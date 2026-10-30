/**
 * 210 · 217 · 218 — 주문 창 하나 (매수 · 매도)
 * ════════════════════════════════════════════════════════════
 * 어디서 누르든(오늘 탭 · 차트 · 내 종목 카드 · 계좌 카드) 이 창 하나가 그 자리에서 아래에서 올라옵니다.
 *   열 때: 계좌(/api/broker)에서 지금 가격을 받고, 앱 데이터가 최신인지 바로 확인(app-data-check)
 *   수량: − / + · 빠른 선택(1회차 · 1주 · 보유 전부) · 직접 입력
 *   지정가: 매수 = 지금 가격 +0.5% · 매도 = 지금 가격 −0.5% (고칠 수 있음)
 *   검사(오늘 매수 제안과 같은 기준):
 *     막음 — 주문 꺼짐 · 정규장 밖 매수 · 매수 지정가가 지금 +1.5% 초과 / 매도 −3% 미만 · 1건 상한 초과 · 지금 가격 확인 안 됨
 *     빨간 경고(체크해야 보냄) — 시장 급락(−2%↓) · 종목 −5%↓ · +4%↑ 추격 · 손절선 아래 · 앱 신호가 매수!/매도! 아님 · 이미 보유 중
 *     안내 — 개장 직후 5분 · 실적 발표 가까움
 *   보내면: 결과를 보여 주고 'broker-changed' 를 알림 → 계좌 카드가 주문 내역을 다시 불러옴
 * 여는 법: import { openOrder } from "./order.js";  openOrder({ t, side: "buy"|"sell", qty, m: "us"|"kr" })
 */
import React, { useEffect, useMemo, useState } from "react";
import { nextOpen } from "./order.js";

