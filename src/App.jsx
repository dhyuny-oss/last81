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

export const APP_VERSION = "v9.0.0";

/* ══════════════ 디자인 토큰 ══════════════ */
const C = {
  bg: "#0A0E1A", panel: "#0F1420", panel2: "#161B2E", border: "rgba(255,255,255,.09)",
  text: "#E5E7EB", dim: "#9CA3AF", muted: "#6B7280",
  gold: "#F59E0B", emerald: "#30D158", cyan: "#06B6D4", violet: "#A78BFA",
  red: "#FF453A", orange: "#FF9F0A",
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
// daily.yml 의 cron 과 같아야 합니다 — 어긋나면 '수집 대기' 경보가 헛돕니다.
// 정각 예약은 깃허브 대기열이 길어(실측 평균 5.7시간) 어긋난 분으로 옮겼습니다.
const SLOTS_KST = [[16, 17], [6, 23]];
const SAT_SLOT = [9, 13];   // 토 09:13 KST 주간 백업

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
  const slots = dow === 6 ? [SLOTS_KST[1], SAT_SLOT] : SLOTS_KST;
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
    if (dow >= 1 && dow <= 5) cand.push(16 * 60 + 17);
    if (dow >= 2 && dow <= 6) cand.push(6 * 60 + 23);
    if (dow === 6) cand.push(9 * 60 + 13);
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

/** 목록 위에 붙어 스크롤해도 남는 바 — 시장 등락(비교 기준) + 정렬 */
const SortBar = ({ text, n, market }) => {
  const rows = [["🇰🇷 KOSPI", market?.indices?.["^KS11"], market?.judge?.kr], ["🇺🇸 S&P500", market?.indices?.["^GSPC"], market?.judge?.us]];
  const J = { safe: ["안전", C.emerald], warn: ["주의", C.gold], risk: ["위험", C.red] };
  return (
    <div style={{ position: "sticky", top: "var(--hdr, 50px)", zIndex: 20, background: "rgba(10,14,26,.96)", backdropFilter: "blur(6px)",
                  borderBottom: `1px solid ${C.border}`, padding: "5px 0 5px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 10, color: C.muted, flex: 1 }}>시장 (비교 기준)</span>
        <span style={{ display: "grid", gridTemplateColumns: COLS3, gap: 4, flexShrink: 0 }}>
          {["3일", "5일", "1달"].map(l => <span key={l} style={{ textAlign: "right", fontSize: 10, color: C.muted }}>{l}</span>)}
        </span>
      </div>
      {rows.map(([label, v, j]) => v && (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "1px 0" }}>
          <span style={{ fontSize: FS.xs, fontWeight: 700, flexShrink: 0 }}>{label}</span>
          {j && J[j.verdict] && <span style={{ fontSize: 10, fontWeight: 700, color: J[j.verdict][1], flexShrink: 0 }}>{J[j.verdict][0]}</span>}
          <span style={{ marginLeft: "auto", display: "grid", gridTemplateColumns: COLS3, gap: 4, flexShrink: 0 }}>
            {["d3", "d5", "d21"].map(k => (
              <span key={k} style={{ textAlign: "right", fontSize: "clamp(10.5px, 3vw, 12px)", fontFamily: MONO, color: col(v[k]), ...ONE }}>{pctFit(v[k])}</span>))}
          </span>
          </div>))}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}>
        <span style={{ fontSize: FS.xs, color: C.gold, fontWeight: 700, ...ONE }}>▼ {text}</span>
        <span style={{ fontSize: FS.xs, color: C.muted, marginLeft: "auto", flexShrink: 0 }}>{n}개 · 시장 = 같은 시장 지수 1달 대비</span>
      </div>
    </div>);
};
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
const Cells = ({ s, keys = [["3일", "d3"], ["5일", "d5"], ["1달", "d21"]] }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(${keys.length}, minmax(0,1fr))`, columnGap: 6 }}>
    {keys.map(([l, k]) => (
      <div key={k} style={{ minWidth: 0, overflow: "hidden" }}>
        <div style={{ fontSize: 10.5, color: C.muted, whiteSpace: "nowrap" }}>{l}</div>
        <div style={{ fontSize: FS.sm, fontFamily: MONO, color: col(s[k]), fontWeight: 600, whiteSpace: "nowrap",
                      letterSpacing: -0.3 }}>{pctFit(s[k])}</div>
      </div>))}
  </div>
);

/** 근거 강도 — 검증 결과를 앱 전체에서 같은 말로 표시합니다 */
const GRADE = { strong: ["●●●", "근거 강함", C.emerald], mid: ["●●○", "근거 보통", C.gold], weak: ["●○○", "참고용", C.muted] };
const Grade = ({ k }) => {
  const g = GRADE[k]; if (!g) return null;
  return <span style={{ fontSize: FS.xs, color: g[2], fontWeight: 700, whiteSpace: "nowrap" }}>{g[0]} {g[1]}</span>;
};

/** 매매 신호 칩 — 파이프라인 sig: buy(새로 삼) / exit(들고 있으면 팜) / keep */
/* ══════════════ 포지션(회차) 도우미 ══════════════
   p = { id, t, role, date, tr: [{d, px, amt}] }   ※ 구버전 {avg} 만 있으면 tr 하나로 봅니다 */
const trOf = (p) => (Array.isArray(p.tr) && p.tr.length ? p.tr : [{ d: p.date, px: p.avg, amt: p.amt || 0 }]);
const avgOf = (p) => { const tr = trOf(p); const a = tr.reduce((x, t) => x + (t.amt || 0), 0); const sh = tr.reduce((x, t) => x + (t.amt || 0) / t.px, 0);
  return sh > 0 ? a / sh : tr[0].px; };
const investedOf = (p) => trOf(p).reduce((x, t) => x + (t.amt || 0), 0);
const nextTrancheOf = (p, s, limit) => {   // 2회차 조건: 1회차 +3% ~ +6% 밴드 안에서 마감 · 느린ST 초록 · 아직 1회차뿐
  const tr = trOf(p); if (tr.length >= 2 || !s?.c) return null;   // (+6% 넘게 오른 날은 추격 금지 — 검증과 같은 밴드)
  const target = tr[0].px * 1.03, cap = tr[0].px * 1.06;
  const gain = (s.c / tr[0].px - 1) * 100;
  const chase = s.c > cap;
  return { target, cap, gain, chase, ok: s.c >= target && !chase && s.stSlow === 1, amt: limit * 0.5, pctToGo: (target / s.c - 1) * 100 };
};

/* ══════════════ 행동 표기 — 앱 전체·텔레그램·감시 스크립트가 같은 말을 씁니다 ══════════════
   판정은 파이프라인이 종목마다 action 하나로 확정합니다. 화면은 읽기만 합니다.
   buy=매수! · sell=매도! · watch=관망 · hold=보유(들고 있고 매도 아님 — 앱만 아는 상태)               */
const ACTION = { buy: ["매수!", C.emerald], sell: ["매도!", C.red], watch: ["관망", C.muted], hold: ["보유", C.cyan] };
const WHY = { pull: "눌림", strong: "강세", trend: "추세", st: "트레일링선 아래" };
const actionOf = (s, held) => (s?.action === "sell" ? "sell" : held ? "hold" : (s?.action || "watch"));
const ActionTag = ({ s, held, big }) => {
  const k = actionOf(s, held); const [t, c] = ACTION[k];
  const why = k === "buy" ? WHY[s.why] : k === "sell" ? WHY.st : null;
  return <span style={{ fontSize: big ? FS.lg : FS.xs, fontWeight: 800, color: c, whiteSpace: "nowrap" }}>
    {t}{why && <span style={{ fontWeight: 500, color: C.dim }}> ({why})</span>}</span>;
};
/* 급락 탭 전용 판정 (매수! 를 쓰지 않습니다 — 12~24개월 방식이라) */
const DIP = { watch: ["관찰", C.cyan], wait: ["대기", C.muted], broken: ["⚠ 훼손", C.red] };
const DipTag = ({ s, big }) => {
  const k = s?.dip; if (!k || !DIP[k]) return <span style={{ fontSize: big ? FS.lg : FS.xs, color: C.muted }}>—</span>;
  const [t, c] = DIP[k];
  return <span style={{ fontSize: big ? FS.lg : FS.xs, fontWeight: 800, color: c, whiteSpace: "nowrap" }}>{t}</span>;
};
const SigChip = ({ s }) => <ActionTag s={s} />;      // (구버전 호출 호환)
/* 표기 설명 — 한 곳에서 관리해 찾기·차트가 다른 말을 하지 않게 */
const EXPLAIN = {
  trend: [
    ["매수! (눌림)", "🇰🇷 50일선>200일선 · 종가>200일선 · RS 70↑ · 느린ST 초록 · RSI(14)가 45 아래→위로 올라온 날. 검증 1위"],
    ["매수! (강세)", "🇺🇸 같은 추세 조건 + RSI 60 이상. 미국 주도주는 눌림을 안 주고 강한 채로 가서, 이게 세 구간 모두 보유를 이김"],
    ["매수! (추세)", "슈퍼트렌드 3개 초록 + 구름 위 + RS 70↑. 눌림·강세보다 늦지만 확인된 뒤"],
    ["매도!", "종가가 트레일링선(느린 슈퍼트렌드 12,3) 아래로 마감. 들고 있으면 판다. 유일한 매도 기준"],
    ["관망", "위 어느 것도 아님"],
    ["RS", "같은 시장 6개월 수익률 순위 백분위. 100이 최고, 70↑ 주도주"],
    ["시장 1달", "이 종목 1달 수익 − 같은 시장 지수 1달 수익 (나스닥 종목은 나스닥 기준)"],
    ["선", "지금 사면 트레일링선까지 거리. 그만큼 잃을 각오가 필요"],
    ["3일·5일·1달", "누적 등락. 위 고정 바의 지수 숫자와 같은 열"],
    ["매수 N주", "종목당 한도의 절반(1회차)으로 살 수 있는 주수"],
    ["RSI 52 ↑", "참고. 조건 아님 (검증에서 '상승중'은 효과 없음)"],
    ["업종 3위", "이 종목 업종의 섹터 ETF 순위 (미국만)"],
    ["매출 +12% · 흑자", "연간 재무 참고 (미국만). 검증 불가라 조건이 아님"],
  ],
  dip: [
    ["관찰", "고점 −25%↓ · 3년 중 60%↑ 200일선 위 · 흑자(미국) · 20일선 회복. 재검증 결과 그나마 나은 조합"],
    ["대기", "낙폭·건강은 맞지만 아직 20일선 아래(떨어지는 중) 또는 적자"],
    ["⚠ 훼손", "200일선을 −50% 넘게 밑돎. 회복이 아니라 구조가 망가진 경우가 많음"],
    ["고점", "52주 고점 대비 낙폭"],
    ["건강", "최근 3년 중 200일선 위에 있던 날의 비율. 주가 기준이지 사업 건강이 아님"],
    ["참고용인 이유", "27번 재검증: 어떤 조합도 12개월 보유 시 주도주 그냥 보유를 6~14%p 못 이김. 소액·장기만"],
  ],
};
const ExplainList = ({ items }) => (
  <Info label="▸ 표기 설명">
    {items.map(([k, v]) => <div key={k} style={{ marginBottom: 4 }}><b style={{ color: C.text }}>{k}</b> — {v}</div>)}
  </Info>
);

/* ══════════════ 종목 행 (모든 탭 공통) ══════════════ */
const ONE = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const COLS3 = "repeat(3, clamp(40px, 12.5vw, 50px))";   // 3일·5일·1달 열 — 행과 고정 바가 같은 폭을 씁니다
/** 회사명 축약 — "Dell Technologies Inc." → "Dell Technologies". 풀네임이 아니어도 알아봅니다 */
const shortName = (n) => (n || "")
  .replace(/,?\s*(Inc\.?|Corp\.?|Corporation|Co\.,? Ltd\.?|Ltd\.?|plc|PLC|N\.V\.|S\.A\.|Holdings?|Group|Company|Limited|Class [A-C])\s*$/i, "")
  .replace(/,?\s*(Inc\.?|Corp\.?|Corporation|Co\.,? Ltd\.?)\s*$/i, "")
  .replace(/\s*\(.*?\)\s*$/, "")
  .trim() || n;
function StockRow({ s, rank, rel, sub, onOpen, isWatch, onToggle, dip = false, held = false }) {
  const rs = s.rs;
  const gap = (s.stLine && s.c) ? (s.c / s.stLine - 1) * 100 : null;      // 트레일링선까지 거리
  return (
    <div onClick={() => onOpen(s.t)} style={{ padding: "9px 0", borderBottom: `1px solid ${C.border}`, cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {rank != null && <span style={{ fontSize: FS.xs, color: C.muted, fontFamily: MONO, width: 16, flexShrink: 0, textAlign: "right" }}>{rank}</span>}
        <div style={{ flex: 1, minWidth: 0, ...ONE }}>
          <b style={{ fontSize: 15, fontFamily: MONO }}>{s.t}</b>
          <span style={{ fontSize: FS.xs, color: C.dim }}> {shortName(s.n)}</span>
        </div>
        <span style={{ fontSize: 14, fontWeight: 700, fontFamily: MONO, flexShrink: 0 }}>{price(s.c, s.m)}</span>
        <span style={{ fontSize: FS.xs, fontFamily: MONO, color: col(s.d1), width: "clamp(40px, 12.5vw, 50px)", textAlign: "right", flexShrink: 0 }}>{pct(s.d1, 1)}</span>
        <Star on={isWatch} onClick={() => onToggle(s.t)} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, paddingLeft: rank != null ? 22 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1, overflow: "hidden" }}>
          {dip ? <DipTag s={s} /> : <ActionTag s={s} held={held} />}
          <span style={{ fontSize: FS.xs, color: (rs ?? 0) >= 70 ? C.cyan : C.muted, flexShrink: 0 }}>RS<b style={{ fontFamily: MONO }}>{rs != null ? Math.floor(rs) : "—"}</b></span>
          {rel != null && <span style={{ fontSize: FS.xs, color: rel >= 0 ? C.emerald : C.red, flexShrink: 0 }}>
            시장<b style={{ fontFamily: MONO }}>{rel >= 0 ? "+" : ""}{rel.toFixed(0)}%p</b></span>}
          {!dip && gap != null && <span style={{ fontSize: FS.xs, color: s.stSlow === 1 ? C.muted : C.red, flexShrink: 0 }}>
            선<b style={{ fontFamily: MONO }}>{gap >= 0 ? "−" : "+"}{Math.abs(gap).toFixed(0)}%</b></span>}
        </div>
        <span style={{ marginLeft: "auto", display: "grid", gridTemplateColumns: COLS3, gap: 4, flexShrink: 0 }}>
          {["d3", "d5", "d21"].map(k => (
            <span key={k} style={{ textAlign: "right", fontSize: "clamp(10.5px, 3vw, 12px)", fontFamily: MONO, color: col(s[k]), ...ONE }}>{pctFit(s[k])}</span>))}
        </span>
      </div>
      {sub && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2, paddingLeft: rank != null ? 22 : 0, ...ONE }}>{sub}</div>}
    </div>
  );
}

/** 셋째 줄 참고 정보 — 거래 · 매수 주수 · RSI · 업종 순위 · 재무 */
function subLine(s, sizer, market, extra = []) {
  const sh = sizer?.shares(s.c, s.m);
  const secRank = s.sec && (market?.sectors || []).find(x => x.tk === s.sec);
  const f = s.fin;
  return [
    `거래 ${money(s.tv, s.m)}`,
    sh > 0 ? `매수 ${sh}주` : null,
    s.rsi != null ? `RSI ${s.rsi.toFixed(0)}${s.rsiUp ? "↑" : "↓"}` : null,
    secRank ? `${secRank.label} ${secRank.rank}위` : null,
    f ? [f.rev != null ? `매출 ${f.rev >= 0 ? "+" : ""}${f.rev.toFixed(0)}%` : null, f.prof === false ? "적자" : f.prof ? "흑자" : null].filter(Boolean).join(" ") : null,
    ...extra,
  ].filter(Boolean).join(" · ");
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
/* 탭 순서 = 하루 루틴: 오늘(시장·할 일) → 찾기 → 차트 → 내 종목 → DC(월 1회) → 점검(주 1회) */
const TAB_DEF = [
  ["market", "☀️", "오늘"], ["find", "🔍", "찾기"], ["chart", "📊", "차트"],
  ["track", "📁", "내 종목"], ["alloc", "🏦", "DC"], ["review", "✅", "점검"],
];

export default function App() {
  const [snap, setSnap] = useState(null);
  const [market, setMarket] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState(() => { const t = sessionStorage.getItem("v6.tab"); return t === "over" ? "find" : (t || "market"); });
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
  useEffect(() => {
    fetch("/data/universe_log.json?t=" + Date.now())
      .then(r => r.ok ? r.json() : null).then(setUni).catch(() => {});
  }, []);
  // 내 원칙 — 하루 한 번, 앱을 처음 열 때 먼저 확인합니다
  const today0 = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const [rulesOpen, setRulesOpen] = useState(() => {
    try { return localStorage.getItem("v7.rules.ack") !== today0; } catch { return true; }
  });
  const closeRules = useCallback(() => {
    try { localStorage.setItem("v7.rules.ack", today0); } catch {}
    setRulesOpen(false);
  }, [today0]);
  const [, setNow] = useState(0);
  useEffect(() => { const id = setInterval(() => setNow(n => n + 1), 60000); return () => clearInterval(id); }, []);
  useEffect(() => { try { sessionStorage.setItem("v6.tab", tab); } catch {} window.scrollTo(0, 0); }, [tab]);

  /* ── 내 기록 (이 기기 브라우저에만 저장) ── */
  const [watch, setWatch] = useState(() => { try { return JSON.parse(localStorage.getItem("v4.watch") || "[]"); } catch { return []; } });
  const [extras, setExtras] = useState(() => { try { return JSON.parse(localStorage.getItem("v7.extras") || "[]"); } catch { return []; } });
  const [trades, setTrades] = useState(() => { try { return JSON.parse(localStorage.getItem("v7.trades") || "[]"); } catch { return []; } });
  useEffect(() => { localStorage.setItem("v7.extras", JSON.stringify(extras)); }, [extras]);
  useEffect(() => { localStorage.setItem("v7.trades", JSON.stringify(trades)); }, [trades]);
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
  const etfs = snap?.etfs || {};
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

  /* 사이저 — 계좌별 자본(원화/달러)과 종목당 한도. 손절 폭은 없습니다: 청산은 트레일링선 하나.
     1회차 = 한도의 절반, 2회차 = +3% 확인 후 나머지 절반 (검증: 총수익·투입효율의 균형점) */
  const sizer = useMemo(() => {
    const g = (k, d) => { const v = Number(localStorage.getItem(k)); return Number.isFinite(v) && v > 0 ? v : d; };
    const capKr = g("v9.cap.kr", 20000000), capUs = g("v9.cap.us", 5000);
    const limKr = g("v9.lim.kr", 20000000), limUs = g("v9.lim.us", 1000);
    const fx = market?.fx?.usdkrw || null;
    const limit = (m) => (m === "us" ? limUs : limKr);
    const cap = (m) => (m === "us" ? capUs : capKr);
    return {
      capKr, capUs, limKr, limUs, fx, limit, cap,
      slots: (m) => Math.max(1, Math.floor(cap(m) / limit(m))),
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

  if (err) return <Shell><Card style={{ borderColor: C.red, margin: "40px 12px" }}>
    <div style={{ color: C.red, fontWeight: 800, fontSize: FS.lg }}>데이터를 불러오지 못했습니다</div>
    <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 6 }}>{err}</div>
    <div style={{ fontSize: FS.sm, color: C.muted, marginTop: 8 }}>Actions → Daily Data Update 를 실행하세요.</div>
  </Card></Shell>;

  if (!snap || !market) return <Shell><div style={{ textAlign: "center", color: C.muted, marginTop: 80, fontSize: FS.md }}>불러오는 중…</div></Shell>;

  const shared = { stocks, list, etfs, items, openStock, watch, toggleWatch, market, setTab, setSel, pos, setPos,
                   seen, sizer, bumpSizer, extras, setExtras, trades, setTrades };
  const nTrack = pos.length + watch.length;
  const warn = fr.tone === "stale" || fr.tone === "old" || fr.tone === "bad";

  return (
    <Shell>
      {rulesOpen && snap && <RulesPopup onClose={closeRules} sizer={sizer} />}
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
              <KV k="신호 기준일 🇰🇷" v={asOfBy.kr || "—"} />
              <KV k="신호 기준일 🇺🇸" v={asOfBy.us || "—"} />
              <KV k="데이터 생성" v={snap.meta.generatedKST} />
              <KV k="다음 수집" v={fr.weekend ? "월 16:17" : fr.next ? `${String(fr.next.hh).padStart(2, "0")}:${String(fr.next.mm).padStart(2, "0")}` : "—"} />
            </div>
            <RefreshBtn />
            <FinRefreshBtn />
            {uni && (
              <div style={{ fontSize: FS.xs, color: C.muted, lineHeight: 1.6 }}>
                📦 종목풀 {uni.date?.slice(5, 10)} 점검 · {uni.prevTotal} → {uni.total}종목
                {(uni.added?.length > 0 || uni.removed?.length > 0) && (
                  <><br />
                    {uni.added?.length > 0 && <span style={{ color: C.emerald }}>＋{uni.added.length} {uni.added.slice(0, 3).map(x => x.n).join(", ")}{uni.added.length > 3 ? " …" : ""}</span>}
                    {uni.added?.length > 0 && uni.removed?.length > 0 && " · "}
                    {uni.removed?.length > 0 && <span style={{ color: C.red }}>−{uni.removed.length} {uni.removed.slice(0, 3).map(x => x.n).join(", ")}{uni.removed.length > 3 ? " …" : ""}</span>}
                  </>)}
                <br />매주 토요일 갱신 — 그 사이에는 같은 종목으로 신호를 봅니다
              </div>)}
            {/* 데이터 검사 결과 — 제외된 종목이 소리 없이 사라지지 않게 */}
            <div style={{ fontSize: FS.xs, color: C.muted, lineHeight: 1.6 }}>
              {(() => {
                const h = snap.meta.health;
                if (!h) return <>종목 {list.length}{snap.meta.counts.failed > 0 && ` · 수집 실패 ${snap.meta.counts.failed}`}</>;
                const dr = Object.entries(h.dropped || {});
                return (<>
                  <span style={{ color: C.emerald }}>🩺 {h.kept}종목 검사 통과</span>
                  {h.mode === "focus" && <span style={{ color: C.gold }}> · 감시 모드 (전체 {h.fullUniverse} 중 신호 가능 종목만 · 토요일 전체 스캔)</span>}
                  {h.byMarket && <> (🇰🇷 {h.byMarket.kr?.kept ?? 0} · 🇺🇸 {h.byMarket.us?.kept ?? 0})</>}
                  {h.exchange && <> · 코스피 {h.exchange.KS} / 코스닥 {h.exchange.KQ}</>}
                  {market?.breadthAsOf && h.mode === "focus" && <> · 폭은 {market.breadthAsOf.slice(5)} 전체 스캔 기준</>}
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
        {tab === "market" && <MarketTab {...shared} onShowRules={() => setRulesOpen(true)} />}
        {tab === "alloc" && <DcTab {...shared} />}
        {tab === "find" && <FindHub {...shared} />}
        {tab === "review" && <ReviewTab {...shared} uni={uni} snap={snap} />}
        {tab === "chart" && <ChartTab {...shared} stocks={items} sel={sel} />}
        {tab === "track" && <TrackTab {...shared} stocks={items} />}
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
  // overflowX:hidden 은 sticky(정렬줄·상단바)를 망가뜨려 쓰지 않습니다 — 가로 넘침은 각 행에서 막습니다
  <div style={{ background: C.bg, color: C.text, minHeight: "100vh", colorScheme: "dark",
                fontFamily: '-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Segoe UI",sans-serif',
                lineHeight: 1.45, WebkitTextSizeAdjust: "100%" }}>
    <div style={{ maxWidth: 640, margin: "0 auto" }}>{children}</div>
  </div>
);


/* ══════════════ 거래 시간표 + 내 원칙 ══════════════
   거래시간 출처: KRX 정규 09:00~15:30(종가단일가 15:20~), KRX 애프터마켓 16:00~20:00(2026-09-14 신설·ETF 제외),
   NXT 프리 08:00~08:50 · 메인 09:00:30~15:20 · 애프터 15:40~20:00 (지정가만).
   미국은 서머타임 여부로 1시간 이동합니다.                                    */
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
function sessions(nowMs) {
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
const inSpan = (mins, a, b) => (a <= b ? mins >= a && mins < b : mins >= a || mins < b);

function HoursCard({ nowMs }) {
  const kst = new Date(nowMs + 9 * 3600000);
  const dow = kst.getUTCDay(), mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const wd = dow >= 1 && dow <= 5;
  const S = sessions(nowMs);
  const Row = ({ list, flag, label }) => (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: FS.sm, fontWeight: 700, marginBottom: 4 }}>{flag} {label}</div>
      {list.map(([n, a, b, note]) => {
        const on = wd && inSpan(mins, a, b);
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
      <Row list={S.kr} flag="🇰🇷" label="한국" />
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

/* 내 원칙 — 하루 한 번 앱을 열 때 먼저 뜹니다 */
/** 원칙 목록 — 4번은 앱에 구현된 매수·매도 규칙과 추적탭 설정값을 그대로 읽어 씁니다 */
const myRules = (sz) => [
  ["국내주식 비중을 키우지 않는다", "검증에서도 한국은 시장 판정이 '위험'일 때가 많고 변동이 큽니다"],
  ["국내주식은 09:30 전에 사지 않는다", "시가 급변을 피합니다 (예약주문 시가 체결 금지)"],
  [`2회차 매수 — 한도의 절반 먼저, 1회차가 +3% 넘게 마감하면 나머지 절반`,
   `종목당 한도 🇰🇷 ${sz ? money(sz.limKr, "kr") : "—"} · 🇺🇸 ${sz ? money(sz.limUs, "us") : "—"} · 추격 금지(+5% 넘게 올랐으면 그 회차는 건너뜀)`],
  ["매수는 앱이 '매수!'라고 쓴 종목만 · 매도는 '매도!'(트레일링선 아래 마감) 하나",
   "🇰🇷 눌림(RSI 45 회복) · 🇺🇸 강세(RSI 60↑) · −3% 손절·고점 −5%·2주 타임컷은 검증에서 성과를 깎아 쓰지 않는다"],
  ["이벤트 매매 금지 · 몰빵 금지", "뉴스·테마로 사지 않는다"],
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
        <div style={{ fontSize: 17, fontWeight: 800, color: C.gold }}>오늘의 원칙</div>
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
          3번 한도는 내 종목 탭 설정을 그대로 씁니다. 검증(2008–26): 절반→+3%→절반이 총수익과 투입 효율의 균형점이었고,
          −3% 초기손절은 거래의 65%를 추가 매수 전에 털어냈습니다.
        </div>
        <button onClick={onClose} disabled={!all}
          style={{ ...btn(all ? C.emerald : C.dim), width: "100%", marginTop: 12, opacity: all ? 1 : .5, minHeight: 44 }}>
          {all ? "확인했습니다 · 시작" : `${ack.length}/5 확인`}</button>
      </div>
    </div>);
}

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

function MarketTab({ market, setTab, onShowRules, list, pos, stocks, sizer }) {
  const J = { safe: ["🟢 안전", C.emerald], warn: ["🟡 주의", C.gold], risk: ["🔴 위험", C.red] };
  const idxRows = Object.entries(market.indices || {});
  const risk = market.risk || {};
  const spy21 = market.indices?.["^GSPC"]?.d21 ?? null;
  const sectors = market.sectors || [];
  const [hoursOpen, setHoursOpen] = useState(false);
  // 오늘 할 일 — 순서가 곧 루틴: ① 내 종목 매도 신호 ② 새 신호 ③ DC 상태
  const sellN = (pos || []).filter(p => p.role !== "long" && stocks[p.t]?.action === "sell").length;
  const t2N = (pos || []).filter(p => p.role === "swing" && nextTrancheOf(p, stocks[p.t], sizer.limit(stocks[p.t]?.m || "kr"))?.ok).length;
  const buyN = list.filter(x => x.action === "buy" && (x.tvr ?? 0) >= 40).length;
  const buyKr = list.filter(x => x.action === "buy" && x.m === "kr" && (x.tvr ?? 0) >= 40).length;
  const dcWait = (market.dc?.core || []).filter(c => c.state === "wait").length;
  const S = sessions(Date.now());
  const kst = new Date(Date.now() + 9 * 3600000), mins = kst.getUTCHours() * 60 + kst.getUTCMinutes(), wd = kst.getUTCDay() >= 1 && kst.getUTCDay() <= 5;
  const nowSeg = wd && ([...S.kr.map(x => ["🇰🇷 " + x[0], x[1], x[2]]), ...S.us.map(x => ["🇺🇸 " + x[0], x[1], x[2]])].find(([, a, b]) => inSpan(mins, a, b)) || null);
  return (
    <>
      {/* 원칙 — 한 줄. 누르면 팝업 */}
      <button onClick={onShowRules} style={{ ...btn(C.gold), width: "100%", marginTop: 8, textAlign: "left", display: "flex", gap: 8 }}>
        <span>📌 오늘의 원칙 5개</span><span style={{ marginLeft: "auto", fontWeight: 400, color: C.dim }}>확인함 ✓ · 다시 보기 ›</span>
      </button>

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
      {/* 오늘 할 일 — 이 순서대로 탭을 넘기면 됩니다 */}
      <Sec>오늘 할 일</Sec>
      <Card style={{ padding: "4px 12px" }}>
        {[
          ["1", `매도! ${sellN}건`, sellN ? "내 종목 — 지금 처리" : "없음", "track", sellN ? C.red : C.muted],
          ["2", `2회차 조건 도달 ${t2N}건`, t2N ? "1회차 +3% 넘음 — 나머지 절반" : "없음", "track", t2N ? C.emerald : C.muted],
          ["3", `매수! ${buyN}건 (🇰🇷 ${buyKr} · 🇺🇸 ${buyN - buyKr})`, buyN ? "찾기에서 고르기" : "오늘은 없음", "find", buyN ? C.emerald : C.muted],
          ["4", `DC ${dcWait === 0 ? "두 몫 모두 보유" : dcWait === 2 ? "두 몫 모두 대기(안전자산)" : "한 몫 대기"}`, "월 1회·바뀌면 알림", "alloc", C.dim],
        ].map(([n, t, sub, to, c]) => (
          <button key={n} onClick={() => setTab(to)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                  background: "none", border: "none", borderTop: n !== "1" ? `1px solid ${C.border}` : "none", padding: "10px 0", cursor: "pointer", color: C.text }}>
            <span style={{ width: 22, height: 22, borderRadius: 11, background: `${c}22`, color: c, fontSize: FS.xs, fontWeight: 800, display: "grid", placeItems: "center", flexShrink: 0 }}>{n}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: FS.md, fontWeight: 700, ...ONE }}>{t}</div>
              <div style={{ fontSize: FS.xs, color: C.muted }}>{sub}</div>
            </span>
            <span style={{ color: C.muted }}>›</span>
          </button>))}
      </Card>

      {/* 거래시간 — 접어 두고 한 줄만 */}
      <button onClick={() => setHoursOpen(v => !v)} style={{ ...btn(C.dim), width: "100%", marginTop: 8, textAlign: "left", display: "flex", gap: 8 }}>
        <span>🕒 {nowSeg ? `지금 ${nowSeg[0]}` : "지금 휴장"}</span>
        <span style={{ marginLeft: "auto", fontWeight: 400, color: C.muted }}>내 시각 07:30 · 21:30 {hoursOpen ? "▴" : "▾"}</span>
      </button>
      {hoursOpen && <HoursCard nowMs={Date.now()} />}

      <Info label="판단 기준">
        <b style={{ color: C.text }}>폭</b> = 그 시장에서 200일선 위에 있는 종목 비율. 세로 흰 선이 3년 중 오늘 위치, 옅은 선이 기준(40).<br />
        <b style={{ color: C.cyan }}>🇰🇷 판단에 사용</b> — 폭이 3년 하위 40% 아래면 위험. 이 판정은 <b>ETF 배분(DC)에만</b> 씁니다.
        2008–26 검증: 연 +16.9%·최대낙폭 −28% (게이트 없음 +13.1%·−52%).
        지수만 오르고 종목 대부분이 약한 ‘좁은 장’은 과거 평균 3개월 +1% 수준이었습니다.<br />
        <b style={{ color: C.gold }}>🇺🇸 참고만</b> — 시험한 15개 타이밍 지표가 2010년 이후 전부 (−). 위험 관리는 손절과 비중으로 합니다.
      </Info>

      <Sec right="누적 등락">지수</Sec>
      <Card style={{ padding: "2px 12px 6px" }}>
        <Head cols={["지수", "종가", "3일", "5일", "1달"]} grid={IDX_GRID} />
        {idxRows.map(([k, v]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: IDX_GRID, gap: 6, alignItems: "center",
                                padding: "9px 0", borderTop: `1px solid ${C.border}` }}>
            <span style={{ minWidth: 0, ...ONE }}>
              <b style={FIT_NAME}>{v.label}</b>
              <span style={{ fontSize: FS.xs, color: col(v.ma200p), display: "block", ...ONE }}>200일 {pct(v.ma200p, 0)}</span>
            </span>
            <span style={{ ...FIT, fontWeight: 700, textAlign: "right" }}>{num(v.c, 0)}</span>
            {["d3", "d5", "d21"].map(x =>
              <span key={x} style={{ ...FIT, textAlign: "right", color: col(v[x]) }}>{pctFit(v[x])}</span>)}
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

      <Sec right={<Grade k="weak" />}>미국 섹터 순위</Sec>
      <Card style={{ padding: "2px 12px 6px" }}>
        <Head cols={["#", "섹터", "3일", "5일", "1달", "점수"]} grid={SEC_GRID} />
        {sectors.map(s => (
          <div key={s.tk} style={{ display: "grid", gridTemplateColumns: SEC_GRID, gap: 5, alignItems: "center",
                                   padding: "9px 0", borderTop: `1px solid ${C.border}` }}>
            <span style={{ fontSize: FS.sm, color: C.muted }}>{s.rank}</span>
            <span style={{ minWidth: 0, ...ONE }}>
              <b style={FIT_NAME}>{s.label}</b> <span style={{ fontSize: 10, color: C.muted }}>{s.tk}</span>
            </span>
            {["d3", "d5", "d21"].map(x =>
              <span key={x} style={{ ...FIT, textAlign: "right", color: col(s[x]) }}>{pctFit(s[x])}</span>)}
            <span style={{ ...FIT, textAlign: "right", fontWeight: 700, color: col(s.score) }}>{pctFit(s.score)}</span>
            {(() => {   // 지수대비 = 섹터 1달 − S&P500 1달
              const r = (s.d21 == null || spy21 == null) ? null : s.d21 - spy21;
              return r == null ? <span /> : (
                <span style={{ gridColumn: "2 / -1", fontSize: 10.5, color: r >= 0 ? C.emerald : C.red, marginTop: 1 }}>
                  지수대비 {r >= 0 ? "+" : ""}{r.toFixed(1)}%p</span>);
            })()}
          </div>))}
        <div style={{ fontSize: FS.xs, color: C.muted, padding: "7px 0 2px" }}>
          점수 = 3·6·9·12개월 평균 · 섹터를 갈아타는 방식은 지수 보유와 차이가 없었습니다
          <button onClick={() => setTab("alloc")} style={{ ...linkBtn, fontSize: FS.sm, minHeight: 36, display: "block" }}>국내 ETF로 보기 ›</button>
        </div>
      </Card>

    </>
  );
}

// 칸 폭은 고정 픽셀 대신 비율로 — 글자를 키운 좁은 화면에서도 이름 칸이 뭉개지지 않게
const IDX_GRID = "minmax(0,1.5fr) minmax(0,1.1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)";
const SEC_GRID = "16px minmax(0,1.7fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.1fr)";
/** 표 머리글 — 칸 이름을 행마다 반복하지 않고 한 번만 적습니다 */
// 좁은 화면에서 숫자가 잘리지 않도록 글자 크기를 화면 폭에 맞춰 줄입니다
const FIT = { fontSize: "clamp(10.5px, 3.1vw, 12px)", fontFamily: MONO, whiteSpace: "nowrap", letterSpacing: -0.4 };
const FIT_NAME = { fontSize: "clamp(11px, 3.6vw, 14px)", fontWeight: 700 };
const Head = ({ cols, grid }) => (
  <div style={{ display: "grid", gridTemplateColumns: grid, gap: 5, fontSize: "clamp(10px, 2.8vw, 10.5px)", color: C.muted, padding: "7px 0 3px" }}>
    {cols.map((c, i) => <span key={c} style={{ textAlign: i >= 2 ? "right" : "left", ...ONE }}>{c}</span>)}
  </div>
);

/* ══════════════ 2. DC (퇴직연금) ══════════════
   규칙 (2026-09 검증 ⑤): 미국 S&P500 35% + 코스피200 35% + 안전자산 30%
   · 각 몫은 느린 슈퍼트렌드(12,3)가 초록일 때만 보유, 빨강이면 그 몫도 안전자산
   · 판단은 미국 원본(SPY) 신호, 매수는 국내 상장 ETF (퇴직연금은 국내 상장만 가능)
   · 진입은 한 번에 또는 월 1회 3분할 (분할은 평균 −0.3%p, 최악 결과는 줄어듦)          */
const DAY = 86400000;
function loadJSON(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? d; } catch { return d; } }

function DcTab({ etfs, market, pos, setPos, openStock }) {
  const dc = market.dc;
  const [total, setTotal] = useState(() => Number(localStorage.getItem("v6.dc.total")) || 100000000);
  const [split, setSplit] = useState(() => Number(localStorage.getItem("v6.dc.split")) || 3);
  const [done, setDone] = useState(() => loadJSON("v6.dc.done", { us: [], kr: [] }));
  const [moreUs, setMoreUs] = useState(false);
  const [moreKr, setMoreKr] = useState(false);
  const [mode, setMode] = useState(() => localStorage.getItem("v9.dc.mode") || "st");      // st=현행(느린ST) · dual=듀얼 모멘텀
  const [semiOn, setSemiOn] = useState(() => localStorage.getItem("v9.dc.semi") === "1");
  useEffect(() => { localStorage.setItem("v9.dc.mode", mode); }, [mode]);
  useEffect(() => { localStorage.setItem("v9.dc.semi", semiOn ? "1" : "0"); }, [semiOn]);
  useEffect(() => { localStorage.setItem("v6.dc.total", String(total)); }, [total]);
  useEffect(() => { localStorage.setItem("v6.dc.split", String(split)); }, [split]);
  useEffect(() => { localStorage.setItem("v6.dc.done", JSON.stringify(done)); }, [done]);

  if (!dc) return <Card style={{ marginTop: 10 }}><Empty>DC 신호는 다음 데이터 갱신 후 표시됩니다 (파이프라인 v6.2 필요)</Empty></Card>;

  const today = new Date().toISOString().slice(0, 10);
  const krJudge = market.judge?.kr;
  let invested = 0;
  const cores = dc.core.map(c => {
    const d = etfs[c.sig] || null;
    const target = total * c.w;
    const per = target / split;
    const list = (done[c.key] || []).slice(0, split);
    const n = list.length;
    const last = n ? new Date(list[n - 1]).getTime() : null;
    const waitDays = last ? Math.max(0, 28 - Math.floor((Date.now() - last) / DAY)) : 0;
    const px = c.buy?.c || null;
    invested += n * per;
    return { ...c, d, target, per, n, waitDays, px, shares: px ? Math.floor(per / px) : null };
  });
  const safeNow = Math.max(0, total - invested);
  const record = (key, code, px) => {
    setDone(o => ({ ...o, [key]: [...(o[key] || []), today].slice(0, split) }));
    if (code && !(pos || []).some(p => p.t === code))
      setPos(v => [...v, { id: Date.now(), t: code, avg: px || 0, role: "etf", date: today }]);
  };
  const reset = (key, code) => {
    if (!confirm("매도를 완료했으면 이 몫의 회차 기록을 비웁니다")) return;
    setDone(o => ({ ...o, [key]: [] }));
    if (code) setPos(v => v.filter(p => p.t !== code));
  };
  const undo = (key) => setDone(o => ({ ...o, [key]: (o[key] || []).slice(0, -1) }));

  const St = ({ d }) => {
    if (!d || d.stSlow == null) return <Chip tone="n">신호 없음</Chip>;
    return d.stSlow === 1
      ? <Chip tone="g">느린ST 초록 {d.slowDays}거래일</Chip>
      : <Chip tone="r">느린ST 빨강 {d.slowDays}거래일</Chip>;
  };

  return (
    <>
      {/* 규칙 택일 — 둘을 섞으면 검증에서 성과가 크게 떨어졌습니다 (19.7 → 9.5%) */}
      <div style={{ marginTop: 8 }}>
        <Seg full value={mode} onChange={setMode} items={[["st", "느린ST 규칙 (낙폭 −10%)"], ["dual", "듀얼 모멘텀 (수익 두 배)"]]} />
      </div>
      <div style={{ fontSize: FS.xs, color: C.muted, margin: "6px 2px 0" }}>
        {mode === "st" ? "S&P500 35% + 코스피200 35%, 느린ST 초록일 때만 보유 · 검증 연 +7.2% · MDD −10% · 샤프 1.04"
                       : "매월 1거래일 나스닥100·S&P500·코스피200 중 3·6·12개월 평균 상위 2개 반반 · 검증 연 +12.5% · MDD −20% · 샤프 0.92"}
      </div>
      {mode === "dual" && dc.dual && (() => {
        const semiShare = semiOn && dc.semi ? dc.semi.share : 0;
        const riskW = 0.70 - semiShare;
        return (<>
          <Sec right={<Grade k="strong" />}>이번 달 보유 (듀얼 모멘텀)</Sec>
          <Card style={{ padding: "4px 12px" }}>
            {dc.dual.cands.map((c, i) => {
              const hold = dc.dual.hold.includes(c.sig);
              return (
                <div key={c.sig} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderTop: i ? `1px solid ${C.border}` : "none" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: FS.md, fontWeight: 800, ...ONE }}>{hold ? "● " : "○ "}{c.label} <span style={{ fontSize: FS.xs, color: C.muted, fontWeight: 400 }}>{c.sig}</span></div>
                    <div style={{ fontSize: FS.xs, color: C.muted, ...ONE }}>{c.buy?.code ? <>매수 <b style={{ fontFamily: MONO, color: C.cyan }}>{c.buy.code}</b> {c.buy.name}</> : "국내 상품 없음"}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: FS.md, fontWeight: 800, fontFamily: MONO, color: col(c.score) }}>{pct(c.score, 1)}</div>
                    <div style={{ fontSize: 10.5, color: hold ? C.emerald : C.muted }}>{hold ? `보유 ${Math.round(riskW / 2 * 100)}% · ${money(total * riskW / 2, "kr")}` : "제외"}</div>
                  </div>
                </div>);
            })}
            <div style={{ fontSize: FS.xs, color: C.muted, padding: "8px 0 4px", lineHeight: 1.6 }}>
              점수 = 3·6·12개월 평균 · 기준일 {dc.dual.asOf} · 다음 교체 {market.allocation?.nextRebal ? "매월 1거래일" : "매월 1거래일"} · 점수 마이너스면 그 몫은 안전자산.
              느린ST 필터와 섞지 않습니다 (검증에서 19.7% → 9.5%).
            </div>
          </Card>
        </>);
      })()}
      {dc.semi && (
        <Card style={{ marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: FS.md, fontWeight: 800 }}>반도체 고정 칸 {semiOn ? "(위험자산 중 10%)" : "(꺼짐)"}</div>
              <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 2, ...ONE }}>
                {dc.semi.buy?.code ? <><b style={{ fontFamily: MONO, color: C.cyan }}>{dc.semi.buy.code}</b> {dc.semi.buy.name}</> : "SMH"} · {dc.semi.state === "hold" ? <b style={{ color: C.emerald }}>보유 (느린ST 초록)</b> : <b style={{ color: C.gold }}>대기 (느린ST 빨강 → 안전자산)</b>}
              </div>
            </div>
            <Toggle on={semiOn} onClick={() => setSemiOn(v => !v)}>{semiOn ? "켜짐" : "끄기"}</Toggle>
          </div>
          <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 6 }}>재량 베팅 대신 칸으로 묶는 장치입니다. 켜면 위험자산 70% 중 10%({money(total * 0.10, "kr")})가 여기로 가고 나머지 60%가 위 규칙으로 갑니다.</div>
        </Card>)}
      {mode === "st" && <>
      <Sec right={<Grade k="strong" />}>오늘 규칙</Sec>
      <div style={{ fontSize: FS.xs, color: C.muted, margin: "-4px 2px 6px" }}>다음 비중 점검 {market.allocation?.nextRebal || "분기 첫 거래일"}</div>
      {cores.map(c => {
        const hold = c.state === "hold";
        return (
          <Card key={c.key} style={{ marginBottom: 8, borderColor: hold ? "rgba(48,209,88,.35)" : "rgba(245,158,11,.35)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: FS.lg, fontWeight: 800 }}>{c.label} <span style={{ fontSize: FS.sm, color: C.muted, fontWeight: 500 }}>{Math.round(c.w * 100)}%</span></div>
                <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 2, ...ONE }}>
                  매수 <b style={{ fontFamily: MONO, color: C.cyan }}>{c.buy?.code}</b> {c.buy?.name}{c.px ? ` · ${price(c.px, "kr")}` : ""}
                </div>
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1, ...ONE }}>
                  판단 {c.d?.asOf || "—"} 종가{c.buy?.asOf ? ` · 국내가 ${c.buy.asOf}` : ""}
                </div>
              </div>
              <span style={{ fontSize: FS.md, fontWeight: 800, color: hold ? C.emerald : C.gold, whiteSpace: "nowrap" }}>
                {hold ? "🟢 보유" : c.state === "wait" ? "🟡 대기" : "⚪ 확인 불가"}</span>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 7 }}>
              <St d={c.d} />
              {c.d && <Chip tone="n">ST {c.d.st ?? "—"}/3</Chip>}
              <Chip tone="n">판단 {c.sig === "SPY" ? "SPY(미국 원본)" : c.buy?.name}</Chip>
              {c.key === "kr" && krJudge && <Chip tone={krJudge.verdict === "risk" ? "r" : krJudge.verdict === "warn" ? "w" : "g"}>
                시장 {krJudge.verdict === "risk" ? "위험" : krJudge.verdict === "warn" ? "주의" : "안전"}</Chip>}
            </div>

            {/* 할 일 */}
            <div style={{ marginTop: 9, padding: "9px 10px", borderRadius: 9, background: "rgba(255,255,255,.04)", fontSize: FS.sm, color: C.dim }}>
              {hold ? (
                c.n >= split ? <>✅ 목표 {money(c.target, "kr")} 보유 완료 · 빨강으로 바뀌면 전량 안전자산</>
                : c.waitDays > 0 ? <>다음 회차({c.n + 1}/{split})는 <b style={{ color: C.text }}>{c.waitDays}일 뒤</b> · {money(c.per, "kr")}</>
                : <>
                    <b style={{ color: C.emerald }}>매수 {c.n + 1}/{split}회차</b> · {money(c.per, "kr")}
                    {c.shares != null && <> ≈ <b style={{ color: C.text }}>{c.shares}주</b></>}
                    <button onClick={() => record(c.key, c.buy?.code, c.px)} style={{ ...btn(C.emerald), width: "100%", marginTop: 8 }}>
                      ✓ {c.n + 1}회차 매수 완료 기록</button>
                  </>
              ) : c.state === "wait" ? (
                c.n > 0 ? <>
                    <b style={{ color: C.red }}>⚠ 보유분 {c.n}회차({money(c.n * c.per, "kr")}) 매도 → 안전자산</b>
                    <button onClick={() => reset(c.key, c.buy?.code)} style={{ ...btn(C.red), width: "100%", marginTop: 8 }}>매도 완료 기록</button>
                  </>
                  : <>사지 않음 · 초록으로 바뀔 때까지 이 몫({money(c.target, "kr")})은 안전자산</>
              ) : <>신호를 확인할 수 없습니다 · 데이터 갱신을 확인하세요</>}
            </div>
            {c.n > 0 && <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 5, display: "flex", gap: 8, alignItems: "center" }}>
              기록 {(done[c.key] || []).slice(0, split).join(" · ")}
              <button onClick={() => undo(c.key)} style={{ ...linkBtn, marginLeft: "auto", fontSize: FS.xs }}>마지막 기록 취소</button>
            </div>}
            {c.d && <button onClick={() => openStock(c.sig)} style={{ ...linkBtn, fontSize: FS.xs }}>판단 차트 보기 ›</button>}
          </Card>);
      })}
      <Card style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: FS.lg, fontWeight: 800 }}>안전자산 <span style={{ fontSize: FS.sm, color: C.muted, fontWeight: 500 }}>30% + 대기 몫</span></div>
            <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 2 }}>적격 TDF · 채권혼합형(주식 40%↓) · 예금 — 증권사에서 ‘안전자산’ 분류 확인</div>
          </div>
          <div style={{ fontSize: FS.lg, fontWeight: 800, fontFamily: MONO }}>{money(safeNow, "kr")}</div>
        </div>
      </Card>

      </>}
      <Sec>계좌 설정</Sec>
      <Card>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: FS.sm, color: C.dim, width: 64, flexShrink: 0 }}>DC 총액</span>
          <input type="number" inputMode="numeric" value={total} onChange={e => setTotal(Number(e.target.value) || 0)} style={{ ...inp("100%"), flex: 1 }} />
        </label>
        <div style={{ fontSize: FS.xs, color: C.muted, margin: "4px 0 0 72px" }}>{money(total, "kr")}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: FS.sm, color: C.dim, width: 64, flexShrink: 0 }}>진입</span>
          <Seg full value={split} onChange={setSplit} items={[[1, "한 번에"], [3, "3분할"]]} />
        </div>
        <div style={{ fontSize: FS.xs, color: C.muted, margin: "4px 0 0 72px" }}>{split === 3 ? "초록일 때 한 달 간격으로 3번" : "초록일 때 한 번에"}</div>
        <Info label="진입 방식 근거">
          2007–2025년 222개 시작 시점, 12개월 뒤 결과(이 규칙 기준):
          한 번에 평균 +6.6%·최악 −4.0%, 3분할 평균 +6.4%·최악 −3.6%. 한 번에가 이긴 비율 60%.
          평균은 한 번에가 낫고, 분할은 최악의 경우를 조금 줄입니다.
        </Info>
      </Card>

      <Sec right={<Grade k="weak" />}>🇺🇸 미국 섹터 → 국내 ETF</Sec>
      <Card style={{ padding: "0 12px" }}>
        {[...(dc.usCore || []), ...(dc.usSect || [])].slice(0, moreUs ? 99 : 5).map((t, i) => {
          const d = etfs[t]; if (!d) return null;
          const v = d.veh;
          const core = (dc.usCore || []).includes(t);
          return (
            <div key={t} onClick={() => openStock(t)} style={{ padding: "10px 0", borderTop: i ? `1px solid ${C.border}` : "none", cursor: "pointer",
                                                            background: core ? "rgba(6,182,212,.04)" : undefined }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 0, ...ONE }}>
                  {d.s} <span style={{ fontSize: FS.xs, color: C.muted, fontWeight: 400 }}>{t}{core ? " · 지수" : ""}</span></span>
                <span style={{ fontSize: 14, fontWeight: 700, fontFamily: MONO, color: col(d.score) }}>{pct(d.score, 0)}</span>
              </div>
              <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 2, ...ONE }}>
                {v?.code ? <>→ <b style={{ fontFamily: MONO, color: C.cyan }}>{v.code}</b> {v.name}{v.c ? ` · ${price(v.c, "kr")}` : ""}</>
                         : <span style={{ color: C.gold }}>국내 상장 대체 없음</span>}
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                <St d={d} />
                <Chip tone={d.st === 3 ? "g" : "n"}>ST {d.st}/3</Chip>
                <Chip tone={d.cloud === 1 ? "g" : d.cloud === -1 ? "r" : "n"}>구름 {d.cloud === 1 ? "위" : d.cloud === 0 ? "안" : "아래"}</Chip>
                {v?.synth && <Chip tone="w">합성 · DC 매수 가능 여부 확인</Chip>}
              </div>
            </div>);
        })}
        {!moreUs && (dc.usCore || []).length + (dc.usSect || []).length > 5 && (
          <button onClick={() => setMoreUs(true)} style={{ ...btn(C.dim), width: "100%", margin: "8px 0" }}>
            나머지 {(dc.usCore || []).length + (dc.usSect || []).length - 5}개 보기</button>)}
        <Info label="섹터 선택 근거">
          판단(점수·신호)은 미국 원본 ETF로, 매수는 국내 상장 ETF로 합니다. 국내 상품은 원화 기준이라 환율 영향이 더해집니다
          (주간 상관 0.83~0.96). 섹터 상위 3개로 교체하는 방식은 원화·DC 조건 검증에서 지수 보유와 차이가 없었습니다
          (연 9.2% vs 9.2%) — 핵심 비중은 위 규칙대로 두고, 섹터는 비중을 더 두고 싶을 때 고르는 참고로 쓰세요.
        </Info>
      </Card>

      <Sec right={<Grade k="weak" />}>🇰🇷 한국 업종 ETF</Sec>
      <Card style={{ padding: "0 12px" }}>
        {(dc.krSect || []).slice(0, moreKr ? 99 : 5).map((t, i) => {
          const d = etfs[t]; if (!d) return null;
          return (
            <div key={t} onClick={() => openStock(t)} style={{ padding: "10px 0", borderTop: i ? `1px solid ${C.border}` : "none", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 0, ...ONE }}>
                  {d.n} <span style={{ fontSize: FS.xs, color: C.muted, fontWeight: 400, fontFamily: MONO }}>{t}</span></span>
                <span style={{ fontSize: 14, fontWeight: 700, fontFamily: MONO, color: col(d.score) }}>{pct(d.score, 0)}</span>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                <St d={d} />
                <Chip tone={d.st === 3 ? "g" : "n"}>ST {d.st}/3</Chip>
                <Chip tone="n">{price(d.c, "kr")}</Chip>
              </div>
            </div>);
        })}
        {!moreKr && (dc.krSect || []).length > 5 && (
          <button onClick={() => setMoreKr(true)} style={{ ...btn(C.dim), width: "100%", margin: "8px 0" }}>
            나머지 {(dc.krSect || []).length - 5}개 보기</button>)}
        <Info label="왜 참고만?">
          한국 업종 ETF를 골라 담는 방식은 KODEX 200 보유보다 낮았습니다(연 +5.51% vs +10.22%, 최대낙폭 −62% vs −36%).
          추세 신호를 붙여도 업종 ETF 전체 샤프 0.44로 KODEX 200 보유(0.53)보다 낮았습니다. 한국 몫은 KODEX 200 하나로 두는 것이 검증 결과입니다.
        </Info>
      </Card>

      <Info label="규칙 · 검증 · DC 제약">
        <b style={{ color: C.text }}>규칙</b> {dc.rule}<br />
        <b style={{ color: C.text }}>검증</b> {dc.evidence?.period}: 연 {pct(dc.evidence?.cagr, 1)} · 최대낙폭 {dc.evidence?.mdd}% · 샤프 {dc.evidence?.sharpe}
        (신호 없이 보유 {pct(dc.evidence?.bh_cagr, 1)} · {dc.evidence?.bh_mdd}% · {dc.evidence?.bh_sharpe}).
        수익은 조금 낮고 낙폭은 절반 이하입니다. 2026년 7월 폭락 때 KODEX 200 신호는 7/2(고점 −17%)에 빠져 이후 −29%를 피했지만, 반등은 놓쳤습니다.<br />
        <b style={{ color: C.text }}>DC 제약</b> 국내 상장 ETF만 · 위험자산 70% 한도 · 레버리지·인버스 불가 · 합성 ETF는 증권사 확인.
        분기 첫 거래일에 35/35/30 비중을 다시 맞춥니다. 은행·보험사 DC는 ETF 실시간 매매가 안 될 수 있습니다.<br />
        기록은 이 기기 브라우저에만 저장됩니다. 투자자문이 아닙니다.
      </Info>
    </>
  );
}

/* ══════════════ 3. 발굴 ══════════════ */
const SORT_LABEL = { sig: "매수! 먼저", rs: "RS 높은 순", sec: "주도 업종 먼저", vol: "변동성 높은 순", tv: "거래대금 큰 순" };
/** 시장 대비 = 그 종목 1달 수익 − 같은 시장 지수 1달 수익 */
const benchOf = (s) => s.m === "kr" ? "^KS11" : (s.ex === "NMS" ? "^IXIC" : "^GSPC");
const relOf = (s, market) => {
  const i = market?.indices?.[benchOf(s)];
  return (s.d21 == null || i?.d21 == null) ? null : s.d21 - i.d21;
};
function FindTab({ list, openStock, watch, toggleWatch, market, sizer, pos }) {
  const [filt, setFilt] = useState("buy");
  const [mkt, setMkt] = useState("all");
  const [sortBy, setSortBy] = useState("sig");
  const [limit, setLimit] = useState(20);
  const heldSet = useMemo(() => new Set((pos || []).map(p => p.t)), [pos]);
  const pool = useMemo(() => {
    let r = list.filter(s => (s.tvr ?? 0) >= 40);
    if (mkt !== "all") r = r.filter(s => s.m === mkt);
    return r;
  }, [list, mkt]);
  const rows = useMemo(() => {
    let r = pool;
    if (filt === "buy") r = r.filter(s => s.action === "buy");
    const W = { pull: 3, strong: 3, trend: 2 };
    const key = { sig: s => -((s.action === "buy" ? W[s.why] || 1 : 0) * 1000 + (s.rs ?? 0)),
                  rs: s => -(s.rs ?? 0), vol: s => -(s.atrr ?? -1), tv: s => -(s.tvr ?? 0),
                  sec: s => { const r = (market?.sectors || []).find(x => x.tk === s.sec); return (r ? r.rank : 99) * 1000 - (s.rs ?? 0); } }[sortBy];
    return [...r].sort((a, b) => key(a) - key(b));
  }, [pool, filt, sortBy, market]);
  const nBuy = pool.filter(s => s.action === "buy").length;
  const nKr = pool.filter(s => s.action === "buy" && s.m === "kr").length;
  return (
    <>
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        <Seg full value={mkt} onChange={setMkt} items={[["all", "전체"], ["kr", "🇰🇷 한국"], ["us", "🇺🇸 미국"]]} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(98px, 1fr))", gap: 6 }}>
          <Seg full value={filt} onChange={setFilt} items={[["buy", `매수! ${nBuy}`], ["all", "전체"]]} />
          <SortSelect value={sortBy} onChange={setSortBy}
            items={[["sig", "신호순"], ["rs", "RS순"], ["sec", "주도 업종순"], ["vol", "변동성순"], ["tv", "거래대금순"]]} />
        </div>
        <div style={{ fontSize: FS.xs, color: C.muted }}>
          매수! {nBuy} (🇰🇷 눌림 {nKr} · 🇺🇸 강세·추세 {nBuy - nKr}) · 🇰🇷 <Grade k="strong" /> · 🇺🇸 <Grade k="mid" />
        </div>
      </div>
      <SortBar text={SORT_LABEL[sortBy]} n={rows.length} market={market} />
      <ExplainList items={EXPLAIN.trend} />
      <div>
        {rows.length === 0 ? <Empty>지금은 매수! 신호가 없습니다 · ‘전체’를 누르면 관망 종목도 보입니다</Empty> : rows.slice(0, limit).map((s, i) => (
          <StockRow key={s.t} s={s} rank={i + 1} rel={relOf(s, market)} held={heldSet.has(s.t)}
            isWatch={watch.includes(s.t)} onToggle={toggleWatch} onOpen={openStock}
            sub={subLine(s, sizer, market)} />))}
        {rows.length > limit && (
          <button onClick={() => setLimit(l => l + 20)} style={{ ...btn(C.dim), width: "100%", marginTop: 10 }}>
            더 보기 ({limit} / {rows.length})</button>)}
      </div>
    </>
  );
}

/* ══════════════ 4. 과매도 ══════════════ */
function OversoldTab({ list, openStock, watch, toggleWatch, sizer, market, pos }) {
  const [showKr, setShowKr] = useState(false);
  const [onlyWatch, setOnlyWatch] = useState(true);
  const [limit, setLimit] = useState(20);
  const heldSet = useMemo(() => new Set((pos || []).map(p => p.t)), [pos]);
  const all = useMemo(() => list.filter(s => (s.tvr ?? 0) >= 40 && s.dip), [list]);
  const nKr = all.filter(s => s.m === "kr").length;
  const rows = useMemo(() => all
    .filter(s => showKr || s.m === "us")
    .filter(s => !onlyWatch || s.dip === "watch")
    .sort((a, b) => (a.dip === "watch" ? 0 : a.dip === "wait" ? 1 : 2) - (b.dip === "watch" ? 0 : b.dip === "wait" ? 1 : 2) || (a.w52p ?? 0) - (b.w52p ?? 0)), [all, showKr, onlyWatch]);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: FS.sm, color: C.dim }}>🇺🇸 좋았던 종목이 크게 빠진 것 · <b style={{ color: C.gold }}>손절 없이 12~24개월 · 소액만</b></span>
        <span style={{ marginLeft: "auto" }}><Grade k="weak" /></span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 6, marginTop: 8 }}>
        <Seg full value={onlyWatch ? "w" : "a"} onChange={v => setOnlyWatch(v === "w")} items={[["w", "관찰만"], ["a", "대기·훼손 포함"]]} />
        <Toggle full on={showKr} onClick={() => setShowKr(v => !v)}>🇰🇷 포함 {nKr}</Toggle>
      </div>
      <SortBar text="관찰 먼저 · 낙폭 큰 순" n={rows.length} market={market} />
      <ExplainList items={EXPLAIN.dip} />
      <div>
        {rows.length === 0 ? <Empty>조건에 맞는 종목이 없습니다</Empty> : rows.slice(0, limit).map((s, i) => (
          <StockRow key={s.t} s={s} rank={i + 1} rel={relOf(s, market)} dip held={heldSet.has(s.t)}
            isWatch={watch.includes(s.t)} onToggle={toggleWatch} onOpen={openStock}
            sub={subLine(s, sizer, market, [`고점 ${pct(s.w52p, 0)}`, `건강 ${((s.hlt ?? 0) * 100).toFixed(0)}%`,
                  s.ma20p != null ? `20일선 ${s.ma20p >= 0 ? "위" : "아래"}` : null])} />))}
        {rows.length > limit && (
          <button onClick={() => setLimit(l => l + 20)} style={{ ...btn(C.dim), width: "100%", marginTop: 10 }}>
            더 보기 ({limit} / {rows.length})</button>)}
      </div>
    </>
  );
}

const FilterBar = ({ children }) => (
  <div style={{ display: "flex", gap: 6, alignItems: "center", overflowX: "auto", WebkitOverflowScrolling: "touch",
                padding: "10px 2px 6px", scrollbarWidth: "none" }}>{children}</div>
);
const Seg = ({ value, onChange, items, full }) => (
  <div style={{ display: "flex", background: "rgba(255,255,255,.05)", borderRadius: 9, padding: 2, minWidth: 0,
                flex: full ? 1 : "none", flexShrink: full ? 1 : 0 }}>
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
function ChartTab({ stocks, sel: sel0, watch, toggleWatch, market, pos, setPos, setTab, sizer }) {
  // 국내 상장 매수용 ETF 를 열면 판단 기준인 미국 원본 차트를 보여줍니다
  const sel = (sel0 && stocks[sel0]?.vehOf) || sel0;
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
  const [hov, setHov] = useState(null);       // 손가락으로 짚은 봉 (없으면 마지막 봉)
  useEffect(() => { setHov(null); }, [sel, span]);
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
  const v = isEtf
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
    ...(s.m === "kr"
      ? [["RSI 45 회복 (눌림)", !!s.pull, `RSI ${s.rsi?.toFixed(0) ?? "—"}${s.pull ? " · 오늘 회복" : ""}`]]
      : [["RSI 60 이상 (강세)", (s.rsi ?? 0) >= 60, `RSI ${s.rsi?.toFixed(0) ?? "—"}`]]),
    ["또는 추세 확인 (ST 3개 초록 + 구름 위)", !!s.trend3, `ST ${s.st ?? "—"}/3 · 구름 ${s.cloud === 1 ? "위" : s.cloud === 0 ? "안" : "아래"}`],
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
            <div style={{ fontSize: FS.sm, fontFamily: MONO, color: col(s.d1) }}>{pct(s.d1)}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {isEtf ? <><span style={{ fontSize: FS.lg, fontWeight: 800, color: v?.c }}>{v?.t}</span>
                     <span style={{ fontSize: FS.sm, color: C.dim }}>{v?.why}</span></>
                 : <><ActionTag s={s} held={held} big />
                     <span style={{ fontSize: FS.sm, color: C.dim }}>
                       {s.action === "sell" ? `느린 ST 빨강 ${s.slowDays ?? "—"}거래일째` : s.stLine ? `트레일링선 ${price(s.stLine, s.m)} (${((s.c / s.stLine - 1) * 100).toFixed(1)}%)` : ""}</span>
                     {s.dip && <DipTag s={s} />}</>}
        </div>
        {isEtf && veh && (
          <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 6, padding: "7px 9px", borderRadius: 8, background: "rgba(6,182,212,.07)" }}>
            {veh.code ? <>DC 매수 → <b style={{ fontFamily: MONO, color: C.cyan }}>{veh.code}</b> <b style={{ color: C.text }}>{veh.name}</b>
              {veh.c ? ` · ${price(veh.c, "kr")}` : ""}{veh.synth && <span style={{ color: C.gold }}> · 합성 — DC 매수 가능 여부 확인</span>}</>
              : <span style={{ color: C.gold }}>국내 상장 대체 ETF 없음 — DC에서 살 수 없습니다</span>}
          </div>)}
        {!held && sh != null && (!isEtf || veh?.code) && (
          <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 4 }}>
            {sh > 0 ? <>1회차 <b style={{ color: C.text }}>{sh}주</b> · {money(sizer.limit(regM) * 0.5, regM)} (한도 {money(sizer.limit(regM), regM)}의 절반)
              <span style={{ color: C.muted }}> · 2회차는 +3% 확인 후</span></>
              : Math.floor(sizer.limit(regM) / regPx) >= 1
                ? <span style={{ color: C.gold }}>고가 종목 — 절반으로는 1주도 안 됩니다. <b style={{ color: C.text }}>1주를 한 번에</b> (2회차 없음)</span>
                : <span style={{ color: C.gold }}>1주 가격이 종목당 한도({money(sizer.limit(regM), regM)})보다 큽니다 — 한도를 올리세요</span>}
          </div>)}
        <button onClick={() => {
          if (held) { setTab("track"); return; }
          if (isEtf && !veh?.code) return;
          const today = new Date().toISOString().slice(0, 10);
          const half = sizer.limit(regM) * 0.5;
          const oneShot = !isEtf && Math.floor(half / regPx) < 1;            // 고가 종목: 1주를 한 번에
          const amt = isEtf ? sizer.limit(regM) : oneShot ? regPx : half;
          const tr = oneShot ? [{ d: today, px: regPx, amt }, { d: today, px: regPx, amt: 0 }] : [{ d: today, px: regPx, amt }];
          setPos(vs => [...vs, { id: Date.now(), t: regT, role: isEtf ? "etf" : (s.dip ? "long" : "swing"), date: today, tr }]);
          setTab("track");
        }} disabled={isEtf && !veh?.code} style={{ ...btn(held ? C.dim : C.emerald), width: "100%", marginTop: 10, opacity: isEtf && !veh?.code ? .4 : 1 }}>
          {held ? "내 종목에서 보기" : isEtf ? `＋ ${price(regPx, regM)} 에 보유 등록${veh?.code ? ` (${veh.code})` : ""}`
            : (sh > 0 ? `＋ 1회차 매수 등록 · ${price(regPx, regM)}` : `＋ 1주 매수 등록 · ${price(regPx, regM)}`)}</button>
      </Card>

      {/* 매매 체크리스트 — 충동 매매 방지 (검증된 규칙만) */}
      <Card style={{ marginTop: 8, padding: "10px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: FS.md, fontWeight: 800 }}>{isEtf ? "보유 조건" : "매수 체크리스트"}</span>
          <span style={{ marginLeft: "auto", fontSize: FS.sm, fontWeight: 800, color: isEtf ? (s.stSlow === 1 ? C.emerald : C.gold) : allOk ? C.emerald : C.muted }}>
            {isEtf ? (s.stSlow === 1 ? "보유 가능" : "대기") : allOk ? "매수!" : s.action === "sell" ? "매도!" : "관망"}</span>
        </div>
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
          {isEtf
            ? <>느린 슈퍼트렌드가 초록일 때만 보유하고 빨강이면 안전자산으로 두는 규칙입니다. S&P500 원화 기준 2007–26: 샤프 0.69 (그냥 보유 0.58), 최대낙폭 −20% (보유 −31%).</>
            : <>매수는 위 조건이 모두 맞을 때, 매도는 느린 ST가 빨강이 될 때. 2008–26 검증: 평균 약 30일 보유, 손익비 1.6, 승률 약 40%.
               “셋 중 하나라도 빨강이면 매도”는 평균 7일 보유로 비용을 빼면 남는 게 없었습니다. RSI·MACD 상승 조건은 넣어도 결과가 같았습니다.</>}
        </Info>
      </Card>
      <div style={{ marginTop: 8 }}><Cells s={s} /></div>

      {/* 차트 옵션 — 한 줄, 넘치면 밀어서 */}
      <FilterBar>
        <span style={{ fontSize: FS.xs, color: C.muted, flexShrink: 0 }}>기간</span>
        <Seg value={span} onChange={setSpan} items={[[63, "3M"], [126, "6M"], [200, "전체"]]} />
        <span style={{ fontSize: FS.xs, color: C.muted, flexShrink: 0, marginLeft: 4 }}>표시</span>
        {[["st", "ST"], ["ichi", "구름"], ["ma", "이평"], ["idx", idxLabel]].map(([k, l]) =>
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
              {opt.idx && view?.idxRel != null && (
                <span style={{ fontWeight: 700, color: view.idxRel >= 0 ? C.emerald : C.red }}>
                  지수 대비 {view.idxRel >= 0 ? "+" : ""}{view.idxRel.toFixed(1)}%</span>)}
            </PanelLabel>
            <div {...touchBox(250)}>
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
          </Card>

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
function TrackTab({ stocks, watch, toggleWatch, openStock, pos, setPos, market, bumpSizer, extras, trades, setTrades, sizer }) {
  const [role, setRole] = useState("all");
  const [showSizer, setShowSizer] = useState(false);
  const g = (k, d) => { const v = Number(localStorage.getItem(k)); return Number.isFinite(v) && v > 0 ? v : d; };
  const [capKr, setCapKr] = useState(() => g("v9.cap.kr", 20000000));
  const [capUs, setCapUs] = useState(() => g("v9.cap.us", 5000));
  const [limKr, setLimKr] = useState(() => g("v9.lim.kr", 20000000));
  const [limUs, setLimUs] = useState(() => g("v9.lim.us", 1000));
  useEffect(() => { localStorage.setItem("v9.cap.kr", String(capKr)); localStorage.setItem("v9.cap.us", String(capUs));
                    localStorage.setItem("v9.lim.kr", String(limKr)); localStorage.setItem("v9.lim.us", String(limUs)); bumpSizer?.(); }, [capKr, capUs, limKr, limUs]);
  const look = useCallback((t) => stocks[t] || null, [stocks]);
  const [form, setForm] = useState(null);
  const rows = pos.filter(p => role === "all" || p.role === role);
  const RB = { etf: ["ETF", "w"], swing: ["단기", "g"], long: ["장기", "c"] };

  /** 매도 기록 — 회차까지 남깁니다 */
  const closePos = (p, s) => {
    const cur = s?.c ?? avgOf(p);
    const raw = prompt(`${s?.n || p.t} 매도가를 입력하세요 (취소하면 기록 없이 삭제)`, String(cur));
    if (raw !== null) {
      const sell = Number(String(raw).replace(/[^\d.]/g, ""));
      if (sell > 0) {
        const avg = avgOf(p), tr = trOf(p);
        const days = Math.max(1, Math.round((Date.now() - new Date(tr[0].d + "T00:00:00").getTime()) / 86400000));
        setTrades(v => [...v, { t: p.t, n: s?.n || p.t, m: s?.m || "kr", role: p.role, buy: avg, sell, in: tr[0].d,
                                out: new Date().toISOString().slice(0, 10), days, pl: (sell / avg - 1) * 100,
                                k: tr.length, inv: investedOf(p) }].slice(-300));
      }
    }
    setPos(v => v.filter(x => x.id !== p.id));
  };
  /** 2회차 매수 기록 */
  const addTranche = (p, s) => {
    const raw = prompt(`${s?.n || p.t} 2회차 매수가 (기본: 현재가)`, String(s?.c ?? ""));
    if (raw === null) return;
    const px = Number(String(raw).replace(/[^\d.]/g, "")); if (!(px > 0)) return;
    const amt = sizer.limit(s?.m || "kr") * 0.5;
    setPos(v => v.map(x => x.id === p.id ? { ...x, tr: [...trOf(x), { d: new Date().toISOString().slice(0, 10), px, amt }] } : x));
  };
  const submit = () => {
    const key = (form.t || "").trim().toUpperCase();
    const found = look(key);
    if (!found) { setForm({ ...form, err: "목록에 없는 티커입니다" }); return; }
    const px = Number(form.avg);
    if (!px || px <= 0) { setForm({ ...form, err: "매수가를 숫자로 입력하세요" }); return; }
    const m = found.m || "kr"; const role = form.role || (found.etf ? "etf" : "swing");
    const amt = role === "etf" ? sizer.limit(m) : sizer.limit(m) * (form.k === "2" ? 1 : 0.5);
    setPos(v => [...v, { id: Date.now(), t: key, role, date: new Date().toISOString().slice(0, 10),
                         tr: form.k === "2" ? [{ d: new Date().toISOString().slice(0, 10), px, amt: amt / 2 }, { d: new Date().toISOString().slice(0, 10), px, amt: amt / 2 }]
                                            : [{ d: new Date().toISOString().slice(0, 10), px, amt }] }]);
    setForm(null);
  };
  const Cap = ({ label, v, set, m }) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: FS.sm, color: C.dim, width: 92, flexShrink: 0 }}>{label}</span>
      <input type="number" inputMode="numeric" value={v} onChange={e => set(Number(e.target.value) || 0)} style={{ ...inp("100%"), flex: 1 }} />
      <span style={{ fontSize: FS.xs, color: C.muted, width: 56, textAlign: "right" }}>{money(v, m)}</span>
    </label>);
  return (
    <>
      {/* 사이징 — 계좌별 자본·종목당 한도. 손절 폭 설정은 없습니다: 청산은 트레일링선 하나 */}
      <Card style={{ marginTop: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
          {[["🇰🇷 원화 계좌", capKr, limKr, "kr"], ["🇺🇸 달러 계좌", capUs, limUs, "us"]].map(([l, c, lim, m]) => (
            <div key={m} style={{ padding: "8px 10px", borderRadius: 9, background: "rgba(255,255,255,.03)" }}>
              <div style={{ fontSize: FS.xs, color: C.muted }}>{l}</div>
              <div style={{ fontSize: FS.md, fontWeight: 800, fontFamily: MONO }}>{money(c, m)}</div>
              <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 2 }}>종목당 {money(lim, m)} · 1회차 {money(lim * 0.5, m)} · 최대 {Math.max(1, Math.floor(c / lim))}종목</div>
            </div>))}
        </div>
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 6 }}>매수 = 한도의 절반 → +3% 확인 후 나머지 절반 · 매도 = 트레일링선 아래 마감 (손절 % 설정 없음)</div>
        <button onClick={() => setShowSizer(v => !v)} style={{ ...btn(C.dim), width: "100%", marginTop: 8 }}>
          {showSizer ? "설정 닫기" : "⚙ 자본 · 종목당 한도 설정"}</button>
        {showSizer && (
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            <Cap label="원화 자본" v={capKr} set={setCapKr} m="kr" />
            <Cap label="원화 종목당" v={limKr} set={setLimKr} m="kr" />
            <Cap label="달러 자본 ($)" v={capUs} set={setCapUs} m="us" />
            <Cap label="달러 종목당 ($)" v={limUs} set={setLimUs} m="us" />
            <Info label="왜 절반씩?">
              검증(2008–26): 1주 보초→400→…처럼 잘게 쪼개면 돈이 놀아 총수익이 절반 이하. 한 번에 다 넣으면 총수익은 최대지만 심리적으로 어렵습니다.
              절반→+3% 확인 후 절반이 투입 효율(한국 +3.2%·미국 +2.8%)과 총수익의 균형점이었습니다. −3% 초기손절·고점 −5% 트레일·2주 타임컷은 모두 성과를 깎아 쓰지 않습니다.
            </Info>
          </div>)}
      </Card>

      <Sec right={<button onClick={() => setForm(form ? null : { t: "", avg: "", role: "swing", k: "1" })} style={linkBtn}>{form ? "닫기" : "＋ 직접 추가"}</button>}>
        보유 {pos.length}
      </Sec>
      <div style={{ marginBottom: 8 }}>
        <Seg value={role} onChange={setRole} items={[["all", "전체"], ["etf", "ETF"], ["swing", "단기"], ["long", "장기"]]} />
      </div>
      {form && (
        <Card style={{ marginBottom: 8, display: "grid", gap: 8 }}>
          <input value={form.t} onChange={e => setForm({ ...form, t: e.target.value, err: null })} placeholder="티커 (AAPL / 005930)" style={inp("100%")} />
          <input value={form.avg} onChange={e => setForm({ ...form, avg: e.target.value, err: null })} placeholder="매수가 (평단)" inputMode="decimal" style={inp("100%")} />
          <Seg value={form.role} onChange={r => setForm({ ...form, role: r })} items={[["etf", "ETF"], ["swing", "단기"], ["long", "장기"]]} />
          {form.role === "swing" && <Seg value={form.k} onChange={k => setForm({ ...form, k })} items={[["1", "1회차만 산 상태"], ["2", "이미 전량"]]} />}
          <button onClick={submit} style={{ ...btn(C.emerald), width: "100%" }}>등록</button>
          {form.err && <span style={{ fontSize: FS.sm, color: C.red }}>{form.err}</span>}
        </Card>)}
      {rows.length === 0 ? <Card><Empty>기록된 포지션이 없습니다 · 차트탭에서 ‘1회차 매수 등록’</Empty></Card> :
        rows.map(p => {
          const s = look(p.t); if (!s) return null;
          const tr = trOf(p), avg = avgOf(p), inv = investedOf(p);
          const pl = (s.c / avg - 1) * 100, pl1 = (s.c / tr[0].px - 1) * 100;
          const [rl, rt] = RB[p.role] || RB.swing;
          const act = actionOf(s, true);
          const nxt = p.role === "swing" ? nextTrancheOf(p, s, sizer.limit(s.m)) : null;
          const gap = s.stLine ? (s.c / s.stLine - 1) * 100 : null;
          const isSell = act === "sell" && p.role !== "long";
          return (
            <Card key={p.id} style={{ marginBottom: 8, borderColor: isSell ? "rgba(255,69,58,.5)" : nxt?.ok ? "rgba(48,209,88,.45)" : C.border }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div onClick={() => openStock(p.t)} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, ...ONE }}><Chip tone={rt}>{rl}</Chip> <b style={{ fontFamily: MONO }}>{p.t}</b> <span style={{ color: C.dim, fontWeight: 400 }}>{shortName(s.n)}</span></div>
                  <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 2 }}>
                    {p.role === "swing" ? `${tr.length}/2회차 · ` : ""}투입 {money(inv, s.m)} · 평단 {price(avg, s.m)} · {tr[0].d}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: col(pl), fontFamily: MONO }}>{pct(pl)}</div>
                  <div style={{ fontSize: FS.xs, color: C.muted }}>{tr.length > 1 ? `1회차 기준 ${pct(pl1)}` : price(s.c, s.m)}</div>
                </div>
                <button onClick={() => closePos(p, s)} aria-label="매도 기록"
                  style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18, width: 32, height: 34 }}>×</button>
              </div>

              {/* 상태 줄 — 행동 단어는 파이프라인 판정 그대로 */}
              {p.role !== "long" ? (
                <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8,
                              background: isSell ? "rgba(255,69,58,.12)" : "rgba(48,209,88,.07)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: FS.md, fontWeight: 800, color: isSell ? C.red : C.emerald }}>{isSell ? "매도!" : "보유"}</span>
                    <span style={{ fontSize: FS.xs, color: C.dim }}>
                      {isSell ? `종가 ${price(s.c, s.m)} < 트레일링선 ${price(s.stLine, s.m)}`
                              : s.stLine ? `트레일링선 ${price(s.stLine, s.m)} · 여유 ${gap.toFixed(1)}%` : "트레일링선 없음"}
                      {s.slowDays != null && ` · ${s.slowDays}거래일째`}</span>
                  </div>
                  {!isSell && s.stLine && (
                    <div style={{ height: 6, borderRadius: 4, background: "rgba(255,255,255,.07)", marginTop: 6, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, gap * 4))}%`, background: `linear-gradient(90deg,${C.gold},${C.emerald})` }} />
                    </div>)}
                  {isSell && <button onClick={() => closePos(p, s)} style={{ ...btn(C.red), width: "100%", marginTop: 8 }}>매도가 입력 → 기록</button>}
                </div>
              ) : (
                <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 6 }}>장기 관찰 — 손절 없이 12~24개월 · <DipTag s={s} /></div>
              )}

              {/* 2회차 안내 */}
              {nxt && !isSell && (
                <div style={{ marginTop: 6, padding: "7px 10px", borderRadius: 8, background: nxt.ok ? "rgba(48,209,88,.10)" : "rgba(255,255,255,.03)", fontSize: FS.sm }}>
                  {nxt.ok ? <>
                    <b style={{ color: C.emerald }}>2회차 조건 도달</b> <span style={{ color: C.dim }}>· 1회차 +3% = {price(nxt.target, s.m)} 넘음 · {money(nxt.amt, s.m)} ≈ {Math.floor(nxt.amt / s.c)}주</span>
                    <button onClick={() => addTranche(p, s)} style={{ ...btn(C.emerald), width: "100%", marginTop: 6 }}>✓ 2회차 매수 완료 기록</button>
                  </> : nxt.chase ? <span style={{ color: C.gold }}>⛔ 추격 금지 — 1회차 대비 {nxt.gain.toFixed(1)}% (밴드 +3~6% 초과). 눌렸다 다시 +3~6% 안에 들어오면 2회차</span>
                  : <span style={{ color: C.dim }}>⏳ 2회차 조건: 1회차 +3% = <b style={{ color: C.text }}>{price(nxt.target, s.m)}</b> ({nxt.pctToGo.toFixed(1)}% 남음){s.stSlow !== 1 ? " · 느린 ST 초록이어야" : ""}</span>}
                </div>)}
            </Card>);
        })}

      <SyncBtn pos={pos} watch={watch} extras={extras} trades={trades} />
      <Sec>관심 {watch.length}</Sec>
      <Card style={{ padding: "0 10px" }}>
        {watch.length === 0 ? <Empty>종목 옆 ☆ 를 누르면 여기에 모입니다</Empty> :
          watch.map(t => { const s = look(t); if (!s) return null;
            return <StockRow key={t} s={s} isWatch onToggle={toggleWatch} onOpen={openStock} rel={relOf(s, market)}
              held={pos.some(p => p.t === t)} sub={subLine(s, sizer, market)} />; })}
      </Card>
      <div style={{ fontSize: FS.xs, color: C.muted, margin: "10px 2px 0" }}>보유·관심 기록은 이 기기 브라우저에만 저장됩니다 · 🔔 알림 연결로 서버에 백업</div>
    </>
  );
}

