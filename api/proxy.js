module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }
  var body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
  var model = body.model || 'gemini-2.5-flash';
  var payload = body.payload;
  var key = process.env.GEMINI_API_KEY || body.key;
  if (!key) { res.status(401).json({ error: { message: 'API 키 없음' } }); return; }
  if (!payload) { res.status(400).json({ error: { message: 'payload 없음' } }); return; }
  try {
    var r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    var data = await r.json();
    res.status(r.status).json(data);
  } catch(e) {
    res.status(500).json({ error: { message: e.message } });
  }
};
