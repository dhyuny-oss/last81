/**
 * Alpha Terminal v4 — 통합본
 * ════════════════════════════════════════════════════════════
 * 데이터는 파이프라인(scripts/build_snapshot.py)이 계산한 값을 "읽기만" 합니다.
 * 이 파일에는 지표 계산이 한 줄도 없습니다 — 통일성의 핵심.
 *
 *   /data/snapshot.json    종목별 지표 (약 260KB, 첫 화면)
 *   /data/market.json      지수·섹터·판단 (3KB, 첫 화면)
 *   /data/bars/<티커>.json  차트용 시계열 (약 16KB, 누른 종목 하나만)
 *
 * 탭 6개 — 시장 · 배분 · 발굴 · 과매도 · 차트 · 추적
 * 전역 상태 하나로 탭 간 연계 (종목 클릭 → 차트 / 관심 토글 즉시 반영 / 검색)
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  ComposedChart, Line, Area, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

export const APP_VERSION = "v5.0.0";

/* ══════════════ 디자인 토큰 ══════════════ */
const C = {
  bg: "#0A0E1A", panel: "#0F1420", panel2: "#161B2E", border: "rgba(255,255,255,.09)",
  text: "#E5E7EB", dim: "#9CA3AF", muted: "#6B7280",
  gold: "#F59E0B", emerald: "#30D158", cyan: "#06B6D4", violet: "#A78BFA",
  red: "#FF453A", orange: "#FF9F0A",
};
const css = {
  card: { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: "13px 15px" },
  chip: (bg, col, bd) => ({ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: bg, color: col, fontWeight: 600, border: bd || "none", whiteSpace: "nowrap" }),
  h2: { fontSize: 13, fontWeight: 700, color: C.gold, margin: "16px 0 6px", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" },
  lbl: { fontSize: 10, color: C.muted, fontWeight: 400 },
};
const pct = (v, d = 2) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const col = (v) => (v == null ? C.muted : v > 0 ? C.emerald : v < 0 ? C.red : C.dim);
const num = (v, d = 2) => (v == null ? "—" : v.toLocaleString("ko-KR", { maximumFractionDigits: d }));
/** 가격 표기 — 한국은 원(소수 없음), 미국은 달러(소수 2자리) */
const price = (v, m = "us") => (v == null ? "—" : m === "kr" ? `₩${num(v, 0)}` : `$${num(v, 2)}`);
/** 금액 표기 — 시장별 단위. m="kr" 이면 원(조/억), 아니면 달러($B/$M).
 *  ※ 시장을 안 넘기면 미국 거래대금 $18.9B 가 "189억"으로 찍힙니다(원/달러 혼동). */
const money = (v, m = "us") => {
  if (v == null) return "—";
  const a = Math.abs(v), sg = v < 0 ? "-" : "";
  if (m === "kr") {
    if (a >= 1e12) return `${sg}${(a / 1e12).toFixed(1)}조`;
    if (a >= 1e8) return `${sg}${(a / 1e8).toFixed(0)}억`;
    if (a >= 1e4) return `${sg}${(a / 1e4).toFixed(0)}만`;
    return `${sg}${num(a, 0)}원`;
  }
  if (a >= 1e9) return `${sg}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sg}$${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${sg}$${(a / 1e3).toFixed(0)}K`;
  return `${sg}$${num(a, 0)}`;
};

/* ══════════════ 세션·신선도 (앱 전체 공통) ══════════════ */
const SLOTS_KST = [[9, 5], [12, 30], [16, 0], [20, 0], [22, 45], [23, 45], [2, 0], [6, 30]];
const SAT_SLOT = [9, 0];   // 토 09:00 KST 주간 정리 (워크플로에 있는데 목록엔 빠져 있었음)

/** 미국이 서머타임(EDT)인지 — 하드코딩하면 겨울 반년 동안 세션 표시가 30분씩 틀립니다 */
function usDST(nowMs) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "short" })
      .formatToParts(new Date(nowMs)).find(p => p.type === "timeZoneName")?.value === "EDT";
  } catch { return true; }
}

function marketState(nowMs = Date.now()) {
  // ★ UTC 게터로 읽습니다. 로컬 게터를 쓰면 미국에서 접속했을 때
  //   서머타임 전환 주에 KST 가 1시간 어긋납니다.
  const kst = new Date(nowMs + 9 * 3600000);
  const dow = kst.getUTCDay(), mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const wd = dow >= 1 && dow <= 5;
  const krRegular = wd && mins >= 540 && mins <= 930;          // 09:00~15:30
  const krExt = wd && ((mins >= 450 && mins < 540) || (mins > 930 && mins <= 1080));
  const dst = usDST(nowMs);
  const usOpen = dst ? 1350 : 1410;                            // 22:30 / 23:30 KST
  const usClose = dst ? 300 : 360;                             // 05:00 / 06:00 KST
  const usRegular = (wd && mins >= usOpen) || (mins <= usClose && dow >= 2 && dow <= 6);
  const usPre = wd && mins >= usOpen - 330 && mins < usOpen;
  const usAfter = mins > usClose && mins <= usClose + 240 && dow >= 2 && dow <= 6;
  // 토요일 아침은 아직 미국 장 뒷정리 시간이고 06:30·09:00 빌드가 남아 있습니다.
  const weekend = dow === 0 || (dow === 6 && mins > 570) || (dow === 1 && mins < 450);
  const anyOpen = krRegular || usRegular;
  let next = null;
  const slots = dow === 6 ? [[6, 30], SAT_SLOT] : SLOTS_KST;
  if (!weekend) {
    let best = Infinity;
    for (const [h, m] of slots) {
      let d = h * 60 + m - mins; if (d < 0) d += 1440;
      if (d < best) { best = d; next = { hh: h, mm: m, inMin: d }; }
    }
  }
  // ★ 라벨 — "휴장"은 아예 안 여는 날에만 씁니다.
  //   장이 열렸다가 끝난 평일 저녁을 "휴장"이라고 하면 데이터가 없는 것처럼 읽힙니다.
  const krLabel = weekend ? "휴장"
    : mins < 450 ? "개장 전" : mins < 540 ? "장전" : mins <= 930 ? "장중"
    : mins <= 1080 ? "장후" : "장마감";
  const usLabel = weekend ? "휴장"
    : usRegular ? "장중" : usPre ? "프리마켓" : usAfter ? "애프터"
    : (mins > usClose + 240 && mins < usOpen - 330) ? "장마감" : "개장 전";
  return { krRegular, krExt, usRegular, usPre, usAfter, weekend, anyOpen, next, dst, krLabel, usLabel };
}
function freshness(updMs, nowMs = Date.now()) {
  const st = marketState(nowMs);
  if (!updMs) return { ...st, emoji: "⚪", label: "데이터 없음", color: C.muted, tone: "none" };
  const min = Math.floor((nowMs - updMs) / 60000);
  const txt = min < 60 ? `${min}분 전` : min < 1440 ? `${Math.floor(min / 60)}시간 전` : `${(min / 1440).toFixed(1)}일 전`;
  if (st.weekend) return { ...st, min, emoji: "🔵", label: `주말 휴장 · ${txt}`, color: C.cyan, tone: "closed" };
  if (!st.anyOpen) return { ...st, min, emoji: "⚪", label: `시간외 · ${txt}`, color: C.muted, tone: "closed" };
  if (min < 60) return { ...st, min, emoji: "🟢", label: txt, color: C.emerald, tone: "fresh" };
  if (min < 240) return { ...st, min, emoji: "🟡", label: txt, color: C.gold, tone: "lag" };
  return { ...st, min, emoji: "🔴", label: `${txt} — 수집 지연`, color: C.red, tone: "bad" };
}

/* ══════════════ 검증 결과 — 시장별 근거 등급 ══════════════
   백테스트(미국 416종목·한국 294종목, 1996~2026)에서 시장마다 답이 달랐습니다.
   같은 규칙을 두 시장에 쓰면 한쪽이 반드시 틀리므로, 여기 한 곳에 적어 두고
   화면·알림이 모두 이 표를 따릅니다.                                        */
const EVIDENCE = {
  find: {                                   // 가격구조 + RS 상위
    kr: { ok: true,  note: "한국 2010–18 +1.82% · 2019–23 +2.39% · 2024–26 +3.98% 모두 유의" },
    us: { ok: false, note: "미국 최근 2년은 +0.12%로 유의하지 않음 (2019–23까지는 유의했음)" },
  },
  oversold: {                               // 고점 −40% + 3년 건강 60%
    us: { ok: true,  note: "미국 +10.57% 유의 (252일 보유)" },
    kr: { ok: false, note: "한국 −7.24%로 유의하게 손해. 낙폭이 클수록 더 나빴고, 백분위·변동성 조정으로 바꿔도 살아나지 않았습니다" },
  },
  vol: {                                    // 변동성 상위
    us: { ok: true,  note: "미국 최근 2년 +4.10% 유의 — 지금 가장 강한 신호" },
    kr: { ok: false, note: "한국 −1.95%로 신호가 되지 않음" },
  },
  ma200: {
    kr: { ok: true,  note: "한국 최근 2년 판별력 +6.98%p — 아래면 실제로 위험" },
    us: { ok: false, note: "미국 최근 2년은 판별력이 뒤집힘. 7년간 제대로 맞은 건 2022년 한 번" },
  },
};

/* ══════════════ 판단 규칙 (스펙 3요소) ══════════════ */
/** 발굴탭 판단 — 추세템플릿 · RS70 · 돌파(재돌파 or ST전환) */
/** 진입 판단 — ★ 돌파(재돌파·ST전환)를 필수 조건에서 뺐습니다.
 *  검증: 돌파를 요구하면 후보가 85% 줄고 목록이 하루 사이 100% 교체되는데,
 *        성과 차이는 없었습니다(+1.41% vs +1.20%, 표본은 12배 차이).
 *  이제 핵심은 가격구조 + RS 이고, 돌파는 '오늘 움직임' 참고 표시입니다. */
