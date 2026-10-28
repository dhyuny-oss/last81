/**
 * 198·199. '이 회사는' 카드 · 한 줄 소개 · 다음 일정
 * ─────────────────────────────────────────────
 * /api/info 가 회사 소개(🇺🇸 네이버 해외주식 · 🇰🇷 와이즈리포트) · 최근 뉴스 3건(구글 뉴스) · 🇰🇷 IR 일정을 줍니다.
 * 표시 전용입니다 — 매수!·매도! 판정에는 쓰지 않습니다. 실패하면 그 칸만 비우고 링크로 대신합니다.
 * 같은 종목은 이 기기에 6시간 저장해 다시 열면 바로 뜹니다.
 */
import React, { useEffect, useState } from "react";

const MEM = new Map();                       // t → { at, d }
const KEEP = 6 * 3600 * 1000;
const lsKey = (t) => `v14.info.${t}`;
function cached(t) {
  const m = MEM.get(t); if (m && Date.now() - m.at < KEEP) return m.d;
  try { const x = JSON.parse(localStorage.getItem(lsKey(t)) || "null"); if (x && Date.now() - x.at < KEEP) { MEM.set(t, x); return x.d; } } catch { /* 저장소 없음 */ }
  return null;
}
const INFLIGHT = new Map();
const SUBS = new Set();                     // 새 정보가 오면 '이번 주 일정'을 다시 그림
function useInfoTick() { const [, set] = useState(0); useEffect(() => { const f = () => set(n => n + 1); SUBS.add(f); return () => SUBS.delete(f); }, []); }
function load(s) {
  const t = String(s.t || "").toUpperCase();
  if (INFLIGHT.has(t)) return INFLIGHT.get(t);
  const p = fetch(`/api/info?t=${encodeURIComponent(t)}&m=${s.m === "kr" ? "kr" : "us"}&n=${encodeURIComponent(String(s.n || "").slice(0, 40))}`)
    .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
    .then(d => { const x = { at: Date.now(), d }; MEM.set(t, x); try { localStorage.setItem(lsKey(t), JSON.stringify(x)); } catch { /* 저장소 없음 */ } SUBS.forEach(f => f()); return d; })
    .finally(() => INFLIGHT.delete(t));
  INFLIGHT.set(t, p);
  return p;
}
export function useInfo(s, on = true) {
  const t = s?.t;
  const [d, setD] = useState(() => (t ? cached(String(t).toUpperCase()) : null));
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!t || !on || s?.etf) return;
    const c = cached(String(t).toUpperCase());
    if (c) { setD(c); return; }
    let dead = false; setErr(false); setD(null);
    load(s).then(x => { if (!dead) setD(x); }).catch(() => { if (!dead) setErr(true); });
    return () => { dead = true; };
  }, [t, on]);                                            // eslint-disable-line react-hooks/exhaustive-deps
  return { d, err, loading: !d && !err };
}

const K = { text: "#E8ECF5", dim: "#A9B2C1", muted: "#8590a3", gold: "#F5B84A", cyan: "#7CC4FF", border: "#1f2b40", panel: "rgba(255,255,255,.03)" };
const md = (iso) => { const m = String(iso || "").match(/^\d{4}-(\d{2})-(\d{2})/); return m ? `${+m[1]}/${+m[2]}` : ""; };
const dday = (iso, today) => Math.round((Date.parse(iso) - Date.parse(today)) / 864e5);

/** 199. 다음 일정 — 실적 발표 · 배당락 · 🇰🇷 IR (오늘부터 within 일 안, 날짜순) */
export function nextEvents(s, info, today, within = 45) {
  const out = [];
  const add = (d, label, key) => { if (!d) return; const n = dday(d, today); if (n >= 0 && n <= within && !out.some(x => x.d === d && x.key === key)) out.push({ d, n, label, key }); };
  if (s?.earn) add(s.earn, `실적 발표${s.earnE ? "(예상)" : ""}`, "earn");
  if (s?.exDiv) add(s.exDiv, "배당락", "div");
  const ir = info?.ir;
  if (ir?.date && !(s?.earn && ir.date === s.earn && /실적/.test(ir.title))) add(ir.date, ir.title.length > 18 ? ir.title.slice(0, 17) + "…" : ir.title, "ir");
  return out.sort((a, b) => a.d.localeCompare(b.d));
}
export const evTxt = (e) => `${md(e.d)} ${e.label} ${e.n === 0 ? "오늘" : `D-${e.n}`}`;

