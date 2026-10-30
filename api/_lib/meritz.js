/**
 * 메리츠증권 Open API 어댑터 — /api/broker 가 BROKER=meritz(기본값)일 때 씁니다
 * ════════════════════════════════════════════════════════════
 * 한투 어댑터(api/_lib/kis.js)와 "같은 약속"으로 답합니다. 그래서 화면(src/Kis.jsx)은 증권사를 몰라도 됩니다.
 *   what = balance · orders · order · cancel · quote      (mk:"kr" 이면 🇰🇷 국내 · 없으면 🇺🇸 미국)
 *
 * ▣ Vercel 환경변수 (채팅·깃허브에 적지 마세요)
 *   MERITZ_APP_KEY / MERITZ_APP_SECRET   메리츠 Open API 포털에서 발급 (계좌는 키에 묶여 있어 계좌번호 불필요)
 *   APP_PIN (또는 예전 이름 KIS_PIN)      내가 정하는 앱 비밀번호 — 조회·주문 모두 필요
 *   MERITZ_ORDER=on                      ★ 실주문 스위치. 없으면 조회만 됩니다 (끄면 즉시 주문 잠김)
 *   (선택) MERITZ_MAX_USD · MERITZ_MAX_DAY_USD     🇺🇸 1건 · 하루 매수 상한 — 기본 3,500 · 10,000 달러 (1회차 한 건이 들어가게)
 *   (선택) MERITZ_MAX_KRW · MERITZ_MAX_DAY_KRW     🇰🇷 1건 · 하루 매수 상한 — 기본 200만 · 500만 원
 *
 * ▣ 안전장치 (한투 실전과 같은 수준)
 *   지정가만 · 비밀번호 · 확인 단계(confirm:true) · 같은 주문 번호표(rid) 재전송 차단 · 1건/하루 상한
 *   매수 지정가가 지금 가격 +1.5% 넘으면 · 매도 지정가가 −3% 아래면 거절 · 정규장 밖 매수 거절(218) · 지금 가격을 못 보면 거절 · 같은 미체결이 있으면 거절
 *   매도는 가진 수량(− 매도 대기) 안에서만 · 메리츠가 "경고"로 돌려주면 접수 안 된 것 → 화면에서 내용 확인 뒤 다시 보냄
 *   주문 전송이 시간 초과로 끊기면 다시 보내지 않고 "주문 내역을 먼저 확인"하라고 알림 (두 번 나가는 것 방지)
 *
 * 규격 출처: 메리츠 공식 github.com/meritz-securities/open-api (catalog.json · corrections.json · docs/errors.md)
 *   토큰 POST /oauth2/token (form · client_credentials · scope=login)
 *   🇺🇸 잔고 GET /accounts/v1/me/overseas/holdings · 주문 POST /trading/v1/overseas/orders/{buy|sell|cancel}
 *      주문내역 GET /trading/v1/overseas/orders/history · 현재가 GET /market/v1/overseas/prices
 *      주문·잔고의 거래소는 벤더 코드(0537 나스닥 · 0321 뉴욕 · 0066 아멕스), 시세는 OQ · NY · AX — 서로 다른 체계
 *   🇰🇷 잔고 GET /accounts/v1/me/holdings (국내·해외가 섞여 옴 → pros_trgt_cls_code "1" 만)
 *      주문 POST /trading/v1/orders/{buy|sell|cancel} (종목코드 "A"+6자리) · 주문내역 GET /trading/v1/orders/history (하루씩)
 *      현재가 GET /market/v1/prices · 지수 GET /market/v1/index/prices (KGG01P 코스피 · QGG01P 코스닥)
 *   오류는 HTTP 500 + rsp_cd/rsp_msg/rsp_sub_msg · 주문 성공 "0001" 이어도 warn_cls_code ≠ "0" 이면 접수 안 됨
 *   연속조회 키(tr_cont_key)는 오른쪽 공백까지 그대로 쿼리스트링으로 돌려보냄
 */
import crypto from "node:crypto";