function verdictFind(s, marketVerdict) {
  if (!s) return null;
  const trend = !!s.tmpl, rs = (s.rs ?? 0) >= 70;
  const hot = (s.rsi ?? 0) > 75;
  if (trend && rs && !hot) {
    return marketVerdict === "risk"
      ? { k: "wait", t: "🟡 관망", c: C.gold, why: "조건 충족이나 시장 위험" }
      : { k: "go", t: "🟢 후보", c: C.emerald, why: "가격구조 + RS 상위" };
  }
  if (trend && rs && hot) return { k: "wait", t: "🟡 관망", c: C.gold, why: "과열 — 눌림 대기" };
  if (trend || rs) return { k: "wait", t: "🟡 관망", c: C.gold, why: trend ? "RS 부족" : "가격구조 미형성" };
  return { k: "no", t: "⚪ 제외", c: C.muted, why: "가격구조·RS 모두 미달" };
}
/** 과매도탭 판단 — 논리가 반대라 라벨을 일부러 다르게 (발굴탭과 혼동 방지) */
function verdictOversold(s) {
  if (!s) return null;
  const deep = (s.w52p ?? 0) <= -40, mid = (s.w52p ?? 0) <= -25;
  const healthy = (s.hlt ?? 0) >= 0.6;
  if (deep && healthy) return { k: "watch", t: "🔵 장기 관찰후보", c: C.cyan, why: "깊은 낙폭 + 장기 추세 건강" };
  if (mid && healthy) return { k: "soft", t: "🔷 관찰", c: "#3B82F6", why: "낙폭 진행 중" };
  return { k: "no", t: "⚪ 제외", c: C.muted, why: healthy ? "낙폭 부족" : "장기 추세 훼손" };
}

/* ══════════════ 공통 UI ══════════════ */
const Verdict = ({ v, size = 11 }) => v ? (
  <span style={{ fontSize: size, fontWeight: 800, color: v.c, whiteSpace: "nowrap" }}>{v.t}</span>
) : null;

const Chip = ({ children, tone = "n" }) => {
  const m = { g: [C.emerald, "rgba(48,209,88,.10)"], r: [C.red, "rgba(255,69,58,.10)"],
              w: [C.gold, "rgba(245,158,11,.10)"], c: [C.cyan, "rgba(6,182,212,.10)"], n: [C.dim, "rgba(255,255,255,.04)"] }[tone];
  return <span style={{ fontSize: 9, fontWeight: 600, padding: "1.5px 6px", borderRadius: 4, background: m[1], color: m[0], border: `1px solid ${m[0]}33`, whiteSpace: "nowrap" }}>{children}</span>;
};

const Star = ({ on, onClick }) => (
  <button onClick={(e) => { e.stopPropagation(); onClick(); }} title={on ? "관심 해제" : "관심 등록"}
    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: "0 4px",
             color: on ? C.gold : C.muted, lineHeight: 1, flexShrink: 0 }}>{on ? "★" : "☆"}</button>
);

const Empty = ({ children }) => (
  <div style={{ padding: "22px 12px", textAlign: "center", color: C.muted, fontSize: 11.5 }}>{children}</div>
);

const Range4Head = () => (
  <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 4px 5px",
                fontSize: 9, color: C.muted, fontFamily: "ui-monospace,monospace", letterSpacing: .2 }}>
    1일 · 3일 · 5일 · 1달 (누적)
  </div>
);

const Range4 = ({ s }) => (
  <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10.5, whiteSpace: "nowrap" }}>
    <span style={{ color: col(s.d1) }}>{pct(s.d1)}</span><span style={{ color: C.muted }}> · </span>
    <span style={{ color: col(s.d3) }}>{pct(s.d3)}</span><span style={{ color: C.muted }}> · </span>
    <span style={{ color: col(s.d5) }}>{pct(s.d5)}</span><span style={{ color: C.muted }}> · </span>
    <span style={{ color: col(s.d21) }}>{pct(s.d21)}</span>
  </span>
);

/* ══════════════ 종목 행 (모든 탭 공통 — 클릭·별 연계) ══════════════ */
function StockRow({ s, verdict, chips, right, onOpen, isWatch, onToggle }) {
  return (
    <div onClick={() => onOpen(s.t)} style={{
      display: "flex", alignItems: "center", gap: 9, padding: "9px 4px",
      borderBottom: `1px solid ${C.border}`, cursor: "pointer", flexWrap: "wrap",
    }}
      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,.02)"}
      onMouseLeave={e => e.currentTarget.style.background = ""}>
      <Star on={isWatch} onClick={() => onToggle(s.t)} />
      {verdict && <div style={{ width: 78, flexShrink: 0 }}><Verdict v={verdict} /></div>}
      <div style={{ minWidth: 96, flexShrink: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>{s.n || s.t}</div>
        <div style={{ fontSize: 9, color: C.muted }}>{s.t} · {s.m === "kr" ? "🇰🇷" : "🇺🇸"}</div>
      </div>
      <div style={{ flex: 1, minWidth: 130, display: "flex", gap: 3, flexWrap: "wrap" }}>{chips}</div>
      <div style={{ textAlign: "right", flexShrink: 0, minWidth: 128 }}>{right}</div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   메인
   ══════════════════════════════════════════════════════════ */
export default function App() {
  const [snap, setSnap] = useState(null);
  const [market, setMarket] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState("market");
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState("");
  const [showQ, setShowQ] = useState(false);

  /* ── 내 기록 (localStorage) ── */
  const [watch, setWatch] = useState(() => { try { return JSON.parse(localStorage.getItem("v4.watch") || "[]"); } catch { return []; } });
  const [pos, setPos] = useState(() => { try { return JSON.parse(localStorage.getItem("v4.pos") || "[]"); } catch { return []; } });
  useEffect(() => { localStorage.setItem("v4.watch", JSON.stringify(watch)); }, [watch]);
  useEffect(() => { localStorage.setItem("v4.pos", JSON.stringify(pos)); }, [pos]);

  /* ── 데이터 로드 ── */
  useEffect(() => {
    (async () => {
      try {
        const [a, b] = await Promise.all([
          fetch("/data/snapshot.json?t=" + Date.now()).then(r => r.ok ? r.json() : Promise.reject(new Error("snapshot " + r.status))),
          fetch("/data/market.json?t=" + Date.now()).then(r => r.ok ? r.json() : Promise.reject(new Error("market " + r.status))),
        ]);
        setSnap(a); setMarket(b);
      } catch (e) { setErr(e.message); }
    })();
  }, []);

  /* ── 후보 목록 체류일 추적 ──
     "매일 목록이 바뀐다"는 불편의 반대편은 "이 종목을 며칠째 보고 있나"입니다.
     앱을 열 때마다 오늘 후보를 기록해 두고, 처음 본 날부터 며칠 됐는지 셉니다. */
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
    const today = new Date().toISOString().slice(0, 10);
    const store = seenRef.current, now = Date.now();
    const cur = Object.values(snap.stocks || {}).filter(x =>
      (x.tvr ?? 0) >= 40 && x.tmpl && (x.rs ?? 0) >= 70);
    for (const x of cur) {
      const r = store[x.t];
      if (!r) store[x.t] = { first: now, last: today };
      else r.last = today;
    }
    // 30일 넘게 목록에 없던 종목은 기록 삭제 (다시 뜨면 새로 셉니다)
    for (const k of Object.keys(store)) {
      const d = (now - new Date(store[k].last + "T00:00:00Z").getTime()) / 86400000;
      if (d > 30) delete store[k];
    }
    localStorage.setItem("v5.seen", JSON.stringify(store));
  }, [snap]);

  /* ── 탭 간 연계: 종목 열기 = 선택 + 차트로 ── */
  const openStock = useCallback((t) => { setSel(t); setTab("chart"); setShowQ(false); }, []);
  const toggleWatch = useCallback((t) => setWatch(w => w.includes(t) ? w.filter(x => x !== t) : [...w, t]), []);

  const stocks = snap?.stocks || {};
  const list = useMemo(() => Object.values(stocks), [stocks]);
  const updMs = snap?.meta?.generatedAt ? new Date(snap.meta.generatedAt).getTime() : null;
  const fr = freshness(updMs);
  // ★ list[0].asOf 하나만 쓰면 헤더는 07-27, 미국 종목 카드는 07-24 가 되어
  //   같은 화면에 기준일이 두 개 나옵니다. 시장별로 각각 최신일을 씁니다.
  const asOfBy = useMemo(() => {
    const g = { kr: [], us: [] };
    for (const s of list) if (s.asOf) g[s.m === "kr" ? "kr" : "us"].push(s.asOf);
    const top = (a) => a.length ? a.sort().slice(-Math.max(1, Math.floor(a.length * 0.1)))[0] : null;
    return { kr: top(g.kr), us: top(g.us) };
  }, [list]);

  /* ── 검색 ── */
  const results = useMemo(() => {
    const k = q.trim().toLowerCase(); if (!k) return [];
    return list.filter(s => s.t.toLowerCase().includes(k) || (s.n || "").toLowerCase().includes(k)).slice(0, 8);
  }, [q, list]);

  if (err) return <Shell><div style={{ ...css.card, borderColor: C.red, marginTop: 40 }}>
    <div style={{ color: C.red, fontWeight: 800, fontSize: 14 }}>데이터를 불러오지 못했습니다</div>
    <div style={{ fontSize: 11.5, color: C.dim, marginTop: 6 }}>{err}</div>
    <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
      Actions 탭에서 <b style={{ color: C.dim }}>Snapshot Build (v4)</b> 를 한 번 실행해 주세요.
      <code style={{ color: C.gold }}> public/data/snapshot.json</code> 이 생겨야 합니다.
    </div></div></Shell>;

  if (!snap || !market) return <Shell><div style={{ textAlign: "center", color: C.muted, marginTop: 60, fontSize: 12 }}>불러오는 중…</div></Shell>;

  const TABS = [
    ["market", "🌐 시장"], ["alloc", "🧺 배분"], ["find", "🔍 발굴"],
    ["over", "🌊 과매도"], ["chart", "📊 차트"], ["track", `📁 추적 ${pos.length + watch.length || ""}`],
  ];
  const shared = { stocks, list, openStock, watch, toggleWatch, market, setTab, setSel, pos, setPos, seen };

  return (
    <Shell>
      {/* ═══ 헤더 ═══ */}
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: "#0d1526", borderBottom: `1px solid ${C.border}`, padding: "8px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
                        fontWeight: 700, fontSize: 13, background: "rgba(59,130,246,.12)", color: "#60A5FA", border: "1px solid rgba(59,130,246,.25)", flexShrink: 0 }}>α</div>
          <span style={css.chip(fr.krRegular ? "rgba(48,209,88,.12)" : "rgba(255,255,255,.04)", fr.krRegular ? C.emerald : C.muted)}>
            🇰🇷 {fr.krLabel}</span>
          <span style={css.chip(fr.usRegular ? "rgba(48,209,88,.12)" : "rgba(255,255,255,.04)", fr.usRegular ? C.emerald : C.muted)}>
            🇺🇸 {fr.usLabel}</span>
          <span title="지표·판단의 기준일 (종가 스냅샷) — 시장마다 다를 수 있습니다"
            style={css.chip("rgba(255,255,255,.04)", C.muted, `1px solid ${C.border}`)}>
            신호 🇰🇷{asOfBy.kr || "—"} · 🇺🇸{asOfBy.us || "—"}</span>
          <span style={css.chip(`${fr.color}15`, fr.color, `1px solid ${fr.color}40`)}>{fr.emoji} {fr.label}</span>
          <span style={css.chip("rgba(255,255,255,.04)", C.muted, `1px solid ${C.border}`)}>
            다음 {fr.weekend ? "월 09:05" : fr.next ? `${String(fr.next.hh).padStart(2, "0")}:${String(fr.next.mm).padStart(2, "0")}` : "—"}</span>

          <div style={{ marginLeft: "auto", position: "relative", flexShrink: 0 }}>
            <input value={q} onChange={e => { setQ(e.target.value); setShowQ(true); }} onFocus={() => setShowQ(true)}
              onKeyDown={e => { if (e.key === "Enter" && results[0]) openStock(results[0].t); }}
              placeholder="🔍 종목 검색"
              style={{ background: "rgba(255,255,255,.05)", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 9px", color: C.text, fontSize: 10.5, outline: "none", width: 128 }} />
            {showQ && q.trim() && results.length === 0 && (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, width: 250, background: "#0f172a",
                            border: `1px solid ${C.border}`, borderRadius: 7, zIndex: 200, padding: "9px 11px",
                            boxShadow: "0 8px 32px rgba(0,0,0,.8)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.gold }}>“{q.trim()}” 는 목록에 없습니다</div>
                <div style={{ fontSize: 10, color: C.dim, marginTop: 5, lineHeight: 1.65 }}>
                  깃허브에서 <code style={{ color: C.cyan }}>scripts/tickers_extra.txt</code> 를 열어
                  한 줄 추가하고 <b style={{ color: C.text }}>Snapshot Build</b> 를 돌리면 다음부터 나옵니다.
                  <br />한국은 숫자 6자리, 미국은 영문 티커입니다.
                </div>
              </div>)}
            {showQ && results.length > 0 && (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, minWidth: 190, background: "#0f172a",
                            border: `1px solid ${C.border}`, borderRadius: 7, zIndex: 200, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,.8)" }}>
                {results.map(r => (
                  <div key={r.t} onClick={() => openStock(r.t)} style={{ padding: "7px 10px", cursor: "pointer", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", gap: 8 }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(56,189,248,.1)"} onMouseLeave={e => e.currentTarget.style.background = ""}>
                    <span style={{ fontSize: 11, fontWeight: 700 }}>{r.n}</span>
                    <span style={{ fontSize: 9, color: C.muted }}>{r.t}</span>
                  </div>))}
              </div>)}
          </div>
          <span title={`Alpha Terminal ${APP_VERSION}`} style={{ fontSize: 7.5, color: C.muted, opacity: .65, flexShrink: 0 }}>{APP_VERSION}</span>
        </div>

        {fr.tone === "bad" && (
          <div style={{ background: "rgba(255,69,58,.12)", border: `1px solid ${C.red}`, borderRadius: 6, padding: "6px 10px", marginTop: 6, fontSize: 9.5, color: C.dim }}>
            <b style={{ color: C.red }}>장중인데 데이터가 {Math.floor(fr.min / 60)}시간 멈춰 있어요</b> — Actions 탭에서 Snapshot Build 실행을 확인하세요.
          </div>)}

        <div style={{ display: "flex", marginTop: 7, borderRadius: 6, overflow: "hidden", border: `1px solid ${C.border}`, overflowX: "auto" }}>
          {TABS.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              flex: 1, minWidth: 56, padding: "7px 3px", fontSize: 10, fontWeight: 700, cursor: "pointer", border: "none",
              background: tab === k ? "rgba(245,158,11,.14)" : "transparent", color: tab === k ? C.gold : C.muted, whiteSpace: "nowrap",
            }}>{label}</button>))}
        </div>
      </div>

      <div style={{ padding: "4px 12px 40px" }}>
        {tab === "market" && <MarketTab {...shared} />}
        {tab === "alloc" && <AllocTab {...shared} />}
        {tab === "find" && <FindTab {...shared} />}
        {tab === "over" && <OversoldTab {...shared} />}
        {tab === "chart" && <ChartTab {...shared} sel={sel} />}
        {tab === "track" && <TrackTab {...shared} />}
      </div>

      <div style={{ padding: "10px 12px 24px", fontSize: 9.5, color: C.muted, textAlign: "center", borderTop: `1px solid ${C.border}` }}>
        지표는 파이프라인이 한 번 계산한 값을 표시만 합니다 · 생성 {snap.meta.generatedKST} · 종목 {snap.meta.counts.stocks}
        {snap.meta.pool?.extra?.length > 0 && <> (직접 추가 {snap.meta.pool.extra.length})</>}
        {snap.meta.counts.failed > 0 && <> · 못 받은 종목 {snap.meta.counts.failed}</>}
        <br />투자자문이 아니며 과거 성과가 미래를 보장하지 않습니다
      </div>
    </Shell>
  );
}

