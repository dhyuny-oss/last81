/**
 * /api/info — 198. '이 회사는' 카드 (참고 정보 · 매수!·매도! 판정에는 쓰지 않음)
 *
 *   GET /api/info?t=AMD&m=us   ·   GET /api/info?t=000660&m=kr
 *   → { ok, t, m, name, industry, about: [문장…], news: [{tit, src, dt, url}],
 *       reports: [{bnm, tit, dt}] (🇰🇷 증권사 리포트 제목), ir: {title, date} (🇰🇷 IR 일정),
 *       div: {exDiv, pay, yld} (배당), target: {mean, n} (애널 목표가 평균), naver }
 *
 * 출처: 네이버 증권 공개 화면이 쓰는 주소(한글 회사 소개·뉴스) · 🇰🇷 회사 소개는 와이즈리포트 요약.
 * 키·토큰 필요 없음. 앱이 6시간 동안 기기에 저장해 같은 종목을 다시 묻지 않습니다.
 */
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const OK_US = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const OK_KR = /^[0-9A-Z]{6}$/;

async function getJson(url, ms = 6000) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function getText(url, ms = 6000) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(ms) });
    return r.ok ? await r.text() : null;
  } catch { return null; }
}

const clean = (s) => String(s || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
/** 문장 단위로 자르기 — '…다.' '…음.' 끝 기준. 너무 긴 소개는 앞 n문장만 */
const sentences = (s, n) => (clean(s).match(/[^.]+?(다|음|함|임)\.(?=\s|$)|[^.]+$/g) || []).map(x => x.trim()).filter(x => x.length > 3).slice(0, n);
/** 네이버 날짜 '202610282016' / '20261028194156' / '20261013' → '2026-10-28' */
const ymd = (s) => { const x = String(s || ""); return x.length >= 8 ? `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}` : null; };

/** 뉴스 — 네이버는 비슷한 기사를 묶어 [{items:[…]}] 로 줍니다. 묶음마다 첫 기사 하나.
 *  key 가 있으면 제목·본문에 그 이름이 든 기사만 (이름만 스친 시황 기사 거르기) */
function pickNews(arr, n = 3, key = "") {
  const out = [], seen = new Set();
  for (const g of Array.isArray(arr) ? arr : []) {
    const it = (g?.items || [])[0]; if (!it) continue;
    const tit = clean(it.titleFull || it.title); if (!tit || seen.has(tit)) continue;
    if (key && !(tit.includes(key) || clean(it.body).includes(key))) continue;
    seen.add(tit);
    out.push({ tit, src: it.officeName || "", dt: ymd(it.datetime), url: it.mobileNewsUrl || (it.officeId && it.articleId ? `https://n.news.naver.com/mnews/article/${it.officeId}/${it.articleId}` : null) });
    if (out.length >= n) break;
  }
  return out;
}

/** 회사 이름의 핵심 — 'AMD(어드밴스드 …)' → 'AMD' · '버크셔 해서웨이 Class B' → '버크셔 해서웨이' · 'TSMC ADR' → 'TSMC' */
const coreName = (n) => String(n || "").replace(/\(.*?\)/g, "").replace(/\s+(Class\s+[A-Z]|ADR|보통주|우선주|홀딩스?)\s*$/i, "").replace(/\s+ADR\s*$/i, "").trim();

/** 구글 뉴스(한국어) — 이름을 따옴표로 묶어 최근 14일. 네이버 해외주식 뉴스는 이름만 겹친 기사가 많아 이쪽을 먼저 씁니다 */
async function googleNews(name, n = 3) {
  if (!name) return [];
  const x = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(`"${name}" when:14d`)}&hl=ko&gl=KR&ceid=KR:ko`);
  if (!x) return [];
  const out = [], seen = new Set();
  for (const m of x.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1], g = (re) => { const r = it.match(re); return r ? clean(r[1].replace(/^<!\[CDATA\[|\]\]>$/g, "")) : ""; };
    const src = g(/<source[^>]*>([\s\S]*?)<\/source>/);
    let tit = g(/<title>([\s\S]*?)<\/title>/); if (src && tit.endsWith(` - ${src}`)) tit = tit.slice(0, -(src.length + 3));
    if (!tit || seen.has(tit) || !tit.includes(name)) continue;
    const d = Date.parse(g(/<pubDate>([\s\S]*?)<\/pubDate>/));
    seen.add(tit); out.push({ tit, src, dt: Number.isFinite(d) ? new Date(d + 9 * 3600e3).toISOString().slice(0, 10) : null, url: g(/<link>([\s\S]*?)<\/link>/) || null, ts: d || 0 });
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, n).map(({ ts, ...r }) => r);
}

/** 🇺🇸 네이버 해외주식 코드 — 나스닥은 'AMD.O', 뉴욕은 'CVX', 클래스주는 'BRKb' */
async function usCode(t) {
  const cands = [t, `${t}.O`, t.replace(/[-.]([A-Z])$/, (_, c) => c.toLowerCase()), `${t}.K`];
  for (const c of [...new Set(cands)]) {
    const j = await getJson(`https://api.stock.naver.com/stock/${encodeURIComponent(c)}/basic`, 4000);
    if (j?.reutersCode) return { code: j.reutersCode, basic: j };
  }
  return null;
}

