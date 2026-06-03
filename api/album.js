// api/album.js — Apple Music (iTunes API) 앨범 커버 + 색상 추출
// 키 불필요, 완전 무료

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  var body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  var query = body.query;
  if (!query) { res.status(400).json({ error: 'query 없음' }); return; }

  try {
    // ── 1. iTunes Search API로 앨범 검색 ──
    var searchUrl = 'https://itunes.apple.com/search?term='
      + encodeURIComponent(query)
      + '&media=music&entity=album&limit=5&country=kr';

    var searchRes = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    var searchData = await searchRes.json();
    var result = searchData.results && searchData.results[0];

    if (!result || !result.artworkUrl100) {
      // Fallback: country=us 로 재시도
      var searchRes2 = await fetch(
        'https://itunes.apple.com/search?term=' + encodeURIComponent(query)
        + '&media=music&entity=album&limit=5&country=us',
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      var data2 = await searchRes2.json();
      result = data2.results && data2.results[0];
    }

    if (!result || !result.artworkUrl100) {
      res.status(404).json({ error: '앨범을 찾을 수 없습니다', query });
      return;
    }

    // ── 2. 고해상도 커버 URL 생성 (100x100 → 3000x3000) ──
    var coverUrl = result.artworkUrl100
      .replace('100x100bb', '3000x3000bb')
      .replace('100x100bb.jpg', '3000x3000bb.jpg');

    var albumName = result.collectionName;
    var artistName = result.artistName;

    // ── 3. 이미지 다운로드 ──
    var imgRes = await fetch(coverUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!imgRes.ok) {
      // 3000 안되면 600으로 fallback
      coverUrl = result.artworkUrl100.replace('100x100bb', '600x600bb');
      imgRes = await fetch(coverUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    }
    if (!imgRes.ok) {
      res.status(502).json({ error: '이미지 다운로드 실패' });
      return;
    }

    var imgBuf = Buffer.from(await imgRes.arrayBuffer());
    var contentType = imgRes.headers.get('content-type') || 'image/jpeg';

    // ── 4. 픽셀에서 대표 색상 5개 추출 ──
    var palette = extractColors(imgBuf);

    // ── 5. base64 인코딩 ──
    var base64 = imgBuf.toString('base64');

    res.status(200).json({
      ok: true,
      coverUrl,
      source: 'Apple Music',
      albumName,
      artistName,
      palette,
      imageData: 'data:' + contentType + ';base64,' + base64
    });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};

// ── k-means 색상 추출 ──
function extractColors(buf) {
  var pixels = [];
  var step = Math.max(1, Math.floor(buf.length / 3000));

  for (var i = 0; i < buf.length - 2; i += step) {
    var r = buf[i], g = buf[i+1], b = buf[i+2];
    if (r < 5 || g < 5 || b < 5) continue;      // 너무 어두운 픽셀 제외
    if (r > 250 && g > 250 && b > 250) continue; // 순백 제외
    var max = Math.max(r,g,b), min = Math.min(r,g,b);
    var sat = max === 0 ? 0 : (max - min) / max;
    if (sat > 0.06) pixels.push([r, g, b]);
    if (pixels.length >= 3000) break;
  }

  // 채도 있는 픽셀 부족 시 모든 픽셀 포함
  if (pixels.length < 200) {
    pixels = [];
    for (var j = 0; j < buf.length - 2; j += step) {
      pixels.push([buf[j], buf[j+1], buf[j+2]]);
      if (pixels.length >= 3000) break;
    }
  }

  if (pixels.length === 0) return ['#FF2D6A','#0BFFCD','#1A1A2E','#C0C0D0','#7B2FBE'];

  // k-means (k=5, 20 iterations)
  var k = 5;
  var centers = Array.from({length:k}, function(_, ki) {
    return pixels[Math.floor(ki * pixels.length / k)].slice();
  });

  for (var iter = 0; iter < 20; iter++) {
    var clusters = Array.from({length:k}, function() { return []; });
    pixels.forEach(function(p) {
      var best = 0, bestD = Infinity;
      centers.forEach(function(c, ci) {
        var d = (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2;
        if (d < bestD) { bestD = d; best = ci; }
      });
      clusters[best].push(p);
    });
    centers = clusters.map(function(cl, ci) {
      if (!cl.length) return centers[ci];
      return [
        Math.round(cl.reduce(function(s,p){return s+p[0];},0)/cl.length),
        Math.round(cl.reduce(function(s,p){return s+p[1];},0)/cl.length),
        Math.round(cl.reduce(function(s,p){return s+p[2];},0)/cl.length)
      ];
    });
  }

  // 채도 높은 순 정렬
  centers.sort(function(a, b) {
    var sa = (Math.max(...a)-Math.min(...a)) / (Math.max(...a)||1);
    var sb = (Math.max(...b)-Math.min(...b)) / (Math.max(...b)||1);
    return sb - sa;
  });

  return centers.map(function(c) {
    return '#' + c.map(function(v) {
      return Math.min(255, Math.max(0, v)).toString(16).padStart(2,'0').toUpperCase();
    }).join('');
  });
}