/** 분기 실적(재무) 갱신 — 베타 터미널 F-Score 가 쓰는 데이터. 수집 후 병합까지 자동 연결됩니다 */
function FinRefreshBtn() {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!confirm("분기 실적을 새로 받습니다 (약 20분). 진행할까요?")) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/refresh?wf=financials", {
        method: "POST", headers: { "x-key": localStorage.getItem("v52.rkey") || "" },
      });
      const j = await r.json().catch(() => ({}));
      setMsg({ t: j.ok ? (j.already ? "이미 실행 중" : "시작 · 약 20분 뒤 베타에 반영") : (j.msg || "실행하지 못했습니다"), bad: !j.ok });
    } catch { setMsg({ t: "네트워크 오류", bad: true }); }
    setBusy(false);
  };
  return (
    <div>
      <button onClick={run} disabled={busy} style={{ ...btn(C.dim), width: "100%" }}>
        {busy ? "…" : "📊 분기 실적 갱신 (베타)"}</button>
      {msg && <div style={{ fontSize: FS.xs, color: msg.bad ? C.red : C.emerald, marginTop: 5 }}>{msg.t}</div>}
    </div>
  );
}

/** 알림 연결 — 이 기기의 보유·관심을 서버에 올려 텔레그램 알림이 내 종목을 보게 합니다 */
function SyncBtn({ pos, watch, extras = [], trades = [] }) {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState(() => localStorage.getItem("v7.sync.at") || null);
  const run = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-key": localStorage.getItem("v52.rkey") || "" },
        body: JSON.stringify({ bulk: true, positions: pos, watch, extras, trades: trades.slice(-100) }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) {
        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        localStorage.setItem("v7.sync.at", now); setAt(now);
        setMsg({ t: j.message || "저장됨" });
      } else setMsg({ t: j.message || j.error || `실패 (${r.status})`, bad: true });
    } catch { setMsg({ t: "네트워크 오류", bad: true }); }
    setBusy(false);
  };
  return (
    <Card style={{ marginTop: 10 }}>
      <div style={{ fontSize: FS.sm, color: C.dim }}>
        보유·관심을 알림에 연결하면 <b style={{ color: C.text }}>내 종목의 매도·매수 신호</b>가 텔레그램 맨 위에 옵니다.
      </div>
      <button onClick={run} disabled={busy} style={{ ...btn(C.cyan), width: "100%", marginTop: 8 }}>
        {busy ? "보내는 중…" : `🔔 알림 연결 (보유 ${pos.length} · 관심 ${watch.length}${extras.length ? ` · 추가 ${extras.length}` : ""})`}</button>
      {msg && <div style={{ fontSize: FS.xs, color: msg.bad ? C.red : C.emerald, marginTop: 5 }}>{msg.t}</div>}
      <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 4 }}>
        {at ? `마지막 연결 ${at} · 목록이 바뀌면 다시 눌러 주세요` : "기록을 바꿀 때마다 눌러 주세요"}
      </div>
    </Card>
  );
}