const K = { panel: "#0F1420", panel2: "#161B2E", border: "rgba(255,255,255,.09)", text: "#E5E7EB", dim: "#9CA3AF", gold: "#F59E0B", up: "#30D158", down: "#FF453A", cyan: "#06B6D4" };
const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";
const TOK = "v7.kis.tok", PIN = "v7.kis.pin";
const G = { mktDown: -2, stDown: -5, stUp: 4, slip: 0.5, buyBand: 1.5, sellBand: 3 };   // 계좌 카드(src/Kis.jsx GUARD) · 서버(api/_lib/meritz.js)와 같은 숫자
const EX = { NMS: "NASD", NGM: "NASD", NCM: "NASD", NYQ: "NYSE", ASE: "AMEX", PCX: "AMEX", BTS: "AMEX" };
const IDX = { us: [["QQQ", "나스닥100"], ["SPY", "S&P500"]], kr: [["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]] };
const ls = { get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } }, set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} } };
const tickKr = (p) => p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000;
const upTick = (v) => { const t = tickKr(v); return Math.ceil(v / t) * t; };
const downTick = (v) => { const t = tickKr(v); return Math.floor(v / t) * t; };
const rid = () => { try { return crypto.randomUUID(); } catch { return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); } };
const pct = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v || 0).toFixed(1)}%`;
const md = (d) => d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : "—";

/** 지금 정규장인가 · 개장 직후 5분인가 (그 시장 현지 시각 · 주말만 거름) */
function session(KR) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: KR ? "Asia/Seoul" : "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  const wk = p.weekday !== "Sat" && p.weekday !== "Sun", m = +p.hour * 60 + +p.minute, o = KR ? 540 : 570, c = KR ? 930 : 960;
  return { open: wk && m >= o && m < c, early: wk && m >= o && m < o + 5 };
}

export default function OrderSheet({ req, stocks = {}, pos = [], half = {}, onClose }) {
  const KR = req.m === "kr" || /^\d{6}$/.test(String(req.t || ""));
  const mk = KR ? "kr" : "us";
  const t = String(req.t || "").toUpperCase();
  const s = stocks[t] || null;
  const M = (v, d = 2) => KR ? `${Math.round(Number(v) || 0).toLocaleString("ko-KR")}원` : "$" + Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

  const [side, setSide] = useState(req.side === "sell" ? "sell" : "buy");
  const [info, setInfo] = useState(null);
  const [pin, setPin] = useState(() => ls.get(PIN));
  const [needPin, setNeedPin] = useState(false);
  const [q, setQ] = useState(null), [idx, setIdx] = useState({}), [qAt, setQAt] = useState(0);
  const [qty, setQty] = useState(req.qty ? String(req.qty) : "");
  const [px, setPx] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [done, setDone] = useState(null), [warnOk, setWarnOk] = useState(null);

  const tokKey = `${TOK}.${info?.broker || "x"}`;
  const call = async (body) => {
    const r = await fetch("/api/broker", { method: "POST", headers: { "Content-Type": "application/json", "x-kis-pin": pin || "" },
      body: JSON.stringify({ ...body, ...(KR ? { mk: "kr" } : {}), tok: ls.get(tokKey) }) });
    const j = await r.json();
    if (j.tok) ls.set(tokKey, j.tok);
    if (j.code === "pin") { setNeedPin(true); ls.set(PIN, ""); } else if (j.ok) { setNeedPin(false); ls.set(PIN, pin); }
    return j;
  };
  const loadQuote = async (sd = side) => {
    setBusy("quote"); setMsg("");
    try {
      const j = await call({ what: "quote", idx: sd === "buy", list: [{ t, ex: KR ? "KRX" : EX[s?.ex] || "" }] });
      if (!j.ok) { setMsg(j.msg || "지금 가격을 받지 못했습니다"); setBusy(""); return; }
      const qq = j.quotes?.[t] || null;
      setQ(qq); setIdx(j.idx || {}); setQAt(Date.now());
      if (qq?.last > 0 && !req.px) {
        const raw = sd === "buy" ? qq.last * (1 + G.slip / 100) : qq.last * (1 - G.slip / 100);
        setPx(String(KR ? (sd === "buy" ? upTick(raw) : downTick(raw)) : (sd === "buy" ? Math.ceil(raw * 100) / 100 : Math.floor(raw * 100) / 100)));
      }
      if (!qty && qq?.last > 0) {
        const h = Number(half?.[mk]) || 0;
        setQty(String(sd === "buy" ? Math.max(1, Math.floor(h / qq.last) || 1) : 1));
      }
    } catch { setMsg("연결하지 못했습니다 — 잠시 뒤 다시"); }
    setBusy("");
  };

  useEffect(() => {
    try { window.dispatchEvent(new Event("app-data-check")); } catch {}      // 218. 앱 데이터가 최신인지 바로 확인
    fetch("/api/broker").then((r) => r.json()).then((j) => setInfo(j && j.ok ? j : { configured: false })).catch(() => setInfo({ configured: false }));
    if (req.px) setPx(String(req.px));
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc);
  }, []);                                                                       // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (info?.configured && pin && !needPin) loadQuote(); }, [info]);   // eslint-disable-line react-hooks/exhaustive-deps
  const flip = (sd) => { if (sd === side) return; setSide(sd); setAck(false); setPx(""); setQty(sd === "sell" && heldQty ? String(heldQty) : qty); if (info?.configured && pin) loadQuote(sd); };

  const sess = session(KR);
  const last = q?.last || 0;
  const base = s?.c || q?.base || 0;
  const ch = last > 0 && base > 0 ? (last / base - 1) * 100 : null;
  const line = s?.stSlow === 1 ? s?.stLine : null;
  const nQty = Math.floor(Number(qty) || 0), nPx = KR ? Math.round(Number(px) || 0) : Math.round((Number(px) || 0) * 100) / 100;
  const amount = nQty * nPx;
  const cap1 = KR ? (info?.maxKrw || 0) : (info?.maxUsd || 0);
  const held = (pos || []).find((p) => String(p.t).toUpperCase() === t);
  const heldQty = req.held || null;
  const idxR = IDX[mk].map(([k, l]) => [l, idx?.[k]?.rate]).filter(([, v]) => typeof v === "number");
  const halt = side === "buy" && idxR.length > 0 && Math.min(...idxR.map(([, v]) => v)) <= G.mktDown;
  const stale = qAt && Date.now() - qAt > 120000;
  const halfAmt = Number(half?.[mk]) || 0;

  // 189. 장이 닫혀 있을 때 매도 = 다음 개장 때 매도 예약 (🇺🇸 장 시작 시장가 MOO · 🇰🇷 다음 영업일 시작 시장가)
  const resvMode = side === "sell" && !sess.open;
  const nxo = resvMode ? nextOpen(KR) : null;                                                   // 223. 언제 나가는지
  // 막음 (넘어갈 수 없음)
  const block = !info ? "불러오는 중…"
    : !info.configured ? "계좌가 연결되어 있지 않습니다"
    : !info.canOrder ? "주문이 꺼져 있습니다 (조회 전용)"
    : !pin || needPin ? "앱 비밀번호를 넣어 주세요"
    : resvMode ? (!(nQty >= 1) ? "수량은 1주 이상" : heldQty && nQty > heldQty ? `보유 ${heldQty}주보다 많습니다` : "")
    : !(last > 0) ? (busy ? "지금 가격 받는 중…" : "지금 가격을 확인하지 못했습니다 — 다시 보기")
    : side === "buy" && !sess.open ? (KR ? "한국 정규장(09:00~15:30)에만 매수합니다" : "미국 정규장에만 매수합니다 — 장 밖 주문은 보내지 않음")
    : !(nQty >= 1) ? "수량은 1주 이상"
    : !(nPx > 0) ? "지정가를 넣어 주세요"
    : KR && nPx % tickKr(nPx) !== 0 ? `호가 단위 ${tickKr(nPx).toLocaleString("ko-KR")}원에 맞춰 주세요`
    : side === "buy" && nPx > last * (1 + G.buyBand / 100) ? `지정가가 지금 가격보다 ${G.buyBand}% 넘게 높습니다 (최대 ${M(last * (1 + G.buyBand / 100))})`
    : side === "sell" && nPx < last * (1 - G.sellBand / 100) ? `지정가가 지금 가격보다 ${G.sellBand}% 넘게 낮습니다`
    : cap1 && amount > cap1 ? `1건 상한 ${M(cap1, 0)}을 넘습니다`
    : stale ? "가격을 본 지 2분이 넘었습니다 — 다시 보기"
    : "";
  // 빨간 경고 (알고도 하려면 체크)
  const warns = [];
  if (side === "buy") {
    if (halt) warns.push(`시장 급락 중 — ${idxR.map(([l, v]) => `${l} ${pct(v)}`).join(" · ")} (기준 ${G.mktDown}%)`);
    if (s && s.action !== "buy") warns.push(`앱 신호가 매수!가 아닙니다 (지금: ${s.action === "sell" ? "매도!" : "관망"} · ${md(s.asOf)} 종가 기준)`);
    if (!s) warns.push("앱 종목풀에 없는 종목입니다 — 신호를 확인할 수 없음");
    if (line && last > 0 && last <= line) warns.push(`지금 가격이 손절선 ${M(line)} 아래 — 신호가 깨졌습니다`);
    if (ch != null && ch <= G.stDown) warns.push(`기준 종가보다 ${pct(ch)} — 급락 중`);
    if (ch != null && ch >= G.stUp) warns.push(`기준 종가보다 ${pct(ch)} — 이미 많이 올라 추격`);
    if (held && !req.tranche2) warns.push("이미 보유 중인 종목입니다 — 2회차인지 확인");
  } else {
    if (s && s.action !== "sell") warns.push(`앱 신호는 매도!가 아닙니다 (지금: ${s.action === "buy" ? "매수!" : "들고 있기"} · 손절선 ${line ? M(line) : "—"}) — 규칙보다 일찍 파는 것`);
  }
  const notes = [];
  if (sess.early) notes.push("개장 직후 5분 — 가격이 크게 흔들리는 시간입니다. 몇 분 뒤가 안전합니다");
  if (side === "buy" && s?.earn) { const d = Math.round((Date.parse(s.earn) - Date.now()) / 864e5); if (d >= 0 && d <= 3) notes.push(`실적 발표 ${d === 0 ? "오늘" : `D-${d}`} — 발표 전후 크게 움직일 수 있음`); }
  const needAck = warns.length > 0;
  const canSend = !block && !busy && (!needAck || ack);

  /** 221. 보낸 뒤 상태 확인 — 2·5·10초 뒤 주문 내역에서 이 주문번호를 찾아 접수/체결/거부를 보여 줌 */
  const watch = async (odno) => {
    for (const wait of [2000, 3000, 5000]) {
      await new Promise((r) => setTimeout(r, wait));
      try {
        const o = await call({ what: "orders" });
        const x = (o.orders || []).find((y) => y.odno === odno) || (o.orders || []).find((y) => y.t === t && !y.orgn);
        if (!x) continue;
        const st = /거부|거절/.test(x.state || "") ? "거부" : x.filled >= x.qty && x.qty > 0 ? "체결" : x.filled > 0 ? "일부 체결" : x.open > 0 ? "접수 — 대기 중" : x.state || "확인 중";
        setDone((d) => d && { ...d, st, fpx: x.fpx || 0, filled: x.filled || 0 });
        // 228. 다 체결되면 내 종목에 바로 반영 (내 종목 탭을 열기 전에도 오늘 탭 칸 수·'살 것'이 맞도록)
        if (st === "체결" && info?.env === "real") { try { window.dispatchEvent(new CustomEvent("order-filled", { detail: { odno: x.odno, dt: x.dt, side: x.side, t: x.t, n: x.n, filled: x.filled, fpx: x.fpx, px: x.px, mk } })); } catch {} }
        if (st === "체결" || st === "거부") break;
      } catch { /* 다음에 */ }
    }
    setDone((d) => d && { ...d, st: d.st || "확인 못 함 — 메리츠 카드 '최근 주문'에서 확인", checked: true });
  };
  const send = async () => {
    if (!canSend) return;
    if (t !== String(req.t || "").toUpperCase()) { setMsg("주문 창 종목이 바뀌었습니다 — 닫고 다시 열어 주세요"); return; }   // 222. 연 종목 = 보내는 종목
    setBusy("send"); setMsg("");
    if (resvMode) {                                                                            // 189. 다음 개장 때 매도 예약
      try {
        const j = await call({ what: "resv", t, qty: nQty, rid: rid(), confirm: true, ...(warnOk ? { warnOk: true } : {}) });
        if (!j.ok && j.code === "warn" && j.warn && !warnOk) { setWarnOk(j.warn); setBusy(""); return; }
        if (!j.ok) { setMsg(j.msg || "예약이 거절되었습니다"); setBusy(""); return; }
        setDone({ resv: true, side, qty: nQty, no: j.reserved?.no || "", how: nxo?.label ? `${nxo.label} 시장가` : (j.reserved?.how || "다음 개장 때"), st: "예약 접수 — 장이 열리면 나감" });
        try { window.dispatchEvent(new Event("broker-changed")); } catch {}
      } catch { setMsg("연결이 끊겼습니다 — 다시 보내기 전에 메리츠 앱 '예약주문' 화면을 먼저 확인하세요 (중복 예약 주의)"); }
      setBusy(""); return;
    }
    try {
      const body = { what: "order", side, t, ex: KR ? "KRX" : (q?.ex || EX[s?.ex] || "NASD"), qty: nQty, px: nPx, rid: rid(), confirm: true, ...(warnOk ? { warnOk: true } : {}) };
      const j = await call(body);
      if (!j.ok && j.code === "warn" && j.warn && !warnOk) { setWarnOk(j.warn); setBusy(""); return; }
      if (!j.ok) { setMsg(j.code === "unsure" ? `${j.msg || "응답을 못 받았습니다"} — 다시 보내기 전에 계좌 카드의 주문 내역을 먼저 확인하세요` : (j.msg || "주문이 거절되었습니다")); setBusy(""); return; }
      setDone({ odno: j.placed?.odno || "", side, qty: nQty, px: nPx, st: "접수 — 상태 확인 중…" });
      try { window.dispatchEvent(new Event("broker-changed")); } catch {}
      watch(j.placed?.odno || "");
    } catch { setMsg("연결이 끊겼습니다 — 다시 보내기 전에 계좌 카드의 주문 내역을 먼저 확인하세요"); }
    setBusy("");
  };

  const btn = { font: "inherit", fontSize: 14, fontWeight: 700, minHeight: 44, padding: "6px 14px", borderRadius: 10, cursor: "pointer", background: "transparent", color: K.text, border: `1px solid ${K.border}`, boxSizing: "border-box" };
  const inp = { minHeight: 44, padding: "6px 10px", borderRadius: 10, border: `1px solid ${K.border}`, background: "#0A0E1A", color: K.text, font: "inherit", fontSize: 16, minWidth: 0, width: "100%", fontFamily: MONO, boxSizing: "border-box" };
  const step = (d) => setQty(String(Math.max(1, (Math.floor(Number(qty) || 0)) + d)));
  const BK = info?.label || "계좌";
  const sideC = side === "buy" ? K.up : K.down;
  const half1 = last > 0 && halfAmt > 0 ? Math.max(1, Math.floor(Math.min(halfAmt, cap1 || halfAmt) / last)) : null;

  return (
    <div role="dialog" aria-modal="true" aria-label="주문" onClick={onClose}
         style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 560, maxHeight: "92vh", overflowY: "auto", background: K.panel2, color: K.text, borderRadius: "16px 16px 0 0",
                                                         borderTop: `2px solid ${needAck && !done ? K.down : sideC}`, padding: "14px 16px calc(18px + env(safe-area-inset-bottom))", fontSize: 13 }}>
        {/* 머리 — 매수/매도 · 종목 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {["buy", "sell"].map((k) => (
            <button key={k} type="button" onClick={() => flip(k)} disabled={!!done}
              style={{ ...btn, minHeight: 36, padding: "2px 14px", color: side === k ? (k === "buy" ? K.up : K.down) : K.dim, borderColor: side === k ? (k === "buy" ? K.up : K.down) : K.border }}>{k === "buy" ? "매수" : "매도"}</button>))}
          <span style={{ marginLeft: "auto", fontSize: 11, color: info?.env === "real" ? K.gold : K.dim }}>{BK} · {info?.env === "real" ? "실전 · 실제 돈" : info ? "모의" : ""}</span>
          <button type="button" onClick={onClose} aria-label="닫기" style={{ ...btn, minHeight: 36, padding: "0 10px" }}>✕</button>
        </div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
          <b style={{ fontSize: 20, fontFamily: KR ? "inherit" : MONO }}>{KR ? (s?.n || t) : t}</b>
          <span style={{ color: K.dim }}>{KR ? t : s?.n || ""}</span>
        </div>
        <div style={{ color: K.dim, fontSize: 12, marginTop: 2 }}>
          신호 기준 <b style={{ color: K.text }}>{md(s?.asOf)} 종가</b> {s ? M(s.c) : ""}{s ? ` · 지금 앱 신호 ${s.action === "buy" ? "매수!" : s.action === "sell" ? "매도!" : "관망"}` : ""}{line ? ` · 손절선 ${M(line)}` : ""}
        </div>

        {(!pin || needPin) && info?.configured && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="앱 비밀번호" autoComplete="off" style={{ ...inp, fontFamily: "inherit" }} />
            <button type="button" onClick={() => loadQuote()} style={{ ...btn, borderColor: K.gold }}>확인</button>
          </div>)}

        {/* 지금 가격 */}
        <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 10, background: "rgba(255,255,255,.04)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: K.dim }}>{BK} 지금</span>
          <b style={{ fontFamily: MONO, fontSize: 16 }}>{last > 0 ? M(last) : "—"}</b>
          {ch != null && <span style={{ fontFamily: MONO, color: ch >= 0 ? K.up : K.down }}>{pct(ch)}</span>}
          {ch != null && <span style={{ color: K.dim, fontSize: 11 }}>기준 종가 대비</span>}
          <button type="button" onClick={() => loadQuote()} disabled={!!busy || !info?.configured} style={{ ...btn, minHeight: 32, padding: "0 10px", fontSize: 12, marginLeft: "auto", color: stale ? K.gold : K.dim }}>
            {busy === "quote" ? "받는 중…" : "가격 다시 보기"}</button>
          {side === "buy" && idxR.length > 0 && <div style={{ width: "100%", fontSize: 11, color: halt ? K.down : K.dim }}>시장 {idxR.map(([l, v]) => `${l} ${pct(v)}`).join(" · ")}</div>}
        </div>

        {/* 수량 · 지정가 */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 10, marginTop: 10 }}>
          <label style={{ display: "grid", gap: 4, color: K.dim, fontSize: 12 }}>수량 (주)
            <div style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr) 44px", gap: 4 }}>
              <button type="button" onClick={() => step(-1)} style={{ ...btn, padding: 0 }} aria-label="수량 줄이기">−</button>
              <input value={qty} inputMode="numeric" onChange={(e) => setQty(e.target.value.replace(/\D/g, "").slice(0, 7))} style={{ ...inp, textAlign: "center" }} aria-label="수량" />
              <button type="button" onClick={() => step(1)} style={{ ...btn, padding: 0 }} aria-label="수량 늘리기">＋</button>
            </div>
          </label>
          {resvMode
            ? <div style={{ display: "grid", gap: 4, color: K.dim, fontSize: 12 }}>가격
                <div style={{ ...inp, display: "flex", alignItems: "center", fontFamily: "inherit", fontSize: 13, color: K.text }}>{KR ? "다음 영업일 시작 시장가" : "장 시작 시장가 (MOO)"}</div></div>
            : <label style={{ display: "grid", gap: 4, color: K.dim, fontSize: 12 }}>지정가 ({KR ? "원" : "$"})
                <input value={px} inputMode="decimal" onChange={(e) => setPx(e.target.value.replace(/[^0-9.]/g, ""))} style={inp} aria-label="지정가" />
              </label>}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {side === "buy" && half1 && <button type="button" onClick={() => setQty(String(half1))} style={{ ...btn, minHeight: 32, padding: "0 10px", fontSize: 12 }}>1회차 {half1}주</button>}
          <button type="button" onClick={() => setQty("1")} style={{ ...btn, minHeight: 32, padding: "0 10px", fontSize: 12 }}>1주</button>
          {side === "sell" && heldQty && <button type="button" onClick={() => setQty(String(heldQty))} style={{ ...btn, minHeight: 32, padding: "0 10px", fontSize: 12 }}>보유 전부 {heldQty}주</button>}
          {last > 0 && !resvMode && <button type="button" onClick={() => { const raw = side === "buy" ? last * (1 + G.slip / 100) : last * (1 - G.slip / 100);
              setPx(String(KR ? (side === "buy" ? upTick(raw) : downTick(raw)) : (side === "buy" ? Math.ceil(raw * 100) / 100 : Math.floor(raw * 100) / 100))); }}
            style={{ ...btn, minHeight: 32, padding: "0 10px", fontSize: 12 }}>지정가 = 지금 {side === "buy" ? "+" : "−"}{G.slip}%</button>}
        </div>
        {resvMode ? (
          <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 10, background: "rgba(6,182,212,.08)", border: `1px solid ${K.cyan}66`, fontSize: 12, lineHeight: 1.6 }}>
            <b style={{ color: K.cyan }}>지금은 장이 닫혀 있어 예약으로 보냅니다 — {nxo?.label} 시장가로 매도</b><br />
            규칙(종가가 선 아래 → 다음 장 시작에 판다) 그대로입니다. 갭 하락이면 그만큼 낮게 팔릴 수 있습니다.
            확인·취소는 {BK} 앱 '예약주문' 화면에서 합니다.
          </div>) : <>
        <div style={{ marginTop: 8, fontFamily: MONO, fontSize: 14 }}>
          {nQty >= 1 && nPx > 0 ? <>= <b>{M(amount)}</b>{cap1 ? <span style={{ color: amount > cap1 ? K.down : K.dim, fontSize: 12, fontFamily: "inherit" }}> · 1건 상한 {M(cap1, 0)}</span> : null}</> : <span style={{ color: K.dim, fontFamily: "inherit" }}>수량과 지정가를 넣어 주세요</span>}
        </div>
        <div style={{ color: K.dim, fontSize: 11, marginTop: 2, lineHeight: 1.5 }}>
          지정가 = {side === "buy" ? "이 값보다 비싸게는 안 삼" : "이 값보다 싸게는 안 팖"}. 지금 가격이 더 {side === "buy" ? "싸면 그 값에" : "비싸면 그 값에"} 체결되고, 안 닿으면 대기로 남았다가 장이 끝나면 사라집니다.
        </div></>}

        {/* 경고 · 안내 */}
        {needAck && !done && (
          <div role="alert" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(255,69,58,.12)", border: `1px solid ${K.down}` }}>
            <b style={{ color: K.down }}>⚠ 확인이 필요합니다</b>
            {warns.map((w) => <div key={w} style={{ marginTop: 4, lineHeight: 1.5 }}>· {w}</div>)}
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontWeight: 700, cursor: "pointer", minHeight: 36 }}>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ width: 20, height: 20 }} />
              위 내용을 알고도 {side === "buy" ? "삽니다" : "팝니다"}
            </label>
          </div>)}
        {notes.length > 0 && !done && <div style={{ marginTop: 8, color: K.gold, fontSize: 12, lineHeight: 1.5 }}>{notes.map((n) => <div key={n}>ⓘ {n}</div>)}</div>}
        {warnOk && !done && <div style={{ marginTop: 8, color: K.gold, lineHeight: 1.5 }}>{BK} 경고: {warnOk} — 읽고 괜찮으면 한 번 더 보내 주세요</div>}
        {msg && <div role="alert" style={{ marginTop: 8, color: K.down, lineHeight: 1.5 }}>⚠ {msg}</div>}

        {/* 보내기 / 결과 */}
        {done ? (
          <div role="status" style={{ marginTop: 12, padding: "12px", borderRadius: 10, background: "rgba(48,209,88,.10)", border: `1px solid ${K.up}`, lineHeight: 1.6 }}>
            {done.resv ? <>
              <b style={{ color: K.up }}>✓ 매도 예약을 접수했습니다</b> — {t} {done.qty}주 · {done.how}{done.no ? ` · 예약번호 ${done.no}` : ""}
              <div style={{ color: K.dim, fontSize: 12 }}>장이 열리면 주문이 나갑니다. 확인·취소는 {BK} 앱 '예약주문' 화면에서 합니다. 팔리면 다음에 내 종목 탭을 열 때 자동으로 정리됩니다.</div>
            </> : <>
              <b style={{ color: K.up }}>✓ {done.side === "buy" ? "매수" : "매도"} 주문을 보냈습니다</b> — {t} {done.qty}주 × {M(done.px)}{done.odno ? ` · 주문번호 ${done.odno}` : ""}
              {/* 221. 지금 상태 */}
              <div style={{ marginTop: 6, fontSize: 15, fontWeight: 800, color: done.st === "체결" ? K.up : done.st === "거부" ? K.down : K.gold }}>
                상태: {done.st}{done.st === "체결" && done.fpx ? ` · 체결가 ${M(done.fpx)}` : ""}</div>
              <div style={{ color: K.dim, fontSize: 12 }}>
                {done.st === "체결" ? (info?.env === "real" ? "실제 체결가로 내 종목에 바로 반영했습니다." : "내 종목 맨 위 '체결 반영'에서 넣습니다(모의).")
                  : done.st === "거부" ? `${BK}가 거부했습니다 — ${BK} 앱에서 사유를 확인하세요.`
                  : `지정가에 안 닿으면 대기로 남았다가 장이 끝나면 사라집니다. 내 종목 → ${BK} 카드 '최근 주문'에서 취소할 수 있습니다.`}</div>
            </>}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {(done.st === "체결" || done.resv) && <button type="button" onClick={() => { try { window.dispatchEvent(new Event("go-track")); } catch {} onClose(); }} style={{ ...btn, flex: 1, borderColor: K.up }}>내 종목으로</button>}
              <button type="button" onClick={onClose} style={{ ...btn, flex: 1, borderColor: K.up }}>닫기</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ marginTop: 12, color: block ? K.gold : K.dim, fontSize: 12, minHeight: 18 }}>{block || (needAck && !ack ? "빨간 상자를 확인하고 체크하면 보낼 수 있습니다" : "")}</div>
            <button type="button" onClick={send} disabled={!canSend}
              style={{ ...btn, width: "100%", marginTop: 6, minHeight: 50, fontSize: 16, color: "#111", background: canSend ? (needAck ? K.down : sideC) : "rgba(255,255,255,.12)", borderColor: "transparent" }}>
              {busy === "send" ? "보내는 중…" : warnOk ? "경고 확인 — 다시 보내기"
                : resvMode ? `${KR ? (s?.n || t) : t} 다음 개장 때 매도 예약 · ${nQty || 0}주`
                : `${KR ? (s?.n || t) : t} ${side === "buy" ? "매수" : "매도"} 보내기${nQty >= 1 && nPx > 0 ? ` · ${nQty}주 ${M(amount, 0)}` : ""}`}</button>
            <div style={{ color: K.dim, fontSize: 11, marginTop: 6, textAlign: "center" }}>{info?.env === "real" ? "실제 계좌에서 실제 돈으로 주문됩니다 · " : ""}같은 주문은 한 번만 전송됩니다</div>
          </>)}
      </div>
    </div>);
}