const Shell = ({ children }) => (
  <div style={{ background: C.bg, color: C.text, minHeight: "100vh",
                fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","Apple SD Gothic Neo",sans-serif', lineHeight: 1.5 }}>
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>{children}</div>
  </div>
);

/* ══════════════ 1. 시장 ══════════════ */
function MarketTab({ market, setTab }) {
  const J = { safe: ["🟢 안전", C.emerald], warn: ["🟡 주의", C.gold], risk: ["🔴 위험", C.red] };
  const idxRows = Object.entries(market.indices || {});
  const risk = market.risk || {};
  const holds = market.allocation?.holds || [];
  const sectors = market.sectors || [];
  return (
    <>
      <h2 style={css.h2}>📊 시장 판단 <span style={css.lbl}>— 판단만, 숫자는 아래</span></h2>
      <div style={css.card}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {["us", "kr"].map(m => {
            const j = market.judge?.[m]; if (!j || !J[j.verdict]) return null;
            const [t, c] = J[j.verdict];
            return (
              <div key={m} style={{ flex: 1, minWidth: 210, borderRadius: 11, padding: "12px 14px",
                background: `${c}12`, border: `1px solid ${c}55`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{m === "us" ? "🇺🇸 미국" : "🇰🇷 한국"}</div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{j.why}</div>
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, color: c, whiteSpace: "nowrap" }}>{t}</div>
              </div>);
          })}
        </div>
        <div style={{ fontSize: 10, color: C.muted, marginTop: 9, lineHeight: 1.75 }}>
          200일선 위=안전 / 아래=위험 / 위지만 1일 −5%↑ 또는 1달 −15%↑면 주의. 미국=S&amp;P500 · 한국=KOSPI.<br />
          <b style={{ color: C.cyan }}>🇰🇷 한국은 이 신호가 잘 듣습니다</b> — {EVIDENCE.ma200.kr.note}<br />
          <b style={{ color: C.gold }}>🇺🇸 미국은 참고만</b> — {EVIDENCE.ma200.us.note}.
          최근 2년엔 642일 중 55일(9%)만 켜졌고 그때가 오히려 반등 직전이었습니다.
        </div>
      </div>

      <h2 style={css.h2}>🌐 지수 <span style={css.lbl}>— 근거 숫자는 여기 한 곳에만</span></h2>
      <div style={css.card}>
        <Scroll>
          <div style={{ fontSize: 9, color: C.muted, marginBottom: 3 }}>3일·5일·1달은 그 기간 누적 등락입니다 (소수 1자리)</div>
          <table style={tbl}>
            <thead><tr>{["지수 · 200일선", "종가", "1일", "3일", "5일", "1달"].map((h, i) =>
              <th key={h} style={{ ...th, textAlign: i === 0 ? "left" : "right" }}>{h}</th>)}</tr></thead>
            <tbody>{idxRows.map(([k, v]) => (
              <tr key={k}>
                <td style={{ ...td, fontWeight: 700 }}>{v.label}
                  <div style={{ fontSize: 8.5, fontWeight: 400, color: col(v.ma200p) }}>
                    200일선 {pct(v.ma200p, 1)} {v.ma200p >= 0 ? "위" : "아래"}</div></td>
                <td style={tdR}>{num(v.c, 0)}</td>
                {["d1", "d3", "d5", "d21"].map(f => <td key={f} style={{ ...tdR, color: col(v[f]) }}>{pct(v[f], 1)}</td>)}
              </tr>))}</tbody>
          </table>
        </Scroll>
      </div>

      <h2 style={css.h2}>⚠️ 위험 지표</h2>
      <div style={css.card}>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          {[["^VIX", "VIX (공포지수)", "", v => v.c < 22 ? ["안정", C.emerald] : v.c < 30 ? ["주의", C.gold] : ["위험", C.red]],
            ["^TNX", "미국 10년물", "%", v => [`1달 ${v.d21p >= 0 ? "+" : ""}${num(v.d21p, 2)}%p`, C.muted]],
            ["^IRX", "미국 3개월물", "%", v => [`1달 ${v.d21p >= 0 ? "+" : ""}${num(v.d21p, 2)}%p`, C.muted]],
            ["curve", "금리커브 (10Y−3M)", "%p", v => v.c > 0 ? ["정상 · 역전 아님", C.emerald] : ["역전 — 침체 경고", C.red]],
          ].map(([k, label, unit, f]) => { const v = risk[k]; if (!v) return null; const [s, c] = f(v);
            return (<div key={k} style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 11px" }}>
              <div style={{ fontSize: 9.5, color: C.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
              <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "ui-monospace,monospace", marginTop: 1 }}>
                {num(v.c, 3)}<span style={{ fontSize: 10.5, color: C.muted }}>{unit}</span></div>
              <div style={{ fontSize: 9, color: c, marginTop: 1 }}>{s}</div>
            </div>); })}
        </div>
      </div>

      <h2 style={css.h2}>🔄 섹터 <span style={css.lbl}>— 6개월 모멘텀 순위 · 상위 3개가 배분탭 보유 대상</span></h2>
      <div style={css.card}>
        <Scroll>
          <table style={tbl}>
            <thead><tr>{["섹터", "1일", "3일", "5일", "1달", "6개월"].map((h, i) =>
              <th key={h} style={{ ...th, textAlign: i === 0 ? "left" : "right" }}>{h}</th>)}</tr></thead>
            <tbody>{sectors.map(s => {
              const hold = holds.includes(s.tk);
              return (<tr key={s.tk} style={hold ? { background: "rgba(48,209,88,.06)" } : undefined}>
                <td style={td}>
                  <span style={{ color: C.muted }}>{s.rank}</span> <b>{s.label}</b>
                  {hold && <span style={{ color: C.emerald, fontSize: 9, fontWeight: 700 }}> ● 보유</span>}
                  <div style={{ fontSize: 8.5, color: C.muted }}>{s.tk} · 200일선 <span style={{ color: col(s.ma200p) }}>{pct(s.ma200p, 0)}</span></div>
                </td>
                {["d1", "d3", "d5", "d21"].map(f => <td key={f} style={{ ...tdR, color: col(s[f]) }}>{pct(s[f], 1)}</td>)}
                <td style={{ ...tdR, color: col(s.m6), fontWeight: 700 }}>{pct(s.m6, 0)}</td>
              </tr>);
            })}</tbody>
          </table>
        </Scroll>
        <div style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>
          섹터 1일은 캔들에서 직접 계산합니다 — 이전 버전은 이 자리에 1개월 값이 들어가 있었습니다.
          <button onClick={() => setTab("alloc")} style={linkBtn}> 배분탭에서 보유 지시 보기 →</button>
        </div>
      </div>
    </>
  );
}

/* ══════════════ 2. 배분 (감마 흡수) ══════════════ */
function AllocTab({ market, pos, setPos, setTab }) {
  const [cap, setCap] = useState(() => Number(localStorage.getItem("v4.cap") || 10000000));
  useEffect(() => localStorage.setItem("v4.cap", String(cap)), [cap]);
  const holds = market.sectors.filter(s => market.allocation.holds.includes(s.tk));
  const per = holds.length ? cap / holds.length : 0;          // 원화
  // ETF 는 달러 상품입니다 — 원화 투입액을 환율로 나눠야 몇 주인지 나옵니다.
  const fx = market.fx?.usdkrw || null;
  const perUsd = fx ? per / fx : null;
  const shares = (px) => (perUsd && px ? Math.floor(perUsd / px) : null);
  const held = (t) => (pos || []).some(p => p.t === t);
  return (
    <>
      <h2 style={css.h2}>🧺 이번 달 보유 지시 <span style={css.lbl}>— 6개월 모멘텀 상위 3개 균등</span></h2>
      {market.allocation.defense ? (
        <div style={{ ...css.card, borderColor: `${C.gold}66`, background: "rgba(245,158,11,.06)" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.gold }}>🛡 방어 국면 — 현금 또는 채권(IEF)</div>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 5 }}>
            6개월 모멘텀이 플러스인 섹터가 {market.allocation.nPositive}개뿐입니다. 상위 3개를 채울 수 없어 방어로 전환합니다.
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {holds.map(s => (
              <div key={s.tk} style={{ flex: 1, minWidth: 190, ...css.card, borderColor: "rgba(48,209,88,.35)", background: "rgba(48,209,88,.05)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <div><div style={{ fontSize: 15, fontWeight: 800 }}>{s.tk}</div>
                    <div style={{ fontSize: 10.5, color: C.dim }}>{s.label}</div></div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: C.emerald, fontFamily: "ui-monospace,monospace" }}>{pct(s.m6, 1)}</div>
                    <div style={{ fontSize: 9, color: C.muted }}>6개월</div></div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: C.dim, marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 7, flexWrap: "wrap", gap: 6 }}>
                  <span>현재가 <b style={{ color: C.text }}>${num(s.c)}</b></span>
                  <span>배분 <b style={{ color: C.text }}>{money(per, "kr")}</b>
                    {shares(s.c) != null && <span style={{ color: C.muted }}> ≈ {shares(s.c)}주</span>}</span>
                </div>
                {/* 탭 연계 — 배분 지시를 그대로 추적탭 포지션으로 */}
                <button onClick={() => {
                  if (!held(s.tk)) setPos(v => [...v, { id: Date.now(), t: s.tk, avg: s.c, role: "etf",
                    date: new Date().toISOString().slice(0, 10) }]);
                  setTab("track");
                }} style={{ width: "100%", marginTop: 8, background: held(s.tk) ? "rgba(255,255,255,.05)" : "rgba(48,209,88,.12)",
                  border: `1px solid ${held(s.tk) ? C.border : C.emerald + "55"}`, color: held(s.tk) ? C.dim : C.emerald,
                  borderRadius: 6, padding: "6px 0", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>
                  {held(s.tk) ? "📁 추적탭에서 보기" : "＋ 추적탭에 등록"}</button>
              </div>))}
          </div>
          <div style={{ ...css.card, marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, color: C.dim }}>투입 자본 (원)</span>
              <input type="number" value={cap} onChange={e => setCap(Number(e.target.value) || 0)}
                style={{ background: "rgba(255,255,255,.05)", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 9px", color: C.text, fontSize: 11.5, width: 140 }} />
              <span style={{ fontSize: 11, color: C.muted }}>
                → {holds.length}분할 {money(per, "kr")} 씩
                {perUsd != null && <> (≈ ${num(perUsd, 0)})</>}
              </span>
            </div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>
              {fx ? <>환율 {num(fx, 1)}원/$ 기준 · </> : <>환율을 불러오지 못해 주 수는 생략했습니다 · </>}
              월 1회 리밸런스. 미국 ETF는 해외주식 양도세 22%(연 250만원 초과분) — 잦은 교체는 세금이 불리합니다.
            </div>
          </div>
        </>)}

      <h2 style={css.h2}>📋 전 섹터 순위</h2>
      <div style={css.card}>
        <Scroll>
          <table style={tbl}>
            <thead><tr>{["#", "섹터", "6개월", "3개월", "1달누적", "200일선"].map((h, i) =>
              <th key={h} style={{ ...th, textAlign: i <= 1 ? "left" : "right" }}>{h}</th>)}</tr></thead>
            <tbody>{market.sectors.map(s => (
              <tr key={s.tk} style={market.allocation.holds.includes(s.tk) ? { background: "rgba(48,209,88,.06)" } : undefined}>
                <td style={{ ...td, color: C.muted }}>{s.rank}</td>
                <td style={td}><b>{s.label}</b> <span style={{ color: C.muted, fontSize: 9.5 }}>{s.tk}</span></td>
                <td style={{ ...tdR, color: col(s.m6), fontWeight: 700 }}>{pct(s.m6, 1)}</td>
                <td style={{ ...tdR, color: col(s.m3) }}>{pct(s.m3, 1)}</td>
                <td style={{ ...tdR, color: col(s.d21) }}>{pct(s.d21)}</td>
                <td style={{ ...tdR, color: col(s.ma200p) }}>{pct(s.ma200p, 1)}</td>
              </tr>))}</tbody>
          </table>
        </Scroll>
      </div>
    </>
  );
}

/* ══════════════ 3. 발굴 ══════════════ */
function FindTab({ list, openStock, watch, toggleWatch, market, seen }) {
  const [onlyGo, setOnlyGo] = useState(true);
  const [mkt, setMkt] = useState("all");
  const [needBrk, setNeedBrk] = useState(false);      // ★ 돌파는 이제 '선택'
  const [sortBy, setSortBy] = useState("rs");

  const pool = useMemo(() => {
    let r = list.filter(s => (s.tvr ?? 0) >= 40);
    if (mkt !== "all") r = r.filter(s => s.m === mkt);
    return r.map(s => ({ s, v: verdictFind(s, market.judge[s.m]?.verdict) }));
  }, [list, mkt, market]);

  const rows = useMemo(() => {
    let r = pool;
    if (onlyGo) r = r.filter(x => x.v?.k === "go");
    if (needBrk) r = r.filter(x => x.s.brk || x.s.stFlip);
    const key = { rs: x => -(x.s.rs ?? 0), vol: x => -(x.s.atrr ?? -1),
                  days: x => -(seen.days(x.s.t) ?? 0), tv: x => -(x.s.tvr ?? 0) }[sortBy];
    return [...r].sort((a, b) => key(a) - key(b)).slice(0, 60);
  }, [pool, onlyGo, needBrk, sortBy, seen]);

  const nGo = pool.filter(x => x.v?.k === "go").length;
  const nBrk = pool.filter(x => x.v?.k === "go" && (x.s.brk || x.s.stFlip)).length;

  return (
    <>
      <h2 style={css.h2}>🔍 발굴 <span style={css.lbl}>— 가격구조 + RS(6개월) 상위</span></h2>

      {/* 시장별 근거 — 같은 규칙이 두 시장에 다르게 통합니다 */}
      <div style={{ ...css.card, marginBottom: 8, background: "rgba(6,182,212,.04)", borderColor: "rgba(6,182,212,.25)" }}>
        <div style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.8 }}>
          <b style={{ color: C.emerald }}>🇰🇷 한국 — 검증됨</b> {EVIDENCE.find.kr.note}<br />
          <b style={{ color: C.gold }}>🇺🇸 미국 — 최근 근거 약함</b> {EVIDENCE.find.us.note}<br />
          <span style={{ color: C.muted, fontSize: 10.5 }}>
            미국 종목은 대신 <b style={{ color: C.dim }}>변동성 상위</b>가 최근 가장 강한 신호였습니다 (+4.10% 유의). 아래 ⚡ 칩을 참고하세요.
          </span>
        </div>
      </div>

      <div style={{ ...css.card, marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <Toggle on={onlyGo} onClick={() => setOnlyGo(v => !v)}>🟢 후보만 ({nGo})</Toggle>
          {[["all", "전체"], ["us", "🇺🇸"], ["kr", "🇰🇷"]].map(([k, l]) =>
            <Toggle key={k} on={mkt === k} onClick={() => setMkt(k)}>{l}</Toggle>)}
          <span style={{ width: 1, height: 15, background: C.border, margin: "0 2px" }} />
          <Toggle on={needBrk} onClick={() => setNeedBrk(v => !v)}>돌파만 ({nBrk})</Toggle>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 7,
                      paddingTop: 7, borderTop: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 10, color: C.muted }}>정렬</span>
          {[["rs", "RS 높은 순"], ["vol", "⚡변동성 높은 순"], ["days", "오래 머문 순"], ["tv", "거래대금 순"]].map(([k, l]) =>
            <Toggle key={k} on={sortBy === k} onClick={() => setSortBy(k)}>{l}</Toggle>)}
        </div>
        <div style={{ fontSize: 9.5, color: C.muted, marginTop: 7 }}>
          거래대금 하위 40% 제외 · 최대 60개 ·
          <b style={{ color: C.dim }}> 돌파는 필수 조건에서 뺐습니다</b> — 후보를 85% 줄이는데 성과 차이가 없었고,
          하루짜리 사건이라 목록이 매일 뒤집혔습니다.
        </div>
      </div>

      <div style={css.card}>
        <Range4Head />
        {rows.length === 0 ? <Empty>조건에 맞는 종목이 없습니다.</Empty> : rows.map(({ s, v }) => {
          const d = seen.days(s.t);
          return (
            <StockRow key={s.t} s={s} verdict={v} isWatch={watch.includes(s.t)} onToggle={toggleWatch} onOpen={openStock}
              chips={<>
                <Chip tone={s.tmpl ? "g" : "n"}>가격구조 {s.tmpl ? "✓" : "✕"}</Chip>
                <Chip tone={(s.rs ?? 0) >= 70 ? "g" : "n"}>RS {s.rs != null ? Math.floor(s.rs) : "—"}</Chip>
                {s.atrr != null && (
                  <Chip tone={s.m === "us" && s.atrr >= 80 ? "g" : "n"}>⚡변동성 {Math.floor(s.atrr)}</Chip>)}
                {(s.brk || s.stFlip) && <Chip tone="c">{s.brk ? "재돌파" : "ST전환"}</Chip>}
                {(s.rsi ?? 0) > 75 && <Chip tone="w">RSI {s.rsi.toFixed(0)} 과열</Chip>}
                {d != null && d >= 5 && <Chip tone="n">{d}일째 후보</Chip>}
              </>}
              right={<><Range4 s={s} /><div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>거래대금 {money(s.tv, s.m)}</div></>} />
          );
        })}
      </div>
      <Note>
        <b>가격구조</b> = 200/150/50일선 정배열 + 52주 저점 +30%↑ + 고점 −25% 이내 (7개 조건) ·
        <b> RS</b> = 같은 시장 안에서 6개월 수익률 백분위 (검증: 21/42/63/126일 중 126일이 양쪽 시장 모두 최고) ·
        <b> ⚡변동성</b> = ATR÷가격 백분위 (미국에서만 신호로 유효) ·
        <b> N일째 후보</b> = 이 화면을 열었을 때 그 종목이 목록에 있던 날 수 — 내가 지켜본 기간입니다.
      </Note>
    </>
  );
}

