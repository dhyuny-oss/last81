/**
 * Alpha Terminal — 앱 뼈대 (데이터 불러오기 · 서버 동기화 · 하단 탭 · 차트 창)
 * ════════════════════════════════════════════════════════════
 * 데이터는 파이프라인(scripts/build_snapshot.py)이 계산한 값을 "읽기만" 합니다. 지표 계산은 여기 없습니다.
 *   /data/snapshot.json · market.json · today.json (첫 화면) · /data/bars/<티커>.json (누른 종목 하나만)
 *
 * 264. 탭마다 파일 하나 — 한 탭을 고치거나 바꿔 끼울 땐 그 파일만:
 *   TabToday.jsx(오늘) · TabFind.jsx(찾기 · 🌐 시장 · 급락) · TabChart.jsx(차트 창) · TabTrack.jsx(내 종목)
 *   TabDc.jsx(DC) · TabReview.jsx(점검) · TabPool.jsx(종목풀) · core.jsx(여러 탭이 같이 쓰는 색·버튼·숫자·시장 시간)
 *   규칙 숫자는 config/rules.json · 휴장일은 config/market.json · 고르는 규칙은 picks.js
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import RULES from "./rules.js";
import { pickToday, SLOTS_DEFAULT, SEC_CAP } from "./picks.js";
import { planFills, applyFills } from "./fills.js";
import { C, Card, FS, KR_HOLIDAYS, MONO, NOTES_REF, PLAN_KEY, REV_KEY, SYNC_BASE, US_HOLIDAYS, asOfOf, btn, dcModeOf, getJson, getRevMin, inp, krGateOf, kstDay, linkBtn, loadJSON, loadPlan, marketState, md, mdt, mdy, mktOfT, money, pct, pickCfg, planAmounts, postWatch, slotInfo, trOf, usDST, usGateOf, weekKey } from "./core.jsx";
import { MarketTab } from "./TabToday.jsx";
import { DcTab } from "./TabDc.jsx";
import { ChartTab } from "./TabChart.jsx";
import { TrackTab } from "./TabTrack.jsx";
import { FindHub } from "./TabFind.jsx";
import { ReviewTab } from "./TabReview.jsx";
import { PoolTab } from "./TabPool.jsx";


export const APP_VERSION = "v13.21.0";

/* ★ 증권사 (1/2) — 증권사 계좌 카드(조회 · 매수 제안 · 주문 · 기본 메리츠, BROKER 환경변수로 바꿈). 빼려면: 이 두 줄 + 아래 "★ 증권사 (2/2)" 한 줄 + src/Kis.jsx + api/broker.js + api/_lib/ */
const BrokerPanel = React.lazy(() => import("./Broker.jsx"));
const OrderSheet = React.lazy(() => import("./OrderSheet.jsx"));

/* ★ 연습 (1/2) — 고르기 연습 입구. 빼려면: 이 블록 + 아래 "★ 연습 (2/2)" 한 줄 + src/Practice.jsx + public/data/practice.json 삭제 */
const Practice = React.lazy(() => import("./Practice.jsx"));
function PracticeEntry() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (<>
    <button onClick={() => setOpen(true)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", marginTop: 14,
      padding: "12px 14px", minHeight: 48, borderRadius: 12, background: "#0F1420", border: "1px solid rgba(255,255,255,.09)", color: "#E5E7EB", cursor: "pointer", font: "inherit" }}>
      <span style={{ fontSize: 20 }}>🎯</span>
      <span style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 14 }}>고르기 연습</b>
        <span style={{ display: "block", fontSize: 12, color: "#9CA3AF" }}>과거 실제 신호 250문제 · 셋 중 하나 골라 보기</span></span>
      <span style={{ color: "#9CA3AF" }}>›</span>
    </button>
    {open && <React.Suspense fallback={null}><Practice onClose={close} /></React.Suspense>}
  </>);
}
/** 그 사이에 낀 평일 수 — 대략적인 '놓친 거래일'.
 *  주말·시간외라고 경보를 끄면 안 되고, 반대로 토요일에 금요일 데이터를 보고
 *  "하루 지났다"고 겁줘도 안 됩니다. 그래서 시간이 아니라 평일 수로 셉니다. */
function weekdaysBetween(fromMs, toMs) {
  if (!(toMs > fromMs)) return 0;
  const day = 86400000;
  // KST 기준 날짜로 자릅니다 (UTC+9)
  const d0 = Math.floor((fromMs + 9 * 3600000) / day);
  const d1 = Math.floor((toMs + 9 * 3600000) / day);
  let n = 0;
  for (let d = d0 + 1; d <= d1 && d - d0 <= 40; d++) {
    const dow = (d + 4) % 7;                  // 1970-01-01(=0) 은 목요일
    if (dow !== 0 && dow !== 6) n++;          // 일·토 제외
  }
  return n;
}
/** 가장 최근에 '돌았어야 할' 예약 수집 시각 (daily.yml cron 과 같은 규칙) */
function lastSlotMs(nowMs) {
  const H = 3600000, day = 86400000;
  const kstMid = Math.floor((nowMs + 9 * H) / day) * day - 9 * H;   // 오늘 KST 00:00 (UTC ms)
  let best = 0;
  for (let k = 0; k <= 3; k++) {
    const base = kstMid - k * day;
    const dow = new Date(base + 9 * H).getUTCDay();
    const cand = [];
    if (dow >= 1 && dow <= 5) cand.push(16 * 60 + 17);
    if (dow >= 2 && dow <= 6) cand.push(6 * 60 + 23);
    if (dow === 6) cand.push(9 * 60 + 13);
    for (const m of cand) { const t = base + m * 60000; if (t <= nowMs && t > best) best = t; }
  }
  return best;
}
/** 106. 시장별 '지금쯤 있어야 할 확정 종가' 날짜 (그 시장 현지 날짜)
 *  🇰🇷 15:45 KST 뒤면 오늘, 아니면 그 전 거래일 · 🇺🇸 뉴욕 16:10 뒤면 그날, 아니면 그 전 거래일 (주말·휴장 건너뜀)
 *  파이프라인도 같은 시각 기준으로 장중 봉을 버립니다(100) */
