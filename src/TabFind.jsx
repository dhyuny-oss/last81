/* 264. Find 탭 — 이 탭만 쓰는 화면 (App.jsx 에서 자동으로 나눔 · 다른 탭과 같이 쓰는 건 core.jsx) */
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
import { C, COLS3, Card, CopyBtn, Empty, FIT, FS, Grade, Head, Info, LiveTag, MONO, ONE, REV_KEY, SPARE_TXT, Seg, StaleWarn, Step, StockRow, Toggle, US_GATE_TXT, asOfOf, btn, col, earnTxt, getRevMin, growthOf, linkBtn, liveOf, loadJSON, loadPlan, md, newTxt, num, passRevOf, pct, pctFit, pickCfg, planAmounts, price, relOf, settingsChanged, shortName, slotInfo, subLine, trOf, useLive, useSticky, weekKey } from "./core.jsx";



/** 목록 위에 붙어 스크롤해도 남는 바 — 시장 등락(비교 기준) + 정렬 */
export const SortBar = ({ text, n, market }) => {
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
};      // (구버전 호출 호환)
/* 표기 설명 — 한 곳에서 관리해 찾기·차트가 다른 말을 하지 않게 */
export const EXPLAIN = {
  trend: [
    ["매수! (눌림)", "🇰🇷 50일선>200일선 · 종가>200일선 · RS 70↑ · 느린 ST 초록 · RSI(14)가 45 아래→위로 올라온 날. 검증 1위"],
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
    ["업종 3위", "이 종목 업종의 업종 ETF 순위 (미국만)"],
    ["매출 +16% 분기↑ · 흑자", "최근 분기 매출의 전년 동기 대비 (SEC 공시, ↑ = 직전 분기보다 성장 가속). 없으면 4분기 합계 → 연간. 미국만. 검증 불가라 조건이 아닌 취향 필터 — 한국·재무 없는 종목은 통과"],
    ["예비", "관찰용. rising = 추세 유지·RS 55~70·1달 시장대비 + / turn = 느린 ST 초록 전환 3일 이내. 검증에서 현행을 못 이겨 매수!로 쓰지 않음"],
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
export const ROW_GUIDE = [
  ["1줄", "DELL Dell Technologies ↗ 🆕 9/24 종가 ○ · $568.06 · 전일 −3.5% · ☆", "티커(한국은 이름) · 네이버 ↗ · 매수! 된 지 며칠째 · 확인함 ○ · 종가 · 전일 대비 · 관심 ☆"],
  ["2줄", "매수! (강세) · RS 100 · 1달 S&P比 +31p · +4.5% +0.1% +29.8%", "행동(근거) · 6개월 상대강도 순위 · 1달 수익 − 비교 지수 1달 수익 · 3일·5일·1달 누적(위 고정 바와 같은 열)"],
  ["3줄", "강도 88 · 선까지 −16% · 시총 $390B · 하루 거래 $5.2B · RSI 62(3일↑) · 업종 기술 2위 · 매출 분기 전년比 +58% · 흑자",
          "강도(RS+200일선) · 선에 닿으면 잃는 폭 · 시가총액 · 20일 평균 하루 거래대금 · 한도 절반으로 살 수 있는 주수 · RSI와 3일 전 대비 방향 · 섹터 ETF 점수 순위 · 최근 분기 매출의 전년 같은 분기 대비"],
];
export const ExplainList = ({ items }) => (
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
export function BreadthBar({ b, c }) {
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

/* 245. 찾기 › 🌐 시장 — 예전 오늘 탭 2·3·4번 (시장 상태 · 위험 지표 · 미국 섹터) */
export function MarketInfo({ market, setTab, list, pos, stocks, items, sizer, openStock }) {
  const J = { safe: ["안전", C.emerald], warn: ["주의", C.gold], risk: ["위험", C.red] };
  const risk = market.risk || {};
  const spy21 = market.indices?.["^GSPC"]?.d21 ?? null;
  const sectors = market.sectors || [];
  const [secView, setSecView] = useSticky("v13.market.secView", "ret");
  const [secOpen, setSecOpen] = useSticky("v13.market.secOpen", false);      // 섹터: 수익률 / PER·매수! 수
  const revMin = getRevMin();
  const buyL = (list || []).filter(x => x.action === "buy" && (x.tvr ?? 0) >= RULES.tvrMin).filter(x => passRevOf(x, revMin));
  const secRank = Object.fromEntries(sectors.map(x => [x.tk, [x.rank, x.label]]));
  const usBuy = (() => {          // 그 업종에서 오늘 살 것 (오늘 탭 3번과 같은 함수 · 빈 칸만큼)
    const pa = sizer?.plan; if (!pa || !(pa.us > 0)) return [];
    const P = pickToday(stocks || {}, pickCfg(market, loadPlan()), new Set((pos || []).map(p => String(p.t).toUpperCase())), { secRank });
    return P.pickUs.slice(0, slotInfo(pos, "us").free);
  })();
  const buyBySec = {}; usBuy.forEach(r => { (buyBySec[r.sec] = buyBySec[r.sec] || []).push(r.t); });
  const heldBySec = {}; (pos || []).forEach(p => { const s = stocks[p.t]; if (s?.m === "us" && s.sec && p.role !== "etf") (heldBySec[s.sec] = heldBySec[s.sec] || []).push(p.t); });
  const nbOf = (tk) => buyL.filter(d => d.m === "us" && d.sec === tk).length;
  // 187. 지수 줄을 누르면 지수 차트 (파이프라인이 SPX · NASDAQ · NDX · KOSPI 이름으로 내보냄 — 아직 없으면 누르지 않음)
  const IDX_KEY = { "^GSPC": "SPX", "^IXIC": "NASDAQ", "^NDX": "NDX", "^KS11": "KOSPI" };
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
    const nq = market.indices?.["^NDX"];
    return (
      <Card style={{ marginBottom: 8, borderColor: `${c}44` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <b style={{ fontSize: FS.lg }}>{m === "us" ? "🇺🇸 미국" : "🇰🇷 한국"}</b>
          <span style={{ fontSize: FS.sm, fontWeight: 800, color: c, background: `${c}1f`, border: `1px solid ${c}55`, borderRadius: 99, padding: "1px 10px" }}>{t}</span>
          <span style={{ marginLeft: "auto", fontSize: 10.5, color: C.muted, textAlign: "right" }}>판정 근거: {j.basis || (m === "kr" ? "폭 3년 하위 40%" : "나스닥100 200일선")}</span>
        </div>
        <div style={{ fontSize: FS.sm, color: C.dim, marginTop: 5 }}>{j.why}</div>
        {(() => { const bl = j.blocked ?? (m === "kr" ? (j.gate && j.verdict === "risk") : j.nqGate); const nm = m === "kr" ? "한국" : "미국";
          return bl == null ? null : <div style={{ fontSize: FS.xs, marginTop: 2, color: bl ? C.red : C.cyan, fontWeight: 700 }}>
            {bl ? `→ ${nm}은 새로 사지 않음 · 가진 종목은 트레일링선대로${m === "kr" ? ` · ${SPARE_TXT.kr}` : ""}` : `→ ${nm} 새로 사기 가능`}</div>; })()}
        <div style={{ marginTop: 6 }}>
          <Head cols={["지수", "종가", "3일", "5일", "1달", "200일선"]} grid={IDX_GRID6} />
          {rows.map(idxRow)}
        </div>
        {m === "us" && (() => {     // 252. 나스닥100 200일선 — 미국 새로 사기 규칙
          const g = j.blocked ?? j.nqGate, v = j.nq200 ?? nq?.ma200p, run = (j.nqRun ?? nq?.run200);
          if (g == null) return <div style={{ marginTop: 8, fontSize: FS.xs, color: C.gold }}>나스닥100 자료를 받지 못해 오늘은 막지 않습니다 (다음 수집 때 다시 판단)</div>;
          return <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 9, fontSize: FS.xs, lineHeight: 1.6,
                               background: g ? "rgba(255,69,58,.10)" : "rgba(48,209,88,.08)", border: `1px solid ${g ? C.red : C.emerald}55`, color: C.dim }}>
            {g ? <><b style={{ color: C.red }}>⛔ 나스닥100 200일선 아래 ({pct(v, 1)}{run != null ? ` · ${Math.abs(run)}일째` : ""}) → 미국 새로 사지 않음</b> · 가진 종목은 트레일링선대로 · 2회차는 그대로 · 종가가 200일선 위로 올라서면 다음 날부터 다시 삽니다
                 <span style={{ display: "block", color: C.text, marginTop: 2 }}>💵 {SPARE_TXT.us} — 백테스트 연 +0.4%p · 5년 최대낙폭 −0.3%. 장기채(TLT)는 안전자산이 아님(2022 −30% · 5년 최대낙폭 −44%)</span></>
               : <><b style={{ color: C.emerald }}>나스닥100 200일선 위 ({pct(v, 1)}{run != null ? ` · ${Math.abs(run)}일째` : ""}) → 미국 새로 사기 가능</b> · 종가가 200일선 아래로 내려가면 새로 사지 않습니다</>}
            <span style={{ display: "block", color: C.muted }}>규칙(252) · 2010–26 지금 매매 규칙 7칸 · 업종 3개: 연 15.1% → 17.2% · 최대낙폭 −37.0% → −29.8% (2010–18 · 2019–26 둘 다 나음) · 지금 살아남은 종목으로 계산해 수익률 자체는 실제보다 높게 나옴</span>
          </div>;
        })()}
        {m === "kr" && <>{/* 폭은 한국 새로 사기 기준 — 미국은 나스닥100 200일선이라 폭 막대를 보이지 않음 */}
          <BreadthBar b={b} c={c} />
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>폭 계산 {market.breadthAsOf ? md(market.breadthAsOf) : "—"} (토요일 전체 계산 · 평일엔 그 값)</div></>}
      </Card>);
  };
  return (
    <>
      {/* ① 시장 상태 — 157. 지수 숫자 · 252. 나스닥100 200일선 · 171. 폭 계산 날짜 */}
      <Step n="1" q="사기 전에 — 시장은?">시장 상태</Step>
      <MarketBlock m="us" />
      <MarketBlock m="kr" />
      <div style={{ fontSize: 10.5, color: C.muted, margin: "0 2px", lineHeight: 1.6 }}>
        폭 = 200일선 위 종목 비율 · 세로 흰 선 = 3년 중 오늘 위치 · 옅은 선 = 기준 40 · DC(ETF 배분)는 이 판정을 쓰지 않고 느린 ST로만 판단</div>

      {/* ② 위험 지표 */}
      <Step n="2" q="숨은 경고는?" right="미국 · 종가 기준">위험 지표</Step>
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

      {/* ③ 섹터 — 수익률 / PER·매수! 수 */}
      <Step n="3" q="어디가 강하지?" right={<Grade k="weak" />}>미국 업종</Step>
      {/* 215. 참고용(●○○) 표라 기본은 접어 둠 — 1~3위만 한 줄로 */}
      <button onClick={() => setSecOpen(!secOpen)} style={{ ...btn(C.dim), width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8, marginBottom: secOpen ? 6 : 0 }}>
        <span style={{ minWidth: 0, ...ONE }}>{sectors.slice(0, 3).map(x => `${x.rank} ${x.label}`).join(" · ")}</span>
        <span style={{ marginLeft: "auto", fontWeight: 400, color: C.muted, flexShrink: 0 }}>{secOpen ? "접기 ▴" : "12개 펼치기 ▾"}</span></button>
      {secOpen && <Seg full value={secView} onChange={setSecView} items={[["ret", "수익률"], ["per", "PER · 매수! 수"]]} />}
      {!secOpen ? null : secView === "ret" ? (
      <Card style={{ padding: "2px 12px 6px", marginTop: 6 }}>
        <Head cols={["#", "업종 · S&P比 1달", "3일", "5일", "1달", "모멘텀"]} grid={SEC_GRID} />
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
          이름 아래 숫자 = S&P500 대비 1달 %p · 모멘텀 = 3·6·9·12개월 수익률 평균 · <span style={{ color: C.gold }}>살 것</span>/<span style={{ color: C.cyan }}>보유</span> = 그 업종에서 오늘 고른 종목 · 줄을 누르면 그 업종 ETF 차트 · 섹터를 갈아타는 방식은 지수 보유와 차이가 없었습니다
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
          # = 업종 순위(3·6·9·12개월 수익률 평균) · PER·예상 PER = 종목풀에 든 그 업종 🇺🇸 종목의 <b style={{ color: C.dim }}>중앙값</b>(업종 지수의 PER 과는 다를 수 있음)
          · 매수! = 지금 매수 신호인 종목 수. PER 로 종목을 거르지는 않습니다.
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            <a href="https://finviz.com/groups.ashx?g=sector&v=120&o=pe" target="_blank" rel="noopener" style={{ ...linkBtn, fontSize: FS.xs, minHeight: 34, padding: "0 10px", border: `1px solid ${C.border}`, borderRadius: 8, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>↗ 🇺🇸 업종별 PER 자세히 (finviz)</a>
            <a href="https://finance.naver.com/sise/sise_group.naver?type=upjong" target="_blank" rel="noopener" style={{ ...linkBtn, fontSize: FS.xs, minHeight: 34, padding: "0 10px", border: `1px solid ${C.border}`, borderRadius: 8, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>↗ 🇰🇷 업종별 시세 (네이버)</a>
          </div>
        </div>
      </Card>)}
      <Info label="판단 기준 — 폭 · 판정 · 검증 수치">
        <b style={{ color: C.text }}>폭</b> = 그 시장에서 200일선 위에 있는 종목 비율. 토요일에 전체 종목풀로 계산하고 평일엔 그 값을 씁니다. 세로 흰 선 = 3년 중 오늘 위치, 옅은 선 = 기준(40).<br />
        <b style={{ color: C.cyan }}>🇰🇷 한국 새로 사기에 사용</b> — 폭이 3년 하위 40% 아래면 '위험' → 한국은 새로 사지 않습니다(가진 종목은 트레일링선대로).
        2010–26 검증(지금 매매 규칙 · 한국 5칸): 연 11.4% → 24.1%, 최대낙폭 −72% → −52%, 16년 중 12년 나음. 기준을 2·3·5년 × 30·40·50으로 바꿔도 모두 16~24%, 같은 비율을 무작위로 막으면 평균 11.9%.
        단 급반등 해(2020·2021)는 손해였고, 지금 살아남은 종목으로 계산해 수익률 자체는 실제보다 높게 나옵니다. DC(ETF 배분)는 이 판정을 쓰지 않습니다.<br />
        <b style={{ color: C.cyan }}>🇺🇸 나스닥100 200일선(252)</b> — 아래면 미국은 새로 사지 않습니다. 예전 검증(발굴 바스켓 3개월 보유)에서는 타이밍 지표 15개가 전부 (−)였지만, 지금 매매 규칙(7칸 · 업종 3개 · 다음 날 시가 체결)으로 다시 보면 2010–18 · 2019–26 둘 다 나아져 규칙으로 씁니다.
        S&P500 판정 색(안전·주의·위험)은 참고만입니다.
      </Info>
    </>
  );
}

export const IDX_GRID6 = "minmax(0,1.55fr) minmax(0,1.1fr) minmax(0,.85fr) minmax(0,.85fr) minmax(0,.85fr) minmax(0,1fr)";
export const SEC_GRID = "16px minmax(0,1.7fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.1fr)";
export const VAL_GRID = "16px minmax(0,1.9fr) minmax(0,1fr) minmax(0,1fr) minmax(0,.7fr)";
export const FIT_NAME = { fontSize: "clamp(11px, 3.6vw, 14px)", fontWeight: 700 };

/* ══════════════ 3. 발굴 ══════════════ */
export const SORT_LABEL = { str: "강도 높은 순 (RS + 200일선 거리)", new: "새로 매수! 된 순", sig: "매수! 먼저", rs: "RS 높은 순", sec: "주도 업종 먼저", rev: "매출 성장 큰 순", vol: "변동성 높은 순", tv: "거래대금 큰 순" };
/** 매수! 가 된 지 며칠째인지 — 실전 장부(signals_log)의 첫 발생일 기준. 거래일 수는 장부에 있는 날짜 수로 셉니다 */
export function sigAgeMap(siglog) {
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
export function TodayPicks({ today, stocks, sizer, openStock, pos, staleInfo, market, ageMap, sinceMap, genDay }) {
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
          <Stat k="강도" v={r.str ?? "—"} />
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
            {z ? zeroTxt : sl.held > sl.n ? `⚠ 칸보다 많이 보유 ${sl.held} / ${sl.n}칸 — 기록 확인` : full ? `칸이 다 참 · 보유 ${sl.held} / ${sl.n}칸` : `빈 칸 ${sl.free} / ${sl.n}칸`}</Tag>
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
      {cfg.usGate ? (() => {   // 252. 나스닥100 200일선 아래 — 미국 새로 사지 않음
        const wait = loc.excluded.filter(x => x.m === "us" && (x.why || []).includes(US_GATE_WHY));
        const j = market?.judge?.us;
        return <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <b style={{ fontSize: FS.sm }}>🇺🇸 미국</b>
            <Tag c={C.red} bg="rgba(255,69,58,.12)">{US_GATE_TXT}</Tag></div>
          <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 4, lineHeight: 1.6 }}>
            나스닥100 200일선 {j?.nq200 != null ? pct(j.nq200, 1) : "—"}{j?.nqRun != null && j.nqRun < 0 ? ` · ${-j.nqRun}일째 아래` : ""} · 다시 위로 올라선 종가가 나오면 그날부터 삽니다 · 가진 종목은 트레일링선대로 · 2회차는 그대로.
            {wait.length > 0 && <> 신호는 있지만 대기: {wait.slice(0, 6).map(x => x.t).join(" · ")}{wait.length > 6 ? ` 외 ${wait.length - 6}` : ""}</>}</div>
        </div>;
      })() : <Section m="us" flag="🇺🇸" name="미국" picks={loc.pickUs} />}
      {(() => {   // 161 · 247. 같은 업종이 이미 3개(보유 포함)라 뺀 종목 — 원칙 5
        const out = loc.excluded.filter(x => x.m === "us" && (x.why || []).some(w => w.startsWith("같은 업종 보유") || w === SEC_FULL_WHY));
        if (!out.length) return null;
        const secLabel = (t) => (stocks[t]?.sec && (market?.sectors || []).find(z => z.tk === stocks[t].sec)?.label) || "업종";
        const by = {}; out.forEach(x => { const k = secLabel(x.t); (by[k] = by[k] || []).push(x.t); });
        return <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
          같은 업종이 이미 {SEC_CAP}개(보유 포함)라 뺌 (원칙 5): {Object.entries(by).map(([k, ts]) => `${k} → ${ts.slice(0, 4).join("·")}${ts.length > 4 ? ` 외 ${ts.length - 4}` : ""}`).join(" / ")}</div>;
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
          <b style={{ color: C.text }}>고르는 순서</b>: 매수! 중 강세·눌림 먼저 → 강도(6개월 상대강도 + 200일선 거리) 높은 순 · 🇺🇸 같은 업종은 {SEC_CAP}개까지(이미 보유한 종목 포함 — 2010–26 검증 7칸: 1개 연 12.6% · 3개 15.1%) · 적자·매출 부진·보유 제외.<br />
          <b style={{ color: C.text }}>🇺🇸 나스닥100 200일선 아래</b>면 미국은 새로 사지 않습니다 — 업종 3개와 함께 검증 연 15.1% → 17.2%, 최대낙폭 −37% → −30% (2010–18 · 2019–26 둘 다 나음).<br />
          <b style={{ color: C.text }}>🇰🇷 시장 위험</b>(폭 3년 하위 40% 아래 · 주 1회 계산)이면 한국은 새로 사지 않습니다 — 2010–26 검증 연 11.4% → 24.1%, 최대낙폭 −72% → −52%.<br />
          <b style={{ color: C.text }}>검증</b>: 규칙을 2010–18에서 정하고 2019–26에 적용 — 🇺🇸 연 +50%·+38% (RS 순 +41%·+27%) · 🇰🇷 +48%·+39%. 텔레그램·AI 도구와 같은 규칙.<br />
          PER 은 참고용입니다(이 값으로 거르지 않음 · 🇰🇷 은 ↗ 네이버에서 확인).
        </div>
      </details>
    </Card>);
}

export function FindTab({ list, openStock, watch, toggleWatch, market, sizer, pos, siglog, stocks, today, staleInfo, notes, genDay }) {
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
      out[x.t] = [w === SEC_FULL_WHY ? `같은 업종 ${SEC_CAP}개 먼저(${secBy[stocks[x.t]?.sec] || "?"} 등)` : w === "적자" ? "적자 — 살 것 제외" : w === KR_GATE_WHY ? "시장 위험 — 한국 안 삼" : w === US_GATE_WHY ? US_GATE_TXT : w.startsWith("매출") ? `${w} — 제외` : w, C.muted]; });
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
    let r = list.filter(s => (s.tvr ?? 0) >= RULES.tvrMin);
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
          ☆로 담아 두면 매수!로 바뀌는 날 알림이 옵니다. <b>rising</b> = 추세 유지·RS 55~70·1달 시장대비 + / <b>turn</b> = 느린 ST 초록 전환 3일 이내
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
export function OversoldTab({ list, openStock, watch, toggleWatch, sizer, market, pos }) {
  const [showKr, setShowKr] = useState(false);
  const [onlyWatch, setOnlyWatch] = useState(true);
  const [limit, setLimit] = useState(20);
  const heldSet = useMemo(() => new Set((pos || []).map(p => p.t)), [pos]);
  const all = useMemo(() => list.filter(s => (s.tvr ?? 0) >= RULES.tvrMin && s.dip), [list]);
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
export const SortSelect = ({ value, onChange, items }) => (
  <select value={value} onChange={e => onChange(e.target.value)}
    style={{ background: "#161B2E", color: C.text, border: `1px solid ${C.border}`, borderRadius: 9, colorScheme: "dark",
             padding: "0 8px", minHeight: 38, fontSize: FS.sm, fontWeight: 700, minWidth: 0, width: "100%" }}>
    {items.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
  </select>
);


/* ══════════════ 찾기 — 추세(눌림·매수) / 🌐 시장(245 · 예전 오늘 탭 2~4번) / 급락(과매도) 를 한 탭에서 전환 ══════════════ */
export function FindHub(props) {
  const [mode, setMode] = useState(() => sessionStorage.getItem("v8.find") || "trend");
  useEffect(() => { try { sessionStorage.setItem("v8.find", mode); } catch {} }, [mode]);
  return (
    <>
      <div style={{ marginTop: 8 }}>
        <Seg full value={mode} onChange={setMode} items={[["trend", "📈 매수 신호"], ["market", "🌐 시장"], ["dip", "🌊 급락"]]} />
      </div>
      {mode === "trend" ? <FindTab {...props} /> : mode === "market" ? (props.market ? <MarketInfo {...props} /> : null) : <OversoldTab {...props} />}
    </>
  );
}
