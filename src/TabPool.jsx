/* 264. Pool 탭 — 이 탭만 쓰는 화면 (App.jsx 에서 자동으로 나눔 · 다른 탭과 같이 쓰는 건 core.jsx) */
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
import { ActionTag, C, Card, FS, MONO, ONE, Sec, Seg, btn, inp, loadJSON, money, postWatch, settingsChanged, shortName } from "./core.jsx";



/** 🔄 지금 갱신 — 깃허브 토큰은 Vercel 서버(/api/refresh)에만 둡니다 */
export function RefreshBtn() {
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

/** 분기 실적(재무) 갱신 — 매출 필터·재무 참고가 쓰는 데이터. 수집 후 병합까지 자동 연결됩니다 */
export function FinRefreshBtn() {
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

/* ══════════════ 📦 종목풀 — 주 1회 자동 교체 + 수동 추가·빼기·즉시 교체 ══════════════ */
export function PoolTab({ snap, uni, list, openStock, watch, pos, extras, setExtras, trades, market }) {
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
