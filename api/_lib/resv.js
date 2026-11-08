/**
 * 249. 매수 예약 — 장이 닫혀 있을 때 '사기'를 누르면 여기 적어 두고, 장이 열린 뒤 서버가 조건을 다시 보고 지정가로 삽니다.
 * ════════════════════════════════════════════════════════════
 * 저장   public/data/resv.json (GitHub contents API · Vercel 환경변수 GH_TOKEN — 관심종목 저장과 같은 방식)
 *        { updatedAt, items: [{ id, t, m, n, ex, qty, base, line, asOf, day, at, status, why, odno, px, ranAt, doneAt }] }
 *        status: wait(기다림) · run(확인 중) · sent(주문 보냄) · skip(조건에 걸려 안 삼) · expired(그날 못 봄) · cancel · fail · unsure
 * 실행   /api/cron/resv-us1 · resv-us2 · resv-kr1 · resv-kr2 (vercel.json — 무료 요금제라 '그 시간 안 어딘가'에 돕니다)
 *        + 앱이 그 시간에 열려 있으면 앱도 한 번 부름(비밀번호) · 몇 번을 불러도 같은 예약을 두 번 사지 않음
 * 확인   🇺🇸 개장 5분 뒤 ~ 2시간 30분 · 🇰🇷 09:30 ~ 11:30 (그날 이 안에 못 보면 '만료' — 하루만 유효)
 * 안 삼  시장(🇺🇸 QQQ·SPY 중 나쁜 쪽 · 🇰🇷 코스피·코스닥) −2% 이하 · 지금 가격이 손절선 아래 · 기준 종가보다 +3% 넘게(추격) / −5% 넘게(급락)
 *        새 종가에서 매수! 가 꺼짐 · 🇺🇸 나스닥100 200일선 아래(252) · 🇰🇷 시장 위험 · 이미 보유 · 같은 종목 매수 대기 · 시장 상태를 못 봄
 * 사면   지정가 = 그때 가격 +0.5% (🇰🇷 호가 단위로 올림) · 수량 = 예약 수량(1건 상한을 넘으면 줄임)
 *        주문은 화면 주문과 같은 함수(placeOrder) — 1건·하루 상한 · 지정가 범위 · 정규장 · 번호표 검사가 그대로 걸림
 * 알림   Vercel 에 TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID (또는 TG_TOKEN · TG_CHAT) 가 있으면 바로 · 없으면 다음 아침 텔레그램(notify.py)에 한 줄
 */
import { createRequire } from "module";
import { INT, cfg } from "./meritz.js";
const RULES = createRequire(import.meta.url)("../../config/rules.json");   // 260. 규칙 숫자 한 파일

const REPO = process.env.GH_REPO || "dhyuny-oss/last81";
const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
const PATH = "public/data/resv.json";
const API = `https://api.github.com/repos/${REPO}/contents/`;
const G = RULES.resv;                                           // 249 · config/rules.json resv (추격은 주문 창보다 좁게 +3%)
const WIN = { us: RULES.resv.usWin, kr: RULES.resv.krWin };     // 🇺🇸 개장 뒤 분 · 🇰🇷 한국 시각 분(09:30 ~ 11:30)
const KEEP = 40;

