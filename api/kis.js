/**
 * /api/kis — 한국투자증권 Open API · 미국 주식 잔고 조회 + 모의투자 주문
 * ════════════════════════════════════════════════════════════
 * 실전(real) 계좌에서는 "조회만" 됩니다. 주문·취소는 모의투자(demo)에서만 열립니다 (코드로 잠금).
 * 앱 본체·내 종목·텔레그램·수집 파이프라인 어디에도 영향을 주지 않습니다.
 *
 * ▣ 빼는 방법 (네 군데)
 *   1) src/App.jsx 에서 "★ 한투" 라고 적힌 두 곳 삭제
 *   2) src/Kis.jsx 삭제
 *   3) api/kis.js (이 파일) 삭제
 *   4) Vercel 환경변수 KIS_* 삭제 + 한투 앱에서 Open API 해지
 *
 * ▣ Vercel 환경변수 (Settings → Environment Variables · 채팅/깃허브에 적지 마세요)
 *   KIS_DEMO_APP_KEY / KIS_DEMO_APP_SECRET / KIS_DEMO_ACCOUNT   모의투자용 (KIS_ENV=demo 일 때 사용)
 *   KIS_APP_KEY / KIS_APP_SECRET / KIS_ACCOUNT(또는 KIS_ACCOUNT_NO)  실전용 (KIS_ENV=real 일 때만 · 기존 시세 수집과 같은 키)
 *   계좌번호는 8자리 + 상품코드 2자리 (예: 12345678-01 · 하이픈 있어도 없어도 됨)
 *   KIS_ENV          demo(모의·기본값) 또는 real(실전)
 *   KIS_REAL_ORDER   (실전 주문 스위치) on 이라고 넣어야만 실전 주문이 열립니다. 없으면 실전은 조회만.
 *   KIS_MAX_DAY_USD  (선택) 하루 매수 합계 상한 — 기본 모의 20000 · 실전 4000 달러
 *   KIS_PIN          내가 정하는 비밀번호. 앱에서 한 번 입력. 실전 조회와 모든 주문에 필수입니다.
 *   KIS_MAX_USD      (선택) 주문 1건 금액 상한 — 기본 모의 5000 · 실전 1500 달러
 *   KIS_HTS_ID       (선택) 한투 HTS 아이디 — 있어야 "관심 그룹 불러오기"가 됩니다
 *
 * ▣ 쓰는 법  POST /api/kis  { what, tok, ... } + 헤더 x-kis-pin   (GET 은 설정 상태만)
 *   what="balance"              보유 종목                          → rows, sum
 *   what="orders"               최근 주문·미체결                    → orders, dayBuy(오늘 매수 합계)
 *   what="order"                주문 { side, t, ex, qty, px, rid, confirm:true }   (모의 · 실전은 KIS_REAL_ORDER=on 일 때만)
 *   what="cancel"               주문 취소 { odno, t, ex, qty }
 *   what="quote"                지금 가격 { list:[{t, ex}], idx:true }  → quotes{t:{ex,last,base,rate}}, idx{QQQ,SPY}
 *   what="groups" / "group"     한투 관심 그룹 목록 / 그룹 안 종목 { code }   (국내 중심 · 한투 → 앱 한 방향)
 *   모든 응답에 새 접속 토큰 꾸러미 tok 가 들어옵니다.
 *
 * ▣ 접속 토큰 (한투 규칙: 유효 1일 · 재발급 1분에 1회 · 발급 때마다 알림톡)
 *   서버리스는 기억이 없어서, 발급받은 토큰을 앱 시크릿으로 잠가(AES-256-GCM) 브라우저에 맡겨 둡니다(tok).
 *
 * 규격 출처: 한투 공식 샘플 github.com/koreainvestment/open-trading-api
 *   토큰 POST /oauth2/tokenP
 *   잔고 GET inquire-balance (TTTS3012R / VTTS3012R) · 주문 POST order (모의 매수 VTTT1002U · 매도 VTTT1001U)
 *   취소 POST order-rvsecncl (VTTT1004U) · 주문내역 GET inquire-ccnl (VTTS3035R)
 *   실전: 매수 TTTT1002U · 매도 TTTT1006U · 취소 TTTT1004U · 주문내역 TTTS3035R
 *   현재가 GET /uapi/overseas-price/v1/quotations/price (HHDFS00000300 · 거래소 NAS/NYS/AMS)
 *   관심 그룹 GET intstock-grouplist (HHKCM113004C7) · 그룹 종목 GET intstock-stocklist-by-group (HHKCM113004C6)
 */
