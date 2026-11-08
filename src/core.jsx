/* 264. 여러 탭이 같이 쓰는 것 — 색·글자·버튼·카드·숫자 표시·시장 시간·데이터 도구 (App.jsx 에서 자동으로 나눔) */
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




/** 135. 수집 데이터에 남아 있던 "&amp;" 를 "&" 로 (예: Procter &amp; Gamble). 파이프라인이 고친 뒤에는 할 일이 없어 그냥 지나갑니다 */
export const getJson = (url) => fetch(url).then(r => r.ok ? r.text().then(t => JSON.parse(t.includes("&amp;") ? t.replace(/&amp;/g, "&") : t)) : null);

/* ══════════════ 디자인 토큰 ══════════════ */
export const C = {
  bg: "#0A0E1A", panel: "#0F1420", panel2: "#161B2E", border: "rgba(255,255,255,.09)",
  text: "#E5E7EB", dim: "#9CA3AF", muted: "#6B7280",
  gold: "#F59E0B", emerald: "#30D158", cyan: "#06B6D4", violet: "#A78BFA",
  red: "#FF453A", orange: "#FF9F0A",
};
export const pct = (v, d = 2) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
export const col = (v) => (v == null ? C.muted : v > 0 ? C.emerald : v < 0 ? C.red : C.dim);
export const num = (v, d = 2) => (v == null ? "—" : v.toLocaleString("ko-KR", { maximumFractionDigits: d }));
/** 가격 표기 — 한국은 원(소수 없음), 미국은 달러(소수 2자리) */
export const price = (v, m = "us") => (v == null ? "—" : m === "kr" ? `₩${num(v, 0)}` : `$${num(v, 2)}`);
/** 금액 표기 — 시장별 단위. m="kr" 이면 원(조/억), 아니면 달러($B/$M).
 *  ※ 시장을 안 넘기면 미국 거래대금 $18.9B 가 "189억"으로 찍힙니다(원/달러 혼동). */
export const money = (v, m = "us") => {
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
export const SLOTS_KST = [[16, 17], [6, 23]];
export const SAT_SLOT = [9, 13];   // 토 09:13 KST 주간 백업

/** 미국이 서머타임(EDT)인지 — 하드코딩하면 겨울 반년 동안 세션 표시가 30분씩 틀립니다 */
export function usDST(nowMs) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "short" })
      .formatToParts(new Date(nowMs)).find(p => p.type === "timeZoneName")?.value === "EDT";
  } catch { return true; }
}

/* 257. 휴장일 — config/market.json 한 파일 (앱·서버·파이프라인 공통) */
export const KR_HOLIDAYS = new Set(Object.keys(MKT_CAL.kr));
export const US_HOLIDAYS = new Set(Object.keys(MKT_CAL.us));
export const HOLI_NAME = { ...MKT_CAL.us, ...MKT_CAL.kr };
/** 오늘 날짜 (한국 시간) — 매수·매도 기록 날짜에 씁니다. 예전엔 UTC 날짜라 오전 9시 전 기록이 하루 전으로 찍혔습니다 */
export const kstDay = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
export function marketState(nowMs = Date.now()) {
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

/* ══════════════ 검증 결과 — 시장별 근거 등급 ══════════════
   백테스트(미국 416종목·한국 294종목, 1996~2026)에서 시장마다 답이 달랐습니다.
   같은 규칙을 두 시장에 쓰면 한쪽이 반드시 틀리므로, 여기 한 곳에 적어 두고
   화면·알림이 모두 이 표를 따릅니다.                                        */
export const EVIDENCE = {
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
export function verdictOversold(s) {
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
export const FS = { xs: 11, sm: 12, md: 13, lg: 15, xl: 20 };
export const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";

export const Chip = ({ children, tone = "n" }) => {
  const m = { g: [C.emerald, "rgba(48,209,88,.10)"], r: [C.red, "rgba(255,69,58,.10)"],
              w: [C.gold, "rgba(245,158,11,.10)"], c: [C.cyan, "rgba(6,182,212,.10)"], n: [C.dim, "rgba(255,255,255,.05)"] }[tone];
  return <span style={{ fontSize: FS.xs, fontWeight: 600, padding: "2px 7px", borderRadius: 5, background: m[1], color: m[0], whiteSpace: "nowrap" }}>{children}</span>;
};

export const Star = ({ on, onClick }) => (
  <button onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label={on ? "관심 해제" : "관심 등록"}
    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, width: 34, height: 38, margin: "-4px -6px 0 0",
             color: on ? C.gold : "rgba(156,163,175,.7)", lineHeight: 1, flexShrink: 0, padding: 0 }}>{on ? "★" : "☆"}</button>
);
export const Empty = ({ children }) => (
  <div style={{ padding: "28px 12px", textAlign: "center", color: C.muted, fontSize: FS.sm }}>{children}</div>
);

export const Card = ({ children, style }) => (
  <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, ...style }}>{children}</div>
);

