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
 * 탭 6개 — 시장 · 배분 · 발굴 · 과매도 · 차트 · 추적 (하단 탭바 · 휴대폰 우선 레이아웃)
 * 전역 상태 하나로 탭 간 연계 (종목 클릭 → 차트 / 관심 토글 즉시 반영 / 검색)
 */
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  ComposedChart, Line, Area, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

export const APP_VERSION = "v6.1.0";

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
// ★ 워크플로(daily.yml)의 cron 과 반드시 같아야 합니다.
//   무료 한도(비공개 저장소 월 2,000분)에 맞춰 하루 8회 → 2회로 줄였습니다.
//   16:00 = 한국 확정 종가 · 06:30 = 미국 확정 종가. 매매 결정은 이 두 시각 이후 값으로 합니다.
//   장중 갱신본은 아직 안 끝난 봉이라 어차피 판단에 쓰면 안 되는 값이었습니다.
const SLOTS_KST = [[16, 0], [6, 30]];
const SAT_SLOT = [9, 0];   // 토 09:00 KST 주간 백업

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
    if (dow >= 1 && dow <= 5) cand.push(16 * 60);
    if (dow >= 2 && dow <= 6) cand.push(6 * 60 + 30);
    if (dow === 6) cand.push(9 * 60);
    for (const m of cand) { const t = base + m * 60000; if (t <= nowMs && t > best) best = t; }
  }
  return best;
}
function freshness(updMs, nowMs = Date.now()) {
  const st = marketState(nowMs);
  if (!updMs) return { ...st, emoji: "⚪", label: "데이터 없음", color: C.muted, tone: "none" };
  const min = Math.floor((nowMs - updMs) / 60000);
  const days = weekdaysBetween(updMs, nowMs);
  const txt = min < 60 ? `${min}분 전` : min < 1440 ? `${Math.floor(min / 60)}시간 전` : `${(min / 1440).toFixed(1)}일 전`;
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
/** 시장 판단을 '관망 전환'에 쓸 수 있는 시장인지.
 *  파이프라인이 gate=true 로 표시한 시장(한국)만 게이트로 씁니다.
 *  미국은 검증을 통과한 타이밍 지표가 없어(15개 후보 전부 2010년 이후 −)
 *  판단을 화면에 보여주기만 하고 후보를 관망으로 바꾸지 않습니다. */
function gateOf(market, m) {
  const j = market?.judge?.[m];
  return (j && j.gate) ? j.verdict : null;
}
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
  if (deep && healthy) return { k: "watch", t: "🔵 관찰후보", c: C.cyan, why: "깊은 낙폭 + 장기 추세 건강" };
  if (mid && healthy) return { k: "soft", t: "🔷 관찰", c: "#3B82F6", why: "낙폭 진행 중" };
  return { k: "no", t: "⚪ 제외", c: C.muted, why: healthy ? "낙폭 부족" : "장기 추세 훼손" };
}

/* ══════════════ 공통 UI (휴대폰 우선) ══════════════
   원칙 — 한 손 엄지로 쓰는 화면
   · 글자는 11px 아래로 내리지 않습니다 (예전 8~9px 은 휴대폰에서 읽히지 않았습니다)
   · 누르는 것은 높이 34px 이상
   · 표 대신 '2줄 행' — 가로 스크롤이 생기지 않게
   · 탭은 화면 아래 (엄지가 닿는 곳)                                         */
const FS = { xs: 11, sm: 12, md: 13, lg: 15, xl: 20 };
const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";
const NAV_H = 60;

const Verdict = ({ v }) => v ? (
  <span style={{ fontWeight: 700, color: v.c }}>{v.t}</span>
) : null;

const Chip = ({ children, tone = "n" }) => {
  const m = { g: [C.emerald, "rgba(48,209,88,.10)"], r: [C.red, "rgba(255,69,58,.10)"],
              w: [C.gold, "rgba(245,158,11,.10)"], c: [C.cyan, "rgba(6,182,212,.10)"], n: [C.dim, "rgba(255,255,255,.05)"] }[tone];
  return <span style={{ fontSize: FS.xs, fontWeight: 600, padding: "2px 7px", borderRadius: 5, background: m[1], color: m[0], whiteSpace: "nowrap" }}>{children}</span>;
};

const Star = ({ on, onClick }) => (
  <button onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label={on ? "관심 해제" : "관심 등록"}
    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, width: 34, height: 38, margin: "-4px -6px 0 0",
             color: on ? C.gold : "rgba(156,163,175,.7)", lineHeight: 1, flexShrink: 0, padding: 0 }}>{on ? "★" : "☆"}</button>
);

const Empty = ({ children }) => (
  <div style={{ padding: "28px 12px", textAlign: "center", color: C.muted, fontSize: FS.sm }}>{children}</div>
);

const Card = ({ children, style }) => (
  <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, ...style }}>{children}</div>
);

const Sec = ({ children, right }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "16px 2px 7px" }}>
    <span style={{ fontSize: FS.md, fontWeight: 700, color: C.text }}>{children}</span>
    {right && <span style={{ fontSize: FS.xs, color: C.muted, marginLeft: "auto" }}>{right}</span>}
  </div>
);