const ghHead = () => ({ Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "alpha-terminal", "X-GitHub-Api-Version": "2022-11-28" });
async function load() {
  const r = await fetch(`${API}${PATH}?ref=main`, { headers: ghHead(), cache: "no-store" });
  if (r.status === 404) return { data: { updatedAt: null, items: [] }, sha: null };
  if (!r.ok) throw new Error(`예약 목록을 읽지 못했습니다 (깃허브 ${r.status})`);
  const j = await r.json();
  const data = JSON.parse(Buffer.from(j.content, "base64").toString("utf-8"));
  return { data: { updatedAt: data.updatedAt || null, items: Array.isArray(data.items) ? data.items : [] }, sha: j.sha };
}
/** sha 가 맞을 때만 씀 — 두 곳에서 동시에 고치면 한쪽은 conflict (같은 예약을 두 번 사지 않게 하는 잠금) */
async function save(data, sha, msg) {
  data.updatedAt = new Date().toISOString();
  data.items = data.items.slice(-KEEP);
  const body = { message: `⏰ ${msg}`, content: Buffer.from(JSON.stringify(data, null, 2)).toString("base64"), branch: "main", ...(sha ? { sha } : {}) };
  const r = await fetch(`${API}${PATH}`, { method: "PUT", headers: { ...ghHead(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) return { ok: false, conflict: true };
  if (!r.ok) return { ok: false, msg: `깃허브 ${r.status}` };
  const j = await r.json().catch(() => ({}));
  return { ok: true, sha: j?.content?.sha || null };
}
/** 읽고 → 고치고 → 쓰기. 부딪히면 새로 읽어 다시 (최대 3번) */
async function mutate(fn, msg) {
  for (let i = 0; i < 3; i++) {
    const { data, sha } = await load();
    const out = fn(data);
    if (out === false) return { data, unchanged: true };
    const w = await save(data, sha, msg);
    if (w.ok) return { data, sha: w.sha };
    if (!w.conflict) throw new Error(`예약을 저장하지 못했습니다 (${w.msg})`);
  }
  throw new Error("예약을 저장하지 못했습니다 — 잠시 뒤 다시");
}

/* ── 시각 ── */
function clock(KR, now = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: KR ? "Asia/Seoul" : "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { d: `${p.year}${p.month}${p.day}`, min: +p.hour * 60 + +p.minute, wk: p.weekday !== "Sat" && p.weekday !== "Sun" };
}
/** 예약이 확인될 날 — 🇰🇷 은 평일 09:30 전이면 오늘, 🇺🇸 은 다음 개장일(지금 장 전이면 오늘) */
function targetDay(KR, now = Date.now()) {
  if (KR) { const k = clock(true, now); if (k.wk && k.min < WIN.kr[0]) return INT.nextOpenDay(true, now - Math.max(0, k.min - 530) * 60000); }   // 09:00~09:30 이면 08:50 으로 보고 셈 → 오늘
  return INT.nextOpenDay(KR, now);
}
/** 지금 그 시장의 확인 시간인가 — 'before' · 'in' · 'after' (그날 기준) */
function phase(KR, now = Date.now()) {
  const k = clock(KR, now), [a, b] = KR ? WIN.kr : [570 + WIN.us[0], 570 + WIN.us[1]];
  return { d: k.d, wk: k.wk, ph: k.min < a ? "before" : k.min <= b ? "in" : "after" };
}
const dayTxt = (d) => d ? `${+d.slice(4, 6)}/${+d.slice(6, 8)}` : "";
const rid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

/* ── 화면이 부르는 것: 목록 · 넣기 · 취소 ── */
export async function listResv() {
  const { data } = await load();
  return { items: data.items.slice(-20).reverse(), updatedAt: data.updatedAt, win: { us: phase(false), kr: phase(true) } };
}
export async function addResv(b) {
  const c = cfg();
  if (!c.order) throw new Error("메리츠 주문이 꺼져 있어 예약할 수 없습니다 (MERITZ_ORDER=on)");
  const KR = b.m === "kr";
  const t = String(b.t || "").toUpperCase().trim();
  if (KR ? !/^[0-9A-Z]{6}$/.test(t) : !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)) throw new Error("종목 코드가 올바르지 않습니다");
  const qty = Math.floor(num(b.qty)), base = num(b.base), line = num(b.line);
  if (!(qty >= 1 && qty <= 100000)) throw new Error("수량은 1주 이상이어야 합니다");
  if (!(base > 0)) throw new Error("기준 종가가 없습니다 — 앱 데이터를 새로 고친 뒤 다시");
  const cap1 = KR ? c.maxKrw : c.maxUsd;
  if (qty * base * (1 + G.up / 100) > cap1) throw new Error(`예약 금액이 1건 상한 ${KR ? `${cap1.toLocaleString("ko-KR")}원` : `$${cap1.toLocaleString("en-US")}`} 을 넘을 수 있습니다 — 수량을 줄여 주세요`);
  const k = clock(KR);
  if (INT.regularNow(KR) && !(KR && k.min < WIN.kr[0])) throw new Error("지금은 정규장입니다 — 예약 대신 바로 사기로 주문해 주세요");
  const day = targetDay(KR);
  const item = { id: rid(), t, m: KR ? "kr" : "us", n: String(b.n || "").slice(0, 40), ex: KR ? "KRX" : String(b.ex || "").toUpperCase(), qty, base, line: line > 0 ? line : null,
                 asOf: String(b.asOf || "").slice(0, 10), day, at: new Date().toISOString(), status: "wait" };
  await mutate((d) => {
    if (d.items.some((x) => x.t === t && (x.status === "wait" || x.status === "run"))) throw new Error(`${t} 은(는) 이미 예약돼 있습니다 — 내 종목 탭 '매수 예약'에서 확인`);
    d.items.push(item);
  }, `매수 예약 ${t} ${qty}주 (${dayTxt(day)})`);
  return { added: item };
}
export async function cancelResv(id) {
  let hit = null;
  await mutate((d) => {
    const x = d.items.find((y) => y.id === id);
    if (!x) throw new Error("그 예약을 찾지 못했습니다");
    if (x.status !== "wait") throw new Error(x.status === "run" ? "지금 확인 중이라 취소할 수 없습니다 — 메리츠 주문 내역을 봐 주세요" : "이미 끝난 예약입니다");
    x.status = "cancel"; x.doneAt = new Date().toISOString(); x.why = "직접 취소"; hit = x;
  }, `매수 예약 취소 ${id}`);
  return { cancelled: hit };
}

/* ── 실행 (예약 시간 · 앱) ── */
async function todayJson() {
  try {
    const r = await fetch(`${API}public/data/today.json?ref=main`, { headers: { ...ghHead(), Accept: "application/vnd.github.raw" }, cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function tg(text) {
  const tok = process.env.TELEGRAM_BOT_TOKEN || process.env.TG_TOKEN || "", chat = process.env.TELEGRAM_CHAT_ID || process.env.TG_CHAT || "";
  if (!tok || !chat) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }), signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch { return false; }
}

/** 한 시장의 예약을 처리. now 는 시험용 */
export async function runResv({ only = null, now = Date.now(), dry = false } = {}) {
  const c = cfg();
  const report = [];
  for (const mk of only ? [only] : ["us", "kr"]) {
    const KR = mk === "kr", P = phase(KR, now);
    // 1) 날짜·시간으로 정리 + 내가 맡을 예약을 'run' 으로 잠금
    //    run 인 채 5분 넘은 것 = 확인 중에 끊김 → 주문 내역으로 판정 (주문이 있으면 '보냄', 없으면 시간 안이면 다시 확인 · 지났으면 실패)
    let mine = [], stuck = [], expired = [];
    const nowIso = new Date(now).toISOString();
    const inWin = (x) => x.day === P.d && P.ph === "in";
    const { data } = await mutate((d) => {
      let changed = false; mine = []; stuck = []; expired = [];
      for (const x of d.items) {
        if (x.m !== mk) continue;
        if (x.status === "run" && Date.parse(x.ranAt || 0) < now - 5 * 60000) { stuck.push(x.id); if (inWin(x)) { x.ranAt = nowIso; changed = true; } continue; }
        if (x.status !== "wait") continue;
        if (x.day < P.d || (x.day === P.d && P.ph === "after")) {
          x.status = "expired"; x.doneAt = nowIso; x.why = x.day < P.d ? "그날 확인하지 못해 만료 (예약 실행이 안 돌았음)" : "확인 시간이 지나 만료"; expired.push(x.id); changed = true; continue; }
        if (inWin(x)) { x.status = "run"; x.ranAt = nowIso; mine.push(x.id); changed = true; }
      }
      return changed ? undefined : false;
    }, `매수 예약 확인 ${mk}`);
    report.push(...data.items.filter((x) => expired.includes(x.id)));
    if (!mine.length && !stuck.length) continue;
    if (!INT.regularNow(KR)) {                                      // 확인 시간인데 장이 닫힘 = 휴장
      const ids = [...mine, ...stuck.filter((id) => inWin(data.items.find((y) => y.id === id) || {}))];
      await mutate((d) => { for (const x of d.items) if (ids.includes(x.id)) { x.status = "expired"; x.doneAt = nowIso; x.why = "휴장일이라 만료"; } }, `매수 예약 휴장 ${mk}`);
      report.push(...data.items.filter((x) => ids.includes(x.id)).map((x) => ({ ...x, status: "expired", why: "휴장일이라 만료" })));
      continue;
    }
    // 2) 계좌·시장·신호 한 번에 — 여기서 실패하면(주문 전) 잠근 예약을 '기다림'으로 되돌려 다음 확인 때 다시
    let bal, orders, qj, ctx;
    const upd = {};                                                 // id → 바꿀 값
    try {
      ctx = { tok: null, reissued: false };
      ctx.tok = await INT.getToken(c, null, false);
      bal = KR ? await INT.krBalance(c, ctx) : await INT.usBalance(c, ctx);
      await INT.sleep(INT.GAP);
      orders = KR ? await INT.krOrders(c, ctx) : await INT.usOrders(c, ctx);
    } catch (e) {
      await mutate((d) => { for (const x of d.items) if (mine.includes(x.id) || stuck.includes(x.id)) { x.status = x.status === "run" && mine.includes(x.id) ? "wait" : x.status; x.note = `계좌 조회 실패 — 다음 확인 때 다시 (${String(e?.message || e).slice(0, 80)})`; } }, `매수 예약 보류 ${mk}`);
      continue;
    }
    const today = clock(KR, now).d;
    const boughtToday = (t) => orders.find((o) => o.t === t && o.side === "buy" && !o.orgn && (KR ? o.dt === today : o.sess === today) && !/거부|미접수/.test(o.state || ""));
    for (const id of stuck) {
      const x = data.items.find((y) => y.id === id); if (!x) continue;
      const o = boughtToday(x.t);
      if (o) upd[id] = { status: "sent", odno: o.odno, px: o.px, qty: o.qty, why: "확인 중 끊겼지만 주문은 나갔음 — 메리츠에서 확인" };
      else if (inWin(x)) mine.push(id);                             // 주문이 없고 아직 확인 시간 → 이번에 다시 확인
      else upd[id] = { status: "fail", why: "확인 중에 끊김 — 주문 기록 없음 · 필요하면 직접 사기" };
    }
    const todo = data.items.filter((x) => mine.includes(x.id));
    try {
      await INT.sleep(INT.GAP);
      qj = KR ? await INT.krQuotes(c, ctx, { idx: true, list: todo.map((x) => ({ t: x.t })) })
              : await INT.usQuotes(c, ctx, { idx: true, list: todo.map((x) => ({ t: x.t, ex: x.ex })) });
    } catch { qj = { quotes: {}, idx: {} }; }                       // 아래에서 '시장 상태 확인 못 함'으로 안 삼
    const idxR = (KR ? ["KOSPI", "KOSDAQ"] : ["QQQ", "SPY"]).map((k) => [k, qj.idx?.[k]?.rate]).filter(([, v]) => typeof v === "number");
    const tj = await todayJson();
    const sigDay = tj ? String((KR ? tj.asOfKr : tj.asOfUs) || tj.asOf || "") : "";
    const candT = new Set((tj?.candidates || []).map((r) => r.t));
    const gate = tj ? (KR ? !!tj.cfg?.krGate : !!tj.cfg?.usGate) : false;
    for (const x of todo) {
      const q = qj.quotes?.[x.t] || null;
      const skip = (why) => { upd[x.id] = { status: "skip", why, last: q?.last || null }; };
      if (!(num(x.base) > 0)) { skip("기준 종가가 없는 예약 — 사지 않음"); continue; }          // 297. 기준 종가가 없으면 +3%·−5% 검사가 안 되므로 사지 않음
      if (bal.rows.some((r) => r.t === x.t)) { skip("이미 이 계좌에 있음"); continue; }
      if (orders.some((o) => o.t === x.t && o.side === "buy" && o.open > 0 && !o.orgn)) { skip("같은 종목 매수 대기 주문이 있음"); continue; }
      if (boughtToday(x.t)) { skip("오늘 이미 산 주문이 있음"); continue; }
      if (!tj) { skip("앱 데이터(today.json)를 읽지 못해 신호 확인 불가 — 보류"); continue; }
      if (gate) { skip(KR ? "한국 시장 위험 — 새로 사지 않음" : "나스닥100 200일선 아래 — 미국 새로 사지 않음"); continue; }
      if (tj && sigDay && x.asOf && sigDay > x.asOf && !candT.has(x.t)) { skip(`새 종가(${sigDay.slice(5)})에서 매수! 신호가 꺼짐`); continue; }
      if (!idxR.length) { skip("시장 상태를 확인하지 못함 — 보류"); continue; }
      const worst = Math.min(...idxR.map(([, v]) => v));
      if (worst <= G.mktDown) { skip(`시장 급락 (${idxR.map(([k, v]) => `${k} ${v.toFixed(1)}%`).join(" · ")})`); continue; }
      if (!q || !(q.last > 0)) { skip("지금 가격을 확인하지 못함"); continue; }
      const ch = (q.last / x.base - 1) * 100;
      if (x.line && q.last <= x.line) { skip(`손절선 ${x.line} 아래 (지금 ${q.last})`); continue; }
      if (ch >= G.up) { skip(`기준 종가보다 +${ch.toFixed(1)}% — 추격 안 함`); continue; }
      if (ch <= G.down) { skip(`기준 종가보다 ${ch.toFixed(1)}% — 급락 중`); continue; }
      const raw = q.last * (1 + G.slip / 100);
      const px = KR ? Math.ceil(raw / INT.tickKr(raw)) * INT.tickKr(raw) : Math.ceil(raw * 100) / 100;
      const cap1 = KR ? c.maxKrw : c.maxUsd;
      const qty = Math.min(x.qty, Math.floor(cap1 / px));
      if (qty < 1) { skip("1주 값이 1건 상한보다 큼"); continue; }
      if (dry) { upd[x.id] = { status: "skip", why: `시험 — 실제로는 ${qty}주 × ${px} 주문`, last: q.last }; continue; }
      try {
        await INT.sleep(INT.GAP);
        const r = await INT.placeOrder(c, ctx, { side: "buy", t: x.t, ex: KR ? "KRX" : q.ex, qty, px, confirm: true, rid: `resv-${x.id}` }, KR);
        upd[x.id] = { status: "sent", odno: r.placed?.odno || "", px, qty, last: q.last, why: qty < x.qty ? `1건 상한으로 ${x.qty}→${qty}주` : "" };
      } catch (e) {
        upd[x.id] = e?.unsure ? { status: "unsure", why: "메리츠 응답이 끊김 — 주문이 들어갔을 수 있음 · 메리츠 앱에서 확인" }
                              : { status: "fail", why: String(e?.message || e).slice(0, 160) };
      }
    }
    // 3) 결과 저장 (부딪혀도 내 것만 덮음)
    const doneAt = new Date().toISOString();
    const fin = await mutate((d) => { for (const y of d.items) if (upd[y.id]) Object.assign(y, upd[y.id], { doneAt }); }, `매수 예약 결과 ${mk}`);
    report.push(...fin.data.items.filter((y) => upd[y.id]));
  }
  if (report.length && !dry) {
    const icon = { sent: "✅", skip: "⏭", expired: "⌛", fail: "⚠️", unsure: "❓" };
    const M = (x, v) => x.m === "kr" ? `${Math.round(v).toLocaleString("ko-KR")}원` : `$${v}`;
    const lines = report.map((x) => `${icon[x.status] || "·"} <b>${x.m === "kr" ? (x.n || x.t) : x.t}</b> ` + (x.status === "sent" ? `${x.qty}주 지정가 ${M(x, x.px)} 주문 보냄${x.why ? ` · ${x.why}` : ""}` : `사지 않음 — ${x.why || x.status}`));
    await tg(`⏰ <b>매수 예약 결과</b>\n${lines.join("\n")}\n<i>체결은 메리츠 앱 · 앱 내 종목 탭에서 확인</i>`);
  }
  return { done: report };
}
