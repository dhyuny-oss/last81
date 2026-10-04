/**
 * 고르기 연습 — 과거 실제 신호로 "셋 중 하나" 골라 보기
 * ════════════════════════════════════════════════════════════
 * 앱 본체와 완전히 따로 도는 화면입니다. 이 파일은 /data/practice.json 하나만 읽고,
 * 내 종목·설정·텔레그램 어디에도 영향을 주지 않습니다.
 *
 * ▣ 빼는 방법 (세 군데)
 *   1) src/App.jsx 에서 "★ 연습" 이라고 적힌 두 곳 삭제
 *   2) src/Practice.jsx (이 파일) 삭제
 *   3) public/data/practice.json 삭제
 *
 * ▣ 데이터 (practice.json · 한 번 만들어 둔 고정 파일, 매일 수집과 무관)
 *   rounds[] = { m: us|kr, d: 신호일, nc: 그날 새 매수! 종목 수, rows[3] }
 *   rows[]   = 신호일 기준 값만 들어 있음(뒤 정보 없음) + 결과(ret·days·peak)
 *              c 종가 · l 트레일링선(음수 = 빨강) · ma 200일선 — 모두 6개월 전 = 100 인 지수
 *   info[티커] = [업종, 한 줄 설명]
 *   성적 계산은 앱 규칙과 같음: 다음 날 시가 매수 → 종가가 트레일링선 아래로 마감하면 그다음 날 시가 매도
 */
import React, { useState, useEffect, useMemo, useCallback } from "react";

const K = {
  bg: "#0A0E1A", panel: "#121829", line: "#232C44", fg: "#E8ECF5", dim: "#97A1B8",
  gold: "#F0A020", up: "#2FD07A", down: "#FF5A5F", blue: "#4CC3FF", pick: "#2A2110",
};
const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";
const KEY = "v7.practice";
const PRE = 126;

const pct = (v, d = 1) => (v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + "%");
const col = (v) => (v > 0 ? K.up : v < 0 ? K.down : K.dim);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/* 씨앗으로 섞기 — 기기마다 문제 순서가 다르고, 다시 열어도 같은 순서가 유지됩니다 */
function shuffled(n, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function loadState() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && s.picks && typeof s.seed === "number") return s; } catch {}
  return { seed: Math.floor(Math.random() * 1e9), picks: {}, blind: true, mk: "all" };
}

/* 신호일 숫자를 한 줄 말로 */
function story(r) {
  const a = [];
  a.push(`6달 ${pct(r.m6, 0)}`);
  a.push(r.hi >= -3 ? "52주 고점 근처" : `52주 고점에서 ${Math.abs(r.hi).toFixed(0)}% 아래`);
  a.push(r.sd <= 5 ? "초록선에 막 올라탐" : `초록선 ${r.sd}거래일째`);
  if (r.atr != null) a.push(r.atr >= 4 ? "하루 변동 큼" : r.atr <= 2 ? "하루 변동 작음" : "하루 변동 보통");
  return a.join(" · ");
}

