/* 264. Track 탭 — 이 탭만 쓰는 화면 (App.jsx 에서 자동으로 나눔 · 다른 탭과 같이 쓰는 건 core.jsx) */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { pickToday, SLOTS_DEFAULT } from "./picks.js";
import { planFills, applyFills } from "./fills.js";
import { openOrder, nextOpen } from "./order.js";
import { useResv, resvDay, resvCall, RESV_ST } from "./resv.js";
import { SchedLine, WeekSched, pastEarnTxt } from "./Info.jsx";
import { C, Card, Chip, CopyBtn, DipTag, Empty, FS, InfoLink, LiveTag, MONO, NOTES_REF, ONE, PLAN_KEY, Sec, Seg, StockRow, actionOf, askKeyAgain, avgOf, btn, budgetOf, col, dcModeOf, earnDays, earnTxt, getRevMin, inp, investedIn, investedOf, kstDay, linkBtn, liveOf, loadJSON, loadPlan, localToday, lossOf, lossTxt, md, mktOfT, money, nextTrancheOf, pct, pickCfg, planAmounts, postWatch, price, relOf, roomFor, settingsChanged, shortName, slotInfo, subLine, tgtGap, tgtOf, tgtText, trOf, usDST, useBroker, useLive } from "./core.jsx";


/** 보유 평가 — 회차 합산 (시장 통화 그대로) */
export const valueOf = (p, s) => trOf(p).reduce((a, t) => a + (t.amt || 0) / t.px * (s?.c ?? t.px), 0);

/* ── 228. 서버(watchlist.json) 동기화 도구 ── */
export const AUTO_FROM = "2026-10-31";
export const AUTO_APPLY_FROM = "2026-11-08";

/* ══════════════ 6. 추적 ══════════════ */
/** 246. 내 종목 탭 맨 위 — 메리츠 잔고 요약(내 종목 = 메리츠 기준) · 249. 매수 예약 목록 */
export function BrokerTop({ brokerSync = {}, stocks = {} }) {
  const resv = useResv();
  const [busy, setBusy] = useState("");
  const rows = ["us", "kr"].map(m => brokerSync[m]).filter(k => k && k.env === "real" && Array.isArray(k.rows));
  const at = rows.length ? Math.max(...rows.map(k => k.at || 0)) : 0;
  const go = () => { try { document.getElementById("kis-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {} };
  const items = resv.items || [];
  const wait = items.filter(x => x.status === "wait" || x.status === "run");
  const recent = items.filter(x => x.status !== "wait" && x.status !== "run" && Date.now() - Date.parse(x.doneAt || x.at || 0) < 3 * 86400000).slice(0, 4);
  const cancel = async (x) => {
    if (!confirm(`${x.t} ${x.qty}주 매수 예약을 취소할까요?`)) return;
    setBusy(x.id);
    try { const j = await resvCall({ what: "resvBuyCancel", id: x.id }); if (!j.ok) alert(j.msg || "취소하지 못했습니다"); } catch { alert("연결이 끊겼습니다 — 다시 눌러 주세요"); }
    try { window.dispatchEvent(new Event("resv-changed")); } catch {}
    setBusy("");
  };
  const nmOf = (x) => x.m === "kr" ? (x.n || stocks[x.t]?.n || x.t) : x.t;
  return (
    <>
      <button onClick={go} style={{ display: "block", width: "100%", textAlign: "left", marginTop: 8, padding: "10px 12px", borderRadius: 12, cursor: "pointer",
                                    background: "rgba(245,158,11,.06)", border: `1px solid ${C.gold}55`, color: C.text }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <b style={{ fontSize: FS.sm, flexShrink: 0 }}>🏦 메리츠 잔고</b>
          <span style={{ fontSize: FS.xs, color: C.muted, minWidth: 0, ...ONE }}>{at ? `${new Date(at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 기준` : "아직 안 불러옴"}</span>
          <span style={{ marginLeft: "auto", color: C.muted, fontSize: FS.xs, flexShrink: 0 }}>계좌 카드 ›</span>
        </div>
        <div style={{ fontSize: 10.5, color: C.muted }}>내 종목은 이 잔고가 기준입니다</div>
        {rows.length ? rows.map(k => { const cost = k.rows.reduce((a, r) => a + (r.cost || 0), 0), val = k.rows.reduce((a, r) => a + (r.val || 0), 0), m = k.mk;
          return <div key={m} style={{ fontSize: FS.sm, marginTop: 4, fontFamily: MONO, ...ONE }}>
            {m === "us" ? "🇺🇸" : "🇰🇷"} {k.rows.length}종목 · 평가 {money(val, m)} <b style={{ color: col(val - cost) }}>{cost > 0 ? pct((val / cost - 1) * 100, 1) : ""}</b>
            <span style={{ color: C.muted, fontFamily: "inherit", fontSize: FS.xs }}> {k.rows.slice(0, 5).map(r => m === "kr" ? (r.n || r.t) : r.t).join(" · ")}{k.rows.length > 5 ? " …" : ""}</span></div>; })
          : <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 4 }}>아래 계좌 카드에서 '잔고 불러오기'를 한 번 누르면 이 기기에서는 앱을 열 때마다 자동으로 불러옵니다</div>}
      </button>
      {(wait.length > 0 || recent.length > 0) && (
        <Card style={{ marginTop: 8, borderColor: `${C.cyan}66`, padding: "10px 12px" }}>
          <div style={{ fontSize: FS.sm, fontWeight: 800 }}>⏰ 매수 예약 {wait.length ? `${wait.length}건 기다림` : ""}</div>
          {wait.map(x => (
            <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: `1px solid ${C.border}` }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: FS.sm }}>
                <b style={{ fontFamily: x.m === "us" ? MONO : "inherit" }}>{nmOf(x)}</b> {x.qty}주
                <span style={{ display: "block", fontSize: 10.5, color: C.muted }}>{resvDay(x.day)} {x.m === "us" ? "미국 장 시작 5분 뒤부터" : "09:30 뒤"} 확인 · 기준 {price(x.base, x.m)}{x.line ? ` · 트레일링선 ${price(x.line, x.m)}` : ""} · 하루만</span></span>
              {x.status === "run" ? <span style={{ fontSize: FS.xs, color: C.gold }}>확인 중…</span>
                : <button onClick={() => cancel(x)} disabled={busy === x.id} style={{ ...btn(C.dim), minHeight: 34, padding: "0 12px", fontSize: FS.xs }}>{busy === x.id ? "…" : "취소"}</button>}
            </div>))}
          {recent.map(x => { const [l, c] = RESV_ST[x.status] || [x.status, C.muted]; return (
            <div key={x.id} style={{ fontSize: FS.xs, padding: "6px 0", borderTop: `1px solid ${C.border}`, color: C.dim, lineHeight: 1.5 }}>
              <b style={{ color: c }}>{l}</b> <b style={{ color: C.text, fontFamily: x.m === "us" ? MONO : "inherit" }}>{nmOf(x)}</b> {resvDay(x.day)}
              {x.status === "sent" ? ` · ${x.qty}주 지정가 ${price(x.px, x.m)} — 체결은 메리츠 카드 '최근 주문'` : x.why ? ` · ${x.why}` : ""}</div>); })}
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>장이 열린 뒤 서버가 시장 -2% · 트레일링선 · 기준 종가 +3%/-5% · 매수! 신호 · 나스닥100 200일선을 다시 보고 지정가(그때 가격 +0.5%)로 삽니다 · 무료 서버 예약이라 개장 뒤 몇 분~1시간 늦을 수 있음</div>
        </Card>)}
    </>);
}