import crypto from "node:crypto";

const HOST = { real: "https://openapi.koreainvestment.com:9443", demo: "https://openapivts.koreainvestment.com:29443" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
const US_EX = ["NASD", "NYSE", "AMEX"];

function cfg() {
  const env = String(process.env.KIS_ENV || "demo").trim().toLowerCase() === "real" ? "real" : "demo";
  const demo = env === "demo";   // 모의는 KIS_DEMO_* 전용 이름 — 기존 실전 키(KIS_APP_KEY 등)와 섞이지 않게
  const acct = String((demo ? process.env.KIS_DEMO_ACCOUNT : (process.env.KIS_ACCOUNT || process.env.KIS_ACCOUNT_NO)) || "").replace(/\D/g, "");
  return { env, key: String((demo ? process.env.KIS_DEMO_APP_KEY : process.env.KIS_APP_KEY) || "").trim(),
           sec: String((demo ? process.env.KIS_DEMO_APP_SECRET : process.env.KIS_APP_SECRET) || "").trim(),
           cano: acct.slice(0, 8), prod: acct.slice(8, 10) || "01", acctOk: acct.length === 8 || acct.length === 10,
           pin: (process.env.KIS_PIN || "").trim(), maxUsd: num(process.env.KIS_MAX_USD) || (demo ? 5000 : 1500),
           maxDay: num(process.env.KIS_MAX_DAY_USD) || (demo ? 20000 : 4000),
           realOrder: String(process.env.KIS_REAL_ORDER || "").trim().toLowerCase() === "on",
           hts: (process.env.KIS_HTS_ID || "").trim() };
}

/* ── 토큰 꾸러미 잠그기·풀기 ── */
const boxKey = (c) => crypto.createHash("sha256").update(`${c.sec}|${c.key}|${c.env}|kis-token-v1`).digest();
function seal(c, obj) {
  const iv = crypto.randomBytes(12), ci = crypto.createCipheriv("aes-256-gcm", boxKey(c), iv);
  const body = Buffer.concat([ci.update(JSON.stringify(obj), "utf8"), ci.final()]);
  return Buffer.concat([iv, ci.getAuthTag(), body]).toString("base64url");
}
function unseal(c, blob) {
  try {
    const b = Buffer.from(String(blob || ""), "base64url"); if (b.length < 40) return null;
    const de = crypto.createDecipheriv("aes-256-gcm", boxKey(c), b.subarray(0, 12)); de.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([de.update(b.subarray(28)), de.final()]).toString("utf8"));
  } catch { return null; }
}

let MEM = null;                                         // 같은 서버 인스턴스가 살아 있는 동안만 유지
const alive = (t) => t && t.token && t.exp - Date.now() > 10 * 60 * 1000;   // 만료 10분 전부터는 새로 받음

async function issue(c) {
  const r = await fetch(`${HOST[c.env]}/oauth2/tokenP`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "text/plain", charset: "UTF-8" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: c.key, appsecret: c.sec }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const why = j.error_description || j.msg1 || j.error_code || `HTTP ${r.status}`;
    throw new Error(`접속 토큰을 받지 못했습니다 — ${why}${/1분|EGW00133/.test(String(why) + (j.error_code || "")) ? " (1분 뒤 다시 눌러 주세요)" : ""}`);
  }
  let exp = Date.now() + (num(j.expires_in) || 86400) * 1000;       // 만료 시각: "2026-10-05 10:45:00"(한국 시간) 또는 expires_in(초)
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)$/.exec(j.access_token_token_expired || "");
  if (m) exp = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +m[6]);
  return { token: j.access_token, exp };
}
async function getToken(c, blob, force) {
  if (!force) {
    if (alive(MEM)) return MEM;
    const b = unseal(c, blob); if (alive(b)) return (MEM = b);
  }
  return (MEM = await issue(c));
}

