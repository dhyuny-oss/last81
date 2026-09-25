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

export const APP_VERSION = "v13.0.1";

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
    const trim = (x, d) => x.toFixed(d).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");   // 1.70 → 1.7 · 10 → 10
    if (a >= 1e12) return `${sg}${trim(a / 1e12, 1)}조`;
    if (a >= 1e8) return `${sg}${trim(a / 1e8, a >= 1e10 ? 0 : a >= 1e9 ? 1 : 2)}억`;
    if (a >= 1e4) return `${sg}${Math.round(a / 1e4).toLocaleString()}만`;
    return `${sg}${num(a, 0)}원`;
  }
  if (a >= 1e9) return `${sg}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sg}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (a >= 1e4) return `${sg}$${(a / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `${sg}$${Math.round(a).toLocaleString()}`;              // $4,927 — 1만 달러 아래는 그대로
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

/* 휴장일 (2026) — 매년 12월에 다음 해 것을 추가합니다. 장중 감시 스크립트와 같은 목록 */
const KR_HOLIDAYS = new Set(["2026-09-24", "2026-09-25", "2026-10-05", "2026-10-09", "2026-12-25", "2026-12-31"]);
const US_HOLIDAYS = new Set(["2026-11-26", "2026-12-25"]);
const HOLI_NAME = { "2026-09-24": "추석", "2026-09-25": "추석", "2026-10-05": "개천절 대체", "2026-10-09": "한글날",
                    "2026-12-25": "성탄절", "2026-12-31": "연말", "2026-11-26": "추수감사절" };
function marketState(nowMs = Date.now()) {
  // ★ UTC 게터로 읽습니다. 로컬 게터를 쓰면 미국에서 접속했을 때
  //   서머타임 전환 주에 KST 가 1시간 어긋납니다.
  const kst = new Date(nowMs + 9 * 3600000);
  const dow = kst.getUTCDay(), mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const ymd = kst.toISOString().slice(0, 10);
  const krHol = KR_HOLIDAYS.has(ymd);
  const usYmd = new Date(nowMs + 9 * 3600000 - (mins < 720 ? 86400000 : 0)).toISOString().slice(0, 10);   // 미국 장은 KST 자정을 넘김
  const usHol = US_HOLIDAYS.has(usYmd);
  const wd = dow >= 1 && dow <= 5;
  const krRegular = wd && !krHol && mins >= 540 && mins <= 930;          // 09:00~15:30
  const krExt = wd && !krHol && ((mins >= 450 && mins < 540) || (mins > 930 && mins <= 1080));
  const dst = usDST(nowMs);
  const usOpen = dst ? 1350 : 1410;                            // 22:30 / 23:30 KST
  const usClose = dst ? 300 : 360;                             // 05:00 / 06:00 KST
  const usRegular = !usHol && ((wd && mins >= usOpen) || (mins <= usClose && dow >= 2 && dow <= 6));
  const usPre = !usHol && wd && mins >= usOpen - 330 && mins < usOpen;
  const usAfter = !usHol && mins > usClose && mins <= usClose + 240 && dow >= 2 && dow <= 6;
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
  const krLabel = weekend ? "휴장" : krHol ? `휴장(${HOLI_NAME[ymd] || "공휴일"})`
    : mins < 450 ? "개장 전" : mins < 540 ? "장전" : mins <= 930 ? "장중"
    : mins <= 1080 ? "장후" : "장마감";
  const usLabel = weekend ? "휴장" : usHol ? `휴장(${HOLI_NAME[usYmd] || "공휴일"})`
    : usRegular ? "장중" : usPre ? "프리마켓" : usAfter ? "애프터"
    : (mins > usClose + 240 && mins < usOpen - 330) ? "장마감" : "개장 전";
  return { krRegular, krExt, usRegular, usPre, usAfter, weekend, anyOpen, next, dst, krLabel, usLabel, krHol, usHol };
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
  const rows = [["🇰🇷 코스피", market?.indices?.["^KS11"], market?.judge?.kr], ["🇺🇸 S&P500", market?.indices?.["^GSPC"], market?.judge?.us],
                ["🇺🇸 나스닥", market?.indices?.["^IXIC"], null]];
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
        <span style={{ fontSize: FS.xs, color: C.muted, marginLeft: "auto", flexShrink: 0 }}>{n}개</span>
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
// 매도! 는 들고 있을 때만 뜻이 있습니다. 안 들고 있는 종목의 추세 이탈은 '관망 (추세 이탈)'
const actionOf = (s, held) => (s?.action === "sell" ? (held ? "sell" : "watch") : held ? "hold" : (s?.action || "watch"));
const ActionTag = ({ s, held, big }) => {
  const k = actionOf(s, held); const [t, c] = ACTION[k];
  const why = k === "buy" ? WHY[s.why] : k === "sell" ? WHY.st : (k === "watch" && s?.action === "sell") ? "추세 이탈" : null;
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
    ["매도!", "들고 있는 종목의 종가가 트레일링선(느린 슈퍼트렌드 12,3) 아래로 마감. 유일한 매도 기준. 안 들고 있으면 '관망 (추세 이탈)'로 표시"],
    ["관망", "위 어느 것도 아님"],
    ["RS", "같은 시장 6개월 수익률 순위 백분위. 100이 최고, 70↑ 주도주"],
    ["나스닥比 +9p", "이 종목 1달 수익 − 비교 지수 1달 수익 (%p). 🇰🇷 코스피 · 나스닥 상장 종목은 나스닥 · 그 외 미국은 S&P500. 위 고정 바에 세 지수가 다 있음"],
    ["20일선 이격", "검증: '많이 달린 종목을 피하고 20일선 가까이서만 사기'는 미국에서 성과를 깎았음(연 32.6→24.0%). 매수!면 그냥 산다"],
    ["선까지 −N%", "지금 가격에서 트레일링선까지 떨어지면 잃는 폭. 앱 전체(찾기·차트·내 종목·텔레그램)가 같은 뜻으로 씀. '선 아래'면 이미 매도 구간"],
    ["3일·5일·1달", "누적 등락. 위 고정 바의 지수 숫자와 같은 열"],
    ["1회차 N주", "종목당 한도의 절반(1회차)으로 살 수 있는 주수. 0이면 '1주 한 번에'"],
    ["하루 거래 $5.2B", "최근 20거래일 평균 하루 거래대금"],
    ["RSI 62(3일↑)", "RSI(14일) 값과 3일 전보다 올랐는지(↑)·내렸는지(↓). 참고용 — 검증에서 '상승 중'은 효과 없음"],
    ["RS 100", "같은 시장 종목 중 최근 6개월 수익률 순위(백분위). 100이 1등, 70 이상 = 주도주"],
    ["목표까지 +22%", "내 목표가(차트에서 적음) 또는 🇺🇸 애널리스트 평균 목표가(애널)까지 남은 거리 = 목표 ÷ 현재가 − 1. 참고용 — 목표 도달은 매도 신호가 아님"],
    ["📝", "내가 적은 메모가 있는 종목"],
    ["강도 88", "RS 백분위와 200일선 거리 백분위의 평균(0~100). 매수! 중 무엇부터 살지 정하는 점수 — '강한 것 중 더 강한 것'. 규칙을 2010–18에서 정하고 2019–26에 적용해도 RS 순·업종 순보다 나았음"],
    ["전일 +2.7%", "직전 거래일 종가 대비 오늘(마지막) 종가"],
    ["업종 3위", "이 종목 업종의 섹터 ETF 순위 (미국만)"],
    ["매출 +16% 분기↑ · 흑자", "최근 분기 매출의 전년 동기 대비 (SEC 공시, ↑ = 직전 분기보다 성장 가속). 없으면 4분기 합계 → 연간. 미국만. 검증 불가라 조건이 아닌 취향 필터 — 한국·재무 없는 종목은 통과"],
    ["예비", "관찰용. rising = 추세 유지·RS 55~70·1달 시장대비 + / turn = 느린ST 초록 전환 3일 이내. 검증에서 현행을 못 이겨 매수!로 쓰지 않음"],
    ["○ 확인함", "누르면 회색으로 맨 아래. 그 주 동안 유지"],
    ["🆕 오늘 · N일째", "매수! 조건을 처음 만족한 뒤 며칠째인지 (실전 장부 기준). 20일 넘으면 표시 없음"],
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
const ROW_GUIDE = [
  ["1줄", "DELL Dell Technologies ↗ 🆕 오늘 ○ · $568.06 · 전일 −3.5% · ☆", "티커(한국은 이름) · 네이버 ↗ · 매수! 된 지 며칠째 · 확인함 ○ · 종가 · 전일 대비 · 관심 ☆"],
  ["2줄", "매수! (강세) · RS 100 · 1달 S&P比 +31p · +4.5% +0.1% +29.8%", "행동(근거) · 6개월 상대강도 순위 · 1달 수익 − 비교 지수 1달 수익 · 3일·5일·1달 누적(위 고정 바와 같은 열)"],
  ["3줄", "강도 88 · 선까지 −16% · 시총 $390B · 하루 거래 $5.2B · 1회차 1주 · RSI 62(3일↑) · 업종 기술 2위 · 매출 분기 전년比 +58% · 흑자",
          "강도 점수(RS+200일선) · 선에 닿으면 잃는 폭 · 시가총액 · 20일 평균 하루 거래대금 · 한도 절반으로 살 수 있는 주수 · RSI와 3일 전 대비 방향 · 섹터 ETF 점수 순위 · 최근 분기 매출의 전년 같은 분기 대비"],
];
const ExplainList = ({ items }) => (
  <Info label="▸ 표기 설명 · 행 읽는 법">
    <div style={{ marginBottom: 8, padding: "6px 8px", borderRadius: 7, background: "rgba(255,255,255,.04)" }}>
      {ROW_GUIDE.map(([k, ex, v]) => (
        <div key={k} style={{ marginBottom: 6 }}>
          <b style={{ color: C.gold }}>{k}</b> <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.text }}>{ex}</span>
          <div style={{ fontSize: 10.5, color: C.dim, marginTop: 1 }}>→ {v}</div>
        </div>))}
    </div>
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
function StockRow({ s, rank, rel, sub, onOpen, isWatch, onToggle, dip = false, held = false, seen = false, onSeen, age }) {
  const rs = s.rs;
  const gap = (s.stLine && s.c) ? (s.c / s.stLine - 1) * 100 : null;      // 트레일링선까지 거리
  return (
    <div onClick={() => onOpen(s.t)} style={{ padding: "9px 0", borderBottom: `1px solid ${C.border}`, cursor: "pointer", opacity: seen ? .45 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {rank != null && <span style={{ fontSize: FS.xs, color: C.muted, fontFamily: MONO, width: 16, flexShrink: 0, textAlign: "right" }}>{rank}</span>}
        <div style={{ flex: 1, minWidth: 0, ...ONE }}>
          {s.m === "kr"
            ? <><b style={{ fontSize: 15 }}>{s.n}</b><span style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}> {s.t}</span></>   // 한국은 이름이 알아보기 쉬움
            : <><b style={{ fontSize: 15, fontFamily: MONO }}>{s.t}</b><span style={{ fontSize: FS.xs, color: C.dim }}> {shortName(s.n)}</span></>}
          <InfoLink s={s} />
          {NOTES_REF.cur[s.t]?.m && <span title={NOTES_REF.cur[s.t].m} style={{ fontSize: 11 }}> 📝</span>}
        </div>
        {!dip && s.action === "buy" && age != null && <NewTag age={age} />}
        {onSeen && <button onClick={e => { e.stopPropagation(); onSeen(s.t); }} aria-label={seen ? "확인 취소" : "확인함"}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, width: 30, height: 34, color: seen ? C.emerald : C.muted, padding: 0 }}>{seen ? "✓" : "○"}</button>}
        <span style={{ fontSize: 14, fontWeight: 700, fontFamily: MONO, flexShrink: 0 }}>{price(s.c, s.m)}</span>
        <span style={{ textAlign: "right", flexShrink: 0, lineHeight: 1.05 }}>
          <span style={{ display: "block", fontSize: 9, color: C.muted }}>전일</span>
          <span style={{ fontSize: FS.xs, fontFamily: MONO, color: col(s.d1) }}>{pct(s.d1, 1)}</span></span>
        <Star on={isWatch} onClick={() => onToggle(s.t)} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, paddingLeft: rank != null ? 22 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1, overflow: "hidden" }}>
          {dip ? <DipTag s={s} /> : <ActionTag s={s} held={held} />}
          <span style={{ fontSize: FS.xs, color: (rs ?? 0) >= 70 ? C.cyan : C.muted, flexShrink: 0 }}>RS<b style={{ fontFamily: MONO }}>{rs != null ? Math.floor(rs) : "—"}</b></span>
          {rel != null && <span style={{ fontSize: FS.xs, color: rel >= 0 ? C.emerald : C.red, minWidth: 0, ...ONE }}>
            1달 {benchName(s)}比<b style={{ fontFamily: MONO }}>{rel >= 0 ? "+" : ""}{rel.toFixed(0)}p</b></span>}

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

const NASDAQ = new Set(["NMS", "NGM", "NCM", "NAS"]);
/** 75. 최신 아님 경고 — 상단 상태줄이 🟡 이상일 때 매수 쪽 화면에 */
const StaleWarn = ({ info, m }) => info ? (
  <div style={{ margin: "6px 0", padding: "7px 10px", borderRadius: 8, background: "rgba(245,158,11,.12)", border: `1px solid ${C.gold}66`,
                fontSize: FS.xs, color: C.gold, lineHeight: 1.5 }}>
    ⚠ 이 신호는 <b>{(m === "kr" ? info.kr : m === "us" ? info.us : (info.us || info.kr)) || "지난"} 종가</b> 기준입니다 — 최신 데이터가 아직 안 들어왔습니다({info.label}).
    주문 전에 📦 종목풀 → 🔄 시세 갱신을 누르거나 갱신될 때까지 기다리세요. 그사이 트레일링선 아래로 떨어졌을 수 있습니다.
  </div>) : null;

/** 74. 종목 메모·내 목표가 — 목표가는 참고용 (매도 신호 아님). 거리 = 목표 ÷ 현재가 − 1 */
const NOTE_KEY = "v12.notes";
const NOTES_REF = { cur: {} };     // 행 표시용 — App 이 그릴 때마다 최신으로 맞춤
const tgtOf = (t, notes, s) => { const my = notes?.[t]?.tg; return my ? { v: my, mine: true } : (s?.tgt?.a ? { v: s.tgt.a, mine: false } : null); };
const tgtGap = (tg, c) => (tg && c) ? (tg / c - 1) * 100 : null;

/** 62. 트레일링선 거리 — 앱 전체에서 한 가지 뜻: '선에 닿으면 잃는 폭'(%) 양수. 화면에는 "선까지 −17%" */
const lossOf = (s) => (s?.stLine && s?.c) ? (1 - s.stLine / s.c) * 100 : null;
const lossTxt = (s) => { const l = lossOf(s); return l == null ? "—" : l < 0 ? "선 아래" : `−${l.toFixed(0)}%`; };
const mktOfT = (t) => /^\d{6}$/.test(t) ? "kr" : "us";
/** 보유 평가 — 회차 합산 (시장 통화 그대로) */
const valueOf = (p, s) => trOf(p).reduce((a, t) => a + (t.amt || 0) / t.px * (s?.c ?? t.px), 0);
/** 설정이 바뀌면 알림 — 자동 동기화가 듣습니다 (61) */
const settingsChanged = () => { try { window.dispatchEvent(new Event("v11:settings")); } catch {} };

/** 54. 전체 투자금 — 앱 전체의 돈 기준. 비율로 DC·🇺🇸·🇰🇷·대기로 나누고, 칸 수로 종목당 한도를 정합니다 */
const PLAN_KEY = "v11.plan";
// 계좌별 금액을 넣고 합계·비율은 계산 — DC 잔액·예수금은 이미 정해진 금액이라서 (56)
const PLAN_DEFAULT = { dcAmt: 0, usAmt: 0, krAmt: 0, cashAmt: 0, slotsUs: 5, slotsKr: 3, hist: [] };
const loadPlan = () => {
  const raw = loadJSON(PLAN_KEY, {});
  if (raw.total && raw.dcAmt == null) {           // v11.0 의 '총액 + 비율' 저장값을 금액으로 한 번 바꿔 둡니다
    const a = (k) => Math.round(raw.total * (raw[k] || 0) / 100);
    return { ...PLAN_DEFAULT, dcAmt: a("dc"), krAmt: a("kr"), cashAmt: a("cash"), usKrwOld: a("us"), slotsUs: raw.slotsUs || 5, slotsKr: raw.slotsKr || 3 };
  }
  return { ...PLAN_DEFAULT, ...raw };
};
const planAmounts = (p, fx) => {
  if (!p) return null;
  const us = p.usAmt || (p.usKrwOld && fx ? p.usKrwOld / fx : 0);
  const usKrw = fx ? us * fx : 0;
  const total = (p.dcAmt || 0) + (p.krAmt || 0) + (p.cashAmt || 0) + usKrw;
  if (!total) return null;
  const pct = (v) => Math.round(v / total * 100);
  return { total, dc: p.dcAmt || 0, kr: p.krAmt || 0, us, usKrw, cash: p.cashAmt || 0,
           pct: { dc: pct(p.dcAmt || 0), us: pct(usKrw), kr: pct(p.krAmt || 0), cash: pct(p.cashAmt || 0) },
           limKr: p.slotsKr ? (p.krAmt || 0) / p.slotsKr : (p.krAmt || 0), limUs: p.slotsUs ? us / p.slotsUs : us };
};

/** 52. 시장 대비의 비교 대상 — 한국 = 코스피 · 나스닥 상장 = 나스닥 · 그 외 미국 = S&P500 (모두 1달) */
const benchName = (s) => s?.m === "kr" ? "코스피" : (NASDAQ.has(s?.ex) ? "나스닥" : "S&P");

/** 매출 성장 필터 — 앱 전체 공통 설정. 오늘 할 일·찾기·선정이 같은 개수를 보여주도록 한 곳에서 읽습니다
    (텔레그램도 같은 기본값 +10% 를 씁니다) */
const REV_KEY = "v9.revMin";
const getRevMin = () => { try { const v = localStorage.getItem(REV_KEY); return v == null ? 10 : Number(v); } catch { return 10; } };
const growthOf = (s) => s?.fin ? (s.fin.growth ?? s.fin.qyoy ?? s.fin.ttm ?? s.fin.rev ?? null) : null;   // 최근 분기 → 4분기 → 연간
const passRevOf = (s, revMin) => { const g = growthOf(s); return revMin <= 0 || s.m === "kr" || g == null || g >= revMin; };

/** 33·38. 종목 정보 외부 링크 — 전부 네이버 (🇰🇷 국내 · 🇺🇸 나스닥은 해외주식 페이지, 뉴욕은 네이버 검색) */
const infoUrl = (s) => {
  if (!s) return "#";
  if (s.m === "kr") return `https://m.stock.naver.com/domestic/stock/${s.t}/total`;
  if (NASDAQ.has(s.ex)) return `https://m.stock.naver.com/worldstock/stock/${s.t}.O/total`;     // 네이버 해외주식 (나스닥 = .O)
  return `https://m.search.naver.com/search.naver?query=${encodeURIComponent(s.t + " 주가")}`;     // 뉴욕 등은 네이버 검색 카드
};
const InfoLink = ({ s, style }) => (
  <a href={infoUrl(s)} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} aria-label="종목 정보 열기"
     style={{ color: C.muted, textDecoration: "none", fontSize: 13, padding: "0 4px", flexShrink: 0, ...style }}>↗</a>
);
/** 34. 티커 복사 — MTS 관심그룹 일괄 등록용 */
function CopyBtn({ tickers, label = "티커 복사" }) {
  const [ok, setOk] = useState(false);
  const run = async (e) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(tickers.join("\n")); setOk(true); setTimeout(() => setOk(false), 1500); }
    catch { prompt("복사해서 쓰세요", tickers.join(", ")); }
  };
  return <button onClick={run} style={{ ...linkBtn, fontSize: FS.xs, minHeight: 32 }}>{ok ? "복사됨 ✓" : `📋 ${label} ${tickers.length}`}</button>;
}