export function TrackTab({ stocks, watch, toggleWatch, openStock, pos, setPos, market, bumpSizer, extras, trades, setTrades, sizer, syncState, brokerSync = {}, syncOk = true, brokerMiss = [] }) {
  const [role, setRole] = useState("all");
  const [tmk, setTmkRaw] = useState(() => localStorage.getItem("v11.trackMkt") || "us");      // 69. 기본 🇺🇸, 마지막 선택 기억
  const setTmk = (v) => { setTmkRaw(v); localStorage.setItem("v11.trackMkt", v); };
  const live = useLive((pos || []).map(p => stocks[p.t]));      // 105. 지금 가격 (표시 전용)
  const [edit, setEdit] = useState(null);      // 104. { id, tr:[{d,px,amt}] } — 매수가(체결가)·금액 고치기
  const saveEdit = () => {
    const tr = (edit?.tr || []).map(t => ({ d: String(t.d || "").slice(0, 10), px: Number(t.px), amt: Math.max(0, Number(t.amt) || 0) }));
    if (!tr.length || tr.some(t => !(t.px > 0))) { setEdit(e => ({ ...e, err: "체결가는 0보다 커야 합니다" })); return; }
    setPos(v => v.map(x => x.id === edit.id ? { ...x, tr, date: tr[0].d || x.date } : x)); setEdit(null);
  };
  const look = useCallback((t) => stocks[t] || null, [stocks]);
  const [form, setForm] = useState(null);
  const inMk = (t) => tmk === "all" || mktOfT(t) === tmk;
  const rows = pos.filter(p => (role === "all" || p.role === role) && inMk(p.t))
                  .sort((a, b) => (mktOfT(a.t) === "us" ? 0 : 1) - (mktOfT(b.t) === "us" ? 0 : 1));   // 🇺🇸 먼저
  const nUs = pos.filter(p => mktOfT(p.t) === "us").length, nKr = pos.length - nUs;
  const RB = { etf: ["ETF", "w"], swing: ["단기", "g"], long: ["장기", "c"] };

  /* ── 184. 증권사 체결 반영 — 아래 증권사 카드가 불러온 잔고·주문과 내 종목을 맞춥니다 (src/fills.js · scripts/check_fills.mjs) ── */
  const [applied, setApplied] = useState(() => new Set(loadJSON("v13.kis.applied", [])));
  const [ignored, setIgnored] = useState(() => new Set(loadJSON("v13.kis.ignore", [])));
  const saveSet = (k, set) => { try { localStorage.setItem(k, JSON.stringify([...set].slice(-500))); } catch {} };
  const fillPlan = useMemo(() => ["us", "kr"].map(m => {
    const k = brokerSync[m]; if (!k) return null;
    return { m, env: k.env, broker: k.broker, ...planFills({ orders: k.orders, rows: k.rows, pos: pos.filter(p => mktOfT(p.t) === m), applied, ignored, from: k.env === "real" ? AUTO_FROM : "" }) };
  }).filter(Boolean), [brokerSync, pos, applied, ignored]);
  useEffect(() => {      // 손으로 이미 기록한 체결은 조용히 '반영됨' 처리
    const d = fillPlan.flatMap(x => x.dup).filter(o => !applied.has(o));
    if (d.length) { const n = new Set([...applied, ...d]); setApplied(n); saveSet("v13.kis.applied", n); }
  }, [fillPlan]);        // eslint-disable-line react-hooks/exhaustive-deps
  const kisQty = useMemo(() => { const o = {}; Object.values(brokerSync).forEach(k => (k.rows || []).forEach(r => { o[String(r.t).toUpperCase().replace("/", "-")] = { qty: r.qty, env: k.env, label: k.label }; })); return o; }, [brokerSync]);
  const broker = useBroker();          // 210. 주문이 열린 계좌면 카드에서 바로 주문 창
  const BK = broker?.label || Object.values(brokerSync).find(k => k && k.label)?.label || "계좌";   // 연결된 증권사 이름 (카드가 알려 줌)
  const pendingN = fillPlan.reduce((a, x) => a + x.items.length + x.extra.length, 0);
  const [fillOpen, setFillOpen] = useState(false);
  const [fillOff, setFillOff] = useState({});          // key → true 면 반영하지 않음
  const applyAll = () => {
    let cur = pos, tradesAdd = [];
    const done = new Set(applied);
    fillPlan.forEach(x => {
      const pick = x.items.filter(i => i.kind !== "partial" && !fillOff[i.key]);
      const r = applyFills(cur, pick, { src: (x.broker || "kis"), mOf: mktOfT, nameOf: t => stocks[t]?.n });
      cur = r.pos; tradesAdd = [...tradesAdd, ...r.trades];
      x.items.forEach(i => i.odnos.forEach(o => done.add(o)));      // 체크를 뺀 것·일부 매도도 목록에서 지움
    });
    setPos(cur); if (tradesAdd.length) setTrades(v => [...v, ...tradesAdd].slice(-300));
    setApplied(done); saveSet("v13.kis.applied", done); setFillOpen(false); setFillOff({});
  };
  const addExtra = (x, e, role = "long") => {
    setPos(v => [...v, { id: Date.now(), t: e.t, role, date: kstDay(), tr: [{ d: kstDay(), px: e.avg || 0, amt: Math.round((e.avg || 0) * e.qty * 100) / 100 }], src: (x.broker || "kis") }]);
  };
  /* ★ 228. 내 종목 = 메리츠(실계좌) 기준 — 체결된 매수·매도는 열 때 자동으로 반영. 반영한 내용은 한 번 알리고 되돌릴 수 있음
   *   (일부 매도·메리츠에만 있는 종목은 지금처럼 골라서) · 서버와 맞추기가 끝난 뒤에만(다른 기기 기록과 겹쳐 두 번 들어가지 않게) */
  const [autoNote, setAutoNote] = useState(null);       // { txt, undo: { pos, trades } }
  useEffect(() => {
    if (!syncOk || kstDay() < AUTO_APPLY_FROM) return;     // 233. 미리보기 기간 — 아래 노란 상자에서 확인하고 반영
    const pick = fillPlan.filter(x => x.env === "real").map(x => ({ x, items: x.items.filter(i => i.kind !== "partial") })).filter(y => y.items.length);
    if (!pick.length) return;
    const undo = { pos, trades };
    let cur = pos, add = []; const done = new Set(applied);
    pick.forEach(({ x, items }) => {
      const r = applyFills(cur, items, { src: x.broker || "kis", mOf: mktOfT, nameOf: t => stocks[t]?.n });
      cur = r.pos; add = [...add, ...r.trades]; items.forEach(i => i.odnos.forEach(o => done.add(o)));
    });
    setPos(cur); if (add.length) setTrades(v => [...v, ...add].slice(-300));
    setApplied(done); saveSet("v13.kis.applied", done);
    setAutoNote({ txt: pick.flatMap(({ x, items }) => items.map(i => `${x.m === "kr" ? (stocks[i.t]?.n || i.n || i.t) : i.t} ${i.side === "sell" ? "매도" : i.kind === "t2" ? "2회차 매수" : "매수"} ${i.qty}주 @ ${price(i.px, x.m)}`)).join(" · "), undo });
  }, [fillPlan, syncOk]);   // eslint-disable-line react-hooks/exhaustive-deps
  // 229. 계좌 카드의 '내 종목에 없음 — 넣기' → 이 종목을 '무시'에서 빼고 고르는 창을 엶
  useEffect(() => {
    const f = (e) => { const t = e.detail?.t; if (t && ignored.has(t)) { const n = new Set([...ignored].filter(x => x !== t)); setIgnored(n); saveSet("v13.kis.ignore", n); }
      setFillOpen(true); };
    window.addEventListener("fill-open", f); return () => window.removeEventListener("fill-open", f);
  });
  const ignoreExtra = (e) => { const n = new Set([...ignored, e.t]); setIgnored(n); saveSet("v13.kis.ignore", n); };
  // 189. 매도!는 '다음 개장 때 팔리게' — 종가보다 2.5% 낮은 지정가로 채움 (지정가가 시장가보다 낮으면 개장 가격에 체결)
  const FillSheet = () => !fillOpen ? null : (
    <div onClick={(e) => { if (e.target === e.currentTarget) setFillOpen(false); }}
         style={{ position: "fixed", inset: 0, zIndex: 180, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div role="dialog" aria-modal="true" aria-label="체결 반영" style={{ background: C.panel, borderRadius: "14px 14px 0 0", width: "100%", maxWidth: 640, maxHeight: "86vh", overflowY: "auto", padding: "16px 14px 22px", borderTop: `2px solid ${C.gold}` }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.gold }}>{BK} 체결 반영</div>
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 3, lineHeight: 1.6 }}>{BK}에서 체결된 거래를 체결가 그대로 내 종목에 적습니다. 반영하면 칸 수·투입금·성적이 바로 맞춰집니다. 체크를 뺀 것은 반영하지 않고 목록에서만 지웁니다.</div>
        {fillPlan.map(x => (
          <div key={x.m} style={{ marginTop: 10 }}>
            {(x.items.length > 0 || x.extra.length > 0) && <div style={{ fontSize: FS.sm, fontWeight: 700, marginBottom: 4 }}>{x.m === "us" ? "🇺🇸 미국" : "🇰🇷 한국"}
</div>}
            {x.items.map(i => {
              const off = fillOff[i.key] || i.kind === "partial"; const sell = i.side === "sell";
              return (
                <label key={i.key} style={{ display: "grid", gridTemplateColumns: "26px minmax(0,1fr) auto", gap: "2px 8px", alignItems: "center", padding: "9px 10px", marginBottom: 6, borderRadius: 10, background: "rgba(255,255,255,.04)", border: `1px solid ${C.border}`, cursor: i.kind === "partial" ? "default" : "pointer" }}>
                  <input type="checkbox" checked={!off} disabled={i.kind === "partial"} onChange={() => setFillOff(v => ({ ...v, [i.key]: !v[i.key] }))} style={{ width: 20, height: 20 }} aria-label={`${i.t} 반영`} />
                  <span style={{ minWidth: 0, ...ONE }}><b style={{ fontFamily: MONO }}>{x.m === "kr" ? (stocks[i.t]?.n || i.n || i.t) : i.t}</b> <b style={{ color: sell ? C.red : C.emerald, fontSize: FS.sm }}>{sell ? "매도" : "매수"} {i.qty}주</b></span>
                  <b style={{ fontFamily: MONO }}>{price(i.px, x.m)}</b>
                  <span style={{ gridColumn: "2 / -1", fontSize: FS.xs, color: i.kind === "partial" ? C.gold : C.muted }}>{md(i.d)} 체결 · {i.label}</span>
                </label>);
            })}
            {x.extra.map(e => (
              <div key={e.t} style={{ padding: "9px 10px", marginBottom: 6, borderRadius: 10, background: "rgba(245,158,11,.08)", border: `1px solid ${C.gold}55`, fontSize: FS.sm }}>
                <b style={{ color: C.gold }}>{BK}에만 있음</b> · <b style={{ fontFamily: MONO }}>{x.m === "kr" ? (e.n || e.t) : e.t}</b> {e.qty}주{e.avg ? ` · 평단 ${price(e.avg, x.m)}` : ""}
                <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 2 }}>앱 신호로 산 종목이면 '단기'(매도 규칙·알림 적용), 따로 산 종목이면 '장기'로 넣으세요</div>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button onClick={() => addExtra(x, e, "swing")} style={{ ...btn(C.emerald), flex: 1, minHeight: 40 }}>단기로 넣기</button>
                  <button onClick={() => addExtra(x, e, "long")} style={{ ...btn(C.dim), flex: 1, minHeight: 40 }}>장기로 넣기</button>
                  <button onClick={() => ignoreExtra(e)} style={{ ...btn(C.dim), flex: "0 0 64px", minHeight: 40 }}>무시</button>
                </div>
              </div>))}
          </div>))}
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {fillPlan.some(x => x.items.length) && <button onClick={applyAll} style={{ ...btn(C.emerald), minHeight: 46 }}>
            {fillPlan.reduce((a, x) => a + x.items.filter(i => i.kind !== "partial" && !fillOff[i.key]).length, 0)}건 반영하기</button>}
          <button onClick={() => setFillOpen(false)} style={{ ...btn(C.dim), minHeight: 40 }}>나중에</button>
        </div>
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>같은 날 여러 번 산 것은 평균가로 한 번 · 일부 매도는 카드의 ✏ 수정으로 직접 고칩니다 · 반영 뒤에도 ✏ 수정으로 고칠 수 있습니다</div>
      </div>
    </div>);

  /** 83. 매도 기록 — 앱 안 입력 시트. 예전엔 브라우저 입력창에서 '취소'를 누르면 기록 없이 종목이 삭제됐음 */
  const [sheet, setSheet] = useState(null);      // { kind: "sell"|"add", p, s, px }
  const closePos = (p, s) => setSheet({ kind: "sell", p, s, px: String(s?.c ?? avgOf(p)) });
  const addTranche = (p, s) => { const t0 = trOf(p)[0]; const amt0 = t0 && t0.amt > 0 ? t0.amt : sizer.limit(s?.m || "kr") * 0.5;
    setSheet({ kind: "add", p, s, px: String(s?.c ?? ""), qty: s?.c ? String(Math.max(1, Math.floor(amt0 / s.c))) : "", d: kstDay() }); };
  const doClose = (p, s, raw, keep) => {
    {
      const sell = Number(String(raw).replace(/[^\d.]/g, ""));
      if (keep && sell > 0) {
        const avg = avgOf(p), tr = trOf(p);
        const days = Math.max(1, Math.round((Date.now() - new Date(tr[0].d + "T00:00:00").getTime()) / 86400000));
        setTrades(v => [...v, { t: p.t, n: s?.n || p.t, m: s?.m || (/^\d{6}$/.test(p.t) ? "kr" : "us"), role: p.role, buy: avg, sell, in: tr[0].d,
                                out: kstDay(), days, pl: (sell / avg - 1) * 100,
                                k: tr.length, inv: investedOf(p) }].slice(-300));
      }
    }
    setPos(v => v.filter(x => x.id !== p.id)); setSheet(null);
  };
  /** 2회차 매수 기록 */
  const doAdd = (p, s, raw, rawQty, d) => {
    const px = Number(String(raw).replace(/[^\d.]/g, "")); if (!(px > 0)) return;
    const qty = Number(String(rawQty || "").replace(/[^\d.]/g, ""));
    setSheet(null);
    const t0 = trOf(p)[0];
    // 184. 실제 주수를 넣으면 체결가 × 주수 · 비우면 1회차와 같은 금액(103)
    const amt = qty > 0 ? Math.round(qty * px * 100) / 100 : (t0 && t0.amt > 0 ? t0.amt : sizer.limit(s?.m || "kr") * 0.5);
    setPos(v => v.map(x => x.id === p.id ? { ...x, tr: [...trOf(x), { d: String(d || kstDay()).slice(0, 10), px, amt }] } : x));
  };
  const submit = () => {
    const key = (form.t || "").trim().toUpperCase();
    const found = look(key);
    if (!found) { setForm({ ...form, err: "목록에 없는 티커입니다" }); return; }
    const px = Number(form.avg);
    if (!px || px <= 0) { setForm({ ...form, err: "매수가를 숫자로 입력하세요" }); return; }
    const m = found.m || "kr"; const role = form.role || (found.etf ? "etf" : "swing");
    const amt = role === "etf" ? sizer.limit(m) : sizer.limit(m) * (form.k === "2" ? 1 : 0.5);
    setPos(v => [...v, { id: Date.now(), t: key, role, date: kstDay(),
                         tr: form.k === "2" ? [{ d: kstDay(), px, amt: amt / 2 }, { d: kstDay(), px, amt: amt / 2 }]
                                            : [{ d: kstDay(), px, amt }] }]);
    setForm(null);
  };
  const Cap = ({ label, v, set, m }) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: FS.sm, color: C.dim, width: 92, flexShrink: 0 }}>{label}</span>
      <input type="number" inputMode="numeric" value={v} onChange={e => set(Number(e.target.value) || 0)} style={{ ...inp("100%"), flex: 1 }} />
      <span style={{ fontSize: FS.xs, color: C.muted, width: 56, textAlign: "right" }}>{money(v, m)}</span>
    </label>);
  // 220. 잘못 등록 추정: 오늘 등록 + (계좌 잔고를 불러왔다면) 잔고에 없음
  const mistakeOf = (p) => { const d0 = kstDay(), reg = String(p.date || trOf(p)[0]?.d || "") === d0;
    const loaded = Object.values(brokerSync).some(k => k && Array.isArray(k.rows) && k.mk === mktOfT(p.t));
    return reg && (!loaded || !kisQty[String(p.t).toUpperCase()]); };
  const Sheet = () => !sheet ? null : (
    <div onClick={(e) => { if (e.target === e.currentTarget) setSheet(null); }}
         style={{ position: "fixed", inset: 0, zIndex: 180, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: C.panel, borderRadius: "14px 14px 0 0", width: "100%", maxWidth: 640, padding: "16px 14px 22px", borderTop: `2px solid ${sheet.kind === "sell" ? C.red : C.emerald}` }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>{sheet.kind === "sell" ? "매도 기록" : "2회차 매수 기록"} · {sheet.s?.n || sheet.p.t}</div>
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 3 }}>
          {sheet.kind === "sell" ? `평단 ${price(avgOf(sheet.p), mktOfT(sheet.p.t))} · 지금 ${price(sheet.s?.c, mktOfT(sheet.p.t))} · 실제 매도가를 넣어 주세요` : `1회차 ${price(trOf(sheet.p)[0]?.px, mktOfT(sheet.p.t))} · 실제 체결가와 주수를 넣어 주세요 (앱 제안값으로 채워 둠)`}</div>
        {sheet.kind === "add" ? (() => {   // 184. 체결가·주수·날짜를 실제 값으로 (앱 제안값으로 미리 채움)
          const m = mktOfT(sheet.p.t), px = Number(sheet.px) || 0, q = Number(sheet.qty) || 0;
          const tr = trOf(sheet.p), inv0 = investedOf(sheet.p), sh0 = tr.reduce((a, t) => a + (t.px > 0 ? (t.amt || 0) / t.px : 0), 0);
          const L = (k, child) => <label style={{ display: "grid", gap: 3, fontSize: FS.xs, color: C.dim }}>{k}{child}</label>;
          return <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
              {L(`체결가 (${m === "us" ? "$" : "원"})`, <input type="number" inputMode="decimal" value={sheet.px} onChange={e => setSheet(v => ({ ...v, px: e.target.value }))} style={{ ...inp("100%"), fontSize: 17, padding: "9px 10px" }} />)}
              {L("주수", <input type="number" inputMode="numeric" value={sheet.qty} onChange={e => setSheet(v => ({ ...v, qty: e.target.value }))} style={{ ...inp("100%"), fontSize: 17, padding: "9px 10px" }} />)}
            </div>
            <div style={{ marginTop: 6 }}>{L("날짜", <input value={sheet.d} onChange={e => setSheet(v => ({ ...v, d: e.target.value }))} style={inp("100%")} />)}</div>
            {px > 0 && q > 0 && <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 8 }}>= <b style={{ fontFamily: MONO, color: C.text }}>{money(px * q, m)}</b> · 새 평단 <b style={{ fontFamily: MONO, color: C.text }}>{price((inv0 + px * q) / (sh0 + q), m)}</b> · 보유 약 {Math.round(sh0 + q)}주</div>}
          </>; })()
        : <input type="number" inputMode="decimal" autoFocus value={sheet.px} onChange={e => setSheet(v => ({ ...v, px: e.target.value }))}
          style={{ ...inp("100%"), marginTop: 10, fontSize: 18, padding: "10px 12px" }} aria-label="매도가" />}
        {/* 220. 오늘 등록했고 계좌 잔고에도 없으면 — 잘못 등록일 가능성이 큼: '기록 없이 지우기'를 먼저 */}
        {sheet.kind === "sell" && mistakeOf(sheet.p) && (
          <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(245,158,11,.10)", border: `1px solid ${C.gold}` }}>
            <div style={{ fontSize: FS.sm, fontWeight: 700, color: C.gold }}>오늘 등록했고 {BK} 잔고에도 없는 종목입니다</div>
            <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 2 }}>실제로 산 게 아니라면 매도 기록을 남기지 말고 지우세요 — 기록이 남으면 성적에 섞입니다</div>
            <button onClick={() => doClose(sheet.p, sheet.s, 0, false)} style={{ ...btn(C.gold), width: "100%", minHeight: 44, marginTop: 8 }}>잘못 등록 — 기록 없이 지우기</button>
          </div>)}
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {sheet.kind === "sell"
            ? <button onClick={() => doClose(sheet.p, sheet.s, sheet.px, true)} style={{ ...btn(mistakeOf(sheet.p) ? C.dim : C.red), minHeight: 44 }}>{mistakeOf(sheet.p) ? "실제로 팔았음 — 매도 기록하고 빼기" : "매도 기록하고 내 종목에서 빼기"}</button>
            : <button onClick={() => doAdd(sheet.p, sheet.s, sheet.px, sheet.qty, sheet.d)} style={{ ...btn(C.emerald), minHeight: 44 }}>2회차 기록</button>}
          <button onClick={() => setSheet(null)} style={{ ...btn(C.dim), minHeight: 40 }}>취소 (아무것도 바꾸지 않음)</button>
          {sheet.kind === "sell" && !mistakeOf(sheet.p) && (
            <button onClick={() => { if (confirm("매도 기록 없이 이 종목을 내 종목에서 지울까요? (잘못 등록한 경우)")) doClose(sheet.p, sheet.s, 0, false); }}
              style={{ ...linkBtn, fontSize: FS.xs, color: C.muted, minHeight: 32 }}>잘못 등록한 종목이면 — 기록 없이 지우기</button>)}
        </div>
      </div>
    </div>);
  return (
    <>
      {Sheet()}{/* 함수로 불러야 입력 칸이 글자마다 다시 그려지지 않습니다 */}
      {FillSheet()}
      <BrokerTop brokerSync={brokerSync} stocks={stocks} />
      <PlanCard sizer={sizer} bumpSizer={bumpSizer} pos={pos} stocks={stocks} />
      {/* 사이징 — 전체 투자금이 없을 때만 계좌별로 직접 */}
      {!sizer.plan && <Card style={{ marginTop: 8, borderColor: `${C.gold}66` }}>
        <div style={{ fontSize: FS.sm, color: C.gold, fontWeight: 700 }}>💰 투자금을 아직 정하지 않았습니다</div>
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 4, lineHeight: 1.6 }}>
          위 💰 투자금에 계좌별 금액과 칸 수를 넣으면 종목당 한도(= 직투 금액 ÷ 칸 수)와 1회차 주수를 모든 탭에서 계산합니다. 정하기 전에는 주수를 보여 주지 않습니다.</div>
      </Card>}

      {autoNote && (     /* 228. 메리츠 체결을 자동으로 반영했다는 알림 */
        <div role="status" style={{ marginTop: 8, padding: "10px 12px", borderRadius: 12, background: "rgba(48,209,88,.10)", border: `1px solid ${C.emerald}66` }}>
          <div style={{ fontSize: FS.sm, fontWeight: 800, color: C.emerald }}>✓ {BK} 체결을 내 종목에 반영했습니다</div>
          <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 2, lineHeight: 1.5 }}>{autoNote.txt}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={() => setAutoNote(null)} style={{ ...btn(C.emerald), flex: 1, minHeight: 38 }}>확인</button>
            <button onClick={() => { setPos(autoNote.undo.pos); setTrades(autoNote.undo.trades); setAutoNote(null); }} style={{ ...btn(C.dim), flex: 1, minHeight: 38 }}>되돌리기</button>
          </div>
        </div>)}
      {(() => {   /* 메리츠(실계좌) 잔고에 없는 단기 종목 — 이미 팔았거나 잘못 들어간 기록. 메리츠가 기준이라 한 번에 정리 */
        const miss = brokerMiss;            // 234. App 이 계산 (잔고를 본 뒤에 산 종목은 빼지 않음)
        if (!miss.length) return null;
        return (
          <div role="alert" style={{ marginTop: 8, padding: "10px 12px", borderRadius: 12, background: "rgba(245,158,11,.10)", border: `1px solid ${C.gold}88` }}>
            <div style={{ fontSize: FS.sm, fontWeight: 800, color: C.gold }}>⚠ {BK} 잔고에 없는 단기 종목 {miss.length}개</div>
            <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 2, lineHeight: 1.5 }}>{miss.map(p => mktOfT(p.t) === "kr" ? (stocks[p.t]?.n || p.t) : p.t).join(" · ")} — 이미 팔았거나 잘못 들어간 기록입니다. 남아 있으면 칸 수·매도 알림·텔레그램이 틀어집니다.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={() => { if (!confirm(`${miss.map(p => p.t).join(", ")}\n\n${BK} 잔고에 없는 이 ${miss.length}종목을 매매 기록 없이 내 종목에서 뺄까요?`)) return;
                                       const ids = new Set(miss.map(p => p.id)); setPos(v => v.filter(p => !ids.has(p.id))); }}
                style={{ ...btn(C.gold), flex: 1, minHeight: 40 }}>{BK} 기준으로 정리 (기록 없이 빼기)</button>
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6 }}>실제로 팔아서 성적에 남기고 싶은 종목은 먼저 그 카드의 ×에서 매도가를 넣어 주세요</div>
          </div>);
      })()}
      {pendingN > 0 && (    /* 184. 증권사 체결이 내 종목에 아직 없음 */
        <button onClick={() => setFillOpen(true)} style={{ display: "block", width: "100%", textAlign: "left", marginTop: 8, padding: "10px 12px", borderRadius: 12, cursor: "pointer",
                 background: "rgba(245,158,11,.10)", border: `1px solid ${C.gold}66`, color: C.text }}>
          <div style={{ fontSize: FS.sm, fontWeight: 800, color: C.gold }}>{[fillPlan.reduce((a, x) => a + x.items.length, 0) && `${BK} 체결 ${fillPlan.reduce((a, x) => a + x.items.length, 0)}건`, fillPlan.some(x => x.extra.length) && `${BK}에만 있는 종목 ${fillPlan.reduce((a, x) => a + x.extra.length, 0)}`].filter(Boolean).join(" · ")} — 아직 내 종목에 없음</div>
          <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 2, ...ONE }}>{fillPlan.flatMap(x => [...x.items.map(i => `${x.m === "kr" ? (stocks[i.t]?.n || i.t) : i.t} ${i.side === "sell" ? "매도" : "매수"} ${i.qty}주`), ...x.extra.map(e => `${x.m === "kr" ? (e.n || e.t) : e.t} ${e.qty}주`)]).join(" · ")}</div>
          <div style={{ fontSize: FS.sm, color: C.gold, marginTop: 4, fontWeight: 700 }}>확인하고 반영하기 ›{kstDay() < AUTO_APPLY_FROM ? <span style={{ fontWeight: 400, color: C.muted, fontSize: FS.xs }}> · {md(AUTO_APPLY_FROM)}부터는 자동 반영 (그때까지는 이렇게 먼저 보여 드림)</span> : null}</div>
        </button>)}
      <Sec right={<button onClick={() => setForm(form ? null : { t: "", avg: "", role: "swing", k: "1" })} style={linkBtn}>{form ? "닫기" : "＋ 직접 추가"}</button>}>
        보유 {pos.length}
      </Sec>
      <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
        <Seg full value={tmk} onChange={setTmk} items={[["us", `🇺🇸 미국 ${nUs}`], ["kr", `🇰🇷 한국 ${nKr}`], ["all", "전체"]]} />
        <Seg value={role} onChange={setRole} items={[["all", "전체"], ["etf", "ETF"], ["swing", "단기"], ["long", "장기"]]} />
      </div>
      <HoldTotals pos={pos} stocks={stocks} fx={sizer.fx} only={tmk} />
      {(() => {   // 184. 증권사에 넣어 둔 매수 주문 중 아직 체결 안 된 것
        const w = fillPlan.filter(x => tmk === "all" || x.m === tmk).flatMap(x => x.waiting.filter(o => !pos.some(p => String(p.t).toUpperCase() === o.t)).map(o => ({ ...o, m: x.m })));
        return w.length ? <Card style={{ marginBottom: 8, borderColor: `${C.cyan}55`, padding: "8px 12px" }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: C.cyan }}>체결 대기 ({BK})</div>
          {w.map(o => <div key={o.odno} style={{ fontSize: FS.sm, marginTop: 3 }}><b style={{ fontFamily: o.m === "us" ? MONO : "inherit" }}>{o.m === "kr" ? (stocks[o.t]?.n || o.t) : o.t}</b> 지정가 {o.open}주 @ {price(o.px, o.m)} <span style={{ color: C.muted, fontSize: FS.xs }}>· 체결되면 위에서 1회차로 반영할지 묻습니다</span></div>)}
        </Card> : null; })()}
      {form && (
        <Card style={{ marginBottom: 8, display: "grid", gap: 8 }}>
          <input value={form.t} onChange={e => setForm({ ...form, t: e.target.value, err: null })} placeholder="티커 (AAPL / 005930)" style={inp("100%")} />
          <input value={form.avg} onChange={e => setForm({ ...form, avg: e.target.value, err: null })} placeholder="매수가 (평단)" inputMode="decimal" style={inp("100%")} />
          <Seg value={form.role} onChange={r => setForm({ ...form, role: r })} items={[["etf", "ETF"], ["swing", "단기"], ["long", "장기"]]} />
          {form.role === "swing" && <Seg value={form.k} onChange={k => setForm({ ...form, k })} items={[["1", "1회차만 산 상태"], ["2", "이미 전량"]]} />}
          <button onClick={submit} style={{ ...btn(C.emerald), width: "100%" }}>등록</button>
          {form.err && <span style={{ fontSize: FS.sm, color: C.red }}>{form.err}</span>}
        </Card>)}
      <WeekSched today={localToday} openStock={openStock} list={[
        ...pos.map(p => ({ s: stocks[p.t], tag: "보유" })),
        ...(() => { try { const P = pickToday(stocks, pickCfg(market, loadPlan()), new Set(pos.map(p => String(p.t).toUpperCase())));
                          return [...P.pickUs, ...(P.pickKr || [])].map(r => ({ s: stocks[r.t], tag: "오늘 살 것" })); } catch { return []; } })()]} />
      {rows.length === 0 ? <Card><Empty>보유가 없습니다 · 메리츠로 사면 이 탭을 열 때 자동으로 들어옵니다 (다른 곳에서 샀으면 ‘＋ 직접 추가’)</Empty></Card> :
        rows.map(p => ({ p, s: look(p.t) })).map(o => {          // 184. 급한 순서: 매도! → 2회차 → 나머지
          const { p, s } = o; if (!s) return { ...o, rank: 0 };
          const nx = p.role === "swing" ? nextTrancheOf(p, s, sizer.limit(s.m)) : null;
          const sell = actionOf(s, true) === "sell" && p.role !== "long";
          return { ...o, rank: sell ? 0 : (nx?.ok && roomFor(pos, sizer, s.m, nx.amt)) ? 1 : 2 };
        }).sort((a, b) => a.rank - b.rank).map(({ p, s }) => {
          if (!s) return (   // ★ 데이터가 없어도 들고 있는 종목은 사라지면 안 됩니다
            <Card key={p.id} style={{ marginBottom: 8, borderColor: "rgba(245,158,11,.6)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}><b style={{ fontFamily: MONO }}>{p.t}</b> <InfoLink s={{ t: p.t, m: /^\d{6}$/.test(p.t) ? "kr" : "us" }} /></div>
                  <div style={{ fontSize: FS.xs, color: C.gold, marginTop: 3 }}>⚠ 데이터 없음 — 거래정지·상장폐지·티커 변경 가능성. ↗ 네이버에서 상태를 확인하세요</div>
                  <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 2 }}>투입 {money(investedOf(p), /^\d{6}$/.test(p.t) ? "kr" : "us")} · 평단 {avgOf(p).toLocaleString()}</div>
                </div>
                <button onClick={() => closePos(p, null)} aria-label="매도 기록" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18, width: 32, height: 34 }}>×</button>
              </div>
            </Card>);
          const tr = trOf(p), avg = avgOf(p), inv = investedOf(p);
          const pl = (s.c / avg - 1) * 100;
          const [rl, rt] = RB[p.role] || RB.swing;
          const act = actionOf(s, true);
          const nxt = p.role === "swing" ? nextTrancheOf(p, s, sizer.limit(s.m)) : null;
          const isSell = act === "sell" && p.role !== "long";
          const kq = kisQty[String(p.t).toUpperCase()];
          const shApp = Math.round(tr.reduce((a, t) => a + (t.px > 0 ? (t.amt || 0) / t.px : 0), 0));
          const sh = shApp, shSell = kq?.qty || shApp;
          const missHere = brokerMiss.some(x => x.id === p.id);   // 235. 메리츠 잔고에 없음 — 팔기 버튼을 누르면 메리츠가 거절함
          const kisBtn = !!broker?.canOrder && !missHere;         // 주문이 열린 계좌일 때만 (보유 수량은 서버가 다시 확인)
          const when = (() => { const o = nextOpen(s.m === "kr"), md0 = o.label.split(" ")[0];     // 주말·휴장일이면 '오늘 밤'이 아니라 그 날짜
            return s.m === "us" ? `${o.d === kstDay() ? "오늘" : md0} 밤 ${usDST(Date.now()) ? "22:30" : "23:30"} 개장 때` : `${o.d === kstDay() ? "오늘" : md0} 09:30 이후`; })();
          const room = nxt?.ok ? roomFor(pos, sizer, s.m, nxt.amt) : false;
          const q2 = nxt ? Math.floor(nxt.amt / s.c) : 0;
          // 184. '다음 할 일' 한 줄 — 상태 하나 · 행동 하나
          const N = missHere ? { c: C.gold, k: `${BK}에 없음`, v: "정리 필요 — 이미 팔았거나 잘못 들어간 기록", sub: "오늘 할 일·칸 계산에서는 이미 뺐습니다 · 실제로 팔았으면 × 에서 매도가를 넣어 성적에 남길 수 있음" }
            : p.role === "long" ? { c: C.cyan, k: "장기", v: "장기 보유 — 앱 매도 규칙 적용 안 함", sub: "칸 수·매도! 알림에서 빠짐 · 손익 합계에는 들어감" }
            : isSell ? { c: C.red, k: "매도!", v: `${when} 전량 매도${sh ? ` · ${sh}주` : ""}`, sub: `${md(s.asOf)} 종가 ${price(s.c, s.m)} < 트레일링선 ${price(s.stLine, s.m)} · 미루지 않고 그날 처리 (원칙 3)`, act: "sell" }
            : nxt?.ok && room ? { c: C.emerald, k: "2회차", v: `${when} 2회차 ${q2 > 0 ? `${q2}주` : "1주"} · ~${price(s.c * 1.005, s.m)}`, sub: `1회차 대비 ${pct(nxt.gain, 1)} 마감 (조건 +3~6% · 트레일링선 위) · ${money(nxt.amt, s.m)}`, act: "t2" }
            : nxt?.ok ? { c: C.gold, k: "2회차 건너뜀", v: "투자금 한도를 넘어 2회차는 건너뜁니다", sub: `직투 ${money(budgetOf(sizer, s.m), s.m)} 중 ${money(investedIn(pos, s.m), s.m)} 투입 · 2회차 ${money(nxt.amt, s.m)}` }
            : nxt?.chase ? { c: C.gold, k: "기다리기", v: `2회차 추격 금지 — 1회차 대비 ${pct(nxt.gain, 1)}`, sub: `+6%를 넘었습니다. 눌렸다 +3~6% 안에 다시 들어오면 2회차 · ${price(s.stLine, s.m)} 아래로 마감하면 매도` }
            : nxt ? { c: C.muted, k: "다음 할 일", v: "없음 — 기다리기", sub: `${!nxt.after ? `산 뒤 첫 종가부터 판단 · ${price(nxt.target, s.m)}~${price(nxt.cap, s.m)}(+3~6%)로 마감하면 2회차` : `${price(nxt.target, s.m)} 위로 마감하면 2회차 (${nxt.pctToGo.toFixed(1)}% 남음${s.stSlow !== 1 ? " · 트레일링선 위여야" : ""})`} · ${s.stLine ? `${price(s.stLine, s.m)} 아래로 마감하면 매도` : "트레일링선 없음"}` }
            : { c: C.muted, k: "다음 할 일", v: "없음 — 기다리기", sub: s.stLine ? `${price(s.stLine, s.m)} 아래로 마감하면 매도 (선까지 ${lossTxt(s)})` : "트레일링선 없음" };
          return (
            <Card key={p.id} style={{ marginBottom: 8, borderColor: missHere ? `${C.gold}88` : isSell ? "rgba(255,69,58,.5)" : N.act === "t2" ? "rgba(48,209,88,.45)" : C.border }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div onClick={() => openStock(p.t)} style={{ flex: 1, minWidth: 0, cursor: "pointer", fontSize: 15, fontWeight: 700, ...ONE }}>
                  <Chip tone={rt}>{rl}</Chip> {s.m === "kr" ? <b>{s.n}</b> : <b style={{ fontFamily: MONO }}>{p.t}</b>} <span style={{ color: C.dim, fontWeight: 400, fontSize: FS.sm }}>{s.m === "kr" ? p.t : shortName(s.n)}</span></div>
                
                {kq && <span style={{ fontSize: 10.5, color: C.cyan, whiteSpace: "nowrap" }}>{kq.label || BK} {kq.qty}주</span>}
                {!kq && p.role !== "etf" && Object.values(brokerSync).some(k => k && k.env === "real" && k.mk === s.m && Array.isArray(k.rows)) &&
                  <span title="계좌 잔고에 없음 — 이미 팔았거나 다른 곳에서 산 종목" style={{ fontSize: 10.5, color: C.gold, whiteSpace: "nowrap" }}>{BK}에 없음</span>}
                <button onClick={() => closePos(p, s)} aria-label="매도 기록"
                  style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18, width: 32, height: 34, flexShrink: 0 }}>×</button>
              </div>
              {/* 다음 할 일 */}
              <div style={{ marginTop: 8, padding: "9px 11px", borderRadius: 10, background: `${N.c}17` }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: N.c }}>{N.k}{(s.halted || s.status) ? ` · ⚠ ${s.status || "거래정지"}` : ""}</div>
                <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2, lineHeight: 1.35 }}>{N.v}</div>
                {N.sub && <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 3, lineHeight: 1.55 }}>{N.sub}</div>}
              </div>
              {N.act && !missHere && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  {kisBtn && <button onClick={() => openOrder(N.act === "sell" ? { t: p.t, side: "sell", qty: shSell, held: shSell, m: s.m } : { t: p.t, side: "buy", qty: Math.max(1, q2), m: s.m, tranche2: true })}
                    style={{ ...btn(N.act === "sell" ? C.red : C.emerald), flex: 1, minHeight: 44 }}>{N.act === "sell" ? `${BK}로 팔기 ${shSell}주` : `${BK}로 2회차 사기`}</button>}
                  <button onClick={() => N.act === "sell" ? closePos(p, s) : addTranche(p, s)} style={{ ...btn(C.dim), flex: 1, minHeight: 44 }}>
                    {N.act === "sell" ? (kisBtn ? "다른 곳에서 팔았음" : "팔았음 — 매도가 기록") : (kisBtn ? "다른 곳에서 샀음" : "샀음 — 2회차 기록")}</button>
                </div>)}
              {/* 숫자 4칸 */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 6, marginTop: 9 }}>
                {[["평단 대비", pct(pl), col(pl)], ["지금", price(s.c, s.m)], ["평단", price(avg, s.m)], ["보유", sh ? `${sh}주` : money(inv, s.m)]].map(([k, v, c]) => (
                  <div key={k} style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: C.muted }}>{k}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, fontFamily: MONO, color: c || C.text, ...ONE }}>{v}</div>
                  </div>))}
              </div>
              {liveOf(s, live) && <div style={{ marginTop: 4 }}><LiveTag s={s} q={live} /></div>}
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6 }}>
                {p.role === "swing" ? <>{tr.length >= 2 ? "● ●" : "● ○"} {tr.map((t, i) => `${i + 1}회차 ${md(t.d)}`).join(" · ")}{tr.length < 2 ? " · 2회차 전" : ""}</> : `${md(tr[0].d)} 등록`} · 투입 {money(inv, s.m)}</div>
              <SchedLine s={s} today={localToday(s.m)} />
              {/* 자세히 — 선·초록 며칠·실적·목표가·고치기 */}
              <details style={{ marginTop: 4 }}>
                <summary style={{ fontSize: FS.xs, color: C.muted, cursor: "pointer", minHeight: 32, display: "flex", alignItems: "center" }}>
                  ▸ 자세히 — {s.stLine ? `선 ${price(s.stLine, s.m)} (${lossTxt(s)})` : "선 없음"}{s.slowDays != null ? ` · ${s.stSlow === 1 ? "초록" : "빨강"} ${s.slowDays}일` : ""}{earnTxt(s) ? ` · 📅 ${earnTxt(s)}` : ""}{s.short ? ` · 이력 부족(${s.short}일) — 200일선·RS 없음` : ""}</summary>
                <div style={{ fontSize: FS.xs, color: C.dim, lineHeight: 1.7, padding: "2px 0 4px" }}>
                  {p.role !== "long" ? <>트레일링선 {price(s.stLine, s.m)} · 선까지 {lossTxt(s)}{s.slowDays != null ? ` · 트레일링선 ${s.stSlow === 1 ? "위" : "아래"} ${s.slowDays}거래일째` : ""}</> : <>장기 관찰 · <DipTag s={s} /></>}
                  {earnTxt(s) && <><br /><b style={{ color: earnDays(s) <= 7 ? C.gold : C.dim }}>📅 {earnTxt(s)}</b></>}
                  {pastEarnTxt(s) && <><br />{pastEarnTxt(s)}</>}
                  {(() => { const tg = tgtOf(p.t, NOTES_REF.cur, s); const g = tg && tgtGap(tg.v, s.c);
                    return g == null ? null : <><br />{g <= 0 ? "🎯 " : ""}{tgtText(tg.mine ? "내 목표" : "애널 평균 목표", tg.v, s.c, s.m)}{g <= 0 ? " (매도 신호 아님)" : ""}</>; })()}
                  {!isSell && s.stLine && (
                    <div style={{ height: 6, borderRadius: 4, background: "rgba(255,255,255,.07)", marginTop: 6, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, (lossOf(s) ?? 0) * 4))}%`, background: `linear-gradient(90deg,${C.gold},${C.emerald})` }} />
                    </div>)}
                  <button onClick={() => setEdit(edit?.id === p.id ? null : { id: p.id, tr: tr.map(t => ({ ...t })) })}
                    style={{ ...linkBtn, fontSize: FS.xs, minHeight: 34, padding: 0, display: "block" }}>✏ 체결가·금액 고치기</button>
                  {/* 204. 단기 ↔ 장기 — 매도! 상태에서 장기로 바꾸면 한 번 묻고 기록 (3주 점검에 따로 나옴) */}
                  {(p.role === "swing" || p.role === "long") && <button onClick={() => {
                    const to = p.role === "swing" ? "long" : "swing";
                    if (to === "long" && isSell && !confirm(`${s.m === "kr" ? s.n : p.t} 은(는) 지금 매도! 상태입니다.\n장기로 바꾸면 매도 알림이 꺼지고 칸에서 빠집니다.\n규칙은 '매도를 미루지 않는다'입니다. 그래도 바꿀까요? (바꾼 기록은 3주 점검에 남습니다)`)) return;
                    if (to === "swing" && slotInfo(pos, mktOfT(p.t)).free <= 0 && !confirm("빈 칸이 없습니다. 단기로 바꾸면 칸이 넘칩니다. 그래도 바꿀까요?")) return;
                    setPos(v => v.map(x => x.id !== p.id ? x : { ...x, role: to, conv: [...(x.conv || []), { d: kstDay(), to, sell: to === "long" && isSell }].slice(-5) }));
                  }} style={{ ...linkBtn, fontSize: FS.xs, minHeight: 34, padding: 0, display: "block" }}>
                    {p.role === "swing" ? "⇄ 장기로 바꾸기 (앱 매도 규칙에서 뺌)" : "⇄ 단기로 바꾸기 (앱 매도 규칙 적용)"}</button>}
                  {(p.conv || []).length > 0 && <div style={{ fontSize: 10.5, color: C.muted }}>바꾼 기록: {p.conv.map(c => `${md(c.d)} ${c.to === "long" ? "장기로" : "단기로"}${c.sell ? "(매도! 중)" : ""}`).join(" · ")}</div>}
                </div>
              </details>
              {edit?.id === p.id && (   /* 104. 실제 체결가로 고치기 — 손익·2회차 기준(+3%)이 이 값으로 계산됩니다 */
                <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,.04)", display: "grid", gap: 6 }}>
                  <div style={{ fontSize: FS.xs, color: C.muted }}>실제 체결가와 넣은 금액으로 고치세요. 손익과 2회차 기준(1회차 +3%)이 이 값으로 계산됩니다.</div>
                  {edit.tr.map((t, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1.1fr) minmax(0,1fr) minmax(0,1fr)", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: FS.xs, color: C.dim }}>{i + 1}회차</span>
                      <input value={t.d} onChange={e => setEdit(o => ({ ...o, tr: o.tr.map((x, j) => j === i ? { ...x, d: e.target.value } : x) }))} placeholder="날짜" style={{ ...inp("100%"), padding: "6px 6px", fontSize: 13 }} />
                      <input type="number" inputMode="decimal" value={t.px} onChange={e => setEdit(o => ({ ...o, tr: o.tr.map((x, j) => j === i ? { ...x, px: e.target.value } : x) }))} placeholder="체결가" style={{ ...inp("100%"), padding: "6px 6px", fontSize: 13 }} />
                      <input type="number" inputMode="decimal" value={t.amt} onChange={e => setEdit(o => ({ ...o, tr: o.tr.map((x, j) => j === i ? { ...x, amt: e.target.value } : x) }))} placeholder="금액" style={{ ...inp("100%"), padding: "6px 6px", fontSize: 13 }} />
                    </div>))}
                  <div style={{ fontSize: 10.5, color: C.muted }}>칸: 회차 · 날짜 · 체결가 · 넣은 금액({s.m === "us" ? "달러" : "원"})</div>
                  {edit.err && <div style={{ fontSize: FS.xs, color: C.red }}>{edit.err}</div>}
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={saveEdit} style={{ ...btn(C.emerald), flex: 1 }}>저장</button>
                    <button onClick={() => setEdit(null)} style={{ ...btn(C.dim), flex: 1 }}>취소</button>
                  </div>
                </div>)}
            </Card>);
        })}

      <SyncBtn pos={pos} watch={watch} extras={extras} trades={trades} syncState={syncState} />
      <Sec right={<CopyBtn tickers={watch.filter(inMk)} />}>관심 {watch.filter(inMk).length}{tmk !== "all" ? ` · ${tmk === "us" ? "🇺🇸" : "🇰🇷"}` : ""}</Sec>
      <Card style={{ padding: "0 10px" }}>
        {watch.filter(inMk).length === 0 ? <Empty>종목 옆 ☆ 를 누르면 여기에 모입니다</Empty> :
          [...watch].filter(inMk).sort((a, b) => (mktOfT(a) === "us" ? 0 : 1) - (mktOfT(b) === "us" ? 0 : 1)).map(t => { const s = look(t); if (!s) return null;
            return <StockRow key={t} s={s} isWatch onToggle={toggleWatch} onOpen={openStock} rel={relOf(s, market)}
              held={pos.some(p => p.t === t)} sub={subLine(s, sizer, market)} />; })}
      </Card>
      <div style={{ fontSize: FS.xs, color: C.muted, margin: "10px 2px 0" }}>보유·관심은 서버에 저장돼 휴대폰·PC 어디서 열어도 같습니다 · 미국 보유는 메리츠 잔고 기준으로 자동으로 맞춥니다</div>
    </>
  );
}

/** 알림 연결 — 이 기기의 보유·관심을 서버에 올려 텔레그램 알림이 내 종목을 보게 합니다 */
export function SyncBtn({ pos, watch, extras = [], trades = [], syncState }) {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState(() => localStorage.getItem("v7.sync.at") || null);
  const run = async () => {
    setBusy(true); setMsg(null);
    try {
      askKeyAgain();      // 312. 직접 누른 것이니 암호를 다시 물어도 됨
      const { r, j } = await postWatch({ bulk: true, positions: pos, watch, extras, excludes: loadJSON("v10.excludes", []), trades: trades.slice(-300),
                               force: (pos.length === 0 && watch.length === 0) ? confirm("이 기기의 보유·관심이 비어 있습니다. 서버의 기록을 빈 목록으로 덮어쓸까요?") : undefined,
                               settings: { revMin: getRevMin(), slotsUs: loadPlan().slotsUs || SLOTS_DEFAULT.us, slotsKr: loadPlan().slotsKr || SLOTS_DEFAULT.kr,
                                           dcAmt: loadPlan().dcAmt || 0, dcMode: dcModeOf(), dcSemi: false,
                                           ...(planAmounts(loadPlan(), 1) ? { usAmt: loadPlan().usAmt || 0, krAmt: loadPlan().krAmt || 0 } : {}) } });
      if (j.ok) {
        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        localStorage.setItem("v7.sync.at", now); setAt(now);
        setMsg({ t: j.message || "저장됨" });
      } else setMsg({ t: j.error === "stale" ? "다른 기기에서 먼저 바뀐 기록이 있습니다 — 화면을 새로 고치면 고르는 창이 뜹니다" : (j.message || j.error || `실패 (${r.status})`), bad: true });
    } catch { setMsg({ t: "네트워크 오류", bad: true }); }
    setBusy(false);
  };
  return (
    <Card style={{ marginTop: 10 }}>
      <div style={{ fontSize: FS.sm, color: C.dim }}>
        <b style={{ color: syncState?.ok === false ? C.red : C.emerald }}>{syncState?.ok === false ? "⚠ 자동 연결 실패" : "🔔 자동 연결됨"}</b>
        {syncState?.at && <span style={{ color: C.muted }}> · 마지막 {syncState.at}</span>}
        {syncState?.ok === false && syncState?.msg && <span style={{ color: C.red }}> · {syncState.msg}</span>}
        <div style={{ marginTop: 3 }}>보유·관심·회차·설정을 바꾸면 3초 뒤 서버에 자동으로 올라가, 텔레그램·장중 감시가 같은 내용을 봅니다.</div>
      </div>
      <button onClick={run} disabled={busy} style={{ ...btn(C.cyan), width: "100%", marginTop: 8 }}>
        {busy ? "보내는 중…" : `지금 다시 보내기 (보유 ${pos.length} · 관심 ${watch.length}${extras.length ? ` · 추가 ${extras.length}` : ""})`}</button>
      {msg && <div style={{ fontSize: FS.xs, color: msg.bad ? C.red : C.emerald, marginTop: 5 }}>{msg.t}</div>}
      <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 4 }}>
        {"자동 연결이 실패했을 때만 누르면 됩니다"}
      </div>
    </Card>
  );
}

/* ══════════════ 68·69. 보유 합계 — 시장별 (달러는 달러, 원은 원) ══════════════ */
export function holdSums(pos, stocks) {
  const out = { us: { inv: 0, val: 0, n: 0, risk: 0, rn: 0, sell: 0 }, kr: { inv: 0, val: 0, n: 0, risk: 0, rn: 0, sell: 0 } };
  for (const p of pos || []) {
    if (p.role === "etf") continue;
    const m = mktOfT(p.t), s = stocks[p.t], v = valueOf(p, s);
    out[m].inv += investedOf(p); out[m].val += v; out[m].n += 1;
    // 92. 위험 합계 — 선으로 파는 종목(장기 제외)이 전부 트레일링선에 닿으면 잃는 금액. 이미 선 아래(매도!)는 따로 셈
    if (p.role !== "long" && s?.stLine && s?.c) {
      if (s.stSlow === 1) { out[m].risk += v * Math.max(0, 1 - s.stLine / s.c); out[m].rn += 1; }
      else if (s.stSlow === 0) out[m].sell += 1;
    }
  }
  return out;
}
export function HoldTotals({ pos, stocks, fx, only = "all" }) {
  const t = holdSums(pos, stocks);
  const parts = [["us", "🇺🇸"], ["kr", "🇰🇷"]].filter(([m]) => t[m].n > 0 && (only === "all" || only === m));
  if (!parts.length) return null;
  return (
    <div style={{ display: "grid", gap: 4, margin: "0 0 8px", padding: "8px 10px", borderRadius: 9, background: "rgba(255,255,255,.03)" }}>
      {parts.map(([m, f]) => { const x = t[m]; const pl = x.inv ? (x.val / x.inv - 1) * 100 : 0;
        return (
          <div key={m} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: FS.sm }}>
            <b>{f} {x.n}종목</b>
            <span style={{ color: C.muted }}>투입 <b style={{ color: C.text, fontFamily: MONO }}>{money(x.inv, m)}</b> → 평가 <b style={{ color: C.text, fontFamily: MONO }}>{money(x.val, m)}</b></span>
            <b style={{ marginLeft: "auto", fontFamily: MONO, color: col(pl) }}>{pct(pl, 1)}</b>
          </div>); })}
      {parts.map(([m, f]) => { const x = t[m]; if (!x.rn && !x.sell) return null;     // 92. 위험 합계
        return (
          <div key={"r" + m} style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: FS.xs, color: C.dim, flexWrap: "wrap" }}>
            <span>{f} 전부 선에 닿으면</span>
            <b style={{ fontFamily: MONO, color: C.red }}>-{money(x.risk, m)}</b>
            <span>(평가의 -{x.val ? (x.risk / x.val * 100).toFixed(1) : "0"}%)</span>
            {x.sell > 0 && <b style={{ color: C.red }}>· 매도! {x.sell}개 따로</b>}
          </div>); })}
      {only === "all" && parts.length === 2 && fx && (() => {
        const inv = t.kr.inv + t.us.inv * fx, val = t.kr.val + t.us.val * fx, pl = inv ? (val / inv - 1) * 100 : 0;
        return <div style={{ display: "flex", gap: 8, fontSize: FS.xs, color: C.dim, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>
          합계(원화 환산) <b style={{ fontFamily: MONO, color: C.text }}>{money(val, "kr")}</b><b style={{ marginLeft: "auto", fontFamily: MONO, color: col(pl) }}>{pct(pl, 1)}</b></div>; })()}
      <div style={{ fontSize: 10, color: C.muted }}>평가 = 앱의 마지막 종가 기준 · ETF 제외 · "선에 닿으면" = 장기 보유 제외 · 갭 하락이면 더 잃을 수 있음</div>
    </div>);
}

/* ══════════════ 💰 전체 투자금 ══════════════ */
export function PlanCard({ sizer, bumpSizer, pos, stocks }) {
  const [p, setP] = useState(loadPlan);
  const [open, setOpen] = useState(() => !planAmounts(loadPlan(), 1));
  const save = (np) => {
    const pa = planAmounts(np, sizer.fx); const d = kstDay();
    const hist = pa ? [...(np.hist || []).filter(h => h.d !== d), { d, total: Math.round(pa.total) }].slice(-60) : (np.hist || []);
    const out = { ...np, hist }; delete out.usKrwOld;
    setP(out); localStorage.setItem(PLAN_KEY, JSON.stringify(out)); bumpSizer?.(); settingsChanged();
  };
  const set = (k, v) => save({ ...p, [k]: v });
  const pa = planAmounts(p, sizer.fx);
  const invKr = (pos || []).filter(x => /^\d{6}$/.test(x.t) && x.role !== "etf").reduce((a, x) => a + investedOf(x), 0);
  const invUs = (pos || []).filter(x => !/^\d{6}$/.test(x.t) && x.role !== "etf").reduce((a, x) => a + investedOf(x), 0);
  const Row = ({ k, label, unit, m, sub }) => (
    <label style={{ display: "grid", gridTemplateColumns: "70px minmax(0,1fr) 40px", gap: 8, alignItems: "center", padding: "5px 0" }}>
      <span style={{ fontSize: FS.sm, fontWeight: 700 }}>{label}</span>
      <div style={{ minWidth: 0 }}>
        <input type="number" inputMode="numeric" value={p[k] || ""} placeholder={unit === "$" ? "달러" : "원"}
          onChange={e => set(k, Math.max(0, Number(e.target.value) || 0))} style={{ ...inp("100%"), padding: "7px 8px", fontSize: 15 }} />
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2, ...ONE }}>{p[k] ? money(p[k], m) : "—"}{sub ? ` · ${sub}` : ""}</div>
      </div>
      <span style={{ fontSize: FS.sm, fontFamily: MONO, color: C.dim, textAlign: "right" }}>{pa ? `${pa.pct[k.replace("Amt", "")]}%` : ""}</span>
    </label>);
  return (
    <Card style={{ marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: FS.md, fontWeight: 800 }}>💰 투자금</span>
        <span style={{ fontSize: 17, fontWeight: 800, fontFamily: MONO, marginLeft: "auto" }}>{pa ? money(pa.total, "kr") : "미설정"}</span>
        <button onClick={() => setOpen(v => !v)} style={{ ...linkBtn, minHeight: 32, fontSize: FS.xs }}>{open ? "닫기" : "수정"}</button>
      </div>
      {pa && !open && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", marginTop: 8, textAlign: "center" }}>
          {[["🏦 DC", money(pa.dc, "kr"), `${pa.pct.dc}%`], ["🇺🇸 직투", money(pa.us, "us"), `${p.slotsUs}칸 · ${money(pa.limUs, "us")}`],
            ["🇰🇷 직투", money(pa.kr, "kr"), `${p.slotsKr}칸 · ${money(pa.limKr, "kr")}`], ["💤 남는 돈", money(pa.cash, "kr"), `${pa.pct.cash}%`]].map(([l, v, sub], i) => (
            <div key={l} style={{ borderLeft: i ? `1px solid ${C.border}` : "none", minWidth: 0, padding: "0 2px" }}>
              <div style={{ fontSize: 10.5, color: C.dim }}>{l}</div>
              <div style={{ fontSize: 13.5, fontWeight: 800, fontFamily: MONO, ...ONE }}>{v}</div>
              <div style={{ fontSize: 10, color: C.muted, ...ONE }}>{sub}</div>
            </div>))}
        </div>)}
      {pa && !open && (invKr > 0 || invUs > 0) && (
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 6 }}>
          지금 투입 중 — 🇺🇸 {money(invUs, "us")}{pa.us ? ` (${Math.round(invUs / pa.us * 100)}%)` : ""} · 🇰🇷 {money(invKr, "kr")}{pa.kr ? ` (${Math.round(invKr / pa.kr * 100)}%)` : ""}</div>)}
      {open && (
        <div style={{ marginTop: 6 }}>
          <Row k="dcAmt" label="🏦 DC" unit="원" m="kr" sub={dcModeOf() === "hold" ? "3지수 보유" : "느린 ST"} />
          <Row k="usAmt" label="🇺🇸 직투" unit="$" m="us" sub={sizer.fx && p.usAmt ? `≈ ${money(p.usAmt * sizer.fx, "kr")} (환율 ${sizer.fx.toFixed(0)})` : "달러로 입력"} />
          <Row k="krAmt" label="🇰🇷 직투" unit="원" m="kr" sub="강세·눌림" />
          <Row k="cashAmt" label="💤 남는 돈" unit="원" m="kr" sub="예금·예비금" />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 4px", borderTop: `1px solid ${C.border}`, marginTop: 4 }}>
            <b>합계</b><b style={{ fontFamily: MONO }}>{pa ? money(pa.total, "kr") : "—"}</b></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8, marginTop: 6 }}>
            {[["slotsUs", "🇺🇸 칸 수", pa ? `칸당 ${money(pa.limUs, "us")}` : ""], ["slotsKr", "🇰🇷 칸 수", pa ? `칸당 ${money(pa.limKr, "kr")}` : ""]].map(([k, l, sub]) => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: FS.sm, color: C.dim, flexShrink: 0 }}>{l}</span>
                <input type="number" inputMode="numeric" value={p[k]} onChange={e => set(k, Math.max(1, Number(e.target.value) || 1))} style={{ ...inp("100%"), width: 52, padding: "6px 4px", textAlign: "right" }} />
                <span style={{ fontSize: 10.5, color: C.muted, ...ONE }}>{sub}</span>
              </label>))}
          </div>
          <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>
            계좌별 금액을 넣으면 합계와 비율은 자동입니다. DC 탭 총액 · 원화/달러 자본 · 종목당 한도(= 직투 금액 ÷ 칸 수)가 모든 탭에 반영됩니다.
            1회차는 칸당 금액의 절반. 금액을 바꾼 날짜와 합계는 기록됩니다. 아이들 적립 계좌는 넣지 않습니다.
          </div>
          <button onClick={() => setOpen(false)} disabled={!pa} style={{ ...btn(C.emerald), width: "100%", marginTop: 8, opacity: pa ? 1 : .4 }}>저장</button>
        </div>)}
    </Card>);
}
