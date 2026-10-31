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
import { pickToday, SLOTS_DEFAULT, KR_GATE_WHY } from "./picks.js";
import { planFills, applyFills } from "./fills.js";
import {
  ComposedChart, Line, Area, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot,
} from "recharts";

export const APP_VERSION = "v13.19.0";

/** 135. 수집 데이터에 남아 있던 "&amp;" 를 "&" 로 (예: Procter &amp; Gamble). 파이프라인이 고친 뒤에는 할 일이 없어 그냥 지나갑니다 */
const getJson = (url) => fetch(url).then(r => r.ok ? r.text().then(t => JSON.parse(t.includes("&amp;") ? t.replace(/&amp;/g, "&") : t)) : null);

/* ★ 한투 (1/2) — 증권사 계좌 카드(조회 · 매수 제안 · 주문 · 기본 메리츠, BROKER 환경변수로 바꿈). 빼려면: 이 두 줄 + 아래 "★ 한투 (2/2)" 한 줄 + src/Kis.jsx + api/broker.js + api/_lib/ */
const KisPanel = React.lazy(() => import("./Kis.jsx"));
const OrderSheet = React.lazy(() => import("./OrderSheet.jsx"));      // 210. 주문 창 하나
import { openOrder, nextOpen } from "./order.js";
import { AboutCard, AboutLine, SchedLine, WeekSched, pastEarnTxt } from "./Info.jsx";

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
/** 오늘 날짜 (한국 시간) — 매수·매도 기록 날짜에 씁니다. 예전엔 UTC 날짜라 오전 9시 전 기록이 하루 전으로 찍혔습니다 */
const kstDay = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
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
  // ★ 1회차를 산 뒤의 종가여야 함 — 산 날 밤 데이터가 아직 그 전날 종가면 '+3% 마감'을 확인한 게 아님 (검증도 매수 다음 종가부터)
  const after = !s.asOf || !tr[0].d || String(s.asOf) > String(tr[0].d).slice(0, 10);
  const chase = after && s.c > cap;
  // 103. 2회차 금액 = 1회차에 넣은 금액 (투자금을 나중에 바꿔도 '나머지 절반'이 1회차와 같게). 1회차 금액이 없으면 지금 한도의 절반
  const amt = tr[0].amt > 0 ? tr[0].amt : limit * 0.5;
  return { target, cap, gain, chase, after, ok: after && s.c >= target && !chase && s.stSlow === 1, amt, pctToGo: (target / s.c - 1) * 100 };
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
    ["매수! (강세)", "🇺🇸🇰🇷 같은 추세 조건 + RSI 60 이상. 주도주는 눌림을 잘 안 주고 강한 채로 가서, 미국은 세 구간 모두 보유를 이김 · 한국도 눌림과 같이 쓰면 추세만보다 나음(180)"],
    ["매수! (추세)", "슈퍼트렌드 3개 초록 + 구름 위 + RS 70↑. 눌림·강세보다 늦지만 확인된 뒤"],
    ["매도!", "들고 있는 종목의 종가가 트레일링선(느린 슈퍼트렌드 12,3) 아래로 마감. 유일한 매도 기준. 안 들고 있으면 '관망 (추세 이탈)'로 표시"],
    ["관망", "위 어느 것도 아님"],
    ["RS", "같은 시장 6개월 수익률 순위 백분위. 100이 최고, 70↑ 주도주"],
    ["나스닥比 +9p", "이 종목 1달 수익 − 비교 지수 1달 수익 (%p). 🇰🇷 코스피 · 나스닥 상장 종목은 나스닥 · 그 외 미국은 S&P500. 위 고정 바에 세 지수가 다 있음"],
    ["20일선 이격", "검증: '많이 달린 종목을 피하고 20일선 가까이서만 사기'는 미국에서 성과를 깎았음(연 32.6→24.0%). 매수!면 그냥 산다"],
    ["선까지 −N%", "지금 가격에서 트레일링선까지 떨어지면 잃는 폭. 앱 전체(찾기·차트·내 종목·텔레그램)가 같은 뜻으로 씀. '선 아래'면 이미 매도 구간"],
    ["3일·5일·1달", "누적 등락. 위 고정 바의 지수 숫자와 같은 열"],
    ["살 것 / 1주 한 번에", "오늘 살 것에 든 종목. 한도의 절반으로 1주도 안 되면 '1주 한 번에'. 주수는 차트의 1회차 매수 등록·계좌 주문에서 보여 줍니다"],
    ["하루 거래 $5.2B", "최근 20거래일 평균 하루 거래대금"],
    ["RSI 62(3일↑)", "RSI(14일) 값과 3일 전보다 올랐는지(↑)·내렸는지(↓). 참고용 — 검증에서 '상승 중'은 효과 없음"],
    ["RS 100", "같은 시장 종목 중 최근 6개월 수익률 순위(백분위). 100이 1등, 70 이상 = 주도주"],
    ["애널 목표까지 +22%", "내 목표가(차트에서 적음) 또는 🇺🇸 애널리스트 평균 목표가까지 남은 거리 = 목표 ÷ 현재가 − 1. 참고용 — 목표 도달은 매도 신호가 아님"],
    ["📝", "내가 적은 메모가 있는 종목"],
    ["강도 88", "RS 백분위와 200일선 거리 백분위의 평균(0~100). 매수! 중 무엇부터 살지 정하는 점수 — '강한 것 중 더 강한 것'. 규칙을 2010–18에서 정하고 2019–26에 적용해도 RS 순·업종 순보다 나았음"],
    ["전일 +2.7%", "직전 거래일 종가 대비 오늘(마지막) 종가"],
    ["업종 3위", "이 종목 업종의 섹터 ETF 순위 (미국만)"],
    ["매출 +16% 분기↑ · 흑자", "최근 분기 매출의 전년 동기 대비 (SEC 공시, ↑ = 직전 분기보다 성장 가속). 없으면 4분기 합계 → 연간. 미국만. 검증 불가라 조건이 아닌 취향 필터 — 한국·재무 없는 종목은 통과"],
    ["예비", "관찰용. rising = 추세 유지·RS 55~70·1달 시장대비 + / turn = 느린ST 초록 전환 3일 이내. 검증에서 현행을 못 이겨 매수!로 쓰지 않음"],
    ["○ 확인함", "누르면 회색으로 맨 아래. 그 주 동안 유지"],
    ["🆕 9/24 종가 · 9/24 첫 신호", "매수! 조건이 처음 켜진 종가 날짜 (실전 장부 기준). 그 뒤 중간에 꺼졌다 다시 켜졌을 수도 있어서 '며칠째'로 세지 않습니다. 미국 종가는 한국 아침에 들어오므로 달력 날짜보다 하루 앞설 수 있음. 20거래일 넘으면 표시 없음"],
    ["📅 실적 D-3", "다음 실적 발표까지 남은 날 (그 시장 현지 날짜 · 14일 안일 때만). (예상) = 회사가 아직 확정 안 한 날짜. 발표 전후엔 하루에 크게 움직일 수 있어 새로 살 때 참고 — 매수·매도 규칙은 그대로"],
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
  ["1줄", "DELL Dell Technologies ↗ 🆕 9/24 종가 ○ · $568.06 · 전일 −3.5% · ☆", "티커(한국은 이름) · 네이버 ↗ · 매수! 된 지 며칠째 · 확인함 ○ · 종가 · 전일 대비 · 관심 ☆"],
  ["2줄", "매수! (강세) · RS 100 · 1달 S&P比 +31p · +4.5% +0.1% +29.8%", "행동(근거) · 6개월 상대강도 순위 · 1달 수익 − 비교 지수 1달 수익 · 3일·5일·1달 누적(위 고정 바와 같은 열)"],
  ["3줄", "강도 88 · 선까지 −16% · 시총 $390B · 하루 거래 $5.2B · RSI 62(3일↑) · 업종 기술 2위 · 매출 분기 전년比 +58% · 흑자",
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
function StockRow({ s, rank, rel, sub, onOpen, isWatch, onToggle, dip = false, held = false, seen = false, onSeen, age, since, tag = null }) {
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
        {!dip && s.action === "buy" && age != null && <NewTag age={age} since={since} />}
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
          {tag && <span style={{ fontSize: 10.5, fontWeight: 700, color: tag[1], background: `${tag[1]}1f`, borderRadius: 5, padding: "1px 6px", flexShrink: 0, whiteSpace: "nowrap" }}>{tag[0]}</span>}
          <span style={{ fontSize: FS.xs, color: (rs ?? 0) >= 70 ? C.cyan : C.muted, flexShrink: 0 }}>RS<b style={{ fontFamily: MONO }}>{rs != null ? Math.floor(rs) : "—"}</b></span>
          {rel != null && <span style={{ fontSize: FS.xs, color: rel >= 0 ? C.emerald : C.red, minWidth: 0, ...ONE }}>
            1달 {benchName(s)}比<b style={{ fontFamily: MONO }}>{rel >= 0 ? "+" : ""}{rel.toFixed(0)}p</b></span>}
          {!dip && <EarnTag s={s} />}

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
// 166. 그 시장의 확정 종가가 실제로 빠졌을 때만 — 토요일 백업 수집이 늦는 것(lag)만으로는 띄우지 않음(금요일 종가는 이미 확정)
const StaleWarn = ({ info, m }) => (info && (m ? !(m === "kr" ? info.okKr : info.okUs) : !(info.okKr && info.okUs))) ? (
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
/** 109. 칸 = 동시에 들고 있을 종목 수 한도. 빈 칸 = 칸 수 − 지금 들고 있는 단기 종목 수 (앱 전체가 이 함수 하나를 씀) */
const slotInfo = (pos, m) => {
  const plan = loadPlan();
  const n = m === "us" ? (plan.slotsUs || SLOTS_DEFAULT.us) : (plan.slotsKr || SLOTS_DEFAULT.kr);
  const held = (pos || []).filter(p => (p.role || "swing") === "swing" && mktOfT(p.t) === m).length;
  return { n, held, free: Math.max(0, n - held) };
};
/** 109. 투자금 여유 — 그 시장에 이미 넣은 돈 + 이번 금액이 직투 금액을 넘지 않는지 (💰 투자금을 정했을 때만 따짐) */
const investedIn = (pos, m) => (pos || []).filter(p => p.role !== "etf" && mktOfT(p.t) === m).reduce((a, p) => a + investedOf(p), 0);
const budgetOf = (sizer, m) => sizer?.plan ? (m === "us" ? sizer.plan.us : sizer.plan.kr) : null;
const roomFor = (pos, sizer, m, amt) => { const b = budgetOf(sizer, m); return b == null || investedIn(pos, m) + amt <= b * 1.001; };
/** 87. 날짜 "2026-09-24" → "9/24" */
const md = (d) => d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : "";
/** 93. 실적 발표일 — 그 시장 현지 날짜로 D-n (🇺🇸 뉴욕 · 🇰🇷 서울). 참고용: 매매 규칙에는 쓰지 않음 (과거 발표일 자료가 없어 검증 불가) */
const localToday = (m) => { try { return new Date().toLocaleDateString("en-CA", { timeZone: m === "kr" ? "Asia/Seoul" : "America/New_York" }); } catch { return kstDay(); } };
const earnDays = (s) => { if (!s?.earn) return null; const n = Math.round((Date.parse(s.earn) - Date.parse(localToday(s.m))) / 864e5); return Number.isFinite(n) && n >= 0 ? n : null; };
const earnTxt = (s, within = 14) => { const n = earnDays(s); return (n == null || n > within) ? null : `실적 ${n === 0 ? "오늘" : "D-" + n}${s.earnE ? "(예상)" : ""}`; };
/** 105. 지금 가격 — 표시 전용 (매수!·매도! 는 종가로만). /api/quote 가 야후에서 20종목씩 묶어 받음 · 1분마다 · 화면 켜져 있을 때만 */
const ysym = (s) => s.m === "kr" ? s.t + (String(s.ex || "").startsWith(".") ? s.ex : ".KS") : String(s.t).replace(".", "-");
function useLive(list) {
  const key = [...new Set((list || []).filter(x => x && x.t && !x.etf).map(ysym))].sort().join(",");
  const [q, setQ] = useState({});
  useEffect(() => {
    if (!key) return;
    let stop = false;
    const load = async () => {
      if (document.hidden) return;
      try { const r = await fetch("/api/quote?s=" + encodeURIComponent(key)); const j = await r.json(); if (!stop && j.ok) setQ(j.q || {}); } catch {}
    };
    load();
    const id = setInterval(load, 60000);
    const vis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", vis);
    return () => { stop = true; clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [key]);
  return q;
}
const liveOf = (s, q) => {
  const v = s && q?.[ysym(s)];
  if (!v || !(v.p > 0) || !v.t) return null;
  const d = new Date(v.t * 1000).toLocaleDateString("en-CA", { timeZone: s.m === "kr" ? "Asia/Seoul" : "America/New_York" });
  const sess = s.m === "us" ? (v.s || "reg") : "reg";        // 203. 🇺🇸 pre(프리마켓) · reg(정규장) · post(애프터)
  // 앱 종가보다 새 값일 때만 — 같은 날이라도 장 마감 뒤 애프터 가격은 새 값 (예: 실적 발표 뒤 급락)
  if (s.asOf && (d < s.asOf || (d === s.asOf && sess !== "post"))) return null;
  const hm = new Date(v.t * 1000).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
  const ms = marketState();
  const fresh = Date.now() / 1000 - v.t < 60 * 60;          // 1시간 안의 체결
  const open = sess === "reg" && (s.m === "kr" ? ms.krRegular : ms.usRegular) && fresh;
  const when = sess === "pre" ? "프리마켓" : sess === "post" ? "애프터" : open ? "장중" : "마감";
  const base = s.c || v.pc;                                  // 앱 종가(판정 기준) 대비
  return { p: v.p, ch: base ? (v.p / base - 1) * 100 : null, hm, open, when, ext: sess !== "reg", below: !!(s.stLine && s.stSlow === 1 && v.p < s.stLine) };
};
const LiveTag = ({ s, q, short = false }) => {
  const L = liveOf(s, q); if (!L) return null;
  return (
    <span style={{ fontSize: 10.5, color: L.below ? C.gold : C.dim, fontWeight: L.below ? 700 : 400, whiteSpace: short ? "nowrap" : "normal" }}>
      지금 <b style={{ fontFamily: MONO, color: C.text }}>{price(L.p, s.m)}</b>{L.ch != null && <b style={{ fontFamily: MONO, color: col(L.ch) }}> {pct(L.ch, 1)}</b>}
      {short && <span style={{ color: C.muted }}> · {L.hm}</span>}
      {short && L.ext && <span style={{ color: C.muted }}> {L.when}</span>}
      {!short && <> · {L.hm} {L.when}{s.m === "kr" ? "(약 20분 지연)" : ""} · 앱 종가({md(s.asOf)}) 대비</>}
      {L.below && (short ? " ⚠선 아래" : " · ⚠ 지금 선 아래 — 매도는 마감 가격으로 판정")}
    </span>);
};
const EarnTag = ({ s, within = 14 }) => { const t = earnTxt(s, within); if (!t) return null;
  return <span style={{ fontSize: 10.5, fontWeight: 700, color: earnDays(s) <= 7 ? C.gold : C.muted, flexShrink: 0, whiteSpace: "nowrap" }}>📅 {t}</span>; };
/** 설정이 바뀌면 알림 — 자동 동기화가 듣습니다 (61) */
const settingsChanged = () => { try { window.dispatchEvent(new Event("v11:settings")); } catch {} };

/* ── 228. 서버(watchlist.json) 동기화 도구 ── */
const AUTO_FROM = "2026-10-31";        // 메리츠 체결 자동 반영은 이 날(미국 장 날짜) 이후 체결만 — 그 전 거래는 이미 정리한 기록
const SYNC_BASE = "v13.syncBase";      // 이 기기가 마지막으로 본 서버 저장 시각
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
/** 서버에 올리기 — 한 번에 하나씩(겹치면 서버가 '다른 기기'로 오해) · 마지막으로 본 서버 시각(base)을 같이 보냄 */
let SYNC_Q = Promise.resolve();
function postWatch(body) {
  const run = async () => {
    const b = typeof body === "string" ? JSON.parse(body) : body;
    const r = await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json", "x-key": localStorage.getItem("v52.rkey") || "" },
                                              body: JSON.stringify({ ...b, base: localStorage.getItem(SYNC_BASE) || "" }) });
    const j = await r.json().catch(() => ({}));
    if (j.ok && j.updatedAt) { try { localStorage.setItem(SYNC_BASE, j.updatedAt); } catch {} }
    return { r, j };
  };
  const p = SYNC_Q.then(run, run); SYNC_Q = p.catch(() => {}); return p;
}

/** 54. 전체 투자금 — 앱 전체의 돈 기준. 비율로 DC·🇺🇸·🇰🇷·대기로 나누고, 칸 수로 종목당 한도를 정합니다 */
const PLAN_KEY = "v11.plan";
// 계좌별 금액을 넣고 합계·비율은 계산 — DC 잔액·예수금은 이미 정해진 금액이라서 (56)
const PLAN_DEFAULT = { dcAmt: 0, usAmt: 0, krAmt: 0, cashAmt: 0, slotsUs: SLOTS_DEFAULT.us, slotsKr: SLOTS_DEFAULT.kr, hist: [] };   // 168. 기본 = 권장 7·5
const loadPlan = () => {
  const raw = loadJSON(PLAN_KEY, {});
  if (raw.total && raw.dcAmt == null) {           // v11.0 의 '총액 + 비율' 저장값을 금액으로 한 번 바꿔 둡니다
    const a = (k) => Math.round(raw.total * (raw[k] || 0) / 100);
    return { ...PLAN_DEFAULT, dcAmt: a("dc"), krAmt: a("kr"), cashAmt: a("cash"), usKrwOld: a("us"), slotsUs: raw.slotsUs || SLOTS_DEFAULT.us, slotsKr: raw.slotsKr || SLOTS_DEFAULT.kr };
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
/** 176. 한국 시장 '위험'(폭 3년 하위 40% 아래)이면 한국은 새로 사지 않음 — 오늘·찾기·한투·선정·파이프라인이 같은 판정을 씀 */
const krGateOf = (market) => !!(market?.judge?.kr?.gate && market.judge.kr.verdict === "risk");
/** '오늘 살 것' 설정 한 곳 — 칸 수·매출 필터·한국 게이트 */
const pickCfg = (market, plan = loadPlan()) => ({ revMin: getRevMin(), slotsUs: plan.slotsUs || SLOTS_DEFAULT.us, slotsKr: plan.slotsKr || SLOTS_DEFAULT.kr, krGate: krGateOf(market) });
/* ★ 한투 (보조) — 한투 카드의 "오늘 살 것"을 오늘 탭과 똑같이 고름 (이 기기의 보유·칸 수·매출 필터 기준). 빼려면 이 함수도 삭제 */
const kisPicks = (stocks, pos, genDay, fx, m = "us", market = null) => {
  if (!stocks || !Object.keys(stocks).length) return { list: [], note: "" };
  const plan = loadPlan();
  const dayOf = (p) => String(p.date || trOf(p)[0]?.d || "");
  const bought = new Set((pos || []).filter(p => (p.role || "swing") === "swing" && genDay && dayOf(p) >= genDay).map(p => String(p.t).toUpperCase()));
  const heldBefore = new Set((pos || []).map(p => String(p.t).toUpperCase()).filter(t => !bought.has(t)));
  const P = pickToday(stocks, pickCfg(market, plan), heldBefore);
  const all = (m === "kr" ? P.pickKr : P.pickUs).filter(r => !bought.has(r.t));
  if (m === "kr" && krGateOf(market)) return { list: [], note: "오늘 탭 기준: 한국 시장 위험 — 한국은 새로 사지 않습니다 (폭 3년 하위 40% 아래)" };
  const sl = slotInfo(pos, m), pa = planAmounts(plan, fx), flag = m === "kr" ? "한국" : "미국";
  if (!pa || !((m === "kr" ? pa.kr : pa.us) > 0))                       // 오늘 탭과 같은 판정 — 투자금 0이면 살 것 없음
    return { list: [], note: `오늘 탭 기준: ${flag} 투자금이 0이라 살 것이 없습니다`,
             test: m === "kr" && all.length ? { list: all.slice(0, Math.max(1, sl.free)), note: `모의 시험용: 한국 투자금이 0원이라 오늘 탭에는 없지만, 모의 계좌에서만 한국 추천 ${Math.min(all.length, Math.max(1, sl.free))}개를 보여 줍니다` } : null };
  const list = all.slice(0, sl.free);
  return { list, note: sl.free === 0 ? `오늘 탭 기준: 칸이 다 차서(보유 ${sl.held}/${sl.n}칸) 살 것이 없습니다` : all.length > list.length ? `오늘 탭 기준: 빈 칸 ${sl.free}개만큼만 · 대기 ${all.length - list.length}개는 빼고 보여 줍니다` : all.length === 0 ? "오늘 탭 기준: 조건에 맞는 종목이 없습니다" : "" };
};
const growthOf = (s) => s?.fin ? (s.fin.growth ?? s.fin.qyoy ?? s.fin.ttm ?? s.fin.rev ?? null) : null;   // 최근 분기 → 4분기 → 연간
const passRevOf = (s, revMin) => { const g = growthOf(s); return revMin <= 0 || s.m === "kr" || g == null || g >= revMin; };

/** 33·38. 종목 정보 외부 링크 — 전부 네이버 (🇰🇷 국내 · 🇺🇸 나스닥은 해외주식 페이지, 뉴욕은 네이버 검색) */
const infoUrl = (s) => {
  if (!s) return "#";
  if (s.m === "kr") return `https://m.stock.naver.com/domestic/stock/${s.t}/total`;
  if (NASDAQ.has(s.ex)) return `https://m.stock.naver.com/worldstock/stock/${s.t}.O/total`;     // 네이버 해외주식 (나스닥 = .O)
  return `https://m.stock.naver.com/worldstock/stock/${encodeURIComponent(s.t)}/total`;           // 198. 뉴욕 = 접미사 없이 (예: CVX)
};
const InfoLink = ({ s, style }) => (
  <a href={infoUrl(s)} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} aria-label="종목 정보 열기"
     style={{ color: C.muted, textDecoration: "none", fontSize: 13, padding: "0 4px", flexShrink: 0, ...style }}>↗</a>
);
/** 112. 트레이딩뷰 차트 — 확대·추세선·지표는 거기서 (앱 차트는 신호 확인용) */
const TV_EX = { NMS: "NASDAQ", NGM: "NASDAQ", NCM: "NASDAQ", NAS: "NASDAQ", NYQ: "NYSE", ASE: "AMEX", PCX: "AMEX" };
const tvUrl = (s) => "https://www.tradingview.com/chart/?symbol=" + encodeURIComponent(
  s.m === "kr" ? `KRX:${s.t}` : (TV_EX[s.ex] ? `${TV_EX[s.ex]}:` : "") + String(s.t).replace("-", "."));
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
  const secRank = s.sec && (market?.sectors || []).find(x => x.tk === s.sec);
  const f = s.fin;
  return [
    s.str != null ? `강도 ${s.str}` : null,                                  // RS + 200일선 거리 (0~100)
    s.stSlow === 1 && lossOf(s) != null ? `선까지 ${lossTxt(s)}` : null,     // 지금 사면 선에 닿을 때 잃는 폭
    s.mcap ? `시총 ${s.m === "kr" ? (s.mcap >= 10000 ? `${(s.mcap / 10000).toFixed(1)}조` : `${s.mcap.toLocaleString()}억`) : `$${s.mcap >= 1e12 ? (s.mcap / 1e12).toFixed(1) + "T" : (s.mcap / 1e9).toFixed(0) + "B"}`}` : null,
    `하루 거래 ${money(s.tv, s.m)}`,
    (() => { const tg = tgtOf(s.t, NOTES_REF.cur, s); const g = tg && tgtGap(tg.v, s.c);
             return g == null ? null : tg.mine ? (g <= 0 ? "내 목표 도달" : `내 목표까지 +${g.toFixed(0)}%`) : (g <= 0 ? "애널 목표보다 위" : `애널 목표까지 +${g.toFixed(0)}%`); })(),
    // 188. 몇 주 살 수 있는지는 고르는 단계에선 필요 없어 뺌 — 주수는 주문하는 곳(차트 1회차 등록·한투 주문·2회차 안내)에만
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
      const r = await fetch("/api/refresh?mode=quick", { method: "POST", headers: { "x-key": k } });   // 102. 약 5분 · 종목풀 교체 없음
      const txt = await r.text();
      let j; try { j = JSON.parse(txt); } catch {
        setMsg({ t: `갱신 서버 응답 오류 (${r.status})`, bad: true }); setBusy(false); return;
      }
      if (!j.ok) { setMsg({ t: j.msg || "실행하지 못했습니다", bad: true }); if (j.code === "BAD_KEY") setAsk(true); }
      else { setMsg({ t: j.already ? "이미 갱신 중" : "시작 · 약 5분" }); localStorage.setItem("v52.rkey", k); setKey(k); setAsk(false); poll(); }
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
  const [kisSync, setKisSync] = useState({});
  const [orderReq, setOrderReq] = useState(null);   // 210. 주문 창 — openOrder() 가 어디서든 엶
  useEffect(() => { const f = (e) => setOrderReq(e.detail ? { ...e.detail, k: Date.now() } : null); window.addEventListener("order-open", f); return () => window.removeEventListener("order-open", f); }, []);
  useEffect(() => { const f = () => { setChartOpen(false); setTab("track"); }; window.addEventListener("go-track", f); return () => window.removeEventListener("go-track", f); }, []);   // 221. 주문 창 '내 종목으로'       // 184. 한투 잔고·주문 (시장별) — 내 종목 '체결 반영'이 읽음
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
      const strong = up && (d.rsi ?? 0) >= 60;                 // 180: 한국도 강세
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
    return { bulk: true, positions: pos, watch, extras, excludes: loadJSON("v10.excludes", []), trades: (trades || []).slice(-300), notes,
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
  }, [pos, watch, extras, trades, cfgTick, notes, syncReady, conflict, syncRetry]);   // eslint-disable-line react-hooks/exhaustive-deps
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
              <KV k="데이터 생성" v={snap.meta.generatedKST} />
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
        <TabBasis tab={tab} stocks={stocks} market={market} snap={snap} siglog={siglog} uni={uni} />
        {tab === "market" && <MarketTab {...shared} onShowRules={() => setRulesOpen(true)} />}
        {tab === "alloc" && <DcTab {...shared} />}
        {tab === "find" && <FindHub {...shared} />}
        {tab === "review" && <ReviewTab {...shared} uni={uni} snap={snap} onShowRules={() => setRulesOpen(true)} />}
        {tab === "pool" && <PoolTab {...shared} snap={snap} uni={uni} />}
        {tab === "track" && <TrackTab {...shared} stocks={items} kisSync={kisSync} />}
        {tab === "track" && <React.Suspense fallback={null}><KisPanel held={pos.map(p => p.t)} stocks={stocks} {...(({ list, note }) => ({ picks: list, pickNote: note }))(kisPicks(stocks, pos, genDay, market?.fx?.usdkrw || null, "us", market))} kr={kisPicks(stocks, pos, genDay, market?.fx?.usdkrw || null, "kr", market)} krOpen={() => marketState().krRegular} watch={watch} toggleWatch={toggleWatch} asOf={{ us: asOfOf(stocks, "us") || "", kr: asOfOf(stocks, "kr") || "" }} half={{ us: sizer.limit("us") / 2, kr: sizer.limit("kr") / 2 }} usOpen={() => marketState().usRegular} fx={market?.fx?.usdkrw || null} onSync={(x) => setKisSync(v => ({ ...v, [x.mk]: x }))} openStock={openStock} /></React.Suspense>}{/* ★ 한투 (2/2) */}
        {(tab === "market" || tab === "review") && <PracticeEntry />}{/* ★ 연습 (2/2) */}
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

/* 내 원칙 — 주 1회(토요일 기준) 앱을 열 때 먼저 뜹니다 */
/** 원칙 목록 — 4번은 앱에 구현된 매수·매도 규칙과 추적탭 설정값을 그대로 읽어 씁니다 */
const myRules = (sz) => [
  ["앱이 '매수!'라고 쓴 종목만 산다", "강세(RSI 60↑) · 🇰🇷 눌림(RSI 45 회복) · 추세(ST 3개 초록+구름 위). 뉴스·테마·감으로 사지 않는다"],
  [`절반 → 1회차 +3% 확인 후 나머지 절반 · +6% 넘게 올랐으면 추격 금지`,
   `종목당 한도 🇰🇷 ${sz ? money(sz.limKr, "kr") : "—"} · 🇺🇸 ${sz ? money(sz.limUs, "us") : "—"} · 고가 종목은 1주 한 번에`],
  ["매도는 '매도!' 하나 — 트레일링선 아래 마감. 그날 처리한다", "−3% 손절·고점 −5%·2주 타임컷은 검증에서 성과를 깎아 쓰지 않는다. 매도를 미루면 매수 타이밍 차이보다 비싸다"],
  [`🇰🇷는 시장 위험이면 새로 사지 않는다 · 🇺🇸는 ${usDST(Date.now()) ? "22:30" : "23:30"} 개장에 주문`, "한국 '위험'(폭 3년 하위 40% 아래)은 앱이 '오늘 살 것'에서 알아서 뺍니다. 원화 노출은 부동산으로 충분 — 한국을 한다면 09:30 이후에만"],
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
  const live = useLive(ps.map(p => stocks[p.t]));      // 105
  if (!ps.length) return null;
  return (
    <>
      <Step n="6" q="들고 있는 건?" right={<button onClick={() => setTab("track")} style={{ ...linkBtn, minHeight: 30, fontSize: FS.xs }}>내 종목 탭 ›</button>}>내 종목</Step>
      <Card style={{ padding: "8px 12px" }}>
        <HoldTotals pos={pos} stocks={stocks} fx={sizer?.fx} />
        {ps.map((p, i) => {
          const s = stocks[p.t]; const m = mktOfT(p.t);
          if (!s) return <div key={p.id} style={{ fontSize: FS.sm, padding: "6px 0", color: C.gold }}>⚠ {p.t} 데이터 없음 — 거래정지·상장폐지 확인</div>;
          const pl = (s.c / avgOf(p) - 1) * 100;
          const nx = p.role === "swing" ? nextTrancheOf(p, s, sizer.limit(m)) : null;
          const st = actionOf(s, true) === "sell" && p.role !== "long" ? ["매도!", C.red] : (nx?.ok && roomFor(pos, sizer, m, nx.amt)) ? ["2회차", C.emerald] : ["보유", C.cyan];
          return (
            <div key={p.id} onClick={() => openStock(p.t)} style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr) 62px 62px", gap: 6, alignItems: "center",
                                                                 padding: "7px 0", borderTop: `1px solid ${C.border}`, cursor: "pointer" }}>
              <span style={{ fontSize: FS.sm, fontWeight: 800, color: st[1] }}>{st[0]}</span>
              <span style={{ minWidth: 0, fontSize: FS.sm, ...ONE }}>{m === "us" ? "🇺🇸 " : "🇰🇷 "}{m === "kr" ? <b>{s.n}</b> : <b style={{ fontFamily: MONO }}>{p.t}</b>}</span>
              <span style={{ textAlign: "right", lineHeight: 1.1 }}><span style={{ display: "block", fontSize: 9, color: C.muted }}>평단 대비</span>
                <b style={{ fontSize: FS.sm, fontFamily: MONO, color: col(pl) }}>{pct(pl, 1)}</b></span>
              <span style={{ textAlign: "right", lineHeight: 1.1 }}><span style={{ display: "block", fontSize: 9, color: C.muted }}>선까지</span>
                <b style={{ fontSize: FS.sm, fontFamily: MONO, color: s.stSlow === 1 ? C.dim : C.red }}>{lossTxt(s)}</b></span>
              {liveOf(s, live) && <span style={{ gridColumn: "2 / -1", marginTop: -3 }}><LiveTag s={s} q={live} /></span>}
              {earnTxt(s, 7) && <span style={{ gridColumn: "2 / -1", fontSize: 10.5, color: C.gold, marginTop: -3 }}>📅 {earnTxt(s, 7)} — 발표 전후 크게 움직일 수 있음</span>}
            </div>);
        })}
      </Card>
    </>);
}

/** 159. 칸 머리 — 번호 · 제목 · 이 칸이 답하는 질문 (오늘 탭 흐름: 할 일 → 시장 → 위험 → 섹터 → 종목) */
const Step = ({ n, children, q, right }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 2px 8px" }}>
    {n && <span style={{ width: 22, height: 22, borderRadius: 6, background: C.text, color: C.bg, fontSize: FS.xs, fontWeight: 800, fontFamily: MONO,
                          display: "grid", placeItems: "center", flexShrink: 0 }}>{n}</span>}
    <span style={{ fontSize: 15, fontWeight: 800, color: C.text, whiteSpace: "nowrap" }}>{children}</span>
    {q && <span style={{ fontSize: FS.xs, color: C.muted, minWidth: 0, ...ONE }}>{q}</span>}
    {right && <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: FS.xs, color: C.muted }}>{right}</span>}
  </div>);
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
             <>다음 수집 🇰🇷 {nextCollect("kr")} · 🇺🇸 {nextCollect("us")}</>, "시세 야후 · 🇰🇷 거래대금 한투"],
    find: [basisDates(stocks, market), <>설정 {B(`🇺🇸 ${plan.slotsUs || SLOTS_DEFAULT.us}칸 · 🇰🇷 ${plan.slotsKr || SLOTS_DEFAULT.kr}칸 · 매출 ${getRevMin() > 0 ? `+${getRevMin()}%` : "필터 끔"}`)}</>,
           krGateOf(market) && <span style={{ color: C.red }}>🇰🇷 시장 위험 — 새로 안 삼</span>],
    track: [<>평가 {B(`앱의 마지막 종가 (🇺🇸 ${md(asOfOf(stocks, "us")) || "—"} · 🇰🇷 ${md(asOfOf(stocks, "kr")) || "—"})`)}</>, <>보유 기록 {B("메리츠 잔고 기준 · 서버 저장 (휴대폰·PC 같음)")}</>],
    alloc: [<>판단 {B(`🇺🇸 ${md(asOfOf(snap?.etfs, "us")) || "—"} · 🇰🇷 ${md(asOfOf(snap?.etfs, "kr")) || "—"} 종가`)} (미국은 원본 QQQ·SPY · 한국 KODEX 200)</>, market.allocation?.nextRebal && <>다음 비중 점검 {B(market.allocation.nextRebal)}</>],
    review: [sig.length > 0 && <>신호 기록 {B(`${md(sig[0])} ~ ${md(sig[sig.length - 1])} · ${sig.length}건`)}</>, <>시장 비교 {B("🇺🇸 S&P500 · 🇰🇷 코스피")}</>, <>검증값 {B("백테스트")}</>],
    pool: [uni?.date && <>종목풀 {B(`${md(uni.date.slice(0, 10))} 교체`)}</>, <>시세 {B(snap?.meta?.generatedKST?.slice(5) || "—")}</>, snap?.meta?.finUpdated && <>재무 {B(md(snap.meta.finUpdated))}</>,
           "출처: 한투 종목 마스터 · 나스닥 스크리너 · S&P500 목록 · 시세 야후"],
  }[tab];
  return items ? <Basis items={items} /> : null;
}
const basisDates = (stocks, market) => {
  const a = asOfOf(stocks, "us"), b = asOfOf(stocks, "kr");
  return <>신호 기준 <b style={{ color: C.text, fontWeight: 600 }}>🇺🇸 {md(a) || "—"} 종가 · 🇰🇷 {md(b) || "—"} 종가</b></>;
};