async function infoUs(t) {
  const hit = await usCode(t);
  if (!hit) return { ok: false, msg: "네이버에서 이 종목을 찾지 못했습니다" };
  const { code, basic } = hit;
  const [ov, news, integ] = await Promise.all([
    getJson(`https://api.stock.naver.com/stock/${code}/overview`),
    getJson(`https://api.stock.naver.com/news/stock/${code}?pageSize=20&page=1`),
    getJson(`https://api.stock.naver.com/stock/${code}/integration`),
  ]);
  const tot = Object.fromEntries((basic.stockItemTotalInfos || []).map(x => [x.code, x.value]));
  const dot = (v) => (v && v !== "N/A") ? v.replace(/\.$/, "").replace(/\./g, "-") : null;
  const cns = integ?.consensusInfo;
  const name = basic.stockName || ov?.companyName || t, key = coreName(name) || t;
  let nws = await googleNews(key);
  if (!nws.length) nws = pickNews(news, 3, key);
  const na = (v) => v && v !== "N/A" ? v : null;
  return {
    ok: true, name,
    industry: ov?.industry?.industryGroupKor || na(tot.industryGroupKor),
    about: sentences(ov?.summary || integ?.corporateOverview || "", 3),
    news: nws,
    reports: [],
    ir: null,
    div: (dot(tot.exDividendAt) || na(tot.dividendYieldRatio)) ? { exDiv: dot(tot.exDividendAt), pay: dot(tot.dividendAt), yld: na(tot.dividendYieldRatio) } : null,
    target: cns?.priceTargetMean ? { mean: cns.priceTargetMean, at: cns.createDate || null } : null,
    naver: basic.endUrl || `https://m.stock.naver.com/worldstock/stock/${code}/total`,
  };
}

async function infoKr(t) {
  const [integ, news, wise] = await Promise.all([
    getJson(`https://m.stock.naver.com/api/stock/${t}/integration`),
    getJson(`https://m.stock.naver.com/api/news/stock/${t}?pageSize=12&page=1`),
    getText(`https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd=${t}`),
  ]);
  if (!integ && !news && !wise) return { ok: false, msg: "네이버 응답 없음" };
  // 와이즈리포트 '기업 개요' 3줄 (<li class="dot_cmp">)
  const about = [];
  for (const m of String(wise || "").matchAll(/<li class="dot_cmp"[^>]*>([\s\S]*?)<\/li>/g)) { const x = clean(m[1]); if (x) about.push(x); if (about.length >= 3) break; }
  const tot = Object.fromEntries((integ?.totalInfos || []).map(x => [x.code, x.value]));
  const ir = integ?.irScheduleInfo;
  const name = integ?.stockName || t, key = coreName(name);
  let nws = pickNews(news, 3, key);                 // 🇰🇷 은 네이버가 종목에 붙인 기사 — 그래도 이름이 든 것 먼저
  if (nws.length < 3) for (const x of pickNews(news, 6)) { if (nws.length >= 3) break; if (!nws.some(y => y.tit === x.tit)) nws.push(x); }
  return {
    ok: true, name,
    industry: null,
    about,
    news: nws,
    reports: (integ?.researches || []).slice(0, 3).map(r => ({ bnm: r.bnm, tit: clean(r.tit), dt: ymd(r.wdt) })),
    ir: ir?.irScheduleDate ? { title: ir.title, date: ir.irScheduleDate } : null,
    div: tot.dividendYieldRatio && tot.dividendYieldRatio !== "N/A" ? { exDiv: null, pay: null, yld: tot.dividendYieldRatio } : null,
    target: integ?.consensusInfo?.priceTargetMean ? { mean: integ.consensusInfo.priceTargetMean, at: integ.consensusInfo.createDate || null } : null,
    naver: `https://m.stock.naver.com/domestic/stock/${t}/total`,
  };
}

export default async function handler(req, res) {
  const m = String(req.query?.m || "").toLowerCase() === "kr" ? "kr" : "us";
  const t = String(req.query?.t || "").trim().toUpperCase();
  if (!(m === "kr" ? OK_KR : OK_US).test(t)) return res.status(400).json({ ok: false, msg: "t=티커 (🇺🇸 AMD · 🇰🇷 000660) 가 필요합니다" });
  try {
    const out = m === "kr" ? await infoKr(t) : await infoUs(t);
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=3600");
    return res.status(200).json({ t, m, at: new Date().toISOString(), ...out });
  } catch (e) {
    return res.status(200).json({ ok: false, t, m, msg: String(e?.message || e).slice(0, 120) });
  }
}