/** 한투 호출 한 번. 토큰이 죽었으면 한 번만 새로 받아 다시 보냅니다. ctx.tok 은 호출 뒤 최신 토큰 */
async function kis(c, ctx, method, path, trId, data, trCont = "") {
  const once = async () => {
    const isPost = method === "POST";
    const r = await fetch(`${HOST[c.env]}${path}${isPost ? "" : "?" + new URLSearchParams(data)}`, {
      method, body: isPost ? JSON.stringify(data) : undefined,
      headers: { "Content-Type": "application/json", Accept: "text/plain", charset: "UTF-8", authorization: `Bearer ${ctx.tok.token}`,
                 appkey: c.key, appsecret: c.sec, tr_id: trId, custtype: "P", tr_cont: trCont } });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, cont: r.headers.get("tr_cont") || "", j };
  };
  let x = await once();
  for (let n = 0; n < 3 && /EGW00201/.test(`${x.j?.msg_cd || ""} ${x.j?.msg1 || ""}`); n++) { await sleep(1100 + n * 600); x = await once(); }   // "초당 거래건수 초과" → 잠깐 쉬고 다시 (최대 3번)
  if (/EGW00123|EGW00121|기간이 만료된 token|유효하지 않은 token/.test(`${x.j?.msg_cd || ""} ${x.j?.msg1 || ""}`) && !ctx.reissued) {
    ctx.reissued = true; ctx.tok = await getToken(c, null, true); x = await once();
  }
  if (x.j?.rt_cd !== "0") throw new Error(`한투 응답 오류 — ${x.j?.msg1 || `HTTP ${x.status}`}${x.j?.msg_cd ? ` (${x.j.msg_cd})` : ""}`);
  return x;
}
const gapOf = (c) => (c.env === "real" ? 120 : 800);      // 초당 호출 제한 (모의가 더 빡빡함)

/* ── 보유 종목 (조회) ── */
async function usBalance(c, ctx, only) {
  const trId = c.env === "real" ? "TTTS3012R" : "VTTS3012R";
  const exchanges = only ? [only] : c.env === "real" ? ["NASD"] : US_EX;
  const rows = new Map();
  for (let e = 0; e < exchanges.length; e++) {
    let fk = "", nk = "", cont = "";
    for (let page = 0; page < 5; page++) {
      if (e + page > 0) await sleep(gapOf(c));
      const x = await kis(c, ctx, "GET", "/uapi/overseas-stock/v1/trading/inquire-balance", trId,
        { CANO: c.cano, ACNT_PRDT_CD: c.prod, OVRS_EXCG_CD: exchanges[e], TR_CRCY_CD: "USD", CTX_AREA_FK200: fk, CTX_AREA_NK200: nk }, cont);
      const out = Array.isArray(x.j.output1) ? x.j.output1 : x.j.output1 ? [x.j.output1] : [];
      for (const o of out) {
        const t = String(o.ovrs_pdno || "").trim(), qty = num(o.ovrs_cblc_qty);
        if (!t || qty <= 0) continue;
        const avg = num(o.pchs_avg_pric), px = num(o.now_pric2);
        const cost = num(o.frcr_pchs_amt1) || avg * qty, val = num(o.ovrs_stck_evlu_amt) || px * qty;
        rows.set(`${t}|${o.ovrs_excg_cd || exchanges[e]}`, { t, n: String(o.ovrs_item_name || "").trim(), ex: o.ovrs_excg_cd || exchanges[e],
          qty, ord: num(o.ord_psbl_qty) || qty, avg, px, cost, val, pl: val - cost, plPct: cost > 0 ? (val / cost - 1) * 100 : 0 });
      }
      if (x.cont === "F" || x.cont === "M") { fk = x.j.ctx_area_fk200 || ""; nk = x.j.ctx_area_nk200 || ""; cont = "N"; } else break;
    }
  }
  const list = [...rows.values()].sort((a, b) => b.val - a.val);
  const cost = list.reduce((s, r) => s + r.cost, 0), val = list.reduce((s, r) => s + r.val, 0);
  return { rows: list, sum: { n: list.length, cost, val, pl: val - cost, plPct: cost > 0 ? (val / cost - 1) * 100 : 0 } };
}