export const Sec = ({ children, right }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "16px 2px 7px" }}>
    <span style={{ fontSize: FS.md, fontWeight: 700, color: C.text }}>{children}</span>
    {right && <span style={{ fontSize: FS.xs, color: C.muted, marginLeft: "auto" }}>{right}</span>}
  </div>
);

/** 구간 수익률 — 칸마다 이름을 붙여 머리글이 따로 필요 없습니다 */
export const pctFit = (v) => (v == null ? "—" : pct(v, Math.abs(v) >= 100 ? 0 : 1));

/** 근거 강도 — 검증 결과를 앱 전체에서 같은 말로 표시합니다 */
export const GRADE = { strong: ["●●●", "근거 강함", C.emerald], mid: ["●●○", "근거 보통", C.gold], weak: ["●○○", "참고용", C.muted] };
export const Grade = ({ k }) => {
  const g = GRADE[k]; if (!g) return null;
  return <span style={{ fontSize: FS.xs, color: g[2], fontWeight: 700, whiteSpace: "nowrap" }}>{g[0]} {g[1]}</span>;
};

/** 매매 신호 칩 — 파이프라인 sig: buy(새로 삼) / exit(들고 있으면 팜) / keep */
/* ══════════════ 포지션(회차) 도우미 ══════════════
   p = { id, t, role, date, tr: [{d, px, amt}] }   ※ 구버전 {avg} 만 있으면 tr 하나로 봅니다 */
export const trOf = (p) => (Array.isArray(p.tr) && p.tr.length ? p.tr : [{ d: p.date, px: p.avg, amt: p.amt || 0 }]);
export const avgOf = (p) => { const tr = trOf(p); const a = tr.reduce((x, t) => x + (t.amt || 0), 0); const sh = tr.reduce((x, t) => x + (t.amt || 0) / t.px, 0);
  return sh > 0 ? a / sh : tr[0].px; };