function Chart({ r, shown }) {
  const W = 340, H = 190, L = 6, R = 38, T = 8, B = 18;
  const n = shown ? r.c.length : PRE + 1;
  const vals = [];
  for (let k = 0; k < n; k++) { if (r.c[k] != null) vals.push(r.c[k]); if (r.l[k] != null) vals.push(Math.abs(r.l[k])); if (r.ma[k] != null) vals.push(r.ma[k]); }
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
  const x = (k) => L + (W - L - R) * k / (n - 1), y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const path = (a, ok, f = (v) => v) => { let d = "", pen = false; for (let k = 0; k < n; k++) { if (a[k] == null || (ok && !ok(a[k]))) { pen = false; continue; } d += (pen ? "L" : "M") + x(k).toFixed(1) + " " + y(f(a[k])).toFixed(1); pen = true; } return d; };
  const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];
  const xb = x(PRE + 1), xe = x(Math.min(r.xi, n - 1));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="가격 그래프" style={{ display: "block", width: "100%", height: "auto" }}>
      {ticks.map((t, i) => (<g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={K.line} strokeWidth="1" />
        <text x={W - R + 4} y={y(t) + 4} fontSize="10" fill={K.dim} fontFamily={MONO}>{t.toFixed(0)}</text></g>))}
      <path d={path(r.ma)} fill="none" stroke={K.blue} strokeWidth="1.2" strokeDasharray="3 3" />
      <path d={path(r.l, (v) => v > 0)} fill="none" stroke={K.up} strokeWidth="1.6" />
      <path d={path(r.l, (v) => v < 0, Math.abs)} fill="none" stroke={K.down} strokeWidth="1.6" />
      <path d={path(r.c)} fill="none" stroke={K.fg} strokeWidth="1.8" />
      {shown ? (<>
        <rect x={xb} y={T} width={Math.max(1, xe - xb)} height={H - T - B} fill={r.ret >= 0 ? K.up : K.down} opacity="0.10" />
        <line x1={xb} x2={xb} y1={T} y2={H - B} stroke={K.gold} strokeWidth="1.2" /><text x={xb + 3} y={T + 10} fontSize="10" fill={K.gold}>매수</text>
        {!r.open && !r.cut && (<><line x1={xe} x2={xe} y1={T} y2={H - B} stroke={K.dim} strokeWidth="1.2" />
          <text x={Math.min(xe + 3, W - R - 22)} y={H - B - 4} fontSize="10" fill={K.dim}>매도</text></>)}
      </>) : <circle cx={x(n - 1)} cy={y(r.c[n - 1])} r="3.5" fill={K.gold} />}
      <text x={L} y={H - 4} fontSize="10" fill={K.dim}>6개월 전</text>
      <text x={shown ? x(PRE) : W - R} y={H - 4} fontSize="10" fill={K.dim} textAnchor={shown ? "middle" : "end"}>신호일</text>
    </svg>);
}

const Tag = ({ children, c }) => (
  <span style={{ fontSize: 12, padding: "1px 8px", borderRadius: 99, border: `1px solid ${c || K.line}`, color: c || K.dim, whiteSpace: "nowrap" }}>{children}</span>);
const Stat = ({ k, v, c }) => (
  <div style={{ minWidth: 0 }}><small style={{ display: "block", color: K.dim, fontSize: 11.5 }}>{k}</small>
    <b style={{ fontFamily: MONO, fontSize: 14.5, color: c || K.fg }}>{v}</b></div>);