/* ══════════════ 4. 과매도 (베타 흡수) ══════════════ */
function OversoldTab({ list, openStock, watch, toggleWatch }) {
  const [deep, setDeep] = useState(true);
  // ★ 기본은 미국만. 한국은 검증에서 −7.24%로 유의하게 손해였습니다.
  const [showKr, setShowKr] = useState(false);
  const all = useMemo(() =>
    list.filter(s => (s.tvr ?? 0) >= 40 && s.w52p != null && s.hlt != null)
        .map(s => ({ s, v: verdictOversold(s) }))
        .filter(x => deep ? x.v.k === "watch" : x.v.k !== "no"), [list, deep]);
  const nKr = all.filter(x => x.s.m === "kr").length;
  const rows = useMemo(() =>
    all.filter(x => showKr || x.s.m === "us")
       .sort((a, b) => (a.s.w52p ?? 0) - (b.s.w52p ?? 0)).slice(0, 60), [all, showKr]);
  return (
    <>
      <h2 style={css.h2}>🌊 과매도 <span style={css.lbl}>— 🇺🇸 미국 전용 · 장기 관찰</span></h2>
      <div style={{ ...css.card, marginBottom: 8, background: "rgba(255,69,58,.06)", borderColor: "rgba(255,69,58,.3)" }}>
        <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.75 }}>
          <b style={{ color: C.rd || C.red }}>🇰🇷 한국 종목은 기본으로 뺐습니다.</b> {EVIDENCE.oversold.kr.note}<br />
          <b style={{ color: C.emerald }}>🇺🇸 미국은 검증됨</b> — {EVIDENCE.oversold.us.note}
          <span style={{ color: C.muted }}> (단 생존편향 미보정이라 실제는 이보다 낮습니다)</span>
        </div>
      </div>
      <div style={{ ...css.card, marginBottom: 8, background: "rgba(6,182,212,.05)", borderColor: "rgba(6,182,212,.3)" }}>
        <div style={{ fontSize: 12, color: C.dim }}>
          <b style={{ color: C.text }}>원래 좋은 종목이 크게 빠진 것</b>을 찾습니다 — 낙폭은 기회를, 장기 건강도는 "망가진 종목이 아니라는 증거"를 담당합니다.
          <br /><b style={{ color: C.gold }}>청산 규칙이 발굴탭과 다릅니다</b> — 손절 없이 <b style={{ color: C.text }}>12~24개월 보유</b>. 단기 매매용이 아닙니다.
        </div>
      </div>
      <div style={{ ...css.card, marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <Toggle on={deep} onClick={() => setDeep(true)}>깊은 낙폭 (−40%↓)</Toggle>
          <Toggle on={!deep} onClick={() => setDeep(false)}>넓게 보기 (−25%↓)</Toggle>
          <span style={{ width: 1, height: 15, background: C.border, margin: "0 2px" }} />
          <Toggle on={showKr} onClick={() => setShowKr(v => !v)}>🇰🇷 한국 {nKr}개 보기 (검증 실패)</Toggle>
          <span style={{ fontSize: 10, color: C.muted, marginLeft: "auto" }}>낙폭 큰 순 · 3년 건강도 60%↑</span>
        </div>
      </div>
      <div style={css.card}>
        <Range4Head />
        {rows.length === 0 ? <Empty>조건에 맞는 종목이 없습니다.</Empty> : rows.map(({ s, v }) => (
          <StockRow key={s.t} s={s} verdict={v} isWatch={watch.includes(s.t)} onToggle={toggleWatch} onOpen={openStock}
            chips={<>
              <Chip tone="r">고점대비 {s.w52p?.toFixed(0)}%</Chip>
              <Chip tone={(s.hlt ?? 0) >= 0.7 ? "g" : "c"}>{s.hltY ?? 3}년건강 {((s.hlt ?? 0) * 100).toFixed(0)}%</Chip>
              <Chip tone={(s.rsi ?? 50) < 30 ? "c" : "n"}>RSI {s.rsi?.toFixed(0) ?? "—"}</Chip>
              <Chip tone={(s.ma200p ?? 0) > 0 ? "g" : "n"}>200일선 {pct(s.ma200p, 0)}</Chip>
              {/* 200일선을 -50% 넘게 밑돌면 '눌림'이 아니라 구조가 깨진 경우가 많습니다.
                  백테스트 규칙(-40% + 건강도 60%)은 그대로 두고, 사실만 표시합니다. */}
              {s.m === "kr" && <Chip tone="r">⚠ 한국 — 이 전략 검증 실패</Chip>}
              {(s.ma200p ?? 0) < -50 && <Chip tone="r">⚠ 200일선 −50%↓ · 구조 훼손 의심</Chip>}
            </>}
            right={<><Range4 s={s} /><div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>거래대금 {money(s.tv, s.m)}</div></>} />
        ))}
      </div>
      <Note>낙폭이 아무리 커도 <b>200일선을 −50% 넘게 밑도는 종목</b>은 회복이 아니라 구조 훼손일 때가 많습니다 — 그런 종목엔 ⚠ 를 붙여 두었습니다(현재 목록에 2종목).
        3년 건강도 = 과거 3년 중 200일선 위에 있던 비율. 검증: 낙폭 −40%↓ + 건강도 60%↑ 조합이 12개월 보유 시 시장 대비 중앙값 +10.1%(승률 60%). <b>단 생존편향 미보정이라 실제는 이보다 낮습니다.</b></Note>
    </>
  );
}