const HOST = "https://openapi.imeritz.com:9443";
const MAC = "02A0C9E1F7B3";            // 게이트웨이 필수 헤더(12자리) — 서버리스엔 고정 MAC 이 없어 고정값
const OK = new Set(["0000", "0001", "5620", "5762", "5766", "5820", "5822"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => { const x = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(x) ? x : 0; };
const GAP = 130;                       // API 마다 초당 10건 — 연달아 부를 때 쉬는 간격

/* 거래소 코드 세 가지 체계 — 앱은 NASD · NYSE · AMEX 로 통일 */
const VNDR = { NASD: "0537", NYSE: "0321", AMEX: "0066" };
const FROM_VNDR = { "0537": "NASD", "0321": "NYSE", "0066": "AMEX" };
const QUOTE_EX = { NASD: "OQ", NYSE: "NY", AMEX: "AX" };
const FROM_SUFFIX = { OQ: "NASD", O: "NASD", NQ: "NASD", NY: "NYSE", N: "NYSE", AX: "AMEX", A: "AMEX", PCX: "AMEX", P: "AMEX" };
const US_EX = ["NASD", "NYSE", "AMEX"];
const US_T = /^[A-Z][A-Z0-9.\-]{0,9}$/, KR_CODE = /^[0-9A-Z]{6}$/;

export function cfg() {
  return {
    key: String(process.env.MERITZ_APP_KEY || "").trim(), sec: String(process.env.MERITZ_APP_SECRET || "").trim(),
    pin: String(process.env.APP_PIN || process.env.KIS_PIN || "").trim(),
    order: String(process.env.MERITZ_ORDER || "").trim().toLowerCase() === "on",
    maxUsd: num(process.env.MERITZ_MAX_USD) || 3500, maxDay: num(process.env.MERITZ_MAX_DAY_USD) || 10000,
    maxKrw: num(process.env.MERITZ_MAX_KRW) || 2000000, maxDayKrw: num(process.env.MERITZ_MAX_DAY_KRW) || 5000000,
  };
}

/* ── 토큰: 서버리스는 기억이 없어서, 받은 토큰을 앱 시크릿으로 잠가(AES-256-GCM) 브라우저에 맡겨 둡니다 ── */
const boxKey = (c) => crypto.createHash("sha256").update(`${c.sec}|${c.key}|meritz-token-v1`).digest();
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
let MEM = null;
const alive = (t) => t && t.token && t.exp - Date.now() > 30 * 60 * 1000;
async function issue(c) {
  const r = await fetch(`${HOST}/oauth2/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.key, client_secret: c.sec, scope: "login" }),
    signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`메리츠 토큰을 받지 못했습니다 — ${[j.rsp_cd || j.error, j.rsp_msg || j.error_description || j.message].filter(Boolean).join(" ") || `HTTP ${r.status}`}`);
  return { token: j.access_token, exp: Date.now() + (num(j.expires_in) || 43200) * 1000 };
}
async function getToken(c, blob, force) {
  if (!force) { if (alive(MEM)) return MEM; const b = unseal(c, blob); if (alive(b)) return (MEM = b); }
  return (MEM = await issue(c));
}

/** 메리츠 호출 한 번. 토큰이 죽었으면 한 번만 새로 받고, 초당 한도면 잠깐 쉬고 다시. 주문(POST)은 절대 자동 재전송하지 않음 */
async function mz(c, ctx, method, path, data = {}, opt = {}) {
  const isPost = method === "POST";
  const once = async () => {
    const q = isPost ? "" : "?" + new URLSearchParams(Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== ""));
    let r;
    try {
      r = await fetch(`${HOST}${path}${q}`, { method, body: isPost ? JSON.stringify(data) : undefined,
        headers: { authorization: `Bearer ${ctx.tok.token}`, mac_address: MAC, ...(isPost ? { "content-type": "application/json; charset=utf-8" } : {}) },
        signal: AbortSignal.timeout(isPost ? 12000 : 15000) });
    } catch (e) {
      if (isPost) { const err = new Error("메리츠 응답이 늦어 끊겼습니다 — 주문이 들어갔을 수도 있습니다. 다시 보내기 전에 '최근 주문'을 새로고침해 확인해 주세요"); err.unsure = true; throw err; }
      throw new Error("메리츠 서버에 연결하지 못했습니다 — 잠시 뒤 다시 눌러 주세요");
    }
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j };
  };
  let x = await once();
  const codeOf = (x) => String(x.j?.rsp_cd || "");
  if (!isPost) for (let n = 0; n < 3 && codeOf(x) === "EGW00200"; n++) { await sleep(600 + n * 400); x = await once(); }
  if (["EGW00121", "EGW00123"].includes(codeOf(x)) && !ctx.reissued) { ctx.reissued = true; ctx.tok = await getToken(c, null, true); x = await once(); }
  const code = codeOf(x);
  if (x.status !== 200 || (code && !OK.has(code))) {
    const main = String(x.j?.rsp_msg || "").trim(), sub = String(x.j?.rsp_sub_msg || "").trim();
    const why = [main, sub && sub !== main ? sub : ""].filter(Boolean).join(" — ") || `HTTP ${x.status}`;
    throw new Error(`${opt.what || "메리츠"} 실패 — ${why}${code ? ` (${code})` : ""}`);
  }
  return x.j;
}
const rowsOf = (j) => (Array.isArray(j?.data) ? j.data : j?.data && typeof j.data === "object" ? [j.data] : []);
/** 연속조회 — 키는 오른쪽 공백까지 그대로 쿼리스트링으로 */
async function paged(c, ctx, path, data, what, max = 6) {
  const out = []; let key = "";
  for (let p = 0; p < max; p++) {
    if (p) await sleep(GAP);
    const j = await mz(c, ctx, "GET", path, key ? { ...data, tr_cont: "1", tr_cont_key: key } : data, { what });
    out.push(...rowsOf(j));
    const more = String(j.tr_cont || "").trim() === "1" || String(j.rsp_cd) === "5762";
    key = j.tr_cont_key || "";
    if (!more || !key) break;
  }
  return out;
}

/* ── 날짜 ── */
const ymd = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`; };
const kstNow = () => Date.now() + 9 * 3600000;
const todayKst = () => ymd(kstNow());
/** "YYYY-MM-DD HH:MM:SS"(한국 시간) → 세계표준시 날짜. 미국 장 한 번(한국 22:30~다음날 06:00)이 같은 날로 묶임 */
const usSessOf = (s, dt) => { const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)/.exec(s || "");
  if (m) return ymd(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 9 * 3600000);
  const d = /^(\d{4})(\d\d)(\d\d)$/.exec(dt || ""); return d ? ymd(Date.UTC(+d[1], +d[2] - 1, +d[3], 12) - 9 * 3600000) : ""; };
const usSessNow = () => ymd(Date.now());
const sumOf = (rows) => { const cost = rows.reduce((s, r) => s + r.cost, 0), val = rows.reduce((s, r) => s + r.val, 0);
  return { n: rows.length, cost, val, pl: val - cost, plPct: cost > 0 ? (val / cost - 1) * 100 : 0 }; };

/* ════════ 🇺🇸 미국 ════════ */
async function usBalance(c, ctx) {
  const raw = await paged(c, ctx, "/accounts/v1/me/overseas/holdings", {}, "해외 잔고 조회");
  const rows = [];
  for (const o of raw) {
    if (o.ovrs_stck_mrkt_tr_cls_code && o.ovrs_stck_mrkt_tr_cls_code !== "01") continue;        // 미국만
    const qty = num(o.rmnd_dqty); if (qty <= 0) continue;
    const t = String(o.ovrs_stck_symb_iscd || o.iscd || "").split(".")[0].trim().toUpperCase();
    const avg = num(o.avrg_unpr), px = num(o.psnt_prc), cost = num(o.byov_camt) || avg * qty, val = num(o.frcr_vltn_amt) || px * qty;
    rows.push({ t, n: String(o.isnm || "").trim(), ex: FROM_VNDR[String(o.ovrs_exch_vndr_idno || "").trim()] || "NASD",
                qty, ord: num(o.seln_able_dqty), avg, px, cost, val, pl: val - cost, plPct: cost > 0 ? (val / cost - 1) * 100 : num(o.vltn_ert) });
  }
  rows.sort((a, b) => b.val - a.val);
  return { rows, sum: sumOf(rows) };
}
const exFromIscd = (iscd) => FROM_SUFFIX[String(iscd || "").split(".")[1] || ""] || "";
async function usOrders(c, ctx) {
  const raw = await paged(c, ctx, "/trading/v1/overseas/orders/history",
    { oder_sta_date: ymd(kstNow() - 7 * 86400000), oder_fin_date: ymd(kstNow() + 86400000), seln_byov_clcd: "0", cntg_cls_code: "0" }, "해외 주문내역 조회");
  const cancelled = new Map();                                  // 원주문번호 → 취소 수량
  for (const o of raw) if (String(o.oder_rctf_cncl_cls_code) === "2") { const k = String(o.orgl_oder_no || "").trim(); cancelled.set(k, (cancelled.get(k) || 0) + num(o.oder_dqty)); }
  const now = usSessNow();
  return raw.map((o) => {
    const kindCd = String(o.oder_rctf_cncl_cls_code || "0"), stat = String(o.ovrs_stck_oder_stat_cls_code || "0");
    const odno = String(o.oder_no || "").trim(), qty = num(o.oder_dqty), filled = num(o.cntg_dqty);
    const sess = usSessOf(o.oder_exec_ymdh, o.oder_date);
    const orig = kindCd === "0", rejected = stat !== "0";
    const open = orig && !rejected && sess === now ? Math.max(0, qty - filled - (cancelled.get(odno) || 0)) : 0;   // 미국 당일 주문은 장이 끝나면 사라짐
    const tm = String(o.oder_exec_ymdh || "").slice(11).replace(/:/g, "");
    return { odno, orgn: orig ? "" : String(o.orgl_oder_no || "").trim().replace(/^0+$/, ""), dt: String(o.oder_date || "").trim(), tm,
      side: String(o.seln_byov_clcd) === "1" ? "sell" : "buy", t: String(o.iscd || "").split(".")[0].trim().toUpperCase(), n: String(o.kor_isnm || "").trim(),
      ex: exFromIscd(o.iscd), qty, px: num(o.ovrs_stck_oder_prc), filled, fpx: num(o.cntg_crnc_prc), open, sess,
      ocls: String(o.aspr_type_code) === "1" ? "05" : "01",
      state: rejected ? ({ 1: "거부", 2: "자동거부", 3: "자동취소", 4: "미접수" }[stat] || "거부") : !orig ? "" : filled >= qty && qty > 0 ? "체결" : open > 0 ? "접수" : filled > 0 ? "일부체결" : sess === now ? "취소" : "만료",
      why: String(o.ovrs_stck_rfus_reas || "").trim(), kind: orig ? "" : String(o.rctf_cncl_cls_name || (kindCd === "2" ? "취소" : "정정")).trim() };
  }).filter((o) => o.odno).sort((a, b) => (b.dt + b.tm).localeCompare(a.dt + a.tm));
}
const dayBuyUs = (orders) => { const s = usSessNow();
  return orders.filter((o) => o.side === "buy" && !o.orgn && o.sess === s && !/거부|미접수/.test(o.state)).reduce((a, o) => a + o.filled * (o.fpx || o.px) + o.open * o.px, 0); };

async function usQuoteOne(c, ctx, t, hint, gap) {
  const order = [hint, ...US_EX].filter((e, i, a) => US_EX.includes(e) && a.indexOf(e) === i);
  for (const ex of order) {
    for (const dely of ["0", "1"]) {                            // 실시간이 비면 지연 시세로 한 번 더
      if (gap.n++ > 0) await sleep(GAP);
      let j; try { j = await mz(c, ctx, "GET", "/market/v1/overseas/prices", { mrkt_div_code: "OV", mrkt_cls_code: QUOTE_EX[ex], iscd: t, dely_rltm_cls_code: dely }, { what: "해외 현재가" }); } catch { j = null; }
      const o = rowsOf(j)[0] || {}, last = num(o.prpr);
      if (last > 0) { const base = num(o.prdy_clpr); return { ex, last, base, rate: base > 0 ? (last / base - 1) * 100 : num(o.prdy_ctrt), delayed: dely === "1" }; }
      if (!j || !rowsOf(j).length) break;                       // 이 거래소엔 없는 종목 → 다음 거래소
    }
  }
  return null;
}
async function usQuotes(c, ctx, b) {
  const list = (Array.isArray(b.list) ? b.list : []).slice(0, 8).map((q) => ({ t: String(q?.t || "").toUpperCase().trim(), ex: String(q?.ex || "").toUpperCase() })).filter((q) => US_T.test(q.t));
  const gap = { n: 0 }, out = {}, idx = {};
  if (b.idx) for (const [t, ex] of [["QQQ", "NASD"], ["SPY", "AMEX"]]) { try { idx[t] = await usQuoteOne(c, ctx, t, ex, gap); } catch { idx[t] = null; } }
  for (const q of list) { try { out[q.t] = await usQuoteOne(c, ctx, q.t, q.ex, gap); } catch { out[q.t] = null; } }
  return { quotes: out, idx };
}

/* ════════ 🇰🇷 국내 ════════ */
const tickKr = (p) => p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000;
async function krBalance(c, ctx) {
  const raw = await paged(c, ctx, "/accounts/v1/me/holdings", { nthn_rmnd_incu_yn: "N" }, "국내 잔고 조회");
  const rows = [];
  for (const o of raw) {
    if (String(o.pros_trgt_cls_code || "").trim() !== "1") continue;                        // 국내 주식만 (해외 행이 섞여 옴)
    const t = String(o.iscd || "").trim().replace(/^A/, ""), qty = num(o.rmnd_qty);
    if (!KR_CODE.test(t) || qty <= 0) continue;
    const avg = num(o.byng_unpr), px = num(o.psnt_prc), cost = num(o.byng_amt) || avg * qty, val = num(o.vltn_amt) || px * qty;
    rows.push({ t, n: String(o.isnm || "").trim(), ex: "KRX", qty, ord: qty, avg, px, cost, val, pl: val - cost, plPct: cost > 0 ? (val / cost - 1) * 100 : num(o.ert) });
  }
  rows.sort((a, b) => b.val - a.val);
  return { rows, sum: sumOf(rows) };
}
async function krOrders(c, ctx) {
  const days = [];
  for (let i = 0; days.length < 5 && i < 9; i++) { const ms = kstNow() - i * 86400000, w = new Date(ms).getUTCDay(); if (w !== 0 && w !== 6) days.push(ymd(ms)); }   // 최근 영업일 5일 (하루씩 조회)
  const raw = [];
  for (let i = 0; i < days.length; i++) {
    if (i) await sleep(GAP);
    const r = await paged(c, ctx, "/trading/v1/orders/history", { oder_date: days[i], deal_cls_code: "0", cntg_cls_code: "0", sort_stnd_code: "1" }, "국내 주문내역 조회", 3);
    raw.push(...r.map((o) => ({ ...o, _d: days[i] })));
  }
  const today = todayKst();
  return raw.map((o) => {
    const kindCd = String(o.rctf_cncl_cls_code || "1"), orig = kindCd === "1", rejected = String(o.oder_pros_stat_cls_code) === "3";
    const qty = num(o.odqt), filled = num(o.total_cntg_qty), cxl = num(o.cncl_qty);
    const open = orig && !rejected && o._d === today ? Math.max(0, Math.min(num(o.ncnt_qty) || qty, qty - filled - cxl)) : 0;   // 국내 당일 주문도 장이 끝나면 사라짐
    return { odno: String(o.oder_no || "").trim(), orgn: orig ? "" : String(o.orgl_oder_no || "").trim().replace(/^0+$/, ""), dt: o._d,
      tm: String(o.oder_pros_sta_time || "").slice(0, 6), side: String(o.deal_cls_code) === "1" ? "sell" : "buy",
      t: String(o.iscd || "").trim().replace(/^A/, ""), n: String(o.kor_issu_abwr_name || "").trim(), ex: "KRX",
      qty, px: num(o.oder_unpr), filled, fpx: num(o.cntg_unpr), open, ocls: String(o.oder_cls_code || "01").trim() || "01",
      state: rejected ? "거부" : !orig ? "" : filled >= qty && qty > 0 ? "체결" : open > 0 ? "접수" : cxl > 0 ? "취소" : filled > 0 ? "일부체결" : "만료",
      why: rejected ? String(o.oder_rfus_reas_code || "").trim() : "", kind: orig ? "" : kindCd === "3" ? "취소" : "정정" };
  }).filter((o) => o.odno).sort((a, b) => (b.dt + b.tm).localeCompare(a.dt + a.tm));
}
const dayBuyKr = (orders) => { const d = todayKst(); return orders.filter((o) => o.side === "buy" && !o.orgn && o.dt === d && o.state !== "거부").reduce((s, o) => s + o.filled * (o.fpx || o.px) + o.open * o.px, 0); };
async function krQuoteOne(c, ctx, t) {
  const j = await mz(c, ctx, "GET", "/market/v1/prices", { mrkt_div_code: "J", iscd: t }, { what: "국내 현재가" });
  const o = rowsOf(j)[0] || {}, last = num(o.stck_prpr), base = num(o.sdpr) || (last - num(o.prdy_vrss));
  return last > 0 ? { ex: "KRX", last, base, rate: base > 0 ? (last / base - 1) * 100 : num(o.prdy_ctrt) } : null;   // 없는 종목은 0 으로 와서 null
}
async function krQuotes(c, ctx, b) {
  const list = (Array.isArray(b.list) ? b.list : []).slice(0, 8).map((q) => String(q?.t || "").toUpperCase().trim()).filter((t) => KR_CODE.test(t));
  const out = {}, idx = {}; let n = 0;
  if (b.idx) for (const [k, code] of [["KOSPI", "KGG01P"], ["KOSDAQ", "QGG01P"]]) {
    try { if (n++) await sleep(GAP);
      const o = rowsOf(await mz(c, ctx, "GET", "/market/v1/index/prices", { iscd: code }, { what: "지수" }))[0] || {};
      idx[k] = num(o.stck_prpr) > 0 ? { last: num(o.stck_prpr), rate: num(o.prdy_ctrt) } : null;
    } catch { idx[k] = null; } }
  for (const t of list) { try { if (n++) await sleep(GAP); out[t] = await krQuoteOne(c, ctx, t); } catch { out[t] = null; } }
  return { quotes: out, idx };
}

/* ════════ 주문 · 취소 ════════ */
const RID = new Map();                                          // 같은 주문 번호표 재전송 막기 (서버가 살아 있는 동안)
function gate(c) { if (!c.order) throw new Error("메리츠 주문은 잠겨 있습니다 — Vercel 환경변수 MERITZ_ORDER=on 을 넣고 다시 배포해야 열립니다 (지금은 조회만)"); }
/** 주문 응답 판정: rsp_cd 0001 이어도 warn_cls_code 가 "0" 이 아니면 시장에 나간 것이 없음 */
function accepted(j, overseas) {
  const d = rowsOf(j)[0] || j || {};
  const w = String(d.warn_cls_code ?? "0").trim();
  if (w && w !== "0") {
    const resend = overseas ? "13".includes(w) : "134679acdfg".includes(w);
    const e = new Error(`메리츠 경고로 접수되지 않았습니다 — ${String(d.warn_msg || "").trim() || `경고 코드 ${w}`}`);
    e.warn = resend ? String(d.warn_msg || "").trim() || `경고 코드 ${w}` : ""; throw e;
  }
  return String(d.oder_no || "").trim();
}
/** 지금 정규장인가 (주말만 거름 — 휴장일은 증권사가 거절) */
function regularNow(KR) {
  const z = KR ? "Asia/Seoul" : "America/New_York";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: z, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  if (p.weekday === "Sat" || p.weekday === "Sun") return false;
  const m = +p.hour * 60 + +p.minute;
  return KR ? m >= 540 && m < 930 : m >= 570 && m < 960;
}

async function placeOrder(c, ctx, b, KR) {
  gate(c);
  const side = b.side === "sell" ? "sell" : b.side === "buy" ? "buy" : "";
  const t = String(b.t || "").toUpperCase().trim(), ex = KR ? "KRX" : String(b.ex || "").toUpperCase();
  const qty = Math.floor(num(b.qty)), px = KR ? Math.round(num(b.px)) : Math.round(num(b.px) * 100) / 100;
  const M = (v) => (KR ? `${Math.round(v).toLocaleString("ko-KR")}원` : `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
  if (!side) throw new Error("매수/매도 구분이 없습니다");
  if (KR ? !KR_CODE.test(t) : !US_T.test(t)) throw new Error(KR ? "종목 코드는 6자리입니다 (예: 005930)" : "종목 코드가 올바르지 않습니다");
  if (!KR && !US_EX.includes(ex)) throw new Error("거래소는 NASD · NYSE · AMEX 중 하나여야 합니다");
  if (!(qty >= 1 && qty <= 100000)) throw new Error("수량은 1주 이상이어야 합니다");
  if (!(px > 0 && px < (KR ? 100000000 : 100000))) throw new Error("지정가를 입력해 주세요 (지정가 주문만 됩니다)");
  if (KR && px % tickKr(px) !== 0) throw new Error(`호가 단위가 맞지 않습니다 — ${px.toLocaleString("ko-KR")}원대는 ${tickKr(px).toLocaleString("ko-KR")}원 단위입니다`);
  const cap1 = KR ? c.maxKrw : c.maxUsd, capDay = KR ? c.maxDayKrw : c.maxDay;
  if (qty * px > cap1) throw new Error(`주문 1건 상한 ${M(cap1)} 을 넘습니다 (${qty}주 × ${M(px)} = ${M(qty * px)})`);
  if (b.confirm !== true) throw new Error("확인 단계를 거치지 않은 주문입니다");
  // 218. 정규장 밖 매수는 보내지 않음 — 장 밖 주문이 어떻게 처리될지(다음 장 이월·거절)가 확인되지 않음. 장 밖은 예약주문으로 따로
  if (side === "buy" && !regularNow(KR)) throw new Error(KR ? "한국 정규장(09:00~15:30)에만 매수를 보냅니다" : "미국 정규장(한국 시각 22:30/23:30 ~ 05:00/06:00)에만 매수를 보냅니다");
  const rid = String(b.rid || "");
  if (!/^[A-Za-z0-9\-]{8,64}$/.test(rid)) throw new Error("주문 번호표(rid)가 없습니다");
  if (RID.has(rid)) throw new Error("방금 보낸 같은 주문입니다 — 아래 주문 내역을 확인해 주세요");
  RID.set(rid, Date.now()); for (const [k, v] of RID) if (Date.now() - v > 3600000) RID.delete(k);
  const fail = (m) => { RID.delete(rid); throw new Error(m); };

  const hist = KR ? await krOrders(c, ctx) : await usOrders(c, ctx);
  const open = hist.filter((o) => o.open > 0 && !o.orgn);
  if (open.some((o) => o.t === t && o.side === side && o.qty === qty && o.px === px)) fail("같은 종목·수량·가격의 미체결 주문이 이미 있습니다");
  if (side === "buy") { const used = KR ? dayBuyKr(hist) : dayBuyUs(hist);
    if (used + qty * px > capDay) fail(`하루 매수 상한 ${M(capDay)} 을 넘습니다 (오늘 이미 ${M(used)} + 이번 ${M(qty * px)})`); }
  await sleep(GAP);
  let q = null; try { q = KR ? await krQuoteOne(c, ctx, t) : await usQuoteOne(c, ctx, t, ex, { n: 0 }); } catch { q = null; }
  if (!q) fail("지금 가격을 확인하지 못해 주문을 보내지 않았습니다 — 잠시 뒤 다시 눌러 주세요");
  if (!KR && q.ex !== ex) fail(`${t} 은(는) ${{ NASD: "나스닥", NYSE: "뉴욕", AMEX: "아멕스" }[q.ex]} 종목입니다 — 거래소를 바꿔 주세요`);
  if (side === "buy" && px > q.last * 1.015) fail(`지정가 ${M(px)} 가 지금 가격 ${M(q.last)} 보다 1.5% 넘게 높습니다 — 가격을 다시 보고 넣어 주세요`);   // 218. 매수는 좁게
  if (side === "sell" && px < q.last * 0.97) fail(`지정가 ${M(px)} 가 지금 가격 ${M(q.last)} 보다 3% 넘게 낮습니다`);
  if (side === "sell") {
    await sleep(GAP);
    const have = (KR ? await krBalance(c, ctx) : await usBalance(c, ctx)).rows.find((r) => r.t === t);
    const pending = open.filter((o) => o.t === t && o.side === "sell").reduce((s, o) => s + o.open, 0);
    const can = have ? (KR ? have.qty : Math.min(have.qty, have.ord || have.qty)) - pending : 0;
    if (can < qty) fail(`팔 수 있는 수량이 부족합니다 (보유 ${have ? have.qty : 0}주 · 매도 대기 ${pending}주)`);
  }
  await sleep(GAP);
  const warnOk = b.warnOk === true ? { warn_cnfr_yn: "Y" } : {};
  let j;
  try {
    j = KR
      ? await mz(c, ctx, "POST", `/trading/v1/orders/${side}`, { iscd: "A" + t, oder_unpr: String(px), odqt: String(qty), oder_cls_code: "01",
          oder_cond_cls_code: "0", orgl_oder_no: "0", exch_kind_code: "01", ...warnOk }, { what: "국내 주문" })
      : await mz(c, ctx, "POST", `/trading/v1/overseas/orders/${side}`, { ovrs_stck_symb_iscd: t, ovrs_exch_vndr_idno: VNDR[ex], oder_cls_code: "01",
          oder_cond_cls_code: "0", odqt: String(qty), ovrs_stck_oder_prc: px.toFixed(2), ...warnOk }, { what: "해외 주문" });
  } catch (e) { if (!e.unsure) RID.delete(rid); throw e; }        // 시간 초과로 끊긴 경우엔 번호표를 남겨 재전송을 막음
  let odno;
  try { odno = accepted(j, !KR); } catch (e) { RID.delete(rid); throw e; }
  return { placed: { side, t, ex, qty, px, odno, msg: String(j.rsp_msg || "").trim() } };
}
async function cancelOrder(c, ctx, b, KR) {
  gate(c);
  const odno = String(b.odno || "").trim(), t = String(b.t || "").toUpperCase().trim(), qty = Math.floor(num(b.qty));
  const ocls = /^\d{2}$/.test(String(b.ocls || "")) ? String(b.ocls) : "01";
  if (!/^\d{1,12}$/.test(odno)) throw new Error("원주문번호가 올바르지 않습니다");
  if ((KR ? !KR_CODE.test(t) : !US_T.test(t)) || !(qty >= 1)) throw new Error("취소할 주문 정보가 올바르지 않습니다");
  let j;
  if (KR) {
    j = await mz(c, ctx, "POST", "/trading/v1/orders/cancel", { iscd: "A" + t, odqt: String(qty), orgl_oder_no: odno, exch_kind_code: "01" }, { what: "국내 주문 취소" });
  } else {
    const dt = /^\d{8}$/.test(String(b.dt || "")) ? String(b.dt) : todayKst();
    j = await mz(c, ctx, "POST", "/trading/v1/overseas/orders/cancel", { oder_date: dt, orgl_oder_no: odno, oder_cls_code: ocls, odqt: String(qty) }, { what: "해외 주문 취소" });
  }
  accepted(j, !KR);
  return { cancelled: { odno, t, msg: String(j.rsp_msg || "").trim() } };
}

/* ── 189. 다음 개장 때 매도 (예약주문) — 규칙: 종가가 선 아래 → 다음 장 시작에 판다 ──
 *   🇺🇸 POST /trading/v1/overseas/reserved-orders/sell · MOO(장개시 시장가 "6") · 일반예약("1") · 시작=종료=오늘(한국 날짜)
 *      (공식 corrections.json: 일자를 비우면 접수는 되나 취소 불가 예약이 생김 → 항상 넣음)
 *   🇰🇷 POST /trading/v1/reserved-orders/sell · 시장가("05", 단가 0) · 일반예약("1") → 다음 영업일 장 시작 동시호가
 *   성공 코드 5620 = 예약 접수(체결 아님) — 같은 예약을 다시 보내면 중복 접수되므로 번호표(rid)로 막고, 이미 같은 매도 예약이 있으면 거절
 *   예약 취소는 메리츠 앱 '예약주문' 화면에서 (앱은 접수·조회만) */
async function resvList(c, ctx, KR) {
  const fin = ymd(kstNow() + 7 * 86400000);
  if (KR) {
    const raw = await paged(c, ctx, "/trading/v1/reserved-orders", { oder_sta_date: ymd(kstNow() - 3 * 86400000), oder_fin_date: fin, iqry_cls_code: "1" }, "국내 예약 조회");
    return raw.map((o) => ({ t: String(o.iscd || "").replace(/^A/, "").trim(), n: String(o.iscd_name || "").trim(), side: String(o.deal_cls_code) === "1" ? "sell" : "buy",
      qty: num(o.odqt), px: num(o.oder_unpr), kind: String(o.oder_cls_code) === "05" ? "시장가" : "지정가", d: String(o.oder_sta_date || o.rsev_reg_date || ""), no: String(o.oder_rsev_mst_no || "") }))
      .filter((o) => o.t);
  }
  const raw = await paged(c, ctx, "/trading/v1/overseas/reserved-orders", { iqry_sta_date: ymd(kstNow() - 3 * 86400000), iqry_fin_date: fin, seln_byov_clcd: "0", iqry_idnt_clcd: "2" }, "해외 예약 조회");
  const TP = { 1: "지정가", 2: "시장가", 4: "장개시 지정가", 5: "장마감 지정가", 6: "장개시 시장가(MOO)", 7: "장마감 시장가" };
  return raw.map((o) => ({ t: String(o.ovrs_stck_symb_iscd || o.iscd || "").split(".")[0].trim().toUpperCase(), n: String(o.kor_isnm || "").trim(),
    side: String(o.seln_byov_clcd) === "1" ? "sell" : "buy", qty: num(o.odqt), px: num(o.ovrs_stck_oder_prc), kind: TP[String(o.rsev_aspr_tpcd)] || "예약",
    d: String(o.oder_sta_date || o.rsev_acpt_date || ""), no: String(o.rsev_acpt_srno || ""), cancelled: String(o.rsev_cncl_yn || "") === "Y" }))
    .filter((o) => o.t && !o.cancelled);
}
async function placeResv(c, ctx, b, KR) {
  gate(c);
  const t = String(b.t || "").toUpperCase().trim(), qty = Math.floor(num(b.qty));
  if (KR ? !KR_CODE.test(t) : !US_T.test(t)) throw new Error("종목 코드가 올바르지 않습니다");
  if (!(qty >= 1 && qty <= 100000)) throw new Error("수량은 1주 이상이어야 합니다");
  if (b.confirm !== true) throw new Error("확인 단계를 거치지 않은 예약입니다");
  if (regularNow(KR)) throw new Error("지금은 정규장입니다 — 예약 대신 바로 매도 주문을 넣어 주세요");
  const rid = String(b.rid || "");
  if (!/^[A-Za-z0-9\-]{8,64}$/.test(rid)) throw new Error("주문 번호표(rid)가 없습니다");
  if (RID.has(rid)) throw new Error("방금 보낸 같은 예약입니다 — 예약 목록을 확인해 주세요");
  RID.set(rid, Date.now());
  const fail = (m) => { RID.delete(rid); throw new Error(m); };
  const bal = KR ? await krBalance(c, ctx) : await usBalance(c, ctx);
  const have = bal.rows.find((r) => r.t === t);
  if (!have) fail(`${t} 을(를) 이 계좌에 가지고 있지 않습니다`);
  const can = KR ? have.qty : Math.min(have.qty, have.ord || have.qty);
  await sleep(GAP);
  const already = (await resvList(c, ctx, KR)).filter((o) => o.t === t && o.side === "sell").reduce((s, o) => s + o.qty, 0);
  if (already + qty > can) fail(already ? `이미 ${t} 매도 예약 ${already}주가 있습니다 (보유 ${can}주) — 메리츠 앱 예약주문 화면에서 확인해 주세요` : `팔 수 있는 수량이 부족합니다 (보유 ${can}주)`);
  await sleep(GAP);
  const today = todayKst();
  let j;
  try {
    j = KR
      ? await mz(c, ctx, "POST", "/trading/v1/reserved-orders/sell", { iscd: t, adod_type_code: "01", odqt: String(qty), oder_unpr: "0", oder_cls_code: "05", oder_rsev_cls_code: "1", warn_cnfr_yn: b.warnOk === true ? "Y" : "N" }, { what: "국내 예약 매도" })
      : await mz(c, ctx, "POST", "/trading/v1/overseas/reserved-orders/sell", { ovrs_stck_symb_iscd: t, ovrs_exch_vndr_idno: VNDR[have.ex] || "0537", rsev_aspr_tpcd: "6", odqt: String(qty),
          ovrs_stck_oder_prc: "0", oder_rsev_cls_code: "1", oder_rsev_hour_clcd: "0", oder_sta_date: today, oder_fin_date: today, warn_cnfr_yn: b.warnOk === true ? "Y" : "N" }, { what: "해외 예약 매도" });
  } catch (e) { if (!e.unsure) RID.delete(rid); throw e; }
  const d = rowsOf(j)[0] || j || {};
  const w = String(d.warn_cls_code ?? "0").trim();
  if (w && w !== "0") { RID.delete(rid); const e = new Error(`메리츠 경고로 예약이 접수되지 않았습니다 — ${String(d.warn_msg || d.msg_cntt || "").trim() || `경고 코드 ${w}`}`);
    e.warn = (KR ? "134679acdfg" : "13").includes(w) ? String(d.warn_msg || d.msg_cntt || "").trim() || `경고 코드 ${w}` : ""; throw e; }
  return { reserved: { t, qty, how: KR ? "다음 영업일 장 시작 시장가" : "미국 장 시작 시장가(MOO)", no: String(d.oder_rsev_mst_no || d.pros_srno || ""), msg: String(j.rsp_msg || "").trim() } };
}

function pinOk(c, given) {
  if (!c.pin) return false;
  const a = crypto.createHash("sha256").update(String(given || "")).digest(), b = crypto.createHash("sha256").update(c.pin).digest();
  return crypto.timingSafeEqual(a, b);
}

export default async function meritz(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const c = cfg();
  const configured = !!(c.key && c.sec);
  if (req.method === "GET") return res.status(200).json({ ok: true, broker: "meritz", label: "메리츠", configured, env: "real", pin: !!c.pin, pinMissing: !c.pin,
    canOrder: c.order && !!c.pin, maxUsd: c.maxUsd, maxDay: c.maxDay, maxKrw: c.maxKrw, maxDayKrw: c.maxDayKrw, hts: false });
  if (req.method !== "POST") return res.status(405).json({ ok: false, msg: "GET 또는 POST 만 됩니다" });
  if (!configured) return res.status(200).json({ ok: false, code: "setup", msg: "Vercel 환경변수 MERITZ_APP_KEY · MERITZ_APP_SECRET 이 없습니다 (넣은 뒤 다시 배포해야 반영됩니다)" });
  if (!c.pin) return res.status(200).json({ ok: false, code: "setup", msg: "APP_PIN 환경변수(내가 정하는 비밀번호)를 넣어야 열립니다" });
  if (!pinOk(c, req.headers["x-kis-pin"])) { await sleep(700); return res.status(200).json({ ok: false, code: "pin", msg: "비밀번호가 맞지 않습니다" }); }
  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const ACTIONS = ["balance", "orders", "order", "cancel", "quote", "resv", "resvList"];
  if (!ACTIONS.includes(body.what)) return res.status(400).json({ ok: false, msg: `what 은 ${ACTIONS.join(" · ")} 중 하나여야 합니다` });
  const KR = body.mk === "kr";
  const ctx = { tok: null, reissued: false };
  try {
    ctx.tok = await getToken(c, body.tok, false);
    let out;
    if (body.what === "balance") out = KR ? await krBalance(c, ctx) : await usBalance(c, ctx);
    else if (body.what === "orders") { const orders = KR ? await krOrders(c, ctx) : await usOrders(c, ctx); out = { orders, dayBuy: KR ? dayBuyKr(orders) : dayBuyUs(orders) }; }
    else if (body.what === "quote") out = KR ? await krQuotes(c, ctx, body) : await usQuotes(c, ctx, body);
    else if (body.what === "order") out = await placeOrder(c, ctx, body, KR);
    else if (body.what === "resv") out = await placeResv(c, ctx, body, KR);
    else if (body.what === "resvList") out = { resv: await resvList(c, ctx, KR) };
    else out = await cancelOrder(c, ctx, body, KR);
    return res.status(200).json({ ok: true, broker: "meritz", env: "real", ...(KR ? { mk: "kr" } : {}), at: Date.now(), ...out, tok: seal(c, ctx.tok) });
  } catch (e) {
    return res.status(200).json({ ok: false, code: e?.warn ? "warn" : e?.unsure ? "unsure" : "broker", warn: e?.warn || undefined,
      msg: String(e?.message || e).slice(0, 300), tok: ctx.tok ? seal(c, ctx.tok) : undefined });
  }
}
