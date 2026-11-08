/* 264. Chart 탭 — 이 탭만 쓰는 화면 (App.jsx 에서 자동으로 나눔 · 다른 탭과 같이 쓰는 건 core.jsx) */
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
import { ActionTag, C, Card, DipTag, Empty, FS, Info, LiveTag, MONO, ONE, Seg, StaleWarn, Star, Toggle, WHY, btn, col, earnDays, infoUrl, inp, kstDay, linkBtn, liveOf, lossOf, lossTxt, md, money, pct, pctFit, pickedDays, price, slotInfo, tgtGap, trOf, useBroker, useLive, useSticky, ysym } from "./core.jsx";


export const Cells = ({ s, keys = [["3일", "d3"], ["5일", "d5"], ["1달", "d21"]] }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(${keys.length}, minmax(0,1fr))`, columnGap: 6 }}>
    {keys.map(([l, k]) => (
      <div key={k} style={{ minWidth: 0, overflow: "hidden" }}>
        <div style={{ fontSize: 10.5, color: C.muted, whiteSpace: "nowrap" }}>{l}</div>
        <div style={{ fontSize: FS.sm, fontFamily: MONO, color: col(s[k]), fontWeight: 600, whiteSpace: "nowrap",
                      letterSpacing: -0.3 }}>{pctFit(s[k])}</div>
      </div>))}
  </div>
);
/** 112. 트레이딩뷰 차트 — 확대·추세선·지표는 거기서 (앱 차트는 신호 확인용) */
export const TV_EX = { NMS: "NASDAQ", NGM: "NASDAQ", NCM: "NASDAQ", NAS: "NASDAQ", NYQ: "NYSE", ASE: "AMEX", PCX: "AMEX" };
export const tvUrl = (s) => "https://www.tradingview.com/chart/?symbol=" + encodeURIComponent(
  s.m === "kr" ? `KRX:${s.t}` : (TV_EX[s.ex] ? `${TV_EX[s.ex]}:` : "") + String(s.t).replace("-", "."));

export const FilterBar = ({ children }) => (
  <div style={{ display: "flex", gap: 6, alignItems: "center", overflowX: "auto", WebkitOverflowScrolling: "touch",
                padding: "10px 2px 6px", scrollbarWidth: "none" }}>{children}</div>
);

/* ══════════════ 5. 차트 ══════════════ */
export function ChartTab({ stocks, sel: sel0, watch, toggleWatch, market, pos, setPos, setTab, sizer, staleInfo, notes, setNote, trades, picksLog }) {
  const [checkOpen, setCheckOpen] = useSticky("v13.chart.check", false);   // 81. 체크리스트 접기
  const [reg, setReg] = useState(null);      // 184. 1회차 등록 입력 { px, qty, d, oneShot }
  const broker = useBroker();                 // 계좌 연결 상태 (주문이 열려 있나)
  useEffect(() => { setReg(null); }, [sel0]);
  // 국내 상장 매수용 ETF 를 열면 판단 기준인 미국 원본 차트를 보여줍니다
  const sel = (sel0 && stocks[sel0]?.vehOf) || sel0;
  const s = sel ? stocks[sel] : null;
  const orderHere = !!broker?.canOrder && !!sel && !stocks[sel]?.etf && !stocks[sel]?.idx && stocks[sel]?.action === "buy" && !(pos || []).some(p => p.t === sel);   // 210. 계좌로 살 수 있으면 '기록만'은 작게
  const [bars, setBars] = useState(null);
  const [busy, setBusy] = useState(false);
  const [berr, setBerr] = useState(null);
  const cache = useRef({});
  const [span, setSpan] = useState(63);                        // 250. 기본 3개월 (예전 6개월 — 봉이 촘촘해 잘 안 보였음)
  const [macdOpen, setMacdOpen] = useSticky("v13.chart.macd", false);   // 250. MACD 는 참고라 기본 접음
  const mainH = Math.max(250, Math.min(360, Math.round((typeof window !== "undefined" ? window.innerHeight : 800) * 0.48)));   // 250. 큰 차트 250 → 최대 360
  const [opt, setOpt] = useState(() => {
    const D = { ichi: true, st: true, ma: true, idx: true, mk: true };
    try { return { ...D, ...JSON.parse(localStorage.getItem("v4.chart") || "{}") }; }
    catch { return D; }
  });
  useEffect(() => { localStorage.setItem("v4.chart", JSON.stringify(opt)); }, [opt]);

  /* 누른 종목 파일 하나만 받습니다 (약 16KB) */
  useEffect(() => {
    if (!sel) return;
    if (cache.current[sel]) { setBars(cache.current[sel]); setBerr(null); return; }
    let dead = false;
    setBusy(true); setBerr(null); setBars(null);
    fetch(`/data/bars/${encodeURIComponent(sel)}.json?t=${Date.now()}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(d => { if (dead) return; cache.current[sel] = d; setBars(d); })
      .catch(e => { if (!dead) setBerr(e.message); })
      .finally(() => { if (!dead) setBusy(false); });
    return () => { dead = true; };
  }, [sel]);

  /* 지수(KOSPI / S&P500) — 날짜로 맞춰 붙입니다. 파이프라인이 저장한 종가를 그대로 씁니다. */
  const idxMap = useMemo(() => {
    const rows = market?.idxbars?.[s?.m]?.rows;
    if (!rows?.length || s?.idx) return null;          // 187. 지수 차트에는 지수 겹쳐 그리기 안 함
    const m = new Map();
    for (const [t, c] of rows) if (c != null) m.set(t, c);
    return m;
  }, [market, s?.m, s?.idx]);
  const idxLabel = market?.idxbars?.[s?.m]?.label || (s?.m === "kr" ? "KOSPI" : "S&P500");

  /* 열 이름은 파일이 알려 줍니다 — 순서가 바뀌어도 화면이 깨지지 않도록 */
  const view = useMemo(() => {
    if (!bars?.rows?.length) return null;
    const ix = {}; (bars.cols || []).forEach((c, i) => ix[c] = i);
    const raw = bars.rows.slice(-span);
    const rows = raw.map(r => {
      const g = k => (ix[k] == null ? null : (r[ix[k]] ?? null));
      const mask = g("stDir"), macd = g("macd"), hist = g("hist");
      const sA = g("spanA"), sB = g("spanB");
      const o = {
        d: new Date(g("t") * 1000).toISOString().slice(5, 10),
        _t: g("t"),
        c: g("c"), v: g("v"), ma20: g("ma20"), ma200: g("ma200"),
        cloudLo: (sA != null && sB != null) ? Math.min(sA, sB) : null,
        cloudBand: (sA != null && sB != null) ? Math.abs(sA - sB) : null,
        cloudUp: (sA != null && sB != null) ? (sA >= sB ? 1 : 0) : null,
        rsi: g("rsi"), macd, hist,
        signal: (macd != null && hist != null) ? +(macd - hist).toFixed(3) : null,
      };
      // 트리플 슈퍼트렌드 — 상승/하락을 따로 담아야 한 선 안에서 색이 바뀝니다.
      // stDir 은 3비트 묶음(1=st1, 2=st2, 4=st3)이고, 켜진 비트 수가 곧 ST n/3 입니다.
      let up = 0;
      for (let k = 0; k < 3; k++) {
        const val = g(ST_KEYS[k]);
        const bull = mask != null && ((mask >> k) & 1) === 1;
        if (mask != null && bull) up++;
        o[`st${k + 1}Up`] = (val != null && mask != null && bull) ? val : null;
        o[`st${k + 1}Dn`] = (val != null && mask != null && !bull) ? val : null;
      }
      o.stUpCount = mask == null ? null : up;
      return o;
    });
    // ★ 지수 겹쳐 그리기 — 화면 첫날을 종목과 같은 가격에서 출발시킵니다.
    //   "이 종목을 안 사고 지수를 샀다면 지금 얼마" 가 되어, 두 선의 벌어진 폭이 곧 초과수익입니다.
    //   (지수를 원래 눈금으로 그리면 축이 둘로 갈라져 어느 쪽이 이겼는지 눈으로 못 읽습니다.)
    let idxFirst = null, stkFirst = null, idxPts = 0;
    if (idxMap) {
      for (const r of rows) {
        const iv = idxMap.get(r._t);
        if (iv != null && r.c != null) { idxFirst = iv; stkFirst = r.c; break; }
      }
      if (idxFirst) for (const r of rows) {
        const iv = idxMap.get(r._t);
        if (iv != null) { r.idx = +(stkFirst * iv / idxFirst).toFixed(4); idxPts++; }
        else r.idx = null;
      }
    }
    const idxRel = (idxFirst && rows.length) ? (() => {
      // 기간 초과수익 — 근거 카드의 RS 와는 다른 값입니다(여기는 '이 화면 구간'만).
      let lastC = null, lastI = null;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (lastC == null && rows[i].c != null) lastC = rows[i].c;
        if (lastI == null && rows[i].idx != null) lastI = rows[i].idx;
        if (lastC != null && lastI != null) break;
      }
      return (lastC != null && lastI) ? (lastC / lastI - 1) * 100 : null;
    })() : null;

    // 가격축 범위 — 구름을 stack 으로 깔면 0 이 축에 끌려 들어와 가격선이 납작해집니다.
    // 축 범위는 가까이 읽는 것(종가·20일선·구름·슈퍼트렌드)으로만 잡습니다.
    // 200일선까지 넣으면 크게 오른 종목(예: 삼성전자)에서 축이 0 근처까지 늘어나
    // 정작 봐야 할 가격 움직임이 위쪽에 눌려 붙어 안 보입니다. 200일선은 화면 밖으로
    // 나가면 잘리고, 가격이 다가오면 자연스럽게 들어옵니다 (수치는 아래 '근거'에 있습니다).
    // 186. 1M(약 21거래일)은 가격 움직임을 크게 보려는 화면 — 구름은 축 범위에서 빼고 (화면 밖이면 잘림) 종가·20일선·슈퍼트렌드로만
    const near = span <= 21;
    const vals = [];
    for (const r of rows) {
      for (const k of ["c", "ma20", ...(near ? [] : ["cloudLo"]), ...ST_DOM]) if (r[k] != null) vals.push(r[k]);
      if (!near && r.cloudLo != null && r.cloudBand != null) vals.push(r.cloudLo + r.cloudBand);
    }
    if (!vals.length) return { rows, idxPts, idxRel, dom: ["auto", "auto"], ticks: undefined };
    let lo = Math.min(...vals), hi = Math.max(...vals);
    // 지수선도 축에 넣습니다 — 안 넣으면 크게 이긴/진 종목에서 지수선이 화면 밖으로 잘려
    // 정작 보려던 '얼마나 이겼나'가 안 보입니다. 다만 종목 범위의 2배를 넘게는 늘리지 않습니다
    // (지수가 극단적으로 벌어졌을 때 가격 움직임이 납작해지는 것을 막습니다).
    if (idxPts > 1) {
      const iv = rows.map(r => r.idx).filter(v => v != null);
      const sp = (hi - lo) || hi * 0.05;
      lo = Math.max(Math.min(lo, Math.min(...iv)), lo - sp);
      hi = Math.min(Math.max(hi, Math.max(...iv)), hi + sp);
    }
    const pad = (hi - lo) * 0.06 || hi * 0.02;
    return { rows, idxPts, idxRel, ...niceAxis(Math.max(0, lo - pad), hi + pad) };
  }, [bars, span, idxMap]);
  const data = view?.rows || null;
  /* 152. 차트 표시 — ▲ '오늘 살 것'에 든 날 · ● 내가 산 날 · ✕ 내가 판 날 (그날 또는 그 전 마지막 거래일 종가 위치) */
  const marks = (() => {
    if (!data?.length || !s || !opt.mk) return [];
    const off = s.m === "kr" ? 9 * 3600000 : 0;
    const days = data.map(r => new Date(r._t * 1000 + off).toISOString().slice(0, 10));
    const at = (d) => { if (!d || d < days[0]) return -1; let k = -1; for (let i = 0; i < days.length; i++) { if (days[i] <= d) k = i; else break; } return k; };
    const out = [], seenK = new Set(), add = (d, kind, label) => { const i = at(String(d || "").slice(0, 10)); if (i < 0 || data[i].c == null) return;
      const key = kind + i; if (seenK.has(key)) return; seenK.add(key); out.push({ x: data[i].d, y: data[i].c, kind, label }); };
    pickedDays(picksLog, s.t, s.m).filter(p => p.buy).forEach(p => add(p.d, "pick", "추천"));
    (pos || []).filter(p => String(p.t).toUpperCase() === s.t).forEach(p => trOf(p).forEach((t, k) => add(t.d, "buy", `${k + 1}회차`)));
    (trades || []).filter(t => String(t.t).toUpperCase() === s.t).forEach(t => { add(t.in, "buy", "매수"); add(t.out, "sell", "매도"); });
    return out;
  })();
  const MK = { pick: [C.emerald, "▲"], buy: [C.gold, "●"], sell: [C.red, "✕"] };
  const [hov, setHov] = useState(null);       // 손가락으로 짚은 봉 (없으면 마지막 봉)
  useEffect(() => { setHov(null); }, [sel, span]);
  const live = useLive(s ? [s] : []);      // 105. 지금 가격 (훅이라 조기 return 앞)
  // 축 폭 — 7자리 원화 눈금이 잘리지 않게. ★ 훅이라 아래 조기 return 보다 먼저 있어야 합니다.
  const axisW = useMemo(() => {
    const t = view?.ticks?.length ? view.ticks : [100];
    const px = (str) => [...String(str)].reduce((a, ch) => a + (/[가-힣]/.test(ch) ? 8.6 : 4.9), 0);
    return Math.max(34, Math.min(62, Math.ceil(Math.max(...t.map(x => px(shortNum(x)))) + 12)));
  }, [view]);

  if (!sel) return <Empty>검색(🔍)이나 다른 탭에서 종목을 누르면 여기에 열립니다</Empty>;
  if (!s) return <Empty>{sel} 는 스냅샷에 없습니다</Empty>;

  const isEtf = !!s.etf;
  const veh = s.veh || null;                       // 미국 원본이면 국내 매수 상품
  const v = s.idx
    ? (s.stSlow === 1 ? { t: "추세 위", c: C.emerald, why: `느린 ST 초록 ${s.slowDays}거래일째 · 지수는 참고용(사는 대상 아님)` }
       : s.stSlow === 0 ? { t: "추세 아래", c: C.gold, why: `느린 ST 빨강 ${s.slowDays}거래일째 · 지수는 참고용(사는 대상 아님)` }
       : { t: "—", c: C.muted, why: "" })
    : isEtf
    ? (s.stSlow === 1 ? { t: "보유", c: C.emerald, why: `느린 ST 초록 ${s.slowDays}거래일째` }
       : s.stSlow === 0 ? { t: "대기", c: C.gold, why: `느린 ST 빨강 ${s.slowDays}거래일째 · 안전자산` }
       : { t: "—", c: C.muted, why: "" })
    : null;   // 종목은 아래 ActionTag 가 파이프라인 판정을 그대로 씁니다
  const hi52 = s.w52p != null ? s.c / (1 + s.w52p / 100) : null;
  const regT = isEtf && veh?.code ? veh.code : s.t;          // 실제로 사는 것
  const regPx = isEtf && veh?.code ? veh.c : s.c;
  const regM = isEtf && veh?.code ? "kr" : s.m;
  const held = (pos || []).some(p => p.t === regT);
  const pf = (val) => price(val, s.m);
  const macdTxt = (s.macdH != null && s.c)
    ? `${s.macdH >= 0 ? "+" : ""}${(s.macdH / s.c * 100).toFixed(2)}%` : "—";
  const axis = { fontSize: 10, fill: C.muted };
  // ★ 툴팁 상자는 휴대폰에서 차트를 통째로 가립니다 → 십자선만 남기고 값은 차트 밖에 적습니다
  const tip = { cursor: { stroke: "rgba(255,255,255,.45)", strokeWidth: 1 }, content: () => null, isAnimationActive: false };
  const pick = (st) => { const i = st?.activeTooltipIndex; if (i != null) setHov(i); };
  // ★ onMouseLeave 로 지우면 안 됩니다 — 탭 직후 브라우저가 흉내 내는 마우스 이벤트가 선택을 지워버립니다.
  //   해제는 판독줄의 '최근으로' 버튼으로 합니다.
  const touch = { onMouseMove: pick };
  // ★ 손가락 터치는 recharts 가 위치를 넘겨주지 않습니다 → 좌표로 직접 몇 번째 봉인지 계산합니다
  const onTouch = (e) => {
    const t = e.touches?.[0] || e.changedTouches?.[0];
    if (!t || !data?.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const L = axisW + 4, Rt = 8, w = r.width - L - Rt;
    if (w <= 0) return;
    const i = Math.round(((t.clientX - r.left - L) / w) * (data.length - 1));
    setHov(Math.max(0, Math.min(data.length - 1, i)));
  };
  const touchBox = (h) => ({ onTouchStart: onTouch, onTouchMove: onTouch, style: { height: h, touchAction: "pan-y" } });
  const Cross = () => hov != null && data?.[hov]
    ? <ReferenceLine x={data[hov].d} stroke="rgba(255,255,255,.55)" strokeWidth={1} /> : null;
  const cloudTone = data?.length ? (data[data.length - 1].cloudUp ? C.emerald : C.red) : C.emerald;
  const stNow = data?.length ? data[data.length - 1].stUpCount : null;
  const sh = sizer?.shares(regPx, regM);
  const isStock = !isEtf;
  // 체크리스트 = 파이프라인 판정의 재료를 풀어 보여주는 것. 결론은 위 ActionTag 와 항상 같습니다.
  const checks = isStock ? [
    ["주도주 (RS 70↑)", (s.rs ?? 0) >= 70, `RS ${s.rs != null ? Math.floor(s.rs) : "—"}`],
    ["추세 (50>200일선 · 종가>200일선)", (s.ma200p ?? -1) > 0 && s.tmpl !== false && (s.stSlow === 1), `200일선 ${pct(s.ma200p, 1)}`],
    ["느린 ST 초록", s.stSlow === 1, s.stSlow == null ? "—" : `${s.stSlow === 1 ? "초록" : "빨강"} ${s.slowDays}거래일째`],
    ["RSI 60 이상 (강세)", (s.rsi ?? 0) >= 60, `RSI ${s.rsi?.toFixed(0) ?? "—"}`],
    ...(s.m === "kr"
      ? [["↳ 또는 RSI 45 회복 (눌림)", !!s.pull, `${s.pull ? "오늘 회복" : "아님"}`]]
      : []),
    ["↳ 또는 추세 확인 (ST 3개 초록 + 구름 위)", !!s.trend3, `ST ${s.st ?? "—"}/3 · 구름 ${s.cloud === 1 ? "위" : s.cloud === 0 ? "안" : "아래"}`],
  ] : [];
  const allOk = s.action === "buy";

  return (
    <>
      {/* 종목 머리 */}
      <Card style={{ marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Star on={watch.includes(s.t)} onClick={() => toggleWatch(s.t)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.n}</div>
            <div style={{ fontSize: FS.xs, color: C.muted }}>{s.m === "kr" ? "🇰🇷" : "🇺🇸"} {s.t} · {s.asOf} 종가</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 19, fontWeight: 800, fontFamily: MONO }}>{price(s.c, s.m)}</div>
            <div style={{ fontSize: FS.sm, fontFamily: MONO, color: col(s.d1) }}><span style={{ fontSize: 10.5, color: C.muted, fontFamily: "inherit" }}>전일 </span>{pct(s.d1)}</div>
          </div>
        </div>
        {liveOf(s, live) && <div style={{ marginTop: 4, textAlign: "right" }}><LiveTag s={s} q={live} /></div>}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {isEtf ? <><span style={{ fontSize: FS.lg, fontWeight: 800, color: v?.c }}>{v?.t}</span>
                     <span style={{ fontSize: FS.sm, color: C.dim }}>{v?.why}</span></>
                 : <><ActionTag s={s} held={held} big />
                     <span style={{ fontSize: FS.sm, color: C.dim }}>
                       {s.action === "sell" ? `느린 ST 빨강 ${s.slowDays ?? "—"}거래일째${held ? "" : " · 새로 사지 않음"}` : s.stLine ? `트레일링선 ${price(s.stLine, s.m)} · 선까지 ${lossTxt(s)}` : ""}</span>
                     {s.dip && <DipTag s={s} />}
                     {earnDays(s) != null && earnDays(s) <= 60 && <span style={{ fontSize: FS.xs, fontWeight: 700, color: earnDays(s) <= 7 ? C.gold : C.muted }}>
                       📅 실적 {md(s.earn)} ({earnDays(s) === 0 ? "오늘" : `D-${earnDays(s)}`}{s.earnE ? " · 예상일" : ""})</span>}</>}
        </div>
        {isStock && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", marginTop: 8, padding: "6px 0", borderRadius: 8,
                        background: "rgba(255,255,255,.03)", textAlign: "center" }}>
            {[["20일선", s.ma20p != null ? `${s.ma20p >= 0 ? "+" : ""}${s.ma20p.toFixed(1)}%` : "—", s.ma20p],
              ["선까지", lossTxt(s), lossOf(s) != null ? -lossOf(s) : null],
              ["거래량 5/50", s.vol != null ? `${s.vol.toFixed(2)}배` : "—", s.vol != null ? s.vol - 1 : null],
              ["52주 고점", s.w52p != null ? `${s.w52p.toFixed(0)}%` : "—", s.w52p]].map(([l, v, c], i) => (
              <div key={l} style={{ borderLeft: i ? `1px solid ${C.border}` : "none", minWidth: 0 }}>
                <div style={{ fontSize: 10, color: C.muted, ...ONE }}>{l}</div>
                <div style={{ fontSize: FS.sm, fontWeight: 700, fontFamily: MONO, color: c == null ? C.muted : col(c), ...ONE }}>{v}</div>
              </div>))}
          </div>)}
        {isStock && <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>위치 정보는 참고용 — 이 값으로 걸러 사면 검증에서 성과가 떨어졌습니다. 선까지 = 지금 사면 잃을 수 있는 폭</div>}
        {isStock && (() => {      /* 110. PER (참고) · 112. 바깥 차트·자료 연결 */
          const sec = (market?.sectors || []).find(x => x.tk === s.sec);
          const f1 = (v) => v == null ? "—" : v >= 100 ? v.toFixed(0) : v.toFixed(1);
          const link = { ...linkBtn, fontSize: FS.xs, minHeight: 34, padding: "0 10px", border: `1px solid ${C.border}`, borderRadius: 8, textDecoration: "none", display: "inline-flex", alignItems: "center" };
          return (
            <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,.03)" }}>
              {s.m === "us" ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: C.muted }}>이 종목 PER · 예상 PER</div>
                    <div style={{ fontSize: FS.md, fontWeight: 700, fontFamily: MONO }}>{s.pe ? f1(s.pe) : (s.fin?.prof === false ? "적자" : "—")} <span style={{ color: C.muted, fontWeight: 400 }}>·</span> {f1(s.fpe)}</div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: C.muted, ...ONE }}>업종 중앙값{sec ? ` (${sec.label} · ${sec.n ?? "—"}종목)` : ""}</div>
                    <div style={{ fontSize: FS.md, fontWeight: 700, fontFamily: MONO, color: C.dim }}>{f1(sec?.pe)} <span style={{ color: C.muted, fontWeight: 400 }}>·</span> {f1(sec?.fpe)}</div>
                  </div>
                </div>
              ) : <div style={{ fontSize: FS.xs, color: C.muted }}>🇰🇷 PER 은 자료원(야후)에 없어 네이버 증권에서 확인합니다</div>}
              <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>PER = 주가 ÷ 최근 12개월 주당순이익 · 예상 PER = 주가 ÷ 앞으로 12개월 예상 이익 · 참고용(이 값으로 거르지 않음)</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                <a href={tvUrl(s)} target="_blank" rel="noopener" style={link}>📈 트레이딩뷰</a>
                <a href={`https://finance.yahoo.com/quote/${encodeURIComponent(ysym(s))}`} target="_blank" rel="noopener" style={link}>야후</a>
                {s.m === "us" && <a href={`https://finviz.com/quote.ashx?t=${encodeURIComponent(String(s.t).replace(".", "-"))}`} target="_blank" rel="noopener" style={link}>핀비즈</a>}
                <a href={infoUrl(s)} target="_blank" rel="noopener" style={link}>네이버</a>
              </div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>
                트레이딩뷰 = 차트 확대·선긋기 · 야후 = 실적·재무(앱 PER 의 출처){s.m === "us" ? " · 핀비즈 = 지표 한눈에" : ""} · 네이버 = 한글 정보
              </div>
            </div>);
        })()}
        {isStock && !s.idx && <AboutCard s={s} today={kstDay()} naverUrl={infoUrl(s)} />}
        {isStock && !held && s.action === "buy" && <StaleWarn info={staleInfo} m={s.m} />}
        {isStock && <NoteBox s={s} note={notes?.[s.t]} setNote={setNote} />}
        {isEtf && veh && (
          <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 6, padding: "7px 9px", borderRadius: 8, background: "rgba(6,182,212,.07)" }}>
            {veh.code ? <>DC 매수 → <b style={{ fontFamily: MONO, color: C.cyan }}>{veh.code}</b> <b style={{ color: C.text }}>{veh.name}</b>
              {veh.c ? ` · ${price(veh.c, "kr")}` : ""}{veh.synth && <span style={{ color: C.gold }}> · 합성 — DC 매수 가능 여부 확인</span>}</>
              : <span style={{ color: C.gold }}>국내 상장 대체 ETF 없음 — DC에서 살 수 없습니다</span>}
          </div>)}
        {!held && sh != null && (!isEtf || veh?.code) && (
          <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 4 }}>
            {!isEtf && !(sizer.limit(regM) > 0) ? <span style={{ color: C.gold }}>{regM === "kr" ? "🇰🇷" : "🇺🇸"} 투자금{sizer.plan ? "이 0원입니다" : "을 아직 정하지 않았습니다"} — 📁 내 종목 → 💰 투자금에서 금액을 넣으면 1회차 주수를 계산합니다</span>
            : sh > 0 ? <>1회차 <b style={{ color: C.text }}>{sh}주</b> · {money(sizer.limit(regM) * 0.5, regM)} (한도 {money(sizer.limit(regM), regM)}의 절반)
              <span style={{ color: C.muted }}> · 2회차는 +3% 확인 후</span></>
              : Math.floor(sizer.limit(regM) / regPx) >= 1
                ? <span style={{ color: C.gold }}>고가 종목 — 절반으로는 1주도 안 됩니다. <b style={{ color: C.text }}>1주를 한 번에</b> (2회차 없음)</span>
                : <span style={{ color: C.gold }}>1주 가격이 종목당 한도({money(sizer.limit(regM), regM)})보다 큽니다. 사려면 칸 두 개를 쓰는 셈이니, 💰 투자금에서 칸 수나 금액을 조정하세요</span>}
          </div>)}
        {/* 210. 계좌로 사기 — 이 자리에서 주문 창이 열림 (주문이 열린 계좌일 때만) */}
        {!s.idx && isStock && !held && s.action === "buy" && broker?.canOrder && (
          <button onClick={() => openOrder({ t: s.t, side: "buy", qty: sh > 0 ? sh : 1, m: s.m })}
            style={{ ...btn(C.cyan), width: "100%", marginTop: 8, minHeight: 48, fontSize: FS.md }}>🏦 {broker.label || "계좌"}로 사기 · 1회차 {sh > 0 ? sh : 1}주</button>)}
        {!s.idx && <button onClick={() => {
          if (held) { setTab("track"); return; }
          if (isEtf && !veh?.code) return;
          if (!isEtf && !s.dip) {       // 109. 칸이 다 찼으면 한 번 묻습니다
            const sl = slotInfo(pos, regM);
            if (sl.free <= 0 && !confirm(`빈 칸이 없습니다 (보유 ${sl.held} · ${sl.n}칸).\n규칙은 "빈 칸만큼만 산다"입니다. 그래도 등록할까요?`)) return;
          }
          // 184. 바로 등록하지 않고 실제 체결가·주수·날짜를 먼저 받습니다 (앱 제안값으로 채움 — 예전엔 종가로 등록 후 ✏ 수정)
          const half = sizer.limit(regM) * 0.5;
          const oneShot = !isEtf && Math.floor(half / regPx) < 1;            // 고가 종목: 1주를 한 번에
          const amt = isEtf ? sizer.limit(regM) : oneShot ? regPx : half;
          setReg({ px: String(regPx ?? ""), qty: String(Math.max(1, Math.floor(amt / regPx) || 1)), d: kstDay(), oneShot });
        }} disabled={isEtf && !veh?.code} style={{ ...btn(held ? C.dim : (isStock && !s.dip && slotInfo(pos, regM).free <= 0) ? C.gold : C.emerald), width: "100%", marginTop: 10, opacity: isEtf && !veh?.code ? .4 : 1 , ...(orderHere ? { ...btn(C.dim), minHeight: 38, fontSize: FS.sm, marginTop: 8 } : {})}}>
          {held ? "내 종목에서 보기" : isEtf ? `＋ ${price(regPx, regM)} 에 보유 등록${veh?.code ? ` (${veh.code})` : ""}`
            : orderHere ? "다른 곳에서 샀음 — 기록만"
            : sh > 0 ? `＋ 1회차 매수 등록 · ${price(regPx, regM)}`
            : Math.floor(sizer.limit(regM) / regPx) >= 1 ? `＋ 1주 매수 등록 · ${price(regPx, regM)}`
            : !(sizer.limit(regM) > 0) ? `＋ 1주 매수 등록 · ${price(regPx, regM)}`
            : `＋ 1주 등록 (한도 초과 — 칸 2개 쓰는 셈) · ${price(regPx, regM)}`}</button>}
        {reg && !held && (() => {   // 184. 실제 체결 값 입력
          const px = Number(reg.px) || 0, q = Number(reg.qty) || 0;
          const L = (k, child) => <label style={{ display: "grid", gap: 3, fontSize: FS.xs, color: C.dim }}>{k}{child}</label>;
          const save = () => {
            if (!(px > 0) || !(q > 0)) { setReg(r => ({ ...r, err: "체결가와 주수를 넣어 주세요" })); return; }
            const d = String(reg.d || kstDay()).slice(0, 10), amt = Math.round(px * q * 100) / 100;
            const tr = reg.oneShot ? [{ d, px, amt }, { d, px, amt: 0 }] : [{ d, px, amt }];
            setPos(vs => [...vs, { id: Date.now(), t: regT, role: isEtf ? "etf" : (s.dip ? "long" : "swing"), date: d, tr }]);
            setReg(null); setTab("track");
          };
          return <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 10, background: "rgba(48,209,88,.07)", border: `1px solid ${C.emerald}44`, display: "grid", gap: 8 }}>
            <div style={{ fontSize: FS.sm, fontWeight: 700 }}>실제로 산 값을 넣어 주세요 <span style={{ fontSize: FS.xs, color: C.muted, fontWeight: 400 }}>· 앱 제안값으로 채워 둠</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {L(`체결가 (${regM === "us" ? "$" : "원"})`, <input type="number" inputMode="decimal" value={reg.px} onChange={e => setReg(r => ({ ...r, px: e.target.value, err: null }))} style={{ ...inp("100%"), fontSize: 16 }} />)}
              {L("주수", <input type="number" inputMode="numeric" value={reg.qty} onChange={e => setReg(r => ({ ...r, qty: e.target.value, err: null }))} style={{ ...inp("100%"), fontSize: 16 }} />)}
            </div>
            {L("날짜", <input value={reg.d} onChange={e => setReg(r => ({ ...r, d: e.target.value }))} style={inp("100%")} />)}
            {px > 0 && q > 0 && <div style={{ fontSize: FS.xs, color: C.dim }}>= <b style={{ fontFamily: MONO, color: C.text }}>{money(px * q, regM)}</b>{!isEtf && sizer.limit(regM) > 0 ? ` · 종목당 한도 ${money(sizer.limit(regM), regM)}의 ${Math.round(px * q / sizer.limit(regM) * 100)}%` : ""}</div>}
            {reg.err && <div style={{ fontSize: FS.xs, color: C.red }}>{reg.err}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={save} style={{ ...btn(C.emerald), flex: 1, minHeight: 44 }}>등록</button>
              <button onClick={() => setReg(null)} style={{ ...btn(C.dim), flex: 1, minHeight: 44 }}>취소</button>
            </div>
          </div>; })()}
        {!held && isStock && slotInfo(pos, regM).free <= 0 && <div style={{ fontSize: FS.xs, color: C.gold, marginTop: 6, textAlign: "center", fontWeight: 700 }}>
          ⛔ 빈 칸 없음 (보유 {slotInfo(pos, regM).held} · {slotInfo(pos, regM).n}칸) — 오늘은 새로 사지 않는 날입니다</div>}
        {!held && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 4, textAlign: "center" }}>등록 가격은 앱의 마지막 종가입니다 — 실제 체결가가 다르면 📁 내 종목에서 ✏ 수정</div>}
      </Card>

      {/* 매매 체크리스트 — 충동 매매 방지 (검증된 규칙만) */}
      <Card style={{ marginTop: 8, padding: "10px 12px" }}>
        <div onClick={() => setCheckOpen(v => !v)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <span style={{ fontSize: FS.md, fontWeight: 800 }}>{s.idx ? "추세" : isEtf ? "보유 조건" : "매수 체크리스트"}</span>
          {!isEtf && <span style={{ fontSize: FS.xs, color: C.muted }}>{allOk ? `조건 충족 (${WHY[s.why] || "매수"})` : `기본 ${checks.slice(0, 3).filter(c => c[1]).length}/3`} · {checkOpen ? "접기 ▴" : "자세히 ▾"}</span>}
          <span style={{ marginLeft: "auto", fontSize: FS.sm, fontWeight: 800, color: isEtf ? (s.stSlow === 1 ? C.emerald : C.gold) : allOk ? C.emerald : C.muted }}>
            {s.idx ? (s.stSlow === 1 ? "추세 위" : "추세 아래") : isEtf ? (s.stSlow === 1 ? "보유 가능" : "대기") : allOk ? "매수!" : (s.action === "sell" && held) ? "매도!" : "관망"}</span>
        </div>
        {(checkOpen || isEtf) && <>
        {!isEtf && checks.map(([label, ok, val]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: `1px solid ${C.border}`, marginTop: 6 }}>
            <span style={{ fontSize: 16, width: 20, color: ok ? C.emerald : C.muted }}>{ok ? "✓" : "○"}</span>
            <span style={{ fontSize: FS.sm, flex: 1 }}>{label}</span>
            <span style={{ fontSize: FS.sm, color: C.dim, fontFamily: MONO }}>{val}</span>
          </div>))}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: `1px solid ${C.border}`, marginTop: 6 }}>
          <span style={{ fontSize: 14, width: 20, color: s.stSlow === 1 ? C.emerald : C.red }}>●</span>
          <span style={{ fontSize: FS.sm, flex: 1 }}>{isEtf ? "느린 ST (12,3)" : "매도 기준 · 느린 ST (12,3)"}</span>
          <span style={{ fontSize: FS.sm, fontWeight: 700, color: s.stSlow === 1 ? C.emerald : C.red }}>
            {s.stSlow == null ? "—" : `${s.stSlow === 1 ? "초록" : "빨강"} ${s.slowDays}거래일째`}</span>
        </div>
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 4 }}>
          참고 · RSI {s.rsi?.toFixed(0) ?? "—"} {s.rsiUp ? "↑" : "↓"} · MACD {s.macdUp ? "↑" : "↓"} ({macdTxt}) · 200일 {pct(s.ma200p, 1)}
          {isStock && ` · 가격구조 ${s.tmpl ? "✓" : "✕"}`}
        </div>
        <Info label="이 규칙의 근거">
          {s.idx ? <>지수는 사는 대상이 아니라 시장 흐름을 보는 참고용입니다. 느린 ST 색은 DC 규칙이 쓰는 것과 같은 선(12일 · ATR 3배)입니다.</>
            : isEtf
            ? <>느린 슈퍼트렌드가 초록일 때만 보유하고 빨강이면 안전자산으로 두는 규칙입니다. S&P500 원화 기준 2007–26: 샤프 0.69 (그냥 보유 0.58), 최대낙폭 −20% (보유 −31%).</>
            : <>매수는 위 조건이 모두 맞을 때, 매도는 느린 ST가 빨강이 될 때. 2008–26 검증: 평균 약 30일 보유, 손익비 1.6, 승률 약 40%.
               “셋 중 하나라도 빨강이면 매도”는 평균 7일 보유로 비용을 빼면 남는 게 없었습니다. RSI·MACD 상승 조건은 넣어도 결과가 같았습니다.</>}
        </Info>
        </>}
      </Card>
      <div style={{ marginTop: 8 }}><Cells s={s} /></div>

      {/* 차트 옵션 — 한 줄, 넘치면 밀어서 */}
      <FilterBar>
        <span style={{ fontSize: FS.xs, color: C.muted, flexShrink: 0 }}>기간</span>
        <Seg value={span} onChange={setSpan} items={[[21, "1M"], [63, "3M"], [126, "6M"], [200, "전체"]]} />
        <span style={{ fontSize: FS.xs, color: C.muted, flexShrink: 0, marginLeft: 4 }}>표시</span>
        {[["st", "ST"], ["ichi", "구름"], ["ma", "이평"], ["idx", idxLabel], ["mk", "매매"]].map(([k, l]) =>
          <Toggle key={k} on={opt[k]} onClick={() => setOpt(o => ({ ...o, [k]: !o[k] }))}>{l}</Toggle>)}
      </FilterBar>

      {busy ? <Card><Empty>차트 불러오는 중…</Empty></Card>
        : berr ? <Card><Empty>차트 파일 없음 ({berr}) · Actions → Daily Data Update 실행</Empty></Card>
        : !data ? <Card><Empty>차트 데이터가 없습니다</Empty></Card>
        : (<>
          <Card style={{ padding: "10px 4px 4px" }}>
            <Readout row={data[Math.min(hov ?? data.length - 1, data.length - 1)]} live={hov == null} m={s.m} idxLabel={idxLabel} onClear={() => setHov(null)} />
            <PanelLabel>
              {opt.st && stNow != null && <span style={{ color: stNow === 3 ? C.emerald : stNow === 0 ? C.red : C.gold, fontWeight: 700 }}>ST {stNow}/3</span>}
              {opt.ma && <LegendDot c={C.orange}>20일</LegendDot>}
              {opt.ma && <LegendDot c={C.violet}>200일</LegendDot>}
              {opt.idx && view?.idxPts > 1 && <LegendDot c={C.cyan}>{idxLabel}</LegendDot>}
              {opt.mk && marks.length > 0 && <span style={{ color: C.dim }}>
                {marks.some(k => k.kind === "pick") && <span style={{ color: C.emerald }}>▲추천 </span>}
                {marks.some(k => k.kind === "buy") && <span style={{ color: C.gold }}>●삼 </span>}
                {marks.some(k => k.kind === "sell") && <span style={{ color: C.red }}>✕팖</span>}</span>}
              {opt.idx && view?.idxRel != null && (
                <span style={{ fontWeight: 700, color: view.idxRel >= 0 ? C.emerald : C.red }}>
                  지수 대비 {view.idxRel >= 0 ? "+" : ""}{view.idxRel.toFixed(1)}%</span>)}
            </PanelLabel>
            <div {...touchBox(mainH)}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} syncId="v4chart" {...touch} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,.045)" vertical={false} />
                  <XAxis dataKey="d" tick={axis} tickLine={false} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis yAxisId="p" domain={view.dom} ticks={view.ticks} allowDataOverflow tick={axis}
                    width={axisW} tickFormatter={shortNum} />
                  <YAxis yAxisId="v" orientation="right" domain={[0, (m) => m * 4]} hide />
                  <Tooltip {...tip} />
                  {hov != null && data[hov] && <ReferenceLine yAxisId="p" x={data[hov].d} stroke="rgba(255,255,255,.55)" strokeWidth={1} />}
                  {hi52 && <ReferenceLine yAxisId="p" y={hi52} stroke={C.gold} strokeDasharray="2 5" strokeWidth={1}
                    label={{ value: "52주 고점", position: "insideTopLeft", fill: C.gold, fontSize: 10 }} />}
                  <Bar yAxisId="v" dataKey="v" name="거래량" fill="rgba(148,163,184,.22)" isAnimationActive={false} />
                  {opt.ichi && <Area yAxisId="p" type="monotone" dataKey="cloudLo" stackId="cl" stroke="none" fill="transparent" isAnimationActive={false} legendType="none" name="구름 아래" />}
                  {opt.ichi && <Area yAxisId="p" type="monotone" dataKey="cloudBand" stackId="cl" stroke="none"
                    fill={cloudTone} fillOpacity={0.13} isAnimationActive={false} name="구름 두께" />}
                  {opt.ma && <Line yAxisId="p" type="monotone" dataKey="ma20" name="20일선" stroke={C.orange} strokeWidth={1.2} dot={false} connectNulls strokeDasharray="4 2" isAnimationActive={false} />}
                  {opt.ma && <Line yAxisId="p" type="monotone" dataKey="ma200" name="200일선" stroke={C.violet} strokeWidth={1.2} dot={false} connectNulls strokeDasharray="3 3" isAnimationActive={false} />}
                  {opt.idx && view?.idxPts > 1 && <Line yAxisId="p" type="monotone" dataKey="idx"
                    name={`${idxLabel} (같은 출발점)`} stroke={C.cyan} strokeWidth={1.4} strokeOpacity={0.85}
                    dot={false} connectNulls isAnimationActive={false} />}
                  <Line yAxisId="p" type="monotone" dataKey="c" name="종가" stroke="#FFFFFF" strokeWidth={2} dot={false} isAnimationActive={false} />
                  {marks.map((k, i) => (
                    <ReferenceDot key={"mk" + i} yAxisId="p" x={k.x} y={k.y} r={k.kind === "pick" ? 0 : 4} fill={MK[k.kind][0]} stroke="#0B0F1A" strokeWidth={1.5} isFront ifOverflow="extendDomain"
                      label={{ value: k.kind === "pick" ? "▲" : k.kind === "sell" ? "✕" : "", position: k.kind === "pick" ? "bottom" : "top", fill: MK[k.kind][0], fontSize: k.kind === "pick" ? 13 : 12, fontWeight: 800 }} />))}
                  {opt.st && [0, 1, 2].flatMap(k => [
                    <Line key={`u${k}`} yAxisId="p" type="monotone" dataKey={`st${k + 1}Up`} name={`ST${k + 1} 상승`}
                      stroke={C.emerald} strokeWidth={2.1 - k * 0.45} strokeOpacity={1 - k * 0.22}
                      dot={false} connectNulls={false} isAnimationActive={false} />,
                    <Line key={`d${k}`} yAxisId="p" type="monotone" dataKey={`st${k + 1}Dn`} name={`ST${k + 1} 하락`}
                      stroke={C.red} strokeWidth={2.1 - k * 0.45} strokeOpacity={1 - k * 0.22}
                      dot={false} connectNulls={false} isAnimationActive={false} />,
                  ])}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {!macdOpen ? <button onClick={() => setMacdOpen(true)} style={{ ...btn(C.dim), width: "100%", marginTop: 6, minHeight: 36, fontSize: FS.xs, textAlign: "left", display: "flex" }}>
              <span>MACD (참고)</span><span style={{ marginLeft: "auto", fontWeight: 400, color: C.muted }}>펼치기 ▾</span></button> :
          <Card style={{ marginTop: 6, padding: "8px 4px 2px" }}>
            <PanelLabel>MACD <LegendDot c={C.cyan}>선</LegendDot><LegendDot c={C.gold}>시그널</LegendDot>
              <button onClick={() => setMacdOpen(false)} style={{ ...linkBtn, fontSize: FS.xs, minHeight: 26, marginLeft: "auto", padding: "0 6px" }}>접기 ▴</button></PanelLabel>
            <div {...touchBox(88)}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} syncId="v4chart" {...touch} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
                  <XAxis dataKey="d" tick={false} tickLine={false} height={1} />
                  <Cross />
                  <YAxis tick={axis} width={axisW} tickFormatter={shortNum} />
                  <Tooltip {...tip} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,.18)" />
                  <Bar dataKey="hist" name="히스토그램" isAnimationActive={false}
                    shape={(pr) => <rect x={pr.x} y={pr.y} width={Math.max(1, pr.width)} height={Math.abs(pr.height)}
                      fill={pr.payload.hist >= 0 ? "rgba(48,209,88,.55)" : "rgba(255,69,58,.55)"} />} />
                  <Line type="monotone" dataKey="macd" name="MACD" stroke={C.cyan} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
                  <Line type="monotone" dataKey="signal" name="시그널" stroke={C.gold} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>}

          <Card style={{ marginTop: 6, padding: "8px 4px 2px" }}>
            <PanelLabel>RSI <span style={{ color: C.muted, fontWeight: 400 }}>70 과열 · 30 과매도</span></PanelLabel>
            <div {...touchBox(88)}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} syncId="v4chart" {...touch} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
                  <XAxis dataKey="d" tick={axis} tickLine={false} interval="preserveStartEnd" minTickGap={40} />
                  <Cross />
                  <YAxis domain={[0, 100]} ticks={[30, 70]} tick={axis} width={axisW} />
                  <Tooltip {...tip} />
                  <ReferenceLine y={70} stroke="rgba(255,69,58,.35)" strokeDasharray="3 3" />
                  <ReferenceLine y={30} stroke="rgba(6,182,212,.35)" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="rsi" name="RSI" stroke={C.cyan} fill="rgba(6,182,212,.09)" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>)}

      <div style={{ fontSize: FS.xs, color: C.muted, margin: "8px 2px 0" }}>
        거래대금 {money(s.tv, s.m)} (상위 {s.tvr != null ? Math.max(1, Math.round(100 - s.tvr)) : "—"}%)
        {s.hlt != null && ` · ${s.hltY ?? 3}년 건강도 ${(s.hlt * 100).toFixed(0)}%`}
      </div>
    </>
  );
}
/** 트리플 슈퍼트렌드 열 이름 — 파이프라인의 ST_SET (10,1)(11,2)(12,3) 과 같은 순서 */
/** 축 눈금 축약 — 1,401,000 → 140만 / 2.3조. 원화 종목의 7자리 눈금이 잘리지 않게. */
export function shortNum(x) {
  if (x == null || !isFinite(x)) return "";
  const a = Math.abs(x), sg = x < 0 ? "-" : "";
  if (a >= 1e12) return `${sg}${+(a / 1e12).toFixed(1)}조`;
  if (a >= 1e8) return `${sg}${+(a / 1e8).toFixed(a >= 1e9 ? 0 : 1)}억`;
  if (a >= 1e4) return `${sg}${+(a / 1e4).toFixed(a >= 1e5 ? 0 : 1)}만`;
  if (a >= 100) return `${sg}${Math.round(a).toLocaleString("ko-KR")}`;
  if (a >= 1) return `${sg}${+a.toFixed(1)}`;
  return `${sg}${+a.toFixed(2)}`;
}

