/**
 * 한투 계좌 조회 카드 — 내 종목 탭 아래에 붙는 "보기 전용" 화면
 * ════════════════════════════════════════════════════════════
 * /api/kis 를 불러 미국 주식 잔고를 보여주고, 앱의 내 종목과 무엇이 다른지만 알려줍니다.
 * 앱의 내 종목을 바꾸지 않습니다. 주문 기능 없음.
 *
 * ▣ 빼는 방법: api/kis.js 맨 위 설명 참고 (App.jsx 의 "★ 한투" 두 곳 + 이 파일 + api/kis.js + 환경변수)
 *
 * props: held = 앱 내 종목의 티커 배열 (비교용 · 읽기만 함)
 */
import React, { useState, useEffect, useCallback } from "react";

const K = { panel: "#0F1420", border: "rgba(255,255,255,.09)", text: "#E5E7EB", dim: "#9CA3AF", gold: "#F59E0B", up: "#30D158", down: "#FF453A" };
const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";
const TOK = "v7.kis.tok", PIN = "v7.kis.pin";
const ls = { get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } }, set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} } };
const usd = (v, d = 0) => "$" + Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v || 0).toFixed(1)}%`;
const col = (v) => (v > 0 ? K.up : v < 0 ? K.down : K.dim);
const isUs = (t) => !/^\d{6}$/.test(t);
const btn = { font: "inherit", fontSize: 13, fontWeight: 700, minHeight: 40, padding: "6px 14px", borderRadius: 10, cursor: "pointer",
              background: "transparent", color: K.text, border: `1px solid ${K.gold}` };

export default function KisPanel({ held = [] }) {
  const [info, setInfo] = useState(null);               // { configured, env, pin }
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [needPin, setNeedPin] = useState(false);
  const [pin, setPin] = useState(() => ls.get(PIN));

  useEffect(() => {
    let live = true;
    fetch("/api/kis").then((r) => r.json()).then((j) => { if (live) setInfo(j && j.ok ? j : { configured: false, off: true }); })
      .catch(() => { if (live) setInfo({ configured: false, off: true }); });
    return () => { live = false; };
  }, []);

  const load = useCallback(async () => {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/kis", { method: "POST", headers: { "Content-Type": "application/json", "x-kis-pin": pin || "" },
                                          body: JSON.stringify({ what: "balance", tok: ls.get(TOK) }) });
      const j = await r.json();
      if (j.ok) { if (j.tok) ls.set(TOK, j.tok); ls.set(PIN, pin); setNeedPin(false); setData(j); }
      else { if (j.code === "pin") { setNeedPin(true); ls.set(PIN, ""); } setMsg(j.msg || "불러오지 못했습니다"); }
    } catch (e) { setMsg("연결하지 못했습니다 — 잠시 뒤 다시 눌러 주세요"); }
    setBusy(false);
  }, [pin]);

  if (!info) return null;
  const demo = (data?.env || info.env) !== "real";
  const box = { marginTop: 14, padding: "12px 14px", borderRadius: 12, background: K.panel, border: `1px solid ${K.border}`, color: K.text, fontSize: 13 };
  const head = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <b style={{ fontSize: 14 }}>🏦 한투 계좌</b>
      <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 99, border: `1px solid ${demo ? K.dim : K.gold}`, color: demo ? K.dim : K.gold }}>{demo ? "모의투자" : "실전"}</span>
      <span style={{ fontSize: 11, color: K.dim }}>조회 전용 · 🇺🇸 미국 주식</span>
    </div>);

  if (!info.configured || info.pinMissing) return (
    <div style={box}>{head}
      <div style={{ color: K.dim, marginTop: 6, lineHeight: 1.6 }}>
        {info.off ? "서버 연결 함수(/api/kis)를 찾지 못했습니다." : info.pinMissing ? "실전 계좌는 Vercel 환경변수 KIS_PIN(내가 정하는 비밀번호)을 넣어야 열립니다."
          : <>아직 연결 전입니다. Vercel → Settings → Environment Variables 에 <span style={{ fontFamily: MONO, color: K.text }}>KIS_APP_KEY · KIS_APP_SECRET · KIS_ACCOUNT · KIS_ENV · KIS_PIN</span> 을 넣고 다시 배포하면 여기서 조회됩니다.</>}
      </div>
    </div>);

  const mine = new Set(held.filter(isUs));
  const kis = new Set((data?.rows || []).map((r) => r.t));
  const onlyKis = [...kis].filter((t) => !mine.has(t)), onlyApp = [...mine].filter((t) => !kis.has(t));

  return (
    <div style={box}>
      {head}
      {(needPin || (info.pin && !pin)) && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="비밀번호 (KIS_PIN)" autoComplete="off" aria-label="한투 조회 비밀번호"
            style={{ flex: "1 1 160px", minWidth: 0, minHeight: 40, padding: "6px 10px", borderRadius: 10, border: `1px solid ${K.border}`, background: "#0A0E1A", color: K.text, font: "inherit" }} />
        </div>)}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={load} disabled={busy} style={{ ...btn, opacity: busy ? .6 : 1 }}>{busy ? "불러오는 중…" : data ? "다시 불러오기" : "잔고 불러오기"}</button>
        {data && <span style={{ color: K.dim, fontSize: 12 }}>{new Date(data.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 기준</span>}
      </div>
      {msg && <div style={{ color: K.down, marginTop: 8, lineHeight: 1.5 }}>⚠ {msg}</div>}

      {data && (data.rows.length === 0
        ? <div style={{ color: K.dim, marginTop: 10 }}>보유한 미국 주식이 없습니다{demo ? " (모의 계좌는 모의로 산 종목만 보입니다)" : ""}.</div>
        : <>
          <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 13 }}>
            {data.sum.n}종목 · 매입 {usd(data.sum.cost)} → 평가 {usd(data.sum.val)}{" "}
            <b style={{ color: col(data.sum.pl) }}>{pct(data.sum.plPct)}</b>
          </div>
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
              <thead><tr style={{ color: K.dim }}>{["종목", "수량", "평단", "지금", "평가", "수익"].map((h, i) => (
                <th key={h} style={{ padding: "5px 6px", borderBottom: `1px solid ${K.border}`, textAlign: i ? "right" : "left", fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>))}</tr></thead>
              <tbody>{data.rows.map((r) => { const td = { padding: "6px", borderBottom: `1px solid ${K.border}`, textAlign: "right", fontFamily: MONO, whiteSpace: "nowrap" };
                return (<tr key={r.t + r.ex}>
                  <td style={{ ...td, textAlign: "left" }}><b>{r.t}</b>{!mine.has(r.t) && <span style={{ color: K.gold, fontFamily: "inherit", fontSize: 11 }}> · 앱에 없음</span>}
                    {r.n && <div style={{ color: K.dim, fontFamily: "inherit", fontSize: 11, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>{r.n}</div>}</td>
                  <td style={td}>{r.qty}</td><td style={td}>{usd(r.avg, 2)}</td><td style={td}>{usd(r.px, 2)}</td><td style={td}>{usd(r.val)}</td>
                  <td style={{ ...td, color: col(r.pl) }}>{pct(r.plPct)}</td></tr>); })}</tbody>
            </table>
          </div>
        </>)}
      {data && (onlyKis.length > 0 || onlyApp.length > 0) && (
        <div style={{ marginTop: 10, color: K.dim, lineHeight: 1.6 }}>
          {onlyKis.length > 0 && <div>한투에만 있음: <span style={{ color: K.text, fontFamily: MONO }}>{onlyKis.join(" · ")}</span></div>}
          {onlyApp.length > 0 && <div>앱 내 종목에만 있음: <span style={{ color: K.text, fontFamily: MONO }}>{onlyApp.join(" · ")}</span> <span style={{ fontSize: 11 }}>(다른 증권사 보유분이면 정상)</span></div>}
        </div>)}
      <div style={{ marginTop: 10, color: K.dim, fontSize: 11, lineHeight: 1.5 }}>
        보기만 합니다. 앱의 내 종목은 바뀌지 않고 주문 기능은 없습니다. 조회할 때마다 한투 알림톡이 올 수 있습니다(접속 토큰을 새로 받는 날).
      </div>
    </div>);
}
