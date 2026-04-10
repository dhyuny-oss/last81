// api/token.js
// 한국투자증권 액세스 토큰 발급
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const r = await fetch("https://openapi.koreainvestment.com:9443/oauth2/tokenP", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
      }),
    });
    const data = await r.json();
    if (!data.access_token) throw new Error(data.msg1 || "토큰 발급 실패");
    res.status(200).json({ token: data.access_token, expires: data.access_token_token_expired });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