/** 셋째 줄 참고 정보 — 거래 · 매수 주수 · RSI · 업종 순위 · 재무 */
function subLine(s, sizer, market, extra = []) {
  const sh = sizer?.shares(s.c, s.m);
  const secRank = s.sec && (market?.sectors || []).find(x => x.tk === s.sec);
  const f = s.fin;
  return [
    s.str != null ? `강도 ${s.str}` : null,                                  // RS + 200일선 거리 (0~100)
    s.stSlow === 1 && lossOf(s) != null ? `선까지 ${lossTxt(s)}` : null,     // 지금 사면 선에 닿을 때 잃는 폭
    s.mcap ? `시총 ${s.m === "kr" ? (s.mcap >= 10000 ? `${(s.mcap / 10000).toFixed(1)}조` : `${s.mcap.toLocaleString()}억`) : `$${s.mcap >= 1e12 ? (s.mcap / 1e12).toFixed(1) + "T" : (s.mcap / 1e9).toFixed(0) + "B"}`}` : null,
    `하루 거래 ${money(s.tv, s.m)}`,
    (() => { const tg = tgtOf(s.t, NOTES_REF.cur, s); const g = tg && tgtGap(tg.v, s.c);
             return g == null ? null : g <= 0 ? `목표 도달${tg.mine ? "" : "(애널)"}` : `목표까지 +${g.toFixed(0)}%${tg.mine ? "" : "(애널)"}`; })(),
    sh > 0 ? `1회차 ${sh}주` : null,
    s.rsi != null ? `RSI ${s.rsi.toFixed(0)}(3일${s.rsiUp ? "↑" : "↓"})` : null,
    secRank ? `업종 ${secRank.label} ${secRank.rank}위` : null,
    f ? [
      f.qyoy != null ? `매출 분기 전년比 ${f.qyoy >= 0 ? "+" : ""}${f.qyoy.toFixed(0)}%${f.accel ? " 가속" : ""}`
        : f.ttm != null ? `매출 4분기 전년比 ${f.ttm >= 0 ? "+" : ""}${f.ttm.toFixed(0)}%`
        : f.rev != null ? `매출 연간 전년比 ${f.rev >= 0 ? "+" : ""}${f.rev.toFixed(0)}%` : null,
      f.prof === false ? "적자" : f.prof ? "흑자" : null].filter(Boolean).join(" ") : null,
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
  const [today, setToday] = useState(null);     // 파이프라인이 확정한 오늘 후보 (앱·텔레그램·AI 도구가 같은 것을 봄)
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
    fetch("/data/today.json?t=" + Date.now()).then(r => r.ok ? r.json() : null).then(setToday).catch(() => {});
  }, []);
  useEffect(() => {
    fetch("/data/signals_log.json?t=" + Date.now()).then(r => r.ok ? r.json() : null).then(setSiglog).catch(() => {});
  }, []);
  useEffect(() => {
    fetch("/data/universe_log.json?t=" + Date.now())
      .then(r => r.ok ? r.json() : null).then(setUni).catch(() => {});
  }, []);
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

  // 파이프라인이 action 을 안 준 데이터(구버전)면 같은 규칙으로 앱이 채웁니다 — 빈 화면 방지
  const rawStocks = useMemo(() => {
    const src = snap?.stocks || {};
    const first = Object.values(src)[0];
    if (!first || "action" in first) return src;
    const out = {};
    for (const [t, d] of Object.entries(src)) {
      const rsOk = (d.rs ?? 0) >= 70;
      const up = d.stSlow === 1 && rsOk && (d.ma200p ?? -1) > 0;
      const strong = up && d.m === "us" && (d.rsi ?? 0) >= 60;
      const trend3 = d.st === 3 && d.cloud === 1 && rsOk;
      const action = d.stSlow === 0 ? "sell" : (d.m === "kr" && d.pull) ? "buy" : strong ? "buy" : trend3 ? "buy" : "watch";
      const why = action === "sell" ? "st" : action === "buy" ? ((d.m === "kr" && d.pull) ? "pull" : strong ? "strong" : "trend") : null;
      const dip = (d.w52p != null && d.hlt != null && d.w52p <= -25 && d.hlt >= 0.6)
        ? ((d.ma200p ?? 0) < -50 ? "broken" : ((d.ma20p ?? 0) > 0 || (d.c > 0 && d.ma200p != null && d.d21 > 0)) ? "watch" : "wait") : null;
      out[t] = { ...d, action, why, dip, strong, trend3, _legacy: true };
    }
    return out;
  }, [snap]);
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
    const fx = market?.fx?.usdkrw || null;
    const pa = planAmounts(loadPlan(), fx);      // 전체 투자금이 있으면 그걸로 계산
    const capKr = pa ? pa.kr : g("v9.cap.kr", 20000000), capUs = pa?.us ?? g("v9.cap.us", 5000);
    const limKr = pa ? pa.limKr : g("v9.lim.kr", 20000000), limUs = pa?.limUs ?? g("v9.lim.us", 1000);
    const limit = (m) => (m === "us" ? limUs : limKr);
    const cap = (m) => (m === "us" ? capUs : capKr);
    return {
      capKr, capUs, limKr, limUs, fx, limit, cap, plan: pa,
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

  // ★ 빈 기기 보호 — 이 기기 기록이 비어 있고 서버에 있으면 서버 것을 불러옵니다 (다른 폰·PC·브라우저에서 처음 열 때)
  const [restored, setRestored] = useState(null);
  useEffect(() => { if (!restored) return; const id = setTimeout(() => setRestored(null), 6000); return () => clearTimeout(id); }, [restored]);   // 6초 뒤 저절로 닫힘
  useEffect(() => { if (!restored) return; const t = setTimeout(() => setRestored(null), 6000); return () => clearTimeout(t); }, [restored]);   // 6초 뒤 저절로 닫힘
  const [syncReady, setSyncReady] = useState(false);
  useEffect(() => {
    const emptyHere = (pos || []).length === 0 && (watch || []).length === 0;
    fetch("/data/watchlist.json?t=" + Date.now()).then(r => r.ok ? r.json() : null).then(w => {
      const sp = w?.positions || [], sw = w?.watch || [];
      if (emptyHere && (sp.length || sw.length)) {
        const ps = sp.map((p, i) => ({ id: Date.now() + i, t: p.t, role: p.role || "swing", date: p.date || (p.tr?.[0]?.d) || "",
                                       ...(p.tr?.length ? { tr: p.tr } : { avg: p.avg }) }));
        setPos(ps); setWatch(sw);
        if (Array.isArray(w.extras)) setExtras(w.extras);
        if (w.notes) { setNotes(w.notes); try { localStorage.setItem(NOTE_KEY, JSON.stringify(w.notes)); } catch {} }
        setRestored({ n: ps.length, w: sw.length });
      }
    }).catch(() => {}).finally(() => setSyncReady(true));
  }, []);   // eslint-disable-line

  // ★ 60·61. 자동 동기화 — 바뀐 게 있으면 3초 뒤 서버(watchlist.json)에 올립니다. 텔레그램·장중 감시·오늘 후보가 같은 값을 씁니다
  useEffect(() => {
    const plan = loadPlan();
    const body = { bulk: true, positions: pos, watch, extras, excludes: loadJSON("v10.excludes", []), trades: (trades || []).slice(-100), notes,
                   settings: { revMin: getRevMin(), slotsUs: plan.slotsUs || 5, slotsKr: plan.slotsKr || 3,
                               dcAmt: plan.dcAmt || 0, dcMode: localStorage.getItem("v9.dc.mode") || "st", dcSemi: localStorage.getItem("v9.dc.semi") === "1" } };
    const key = JSON.stringify(body);
    if (!syncReady) return;                                            // 서버 확인이 끝나기 전엔 올리지 않음
    if ((pos || []).length === 0 && (watch || []).length === 0) return;   // 빈 상태는 자동으로 올리지 않음 (수동 '다시 보내기'만)
    if (key === localStorage.getItem("v11.syncKey")) return;
    const tm = setTimeout(async () => {
      try {
        const r = await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json", "x-key": localStorage.getItem("v52.rkey") || "" }, body: key });
        const j = await r.json().catch(() => ({}));
        const at = new Date().toISOString().slice(0, 16).replace("T", " ");
        if (j.ok) { localStorage.setItem("v11.syncKey", key); localStorage.setItem("v7.sync.at", at); setSyncState({ at, ok: true }); }
        else setSyncState(s => ({ ...s, ok: false, msg: j.message || j.error || `실패 (${r.status})` }));
      } catch { setSyncState(s => ({ ...s, ok: false, msg: "네트워크 오류" })); }
    }, 3000);
    return () => clearTimeout(tm);
  }, [pos, watch, extras, trades, cfgTick, notes, syncReady]);

  if (err) return <Shell><Card style={{ borderColor: C.red, margin: "40px 12px" }}>
    <div style={{ color: C.red, fontWeight: 800, fontSize: FS.lg }}>데이터를 불러오지 못했습니다</div>
    <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 6 }}>{err}</div>
    <div style={{ fontSize: FS.sm, color: C.muted, marginTop: 8 }}>Actions → Daily Data Update 를 실행하세요.</div>
  </Card></Shell>;

  if (!snap || !market) return <Shell><div style={{ textAlign: "center", color: C.muted, marginTop: 80, fontSize: FS.md }}>불러오는 중…</div></Shell>;

  NOTES_REF.cur = notes;
  const staleInfo = fr.tone === "lag" || fr.tone === "stale" || fr.tone === "old" || fr.tone === "bad"
    ? { label: fr.label, us: asOfBy.us, kr: asOfBy.kr } : null;       // 75. 주문 전에 보여줄 '최신 아님' 정보
  const shared = { stocks, list, etfs, items, openStock, watch, toggleWatch, market, setTab, setSel, pos, setPos, syncState, staleInfo, notes, setNote,
                   seen, sizer, bumpSizer, extras, setExtras, trades, setTrades, siglog, today };
  const nTrack = pos.length + watch.length;
  const warn = fr.tone === "stale" || fr.tone === "old" || fr.tone === "bad";

  return (
    <Shell>
      {rulesOpen && snap && <RulesPopup onClose={closeRules} sizer={sizer} />}
      {restored && (
        <div onClick={() => setRestored(null)} style={{ position: "fixed", left: 12, right: 12, bottom: 84, zIndex: 120, padding: "10px 12px", borderRadius: 10,
                                                        background: "rgba(16,185,129,.95)", color: "#04120c", fontSize: FS.sm, fontWeight: 700 }}>
          이 기기에 기록이 없어 서버에 저장된 보유 {restored.n} · 관심 {restored.w}을 불러왔습니다
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
        {tab === "review" && <ReviewTab {...shared} uni={uni} snap={snap} onShowRules={() => setRulesOpen(true)} />}
        {tab === "pool" && <PoolTab {...shared} snap={snap} uni={uni} />}
        {tab === "track" && <TrackTab {...shared} stocks={items} />}
      </main>

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

/* 내 원칙 — 하루 한 번 앱을 열 때 먼저 뜹니다 */
/** 원칙 목록 — 4번은 앱에 구현된 매수·매도 규칙과 추적탭 설정값을 그대로 읽어 씁니다 */
const myRules = (sz) => [
  ["앱이 '매수!'라고 쓴 종목만 산다", "🇰🇷 눌림(RSI 45 회복) · 🇺🇸 강세(RSI 60↑) · 추세(ST 3개 초록+구름 위). 뉴스·테마·감으로 사지 않는다"],
  [`절반 → 1회차 +3% 확인 후 나머지 절반 · +6% 넘게 올랐으면 추격 금지`,
   `종목당 한도 🇰🇷 ${sz ? money(sz.limKr, "kr") : "—"} · 🇺🇸 ${sz ? money(sz.limUs, "us") : "—"} · 고가 종목은 1주 한 번에`],
  ["매도는 '매도!' 하나 — 트레일링선 아래 마감. 그날 처리한다", "−3% 손절·고점 −5%·2주 타임컷은 검증에서 성과를 깎아 쓰지 않는다. 매도를 미루면 매수 타이밍 차이보다 비싸다"],
  ["🇰🇷는 쉬어도 된다 · 🇺🇸는 22:30 개장에 주문", "원화 노출은 부동산으로 충분. 한국을 한다면 09:30 이후에만"],
  ["이벤트 매매 금지 · 몰빵 금지 · 적자 추격 금지 · 급락 탭은 소액만", "같은 업종에 두 칸 이상 넣지 않는다. 급락은 참고용(주도주 보유를 못 이김)"],
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
          2번 한도는 내 종목 탭 설정을 그대로 씁니다. 다섯 개 모두 2008–26 검증과 이 대화에서 확정한 규칙입니다.
        </div>
        <button onClick={onClose} disabled={!all}
          style={{ ...btn(all ? C.emerald : C.dim), width: "100%", marginTop: 12, opacity: all ? 1 : .5, minHeight: 44 }}>
          {all ? "확인했습니다 · 시작" : `${ack.length}/5 확인`}</button>
      </div>
    </div>);
}

/* ══════════════ 1. 시장 ══════════════ */
/** 폭 추이 미니 차트 — 판정 줄 오른쪽. 점선 = 3년 백분위 40 근처(위험 경계) */
function Spark({ b, c }) {
  const hist = b?.hist || [];
  if (hist.length < 5) return <span />;
  const W = 84, H = 30, ys = hist.map(r => r[1]);
  const lo = Math.min(...ys), hi = Math.max(...ys), sp = Math.max(hi - lo, 1);
  const d = hist.map((r, i) => `${i ? "L" : "M"}${(i / (hist.length - 1) * W).toFixed(1)},${(H - 2 - (r[1] - lo) / sp * (H - 4)).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: H, display: "block" }} aria-label="폭 추이">
      <path d={d} fill="none" stroke={c} strokeWidth="1.5" />
      <circle cx={W} cy={H - 2 - (ys[ys.length - 1] - lo) / sp * (H - 4)} r="2.5" fill={c} />
    </svg>);
}
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

function MyHoldings({ pos, stocks, sizer, setTab, openStock }) {
  const ps = (pos || []).filter(p => p.role !== "etf").sort((a, b) => (mktOfT(a.t) === "us" ? 0 : 1) - (mktOfT(b.t) === "us" ? 0 : 1));
  if (!ps.length) return null;
  return (
    <>
      <Sec right={<button onClick={() => setTab("track")} style={{ ...linkBtn, minHeight: 30, fontSize: FS.xs }}>내 종목 ›</button>}>내 종목</Sec>
      <Card style={{ padding: "8px 12px" }}>
        <HoldTotals pos={pos} stocks={stocks} fx={sizer?.fx} />
        {ps.map((p, i) => {
          const s = stocks[p.t]; const m = mktOfT(p.t);
          if (!s) return <div key={p.id} style={{ fontSize: FS.sm, padding: "6px 0", color: C.gold }}>⚠ {p.t} 데이터 없음 — 거래정지·상장폐지 확인</div>;
          const pl = (s.c / avgOf(p) - 1) * 100;
          const nx = p.role === "swing" ? nextTrancheOf(p, s, sizer.limit(m)) : null;
          const st = actionOf(s, true) === "sell" && p.role !== "long" ? ["매도!", C.red] : nx?.ok ? ["2회차", C.emerald] : ["보유", C.cyan];
          return (
            <div key={p.id} onClick={() => openStock(p.t)} style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr) 62px 62px", gap: 6, alignItems: "center",
                                                                 padding: "7px 0", borderTop: `1px solid ${C.border}`, cursor: "pointer" }}>
              <span style={{ fontSize: FS.sm, fontWeight: 800, color: st[1] }}>{st[0]}</span>
              <span style={{ minWidth: 0, fontSize: FS.sm, ...ONE }}>{m === "us" ? "🇺🇸 " : "🇰🇷 "}{m === "kr" ? <b>{s.n}</b> : <b style={{ fontFamily: MONO }}>{p.t}</b>}</span>
              <span style={{ textAlign: "right", lineHeight: 1.1 }}><span style={{ display: "block", fontSize: 9, color: C.muted }}>평단 대비</span>
                <b style={{ fontSize: FS.sm, fontFamily: MONO, color: col(pl) }}>{pct(pl, 1)}</b></span>
              <span style={{ textAlign: "right", lineHeight: 1.1 }}><span style={{ display: "block", fontSize: 9, color: C.muted }}>선까지</span>
                <b style={{ fontSize: FS.sm, fontFamily: MONO, color: s.stSlow === 1 ? C.dim : C.red }}>{lossTxt(s)}</b></span>
            </div>);
        })}
      </Card>
    </>);
}

function MarketTab({ market, setTab, onShowRules, list, pos, stocks, sizer, openStock }) {
  const J = { safe: ["🟢 안전", C.emerald], warn: ["🟡 주의", C.gold], risk: ["🔴 위험", C.red] };
  const idxRows = Object.entries(market.indices || {});
  const risk = market.risk || {};
  const spy21 = market.indices?.["^GSPC"]?.d21 ?? null;
  const sectors = market.sectors || [];
  const [hoursOpen, setHoursOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useSticky("v13.market.detail", false);   // 85. 지수·위험·섹터 접기
  // 오늘 할 일 — 순서가 곧 루틴: ① 내 종목 매도 신호 ② 새 신호 ③ DC 상태
  const sellN = (pos || []).filter(p => p.role !== "long" && stocks[p.t]?.action === "sell").length;
  const t2N = (pos || []).filter(p => p.role === "swing" && nextTrancheOf(p, stocks[p.t], sizer.limit(stocks[p.t]?.m || "kr"))?.ok).length;
  const revMin = getRevMin();
  const buyAll = list.filter(x => x.action === "buy" && (x.tvr ?? 0) >= 40);
  const buyL = buyAll.filter(x => passRevOf(x, revMin));
  const buyN = buyL.length, buyCut = buyAll.length - buyL.length;
  const buyKr = buyL.filter(x => x.m === "kr").length;
  const dcWait = (market.dc?.core || []).filter(c => c.state === "wait").length;
  const S = sessions(Date.now());
  const kst = new Date(Date.now() + 9 * 3600000), mins = kst.getUTCHours() * 60 + kst.getUTCMinutes(), wd = kst.getUTCDay() >= 1 && kst.getUTCDay() <= 5;
  const nowSeg = wd && ([...S.kr.map(x => ["🇰🇷 " + x[0], x[1], x[2]]), ...S.us.map(x => ["🇺🇸 " + x[0], x[1], x[2]])].find(([, a, b]) => inSpan(mins, a, b)) || null);
  return (
    <>
      {sizer?.plan && (
        <div onClick={() => setTab("track")} style={{ marginTop: 8, padding: "8px 12px", borderRadius: 10, background: C.card, border: `1px solid ${C.border}`,
                                                       display: "flex", gap: 10, alignItems: "baseline", cursor: "pointer", fontSize: FS.xs, color: C.dim, ...ONE }}>
          <b style={{ fontSize: FS.md, color: C.text, fontFamily: MONO }}>💰 {money(sizer.plan.total, "kr")}</b>
          <span>DC {money(sizer.plan.dc, "kr")}</span><span>🇺🇸 {sizer.plan.us != null ? money(sizer.plan.us, "us") : "—"}</span>
          <span>🇰🇷 {money(sizer.plan.kr, "kr")}</span><span>대기 {money(sizer.plan.cash, "kr")}</span>
        </div>)}
      {/* 원칙 — 한 줄. 누르면 팝업 */}
      <button onClick={onShowRules} style={{ ...btn(C.gold), width: "100%", marginTop: 8, textAlign: "left", display: "flex", gap: 8 }}>
        <span>📌 이번 주 원칙 5개</span><span style={{ marginLeft: "auto", fontWeight: 400, color: C.dim }}>확인함 ✓ · 다시 보기 ›</span>
      </button>

      <Sec right={<span style={{ fontSize: 10.5, color: C.muted }}>폭 = 200일선 위 종목 비율</span>}>시장 상태</Sec>
      <Card style={{ padding: "2px 12px" }}>
        {["kr", "us"].map((m, i) => {
          const j = market.judge?.[m]; if (!j || !J[j.verdict]) return null;
          const [t, c] = J[j.verdict]; const b = market.breadth?.[m];
          return (
            <div key={m} style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) 84px", gap: 10, alignItems: "center",
                                  padding: "10px 0", borderTop: i ? `1px solid ${C.border}` : "none" }}>
              <div style={{ textAlign: "center", minWidth: 56 }}>
                <div style={{ fontSize: FS.xs, color: C.dim }}>{m === "us" ? "🇺🇸 미국" : "🇰🇷 한국"}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: c, whiteSpace: "nowrap" }}>{t.replace(/^\S+\s/, "")}</div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: FS.sm, fontWeight: 700, ...ONE }}>
                  {b?.v != null && <>폭 <span style={{ fontFamily: MONO, color: c }}>{b.v.toFixed(0)}%</span> · 3년 {b.pct >= 50 ? `상위 ${Math.round(100 - b.pct)}%` : `하위 ${Math.round(b.pct)}%`}</>}
                </div>
                <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 2, ...ONE }}>{j.why.replace(/\s*\(.*\)\s*$/, "")}</div>
                <div style={{ fontSize: 10.5, color: j.gate ? C.cyan : C.muted, marginTop: 1 }}>{j.gate ? "DC 판단에만 사용" : "참고"}</div>
              </div>
              <Spark b={b} c={c} />
            </div>);
        })}
      </Card>
      <MyHoldings pos={pos} stocks={stocks} sizer={sizer} setTab={setTab} openStock={openStock} />
      {/* 오늘 할 일 — 이 순서대로 탭을 넘기면 됩니다 */}
      <Sec>오늘 할 일</Sec>
      <Card style={{ padding: "4px 12px" }}>
        {[
          ["1", `매도! ${sellN}건`, sellN ? "내 종목 — 지금 처리" : "없음", "track", sellN ? C.red : C.muted],
          ["2", `2회차 조건 도달 ${t2N}건`, t2N ? "1회차 +3% 넘음 — 나머지 절반" : "없음", "track", t2N ? C.emerald : C.muted],
          ["3", `매수! ${buyN}건 (🇰🇷 ${buyKr} · 🇺🇸 ${buyN - buyKr})`, buyN ? `찾기에서 고르기${buyCut ? ` · 매출 부진 ${buyCut} 숨김` : ""}` : "오늘은 없음", "find", buyN ? C.emerald : C.muted],
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

      {!detailOpen && risk["^TNX"] && risk["^TNX"].c >= 5 && (risk["^TNX"].d21p ?? 0) > 0 && (
        <div style={{ marginTop: 10, padding: "7px 10px", borderRadius: 9, background: "rgba(245,158,11,.10)", border: `1px solid ${C.gold}55`, fontSize: FS.xs, color: C.dim }}>
          <b style={{ color: C.gold }}>⚠ 금리 경계</b> — 미 10년물 {Number(risk["^TNX"].c).toFixed(2)}% · 1달 +{Number(risk["^TNX"].d21p).toFixed(2)}%p · 정보용(매매 규칙 아님) · 아래 펼쳐서 자세히
        </div>)}
      <button onClick={() => setDetailOpen(v => !v)} style={{ ...btn(C.dim), width: "100%", marginTop: 10, display: "flex" }}>
        <span>시장 자세히 — 지수 · 위험 지표 · 섹터</span><span style={{ marginLeft: "auto", fontWeight: 400, color: C.muted }}>{detailOpen ? "접기 ▴" : "펼치기 ▾"}</span>
      </button>
      {detailOpen && <>
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

      <Sec right={<span style={{ fontSize: 10.5, color: C.muted }}>미국 · 종가 기준</span>}>위험 지표</Sec>
      {risk["^TNX"] && risk["^TNX"].c >= 5 && (risk["^TNX"].d21p ?? 0) > 0 && (
        <div style={{ marginBottom: 6, padding: "8px 10px", borderRadius: 9, background: "rgba(245,158,11,.10)", border: `1px solid ${C.gold}55`, fontSize: FS.xs, color: C.dim, lineHeight: 1.6 }}>
          <b style={{ color: C.gold }}>⚠ 금리 경계</b> — 미 10년물 {Number(risk["^TNX"].c).toFixed(2)}% · 1달 {risk["^TNX"].d21p >= 0 ? "+" : ""}{Number(risk["^TNX"].d21p).toFixed(2)}%p.
          성장주(나스닥)가 금리에 더 민감합니다. <b style={{ color: C.text }}>정보용 — 매매 규칙 아님</b>: 1999~2026 검증에서 금리 방향은 이후 수익과 거의 무관했고, 5% 이상 구간의 부진은 대부분 2000~02년 닷컴 붕괴 한 번이었습니다.
          DC는 안전자산 30% 몫이 지켜지고 있는지만 확인하세요.
        </div>)}
      <Card style={{ padding: "10px 8px", display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
        {[["^VIX", "VIX", "", v => v.c < 22 ? ["안정", C.emerald] : v.c < 30 ? ["주의", C.gold] : ["위험", C.red]],
          ["curve", "10년−3개월", "%p", v => v.c > 0 ? ["정상", C.emerald] : ["역전·침체 경고", C.red]],
          ["^TNX", "미 10년물", "%", v => [`1달 ${v.d21p >= 0 ? "+" : ""}${Number(v.d21p).toFixed(2)}%p`, v.c >= 5 && v.d21p > 0 ? C.gold : C.muted]],
          ["^IRX", "미 3개월물", "%", v => [`1달 ${v.d21p >= 0 ? "+" : ""}${Number(v.d21p).toFixed(2)}%p`, C.muted]],
        ].map(([k, label, unit, f], i) => { const v = risk[k]; if (!v) return <div key={k} />; const [st, c] = f(v);
          return (<div key={k} style={{ textAlign: "center", borderLeft: i ? `1px solid ${C.border}` : "none", minWidth: 0, padding: "0 2px" }}>
            <div style={{ fontSize: 10.5, color: C.dim, ...ONE }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, fontFamily: MONO, ...ONE }}>{Number(v.c).toFixed(k === "^VIX" ? 1 : 2)}<span style={{ fontSize: 10, color: C.muted }}>{unit}</span></div>
            <div style={{ fontSize: 10.5, color: c, ...ONE }}>{st}</div>
          </div>); })}
      </Card>

      <Sec right={<Grade k="weak" />}>미국 섹터 순위</Sec>
      <Card style={{ padding: "2px 12px 6px" }}>
        <Head cols={["#", "섹터 · S&P比 1달", "3일", "5일", "1달", "점수"]} grid={SEC_GRID} />
        {sectors.map(s => (
          <div key={s.tk} style={{ display: "grid", gridTemplateColumns: SEC_GRID, gap: 5, alignItems: "center",
                                   padding: "8px 0", borderTop: `1px solid ${C.border}` }}>
            <span style={{ fontSize: FS.sm, color: C.muted }}>{s.rank}</span>
            {(() => {   // S&P比 = 섹터 1달 − S&P500 1달 — 이름 옆 한 줄
              const r = (s.d21 == null || spy21 == null) ? null : s.d21 - spy21;
              return (
                <span style={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 4 }}>
                  <b style={{ ...FIT_NAME, minWidth: 0, ...ONE }}>{s.label}</b>
                  {r != null && <span style={{ fontSize: 10.5, fontFamily: MONO, color: r >= 0 ? C.emerald : C.red, flexShrink: 0 }}>{r >= 0 ? "+" : ""}{r.toFixed(1)}p</span>}
                </span>);
            })()}
            {["d3", "d5", "d21"].map(x =>
              <span key={x} style={{ ...FIT, textAlign: "right", color: col(s[x]) }}>{pctFit(s[x])}</span>)}
            <span style={{ ...FIT, textAlign: "right", fontWeight: 700, color: col(s.score) }}>{pctFit(s.score)}</span>
          </div>))}
        <div style={{ fontSize: FS.xs, color: C.muted, padding: "7px 0 2px" }}>
          이름 옆 숫자 = S&P500 대비 1달 %p · 점수 = 3·6·9·12개월 평균 · 섹터를 갈아타는 방식은 지수 보유와 차이가 없었습니다
          <button onClick={() => setTab("alloc")} style={{ ...linkBtn, fontSize: FS.sm, minHeight: 36, display: "block" }}>국내 ETF로 보기 ›</button>
        </div>
      </Card>
      </>}

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

function DcTab({ etfs, market, pos, setPos, openStock, sizer }) {
  const dc = market.dc;
  const [total0, setTotal] = useState(() => Number(localStorage.getItem("v6.dc.total")) || 100000000);
  const total = sizer?.plan?.dc || total0;          // 💰 전체 투자금이 있으면 그 DC 몫
  const [showRef, setShowRef] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);                 // 84. 규칙 설명 접기
  const [split, setSplit] = useState(() => Number(localStorage.getItem("v6.dc.split")) || 3);
  const [done, setDone] = useState(() => loadJSON("v6.dc.done", { us: [], kr: [] }));
  const [moreUs, setMoreUs] = useState(false);
  const [moreKr, setMoreKr] = useState(false);
  const [mode, setMode] = useState(() => localStorage.getItem("v9.dc.mode") || "st");      // st=현행(느린ST) · dual=듀얼 모멘텀
  const [semiOn, setSemiOn] = useState(() => localStorage.getItem("v9.dc.semi") === "1");
  useEffect(() => { localStorage.setItem("v9.dc.mode", mode); settingsChanged(); }, [mode]);
  useEffect(() => { localStorage.setItem("v9.dc.semi", semiOn ? "1" : "0"); settingsChanged(); }, [semiOn]);
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
      {/* 84. 규칙 설명은 한 줄 요약만 두고 나머지는 접어, '이번 달 보유 목표'가 먼저 보이게 */}
      <div style={{ fontSize: FS.xs, color: C.muted, margin: "6px 2px 0", display: "flex", gap: 6, alignItems: "baseline" }}>
        <span>{mode === "st" ? "낙폭 −10% 넘으면 대기" : "매월 1거래일 상위 2개 반반"}</span>
        <button onClick={() => setRuleOpen(v => !v)} style={{ ...linkBtn, fontSize: FS.xs, minHeight: 36, padding: "0 8px", marginLeft: "auto" }}>{ruleOpen ? "접기" : "규칙 자세히"}</button>
      </div>
      {ruleOpen && (
        <div style={{ fontSize: FS.xs, color: C.muted, margin: "2px 2px 0" }}>
          {mode === "st" ? "S&P500 35% + 코스피200 35%, 느린ST 초록일 때만 보유 · 검증 연 +7.2% · MDD −10% · 샤프 1.04"
                         : "나스닥100·S&P500·코스피200 중 3·6·12개월 평균 상위 2개 반반 · 검증 연 +12.5% · MDD −20% · 샤프 0.92"}
        </div>)}
      {mode === "dual" && dc.dual && (() => {
        const semiShare = semiOn && dc.semi ? dc.semi.share : 0;
        const riskW = 0.70 - semiShare;
        const hold = dc.dual.cands.filter(c => dc.dual.hold.includes(c.sig));
        const safeW = 1 - riskW * hold.length / 2 - (semiOn && dc.semi?.state === "hold" ? semiShare : 0);
        return (<>
          {/* 53. 이번 달 할 일 — 코드와 금액 한 줄 */}
          <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(6,182,212,.08)", border: `1px solid ${C.cyan}44` }}>
            <div style={{ fontSize: FS.xs, color: C.cyan, fontWeight: 800 }}>이번 달 보유 목표 · 총 {money(total, "kr")}</div>
            <div style={{ display: "grid", gap: 3, marginTop: 5 }}>
              {hold.map(c => (
                <div key={c.sig} style={{ display: "flex", gap: 6, fontSize: FS.sm }}>
                  <b style={{ fontFamily: MONO, color: C.cyan }}>{c.buy?.code || "—"}</b><span style={{ color: C.dim, minWidth: 0, ...ONE }}>{c.buy?.name || c.label}</span>
                  <b style={{ marginLeft: "auto", fontFamily: MONO }}>{money(total * riskW / 2, "kr")}</b></div>))}
              {semiOn && dc.semi?.state === "hold" && (
                <div style={{ display: "flex", gap: 6, fontSize: FS.sm }}>
                  <b style={{ fontFamily: MONO, color: C.cyan }}>{dc.semi.buy?.code}</b><span style={{ color: C.dim, minWidth: 0, ...ONE }}>반도체 고정 칸</span>
                  <b style={{ marginLeft: "auto", fontFamily: MONO }}>{money(total * semiShare, "kr")}</b></div>)}
              <div style={{ display: "flex", gap: 6, fontSize: FS.sm }}>
                <b>안전자산</b><span style={{ color: C.dim }}>TDF·채권혼합·예금</span>
                <b style={{ marginLeft: "auto", fontFamily: MONO }}>{money(total * safeW, "kr")}</b></div>
            </div>
          </div>
          <Sec right={<span style={{ fontSize: 10.5, color: C.muted }}>점수 = 3·6·12달 평균 수익</span>}>이번 달 보유 (듀얼 모멘텀)</Sec>
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
              <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>
                {dc.semi.buy?.code ? <><b style={{ fontFamily: MONO, color: C.cyan }}>{dc.semi.buy.code}</b> {dc.semi.buy.name}</> : "SMH"}<br />{dc.semi.state === "hold" ? <b style={{ color: C.emerald }}>보유 가능 — 느린ST 초록</b> : <b style={{ color: C.gold }}>대기 — 느린ST 빨강 → 안전자산</b>}
              </div>
            </div>
            <Toggle on={semiOn} onClick={() => setSemiOn(v => !v)}>{semiOn ? "켜짐 ✓" : "켜기"}</Toggle>
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
          {sizer?.plan ? <span style={{ fontSize: 15, fontWeight: 800, fontFamily: MONO }}>{money(total, "kr")}</span>
            : <input type="number" inputMode="numeric" value={total0} onChange={e => setTotal(Number(e.target.value) || 0)} style={{ ...inp("100%"), flex: 1 }} />}
        </label>
        <div style={{ fontSize: FS.xs, color: C.muted, margin: "4px 0 0 72px" }}>{sizer?.plan ? "💰 전체 투자금에서 자동 · 내 종목 탭에서 변경" : money(total, "kr")}</div>
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

      <button onClick={() => setShowRef(v => !v)} style={{ ...btn(C.dim), width: "100%", marginTop: 14, textAlign: "left", display: "flex" }}>
        <span>참고: 섹터·업종 ETF</span><span style={{ marginLeft: "auto", fontWeight: 400, color: C.muted }}>배분하지 않음 · 검증에서 지수 보유와 차이 없음 {showRef ? "▴" : "▾"}</span>
      </button>
      {showRef && <>
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
      </>}
    </>
  );
}

/* ══════════════ 3. 발굴 ══════════════ */
const SORT_LABEL = { str: "강도 높은 순 (RS + 200일선 거리)", new: "새로 매수! 된 순", sig: "매수! 먼저", rs: "RS 높은 순", sec: "주도 업종 먼저", rev: "매출 성장 큰 순", vol: "변동성 높은 순", tv: "거래대금 큰 순" };
/** 시장 대비 = 그 종목 1달 수익 − 같은 시장 지수 1달 수익 */
const benchOf = (s) => s.m === "kr" ? "^KS11" : (NASDAQ.has(s.ex) ? "^IXIC" : "^GSPC");   // 이름표(benchName)와 같은 기준
const relOf = (s, market) => {
  const i = market?.indices?.[benchOf(s)];
  return (s.d21 == null || i?.d21 == null) ? null : s.d21 - i.d21;
};
/** 최근 신호 모아보기 — 5거래일치 매수! 기록과 그 뒤 성과 (실전 장부 signals_log 기준) */
function RecentSignals({ siglog, stocks, openStock, market }) {
  const [open, setOpen] = useState(false);
  if (!siglog?.length) return null;
  const days = [...new Set(siglog.map(x => x.d))].sort().slice(-5);
  const seenDT = new Set();
  const rows = siglog.filter(x => days.includes(x.d) && (x.k === "pull" || x.k === "strong" || x.k === "buy"))
    .sort((a, b) => ({ pull: 0, strong: 0, buy: 1 }[a.k] ?? 2) - ({ pull: 0, strong: 0, buy: 1 }[b.k] ?? 2))
    .filter(x => { const key = x.d + x.t; if (seenDT.has(key)) return false; seenDT.add(key); return true; })   // 같은 날 같은 종목 한 줄
    .map(x => { const s = stocks[x.t]; const now = s?.c ?? null;
      return { ...x, now, ret: now && x.p ? (now / x.p - 1) * 100 : null, n: s?.n || x.n }; })
    .sort((a, b) => b.d.localeCompare(a.d) || (b.ret ?? -99) - (a.ret ?? -99));
  const done = rows.filter(r => r.ret != null);
  const avg = done.length ? done.reduce((a, r) => a + r.ret, 0) / done.length : null;
  const win = done.length ? done.filter(r => r.ret > 0).length / done.length * 100 : null;
  const K = { pull: "눌림", strong: "강세", buy: "추세" };
  return (
    <Card style={{ marginTop: 8, padding: "10px 12px" }}>
      <button onClick={() => setOpen(v => !v)} style={{ background: "none", border: "none", padding: "6px 0", minHeight: 36, width: "100%", textAlign: "left", cursor: "pointer", color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: FS.md, fontWeight: 800 }}>최근 5거래일 매수! 기록</span>
        <span style={{ fontSize: FS.xs, color: C.muted }}>{rows.length}건{avg != null && <> · 평균 <b style={{ color: col(avg) }}>{pct(avg, 1)}</b> · 승률 {win.toFixed(0)}%</>}</span>
        <span style={{ marginLeft: "auto", color: C.muted }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (<div style={{ marginTop: 6 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 44px 64px 56px", gap: 6, fontSize: 10, color: C.muted, padding: "2px 0" }}>
          <span>종목</span><span>근거</span><span style={{ textAlign: "right" }}>신호일 종가</span><span style={{ textAlign: "right" }}>지금까지</span></div>
        {days.slice().reverse().map(d => (
          <div key={d}>
            <div style={{ fontSize: FS.xs, color: C.gold, fontWeight: 700, padding: "8px 0 2px", borderTop: `1px solid ${C.border}` }}>{d} · {rows.filter(r => r.d === d).length}건</div>
            {rows.filter(r => r.d === d).map((r, i) => (
              <div key={r.t + r.k + i} onClick={() => openStock(r.t)} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 44px 64px 56px", gap: 6, alignItems: "center", padding: "5px 0", cursor: "pointer" }}>
                <span style={{ minWidth: 0, ...ONE }}>{r.m === "kr" ? <><b>{r.n}</b> <span style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}>{r.t}</span></>
                  : <><b style={{ fontFamily: MONO }}>{r.t}</b> <span style={{ fontSize: FS.xs, color: C.dim }}>{shortName(r.n)}</span></>}</span>
                <span style={{ fontSize: FS.xs, color: C.muted }}>{K[r.k]}</span>
                <span style={{ fontSize: FS.xs, fontFamily: MONO, color: C.muted, textAlign: "right" }}>{price(r.p, r.m)}</span>
                <span style={{ fontSize: FS.sm, fontFamily: MONO, fontWeight: 700, color: col(r.ret), textAlign: "right" }}>{r.ret == null ? "—" : pct(r.ret, 1)}</span>
              </div>))}
          </div>))}
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>
          신호일 종가 → 지금 종가. 같은 종목이 며칠 연속 뜨면 첫날만 기록됩니다(20거래일 안 중복 제외).
          20거래일이 지난 신호의 확정 성적은 점검 탭 "실전 신호 성적"에.
        </div>
      </div>)}
    </Card>);
}

/** 찾기 탭 상태를 세션에 남깁니다 — 탭을 오가도 필터·정렬·더 보기가 풀리지 않게 (31) */
const useSticky = (key, init) => {
  const [v, set] = useState(() => { try { const x = sessionStorage.getItem(key); return x == null ? init : JSON.parse(x); } catch { return init; } });
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch {} }, [v]);
  return [v, set];
};
/** 매수! 가 된 지 며칠째인지 — 실전 장부(signals_log)의 첫 발생일 기준. 거래일 수는 장부에 있는 날짜 수로 셉니다 */
function sigAgeMap(siglog) {
  if (!siglog?.length) return {};
  const dates = [...new Set(siglog.map(x => x.d))].sort();
  const last = dates[dates.length - 1];
  const idx = Object.fromEntries(dates.map((d, i) => [d, i]));
  const m = {};
  for (const x of siglog) {
    if (!(x.k === "pull" || x.k === "strong" || x.k === "buy")) continue;
    const age = idx[last] - idx[x.d] + 1;
    if (age <= 20 && (m[x.t] == null || age < m[x.t])) m[x.t] = age;
  }
  return m;
}
const NewTag = ({ age }) => age == null ? null : (
  <span style={{ fontSize: 10.5, fontWeight: 800, color: age <= 1 ? C.gold : C.muted, flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                 background: age <= 1 ? "rgba(245,158,11,.15)" : "transparent", borderRadius: 4, padding: age <= 1 ? "0 4px" : 0 }}>
    {age <= 1 ? "🆕 오늘" : age <= 3 ? `🆕 ${age}일째` : `${age}일째`}</span>);
function TodayPicks({ today, stocks, sizer, openStock, pos, staleInfo }) {
  if (!today?.pickUs) return null;
  const held = new Set((pos || []).map(p => p.t));
  const K = { pull: "눌림", strong: "강세", trend: "추세" };
  const Row = ({ r, i }) => {
    const s = stocks[r.t] || r; const sh = sizer?.shares(r.c, r.m);
    const why = [K[r.why], r.str != null && `강도 ${r.str}`, r.rs != null && `RS ${Math.floor(r.rs)}`, r.ma200p != null && `200일선 +${Math.round(r.ma200p)}%`, r.secRank && `업종 ${r.secLabel || ""} ${r.secRank}위`,
                 r.growth != null && `매출 ${r.growth >= 0 ? "+" : ""}${r.growth.toFixed(0)}%${r.accel ? " 가속" : ""}`,
                 r.loss != null && `선까지 −${r.loss.toFixed(0)}%`, r.age && (r.age <= 1 ? "🆕 오늘" : `${r.age}일째`)].filter(Boolean).join(" · ");
    return (
      <div onClick={() => openStock(r.t)} style={{ display: "grid", gridTemplateColumns: "18px minmax(0,1fr) auto", gap: 8, alignItems: "center", padding: "8px 0", borderTop: i ? `1px solid ${C.border}` : "none", cursor: "pointer" }}>
        <span style={{ fontSize: FS.sm, color: C.muted, textAlign: "right" }}>{i + 1}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, ...ONE }}>{r.m === "kr" ? <><b>{r.n}</b><span style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}> {r.t}</span></>
            : <><b style={{ fontFamily: MONO }}>{r.t}</b><span style={{ fontSize: FS.xs, color: C.dim }}> {shortName(r.n)}</span></>}
            {held.has(r.t) && <span style={{ fontSize: 10.5, color: C.cyan }}> 보유 중</span>}</div>
          <div style={{ fontSize: 10.5, color: C.dim, marginTop: 2, lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{why}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: MONO }}>{price(r.c, r.m)}</div>
          <div style={{ fontSize: 10.5, color: C.muted }}>{sh > 0 ? `1회차 ${sh}주` : "1주 한 번에"}</div>
        </div>
      </div>);
  };
  return (
    <Card style={{ marginTop: 10, borderColor: `${C.emerald}55`, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: FS.md, fontWeight: 800 }}>오늘 살 것</span>
        {(() => { const rm = getRevMin(); const c = (today.candidates || []).filter(r => rm <= 0 || r.m === "kr" || r.growth == null || r.growth >= rm);
          const us = c.filter(r => r.m === "us").length;
          return <span style={{ fontSize: FS.xs, color: C.muted }}>{today.asOf} 종가 · 매수! 🇺🇸 {us} · 🇰🇷 {c.length - us}건 중</span>; })()}
      </div>
      <StaleWarn info={staleInfo} />
      <div style={{ fontSize: FS.xs, color: C.emerald, fontWeight: 700, marginTop: 6 }}>🇺🇸 미국 {today.pickUs.length}칸</div>
      {today.pickUs.length ? today.pickUs.map((r, i) => <Row key={r.t} r={r} i={i} />) : <div style={{ fontSize: FS.sm, color: C.muted, padding: "6px 0" }}>오늘은 없음</div>}
      {today.pickKr?.length > 0 && <>
        <div style={{ fontSize: FS.xs, color: C.gold, fontWeight: 700, marginTop: 8 }}>🇰🇷 한국{today.market?.kr === "risk" ? " · 시장 위험 — 쉬어도 됨" : ""}</div>
        {today.pickKr.map((r, i) => <Row key={r.t} r={r} i={i} />)}</>}
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
        고른 방법: 매수! 중 강세·눌림 먼저 → <b style={{ color: C.text }}>강도 점수(RS + 200일선 거리) 높은 순</b> · 같은 업종은 하나(위험 관리) · 적자·매출 부진·보유 제외.
        검증: 규칙을 2010–18에서 정하고 2019–26에 적용 — 🇺🇸 연 +50%·+38% (RS 순 +41%·+27%) · 🇰🇷 +48%·+39% (+45%·+23%). 텔레그램·AI 도구와 같은 목록
      </div>
    </Card>);
}

function FindTab({ list, openStock, watch, toggleWatch, market, sizer, pos, siglog, stocks, today, staleInfo, notes }) {
  const [filt, setFilt] = useSticky("v9.find.filt", "buy");
  const [mkt, setMkt] = useSticky("v9.find.mkt", "us");      // 🇺🇸 기본
  const [sortBy, setSortBy] = useSticky("v12.find.sort", "str");
  const ageMap = useMemo(() => sigAgeMap(siglog), [siglog]);
  const [limit, setLimit] = useSticky("v9.find.limit", 20);
  const [revMin, setRevMinRaw] = useState(getRevMin);                  // 28. 매출 성장 필터 (%) · 0 = 끄기 — 공통 설정
  const [showAll, setShowAll] = useSticky("v12.find.all", false);      // 67. 전체 매수! 목록은 접어 둠
  const setRevMin = (v) => { setRevMinRaw(v); try { localStorage.setItem(REV_KEY, String(v)); } catch {} settingsChanged(); };
  const wk = weekKey();
  const [seenMap, setSeenMap] = useState(() => loadJSON("v9.find.seen", {}));   // 31. 확인함 — 그 주 동안 유지
  useEffect(() => { localStorage.setItem("v9.find.seen", JSON.stringify({ [wk]: seenMap[wk] || {} })); }, [seenMap]);
  const seenSet = seenMap[wk] || {};
  const toggleSeen = (t) => setSeenMap(o => ({ ...o, [wk]: { ...(o[wk] || {}), [t]: !(o[wk] || {})[t] } }));
  const heldSet = useMemo(() => new Set((pos || []).map(p => p.t)), [pos]);
  const passRev = (s) => passRevOf(s, revMin);
  const pool = useMemo(() => {
    let r = list.filter(s => (s.tvr ?? 0) >= 40);
    if (mkt !== "all") r = r.filter(s => s.m === mkt);
    return r;
  }, [list, mkt]);
  const rows = useMemo(() => {
    let r = pool;
    if (filt === "buy") r = r.filter(s => s.action === "buy" && passRev(s));
    else if (filt === "pre") r = r.filter(s => s.pre);
    const W = { pull: 3, strong: 3, trend: 2 };
    const key = { str: s => ((s.action === "buy" && s.why !== "trend") ? 0 : 1) * 1000 - (s.str ?? -1),   // 강도순 (검증된 순서)
                  new: s => (ageMap[s.t] ?? 99) * 1000 - (s.rs ?? 0),          // 새로 매수! 된 순
                  sig: s => -((s.action === "buy" ? W[s.why] || 1 : 0) * 1000 + (s.rs ?? 0)),
                  rs: s => -(s.rs ?? 0), vol: s => -(s.atrr ?? -1), tv: s => -(s.tvr ?? 0), rev: s => -(growthOf(s) ?? -999),
                  sec: s => { const r = (market?.sectors || []).find(x => x.tk === s.sec); return (r ? r.rank : 99) * 1000 - (s.rs ?? 0); } }[sortBy];
    const sorted = [...r].sort((a, b) => key(a) - key(b));
    return [...sorted.filter(s => !seenSet[s.t]), ...sorted.filter(s => seenSet[s.t])];   // 확인한 것은 맨 아래
  }, [pool, filt, sortBy, market, revMin, seenSet, ageMap]);
  const nNew = pool.filter(s => s.action === "buy" && passRev(s) && (ageMap[s.t] ?? 99) <= 1).length;
  const nBuy = pool.filter(s => s.action === "buy" && passRev(s)).length;
  const nCut = pool.filter(s => s.action === "buy" && !passRev(s)).length;
  const nPre = pool.filter(s => s.pre).length;
  const nKr = pool.filter(s => s.action === "buy" && s.m === "kr").length;
  return (
    <>
      <TodayPicks today={today} stocks={stocks} sizer={sizer} openStock={openStock} pos={pos} staleInfo={staleInfo} />
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        <Seg full value={mkt} onChange={setMkt} items={[["us", "🇺🇸 미국"], ["kr", "🇰🇷 한국"], ["all", "전체"]]} />
        <Seg full value={filt} onChange={setFilt} items={[["buy", `매수! ${nBuy}`], ["pre", `예비 ${nPre}`], ["all", "전체"]]} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(98px, 1fr))", gap: 6 }}>
          <SortSelect value={sortBy} onChange={setSortBy}
            items={[["str", "강도순 (검증)"], ["new", "새로 된 순"], ["rs", "RS순"], ["sec", "주도 업종순"], ["rev", "매출 성장순"], ["vol", "변동성순"], ["tv", "거래대금순"]]} />
          <SortSelect value={revMin} onChange={v => setRevMin(Number(v))}
            items={[[0, "매출 필터 끔"], [5, "매출 +5%↑"], [10, "매출 +10%↑"], [20, "매출 +20%↑"]]} />
        </div>
        <div style={{ fontSize: FS.xs, color: C.muted, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span>{nNew > 0 && <b style={{ color: C.gold }}>🆕 오늘 새로 {nNew} · </b>}🇰🇷 눌림 {nKr} · 🇺🇸 강세·추세 {nBuy - nKr}{nCut > 0 && <span style={{ color: C.gold }}> · ✂ 매출 부진 {nCut} 숨김</span>}</span>
          {Object.values(seenSet).some(Boolean) && (
            <button onClick={() => setSeenMap(o => ({ ...o, [wk]: {} }))} style={{ ...linkBtn, fontSize: FS.xs, minHeight: 32 }}>
              ↺ 확인 {Object.values(seenSet).filter(Boolean).length} 모두 해제</button>)}
          <span style={{ marginLeft: "auto" }}><CopyBtn tickers={rows.filter(s => !seenSet[s.t]).map(s => s.t)} /></span>
        </div>
      </div>
      {filt === "pre" && (
        <div style={{ fontSize: FS.xs, color: C.dim, background: "rgba(6,182,212,.07)", borderRadius: 8, padding: "7px 10px", marginTop: 6, lineHeight: 1.6 }}>
          <b style={{ color: C.cyan }}>예비 후보 = 관찰용, 매수! 아님.</b> 검증(2008–26)에서 '강해질 것 같은' 진입 5종은 모두 현행을 못 이겼습니다(미국 −8~−14%p).
          ☆로 담아 두면 매수!로 바뀌는 날 알림이 옵니다. <b>rising</b> = 추세 유지·RS 55~70·1달 시장대비 + / <b>turn</b> = 느린ST 초록 전환 3일 이내
        </div>)}
      <button onClick={() => setShowAll(v => !v)} style={{ ...btn(C.dim), width: "100%", marginTop: 8, display: "flex" }}>
        <span>{filt === "pre" ? `예비 목록 ${rows.length}개` : filt === "buy" ? `매수! 목록 ${rows.length}개` : `전체 목록 ${rows.length}개`}</span><span style={{ marginLeft: "auto", fontWeight: 400, color: C.muted }}>{showAll ? "접기 ▴" : "펼치기 ▾"}</span>
      </button>
      {showAll && <>
      <SortBar text={filt === "pre" ? "예비 후보 (관찰)" : SORT_LABEL[sortBy]} n={rows.length} market={market} />
      <ExplainList items={EXPLAIN.trend} />
      <div>
        {rows.length === 0 ? <Empty>{filt === "buy" ? "지금은 매수! 신호가 없습니다 · ‘전체’를 누르면 관망 종목도 보입니다" : "해당 종목이 없습니다"}</Empty> : rows.slice(0, limit).map((s, i) => (
          <StockRow key={s.t} s={s} rank={i + 1} rel={relOf(s, market)} held={heldSet.has(s.t)}
            seen={!!seenSet[s.t]} onSeen={toggleSeen} age={ageMap[s.t]}
            isWatch={watch.includes(s.t)} onToggle={toggleWatch} onOpen={openStock}
            sub={subLine(s, sizer, market, filt === "pre" ? [s.pre === "rising" ? "예비: RS 오르는 중" : "예비: 추세 전환 초기"] : [])} />))}
        {rows.length > limit && (
          <button onClick={() => setLimit(l => l + 20)} style={{ ...btn(C.dim), width: "100%", marginTop: 10 }}>
            더 보기 ({limit} / {rows.length})</button>)}
      </div>
      </>}
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
function ChartTab({ stocks, sel: sel0, watch, toggleWatch, market, pos, setPos, setTab, sizer, staleInfo, notes, setNote }) {
  const [checkOpen, setCheckOpen] = useSticky("v13.chart.check", false);   // 81. 체크리스트 접기
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
            <div style={{ fontSize: 17, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.n}<InfoLink s={s} style={{ fontSize: 15 }} /></div>
            <div style={{ fontSize: FS.xs, color: C.muted }}>{s.m === "kr" ? "🇰🇷" : "🇺🇸"} {s.t} · {s.asOf} 종가</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 19, fontWeight: 800, fontFamily: MONO }}>{price(s.c, s.m)}</div>
            <div style={{ fontSize: FS.sm, fontFamily: MONO, color: col(s.d1) }}><span style={{ fontSize: 10.5, color: C.muted, fontFamily: "inherit" }}>전일 </span>{pct(s.d1)}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {isEtf ? <><span style={{ fontSize: FS.lg, fontWeight: 800, color: v?.c }}>{v?.t}</span>
                     <span style={{ fontSize: FS.sm, color: C.dim }}>{v?.why}</span></>
                 : <><ActionTag s={s} held={held} big />
                     <span style={{ fontSize: FS.sm, color: C.dim }}>
                       {s.action === "sell" ? `느린 ST 빨강 ${s.slowDays ?? "—"}거래일째${held ? "" : " · 새로 사지 않음"}` : s.stLine ? `트레일링선 ${price(s.stLine, s.m)} · 선까지 ${lossTxt(s)}` : ""}</span>
                     {s.dip && <DipTag s={s} />}</>}
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
        {isStock && <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>자리 정보는 참고용 — 이 값으로 걸러 사면 검증에서 성과가 떨어졌습니다. 선까지 = 지금 사면 잃을 수 있는 폭</div>}
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
            {sh > 0 ? <>1회차 <b style={{ color: C.text }}>{sh}주</b> · {money(sizer.limit(regM) * 0.5, regM)} (한도 {money(sizer.limit(regM), regM)}의 절반)
              <span style={{ color: C.muted }}> · 2회차는 +3% 확인 후</span></>
              : Math.floor(sizer.limit(regM) / regPx) >= 1
                ? <span style={{ color: C.gold }}>고가 종목 — 절반으로는 1주도 안 됩니다. <b style={{ color: C.text }}>1주를 한 번에</b> (2회차 없음)</span>
                : <span style={{ color: C.gold }}>1주 가격이 종목당 한도({money(sizer.limit(regM), regM)})보다 큽니다. 사려면 칸 두 개를 쓰는 셈이니, 💰 투자금에서 칸 수나 금액을 조정하세요</span>}
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
            : sh > 0 ? `＋ 1회차 매수 등록 · ${price(regPx, regM)}`
            : Math.floor(sizer.limit(regM) / regPx) >= 1 ? `＋ 1주 매수 등록 · ${price(regPx, regM)}`
            : `＋ 1주 등록 (한도 초과 — 칸 2개 쓰는 셈) · ${price(regPx, regM)}`}</button>
      </Card>

      {/* 매매 체크리스트 — 충동 매매 방지 (검증된 규칙만) */}
      <Card style={{ marginTop: 8, padding: "10px 12px" }}>
        <div onClick={() => setCheckOpen(v => !v)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <span style={{ fontSize: FS.md, fontWeight: 800 }}>{isEtf ? "보유 조건" : "매수 체크리스트"}</span>
          {!isEtf && <span style={{ fontSize: FS.xs, color: C.muted }}>✓ {checks.filter(c => c[1]).length}/{checks.length} · {checkOpen ? "접기 ▴" : "자세히 ▾"}</span>}
          <span style={{ marginLeft: "auto", fontSize: FS.sm, fontWeight: 800, color: isEtf ? (s.stSlow === 1 ? C.emerald : C.gold) : allOk ? C.emerald : C.muted }}>
            {isEtf ? (s.stSlow === 1 ? "보유 가능" : "대기") : allOk ? "매수!" : (s.action === "sell" && held) ? "매도!" : "관망"}</span>
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
          {isEtf
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
function TrackTab({ stocks, watch, toggleWatch, openStock, pos, setPos, market, bumpSizer, extras, trades, setTrades, sizer, syncState }) {
  const [role, setRole] = useState("all");
  const [tmk, setTmkRaw] = useState(() => localStorage.getItem("v11.trackMkt") || "us");      // 69. 기본 🇺🇸, 마지막 선택 기억
  const setTmk = (v) => { setTmkRaw(v); localStorage.setItem("v11.trackMkt", v); };
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
  const inMk = (t) => tmk === "all" || mktOfT(t) === tmk;
  const rows = pos.filter(p => (role === "all" || p.role === role) && inMk(p.t))
                  .sort((a, b) => (mktOfT(a.t) === "us" ? 0 : 1) - (mktOfT(b.t) === "us" ? 0 : 1));   // 🇺🇸 먼저
  const nUs = pos.filter(p => mktOfT(p.t) === "us").length, nKr = pos.length - nUs;
  const RB = { etf: ["ETF", "w"], swing: ["단기", "g"], long: ["장기", "c"] };

  /** 83. 매도 기록 — 앱 안 입력 시트. 예전엔 브라우저 입력창에서 '취소'를 누르면 기록 없이 종목이 삭제됐음 */
  const [sheet, setSheet] = useState(null);      // { kind: "sell"|"add", p, s, px }
  const closePos = (p, s) => setSheet({ kind: "sell", p, s, px: String(s?.c ?? avgOf(p)) });
  const addTranche = (p, s) => setSheet({ kind: "add", p, s, px: String(s?.c ?? "") });
  const doClose = (p, s, raw, keep) => {
    {
      const sell = Number(String(raw).replace(/[^\d.]/g, ""));
      if (keep && sell > 0) {
        const avg = avgOf(p), tr = trOf(p);
        const days = Math.max(1, Math.round((Date.now() - new Date(tr[0].d + "T00:00:00").getTime()) / 86400000));
        setTrades(v => [...v, { t: p.t, n: s?.n || p.t, m: s?.m || (/^\d{6}$/.test(p.t) ? "kr" : "us"), role: p.role, buy: avg, sell, in: tr[0].d,
                                out: new Date().toISOString().slice(0, 10), days, pl: (sell / avg - 1) * 100,
                                k: tr.length, inv: investedOf(p) }].slice(-300));
      }
    }
    setPos(v => v.filter(x => x.id !== p.id)); setSheet(null);
  };
  /** 2회차 매수 기록 */
  const doAdd = (p, s, raw) => {
    const px = Number(String(raw).replace(/[^\d.]/g, "")); if (!(px > 0)) return;
    setSheet(null);
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
  const Sheet = () => !sheet ? null : (
    <div onClick={(e) => { if (e.target === e.currentTarget) setSheet(null); }}
         style={{ position: "fixed", inset: 0, zIndex: 180, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: C.panel, borderRadius: "14px 14px 0 0", width: "100%", maxWidth: 640, padding: "16px 14px 22px", borderTop: `2px solid ${sheet.kind === "sell" ? C.red : C.emerald}` }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>{sheet.kind === "sell" ? "매도 기록" : "2회차 매수 기록"} · {sheet.s?.n || sheet.p.t}</div>
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 3 }}>
          {sheet.kind === "sell" ? `평단 ${price(avgOf(sheet.p), mktOfT(sheet.p.t))} · 지금 ${price(sheet.s?.c, mktOfT(sheet.p.t))}` : `1회차 ${price(trOf(sheet.p)[0]?.px, mktOfT(sheet.p.t))} · 금액은 칸당 금액의 절반`}</div>
        <input type="number" inputMode="decimal" autoFocus value={sheet.px} onChange={e => setSheet(v => ({ ...v, px: e.target.value }))}
          style={{ ...inp("100%"), marginTop: 10, fontSize: 18, padding: "10px 12px" }} aria-label={sheet.kind === "sell" ? "매도가" : "매수가"} />
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {sheet.kind === "sell"
            ? <button onClick={() => doClose(sheet.p, sheet.s, sheet.px, true)} style={{ ...btn(C.red), minHeight: 44 }}>매도 기록하고 내 종목에서 빼기</button>
            : <button onClick={() => doAdd(sheet.p, sheet.s, sheet.px)} style={{ ...btn(C.emerald), minHeight: 44 }}>2회차 기록</button>}
          <button onClick={() => setSheet(null)} style={{ ...btn(C.dim), minHeight: 40 }}>취소 (아무것도 바꾸지 않음)</button>
          {sheet.kind === "sell" && (
            <button onClick={() => { if (confirm("매도 기록 없이 이 종목을 내 종목에서 지울까요? (잘못 등록한 경우)")) doClose(sheet.p, sheet.s, 0, false); }}
              style={{ ...linkBtn, fontSize: FS.xs, color: C.muted, minHeight: 32 }}>잘못 등록한 종목이면 — 기록 없이 지우기</button>)}
        </div>
      </div>
    </div>);
  return (
    <>
      <Sheet />
      <PlanCard sizer={sizer} bumpSizer={bumpSizer} pos={pos} stocks={stocks} />
      {/* 사이징 — 전체 투자금이 없을 때만 계좌별로 직접 */}
      {!sizer.plan && <Card style={{ marginTop: 8 }}>
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
      </Card>}

      <Sec right={<button onClick={() => setForm(form ? null : { t: "", avg: "", role: "swing", k: "1" })} style={linkBtn}>{form ? "닫기" : "＋ 직접 추가"}</button>}>
        보유 {pos.length}
      </Sec>
      <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
        <Seg full value={tmk} onChange={setTmk} items={[["us", `🇺🇸 미국 ${nUs}`], ["kr", `🇰🇷 한국 ${nKr}`], ["all", "전체"]]} />
        <Seg value={role} onChange={setRole} items={[["all", "전체"], ["etf", "ETF"], ["swing", "단기"], ["long", "장기"]]} />
      </div>
      <HoldTotals pos={pos} stocks={stocks} fx={sizer.fx} only={tmk} />
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
          const s = look(p.t);
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
                  <div style={{ fontSize: 10, color: C.muted }}>평단 대비</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: col(pl), fontFamily: MONO, lineHeight: 1.1 }}>{pct(pl)}</div>
                  <div style={{ fontSize: FS.xs, color: C.muted }}>{tr.length > 1 ? `1회차 대비 ${pct(pl1)}` : `지금 ${price(s.c, s.m)}`}</div>
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
                    {(s.halted || s.status) && <span style={{ fontSize: FS.xs, fontWeight: 800, color: C.gold }}>⚠ {s.status || "거래정지"}</span>}
                    <span style={{ fontSize: FS.xs, color: C.dim }}>
                      {isSell ? `종가 ${price(s.c, s.m)} < 트레일링선 ${price(s.stLine, s.m)}`
                              : s.stLine ? `트레일링선 ${price(s.stLine, s.m)} · 선까지 ${lossTxt(s)}` : "트레일링선 없음"}
                      {s.slowDays != null && ` · 초록 ${s.slowDays}거래일째`}
                      {(() => { const tg = tgtOf(p.t, NOTES_REF.cur, s); const g = tg && tgtGap(tg.v, s.c);
                        return g == null ? null : <b style={{ color: g <= 0 ? C.emerald : C.dim }}>{g <= 0 ? ` · 🎯 목표 ${price(tg.v, s.m)} 도달 (매도 신호 아님)` : ` · 목표 ${price(tg.v, s.m)}까지 +${g.toFixed(0)}%${tg.mine ? "" : "(애널)"}`}</b>; })()}</span>
                  </div>
                  {!isSell && s.stLine && (
                    <div style={{ height: 6, borderRadius: 4, background: "rgba(255,255,255,.07)", marginTop: 6, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, (lossOf(s) ?? 0) * 4))}%`, background: `linear-gradient(90deg,${C.gold},${C.emerald})` }} />
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

      <SyncBtn pos={pos} watch={watch} extras={extras} trades={trades} syncState={syncState} />
      <Sec right={<CopyBtn tickers={watch.filter(inMk)} />}>관심 {watch.filter(inMk).length}{tmk !== "all" ? ` · ${tmk === "us" ? "🇺🇸" : "🇰🇷"}` : ""}</Sec>
      <Card style={{ padding: "0 10px" }}>
        {watch.filter(inMk).length === 0 ? <Empty>종목 옆 ☆ 를 누르면 여기에 모입니다</Empty> :
          [...watch].filter(inMk).sort((a, b) => (mktOfT(a) === "us" ? 0 : 1) - (mktOfT(b) === "us" ? 0 : 1)).map(t => { const s = look(t); if (!s) return null;
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
function SyncBtn({ pos, watch, extras = [], trades = [], syncState }) {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState(() => localStorage.getItem("v7.sync.at") || null);
  const run = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-key": localStorage.getItem("v52.rkey") || "" },
        body: JSON.stringify({ bulk: true, positions: pos, watch, extras, excludes: loadJSON("v10.excludes", []), trades: trades.slice(-100),
                               force: (pos.length === 0 && watch.length === 0) ? confirm("이 기기의 보유·관심이 비어 있습니다. 서버의 기록을 빈 목록으로 덮어쓸까요?") : undefined,
                               settings: { revMin: getRevMin(), slotsUs: loadPlan().slotsUs || 5, slotsKr: loadPlan().slotsKr || 3,
                                           dcAmt: loadPlan().dcAmt || 0, dcMode: localStorage.getItem("v9.dc.mode") || "st", dcSemi: localStorage.getItem("v9.dc.semi") === "1" } }),
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
  ["hold", "내 종목 점검", "매도!는 처리했는지 · 선까지 −5% 이내(곧 매도 구간)인 종목 확인"],
  ["live", "실전 성적 보기", "앱이 실제로 낸 신호의 20일 성적이 검증값과 비슷한지"],
  ["trade", "내 매매 기록 대조", "내 승률·손익비가 검증값과 크게 다르면 규칙을 안 지킨 것"],
  ["decide", "전략 결정", "그대로 간다 / 바꾼다 — 바꾸면 이유를 한 줄 적기"],
];
/** 29. 이번 주 선정 — 손으로 하던 절차를 버튼으로. 결과는 그 주 기록으로 저장 */
function buildWeeklyPick(stocks, market, sizer, held = []) {
  const heldSet = new Set(held);
  const list = Object.values(stocks).filter(s => (s.tvr ?? 0) >= 40);
  const allBuys = list.filter(s => s.action === "buy");
  const buys = allBuys.filter(s => !heldSet.has(s.t));
  const secRank = (s) => (market?.sectors || []).find(x => x.tk === s.sec)?.rank ?? 99;
  const rel = (s) => relOf(s, market);
  const gap = (s) => (s.stLine && s.c) ? (s.c / s.stLine - 1) * 100 : null;
  const reasonsOut = (s) => {
    const r = []; const f = s.fin || {};
    if (f.prof === false) r.push("적자");
    const rm = getRevMin();
    if (rm > 0 && f.rev != null && f.rev < rm && s.m === "us") r.push(`매출 ${f.rev >= 0 ? "+" : ""}${f.rev.toFixed(0)}%`);
    return r;
  };
  const rank = (s) => (s.why === "trend" ? 1 : 0) * 1000 - (s.str ?? 0);      // 강도 점수 순 (70)
  const us = buys.filter(s => s.m === "us").sort((a, b) => rank(a) - rank(b));
  const kr = buys.filter(s => s.m === "kr").sort((a, b) => rank(a) - rank(b));
  // 5칸: 같은 업종은 하나씩, 제외 사유 없는 것 먼저
  const pick = [], used = new Set(), excluded = [];
  for (const s of us) {
    const why = reasonsOut(s);
    if (why.length) { excluded.push({ s, why }); continue; }
    const sec = s.sec || `?${s.t}`;          // 업종 정보가 없으면 분산 규칙을 적용하지 않음
    if (used.has(sec)) { excluded.push({ s, why: ["같은 업종 이미 선택"] }); continue; }
    pick.push(s); used.add(sec);
    if (pick.length >= sizer.slots("us")) break;
  }
  const dips = list.filter(s => s.dip === "watch" && s.m === "us").sort((a, b) => (a.w52p ?? 0) - (b.w52p ?? 0)).slice(0, 5);
  const dual = market?.dc?.dual;
  return { made: new Date().toISOString().slice(0, 10), judge: market?.judge, sectors: (market?.sectors || []).slice(0, 5),
           pick: pick.map(s => ({ t: s.t, n: s.n, why: s.why, rs: s.rs, str: s.str, sec: s.sec, loss: lossOf(s), rel: rel(s),
                                  fin: s.fin ? { rev: growthOf(s), prof: s.fin.prof, accel: s.fin.accel } : null, c: s.c, m: s.m })),
           excluded: excluded.slice(0, 12).map(x => ({ t: x.s.t, n: x.s.n, why: x.why })),
           kr: kr.slice(0, 5).map(s => ({ t: s.t, n: s.n, why: s.why, rs: s.rs, rel: rel(s), gap: gap(s), c: s.c, m: s.m })),
           dips: dips.map(s => ({ t: s.t, n: s.n, w52p: s.w52p, hlt: s.hlt, fin: s.fin })),
           dual: dual ? { hold: dual.hold, cands: dual.cands.map(c => ({ label: c.label, score: c.score })) } : null,
           nBuy: allBuys.length, held: allBuys.filter(s => heldSet.has(s.t)).map(s => s.t) };
}
function WeeklyPick({ stocks, market, sizer, openStock, setTab, pos, today }) {
  const wk = weekKey();
  const [saved, setSaved] = useState(() => loadJSON("v9.pick", {}));
  const cur = saved[wk];
  // 파이프라인이 확정한 today.json 이 있으면 그것을 씁니다 (텔레그램·AI 도구와 같은 목록). 없으면 앱이 같은 규칙으로 계산
  const fromToday = (t) => ({
    made: new Date().toISOString().slice(0, 10) + " (파이프라인 " + (t.asOf || "") + ")", judge: { us: { verdict: t.market?.us }, kr: { verdict: t.market?.kr } },
    sectors: t.sectors || [], pick: t.pickUs.map(r => ({ ...r, fin: { rev: r.growth ?? r.rev, prof: r.prof, accel: r.accel } })),
    excluded: t.excluded.map(x => ({ t: x.t, n: x.n, why: x.why })), kr: t.pickKr, dips: t.dips.map(d => ({ t: d.t, n: d.n, w52p: d.w52p, hlt: d.hlt })),
    dual: t.dc && t.dc.cands ? { hold: t.dc.hold || [], cands: t.dc.cands } : null, nBuy: t.candidates.length,
    held: t.candidates.filter(r => r.held).map(r => r.t) });
  const make = () => { const p = today?.pickUs ? fromToday(today) : buildWeeklyPick(stocks, market, sizer, (pos || []).map(x => x.t)); const next = { ...saved, [wk]: p }; setSaved(next); localStorage.setItem("v9.pick", JSON.stringify(next)); };
  const prev = Object.keys(saved).filter(k => k < wk).sort().pop();
  const J = { safe: "안전", warn: "주의", risk: "위험" };
  return (
    <Card style={{ marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: FS.md, fontWeight: 800 }}>이번 주 선정</span>
        <span style={{ fontSize: FS.xs, color: C.muted }}>{cur ? `${cur.made} 작성` : "아직 없음"}</span>
        <button onClick={make} style={{ ...btn(C.gold), marginLeft: "auto", minHeight: 34 }}>{cur ? "다시 만들기" : "이번 주 선정 만들기"}</button>
      </div>
      {cur && (<div style={{ marginTop: 8, fontSize: FS.sm, lineHeight: 1.7 }}>
        <div style={{ color: C.dim }}>시장 🇺🇸 {J[cur.judge?.us?.verdict] || "—"} · 🇰🇷 {J[cur.judge?.kr?.verdict] || "—"} · 섹터 {cur.sectors.map(x => `${x.label}${x.rank}`).join(" ")}</div>
        <div style={{ fontWeight: 800, marginTop: 6 }}>🇺🇸 추천 (강도 점수 순 · 업종 분산) · 매수! {cur.nBuy}건 중</div>
        {cur.held?.length > 0 && <div style={{ fontSize: FS.xs, color: C.cyan }}>이미 보유 중이라 제외: {cur.held.join(", ")}</div>}
        {cur.pick.length === 0 && <div style={{ color: C.muted }}>제외 사유 없는 후보가 없습니다</div>}
        {cur.pick.map((p, i) => (
          <div key={p.t} onClick={() => openStock(p.t)} style={{ display: "flex", gap: 6, alignItems: "baseline", cursor: "pointer", padding: "3px 0" }}>
            <span style={{ color: C.muted, width: 14 }}>{i + 1}</span>
            <b style={{ fontFamily: MONO }}>{p.t}</b><span style={{ color: C.dim, minWidth: 0, ...ONE }}>{shortName(p.n)}</span>
            <span style={{ marginLeft: "auto", fontSize: FS.xs, color: C.muted, whiteSpace: "nowrap" }}>
              {WHY[p.why]}{p.str != null && ` · 강도${p.str}`} · RS{Math.floor(p.rs)}{p.loss != null && ` · 선까지−${p.loss.toFixed(0)}%`}{p.fin?.rev != null && ` · 매출${p.fin.rev >= 0 ? "+" : ""}${p.fin.rev.toFixed(0)}%${p.fin.accel ? "↑" : ""}`}</span>
          </div>))}
        {cur.excluded.length > 0 && <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 4 }}>제외: {cur.excluded.map(x => `${x.t}(${x.why.join("·")})`).join(", ")}</div>}
        <div style={{ fontWeight: 800, marginTop: 8 }}>🇰🇷 {cur.kr.length ? "" : "없음"}</div>
        {cur.kr.map(p => <div key={p.t} onClick={() => openStock(p.t)} style={{ cursor: "pointer", padding: "2px 0" }}><b>{p.n}</b> <span style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}>{p.t}</span> <span style={{ fontSize: FS.xs, color: C.muted }}>{WHY[p.why]}{p.str != null && ` · 강도${p.str}`} · RS{Math.floor(p.rs)}{p.rel != null && ` · 1달 코스피比${p.rel >= 0 ? "+" : ""}${p.rel.toFixed(1)}p`}</span></div>)}
        {cur.dips.length > 0 && <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 6 }}>급락 관찰(참고): {cur.dips.map(d => `${d.t} ${d.w52p?.toFixed(0)}%`).join(" · ")}</div>}
        {cur.dual && <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 4 }}>DC 다음 달: {cur.dual.cands.map(c => `${c.label} ${c.score >= 0 ? "+" : ""}${c.score.toFixed(1)}`).join(" · ")} → 보유 {cur.dual.hold.join(" + ")}</div>}
        {prev && saved[prev] && <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 6 }}>지난 주({prev}) 추천: {saved[prev].pick.map(p => p.t).join(", ") || "없음"}</div>}
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 6 }}>"이 중 뭘 살지"와 "전략 유지/변경 한 줄"만 사람이 정합니다 · 기록은 이 기기에 저장</div>
      </div>)}
    </Card>);
}
/** 57. 지난 신호 복기 — 매수! 가 떴던 종목이 그 뒤 어떻게 됐나. 규칙대로 팔았으면 얼마였고, 판 뒤에는 어떻게 됐나 */
function SignalReview({ siglog, stocks, market, openStock }) {
  const [weeks, setWeeks] = useState(8);
  const [filter, setFilter] = useState("exit");
  const [limit, setLimit] = useState(15);
  if (!siglog?.length) return null;
  const since = new Date(Date.now() - weeks * 7 * 86400000).toISOString().slice(0, 10);
  const K = { pull: "눌림", strong: "강세", buy: "추세" };
  const rows = siglog.filter(x => x.d >= since && x.p).map(x => {
    const s = stocks[x.t]; const now = s?.c ?? (x.r?.now != null ? x.p * (1 + x.r.now / 100) : null);
    const ex = x.x;
    const rule = ex ? (ex.p / x.p - 1) * 100 : (now ? (now / x.p - 1) * 100 : null);   // 이탈 = 규칙 손익 · 유지 = 지금까지
    const after = ex && now ? (now / ex.p - 1) * 100 : null;                              // 판 뒤 흐름
    const dropped = !ex && s && s.action !== "buy";                                          // 목록에서 빠졌지만 매도 신호는 아님
    return { ...x, n: s?.n || x.n, m: x.m, now, ex, rule, after, dropped, cur: s };
  });
  const exited = rows.filter(r => r.ex);
  const holding = rows.filter(r => !r.ex);
  const saved = exited.filter(r => r.after != null && r.after < 0).length;
  const withAfter = exited.filter(r => r.after != null).length;
  const avg = (a) => a.length ? a.reduce((x, r) => x + (r.rule ?? 0), 0) / a.length : null;
  const list = (filter === "exit" ? exited : filter === "hold" ? holding : rows)
    .sort((a, b) => (b.ex?.d || b.d).localeCompare(a.ex?.d || a.d));
  const dlabel = (d) => d ? d.slice(5).replace("-", "/") : "";
  return (
    <>
      <Sec right={<Seg value={weeks} onChange={setWeeks} items={[[4, "4주"], [8, "8주"], [26, "6달"]]} />}>지난 신호 복기</Sec>
      <Card style={{ padding: "8px 12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", textAlign: "center" }}>
          {[["이탈 (매도!)", `${exited.length}건`, avg(exited) != null ? `규칙 손익 ${pct(avg(exited), 1)}` : "—", col(avg(exited))],
            ["판 뒤 더 떨어짐", withAfter ? `${Math.round(saved / withAfter * 100)}%` : "—", withAfter ? `${saved}/${withAfter}건 · 선이 지켜 줌` : "아직 없음", C.emerald],
            ["유지 중", `${holding.length}건`, avg(holding) != null ? `지금까지 ${pct(avg(holding), 1)}` : "—", col(avg(holding))]].map(([l, v, sub, c], i) => (
            <div key={l} style={{ borderLeft: i ? `1px solid ${C.border}` : "none", padding: "0 4px", minWidth: 0 }}>
              <div style={{ fontSize: 10.5, color: C.dim, ...ONE }}>{l}</div>
              <div style={{ fontSize: 16, fontWeight: 800, fontFamily: MONO }}>{v}</div>
              <div style={{ fontSize: 10.5, color: c, ...ONE }}>{sub}</div>
            </div>))}
        </div>
        <div style={{ marginTop: 8 }}>
          <Seg full value={filter} onChange={setFilter} items={[["exit", `이탈 ${exited.length}`], ["hold", `유지 ${holding.length}`], ["all", "전체"]]} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 58px 54px 54px", gap: 6, fontSize: 10, color: C.muted, padding: "8px 0 2px" }}>
          <span>종목 · 신호 → 매도</span><span style={{ textAlign: "right" }}>규칙 손익</span><span style={{ textAlign: "right" }}>판 뒤</span><span style={{ textAlign: "right" }}>최고</span>
        </div>
        {list.slice(0, limit).map((r, i) => (
          <div key={r.t + r.d + i} onClick={() => openStock(r.t)} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 58px 54px 54px", gap: 6, alignItems: "center",
                                                                    padding: "7px 0", borderTop: `1px solid ${C.border}`, cursor: "pointer" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: FS.sm, ...ONE }}>
                <b style={r.m === "kr" ? {} : { fontFamily: MONO }}>{r.m === "kr" ? r.n : r.t}</b>
                <span style={{ fontSize: 10.5, color: C.muted }}> {K[r.k]}</span>
                {r.dropped && <span style={{ fontSize: 10.5, color: C.gold }}> 목록 빠짐</span>}
              </div>
              <div style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO, ...ONE }}>
                {dlabel(r.d)} {price(r.p, r.m)}{r.ex ? ` → ${dlabel(r.ex.d)} ${price(r.ex.p, r.m)}` : " → 유지 중"}</div>
            </div>
            <span style={{ fontSize: FS.sm, fontFamily: MONO, fontWeight: 700, textAlign: "right", color: col(r.rule) }}>{r.rule == null ? "—" : pct(r.rule, 1)}</span>
            <span style={{ fontSize: FS.xs, fontFamily: MONO, textAlign: "right", color: r.after == null ? C.muted : r.after < 0 ? C.emerald : C.red }}>
              {r.after == null ? "—" : `${r.after < 0 ? "✓" : "✗"}${pct(r.after, 0)}`}</span>
            <span style={{ fontSize: FS.xs, fontFamily: MONO, textAlign: "right", color: C.dim }}>{r.peak == null ? "—" : pct(r.peak, 0)}</span>
          </div>))}
        {list.length > limit && <button onClick={() => setLimit(l => l + 15)} style={{ ...btn(C.dim), width: "100%", marginTop: 6 }}>더 보기 ({limit} / {list.length})</button>}
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>
          규칙 손익 = 매수! 날 종가에 사서, 처음 종가가 트레일링선 아래로 마감한 날 종가에 판 결과 (유지 중이면 지금까지).
          판 뒤 = 그 뒤 지금까지 · <b style={{ color: C.emerald }}>✓</b> 더 떨어짐(판 게 맞음) · <b style={{ color: C.red }}>✗</b> 다시 오름.
          최고 = 신호 뒤 가장 높았던 종가. "목록 빠짐" = 매수! 조건은 사라졌지만 매도 신호는 아님(보유 중이면 계속 보유).
        </div>
      </Card>
    </>);
}

