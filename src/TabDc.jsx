/* 264. Dc 탭 — 이 탭만 쓰는 화면 (App.jsx 에서 자동으로 나눔 · 다른 탭과 같이 쓰는 건 core.jsx) */
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
import { C, Card, Chip, Empty, FS, Grade, Info, MONO, ONE, Sec, Seg, btn, col, dcModeOf, inp, kstDay, linkBtn, loadJSON, money, pct, price, settingsChanged } from "./core.jsx";



/* ══════════════ 2. DC (퇴직연금) ══════════════
   규칙 (230 · 2026-10 다시 검증): 나스닥100 · S&P500 · 코스피200 각 23.3% + 안전자산 30%
   · 각 몫은 느린 슈퍼트렌드(12,3)가 초록일 때만 보유, 빨강이면 그 몫도 안전자산
   · 판단은 미국 원본(SPY) 신호, 매수는 국내 상장 ETF (퇴직연금은 국내 상장만 가능)
   · 진입은 한 번에 또는 월 1회 3분할 (분할은 평균 −0.3%p, 최악 결과는 줄어듦)          */
export const DAY = 86400000;

export function DcTab({ etfs, market, pos, setPos, openStock, sizer }) {
  const dc = market.dc;
  const [total0, setTotal] = useState(() => Number(localStorage.getItem("v6.dc.total")) || 100000000);
  const total = sizer?.plan?.dc || total0;          // 💰 전체 투자금이 있으면 그 DC 몫
  const [showRef, setShowRef] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);                 // 84. 규칙 설명 접기
  const [split, setSplit] = useState(() => Number(localStorage.getItem("v6.dc.split")) || 3);
  const [done, setDone] = useState(() => loadJSON("v6.dc.done", { us: [], kr: [] }));
  const [moreUs, setMoreUs] = useState(false);
  const [moreKr, setMoreKr] = useState(false);
  const [mode, setMode] = useState(dcModeOf);      // st=현행(느린 ST) · hold=3지수 보유 (182: 듀얼 모멘텀 대신)
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
      ? <Chip tone="g">느린 ST 초록 {d.slowDays}거래일</Chip>
      : <Chip tone="r">느린 ST 빨강 {d.slowDays}거래일</Chip>;
  };

  return (
    <>
      {/* 규칙 택일 — 낙폭 작은 쪽(느린 ST)과 수익 쪽(3지수 보유) */}
      <div style={{ marginTop: 8 }}>
        <Seg full value={mode} onChange={setMode} items={[["st", "느린 ST (낙폭 작음)"], ["hold", "3지수 보유 (수익↑ 낙폭↑)"]]} />
      </div>
      {/* 84. 규칙 설명은 한 줄 요약만 두고 나머지는 접어, '이번 달 보유 목표'가 먼저 보이게 */}
      <div style={{ fontSize: FS.xs, color: C.muted, margin: "6px 2px 0", display: "flex", gap: 6, alignItems: "baseline" }}>
        <span>{mode === "st" ? "느린 ST 빨강이면 그 몫은 안전자산" : "1년에 한 번(1월 첫 거래일) 비중만 맞춤"}</span>
        <button onClick={() => setRuleOpen(v => !v)} style={{ ...linkBtn, fontSize: FS.xs, minHeight: 36, padding: "0 8px", marginLeft: "auto" }}>{ruleOpen ? "접기" : "규칙 자세히"}</button>
      </div>
      {ruleOpen && (
        <div style={{ fontSize: FS.xs, color: C.muted, margin: "2px 2px 0" }}>
          {mode === "st" ? (() => { const ev = dc.evidence || {};    // 173. 수치는 데이터 파일 하나에서 (예전엔 화면에 적은 값과 조금 달랐음)
              return `${(dc.core || []).map(c => `${c.label.replace(/^(미국|한국) /, "")} ${Math.round(c.w * 100)}%`).join(" + ")} + 안전자산 30%, 각 몫은 느린 ST 초록일 때만 보유 · 검증 ${ev.period || "—"}: 연 +${ev.cagr ?? "—"}% · 최대낙폭 ${ev.mdd ?? "—"}% · 샤프 ${ev.sharpe ?? "—"}${ev.bh_cagr != null ? ` (3지수 그냥 보유 +${ev.bh_cagr}% · ${ev.bh_mdd}%)` : ""}`; })()
                         : (() => { const ev = dc.hold3?.evidence || {};
              return `나스닥100·S&P500·코스피200 각 23% + 안전자산 30% · 환노출 상품 · 그 사이엔 사고팔지 않음 · 검증 ${ev.period || "2008–26"}: 연 +${ev.cagr ?? "—"}% · 최대낙폭 ${ev.mdd ?? "—"}% · 샤프 ${ev.sharpe ?? "—"}${ev.st_cagr != null ? ` (느린 ST 3지수 +${ev.st_cagr}% · ${ev.st_mdd}%)` : ""}`; })()}
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
        const sell = c.state === "wait" && c.n > 0;   // 285. 신호는 빨강인데 보유 기록이 남음 → 팔아야 함
        return (
          <Card key={c.key} style={{ marginBottom: 8, borderColor: hold ? "rgba(48,209,88,.35)" : sell ? "rgba(255,69,58,.55)" : "rgba(245,158,11,.35)" }}>
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
              <span style={{ fontSize: FS.md, fontWeight: 800, color: hold ? C.emerald : sell ? C.red : C.gold, whiteSpace: "nowrap" }}>
                {hold ? "🟢 보유" : sell ? "🔴 매도 필요" : c.state === "wait" ? "🟡 대기" : "⚪ 확인 불가"}</span>
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
            {/* 254. 채권은 짧은 것 — 장기채는 금리가 오르면 주식처럼 빠짐 */}
            <div style={{ fontSize: FS.xs, color: C.dim, marginTop: 4, lineHeight: 1.55 }}>
              채권으로 채운다면 <b style={{ color: C.text }}>예금 · 국내 단기채 · 국고채 3년</b> — 5년 최대낙폭 −0.5%~−5%.
              국고채 10년(−17%) · 미국 30년(−48%) 같은 장기채는 급락 때 조금 오르지만 금리가 오르면 크게 빠져 안전자산 역할을 못 합니다(2022).
              {dcModeOf() !== "hold" && <b style={{ color: C.gold }}> 느린 ST 방식은 빨강일 때 이 몫으로 옮기므로 장기채를 쓰면 최대낙폭이 −13% → −35~39%로 커집니다(백테스트).</b>}
            </div>
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
        {mode === "st" && <>{/* 진입 방식은 느린 ST 규칙 전용 — 3지수 보유는 처음 한 번 사 두면 끝 */}
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
        <span>참고: 업종 ETF</span><span style={{ marginLeft: "auto", fontWeight: 400, color: C.muted }}>배분하지 않음 · 검증에서 지수 보유와 차이 없음 {showRef ? "▴" : "▾"}</span>
      </button>
      {showRef && <>
      <Sec right={<Grade k="weak" />}>🇺🇸 미국 업종 → 국내 ETF</Sec>
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
        <Info label="업종 선택 근거">
          판단(점수·신호)은 미국 원본 ETF로, 매수는 국내 상장 ETF로 합니다. 국내 상품은 원화 기준이라 환율 영향이 더해집니다
          (주간 상관 0.83~0.96). 업종 상위 3개로 교체하는 방식은 원화·DC 조건 검증에서 지수 보유와 차이가 없었습니다
          (연 9.2% vs 9.2%) — 핵심 비중은 위 규칙대로 두고, 업종은 비중을 더 두고 싶을 때 고르는 참고로 쓰세요.
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