/** 오늘 살 것 행 아래 한 줄 소개 */
export function AboutLine({ s, style }) {
  const { d } = useInfo(s);
  if (!d?.about) return null;
  return <div style={{ fontSize: 11, color: K.dim, lineHeight: 1.45, marginTop: 3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", ...style }}>{d.about}</div>;
}

/** 차트 위 '이 회사는' 카드 — 소개 · 최근 뉴스 3건 · 다음 일정 */
export function AboutCard({ s, today, naverUrl }) {
  const { d, err, loading } = useInfo(s);
  const [open, setOpen] = useState(false);
  const ev = nextEvents(s, d, today, 60);
  return (
    <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: K.panel, border: `1px solid ${K.border}` }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <b style={{ fontSize: 13, color: K.text }}>이 회사는</b>
        {d?.industry && <span style={{ fontSize: 11, color: K.muted }}>{d.industry}</span>}
        {naverUrl && <a href={naverUrl} target="_blank" rel="noopener" style={{ marginLeft: "auto", fontSize: 11, color: K.cyan, textDecoration: "none" }}>네이버에서 자세히 ↗</a>}
      </div>
      {loading && <div style={{ fontSize: 12, color: K.muted, marginTop: 6 }}>불러오는 중…</div>}
      {err && <div style={{ fontSize: 12, color: K.muted, marginTop: 6 }}>회사 정보를 불러오지 못했습니다 — 위 '네이버에서 자세히'로 보세요</div>}
      {d?.about && <div onClick={() => setOpen(v => !v)} style={{ fontSize: 12.5, color: K.dim, lineHeight: 1.55, marginTop: 6, cursor: "pointer",
                         ...(open ? {} : { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }) }}>{d.about}</div>}
      {ev.length > 0 && <div style={{ fontSize: 12, color: K.gold, marginTop: 7, fontWeight: 700 }}>📅 {ev.map(evTxt).join(" · ")}</div>}
      {d && (d.news || []).length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: K.muted, marginBottom: 2 }}>최근 뉴스 — 오른·내린 이유는 제목에서 짐작할 수 있지만 앱이 단정하지는 않습니다</div>
          {d.news.map((n, i) => (
            <a key={i} href={n.link} target="_blank" rel="noopener" style={{ display: "block", padding: "6px 0", borderTop: i ? `1px solid ${K.border}` : "none", textDecoration: "none" }}>
              <span style={{ fontSize: 12.5, color: K.text, lineHeight: 1.45 }}>{n.title}</span>
              <span style={{ display: "block", fontSize: 10.5, color: K.muted, marginTop: 1 }}>{md(n.date)} · {n.src}</span>
            </a>))}
        </div>)}
      {d && !(d.news || []).length && !loading && <div style={{ fontSize: 11, color: K.muted, marginTop: 6 }}>최근 3주 안 뉴스가 없습니다</div>}
    </div>);
}

/** 199. 내 종목 카드 — '다음 일정' 한 줄 (🇰🇷 은 IR 일정까지 받아 옴) */
export function SchedLine({ s, today, style }) {
  const { d } = useInfo(s, s?.m === "kr");
  const ev = nextEvents(s, d, today, 45);
  if (!ev.length) return null;
  const soon = ev[0].n <= 7;
  return <div style={{ fontSize: 11.5, color: soon ? K.gold : K.dim, fontWeight: soon ? 700 : 400, marginTop: 6, lineHeight: 1.45, ...style }}>📅 다음 일정 · {ev.map(evTxt).join(" · ")}</div>;
}

/** 199. 자세히 — 지난 실적 발표와 그 뒤 주가 반응 */
export function pastEarnTxt(s) {
  if (!s?.earnPast) return null;
  const f = s.fin || {};
  const bits = [`지난 실적 ${md(s.earnPast)}`];
  if (f.qyoy != null) bits.push(`분기 매출 ${f.qyoy >= 0 ? "+" : ""}${Math.round(f.qyoy)}%`);
  if (f.prof != null) bits.push(f.prof ? "흑자" : "적자");
  if (s.earnRx != null) bits.push(`발표 뒤 이틀 주가 ${s.earnRx >= 0 ? "+" : ""}${s.earnRx.toFixed(1)}%`);
  return bits.join(" · ");
}

/** 199. 맨 위 '이번 주 일정' — 내 종목 + 오늘 살 것, 앞으로 7일 */
export function WeekSched({ list, today, openStock, style }) {
  useInfoTick();
  const seen = new Set(), rows = [];
  for (const { s, tag } of list) {
    if (!s?.t || s.etf || seen.has(s.t)) continue; seen.add(s.t);
    const info = s.m === "kr" ? cached(String(s.t).toUpperCase()) : null;
    for (const e of nextEvents(s, info, typeof today === "function" ? today(s.m) : today, 7)) rows.push({ ...e, s, tag });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => a.d.localeCompare(b.d));
  return (
    <div style={{ padding: "9px 12px", borderRadius: 10, background: "rgba(245,184,74,.07)", border: "1px solid rgba(245,184,74,.25)", marginBottom: 8, ...style }}>
      <b style={{ fontSize: 12.5, color: K.gold }}>📅 이번 주 일정</b>
      {rows.slice(0, 8).map((r, i) => (
        <div key={i} onClick={() => openStock?.(r.s.t)} style={{ display: "flex", gap: 8, fontSize: 12, color: K.text, padding: "4px 0", cursor: openStock ? "pointer" : "default" }}>
          <span style={{ width: 66, flexShrink: 0, color: r.n <= 1 ? K.gold : K.dim }}>{md(r.d)} {r.n === 0 ? "오늘" : `D-${r.n}`}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <b>{r.s.m === "kr" ? r.s.n : r.s.t}</b> {r.label}{r.tag ? <span style={{ color: K.muted }}> · {r.tag}</span> : null}</span>
        </div>))}
      <div style={{ fontSize: 10.5, color: K.muted, marginTop: 2 }}>실적 날짜는 회사 공지 전엔 '예상' · 일정은 참고용이며 매수!·매도! 판정을 바꾸지 않습니다</div>
    </div>);
}