/** 종목풀에 없는 종목을 급히 넣기 — 파일을 고치지 않고 앱에서 바로 */
function AddTicker({ code, extras, setExtras, pos, watch, trades }) {
  const [st, setSt] = useState(extras.includes(code) ? "done" : "idle");
  const ok = /^[A-Z]{1,5}$|^\d{6}$/.test(code);
  const add = async () => {
    setSt("busy");
    const next = [...new Set([...extras, code])];
    setExtras(next);
    try {
      const r = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-key": localStorage.getItem("v52.rkey") || "" },
        body: JSON.stringify({ bulk: true, positions: pos, watch, extras: next, trades: trades.slice(-100) }),
      });
      setSt((await r.json().catch(() => ({}))).ok ? "done" : "local");
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

/** 매매 기록 — 백테스트 숫자는 생존편향이 섞여 있습니다. 내 계좌 기록이 진짜 검증입니다 */
function TradeLog({ trades, setTrades }) {
  const [open, setOpen] = useState(false);
  if (!trades.length) return (
    <Card style={{ marginTop: 10 }}>
      <div style={{ fontSize: FS.sm, color: C.dim }}>매매 기록이 없습니다</div>
      <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 4 }}>
        보유 종목의 ✕ 를 누르면 매도가를 물어봅니다. 그 기록이 쌓이면 내 실제 승률을 검증값과 비교할 수 있습니다.
      </div>
    </Card>);
  const n = trades.length;
  const win = trades.filter(t => t.pl > 0).length;
  const avg = trades.reduce((a, t) => a + t.pl, 0) / n;
  const med = [...trades].sort((a, b) => a.pl - b.pl)[Math.floor(n / 2)].pl;
  const days = Math.round(trades.reduce((a, t) => a + (t.days || 0), 0) / n);
  const gains = trades.filter(t => t.pl > 0).reduce((a, t) => a + t.pl, 0);
  const loss = -trades.filter(t => t.pl < 0).reduce((a, t) => a + t.pl, 0);
  const pf = loss > 0 ? gains / loss : null;
  const Cell = ({ k, v, c }) => (
    <div><div style={{ fontSize: 10.5, color: C.muted }}>{k}</div>
      <div style={{ fontSize: FS.md, fontWeight: 800, fontFamily: MONO, color: c || C.text }}>{v}</div></div>);
  return (
    <Card style={{ marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: FS.md, fontWeight: 800 }}>내 매매 기록</span>
        <span style={{ marginLeft: "auto", fontSize: FS.xs, color: C.muted }}>{n}건</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 6, marginTop: 8 }}>
        <Cell k="승률" v={`${(win / n * 100).toFixed(0)}%`} c={win / n >= 0.3 ? C.emerald : C.red} />
        <Cell k="평균" v={pct(avg, 1)} c={col(avg)} />
        <Cell k="중앙" v={pct(med, 1)} c={col(med)} />
        <Cell k="보유" v={`${days}일`} />
      </div>
      <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 7, lineHeight: 1.7 }}>
        검증값(2008–26): 승률 31% · 거래당 +3.0% · 중앙 −3.6% · 보유 15일{pf != null && ` · 내 손익비 ${pf.toFixed(2)} (검증 1.6)`}
        <br />작은 손실이 잦고 큰 수익이 가끔 오는 구조라, 승률이 낮은 것 자체는 문제가 아닙니다.
      </div>
      <button onClick={() => setOpen(v => !v)} style={{ ...btn(C.dim), width: "100%", marginTop: 8 }}>
        {open ? "닫기" : `기록 ${n}건 보기`}</button>
      {open && (
        <div style={{ marginTop: 6 }}>
          {[...trades].reverse().slice(0, 30).map((t, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 6, alignItems: "center",
                                  padding: "7px 0", borderTop: `1px solid ${C.border}` }}>
              <span style={{ minWidth: 0, ...ONE }}>
                <b style={{ fontSize: FS.sm }}>{t.n}</b>
                <span style={{ fontSize: 10.5, color: C.muted }}> {t.in}~{t.out} · {t.days}일</span>
              </span>
              <span style={{ fontSize: FS.xs, color: C.muted, fontFamily: MONO }}>
                {price(t.buy, t.m)}→{price(t.sell, t.m)}</span>
              <span style={{ fontSize: FS.sm, fontWeight: 700, fontFamily: MONO, color: col(t.pl) }}>{pct(t.pl, 1)}</span>
            </div>))}
          <button onClick={() => { if (confirm("매매 기록을 모두 지울까요? 되돌릴 수 없습니다")) setTrades([]); }}
            style={{ ...linkBtn, color: C.red, fontSize: FS.xs, marginTop: 6 }}>기록 전체 삭제</button>
        </div>)}
    </Card>);
}


