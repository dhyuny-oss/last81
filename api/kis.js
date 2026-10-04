/**
 * /api/kis — 한국투자증권 Open API · 미국 주식 잔고 "조회 전용"
 * ════════════════════════════════════════════════════════════
 * 이 파일에는 주문(매수·매도) 코드가 한 줄도 없습니다. 잔고를 읽어 오기만 합니다.
 * 앱 본체·내 종목·텔레그램·수집 파이프라인 어디에도 영향을 주지 않습니다.
 *
 * ▣ 빼는 방법 (네 군데)
 *   1) src/App.jsx 에서 "★ 한투" 라고 적힌 두 곳 삭제
 *   2) src/Kis.jsx 삭제
 *   3) api/kis.js (이 파일) 삭제
 *   4) Vercel 환경변수 KIS_* 삭제 + 한투 앱에서 Open API 해지
 *
 * ▣ Vercel 환경변수 (Settings → Environment Variables · 채팅/깃허브에 적지 마세요)
 *   KIS_APP_KEY      앱 키
 *   KIS_APP_SECRET   앱 시크릿
 *   KIS_ACCOUNT      계좌번호 8자리 + 상품코드 2자리 (예: 12345678-01 · 하이픈 있어도 없어도 됨)
 *   KIS_ENV          demo(모의·기본값) 또는 real(실전)
 *   KIS_PIN          내가 정하는 비밀번호. 앱에서 한 번 입력. 실전(real)에서는 꼭 있어야 동작합니다.
 *
 * ▣ 쓰는 법
 *   GET  /api/kis                         → { ok, configured, env, pin } (키 값은 절대 돌려주지 않음)
 *   POST /api/kis  { what:"balance", tok } + 헤더 x-kis-pin
 *        → { ok, env, at, rows:[{ t, n, ex, qty, avg, px, cost, val, pl, plPct }], sum, tok }
 *
 * ▣ 접속 토큰 (한투 규칙: 유효 1일 · 재발급 1분에 1회 · 발급 때마다 알림톡)
 *   서버리스는 기억이 없어서, 발급받은 토큰을 앱 시크릿으로 잠가(AES-256-GCM) 브라우저에 맡겨 둡니다(tok).
 *   다음 조회 때 브라우저가 그 꾸러미를 돌려주면 풀어서 다시 씁니다. 꾸러미는 서버 시크릿 없이는 못 엽니다.
 *
 * 규격 출처: 한투 공식 샘플 github.com/koreainvestment/open-trading-api
 *   토큰 POST /oauth2/tokenP · 해외주식 잔고 GET /uapi/overseas-stock/v1/trading/inquire-balance
 *   (실전 TTTS3012R · 모의 VTTS3012R / 실전은 NASD=미국 전체, 모의는 NASD·NYSE·AMEX 따로)
 */
import crypto from "node:crypto";

const HOST = { real: "https://openapi.koreainvestment.com:9443", demo: "https://openapivts.koreainvestment.com:29443" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };

function cfg() {
  const env = String(process.env.KIS_ENV || "demo").trim().toLowerCase() === "real" ? "real" : "demo";
  const acct = String(process.env.KIS_ACCOUNT || "").replace(/\D/g, "");
  return { env, key: (process.env.KIS_APP_KEY || "").trim(), sec: (process.env.KIS_APP_SECRET || "").trim(),
           cano: acct.slice(0, 8), prod: acct.slice(8, 10) || "01", acctOk: acct.length === 8 || acct.length === 10,
           pin: (process.env.KIS_PIN || "").trim() };
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
  // 만료 시각: "2026-10-05 10:45:00" (한국 시간) 또는 expires_in(초)
  let exp = Date.now() + (num(j.expires_in) || 86400) * 1000;
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

async function call(c, tok, trId, path, params, trCont = "") {
  const r = await fetch(`${HOST[c.env]}${path}?${new URLSearchParams(params)}`, {
    headers: { "Content-Type": "application/json", Accept: "text/plain", charset: "UTF-8", authorization: `Bearer ${tok.token}`,
               appkey: c.key, appsecret: c.sec, tr_id: trId, custtype: "P", tr_cont: trCont } });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, cont: r.headers.get("tr_cont") || "", j };
}
const tokenDead = (x) => /EGW00123|EGW00121|기간이 만료된 token|유효하지 않은 token/.test(`${x.j?.msg_cd || ""} ${x.j?.msg1 || ""}`);