function Card({ r, k, picked, info, blind, onPick }) {
  const shown = picked != null, mine = picked === k, label = "ABC"[k];
  const named = shown || !blind;                       // 이름을 보여줄지
  const [ind, desc] = info || ["", ""];
  return (
    <div style={{ background: mine ? K.pick : K.panel, border: `1px solid ${mine ? K.gold : K.line}`, borderRadius: 12, padding: 12,
                  display: "flex", flexDirection: "column", gap: 9, minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 8px" }}>
        <b style={{ fontSize: 16 }}>{named ? r.n : `종목 ${label}`}</b>
        {named && <span style={{ fontFamily: MONO, fontSize: 12, color: K.dim }}>{r.t}</span>}
        <Tag>{r.why}</Tag>
        {ind && <Tag>{ind}</Tag>}
        {shown && r.rule && <Tag c={K.blue}>앱 규칙의 선택</Tag>}
        {mine && <Tag c={K.gold}>내 선택</Tag>}
      </div>
      {named && desc && <div style={{ fontSize: 13.5, color: K.fg, lineHeight: 1.45 }}>{desc}</div>}
      <Chart r={r} shown={shown} />
      <div style={{ fontSize: 12.5, color: K.dim, lineHeight: 1.45 }}>{story(r)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "6px 8px" }}>
        <Stat k="강도 점수" v={r.str} /><Stat k="RS" v={r.rs} /><Stat k="RSI" v={r.rsi} />
        <Stat k="최근 1달" v={pct(r.m1, 0)} c={col(r.m1)} /><Stat k="3달" v={pct(r.m3, 0)} c={col(r.m3)} /><Stat k="1년" v={pct(r.m12, 0)} c={col(r.m12)} />
        <Stat k="200일선 위" v={pct(r.ma200p, 0)} /><Stat k="선까지" v={`−${r.loss.toFixed(0)}%`} /><Stat k="거래대금 순위" v={`상위 ${Math.max(1, 100 - r.tvr)}%`} />
      </div>
      {shown
        ? <div style={{ fontSize: 14 }}><b style={{ fontFamily: MONO, fontSize: 22, color: col(r.ret) }}>{pct(r.ret)}</b>{" "}
            <span style={{ color: K.dim }}>· {r.days}거래일 보유 · 보유 중 최고 {pct(r.peak, 0)}{r.open ? " · 아직 보유 중(마지막 값 기준)" : ""}</span></div>
        : <button type="button" onClick={() => onPick(k)}
            style={{ font: "inherit", fontWeight: 700, color: K.fg, background: "transparent", border: `1px solid ${K.gold}`, borderRadius: 10,
                     padding: "10px 14px", minHeight: 44, cursor: "pointer" }}>{named ? r.n : `종목 ${label}`} 산다</button>}
    </div>);
}

export default function Practice({ onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [st, setSt] = useState(loadState);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} }, [st]);
  useEffect(() => {
    let live = true;
    fetch("/data/practice.json").then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((j) => { if (live) setData(j); }).catch((e) => { if (live) setErr(String(e.message || e)); });
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { live = false; window.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [onClose]);

  const R = data?.rounds || [];
  const order = useMemo(() => shuffled(R.length, st.seed).filter((i) => st.mk === "all" || R[i].m === st.mk), [R, st.seed, st.mk]);
  const done = order.filter((i) => st.picks[i] != null);
  const [cur, setCur] = useState(null);                 // 지금 보고 있는 문제 번호 (답한 뒤에도 '다음'을 누를 때까지 유지)
  const firstOpen = order.find((i) => st.picks[i] == null);
  const idx = cur != null && order.includes(cur) ? cur : firstOpen;
  const o = idx != null ? R[idx] : null;
  const picked = idx != null && st.picks[idx] != null ? st.picks[idx] : null;

  const pick = useCallback((k) => { setCur(idx); setSt((s) => ({ ...s, picks: { ...s.picks, [idx]: k } })); }, [idx]);
  const next = () => { setCur(null); try { document.getElementById("pp-scroll")?.scrollTo(0, 0); } catch {} };
  const reset = () => { if (window.confirm("연습 기록을 지우고 새 순서로 다시 시작할까요?")) { setCur(null); setSt((s) => ({ ...s, seed: Math.floor(Math.random() * 1e9), picks: {} })); } };

  const mine = avg(done.map((i) => R[i].rows[st.picks[i]].ret));
  const rule = avg(done.map((i) => R[i].rows.find((r) => r.rule).ret));
  const all3 = avg(done.map((i) => avg(R[i].rows.map((r) => r.ret))));
  const same = done.filter((i) => R[i].rows[st.picks[i]].rule).length;
  const wins = done.filter((i) => R[i].rows[st.picks[i]].ret > 0).length;
  const f = (v) => (v == null ? "—" : pct(v));
  const seg = (on) => ({ font: "inherit", fontSize: 13, fontWeight: on ? 700 : 500, minHeight: 36, padding: "4px 12px", borderRadius: 99, cursor: "pointer",
                         background: on ? K.pick : "transparent", color: on ? K.gold : K.dim, border: `1px solid ${on ? K.gold : K.line}` });

  let verdict = null;
  if (o && picked != null) {
    const me = o.rows[picked], best = o.rows.reduce((a, b) => (b.ret > a.ret ? b : a)), ru = o.rows.find((r) => r.rule);
    verdict = me === best ? "셋 중 가장 좋은 종목을 골랐습니다."
      : me.rule ? `앱 규칙과 같은 선택입니다. 이번 판 1등은 ${best.n}(${pct(best.ret)})였습니다.`
      : `이번 판 1등은 ${best.n}(${pct(best.ret)})였습니다. 앱 규칙은 ${ru.n}(${pct(ru.ret)})를 골랐습니다.`;
  }
  const hist = [...done].reverse();

  return (
    <div id="pp-scroll" role="dialog" aria-label="고르기 연습"
      style={{ position: "fixed", inset: 0, zIndex: 400, background: K.bg, color: K.fg, overflowY: "auto", WebkitOverflowScrolling: "touch",
               fontSize: 15, lineHeight: 1.55 }}>
      <style>{`.pp-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
@media (max-width:820px){.pp-cards{grid-template-columns:minmax(0,1fr)}}
.pp-board{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:${K.line};border:1px solid ${K.line};border-radius:10px;overflow:hidden}
@media (max-width:560px){.pp-board{grid-template-columns:repeat(2,minmax(0,1fr))}}
.pp-board>div{background:${K.panel};padding:9px 12px;min-width:0}`}</style>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "12px 14px 56px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px", position: "sticky", top: 0, background: K.bg, padding: "6px 0", zIndex: 2 }}>
          <button type="button" onClick={onClose} aria-label="연습 닫기"
            style={{ font: "inherit", fontWeight: 700, color: K.fg, background: "transparent", border: `1px solid ${K.line}`, borderRadius: 10, minHeight: 40, padding: "4px 12px", cursor: "pointer" }}>← 닫기</button>
          <b style={{ fontSize: 18 }}>🎯 고르기 연습</b>
          <span style={{ color: K.dim, fontSize: 13 }}>{data ? `${done.length} / ${order.length} 문제` : ""}</span>
        </div>

        {err && <div style={{ color: K.down }}>연습 문제를 불러오지 못했습니다 ({err}). 잠시 뒤 다시 열어 주세요.</div>}
        {!data && !err && <div style={{ color: K.dim }}>문제를 불러오는 중…</div>}

        {data && (<>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {[["all", "전체"], ["us", "🇺🇸 미국"], ["kr", "🇰🇷 한국"]].map(([k, t]) => (
              <button key={k} type="button" style={seg(st.mk === k)} aria-pressed={st.mk === k} onClick={() => { setCur(null); setSt((s) => ({ ...s, mk: k })); }}>{t}</button>))}
            <span style={{ flex: 1 }} />
            <button type="button" style={seg(st.blind)} aria-pressed={st.blind} onClick={() => setSt((s) => ({ ...s, blind: !s.blind }))}>
              {st.blind ? "이름 가림 ✓" : "이름 보임"}</button>
          </div>
          <div style={{ fontSize: 12.5, color: K.dim, marginTop: -6 }}>
            {st.blind ? "이름·날짜를 가리고 그래프와 숫자만으로 고릅니다. 고른 뒤에 이름과 회사 설명이 나옵니다."
                      : "이름·회사 설명·날짜를 보고 고릅니다. 결과를 아는 종목이면 연습 효과가 줄어듭니다."}
          </div>

          <div className="pp-board">
            {[["내 평균 수익", f(mine), mine == null ? K.dim : col(mine)], ["앱 규칙 평균", f(rule), rule == null ? K.dim : col(rule)],
              ["셋 다 샀다면", f(all3), all3 == null ? K.dim : col(all3)], ["규칙과 같은 선택", done.length ? `${same} / ${done.length}` : "—", K.fg]].map(([k, v, c]) => (
              <div key={k}><small style={{ display: "block", color: K.dim, fontSize: 12 }}>{k}</small><b style={{ fontFamily: MONO, fontSize: 18, color: c }}>{v}</b></div>))}
          </div>

          {o ? (<>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {o.m === "us" ? "🇺🇸 미국" : "🇰🇷 한국"} · {picked == null && st.blind ? "어느 날" : o.d} 새로 "매수!"가 된 {o.nc}종목 중 3개입니다. 하나만 산다면?
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 12, color: K.dim, marginTop: -6 }}>
              {[[K.fg, "종가", "solid"], [K.up, "트레일링선(초록=보유)", "solid"], [K.down, "트레일링선(빨강)", "solid"], [K.blue, "200일선", "dashed"]].map(([c, t, s]) => (
                <span key={t}><i style={{ display: "inline-block", width: 16, borderTop: `2px ${s} ${c}`, verticalAlign: "middle", marginRight: 4 }} />{t}</span>))}
            </div>
            <div className="pp-cards">
              {o.rows.map((r, k) => <Card key={idx + "-" + k} r={r} k={k} picked={picked} info={data.info?.[r.t]} blind={st.blind} onPick={pick} />)}
            </div>
            {picked != null && (
              <div style={{ background: K.panel, border: `1px solid ${K.line}`, borderRadius: 12, padding: 14, display: "flex", flexWrap: "wrap", gap: "10px 16px",
                            alignItems: "center", justifyContent: "space-between" }}>
                <p style={{ margin: 0, minWidth: 0, flex: "1 1 260px" }}>
                  <b style={{ fontFamily: MONO, color: col(o.rows[picked].ret) }}>{pct(o.rows[picked].ret)}</b> · {verdict}</p>
                <button type="button" onClick={next}
                  style={{ font: "inherit", fontWeight: 700, background: K.gold, color: K.bg, border: `1px solid ${K.gold}`, borderRadius: 10, padding: "10px 18px", minHeight: 44, cursor: "pointer" }}>
                  {firstOpen != null ? "다음 문제" : "결과 보기"}</button>
              </div>)}
          </>) : (
            <div style={{ background: K.panel, border: `1px solid ${K.line}`, borderRadius: 12, padding: 14 }}>
              <b>{order.length}문제를 모두 풀었습니다. 수익으로 끝난 판은 {wins}개입니다.</b>
              <p style={{ margin: "6px 0 0", color: K.dim, maxWidth: "65ch" }}>
                위 점수판에서 내 평균과 앱 규칙 평균을 비교해 보세요. 수익으로 끝나는 판이 절반이 안 되는 것은 이 방식의 정상적인 모습입니다. 작은 손실 여러 번을 큰 수익 몇 번이 메웁니다.</p>
            </div>)}

          {hist.length > 0 && (
            <details open={!o}>
              <summary style={{ cursor: "pointer", color: K.dim, fontSize: 13 }}>내가 고른 기록 ({hist.length}판 · 수익 {wins}판)</summary>
              <div style={{ overflowX: "auto", marginTop: 6 }}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
                  <thead><tr style={{ color: K.dim }}>{["신호일", "내 선택", "수익", "앱 규칙", "수익"].map((h, i) => (
                    <th key={i} style={{ padding: "5px 8px", borderBottom: `1px solid ${K.line}`, textAlign: i === 2 || i === 4 ? "right" : "left", whiteSpace: "nowrap", fontWeight: 500 }}>{h}</th>))}</tr></thead>
                  <tbody>{(showAll ? hist : hist.slice(0, 15)).map((i) => { const me = R[i].rows[st.picks[i]], ru = R[i].rows.find((r) => r.rule);
                    const td = { padding: "5px 8px", borderBottom: `1px solid ${K.line}`, whiteSpace: "nowrap" };
                    return (<tr key={i}><td style={td}>{R[i].m === "us" ? "🇺🇸" : "🇰🇷"} {R[i].d}</td><td style={td}>{me.n}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: MONO, color: col(me.ret) }}>{pct(me.ret)}</td><td style={td}>{ru.n}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: MONO, color: col(ru.ret) }}>{pct(ru.ret)}</td></tr>); })}</tbody>
                </table>
              </div>
              {hist.length > 15 && <button type="button" style={{ ...seg(false), marginTop: 8 }} onClick={() => setShowAll((v) => !v)}>{showAll ? "최근 15판만" : `전체 ${hist.length}판 보기`}</button>}
            </details>)}

          <details style={{ color: K.dim, fontSize: 13 }}>
            <summary style={{ cursor: "pointer" }}>이 연습의 규칙과 한계</summary>
            <p style={{ margin: "6px 0", maxWidth: "65ch" }}>문제는 실제 과거 시세로 만든 {R.length}개입니다(미국 {R.filter((x) => x.m === "us").length} · 한국 {R.filter((x) => x.m === "kr").length}, 2010년 6월~2026년 3월). 그날 알파터미널 규칙으로 처음 "매수!"가 된 종목 중 3개를 보여줍니다. 하나는 앱이 고르는 종목(강세·눌림 먼저, 그다음 강도 점수 높은 순)이고 나머지 둘은 같은 날 후보 중 무작위입니다.</p>
            <p style={{ margin: "6px 0", maxWidth: "65ch" }}>성적은 앱과 같은 방식으로 셉니다. 다음 날 시가에 사고, 종가가 트레일링선 아래로 마감하면 그다음 날 시가에 팝니다. 수수료·세금·환율은 뺐습니다. 그래프 값은 6개월 전을 100으로 맞춘 지수이고, 카드의 숫자는 모두 신호일 기준입니다.</p>
            <p style={{ margin: "6px 0", maxWidth: "65ch" }}>업종과 회사 설명은 지금 기준이라 신호일 당시와 다를 수 있습니다. 지금 종목풀에 남아 있는 종목만 들어 있어 상장폐지된 종목이 빠져 있고, 그래서 실제보다 성적이 좋게 나옵니다. 한 판의 결과는 운이 크니 여러 판의 평균으로 보세요.</p>
            <button type="button" style={{ ...seg(false), marginTop: 4 }} onClick={reset}>기록 지우고 처음부터</button>
          </details>
        </>)}
      </div>
    </div>);
}