export const ST_KEYS = ["st1", "st2", "st3"];
export const ST_DOM = ["st1Up", "st1Dn", "st2Up", "st2Dn", "st3Up", "st3Dn"];

/** 축은 데이터에 딱 맞추고, 눈금만 보기 좋은 수로 찍습니다.
 *  (범위까지 반올림하면 삼성전자처럼 자릿수가 큰 종목에서 축이 0 까지 늘어나
 *   정작 봐야 할 가격 움직임이 위쪽에 눌려 붙습니다.) */
export function niceAxis(lo, hi, want = 5) {
  const span = hi - lo;
  if (!(span > 0)) return { dom: [lo, hi], ticks: undefined };
  const raw = span / want, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(x => x >= raw) || 10 * mag;
  const ticks = [];
  for (let x = Math.ceil(lo / step) * step; x <= hi; x += step) ticks.push(+x.toFixed(6));
  return { dom: [lo, hi], ticks: ticks.length >= 2 ? ticks : undefined };
}


export const PanelLabel = ({ children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: FS.xs, fontWeight: 700, color: C.dim, padding: "0 8px 6px" }}>{children}</div>
);
export const LegendDot = ({ c, children }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: FS.xs, color: C.muted, fontWeight: 400 }}>
    <span style={{ width: 10, height: 3, background: c, borderRadius: 2, display: "inline-block" }} />{children}</span>
);

