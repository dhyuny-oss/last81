// api/analyze.js
// Anthropic API 프록시 — 브라우저에서 직접 호출 불가 → 서버 경유
// 사용: POST /api/analyze  { prompt, tools?, max_tokens? }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { prompt, tools, max_tokens = 500 } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "prompt 필요" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY 환경변수 없음" });

  try {
    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens,
      messages: [{ role: "user", content: prompt }],
    };
    if (tools && tools.length > 0) body.tools = tools;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "API 오류" });

    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
