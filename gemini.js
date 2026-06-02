// api/gemini.js — Vercel Serverless Function
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const { model = 'gemini-2.5-flash', payload, key } = req.body;
  // Use env var first, fallback to client-provided key
  const API_KEY = process.env.GEMINI_API_KEY || key;

  if (!API_KEY) {
    res.status(401).json({ error: { message: 'API 키가 없습니다. Vercel 환경변수 GEMINI_API_KEY를 설정하거나 앱에서 키를 입력하세요.' } });
    return;
  }

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
      { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }
    );
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch(e) {
    res.status(500).json({ error: { message: e.message } });
  }
}