/* ══════════════ 74. 메모·목표가 상자 (차트 화면) ══════════════ */
export function NoteBox({ s, note, setNote }) {
  const [open, setOpen] = useState(!!note?.m || !!note?.tg);
  const [m, setM] = useState(note?.m || ""); const [tg, setTg] = useState(note?.tg || "");
  useEffect(() => { setM(note?.m || ""); setTg(note?.tg || ""); }, [s.t]);
  const a = s.tgt; const my = Number(tg) > 0 ? Number(tg) : null;
  const gMy = tgtGap(my, s.c), gA = tgtGap(a?.a, s.c);
  const line = (g) => g == null ? "" : g <= 0 ? "도달 ✓" : `남은 거리 +${g.toFixed(0)}%`;
  return (
    <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,.03)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", fontSize: FS.xs }}>
        <b style={{ color: C.text }}>🎯 목표가</b>
        {my ? <span>내 목표 <b style={{ fontFamily: MONO }}>{price(my, s.m)}</b> · 현재 {price(s.c, s.m)} · <b style={{ color: gMy <= 0 ? C.emerald : C.gold }}>{line(gMy)}</b></span>
            : <span style={{ color: C.muted }}>내 목표 없음</span>}
        <button onClick={() => setOpen(v => !v)} style={{ ...linkBtn, minHeight: 28, fontSize: FS.xs, marginLeft: "auto" }}>{open ? "닫기" : note?.m ? "📝 메모 보기" : "📝 메모·목표 적기"}</button>
      </div>
      {a?.a && (
        <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 3 }}>
          애널리스트 평균 <b style={{ fontFamily: MONO, color: C.text }}>{price(a.a, s.m)}</b> · {line(gA)}
          {a.l && a.h ? ` · 범위 ${price(a.l, s.m)}~${price(a.h, s.m)}` : ""}{a.b != null ? ` · 매수 ${a.b}/보유 ${a.hd}/매도 ${a.s}` : ""}
          <span style={{ color: C.muted }}> · {a.d} 기준</span>
        </div>)}
      {open && (
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FS.xs, color: C.dim }}>
            내 목표가
            <input type="number" inputMode="decimal" value={tg} placeholder={s.m === "kr" ? "원" : "달러"} onChange={e => setTg(e.target.value)}
              onBlur={() => setNote(s.t, { tg: Number(tg) > 0 ? Number(tg) : undefined })} style={{ ...inp("100%"), flex: 1, padding: "6px 8px" }} />
          </label>
          <textarea value={m} onChange={e => setM(e.target.value)} onBlur={() => setNote(s.t, { m: m.trim() || undefined })} rows={3}
            placeholder="왜 샀는지, 무엇을 지켜볼지 (500자)" maxLength={500}
            style={{ ...inp("100%"), padding: "8px", fontSize: 14, lineHeight: 1.5, resize: "vertical", fontFamily: "inherit" }} />
          <div style={{ fontSize: 10, color: C.muted }}>입력칸을 벗어나면 저장되고 서버에 자동 연결됩니다. 목표가에 닿아도 매도 신호가 아닙니다 — 파는 기준은 트레일링선 하나.</div>
        </div>)}
    </div>);
}