export const investedOf = (p) => trOf(p).reduce((x, t) => x + (t.amt || 0), 0);
export const nextTrancheOf = (p, s, limit) => {   // 2회차 조건: 1회차 +3% ~ +6% 밴드 안에서 마감 · 느린ST 초록 · 아직 1회차뿐
  const tr = trOf(p); if (tr.length >= 2 || !s?.c) return null;   // (+6% 넘게 오른 날은 추격 금지 — 검증과 같은 밴드)
  const target = tr[0].px * RULES.tranche2.lo, cap = tr[0].px * RULES.tranche2.hi;   // 260. config/rules.json
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
export const ACTION = { buy: ["매수!", C.emerald], sell: ["매도!", C.red], watch: ["관망", C.muted], hold: ["보유", C.cyan] };
export const WHY = { pull: "눌림", strong: "강세", trend: "추세", st: "트레일링선 아래" };
// 매도! 는 들고 있을 때만 뜻이 있습니다. 안 들고 있는 종목의 추세 이탈은 '관망 (추세 이탈)'
export const actionOf = (s, held) => (s?.action === "sell" ? (held ? "sell" : "watch") : held ? "hold" : (s?.action || "watch"));
export const ActionTag = ({ s, held, big }) => {
  const k = actionOf(s, held); const [t, c] = ACTION[k];
  const why = k === "buy" ? WHY[s.why] : k === "sell" ? WHY.st : (k === "watch" && s?.action === "sell") ? "추세 이탈" : null;
  return <span style={{ fontSize: big ? FS.lg : FS.xs, fontWeight: 800, color: c, whiteSpace: "nowrap" }}>
    {t}{why && <span style={{ fontWeight: 500, color: C.dim }}> ({why})</span>}</span>;
};
/* 급락 탭 전용 판정 (매수! 를 쓰지 않습니다 — 12~24개월 방식이라) */
export const DIP = { watch: ["관찰", C.cyan], wait: ["대기", C.muted], broken: ["⚠ 훼손", C.red] };
export const DipTag = ({ s, big }) => {
  const k = s?.dip; if (!k || !DIP[k]) return <span style={{ fontSize: big ? FS.lg : FS.xs, color: C.muted }}>—</span>;
  const [t, c] = DIP[k];
  return <span style={{ fontSize: big ? FS.lg : FS.xs, fontWeight: 800, color: c, whiteSpace: "nowrap" }}>{t}</span>;
};
export const SigChip = ({ s }) => <ActionTag s={s} />;

/* ══════════════ 종목 행 (모든 탭 공통) ══════════════ */
export const ONE = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
export const COLS3 = "repeat(3, clamp(40px, 12.5vw, 50px))";   // 3일·5일·1달 열 — 행과 고정 바가 같은 폭을 씁니다
/** 회사명 축약 — "Dell Technologies Inc." → "Dell Technologies". 풀네임이 아니어도 알아봅니다 */
export const shortName = (n) => (n || "")
  .replace(/,?\s*(Inc\.?|Corp\.?|Corporation|Co\.,? Ltd\.?|Ltd\.?|plc|PLC|N\.V\.|S\.A\.|Holdings?|Group|Company|Limited|Class [A-C])\s*$/i, "")
  .replace(/,?\s*(Inc\.?|Corp\.?|Corporation|Co\.,? Ltd\.?)\s*$/i, "")
  .replace(/\s*\(.*?\)\s*$/, "")
  .trim() || n;
export function StockRow({ s, rank, rel, sub, onOpen, isWatch, onToggle, dip = false, held = false, seen = false, onSeen, age, since, tag = null }) {
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

export const NASDAQ = new Set(["NMS", "NGM", "NCM", "NAS"]);
/** 75. 최신 아님 경고 — 상단 상태줄이 🟡 이상일 때 매수 쪽 화면에 */
// 166. 그 시장의 확정 종가가 실제로 빠졌을 때만 — 토요일 백업 수집이 늦는 것(lag)만으로는 띄우지 않음(금요일 종가는 이미 확정)
export const StaleWarn = ({ info, m }) => (info && (m ? !(m === "kr" ? info.okKr : info.okUs) : !(info.okKr && info.okUs))) ? (
  <div style={{ margin: "6px 0", padding: "7px 10px", borderRadius: 8, background: "rgba(245,158,11,.12)", border: `1px solid ${C.gold}66`,
                fontSize: FS.xs, color: C.gold, lineHeight: 1.5 }}>
    ⚠ 이 신호는 <b>{(m === "kr" ? info.kr : m === "us" ? info.us : (info.us || info.kr)) || "지난"} 종가</b> 기준입니다 — 최신 데이터가 아직 안 들어왔습니다({info.label}).
    주문 전에 📦 종목풀 → 🔄 시세 갱신을 누르거나 갱신될 때까지 기다리세요. 그사이 트레일링선 아래로 떨어졌을 수 있습니다.
  </div>) : null;
export const NOTES_REF = { cur: {} };     // 행 표시용 — App 이 그릴 때마다 최신으로 맞춤
export const tgtOf = (t, notes, s) => { const my = notes?.[t]?.tg; return my ? { v: my, mine: true } : (s?.tgt?.a ? { v: s.tgt.a, mine: false } : null); };
export const tgtGap = (tg, c) => (tg && c) ? (tg / c - 1) * 100 : null;

/** 62. 트레일링선 거리 — 앱 전체에서 한 가지 뜻: '선에 닿으면 잃는 폭'(%) 양수. 화면에는 "선까지 −17%" */
export const lossOf = (s) => (s?.stLine && s?.c) ? (1 - s.stLine / s.c) * 100 : null;
export const lossTxt = (s) => { const l = lossOf(s); return l == null ? "—" : l < 0 ? "선 아래" : `−${l.toFixed(0)}%`; };
export const mktOfT = (t) => /^\d{6}$/.test(t) ? "kr" : "us";
/** 109. 칸 = 동시에 들고 있을 종목 수 한도. 빈 칸 = 칸 수 − 지금 들고 있는 단기 종목 수 (앱 전체가 이 함수 하나를 씀) */
export const slotInfo = (pos, m) => {
  const plan = loadPlan();
  const n = m === "us" ? (plan.slotsUs || SLOTS_DEFAULT.us) : (plan.slotsKr || SLOTS_DEFAULT.kr);
  const held = (pos || []).filter(p => (p.role || "swing") === "swing" && mktOfT(p.t) === m).length;
  return { n, held, free: Math.max(0, n - held) };
};
/** 109. 투자금 여유 — 그 시장에 이미 넣은 돈 + 이번 금액이 직투 금액을 넘지 않는지 (💰 투자금을 정했을 때만 따짐) */
export const investedIn = (pos, m) => (pos || []).filter(p => p.role !== "etf" && mktOfT(p.t) === m).reduce((a, p) => a + investedOf(p), 0);
export const budgetOf = (sizer, m) => sizer?.plan ? (m === "us" ? sizer.plan.us : sizer.plan.kr) : null;
export const roomFor = (pos, sizer, m, amt) => { const b = budgetOf(sizer, m); return b == null || investedIn(pos, m) + amt <= b * 1.001; };
/** 87. 날짜 "2026-09-24" → "9/24" */
export const md = (d) => d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : "";
/** 93. 실적 발표일 — 그 시장 현지 날짜로 D-n (🇺🇸 뉴욕 · 🇰🇷 서울). 참고용: 매매 규칙에는 쓰지 않음 (과거 발표일 자료가 없어 검증 불가) */
export const localToday = (m) => { try { return new Date().toLocaleDateString("en-CA", { timeZone: m === "kr" ? "Asia/Seoul" : "America/New_York" }); } catch { return kstDay(); } };
export const earnDays = (s) => { if (!s?.earn) return null; const n = Math.round((Date.parse(s.earn) - Date.parse(localToday(s.m))) / 864e5); return Number.isFinite(n) && n >= 0 ? n : null; };
export const earnTxt = (s, within = 14) => { const n = earnDays(s); return (n == null || n > within) ? null : `실적 ${n === 0 ? "오늘" : "D-" + n}${s.earnE ? "(예상)" : ""}`; };
/** 105. 지금 가격 — 표시 전용 (매수!·매도! 는 종가로만). /api/quote 가 야후에서 20종목씩 묶어 받음 · 1분마다 · 화면 켜져 있을 때만 */
export const ysym = (s) => s.m === "kr" ? s.t + (String(s.ex || "").startsWith(".") ? s.ex : ".KS") : String(s.t).replace(".", "-");
export function useLive(list) {
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
export const liveOf = (s, q) => {
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
export const LiveTag = ({ s, q, short = false }) => {
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
export const EarnTag = ({ s, within = 14 }) => { const t = earnTxt(s, within); if (!t) return null;
  return <span style={{ fontSize: 10.5, fontWeight: 700, color: earnDays(s) <= 7 ? C.gold : C.muted, flexShrink: 0, whiteSpace: "nowrap" }}>📅 {t}</span>; };
/** 설정이 바뀌면 알림 — 자동 동기화가 듣습니다 (61) */
export const settingsChanged = () => { try { window.dispatchEvent(new Event("v11:settings")); } catch {} };  // 233. 이 날 전까지는 자동 반영하지 않고 '이렇게 반영할게요'로 먼저 보여 줌 (10/31 유령 보유 사고 뒤 일주일 지켜보기)        // 메리츠 체결 자동 반영은 이 날(미국 장 날짜) 이후 체결만 — 그 전 거래는 이미 정리한 기록
export const SYNC_BASE = "v13.syncBase";
/** 서버에 올리기 — 한 번에 하나씩(겹치면 서버가 '다른 기기'로 오해) · 마지막으로 본 서버 시각(base)을 같이 보냄 */
export let SYNC_Q = Promise.resolve();
export function postWatch(body) {
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
export const PLAN_KEY = "v11.plan";
// 계좌별 금액을 넣고 합계·비율은 계산 — DC 잔액·예수금은 이미 정해진 금액이라서 (56)
export const PLAN_DEFAULT = { dcAmt: 0, usAmt: 0, krAmt: 0, cashAmt: 0, slotsUs: SLOTS_DEFAULT.us, slotsKr: SLOTS_DEFAULT.kr, hist: [] };   // 168. 기본 = 권장 7·5
export const loadPlan = () => {
  const raw = loadJSON(PLAN_KEY, {});
  if (raw.total && raw.dcAmt == null) {           // v11.0 의 '총액 + 비율' 저장값을 금액으로 한 번 바꿔 둡니다
    const a = (k) => Math.round(raw.total * (raw[k] || 0) / 100);
    return { ...PLAN_DEFAULT, dcAmt: a("dc"), krAmt: a("kr"), cashAmt: a("cash"), usKrwOld: a("us"), slotsUs: raw.slotsUs || SLOTS_DEFAULT.us, slotsKr: raw.slotsKr || SLOTS_DEFAULT.kr };
  }
  return { ...PLAN_DEFAULT, ...raw };
};
export const planAmounts = (p, fx) => {
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
export const benchName = (s) => s?.m === "kr" ? "코스피" : (NASDAQ.has(s?.ex) ? "나스닥" : "S&P");

/** 매출 성장 필터 — 앱 전체 공통 설정. 오늘 할 일·찾기·선정이 같은 개수를 보여주도록 한 곳에서 읽습니다
    (텔레그램도 같은 기본값 +10% 를 씁니다) */
export const REV_KEY = "v9.revMin";
export const getRevMin = () => { try { const v = localStorage.getItem(REV_KEY); return v == null ? RULES.revMin : Number(v); } catch { return RULES.revMin; } };
/** 176. 한국 시장 '위험'(폭 3년 하위 40% 아래)이면 한국은 새로 사지 않음 — 오늘·찾기·한투·선정·파이프라인이 같은 판정을 씀 */
export const krGateOf = (market) => { const j = market?.judge?.kr; return !!(j && (j.blocked ?? (j.gate && j.verdict === "risk"))); };   // blocked = 새로 사지 않음 (옛 market.json 은 gate+risk)
/** 252. 🇺🇸 나스닥100 이 200일선 아래면 미국은 새로 사지 않음 — 파이프라인 judge.us.nqGate (오늘·찾기·계좌·텔레그램 같은 판정) */
export const usGateOf = (market) => { const j = market?.judge?.us; return !!(j && (j.blocked ?? j.nqGate)); };
export const US_GATE_TXT = "나스닥100 200일선 아래 — 새로 안 삼";
/** 254. 하락장(게이트) 동안 남는 돈 · DC 안전자산 — 2026-11 비교: 단기채 5년 최대낙폭 −0.5% · 장기채 −44~48%(2022 금리 급등) */
export const SPARE_TXT = { us: "남는 달러는 단기 국채 ETF(SGOV·BIL)에", kr: "남는 원화는 단기채·국고채3년 ETF에" };

/** '오늘 살 것' 설정 한 곳 — 칸 수·매출 필터·한국·미국 게이트 */
export const pickCfg = (market, plan = loadPlan()) => ({ revMin: getRevMin(), slotsUs: plan.slotsUs || SLOTS_DEFAULT.us, slotsKr: plan.slotsKr || SLOTS_DEFAULT.kr, krGate: krGateOf(market), usGate: usGateOf(market) });
export const growthOf = (s) => s?.fin ? (s.fin.growth ?? s.fin.qyoy ?? s.fin.ttm ?? s.fin.rev ?? null) : null;   // 최근 분기 → 4분기 → 연간
export const passRevOf = (s, revMin) => { const g = growthOf(s); return revMin <= 0 || s.m === "kr" || g == null || g >= revMin; };

/** 33·38. 종목 정보 외부 링크 — 전부 네이버 (🇰🇷 국내 · 🇺🇸 나스닥은 해외주식 페이지, 뉴욕은 네이버 검색) */
export const infoUrl = (s) => {
  if (!s) return "#";
  if (s.m === "kr") return `https://m.stock.naver.com/domestic/stock/${s.t}/total`;
  if (NASDAQ.has(s.ex)) return `https://m.stock.naver.com/worldstock/stock/${s.t}.O/total`;     // 네이버 해외주식 (나스닥 = .O)
  return `https://m.stock.naver.com/worldstock/stock/${encodeURIComponent(s.t)}/total`;           // 198. 뉴욕 = 접미사 없이 (예: CVX)
};
export const InfoLink = ({ s, style }) => (
  <a href={infoUrl(s)} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} aria-label="종목 정보 열기"
     style={{ color: C.muted, textDecoration: "none", fontSize: 13, padding: "0 4px", flexShrink: 0, ...style }}>↗</a>
);
/** 34. 티커 복사 — MTS 관심그룹 일괄 등록용 */
export function CopyBtn({ tickers, label = "티커 복사" }) {
  const [ok, setOk] = useState(false);
  const run = async (e) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(tickers.join("\n")); setOk(true); setTimeout(() => setOk(false), 1500); }
    catch { prompt("복사해서 쓰세요", tickers.join(", ")); }
  };
  return <button onClick={run} style={{ ...linkBtn, fontSize: FS.xs, minHeight: 32 }}>{ok ? "복사됨 ✓" : `📋 ${label} ${tickers.length}`}</button>;
}

/** 셋째 줄 참고 정보 — 거래 · 매수 주수 · RSI · 업종 순위 · 재무 */
export function subLine(s, sizer, market, extra = []) {
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

/* ══════════════ 1. 시장 ══════════════ */
/** 폭 추이 미니 차트 — 판정 줄 오른쪽. 점선 = 3년 백분위 40 근처(위험 경계) */
export function Spark({ b, c }) {
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

/** 159. 칸 머리 — 번호 · 제목 · 이 칸이 답하는 질문 (오늘 탭 흐름: 할 일 → 시장 → 위험 → 섹터 → 종목) */
export const Step = ({ n, children, q, right }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 2px 8px" }}>
    {n && <span style={{ width: 22, height: 22, borderRadius: 6, background: C.text, color: C.bg, fontSize: FS.xs, fontWeight: 800, fontFamily: MONO,
                          display: "grid", placeItems: "center", flexShrink: 0 }}>{n}</span>}
    <span style={{ fontSize: 15, fontWeight: 800, color: C.text, whiteSpace: "nowrap" }}>{children}</span>
    {q && <span style={{ fontSize: FS.xs, color: C.muted, minWidth: 0, ...ONE }}>{q}</span>}
    {right && <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: FS.xs, color: C.muted }}>{right}</span>}
  </div>);   // 252. 이름 칸 넓힘 (나스닥100 이 잘렸음)

// 칸 폭은 고정 픽셀 대신 비율로 — 글자를 키운 좁은 화면에서도 이름 칸이 뭉개지지 않게
export const IDX_GRID = "minmax(0,1.5fr) minmax(0,1.1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)";
/** 표 머리글 — 칸 이름을 행마다 반복하지 않고 한 번만 적습니다 */
// 좁은 화면에서 숫자가 잘리지 않도록 글자 크기를 화면 폭에 맞춰 줄입니다
export const FIT = { fontSize: "clamp(10.5px, 3.1vw, 12px)", fontFamily: MONO, whiteSpace: "nowrap", letterSpacing: -0.4 };
export const Head = ({ cols, grid }) => (
  <div style={{ display: "grid", gridTemplateColumns: grid, gap: 5, fontSize: "clamp(10px, 2.8vw, 10.5px)", color: C.muted, padding: "7px 0 3px" }}>
    {cols.map((c, i) => <span key={c} style={{ textAlign: i >= 2 ? "right" : "left", ...ONE }}>{c}</span>)}
  </div>
);

/* ══════════════ 241. 앱 실적 — '규칙 재검토 경보'를 겁주는 빨간 상자 대신 실적 요약으로 ══════════════
   매수! 신호 전체(실전 기록) · 매도 규칙 효과 · 실제로 고른 '오늘 살 것'(그림자 기록) · 최근 30건 */
export let SC_WAIT = null;
export function useSelfCheck() {
  const [j, setJ] = useState(null);
  useEffect(() => { SC_WAIT = SC_WAIT || fetch("/data/self_check.json?t=" + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null); let dead = false; SC_WAIT.then(x => { if (!dead) setJ(x); }); return () => { dead = true; }; }, []);
  return j;
}
export function AppPerf({ market, compact, onOpen }) {
  const live = market?.live || {}, sm = live.summary || {}, rv = live.review || {}, dr = live.drift;
  const sc = useSelfCheck(); const base = sc?.report?.shadow?.summary?.us?.base; const since = sc?.report?.shadow?.since;
  if (!live.n) return null;
  const weeks = live.since ? Math.max(1, Math.round((Date.now() - Date.parse(live.since)) / (7 * 864e5))) : null;
  const firstPick = since ? md(new Date(Date.parse(since) + 28 * 864e5).toISOString().slice(0, 10)) : null;
  const S = (k, l) => sm[k] ? `${l} ${pct(sm[k].avg, 1)} (지수 ${sm[k].excess >= 0 ? "+" : ""}${sm[k].excess?.toFixed(1)}%p · 승률 ${sm[k].win}%)` : null;
  const pickTxt = base?.n ? `고른 종목(오늘 살 것) ${base.n}건 ${pct(base.avg, 1)} · 승률 ${base.win}%` : `고른 종목(오늘 살 것) 성적은 ${firstPick || "20거래일 뒤"}쯤부터`;
  const tone = dr?.flag ? C.gold : C.border;
  if (compact) return (
    <button onClick={onOpen} style={{ display: "block", width: "100%", textAlign: "left", margin: "0 0 8px", padding: "8px 10px", borderRadius: 9, cursor: "pointer",
                                      background: "rgba(255,255,255,.03)", border: `1px solid ${tone}`, color: C.text }}>
      <b style={{ fontSize: FS.sm }}>📊 앱 실적</b> <span style={{ fontSize: FS.xs, color: C.muted }}>{live.since ? `${md(live.since)}부터 ${weeks}주` : ""} · 매수! 신호 20일 뒤</span>
      <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 2, lineHeight: 1.5 }}>
        {[S("strong:us", "🇺🇸 강세"), rv.savedPct != null ? `매도 뒤 더 빠짐 ${rv.savedPct}%` : null, pickTxt].filter(Boolean).join(" · ")}
        {dr?.flag ? <span style={{ color: C.gold }}> · 최근 30건이 지수보다 {dr.excess}%p</span> : null} ›</div>
    </button>);
  const Row = ({ k, v, sub, c }) => (
    <div style={{ padding: "8px 0", borderTop: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}><span style={{ fontSize: FS.sm, fontWeight: 700, flex: 1 }}>{k}</span><b style={{ fontFamily: MONO, color: c || C.text }}>{v}</b></div>
      {sub && <div style={{ fontSize: FS.xs, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{sub}</div>}
    </div>);
  return (
    <Card style={{ marginTop: 10, padding: "8px 12px 6px", borderColor: tone }}>
      <div style={{ fontSize: FS.md, fontWeight: 800 }}>📊 앱 실적 <span style={{ fontSize: FS.xs, color: C.muted, fontWeight: 400 }}>{live.since ? `${live.since}부터 ${weeks}주 · 신호 ${live.n}건` : ""}</span></div>
      {sm["strong:us"] && <Row k="🇺🇸 강세 신호 (20일 뒤)" v={pct(sm["strong:us"].avg, 1)} c={col(sm["strong:us"].avg)} sub={`지수 대비 ${sm["strong:us"].excess >= 0 ? "+" : ""}${sm["strong:us"].excess}%p · 승률 ${sm["strong:us"].win}% · ${sm["strong:us"].n}건 — 검증 기대치 거래당 +2.8% · 승률 40%`} />}
      {sm["buy:us"] && <Row k="🇺🇸 추세 신호" v={pct(sm["buy:us"].avg, 1)} c={col(sm["buy:us"].avg)} sub={`지수 대비 ${sm["buy:us"].excess >= 0 ? "+" : ""}${sm["buy:us"].excess}%p · 승률 ${sm["buy:us"].win}% · ${sm["buy:us"].n}건`} />}
      {sm["buy:kr"] && <Row k="🇰🇷 추세 신호" v={pct(sm["buy:kr"].avg, 1)} c={col(sm["buy:kr"].avg)} sub={`지수 대비 ${sm["buy:kr"].excess >= 0 ? "+" : ""}${sm["buy:kr"].excess}%p · 승률 ${sm["buy:kr"].win}% · ${sm["buy:kr"].n}건`} />}
      {rv.savedPct != null && <Row k="매도 규칙" v={`${rv.savedPct}%`} c={rv.savedPct >= 50 ? C.emerald : C.gold} sub={`판 뒤 더 떨어진 비율 (${rv.savedN}/${rv.judgedN}건) — 50% 넘으면 파는 규칙이 제 몫을 함`} />}
      <Row k="고른 종목 (오늘 살 것)" v={base?.n ? pct(base.avg, 1) : "쌓는 중"} c={base?.n ? col(base.avg) : C.muted} sub={base?.n ? `${base.n}건 · 승률 ${base.win}% · ${base.verdict || ""}` : `실제로 사는 목록(강도 순 · 업종 ${SEC_CAP}개까지 · 빈 칸만큼)의 성적 — ${since ? `${md(since)}부터 기록 중, ` : ""}첫 결과는 ${firstPick || "20거래일 뒤"}쯤`} />
      {dr && <Row k="최근 30건" v={`${dr.excess >= 0 ? "+" : ""}${dr.excess}%p`} c={dr.flag ? C.gold : C.emerald} sub={`승률 ${dr.win}% · ${dr.flag ? "기준(지수 −3%p · 승률 20%) 아래 — 지켜보는 중" : "정상 범위"}`} />}
      <div style={{ fontSize: 10.5, color: C.muted, padding: "6px 0 2px", lineHeight: 1.5 }}>기록이 짧고 같은 종목이 며칠씩 반복돼 실제 독립 기회는 건수보다 적습니다 · 매수! 전체는 실제로 사는 목록과 다릅니다 · 숫자로 규칙을 바꾸지 않고 보고만 합니다</div>
    </Card>);
}
export function loadJSON(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? d; } catch { return d; } }
// 182. DC 규칙: st=느린ST(기본) · hold=3지수 보유 — 예전 'dual'(듀얼 모멘텀)을 고른 기기는 3지수 보유로 봅니다
export function dcModeOf() { try { const v = localStorage.getItem("v9.dc.mode"); return v === "hold" || v === "dual" ? "hold" : "st"; } catch { return "st"; } }
/** 시장 대비 = 그 종목 1달 수익 − 같은 시장 지수 1달 수익 */
export const benchOf = (s) => s.m === "kr" ? "^KS11" : (NASDAQ.has(s.ex) ? "^IXIC" : "^GSPC");   // 이름표(benchName)와 같은 기준
export const relOf = (s, market) => {
  const i = market?.indices?.[benchOf(s)];
  return (s.d21 == null || i?.d21 == null) ? null : s.d21 - i.d21;
};

/** 찾기 탭 상태를 세션에 남깁니다 — 탭을 오가도 필터·정렬·더 보기가 풀리지 않게 (31) */
export const useSticky = (key, init) => {
  const [v, set] = useState(() => { try { const x = sessionStorage.getItem(key); return x == null ? init : JSON.parse(x); } catch { return init; } });
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch {} }, [v]);
  return [v, set];
};
/** 154. 시장별 종가 기준일 — 종목 데이터에서 가장 많은 날짜 (미국·한국 날짜가 다를 수 있어서 나눠 보여 줌) */
export const asOfOf = (stocks, m) => { const c = {}; for (const v of Object.values(stocks || {})) if (v?.m === m && v.asOf) c[v.asOf] = (c[v.asOf] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null; };
/** 87. 🆕 표시 — '오늘'이 아니라 종가 날짜로 (미국 종가는 한국 아침에 들어와 달력 날짜와 하루 어긋남) */
// 154. "9/23~ 14일째"는 계속 이어진 것처럼 읽혀서(중간에 신호가 꺼졌다 켜졌을 수 있음) '첫 신호 날짜'로만 씁니다
export const newTxt = (age, since) => !since ? (age <= 1 ? "🆕 새로" : `${age}거래일 전 첫 신호`)
  : age <= 1 ? `🆕 ${md(since)} 종가` : age <= 3 ? `🆕 ${md(since)} 첫 신호` : `${md(since)} 첫 신호`;
export const NewTag = ({ age, since }) => age == null ? null : (
  <span style={{ fontSize: 10.5, fontWeight: 800, color: age <= 1 ? C.gold : C.muted, flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                 background: age <= 1 ? "rgba(245,158,11,.15)" : "transparent", borderRadius: 4, padding: age <= 1 ? "0 4px" : 0 }}>
    {newTxt(age, since)}</span>);
export const Seg = ({ value, onChange, items, full }) => (
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

/* ══════════════ 점검 — 주 1회 루틴 ══════════════
   토요일(종목풀 갱신 뒤)에 한 번. 매번 헤매지 않게 순서를 고정합니다.               */
export const weekKey = () => {                      // 이번 주(토요일 시작) 키
  const d = new Date(Date.now() + 9 * 3600000); const dow = d.getUTCDay();
  const sat = new Date(d); sat.setUTCDate(d.getUTCDate() - ((dow + 1) % 7));
  return sat.toISOString().slice(0, 10);
};
/** 152. 이 종목이 '오늘 살 것' 목록에 들었던 날들 — [{d, i(순번), buy(살 것이었나)}] */
export const pickedDays = (picksLog, t, m) => (picksLog || []).flatMap(row => (row[m] || []).filter(x => x.t === t).map(x => ({ d: (m === "us" ? row.du : row.dk) || row.d, i: x.i, buy: !!x.buy })));

/* 계좌 연결 상태 — /api/broker 설정만 한 번 묻고 기억 (비밀번호 없이 · 잔고는 안 봄) */
export let BROKER_INFO = null, BROKER_WAIT = null;
export function useBroker() {
  const [b, setB] = useState(BROKER_INFO);
  useEffect(() => {
    if (BROKER_INFO) return;
    BROKER_WAIT = BROKER_WAIT || fetch("/api/broker").then(r => r.ok ? r.json() : null).catch(() => null);
    let dead = false; BROKER_WAIT.then(j => { BROKER_INFO = j || { canOrder: false }; if (!dead) setB(BROKER_INFO); });
    return () => { dead = true; };
  }, []);
  return b;
}

/* ══════════════ 잡 UI ══════════════ */
export const linkBtn = { background: "none", border: "none", color: C.cyan, cursor: "pointer", fontSize: FS.sm, padding: "0 2px", minHeight: 36, fontWeight: 600 };
export const inp = (w) => ({ background: "rgba(255,255,255,.05)", border: `1px solid ${C.border}`, borderRadius: 8,
                      padding: "0 11px", minHeight: 38, color: C.text, fontSize: 16, width: w, outline: "none", boxSizing: "border-box" });
export const btn = (c) => ({ background: `${c}1f`, border: `1px solid ${c}55`, color: c, borderRadius: 9, minHeight: 38,
                      padding: "0 12px", fontSize: FS.sm, fontWeight: 700, cursor: "pointer" });
export const Toggle = ({ on, onClick, children, full }) => (
  <button onClick={onClick} aria-pressed={on} style={{
    width: full ? "100%" : undefined, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
    fontSize: FS.sm, fontWeight: 700, padding: "0 10px", minHeight: 38, borderRadius: 9, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
    background: on ? "rgba(245,158,11,.16)" : "rgba(255,255,255,.05)",
    color: on ? C.gold : C.muted, border: `1px solid ${on ? C.gold + "55" : "transparent"}`,
  }}>{children}</button>);
/** 긴 설명은 기본으로 접어 둡니다 */
export const Info = ({ label = "근거", children, right }) => {
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