function MarketTab({ market, setTab, onShowRules, list, pos, stocks, items, sizer, openStock }) {
  const J = { safe: ["안전", C.emerald], warn: ["주의", C.gold], risk: ["위험", C.red] };
  const risk = market.risk || {};
  const spy21 = market.indices?.["^GSPC"]?.d21 ?? null;
  const sectors = market.sectors || [];
  const [hoursOpen, setHoursOpen] = useState(false);
  const [secView, setSecView] = useSticky("v13.market.secView", "ret");
  const [secOpen, setSecOpen] = useSticky("v13.market.secOpen", false);      // 섹터: 수익률 / PER·매수! 수
  const krGate = krGateOf(market);
  // 오늘 할 일 — 순서가 곧 루틴: ① 내 종목 매도 신호 ② 2회차 ③ 새로 살 것 ④ DC
  // 183. 할 일에 종목 이름을 바로 — 숫자만 보고 내 종목 탭까지 들어가지 않게
  const nm = (t) => mktOfT(t) === "kr" ? (stocks[t]?.n || t) : t;
  const sellL = (pos || []).filter(p => p.role !== "long" && stocks[p.t]?.action === "sell");
  const t2L = (pos || []).map(p => { if (p.role !== "swing") return null; const m = mktOfT(p.t), s = stocks[p.t];
    const nx = nextTrancheOf(p, s, sizer.limit(m)); return nx?.ok && roomFor(pos, sizer, m, nx.amt) ? { p, m, q: s?.c ? Math.max(1, Math.floor(nx.amt / s.c)) : null } : null; }).filter(Boolean);
  const sellN = sellL.length, t2N = t2L.length;
  const revMin = getRevMin();
  const buyAll = list.filter(x => x.action === "buy" && (x.tvr ?? 0) >= 40);
  const buyL = buyAll.filter(x => passRevOf(x, revMin));
  const heldT = new Set((pos || []).map(p => p.t));
  const buyN = buyL.filter(x => !heldT.has(x.t)).length;   // 132. 보유 종목은 '새 신호' 수에서 뺌 (찾기 탭과 같은 수)
  // 109. 오늘 실제로 살 수 있는 수 = 추천(찾기 탭 '오늘 살 것'과 같은 함수) 중 빈 칸만큼 · 투자금 0원인 시장은 0 · 176. 한국 시장 위험이면 0
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
  const drift = market.live?.drift;
  const brokerT = useBroker();                                                                   // 210. 오늘 살 것 → 바로 사기
  const slotNote = [["us", "🇺🇸"], ["kr", "🇰🇷"]].map(([m, f]) => todo3[m].z ? `${f} 투자금 0` : (m === "kr" && krGate) ? `${f} 시장 위험 — 새로 안 삼` : `${f} 빈 칸 ${todo3[m].free}/${todo3[m].n}`).join(" · ");
  const dcWait = (market.dc?.core || []).filter(c => c.state === "wait").length;
  // 99. DC 탭에서 고른 규칙으로 말함 (182: 3지수 보유면 1월 첫 거래일에만 할 일)
  const dcHold3 = dcModeOf() === "hold";
  const S = sessions(Date.now());
  const kst = new Date(Date.now() + 9 * 3600000), mins = kst.getUTCHours() * 60 + kst.getUTCMinutes(), wd = kst.getUTCDay() >= 1 && kst.getUTCDay() <= 5;
  const nowSeg = wd && ([...S.kr.map(x => ["🇰🇷 " + x[0], x[1], x[2]]), ...S.us.map(x => ["🇺🇸 " + x[0], x[1], x[2]])].find(([, a, b]) => inSpan(mins, a, b)) || null);
  const head = [sellN && `매도 ${sellN}건`, t2N && `2회차 ${t2N}건`, canBuy && `새로 ${canBuy}종목`].filter(Boolean);
  // 섹터별: 오늘 살 것 · 보유 · 매수! 수 (찾기 탭과 같은 기준)
  const buyBySec = {}; todo3.us.buy.forEach(r => { (buyBySec[r.sec] = buyBySec[r.sec] || []).push(r.t); });
  const heldBySec = {}; (pos || []).forEach(p => { const s = stocks[p.t]; if (s?.m === "us" && s.sec && p.role !== "etf") (heldBySec[s.sec] = heldBySec[s.sec] || []).push(p.t); });
  const nbOf = (tk) => buyL.filter(d => d.m === "us" && d.sec === tk).length;
  // 187. 지수 줄을 누르면 지수 차트 (파이프라인이 SPX · NASDAQ · KOSPI 이름으로 내보냄 — 아직 없으면 누르지 않음)
  const IDX_KEY = { "^GSPC": "SPX", "^IXIC": "NASDAQ", "^KS11": "KOSPI" };
  const idxRow = ([k, v]) => { const ck = IDX_KEY[k] && items?.[IDX_KEY[k]] ? IDX_KEY[k] : null; return (
    <div key={k} onClick={ck ? () => openStock(ck) : undefined} style={{ display: "grid", gridTemplateColumns: IDX_GRID6, gap: 6, alignItems: "center", padding: "8px 0", borderTop: `1px solid ${C.border}`, cursor: ck ? "pointer" : "default" }}>
      <b style={{ ...FIT_NAME, minWidth: 0, ...ONE }}>{v.label === "NASDAQ" ? "나스닥" : v.label === "KOSPI" ? "코스피" : v.label}{ck && <span style={{ color: C.muted, fontWeight: 400 }}> ›</span>}</b>
      <span style={{ ...FIT, fontWeight: 700, textAlign: "right" }}>{num(v.c, 0)}</span>
      {["d3", "d5", "d21"].map(x => <span key={x} style={{ ...FIT, textAlign: "right", color: col(v[x]) }}>{pctFit(v[x])}</span>)}
      <span style={{ ...FIT, textAlign: "right", fontWeight: 700, color: col(v.ma200p) }}>{pctFit(v.ma200p)}</span>
    </div>); };
  const MarketBlock = ({ m }) => {
    const j = market.judge?.[m]; if (!j || !J[j.verdict]) return null;
    const [t, c] = J[j.verdict]; const b = market.breadth?.[m];
    const rows = Object.entries(market.indices || {}).filter(([, v]) => v.market === m);
    const nq = market.indices?.["^IXIC"];
    return (
      <Card style={{ marginBottom: 8, borderColor: `${c}44` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <b style={{ fontSize: FS.lg }}>{m === "us" ? "🇺🇸 미국" : "🇰🇷 한국"}</b>
          <span style={{ fontSize: FS.sm, fontWeight: 800, color: c, background: `${c}1f`, border: `1px solid ${c}55`, borderRadius: 99, padding: "1px 10px" }}>{t}</span>
          <span style={{ marginLeft: "auto", fontSize: 10.5, color: C.muted, textAlign: "right" }}>판정 근거: {j.gate ? "폭 3년 하위 40%" : "지수 200일선 · 급락"}</span>
        </div>
        <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 5 }}>{j.why}</div>
        <div style={{ fontSize: FS.xs, marginTop: 2, color: j.gate ? (j.verdict === "risk" ? C.red : C.cyan) : C.muted, fontWeight: j.gate ? 700 : 400 }}>
          {j.gate ? (j.verdict === "risk" ? "→ 한국은 새로 사지 않음 · 가진 종목은 트레일링선대로" : "→ 한국 새로 사기 가능 (이 판정으로 정함)") : "→ 참고 — 매매 규칙 아님"}</div>
        <div style={{ marginTop: 6 }}>
          <Head cols={["지수", "종가", "3일", "5일", "1달", "200일선"]} grid={IDX_GRID6} />
          {rows.map(idxRow)}
        </div>
        {m === "us" && nq?.ma200p != null && (() => {     // 156. 나스닥 200일선 — 표시만 (백테스트 참고)
          const below = nq.ma200p < 0, run = nq.run200 != null ? Math.abs(nq.run200) : null;
          return <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 9, fontSize: FS.xs, lineHeight: 1.6,
                               background: below ? "rgba(245,158,11,.10)" : "rgba(255,255,255,.04)", border: below ? `1px solid ${C.gold}55` : "none", color: C.dim }}>
            {below ? <><b style={{ color: C.gold }}>⚠ 나스닥 200일선 아래 ({pct(nq.ma200p, 1)}{run ? ` · ${run}일째` : ""})</b> — 과거엔 이때 새로 사지 않는 편이 나았음</>
                   : <><b style={{ color: C.emerald }}>나스닥 200일선 위 ({pct(nq.ma200p, 1)}{run ? ` · ${run}일째` : ""})</b> — 아래로 내려가면 경고가 뜹니다</>}
            <span style={{ display: "block", color: C.muted }}>백테스트 참고(2010–26 · 7칸: 아래일 때 새로 안 사면 연 21.4% → 24.5%, 16년 중 13년 나음) · 매매 규칙 아님</span>
          </div>;
        })()}
        <BreadthBar b={b} c={c} />
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>폭 계산 {market.breadthAsOf ? md(market.breadthAsOf) : "—"} (토요일 전체 계산 · 평일엔 그 값)</div>
      </Card>);
  };
  const GoBtn = ({ to, children }) => (
    <button onClick={() => setTab(to)} style={{ ...btn(C.dim), flex: 1, minHeight: 44 }}>{children}</button>);
  return (
    <>
      {sizer?.plan && (
        <div onClick={() => setTab("track")} style={{ marginTop: 8, padding: "8px 12px", borderRadius: 10, background: C.panel, border: `1px solid ${C.border}`,
                                                       display: "flex", gap: 10, alignItems: "baseline", cursor: "pointer", fontSize: FS.xs, color: C.dim, ...ONE }}>
          <b style={{ fontSize: FS.md, color: C.text, fontFamily: MONO }}>💰 {money(sizer.plan.total, "kr")}</b>
          <span>DC {money(sizer.plan.dc, "kr")}</span><span>🇺🇸 {sizer.plan.us != null ? money(sizer.plan.us, "us") : "—"}</span>
          <span>🇰🇷 {money(sizer.plan.kr, "kr")}</span><span>대기 {money(sizer.plan.cash, "kr")}</span>
        </div>)}

      {/* ① 오늘 할 일 */}
      <Step n="1" q="오늘 뭘 하지?">오늘 할 일</Step>
      <Card style={{ padding: "4px 12px" }}>
        <div style={{ padding: "9px 0 7px", fontSize: FS.lg, fontWeight: 800 }}>
          {head.length ? head.join(" + ") : "오늘은 할 일이 없습니다"}
          {!sellN && head.length > 0 && <span style={{ fontSize: FS.xs, color: C.muted, fontWeight: 400 }}> · 팔 것 없음</span>}</div>
        {/* 217. 미국 시장 급락(지금) · 212. 규칙 재검토 경보 — 오늘 살 것보다 먼저 봄 */}
        {usHalt && <div role="alert" style={{ margin: "0 0 8px", padding: "8px 10px", borderRadius: 9, background: "rgba(255,69,58,.14)", border: `2px solid ${C.red}` }}>
          <b style={{ color: C.red }}>⚠ 미국 시장 급락 중 — 매수 보류</b>
          <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 2 }}>{usHalt.txt} ({usHalt.when} · 기준 −2%) · 매도는 그대로</div></div>}
        {drift?.flag && <button onClick={() => setTab("review")} style={{ display: "block", width: "100%", textAlign: "left", margin: "0 0 8px", padding: "8px 10px", borderRadius: 9, cursor: "pointer",
                                          background: "rgba(255,69,58,.08)", border: `1px solid ${C.red}88`, color: C.text }}>
          <b style={{ color: C.red, fontSize: FS.sm }}>🚨 규칙 재검토 경보</b> <span style={{ fontSize: FS.xs, color: C.dim }}>{drift.reasons.join(" · ")} — 최근 신호가 시장보다 못함. 사기 전에 점검 탭 확인 ›</span></button>}
        {[
          ["1", sellN ? `매도! ${sellL.map(p => nm(p.t)).join(" · ")}` : "매도! 0건", sellN ? "트레일링선 아래 마감 — 개장 때 전량 매도 · 미루지 않기" : "없음", "track", sellN ? C.red : C.muted],
          ["2", t2N ? `2회차 ${t2L.map(x => nm(x.p.t)).join(" · ")}` : "2회차 0건", t2N ? `1회차 +3~6% 마감 — 나머지 절반 · ${t2L.map(x => `${nm(x.p.t)} ${x.q ?? "—"}주`).join(" · ")}` : "없음", "track", t2N ? C.emerald : C.muted],
          canBuy > 0
            ? ["3", `오늘 살 것 ${canBuy}개 (🇺🇸 ${todo3.us.can} · 🇰🇷 ${todo3.kr.can})`, `${[...todo3.us.buy, ...todo3.kr.buy].map(r => nm(r.t)).join(" · ")} — 아래 5번 · ${slotNote}`, "find", C.emerald]
            : ["3", "새로 살 것 없음", `${slotNote} · 매수! 신호 ${buyN}건은 참고`, "find", C.muted],
          dcHold3 ? ["4", "DC 그대로 보유", "3지수 보유 · 1년에 한 번(1월 첫 거래일) 비중만 맞춤", "alloc", C.dim]
                 : ["4", `DC ${dcWait === 0 ? "모두 보유" : dcWait === (market.dc?.core || []).length ? "모두 대기(안전자산)" : `${(market.dc?.core || []).filter(c => c.state === "wait").map(c => c.label.replace(/^(미국|한국) /, "")).join("·")} 대기`}`, "느린ST · 색이 바뀌면 알림", "alloc", C.dim],
        ].map(([n, t, sub, to, c]) => (
          <button key={n} onClick={() => setTab(to)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                  background: "none", border: "none", borderTop: `1px solid ${C.border}`, padding: "10px 0", cursor: "pointer", color: C.text }}>
            <span style={{ width: 22, height: 22, borderRadius: 11, background: `${c}22`, color: c, fontSize: FS.xs, fontWeight: 800, display: "grid", placeItems: "center", flexShrink: 0 }}>{n}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: FS.md, fontWeight: 700, ...ONE }}>{t}</div>
              <div style={{ fontSize: FS.xs, color: C.muted }}>{sub}</div>
            </span>
            <span style={{ color: C.muted }}>›</span>
          </button>))}
      </Card>

      {/* ② 시장 상태 — 157. 지수 숫자를 여기로 · 156. 나스닥 200일선 · 171. 폭 계산 날짜 */}
      <Step n="2" q="사기 전에 — 시장은?">시장 상태</Step>
      <MarketBlock m="us" />
      <MarketBlock m="kr" />
      <div style={{ fontSize: 10.5, color: C.muted, margin: "0 2px", lineHeight: 1.6 }}>
        폭 = 200일선 위 종목 비율 · 세로 흰 선 = 3년 중 오늘 위치 · 옅은 선 = 기준 40 · DC(ETF 배분)는 이 판정을 쓰지 않고 느린ST로만 판단</div>

      {/* ③ 위험 지표 */}
      <Step n="3" q="숨은 경고는?" right="미국 · 종가 기준">위험 지표</Step>
      {risk["^TNX"] && risk["^TNX"].c >= 5 && (risk["^TNX"].d21p ?? 0) > 0 && (
        <div style={{ marginBottom: 6, padding: "8px 10px", borderRadius: 9, background: "rgba(245,158,11,.10)", border: `1px solid ${C.gold}55`, fontSize: FS.xs, color: C.dim, lineHeight: 1.6 }}>
          <b style={{ color: C.gold }}>⚠ 금리 경계</b> — 미 10년물 {Number(risk["^TNX"].c).toFixed(2)}% · 1달 {risk["^TNX"].d21p >= 0 ? "+" : ""}{Number(risk["^TNX"].d21p).toFixed(2)}%p.
          성장주(나스닥)가 금리에 더 민감합니다. <b style={{ color: C.text }}>정보용 — 매매 규칙 아님</b>: 1999~2026 검증에서 금리 방향은 이후 수익과 거의 무관했고, 5% 이상 구간의 부진은 대부분 2000~02년 닷컴 붕괴 한 번이었습니다.
          DC는 안전자산 30% 몫이 지켜지고 있는지만 확인하세요.
        </div>)}
      <Card style={{ padding: "10px 8px", display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
        {[["^VIX", "VIX", "", v => v.c < 22 ? ["안정 (22 미만)", C.emerald] : v.c < 30 ? ["주의 (22~30)", C.gold] : ["위험 (30 이상)", C.red]],
          ["curve", "10년 − 3개월", "%p", v => v.c > 0 ? ["정상 (역전 아님)", C.emerald] : ["역전 · 침체 경고", C.red]],
          ["^TNX", "미 10년물", "%", v => [`1달 ${v.d21p >= 0 ? "+" : ""}${Number(v.d21p).toFixed(2)}%p`, v.c >= 5 && v.d21p > 0 ? C.gold : C.muted]],
          ["^IRX", "미 3개월물", "%", v => [`1달 ${v.d21p >= 0 ? "+" : ""}${Number(v.d21p).toFixed(2)}%p`, C.muted]],
        ].map(([k, label, unit, f]) => { const v = risk[k]; if (!v) return <div key={k} />; const [st, c] = f(v);
          return (<div key={k} style={{ background: "rgba(255,255,255,.03)", borderRadius: 9, padding: "8px 10px", minWidth: 0 }}>
            <div style={{ fontSize: 10.5, color: C.dim, ...ONE }}>{label}</div>
            <div style={{ fontSize: 17, fontWeight: 800, fontFamily: MONO, ...ONE }}>{Number(v.c).toFixed(k === "^VIX" ? 1 : 2)}<span style={{ fontSize: 10, color: C.muted }}>{unit}</span></div>
            <div style={{ fontSize: 10.5, color: c, ...ONE }}>{st}</div>
          </div>); })}
      </Card>

      {/* ④ 섹터 — 수익률 / PER·매수! 수 */}
      <Step n="4" q="어디가 강하지?" right={<Grade k="weak" />}>미국 섹터</Step>
      {/* 215. 참고용(●○○) 표라 기본은 접어 둠 — 1~3위만 한 줄로 */}
      <button onClick={() => setSecOpen(!secOpen)} style={{ ...btn(C.dim), width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8, marginBottom: secOpen ? 6 : 0 }}>
        <span style={{ minWidth: 0, ...ONE }}>{sectors.slice(0, 3).map(x => `${x.rank} ${x.label}`).join(" · ")}</span>
        <span style={{ marginLeft: "auto", fontWeight: 400, color: C.muted, flexShrink: 0 }}>{secOpen ? "접기 ▴" : "12개 펼치기 ▾"}</span></button>
      {secOpen && <Seg full value={secView} onChange={setSecView} items={[["ret", "수익률"], ["per", "PER · 매수! 수"]]} />}
      {!secOpen ? null : secView === "ret" ? (
      <Card style={{ padding: "2px 12px 6px", marginTop: 6 }}>
        <Head cols={["#", "섹터 · S&P比 1달", "3일", "5일", "1달", "점수"]} grid={SEC_GRID} />
        {sectors.map(s => {
          const r = (s.d21 == null || spy21 == null) ? null : s.d21 - spy21;
          const bt = buyBySec[s.tk] || [], ht = heldBySec[s.tk] || [], nb = nbOf(s.tk);
          return (
          <div key={s.tk} onClick={items?.[s.tk] ? () => openStock(s.tk) : undefined} style={{ display: "grid", gridTemplateColumns: SEC_GRID, gap: 5, alignItems: "center", padding: "8px 0", borderTop: `1px solid ${C.border}`, cursor: items?.[s.tk] ? "pointer" : "default" }}>
            <span style={{ fontSize: FS.sm, color: C.muted }}>{s.rank}</span>
            <span style={{ minWidth: 0 }}>
              <b style={{ ...FIT_NAME, display: "block", wordBreak: "keep-all", lineHeight: 1.25 }}>{s.label}</b>{/* 187-3. 업종 이름이 잘리지 않게 — S&P比 숫자는 아랫줄로 */}
              <span style={{ display: "block", fontSize: 10.5, color: C.muted, lineHeight: 1.45, wordBreak: "keep-all" }}>
                {r != null && <span style={{ fontFamily: MONO, color: r >= 0 ? C.emerald : C.red }}>{r >= 0 ? "+" : ""}{r.toFixed(1)}p</span>}
                {nb > 0 && `${r != null ? " · " : ""}매수! ${nb}`}{bt.length > 0 && <> · 살 것 <b style={{ color: C.gold, fontFamily: MONO }}>{bt.join(" ")}</b></>}
                {ht.length > 0 && <> · 보유 <b style={{ color: C.cyan, fontFamily: MONO }}>{ht.join(" ")}</b></>}</span>
            </span>
            {["d3", "d5", "d21"].map(x => <span key={x} style={{ ...FIT, textAlign: "right", color: col(s[x]) }}>{pctFit(s[x])}</span>)}
            <span style={{ ...FIT, textAlign: "right", fontWeight: 700, color: col(s.score) }}>{pctFit(s.score)}</span>
          </div>); })}
        <div style={{ fontSize: FS.xs, color: C.muted, padding: "7px 0 2px" }}>
          이름 아래 숫자 = S&P500 대비 1달 %p · 점수 = 3·6·9·12개월 평균 · <span style={{ color: C.gold }}>살 것</span>/<span style={{ color: C.cyan }}>보유</span> = 그 업종에서 오늘 고른 종목 · 줄을 누르면 그 업종 ETF 차트 · 섹터를 갈아타는 방식은 지수 보유와 차이가 없었습니다
          <button onClick={() => setTab("alloc")} style={{ ...linkBtn, fontSize: FS.sm, minHeight: 36, display: "block" }}>국내 ETF로 보기 ›</button>
        </div>
      </Card>) : (
      <Card style={{ padding: "2px 12px 8px", marginTop: 6 }}>
        <Head cols={["#", "업종", "PER", "예상 PER", "매수!"]} grid={VAL_GRID} />
        {sectors.map(x => {
          const nb = nbOf(x.tk);
          const f1 = (v) => v == null ? "—" : v.toFixed(1);
          return (
            <div key={x.tk} style={{ display: "grid", gridTemplateColumns: VAL_GRID, gap: 5, alignItems: "center", padding: "8px 0", borderTop: `1px solid ${C.border}` }}>
              <span style={{ fontSize: FS.sm, color: C.muted }}>{x.rank}</span>
              <span style={{ minWidth: 0 }}><b style={{ ...FIT_NAME, ...ONE }}>{x.label}</b>
                {x.n != null && <span style={{ fontSize: 10, color: C.muted }}> {x.n}종목</span>}</span>
              <span style={{ ...FIT, textAlign: "right", color: x.pe != null ? C.text : C.muted }}>{x.fpe == null && x.pe == null && x.tk === "SMH" ? "기술에 포함" : f1(x.pe)}</span>
              <span style={{ ...FIT, textAlign: "right", fontWeight: 700, color: x.fpe != null ? C.text : C.muted }}>{x.tk === "SMH" && x.fpe == null ? "" : f1(x.fpe)}</span>
              <span style={{ ...FIT, textAlign: "right", fontWeight: 700, color: nb ? C.emerald : C.muted }}>{nb || "—"}</span>
            </div>);
        })}
        <div style={{ fontSize: FS.xs, color: C.muted, padding: "7px 0 2px", lineHeight: 1.6 }}>
          # = 섹터 순위(3·6·9·12개월 수익률 평균) · PER·예상 PER = 종목풀에 든 그 업종 🇺🇸 종목의 <b style={{ color: C.dim }}>중앙값</b>(업종 지수의 PER 과는 다를 수 있음)
          · 매수! = 지금 매수 신호인 종목 수. PER 로 종목을 거르지는 않습니다.
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            <a href="https://finviz.com/groups.ashx?g=sector&v=120&o=pe" target="_blank" rel="noopener" style={{ ...linkBtn, fontSize: FS.xs, minHeight: 34, padding: "0 10px", border: `1px solid ${C.border}`, borderRadius: 8, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>↗ 🇺🇸 업종별 PER 자세히 (finviz)</a>
            <a href="https://finance.naver.com/sise/sise_group.naver?type=upjong" target="_blank" rel="noopener" style={{ ...linkBtn, fontSize: FS.xs, minHeight: 34, padding: "0 10px", border: `1px solid ${C.border}`, borderRadius: 8, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>↗ 🇰🇷 업종별 시세 (네이버)</a>
          </div>
        </div>
      </Card>)}

      {/* ⑤ 종목 — 오늘 살 것 */}
      <Step n="5" q="그래서 뭘?">오늘 살 것</Step>
      <Card style={{ padding: "4px 12px 10px" }}>
        {[["us", "🇺🇸 미국"], ["kr", "🇰🇷 한국"]].map(([m, name]) => {
          const T = todo3[m];
          const gated = m === "kr" && krGate;
          if (m === "kr" && !gated && !T.buy.length && !T.wait.length && !T.z) return null;
          return (
            <div key={m} style={{ paddingTop: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", padding: "2px 0 4px" }}>
                <b style={{ fontSize: FS.sm }}>{name} {T.can}</b>
                <span style={{ fontSize: FS.xs, color: gated ? C.red : C.muted }}>
                  {T.z ? "투자금 0 — 쉬는 중" : gated ? "시장 위험 — 새로 사지 않음" : `빈 칸 ${T.free}/${T.n}`}
                  {!T.z && !gated && sizer?.limit ? ` · 1회차 ${money(sizer.limit(m) / 2, m)}` : ""}</span>
              </div>
              {T.buy.map(r => {
                const sh = sizer?.shares(r.c, r.m);
                return (
                  <div key={r.t} onClick={() => openStock(r.t)} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "1px 8px", padding: "8px 0", borderTop: `1px solid ${C.border}`, cursor: "pointer" }}>
                    <span style={{ minWidth: 0, fontSize: 14, ...ONE }}>{m === "kr" ? <b>{r.n}</b> : <><b style={{ fontFamily: MONO }}>{r.t}</b> <span style={{ fontSize: FS.xs, color: C.dim }}>{shortName(r.n)}</span></>}</span>
                    <b style={{ fontFamily: MONO, fontSize: FS.md, textAlign: "right" }}>{price(r.c, r.m)}</b>
                    <span style={{ fontSize: 10.5, color: C.muted, minWidth: 0, ...ONE }}>
                      {earnTxt(r, 7) && <b style={{ color: C.gold }}>📅 {earnTxt(r, 7)} · </b>}{r.secRank ? `${r.secLabel} ${r.secRank}위 · ` : ""}강도 {r.str ?? "—"} · 선까지 {r.loss != null ? `−${r.loss.toFixed(0)}%` : "—"}{r.growth != null ? ` · 매출 ${r.growth >= 0 ? "+" : ""}${r.growth.toFixed(0)}%` : ""}</span>
                    {brokerT?.canOrder && !gated && !T.z
                      ? <button onClick={e => { e.stopPropagation(); openOrder({ t: r.t, side: "buy", qty: sh > 0 ? sh : 1, m: r.m }); }}
                          style={{ ...btn(usHalt && m === "us" ? C.red : C.emerald), minHeight: 30, padding: "0 12px", fontSize: FS.xs, justifySelf: "end" }}>{usHalt && m === "us" ? "⚠ 사기" : "사기"}</button>
                      : <span style={{ fontSize: 10.5, color: C.emerald, textAlign: "right", fontWeight: 700 }}>{sh > 0 ? "살 것" : "1주 한 번에"}</span>}
                    <AboutLine s={r} style={{ gridColumn: "1 / -1", fontSize: 10.5, color: C.muted }} />
                    {liveOf(stocks?.[r.t], liveT) && <span style={{ gridColumn: "1 / -1" }}><LiveTag s={stocks[r.t]} q={liveT} /></span>}
                  </div>);
              })}
              {T.wait.length > 0 && <div style={{ fontSize: 10.5, color: C.muted, padding: "6px 0 2px", borderTop: `1px solid ${C.border}` }}>
                대기(칸이 비면 이 순서): {T.wait.map(r => m === "kr" ? r.n : r.t).join(" · ")}</div>}
              {gated && <div style={{ fontSize: 10.5, color: C.muted, padding: "2px 0" }}>가진 종목은 트레일링선대로 · 기준은 2번 시장 상태</div>}
            </div>);
        })}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <GoBtn to="track">계좌로 주문 ›</GoBtn>
          <GoBtn to="find">찾기 탭에서 자세히 ›</GoBtn>
        </div>
      </Card>

      {/* ⑥ 내 종목 */}
      <MyHoldings pos={pos} stocks={stocks} sizer={sizer} setTab={setTab} openStock={openStock} />

      {/* 참고 — 거래 시간 · 원칙 · 판단 기준 */}
      <Step q="필요할 때 펼쳐 보기">참고</Step>
      <button onClick={() => setHoursOpen(v => !v)} style={{ ...btn(C.dim), width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
        <span>🕒 {nowSeg ? `지금 ${nowSeg[0]}` : "지금 휴장"}</span>
        <span style={{ marginLeft: "auto", fontWeight: 400, color: C.muted }}>장 시간표 {hoursOpen ? "▴" : "▾"}</span>
      </button>
      {hoursOpen && <HoursCard nowMs={Date.now()} />}
      <button onClick={onShowRules} style={{ ...btn(C.gold), width: "100%", marginTop: 8, textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
        <span>📌 이번 주 원칙 5개</span><span style={{ marginLeft: "auto", fontWeight: 400, color: C.dim }}>확인함 ✓ · 다시 보기 ›</span>
      </button>
      <Info label="판단 기준 — 폭 · 판정 · 검증 수치">
        <b style={{ color: C.text }}>폭</b> = 그 시장에서 200일선 위에 있는 종목 비율. 토요일에 전체 종목으로 계산하고 평일엔 그 값을 씁니다. 세로 흰 선 = 3년 중 오늘 위치, 옅은 선 = 기준(40).<br />
        <b style={{ color: C.cyan }}>🇰🇷 한국 새로 사기에 사용</b> — 폭이 3년 하위 40% 아래면 '위험' → 한국은 새로 사지 않습니다(가진 종목은 트레일링선대로).
        2010–26 검증(지금 매매 규칙 · 한국 5칸): 연 11.4% → 24.1%, 최대낙폭 −72% → −52%, 16년 중 12년 나음. 기준을 2·3·5년 × 30·40·50으로 바꿔도 모두 16~24%, 같은 비율을 무작위로 막으면 평균 11.9%.
        단 급반등 해(2020·2021)는 손해였고, 지금 살아남은 종목으로 계산해 수익률 자체는 실제보다 높게 나옵니다. DC(ETF 배분)는 이 판정을 쓰지 않습니다.<br />
        <b style={{ color: C.gold }}>🇺🇸 참고만</b> — 예전 검증(발굴 바스켓 3개월 보유)에서는 시험한 15개 타이밍 지표가 전부 (−)였고, 지금 매매 규칙(7칸)으로 다시 본 나스닥 200일선은 +3%p였습니다. 결과가 엇갈려 규칙으로 쓰지 않고 2번 칸에 표시만 합니다.
      </Info>
    </>
  );
}

const IDX_GRID6 = "minmax(0,1.3fr) minmax(0,1.1fr) minmax(0,.9fr) minmax(0,.9fr) minmax(0,.9fr) minmax(0,1fr)";

// 칸 폭은 고정 픽셀 대신 비율로 — 글자를 키운 좁은 화면에서도 이름 칸이 뭉개지지 않게
const IDX_GRID = "minmax(0,1.5fr) minmax(0,1.1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)";
const SEC_GRID = "16px minmax(0,1.7fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.1fr)";
const VAL_GRID = "16px minmax(0,1.9fr) minmax(0,1fr) minmax(0,1fr) minmax(0,.7fr)";
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
   규칙 (230 · 2026-10 다시 검증): 나스닥100 · S&P500 · 코스피200 각 23.3% + 안전자산 30%
   · 각 몫은 느린 슈퍼트렌드(12,3)가 초록일 때만 보유, 빨강이면 그 몫도 안전자산
   · 판단은 미국 원본(SPY) 신호, 매수는 국내 상장 ETF (퇴직연금은 국내 상장만 가능)
   · 진입은 한 번에 또는 월 1회 3분할 (분할은 평균 −0.3%p, 최악 결과는 줄어듦)          */
const DAY = 86400000;
function loadJSON(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? d; } catch { return d; } }
// 182. DC 규칙: st=느린ST(기본) · hold=3지수 보유 — 예전 'dual'(듀얼 모멘텀)을 고른 기기는 3지수 보유로 봅니다
function dcModeOf() { try { const v = localStorage.getItem("v9.dc.mode"); return v === "hold" || v === "dual" ? "hold" : "st"; } catch { return "st"; } }

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
  const [mode, setMode] = useState(dcModeOf);      // st=현행(느린ST) · hold=3지수 보유 (182: 듀얼 모멘텀 대신)
  useEffect(() => { localStorage.setItem("v9.dc.mode", mode); settingsChanged(); }, [mode]);
  useEffect(() => { localStorage.setItem("v6.dc.total", String(total)); }, [total]);
  useEffect(() => { localStorage.setItem("v6.dc.split", String(split)); }, [split]);
  useEffect(() => { localStorage.setItem("v6.dc.done", JSON.stringify(done)); }, [done]);

  if (!dc) return <Card style={{ marginTop: 10 }}><Empty>DC 신호는 다음 데이터 갱신 후 표시됩니다 (파이프라인 v6.2 필요)</Empty></Card>;

  const today = kstDay();
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
      {/* 규칙 택일 — 낙폭 작은 쪽(느린ST)과 수익 쪽(3지수 보유) */}
      <div style={{ marginTop: 8 }}>
        <Seg full value={mode} onChange={setMode} items={[["st", "느린ST (낙폭 작음)"], ["hold", "3지수 보유 (수익↑ 낙폭↑)"]]} />
      </div>
      {/* 84. 규칙 설명은 한 줄 요약만 두고 나머지는 접어, '이번 달 보유 목표'가 먼저 보이게 */}
      <div style={{ fontSize: FS.xs, color: C.muted, margin: "6px 2px 0", display: "flex", gap: 6, alignItems: "baseline" }}>
        <span>{mode === "st" ? "느린ST 빨강이면 그 몫은 안전자산" : "1년에 한 번(1월 첫 거래일) 비중만 맞춤"}</span>
        <button onClick={() => setRuleOpen(v => !v)} style={{ ...linkBtn, fontSize: FS.xs, minHeight: 36, padding: "0 8px", marginLeft: "auto" }}>{ruleOpen ? "접기" : "규칙 자세히"}</button>
      </div>
      {ruleOpen && (
        <div style={{ fontSize: FS.xs, color: C.muted, margin: "2px 2px 0" }}>
          {mode === "st" ? (() => { const ev = dc.evidence || {};    // 173. 수치는 데이터 파일 하나에서 (예전엔 화면에 적은 값과 조금 달랐음)
              return `${(dc.core || []).map(c => `${c.label.replace(/^(미국|한국) /, "")} ${Math.round(c.w * 100)}%`).join(" + ")} + 안전자산 30%, 각 몫은 느린ST 초록일 때만 보유 · 검증 ${ev.period || "—"}: 연 +${ev.cagr ?? "—"}% · 최대낙폭 ${ev.mdd ?? "—"}% · 샤프 ${ev.sharpe ?? "—"}${ev.bh_cagr != null ? ` (3지수 그냥 보유 +${ev.bh_cagr}% · ${ev.bh_mdd}%)` : ""}`; })()
                         : (() => { const ev = dc.hold3?.evidence || {};
              return `나스닥100·S&P500·코스피200 각 23% + 안전자산 30% · 환노출 상품 · 그 사이엔 사고팔지 않음 · 검증 ${ev.period || "2008–26"}: 연 +${ev.cagr ?? "—"}% · 최대낙폭 ${ev.mdd ?? "—"}% · 샤프 ${ev.sharpe ?? "—"}${ev.st_cagr != null ? ` (느린ST 3지수 +${ev.st_cagr}% · ${ev.st_mdd}%)` : ""}`; })()}
        </div>)}
      {mode === "hold" && (() => {
        const riskW = 0.70, safeW = 0.30;                 // 225. 반도체 고정 칸은 뺐음 (검증에서 효과 없음)
        const items = dc.hold3?.items || [];
        if (!items.length) return <Card style={{ marginTop: 10 }}><Empty>3지수 보유 정보는 다음 데이터 갱신 후 표시됩니다</Empty></Card>;
        const Line = ({ code, name, amt, px }) => (      // 226. 금액 옆에 대략 주수
          <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", gap: "0 6px", fontSize: FS.sm, alignItems: "baseline" }}>
            <b style={{ fontFamily: MONO, color: C.cyan }}>{code || "—"}</b><span style={{ color: C.dim, minWidth: 0, ...ONE }}>{name}</span>
            <b style={{ fontFamily: MONO, textAlign: "right" }}>{money(amt, "kr")}</b>
            {px > 0 && <span style={{ gridColumn: "2 / -1", textAlign: "right", fontSize: FS.xs, color: C.muted }}>≈ {Math.floor(amt / px).toLocaleString()}주 · {price(px, "kr")}</span>}</div>);
        return (
          <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(6,182,212,.08)", border: `1px solid ${C.cyan}44` }}>
            <div style={{ fontSize: FS.xs, color: C.cyan, fontWeight: 800 }}>보유 목표 · 총 {money(total, "kr")}</div>
            <div style={{ display: "grid", gap: 3, marginTop: 5 }}>
              {items.map(c => <Line key={c.sig} code={c.buy?.code} name={c.buy?.name || c.label} amt={total * riskW / items.length} px={c.buy?.c} />)}
              <div style={{ display: "flex", gap: 6, fontSize: FS.sm }}>
                <b>안전자산</b><span style={{ color: C.dim }}>TDF·채권혼합·예금</span>
                <b style={{ marginLeft: "auto", fontFamily: MONO }}>{money(total * safeW, "kr")}</b></div>
            </div>
            <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
              처음 한 번 이 금액대로 사 두고, 다음 비중 맞춤은 <b style={{ color: C.text }}>{new Date().getFullYear() + 1}년 1월 첫 거래일</b>입니다 (텔레그램으로 알림). 그 사이 오르내림으로는 사고팔지 않습니다.
            </div>
          </div>);
      })()}
      {mode === "st" && <>
      <Sec right={<Grade k="mid" />}>오늘 규칙</Sec>
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
              <Chip tone="n">판단 {/^[A-Z]+$/.test(c.sig) ? `${c.sig}(미국 원본)` : c.buy?.name}</Chip>
              {c.key === "kr" && krJudge && <Chip tone={krJudge.verdict === "risk" ? "r" : krJudge.verdict === "warn" ? "w" : "g"}>
                시장 {krJudge.verdict === "risk" ? "위험" : krJudge.verdict === "warn" ? "주의" : "안전"} · DC엔 안 씀</Chip>}
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
            {(() => { const unb = cores.filter(c => c.state === "hold" && (c.n || 0) < split).reduce((a, c) => a + (c.target || 0) - (c.n || 0) * (c.per || 0), 0);   // 174
              return unb > 0 ? <div style={{ fontSize: FS.xs, color: C.gold, marginTop: 2 }}>아직 안 산 보유 신호 몫 {money(unb, "kr")} 포함 — 위 '매수 완료 기록'을 누르면 줄어듭니다</div> : null; })()}
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
        {mode === "st" && <>{/* 진입 방식은 느린ST 규칙 전용 — 3지수 보유는 처음 한 번 사 두면 끝 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: FS.sm, color: C.dim, width: 64, flexShrink: 0 }}>진입</span>
          <Seg full value={split} onChange={setSplit} items={[[1, "한 번에"], [3, "3분할"]]} />
        </div>
        <div style={{ fontSize: FS.xs, color: C.muted, margin: "4px 0 0 72px" }}>{split === 3 ? "초록일 때 한 달 간격으로 3번" : "초록일 때 한 번에"}</div>
        <Info label="진입 방식 근거">
          2007–2025년 222개 시작 시점, 12개월 뒤 결과(이 규칙 기준):
          한 번에 평균 +6.6%·최악 −4.0%, 3분할 평균 +6.4%·최악 −3.6%. 한 번에가 이긴 비율 60%.
          평균은 한 번에가 낫고, 분할은 최악의 경우를 조금 줄입니다.
        </Info></>}
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
        (같은 3지수 그냥 보유 {pct(dc.evidence?.bh_cagr, 1)} · {dc.evidence?.bh_mdd}% · {dc.evidence?.bh_sharpe}).
        수익은 그냥 보유보다 연 5%p쯤 낮고, 최대낙폭은 약 60% 수준입니다. 2026년 7월 폭락 때 KODEX 200 신호는 7/2(고점 −17%)에 빠져 이후 −29%를 피했지만, 반등은 놓쳤습니다.<br />
        <b style={{ color: C.text }}>DC 제약</b> 국내 상장 ETF만 · 위험자산 70% 한도 · 레버리지·인버스 불가 · 합성 ETF는 증권사 확인.
        분기 첫 거래일에 23/23/23/30 비중을 다시 맞춥니다. 은행·보험사 DC는 ETF 실시간 매매가 안 될 수 있습니다.<br />
        회차 기록은 이 기기에 저장됩니다. 투자자문이 아닙니다.
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
  const mOf = (x) => idxRet(market, x.m, x.d, null);
  const [open, setOpen] = useState(false);
  if (!siglog?.length) return null;
  const days = [...new Set(siglog.map(x => x.d))].sort().slice(-5);
  const seenDT = new Set();
  const rows = siglog.filter(x => days.includes(x.d) && (x.k === "pull" || x.k === "strong" || x.k === "buy"))
    .sort((a, b) => ({ pull: 0, strong: 0, buy: 1 }[a.k] ?? 2) - ({ pull: 0, strong: 0, buy: 1 }[b.k] ?? 2))
    .filter(x => { const key = x.d + x.t; if (seenDT.has(key)) return false; seenDT.add(key); return true; })   // 같은 날 같은 종목 한 줄
    .map(x => { const s = stocks[x.t]; const now = s?.c ?? null;
      return { ...x, now, ret: now && x.p ? (now / x.p - 1) * 100 : null, n: s?.n || x.n, mret: mOf(x) }; })
    .sort((a, b) => b.d.localeCompare(a.d) || (b.ret ?? -99) - (a.ret ?? -99));
  const done = rows.filter(r => r.ret != null);
  const avg = done.length ? done.reduce((a, r) => a + r.ret, 0) / done.length : null;
  const win = done.length ? done.filter(r => r.ret > 0).length / done.length * 100 : null;
  const dm = done.filter(r => r.mret != null);                                              // 151. 같은 기간 시장
  const mavg = dm.length ? dm.reduce((a, r) => a + r.mret, 0) / dm.length : null;
  const beat = dm.length ? dm.reduce((a, r) => a + (r.ret - r.mret), 0) / dm.length : null;
  const K = { pull: "눌림", strong: "강세", buy: "추세" };
  return (
    <Card style={{ marginTop: 8, padding: "10px 12px" }}>
      <button onClick={() => setOpen(v => !v)} style={{ background: "none", border: "none", padding: "6px 0", minHeight: 36, width: "100%", textAlign: "left", cursor: "pointer", color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: FS.md, fontWeight: 800 }}>최근 5거래일 매수! 기록</span>
        <span style={{ fontSize: FS.xs, color: C.muted }}>{rows.length}건{avg != null && <> · 평균 <b style={{ color: col(avg) }}>{pct(avg, 1)}</b> · 승률 {win.toFixed(0)}%</>}
          {beat != null && <> · 시장 {pct(mavg, 1)} → <b style={{ color: col(beat) }}>{beat >= 0 ? "+" : "−"}{Math.abs(beat).toFixed(1)}%p</b></>}</span>
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
  // 87. 며칠째 = 그 시장 장부 날짜 수로 셈 (🇺🇸·🇰🇷 날짜를 섞지 않음) · since = 매수! 가 처음 켜진 종가 날짜
  const age = {}, since = {};
  if (!siglog?.length) return { age, since };
  const mk = (x) => x.m === "kr" ? "kr" : "us";
  const dates = {};
  for (const x of siglog) (dates[mk(x)] ||= new Set()).add(x.d);
  const idx = {};
  for (const k in dates) { const a = [...dates[k]].sort(); idx[k] = { last: a.length - 1, pos: Object.fromEntries(a.map((d, i) => [d, i])) }; }
  for (const x of siglog) {
    if (!(x.k === "pull" || x.k === "strong" || x.k === "buy")) continue;
    const I = idx[mk(x)]; const a = I.last - I.pos[x.d] + 1;
    if (a <= 20 && (age[x.t] == null || a < age[x.t])) { age[x.t] = a; since[x.t] = x.d; }
  }
  return { age, since };
}
/** 154. 시장별 종가 기준일 — 종목 데이터에서 가장 많은 날짜 (미국·한국 날짜가 다를 수 있어서 나눠 보여 줌) */
const asOfOf = (stocks, m) => { const c = {}; for (const v of Object.values(stocks || {})) if (v?.m === m && v.asOf) c[v.asOf] = (c[v.asOf] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null; };
/** 87. 🆕 표시 — '오늘'이 아니라 종가 날짜로 (미국 종가는 한국 아침에 들어와 달력 날짜와 하루 어긋남) */
// 154. "9/23~ 14일째"는 계속 이어진 것처럼 읽혀서(중간에 신호가 꺼졌다 켜졌을 수 있음) '첫 신호 날짜'로만 씁니다
const newTxt = (age, since) => !since ? (age <= 1 ? "🆕 새로" : `${age}거래일 전 첫 신호`)
  : age <= 1 ? `🆕 ${md(since)} 종가` : age <= 3 ? `🆕 ${md(since)} 첫 신호` : `${md(since)} 첫 신호`;
const NewTag = ({ age, since }) => age == null ? null : (
  <span style={{ fontSize: 10.5, fontWeight: 800, color: age <= 1 ? C.gold : C.muted, flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                 background: age <= 1 ? "rgba(245,158,11,.15)" : "transparent", borderRadius: 4, padding: age <= 1 ? "0 4px" : 0 }}>
    {newTxt(age, since)}</span>);
function TodayPicks({ today, stocks, sizer, openStock, pos, staleInfo, market, ageMap, sinceMap, genDay }) {
  const [open, setOpen] = useState({ us: false, kr: false });        // 칸이 찼거나 투자금 0 인 시장은 접어 둠
  const K = { pull: "눌림", strong: "강세", trend: "추세" };
  const plan = loadPlan();
  const heldAll = new Set((pos || []).map(p => String(p.t).toUpperCase()));
  // 109. 오늘(이 데이터가 만들어진 날 이후) 산 종목은 목록에 남겨 '✓ 오늘 삼' — 사자마자 다음 순번이 올라와 또 사게 되는 일을 막음
  const dayOf = (p) => String(p.date || trOf(p)[0]?.d || "");
  const bought = new Set((pos || []).filter(p => (p.role || "swing") === "swing" && genDay && dayOf(p) >= genDay).map(p => String(p.t).toUpperCase()));
  const heldBefore = new Set([...heldAll].filter(t => !bought.has(t)));
  // 96. 지금 설정(칸 수·매출 필터)으로 앱이 바로 고름 — 파이프라인과 같은 규칙(src/picks.js · scripts/check_picks.mjs 로 일치 확인)
  const cfg = pickCfg(market, plan);
  const extra = { secRank: Object.fromEntries((market?.sectors || []).map(x => [x.tk, [x.rank, x.label]])), age: ageMap || {}, since: sinceMap || {} };
  const loc = pickToday(stocks || {}, cfg, heldBefore, extra);
  const pure = bought.size ? pickToday(stocks || {}, cfg, heldAll, extra) : loc;         // 파이프라인과 비교용 (보유 전부 제외)
  const live = useLive([...loc.pickUs, ...loc.pickKr].map(r => (stocks || {})[r.t]));      // 105
  if (!stocks || !Object.keys(stocks).length) return null;
  const ids = (a) => (a || []).map(r => r.t).join(",");
  const differs = !!today?.pickUs && (ids(today.pickUs) !== ids(pure.pickUs) || ids(today.pickKr) !== ids(pure.pickKr));
  const pa0 = planAmounts(plan, sizer?.fx);
  const zero = (m) => !pa0 || !((m === "us" ? pa0.us : pa0.kr) > 0);          // 97. 투자금 0원(또는 미설정)인 시장
  const zeroTxt = !pa0 ? "투자금 미설정" : "투자금 0원 — 쉬는 중";
  const Stat = ({ k, v, c }) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9.5, color: C.muted, ...ONE }}>{k}</div>
      <div style={{ fontSize: FS.sm, fontWeight: 700, fontFamily: MONO, color: c || C.text, ...ONE }}>{v}</div>
    </div>);
  const Tag = ({ children, c = C.dim, bg = "rgba(255,255,255,.06)" }) => (
    <span style={{ fontSize: 10.5, fontWeight: 700, color: c, background: bg, borderRadius: 5, padding: "1px 6px", whiteSpace: "nowrap" }}>{children}</span>);
  const Row = ({ r, i, state }) => {            // state: buy(살 것) · wait(대기) · done(오늘 삼)
    const s = stocks[r.t] || r; const sh = sizer?.shares(r.c, r.m);
    const et = earnTxt({ ...r, earn: r.earn ?? s.earn, earnE: r.earnE ?? s.earnE });
    const fpe = s.fpe ?? r.fpe, pe = s.pe ?? r.pe;
    return (
      <div onClick={() => openStock(r.t)} style={{ padding: "9px 0", borderTop: `1px solid ${C.border}`, cursor: "pointer", opacity: state === "buy" ? 1 : .55 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: FS.xs, color: C.muted, fontFamily: MONO, width: 14, textAlign: "right", flexShrink: 0 }}>{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0, fontSize: 15, ...ONE }}>{r.m === "kr" ? <><b>{r.n}</b><span style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}> {r.t}</span></>
            : <><b style={{ fontFamily: MONO }}>{r.t}</b><span style={{ fontSize: FS.xs, color: C.dim }}> {shortName(r.n)}</span></>}</div>
          <span style={{ flexShrink: 0, textAlign: "right", lineHeight: 1.1 }}>
            <b style={{ fontSize: 14, fontFamily: MONO, display: "block" }}>{price(r.c, r.m)}</b>
            <span style={{ fontSize: 9.5, color: C.muted }}>{md(s.asOf || today?.asOf)} 종가</span></span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", margin: "5px 0 0 20px" }}>
          {state === "done" ? <Tag c={C.emerald} bg="rgba(48,209,88,.14)">✓ 오늘 삼</Tag>
            : state === "wait" ? <Tag c={C.gold} bg="rgba(245,158,11,.12)">대기 — 빈 칸 없음</Tag>
            : <Tag c={C.emerald} bg="rgba(48,209,88,.14)">{zero(r.m) ? (pa0 ? "투자금 0" : "투자금 미설정") : sh > 0 ? "살 것" : "1주 한 번에"}</Tag>}
          <Tag>{K[r.why]}</Tag>
          {r.secRank && <Tag>{r.secLabel} {r.secRank}위</Tag>}
          {r.age && <Tag c={r.age <= 1 ? C.gold : C.dim}>{newTxt(r.age, r.since)}</Tag>}
          {et && <Tag c={C.gold} bg="rgba(245,158,11,.12)">📅 {et}</Tag>}
          {liveOf(s, live) && <span style={{ marginLeft: "auto" }}><LiveTag s={s} q={live} short /></span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 6, margin: "6px 0 0 20px" }}>
          <Stat k="강도 점수" v={r.str ?? "—"} />
          <Stat k="선까지(잃을 폭)" v={r.loss != null ? `−${r.loss.toFixed(0)}%` : "—"} />
          <Stat k="매출 성장" v={r.growth != null ? `${r.growth >= 0 ? "+" : ""}${r.growth.toFixed(0)}%${r.accel ? "↑" : ""}` : "—"} c={r.growth != null ? col(r.growth) : C.muted} />
          <Stat k={fpe ? "예상 PER" : "PER"} v={fpe ? fpe.toFixed(0) : pe ? pe.toFixed(0) : r.m === "kr" ? "↗ 네이버" : "—"} c={fpe || pe ? C.text : C.muted} />
        </div>
        {state === "buy" && <AboutLine s={{ ...s, ...r }} style={{ margin: "6px 0 0 20px" }} />}
      </div>);
  };
  const Section = ({ m, flag, name, picks }) => {
    const sl = slotInfo(pos, m);
    const z = zero(m), full = sl.free === 0;
    const folded = (z || full) && !open[m];
    let k = 0;                                   // 아직 안 산 종목 중 몇 번째인지 → 빈 칸 수만큼만 '살 것'
    const rows = picks.map((r, i) => {
      const done = bought.has(r.t);
      const state = done ? "done" : (!z && k++ < sl.free) ? "buy" : "wait";
      return <Row key={r.t} r={r} i={i} state={state} />;
    });
    const nBuy = Math.min(sl.free, picks.filter(r => !bought.has(r.t)).length);
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <b style={{ fontSize: FS.sm }}>{flag} {name}</b>
          <Tag c={full || z ? C.gold : C.emerald} bg={full || z ? "rgba(245,158,11,.12)" : "rgba(48,209,88,.14)"}>
            {z ? zeroTxt : full ? `칸이 다 참 · 보유 ${sl.held} / ${sl.n}칸` : `빈 칸 ${sl.free} / ${sl.n}칸`}</Tag>
          {!z && !full && <span style={{ fontSize: FS.xs, color: C.dim }}>오늘 살 것 <b style={{ color: C.text }}>{nBuy}</b>{picks.length > nBuy ? ` · 대기 ${picks.filter(r => !bought.has(r.t)).length - nBuy}` : ""}</span>}
        </div>
        {full && !z && <div style={{ fontSize: FS.xs, color: C.gold, marginTop: 4, lineHeight: 1.5 }}>
          ⛔ <b>오늘은 새로 사지 않습니다.</b> 가진 종목이 팔려 칸이 비면 다시 살 것이 나옵니다.</div>}
        {picks.length === 0 ? <div style={{ fontSize: FS.sm, color: C.muted, padding: "6px 0" }}>조건에 맞는 종목 없음</div>
          : folded ? <button onClick={() => setOpen(o => ({ ...o, [m]: true }))} style={{ ...linkBtn, fontSize: FS.xs, minHeight: 36, padding: 0 }}>▾ {z ? "목록" : "대기 순번"} {picks.length}개 보기 (참고)</button>
          : <>{rows}{(z || full) && <button onClick={() => setOpen(o => ({ ...o, [m]: false }))} style={{ ...linkBtn, fontSize: FS.xs, minHeight: 36, padding: 0 }}>▴ 접기</button>}</>}
      </div>);
  };
  const rm = cfg.revMin; const cand = loc.candidates.filter(r => rm <= 0 || r.m === "kr" || r.growth == null || r.growth >= rm);
  const candNew = cand.filter(r => !r.held);                 // 132. 보유 제외 — 찾기 탭 '매수! N' 과 같은 수
  const nUs = candNew.filter(r => r.m === "us").length;
  return (
    <Card style={{ marginTop: 10, borderColor: `${C.emerald}55`, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: FS.md, fontWeight: 800 }}>오늘 살 것</span>
        <span style={{ fontSize: FS.xs, color: C.muted }}>{(() => { const a = asOfOf(stocks, "us"), b = asOfOf(stocks, "kr");
          return a && b && a !== b ? `🇺🇸 ${md(a)} · 🇰🇷 ${md(b)}` : md(a || b || today?.asOf) || "—"; })()} 종가 기준 · 매수! 🇺🇸 {nUs} · 🇰🇷 {candNew.length - nUs} 중에서</span>
      </div>
      {/* 한국은 시장 위험이거나 살 것이 없으면 한국 데이터가 늦어도 경고하지 않음 (미국 목록까지 늦은 것처럼 보였음) */}
      {!cfg.krGate && loc.pickKr.length ? <StaleWarn info={staleInfo} /> : <StaleWarn info={staleInfo} m="us" />}
      {differs && <div style={{ fontSize: 10.5, color: C.gold, marginTop: 6, lineHeight: 1.5 }}>
        ⚙ 지금 설정(🇺🇸 {cfg.slotsUs}칸 · 🇰🇷 {cfg.slotsKr}칸 · 매출 {cfg.revMin > 0 ? `+${cfg.revMin}%` : "필터 끔"})이나 보유가 바뀌어 앱이 다시 골랐습니다. 텔레그램·AI 도구는 다음 갱신 때 같아집니다</div>}
      <Section m="us" flag="🇺🇸" name="미국" picks={loc.pickUs} />
      {(() => {   // 161. 같은 업종을 이미 보유해서 뺀 종목 — 원칙 5
        const out = loc.excluded.filter(x => x.m === "us" && (x.why || []).some(w => w.startsWith("같은 업종 보유")));
        if (!out.length) return null;
        const by = {}; out.forEach(x => { const h = (x.why.find(w => w.startsWith("같은 업종 보유")).match(/\((.+)\)/) || [])[1] || "?"; (by[h] = by[h] || []).push(x.t); });
        return <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
          같은 업종을 이미 보유해서 뺌 (원칙 5): {Object.entries(by).map(([h, ts]) => `${(stocks[h]?.sec && (market?.sectors || []).find(z => z.tk === stocks[h].sec)?.label) || "업종"} · ${h} 보유 → ${ts.slice(0, 4).join("·")}${ts.length > 4 ? ` 외 ${ts.length - 4}` : ""}`).join(" / ")}</div>;
      })()}
      {cfg.krGate ? (() => {   // 176. 한국 시장 위험 — 새로 사지 않음
        const wait = loc.excluded.filter(x => x.m === "kr" && (x.why || []).includes(KR_GATE_WHY));
        const j = market?.judge?.kr;
        return <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <b style={{ fontSize: FS.sm }}>🇰🇷 한국</b>
            <Tag c={C.red} bg="rgba(255,69,58,.12)">시장 위험 — 새로 사지 않음</Tag></div>
          <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 4, lineHeight: 1.6 }}>
            폭 {j?.breadth != null ? `${Math.round(j.breadth)}%` : "—"} · 3년 하위 {j?.breadthPct ?? "—"}% (기준 40){market?.breadthAsOf ? ` · ${md(market.breadthAsOf)} 계산` : ""} · 가진 종목은 트레일링선대로.
            {wait.length > 0 && <> 신호는 있지만 대기: {wait.slice(0, 5).map(x => x.n || x.t).join(" · ")}{wait.length > 5 ? ` 외 ${wait.length - 5}` : ""}</>}</div>
        </div>;
      })() : loc.pickKr.length > 0 && <Section m="kr" flag="🇰🇷" name="한국" picks={loc.pickKr} />}
      <details style={{ marginTop: 10 }}>
        <summary style={{ fontSize: FS.xs, color: C.muted, cursor: "pointer", minHeight: 30, display: "flex", alignItems: "center" }}>▸ 어떻게 고르나 · 칸이 뭔가</summary>
        <div style={{ fontSize: 10.5, color: C.muted, lineHeight: 1.7, marginTop: 2 }}>
          <b style={{ color: C.text }}>칸</b> = 동시에 들고 있을 종목 수 한도. 직투 금액 ÷ 칸 수 = 한 종목에 넣을 돈, 1회차는 그 절반. 빈 칸만큼만 삽니다.<br />
          <b style={{ color: C.text }}>고르는 순서</b>: 매수! 중 강세·눌림 먼저 → 강도 점수(6개월 상대강도 + 200일선 거리) 높은 순 · 🇺🇸 같은 업종은 하나(이미 보유한 업종 포함) · 적자·매출 부진·보유 제외.<br />
          <b style={{ color: C.text }}>🇰🇷 시장 위험</b>(폭 3년 하위 40% 아래 · 주 1회 계산)이면 한국은 새로 사지 않습니다 — 2010–26 검증 연 11.4% → 24.1%, 최대낙폭 −72% → −52%.<br />
          <b style={{ color: C.text }}>검증</b>: 규칙을 2010–18에서 정하고 2019–26에 적용 — 🇺🇸 연 +50%·+38% (RS 순 +41%·+27%) · 🇰🇷 +48%·+39%. 텔레그램·AI 도구와 같은 규칙.<br />
          PER 은 참고용입니다(이 값으로 거르지 않음 · 🇰🇷 은 ↗ 네이버에서 확인).
        </div>
      </details>
    </Card>);
}

function FindTab({ list, openStock, watch, toggleWatch, market, sizer, pos, siglog, stocks, today, staleInfo, notes, genDay }) {
  // 181. 매수! 목록의 각 종목이 '오늘 살 것'에서 어떻게 됐는지 — 살 것 · 대기 · 빠진 이유 (위 '오늘 살 것'과 같은 함수)
  const pickTag = useMemo(() => {
    const out = {}; if (!stocks) return out;
    const plan = loadPlan(), pa = sizer?.plan;
    const P = pickToday(stocks, pickCfg(market, plan), new Set((pos || []).map(p => String(p.t).toUpperCase())));
    const secBy = {}; P.pickUs.forEach(r => { if (r.sec && !secBy[r.sec]) secBy[r.sec] = r.t; });
    [["us", P.pickUs], ["kr", P.pickKr]].forEach(([m, arr]) => {
      const sl = slotInfo(pos, m), z = !pa || !((m === "us" ? pa.us : pa.kr) > 0);
      arr.forEach((r, i) => { out[r.t] = z ? ["투자금 0", C.muted] : i < sl.free ? ["오늘 살 것", C.emerald] : ["대기 — 빈 칸 없음", C.gold]; });
    });
    P.excluded.forEach(x => { if (out[x.t]) return; const w = (x.why || [])[0] || ""; if (w === "보유 중") return;   // 보유는 옆 꼬리표가 이미 말함
      out[x.t] = [w === "같은 업종 이미 선택" ? `같은 업종(${secBy[stocks[x.t]?.sec] || "?"}) 먼저` : w === "적자" ? "적자 — 살 것 제외" : w === KR_GATE_WHY ? "시장 위험 — 한국 안 삼" : w.startsWith("매출") ? `${w} — 제외` : w, C.muted]; });
    return out;
  }, [stocks, pos, market, sizer]);
  const [filt, setFilt] = useSticky("v9.find.filt", "buy");
  const [mkt, setMkt] = useSticky("v9.find.mkt", "us");      // 🇺🇸 기본
  const [sortBy, setSortBy] = useSticky("v12.find.sort", "str");
  const { age: ageMap, since: sinceMap } = useMemo(() => sigAgeMap(siglog), [siglog]);
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
  const isBuy = (s) => s.action === "buy" && passRev(s) && !heldSet.has(s.t);   // 132. 매수! 목록 = 새로 살 수 있는 것만 (보유 제외)
  const pool = useMemo(() => {
    let r = list.filter(s => (s.tvr ?? 0) >= 40);
    if (mkt !== "all") r = r.filter(s => s.m === mkt);
    return r;
  }, [list, mkt]);
  const rows = useMemo(() => {
    let r = pool;
    if (filt === "buy") r = r.filter(isBuy);
    else if (filt === "pre") r = r.filter(s => s.pre);
    const W = { pull: 3, strong: 3, trend: 2 };
    const key = { str: s => ((s.action === "buy" && s.why !== "trend") ? 0 : 1) * 1000 - (s.str ?? -1),   // 강도순 (검증된 순서)
                  new: s => (ageMap[s.t] ?? 99) * 1000 - (s.rs ?? 0),          // 새로 매수! 된 순
                  sig: s => -((s.action === "buy" ? W[s.why] || 1 : 0) * 1000 + (s.rs ?? 0)),
                  rs: s => -(s.rs ?? 0), vol: s => -(s.atrr ?? -1), tv: s => -(s.tvr ?? 0), rev: s => -(growthOf(s) ?? -999),
                  sec: s => { const r = (market?.sectors || []).find(x => x.tk === s.sec); return (r ? r.rank : 99) * 1000 - (s.rs ?? 0); } }[sortBy];
    const sorted = [...r].sort((a, b) => key(a) - key(b));
    return [...sorted.filter(s => !seenSet[s.t]), ...sorted.filter(s => seenSet[s.t])];   // 확인한 것은 맨 아래
  }, [pool, filt, sortBy, market, revMin, seenSet, ageMap, heldSet]);
  const nNew = pool.filter(s => isBuy(s) && (ageMap[s.t] ?? 99) <= 1).length;
  const nBuy = pool.filter(isBuy).length;
  const nHeldBuy = pool.filter(s => s.action === "buy" && passRev(s) && heldSet.has(s.t)).length;
  const nCut = pool.filter(s => s.action === "buy" && !passRev(s)).length;
  const nPre = pool.filter(s => s.pre).length;
  const nKr = pool.filter(s => isBuy(s) && s.m === "kr").length;
  return (
    <>
      <TodayPicks today={today} stocks={stocks} sizer={sizer} openStock={openStock} pos={pos} staleInfo={staleInfo} market={market} ageMap={ageMap} sinceMap={sinceMap} genDay={genDay} />
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
          <span>{nNew > 0 && <b style={{ color: C.gold }}>🆕 최근 종가에 새로 {nNew} · </b>}🇰🇷 {nKr} · 🇺🇸 {nBuy - nKr}{nCut > 0 && <span style={{ color: C.gold }}> · ✂ 매출 부진 {nCut} 숨김</span>}{nHeldBuy > 0 && <span> · 보유 {nHeldBuy} 제외</span>}</span>
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
      <button onClick={() => setShowAll(v => !v)} style={{ ...btn(C.dim), width: "100%", marginTop: 8, display: "flex", alignItems: "center" }}>
        <span>{filt === "pre" ? `예비 목록 ${rows.length}개` : filt === "buy" ? `매수! 목록 ${rows.length}개` : `전체 목록 ${rows.length}개`}</span><span style={{ marginLeft: "auto", fontWeight: 400, color: C.muted }}>{showAll ? "접기 ▴" : "펼치기 ▾"}</span>
      </button>
      {showAll && <>
      <SortBar text={filt === "pre" ? "예비 후보 (관찰)" : SORT_LABEL[sortBy]} n={rows.length} market={market} />
      <ExplainList items={EXPLAIN.trend} />
      <div>
        {rows.length === 0 ? <Empty>{filt === "buy" ? "지금은 매수! 신호가 없습니다 · ‘전체’를 누르면 관망 종목도 보입니다" : "해당 종목이 없습니다"}</Empty> : rows.slice(0, limit).map((s, i) => (
          <StockRow key={s.t} s={s} rank={i + 1} rel={relOf(s, market)} held={heldSet.has(s.t)}
            seen={!!seenSet[s.t]} onSeen={toggleSeen} age={ageMap[s.t]} since={sinceMap[s.t]}
            isWatch={watch.includes(s.t)} onToggle={toggleWatch} onOpen={openStock} tag={s.action === "buy" ? pickTag[s.t] : null}
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
function ChartTab({ stocks, sel: sel0, watch, toggleWatch, market, pos, setPos, setTab, sizer, staleInfo, notes, setNote, trades, picksLog }) {
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
  const [span, setSpan] = useState(126);                       // 기본 6개월
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
        {isStock && <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>자리 정보는 참고용 — 이 값으로 걸러 사면 검증에서 성과가 떨어졌습니다. 선까지 = 지금 사면 잃을 수 있는 폭</div>}
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
function TrackTab({ stocks, watch, toggleWatch, openStock, pos, setPos, market, bumpSizer, extras, trades, setTrades, sizer, syncState, kisSync = {}, syncOk = true }) {
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

  /* ── 184. 한투 체결 반영 — 아래 한투 카드가 불러온 잔고·주문과 내 종목을 맞춥니다 (src/fills.js · scripts/check_fills.mjs) ── */
  const [applied, setApplied] = useState(() => new Set(loadJSON("v13.kis.applied", [])));
  const [ignored, setIgnored] = useState(() => new Set(loadJSON("v13.kis.ignore", [])));
  const saveSet = (k, set) => { try { localStorage.setItem(k, JSON.stringify([...set].slice(-500))); } catch {} };
  const fillPlan = useMemo(() => ["us", "kr"].map(m => {
    const k = kisSync[m]; if (!k) return null;
    return { m, env: k.env, broker: k.broker, ...planFills({ orders: k.orders, rows: k.rows, pos: pos.filter(p => mktOfT(p.t) === m), applied, ignored, from: k.env === "real" ? AUTO_FROM : "" }) };
  }).filter(Boolean), [kisSync, pos, applied, ignored]);
  useEffect(() => {      // 손으로 이미 기록한 체결은 조용히 '반영됨' 처리
    const d = fillPlan.flatMap(x => x.dup).filter(o => !applied.has(o));
    if (d.length) { const n = new Set([...applied, ...d]); setApplied(n); saveSet("v13.kis.applied", n); }
  }, [fillPlan]);        // eslint-disable-line react-hooks/exhaustive-deps
  const kisQty = useMemo(() => { const o = {}; Object.values(kisSync).forEach(k => (k.rows || []).forEach(r => { o[String(r.t).toUpperCase().replace("/", "-")] = { qty: r.qty, env: k.env, label: k.label }; })); return o; }, [kisSync]);
  const broker = useBroker();          // 210. 주문이 열린 계좌면 카드에서 바로 주문 창
  const BK = broker?.label || Object.values(kisSync).find(k => k && k.label)?.label || "계좌";   // 연결된 증권사 이름 (카드가 알려 줌)
  const pendingN = fillPlan.reduce((a, x) => a + x.items.length + x.extra.length, 0);
  const [fillOpen, setFillOpen] = useState(false);
  const [fillOff, setFillOff] = useState({});          // key → true 면 반영하지 않음
  const applyAll = () => {
    let cur = pos, tradesAdd = [];
    const done = new Set(applied);
    fillPlan.forEach(x => {
      const pick = x.items.filter(i => i.kind !== "partial" && !fillOff[i.key]);
      const r = applyFills(cur, pick, { src: x.env === "real" ? (x.broker || "kis") : "kis-demo", mOf: mktOfT, nameOf: t => stocks[t]?.n });
      cur = r.pos; tradesAdd = [...tradesAdd, ...r.trades];
      x.items.forEach(i => i.odnos.forEach(o => done.add(o)));      // 체크를 뺀 것·일부 매도도 목록에서 지움
    });
    setPos(cur); if (tradesAdd.length) setTrades(v => [...v, ...tradesAdd].slice(-300));
    setApplied(done); saveSet("v13.kis.applied", done); setFillOpen(false); setFillOff({});
  };
  const addExtra = (x, e, role = "long") => {
    setPos(v => [...v, { id: Date.now(), t: e.t, role, date: kstDay(), tr: [{ d: kstDay(), px: e.avg || 0, amt: Math.round((e.avg || 0) * e.qty * 100) / 100 }], src: x.env === "real" ? (x.broker || "kis") : "kis-demo" }]);
  };
  /* ★ 228. 내 종목 = 메리츠(실계좌) 기준 — 체결된 매수·매도는 열 때 자동으로 반영. 반영한 내용은 한 번 알리고 되돌릴 수 있음
   *   (일부 매도·메리츠에만 있는 종목은 지금처럼 골라서) · 서버와 맞추기가 끝난 뒤에만(다른 기기 기록과 겹쳐 두 번 들어가지 않게) */
  const [autoNote, setAutoNote] = useState(null);       // { txt, undo: { pos, trades } }
  useEffect(() => {
    if (!syncOk) return;
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
              {x.env !== "real" && <span style={{ fontSize: FS.xs, color: C.gold, fontWeight: 400 }}> · 모의투자 체결 — 반영하면 내 종목에 '모의'로 표시됩니다</span>}</div>}
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
    const loaded = Object.values(kisSync).some(k => k && Array.isArray(k.rows) && k.mk === mktOfT(p.t));
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
        const miss = Object.values(kisSync).filter(k => k && k.env === "real" && Array.isArray(k.rows))
          .flatMap(k => pos.filter(p => (p.role || "swing") === "swing" && mktOfT(p.t) === k.mk && !kisQty[String(p.t).toUpperCase().replace("/", "-")]));
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
      {pendingN > 0 && (    /* 184. 한투 체결이 내 종목에 아직 없음 */
        <button onClick={() => setFillOpen(true)} style={{ display: "block", width: "100%", textAlign: "left", marginTop: 8, padding: "10px 12px", borderRadius: 12, cursor: "pointer",
                 background: "rgba(245,158,11,.10)", border: `1px solid ${C.gold}66`, color: C.text }}>
          <div style={{ fontSize: FS.sm, fontWeight: 800, color: C.gold }}>{[fillPlan.reduce((a, x) => a + x.items.length, 0) && `${BK} 체결 ${fillPlan.reduce((a, x) => a + x.items.length, 0)}건`, fillPlan.some(x => x.extra.length) && `${BK}에만 있는 종목 ${fillPlan.reduce((a, x) => a + x.extra.length, 0)}`].filter(Boolean).join(" · ")} — 아직 내 종목에 없음</div>
          <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 2, ...ONE }}>{fillPlan.flatMap(x => [...x.items.map(i => `${x.m === "kr" ? (stocks[i.t]?.n || i.t) : i.t} ${i.side === "sell" ? "매도" : "매수"} ${i.qty}주`), ...x.extra.map(e => `${x.m === "kr" ? (e.n || e.t) : e.t} ${e.qty}주`)]).join(" · ")}</div>
          <div style={{ fontSize: FS.sm, color: C.gold, marginTop: 4, fontWeight: 700 }}>확인하고 반영하기 ›</div>
        </button>)}
      <Sec right={<button onClick={() => setForm(form ? null : { t: "", avg: "", role: "swing", k: "1" })} style={linkBtn}>{form ? "닫기" : "＋ 직접 추가"}</button>}>
        보유 {pos.length}
      </Sec>
      <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
        <Seg full value={tmk} onChange={setTmk} items={[["us", `🇺🇸 미국 ${nUs}`], ["kr", `🇰🇷 한국 ${nKr}`], ["all", "전체"]]} />
        <Seg value={role} onChange={setRole} items={[["all", "전체"], ["etf", "ETF"], ["swing", "단기"], ["long", "장기"]]} />
      </div>
      <HoldTotals pos={pos} stocks={stocks} fx={sizer.fx} only={tmk} />
      {(() => {   // 184. 한투에 넣어 둔 매수 주문 중 아직 체결 안 된 것
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
          const kisBtn = !!broker?.canOrder;                      // 주문이 열린 계좌일 때만 (보유 수량은 서버가 다시 확인)
          const when = (() => { const o = nextOpen(s.m === "kr"), md0 = o.label.split(" ")[0];     // 주말·휴장일이면 '오늘 밤'이 아니라 그 날짜
            return s.m === "us" ? `${o.d === kstDay() ? "오늘" : md0} 밤 ${usDST(Date.now()) ? "22:30" : "23:30"} 개장 때` : `${o.d === kstDay() ? "오늘" : md0} 09:30 이후`; })();
          const room = nxt?.ok ? roomFor(pos, sizer, s.m, nxt.amt) : false;
          const q2 = nxt ? Math.floor(nxt.amt / s.c) : 0;
          // 184. '다음 할 일' 한 줄 — 상태 하나 · 행동 하나
          const N = p.role === "long" ? { c: C.cyan, k: "장기", v: "장기 보유 — 앱 매도 규칙 적용 안 함", sub: "칸 수·매도! 알림에서 빠짐 · 손익 합계에는 들어감" }
            : isSell ? { c: C.red, k: "매도!", v: `${when} 전량 매도${sh ? ` · ${sh}주` : ""}`, sub: `${md(s.asOf)} 종가 ${price(s.c, s.m)} < 트레일링선 ${price(s.stLine, s.m)} · 미루지 않고 그날 처리 (원칙 3)`, act: "sell" }
            : nxt?.ok && room ? { c: C.emerald, k: "2회차", v: `${when} 2회차 ${q2 > 0 ? `${q2}주` : "1주"} · ~${price(s.c * 1.005, s.m)}`, sub: `1회차 대비 ${pct(nxt.gain, 1)} 마감 (조건 +3~6% · 느린ST 초록) · ${money(nxt.amt, s.m)}`, act: "t2" }
            : nxt?.ok ? { c: C.gold, k: "2회차 건너뜀", v: "투자금 한도를 넘어 2회차는 건너뜁니다", sub: `직투 ${money(budgetOf(sizer, s.m), s.m)} 중 ${money(investedIn(pos, s.m), s.m)} 투입 · 2회차 ${money(nxt.amt, s.m)}` }
            : nxt?.chase ? { c: C.gold, k: "기다리기", v: `2회차 추격 금지 — 1회차 대비 ${pct(nxt.gain, 1)}`, sub: `+6%를 넘었습니다. 눌렸다 +3~6% 안에 다시 들어오면 2회차 · ${price(s.stLine, s.m)} 아래로 마감하면 매도` }
            : nxt ? { c: C.muted, k: "다음 할 일", v: "없음 — 기다리기", sub: `${!nxt.after ? `산 뒤 첫 종가부터 판단 · ${price(nxt.target, s.m)}~${price(nxt.cap, s.m)}(+3~6%)로 마감하면 2회차` : `${price(nxt.target, s.m)} 위로 마감하면 2회차 (${nxt.pctToGo.toFixed(1)}% 남음${s.stSlow !== 1 ? " · 느린ST 초록이어야" : ""})`} · ${s.stLine ? `${price(s.stLine, s.m)} 아래로 마감하면 매도` : "트레일링선 없음"}` }
            : { c: C.muted, k: "다음 할 일", v: "없음 — 기다리기", sub: s.stLine ? `${price(s.stLine, s.m)} 아래로 마감하면 매도 (선까지 ${lossTxt(s)})` : "트레일링선 없음" };
          return (
            <Card key={p.id} style={{ marginBottom: 8, borderColor: isSell ? "rgba(255,69,58,.5)" : N.act === "t2" ? "rgba(48,209,88,.45)" : C.border }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div onClick={() => openStock(p.t)} style={{ flex: 1, minWidth: 0, cursor: "pointer", fontSize: 15, fontWeight: 700, ...ONE }}>
                  <Chip tone={rt}>{rl}</Chip> {s.m === "kr" ? <b>{s.n}</b> : <b style={{ fontFamily: MONO }}>{p.t}</b>} <span style={{ color: C.dim, fontWeight: 400, fontSize: FS.sm }}>{s.m === "kr" ? p.t : shortName(s.n)}</span></div>
                {p.src === "kis-demo" && <Chip tone="w">모의</Chip>}
                {kq && <span style={{ fontSize: 10.5, color: C.cyan, whiteSpace: "nowrap" }}>{kq.label || BK}{kq.env !== "real" ? " 모의" : ""} {kq.qty}주</span>}
                {!kq && p.role !== "etf" && Object.values(kisSync).some(k => k && k.env === "real" && k.mk === s.m && Array.isArray(k.rows)) &&
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
              {N.act && (
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
                  ▸ 자세히 — {s.stLine ? `선 ${price(s.stLine, s.m)} (${lossTxt(s)})` : "선 없음"}{s.slowDays != null ? ` · 초록 ${s.slowDays}일` : ""}{earnTxt(s) ? ` · 📅 ${earnTxt(s)}` : ""}</summary>
                <div style={{ fontSize: FS.xs, color: C.dim, lineHeight: 1.7, padding: "2px 0 4px" }}>
                  {p.role !== "long" ? <>트레일링선 {price(s.stLine, s.m)} · 선까지 {lossTxt(s)}{s.slowDays != null ? ` · 느린ST ${s.stSlow === 1 ? "초록" : "빨강"} ${s.slowDays}거래일째` : ""}</> : <>장기 관찰 · <DipTag s={s} /></>}
                  {earnTxt(s) && <><br /><b style={{ color: earnDays(s) <= 7 ? C.gold : C.dim }}>📅 {earnTxt(s)}</b></>}
                  {pastEarnTxt(s) && <><br />{pastEarnTxt(s)}</>}
                  {(() => { const tg = tgtOf(p.t, NOTES_REF.cur, s); const g = tg && tgtGap(tg.v, s.c);
                    return g == null ? null : <><br />{tg.mine ? (g <= 0 ? `🎯 내 목표 ${price(tg.v, s.m)} 도달 (매도 신호 아님)` : `내 목표 ${price(tg.v, s.m)}까지 +${g.toFixed(0)}%`)
                      : (g <= 0 ? `애널 평균 목표 ${price(tg.v, s.m)} — 지금보다 낮음 (참고 · 매도 신호 아님)` : `애널 평균 목표 ${price(tg.v, s.m)}까지 +${g.toFixed(0)}%`)}</>; })()}
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

/** 분기 실적(재무) 갱신 — 매출 필터·재무 참고가 쓰는 데이터. 수집 후 병합까지 자동 연결됩니다 */
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
      setMsg({ t: j.ok ? (j.already ? "이미 실행 중" : "시작 · 약 20분 뒤 반영") : (j.msg || "실행하지 못했습니다"), bad: !j.ok });
    } catch { setMsg({ t: "네트워크 오류", bad: true }); }
    setBusy(false);
  };
  return (
    <div>
      <button onClick={run} disabled={busy} style={{ ...btn(C.dim), width: "100%" }}>
        {busy ? "…" : "📊 분기 실적 갱신"}</button>
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
        <Seg full value={mode} onChange={setMode} items={[["trend", "📈 매수 신호"], ["dip", "🌊 급락 (과매도)"]]} />
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
/* 208. 주 1회 '이번 주 선정'은 뺐습니다 — 매일 바뀌는 '오늘 살 것'(찾기 탭)과 겹쳐 지난 종목이 남아 헷갈렸음 */
/** 151. 같은 기간 시장 수익률 — market.idxbars(미국 S&P500 · 한국 코스피, 최근 200거래일 종가)에서 날짜로 찾음.
 *  from·to 는 'YYYY-MM-DD'. 그 날짜 이하의 마지막 종가를 씁니다. 범위를 벗어나면 null */
function idxRet(market, m, from, to) {
  const rows = market?.idxbars?.[m]?.rows; if (!rows?.length || !from) return null;
  const dOf = (r) => new Date(r[0] * 1000 + (m === "kr" ? 9 * 3600000 : 0)).toISOString().slice(0, 10);
  const at = (d) => { let v = null; for (const r of rows) { if (dOf(r) <= d) v = r[1]; else break; } return v; };
  if (dOf(rows[0]) > from) return null;
  const a = at(from), b = to ? at(to) : rows[rows.length - 1][1];
  return a && b ? (b / a - 1) * 100 : null;
}
/** 152. 이 종목이 '오늘 살 것' 목록에 들었던 날들 — [{d, i(순번), buy(살 것이었나)}] */
const pickedDays = (picksLog, t, m) => (picksLog || []).flatMap(row => (row[m] || []).filter(x => x.t === t).map(x => ({ d: (m === "us" ? row.du : row.dk) || row.d, i: x.i, buy: !!x.buy })));   // 211. 시장별 날짜

/** 57. 지난 신호 복기 — 매수! 가 떴던 종목이 그 뒤 어떻게 됐나. 규칙대로 팔았으면 얼마였고, 판 뒤에는 어떻게 됐나 */
function SignalReview({ siglog, stocks, market, openStock, picksLog }) {
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
    // 130. 판 뒤 흐름 — 판 날의 종가가 아직 마지막 종가면(하루도 안 지남) 비교할 값이 없으므로 비웁니다
    const after = ex && now && s?.asOf && ex.d < s.asOf ? (now / ex.p - 1) * 100 : null;
    const dropped = !ex && s && s.action !== "buy";                                          // 목록에서 빠졌지만 매도 신호는 아님
    const mret = idxRet(market, x.m, x.d, ex?.d || null);                                   // 151. 같은 기간 시장
    const pk = pickedDays(picksLog, x.t, x.m).filter(p => p.d >= x.d && (!ex || p.d <= ex.d)); // 152. 그 사이 '오늘 살 것'에 들었나
    return { ...x, n: s?.n || x.n, m: x.m, now, ex, rule, after, dropped, cur: s, mret, ex2: rule != null && mret != null ? rule - mret : null,
             picked: pk.find(p => p.buy) || pk[0] || null };
  });
  const first = siglog.reduce((a, x) => (!a || x.d < a ? x.d : a), null);                 // 150. 기록이 시작된 날
  const short = first && since < first;
  const xs = (a) => { const v = a.filter(r => r.ex2 != null); return v.length ? v.reduce((x, r) => x + r.ex2, 0) / v.length : null; };
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
        {short && <div style={{ fontSize: FS.xs, color: C.gold, marginBottom: 6, lineHeight: 1.5 }}>
          기록이 {dlabel(first)}부터라 {weeks === 4 ? "지금은 4주·8주·6달이 모두 같습니다" : `${weeks === 8 ? "8주를" : "6달을"} 골라도 ${dlabel(first)} 이후만 보입니다`} — 기록이 쌓이면 달라집니다.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", textAlign: "center" }}>
          {[["이탈 (매도!)", `${exited.length}건`, avg(exited) != null ? `규칙 손익 ${pct(avg(exited), 1)}` : "—", col(avg(exited)), xs(exited)],
            ["판 뒤 더 떨어짐", withAfter ? `${Math.round(saved / withAfter * 100)}%` : "—", withAfter ? `${saved}/${withAfter}건 · 선이 지켜 줌` : "아직 없음", C.emerald, undefined],
            ["유지 중", `${holding.length}건`, avg(holding) != null ? `지금까지 ${pct(avg(holding), 1)}` : "—", col(avg(holding)), xs(holding)]].map(([l, v, sub, c, x], i) => (
            <div key={l} style={{ borderLeft: i ? `1px solid ${C.border}` : "none", padding: "0 4px", minWidth: 0 }}>
              <div style={{ fontSize: 10.5, color: C.dim, ...ONE }}>{l}</div>
              <div style={{ fontSize: 16, fontWeight: 800, fontFamily: MONO }}>{v}</div>
              <div style={{ fontSize: 10.5, color: c, ...ONE }}>{sub}</div>
              {x !== undefined && <div style={{ fontSize: 10.5, color: x == null ? C.muted : col(x), ...ONE }}>{x == null ? "시장 비교 —" : `시장보다 ${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%p`}</div>}
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
                {r.picked && <span style={{ fontSize: 10.5, color: r.picked.buy ? C.emerald : C.dim }}> {r.picked.buy ? "★ 살 것" : `대기 ${r.picked.i}번`} {dlabel(r.picked.d)}</span>}
              </div>
              <div style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO, ...ONE }}>
                {dlabel(r.d)} {price(r.p, r.m)}{r.ex ? ` → ${dlabel(r.ex.d)} ${price(r.ex.p, r.m)}` : " → 유지 중"}</div>
            </div>
            <span style={{ textAlign: "right", minWidth: 0 }}>
              <span style={{ fontSize: FS.sm, fontFamily: MONO, fontWeight: 700, color: col(r.rule), display: "block" }}>{r.rule == null ? "—" : pct(r.rule, 1)}</span>
              {r.mret != null && <span style={{ fontSize: 10, fontFamily: MONO, color: C.muted, display: "block", ...ONE }}>시장 {pct(r.mret, 1)}</span>}</span>
            <span style={{ fontSize: FS.xs, fontFamily: MONO, textAlign: "right", color: r.after == null ? C.muted : r.after < 0 ? C.emerald : C.red }}>
              {r.after == null ? "—" : `${r.after < 0 ? "✓" : "✗"}${pct(r.after, 0)}`}</span>
            <span style={{ fontSize: FS.xs, fontFamily: MONO, textAlign: "right", color: C.dim }}>{r.peak == null ? "—" : pct(r.peak, 0)}</span>
          </div>))}
        {list.length > limit && <button onClick={() => setLimit(l => l + 15)} style={{ ...btn(C.dim), width: "100%", marginTop: 6 }}>더 보기 ({limit} / {list.length})</button>}
        <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>
          규칙 손익 = 매수! 날 종가에 사서, 처음 종가가 트레일링선 아래로 마감한 날 종가에 판 결과 (유지 중이면 지금까지).
          판 뒤 = 그 뒤 지금까지(판 날 다음 종가부터 · 그 전에는 —) · <b style={{ color: C.emerald }}>✓</b> 더 떨어짐(판 게 맞음) · <b style={{ color: C.red }}>✗</b> 다시 오름.
          최고 = 신호 뒤 가장 높았던 종가. "목록 빠짐" = 매수! 조건은 사라졌지만 매도 신호는 아님(보유 중이면 계속 보유).<br />
          시장 = 같은 기간 🇺🇸 S&P500 · 🇰🇷 코스피. "시장보다 ±%p" = 신호마다 (규칙 손익 − 시장)의 평균 — 플러스면 시장보다 나았다는 뜻.
          ★ 살 것 / 대기 n번 = 그 사이 '오늘 살 것' 목록에 들었던 날 (10/9부터 기록).
        </div>
      </Card>
    </>);
}

/** 197. 규칙 스스로 점검 — 파이프라인이 매일 만드는 self_check.json (보고·표시만 · 규칙은 안 바꿈) */
function SelfCheck({ openStock }) {
  const [o, setO] = useState(null);
  useEffect(() => { getJson("/data/self_check.json?t=" + Date.now()).then(setO).catch(() => setO(null)); }, []);
  if (!o) return null;
  const r = o.report || {}, an = o.anomalies || [], sh = (r.shadow || {}).summary || {};
  const lv = { err: [C.red, "❌"], warn: [C.gold, "⚠️"], info: [C.muted, "ℹ️"] };
  const line = { fontSize: FS.xs, color: C.dim, lineHeight: 1.6 };
  return (
    <>
      <Sec right={`다음 보고 ${md(r.next)}(토)`}>규칙 스스로 점검 · 3주마다</Sec>
      <Card style={{ padding: "8px 12px" }}>
        <div style={{ fontSize: FS.xs, color: C.muted, marginBottom: 6 }}>보고만 합니다 — 규칙은 자동으로 바뀌지 않습니다. 판정은 기록이 30건 넘게 쌓인 것만.</div>
        <b style={{ fontSize: FS.sm }}>데이터 이상 (매일)</b>
        {an.length ? an.map((a, i) => <div key={i} style={{ ...line, color: lv[a.lvl]?.[0] }}>{lv[a.lvl]?.[1]} {a.msg}</div>)
          : <div style={{ ...line, color: C.emerald }}>✓ 이상 없음 · {o.at} 확인</div>}
        {/* 213. 숫자는 아래 '실전 신호 성적' 표 하나에만 — 여기는 판정만 한 줄 */}
        <b style={{ fontSize: FS.sm, display: "block", marginTop: 8 }}>신호별 판정 <span style={{ fontWeight: 400, color: C.muted, fontSize: FS.xs }}>(숫자는 아래 표)</span></b>
        <div style={line}>{(r.signals || []).map((x, i) => <span key={x.k}>{i ? " · " : ""}{x.k} <b style={{ color: /못함/.test(x.verdict) ? C.gold : C.muted }}>{x.verdict.replace(/ — .*/, "")}</b></span>)}</div>
        {r.saved?.pct != null && <div style={line}>판 뒤 더 떨어진 비율 {r.saved.pct}% ({r.saved.n}건) — 50% 넘으면 파는 규칙이 제 몫을 함</div>}
        <b style={{ fontSize: FS.sm, display: "block", marginTop: 8 }}>대안과 비교 (같은 날 후보로 '만약')</b>
        {[["us", "🇺🇸"], ["kr", "🇰🇷"]].map(([m, f]) => Object.entries(sh[m] || {}).map(([k, x]) => (
          <div key={m + k} style={line}>{f} {x.name}{x.avg != null ? ` · 평균 ${x.avg >= 0 ? "+" : ""}${x.avg}% (${x.n}건)` : ""} → <b style={{ color: /검토 후보/.test(x.verdict) ? C.gold : C.muted }}>{x.verdict}</b></div>)))}
        <div style={{ fontSize: 10.5, color: C.muted }}>그림자 기록 {(r.shadow || {}).days || 0}일째{(r.shadow || {}).since ? ` · ${md(r.shadow.since)}부터` : ""} · 그날 고른 종목을 20거래일 들고 있었다면의 평균</div>
        <b style={{ fontSize: FS.sm, display: "block", marginTop: 8 }}>처리 안 된 매도!</b>
        {(r.sells || []).length ? r.sells.map(x => (
          <div key={x.t} onClick={() => openStock?.(x.t)} style={{ ...line, color: C.red, cursor: "pointer" }}>{x.m === "kr" ? x.n : x.t} — 매도! {x.days}일째 ›</div>))
          : <div style={{ ...line, color: C.emerald }}>✓ 없음</div>}
        {(r.conv || []).length > 0 && <div style={{ ...line, color: C.gold }}>⚠ 매도! 상태에서 장기로 바꿈: {r.conv.map(x => `${/^\d{6}$/.test(x.t) ? (x.n || x.t) : x.t} (${md(x.d)})`).join(" · ")}</div>}
      </Card>
    </>);
}

function ReviewTab({ market, uni, snap, trades, setTrades, pos, stocks, setTab, openStock, sizer, today, siglog, syncState, onShowRules, picksLog }) {
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
  const VAL = { "pull:kr": ["눌림 🇰🇷"], "strong:us": ["강세 🇺🇸"], "strong:kr": ["강세 🇰🇷"], "buy:kr": ["추세 🇰🇷"], "buy:us": ["추세 🇺🇸"] };
  const drift = live.drift;
  return (
    <>
      {/* 179. 번호로 묶기 — ① 이번 주 할 일 ② 신호가 잘 맞나 ③ 내 매매 기록 ④ 설정·근거 */}
      <Step n="1" q="주 1회 · 토요일">이번 주 할 일</Step>
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

      {/* 162. '파이프라인 집계' 줄은 아래 '지난 신호 복기'와 같은 값을 다른 계산으로 한 번 더 보여 줘서 뺐습니다 (텔레그램은 같은 계산으로 맞춤) */}
      {drift?.flag && (
        <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(255,69,58,.12)", border: `1px solid ${C.red}66` }}>
          <div style={{ fontSize: FS.md, fontWeight: 800, color: C.red }}>🚨 규칙 재검토 필요</div>
          <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 3 }}>{drift.reasons.join(" · ")}</div>
          <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 3 }}>기준선: 최근 30건 승률 20% 미만 또는 지수대비 −3%p 아래. 신호가 시장과 안 맞고 있다는 뜻입니다. 매수를 줄이고 원인을 보세요.</div>
        </div>)}
      <Step n="2" q="앱 신호의 실제 성적">신호가 잘 맞나</Step>
      <SelfCheck openStock={openStock} />
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
            검증값(백테스트, 20일 보유 근사): 눌림 🇰🇷 거래당 +3.0% · 승률 31% / 강세 🇺🇸 +2.8% · 40% / 강세 🇰🇷 신호 20일 뒤 평균 +2.2%(180).
            {drift && !drift.flag && <> 최근 30건: 승률 {drift.win}% · 지수대비 {drift.excess >= 0 ? "+" : ""}{drift.excess}%p — <b style={{ color: C.emerald }}>정상</b>.</>}
            {" "}경보 기준: 최근 30건 승률 20% 미만 또는 지수대비 −3%p 아래 · 검증 평균 승률은 31~40%라 그보다 높은 건 좋은 쪽입니다 · 30건 전에는 우연의 범위.
          </div>
        </>)}
      </Card>

      <RecentSignals siglog={siglog} stocks={stocks} openStock={openStock} market={market} />
      <SignalReview siglog={siglog} stocks={stocks} market={market} openStock={openStock} picksLog={picksLog} />

      <Step n="3" q="규칙대로 했나">내 매매 기록</Step>
      <TradeLog trades={trades} setTrades={setTrades} />
      <Step n="4">설정 · 근거</Step>
      <SettingsHub sizer={sizer} setTab={setTab} syncState={syncState} onShowRules={onShowRules} />

      <Sec>검증 근거 (백테스트)</Sec>
      <Info label="7개 규칙의 검증 수치 보기">
        <div style={{ color: C.text }}>
      <Card style={{ padding: "4px 12px 10px" }}>
        {[
          ["⭐ 눌림 매수 (종목)", "strong", "한국 연 +21.8% · 같은 종목 보유 대비 +8.2%p · 최대낙폭 −40%",
           "추세 안에서 RSI 45 회복 · 매도는 느린ST 빨강. 미국은 연 +17.9%지만 그냥 보유를 못 이겼습니다."],
          ["🏦 DC 느린ST 규칙", "mid", "연 +7.2% · 최대낙폭 −13.3% · 샤프 0.58 (2008-03~2026-10 원화 · 비용 0.1%)",
           "나스닥100·S&P500·코스피200 각 23% + 안전자산 30%, 각 몫은 느린ST 초록일 때만 보유 (230: 예전 S&P·코스피 둘이면 +6.3% · −15.8% — 3년 구간 188개 중 145개에서 3지수가 나음). 최대낙폭은 2026-10 코스피 급락이 들어간 값."],
          ["🏦 DC 3지수 보유 (선택지)", "mid", "연 +12.4% · 최대낙폭 −22.3% · 샤프 0.80 (같은 조건) · 1년 매매 1번",
           "같은 3지수를 그냥 들고 1월 첫 거래일에만 비중 맞춤. 같은 188개 구간 중 187개에서 느린ST보다 수익이 높았고, 대신 낙폭이 −13% → −22%로 큽니다. 나스닥을 빼면 수익이 크게 줄어 나스닥 몫이 핵심 (182)."],
          ["🇰🇷 강세 추가 (한국 종목)", "mid", "눌림만일 때보다 연 +3~5%p (순서·기준값 흔든 28번 중 26번 나음 · 중앙값 19.7% → 24.7%) · 2010–26 · 한국 5칸",
           "눌림이 드물어 빈 칸을 약한 추세 신호가 채우던 것을 강세가 대신. 신호 하나하나의 120일 지수대비: 강세 +7.4%p · 눌림 +8.1 · 추세 +2.7. 기준 60 한 점만 보면 32.7%로 나오지만 운이 섞인 값이라 낮춰 잡음 (180)."],
          ["🌊 과매도 (미국)", "mid", "12개월 보유 시 시장 대비 중앙값 +10.1% · 승률 60%",
           "생존편향 미보정이라 실제는 더 낮습니다. 한국은 검증 실패라 기본 제외."],
          ["🔄 섹터 교체", "weak", "원화·DC 조건에서 지수 보유와 차이 없음 (연 9.2% vs 9.2%)",
           "비중을 더 두고 싶은 섹터를 고를 때 참고용으로만."],
          ["🇰🇷 시장 판정 → 한국 새로 사기", "mid", "위험이면 새로 안 삼: 연 +24.1% · 최대낙폭 −52% (없으면 +11.4% · −72%) · 2010–26 · 한국 5칸",
           "16년 중 12년 나음 · 기준을 바꿔도 16~24% · 무작위로 막으면 11.9%. 예전 기록(종목 매매에 붙이면 21.8% → 11.1%)과 반대라 '근거 보통'으로 둡니다. 눌림 신호만 쓰면 효과 없음(9.8% → 9.7%). 생존 종목 기준이라 수익률 자체는 실제보다 높게 나옴. DC는 이 판정을 쓰지 않음."],
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
      {parts.map(([m, f]) => { const x = t[m]; if (!x.rn && !x.sell) return null;     // 92. 위험 합계
        return (
          <div key={"r" + m} style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: FS.xs, color: C.dim, flexWrap: "wrap" }}>
            <span>{f} 전부 선에 닿으면</span>
            <b style={{ fontFamily: MONO, color: C.red }}>−{money(x.risk, m)}</b>
            <span>(평가의 −{x.val ? (x.risk / x.val * 100).toFixed(1) : "0"}%)</span>
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
function PlanCard({ sizer, bumpSizer, pos, stocks }) {
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
          <Row k="dcAmt" label="🏦 DC" unit="원" m="kr" sub={dcModeOf() === "hold" ? "3지수 보유" : "느린ST"} />
          <Row k="usAmt" label="🇺🇸 직투" unit="$" m="us" sub={sizer.fx && p.usAmt ? `≈ ${money(p.usAmt * sizer.fx, "kr")} (환율 ${sizer.fx.toFixed(0)})` : "달러로 입력"} />
          <Row k="krAmt" label="🇰🇷 직투" unit="원" m="kr" sub="강세·눌림" />
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

/* 계좌 연결 상태 — /api/broker 설정만 한 번 묻고 기억 (비밀번호 없이 · 잔고는 안 봄) */
let BROKER_INFO = null, BROKER_WAIT = null;
function useBroker() {
  const [b, setB] = useState(BROKER_INFO);
  useEffect(() => {
    if (BROKER_INFO) return;
    BROKER_WAIT = BROKER_WAIT || fetch("/api/broker").then(r => r.ok ? r.json() : null).catch(() => null);
    let dead = false; BROKER_WAIT.then(j => { BROKER_INFO = j || { canOrder: false }; if (!dead) setB(BROKER_INFO); });
    return () => { dead = true; };
  }, []);
  return b;
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
  const dcMode = dcModeOf() === "hold" ? "3지수 보유" : "느린ST 규칙";
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
        <Row k="칸 수" v={`🇺🇸 ${plan.slotsUs || SLOTS_DEFAULT.us}칸 · 🇰🇷 ${plan.slotsKr || SLOTS_DEFAULT.kr}칸 (권장 🇺🇸 7 · 🇰🇷 5 — 매뉴얼 1-1장)`} go={() => setTab("track")} />
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
      const { j } = await postWatch({ bulk: true, positions: pos, watch, extras: nextExtras, excludes: nextExcl, trades: (trades || []).slice(-300) });
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
          <span style={{ fontSize: FS.xs, color: C.muted }}>어떤 종목을 보나</span>
        </div>
        {(() => {   // 169. 숫자마다 뜻을 붙여 따로 — 종목풀(이번 주 명단) · 오늘 신호 계산 · 뺀 종목
          const drop = Object.values(h.dropped || {}).reduce((a, b) => a + b, 0) + (h.failed || 0);
          const total = h.universe ?? h.fullUniverse;
          const Box = ({ k, v, sub, c }) => (
            <div style={{ background: "rgba(255,255,255,.04)", borderRadius: 9, padding: "8px 6px", textAlign: "center", minWidth: 0 }}>
              <div style={{ fontSize: 10.5, color: C.muted }}>{k}</div>
              <div style={{ fontSize: 17, fontWeight: 800, fontFamily: MONO, color: c || C.text }}>{v ?? "—"}</div>
              <div style={{ fontSize: 10, color: C.muted, ...ONE }}>{sub}</div></div>);
          return <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 6, marginTop: 8 }}>
              <Box k="종목풀" v={total} sub="이번 주 명단" />
              <Box k="오늘 신호 계산" v={list.length} sub={`🇰🇷 ${list.filter(s => s.m === "kr").length} · 🇺🇸 ${list.filter(s => s.m === "us").length}`} c={C.emerald} />
              <Box k="뺀 종목" v={h.mode === "focus" ? (total != null ? total - list.length : null) : drop} sub={h.mode === "focus" ? "평일 감시 모드" : "아래 이유"} />
            </div>
            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5, lineHeight: 1.6 }}>
              {h.mode === "focus" ? "평일엔 신호가 날 수 있는 종목만 계산(감시 모드) · 토요일에 전체 다시 계산"
                : `뺀 ${drop} = ${[...Object.entries(h.dropped || {}).map(([k, v]) => `${k} ${v}`), h.failed ? `수집 실패 ${h.failed}` : null].filter(Boolean).join(" · ") || "없음"}`}
            </div></>;
        })()}
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
          {h.mode !== "focus" && uni.total != null && list.length !== uni.total && (
            <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 3 }}>
              들어온 {uni.total} − 오늘 제외 {Object.values(h.dropped || {}).reduce((a, b) => a + b, 0)}{Object.keys(h.dropped || {}).length ? `(${Object.entries(h.dropped).map(([k, v]) => `${k} ${v}`).join(" · ")})` : ""} − 수집 실패 {snap?.meta?.counts?.failed ?? 0} = 지금 {list.length}종목</div>)}
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
