// api/token.js
// 한국투자증권 액세스 토큰 발급 + Upstash Redis 캐싱
// 토큰은 23시간 캐시 → 하루 1번만 문자 알림

const KIS_URL = "https://openapi.koreainvestment.com:9443/oauth2/tokenP";
const REDIS_URL = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;

async function redisGet(key) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const r = await fetch(`${REDIS_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    const data = await r.json();
    return data.result || null;
  } catch { return null; }
}

async function redisSet(key, value, exSeconds) {
  if (!REDIS_URL || !REDIS_TOKEN) return;
  try {
    await fetch(`${REDIS_URL}/set/${key}/${encodeURIComponent(value)}?ex=${exSeconds}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
  } catch {}
}

export async function getKISToken() {
  // 1. Redis에서 캐시된 토큰 확인
  const cached = await redisGet("kis_token");
  if (cached) return cached;

  // 2. 새 토큰 발급 (문자 발송됨)
  const r = await fetch(KIS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    }),
  });
  const data = await r.json();
  if (!data.access_token) throw new Error("토큰 발급 실패: " + JSON.stringify(data));

  // 3. Redis에 23시간 캐시
  await redisSet("kis_token", data.access_token, 82800);

  return data.access_token;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    const token = await getKISToken();
    res.status(200).json({ token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