/* ══════════════ 찾기 — 추세(눌림·매수) / 급락(과매도) 를 한 탭에서 전환 ══════════════ */
function FindHub(props) {
  const [mode, setMode] = useState(() => sessionStorage.getItem("v8.find") || "trend");
  useEffect(() => { try { sessionStorage.setItem("v8.find", mode); } catch {} }, [mode]);
  return (
    <>
      <div style={{ marginTop: 8 }}>
        <Seg full value={mode} onChange={setMode} items={[["trend", "📈 추세 (눌림·매수)"], ["dip", "🌊 급락 (과매도)"]]} />
      </div>
      {mode === "trend" ? <FindTab {...props} /> : <OversoldTab {...props} />}
    </>
  );
}

/* ══════════════ 점검 — 주 1회 루틴 ══════════════
   토요일(종목풀 갱신 뒤)에 한 번. 매번 헤매지 않게 순서를 고정합니다.               */
const weekKey = () => {                      // 이번 주(토요일 시작) 키
  const d = new Date(Date.now() + 9 * 3600000); const dow = d.getUTCDay();
  const sat = new Date(d); sat.setUTCDate(d.getUTCDate() - ((dow + 1) % 7));
  return sat.toISOString().slice(0, 10);
};
const REVIEW_STEPS = [
  ["pool", "종목풀 변경 확인", "이번 주 들어온·나간 종목을 훑고, 관심 있으면 ☆"],
  ["hold", "내 종목 점검", "🔴 이탈은 처리했는지 · 트레일링선 여유가 5% 미만인 종목 확인"],
  ["live", "실전 성적 보기", "앱이 실제로 낸 신호의 20일 성적이 검증값과 비슷한지"],
  ["trade", "내 매매 기록 대조", "내 승률·손익비가 검증값과 크게 다르면 규칙을 안 지킨 것"],
  ["decide", "전략 결정", "그대로 간다 / 바꾼다 — 바꾸면 이유를 한 줄 적기"],
];
function ReviewTab({ market, uni, snap, trades, setTrades, pos, stocks, setTab, openStock }) {
  const wk = weekKey();
  const [done, setDone] = useState(() => loadJSON("v8.review", {}));
  const [memo, setMemo] = useState(() => localStorage.getItem("v8.review.memo") || "");
  useEffect(() => { localStorage.setItem("v8.review", JSON.stringify(done)); }, [done]);
  useEffect(() => { localStorage.setItem("v8.review.memo", memo); }, [memo]);
  const cur = done[wk] || {};
  const toggle = (k) => setDone(o => ({ ...o, [wk]: { ...(o[wk] || {}), [k]: !cur[k] } }));
  const nDone = REVIEW_STEPS.filter(([k]) => cur[k]).length;
  const live = market.live || {};
  const risky = (pos || []).map(p => stocks[p.t]).filter(s => s && s.stLine && s.stSlow === 1 && (s.c / s.stLine - 1) * 100 < 5);
  const out = (pos || []).filter(p => p.role !== "long" && stocks[p.t]?.stSlow === 0);
  const VAL = { "pull:kr": ["눌림 🇰🇷"], "pull:us": ["눌림 🇺🇸"], "strong:us": ["강세 🇺🇸"], "strong:kr": ["강세 🇰🇷"], "buy:kr": ["추세 🇰🇷"], "buy:us": ["추세 🇺🇸"] };
  const drift = live.drift;
  return (
    <>
      <Sec right={`${nDone}/${REVIEW_STEPS.length} · ${wk} 주`}>이번 주 점검</Sec>
      <Card style={{ padding: "4px 12px" }}>
        {REVIEW_STEPS.map(([k, t, why], i) => (
          <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderTop: i ? `1px solid ${C.border}` : "none" }}>
            <button onClick={() => toggle(k)} aria-pressed={!!cur[k]}
              style={{ width: 34, height: 34, borderRadius: 17, flexShrink: 0, cursor: "pointer", border: `1px solid ${cur[k] ? C.emerald : C.border}`,
                       background: cur[k] ? "rgba(48,209,88,.18)" : "transparent", color: cur[k] ? C.emerald : C.muted, fontSize: 14 }}>{cur[k] ? "✓" : ""}</button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: FS.md, fontWeight: 700, color: cur[k] ? C.muted : C.text }}>{i + 1}. {t}</div>
              <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 2 }}>{why}</div>
              {k === "pool" && uni && <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 4 }}>
                {uni.date?.slice(5, 10)} · {uni.prevTotal} → {uni.total}종목
                {uni.added?.length > 0 && <span style={{ color: C.emerald }}> · ＋{uni.added.length} {uni.added.slice(0, 4).map(x => x.n).join(", ")}</span>}
                {uni.removed?.length > 0 && <span style={{ color: C.red }}> · −{uni.removed.length} {uni.removed.slice(0, 4).map(x => x.n).join(", ")}</span>}</div>}
              {k === "hold" && <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 4 }}>
                {out.length ? <span style={{ color: C.red }}>🔴 이탈 {out.length} </span> : "이탈 0 "}
                · 여유 5% 미만 {risky.length}{risky.length ? `: ${risky.slice(0, 3).map(s => s.t).join(", ")}` : ""}
                <button onClick={() => setTab("track")} style={{ ...linkBtn, fontSize: FS.xs, minHeight: 34, marginLeft: 6 }}>내 종목 ›</button></div>}
              {k === "decide" && <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="예: 그대로 유지 / 한국 비중 줄임"
                style={{ ...inp("100%"), marginTop: 6, fontSize: 14 }} />}
            </div>
          </div>))}
        <div style={{ fontSize: FS.xs, color: C.muted, padding: "8px 0 4px" }}>매월 1거래일에는 DC 탭도 함께 · 체크는 이 기기에 저장</div>
      </Card>

      {drift?.flag && (
        <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(255,69,58,.12)", border: `1px solid ${C.red}66` }}>
          <div style={{ fontSize: FS.md, fontWeight: 800, color: C.red }}>🚨 규칙 재검토 필요</div>
          <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 3 }}>{drift.reasons.join(" · ")}</div>
          <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 3 }}>기준선: 최근 30건 승률 20% 미만 또는 지수대비 −3%p 아래. 신호가 시장과 안 맞고 있다는 뜻입니다. 매수를 줄이고 원인을 보세요.</div>
        </div>)}
      <Sec right={live.since ? `${live.since}부터 · 기록 ${live.n}건` : "데이터 갱신 후 표시"}>실전 신호 성적</Sec>
      <Card style={{ padding: "4px 12px" }}>
        {!live.summary || !Object.keys(live.summary).length ? (
          <Empty>{live.n ? `신호 ${live.n}건 기록 중 — 20거래일이 지나야 성적이 잡힙니다 (대기 ${live.pending})` : "앱이 낸 신호를 자동으로 적고, 20거래일 뒤 성적을 셉니다"}</Empty>
        ) : (<>
          <Head cols={["신호", "건수", "20일", "지수대비", "승률"]} grid="minmax(0,1.3fr) minmax(0,.8fr) minmax(0,1fr) minmax(0,1fr) minmax(0,.9fr)" />
          {Object.entries(live.summary).filter(([k]) => !k.endsWith(":all")).map(([k, v]) => (
            <div key={k} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,.8fr) minmax(0,1fr) minmax(0,1fr) minmax(0,.9fr)", gap: 5,
                                  padding: "8px 0", borderTop: `1px solid ${C.border}`, alignItems: "center" }}>
              <span style={{ fontSize: FS.sm, fontWeight: 700, ...ONE }}>{VAL[k]?.[0] || k}</span>
              <span style={{ ...FIT, textAlign: "right" }}>{v.n}</span>
              <span style={{ ...FIT, textAlign: "right", color: col(v.avg) }}>{pct(v.avg, 1)}</span>
              <span style={{ ...FIT, textAlign: "right", color: col(v.excess) }}>{v.excess == null ? "—" : `${v.excess >= 0 ? "+" : ""}${v.excess.toFixed(1)}%p`}</span>
              <span style={{ ...FIT, textAlign: "right" }}>{v.win}%</span>
            </div>))}
          <div style={{ fontSize: FS.xs, color: C.muted, padding: "8px 0 4px", lineHeight: 1.6 }}>
            검증값(백테스트, 20일 보유 근사): 눌림 🇰🇷 거래당 +3.0% · 승률 31% / 강세 🇺🇸 +2.8% · 40%.
            {drift && !drift.flag && ` 최근 30건: 승률 ${drift.win}% · 지수대비 ${drift.excess >= 0 ? "+" : ""}${drift.excess}%p — 정상 범위.`}
            건수가 30건을 넘기 전까지는 우연의 범위입니다. 승률 25~40%, 지수대비 플러스면 정상 작동입니다.
          </div>
        </>)}
      </Card>

      <TradeLog trades={trades} setTrades={setTrades} />

      <Sec>검증 근거 (백테스트)</Sec>
      <Info label="5개 규칙의 검증 수치 보기">
        <div style={{ color: C.text }}>
      <Card style={{ padding: "4px 12px 10px" }}>
        {[
          ["⭐ 눌림 매수 (종목)", "strong", "한국 연 +21.8% · 같은 종목 보유 대비 +8.2%p · 최대낙폭 −40%",
           "추세 안에서 RSI 45 회복 · 매도는 느린ST 빨강. 미국은 연 +17.9%지만 그냥 보유를 못 이겼습니다."],
          ["🏦 DC 배분 규칙", "strong", "연 +7.2% · 최대낙폭 −10% · 샤프 1.04 (2010–26)",
           "S&P500 35% + 코스피200 35% + 안전자산 30%, 느린ST 초록일 때만 보유. 7월 폭락 때 −17%에서 빠져 이후 −29%를 피했습니다."],
          ["🌊 과매도 (미국)", "mid", "12개월 보유 시 시장 대비 중앙값 +10.1% · 승률 60%",
           "생존편향 미보정이라 실제는 더 낮습니다. 한국은 검증 실패라 기본 제외."],
          ["🔄 섹터 교체", "weak", "원화·DC 조건에서 지수 보유와 차이 없음 (연 9.2% vs 9.2%)",
           "비중을 더 두고 싶은 섹터를 고를 때 참고용으로만."],
          ["🇰🇷 시장 판정", "strong", "게이트 적용 시 연 +16.9% · 최대낙폭 −28% (없으면 +13.1% · −52%)",
           "단, 이 판정은 ETF 배분용입니다. 종목 매매에 붙이면 연 21.8%가 11.1%로 떨어졌습니다."],
        ].map(([t, g, num, why], i) => (
          <div key={t} style={{ padding: "9px 0", borderTop: i ? `1px solid ${C.border}` : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: FS.md, fontWeight: 700, flex: 1, minWidth: 0, ...ONE }}>{t}</span>
              <Grade k={g} />
            </div>
            <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 3 }}>{num}</div>
            <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 2, lineHeight: 1.6 }}>{why}</div>
          </div>))}
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 8 }}>
          2008–2026년 실제 데이터 · 신호 다음 날 종가 체결 · 거래비용 포함(미국 0.2% · 한국 0.35% · ETF 0.1%).
          종목 검증은 현재 살아있는 종목만 대상이라 수익이 부풀려져 있습니다. 투자자문이 아닙니다.
        </div>
      </Card>

        </div>
      </Info>
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

/** 차트 판독줄 — 손가락으로 짚은 봉의 값을 차트 '밖'에 적습니다.
    떠다니는 툴팁 상자는 휴대폰 화면을 통째로 가려서 쓰지 않습니다. */
const Readout = ({ row, live, m, idxLabel, onClear }) => {
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