/** 차트 판독줄 — 손가락으로 짚은 봉의 값을 차트 '밖'에 적습니다.
    떠다니는 툴팁 상자는 휴대폰 화면을 통째로 가려서 쓰지 않습니다. */
export const Readout = ({ row, live, m, idxLabel, onClear }) => {
  if (!row) return null;
  const P = (v) => (v == null ? "—" : price(v, m));
  const cells = [
    ["20일선", P(row.ma20)], ["200일선", P(row.ma200)],
    ["구름", row.cloudUp == null ? "—" : (row.c >= (row.cloudLo ?? 0) + (row.cloudBand ?? 0) ? "위" : row.c >= (row.cloudLo ?? 0) ? "안" : "아래")],
    ["RSI", row.rsi == null ? "—" : row.rsi.toFixed(0)],
    ["MACD", row.hist == null ? "—" : (row.hist >= 0 ? "＋" : "−")],
    [idxLabel, P(row.idx)],
  ];
  return (
    <div style={{ padding: "0 8px 8px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: FS.sm, color: live ? C.muted : C.gold, fontWeight: 700 }}>{row.d}{live ? " (최근)" : ""}</span>
        <span style={{ fontSize: FS.lg, fontWeight: 800, fontFamily: MONO }}>{P(row.c)}</span>
        <span style={{ fontSize: FS.xs, color: C.muted, marginLeft: "auto" }}>거래량 {row.v != null ? shortNum(row.v) : "—"}</span>
        {!live && onClear && <button onClick={onClear} style={{ ...linkBtn, fontSize: FS.xs, minHeight: 28 }}>최근으로</button>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "4px 8px", marginTop: 6 }}>
        {cells.map(([k, v]) => (
          <div key={k} style={{ minWidth: 0, display: "flex", gap: 4, alignItems: "baseline" }}>
            <span style={{ fontSize: 10.5, color: C.muted, whiteSpace: "nowrap" }}>{k}</span>
            <span style={{ fontSize: FS.xs, fontFamily: MONO, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</span>
          </div>))}
      </div>
    </div>);
};