/* ── 주문 내역 (공식 샘플: 모의는 전체 조회만 가능 → 빈 값 · 실전은 전체가 "%") ── */
const ymd = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`; };
async function recentOrders(c, ctx) {
  const now = Date.now() - 5 * 3600 * 1000;               // 미국 현지 날짜(대략)
  const all = c.env === "real" ? "%" : "";
  const x = await kis(c, ctx, "GET", "/uapi/overseas-stock/v1/trading/inquire-ccnl", c.env === "real" ? "TTTS3035R" : "VTTS3035R", {
    CANO: c.cano, ACNT_PRDT_CD: c.prod, PDNO: all, ORD_STRT_DT: ymd(now - 6 * 86400000), ORD_END_DT: ymd(Date.now() + 9 * 3600000), SLL_BUY_DVSN: "00",
    CCLD_NCCS_DVSN: "00", OVRS_EXCG_CD: all, SORT_SQN: "DS", ORD_DT: "", ORD_GNO_BRNO: "", ODNO: "", CTX_AREA_NK200: "", CTX_AREA_FK200: "" });
  const out = Array.isArray(x.j.output) ? x.j.output : x.j.output ? [x.j.output] : [];
  return out.map((o) => ({
    odno: String(o.odno || "").trim(), orgn: String(o.orgn_odno || "").trim(), dt: o.ord_dt || "", tm: o.ord_tmd || "",
    side: o.sll_buy_dvsn_cd === "01" ? "sell" : "buy", t: String(o.pdno || "").trim(), n: String(o.prdt_name || "").trim(),
    ex: o.ovrs_excg_cd || "", qty: num(o.ft_ord_qty), px: num(o.ft_ord_unpr3), filled: num(o.ft_ccld_qty), fpx: num(o.ft_ccld_unpr3),
    open: num(o.nccs_qty), state: String(o.prcs_stat_name || "").trim(), why: String(o.rjct_rson_name || "").trim(),
    kind: String(o.rvse_cncl_dvsn_name || "").trim() })).filter((o) => o.odno).sort((a, b) => (b.dt + b.tm).localeCompare(a.dt + a.tm));
}

/* 오늘 미국 장(한 번의 장은 한국 날짜 이틀에 걸침)에 낸 매수 합계 — 체결분은 체결가, 대기분은 주문가. 취소·거부는 0 */
const sess = (ms) => ymd(ms);                           // 세계표준시 날짜 = 한국 22:30~05:00(미국 장 한 번)이 같은 날로 묶임
const sessOfOrder = (o) => { const m = /^(\d{4})(\d\d)(\d\d)$/.exec(o.dt || ""), t = /^(\d\d)(\d\d)/.exec(o.tm || "");
  return m ? ymd(Date.UTC(+m[1], +m[2] - 1, +m[3], t ? +t[1] : 12, t ? +t[2] : 0) - 9 * 3600000) : ""; };
const dayBuyOf = (orders) => { const today = sess(Date.now());
  return orders.filter((o) => o.side === "buy" && !o.orgn && sessOfOrder(o) === today).reduce((s, o) => s + o.filled * (o.fpx || o.px) + o.open * o.px, 0); };

/* ── 지금 가격 (거래소를 모르면 나스닥 → 뉴욕 → 아멕스 순으로 찾아봄) ── */
const EXCD = { NASD: "NAS", NYSE: "NYS", AMEX: "AMS" };
async function quoteOne(c, ctx, t, hint, gap) {
  const order = [hint, ...US_EX].filter((e, i, a) => US_EX.includes(e) && a.indexOf(e) === i);
  for (let i = 0; i < order.length; i++) {
    if (gap.n++ > 0) await sleep(gapOf(c));
    const x = await kis(c, ctx, "GET", "/uapi/overseas-price/v1/quotations/price", "HHDFS00000300", { AUTH: "", EXCD: EXCD[order[i]], SYMB: t });
    const o = x.j.output || {}, last = num(o.last);
    if (last > 0) { const base = num(o.base); return { ex: order[i], last, base, rate: base > 0 ? (last / base - 1) * 100 : num(o.rate) }; }
  }
  return null;
}
async function quotes(c, ctx, b) {
  const list = (Array.isArray(b.list) ? b.list : []).slice(0, 8).map((q) => ({ t: String(q?.t || "").toUpperCase().trim(), ex: String(q?.ex || "").toUpperCase() }))
    .filter((q) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(q.t));
  const gap = { n: 0 }, out = {}, idx = {};
  if (b.idx) for (const [t, ex] of [["QQQ", "NASD"], ["SPY", "AMEX"]]) { try { idx[t] = await quoteOne(c, ctx, t, ex, gap); } catch { idx[t] = null; } }
  for (const q of list) { try { out[q.t] = await quoteOne(c, ctx, q.t, q.ex, gap); } catch (e) { out[q.t] = null; } }
  return { quotes: out, idx };
}

/* ── 주문·취소 (모의 · 실전은 KIS_REAL_ORDER=on 일 때만) ── */
const RID = new Map();                                  // 같은 요청 번호 재전송 막기 (서버가 살아 있는 동안)
const canOrder = (c) => c.env === "demo" || c.realOrder;
function orderGate(c) { if (!canOrder(c)) throw new Error("실전 주문은 잠겨 있습니다 — Vercel 환경변수 KIS_REAL_ORDER=on 을 넣어야 열립니다 (지금은 조회만)"); }
const TR = (c, k) => ({ buy: ["VTTT1002U", "TTTT1002U"], sell: ["VTTT1001U", "TTTT1006U"], cancel: ["VTTT1004U", "TTTT1004U"] })[k][c.env === "real" ? 1 : 0];
async function placeOrder(c, ctx, b) {
  orderGate(c);
  const side = b.side === "sell" ? "sell" : b.side === "buy" ? "buy" : "";
  const t = String(b.t || "").toUpperCase().trim(), ex = String(b.ex || "").toUpperCase();
  const qty = Math.floor(num(b.qty)), px = Math.round(num(b.px) * 100) / 100;
  if (!side) throw new Error("매수/매도 구분이 없습니다");
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)) throw new Error("종목 코드가 올바르지 않습니다");
  if (!US_EX.includes(ex)) throw new Error("거래소는 NASD · NYSE · AMEX 중 하나여야 합니다");
  if (!(qty >= 1 && qty <= 100000)) throw new Error("수량은 1주 이상이어야 합니다");
  if (!(px > 0 && px < 100000)) throw new Error("지정가를 입력해 주세요 (지정가 주문만 됩니다)");
  if (qty * px > c.maxUsd) throw new Error(`주문 1건 상한 $${c.maxUsd.toLocaleString("en-US")} 를 넘습니다 (${qty}주 × $${px} = $${(qty * px).toFixed(0)})`);
  if (b.confirm !== true) throw new Error("확인 단계를 거치지 않은 주문입니다");
  const rid = String(b.rid || "");
  if (!/^[A-Za-z0-9\-]{8,64}$/.test(rid)) throw new Error("주문 번호표(rid)가 없습니다");
  if (RID.has(rid)) throw new Error("방금 보낸 같은 주문입니다 — 아래 주문 내역을 확인해 주세요");
  RID.set(rid, Date.now()); for (const [k, v] of RID) if (Date.now() - v > 3600000) RID.delete(k);
  // 중복·초과 방지: 같은 종목·방향·수량·가격의 미체결이 이미 있으면 막음 / 매도는 가진 수량 이내로
  const fail = (m) => { RID.delete(rid); throw new Error(m); };
  const hist = await recentOrders(c, ctx);
  const open = hist.filter((o) => o.open > 0 && !o.orgn);
  if (side === "buy") {                                   // 하루 매수 합계 상한
    const used = dayBuyOf(hist);
    if (used + qty * px > c.maxDay) fail(`하루 매수 상한 $${c.maxDay.toLocaleString("en-US")} 를 넘습니다 (오늘 이미 $${used.toFixed(0)} + 이번 $${(qty * px).toFixed(0)})`);
  }
  // 지정가가 지금 가격에서 너무 벗어나면 막음 (잘못 누름 · 폭등 추격 · 헐값 매도 방지)
  await sleep(gapOf(c));
  let q = null; try { q = await quoteOne(c, ctx, t, ex, { n: 0 }); } catch { q = null; }
  if (!q) { if (c.env === "real") fail("지금 가격을 확인하지 못해 실전 주문을 보내지 않았습니다 — 잠시 뒤 다시 눌러 주세요"); }
  else if (q.ex !== ex) fail(`${t} 은(는) ${{ NASD: "나스닥", NYSE: "뉴욕", AMEX: "아멕스" }[q.ex]} 종목입니다 — 거래소를 바꿔 주세요`);
  else if (side === "buy" && px > q.last * 1.03) fail(`지정가 $${px} 가 지금 가격 $${q.last} 보다 3% 넘게 높습니다`);
  else if (side === "sell" && px < q.last * 0.97) fail(`지정가 $${px} 가 지금 가격 $${q.last} 보다 3% 넘게 낮습니다`);
  if (open.some((o) => o.t === t && o.side === side && o.qty === qty && o.px === px)) { RID.delete(rid); throw new Error("같은 종목·수량·가격의 미체결 주문이 이미 있습니다"); }
  if (side === "sell") {
    await sleep(gapOf(c));
    const have = (await usBalance(c, ctx, ex)).rows.find((r) => r.t === t);
    const pending = open.filter((o) => o.t === t && o.side === "sell").reduce((s, o) => s + o.open, 0);
    if (!have || have.qty - pending < qty) { RID.delete(rid); throw new Error(`팔 수 있는 수량이 부족합니다 (보유 ${have ? have.qty : 0}주 · 매도 대기 ${pending}주)`); }
  }
  await sleep(gapOf(c));
  const x = await kis(c, ctx, "POST", "/uapi/overseas-stock/v1/trading/order", TR(c, side), {
    CANO: c.cano, ACNT_PRDT_CD: c.prod, OVRS_EXCG_CD: ex, PDNO: t, ORD_QTY: String(qty), OVRS_ORD_UNPR: px.toFixed(2),
    CTAC_TLNO: "", MGCO_APTM_ODNO: "", SLL_TYPE: side === "sell" ? "00" : "", ORD_SVR_DVSN_CD: "0", ORD_DVSN: "00" });
  const o = x.j.output || {};
  return { placed: { side, t, ex, qty, px, odno: String(o.ODNO || o.odno || ""), msg: x.j.msg1 || "" } };
}
async function cancelOrder(c, ctx, b) {
  orderGate(c);
  const t = String(b.t || "").toUpperCase().trim(), ex = String(b.ex || "").toUpperCase(), odno = String(b.odno || "").trim(), qty = Math.floor(num(b.qty));
  if (!/^\d{1,12}$/.test(odno)) throw new Error("원주문번호가 올바르지 않습니다");
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t) || !US_EX.includes(ex) || !(qty >= 1)) throw new Error("취소할 주문 정보가 올바르지 않습니다");
  const x = await kis(c, ctx, "POST", "/uapi/overseas-stock/v1/trading/order-rvsecncl", TR(c, "cancel"), {
    CANO: c.cano, ACNT_PRDT_CD: c.prod, OVRS_EXCG_CD: ex, PDNO: t, ORGN_ODNO: odno, RVSE_CNCL_DVSN_CD: "02",
    ORD_QTY: String(qty), OVRS_ORD_UNPR: "0", MGCO_APTM_ODNO: "", ORD_SVR_DVSN_CD: "0" });
  return { cancelled: { odno, t, msg: x.j.msg1 || "" } };
}

/* ── 한투 관심 그룹 (한투 → 앱 한 방향 · 읽기만) ── */
async function favGroups(c, ctx) {
  if (!c.hts) throw new Error("Vercel 환경변수 KIS_HTS_ID(한투 HTS 아이디)가 필요합니다");
  const x = await kis(c, ctx, "GET", "/uapi/domestic-stock/v1/quotations/intstock-grouplist", "HHKCM113004C7", { TYPE: "1", FID_ETC_CLS_CODE: "00", USER_ID: c.hts });
  const out = Array.isArray(x.j.output2) ? x.j.output2 : x.j.output2 ? [x.j.output2] : [];
  return { groups: out.map((g) => ({ code: String(g.inter_grp_code || "").trim(), name: String(g.inter_grp_name || "").trim() })).filter((g) => g.code) };
}
async function favStocks(c, ctx, code) {
  if (!c.hts) throw new Error("Vercel 환경변수 KIS_HTS_ID(한투 HTS 아이디)가 필요합니다");
  if (!/^\d{1,3}$/.test(String(code || ""))) throw new Error("그룹 코드가 올바르지 않습니다");
  const x = await kis(c, ctx, "GET", "/uapi/domestic-stock/v1/quotations/intstock-stocklist-by-group", "HHKCM113004C6", {
    TYPE: "1", USER_ID: c.hts, DATA_RANK: "", INTER_GRP_CODE: String(code).padStart(3, "0"), INTER_GRP_NAME: "", HTS_KOR_ISNM: "", CNTG_CLS_CODE: "", FID_ETC_CLS_CODE: "4" });
  const out = Array.isArray(x.j.output2) ? x.j.output2 : x.j.output2 ? [x.j.output2] : [];
  return { stocks: out.map((s) => ({ t: String(s.jong_code || "").trim(), n: String(s.hts_kor_isnm || "").trim(), mk: String(s.fid_mrkt_cls_code || "").trim(), ex: String(s.exch_code || "").trim() })).filter((s) => s.t) };
}

function pinOk(c, given) {
  if (!c.pin) return false;                              // 비밀번호(KIS_PIN)가 없으면 열지 않음 — 모의도 마찬가지 (주문 가능성이 있으므로)
  const a = crypto.createHash("sha256").update(String(given || "")).digest(), b = crypto.createHash("sha256").update(c.pin).digest();
  return crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const c = cfg();
  const configured = !!(c.key && c.sec && c.acctOk);
  if (req.method === "GET") return res.status(200).json({ ok: true, configured, env: c.env, pin: !!c.pin, pinMissing: !c.pin, canOrder: canOrder(c) && !!c.pin,
                                                          maxUsd: c.maxUsd, maxDay: c.maxDay, hts: !!c.hts });
  if (req.method !== "POST") return res.status(405).json({ ok: false, msg: "GET 또는 POST 만 됩니다" });
  if (!configured) return res.status(200).json({ ok: false, code: "setup", msg: c.env === "real" ? "Vercel 환경변수(KIS_APP_KEY · KIS_APP_SECRET · KIS_ACCOUNT)가 아직 없습니다" : "Vercel 환경변수(KIS_DEMO_APP_KEY · KIS_DEMO_APP_SECRET · KIS_DEMO_ACCOUNT)가 아직 없습니다" });
  if (!c.pin) return res.status(200).json({ ok: false, code: "setup", msg: "KIS_PIN 환경변수(내가 정하는 비밀번호)를 넣어야 열립니다" });
  if (!pinOk(c, req.headers["x-kis-pin"])) { await sleep(700); return res.status(200).json({ ok: false, code: "pin", msg: "비밀번호가 맞지 않습니다" }); }
  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const ACTIONS = ["balance", "orders", "order", "cancel", "quote", "groups", "group"];
  if (!ACTIONS.includes(body.what)) return res.status(400).json({ ok: false, msg: `what 은 ${ACTIONS.join(" · ")} 중 하나여야 합니다` });
  const ctx = { tok: null, reissued: false };
  try {
    ctx.tok = await getToken(c, body.tok, false);
    let out = {};
    if (body.what === "balance") out = await usBalance(c, ctx);
    else if (body.what === "orders") { const orders = await recentOrders(c, ctx); out = { orders, dayBuy: dayBuyOf(orders) }; }
    else if (body.what === "quote") out = await quotes(c, ctx, body);
    else if (body.what === "order") out = await placeOrder(c, ctx, body);
    else if (body.what === "cancel") out = await cancelOrder(c, ctx, body);
    else if (body.what === "groups") out = await favGroups(c, ctx);
    else out = await favStocks(c, ctx, body.code);
    return res.status(200).json({ ok: true, env: c.env, at: Date.now(), ...out, tok: seal(c, ctx.tok) });
  } catch (e) {
    return res.status(200).json({ ok: false, code: "kis", msg: String(e?.message || e).slice(0, 300), tok: ctx.tok ? seal(c, ctx.tok) : undefined });
  }
}
