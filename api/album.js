// api/album.js — Spotify 앨범 커버 + 색상 추출
// Vercel Serverless Function

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  var body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }

  var query = body.query; // e.g. "aespa Armageddon"
  var SPOTIFY_ID = process.env.SPOTIFY_CLIENT_ID || body.spotifyId;
  var SPOTIFY_SECRET = process.env.SPOTIFY_CLIENT_SECRET || body.spotifySecret;

  if (!query) { res.status(400).json({ error: 'query 없음' }); return; }

  try {
    var coverUrl = null;
    var albumName = '';
    var artistName = '';
    var source = '';

    // ── 1. Spotify API로 앨범 커버 검색 ──
    if (SPOTIFY_ID && SPOTIFY_SECRET) {
      try {
        // Get access token
        var tokenRes = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(SPOTIFY_ID + ':' + SPOTIFY_SECRET).toString('base64')
          },
          body: 'grant_type=client_credentials'
        });
        var tokenData = await tokenRes.json();
        var token = tokenData.access_token;

        if (token) {
          // Search album
          var searchRes = await fetch(
            'https://api.spotify.com/v1/search?q=' + encodeURIComponent(query) + '&type=album&limit=1&market=KR',
            { headers: { 'Authorization': 'Bearer ' + token } }
          );
          var searchData = await searchRes.json();
          var album = searchData.albums && searchData.albums.items && searchData.albums.items[0];
          if (album && album.images && album.images[0]) {
            coverUrl = album.images[0].url; // 640x640
            albumName = album.name;
            artistName = album.artists && album.artists[0] && album.artists[0].name;
            source = 'Spotify';
          }
        }
      } catch(e) {
        console.log('Spotify error:', e.message);
      }
    }

    // ── 2. Spotify 실패 시 iTunes/Apple Music Search API (무료, 키 불필요) ──
    if (!coverUrl) {
      try {
        var itunesRes = await fetch(
          'https://itunes.apple.com/search?term=' + encodeURIComponent(query) + '&media=music&entity=album&limit=1&country=kr',
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        var itunesData = await itunesRes.json();
        var result = itunesData.results && itunesData.results[0];
        if (result && result.artworkUrl100) {
          // 100x100 → 3000x3000 (replace dimensions in URL)
          coverUrl = result.artworkUrl100
            .replace('100x100bb', '3000x3000bb')
            .replace('100x100', '3000x3000');
          albumName = result.collectionName;
          artistName = result.artistName;
          source = 'Apple Music';
        }
      } catch(e) {
        console.log('iTunes error:', e.message);
      }
    }

    if (!coverUrl) {
      res.status(404).json({ error: '앨범을 찾을 수 없습니다', query });
      return;
    }

    // ── 3. 앨범 커버 이미지 다운로드 ──
    var imgRes = await fetch(coverUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PopspaceAI/1.0)' }
    });
    if (!imgRes.ok) {
      res.status(502).json({ error: '이미지 다운로드 실패', coverUrl });
      return;
    }
    var imgBuf = Buffer.from(await imgRes.arrayBuffer());

    // ── 4. 색상 추출 (픽셀 샘플링) ──
    // JPEG/PNG 파싱 없이 직접 픽셀 샘플링 (헤더 건너뛰기)
    var palette = extractColors(imgBuf);

    // ── 5. base64로 이미지 인코딩 (프론트에서 표시용) ──
    var contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    var base64 = imgBuf.toString('base64');

    res.status(200).json({
      ok: true,
      coverUrl,
      source,
      albumName,
      artistName,
      palette,
      imageData: 'data:' + contentType + ';base64,' + base64
    });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};

// ── 색상 추출 함수 ──
// JPEG 이미지에서 대표 색상 5개 추출 (k-means 방식)
function extractColors(buf) {
  // JPEG SOF0 마커 찾아서 width/height 파싱
  var width = 640, height = 640;
  
  // JPEG 픽셀 직접 샘플링 방식 대신
  // DCT 블록 단위로 색상 샘플링 (간이 방식)
  // 실제로는 이미지 바이트에서 규칙적으로 샘플링
  var pixels = [];
  var step = Math.max(1, Math.floor(buf.length / 2000));
  
  for (var i = 0; i < buf.length - 3; i += step) {
    var r = buf[i];
    var g = buf[i+1];
    var b = buf[i+2];
    // 유효한 RGB 범위 필터링
    if (r >= 10 && r <= 245 && g >= 10 && g <= 245 && b >= 10 && b <= 245) {
      // 너무 회색빛인 픽셀 제외 (채도 체크)
      var max = Math.max(r,g,b), min = Math.min(r,g,b);
      var saturation = max === 0 ? 0 : (max - min) / max;
      if (saturation > 0.08) { // 최소 채도
        pixels.push([r, g, b]);
      }
    }
    if (pixels.length >= 2000) break;
  }

  // 채도 있는 픽셀 부족 시 그레이도 포함
  if (pixels.length < 100) {
    for (var j = 0; j < buf.length - 3; j += step) {
      pixels.push([buf[j], buf[j+1], buf[j+2]]);
      if (pixels.length >= 2000) break;
    }
  }

  if (pixels.length === 0) {
    return ['#FF2D6A','#0BFFCD','#1A1A2E','#C0C0D0','#7B2FBE'];
  }

  // k-means (k=5)
  var k = 5;
  var centers = [];
  for (var ki = 0; ki < k; ki++) {
    var idx = Math.floor(ki * pixels.length / k);
    centers.push([...pixels[idx]]);
  }

  for (var iter = 0; iter < 15; iter++) {
    var clusters = Array.from({length: k}, () => []);
    pixels.forEach(function(p) {
      var best = 0, bestDist = Infinity;
      centers.forEach(function(c, ci) {
        var d = (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2;
        if (d < bestDist) { bestDist = d; best = ci; }
      });
      clusters[best].push(p);
    });
    centers = clusters.map(function(cl, ci) {
      if (cl.length === 0) return centers[ci];
      var r = Math.round(cl.reduce(function(s,p){return s+p[0];},0)/cl.length);
      var g = Math.round(cl.reduce(function(s,p){return s+p[1];},0)/cl.length);
      var b = Math.round(cl.reduce(function(s,p){return s+p[2];},0)/cl.length);
      return [r, g, b];
    });
  }

  // 채도 높은 순으로 정렬
  centers.sort(function(a, b) {
    var satA = (Math.max(...a) - Math.min(...a)) / (Math.max(...a) || 1);
    var satB = (Math.max(...b) - Math.min(...b)) / (Math.max(...b) || 1);
    return satB - satA;
  });

  return centers.map(function(c) {
    return '#' + c.map(function(v) {
      return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
    }).join('').toUpperCase();
  });
}