/* ══════════════ 5. 차트 ══════════════ */
/** 차트에 그리는 값은 전부 /data/bars/<티커>.json 에 들어 있는 값입니다.
 *  이 컴포넌트는 지표를 하나도 계산하지 않습니다 — 그래서 차트와 위 판단이 어긋날 수 없습니다. */
function ChartTab({ stocks, sel, watch, toggleWatch, market, pos, setPos, setTab }) {
  const s = sel ? stocks[sel] : null;
  const [bars, setBars] = useState(null);
  const [busy, setBusy] = useState(false);
  const [berr, setBerr] = useState(null);
  const cache = useRef({});
  const [span, setSpan] = useState(126);                       // 기본 6개월
  const [opt, setOpt] = useState(() => {
    try { return { ...{ ichi: true, st: true, ma: true }, ...JSON.parse(localStorage.getItem("v4.chart") || "{}") }; }
    catch { return { ichi: true, st: true, ma: true }; }
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
    // 가격축 범위 — 구름을 stack 으로 깔면 0 이 축에 끌려 들어와 가격선이 납작해집니다.
    // 축 범위는 가까이 읽는 것(종가·20일선·구름·슈퍼트렌드)으로만 잡습니다.
    // 200일선까지 넣으면 크게 오른 종목(예: 삼성전자)에서 축이 0 근처까지 늘어나
    // 정작 봐야 할 가격 움직임이 위쪽에 눌려 붙어 안 보입니다. 200일선은 화면 밖으로
    // 나가면 잘리고, 가격이 다가오면 자연스럽게 들어옵니다 (수치는 아래 '근거'에 있습니다).
    const vals = [];
    for (const r of rows) {
      for (const k of ["c", "ma20", "cloudLo", ...ST_DOM]) if (r[k] != null) vals.push(r[k]);
      if (r.cloudLo != null && r.cloudBand != null) vals.push(r.cloudLo + r.cloudBand);
    }
    if (!vals.length) return { rows, dom: ["auto", "auto"], ticks: undefined };
    const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.06 || hi * 0.02;
    return { rows, ...niceAxis(Math.max(0, lo - pad), hi + pad) };
  }, [bars, span]);
  const data = view?.rows || null;

  if (!sel) return <Empty>위 검색창에서 종목을 찾거나, 다른 탭에서 종목을 누르면 여기에 열립니다.</Empty>;
  if (!s) return <Empty>{sel} 는 스냅샷에 없습니다.</Empty>;

  const v = verdictFind(s, market.judge[s.m]?.verdict);
  const ma200v = s.ma200p != null ? s.c / (1 + s.ma200p / 100) : null;
  const hi52 = s.w52p != null ? s.c / (1 + s.w52p / 100) : null;
  const held = (pos || []).some(p => p.t === s.t);
  const trend = (s.tmpl && (s.rs ?? 0) >= 70) ? ["강", C.emerald]
    : (s.tmpl || (s.st ?? 0) >= 2) ? ["중", C.gold] : ["약", C.muted];
  const power = (s.rsi ?? 0) > 75 ? ["과열", C.red] : (s.macdH ?? 0) > 0 ? ["양호", C.emerald] : ["둔화", C.muted];
  const rel = (s.rs ?? 0) >= 70 ? ["우위", C.emerald] : (s.rs ?? 0) >= 40 ? ["보통", C.dim] : ["열위", C.red];
  const pf = (val) => price(val, s.m);
  // MACD 히스토그램을 원/달러 그대로 쓰면 SK하이닉스가 "-40401.99" 로 찍혀 읽을 수 없습니다.
  // 같은 값을 주가 대비 %로 바꿔 종목끼리 비교되게 합니다 (재계산이 아니라 단위 환산).
  const macdTxt = (s.macdH != null && s.c)
    ? `${s.macdH >= 0 ? "+" : ""}${(s.macdH / s.c * 100).toFixed(2)}% (${s.macdH >= 0 ? "양" : "음"})` : "—";
  const axis = { fontSize: 8.5, fill: C.muted };
  const tip = {
    contentStyle: { background: "#0f172a", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 },
    labelStyle: { color: C.dim }, itemStyle: { padding: 0 },
  };
  const cloudTone = data?.length ? (data[data.length - 1].cloudUp ? C.emerald : C.red) : C.emerald;
  const stNow = data?.length ? data[data.length - 1].stUpCount : null;
  // 축 폭 — 삼성전자·SK하이닉스는 눈금이 7자리라 고정 54px 로는 "​,000,000" 처럼 잘렸습니다.
  // 한글 단위(만·억·조)는 숫자보다 두 배 가까이 넓어서 글자 수로만 재면 잘립니다.
  const axisW = useMemo(() => {
    const t = view?.ticks?.length ? view.ticks : [100];
    const px = (str) => [...String(str)].reduce((a, ch) => a + (/[가-힣]/.test(ch) ? 8.6 : 4.9), 0);
    return Math.max(34, Math.min(62, Math.ceil(Math.max(...t.map(x => px(shortNum(x)))) + 12)));
  }, [view]);

  return (
    <>
      {/* 헤더 — 판단 한 줄 + 가격만. 지표 숫자는 아래 한 벌에만 */}
      <div style={{ ...css.card, marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <Star on={watch.includes(s.t)} onClick={() => toggleWatch(s.t)} />
          <div><div style={{ fontSize: 16, fontWeight: 800 }}>{s.n}</div>
            <div style={{ fontSize: 10, color: C.muted }}>{s.t} · {s.m === "kr" ? "🇰🇷 한국" : "🇺🇸 미국"}</div></div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "ui-monospace,monospace" }}>{price(s.c, s.m)}</div>
            <div style={{ fontSize: 10, color: C.muted }}>{s.asOf} 종가</div></div>
        </div>
        <div style={{ marginTop: 9, paddingTop: 9, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <Verdict v={v} size={14} />
          <span style={{ fontSize: 11.5, color: C.dim }}>{v?.why}</span>
          <button onClick={() => {
            if (held) { setTab("track"); return; }
            setPos(vs => [...vs, { id: Date.now(), t: s.t, avg: s.c,
              role: verdictOversold(s).k === "watch" ? "long" : "swing",
              date: new Date().toISOString().slice(0, 10) }]);
            setTab("track");
          }} style={{ marginLeft: "auto", background: held ? "rgba(255,255,255,.05)" : "rgba(48,209,88,.14)",
            border: `1px solid ${held ? C.border : C.emerald + "66"}`, color: held ? C.dim : C.emerald,
            borderRadius: 6, padding: "5px 11px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            {held ? "📁 추적탭에서 보기" : `＋ ${price(s.c, s.m)} 에 보유 등록`}</button>
        </div>
      </div>

      {/* 차트 옵션 */}
      <div style={{ ...css.card, marginTop: 9, padding: "9px 12px" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {[[63, "3개월"], [126, "6개월"], [200, "전체"]].map(([n, l]) =>
            <Toggle key={n} on={span === n} onClick={() => setSpan(n)}>{l}</Toggle>)}
          <span style={{ width: 1, height: 16, background: C.border, margin: "0 3px" }} />
          {[["st", "슈퍼트렌드"], ["ichi", "구름"], ["ma", "이평선"]].map(([k, l]) =>
            <Toggle key={k} on={opt[k]} onClick={() => setOpt(o => ({ ...o, [k]: !o[k] }))}>{l}</Toggle>)}
        </div>
      </div>

      {busy ? <div style={{ ...css.card, marginTop: 9 }}><Empty>차트 불러오는 중… ({sel})</Empty></div>
        : berr ? <div style={{ ...css.card, marginTop: 9 }}><Empty>
            차트 파일을 찾지 못했습니다 ({berr}).<br />
            <span style={{ fontSize: 10.5 }}>Actions 탭에서 <b style={{ color: C.dim }}>Snapshot Build (v4)</b> 를 한 번 실행하면 <code style={{ color: C.gold }}>public/data/bars/</code> 가 생깁니다.</span>
          </Empty></div>
        : !data ? <div style={{ ...css.card, marginTop: 9 }}><Empty>이 종목의 차트 데이터가 없습니다.</Empty></div>
        : (<>
          {/* ① 가격 — 구름 · 슈퍼트렌드 · 이평선 */}
          <div style={{ ...css.card, marginTop: 9, padding: "10px 8px 4px" }}>
            <PanelLabel>가격
              {opt.st && <LegendDot c={C.emerald}>ST 상승</LegendDot>}
              {opt.st && <LegendDot c={C.red}>하락</LegendDot>}
              {opt.st && stNow != null && <span style={{ fontSize: 9, color: stNow === 3 ? C.emerald : stNow === 0 ? C.red : C.gold, fontWeight: 700 }}>
                지금 {stNow}/3</span>}
              {opt.ichi && <LegendDot c={cloudTone}>구름</LegendDot>}
              {opt.ma && <LegendDot c={C.orange}>20일</LegendDot>}
              {opt.ma && <LegendDot c={C.violet}>200일</LegendDot>}
            </PanelLabel>
            <div style={{ height: 264 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} syncId="v4chart" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,.045)" vertical={false} />
                  <XAxis dataKey="d" tick={axis} tickLine={false} interval="preserveStartEnd" minTickGap={38} />
                  <YAxis yAxisId="p" domain={view.dom} ticks={view.ticks} allowDataOverflow tick={axis}
                    width={axisW} tickFormatter={shortNum} />
                  <YAxis yAxisId="v" orientation="right" domain={[0, (m) => m * 4]} hide />
                  <Tooltip {...tip} filterNull
                    formatter={(val, name) => name === "거래량" ? [num(val, 0), name] : [pf(val), name]}
                    itemSorter={(it) => (it.name === "종가" ? -1 : 0)} />
                  {hi52 && <ReferenceLine yAxisId="p" y={hi52} stroke={C.gold} strokeDasharray="2 5" strokeWidth={1}
                    label={{ value: "52주 고점", position: "insideTopLeft", fill: C.gold, fontSize: 8.5 }} />}
                  <Bar yAxisId="v" dataKey="v" name="거래량" fill="rgba(148,163,184,.22)" isAnimationActive={false} />
                  {/* 구름: 아래 경계까지 투명 + 그 위 밴드만 색칠 (stackId 로 띠를 만듭니다) */}
                  {opt.ichi && <Area yAxisId="p" type="monotone" dataKey="cloudLo" stackId="cl" stroke="none" fill="transparent" isAnimationActive={false} legendType="none" name="구름 아래" />}
                  {opt.ichi && <Area yAxisId="p" type="monotone" dataKey="cloudBand" stackId="cl" stroke="none"
                    fill={cloudTone} fillOpacity={0.13} isAnimationActive={false} name="구름 두께" />}
                  {opt.ma && <Line yAxisId="p" type="monotone" dataKey="ma20" name="20일선" stroke={C.orange} strokeWidth={1.2} dot={false} connectNulls strokeDasharray="4 2" isAnimationActive={false} />}
                  {opt.ma && <Line yAxisId="p" type="monotone" dataKey="ma200" name="200일선" stroke={C.violet} strokeWidth={1.2} dot={false} connectNulls strokeDasharray="3 3" isAnimationActive={false} />}
                  <Line yAxisId="p" type="monotone" dataKey="c" name="종가" stroke="#FFFFFF" strokeWidth={2} dot={false} isAnimationActive={false} />
                  {/* 트리플 슈퍼트렌드 — (10,1) 굵고 진하게 → (12,3) 가늘고 옅게.
                      초록으로 보이는 선의 개수가 아래 '근거'의 ST n/3 과 같습니다. */}
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
          </div>

          {/* ② MACD */}
          <div style={{ ...css.card, marginTop: 8, padding: "10px 8px 4px" }}>
            <PanelLabel>MACD (12·26·9)
              <LegendDot c={C.cyan}>MACD</LegendDot><LegendDot c={C.gold}>시그널</LegendDot>
              <span style={{ fontSize: 9, color: C.muted }}>막대 = 히스토그램</span>
            </PanelLabel>
            <div style={{ height: 96 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} syncId="v4chart" margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
                  <XAxis dataKey="d" tick={false} tickLine={false} height={1} />
                  <YAxis tick={axis} width={axisW} tickFormatter={shortNum} />
                  <Tooltip {...tip} formatter={val => [num(val, 3), ""]} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,.18)" />
                  <Bar dataKey="hist" name="히스토그램" isAnimationActive={false}
                    shape={(pr) => <rect x={pr.x} y={pr.y} width={Math.max(1, pr.width)} height={Math.abs(pr.height)}
                      fill={pr.payload.hist >= 0 ? "rgba(48,209,88,.55)" : "rgba(255,69,58,.55)"} />} />
                  <Line type="monotone" dataKey="macd" name="MACD" stroke={C.cyan} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
                  <Line type="monotone" dataKey="signal" name="시그널" stroke={C.gold} strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ③ RSI */}
          <div style={{ ...css.card, marginTop: 8, padding: "10px 8px 4px" }}>
            <PanelLabel>RSI (14, Wilder)
              <span style={{ fontSize: 9, color: C.muted }}>70 위 과열 · 30 아래 과매도</span>
            </PanelLabel>
            <div style={{ height: 96 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} syncId="v4chart" margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
                  <XAxis dataKey="d" tick={axis} tickLine={false} interval="preserveStartEnd" minTickGap={38} />
                  <YAxis domain={[0, 100]} ticks={[30, 50, 70]} tick={axis} width={axisW} />
                  <Tooltip {...tip} formatter={val => [num(val, 1), "RSI"]} />
                  <ReferenceLine y={70} stroke="rgba(255,69,58,.35)" strokeDasharray="3 3" />
                  <ReferenceLine y={50} stroke="rgba(255,255,255,.10)" />
                  <ReferenceLine y={30} stroke="rgba(6,182,212,.35)" strokeDasharray="3 3" />
                  <Area type="monotone" dataKey="rsi" name="RSI" stroke={C.cyan} fill="rgba(6,182,212,.09)" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div style={{ fontSize: 9.5, color: C.muted, margin: "6px 2px 0" }}>
            최근 {data.length}거래일 · 세 패널은 같은 날짜에 붙어 있어 한 곳에 커서를 두면 나머지도 같이 움직입니다.
            차트에 그린 값은 전부 파이프라인이 계산해 둔 것이라 아래 '근거' 숫자와 항상 같습니다.
          </div>
        </>)}

      {/* 근거 — 세 묶음 고정, 각 숫자 한 번만 */}
      <h2 style={css.h2}>📈 근거 <span style={css.lbl}>— 추세 · 동력 · 상대 (모든 종목 같은 순서)</span></h2>
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
        {[["추세 (구조)", trend, `가격구조 ${s.tmpl ? "✓" : "✕"} · ST ${s.st ?? "—"}/3 · 구름 ${s.cloud === 1 ? "위" : s.cloud === 0 ? "안" : s.cloud === -1 ? "아래" : "—"} · 200일선 ${pct(s.ma200p, 1)}`],
          ["동력 (모멘텀)", power, `RSI ${s.rsi?.toFixed(1) ?? "—"} · MACD ${macdTxt} · 거래량 ${s.vr5?.toFixed(2) ?? "—"}x`],
          ["상대 (시장 대비)", rel, `RS 백분위 ${s.rs?.toFixed(1) ?? "—"} · 52주 고점 대비 ${pct(s.w52p, 1)}`],
        ].map(([label, [t, c], detail]) => (
          <div key={label} style={{ flex: 1, minWidth: 190, background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, color: C.dim }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: c, marginTop: 2 }}>{t}</div>
            <div style={{ fontSize: 9.5, color: C.muted, marginTop: 3 }}>{detail}</div>
          </div>))}
      </div>
      <div style={{ ...css.card, marginTop: 9 }}>
        <div style={{ fontSize: 10.5, color: C.dim }}>구간 <Range4 s={s} /> <span style={{ color: C.muted }}>(1일 · 3일누적 · 5일누적 · 1달누적)</span></div>
        <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>
          거래대금 {money(s.tv, s.m)} <span title="같은 시장 안에서의 순위. 100 에 가까울수록 많이 거래됩니다">(백분위 {s.tvr?.toFixed(0) ?? "—"} / 100)</span>
          {s.hlt != null && <> · {s.hltY ?? 3}년 건강도 {(s.hlt * 100).toFixed(0)}%</>}
          {" · 지표 계산 "}{s.bars}봉
        </div>
      </div>
      <Note>모든 지표는 파이프라인이 계산한 값을 그대로 표시합니다. 이 화면에서 다시 계산하지 않으므로 알림·다른 탭과 항상 같은 값입니다.</Note>
    </>
  );
}

/** 트리플 슈퍼트렌드 열 이름 — 파이프라인의 ST_SET (10,1)(11,2)(12,3) 과 같은 순서 */
/** 축 눈금 축약 — 1,401,000 → 140만 / 2.3조. 원화 종목의 7자리 눈금이 잘리지 않게. */
function shortNum(x) {
  if (x == null || !isFinite(x)) return "";
  const a = Math.abs(x), sg = x < 0 ? "-" : "";
  if (a >= 1e12) return `${sg}${+(a / 1e12).toFixed(1)}조`;
  if (a >= 1e8) return `${sg}${+(a / 1e8).toFixed(a >= 1e9 ? 0 : 1)}억`;
  if (a >= 1e4) return `${sg}${+(a / 1e4).toFixed(a >= 1e5 ? 0 : 1)}만`;
  if (a >= 100) return `${sg}${Math.round(a).toLocaleString("ko-KR")}`;
  if (a >= 1) return `${sg}${+a.toFixed(1)}`;
  return `${sg}${+a.toFixed(2)}`;
}

const ST_KEYS = ["st1", "st2", "st3"];
const ST_DOM = ["st1Up", "st1Dn", "st2Up", "st2Dn", "st3Up", "st3Dn"];

/** 축은 데이터에 딱 맞추고, 눈금만 보기 좋은 수로 찍습니다.
 *  (범위까지 반올림하면 삼성전자처럼 자릿수가 큰 종목에서 축이 0 까지 늘어나
 *   정작 봐야 할 가격 움직임이 위쪽에 눌려 붙습니다.) */
function niceAxis(lo, hi, want = 5) {
  const span = hi - lo;
  if (!(span > 0)) return { dom: [lo, hi], ticks: undefined };
  const raw = span / want, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(x => x >= raw) || 10 * mag;
  const ticks = [];
  for (let x = Math.ceil(lo / step) * step; x <= hi; x += step) ticks.push(+x.toFixed(6));
  return { dom: [lo, hi], ticks: ticks.length >= 2 ? ticks : undefined };
}

const PanelLabel = ({ children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 10.5, fontWeight: 700, color: C.dim, padding: "0 4px 6px" }}>{children}</div>
);
const LegendDot = ({ c, children }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, color: C.muted, fontWeight: 400 }}>
    <span style={{ width: 8, height: 2.5, background: c, borderRadius: 2, display: "inline-block" }} />{children}</span>
);

/* ══════════════ 6. 추적 ══════════════ */
function TrackTab({ stocks, watch, toggleWatch, openStock, pos, setPos, market }) {
  const [role, setRole] = useState("all");
  /* ★ 손절 폭과 '1회 위험'을 사용자가 정합니다.
     검증: 손절이 타이트할수록 성과가 일관되게 나빠졌습니다
     (미국 손절없음 +2.19% → −5% +0.89% / 한국도 같은 방향).
     그래서 기본을 −10%로 넓혔는데, 폭을 넓히면 종목당 금액을 줄여야
     총 위험이 같습니다. 그 계산을 아래 계산기가 대신합니다. */
  const [stopPct, setStopPct] = useState(() => Number(localStorage.getItem("v5.stop") || 10));
  const [cap, setCap] = useState(() => Number(localStorage.getItem("v4.cap") || 10000000));
  const [riskPct, setRiskPct] = useState(() => Number(localStorage.getItem("v5.risk") || 1));
  useEffect(() => { localStorage.setItem("v5.stop", String(stopPct)); }, [stopPct]);
  useEffect(() => { localStorage.setItem("v5.risk", String(riskPct)); }, [riskPct]);
  useEffect(() => { localStorage.setItem("v4.cap", String(cap)); }, [cap]);
  const riskWon = cap * riskPct / 100;
  const perPos = stopPct > 0 ? riskWon / (stopPct / 100) : 0;
  // ★ 배분탭이 지시하는 섹터 ETF 는 snapshot.stocks 에 없습니다(시장 데이터 쪽에 있음).
  //   그대로 두면 "SMH 보유 등록" 이 '스냅샷에 없는 티커' 로 거부됩니다.
  const etf = useMemo(() => Object.fromEntries((market?.sectors || []).map(x =>
    ({ t: x.tk, n: `${x.label} ETF`, m: "us", c: x.c, d1: x.d1, d3: x.d3, d5: x.d5, d21: x.d21,
       ma200p: x.ma200p, isEtf: true })).map(o => [o.t, o])), [market]);
  const look = useCallback((t) => stocks[t] || etf[t] || null, [stocks, etf]);
  const [form, setForm] = useState(null);   // {t, avg, role} — 인라인 폼 (prompt/alert 은 모바일에서 최악)
  const rows = pos.filter(p => role === "all" || p.role === role);
  const RB = { etf: ["ETF 배분", C.gold], swing: ["단기 매매", C.emerald], long: ["장기 관찰", C.cyan] };
  const submit = () => {
    const key = (form.t || "").trim().toUpperCase();
    const found = look(key);
    if (!found) { setForm({ ...form, err: "스냅샷에 없는 티커입니다" }); return; }
    const avg = Number(form.avg);
    if (!avg || avg <= 0) { setForm({ ...form, err: "평균단가를 숫자로 입력해 주세요" }); return; }
    setPos(v => [...v, { id: Date.now(), t: key, avg,
                         role: form.role || (found.isEtf ? "etf" : "swing"),
                         date: new Date().toISOString().slice(0, 10) }]);
    setForm(null);
  };
  return (
    <>
      <h2 style={css.h2}>🧮 포지션 크기 <span style={css.lbl}>— 손절을 넓혔으면 금액은 줄여야 합니다</span></h2>
      <div style={{ ...css.card, marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: C.dim }}>총 자본</span>
          <input type="number" value={cap} onChange={e => setCap(Number(e.target.value) || 0)} style={inp(130)} />
          <span style={{ fontSize: 11, color: C.dim }}>1회 위험</span>
          {[0.5, 1, 2].map(v => <Toggle key={v} on={riskPct === v} onClick={() => setRiskPct(v)}>{v}%</Toggle>)}
          <span style={{ fontSize: 11, color: C.dim }}>손절</span>
          {[5, 8, 10, 12].map(v => <Toggle key={v} on={stopPct === v} onClick={() => setStopPct(v)}>−{v}%</Toggle>)}
        </div>
        <div style={{ marginTop: 9, paddingTop: 9, borderTop: `1px solid ${C.border}`,
                      display: "flex", gap: 14, flexWrap: "wrap", alignItems: "baseline" }}>
          <div>
            <div style={{ fontSize: 9.5, color: C.muted }}>한 종목에 넣을 금액</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: C.emerald, fontFamily: "ui-monospace,monospace" }}>
              {money(perPos, "kr")}</div>
          </div>
          <div>
            <div style={{ fontSize: 9.5, color: C.muted }}>손절 시 잃는 돈</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.red, fontFamily: "ui-monospace,monospace" }}>
              {money(riskWon, "kr")}</div>
          </div>
          <div>
            <div style={{ fontSize: 9.5, color: C.muted }}>동시 보유 가능</div>
            <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "ui-monospace,monospace" }}>
              {perPos > 0 ? Math.floor(cap / perPos) : 0}종목</div>
          </div>
        </div>
        <div style={{ fontSize: 10, color: C.muted, marginTop: 8, lineHeight: 1.7 }}>
          손절을 −5%에서 −10%로 넓히면 <b style={{ color: C.dim }}>종목당 금액은 절반</b>이 됩니다 — 그래야 한 번에 잃는 돈이 같습니다.<br />
          검증: 손절이 타이트할수록 성과가 일관되게 <b style={{ color: C.dim }}>나빠졌습니다</b>
          (미국 손절없음 +2.19% → −12% +1.19% → −8% +1.05% → −5% +0.89%). 정상적인 눌림에 걸려 이길 종목을 미리 털리기 때문입니다.
          <br />다만 <b style={{ color: C.dim }}>손절 없이 버티는 건 실전에서 불가능</b>합니다 — 한 종목 −60%를 견뎌야 성립하는 숫자입니다.
        </div>
      </div>

      <h2 style={css.h2}>💼 보유 <span style={css.lbl}>— 역할별로 청산 규칙이 다릅니다</span></h2>
      <div style={{ ...css.card, marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {[["all", "전체"], ["etf", "🧺 ETF"], ["swing", "🔍 단기"], ["long", "🌊 장기"]].map(([k, l]) =>
            <Toggle key={k} on={role === k} onClick={() => setRole(k)}>{l}</Toggle>)}
          <button onClick={() => setForm(form ? null : { t: "", avg: "", role: "swing" })}
            style={{ ...linkBtn, marginLeft: "auto", fontSize: 11 }}>{form ? "닫기" : "+ 포지션 추가"}</button>
        </div>
        {form && (
          <div style={{ marginTop: 9, paddingTop: 9, borderTop: `1px solid ${C.border}`, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input value={form.t} onChange={e => setForm({ ...form, t: e.target.value, err: null })}
              placeholder="티커 (AAPL / 005930)" style={inp(150)} />
            <input value={form.avg} onChange={e => setForm({ ...form, avg: e.target.value, err: null })}
              placeholder="평균단가" inputMode="decimal" style={inp(110)} />
            {[["etf", "🧺 ETF"], ["swing", "🔍 단기"], ["long", "🌊 장기"]].map(([k, l]) =>
              <Toggle key={k} on={form.role === k} onClick={() => setForm({ ...form, role: k })}>{l}</Toggle>)}
            <button onClick={submit} style={{ background: "rgba(48,209,88,.15)", border: `1px solid ${C.emerald}66`,
              color: C.emerald, borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>등록</button>
            {form.err && <span style={{ fontSize: 10.5, color: C.red }}>{form.err}</span>}
          </div>)}
      </div>
      {rows.length === 0 ? <div style={css.card}><Empty>기록된 포지션이 없습니다.</Empty></div> :
        rows.map(p => {
          const s = look(p.t); if (!s) return null;
          const pl = (s.c / p.avg - 1) * 100;
          const stop = p.role === "swing" ? p.avg * (1 - stopPct / 100) : null;
          const [rl, rc] = RB[p.role] || RB.swing;
          return (
            <div key={p.id} style={{ ...css.card, marginTop: 8, background: C.panel2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <Chip tone={p.role === "etf" ? "w" : p.role === "long" ? "c" : "g"}>{rl}</Chip>
                <div onClick={() => openStock(p.t)} style={{ cursor: "pointer" }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{s.n}</span>
                  <span style={{ fontSize: 10, color: C.muted, marginLeft: 6 }}>{p.t} · 진입 {p.date}</span>
                </div>
                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: col(pl), fontFamily: "ui-monospace,monospace" }}>{pct(pl)}</div>
                  <div style={{ fontSize: 9.5, color: C.muted }}>평단 {price(p.avg, s.m)} → {price(s.c, s.m)}</div>
                </div>
                <button onClick={() => setPos(v => v.filter(x => x.id !== p.id))}
                  style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 14 }}>×</button>
              </div>
              {stop && (<>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: C.dim, marginTop: 8 }}>
                  <span>손절선 <b style={{ color: C.red, fontFamily: "ui-monospace,monospace" }}>{price(stop, s.m)}</b> <span style={{ color: C.muted }}>(평단 −{stopPct}%)</span></span>
                  <span>{s.c > stop ? <>여유 <b style={{ color: C.emerald }}>{pct((s.c - stop) / s.c * 100)}</b></> : <b style={{ color: C.red }}>손절선 하회 — 매도 검토</b>}</span>
                </div>
                {/* 눈금: 손절선=0%, 평단=100%. 위에 적힌 "여유"와 같은 기준입니다 */}
                <div style={{ height: 6, borderRadius: 4, background: "rgba(255,255,255,.07)", marginTop: 6, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, (s.c - stop) / (p.avg - stop) * 100))}%`,
                                background: `linear-gradient(90deg,${C.red},${C.emerald})`, borderRadius: 4 }} />
                </div>
                <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>왼쪽 끝 = 손절선, 오른쪽 끝 = 평단</div></>)}
              {p.role === "swing" && <div style={{ fontSize: 10, color: C.muted, marginTop: 7 }}>
                단기 — 검증상 <b style={{ color: C.dim }}>최소 3~6개월</b>은 들고 가야 합니다 (21일 보유는 성과가 없었습니다)</div>}
              {p.role === "long" && <div style={{ fontSize: 10, color: C.muted, marginTop: 7 }}>장기 관찰 — 손절 없이 12~24개월 보유 기준</div>}
              {p.role === "etf" && <div style={{ fontSize: 10, color: C.muted, marginTop: 7 }}>
                ETF 배분 — 손절이 아니라 <b style={{ color: C.dim }}>월 1회 리밸런스</b>로 교체합니다. 배분탭 상위 3개에서 빠지면 매도.</div>}
            </div>);
        })}

      <h2 style={css.h2}>👁 관심 종목 <span style={css.lbl}>— 어느 탭에서든 ★ 를 누르면 여기에 모입니다</span></h2>
      <div style={css.card}>
        {watch.length > 0 && <Range4Head />}
        {watch.length === 0 ? <Empty>★ 를 눌러 관심 종목을 등록해 보세요.</Empty> :
          watch.map(t => { const s = look(t); if (!s) return null;
            return <StockRow key={t} s={s} isWatch onToggle={toggleWatch} onOpen={openStock}
              chips={<>
                <Chip tone={s.tmpl ? "g" : "n"}>추세 {s.tmpl ? "✓" : "✕"}</Chip>
                <Chip tone={(s.rs ?? 0) >= 70 ? "g" : "n"}>RS {s.rs != null ? Math.floor(s.rs) : "—"}</Chip>
                <Chip tone={(s.w52p ?? 0) <= -40 ? "c" : "n"}>고점대비 {pct(s.w52p, 0)}</Chip>
              </>}
              right={<Range4 s={s} />} />; })}
      </div>
    </>
  );
}

/* ══════════════ 잡 UI ══════════════ */
const tbl = { width: "100%", borderCollapse: "collapse", fontSize: 10.5 };
const th = { padding: "5px 3px", borderBottom: `1px solid ${C.border}`, color: C.dim, fontWeight: 600, fontSize: 9, whiteSpace: "nowrap" };
const td = { padding: "6px 3px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };
const tdR = { ...td, textAlign: "right", fontFamily: "ui-monospace,monospace" };
const linkBtn = { background: "none", border: "none", color: C.cyan, cursor: "pointer", fontSize: 10, padding: 0, textDecoration: "underline" };
const inp = (w) => ({ background: "rgba(255,255,255,.05)", border: `1px solid ${C.border}`, borderRadius: 6,
                      padding: "5px 9px", color: C.text, fontSize: 11.5, width: w, outline: "none" });
/** 가로 스크롤 표 — 좁은 화면에서 열이 잘릴 때 그 사실을 눈에 보이게 알려 줍니다 */
const Scroll = ({ children }) => {
  const ref = useRef(null);
  const [more, setMore] = useState(false);
  const check = useCallback(() => {
    const e = ref.current; if (!e) return;
    setMore(e.scrollWidth - e.clientWidth - e.scrollLeft > 4);
  }, []);
  useEffect(() => { check(); window.addEventListener("resize", check); return () => window.removeEventListener("resize", check); }, [check]);
  return (
    <div style={{ position: "relative" }}>
      <div ref={ref} onScroll={check} style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>{children}</div>
      {more && (<>
        <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 34, pointerEvents: "none",
                      background: `linear-gradient(90deg, transparent, ${C.panel})` }} />
        <div style={{ position: "absolute", top: "50%", right: 2, transform: "translateY(-50%)", pointerEvents: "none",
                      fontSize: 13, color: C.gold, opacity: .8 }}>›</div>
      </>)}
    </div>
  );
};
const Toggle = ({ on, onClick, children }) => (
  <button onClick={onClick} style={{
    fontSize: 10.5, fontWeight: 700, padding: "4px 9px", borderRadius: 6, cursor: "pointer",
    background: on ? "rgba(245,158,11,.14)" : "rgba(255,255,255,.04)",
    color: on ? C.gold : C.muted, border: `1px solid ${on ? C.gold + "55" : C.border}`,
  }}>{children}</button>);
const Note = ({ children }) => <div style={{ fontSize: 10, color: C.muted, marginTop: 9, padding: "0 2px" }}>▸ {children}</div>;
