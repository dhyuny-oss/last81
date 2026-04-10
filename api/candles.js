// api/candles.js
// 일봉 차트 데이터 조회 (3개월)
// 사용: /api/candles?ticker=NVDA  또는  /api/candles?ticker=005930

const KIS_BASE = "https://openapi.koreainvestment.com:9443";

let cachedToken = null;
let tokenExpiry = null;

async function getToken() {
  if (cachedToken && tokenExpiry && new Date() < new Date(tokenExpiry)) return cachedToken;
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
  if (!data.access_token) throw new Error("토큰 발급 실패");
  cachedToken = data.access_token;
  tokenExpiry = data.access_token_token_expired;
  return cachedToken;
}

function formatDate(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

async function getKRCandles(ticker, token) {
  const today = new Date();
  const from = new Date(today);
  from.setMonth(from.getMonth() - 6);

  const r = await fetch(
    `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice` +
    `?fid_cond_mrkt_div_code=J&fid_input_iscd=${ticker}` +
    `&fid_input_date_1=${formatDate(from)}&fid_input_date_2=${formatDate(today)}` +
    `&fid_period_div_code=D&fid_org_adj_prc=0`,
    {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
        tr_id: "FHKST03010100",
      },
    }
  );
  const data = await r.json();
  const list = data.output2 || [];
  return list.reverse().map(d => ({
    date: `${parseInt(d.stck_bsop_date.slice(4,6))}/${parseInt(d.stck_bsop_date.slice(6,8))}`,
    close: parseInt(d.stck_clpr),
    high:  parseInt(d.stck_hgpr),
    low:   parseInt(d.stck_lwpr),
    volume: parseInt(d.acml_vol),
  })).filter(c => c.close > 0);
}

async function getUSCandles(ticker, token) {
  const today = new Date();
  const from = new Date(today);
  from.setMonth(from.getMonth() - 6);

  // NASDAQ 먼저, 실패시 NYSE
  for (const excd of ["NAS", "NYS", "AMS"]) {
    try {
      const r = await fetch(
        `${KIS_BASE}/uapi/overseas-price/v1/quotations/dailychartprice` +
        `?AUTH=&EXCD=${excd}&SYMB=${ticker}` +
        `&GUBN=0&BYMD=${formatDate(today)}&MODP=0`,
        {
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            appkey: process.env.KIS_APP_KEY,
            appsecret: process.env.KIS_APP_SECRET,
            tr_id: "HHDFS76240000",
          },
        }
      );
      const data = await r.json();
      const list = data.output2 || [];
      if (!list.length) continue;
      return list.reverse().map(d => ({
        date: `${parseInt(d.xymd.slice(4,6))}/${parseInt(d.xymd.slice(6,8))}`,
        close: parseFloat(d.clos),
        high:  parseFloat(d.high),
        low:   parseFloat(d.low),
        volume: parseInt(d.tvol),
      })).filter(c => c.close > 0);
    } catch { continue; }
  }
  throw new Error("미국 캔들 조회 실패");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: "ticker 파라미터 필요" });

  try {
    const token = await getToken();
    const isKR = /^\d{6}$/.test(ticker);
    const candles = isKR ? await getKRCandles(ticker, token) : await getUSCandles(ticker, token);
    res.status(200).json({ ticker, candles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