function ReviewTab({ market, uni, snap, trades, setTrades, pos, stocks, setTab, openStock, sizer, today, siglog, syncState, onShowRules }) {
  const wk = weekKey();
  const [done, setDone] = useState(() => loadJSON("v8.review", {}));
  const [memo, setMemo] = useState(() => localStorage.getItem("v8.review.memo") || "");
  useEffect(() => { localStorage.setItem("v8.review", JSON.stringify(done)); }, [done]);
  useEffect(() => { localStorage.setItem("v8.review.memo", memo); }, [memo]);
  const cur = done[wk] || {};
  const toggle = (k) => setDone(o => ({ ...o, [wk]: { ...(o[wk] || {}), [k]: !cur[k] } }));
  const nDone = REVIEW_STEPS.filter(([k]) => cur[k]).length;
  const live = market.live || {};
  const risky = (pos || []).map(p => stocks[p.t]).filter(s => s && s.stLine && s.stSlow === 1 && (lossOf(s) ?? 99) < 5);   // 선까지 −5% 이내
  const out = (pos || []).filter(p => p.role !== "long" && stocks[p.t]?.stSlow === 0);
  const VAL = { "pull:kr": ["눌림 🇰🇷"], "pull:us": ["눌림 🇺🇸"], "strong:us": ["강세 🇺🇸"], "strong:kr": ["강세 🇰🇷"], "buy:kr": ["추세 🇰🇷"], "buy:us": ["추세 🇺🇸"] };
  const drift = live.drift;
  return (
    <>
      <WeeklyPick stocks={stocks} market={market} sizer={sizer} openStock={openStock} setTab={setTab} pos={pos} today={today} />
      <Sec right={(() => { const a = new Date(wk + "T00:00:00Z"), b = new Date(a.getTime() + 6 * 86400000);
        const f = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; return `${nDone}/${REVIEW_STEPS.length} 완료 · ${f(a)}(토)~${f(b)} 주`; })()}>이번 주 점검</Sec>
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
                · 선까지 −5% 이내 {risky.length}{risky.length ? `: ${risky.slice(0, 3).map(s => s.t).join(", ")}` : ""}
                <button onClick={() => setTab("track")} style={{ ...linkBtn, fontSize: FS.xs, minHeight: 34, marginLeft: 6 }}>내 종목 ›</button></div>}
              {k === "decide" && <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="예: 그대로 유지 / 한국 비중 줄임"
                style={{ ...inp("100%"), marginTop: 6, fontSize: 14 }} />}
            </div>
          </div>))}
        <div style={{ fontSize: FS.xs, color: C.muted, padding: "8px 0 4px" }}>매월 1거래일에는 DC 탭도 함께 · 체크는 이 기기에 저장</div>
      </Card>

      {live.review?.exited > 0 && (
        <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 8 }}>
          파이프라인 집계: 이탈 {live.review.exited}건 · 규칙 손익 평균 {pct(live.review.ruleAvg, 1)} · 판 뒤 더 떨어진 비율 {live.review.savedPct}%</div>)}
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

      <RecentSignals siglog={siglog} stocks={stocks} openStock={openStock} market={market} />
      <SignalReview siglog={siglog} stocks={stocks} market={market} openStock={openStock} />

      <TradeLog trades={trades} setTrades={setTrades} />
      <SettingsHub sizer={sizer} setTab={setTab} syncState={syncState} onShowRules={onShowRules} />

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

