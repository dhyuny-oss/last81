/* 264. Review 탭 — 이 탭만 쓰는 화면 (App.jsx 에서 자동으로 나눔 · 다른 탭과 같이 쓰는 건 core.jsx) */
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
import { AppPerf, C, Card, Empty, FIT, FS, Grade, Head, Info, MONO, ONE, REV_KEY, Sec, Seg, Step, btn, col, dcModeOf, getJson, getRevMin, inp, linkBtn, loadJSON, loadPlan, lossOf, md, money, pct, pickedDays, price, settingsChanged, shortName, weekKey } from "./core.jsx";


/** 최근 신호 모아보기 — 5거래일치 매수! 기록과 그 뒤 성과 (실전 장부 signals_log 기준) */
export function RecentSignals({ siglog, stocks, openStock, market }) {
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

/** 매매 기록 — 백테스트 숫자는 생존편향이 섞여 있습니다. 내 계좌 기록이 진짜 검증입니다 */
export function TradeLog({ trades, setTrades }) {
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
export const REVIEW_STEPS = [
  ["pool", "종목풀 변경 확인", "이번 주 들어온·나간 종목을 훑고, 관심 있으면 ☆"],
  ["hold", "내 종목 점검", "매도!는 처리했는지 · 선까지 −5% 이내(곧 매도 구간)인 종목 확인"],
  ["live", "실전 성적 보기", "앱이 실제로 낸 신호의 20일 성적이 검증값과 비슷한지"],
  ["trade", "내 매매 기록 대조", "내 승률·손익비가 검증값과 크게 다르면 규칙을 안 지킨 것"],
  ["decide", "전략 결정", "그대로 간다 / 바꾼다 — 바꾸면 이유를 한 줄 적기"],
];
/* 208. 주 1회 '이번 주 선정'은 뺐습니다 — 매일 바뀌는 '오늘 살 것'(찾기 탭)과 겹쳐 지난 종목이 남아 헷갈렸음 */
/** 151. 같은 기간 시장 수익률 — market.idxbars(미국 S&P500 · 한국 코스피, 최근 200거래일 종가)에서 날짜로 찾음.
 *  from·to 는 'YYYY-MM-DD'. 그 날짜 이하의 마지막 종가를 씁니다. 범위를 벗어나면 null */
export function idxRet(market, m, from, to) {
  const rows = market?.idxbars?.[m]?.rows; if (!rows?.length || !from) return null;
  const dOf = (r) => new Date(r[0] * 1000 + (m === "kr" ? 9 * 3600000 : 0)).toISOString().slice(0, 10);
  const at = (d) => { let v = null; for (const r of rows) { if (dOf(r) <= d) v = r[1]; else break; } return v; };
  if (dOf(rows[0]) > from) return null;
  const a = at(from), b = to ? at(to) : rows[rows.length - 1][1];
  return a && b ? (b / a - 1) * 100 : null;
}   // 211. 시장별 날짜

/** 57. 지난 신호 복기 — 매수! 가 떴던 종목이 그 뒤 어떻게 됐나. 규칙대로 팔았으면 얼마였고, 판 뒤에는 어떻게 됐나 */
export function SignalReview({ siglog, stocks, market, openStock, picksLog }) {
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
export function SelfCheck({ openStock }) {
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
          <div key={x.t} onClick={() => openStock?.(x.t)} style={{ ...line, color: C.red, cursor: "pointer" }}>{x.m === "kr" ? x.n : x.t} — 매도! {x.days > 0 ? `${x.days}일째` : "오늘부터"} ›</div>))
          : <div style={{ ...line, color: C.emerald }}>✓ 없음</div>}
        {(r.conv || []).length > 0 && <div style={{ ...line, color: C.gold }}>⚠ 매도! 상태에서 장기로 바꿈: {r.conv.map(x => `${/^\d{6}$/.test(x.t) ? (x.n || x.t) : x.t} (${md(x.d)})`).join(" · ")}</div>}
      </Card>
    </>);
}

export function ReviewTab({ market, uni, snap, trades, setTrades, pos, stocks, setTab, openStock, sizer, today, siglog, syncState, onShowRules, picksLog }) {
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
      <AppPerf market={market} />
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
           "추세 안에서 RSI 45 회복 · 매도는 느린 ST 빨강. 미국은 연 +17.9%지만 그냥 보유를 못 이겼습니다."],
          ["🏦 DC 느린 ST 규칙", "mid", "연 +7.1% · 최대낙폭 −13.3% · 샤프 0.56 (2008-03~2026-10 원화 · 비용 0.1% · 2008 위기 포함)",
           "나스닥100·S&P500·코스피200 각 23% + 안전자산 30%, 각 몫은 느린 ST 초록일 때만 보유 (230: 예전 S&P·코스피 둘이면 +6.3% · −15.8% — 3년 구간 188개 중 145개에서 3지수가 나음). 최대낙폭은 2026-10 코스피 급락이 들어간 값."],
          ["🏦 DC 3지수 보유 (선택지)", "mid", "연 +11.6% · 최대낙폭 −23.4% · 샤프 0.69 (같은 조건) · 1년 매매 1번",
           "같은 3지수를 그냥 들고 1월 첫 거래일에만 비중 맞춤. 같은 188개 구간 중 187개에서 느린 ST보다 수익이 높았고, 대신 낙폭이 −13% → −22%로 큽니다. 나스닥을 빼면 수익이 크게 줄어 나스닥 몫이 핵심 (182)."],
          ["🇰🇷 강세 추가 (한국 종목)", "mid", "눌림만일 때보다 연 +3~5%p (순서·기준값 흔든 28번 중 26번 나음 · 중앙값 19.7% → 24.7%) · 2010–26 · 한국 5칸",
           "눌림이 드물어 빈 칸을 약한 추세 신호가 채우던 것을 강세가 대신. 신호 하나하나의 120일 지수대비: 강세 +7.4%p · 눌림 +8.1 · 추세 +2.7. 기준 60 한 점만 보면 32.7%로 나오지만 운이 섞인 값이라 낮춰 잡음 (180)."],
          ["🌊 과매도 (미국)", "mid", "12개월 보유 시 시장 대비 중앙값 +10.1% · 승률 60%",
           "생존편향 미보정이라 실제는 더 낮습니다. 한국은 검증 실패라 기본 제외."],
          ["🔄 업종 교체", "weak", "원화·DC 조건에서 지수 보유와 차이 없음 (연 9.2% vs 9.2%)",
           "비중을 더 두고 싶은 업종을 고를 때 참고용으로만."],
          ["🇰🇷 시장 판정 → 한국 새로 사기", "mid", "위험이면 새로 사지 않음: 연 +24.1% · 최대낙폭 −52% (없으면 +11.4% · −72%) · 2010–26 · 한국 5칸",
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

/* ══════════════ 79. ⚙ 설정 모음 — 흩어진 설정을 한 곳에서 보고, 바꿀 곳으로 바로 이동 ══════════════ */
export function SettingsHub({ sizer, setTab, syncState, onShowRules }) {
  const [rev, setRev] = useState(getRevMin);
  const plan = loadPlan(); const pa = sizer?.plan;
  const dcMode = dcModeOf() === "hold" ? "3지수 보유" : "느린 ST 규칙";
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