async function usBalance(c, blob) {
  let tok = await getToken(c, blob, false);
  const trId = c.env === "real" ? "TTTS3012R" : "VTTS3012R";
  const exchanges = c.env === "real" ? ["NASD"] : ["NASD", "NYSE", "AMEX"];
  const gap = c.env === "real" ? 80 : 550;              // 초당 호출 제한 (모의가 더 빡빡함)
  const rows = new Map(); let reissued = false;
  for (let e = 0; e < exchanges.length; e++) {
    let fk = "", nk = "", cont = "";
    for (let page = 0; page < 5; page++) {
      if (e + page > 0) await sleep(gap);
      let x = await call(c, tok, trId, "/uapi/overseas-stock/v1/trading/inquire-balance",
        { CANO: c.cano, ACNT_PRDT_CD: c.prod, OVRS_EXCG_CD: exchanges[e], TR_CRCY_CD: "USD", CTX_AREA_FK200: fk, CTX_AREA_NK200: nk }, cont);
      if (tokenDead(x) && !reissued) {                  // 꾸러미 토큰이 죽었으면 한 번만 새로 받아 다시
        reissued = true; tok = await getToken(c, null, true);
        x = await call(c, tok, trId, "/uapi/overseas-stock/v1/trading/inquire-balance",
          { CANO: c.cano, ACNT_PRDT_CD: c.prod, OVRS_EXCG_CD: exchanges[e], TR_CRCY_CD: "USD", CTX_AREA_FK200: fk, CTX_AREA_NK200: nk }, cont);
      }
      if (x.j?.rt_cd !== "0") throw new Error(`한투 응답 오류 — ${x.j?.msg1 || `HTTP ${x.status}`}${x.j?.msg_cd ? ` (${x.j.msg_cd})` : ""}`);
      const out = Array.isArray(x.j.output1) ? x.j.output1 : x.j.output1 ? [x.j.output1] : [];
      for (const o of out) {
        const t = String(o.ovrs_pdno || "").trim(), qty = num(o.ovrs_cblc_qty);
        if (!t || qty <= 0) continue;
        const avg = num(o.pchs_avg_pric), px = num(o.now_pric2);
        const cost = num(o.frcr_pchs_amt1) || avg * qty, val = num(o.ovrs_stck_evlu_amt) || px * qty;
        rows.set(`${t}|${o.ovrs_excg_cd || exchanges[e]}`, { t, n: String(o.ovrs_item_name || "").trim(), ex: o.ovrs_excg_cd || exchanges[e],
          qty, avg, px, cost, val, pl: val - cost, plPct: cost > 0 ? (val / cost - 1) * 100 : 0 });
      }
      if (x.cont === "F" || x.cont === "M") { fk = x.j.ctx_area_fk200 || ""; nk = x.j.ctx_area_nk200 || ""; cont = "N"; } else break;
    }
  }
  const list = [...rows.values()].sort((a, b) => b.val - a.val);
  const cost = list.reduce((s, r) => s + r.cost, 0), val = list.reduce((s, r) => s + r.val, 0);
  return { rows: list, sum: { n: list.length, cost, val, pl: val - cost, plPct: cost > 0 ? (val / cost - 1) * 100 : 0 }, tok: seal(c, tok) };
}

function pinOk(c, given) {
  if (!c.pin) return c.env !== "real";                  // 실전은 비밀번호 없이는 열지 않음
  const a = crypto.createHash("sha256").update(String(given || "")).digest(), b = crypto.createHash("sha256").update(c.pin).digest();
  return crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const c = cfg();
  const configured = !!(c.key && c.sec && c.acctOk);
  if (req.method === "GET") return res.status(200).json({ ok: true, configured, env: c.env, pin: !!c.pin, pinMissing: c.env === "real" && !c.pin });
  if (req.method !== "POST") return res.status(405).json({ ok: false, msg: "GET 또는 POST 만 됩니다" });
  if (!configured) return res.status(200).json({ ok: false, code: "setup", msg: "Vercel 환경변수(KIS_APP_KEY · KIS_APP_SECRET · KIS_ACCOUNT)가 아직 없습니다" });
  if (c.env === "real" && !c.pin) return res.status(200).json({ ok: false, code: "setup", msg: "실전 계좌는 KIS_PIN 환경변수를 정해야 열립니다" });
  if (!pinOk(c, req.headers["x-kis-pin"])) { await sleep(700); return res.status(200).json({ ok: false, code: "pin", msg: "비밀번호가 맞지 않습니다" }); }
  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  if (body.what !== "balance") return res.status(400).json({ ok: false, msg: "what=balance 만 됩니다 (조회 전용)" });
  try {
    const out = await usBalance(c, body.tok);
    return res.status(200).json({ ok: true, env: c.env, at: Date.now(), ...out });
  } catch (e) {
    return res.status(200).json({ ok: false, code: "kis", msg: String(e?.message || e).slice(0, 300) });
  }
}
