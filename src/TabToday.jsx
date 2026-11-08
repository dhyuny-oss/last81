/* 264. Today 탭 — 이 탭만 쓰는 화면 (App.jsx 에서 자동으로 나눔 · 다른 탭과 같이 쓰는 건 core.jsx) */
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import MKT_CAL from "../config/market.json";
import RULES from "./rules.js";
import { pickToday, SLOTS_DEFAULT, KR_GATE_WHY, US_GATE_WHY, SEC_FULL_WHY, SEC_CAP } from "./picks.js";
import { planFills, applyFills } from "./fills.js";
import {
  ComposedChart, Line, Area, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot,
} from "recharts";
import { openOrder, nextOpen } from "./order.js";
import { useResv, resvOf, resvDay, resvCall, RESV_ST } from "./resv.js";
import { AboutCard, AboutLine, SchedLine, WeekSched, pastEarnTxt } from "./Info.jsx";
import { AppPerf, C, Card, FS, LiveTag, MONO, ONE, SPARE_TXT, Step, US_GATE_TXT, actionOf, avgOf, btn, col, dcModeOf, earnTxt, getRevMin, krGateOf, linkBtn, liveOf, loadPlan, marketState, mktOfT, money, nextTrancheOf, passRevOf, pct, pickCfg, price, roomFor, shortName, slotInfo, usDST, usGateOf, useBroker, useLive } from "./core.jsx";




/* ══════════════ 거래 시간표 + 내 원칙 ══════════════
   거래시간 출처: KRX 정규 09:00~15:30(종가단일가 15:20~), KRX 애프터마켓 16:00~20:00(2026-09-14 신설·ETF 제외),
   NXT 프리 08:00~08:50 · 메인 09:00:30~15:20 · 애프터 15:40~20:00 (지정가만).
   미국은 서머타임 여부로 1시간 이동합니다.                                    */
export const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export function sessions(nowMs) {
  const dst = usDST(nowMs);
  const u = (m) => (m + (dst ? 0 : 60)) % 1440;      // 겨울시간이면 1시간 뒤로
  return {
    kr: [
      ["NXT 프리마켓", 8 * 60, 8 * 60 + 50, "지정가만"],
      ["KRX 정규장", 9 * 60, 15 * 60 + 30, "15:20~ 종가 단일가"],
      ["NXT 애프터", 15 * 60 + 40, 20 * 60, "지정가만"],
      ["KRX 애프터", 16 * 60, 20 * 60, "ETF 제외"],
    ],
    us: [
      ["프리마켓", u(17 * 60), u(22 * 60 + 30), ""],
      ["정규장", u(22 * 60 + 30), u(5 * 60), "핵심"],
      ["애프터", u(5 * 60), u(9 * 60), ""],
    ],
    dst,
  };
}
export const inSpan = (mins, a, b) => (a <= b ? mins >= a && mins < b : mins >= a || mins < b);

