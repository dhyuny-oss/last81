/**
 * /api/meritz — 207. 메리츠 Open API 연결 (1단계: 조회만)
 * ════════════════════════════════════════════════════════════
 * 주문 기능은 없습니다. 잔고 조회만 합니다 (메리츠 포털 기본값도 조회 전용).
 *
 * ▣ Vercel 환경변수 (채팅·깃허브에 적지 마세요)
 *   MERITZ_APP_KEY / MERITZ_APP_SECRET   메리츠 Open API 포털에서 발급
 *   KIS_PIN                              앱 비밀번호 (한투 연결과 같은 값) — 잔고는 이 비밀번호가 있어야 보입니다
 *   계좌번호는 필요 없습니다 — 메리츠는 키가 신청한 계좌에 묶여 있습니다.
 *
 * ▣ 쓰는 법
 *   GET  /api/meritz                         설정 상태만 (키가 들어갔나 · 길이가 맞나) — 비밀번호 없이
 *   GET  /api/meritz?check=1  + 헤더 x-kis-pin (또는 ?pin=)
 *                                            접속 확인: 토큰 발급 → 🇺🇸 해외주식 잔고 조회
 *
 * 규격 출처: 메리츠 공식 github.com/meritz-securities/open-api
 *   REST https://openapi.imeritz.com:9443 · 토큰 POST /oauth2/token (form · client_credentials · scope=login · 유효 7일)
 *   해외 잔고 GET /accounts/v1/me/overseas/holdings · 헤더 authorization + mac_address(12자리 필수, 없으면 IGW50024)
 */
import crypto from "node:crypto";

const HOST = "https://openapi.imeritz.com:9443";
const MAC = "02A0C9E1F7B3";                     // 게이트웨이 필수 헤더 — 서버리스엔 고정 MAC 이 없어 고정값을 씁니다
const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };

function cfg() {
  return { key: String(process.env.MERITZ_APP_KEY || "").trim(), sec: String(process.env.MERITZ_APP_SECRET || "").trim(),
           pin: String(process.env.KIS_PIN || "").trim() };
}
function pinOk(c, given) {
  if (!c.pin) return false;
  const a = crypto.createHash("sha256").update(String(given || "")).digest(), b = crypto.createHash("sha256").update(c.pin).digest();
  return crypto.timingSafeEqual(a, b);
}

async function token(c) {
  const r = await fetch(`${HOST}/oauth2/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.key, client_secret: c.sec, scope: "login" }),
    signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`토큰을 받지 못했습니다 — ${j.rsp_msg || j.error_description || j.message || j.error || `HTTP ${r.status}`}${j.rsp_cd ? ` (${j.rsp_cd})` : ""}`);
  return { token: j.access_token, exp: Date.now() + (num(j.expires_in) || 604800) * 1000 };
}

async function usHoldings(tok) {
  const rows = []; let cont = "", key = "";
  for (let page = 0; page < 5; page++) {
    const h = { authorization: `Bearer ${tok.token}`, mac_address: MAC, "content-type": "application/json" };
    if (cont) { h.tr_cont = "1"; h.tr_cont_key = key; }
    const r = await fetch(`${HOST}/accounts/v1/me/overseas/holdings`, { headers: h, signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || (j.rsp_cd && !Array.isArray(j.data))) throw new Error(`잔고 조회 실패 — ${j.rsp_msg || j.message || `HTTP ${r.status}`}${j.rsp_cd ? ` (${j.rsp_cd})` : ""}`);
    for (const o of j.data || []) {
      const qty = num(o.rmnd_dqty); if (qty <= 0) continue;
      const t = String(o.ovrs_stck_symb_iscd || o.iscd || "").trim().toUpperCase();
      rows.push({ t, n: String(o.isnm || "").trim(), qty, ord: num(o.seln_able_dqty), avg: num(o.avrg_unpr), px: num(o.psnt_prc),
                  cost: num(o.byov_camt), val: num(o.frcr_vltn_amt), plPct: num(o.vltn_ert), cur: o.crcd || "USD" });
    }
    const more = String(j.tr_cont || r.headers.get("tr_cont") || "").trim();
    key = j.tr_cont_key || r.headers.get("tr_cont_key") || "";
    if (!(more === "1" || more === "M" || more === "F") || !key) break;
    cont = "1";
  }
  return rows.sort((a, b) => b.val - a.val);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const c = cfg();
  const look = (v) => !v ? "없음" : /[\s"'<>]/.test(v) ? `${v.length}자 · ⚠ 빈칸·따옴표가 섞여 있음` : v.length < 20 ? `${v.length}자 · ⚠ 너무 짧음` : `들어 있음 (${v.length}자)`;
  const status = { key: look(c.key), secret: look(c.sec), pin: c.pin ? "들어 있음" : "없음 (KIS_PIN)" };
  const configured = !!(c.key && c.sec);
  if (!req.query?.check) return res.status(200).json({ ok: true, configured, status, mode: "조회 전용" });
  if (!configured) return res.status(200).json({ ok: false, configured, status, msg: "Vercel 환경변수 MERITZ_APP_KEY · MERITZ_APP_SECRET 이 없습니다 (넣은 뒤 다시 배포해야 반영됩니다)" });
  if (!pinOk(c, req.headers["x-kis-pin"] || req.query?.pin)) { await new Promise(r => setTimeout(r, 700)); return res.status(200).json({ ok: false, code: "pin", msg: "비밀번호가 맞지 않습니다" }); }
  try {
    const tok = await token(c);
    const rows = await usHoldings(tok);
    return res.status(200).json({ ok: true, configured, status, msg: "메리츠 연결 확인 — 토큰 발급 · 해외 잔고 조회 성공", n: rows.length, rows });
  } catch (e) {
    return res.status(200).json({ ok: false, configured, status, msg: String(e?.message || e).slice(0, 300) });
  }
}