/** 구간 수익률 — 칸마다 이름을 붙여 머리글이 따로 필요 없습니다 */
const pctFit = (v) => (v == null ? "—" : pct(v, Math.abs(v) >= 100 ? 0 : 1));
const Cells = ({ s, keys = [["1일", "d1"], ["3일", "d3"], ["5일", "d5"], ["1달", "d21"]] }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(${keys.length}, minmax(0,1fr))`, columnGap: 6 }}>
    {keys.map(([l, k]) => (
      <div key={k} style={{ minWidth: 0, overflow: "hidden" }}>
        <div style={{ fontSize: 10.5, color: C.muted, whiteSpace: "nowrap" }}>{l}</div>
        <div style={{ fontSize: FS.sm, fontFamily: MONO, color: col(s[k]), fontWeight: 600, whiteSpace: "nowrap",
                      letterSpacing: -0.3 }}>{pctFit(s[k])}</div>
      </div>))}
  </div>
);

/* ══════════════ 종목 행 (모든 탭 공통) ══════════════ */
const ONE = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
function StockRow({ s, verdict, chips, sub, onOpen, isWatch, onToggle, cells = true }) {
  return (
    <div onClick={() => onOpen(s.t)} style={{ padding: "11px 0 10px", borderBottom: `1px solid ${C.border}`, cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, ...ONE }}>{s.n || s.t}</div>
          <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 1, ...ONE }}>
            {s.m === "kr" ? "🇰🇷" : "🇺🇸"} {s.t}{verdict && <> · <Verdict v={verdict} /></>}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0, maxWidth: "46%" }}>
          <div style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO, ...ONE }}>{price(s.c, s.m)}</div>
          {sub && <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 1, ...ONE }}>{sub}</div>}
        </div>
        <Star on={isWatch} onClick={() => onToggle(s.t)} />
      </div>
      {chips && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 7 }}>{chips}</div>}
      {cells && <div style={{ marginTop: 8 }}><Cells s={s} /></div>}
    </div>
  );
}

/** 🔄 지금 갱신 — 깃허브 토큰은 Vercel 서버(/api/refresh)에만 둡니다 */
function RefreshBtn() {
  const [key, setKey] = useState(() => localStorage.getItem("v52.rkey") || "");
  const [ask, setAsk] = useState(false);
  const [st, setSt] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/refresh?t=" + Date.now());
      const txt = await r.text();
      let j = null;
      try { j = JSON.parse(txt); } catch {
        setMsg({ t: r.status === 404 ? "/api/refresh 없음" : `갱신 서버 응답 오류 (${r.status})`, bad: true });
        return null;
      }
      if (j.ok) { setSt(j); setMsg(m => (m && m.bad) ? null : m); return j; }
      setMsg({ t: j.msg || "상태를 읽지 못했습니다", bad: true });
    } catch { setMsg({ t: "네트워크 오류", bad: true }); }
    return null;
  }, []);

  useEffect(() => { poll(); }, [poll]);
  useEffect(() => {
    clearInterval(timer.current);
    if (st?.running) {
      timer.current = setInterval(async () => {
        const j = await poll();
        if (j && !j.running) { clearInterval(timer.current); setMsg({ t: "완료 — 새로 불러옵니다" }); setTimeout(() => location.reload(), 1500); }
      }, 20000);
    }
    return () => clearInterval(timer.current);
  }, [st?.running, poll]);

  const run = async (k) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/refresh", { method: "POST", headers: { "x-key": k } });
      const txt = await r.text();
      let j; try { j = JSON.parse(txt); } catch {
        setMsg({ t: `갱신 서버 응답 오류 (${r.status})`, bad: true }); setBusy(false); return;
      }
      if (!j.ok) { setMsg({ t: j.msg || "실행하지 못했습니다", bad: true }); if (j.code === "BAD_KEY") setAsk(true); }
      else { setMsg({ t: j.already ? "이미 갱신 중" : "시작 · 약 25분" }); localStorage.setItem("v52.rkey", k); setKey(k); setAsk(false); poll(); }
    } catch { setMsg({ t: "네트워크 오류", bad: true }); }
    setBusy(false);
  };

  const running = !!st?.running;
  const mins = st?.live?.started ? Math.max(0, Math.floor((Date.now() - new Date(st.live.started).getTime()) / 60000)) : null;
  const cool = st?.cooldownMin || 0;

  return (
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          onClick={() => { if (running) return; (st && st.needKey === false) ? run("") : (key ? run(key) : setAsk(v => !v)); }}
          disabled={busy || running}
          style={{ ...btn(running ? C.gold : C.cyan), flex: 1, opacity: busy ? .6 : 1 }}>
          {running ? `⏳ 갱신 중 ${mins != null ? `${mins}분` : ""}` : busy ? "…" : cool ? `🔄 ${cool}분 뒤 가능` : "🔄 지금 갱신"}
        </button>
        {ask && <input type="password" placeholder="암호" autoFocus defaultValue={key}
          onKeyDown={e => { if (e.key === "Enter") run(e.currentTarget.value.trim()); }} style={inp(110)} />}
      </div>
      {msg && <div style={{ fontSize: FS.xs, color: msg.bad ? C.red : C.emerald, marginTop: 5 }}>{msg.t}</div>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   메인
   ══════════════════════════════════════════════════════════ */
const TAB_DEF = [
  ["market", "🌐", "시장"], ["alloc", "🧺", "배분"], ["find", "🔍", "발굴"],
  ["over", "🌊", "과매도"], ["chart", "📊", "차트"], ["track", "📁", "추적"],
];

export default function App() {
  const [snap, setSnap] = useState(null);
  const [market, setMarket] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState(() => sessionStorage.getItem("v6.tab") || "market");
  const [sel, setSel] = useState(null);
  const [sizerTick, setSizerTick] = useState(0);
  const bumpSizer = useCallback(() => setSizerTick(t => t + 1), []);
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [, setNow] = useState(0);
  useEffect(() => { const id = setInterval(() => setNow(n => n + 1), 60000); return () => clearInterval(id); }, []);
  useEffect(() => { try { sessionStorage.setItem("v6.tab", tab); } catch {} window.scrollTo(0, 0); }, [tab]);

  /* ── 내 기록 (이 기기 브라우저에만 저장) ── */
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
    const today = new Date().toISOString().slice(0, 10);
    const store = seenRef.current, now = Date.now();
    const cur = Object.values(snap.stocks || {}).filter(x =>
      (x.tvr ?? 0) >= 40 && x.tmpl && (x.rs ?? 0) >= 70);
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

  const openStock = useCallback((t) => { setSel(t); setTab("chart"); setSearchOpen(false); setQ(""); }, []);
  const toggleWatch = useCallback((t) => setWatch(w => w.includes(t) ? w.filter(x => x !== t) : [...w, t]), []);

  const rawStocks = snap?.stocks || {};
  const rawList = useMemo(() => Object.values(rawStocks), [rawStocks]);
  const updMs = snap?.meta?.generatedAt ? new Date(snap.meta.generatedAt).getTime() : null;
  const fr = freshness(updMs);
  const asOfBy = useMemo(() => {
    const g = { kr: [], us: [] };
    for (const s of rawList) if (s.asOf) g[s.m === "kr" ? "kr" : "us"].push(s.asOf);
    const top = (a) => a.length ? a.sort().slice(-Math.max(1, Math.floor(a.length * 0.1)))[0] : null;
    return { kr: top(g.kr), us: top(g.us) };
  }, [rawList]);
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

  const sizer = useMemo(() => {
    const g = (k, d) => { const v = Number(localStorage.getItem(k)); return Number.isFinite(v) && v > 0 ? v : d; };
    const cap = g("v4.cap", 10000000), risk = g("v5.risk", 1), stop = g("v5.stop", 10);
    const won = stop > 0 ? (cap * risk / 100) / (stop / 100) : 0;
    const fx = market?.fx?.usdkrw || null;
    return {
      cap, risk, stop, won, fx,
      shares: (px, m) => {
        if (!px || !won) return null;
        const amt = m === "us" ? (fx ? won / fx : null) : won;
        if (amt == null) return null;
        return Math.floor(amt / px);
      },
    };
  }, [market, sizerTick]);

  const results = useMemo(() => {
    const k = q.trim().toLowerCase(); if (!k) return [];
    return list.filter(s => s.t.toLowerCase().includes(k) || (s.n || "").toLowerCase().includes(k)).slice(0, 10);
  }, [q, list]);

  if (err) return <Shell><Card style={{ borderColor: C.red, margin: "40px 12px" }}>
    <div style={{ color: C.red, fontWeight: 800, fontSize: FS.lg }}>데이터를 불러오지 못했습니다</div>
    <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 6 }}>{err}</div>
    <div style={{ fontSize: FS.sm, color: C.muted, marginTop: 8 }}>Actions → Daily Data Update 를 실행하세요.</div>
  </Card></Shell>;

  if (!snap || !market) return <Shell><div style={{ textAlign: "center", color: C.muted, marginTop: 80, fontSize: FS.md }}>불러오는 중…</div></Shell>;

  const shared = { stocks, list, openStock, watch, toggleWatch, market, setTab, setSel, pos, setPos, seen, sizer, bumpSizer };
  const nTrack = pos.length + watch.length;
  const warn = fr.tone === "stale" || fr.tone === "old" || fr.tone === "bad";

  return (
    <Shell>
      {/* ═══ 상단 바 — 한 줄 ═══ */}
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(10,14,26,.94)", backdropFilter: "blur(8px)",
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
              <span style={{ fontSize: FS.xs, color: fr.color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fr.emoji} {fr.label}</span>
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
              <div style={{ padding: "14px 16px", fontSize: FS.sm, color: C.dim }}>
                “{q.trim()}” 없음 · <code style={{ color: C.cyan }}>scripts/tickers_extra.txt</code> 에 추가하세요
              </div>
            ) : results.map(r => (
              <div key={r.t} onClick={() => openStock(r.t)}
                style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", gap: 8, cursor: "pointer" }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{r.n}</span>
                <span style={{ fontSize: FS.sm, color: C.muted }}>{r.m === "kr" ? "🇰🇷" : "🇺🇸"} {r.t}</span>
              </div>))}
          </div>)}

        {/* 상태 펼침 */}
        {statusOpen && !searchOpen && (
          <div style={{ padding: "4px 12px 12px", display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: FS.sm }}>
              <KV k="신호 기준일 🇰🇷" v={asOfBy.kr || "—"} />
              <KV k="신호 기준일 🇺🇸" v={asOfBy.us || "—"} />
              <KV k="데이터 생성" v={snap.meta.generatedKST} />
              <KV k="다음 수집" v={fr.weekend ? "월 16:00" : fr.next ? `${String(fr.next.hh).padStart(2, "0")}:${String(fr.next.mm).padStart(2, "0")}` : "—"} />
            </div>
            <RefreshBtn />
            <div style={{ fontSize: FS.xs, color: C.muted }}>
              종목 {list.length}{snap.meta.counts.failed > 0 && ` · 수집 실패 ${snap.meta.counts.failed}`}
              {nStale > 0 && ` · 가격 멈춤 제외 ${nStale}`} · {APP_VERSION} · 투자자문 아님
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
        {tab === "market" && <MarketTab {...shared} />}
        {tab === "alloc" && <AllocTab {...shared} />}
        {tab === "find" && <FindTab {...shared} />}
        {tab === "over" && <OversoldTab {...shared} />}
        {tab === "chart" && <ChartTab {...shared} sel={sel} />}
        {tab === "track" && <TrackTab {...shared} />}
      </main>

      {/* ═══ 하단 탭바 — 엄지가 닿는 곳 ═══ */}
      <nav style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 60, background: "rgba(13,18,32,.97)",
                    borderTop: `1px solid ${C.border}`, paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", display: "grid", gridTemplateColumns: `repeat(${TAB_DEF.length}, 1fr)`, height: NAV_H }}>
          {TAB_DEF.map(([k, ic, label]) => {
            const on = tab === k;
            return (
              <button key={k} onClick={() => setTab(k)} aria-current={on ? "page" : undefined}
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
  <div style={{ background: C.bg, color: C.text, minHeight: "100vh", colorScheme: "dark", overflowX: "hidden",
                fontFamily: '-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Segoe UI",sans-serif',
                lineHeight: 1.45, WebkitTextSizeAdjust: "100%" }}>
    <div style={{ maxWidth: 640, margin: "0 auto" }}>{children}</div>
  </div>
);

/* ══════════════ 1. 시장 ══════════════ */
function BreadthBar({ b, c }) {
  if (!b || b.v == null) return null;
  const hist = b.hist || [];
  const W = 160, H = 24;
  let path = "";
  if (hist.length > 4) {
    const ys = hist.map(r => r[1]);
    const lo = Math.min(...ys), hi = Math.max(...ys), sp = Math.max(hi - lo, 1);
    path = hist.map((r, i) =>
      `${i ? "L" : "M"}${(i / (hist.length - 1) * W).toFixed(1)},${(H - (r[1] - lo) / sp * H).toFixed(1)}`).join("");
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: c, fontFamily: MONO }}>{b.v.toFixed(0)}%</span>
        <span style={{ fontSize: FS.xs, color: C.dim }}>
          {b.pct >= 50 ? `3년 상위 ${Math.round(100 - b.pct)}%` : `3년 하위 ${Math.round(b.pct)}%`}
        </span>
      </div>
      <div style={{ fontSize: 10.5, color: C.muted }}>200일선 위 종목 비율</div>
      <div style={{ position: "relative", height: 6, borderRadius: 3, marginTop: 6,
                    background: "linear-gradient(90deg,rgba(255,69,58,.4),rgba(245,158,11,.35),rgba(16,185,129,.4))" }}>
        <div style={{ position: "absolute", left: `${Math.min(Math.max(b.pct, 0), 100)}%`, top: -3,
                      width: 3, height: 12, background: C.text, transform: "translateX(-1.5px)", borderRadius: 2 }} />
        <div style={{ position: "absolute", left: "40%", top: 0, width: 1, height: 6, background: "rgba(255,255,255,.5)" }} />
      </div>
      {path && (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 24, marginTop: 6, display: "block" }}>
          <path d={path} fill="none" stroke={c} strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
        </svg>)}
    </div>);
}

function MarketTab({ market, setTab }) {
  const J = { safe: ["🟢 안전", C.emerald], warn: ["🟡 주의", C.gold], risk: ["🔴 위험", C.red] };
  const idxRows = Object.entries(market.indices || {});
  const risk = market.risk || {};
  const holds = market.allocation?.holds || [];
  const sectors = market.sectors || [];
  return (
    <>
      <Sec>오늘 매매해도 되나</Sec>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
        {["kr", "us"].map(m => {
          const j = market.judge?.[m]; if (!j || !J[j.verdict]) return <div key={m} />;
          const [t, c] = J[j.verdict];
          return (
            <div key={m} style={{ borderRadius: 12, padding: 12, background: `${c}14`, border: `1px solid ${c}55`, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: FS.md, fontWeight: 700 }}>{m === "us" ? "🇺🇸 미국" : "🇰🇷 한국"}</span>
                <span style={{ fontSize: 10.5, color: j.gate ? C.emerald : C.muted }}>{j.gate ? "판단 사용" : "참고"}</span>
              </div>
              <div style={{ fontSize: 19, fontWeight: 800, color: c, marginTop: 4 }}>{t}</div>
              <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 2, lineHeight: 1.4 }}>{j.why}</div>
              <BreadthBar b={market.breadth?.[m]} c={c} />
            </div>);
        })}
      </div>
      <Info label="판단 기준">
        <b style={{ color: C.text }}>폭</b> = 그 시장에서 200일선 위에 있는 종목 비율. 세로 흰 선이 3년 중 오늘 위치, 옅은 선이 기준(40).<br />
        <b style={{ color: C.cyan }}>🇰🇷 판단에 사용</b> — 폭이 3년 하위 40% 아래면 위험, 발굴 후보가 관망으로 바뀝니다.
        2008–26 검증: 연 +16.9%·최대낙폭 −28% (게이트 없음 +13.1%·−52%).
        지수만 오르고 종목 대부분이 약한 ‘좁은 장’은 과거 평균 3개월 +1% 수준이었습니다.<br />
        <b style={{ color: C.gold }}>🇺🇸 참고만</b> — 시험한 15개 타이밍 지표가 2010년 이후 전부 (−). 위험 관리는 손절과 비중으로 합니다.
      </Info>

      <Sec>지수</Sec>
      <Card style={{ padding: "4px 12px" }}>
        {idxRows.map(([k, v], i) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto 60px 60px", gap: 8, alignItems: "center",
                                padding: "9px 0", borderTop: i ? `1px solid ${C.border}` : "none" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{v.label}</div>
              <div style={{ fontSize: FS.xs, color: col(v.ma200p) }}>200일선 {pct(v.ma200p, 1)}</div>
            </div>
            <div style={{ fontSize: 14, fontFamily: MONO, fontWeight: 600 }}>{num(v.c, 0)}</div>
            <MiniPct label="1일" v={v.d1} />
            <MiniPct label="1달" v={v.d21} />
          </div>))}
      </Card>

      <Sec>위험 지표</Sec>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
        {[["^VIX", "VIX", "", v => v.c < 22 ? ["안정", C.emerald] : v.c < 30 ? ["주의", C.gold] : ["위험", C.red]],
          ["curve", "금리차 10Y−3M", "%p", v => v.c > 0 ? ["정상", C.emerald] : ["역전 · 침체 경고", C.red]],
          ["^TNX", "미 10년물", "%", v => [`1달 ${v.d21p >= 0 ? "+" : ""}${num(v.d21p, 2)}%p`, C.muted]],
          ["^IRX", "미 3개월물", "%", v => [`1달 ${v.d21p >= 0 ? "+" : ""}${num(v.d21p, 2)}%p`, C.muted]],
        ].map(([k, label, unit, f]) => { const v = risk[k]; if (!v) return null; const [s, c] = f(v);
          return (<Card key={k} style={{ padding: "10px 12px" }}>
            <div style={{ fontSize: FS.xs, color: C.dim }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, fontFamily: MONO }}>
              {num(v.c, k === "^VIX" ? 1 : 2)}<span style={{ fontSize: FS.xs, color: C.muted }}>{unit}</span></div>
            <div style={{ fontSize: FS.xs, color: c }}>{s}</div>
          </Card>); })}
      </div>

      <Sec right={<button onClick={() => setTab("alloc")} style={linkBtn}>● 보유 · 배분탭 ›</button>}>섹터 순위</Sec>
      <Card style={{ padding: "4px 12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "22px minmax(0,1fr) 56px 56px", gap: 6, fontSize: 10.5, color: C.muted, padding: "6px 0 2px" }}>
          <span>#</span><span>섹터</span><span style={{ textAlign: "right" }}>1일</span><span style={{ textAlign: "right" }}>점수</span>
        </div>
        {sectors.map(s => {
          const hold = holds.includes(s.tk);
          return (
            <div key={s.tk} style={{ display: "grid", gridTemplateColumns: "22px minmax(0,1fr) 56px 56px", gap: 6, alignItems: "center",
                                     padding: "8px 0", borderTop: `1px solid ${C.border}` }}>
              <span style={{ fontSize: FS.sm, color: C.muted }}>{s.rank}</span>
              <span style={{ minWidth: 0, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {hold && <span style={{ color: C.emerald }} aria-label="보유">● </span>}
                <b>{s.label}</b> <span style={{ fontSize: FS.xs, color: C.muted }}>{s.tk}</span>
              </span>
              <span style={{ textAlign: "right", fontFamily: MONO, fontSize: FS.sm, color: col(s.d1) }}>{pct(s.d1, 1)}</span>
              <span style={{ textAlign: "right", fontFamily: MONO, fontSize: FS.sm, fontWeight: 700, color: col(s.score) }}>{pct(s.score, 0)}</span>
            </div>);
        })}
      </Card>
    </>
  );
}

const MiniPct = ({ label, v }) => (
  <div style={{ textAlign: "right" }}>
    <div style={{ fontSize: 10.5, color: C.muted }}>{label}</div>
    <div style={{ fontSize: FS.sm, fontFamily: MONO, color: col(v), fontWeight: 600 }}>{pct(v, 1)}</div>
  </div>
);

/* ══════════════ 2. 배분 ══════════════
   분기 리밸런스 ETF 바구니 — '지금 들고 있어야 할 것 + 다음에 손댈 날짜' */
function AllocTab({ market, pos, setPos, setTab, bumpSizer }) {
  const [cap, setCap] = useState(() => Number(localStorage.getItem("v4.cap") || 10000000));
  useEffect(() => { localStorage.setItem("v4.cap", String(cap)); bumpSizer?.(); }, [cap]);
  const A = market.allocation || {};
  const byTk = useMemo(() => Object.fromEntries((market.sectors || []).map(s => [s.tk, s])), [market.sectors]);
  const lockList = (A.holds || []);
  const holds = lockList.map(t => byTk[t]).filter(Boolean);
  const per = holds.length ? cap / holds.length : 0;
  const fx = market.fx?.usdkrw || null;
  const perUsd = fx ? per / fx : null;
  const shares = (px) => (perUsd && px ? Math.floor(perUsd / px) : null);
  const held = (t) => (pos || []).some(p => p.t === t);
  const due = !!A.rebalDue;
  const krEtf = A.kr?.etf || null;
  const [krCap, setKrCap] = useState(() => Number(localStorage.getItem("v52.krcap") || 0));
  useEffect(() => localStorage.setItem("v52.krcap", String(krCap)), [krCap]);
  const krShares = (krEtf?.c && krCap > 0) ? Math.floor(krCap / krEtf.c) : null;
  const drift = A.drift || [], dropped = A.dropped || [];
  const reg = (t, c) => {
    if (!held(t)) setPos(v => [...v, { id: Date.now(), t, avg: c, role: "etf", date: new Date().toISOString().slice(0, 10) }]);
    setTab("track");
  };

  return (
    <>
      <Card style={{ marginTop: 8, borderColor: due ? `${C.gold}77` : C.border, background: due ? "rgba(245,158,11,.08)" : C.panel }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: FS.lg, fontWeight: 800, color: due ? C.gold : C.text }}>
            {due ? "🔔 리밸런스 시기" : "⏸ 지금은 그대로"}
          </span>
          <span style={{ fontSize: FS.sm, color: C.dim, textAlign: "right" }}>
            다음 <b style={{ color: C.text }}>{A.nextRebal || "—"}</b>
            {A.daysToRebal != null && <span style={{ color: C.gold }}> D-{A.daysToRebal}</span>}
          </span>
        </div>
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 3 }}>{A.quarter || "—"} 고정{A.lockedAt ? ` · ${A.lockedAt}` : ""} · 1·4·7·10월에만 교체</div>
        <Info label="왜 분기마다만?">
          월 1회는 연 교체 5.3회로 비용 0.3%만 되어도 초과수익이 사라졌습니다. 분기는 2.0회, 비용 0.5%에서도 +3.2%p 남았습니다.
          해외주식 양도세 22%까지 생각하면 차이가 더 벌어집니다.
        </Info>
      </Card>

      <Sec>🇺🇸 보유할 ETF</Sec>
      <Card style={{ padding: "10px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: FS.sm, color: C.dim, flexShrink: 0 }}>투입 (원)</span>
          <input type="number" inputMode="numeric" value={cap} onChange={e => setCap(Number(e.target.value) || 0)} style={{ ...inp("100%"), flex: 1 }} />
        </div>
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 5 }}>
          {holds.length}분할 · {money(per, "kr")}씩{perUsd != null && ` (≈ $${num(perUsd, 0)})`}{fx ? ` · 환율 ${num(fx, 1)}` : " · 환율 없음"}
        </div>
      </Card>

      {A.defense ? (
        <Card style={{ marginTop: 8, borderColor: `${C.gold}66`, background: "rgba(245,158,11,.06)" }}>
          <div style={{ fontSize: FS.lg, fontWeight: 800, color: C.gold }}>🛡 방어 — 현금</div>
          <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 4 }}>점수 플러스 섹터 {A.nPositive ?? 0}개 · 3개 미만이면 현금</div>
        </Card>
      ) : holds.map(s => (
        <Card key={s.tk} style={{ marginTop: 8, borderColor: "rgba(48,209,88,.3)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: FS.lg, fontWeight: 800 }}>{s.tk} <span style={{ fontSize: FS.sm, fontWeight: 500, color: C.dim }}>{s.label}</span></div>
              <div style={{ fontSize: FS.xs, color: C.muted }}>{s.rank}위 · ${num(s.c)}{shares(s.c) != null && ` · ${shares(s.c)}주`}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: FS.lg, fontWeight: 800, color: col(s.score), fontFamily: MONO }}>{pct(s.score, 1)}</div>
              <div style={{ fontSize: 10.5, color: C.muted }}>점수</div>
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <Cells s={s} keys={[["3M", "m3"], ["6M", "m6"], ["9M", "m9"], ["12M", "m12"]]} />
          </div>
          <button onClick={() => reg(s.tk, s.c)} style={{ ...btn(held(s.tk) ? C.dim : C.emerald), width: "100%", marginTop: 8 }}>
            {held(s.tk) ? "추적탭에서 보기" : "＋ 보유 등록"}</button>
        </Card>))}

      {(drift.length > 0 || dropped.length > 0) && (
        <Card style={{ marginTop: 8 }}>
          <div style={{ fontSize: FS.sm, fontWeight: 700, color: due ? C.gold : C.dim }}>
            {due ? "이번에 이렇게 바꿉니다" : `${A.quarter} 고정 후 순위 변동 · ${A.nextRebal}에 정리`}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {dropped.map(d => <Chip key={d.tk} tone="r">− {d.label} {d.rank ?? "—"}위</Chip>)}
            {drift.map(d => <Chip key={d.tk} tone="g">＋ {d.label} {d.rank ?? "—"}위</Chip>)}
          </div>
        </Card>)}

      <Sec>🇰🇷 보유할 ETF</Sec>
      {krEtf ? (
        <Card style={{ borderColor: "rgba(6,182,212,.3)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: FS.lg, fontWeight: 800 }}>{krEtf.label} <span style={{ fontSize: FS.sm, fontWeight: 500, color: C.muted }}>{krEtf.code}</span></div>
              <div style={{ fontSize: FS.xs, color: C.muted }}>{price(krEtf.c, "kr")} · 교체 없이 계속 보유</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: FS.lg, fontWeight: 800, color: col(krEtf.ma200p), fontFamily: MONO }}>{pct(krEtf.ma200p, 1)}</div>
              <div style={{ fontSize: 10.5, color: C.muted }}>200일선</div>
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <Cells s={krEtf} keys={[["3M", "m3"], ["6M", "m6"], ["9M", "m9"], ["12M", "m12"]]} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
            <span style={{ fontSize: FS.sm, color: C.dim, flexShrink: 0 }}>투입 (원)</span>
            <input type="number" inputMode="numeric" value={krCap} onChange={e => setKrCap(Number(e.target.value) || 0)} style={{ ...inp("100%"), flex: 1 }} />
          </div>
          {krShares != null && <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 5 }}>
            → <b style={{ color: C.text }}>{krShares}주</b> ({money(krShares * krEtf.c, "kr")})</div>}
          <button onClick={() => reg(krEtf.code, krEtf.c)} style={{ ...btn(held(krEtf.code) ? C.dim : C.cyan), width: "100%", marginTop: 8 }}>
            {held(krEtf.code) ? "추적탭에서 보기" : "＋ 보유 등록"}</button>
          <Info label="왜 섹터를 안 고르나">
            {A.kr?.note} 국내 상장 ETF라 매매차익은 비과세(분배금만 15.4%)입니다.
          </Info>
        </Card>
      ) : (
        <Card><span style={{ fontSize: FS.md, fontWeight: 700, color: C.cyan }}>{A.kr?.name || "KODEX 200"}</span>
          <span style={{ fontSize: FS.sm, color: C.gold }}> · 가격 수집 전</span></Card>
      )}

      <Sec right="점수 = 3·6·9·12개월 평균">전 섹터</Sec>
      <Card style={{ padding: "4px 12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "20px minmax(0,1fr) 50px 44px 44px 44px", gap: 4, fontSize: 10.5, color: C.muted, padding: "6px 0 2px" }}>
          <span>#</span><span>섹터</span>
          {["점수", "3M", "6M", "12M"].map(h => <span key={h} style={{ textAlign: "right" }}>{h}</span>)}
        </div>
        {(market.sectors || []).map(s => (
          <div key={s.tk} style={{ display: "grid", gridTemplateColumns: "20px minmax(0,1fr) 50px 44px 44px 44px", gap: 4, alignItems: "center",
                                   padding: "8px 0", borderTop: `1px solid ${C.border}`, fontSize: FS.sm,
                                   background: lockList.includes(s.tk) ? "rgba(48,209,88,.06)" : undefined }}>
            <span style={{ color: C.muted }}>{s.rank}</span>
            <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <b>{s.label}</b>{lockList.includes(s.tk) && <span style={{ color: C.emerald }}> ●</span>}</span>
            <span style={{ textAlign: "right", fontFamily: MONO, fontWeight: 700, color: col(s.score) }}>{pct(s.score, 0)}</span>
            {["m3", "m6", "m12"].map(k => <span key={k} style={{ textAlign: "right", fontFamily: MONO, color: col(s[k]) }}>{pct(s[k], 0)}</span>)}
          </div>))}
        <Info label="왜 네 기간 평균?">
          과거 성적으로 최적 기간을 고를 수 있는지 시험했는데 학습·검증 순위 상관이 −0.08 이었습니다. 그래서 고르지 않고 넷을 합칩니다.
          지수 대비 +3.99%p(95% 구간 [+0.02, +7.34]), 최대낙폭 −52.2% → −36.8%.
        </Info>
      </Card>
    </>
  );
}

/* ══════════════ 3. 발굴 ══════════════ */
function FindTab({ list, openStock, watch, toggleWatch, market, seen, sizer }) {
  const [onlyGo, setOnlyGo] = useState(true);
  const [mkt, setMkt] = useState("all");
  const [needBrk, setNeedBrk] = useState(false);
  const [sortBy, setSortBy] = useState("rs");

  const pool = useMemo(() => {
    let r = list.filter(s => (s.tvr ?? 0) >= 40);
    if (mkt !== "all") r = r.filter(s => s.m === mkt);
    return r.map(s => ({ s, v: verdictFind(s, gateOf(market, s.m)) }));
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
  const krRisk = gateOf(market, "kr") === "risk";

  return (
    <>
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        <Seg full value={mkt} onChange={setMkt} items={[["all", "전체"], ["kr", "🇰🇷 한국"], ["us", "🇺🇸 미국"]]} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr minmax(0,1.2fr)", gap: 6 }}>
          <Toggle full on={onlyGo} onClick={() => setOnlyGo(v => !v)}>후보만 {nGo}</Toggle>
          <Toggle full on={needBrk} onClick={() => setNeedBrk(v => !v)}>돌파 {nBrk}</Toggle>
          <SortSelect value={sortBy} onChange={setSortBy}
            items={[["rs", "RS순"], ["vol", "변동성순"], ["days", "머문 순"], ["tv", "거래대금순"]]} />
        </div>
      </div>
        <Info label="기준 · 근거" right={`${rows.length}개`}>
          <b>후보</b> = 가격구조(이평 정배열·52주 저점 +30%↑·고점 −25% 이내) + RS 70↑ + RSI 75 이하, 거래대금 하위 40% 제외.<br />
          <b style={{ color: C.emerald }}>🇰🇷 검증됨</b> {EVIDENCE.find.kr.note}<br />
          <b style={{ color: C.gold }}>🇺🇸 근거 약함</b> {EVIDENCE.find.us.note} — 미국은 변동성 상위가 더 강한 신호(+4.10%).<br />
          돌파는 필수 아님 — 후보를 85% 줄이는데 성과 차이가 없었습니다. <b>N일째</b> = 이 기기에서 목록에 본 날 수.
        </Info>
      {krRisk && mkt !== "us" && (
        <div style={{ fontSize: FS.sm, color: C.gold, background: "rgba(245,158,11,.08)", borderRadius: 8, padding: "7px 10px", margin: "4px 0 6px" }}>
          🇰🇷 시장 위험 — 한국 후보는 관망으로 표시됩니다</div>)}

      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 4 }}>
        {rows.length === 0 ? <Empty>조건에 맞는 종목이 없습니다</Empty> : rows.map(({ s, v }) => {
          const d = seen.days(s.t);
          const sh = sizer?.shares(s.c, s.m);
          return (
            <StockRow key={s.t} s={s} verdict={v} isWatch={watch.includes(s.t)} onToggle={toggleWatch} onOpen={openStock}
              sub={sh > 0 ? `${sh}주 가능` : money(s.tv, s.m)}
              chips={<>
                <Chip tone={(s.rs ?? 0) >= 70 ? "g" : "n"}>RS {s.rs != null ? Math.floor(s.rs) : "—"}</Chip>
                {s.atrr != null && <Chip tone={s.m === "us" && s.atrr >= 80 ? "g" : "n"}>변동성 {Math.floor(s.atrr)}</Chip>}
                <Chip tone="n">거래 {money(s.tv, s.m)}</Chip>
                {!s.tmpl && <Chip tone="n">구조 ✕</Chip>}
                {(s.brk || s.stFlip) && <Chip tone="c">{s.brk ? "재돌파" : "ST전환"}</Chip>}
                {(s.rsi ?? 0) > 75 && <Chip tone="w">RSI {s.rsi.toFixed(0)}</Chip>}
                {d != null && d >= 5 && <Chip tone="n">{d}일째</Chip>}
              </>} />
          );
        })}
      </div>
    </>
  );
}

/* ══════════════ 4. 과매도 ══════════════ */
function OversoldTab({ list, openStock, watch, toggleWatch, sizer }) {
  const [deep, setDeep] = useState(true);
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
      <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 10 }}>
        🇺🇸 좋은 종목이 고점 대비 크게 빠진 것 · <b style={{ color: C.gold }}>손절 없이 12~24개월 보유</b>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 6, marginTop: 8 }}>
        <Seg full value={deep ? "deep" : "wide"} onChange={v => setDeep(v === "deep")} items={[["deep", "−40%"], ["wide", "−25%"]]} />
        <Toggle full on={showKr} onClick={() => setShowKr(v => !v)}>🇰🇷 포함 {nKr}</Toggle>
      </div>
      <Info label="기준 · 근거" right={`${rows.length}개`}>
        3년 중 60%↑ 기간 200일선 위였던 종목이 고점 대비 크게 빠진 것을 낙폭 큰 순으로 보여줍니다.<br />
        <b style={{ color: C.emerald }}>🇺🇸 검증됨</b> {EVIDENCE.oversold.us.note} (생존편향 미보정 — 실제는 더 낮음)<br />
        <b style={{ color: C.red }}>🇰🇷 제외</b> {EVIDENCE.oversold.kr.note}<br />
        200일선을 −50% 넘게 밑돌면 구조 훼손일 때가 많아 ⚠ 를 붙입니다.
      </Info>
      {showKr && <div style={{ fontSize: FS.sm, color: C.red, background: "rgba(255,69,58,.08)", borderRadius: 8, padding: "7px 10px", margin: "4px 0 6px" }}>
        🇰🇷 한국은 이 전략이 검증에서 손해였습니다 — 참고만 하세요</div>}
      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 4 }}>
        {rows.length === 0 ? <Empty>조건에 맞는 종목이 없습니다</Empty> : rows.map(({ s, v }) => {
          const sh = sizer?.shares(s.c, s.m);
          return (
            <StockRow key={s.t} s={s} verdict={v} isWatch={watch.includes(s.t)} onToggle={toggleWatch} onOpen={openStock}
              sub={sh > 0 ? `${sh}주 가능` : null}
              chips={<>
                <Chip tone="r">고점 {pct(s.w52p, 0)}</Chip>
                <Chip tone={(s.hlt ?? 0) >= 0.7 ? "g" : "c"}>건강 {((s.hlt ?? 0) * 100).toFixed(0)}%{s.hltY && s.hltY < 3 ? ` (${s.hltY}년)` : ""}</Chip>
                <Chip tone={(s.rsi ?? 50) < 30 ? "c" : "n"}>RSI {s.rsi?.toFixed(0) ?? "—"}</Chip>
                <Chip tone={(s.ma200p ?? 0) > 0 ? "g" : "n"}>200일 {pct(s.ma200p, 0)}</Chip>
                {s.m === "kr" && <Chip tone="r">⚠ 한국</Chip>}
                {(s.ma200p ?? 0) < -50 && <Chip tone="r">⚠ 구조 훼손</Chip>}
              </>} />);
        })}
      </div>
    </>
  );
}

/** 필터 줄 — 한 줄에 안 들어가면 가로로 밀어서 봅니다 */
const FilterBar = ({ children }) => (
  <div style={{ display: "flex", gap: 6, alignItems: "center", overflowX: "auto", WebkitOverflowScrolling: "touch",
                padding: "10px 2px 6px", scrollbarWidth: "none" }}>{children}</div>
);
const Seg = ({ value, onChange, items, full }) => (
  <div style={{ display: "flex", background: "rgba(255,255,255,.05)", borderRadius: 9, padding: 2, flexShrink: 0, minWidth: 0 }}>
    {items.map(([k, l]) => (
      <button key={k} onClick={() => onChange(k)} aria-pressed={value === k} style={{
        flex: full ? 1 : "none", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
        border: "none", cursor: "pointer", borderRadius: 7, padding: "0 10px", minHeight: 34, fontSize: FS.sm, fontWeight: 700,
        background: value === k ? "rgba(245,158,11,.18)" : "transparent", color: value === k ? C.gold : C.muted, whiteSpace: "nowrap",
      }}>{l}</button>))}
  </div>
);
const SortSelect = ({ value, onChange, items }) => (
  <select value={value} onChange={e => onChange(e.target.value)}
    style={{ background: "#161B2E", color: C.text, border: `1px solid ${C.border}`, borderRadius: 9, colorScheme: "dark",
             padding: "0 8px", minHeight: 38, fontSize: FS.sm, fontWeight: 700, minWidth: 0, width: "100%" }}>
    {items.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
  </select>
);

/* ══════════════ 5. 차트 ══════════════ */
function ChartTab({ stocks, sel, watch, toggleWatch, market, pos, setPos, setTab, sizer }) {
  const s = sel ? stocks[sel] : null;
  const [bars, setBars] = useState(null);
  const [busy, setBusy] = useState(false);
  const [berr, setBerr] = useState(null);
  const cache = useRef({});
  const [span, setSpan] = useState(126);                       // 기본 6개월
  const [opt, setOpt] = useState(() => {
    const D = { ichi: true, st: true, ma: true, idx: true };
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
    if (!rows?.length) return null;
    const m = new Map();
    for (const [t, c] of rows) if (c != null) m.set(t, c);
    return m;
  }, [market, s?.m]);
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
    const vals = [];
    for (const r of rows) {
      for (const k of ["c", "ma20", "cloudLo", ...ST_DOM]) if (r[k] != null) vals.push(r[k]);
      if (r.cloudLo != null && r.cloudBand != null) vals.push(r.cloudLo + r.cloudBand);
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
  // 축 폭 — 7자리 원화 눈금이 잘리지 않게. ★ 훅이라 아래 조기 return 보다 먼저 있어야 합니다.
  const axisW = useMemo(() => {
    const t = view?.ticks?.length ? view.ticks : [100];
    const px = (str) => [...String(str)].reduce((a, ch) => a + (/[가-힣]/.test(ch) ? 8.6 : 4.9), 0);
    return Math.max(34, Math.min(62, Math.ceil(Math.max(...t.map(x => px(shortNum(x)))) + 12)));
  }, [view]);

  if (!sel) return <Empty>검색(🔍)이나 다른 탭에서 종목을 누르면 여기에 열립니다</Empty>;
  if (!s) return <Empty>{sel} 는 스냅샷에 없습니다</Empty>;

  const v = verdictFind(s, gateOf(market, s.m));
  const hi52 = s.w52p != null ? s.c / (1 + s.w52p / 100) : null;
  const held = (pos || []).some(p => p.t === s.t);
  const trend = (s.tmpl && (s.rs ?? 0) >= 70) ? ["강", C.emerald]
    : (s.tmpl || (s.st ?? 0) >= 2) ? ["중", C.gold] : ["약", C.muted];
  const power = (s.rsi ?? 0) > 75 ? ["과열", C.red] : (s.macdH ?? 0) > 0 ? ["양호", C.emerald] : ["둔화", C.muted];
  const rel = (s.rs ?? 0) >= 70 ? ["우위", C.emerald] : (s.rs ?? 0) >= 40 ? ["보통", C.dim] : ["열위", C.red];
  const pf = (val) => price(val, s.m);
  const macdTxt = (s.macdH != null && s.c)
    ? `${s.macdH >= 0 ? "+" : ""}${(s.macdH / s.c * 100).toFixed(2)}%` : "—";
  const axis = { fontSize: 10, fill: C.muted };
  const tip = {
    contentStyle: { background: "#0f172a", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 },
    labelStyle: { color: C.dim }, itemStyle: { padding: 0 },
  };
  const cloudTone = data?.length ? (data[data.length - 1].cloudUp ? C.emerald : C.red) : C.emerald;
  const stNow = data?.length ? data[data.length - 1].stUpCount : null;
  const sh = sizer?.shares(s.c, s.m);

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
            <div style={{ fontSize: FS.sm, fontFamily: MONO, color: col(s.d1) }}>{pct(s.d1)}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <span style={{ fontSize: FS.lg, fontWeight: 800, color: v?.c }}>{v?.t}</span>
          <span style={{ fontSize: FS.sm, color: C.dim }}>{v?.why}</span>
        </div>
        {!held && sh != null && (
          <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 4 }}>
            {sh > 0 ? <>매수 <b style={{ color: C.text }}>{sh}주</b> · {money(sizer.won, "kr")}
              <span style={{ color: C.muted }}> · −{sizer.stop}% 손절 시 −{money(sizer.cap * sizer.risk / 100, "kr")}</span></>
              : <span style={{ color: C.gold }}>1주 가격이 종목당 금액({money(sizer.won, "kr")})보다 큽니다</span>}
          </div>)}
        <button onClick={() => {
          if (held) { setTab("track"); return; }
          setPos(vs => [...vs, { id: Date.now(), t: s.t, avg: s.c,
            role: verdictOversold(s).k === "watch" ? "long" : "swing",
            date: new Date().toISOString().slice(0, 10) }]);
          setTab("track");
        }} style={{ ...btn(held ? C.dim : C.emerald), width: "100%", marginTop: 10 }}>
          {held ? "추적탭에서 보기" : `＋ ${price(s.c, s.m)} 에 보유 등록`}</button>
      </Card>

      {/* 근거 3줄 */}
      <Card style={{ marginTop: 8, padding: "4px 12px" }}>
        {[["추세", trend, `구조 ${s.tmpl ? "✓" : "✕"} · ST ${s.st ?? "—"}/3 · 200일 ${pct(s.ma200p, 1)}`],
          ["동력", power, `RSI ${s.rsi?.toFixed(0) ?? "—"} · MACD ${macdTxt} · 거래량 ${s.vr5?.toFixed(2) ?? "—"}x`],
          ["상대", rel, `RS ${s.rs?.toFixed(0) ?? "—"} · 고점 ${pct(s.w52p, 1)}`],
        ].map(([label, [t, c], detail], i) => (
          <div key={label} style={{ display: "grid", gridTemplateColumns: "40px 44px minmax(0,1fr)", gap: 6, alignItems: "center",
                                    padding: "8px 0", borderTop: i ? `1px solid ${C.border}` : "none" }}>
            <span style={{ fontSize: FS.sm, color: C.muted }}>{label}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: c }}>{t}</span>
            <span style={{ fontSize: FS.xs, color: C.dim }}>{detail}</span>
          </div>))}
      </Card>
      <div style={{ marginTop: 8 }}><Cells s={s} /></div>

      {/* 차트 옵션 — 한 줄, 넘치면 밀어서 */}
      <FilterBar>
        <Seg value={span} onChange={setSpan} items={[[63, "3M"], [126, "6M"], [200, "전체"]]} />
        {[["st", "ST"], ["ichi", "구름"], ["ma", "이평"], ["idx", idxLabel]].map(([k, l]) =>
          <Toggle key={k} on={opt[k]} onClick={() => setOpt(o => ({ ...o, [k]: !o[k] }))}>{l}</Toggle>)}
      </FilterBar>

      {busy ? <Card><Empty>차트 불러오는 중…</Empty></Card>
        : berr ? <Card><Empty>차트 파일 없음 ({berr}) · Actions → Daily Data Update 실행</Empty></Card>
        : !data ? <Card><Empty>차트 데이터가 없습니다</Empty></Card>
        : (<>
          <Card style={{ padding: "10px 4px 4px" }}>
            <PanelLabel>
              {opt.st && stNow != null && <span style={{ color: stNow === 3 ? C.emerald : stNow === 0 ? C.red : C.gold, fontWeight: 700 }}>ST {stNow}/3</span>}
              {opt.ma && <LegendDot c={C.orange}>20일</LegendDot>}
              {opt.ma && <LegendDot c={C.violet}>200일</LegendDot>}
              {opt.idx && view?.idxPts > 1 && <LegendDot c={C.cyan}>{idxLabel}</LegendDot>}
              {opt.idx && view?.idxRel != null && (
                <span style={{ fontWeight: 700, color: view.idxRel >= 0 ? C.emerald : C.red }}>
                  지수 대비 {view.idxRel >= 0 ? "+" : ""}{view.idxRel.toFixed(1)}%</span>)}
            </PanelLabel>
            <div style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} syncId="v4chart" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,.045)" vertical={false} />
                  <XAxis dataKey="d" tick={axis} tickLine={false} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis yAxisId="p" domain={view.dom} ticks={view.ticks} allowDataOverflow tick={axis}
                    width={axisW} tickFormatter={shortNum} />
                  <YAxis yAxisId="v" orientation="right" domain={[0, (m) => m * 4]} hide />
                  <Tooltip {...tip} filterNull
                    formatter={(val, name) => name === "거래량" ? [num(val, 0), name] : [pf(val), name]}
                    itemSorter={(it) => (it.name === "종가" ? -1 : 0)} />
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

          <Card style={{ marginTop: 6, padding: "8px 4px 2px" }}>
            <PanelLabel>MACD <LegendDot c={C.cyan}>선</LegendDot><LegendDot c={C.gold}>시그널</LegendDot></PanelLabel>
            <div style={{ height: 88 }}>
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
          </Card>

          <Card style={{ marginTop: 6, padding: "8px 4px 2px" }}>
            <PanelLabel>RSI <span style={{ color: C.muted, fontWeight: 400 }}>70 과열 · 30 과매도</span></PanelLabel>
            <div style={{ height: 88 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} syncId="v4chart" margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
                  <XAxis dataKey="d" tick={axis} tickLine={false} interval="preserveStartEnd" minTickGap={40} />
                  <YAxis domain={[0, 100]} ticks={[30, 70]} tick={axis} width={axisW} />
                  <Tooltip {...tip} formatter={val => [num(val, 1), "RSI"]} />
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
  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: FS.xs, fontWeight: 700, color: C.dim, padding: "0 8px 6px" }}>{children}</div>
);
const LegendDot = ({ c, children }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: FS.xs, color: C.muted, fontWeight: 400 }}>
    <span style={{ width: 10, height: 3, background: c, borderRadius: 2, display: "inline-block" }} />{children}</span>
);

/* ══════════════ 6. 추적 ══════════════ */
function TrackTab({ stocks, watch, toggleWatch, openStock, pos, setPos, market, bumpSizer }) {
  const [role, setRole] = useState("all");
  const [stopPct, setStopPct] = useState(() => Number(localStorage.getItem("v5.stop") || 10));
  const [cap, setCap] = useState(() => Number(localStorage.getItem("v4.cap") || 10000000));
  const [riskPct, setRiskPct] = useState(() => Number(localStorage.getItem("v5.risk") || 1));
  const [showSizer, setShowSizer] = useState(false);
  useEffect(() => { localStorage.setItem("v5.stop", String(stopPct)); bumpSizer?.(); }, [stopPct]);
  useEffect(() => { localStorage.setItem("v5.risk", String(riskPct)); bumpSizer?.(); }, [riskPct]);
  useEffect(() => { localStorage.setItem("v4.cap", String(cap)); bumpSizer?.(); }, [cap]);
  const riskWon = cap * riskPct / 100;
  const perPos = stopPct > 0 ? riskWon / (stopPct / 100) : 0;
  const etf = useMemo(() => {
    const us = (market?.sectors || []).map(x =>
      ({ t: x.tk, n: `${x.label} ETF`, m: "us", c: x.c, d1: x.d1, d3: x.d3, d5: x.d5, d21: x.d21,
         ma200p: x.ma200p, isEtf: true }));
    const k = market?.allocation?.kr?.etf;
    const kr = k ? [{ t: k.code, n: k.label, m: "kr", c: k.c, d1: k.d1, d5: k.d5, d21: k.d21,
                      ma200p: k.ma200p, isEtf: true }] : [];
    return Object.fromEntries([...us, ...kr].map(o => [o.t, o]));
  }, [market]);
  const look = useCallback((t) => stocks[t] || etf[t] || null, [stocks, etf]);
  const [form, setForm] = useState(null);
  const rows = pos.filter(p => role === "all" || p.role === role);
  const RB = { etf: ["ETF", "w"], swing: ["단기", "g"], long: ["장기", "c"] };
  const submit = () => {
    const key = (form.t || "").trim().toUpperCase();
    const found = look(key);
    if (!found) { setForm({ ...form, err: "목록에 없는 티커입니다" }); return; }
    const avg = Number(form.avg);
    if (!avg || avg <= 0) { setForm({ ...form, err: "평균단가를 숫자로 입력하세요" }); return; }
    setPos(v => [...v, { id: Date.now(), t: key, avg,
                         role: form.role || (found.isEtf ? "etf" : "swing"),
                         date: new Date().toISOString().slice(0, 10) }]);
    setForm(null);
  };
  return (
    <>
      {/* 포지션 크기 — 결과를 먼저, 설정은 눌러서 */}
      <Card style={{ marginTop: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 6 }}>
          <div>
            <div style={{ fontSize: FS.xs, color: C.muted }}>종목당 금액</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.emerald, fontFamily: MONO }}>{money(perPos, "kr")}</div>
          </div>
          <div>
            <div style={{ fontSize: FS.xs, color: C.muted }}>손절 시 손실</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: C.red, fontFamily: MONO }}>{money(riskWon, "kr")}</div>
          </div>
          <div>
            <div style={{ fontSize: FS.xs, color: C.muted }}>동시 보유</div>
            <div style={{ fontSize: 17, fontWeight: 800, fontFamily: MONO }}>{perPos > 0 ? Math.floor(cap / perPos) : 0}종목</div>
          </div>
        </div>
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 4 }}>
          자본 {money(cap, "kr")} · 1회 위험 {riskPct}% · 손절 −{stopPct}%
          {market?.fx?.usdkrw && ` · 미국 ≈ $${num(perPos / market.fx.usdkrw, 0)}`}
        </div>
        <button onClick={() => setShowSizer(v => !v)} style={{ ...btn(C.dim), width: "100%", marginTop: 8 }}>
          {showSizer ? "설정 닫기" : "⚙ 자본 · 위험 · 손절 설정"}</button>
        {showSizer && (
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: FS.sm, color: C.dim, width: 56, flexShrink: 0 }}>총 자본</span>
              <input type="number" inputMode="numeric" value={cap} onChange={e => setCap(Number(e.target.value) || 0)} style={{ ...inp("100%"), flex: 1 }} />
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: FS.sm, color: C.dim, width: 56, flexShrink: 0 }}>1회 위험</span>
              <Seg value={riskPct} onChange={setRiskPct} items={[[0.5, "0.5%"], [1, "1%"], [2, "2%"]]} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: FS.sm, color: C.dim, width: 56, flexShrink: 0 }}>손절</span>
              <Seg value={stopPct} onChange={setStopPct} items={[[5, "5%"], [8, "8%"], [10, "10%"], [12, "12%"]]} />
            </div>
            <Info label="계산 방식">
              종목당 금액 = 자본 × 1회 위험 ÷ 손절 폭. 손절을 넓히면 금액이 줄어 한 번에 잃는 돈은 같습니다.
              검증: 손절이 타이트할수록 성과가 나빠졌습니다(미국 손절없음 +2.19% → −5% +0.89%). 다만 손절 없이 버티는 건 실전에서 불가능합니다.
            </Info>
          </div>)}
      </Card>

      <Sec right={<button onClick={() => setForm(form ? null : { t: "", avg: "", role: "swing" })} style={linkBtn}>{form ? "닫기" : "＋ 직접 추가"}</button>}>
        보유 {pos.length}
      </Sec>
      <div style={{ marginBottom: 8 }}>
        <Seg value={role} onChange={setRole} items={[["all", "전체"], ["etf", "ETF"], ["swing", "단기"], ["long", "장기"]]} />
      </div>
      {form && (
        <Card style={{ marginBottom: 8, display: "grid", gap: 8 }}>
          <input value={form.t} onChange={e => setForm({ ...form, t: e.target.value, err: null })}
            placeholder="티커 (AAPL / 005930)" style={inp("100%")} />
          <input value={form.avg} onChange={e => setForm({ ...form, avg: e.target.value, err: null })}
            placeholder="평균단가" inputMode="decimal" style={inp("100%")} />
          <Seg value={form.role} onChange={r => setForm({ ...form, role: r })} items={[["etf", "ETF"], ["swing", "단기"], ["long", "장기"]]} />
          <button onClick={submit} style={{ ...btn(C.emerald), width: "100%" }}>등록</button>
          {form.err && <span style={{ fontSize: FS.sm, color: C.red }}>{form.err}</span>}
        </Card>)}
      {rows.length === 0 ? <Card><Empty>기록된 포지션이 없습니다 · 차트탭에서 ‘보유 등록’</Empty></Card> :
        rows.map(p => {
          const s = look(p.t); if (!s) return null;
          const pl = (s.c / p.avg - 1) * 100;
          const stop = p.role === "swing" ? p.avg * (1 - stopPct / 100) : null;
          const [rl, rt] = RB[p.role] || RB.swing;
          const gauge = stop ? Math.max(0, Math.min(100, (s.c - stop) / (p.avg - stop) * 100)) : null;
          return (
            <Card key={p.id} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div onClick={() => openStock(p.t)} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <Chip tone={rt}>{rl}</Chip> {s.n}</div>
                  <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 2 }}>{p.t} · {p.date} · 평단 {price(p.avg, s.m)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: col(pl), fontFamily: MONO }}>{pct(pl)}</div>
                  <div style={{ fontSize: FS.xs, color: C.muted }}>{price(s.c, s.m)}</div>
                </div>
                <button onClick={() => { if (confirm(`${s.n} 기록을 지울까요?`)) setPos(v => v.filter(x => x.id !== p.id)); }}
                  aria-label="삭제" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18, width: 32, height: 34 }}>×</button>
              </div>
              {stop ? (<>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: FS.sm, color: C.dim, marginTop: 8 }}>
                  <span>손절 <b style={{ color: C.red, fontFamily: MONO }}>{price(stop, s.m)}</b></span>
                  {s.c > stop ? <span>여유 <b style={{ color: C.emerald }}>{pct((s.c - stop) / s.c * 100, 1)}</b></span>
                              : <b style={{ color: C.red }}>손절선 하회 — 매도 검토</b>}
                </div>
                <div style={{ height: 6, borderRadius: 4, background: "rgba(255,255,255,.07)", marginTop: 5, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${gauge}%`, background: `linear-gradient(90deg,${C.red},${C.emerald})` }} />
                </div>
                <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 4 }}>최소 3~6개월 보유</div>
              </>) : (
                <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 6 }}>
                  {p.role === "long" ? "손절 없이 12~24개월" : "분기 리밸런스 때 보유 목록에서 빠지면 매도"}</div>)}
            </Card>);
        })}

      <Sec>관심 {watch.length}</Sec>
      <Card style={{ padding: "0 10px" }}>
        {watch.length === 0 ? <Empty>종목 옆 ☆ 를 누르면 여기에 모입니다</Empty> :
          watch.map(t => { const s = look(t); if (!s) return null;
            return <StockRow key={t} s={s} isWatch onToggle={toggleWatch} onOpen={openStock}
              chips={<>
                <Chip tone={s.tmpl ? "g" : "n"}>구조 {s.tmpl ? "✓" : "✕"}</Chip>
                <Chip tone={(s.rs ?? 0) >= 70 ? "g" : "n"}>RS {s.rs != null ? Math.floor(s.rs) : "—"}</Chip>
                <Chip tone={(s.w52p ?? 0) <= -40 ? "c" : "n"}>고점 {pct(s.w52p, 0)}</Chip>
              </>} />; })}
      </Card>
      <div style={{ fontSize: FS.xs, color: C.muted, margin: "10px 2px 0" }}>보유·관심 기록은 이 기기 브라우저에만 저장됩니다</div>
    </>
  );
}