export function HoursCard({ nowMs }) {
  const kst = new Date(nowMs + 9 * 3600000);
  const dow = kst.getUTCDay(), mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const wd = dow >= 1 && dow <= 5;
  const S = sessions(nowMs);
  const _ms = marketState(nowMs);
  const Row = ({ list, flag, label }) => (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: FS.sm, fontWeight: 700, marginBottom: 4 }}>{flag} {label}</div>
      {list.map(([n, a, b, note]) => {
        const on = wd && inSpan(mins, a, b) && !(flag === "🇰🇷" ? _ms.krHol : _ms.usHol);
        return (
          <div key={n} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 6, alignItems: "center",
                                padding: "5px 7px", borderRadius: 7, marginBottom: 3,
                                background: on ? "rgba(48,209,88,.12)" : "rgba(255,255,255,.03)" }}>
            <span style={{ fontSize: FS.xs, color: on ? C.emerald : C.dim, ...ONE }}>
              {on && "● "}{n}{note ? <span style={{ color: C.muted }}> · {note}</span> : null}
            </span>
            <span style={{ fontSize: FS.xs, fontFamily: MONO, color: on ? C.emerald : C.muted }}>{hhmm(a)}~{hhmm(b)}</span>
          </div>);
      })}
    </div>
  );
  return (
    <Card style={{ marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: FS.md, fontWeight: 800 }}>거래 시간 (KST)</span>
        <span style={{ marginLeft: "auto", fontSize: FS.xs, color: C.muted }}>지금 {hhmm(mins)}{wd ? "" : " · 휴장일"}</span>
      </div>
      <Row list={S.kr} flag="🇰🇷" label={_ms.krHol ? `한국 · ${_ms.krLabel}` : "한국"} />
      <Row list={S.us} flag="🇺🇸" label={`미국 (${S.dst ? "서머타임" : "겨울시간"})`} />
      <div style={{ marginTop: 9, padding: "8px 10px", borderRadius: 8, background: "rgba(6,182,212,.07)", fontSize: FS.xs, color: C.dim, lineHeight: 1.7 }}>
        <b style={{ color: C.text }}>내 매매 시각</b><br />
        아침 <b>07:30</b> 확인 → 그날 밤 <b>{hhmm(S.dst ? 22 * 60 + 30 : 23 * 60 + 30)}</b> 미국 개장 주문<br />
        밤 <b>21:30</b> 확인 → 다음 거래일 <b>09:30 이후</b> 한국 주문 (9시 반 전에 사지 않기)<br />
        매도 신호는 미루지 말고 당일 처리 · 데이터 갱신 16:17 / 06:23
      </div>
    </Card>
  );
}

/** 244. 오늘 탭 '내 종목' 한 줄 — 자세한 건 내 종목 탭 (예전 6번 표를 한 줄로) */
export function HoldLine({ pos, stocks, sizer, setTab }) {
  const ps = (pos || []).filter(p => p.role !== "etf").sort((a, b) => (mktOfT(a.t) === "us" ? 0 : 1) - (mktOfT(b.t) === "us" ? 0 : 1));
  const parts = ps.map(p => { const s = stocks[p.t], m = mktOfT(p.t); if (!s) return { t: p.t, txt: `${p.t} 데이터 없음`, c: C.gold, o: 0 };
    const pl = (s.c / avgOf(p) - 1) * 100, sell = actionOf(s, true) === "sell" && p.role !== "long";
    const nx = p.role === "swing" ? nextTrancheOf(p, s, sizer.limit(m)) : null;
    return { t: p.t, txt: `${m === "kr" ? s.n : p.t} ${pct(pl, 1)}${sell ? " 매도!" : nx?.ok ? " 2회차" : ""}`, c: sell ? C.red : col(pl), o: sell ? 0 : nx?.ok ? 1 : 2 }; })
    .sort((a, b) => a.o - b.o);
  return (
    <button onClick={() => setTab("track")} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", marginTop: 8, padding: "10px 12px", borderRadius: 12,
                                                   background: C.panel, border: `1px solid ${C.border}`, color: C.text, cursor: "pointer", minHeight: 44 }}>
      <b style={{ fontSize: FS.sm, flexShrink: 0 }}>📂 내 종목 {ps.length}</b>
      <span style={{ flex: 1, minWidth: 0, fontSize: FS.xs, ...ONE }}>
        {ps.length ? parts.map((x, i) => <span key={x.t}>{i ? " · " : ""}<span style={{ color: x.c, fontFamily: MONO }}>{x.txt}</span></span>)
                   : <span style={{ color: C.muted }}>없음 — 메리츠로 사면 자동으로 들어옵니다</span>}</span>
      <span style={{ color: C.muted, flexShrink: 0 }}>›</span>
    </button>);
}