/* ══════════════ 68·69. 보유 합계 — 시장별 (달러는 달러, 원은 원) ══════════════ */
function holdSums(pos, stocks) {
  const out = { us: { inv: 0, val: 0, n: 0 }, kr: { inv: 0, val: 0, n: 0 } };
  for (const p of pos || []) {
    if (p.role === "etf") continue;
    const m = mktOfT(p.t), s = stocks[p.t];
    out[m].inv += investedOf(p); out[m].val += valueOf(p, s); out[m].n += 1;
  }
  return out;
}
function HoldTotals({ pos, stocks, fx, only = "all" }) {
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
      {only === "all" && parts.length === 2 && fx && (() => {
        const inv = t.kr.inv + t.us.inv * fx, val = t.kr.val + t.us.val * fx, pl = inv ? (val / inv - 1) * 100 : 0;
        return <div style={{ display: "flex", gap: 8, fontSize: FS.xs, color: C.dim, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>
          합계(원화 환산) <b style={{ fontFamily: MONO, color: C.text }}>{money(val, "kr")}</b><b style={{ marginLeft: "auto", fontFamily: MONO, color: col(pl) }}>{pct(pl, 1)}</b></div>; })()}
      <div style={{ fontSize: 10, color: C.muted }}>평가 = 앱의 마지막 종가 기준 · ETF 제외</div>
    </div>);
}

/* ══════════════ 💰 전체 투자금 ══════════════ */
function PlanCard({ sizer, bumpSizer, pos, stocks }) {
  const [p, setP] = useState(loadPlan);
  const [open, setOpen] = useState(() => !planAmounts(loadPlan(), 1));
  const save = (np) => {
    const pa = planAmounts(np, sizer.fx); const d = new Date().toISOString().slice(0, 10);
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
            ["🇰🇷 직투", money(pa.kr, "kr"), `${p.slotsKr}칸 · ${money(pa.limKr, "kr")}`], ["💤 대기", money(pa.cash, "kr"), `${pa.pct.cash}%`]].map(([l, v, sub], i) => (
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
          <Row k="dcAmt" label="🏦 DC" unit="원" m="kr" sub="듀얼 모멘텀" />
          <Row k="usAmt" label="🇺🇸 직투" unit="$" m="us" sub={sizer.fx && p.usAmt ? `≈ ${money(p.usAmt * sizer.fx, "kr")} (환율 ${sizer.fx.toFixed(0)})` : "달러로 입력"} />
          <Row k="krAmt" label="🇰🇷 직투" unit="원" m="kr" sub="눌림" />
          <Row k="cashAmt" label="💤 대기" unit="원" m="kr" sub="예금·예비금" />
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

/* ══════════════ 74. 메모·목표가 상자 (차트 화면) ══════════════ */
function NoteBox({ s, note, setNote }) {
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

/* ══════════════ 79. ⚙ 설정 모음 — 흩어진 설정을 한 곳에서 보고, 바꿀 곳으로 바로 이동 ══════════════ */
function SettingsHub({ sizer, setTab, syncState, onShowRules }) {
  const [rev, setRev] = useState(getRevMin);
  const plan = loadPlan(); const pa = sizer?.plan;
  const dcMode = localStorage.getItem("v9.dc.mode") === "dual" ? "듀얼 모멘텀" : "느린ST 규칙";
  const Row = ({ k, v, go, label }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: `1px solid ${C.border}` }}>
      <span style={{ fontSize: FS.sm, width: 92, flexShrink: 0 }}>{k}</span>
      <span style={{ fontSize: FS.sm, color: C.dim, flex: 1, minWidth: 0, ...ONE }}>{v}</span>
      {go && <button onClick={go} style={{ ...linkBtn, fontSize: FS.xs, minHeight: 32, flexShrink: 0 }}>{label || "바꾸기"} ›</button>}
    </div>);
  return (
    <>
      <Sec>⚙ 설정 모음</Sec>
      <Card style={{ padding: "2px 12px 6px" }}>
        <Row k="💰 투자금" v={pa ? `${money(pa.total, "kr")} · DC ${money(pa.dc, "kr")} · 🇺🇸 ${money(pa.us, "us")} · 🇰🇷 ${money(pa.kr, "kr")}` : "미설정"} go={() => setTab("track")} />
        <Row k="칸 수" v={`🇺🇸 ${plan.slotsUs || 5}칸 · 🇰🇷 ${plan.slotsKr || 3}칸 (권장 🇺🇸 7 · 🇰🇷 5 — 매뉴얼 1-1장)`} go={() => setTab("track")} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: `1px solid ${C.border}` }}>
          <span style={{ fontSize: FS.sm, width: 92, flexShrink: 0 }}>매출 필터</span>
          <select value={rev} onChange={e => { const v = Number(e.target.value); setRev(v); try { localStorage.setItem(REV_KEY, String(v)); } catch {} settingsChanged(); }}
            style={{ ...inp("100%"), flex: 1, padding: "6px 8px" }}>
            {[[0, "끔"], [5, "+5% 이상"], [10, "+10% 이상 (기본)"], [20, "+20% 이상"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <Row k="🏦 DC 규칙" v={dcMode} go={() => setTab("alloc")} />
        <Row k="🔔 자동 연결" v={syncState?.ok === false ? `⚠ 실패 · ${syncState.msg || ""}` : `연결됨${syncState?.at ? ` · ${syncState.at}` : ""}`} go={() => setTab("track")} label="보기" />
        <Row k="종목 추가·빼기" v="검색창에서 추가 · 종목풀 탭에서 빼기" go={() => setTab("pool")} label="종목풀" />
        <Row k="📌 원칙" v="주 1회 확인" go={onShowRules} label="다시 보기" />
      </Card>
    </>);
}

/* ══════════════ 📦 종목풀 — 주 1회 자동 교체 + 수동 추가·빼기·즉시 교체 ══════════════ */
function PoolTab({ snap, uni, list, openStock, watch, pos, extras, setExtras, trades, market }) {
  const [q, setQ] = useState("");
  const [mkt, setMkt] = useState("all");
  const [limit, setLimit] = useState(40);
  const [excl, setExcl] = useState(() => loadJSON("v10.excludes", []));
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { localStorage.setItem("v10.excludes", JSON.stringify(excl)); settingsChanged(); }, [excl]);
  const h = snap?.meta?.health || {};
  const prot = new Set([...(pos || []).map(p => p.t), ...(watch || []), ...(extras || [])]);
  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return list.filter(s => (mkt === "all" || s.m === mkt) && (!qq || s.t.toLowerCase().includes(qq) || (s.n || "").toLowerCase().includes(qq)))
               .sort((a, b) => (b.tv ?? 0) - (a.tv ?? 0));
  }, [list, q, mkt]);
  const sync = async (nextExtras, nextExcl) => {       // 서버(watchlist.json)에 추가·빼기 목록 저장 → 다음 수집부터 반영
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/watchlist", { method: "POST",
        headers: { "Content-Type": "application/json", "x-key": localStorage.getItem("v52.rkey") || "" },
        body: JSON.stringify({ bulk: true, positions: pos, watch, extras: nextExtras, excludes: nextExcl, trades: (trades || []).slice(-100) }) });
      const j = await r.json().catch(() => ({}));
      setMsg(j.ok ? { t: "저장됨 — 다음 수집부터 반영 (지금 반영하려면 아래 '지금 종목풀 교체')" } : { t: j.message || j.error || "저장 실패 — 이 기기에만 기록됨", bad: true });
    } catch { setMsg({ t: "네트워크 오류 — 이 기기에만 기록됨", bad: true }); }
    setBusy(false);
  };
  const remove = (t) => {
    if (prot.has(t)) { alert(`${t} 는 보유·관심·추가 목록에 있어 뺄 수 없습니다. 먼저 거기서 빼세요.`); return; }
    const next = [...new Set([...excl, t])]; setExcl(next); sync(extras, next);
  };
  const unRemove = (t) => { const next = excl.filter(x => x !== t); setExcl(next); sync(extras, next); };
  const unAdd = (t) => { const next = (extras || []).filter(x => x !== t); setExtras(next); sync(next, excl); };
  const runNow = async () => {
    if (!confirm("지금 종목풀을 새로 뽑고 전체를 다시 계산합니다 (30~40분). 진행할까요?")) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/refresh?wf=data", { method: "POST", headers: { "x-key": localStorage.getItem("v52.rkey") || "" } });
      const j = await r.json().catch(() => ({}));
      setMsg({ t: j.ok ? (j.already ? "이미 실행 중입니다" : "시작 — 30~40분 뒤 새 종목풀로 바뀝니다") : (j.msg || "실행하지 못했습니다"), bad: !j.ok });
    } catch { setMsg({ t: "네트워크 오류", bad: true }); }
    setBusy(false);
  };
  return (
    <>
      <Card style={{ marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: FS.md, fontWeight: 800 }}>지금 종목풀</span>
          <span style={{ fontSize: FS.xs, color: C.muted }}>
            {h.mode === "focus" ? `감시 중 ${list.length} · 전체 ${h.fullUniverse ?? "—"}` : `${list.length}종목`} (🇰🇷 {list.filter(s => s.m === "kr").length} · 🇺🇸 {list.filter(s => s.m === "us").length})</span>
        </div>
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 4, lineHeight: 1.7 }}>
          <b style={{ color: C.text }}>입구 기준</b> (매주 토요일 자동 교체 · 출처: 한투 공식 종목 마스터 · 나스닥 스크리너 · S&P500 목록)<br />
          🇰🇷 보통주 · 거래정지/정리매매/관리종목/투자경고 제외 · 시총 3,000억↑ → 거래대금 상위 150 + 시총 상위 150 (≈200)<br />
          🇺🇸 S&P500 + (시총 $25B↑ · 거래대금 $50M↑) — 밈주식·코인채굴·테마 ETF·소형주 제외 (≈645)<br />
          매일: 20일 평균 하루 거래대금 🇰🇷 30억↑ · 🇺🇸 $30M↑ · 🇰🇷 거래정지 등은 그날 바로 제외 · 보유·관심·추가는 보호
        </div>
        {(() => {
          const dr = h.dropped || {}; const ee = uni?.entryExcluded || {};
          const parts = Object.entries(dr).filter(([, v]) => v > 0);
          const kr = Object.entries(ee.kr || {}), us = Object.entries(ee.us || {});
          return (parts.length || kr.length || us.length) ? (
            <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 6, padding: "6px 8px", borderRadius: 7, background: "rgba(255,255,255,.03)", lineHeight: 1.6 }}>
              {parts.length > 0 && <>오늘 제외: {parts.map(([k, v]) => `${k} ${v}`).join(" · ")}<br /></>}
              {kr.length > 0 && <>주간 입구 🇰🇷: {kr.map(([k, v]) => `${k} ${v}`).join(" · ")}<br /></>}
              {us.length > 0 && <>주간 입구 🇺🇸: {us.map(([k, v]) => `${k} ${v}`).join(" · ")}</>}
            </div>) : null;
        })()}
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          <button onClick={runNow} disabled={busy} style={{ ...btn(C.gold), width: "100%" }}>🔁 종목풀 교체 (주간 수집 즉시 · 30~40분)</button>
          {msg && <div style={{ fontSize: FS.xs, color: msg.bad ? C.red : C.emerald }}>{msg.t}</div>}
          <RefreshBtn />
          <FinRefreshBtn />
          <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.6 }}>
            마지막: 종목풀 {uni?.date?.slice(0, 10) || "—"} · 시세 {snap?.meta?.generatedKST || "—"} · 재무 {snap?.meta?.finUpdated || "—"}
          </div>
        </div>
      </Card>

      {uni && (
        <Card style={{ marginTop: 8 }}>
          <div style={{ fontSize: FS.md, fontWeight: 800 }}>지난 교체 <span style={{ fontSize: FS.xs, color: C.muted, fontWeight: 400 }}>{uni.date} · {uni.prevTotal} → {uni.total}</span></div>
          {uni.added?.length > 0 && <div style={{ fontSize: FS.sm, marginTop: 6 }}><b style={{ color: C.emerald }}>＋{uni.added.length}</b> <span style={{ color: C.dim }}>{uni.added.slice(0, 20).map(x => x.n).join(", ")}{uni.added.length > 20 ? " …" : ""}</span></div>}
          {uni.removed?.length > 0 && <div style={{ fontSize: FS.sm, marginTop: 4 }}><b style={{ color: C.red }}>−{uni.removed.length}</b> <span style={{ color: C.dim }}>{uni.removed.slice(0, 20).map(x => x.n).join(", ")}{uni.removed.length > 20 ? " …" : ""}</span></div>}
          {!uni.added?.length && !uni.removed?.length && <div style={{ fontSize: FS.sm, color: C.muted, marginTop: 4 }}>변경 없음</div>}
        </Card>)}

      <Card style={{ marginTop: 8 }}>
        <div style={{ fontSize: FS.md, fontWeight: 800 }}>수동 추가·빼기</div>
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 2 }}>추가는 순위와 무관하게 계속 유지 · 빼기는 순위에 들어도 수집하지 않음</div>
        <div style={{ marginTop: 8 }}>
          <b style={{ fontSize: FS.sm, color: C.emerald }}>＋ 추가 {(extras || []).length}</b>
          {(extras || []).length === 0 ? <span style={{ fontSize: FS.xs, color: C.muted }}> — 상단 🔍 검색에서 없는 종목을 찾으면 "종목풀에 추가"</span> :
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>{extras.map(t =>
              <button key={t} onClick={() => unAdd(t)} style={{ ...btn(C.dim), minHeight: 32, padding: "0 10px" }}>{t} ✕</button>)}</div>}
        </div>
        <div style={{ marginTop: 10 }}>
          <b style={{ fontSize: FS.sm, color: C.red }}>− 빼기 {excl.length}</b>
          {excl.length === 0 ? <span style={{ fontSize: FS.xs, color: C.muted }}> — 아래 목록에서 − 를 누르면 빠집니다</span> :
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>{excl.map(t =>
              <button key={t} onClick={() => unRemove(t)} style={{ ...btn(C.dim), minHeight: 32, padding: "0 10px" }}>{t} 되돌리기</button>)}</div>}
        </div>
      </Card>

      <Sec right={`${rows.length}종목 · 하루 거래대금(20일 평균) 큰 순`}>종목 목록</Sec>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 6 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름·티커 검색" style={inp("100%")} />
        <Seg value={mkt} onChange={setMkt} items={[["all", "전체"], ["kr", "🇰🇷"], ["us", "🇺🇸"]]} />
      </div>
      <Card style={{ padding: "0 10px", marginTop: 8 }}>
        {rows.slice(0, limit).map(s => (
          <div key={s.t} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0", borderBottom: `1px solid ${C.border}`, opacity: excl.includes(s.t) ? .4 : 1 }}>
            <div onClick={() => openStock(s.t)} style={{ flex: 1, minWidth: 0, cursor: "pointer", ...ONE }}>
              <b style={{ fontFamily: MONO }}>{s.t}</b> <span style={{ fontSize: FS.xs, color: C.dim }}>{shortName(s.n)}</span>
              {prot.has(s.t) && <span style={{ fontSize: 10.5, color: C.cyan }}> 보호</span>}
            </div>
            <ActionTag s={s} />
            <span style={{ fontSize: FS.xs, color: C.muted, width: 64, textAlign: "right", flexShrink: 0, lineHeight: 1.1 }}><span style={{ display: "block", fontSize: 9 }}>하루 거래</span>{money(s.tv, s.m)}</span>
            {excl.includes(s.t)
              ? <button onClick={() => unRemove(s.t)} aria-label="되돌리기" style={{ ...btn(C.dim), minHeight: 32, width: 36, padding: 0 }}>↺</button>
              : <button onClick={() => remove(s.t)} aria-label="빼기" style={{ ...btn(C.dim), minHeight: 32, width: 36, padding: 0 }}>−</button>}
          </div>))}
        {rows.length > limit && <button onClick={() => setLimit(l => l + 40)} style={{ ...btn(C.dim), width: "100%", margin: "8px 0" }}>더 보기 ({limit} / {rows.length})</button>}
      </Card>
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
