// api/quote.js
// 종목 현재가 + 기본 정보 조회
// 사용: /api/quote?ticker=NVDA  또는  /api/quote?ticker=005930

const KIS_BASE_KR = "https://openapi.koreainvestment.com:9443";
const KIS_BASE_US = "https://openapi.koreainvestment.com:9443";

// 토큰 캐시 (Vercel 서버리스 함수 인스턴스 내 임시 캐시)
let cachedToken = null;
let tokenExpiry = null;

async function getToken() {
  if (cachedToken && tokenExpiry && new Date() < new Date(tokenExpiry)) {
    return cachedToken;
  }
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
  if (!data.access_token) throw new Error("토큰 발급 실패: " + JSON.stringify(data));
  cachedToken = data.access_token;
  tokenExpiry = data.access_token_token_expired;
  return cachedToken;
}

async function getKRName(ticker, token) {
  // 한국 종목명 조회
  try {
    const r = await fetch(
      `${KIS_BASE_KR}/uapi/domestic-stock/v1/quotations/search-stock-info?PRDT_TYPE_CD=300&PDNO=${ticker}`,
      { headers: { "content-type":"application/json", authorization:`Bearer ${token}`, appkey:process.env.KIS_APP_KEY, appsecret:process.env.KIS_APP_SECRET, tr_id:"CTPF1002R" } }
    );
    const d = await r.json();
    const o = d.output;
    return o?.prdt_abrv_name || o?.prdt_name || o?.stck_shrn_iscd || null;
  } catch { return null; }
}

async function getKRQuote(ticker, token) {
  const r = await fetch(
    `${KIS_BASE_KR}/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${ticker}`,
    {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
        tr_id: "FHKST01010100",
      },
    }
  );
  const data = await r.json();
  // 종목명 병렬 조회
  const namePromise = getKRName(ticker, token);
  // 한투 API는 output 또는 output1 으로 옴
  const o = data.output || data.output1;
  if (!o || !o.stck_prpr) throw new Error("한국 종목 조회 실패: " + JSON.stringify(data).slice(0,200));
  // 디버그: 어떤 필드가 있는지 확인
  console.log("KR output fields:", Object.keys(o));

  const price = parseInt(o.stck_prpr);
  const prevClose = parseInt(o.stck_bsop_prpr || o.stck_prpr);
  const change = parseInt(o.prdy_vrss);
  const changePct = parseFloat(o.prdy_ctrt);

  return {
    ticker,
    label: (await namePromise) || o.hts_kor_isnm || o.itms_shrt_nm || ticker,
    price,
    change,
    changePct,
    market: "🇰🇷",
    sector: "Technology",
    per: parseFloat(o.per) || 0,
    pbr: parseFloat(o.pbr) || 0,
    eps: parseFloat(o.eps) || 0,
    mktCap: parseInt(o.hts_avls) || 0,
    volume: parseInt(o.acml_vol) || 0,
    w52High: parseInt(o.w52_hgpr) || 0,
    w52Low: parseInt(o.w52_lwpr) || 0,
    target: Math.round(price * 1.2),
    roe: 0, rev: 0, revGrowth: 0, liquidity: 2,
    base: Math.round(price * 0.88), vol: 0.02, drift: 0.001,
  };
}

async function getUSQuote(ticker, token) {
  // 미국 종목명 조회 (ovrs_item_name 필드)
  let stockName = ticker;
  try {
    const nr = await fetch(
      `${KIS_BASE_US}/uapi/overseas-price/v1/quotations/search-info?AUTH=&EXCD=NAS&SYMB=${ticker}`,
      { headers: { "content-type":"application/json", authorization:`Bearer ${token}`, appkey:process.env.KIS_APP_KEY, appsecret:process.env.KIS_APP_SECRET, tr_id:"HHDFS76410000" } }
    );
    const nd = await nr.json();
    const no = nd.output || nd.output1;
    if(no) stockName = no.ovrs_item_name || no.prdt_name || no.name || no.symb || ticker;
  } catch {}

  const r = await fetch(
    `${KIS_BASE_US}/uapi/overseas-price/v1/quotations/price?AUTH=&EXCD=NAS&SYMB=${ticker}`,
    {
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET,
        tr_id: "HHDFS00000300",
      },
    }
  );
  const data = await r.json();
  const o = data.output;
  if (!o || !o.last) {
    // NAS 실패시 NYSE 시도
    const r2 = await fetch(
      `${KIS_BASE_US}/uapi/overseas-price/v1/quotations/price?AUTH=&EXCD=NYS&SYMB=${ticker}`,
      {
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          appkey: process.env.KIS_APP_KEY,
          appsecret: process.env.KIS_APP_SECRET,
          tr_id: "HHDFS00000300",
        },
      }
    );
    const data2 = await r2.json();
    const o2 = data2.output;
    if (!o2 || !o2.last) throw new Error("미국 종목 조회 실패");
    return buildUSResult(ticker, o2, stockName);
  }
  return buildUSResult(ticker, o, stockName);
}

function buildUSResult(ticker, o, stockName=ticker) {
  const price = parseFloat(o.last);
  const prev = parseFloat(o.base || o.last);
  const change = parseFloat(o.diff || 0);
  const changePct = parseFloat(o.rate || 0);
  return {
    ticker,
    label: stockName,
    price,
    change,
    changePct,
    market: "🇺🇸",
    sector: "Technology",
    per: 0, pbr: 0, eps: 0, mktCap: 0,
    volume: parseInt(o.tvol) || 0,
    w52High: parseFloat(o.h52p) || 0,
    w52Low: parseFloat(o.l52p) || 0,
    target: parseFloat((price * 1.2).toFixed(2)),
    roe: 0, rev: 0, revGrowth: 0, liquidity: 2,
    base: parseFloat((price * 0.88).toFixed(2)), vol: 0.02, drift: 0.001,
  };
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
    const result = isKR ? await getKRQuote(ticker, token) : await getUSQuote(ticker, token);
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