/** 244. 오늘 탭 '시장' 한 줄 — 새로 사도 되는지만. 자세한 건 찾기 › 🌐 시장 (245) */
export function MarketLine({ market, setTab }) {
  const ju = market.judge?.us, jk = market.judge?.kr, vix = market.risk?.["^VIX"]?.c;
  const usG = usGateOf(market), krG = krGateOf(market);
  const go = () => { try { sessionStorage.setItem("v8.find", "market"); } catch {} setTab("find"); };
  const Tag = ({ ok, children }) => <b style={{ color: ok ? C.emerald : C.red, fontWeight: 700 }}>{children}</b>;
  return (
    <button onClick={go} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", marginTop: 8, padding: "10px 12px", borderRadius: 12,
                                  background: C.panel, border: `1px solid ${usG || krG ? C.red + "55" : C.border}`, color: C.text, cursor: "pointer", minHeight: 44 }}>
      <b style={{ fontSize: FS.sm, flexShrink: 0 }}>🌐 시장</b>
      <span style={{ flex: 1, minWidth: 0, fontSize: FS.xs, lineHeight: 1.5 }}>
        🇺🇸 {(ju?.blocked ?? ju?.nqGate) == null ? <span style={{ color: C.muted }}>나스닥100 다음 수집 때 판단</span>
          : <><Tag ok={!usG}>{usG ? "새로 사지 않음" : "새로 사기 가능"}</Tag><span style={{ color: C.muted }}> (나스닥100 200일선 {pct(ju.nq200, 1)})</span></>}
        {" · "}🇰🇷 <Tag ok={!krG}>{krG ? "새로 사지 않음" : "새로 사기 가능"}</Tag>
        <span style={{ color: C.muted }}> (폭 3년 하위 {jk?.breadthPct ?? "—"}%)</span>
        {vix != null && <span style={{ color: vix >= 30 ? C.red : vix >= 22 ? C.gold : C.muted }}> · VIX {Number(vix).toFixed(0)}</span>}
      </span>
      <span style={{ color: C.muted, flexShrink: 0 }}>›</span>
    </button>);
}

