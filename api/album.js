// api/album.js — Apple Music 앨범 커버 + 실제 픽셀 색상 추출 (sharp 사용)
const sharp = require('sharp');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  const query = body.query;
  if (!query) { res.status(400).json({ error: 'query 없음' }); return; }

  try {
    // ── 1. iTunes Search API ──
    let result = null;
    for (const country of ['kr', 'us', 'jp']) {
      const r = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=album&limit=3&country=${country}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const data = await r.json();
      if (data.results && data.results[0]) { result = data.results[0]; break; }
    }
    if (!result || !result.artworkUrl100) {
      res.status(404).json({ error: '앨범을 찾을 수 없습니다', query });
      return;
    }

    // ── 2. 고해상도 커버 URL (600x600) ──
    const coverUrl = result.artworkUrl100
      .replace('100x100bb', '600x600bb')
      .replace('/100x100/', '/600x600/');

    // ── 3. 이미지 다운로드 ──
    const imgRes = await fetch(coverUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!imgRes.ok) { res.status(502).json({ error: '이미지 다운로드 실패' }); return; }
    const imgBuf = Buffer.from(await imgRes.arrayBuffer());

    // ── 4. sharp로 실제 픽셀 디코딩 후 색상 추출 ──
    // 이미지를 100x100으로 리사이즈 → raw RGB 픽셀 추출
    const { data: pixels, info } = await sharp(imgBuf)
      .resize(100, 100, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const palette = kmeans(pixels, info.width, info.height, 6);

    // ── 5. base64 인코딩 (프론트 표시용, 원본 이미지) ──
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const base64 = imgBuf.toString('base64');

    res.status(200).json({
      ok: true,
      coverUrl,
      source: 'Apple Music',
      albumName: result.collectionName,
      artistName: result.artistName,
      palette,
      imageData: `data:${contentType};base64,${base64}`
    });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};

// ── k-means 색상 추출 (실제 RGB 픽셀) ──
function kmeans(rawPixels, width, height, k = 6) {
  // 픽셀 배열 구성 (R,G,B 순)
  const pixels = [];
  for (let i = 0; i < rawPixels.length; i += 3) {
    const r = rawPixels[i], g = rawPixels[i+1], b = rawPixels[i+2];
    // 너무 흰색(배경) 제외
    if (r > 245 && g > 245 && b > 245) continue;
    // 너무 어두운 픽셀 제외 (순검정)
    if (r < 8 && g < 8 && b < 8) continue;
    pixels.push([r, g, b]);
  }

  // 픽셀이 너무 적으면 흰/검 포함
  const allPixels = [];
  if (pixels.length < 200) {
    for (let i = 0; i < rawPixels.length; i += 3) {
      allPixels.push([rawPixels[i], rawPixels[i+1], rawPixels[i+2]]);
    }
  }
  const pts = pixels.length >= 200 ? pixels : allPixels;

  if (pts.length === 0) return ['#FFFFFF','#000000','#FF0000','#00FF00','#0000FF','#FFFF00'];

  // 균등 초기 중심점
  let centers = Array.from({ length: k }, (_, ki) =>
    [...pts[Math.floor(ki * pts.length / k)]]
  );

  for (let iter = 0; iter < 25; iter++) {
    const clusters = Array.from({ length: k }, () => []);
    for (const p of pts) {
      let best = 0, bestD = Infinity;
      for (let ci = 0; ci < k; ci++) {
        const c = centers[ci];
        const d = (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2;
        if (d < bestD) { bestD = d; best = ci; }
      }
      clusters[best].push(p);
    }
    const newCenters = clusters.map((cl, ci) => {
      if (!cl.length) return centers[ci];
      return [
        Math.round(cl.reduce((s,p)=>s+p[0],0)/cl.length),
        Math.round(cl.reduce((s,p)=>s+p[1],0)/cl.length),
        Math.round(cl.reduce((s,p)=>s+p[2],0)/cl.length)
      ];
    });
    // 수렴 체크
    const diff = newCenters.reduce((s,c,i)=>
      s + Math.abs(c[0]-centers[i][0]) + Math.abs(c[1]-centers[i][1]) + Math.abs(c[2]-centers[i][2]), 0);
    centers = newCenters;
    if (diff < 3) break;
  }

  // 클러스터 크기로 정렬 (대표색 우선)
  const clusters2 = Array.from({ length: k }, () => 0);
  for (const p of pts) {
    let best = 0, bestD = Infinity;
    for (let ci = 0; ci < k; ci++) {
      const c = centers[ci];
      const d = (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2;
      if (d < bestD) { bestD = d; best = ci; }
    }
    clusters2[best]++;
  }

  // 채도 × 클러스터 크기 점수로 정렬
  const scored = centers.map((c, i) => {
    const max = Math.max(...c), min = Math.min(...c);
    const sat = max > 0 ? (max - min) / max : 0;
    const brightness = (max + min) / 2 / 255;
    // 너무 밝거나 어두운 건 감점
    const brightPenalty = brightness > 0.92 ? 0.2 : (brightness < 0.05 ? 0.3 : 1.0);
    const score = (sat * 0.5 + clusters2[i] / pts.length * 0.5) * brightPenalty;
    return { c, score, size: clusters2[i] };
  });
  scored.sort((a, b) => b.score - a.score);

  // 상위 5개 반환
  return scored.slice(0, 5).map(({ c }) =>
    '#' + c.map(v => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0').toUpperCase()).join('')
  );
}