function expectedClose(m, nowMs = Date.now()) {
  const tz = m === "kr" ? "Asia/Seoul" : "America/New_York";
  const hol = m === "kr" ? KR_HOLIDAYS : US_HOLIDAYS;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(nowMs)).map(x => [x.type, x.value]));
  const mins = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  let d = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  if (mins < (m === "kr" ? 15 * 60 + 45 : 16 * 60 + 10)) d = new Date(d - 86400000);
  for (let k = 0; k < 10; k++) {
    const ymd = d.toISOString().slice(0, 10), dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !hol.has(ymd)) return ymd;
    d = new Date(d - 86400000);
  }
  return null;
}
/** 106. 다음 예약 수집 (KST) — 🇰🇷 평일 16:17 · 🇺🇸 화~토 06:23 */
function nextCollect(m, nowMs = Date.now()) {
  const kst = new Date(nowMs + 9 * 3600000);
  for (let k = 0; k < 8; k++) {
    const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + k));
    const dow = d.getUTCDay(), ymd = d.toISOString().slice(0, 10);
    const [h, mi] = m === "kr" ? [16, 17] : [6, 23];
    const ok = m === "kr" ? (dow >= 1 && dow <= 5 && !KR_HOLIDAYS.has(ymd)) : (dow >= 2 && dow <= 6);
    const t = d.getTime() + (h * 60 + mi) * 60000 - 9 * 3600000;
    if (ok && t > nowMs) return `${k === 0 ? "오늘" : k === 1 ? "내일" : `${+ymd.slice(5, 7)}/${+ymd.slice(8)}`} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }
  return "—";
}
function marketFresh(asOfBy, nowMs = Date.now()) {
  const one = (m) => {
    const have = asOfBy[m], exp = expectedClose(m, nowMs);
    if (!have) return { ok: false, txt: "—" };
    if (!exp || have === exp) return { ok: true, txt: `${md(have)} 종가 ✅ 최신`, have, exp };
    if (have > exp) return { ok: false, txt: `${md(have)} 장중 값 ⚠ 종가 아님`, have, exp, intraday: true };
    // 154. 장이 끝난 뒤 자동 수집이 돌기까지(🇰🇷 ~16:30 · 🇺🇸 ~06:40)는 '늦음'이 아니라 '곧 들어옴' — 🇰🇷 17:30 · 🇺🇸 07:30(서머타임) 까지 기다림
    const expG = expectedClose(m, nowMs - (m === "kr" ? 105 : 140) * 60000);
    if (have >= (expG || "")) return { ok: true, pending: true, txt: `${md(have)} 종가 · ${md(exp)} 종가는 ${m === "kr" ? "17시" : "7시"}쯤까지 들어옴`, have, exp };
    return { ok: false, txt: `${md(have)} 종가 ⚠ ${md(exp)} 종가가 아직 안 들어옴`, have, exp };
  };
  return { kr: one("kr"), us: one("us") };
}
function freshness(updMs, nowMs = Date.now()) {
  const st = marketState(nowMs);
  if (!updMs) return { ...st, emoji: "⚪", label: "데이터 없음", color: C.muted, tone: "none" };
  const min = Math.floor((nowMs - updMs) / 60000);
  const days = weekdaysBetween(updMs, nowMs);
  const txt = "갱신 " + (min < 60 ? `${min}분 전` : min < 1440 ? `${Math.floor(min / 60)}시간 전` : `${(min / 1440).toFixed(1)}일 전`);
  // ★ 오래 멈춘 것은 무조건 먼저 알립니다.
  //   예전에는 주말·시간외면 여기까지 오기 전에 파란 '휴장'으로 빠져서,
  //   9일 멈춘 데이터가 토요일엔 아무 일 없는 것처럼 보였습니다.
  if (days >= 3) return { ...st, min, days, emoji: "🔴", label: `${txt} — 갱신 멈춤`, color: C.red, tone: "stale" };
  if (days === 2) return { ...st, min, days, emoji: "🟠", label: `${txt} — 이틀째 갱신 없음`, color: C.orange, tone: "old" };
  // ★ 수집은 하루 2번(16:00·06:30)뿐이라 '몇 시간 전'으로 판단하면 장중마다 빨간 경보가 뜹니다.
  //   마지막 예약 시각 이후 값이 들어왔는지로 판단합니다. 깃허브 예약은 실제로 6시간 가까이 늦은 적이 있어 8시간은 기다립니다.
  const slot = lastSlotMs(nowMs);
  const slotMiss = slot && updMs < slot - 10 * 60000;
  const waitMin = slot ? Math.floor((nowMs - slot) / 60000) : 0;
  if (slotMiss && waitMin >= 480) return { ...st, min, days, emoji: "🔴", label: `${txt} — 예약 수집 누락`, color: C.red, tone: "bad" };
  if (slotMiss) return { ...st, min, days, emoji: "🟡", label: `${txt} · 수집 대기`, color: C.gold, tone: "lag" };
  if (st.weekend) return { ...st, min, days, emoji: "🔵", label: `주말 · ${txt}`, color: C.cyan, tone: "closed" };
  return { ...st, min, days, emoji: "🟢", label: txt, color: C.emerald, tone: "fresh" };
}
const NAV_H = 60;

/** 74. 종목 메모·내 목표가 — 목표가는 참고용 (매도 신호 아님). 거리 = 목표 ÷ 현재가 − 1 */
const NOTE_KEY = "v12.notes";      // 이 기기가 마지막으로 본 서버 저장 시각
const LOCAL_BAK = "v13.localBak";      // 서버 기록으로 맞추기 전 이 기기 기록 (되살리기용)
/** 기록 내용 지문 — 서버가 값을 다듬어 저장해도(평단 반올림·id 없음) 같은 내용이면 같은 값 */
const syncFp = (w) => {
  const r4 = (v) => (Number(v) || 0).toFixed(4), r2 = (v) => (Number(v) || 0).toFixed(2);
  const ps = (w.positions || []).map(p => {
    const tr = Array.isArray(p.tr) && p.tr.length ? p.tr.filter(t => Number(t.px) > 0).slice(0, 10) : [{ d: p.date, px: p.avg, amt: 0 }];
    return `${String(p.t || "").toUpperCase()}|${p.role || "swing"}|${tr.map(t => `${String(t.d || "").slice(0, 10)}:${r4(t.px)}:${r2(t.amt)}`).join(",")}`;
  }).sort().join(";");
  const nt = Object.entries(w.notes || {}).filter(([, v]) => v && (v.m || v.tg > 0)).map(([k, v]) => `${k.toUpperCase()}:${v.m || ""}:${v.tg > 0 ? v.tg : ""}`).sort().join(";");
  return [ps, [...(w.watch || [])].sort().join(","), [...(w.extras || [])].map(x => String(x).toUpperCase()).sort().join(","),
          JSON.stringify((w.trades || []).slice(-300)), nt].join("#");
};
/** 서버의 보유 → 앱 형식 */
const posFromServer = (sp) => (Array.isArray(sp) ? sp : []).map((p, i) => ({ id: Date.now() + i, t: p.t, role: p.role || "swing", date: p.date || (p.tr?.[0]?.d) || "",
  ...(p.conv ? { conv: p.conv } : {}), ...(p.tr?.length ? { tr: p.tr } : { avg: p.avg }) }));
/** 서버 기록 읽기 — 저장 직후 값이 바로 보이는 API 먼저, 안 되면 배포된 파일 */
async function getWatchServer() {
  try { const r = await fetch("/api/watchlist?t=" + Date.now(), { cache: "no-store" }); if (r.ok) { const j = await r.json(); if (j && (j.positions || j.watch)) return j; } } catch {}
  try { const r = await fetch("/data/watchlist.json?t=" + Date.now()); if (r.ok) return await r.json(); } catch {}
  return null;
}
/* ★ 증권사 (보조) — 증권사 카드의 "오늘 살 것"을 오늘 탭과 똑같이 고름 (이 기기의 보유·칸 수·매출 필터 기준). 빼려면 이 함수도 삭제 */
const brokerPicks = (stocks, pos, genDay, fx, m = "us", market = null) => {
  if (!stocks || !Object.keys(stocks).length) return { list: [], note: "" };
  const plan = loadPlan();
  const dayOf = (p) => String(p.date || trOf(p)[0]?.d || "");
  const bought = new Set((pos || []).filter(p => (p.role || "swing") === "swing" && genDay && dayOf(p) >= genDay).map(p => String(p.t).toUpperCase()));
  const heldBefore = new Set((pos || []).map(p => String(p.t).toUpperCase()).filter(t => !bought.has(t)));
  const P = pickToday(stocks, pickCfg(market, plan), heldBefore);
  const all = (m === "kr" ? P.pickKr : P.pickUs).filter(r => !bought.has(r.t));
  if (m === "kr" && krGateOf(market)) return { list: [], note: "오늘 탭 기준: 한국 시장 위험 — 한국은 새로 사지 않습니다 (폭 3년 하위 40% 아래)" };
  if (m === "us" && usGateOf(market)) return { list: [], note: `오늘 탭 기준: 나스닥100 이 200일선 아래(${pct(market.judge.us.nq200, 1)})라 미국은 새로 사지 않습니다` };
  const sl = slotInfo(pos, m), pa = planAmounts(plan, fx), flag = m === "kr" ? "한국" : "미국";
  if (!pa || !((m === "kr" ? pa.kr : pa.us) > 0))                       // 오늘 탭과 같은 판정 — 투자금 0이면 살 것 없음
    return { list: [], note: `오늘 탭 기준: ${flag} 투자금이 0이라 살 것이 없습니다` };
  const list = all.slice(0, sl.free);
  return { list, note: sl.free === 0 ? `오늘 탭 기준: 칸이 다 차서(보유 ${sl.held}/${sl.n}칸) 살 것이 없습니다` : all.length > list.length ? `오늘 탭 기준: 빈 칸 ${sl.free}개만큼만 · 대기 ${all.length - list.length}개는 빼고 보여 줍니다` : all.length === 0 ? "오늘 탭 기준: 조건에 맞는 종목이 없습니다" : "" };
};

/* ══════════════════════════════════════════════════════════
   메인
   ══════════════════════════════════════════════════════════ */
/* 탭 순서 = 하루 루틴: 오늘(시장·할 일) → 찾기 → 차트 → 내 종목 → DC(월 1회) → 점검(주 1회) */
/* 탭 순서 = 루틴: 오늘 → 찾기 → 내 종목 → 종목풀(주 1회) → DC(월 1회) → 점검(주 1회)
   차트는 탭이 아니라, 어디서든 종목을 누르면 위로 올라오는 화면입니다 */
const TAB_DEF = [
  ["market", "☀️", "오늘"], ["find", "🔍", "찾기"], ["track", "📁", "내 종목"],
  ["alloc", "🏦", "DC"], ["review", "✅", "점검"], ["pool", "📦", "종목풀"],
];

export default function App() {
  const [snap, setSnap] = useState(null);
  const [market, setMarket] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState(() => { const t = sessionStorage.getItem("v6.tab"); return t === "over" ? "find" : (t === "chart" || !t) ? "market" : t; });
  const [chartOpen, setChartOpen] = useState(false);      // 39. 차트 = 위로 올라오는 화면
  const [sel, setSel] = useState(null);
  const [sizerTick, setSizerTick] = useState(0);
  const bumpSizer = useCallback(() => setSizerTick(t => t + 1), []);
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const hdrRef = useRef(null);
  useEffect(() => {
    const el = hdrRef.current; if (!el) return;
    const set = () => document.documentElement.style.setProperty("--hdr", `${el.getBoundingClientRect().height}px`);
    set();
    const ro = new ResizeObserver(set); ro.observe(el);
    return () => ro.disconnect();
  }, [snap, market]);   // 데이터가 오기 전엔 헤더가 없어서, 온 뒤에 다시 붙입니다
  const [uni, setUni] = useState(null);   // 주간 종목풀 점검 기록 (작은 파일, 한 번만 읽습니다)
  const [siglog, setSiglog] = useState(null);   // 실전 장부 — 최근 신호 모아보기·성과 측정
  const [today, setToday] = useState(null);
  const [picksLog, setPicksLog] = useState(null);  // 152. 날마다의 '오늘 살 것' 기록 (복기·차트 표시)     // 파이프라인이 확정한 오늘 후보 (앱·텔레그램·AI 도구가 같은 것을 봄)
  const [cfgTick, setCfgTick] = useState(0);
  const [notes, setNotes] = useState(() => loadJSON(NOTE_KEY, {}));
  const setNote = useCallback((t, patch) => setNotes(o => {
    const cur = { ...(o[t] || {}), ...patch }; const n = { ...o };
    if (!cur.m && !(cur.tg > 0)) delete n[t]; else n[t] = cur;
    try { localStorage.setItem(NOTE_KEY, JSON.stringify(n)); } catch {}
    return n;
  }), []);
  useEffect(() => { const f = () => setCfgTick(x => x + 1); window.addEventListener("v11:settings", f); return () => window.removeEventListener("v11:settings", f); }, []);
  const [syncState, setSyncState] = useState(() => ({ at: localStorage.getItem("v7.sync.at"), ok: true }));
  useEffect(() => {
    getJson("/data/today.json?t=" + Date.now()).then(setToday).catch(() => {});
    getJson("/data/picks_log.json?t=" + Date.now()).then(j => setPicksLog(Array.isArray(j) ? j : [])).catch(() => setPicksLog([]));   // 152
  }, []);
  // 266. 신호 장부(약 140KB)·종목풀 기록은 쓰는 탭(찾기·점검·종목풀)을 처음 열 때만 받음 — 첫 화면을 가볍게
  const lazyRef = useRef({});
  useEffect(() => {
    const L = lazyRef.current;
    if ((tab === "find" || tab === "review") && !L.sig) { L.sig = 1; fetch("/data/signals_log.json?t=" + Date.now()).then(r => r.ok ? r.json() : null).then(setSiglog).catch(() => { L.sig = 0; }); }
    if ((tab === "review" || tab === "pool") && !L.uni) { L.uni = 1; fetch("/data/universe_log.json?t=" + Date.now()).then(r => r.ok ? r.json() : null).then(setUni).catch(() => { L.uni = 0; }); }
  }, [tab]);
  // 82. 내 원칙 — 주 1회(그 주 토요일), 앱을 처음 열 때 먼저 확인합니다. 매일 뜨면 누르는 습관이 생겨 의미가 없어짐
  const today0 = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const weekKey0 = weekKey();
  const [rulesOpen, setRulesOpen] = useState(() => {
    try { return localStorage.getItem("v7.rules.wk") !== weekKey0; } catch { return true; }
  });
  const closeRules = useCallback(() => {
    try { localStorage.setItem("v7.rules.wk", weekKey0); localStorage.setItem("v7.rules.ack", today0); } catch {}
    setRulesOpen(false);
  }, [today0, weekKey0]);
  const [, setNow] = useState(0);
  useEffect(() => { const id = setInterval(() => setNow(n => n + 1), 60000); return () => clearInterval(id); }, []);
  useEffect(() => { try { sessionStorage.setItem("v6.tab", tab); } catch {} window.scrollTo(0, 0); }, [tab]);

  /* ── 내 기록 (이 기기 브라우저에만 저장) ── */
  const [watch, setWatch] = useState(() => { try { return JSON.parse(localStorage.getItem("v4.watch") || "[]"); } catch { return []; } });
  const [extras, setExtras] = useState(() => { try { return JSON.parse(localStorage.getItem("v7.extras") || "[]"); } catch { return []; } });
  const [trades, setTrades] = useState(() => { try { return JSON.parse(localStorage.getItem("v7.trades") || "[]"); } catch { return []; } });
  useEffect(() => { localStorage.setItem("v7.extras", JSON.stringify(extras)); }, [extras]);
  // 219. 한 번만 — 10/30 기록만 해 둔 GH 를 지우며 생긴 가짜 매매 기록(같은 값에 사고팖 · 손익 0) 제거
  useEffect(() => {
    try { if (localStorage.getItem("v13.17.ghFix")) return; localStorage.setItem("v13.17.ghFix", "1"); } catch { return; }
    setTrades(v => v.filter(x => !(x.t === "GH" && x.in === "2026-10-30" && Math.abs((x.buy || 0) - (x.sell || 0)) < 1e-6)));
  }, []);
  // 214. 한 번만 — 10/29 메리츠 잔고를 넣으며 종목풀에 더했던 장기 종목 중 다 판 것은 빼서 매일 수집 시간을 아낌 (보유·관심이면 그대로)
  useEffect(() => {
    try { if (localStorage.getItem("v13.16.extrasClean")) return; localStorage.setItem("v13.16.extrasClean", "1"); } catch { return; }
    const sold = ["IREN", "SCHD", "TEM", "TLT", "TMF", "TWST"];
    const keep = new Set([...(JSON.parse(localStorage.getItem("v4.pos") || "[]")).map(p => String(p.t).toUpperCase()), ...JSON.parse(localStorage.getItem("v4.watch") || "[]")]);
    setExtras(v => v.filter(t => !sold.includes(t) || keep.has(t)));
  }, []);
  useEffect(() => { localStorage.setItem("v7.trades", JSON.stringify(trades)); }, [trades]);
  const [pos, setPos] = useState(() => { try { return JSON.parse(localStorage.getItem("v4.pos") || "[]"); } catch { return []; } });
  const [brokerSync, setBrokerSync] = useState({});
  /* 234. 앱을 열면 메리츠(실계좌) 잔고를 뒤에서 미리 불러옴 — 내 종목 탭을 열기 전에도 오늘 탭·서버(텔레그램)가 '메리츠 기준'으로 보게
   *   비밀번호가 이 기기에 저장돼 있을 때만 · 잔고만(주문 내역은 내 종목 탭 카드가) · 주문 창에서 체결되면 다시 불러옴 */
  const loadBrokerBg = useCallback(async (force) => {
    const pin = (() => { try { return localStorage.getItem("v7.kis.pin") || ""; } catch { return ""; } })();
    if (!pin) return;
    try {
      const info = await fetch("/api/broker").then(r => r.ok ? r.json() : null).catch(() => null);
      if (!info?.configured || info.env !== "real") return;
      const tk = `v7.kis.tok.${info.broker || "x"}`;
      const kr = (JSON.parse(localStorage.getItem("v4.pos") || "[]")).some(p => /^\d{6}$/.test(String(p.t)));
      for (const mk of kr ? ["us", "kr"] : ["us"]) {
        const r = await fetch("/api/broker", { method: "POST", headers: { "Content-Type": "application/json", "x-kis-pin": pin },
          body: JSON.stringify({ what: "balance", ...(mk === "kr" ? { mk: "kr" } : {}), tok: localStorage.getItem(tk) || "" }) });
        const j = await r.json().catch(() => ({}));
        if (j.tok) { try { localStorage.setItem(tk, j.tok); } catch {} }
        if (!j.ok || !Array.isArray(j.rows)) continue;
        setBrokerSync(v => (v[mk] && !force) ? v : { ...v, [mk]: { ...(v[mk] || {}), mk, broker: info.broker, label: info.label, env: "real", rows: j.rows, orders: v[mk]?.orders || [], at: Date.now() } });
      }
    } catch { /* 조용히 — 내 종목 탭에서 다시 불러옴 */ }
  }, []);
  useEffect(() => { loadBrokerBg(false); }, [loadBrokerBg]);
  useEffect(() => { const f = () => setTimeout(() => loadBrokerBg(true), 1500); window.addEventListener("order-filled", f); return () => window.removeEventListener("order-filled", f); }, [loadBrokerBg]);
  // 234. 메리츠 잔고에 없는 단기 보유 — 이미 팔았거나 잘못 들어간 기록. 오늘 탭·찾기 탭은 이걸 뺀 '메리츠 기준 보유'로 계산
  const brokerMiss = useMemo(() => {
    const have = new Set(); const at = {};
    Object.values(brokerSync).forEach(k => { if (k && k.env === "real" && Array.isArray(k.rows)) { at[k.mk] = new Date((k.at || Date.now()) + 9 * 3600000).toISOString().slice(0, 10); k.rows.forEach(r => have.add(String(r.t).toUpperCase().replace("/", "-"))); } });
    // 잔고를 본 날 이후에 산 종목(그 사이 체결)은 아직 잔고에 안 보일 수 있어 빼지 않음
    return (pos || []).filter(p => (p.role || "swing") === "swing" && at[mktOfT(p.t)] && !have.has(String(p.t).toUpperCase()) && String(trOf(p)[0]?.d || p.date || "") < at[mktOfT(p.t)]);
  }, [brokerSync, pos]);
  const posEff = useMemo(() => { const ids = new Set(brokerMiss.map(p => p.id)); return ids.size ? pos.filter(p => !ids.has(p.id)) : pos; }, [pos, brokerMiss]);
  const [orderReq, setOrderReq] = useState(null);   // 210. 주문 창 — openOrder() 가 어디서든 엶
  useEffect(() => { const f = (e) => setOrderReq(e.detail ? { ...e.detail, k: Date.now() } : null); window.addEventListener("order-open", f); return () => window.removeEventListener("order-open", f); }, []);
  useEffect(() => { const f = () => { setChartOpen(false); setTab("track"); }; window.addEventListener("go-track", f); return () => window.removeEventListener("go-track", f); }, []);   // 221. 주문 창 '내 종목으로'       // 184. 증권사 잔고·주문 (시장별) — 내 종목 '체결 반영'이 읽음
  useEffect(() => { localStorage.setItem("v4.watch", JSON.stringify(watch)); }, [watch]);
  useEffect(() => { localStorage.setItem("v4.pos", JSON.stringify(pos)); }, [pos]);
  // 228. 주문 창에서 '체결'을 확인하면 그 자리에서 내 종목에 반영 (내 종목 탭 자동 반영과 같은 함수 · 같은 체결은 다시 안 넣음)
  const posRef = useRef(pos); posRef.current = pos;
  useEffect(() => {
    const f = (e) => {
      const o = e.detail; if (!o?.t || !(o.filled > 0)) return;
      const cur = posRef.current, m = o.mk === "kr" ? "kr" : "us";
      const done = new Set(loadJSON("v13.kis.applied", []));
      const plan = planFills({ orders: [o], rows: [], pos: cur.filter(p => mktOfT(p.t) === m), applied: done });
      const items = plan.items.filter(i => i.kind !== "partial");
      try { localStorage.setItem("v13.kis.applied", JSON.stringify([...done, o.odno].slice(-500))); } catch {}
      if (!items.length) return;
      const r = applyFills(cur, items, { src: "meritz", mOf: mktOfT, nameOf: t => stocks?.[t]?.n });
      setPos(r.pos); if (r.trades.length) setTrades(v => [...v, ...r.trades].slice(-300));
    };
    window.addEventListener("order-filled", f); return () => window.removeEventListener("order-filled", f);
  });

  /* ── 데이터 로드 ── */
  useEffect(() => {
    (async () => {
      try {
        const [a, b] = await Promise.all([
          getJson("/data/snapshot.json?t=" + Date.now()).then(j => j || Promise.reject(new Error("snapshot"))),
          getJson("/data/market.json?t=" + Date.now()).then(j => j || Promise.reject(new Error("market"))),
        ]);
        setSnap(a); setMarket(b); genRef.current = b?.meta?.generatedAt || null; loadedAt.current = Date.now();
      } catch (e) { setErr(e.message); }
    })();
  }, []);
  /* 119. 앱을 켜 둔 채 돌아왔을 때 — 서버 데이터가 새로 만들어졌으면 다시 받습니다 (작은 market.json 으로 먼저 확인 · 5분에 한 번까지) */
  const genRef = useRef(null), loadedAt = useRef(0);
  useEffect(() => {
    let busy = false;
    const check = async () => {
      if (document.hidden || busy || Date.now() - loadedAt.current < 5 * 60000) return;
      busy = true;
      try {
        const b = await getJson("/data/market.json?t=" + Date.now());
        loadedAt.current = Date.now();
        const g = b?.meta?.generatedAt;
        if (g && g !== genRef.current) {
          const a = await getJson("/data/snapshot.json?t=" + Date.now());
          if (a?.stocks && a?.meta?.generatedAt === g) { setSnap(a); setMarket(b); genRef.current = g; }
        }
      } catch { /* 다음에 다시 */ }
      busy = false;
    };
    const id = setInterval(check, 5 * 60000);
    const now = () => { loadedAt.current = 0; check(); };          // 218. 주문 창을 열 때 — 5분 기다리지 않고 바로 최신 데이터인지 확인
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener("app-data-check", now);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", check); window.removeEventListener("focus", check); window.removeEventListener("app-data-check", now); };
  }, []);

  /* ── 후보 체류일 ── */
  const seenRef = useRef(null);
  if (seenRef.current === null) {
    try { seenRef.current = JSON.parse(localStorage.getItem("v5.seen") || "{}"); }
    catch { seenRef.current = {}; }
  }
  const seen = useMemo(() => ({
    days: (t) => {
      const r = seenRef.current[t];
      if (!r) return null;
      return Math.max(1, Math.round((Date.now() - r.first) / 86400000) + 1);
    },
  }), []);
  useEffect(() => {
    if (!snap) return;
    const today = kstDay();
    const store = seenRef.current, now = Date.now();
    const cur = Object.values(snap.stocks || {}).filter(x =>
      (x.tvr ?? 0) >= RULES.tvrMin && x.tmpl && (x.rs ?? 0) >= RULES.signal.rsMin);
    for (const x of cur) {
      const r = store[x.t];
      if (!r) store[x.t] = { first: now, last: today };
      else r.last = today;
    }
    for (const k of Object.keys(store)) {
      const d = (now - new Date(store[k].last + "T00:00:00Z").getTime()) / 86400000;
      if (d > 30) delete store[k];
    }
    localStorage.setItem("v5.seen", JSON.stringify(store));
  }, [snap]);

  const openStock = useCallback((t) => {
    setSel(t); setChartOpen(true); setSearchOpen(false); setQ("");
    try { window.history.pushState({ chart: t }, ""); } catch {}
  }, []);
  const closeChart = useCallback(() => { setChartOpen(false); }, []);
  useEffect(() => {   // 폰 '뒤로' 버튼 = 차트 닫기
    const onPop = () => setChartOpen(false);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // 차트 안에서 다른 탭으로 보내는 동작(내 종목에서 보기 등)은 차트를 닫고 이동
  const goTab = useCallback((t) => { setChartOpen(false); setTab(t); }, []);
  const toggleWatch = useCallback((t) => setWatch(w => w.includes(t) ? w.filter(x => x !== t) : [...w, t]), []);

  // 296. 행동 판정(action·why)은 파이프라인 scripts/snap/signals.py 한 곳에서만 정합니다 — 앱이 같은 규칙을 따로 갖고 있으면 서로 어긋나서, 옛 데이터용 대체 계산을 지웠습니다.
  const rawStocks = useMemo(() => snap?.stocks || {}, [snap]);
  const etfs = snap?.etfs || {};
  const rawList = useMemo(() => Object.values(rawStocks), [rawStocks]);
  const updMs = snap?.meta?.generatedAt ? new Date(snap.meta.generatedAt).getTime() : null;
  const fr = freshness(updMs);
  const asOfBy = useMemo(() => {
    // 299. 그 시장 종목 대부분이 가진 날짜 — 화면 위 '신호 기준' 줄(asOfOf)과 같은 계산 (예전엔 최신 10%의 날짜라 일부만 새 종가여도 '최신'으로 나옴)
    return { kr: asOfOf(rawStocks, "kr") || null, us: asOfOf(rawStocks, "us") || null };
  }, [rawStocks]);
  // 시장 기준일보다 7일 넘게 멈춘 종목(거래정지·합병·상장폐지)은 모든 탭에서 뺍니다
  const { stocks, list, nStale } = useMemo(() => {
    const ok = (s) => {
      const ref = asOfBy[s.m === "kr" ? "kr" : "us"];
      if (!ref || !s.asOf) return true;
      return (new Date(ref) - new Date(s.asOf)) / 86400000 <= 7;
    };
    const l = rawList.filter(ok);
    return { stocks: Object.fromEntries(l.map(s => [s.t, s])), list: l, nStale: rawList.length - l.length };
  }, [rawList, asOfBy]);

  /* 사이저 — 계좌별 자본(원화/달러)과 종목당 한도. 손절 폭은 없습니다: 청산은 트레일링선 하나.
     1회차 = 한도의 절반, 2회차 = +3% 확인 후 나머지 절반 (검증: 총수익·투입효율의 균형점) */
  const sizer = useMemo(() => {
    const fx = market?.fx?.usdkrw || null;
    const pa = planAmounts(loadPlan(), fx);      // 💰 투자금에서만 계산 — 정하지 않았으면 0 (예전엔 2,000만·$5,000 기본값으로 주수를 보여 줬음)
    const capKr = pa ? pa.kr : 0, capUs = pa?.us ?? 0;
    const limKr = pa ? pa.limKr : 0, limUs = pa?.limUs ?? 0;
    const limit = (m) => (m === "us" ? limUs : limKr);
    const cap = (m) => (m === "us" ? capUs : capKr);
    return {
      capKr, capUs, limKr, limUs, fx, limit, cap, plan: pa,
      slots: (m) => Math.max(1, Math.floor(cap(m) / limit(m)) || 1),     // 97. 금액 0 이면 0÷0 이 되지 않게
      tranche: (m, k) => limit(m) * 0.5,                    // 1·2회차 모두 절반
      shares: (px, m) => (px ? Math.floor(limit(m) * 0.5 / px) : null),
    };
  }, [market, sizerTick]);

  // 차트·추적에서 쓰는 전체 조회표 — 종목 + ETF(미국 원본·국내 업종) + DC 매수용 국내 상품
  const items = useMemo(() => {
    const m = { ...etfs };
    for (const d of Object.values(etfs)) {
      const v = d.veh;
      if (v?.code && !m[v.code]) m[v.code] = { t: v.code, n: v.name, m: "kr", c: v.c, d1: v.d1, d21: v.d21, asOf: v.asOf,
        etf: true, vehOf: d.t, stSlow: d.stSlow, slowDays: d.slowDays, st: d.st };
    }
    return { ...m, ...stocks };
  }, [etfs, stocks]);
  const results = useMemo(() => {
    const k = q.trim().toLowerCase(); if (!k) return [];
    return Object.values(items).filter(s => s.t.toLowerCase().includes(k) || (s.n || "").toLowerCase().includes(k)).slice(0, 10);
  }, [q, items]);

  /* ★ 228. 기기 간 맞추기 — 서버(watchlist.json)가 기준입니다 (2026-10-31: 옛 기록이 남은 PC 가 폰의 보유를 덮어쓴 사고)
   *   · 열 때 · 화면으로 돌아올 때 서버를 봄 → 다른 기기가 더 최근에 바꿨으면 그 기록으로 맞춤(이 기기 기록은 따로 보관)
   *   · 이 기기에도 아직 못 올린 변경이 있으면 둘 중 고르게 함 (자동으로 덮어쓰지 않음)
   *   · 올릴 때 '마지막으로 본 서버 시각'을 같이 보내, 그 사이 다른 기기가 바꿨으면 서버가 거절(409) */
  const [syncNote, setSyncNote] = useState(null);      // { txt, bak? } — 아래에 잠깐 뜨는 알림
  useEffect(() => { if (!syncNote || syncNote.bak) return; const id = setTimeout(() => setSyncNote(null), 6000); return () => clearTimeout(id); }, [syncNote]);
  const [syncReady, setSyncReady] = useState(false);
  const [conflict, setConflict] = useState(null);      // 서버 기록 (둘 다 바뀐 경우)
  const [syncRetry, setSyncRetry] = useState(0);
  const adoptRef = useRef(false), keyRef = useRef(""), chkRef = useRef(Date.now());
  const bodyOf = () => {
    const plan = loadPlan();
    // 234. 메리츠 잔고 요약(종목·수량·날짜) — 텔레그램·오늘 후보가 '메리츠에 없는 기록'을 알아보게. 날짜만 적어 하루 한 번만 바뀜
    const bk = {}; Object.values(brokerSync).forEach(k => { if (k && k.env === "real" && Array.isArray(k.rows)) bk[k.mk] = k.rows.map(r => [String(r.t).toUpperCase(), Number(r.qty) || 0]).sort(); });
    return { bulk: true, positions: pos, watch, extras, excludes: loadJSON("v10.excludes", []), trades: (trades || []).slice(-300), notes,
             ...(Object.keys(bk).length ? { broker: { d: kstDay(), ...bk } } : {}),
             settings: { revMin: getRevMin(), slotsUs: plan.slotsUs || SLOTS_DEFAULT.us, slotsKr: plan.slotsKr || SLOTS_DEFAULT.kr,
                         dcAmt: plan.dcAmt || 0, dcMode: dcModeOf(), dcSemi: false,
                         ...(planAmounts(plan, 1) ? { usAmt: plan.usAmt || 0, krAmt: plan.krAmt || 0 } : {}) } };   // 98. 💰 투자금을 정했을 때만
  };
  keyRef.current = JSON.stringify(bodyOf());
  /** 서버 기록으로 이 기기를 맞춤 — 이 기기 기록은 v13.localBak 에 보관(되살리기 가능) */
  const adopt = (w, why) => {
    const here = { positions: pos, watch, trades, notes, extras };
    const hadHere = (pos || []).length + (watch || []).length + (trades || []).length > 0;
    let bak = false;
    if (hadHere && syncFp(here) !== syncFp(w)) {
      try { localStorage.setItem(LOCAL_BAK, JSON.stringify({ at: new Date().toISOString(), pos, watch, extras, trades, notes })); bak = true; } catch {}
    }
    adoptRef.current = true;
    setPos(posFromServer(w.positions)); setWatch(Array.isArray(w.watch) ? w.watch : []);
    setExtras(Array.isArray(w.extras) ? w.extras : []); setTrades(Array.isArray(w.trades) ? w.trades : []);
    const nt = w.notes && typeof w.notes === "object" ? w.notes : {};
    setNotes(nt); try { localStorage.setItem(NOTE_KEY, JSON.stringify(nt)); } catch {}
    try {
      localStorage.setItem("v10.excludes", JSON.stringify(Array.isArray(w.excludes) ? w.excludes : []));
      const st = w.settings;
      if (st && typeof st === "object") {
        const pl = loadPlan();
        localStorage.setItem(PLAN_KEY, JSON.stringify({ ...pl, slotsUs: st.slotsUs || pl.slotsUs, slotsKr: st.slotsKr || pl.slotsKr,
          ...(st.dcAmt > 0 ? { dcAmt: st.dcAmt } : {}), ...(st.usAmt > 0 ? { usAmt: st.usAmt } : {}), ...(st.krAmt > 0 ? { krAmt: st.krAmt } : {}) }));
        if (st.revMin != null) localStorage.setItem(REV_KEY, String(st.revMin));
        if (st.dcMode) localStorage.setItem("v9.dc.mode", st.dcMode === "hold" ? "hold" : "st");
        setSizerTick(x => x + 1);
      }
    } catch {}
    if (w.updatedAt) localStorage.setItem(SYNC_BASE, w.updatedAt);
    setConflict(null);
    const n = (w.positions || []).length, m = (w.watch || []).length;
    if (why) setSyncNote({ txt: `${why} — 보유 ${n} · 관심 ${m}${bak ? " · 이 기기에 있던 기록은 따로 보관했습니다" : ""}`, bak });
  };
  /** 서버를 보고 맞춤 — 처음 열 때 · 화면으로 돌아올 때 */
  const checkServer = async (first) => {
    const w = await getWatchServer();
    if (!w) return;
    const base = localStorage.getItem(SYNC_BASE) || "";
    const unsynced = keyRef.current !== localStorage.getItem("v11.syncKey");     // 이 기기에 아직 못 올린 변경
    const serverHas = (w.positions || []).length + (w.watch || []).length + (w.trades || []).length > 0;
    const here = { positions: pos, watch, trades, notes, extras };
    if (!serverHas) { if (w.updatedAt && !base) localStorage.setItem(SYNC_BASE, w.updatedAt); return; }   // 서버가 비어 있으면 이 기기 것을 올림 (아래 자동 동기화)
    if (base && w.updatedAt && Date.parse(w.updatedAt) <= Date.parse(base)) return;   // 새로 바뀐 것 없음 (늦게 읽힌 옛 값도 무시)
    if (syncFp(here) === syncFp(w)) { if (w.updatedAt) localStorage.setItem(SYNC_BASE, w.updatedAt); return; }   // 내용이 같음
    const empty = (pos || []).length + (watch || []).length === 0;
    if (empty) { adopt(w, "이 기기에 기록이 없어 서버에 저장된 기록을 불러왔습니다"); return; }
    // 처음(이 기능이 생기기 전 기기) — 어느 쪽이 최근인지 알 수 없어 고르게 함. 10/31 처럼 옛 PC 기록이 서버에 올라가 있을 수 있음
    if (!base) { setConflict({ ...w, first: true }); return; }
    if (!unsynced) { adopt(w, "다른 기기에서 바뀐 기록으로 맞췄습니다"); return; }
    setConflict(w);                                                               // 둘 다 바뀜 → 고르게 함
    if (!first) setSyncNote(null);
  };
  useEffect(() => { checkServer(true).catch(() => {}).finally(() => setSyncReady(true)); }, []);   // eslint-disable-line
  useEffect(() => {      // 다른 기기에서 쓰다가 이 화면으로 돌아오면 다시 확인
    const f = () => { if (document.visibilityState !== "visible" || !syncReady || Date.now() - chkRef.current < 15000) return; chkRef.current = Date.now(); checkServer(false).catch(() => {}); };
    document.addEventListener("visibilitychange", f); window.addEventListener("focus", f);
    return () => { document.removeEventListener("visibilitychange", f); window.removeEventListener("focus", f); };
  });

  // ★ 60·61. 자동 동기화 — 바뀐 게 있으면 3초 뒤 서버(watchlist.json)에 올립니다. 텔레그램·장중 감시·오늘 후보가 같은 값을 씁니다
  useEffect(() => {
    const key = keyRef.current;
    if (!syncReady || conflict) return;                                // 서버 확인 전 · 고르는 중엔 올리지 않음
    if (adoptRef.current) { adoptRef.current = false; localStorage.setItem("v11.syncKey", key); return; }   // 방금 서버 것을 받음 — 되올리지 않음
    if ((pos || []).length === 0 && (watch || []).length === 0) return;   // 빈 상태는 자동으로 올리지 않음 (수동 '다시 보내기'만)
    if (key === localStorage.getItem("v11.syncKey")) return;
    const tm = setTimeout(async () => {
      try {
        const { r, j } = await postWatch(key);
        const at = new Date().toISOString().slice(0, 16).replace("T", " ");
        if (j.ok) { localStorage.setItem("v11.syncKey", key); localStorage.setItem("v7.sync.at", at); setSyncState({ at, ok: true }); }
        else if (j.error === "stale" || j.error === "old_app") { await checkServer(false); setTimeout(() => setSyncRetry(x => x + 1), 4000); }    // 다른 기기가 먼저 바꿈(또는 서버 시각을 아직 모름) → 받거나 고르게
        else { setSyncState(s => ({ ...s, ok: false, msg: j.message || j.error || `실패 (${r.status})` }));
               if (r.status >= 500) setTimeout(() => setSyncRetry(x => x + 1), 15000); }   // 깃허브 저장이 겹치면 잠시 뒤 다시
      } catch { setSyncState(s => ({ ...s, ok: false, msg: "네트워크 오류" })); setTimeout(() => setSyncRetry(x => x + 1), 30000); }
    }, 3000);
    return () => clearTimeout(tm);
  }, [pos, watch, extras, trades, cfgTick, notes, syncReady, conflict, syncRetry, brokerSync]);   // eslint-disable-line react-hooks/exhaustive-deps
  const restoreBak = () => {
    const b = loadJSON(LOCAL_BAK, null); if (!b) return;
    if (!confirm("이 기기에 있던 예전 기록으로 되돌리고 서버에도 올립니다. 다른 기기의 기록은 덮어써집니다. 진행할까요?")) return;
    setPos(b.pos || []); setWatch(b.watch || []); setExtras(b.extras || []); setTrades(b.trades || []); setNotes(b.notes || {});
    try { localStorage.setItem(NOTE_KEY, JSON.stringify(b.notes || {})); localStorage.removeItem(LOCAL_BAK); } catch {}
    setSyncNote({ txt: "이 기기 예전 기록으로 되돌렸습니다 — 서버에도 올립니다" });
  };

  if (err) return <Shell><Card style={{ borderColor: C.red, margin: "40px 12px" }}>
    <div style={{ color: C.red, fontWeight: 800, fontSize: FS.lg }}>데이터를 불러오지 못했습니다</div>
    <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 6 }}>{err}</div>
    <div style={{ fontSize: FS.sm, color: C.muted, marginTop: 8 }}>Actions → Daily Data Update 를 실행하세요.</div>
  </Card></Shell>;

  if (!snap || !market) return <Shell><div style={{ textAlign: "center", color: C.muted, marginTop: 80, fontSize: FS.md }}>불러오는 중…</div></Shell>;

  NOTES_REF.cur = notes;
  const mf = marketFresh(asOfBy);       // 106. 시장별 최신 여부
  const staleInfo = fr.tone === "lag" || fr.tone === "stale" || fr.tone === "old" || fr.tone === "bad" || !mf.kr.ok || !mf.us.ok
    ? { label: [!mf.kr.ok && `🇰🇷 ${mf.kr.txt}`, !mf.us.ok && `🇺🇸 ${mf.us.txt}`].filter(Boolean).join(" · ") || fr.label, us: asOfBy.us, kr: asOfBy.kr,
        okKr: mf.kr.ok, okUs: mf.us.ok, lag: fr.tone !== "fresh" && fr.tone !== "closed" } : null;       // 75. 주문 전에 보여줄 '최신 아님' 정보
  const genDay = String(snap?.meta?.generatedKST || "").slice(0, 10);       // 109. 이 데이터가 만들어진 날 (한국 날짜) — '오늘 산 종목' 판정
  const shared = { stocks, list, etfs, items, openStock, watch, toggleWatch, market, setTab, setSel, pos, setPos, syncState, staleInfo, notes, setNote, genDay,
                   seen, sizer, bumpSizer, extras, setExtras, trades, setTrades, siglog, today, picksLog, syncOk: syncReady && !conflict };
  const nTrack = pos.length + watch.length;
  const warn = fr.tone === "stale" || fr.tone === "old" || fr.tone === "bad";

  return (
    <Shell>
      {rulesOpen && snap && <RulesPopup onClose={closeRules} sizer={sizer} />}
      {syncNote && (     /* 228. 서버 기록으로 맞췄다는 알림 — 보관한 기록이 있으면 되살리기 */
        <div role="status" style={{ position: "fixed", left: 12, right: 12, bottom: 84, zIndex: 120, padding: "10px 12px", borderRadius: 10,
                                    background: "rgba(16,185,129,.96)", color: "#04120c", fontSize: FS.sm, fontWeight: 700, lineHeight: 1.5 }}>
          {syncNote.txt}
          <div style={{ display: "flex", gap: 8, marginTop: syncNote.bak ? 8 : 0 }}>
            {syncNote.bak && <button onClick={() => { setSyncNote(null); restoreBak(); }} style={{ ...btn("#04120c"), minHeight: 36, flex: 1, fontSize: FS.xs, color: "#04120c", borderColor: "#04120c88" }}>이 기기 예전 기록으로 되돌리기</button>}
            {syncNote.bak && <button onClick={() => setSyncNote(null)} style={{ ...btn("#04120c"), minHeight: 36, flex: 1, fontSize: FS.xs, color: "#04120c", borderColor: "#04120c88" }}>확인</button>}
          </div>
        </div>)}
      {conflict && (     /* 228. 이 기기와 다른 기기가 둘 다 바뀜 — 자동으로 덮어쓰지 않고 고르게 함 */
        <div role="alertdialog" aria-label="기록 고르기" style={{ position: "fixed", inset: 0, zIndex: 700, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div style={{ background: C.panel, width: "100%", maxWidth: 560, borderRadius: "16px 16px 0 0", padding: "16px 16px calc(18px + env(safe-area-inset-bottom))", borderTop: `2px solid ${C.gold}` }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.gold }}>{conflict.first ? "이 기기와 서버 기록이 다릅니다 (처음 한 번)" : "다른 기기에서도 기록이 바뀌었습니다"}</div>
            <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 6, lineHeight: 1.6 }}>
              {conflict.first ? "실제 보유(메리츠)와 맞는 쪽을 골라 주세요. 한 번 고르면 다음부터는 기기끼리 자동으로 맞춥니다. " : "어느 쪽 기록을 쓸지 골라 주세요. "}고르기 전에는 아무것도 올리지 않습니다.</div>
            {[[conflict.first ? "서버" : "다른 기기 (서버)", conflict.positions || [], conflict.watch || [], (conflict.trades || []).length, conflict.updatedAt],
              ["이 기기", pos, watch, (trades || []).length, null]].map(([k, ps, w, tn, at]) => (
              <div key={k} style={{ marginTop: 8, padding: "8px 10px", borderRadius: 10, background: "rgba(255,255,255,.04)", border: `1px solid ${C.border}`, fontSize: FS.sm, lineHeight: 1.5 }}>
                <b>{k}</b>{at ? <span style={{ color: C.muted, fontSize: FS.xs }}> · {new Date(at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 저장</span> : null}
                <div style={{ color: C.dim, fontSize: FS.xs }}>보유 {ps.length}{ps.length ? ` (${ps.slice(0, 6).map(p => p.t).join(" · ")}${ps.length > 6 ? " …" : ""})` : ""} · 관심 {w.length}{w.length ? ` (${w.slice(0, 5).join(" · ")}${w.length > 5 ? " …" : ""})` : ""} · 매매 기록 {tn}건</div>
              </div>))}
            <button onClick={() => adopt(conflict, "서버 기록으로 맞췄습니다")} style={{ ...btn(conflict.first ? C.cyan : C.emerald), width: "100%", minHeight: 46, marginTop: 10 }}>{conflict.first ? "서버 기록 쓰기" : "다른 기기 기록 쓰기 (권장)"}</button>
            <button onClick={() => { if (!confirm("이 기기 기록으로 서버를 덮어씁니다. 다른 기기에서 바꾼 내용은 사라집니다. 진행할까요?")) return;
                                     if (conflict.updatedAt) localStorage.setItem(SYNC_BASE, conflict.updatedAt); localStorage.removeItem("v11.syncKey"); setConflict(null); }}
              style={{ ...btn(conflict.first ? C.cyan : C.dim), width: "100%", minHeight: conflict.first ? 46 : 42, marginTop: 8 }}>{conflict.first ? "이 기기 기록 쓰기 (서버를 이걸로 바꿈)" : "이 기기 기록으로 덮어쓰기"}</button>
          </div>
        </div>)}
      {chartOpen && sel && (
        <div role="dialog" aria-label="종목 차트" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: "calc(62px + env(safe-area-inset-bottom, 0px))", zIndex: 150, background: C.bg, overflowY: "auto",
                                                         paddingTop: "env(safe-area-inset-top, 0px)" }}>
          <div style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
                        background: "rgba(10,14,26,.96)", backdropFilter: "blur(8px)", borderBottom: `1px solid ${C.border}` }}>
            <button onClick={() => { try { window.history.back(); } catch {} closeChart(); }} aria-label="닫기"
              style={{ ...btn(C.dim), minHeight: 38, padding: "0 14px" }}>← 닫기</button>
            <span style={{ fontSize: FS.md, fontWeight: 800, fontFamily: MONO }}>{sel}</span>
            <span style={{ fontSize: FS.xs, color: C.muted, marginLeft: "auto" }}>뒤로 버튼으로도 닫힘</span>
          </div>
          <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 12px 40px" }}>
            <ChartTab {...shared} setTab={goTab} stocks={items} sel={sel} />
          </div>
        </div>)}
      {/* ═══ 상단 바 — 한 줄 ═══ (높이가 상황마다 달라 --hdr 로 재어 둡니다: 목록 고정 바가 그 아래에 붙습니다) */}
      <div ref={hdrRef} style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(10,14,26,.94)", backdropFilter: "blur(8px)",
                    WebkitBackdropFilter: "blur(8px)", borderBottom: `1px solid ${C.border}` }}>
        {searchOpen ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px" }}>
            <input value={q} onChange={e => setQ(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === "Enter" && results[0]) openStock(results[0].t); }}
              placeholder="종목명 또는 티커" style={{ ...inp("100%"), flex: 1, fontSize: 16 }} />
            <button onClick={() => { setSearchOpen(false); setQ(""); }} style={{ ...btn(C.dim), minWidth: 52 }}>닫기</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", minHeight: 50 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                          fontWeight: 800, fontSize: 15, background: "rgba(59,130,246,.14)", color: "#60A5FA", flexShrink: 0 }}>α</div>
            <button onClick={() => setStatusOpen(v => !v)} aria-expanded={statusOpen}
              style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, background: "none", border: "none",
                       color: C.text, cursor: "pointer", padding: "0", minHeight: 40, textAlign: "left" }}>
              <span style={{ fontSize: FS.xs, color: fr.krRegular ? C.emerald : C.muted, whiteSpace: "nowrap" }}>🇰🇷 {fr.krLabel}</span>
              <span style={{ fontSize: FS.xs, color: fr.usRegular ? C.emerald : C.muted, whiteSpace: "nowrap" }}>🇺🇸 {fr.usLabel}</span>
              <span style={{ fontSize: FS.xs, color: fr.color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fr.emoji} {fr.label}{(!mf.kr.ok || !mf.us.ok) && fr.tone === "fresh" ? ` · ⚠ ${[!mf.kr.ok && "🇰🇷", !mf.us.ok && "🇺🇸"].filter(Boolean).join("")} 늦음` : ""}</span>
              <span style={{ fontSize: 10, color: C.muted }}>{statusOpen ? "▴" : "▾"}</span>
            </button>
            <button onClick={() => setSearchOpen(true)} aria-label="종목 검색"
              style={{ ...btn(C.dim), width: 40, padding: 0, fontSize: 16 }}>🔍</button>
          </div>
        )}

        {/* 검색 결과 */}
        {searchOpen && q.trim() && (
          <div style={{ maxHeight: "60vh", overflowY: "auto", borderTop: `1px solid ${C.border}` }}>
            {results.length === 0 ? (
              <div style={{ padding: "12px 16px", fontSize: FS.sm, color: C.dim }}>
                “{q.trim()}” 는 종목풀에 없습니다
                <AddTicker code={q.trim().toUpperCase()} extras={extras} setExtras={setExtras} pos={pos} watch={watch} trades={trades} />
              </div>
            ) : results.map(r => (
              <div key={r.t} onClick={() => openStock(r.t)}
                style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", gap: 8, cursor: "pointer" }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{r.n}</span>
                <span style={{ fontSize: FS.sm, color: C.muted, flexShrink: 0 }}>{r.etf ? "ETF " : ""}{r.m === "kr" ? "🇰🇷" : "🇺🇸"} {r.t}</span>
              </div>))}
          </div>)}

        {/* 상태 펼침 */}
        {statusOpen && !searchOpen && (
          <div style={{ padding: "4px 12px 12px", display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: FS.sm }}>
              <KV k="🇰🇷 신호 기준" v={mf.kr.txt} />
              <KV k="🇺🇸 신호 기준" v={mf.us.txt} />
              <KV k="데이터 생성" v={mdt(snap.meta.generatedKST)} />
              <KV k="다음 수집" v={`🇰🇷 ${nextCollect("kr")} · 🇺🇸 ${nextCollect("us")}`} />
            </div>
            <button onClick={() => { setTab("pool"); setStatusOpen(false); }} style={{ ...linkBtn, fontSize: FS.sm, minHeight: 34, textAlign: "left" }}>
              🔄 시세·재무 갱신, 🔁 종목풀 교체와 변경 내역은 📦 종목풀 탭에 있습니다 ›</button>
            {/* 데이터 검사 결과 — 제외된 종목이 소리 없이 사라지지 않게 */}
            <div style={{ fontSize: FS.xs, color: C.muted, lineHeight: 1.6 }}>
              {(() => {
                const h = snap.meta.health;
                if (!h) return <>종목 {list.length}{snap.meta.counts.failed > 0 && ` · 수집 실패 ${snap.meta.counts.failed}`}</>;
                const dr = Object.entries(h.dropped || {});
                return (<>
                  <span style={{ color: C.emerald }}>🩺 {h.kept}종목 검사 통과</span>
                  {h.mode === "focus" && <span style={{ color: C.gold }}> · 간이 수집 (전체 {h.fullUniverse} 중 신호 가능 종목만 · 토요일 전체 스캔)</span>}
                  {h.byMarket && <> (🇰🇷 {h.byMarket.kr?.kept ?? 0} · 🇺🇸 {h.byMarket.us?.kept ?? 0})</>}
                  {h.exchange && <> · 코스피 {h.exchange.KS} / 코스닥 {h.exchange.KQ}</>}
                  {market?.breadthAsOf && h.mode === "focus" && <> · 폭은 {md(market.breadthAsOf)} 전체 스캔 기준</>}
                  {dr.length > 0 && <><br />제외 {dr.map(([k, v]) => `${k} ${v}`).join(" · ")}</>}
                  {h.failed > 0 && <> · 수집 실패 {h.failed}</>}
                </>);
              })()}
              <br />{APP_VERSION} · 투자자문 아님
            </div>
          </div>)}

        {warn && !searchOpen && (
          <div style={{ padding: "7px 12px", fontSize: FS.sm, background: fr.tone === "old" ? "rgba(245,158,11,.12)" : "rgba(255,69,58,.12)",
                        color: fr.tone === "old" ? C.orange : C.red, fontWeight: 600 }}
            onClick={() => setStatusOpen(true)}>
            {fr.tone === "stale" ? `⚠ 평일 ${fr.days}일째 갱신 없음 — 매매 판단 보류`
              : fr.tone === "old" ? "⚠ 이틀째 갱신 없음 — 공휴일이 아니면 확인"
              : "⚠ 예약 수집이 반영되지 않았습니다"} <span style={{ fontWeight: 400 }}>· 눌러서 갱신</span>
          </div>)}
      </div>

      <main style={{ padding: `4px 12px ${NAV_H + 24}px` }}>
        {/* 308·309. 오늘·내 종목은 기준 안내를 맨 아래로 — 첫 화면은 내 돈·할 일부터 */}
        {tab !== "market" && tab !== "track" && <TabBasis tab={tab} stocks={stocks} market={market} snap={snap} siglog={siglog} uni={uni} />}
        {tab === "market" && <MarketTab {...shared} pos={posEff} brokerMiss={brokerMiss} onShowRules={() => setRulesOpen(true)} />}
        {tab === "alloc" && <DcTab {...shared} />}
        {tab === "find" && <FindHub {...shared} pos={posEff} />}
        {tab === "review" && <ReviewTab {...shared} uni={uni} snap={snap} onShowRules={() => setRulesOpen(true)} />}
        {tab === "pool" && <PoolTab {...shared} snap={snap} uni={uni} />}
        {tab === "track" && <TrackTab {...shared} stocks={items} brokerSync={brokerSync} brokerMiss={brokerMiss} />}
        {tab === "track" && <div id="kis-panel" style={{ scrollMarginTop: 60 }} />}
        {tab === "track" && <React.Suspense fallback={null}><BrokerPanel held={pos.map(p => p.t)} stocks={stocks} {...(({ list, note }) => ({ picks: list, pickNote: note }))(brokerPicks(stocks, pos, genDay, market?.fx?.usdkrw || null, "us", market))} kr={brokerPicks(stocks, pos, genDay, market?.fx?.usdkrw || null, "kr", market)} krOpen={() => marketState().krRegular} watch={watch} toggleWatch={toggleWatch} asOf={{ us: asOfOf(stocks, "us") || "", kr: asOfOf(stocks, "kr") || "" }} half={{ us: sizer.limit("us") / 2, kr: sizer.limit("kr") / 2 }} usOpen={() => marketState().usRegular} fx={market?.fx?.usdkrw || null} onSync={(x) => setBrokerSync(v => ({ ...v, [x.mk]: x }))} openStock={openStock} /></React.Suspense>}{/* ★ 증권사 (2/2) */}
        {(tab === "market" || tab === "review") && <PracticeEntry />}{/* ★ 연습 (2/2) */}
        {(tab === "market" || tab === "track") && <div style={{ marginTop: 10 }}><TabBasis tab={tab} stocks={stocks} market={market} snap={snap} siglog={siglog} uni={uni} /></div>}
      </main>
      {orderReq && <React.Suspense fallback={null}><OrderSheet key={orderReq.k} req={orderReq} stocks={items} pos={pos}
        half={{ us: sizer.limit("us") / 2, kr: sizer.limit("kr") / 2 }} onClose={() => setOrderReq(null)} /></React.Suspense>}

      {/* ═══ 하단 탭바 — 엄지가 닿는 곳 ═══ */}
      <nav style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 160, background: "rgba(13,18,32,.97)",
                    borderTop: `1px solid ${C.border}`, paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", display: "grid", gridTemplateColumns: `repeat(${TAB_DEF.length}, 1fr)`, height: NAV_H }}>
          {TAB_DEF.map(([k, ic, label]) => {
            const on = tab === k;
            return (
              <button key={k} onClick={() => { if (chartOpen) { setChartOpen(false); try { window.history.back(); } catch {} } setTab(k); }} aria-current={on ? "page" : undefined}
                style={{ background: "none", border: "none", cursor: "pointer", color: on ? C.gold : C.muted,
                         display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, position: "relative" }}>
                <span style={{ fontSize: 19, lineHeight: 1, filter: on ? "none" : "grayscale(.6)", opacity: on ? 1 : .75 }}>{ic}</span>
                <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 500 }}>{label}</span>
                {k === "track" && nTrack > 0 && (
                  <span style={{ position: "absolute", top: 6, right: "calc(50% - 20px)", fontSize: 9.5, fontWeight: 700,
                                 background: C.gold, color: "#111", borderRadius: 8, padding: "0 5px", lineHeight: "15px" }}>{nTrack}</span>)}
                {on && <span style={{ position: "absolute", top: 0, width: 26, height: 2, borderRadius: 2, background: C.gold }} />}
              </button>);
          })}
        </div>
      </nav>
    </Shell>
  );
}

const KV = ({ k, v }) => (
  <div style={{ background: "rgba(255,255,255,.03)", borderRadius: 8, padding: "6px 9px" }}>
    <div style={{ fontSize: FS.xs, color: C.muted }}>{k}</div>
    <div style={{ fontSize: FS.sm, fontWeight: 600, fontFamily: MONO }}>{v}</div>
  </div>
);

const Shell = ({ children }) => (
  // overflowX:hidden 은 sticky(정렬줄·상단바)를 망가뜨려 쓰지 않습니다 — 가로 넘침은 각 행에서 막습니다
  <div style={{ background: C.bg, color: C.text, minHeight: "100vh", colorScheme: "dark",
                fontFamily: '-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Segoe UI",sans-serif',
                lineHeight: 1.45, WebkitTextSizeAdjust: "100%" }}>
    <div style={{ maxWidth: 640, margin: "0 auto" }}>{children}</div>
  </div>
);

/* 내 원칙 — 주 1회(토요일 기준) 앱을 열 때 먼저 뜹니다 */
/** 원칙 목록 — 4번은 앱에 구현된 매수·매도 규칙과 추적탭 설정값을 그대로 읽어 씁니다 */
const myRules = (sz) => [
  ["앱이 '매수!'라고 쓴 종목만 산다", "강세(RSI 60↑) · 🇰🇷 눌림(RSI 45 회복) · 추세(ST 3개 초록+구름 위). 뉴스·테마·감으로 사지 않는다"],
  [`절반 → 1회차 +3% 확인 후 나머지 절반 · +6% 넘게 올랐으면 추격 금지`,
   `종목당 한도 🇰🇷 ${sz ? money(sz.limKr, "kr") : "—"} · 🇺🇸 ${sz ? money(sz.limUs, "us") : "—"} · 고가 종목은 1주 한 번에`],
  ["매도는 '매도!' 하나 — 트레일링선 아래 마감. 그날 처리한다", "-3% 손절·고점 -5%·2주 타임컷은 검증에서 성과를 깎아 쓰지 않는다. 매도를 미루면 매수 타이밍 차이보다 비싸다"],
  [`🇰🇷 시장 위험 · 🇺🇸 나스닥100 200일선 아래면 새로 사지 않는다 · 🇺🇸는 ${usDST(Date.now()) ? "22:30" : "23:30"} 개장에 주문`, "한국 '위험'(폭 3년 하위 40% 아래)과 나스닥100 200일선 아래는 앱이 '오늘 살 것'에서 알아서 뺍니다. 가진 종목은 트레일링선대로. 한국을 한다면 09:30 이후에만"],
  ["이벤트 매매 금지 · 몰빵 금지 · 적자 추격 금지 · 급락 탭은 소액만", `같은 업종은 ${SEC_CAP}칸까지(보유 포함). 급락은 참고용(주도주 보유를 못 이김)`],
];
function RulesPopup({ onClose, sizer }) {
  const MY_RULES = myRules(sizer);
  const [ack, setAck] = useState([]);
  const all = ack.length === MY_RULES.length;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,.72)",
                  display: "flex", alignItems: "flex-end", justifyContent: "center" }}
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: C.panel, borderTop: `2px solid ${C.gold}`, borderRadius: "16px 16px 0 0",
                    width: "100%", maxWidth: 640, maxHeight: "88vh", overflowY: "auto", padding: "16px 14px 20px" }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.gold }}>이번 주 원칙</div>
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 3 }}>다섯 개를 눌러 확인해야 닫힙니다</div>
        {MY_RULES.map(([t, why], i) => {
          const on = ack.includes(i);
          return (
            <button key={i} onClick={() => setAck(a => on ? a.filter(x => x !== i) : [...a, i])}
              style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer", marginTop: 8,
                       background: on ? "rgba(48,209,88,.10)" : "rgba(255,255,255,.04)",
                       border: `1px solid ${on ? C.emerald + "66" : C.border}`, borderRadius: 10, padding: "11px 12px" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 15, color: on ? C.emerald : C.muted }}>{on ? "✓" : "○"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{i + 1}. {t}</div>
                  <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 2 }}>{why}</div>
                </div>
              </div>
            </button>);
        })}
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 10, lineHeight: 1.7 }}>
          2번 한도는 내 종목 탭 설정을 그대로 씁니다. 다섯 개 모두 2008–26 검증으로 확정한 규칙입니다.
        </div>
        <button onClick={onClose} disabled={!all}
          style={{ ...btn(all ? C.emerald : C.dim), width: "100%", marginTop: 12, opacity: all ? 1 : .5, minHeight: 44 }}>
          {all ? "확인했습니다 · 시작" : `${ack.length}/5 확인`}</button>
      </div>
    </div>);
}
/** 159. 기준 줄 — 탭 맨 위에 '어느 날 값인지 · 어디서 온 값인지'를 한 번에 */
const Basis = ({ items }) => (
  <div style={{ marginTop: 8, padding: "7px 10px", borderRadius: 10, background: C.panel2, border: `1px solid ${C.border}`,
                fontSize: 11, color: C.dim, display: "flex", flexWrap: "wrap", gap: "2px 12px", lineHeight: 1.5 }}>
    {items.filter(Boolean).map((x, i) => <span key={i}>{x}</span>)}
  </div>);
/** 159. 탭마다 기준 줄 — 어느 날 값인지 · 무엇과 비교하는지 · 어디서 온 값인지 */
function TabBasis({ tab, stocks, market, snap, siglog, uni }) {
  if (!stocks || !market) return null;
  const B = (x) => <b style={{ color: C.text, fontWeight: 600 }}>{x}</b>;
  const plan = loadPlan();
  const dcAsOf = market.dc?.core?.[0]?.buy?.asOf || market.dc?.hold3?.asOf;
  const sig = (siglog || []).map(x => x.d).filter(Boolean).sort();
  const items = {
    market: [basisDates(stocks, market), market.breadthAsOf && <>폭 {B(`${md(market.breadthAsOf)} 계산`)}</>,
             <>다음 수집 🇰🇷 {nextCollect("kr")} · 🇺🇸 {nextCollect("us")}</>, "시세·거래대금 야후"],
    find: [basisDates(stocks, market), <>설정 {B(`🇺🇸 ${plan.slotsUs || SLOTS_DEFAULT.us}칸 · 🇰🇷 ${plan.slotsKr || SLOTS_DEFAULT.kr}칸 · 매출 ${getRevMin() > 0 ? `+${getRevMin()}%` : "필터 끔"}`)}</>],
    track: [<>평가 {B(`앱의 마지막 종가 (🇺🇸 ${md(asOfOf(stocks, "us")) || "—"} · 🇰🇷 ${md(asOfOf(stocks, "kr")) || "—"})`)}</>, <>보유 기록 {B("메리츠 잔고 기준 · 서버 저장 (휴대폰·PC 같음)")}</>],
    alloc: [<>판단 {B(`🇺🇸 ${md(asOfOf(snap?.etfs, "us")) || "—"} · 🇰🇷 ${md(asOfOf(snap?.etfs, "kr")) || "—"} 종가`)} (미국은 원본 QQQ·SPY · 한국 KODEX 200)</>, market.allocation?.nextRebal && <>다음 비중 점검 {B(mdy(market.allocation.nextRebal))}</>],
    review: [sig.length > 0 && <>신호 기록 {B(`${md(sig[0])} ~ ${md(sig[sig.length - 1])} · ${sig.length}건`)}</>, <>시장 비교 {B("🇺🇸 S&P500 · 🇰🇷 코스피")}</>, <>검증값 {B("백테스트")}</>],
    pool: [uni?.date && <>종목풀 {B(`${md(uni.date.slice(0, 10))} 교체`)}</>, <>시세 {B(mdt(snap?.meta?.generatedKST) || "—")}</>, snap?.meta?.finUpdated && <>재무 {B(md(snap.meta.finUpdated))}</>,
           "출처: 한투 종목 마스터 · 나스닥 스크리너 · S&P500 목록 · 시세 야후"],
  }[tab];
  return items ? <Basis items={items} /> : null;
}
const basisDates = (stocks, market) => {
  const a = asOfOf(stocks, "us"), b = asOfOf(stocks, "kr");
  return <>신호 기준 <b style={{ color: C.text, fontWeight: 600 }}>🇺🇸 {md(a) || "—"} 종가 · 🇰🇷 {md(b) || "—"} 종가</b></>;
};


/** 종목풀에 없는 종목을 급히 넣기 — 파일을 고치지 않고 앱에서 바로 */
function AddTicker({ code, extras, setExtras, pos, watch, trades }) {
  const [st, setSt] = useState(extras.includes(code) ? "done" : "idle");
  const ok = /^[A-Z]{1,5}$|^\d{6}$/.test(code);
  const add = async () => {
    setSt("busy");
    const next = [...new Set([...extras, code])];
    setExtras(next);
    try {
      const { j } = await postWatch({ bulk: true, positions: pos, watch, extras: next, trades: trades.slice(-300) });
      setSt(j.ok ? "done" : "local");
    } catch { setSt("local"); }
  };
  if (!ok) return <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 4 }}>
    미국은 영문 티커, 한국은 숫자 6자리로 검색하세요</div>;
  return (
    <div style={{ marginTop: 8 }}>
      {st === "done" ? (
        <div style={{ fontSize: FS.xs, color: C.emerald }}>
          ✓ <b>{code}</b> 등록됨 — 상단 <b>🔄 지금 갱신</b>을 누르면 이번 수집부터 들어옵니다 (약 30분)
        </div>
      ) : st === "local" ? (
        <div style={{ fontSize: FS.xs, color: C.gold }}>
          이 기기에만 저장됐습니다 — 추적탭의 🔔 알림 연결을 누르면 서버에도 올라갑니다
        </div>
      ) : (
        <button onClick={add} disabled={st === "busy"} style={{ ...btn(C.cyan), width: "100%" }}>
          {st === "busy" ? "등록 중…" : `＋ ${code} 종목풀에 추가`}</button>
      )}
    </div>);
}
