// api/search.js
// 한국투자증권 종목 검색 API
// 사용: /api/search?q=삼성전기  또는  /api/search?q=NVDA

const KIS_BASE = "https://openapi.koreainvestment.com:9443";

let cachedToken = null;
let tokenExpiry = null;

async function getToken() {
  if (cachedToken && tokenExpiry && new Date() < new Date(tokenExpiry)) return cachedToken;
  const r = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
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

async function searchKR(q, token) {
  // 한국 종목 검색 (종목명 또는 티커)
  const r = await fetch(
    `${KIS_BASE}/uapi/domestic-stock/v1/quotations/search-stock-info?PRDT_TYPE_CD=300&PDNO=${encodeURIComponent(q)}`,
    {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
        tr_id: "CTPF1002R",
      },
    }
  );
  const data = await r.json();
  const o = data.output;
  if (o && o.pdno) {
    return [{
      ticker: o.pdno,
      label: o.prdt_abrv_name || o.prdt_name || o.pdno,
      market: "🇰🇷",
      _custom: true,
    }];
  }

  // 리스트 검색 시도
  const r2 = await fetch(
    `${KIS_BASE}/uapi/domestic-stock/v1/quotations/search-info?PRDT_TYPE_CD=300&PDNO=&PRDT_ABRV_NAME=${encodeURIComponent(q)}&PRDT_TYPE_CD1=`,
    {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
        tr_id: "CTPF1001R",
      },
    }
  );
  const data2 = await r2.json();
  const list = data2.output || [];
  return list.slice(0, 8).map(item => ({
    ticker: item.pdno || item.stck_shrn_iscd,
    label: item.prdt_abrv_name || item.prdt_name || item.pdno,
    market: "🇰🇷",
    _custom: true,
  })).filter(i => i.ticker);
}

async function searchUS(q, token) {
  // 미국 종목 검색
  const exchanges = ["NAS", "NYS", "AMS"];
  const results = [];

  for (const excd of exchanges) {
    try {
      const r = await fetch(
        `${KIS_BASE}/uapi/overseas-price/v1/quotations/search-info?AUTH=&EXCD=${excd}&SYMB=${encodeURIComponent(q.toUpperCase())}`,
        {
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            appkey: process.env.KIS_APP_KEY,
            appsecret: process.env.KIS_APP_SECRET,
            tr_id: "HHDFS76410000",
          },
        }
      );
      const data = await r.json();
      const o = data.output || data.output1;
      if (o && (o.symb || o.rsym)) {
        const ticker = o.symb || o.rsym?.replace(/^(NAS|NYS|AMS)/, "") || q.toUpperCase();
        results.push({
          ticker,
          label: o.ovrs_item_name || o.prdt_name || o.name || ticker,
          market: "🇺🇸",
          _custom: true,
        });
        break;
      }
    } catch { continue; }
  }
  return results;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { q } = req.query;
  if (!q || q.trim().length < 1) return res.status(400).json({ error: "검색어 필요" });

  try {
    const token = await getToken();
    const isKRNum = /^\d+$/.test(q.trim()); // 숫자면 한국 종목코드
    const isKRText = /[가-힣]/.test(q.trim()); // 한글이면 한국 종목명
    const isUS = !isKRNum && !isKRText; // 영문이면 미국 종목

    let results = [];
    if (isKRNum || isKRText) {
      results = await searchKR(q.trim(), token);
    } else {
      results = await searchUS(q.trim(), token);
    }

    res.status(200).json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message, results: [] });
  }
}