export function MarketTab({ market, setTab, onShowRules, list, pos, stocks, items, sizer, openStock, brokerMiss = [] }) {
  const [hoursOpen, setHoursOpen] = useState(false);
  const sectors = market.sectors || [];
  const krGate = krGateOf(market), usGate = usGateOf(market);
  const resv = useResv();                                                                        // 249. 매수 예약
  // 오늘 할 일 — 순서가 곧 루틴: ① 내 종목 매도 신호 ② 2회차 ③ 새로 살 것(종목까지 여기서) ④ DC
  // 183. 할 일에 종목 이름을 바로 — 숫자만 보고 내 종목 탭까지 들어가지 않게
  const nm = (t) => mktOfT(t) === "kr" ? (stocks[t]?.n || t) : t;
  const sellL = (pos || []).filter(p => p.role !== "long" && stocks[p.t]?.action === "sell");
  const t2L = (pos || []).map(p => { if (p.role !== "swing") return null; const m = mktOfT(p.t), s = stocks[p.t];
    const nx = nextTrancheOf(p, s, sizer.limit(m)); return nx?.ok && roomFor(pos, sizer, m, nx.amt) ? { p, m, q: s?.c ? Math.max(1, Math.floor(nx.amt / s.c)) : null } : null; }).filter(Boolean);
  const sellN = sellL.length, t2N = t2L.length;
  const revMin = getRevMin();
  const buyL = list.filter(x => x.action === "buy" && (x.tvr ?? 0) >= RULES.tvrMin).filter(x => passRevOf(x, revMin));
  const heldT = new Set((pos || []).map(p => p.t));
  const buyN = buyL.filter(x => !heldT.has(x.t)).length;   // 132. 보유 종목은 '새 신호' 수에서 뺌 (찾기 탭과 같은 수)
  // 109. 오늘 실제로 살 수 있는 수 = 추천(찾기 탭 '오늘 살 것'과 같은 함수) 중 빈 칸만큼 · 투자금 0원인 시장은 0 · 176·252. 시장 게이트면 0
  const secRank = Object.fromEntries(sectors.map(x => [x.tk, [x.rank, x.label]]));
  const todo3 = (() => {
    const plan = loadPlan(), pa = sizer?.plan;
    const held = new Set((pos || []).map(p => String(p.t).toUpperCase()));
    const P = pickToday(stocks || {}, pickCfg(market, plan), held, { secRank });
    const one = (m, picks) => { const sl = slotInfo(pos, m); const z = !pa || !((m === "us" ? pa.us : pa.kr) > 0);
      const can = z ? 0 : Math.min(sl.free, picks.length);
      return { ...sl, z, can, buy: picks.slice(0, can), wait: z ? [] : picks.slice(can) }; };
    return { us: one("us", P.pickUs), kr: one("kr", P.pickKr), P };
  })();
  const canBuy = todo3.us.can + todo3.kr.can;
  const liveT = useLive([...todo3.us.buy, ...todo3.kr.buy].map(r => (stocks || {})[r.t]));      // 202. 지금 가격 (표시 전용)
  const liveIdx = useLive([{ t: "QQQ", m: "us" }, { t: "SPY", m: "us" }]);                     // 217. 미국 시장 지금 (장 전후 포함)
  const usHalt = (() => {
    const r = [["나스닥100", "QQQ"], ["S&P500", "SPY"]].map(([l, k]) => { const v = liveIdx[k]; return v && v.p > 0 && v.pc > 0 && Date.now() / 1000 - v.t < 3600 ? [l, (v.p / v.pc - 1) * 100, v.s] : null; }).filter(Boolean);
    if (!r.length || Math.min(...r.map(x => x[1])) > -2) return null;
    return { txt: r.map(([l, v]) => `${l} ${v >= 0 ? "+" : ""}${v.toFixed(1)}%`).join(" · "), when: r[0][2] === "pre" ? "프리마켓" : r[0][2] === "post" ? "애프터" : "지금" };
  })();
  const brokerT = useBroker();                                                                   // 210. 오늘 살 것 → 바로 사기
  const gatedOf = (m) => (m === "kr" && krGate) || (m === "us" && usGate);
  const gateTxt = (m) => m === "us" ? US_GATE_TXT : "시장 위험 — 새로 사지 않음";
  const slotNote = [["us", "🇺🇸"], ["kr", "🇰🇷"]].map(([m, f]) => todo3[m].z ? `${f} 투자금 0` : gatedOf(m) ? `${f} ${gateTxt(m)}` : todo3[m].held > todo3[m].n ? `${f} ⚠ 칸보다 많이 보유 ${todo3[m].held}/${todo3[m].n} — 기록 확인` : `${f} 빈 칸 ${todo3[m].free}/${todo3[m].n}`).join(" · ");   // 237
  const dcWait = (market.dc?.core || []).filter(c => c.state === "wait").length;
  // 99. DC 탭에서 고른 규칙으로 말함 (182: 3지수 보유면 1월 첫 거래일에만 할 일)
  const dcHold3 = dcModeOf() === "hold";
  const dcSell = (() => { try { const dn = JSON.parse(localStorage.getItem("v6.dc.done") || "{}");   // 285. 신호 빨강인데 보유 기록이 남은 몫
    return (market.dc?.core || []).filter(c => c.state === "wait" && (dn[c.key] || []).length > 0).map(c => c.label.replace(/^(미국|한국) /, "")); } catch { return []; } })();
  const S = sessions(Date.now());
  const kst = new Date(Date.now() + 9 * 3600000), mins = kst.getUTCHours() * 60 + kst.getUTCMinutes(), wd = kst.getUTCDay() >= 1 && kst.getUTCDay() <= 5;
  const nowSeg = wd && ([...S.kr.map(x => ["🇰🇷 " + x[0], x[1], x[2]]), ...S.us.map(x => ["🇺🇸 " + x[0], x[1], x[2]])].find(([, a, b]) => inSpan(mins, a, b)) || null);
  const head = [sellN && `매도 ${sellN}건`, t2N && `2회차 ${t2N}건`, canBuy && `새로 ${canBuy}종목`].filter(Boolean);
  const ms = marketState();
  const Num = ({ n, c }) => <span style={{ width: 22, height: 22, borderRadius: 11, background: `${c}22`, color: c, fontSize: FS.xs, fontWeight: 800, display: "grid", placeItems: "center", flexShrink: 0 }}>{n}</span>;
  const TodoRow = ([n, t, sub, to, c]) => (
    <button key={n} onClick={() => setTab(to)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
            background: "none", border: "none", borderTop: `1px solid ${C.border}`, padding: "10px 0", cursor: "pointer", color: C.text }}>
      <Num n={n} c={c} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: FS.md, fontWeight: 700, ...ONE }}>{t}</div>
        <div style={{ fontSize: FS.xs, color: C.muted }}>{sub}</div>
      </span>
      <span style={{ color: C.muted }}>›</span>
    </button>);
  // ③ 오늘 살 것 — 예전 5번을 할 일 안으로 (244). 장이 닫혀 있으면 '예약'(249)
  const BuyBlock = () => (
    <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 0 6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Num n="3" c={canBuy > 0 ? C.emerald : C.muted} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: FS.md, fontWeight: 700, ...ONE }}>{canBuy > 0 ? `오늘 살 것 ${canBuy}개 (🇺🇸 ${todo3.us.can} · 🇰🇷 ${todo3.kr.can})` : "새로 살 것 없음"}</div>
          <div style={{ fontSize: FS.xs, color: C.muted }}>{slotNote}{canBuy === 0 && buyN > 0 ? ` · 매수! 신호 ${buyN}건은 참고` : ""}</div>
        </span>
      </div>
      {[["us", "🇺🇸 미국"], ["kr", "🇰🇷 한국"]].map(([m, name]) => {
        const T = todo3[m], gated = gatedOf(m);
        if (!T.buy.length && !T.wait.length && !(gated && m === "us")) return null;   // 살 것·대기가 없는 시장은 위 한 줄로 충분
        const openNow = m === "us" ? ms.usRegular : ms.krRegular;
        return (
          <div key={m} style={{ margin: "8px 0 0 32px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", padding: "2px 0 2px" }}>
              <b style={{ fontSize: FS.sm }}>{name} {T.can}</b>
              <span style={{ fontSize: FS.xs, color: gated ? C.red : C.muted }}>
                {T.z ? "투자금 0 — 쉬는 중" : gated ? gateTxt(m) : `빈 칸 ${T.free}/${T.n}`}
                {!T.z && !gated && sizer?.limit ? ` · 1회차 ${money(sizer.limit(m) / 2, m)}` : ""}</span>
            </div>
            {T.buy.map(r => {
              const sh = sizer?.shares(r.c, r.m), rv = resvOf(resv.items, r.t);
              return (
                <div key={r.t} onClick={() => openStock(r.t)} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "1px 8px", padding: "8px 0", borderTop: `1px solid ${C.border}`, cursor: "pointer" }}>
                  <span style={{ minWidth: 0, fontSize: 14, ...ONE }}>{m === "kr" ? <b>{r.n}</b> : <><b style={{ fontFamily: MONO }}>{r.t}</b> <span style={{ fontSize: FS.xs, color: C.dim }}>{shortName(r.n)}</span></>}</span>
                  <b style={{ fontFamily: MONO, fontSize: FS.md, textAlign: "right" }}>{price(r.c, r.m)}</b>
                  <span style={{ fontSize: 10.5, color: C.muted, minWidth: 0, ...ONE }}>
                    {earnTxt(r, 7) && <b style={{ color: C.gold }}>📅 {earnTxt(r, 7)} · </b>}{r.secRank ? `${r.secLabel} ${r.secRank}위 · ` : ""}강도 {r.str ?? "—"} · 선까지 {r.loss != null ? `−${r.loss.toFixed(0)}%` : "—"}{r.growth != null ? ` · 매출 ${r.growth >= 0 ? "+" : ""}${r.growth.toFixed(0)}%` : ""}</span>
                  {rv ? <button onClick={e => { e.stopPropagation(); setTab("track"); }} style={{ ...btn(C.cyan), minHeight: 30, padding: "0 10px", fontSize: FS.xs, justifySelf: "end" }}>⏰ {resvDay(rv.day)} 예약됨</button>
                    : brokerT?.canOrder && !gated && !T.z
                    ? <button onClick={e => { e.stopPropagation(); openOrder({ t: r.t, side: "buy", qty: sh > 0 ? sh : 1, m: r.m }); }}
                        style={{ ...btn(usHalt && m === "us" ? C.red : openNow ? C.emerald : C.cyan), minHeight: 30, padding: "0 12px", fontSize: FS.xs, justifySelf: "end" }}>{usHalt && m === "us" ? "⚠ 사기" : openNow ? "사기" : "예약"}</button>
                    : <span style={{ fontSize: 10.5, color: C.emerald, textAlign: "right", fontWeight: 700 }}>{sh > 0 ? "살 것" : "1주 한 번에"}</span>}
                  <AboutLine s={r} style={{ gridColumn: "1 / -1", fontSize: 10.5, color: C.muted }} />
                  {liveOf(stocks?.[r.t], liveT) && <span style={{ gridColumn: "1 / -1" }}><LiveTag s={stocks[r.t]} q={liveT} /></span>}
                </div>);
            })}
            {T.wait.length > 0 && <div style={{ fontSize: 10.5, color: C.muted, padding: "6px 0 2px", borderTop: `1px solid ${C.border}` }}>
              대기(칸이 비면 이 순서): {T.wait.map(r => m === "kr" ? r.n : r.t).join(" · ")}</div>}
            {gated && <div style={{ fontSize: 10.5, color: C.muted, padding: "2px 0" }}>가진 종목은 트레일링선대로 · 2회차는 그대로 · {SPARE_TXT[m]} · 근거는 아래 🌐 시장</div>}
          </div>);
      })}
      {canBuy > 0 && !ms.usRegular && !ms.krRegular && brokerT?.canOrder &&
        <div style={{ fontSize: 10.5, color: C.muted, margin: "6px 0 0 32px", lineHeight: 1.5 }}>⏰ 예약 = 장이 열린 뒤 서버가 시장 −2%·트레일링선·+3% 추격을 다시 보고 지정가로 삼 (하루만 유효)</div>}
      <button onClick={() => setTab("find")} style={{ ...linkBtn, fontSize: FS.xs, minHeight: 34, margin: "4px 0 0 32px" }}>찾기 탭에서 자세히 ›</button>
    </div>);
  return (
    <>
      {sizer?.plan && (
        <div onClick={() => setTab("track")} style={{ marginTop: 8, padding: "8px 12px", borderRadius: 10, background: C.panel, border: `1px solid ${C.border}`,
                                                       display: "flex", gap: 10, alignItems: "baseline", cursor: "pointer", fontSize: FS.xs, color: C.dim, ...ONE }}>
          <b style={{ fontSize: FS.md, color: C.text, fontFamily: MONO }}>💰 {money(sizer.plan.total, "kr")}</b>
          <span>DC {money(sizer.plan.dc, "kr")}</span><span>🇺🇸 {sizer.plan.us != null ? money(sizer.plan.us, "us") : "—"}</span>
          <span>🇰🇷 {money(sizer.plan.kr, "kr")}</span><span>대기 {money(sizer.plan.cash, "kr")}</span>
        </div>)}

      {/* 오늘 할 일 — 244. 오늘 탭은 할 일만 (시장·위험·섹터는 찾기 › 🌐 시장) */}
      <Step q="오늘 뭘 하지?">오늘 할 일</Step>
      <Card style={{ padding: "4px 12px" }}>
        <div style={{ padding: "9px 0 7px", fontSize: FS.lg, fontWeight: 800 }}>
          {head.length ? head.join(" + ") : "오늘은 할 일이 없습니다"}
          {!sellN && head.length > 0 && <span style={{ fontSize: FS.xs, color: C.muted, fontWeight: 400 }}> · 팔 것 없음</span>}</div>
        {/* 217. 미국 시장 급락(지금) — 오늘 살 것보다 먼저 봄 */}
        {usHalt && <div role="alert" style={{ margin: "0 0 8px", padding: "8px 10px", borderRadius: 9, background: "rgba(255,69,58,.14)", border: `2px solid ${C.red}` }}>
          <b style={{ color: C.red }}>⚠ 미국 시장 급락 중 — 매수 보류</b>
          <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 2 }}>{usHalt.txt} ({usHalt.when} · 기준 −2%) · 매도는 그대로</div></div>}
        {brokerMiss.length > 0 && <button onClick={() => setTab("track")} style={{ display: "block", width: "100%", textAlign: "left", margin: "0 0 8px", padding: "8px 10px", borderRadius: 9, cursor: "pointer",
                                          background: "rgba(245,158,11,.10)", border: `2px solid ${C.gold}`, color: C.text }}>
          <b style={{ color: C.gold, fontSize: FS.sm }}>⚠ 메리츠 잔고에 없는 종목 {brokerMiss.length}개 — 먼저 정리</b>
          <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 2 }}>{brokerMiss.map(p => nm(p.t)).join(" · ")} · 이미 팔았거나 잘못 들어간 기록이라 아래 할 일·칸 계산에서는 뺐습니다. 내 종목 맨 위에서 한 번에 정리 ›</div></button>}
        <AppPerf market={market} compact onOpen={() => setTab("review")} />
        {TodoRow(["1", sellN ? `매도! ${sellL.map(p => nm(p.t)).join(" · ")}` : "매도! 0건", sellN ? "트레일링선 아래 마감 — 개장 때 전량 매도 · 미루지 않기" : "없음", "track", sellN ? C.red : C.muted])}
        {TodoRow(["2", t2N ? `2회차 ${t2L.map(x => nm(x.p.t)).join(" · ")}` : "2회차 0건", t2N ? `1회차 +3~6% 마감 — 나머지 절반 · ${t2L.map(x => `${nm(x.p.t)} ${x.q ?? "—"}주`).join(" · ")}` : "없음", "track", t2N ? C.emerald : C.muted])}
        <BuyBlock />
        {TodoRow(dcHold3 ? ["4", "DC 그대로 보유", "3지수 보유 · 1년에 한 번(1월 첫 거래일) 비중만 맞춤", "alloc", C.dim]
                 : dcSell.length ? ["4", `DC 매도 필요 — ${dcSell.join("·")}`, "신호가 빨강인데 보유 기록이 남아 있습니다 · DC 탭에서 매도 후 '매도 완료 기록'", "alloc", C.red]
                 : ["4", `DC ${dcWait === 0 ? "모두 보유" : dcWait === (market.dc?.core || []).length ? "모두 대기(안전자산)" : `${(market.dc?.core || []).filter(c => c.state === "wait").map(c => c.label.replace(/^(미국|한국) /, "")).join("·")} 대기`}`, "느린 ST · 색이 바뀌면 알림", "alloc", C.dim])}
      </Card>

      {/* 244. 시장 · 내 종목 — 한 줄씩 (자세한 건 찾기 › 🌐 시장 · 내 종목 탭) */}
      <MarketLine market={market} setTab={setTab} />
      <HoldLine pos={pos} stocks={stocks} sizer={sizer} setTab={setTab} />

      {/* 참고 — 거래 시간 · 원칙 */}
      <Step q="필요할 때 펼쳐 보기">참고</Step>
      <button onClick={() => setHoursOpen(v => !v)} style={{ ...btn(C.dim), width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
        <span>🕒 {nowSeg ? `지금 ${nowSeg[0]}` : "지금 휴장"}</span>
        <span style={{ marginLeft: "auto", fontWeight: 400, color: C.muted }}>장 시간표 {hoursOpen ? "▴" : "▾"}</span>
      </button>
      {hoursOpen && <HoursCard nowMs={Date.now()} />}
      <button onClick={onShowRules} style={{ ...btn(C.gold), width: "100%", marginTop: 8, textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
        <span>📌 이번 주 원칙 5개</span><span style={{ marginLeft: "auto", fontWeight: 400, color: C.dim }}>확인함 ✓ · 다시 보기 ›</span>
      </button>
    </>
  );
}
