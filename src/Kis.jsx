/**
 * 한투 계좌 카드 — 내 종목 탭 아래에 붙는 화면
 * ════════════════════════════════════════════════════════════
 * /api/kis 를 불러 한투 계좌의 미국 주식을 보여줍니다.
 *  · 한투 보유는 앱의 "내 종목"(메리츠 실전)과 완전히 분리해서 따로 표시합니다.
 *    투입금·빈 칸·텔레그램 합계에 섞이지 않고, 앱의 내 종목도 바꾸지 않습니다.
 *  · 모의투자(demo)일 때만 주문·취소가 열립니다 (서버가 한 번 더 막음). 실전은 조회만.
 *  · 한투 관심 그룹 → 앱 관심종목은 읽어 와서 추가만 합니다 (반대 방향은 한투가 지원하지 않음).
 *
 * ▣ 빼는 방법: api/kis.js 맨 위 설명 참고 (App.jsx 의 "★ 한투" 두 곳 + 이 파일 + api/kis.js + 환경변수)
 *
 * props: held = 앱 내 종목 티커(비교용·읽기만) · stocks = 앱 종목 지표 · picks = 오늘 살 것(빠른 선택)
 *        watch / toggleWatch = 앱 관심종목 (관심 불러오기에서만 씀)
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";

const K = { panel: "#0F1420", panel2: "#161B2E", border: "rgba(255,255,255,.09)", text: "#E5E7EB", dim: "#9CA3AF", gold: "#F59E0B", up: "#30D158", down: "#FF453A", cyan: "#06B6D4" };
const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";
const TOK = "v7.kis.tok", PIN = "v7.kis.pin";
const ls = { get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } }, set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} } };
const usd = (v, d = 0) => "$" + Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v || 0).toFixed(1)}%`;
const col = (v) => (v > 0 ? K.up : v < 0 ? K.down : K.dim);
const isUs = (t) => !/^\d{6}$/.test(t);
const EX = { NMS: "NASD", NGM: "NASD", NCM: "NASD", NYQ: "NYSE", ASE: "AMEX", PCX: "AMEX", BTS: "AMEX" };
const rid = () => { try { return crypto.randomUUID(); } catch { return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); } };
const btn = { font: "inherit", fontSize: 13, fontWeight: 700, minHeight: 40, padding: "6px 14px", borderRadius: 10, cursor: "pointer", background: "transparent", color: K.text, border: `1px solid ${K.gold}` };
const quiet = { ...btn, border: `1px solid ${K.border}`, color: K.dim, fontWeight: 500 };
const inp = { minHeight: 40, padding: "6px 10px", borderRadius: 10, border: `1px solid ${K.border}`, background: "#0A0E1A", color: K.text, font: "inherit", minWidth: 0 };
const SIG = { buy: ["매수!", K.up], sell: ["매도!", K.down], hold: ["보유", K.cyan], watch: ["관망", K.dim] };

export default function KisPanel({ held = [], stocks = {}, picks = [], watch = [], toggleWatch }) {
  const [info, setInfo] = useState(null);
  const [data, setData] = useState(null);             // 잔고
  const [orders, setOrders] = useState(null);         // 주문 내역
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(""), [ok, setOk] = useState("");
  const [needPin, setNeedPin] = useState(false);
  const [pin, setPin] = useState(() => ls.get(PIN));
  const [form, setForm] = useState({ side: "buy", t: "", ex: "NASD", qty: "1", px: "" });
  const [confirm, setConfirm] = useState(null);       // { ...order, rid }
  const [groups, setGroups] = useState(null), [fav, setFav] = useState(null);

  useEffect(() => {
    let live = true;
    fetch("/api/kis").then((r) => r.json()).then((j) => { if (live) setInfo(j && j.ok ? j : { configured: false, off: true }); })
      .catch(() => { if (live) setInfo({ configured: false, off: true }); });
    return () => { live = false; };
  }, []);

  /** 서버 호출 한 번 — 토큰 꾸러미는 항상 갱신해서 보관 */
  const call = useCallback(async (body) => {
    const r = await fetch("/api/kis", { method: "POST", headers: { "Content-Type": "application/json", "x-kis-pin": pin || "" }, body: JSON.stringify({ ...body, tok: ls.get(TOK) }) });
    const j = await r.json();
    if (j.tok) ls.set(TOK, j.tok);
    if (j.code === "pin") { setNeedPin(true); ls.set(PIN, ""); }
    else if (j.ok) { setNeedPin(false); ls.set(PIN, pin); }
    return j;
  }, [pin]);

  const run = useCallback(async (key, fn) => {
    setBusy(key); setMsg(""); setOk("");
    try { await fn(); } catch { setMsg("연결하지 못했습니다 — 잠시 뒤 다시 눌러 주세요"); }
    setBusy("");
  }, []);

  const loadAll = () => run("load", async () => {
    const j = await call({ what: "balance" });
    if (!j.ok) return setMsg(j.msg || "불러오지 못했습니다");
    setData(j);
    if (info?.canOrder) {                              // 모의 호출 간격(초당 제한)을 위해 잠깐 쉬고 주문 내역
      await new Promise((r) => setTimeout(r, 700));
      const o = await call({ what: "orders" });
      if (o.ok) setOrders(o.orders); else setMsg(o.msg || "주문 내역을 불러오지 못했습니다");
    }
  });
  const reloadOrders = async () => { const o = await call({ what: "orders" }); if (o.ok) setOrders(o.orders); else setMsg(o.msg || ""); };

  const pick = (t, side, extra = {}) => {                // 종목 채우기: 지금 가격·거래소 자동
    const s = stocks[t];
    setForm((f) => ({ ...f, side, t, ex: extra.ex || EX[s?.ex] || f.ex, px: extra.px != null ? String(extra.px) : s?.c != null ? String(Math.round(s.c * 100) / 100) : f.px,
                      qty: extra.qty != null ? String(extra.qty) : f.qty }));
    setOk(""); setMsg("");
  };
  const amount = (Number(form.qty) || 0) * (Number(form.px) || 0);
  const formErr = !/^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(form.t.trim()) ? "종목 코드를 넣어 주세요" : !(Number(form.qty) >= 1) ? "수량은 1주 이상" : !(Number(form.px) > 0) ? "지정가를 넣어 주세요"
    : amount > (info?.maxUsd || 5000) ? `1건 상한 ${usd(info?.maxUsd || 5000)} 초과` : "";
  const openConfirm = () => { if (!formErr) setConfirm({ ...form, t: form.t.trim().toUpperCase(), qty: Math.floor(Number(form.qty)), px: Math.round(Number(form.px) * 100) / 100, rid: rid() }); };
  const send = () => run("order", async () => {
    const c = confirm; setConfirm(null);
    const j = await call({ what: "order", side: c.side, t: c.t, ex: c.ex, qty: c.qty, px: c.px, rid: c.rid, confirm: true });
    if (!j.ok) return setMsg(j.msg || "주문이 거절되었습니다");
    setOk(`모의 ${c.side === "buy" ? "매수" : "매도"} 주문을 보냈습니다 — ${c.t} ${c.qty}주 × ${usd(c.px, 2)}${j.placed?.odno ? ` · 주문번호 ${j.placed.odno}` : ""} (체결은 주문 내역에서 확인)`);
    await new Promise((r) => setTimeout(r, 700)); await reloadOrders();
  });
  const cancel = (o) => run("cancel:" + o.odno, async () => {
    const j = await call({ what: "cancel", odno: o.odno, t: o.t, ex: o.ex, qty: o.open || o.qty });
    if (!j.ok) return setMsg(j.msg || "취소하지 못했습니다");
    setOk(`${o.t} 주문 ${o.odno} 취소를 보냈습니다`);
    await new Promise((r) => setTimeout(r, 700)); await reloadOrders();
  });
  const loadGroups = () => run("groups", async () => { setFav(null); const j = await call({ what: "groups" }); if (j.ok) setGroups(j.groups); else setMsg(j.msg || ""); });
  const loadGroup = (g) => run("group", async () => { const j = await call({ what: "group", code: g.code }); if (j.ok) setFav({ g, stocks: j.stocks }); else setMsg(j.msg || ""); });

  const mine = useMemo(() => new Set(held.filter(isUs)), [held]);
  const demo = (data?.env || info?.env) !== "real";
  const box = { marginTop: 14, padding: "12px 14px", borderRadius: 12, background: K.panel, border: `1px solid ${K.border}`, color: K.text, fontSize: 13 };

  if (!info) return null;
  const head = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <b style={{ fontSize: 14 }}>🏦 한투 계좌</b>
      <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 99, border: `1px solid ${demo ? K.dim : K.gold}`, color: demo ? K.dim : K.gold }}>{demo ? "모의투자" : "실전"}</span>
      <span style={{ fontSize: 11, color: K.dim }}>{info.canOrder ? "조회 + 모의 주문" : "조회 전용"} · 🇺🇸 미국 주식</span>
    </div>);
  if (!info.configured || info.pinMissing) return (
    <div style={box}>{head}
      <div style={{ color: K.dim, marginTop: 6, lineHeight: 1.6 }}>
        {info.off ? "서버 연결 함수(/api/kis)를 찾지 못했습니다."
          : !info.configured ? <>아직 연결 전입니다. Vercel → Settings → Environment Variables 에 <span style={{ fontFamily: MONO, color: K.text }}>KIS_APP_KEY · KIS_APP_SECRET · KIS_ACCOUNT · KIS_ENV · KIS_PIN</span> 을 넣고 다시 배포하면 여기서 조회됩니다.</>
          : "Vercel 환경변수 KIS_PIN(내가 정하는 비밀번호)을 넣어야 열립니다."}
      </div>
    </div>);

  const sigOf = (r) => { const s = stocks[r.t]; if (!s) return null; const [txt, c] = SIG[s.action] || SIG.watch;
    return { txt, c, line: s.stLine, below: s.stLine && r.px && r.px < s.stLine }; };

  return (
    <div style={box}>
      {head}
      <div style={{ marginTop: 6, color: K.dim, fontSize: 11.5, lineHeight: 1.5 }}>
        여기 보유는 앱의 <b style={{ color: K.text }}>내 종목(메리츠)과 따로</b> 표시됩니다. 투입금·빈 칸·텔레그램 합계에 섞이지 않습니다.
      </div>
      {(needPin || !pin) && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="비밀번호 (KIS_PIN)" autoComplete="off" aria-label="한투 조회 비밀번호" style={{ ...inp, flex: "1 1 160px" }} />
        </div>)}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={loadAll} disabled={!!busy} style={{ ...btn, opacity: busy ? .6 : 1 }}>{busy === "load" ? "불러오는 중…" : data ? "다시 불러오기" : info.canOrder ? "잔고·주문내역 불러오기" : "잔고 불러오기"}</button>
        {data && <span style={{ color: K.dim, fontSize: 12 }}>{new Date(data.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 기준</span>}
      </div>
      {msg && <div role="alert" style={{ color: K.down, marginTop: 8, lineHeight: 1.5 }}>⚠ {msg}</div>}
      {ok && <div role="status" style={{ color: K.up, marginTop: 8, lineHeight: 1.5 }}>✓ {ok}</div>}

      {data && (data.rows.length === 0
        ? <div style={{ color: K.dim, marginTop: 10 }}>보유한 미국 주식이 없습니다{demo ? " (모의 계좌는 모의로 산 종목만 보입니다)" : ""}.</div>
        : <>
          <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 13 }}>
            {demo ? "모의 보유" : "한투 보유"} {data.sum.n}종목 · 매입 {usd(data.sum.cost)} → 평가 {usd(data.sum.val)} <b style={{ color: col(data.sum.pl) }}>{pct(data.sum.plPct)}</b>
          </div>
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
              <thead><tr style={{ color: K.dim }}>{["종목", "지금", "수익", "앱 신호", ""].map((h, i) => (
                <th key={i} style={{ padding: "5px 4px", borderBottom: `1px solid ${K.border}`, textAlign: i && i < 4 ? "right" : "left", fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>))}</tr></thead>
              <tbody>{data.rows.map((r) => { const td = { padding: "6px 4px", borderBottom: `1px solid ${K.border}`, textAlign: "right", fontFamily: MONO, whiteSpace: "nowrap", verticalAlign: "top" }; const sg = sigOf(r);
                return (<tr key={r.t + r.ex}>
                  <td style={{ ...td, textAlign: "left", whiteSpace: "normal" }}><b>{r.t}</b>
                    <div style={{ color: K.dim, fontFamily: "inherit", fontSize: 11 }}>{r.qty}주 · 평단 {usd(r.avg, 2)}</div>
                    {mine.has(r.t) && <div style={{ color: K.gold, fontFamily: "inherit", fontSize: 11 }}>내 종목에도 있음</div>}</td>
                  <td style={td}>{usd(r.px, 2)}</td>
                  <td style={{ ...td, color: col(r.pl) }}>{pct(r.plPct)}</td>
                  <td style={{ ...td, fontFamily: "inherit" }}>{sg ? <span style={{ color: sg.c, fontWeight: 700 }}>{sg.txt}</span> : <span style={{ color: K.dim }}>—</span>}
                    {sg?.below && <div style={{ color: K.down, fontSize: 11 }}>선 {usd(sg.line, 0)} 아래</div>}</td>
                  <td style={{ ...td, textAlign: "left" }}>{info.canOrder && <button type="button" onClick={() => pick(r.t, "sell", { ex: r.ex, px: r.px, qty: r.ord })} style={{ ...quiet, minHeight: 32, padding: "2px 10px", fontSize: 12 }}>매도</button>}</td>
                </tr>); })}
              </tbody>
            </table>
          </div>
        </>)}

      {info.canOrder && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${K.border}` }}>
          <b style={{ fontSize: 13 }}>모의 주문</b> <span style={{ color: K.dim, fontSize: 11.5 }}>지정가만 · 1건 상한 {usd(info.maxUsd)} · 보내기 전에 한 번 더 확인</span>
          {picks.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              <span style={{ color: K.dim, fontSize: 11.5, alignSelf: "center" }}>오늘 살 것</span>
              {picks.slice(0, 8).map((p) => (<button key={p.t} type="button" onClick={() => pick(p.t, "buy")} style={{ ...quiet, minHeight: 32, padding: "2px 10px", fontSize: 12, fontFamily: MONO, color: form.t === p.t ? K.gold : K.dim }}>{p.t}</button>))}
            </div>)}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))", gap: 8, marginTop: 8 }}>
            <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })} aria-label="주문 매수 매도" style={inp}><option value="buy">매수</option><option value="sell">매도</option></select>
            <input value={form.t} onChange={(e) => pick(e.target.value.toUpperCase().replace(/[^A-Z0-9.\-]/g, ""), form.side)} placeholder="종목 (예: AMD)" aria-label="주문 종목" style={inp} />
            <select value={form.ex} onChange={(e) => setForm({ ...form, ex: e.target.value })} aria-label="주문 거래소" style={inp}><option value="NASD">나스닥</option><option value="NYSE">뉴욕</option><option value="AMEX">아멕스</option></select>
            <input value={form.qty} inputMode="numeric" onChange={(e) => setForm({ ...form, qty: e.target.value.replace(/\D/g, "") })} placeholder="수량" aria-label="주문 수량" style={inp} />
            <input value={form.px} inputMode="decimal" onChange={(e) => setForm({ ...form, px: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="지정가 $" aria-label="주문 지정가" style={inp} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={openConfirm} disabled={!!formErr || !!busy} style={{ ...btn, opacity: formErr || busy ? .5 : 1 }}>주문 확인</button>
            <span style={{ color: formErr ? K.dim : K.text, fontSize: 12, fontFamily: formErr ? "inherit" : MONO }}>{formErr || `${form.qty}주 × ${usd(form.px, 2)} = ${usd(amount, 2)}`}</span>
          </div>
        </div>)}

      {info.canOrder && orders && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${K.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><b style={{ fontSize: 13 }}>최근 주문 (7일)</b>
            <button type="button" onClick={() => run("orders", reloadOrders)} disabled={!!busy} style={{ ...quiet, minHeight: 30, padding: "2px 10px", fontSize: 12 }}>새로고침</button></div>
          {orders.length === 0 ? <div style={{ color: K.dim, marginTop: 6 }}>최근 주문이 없습니다.</div> : (
            <div style={{ overflowX: "auto", marginTop: 6 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
                <tbody>{orders.slice(0, 15).map((o) => { const td = { padding: "6px", borderBottom: `1px solid ${K.border}`, whiteSpace: "nowrap" };
                  return (<tr key={o.odno + o.kind}>
                    <td style={td}>{o.dt.slice(4, 6)}/{o.dt.slice(6)}</td>
                    <td style={{ ...td, color: o.side === "buy" ? K.up : K.down, fontWeight: 700 }}>{o.side === "buy" ? "매수" : "매도"}</td>
                    <td style={{ ...td, fontFamily: MONO }}><b>{o.t}</b> {o.qty}주 × {usd(o.px, 2)}</td>
                    <td style={{ ...td, color: K.dim }}>{o.filled > 0 ? `체결 ${o.filled}${o.open > 0 ? ` · 대기 ${o.open}` : ""}` : o.open > 0 ? `대기 ${o.open}` : ""} {o.kind || o.state}{o.why ? ` · ${o.why}` : ""}</td>
                    <td style={td}>{o.open > 0 && !o.orgn && <button type="button" onClick={() => cancel(o)} disabled={!!busy} style={{ ...quiet, minHeight: 30, padding: "2px 10px", fontSize: 12 }}>취소</button>}</td>
                  </tr>); })}</tbody>
              </table>
            </div>)}
        </div>)}

      {info.hts && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${K.border}` }}>
          <b style={{ fontSize: 13 }}>한투 관심 그룹 불러오기</b> <span style={{ color: K.dim, fontSize: 11.5 }}>한투 → 앱 한 방향 · 앱에서 뺀다고 한투에서 빠지지는 않습니다</span>
          <div style={{ marginTop: 8 }}><button type="button" onClick={loadGroups} disabled={!!busy} style={btn}>{busy === "groups" ? "불러오는 중…" : groups ? "그룹 다시 불러오기" : "그룹 불러오기"}</button></div>
          {groups && (groups.length === 0 ? <div style={{ color: K.dim, marginTop: 6 }}>관심 그룹이 없습니다.</div>
            : <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>{groups.map((g) => (
              <button key={g.code} type="button" onClick={() => loadGroup(g)} disabled={!!busy} style={{ ...quiet, minHeight: 34, color: fav?.g.code === g.code ? K.gold : K.dim, borderColor: fav?.g.code === g.code ? K.gold : K.border }}>{g.name || g.code}</button>))}</div>)}
          {fav && (fav.stocks.length === 0 ? <div style={{ color: K.dim, marginTop: 8 }}>이 그룹에 종목이 없습니다.</div> : (
            <div style={{ marginTop: 8 }}>{fav.stocks.map((s) => { const inPool = !!stocks[s.t], has = watch.includes(s.t);
              return (<div key={s.t} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${K.border}` }}>
                <span style={{ flex: 1, minWidth: 0 }}><b style={{ fontFamily: MONO }}>{s.t}</b> <span style={{ color: K.dim }}>{s.n || stocks[s.t]?.n || ""}</span></span>
                {has ? <span style={{ color: K.dim, fontSize: 12 }}>이미 관심</span>
                  : inPool ? <button type="button" onClick={() => toggleWatch && toggleWatch(s.t)} style={{ ...quiet, minHeight: 32, padding: "2px 10px", fontSize: 12 }}>앱 관심에 추가</button>
                  : <span style={{ color: K.dim, fontSize: 12 }}>종목풀에 없음</span>}
              </div>); })}</div>))}
        </div>)}

      {data && mine.size > 0 && (() => { const kis = new Set(data.rows.map((r) => r.t)); const only = [...mine].filter((t) => !kis.has(t));
        return only.length > 0 ? <div style={{ marginTop: 10, color: K.dim, fontSize: 11.5, lineHeight: 1.6 }}>앱 내 종목(메리츠)에만 있음: <span style={{ color: K.text, fontFamily: MONO }}>{only.join(" · ")}</span> — 정상입니다. 서로 다른 계좌입니다.</div> : null; })()}

      <div style={{ marginTop: 10, color: K.dim, fontSize: 11, lineHeight: 1.5 }}>
        {info.canOrder ? "모의투자 전용 주문입니다. 실전 계좌에서는 주문이 열리지 않습니다." : "보기만 합니다. 실전 계좌에서는 주문이 열리지 않습니다."} 조회할 때마다 한투 알림톡이 올 수 있습니다(접속 토큰을 새로 받는 날).
      </div>

      {confirm && (
        <div role="dialog" aria-modal="true" aria-label="주문 확인" onClick={() => setConfirm(null)}
          style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 360, background: K.panel2, border: `1px solid ${K.gold}`, borderRadius: 14, padding: 18, color: K.text }}>
            <div style={{ fontSize: 12, color: K.gold, fontWeight: 700 }}>모의투자 · 지정가</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}><span style={{ color: confirm.side === "buy" ? K.up : K.down }}>{confirm.side === "buy" ? "매수" : "매도"}</span> {confirm.t}</div>
            <div style={{ fontFamily: MONO, fontSize: 15, marginTop: 6 }}>{confirm.qty}주 × {usd(confirm.px, 2)} = <b>{usd(confirm.qty * confirm.px, 2)}</b></div>
            <div style={{ color: K.dim, fontSize: 12, marginTop: 4 }}>{{ NASD: "나스닥", NYSE: "뉴욕", AMEX: "아멕스" }[confirm.ex]} · 가짜 돈입니다. 같은 주문이 두 번 나가지 않게 한 번만 전송됩니다.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button type="button" onClick={() => setConfirm(null)} style={{ ...quiet, flex: 1 }}>돌아가기</button>
              <button type="button" onClick={send} style={{ ...btn, flex: 1, background: K.gold, color: "#111", border: `1px solid ${K.gold}` }}>주문 보내기</button>
            </div>
          </div>
        </div>)}
    </div>);
}