/* ══════════════ 잡 UI ══════════════ */
const linkBtn = { background: "none", border: "none", color: C.cyan, cursor: "pointer", fontSize: FS.sm, padding: "0 2px", minHeight: 36, fontWeight: 600 };
const inp = (w) => ({ background: "rgba(255,255,255,.05)", border: `1px solid ${C.border}`, borderRadius: 8,
                      padding: "0 11px", minHeight: 38, color: C.text, fontSize: 16, width: w, outline: "none", boxSizing: "border-box" });
const btn = (c) => ({ background: `${c}1f`, border: `1px solid ${c}55`, color: c, borderRadius: 9, minHeight: 38,
                      padding: "0 12px", fontSize: FS.sm, fontWeight: 700, cursor: "pointer" });
const Toggle = ({ on, onClick, children, full }) => (
  <button onClick={onClick} aria-pressed={on} style={{
    width: full ? "100%" : undefined, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
    fontSize: FS.sm, fontWeight: 700, padding: "0 10px", minHeight: 38, borderRadius: 9, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
    background: on ? "rgba(245,158,11,.16)" : "rgba(255,255,255,.05)",
    color: on ? C.gold : C.muted, border: `1px solid ${on ? C.gold + "55" : "transparent"}`,
  }}>{children}</button>);
/** 긴 설명은 기본으로 접어 둡니다 */
const Info = ({ label = "근거", children, right }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: right ? 2 : 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => setOpen(v => !v)} aria-expanded={open}
          style={{ background: "none", border: "none", padding: "0 2px", minHeight: 36, cursor: "pointer", fontSize: FS.sm, color: C.muted }}>
          {open ? "▾" : "▸"} {label}
        </button>
        {right && <span style={{ fontSize: FS.xs, color: C.muted, marginLeft: "auto" }}>{right}</span>}
      </div>
      {open && <div style={{ fontSize: FS.sm, color: C.dim, lineHeight: 1.65, padding: "2px 2px 4px" }}>{children}</div>}
    </div>);
};
