/**
 * 증권사 계좌 카드 — 내 종목 탭 아래에 붙는 화면
 * ════════════════════════════════════════════════════════════
 * /api/broker 를 불러 연결된 증권사 계좌(기본 메리츠 · Vercel 환경변수 BROKER 로 바꿈)의 잔고·주문을 보여줍니다.
 * 증권사 이름표·주문 스위치 이름은 서버가 알려 주는 대로 바뀝니다 (화면은 증권사를 몰라도 됨).
 *  · 계좌 보유는 앱의 "내 종목"과 따로 표시하고, 내 종목 맨 위 '체결 반영'에서 한 번 눌러야 내 종목에 들어갑니다.
 *    투입금·빈 칸·텔레그램 합계에 섞이지 않고, 앱의 내 종목도 바꾸지 않습니다.
 *  · 🇺🇸 미국 · 🇰🇷 한국을 위쪽 전환 단추로 바꿉니다 (한국: 원화 · 호가 단위 · 코스피/코스닥 급락 보류).
 *    한국 투자금이 0원이면 실전은 제안하지 않고, 모의 계좌에서만 "시험용"으로 한국 추천을 보여 줍니다.
 *  · 비밀번호가 저장돼 있으면 열 때 자동으로 불러옵니다(143).
 *  · 주문·취소는 모의투자(demo)에서 열립니다. 실전은 서버에 KIS_REAL_ORDER=on 이 있을 때만 (없으면 조회만).
 *  · "오늘 매수 제안": 전날 종가로 뽑힌 오늘 살 것을 지금 가격과 견줘, 살 만하면 수량·지정가를 채워 묻습니다.
 *    시장 급락 · 종목 급락 · 손절선 아래 · 이미 많이 오름이면 제안을 보류합니다 (아래 GUARD 숫자 · 미검증 안전장치).
 *  · (한투일 때만) 한투 관심 그룹 → 앱 관심종목은 읽어 와서 추가만 합니다 (반대 방향은 한투가 지원하지 않음).
 *
 * ▣ 증권사 바꾸는 법: api/broker.js 맨 위 설명 (BROKER 환경변수 하나)
 * ▣ 카드 자체를 빼는 법: App.jsx 의 "★ 한투" 두 곳 + 이 파일 + api/broker.js · api/_lib/
 *
 * props: held = 앱 내 종목 티커(비교용·읽기만) · stocks = 앱 종목 지표 · picks = 오늘 살 것(빠른 선택)
 *        watch / toggleWatch = 앱 관심종목 (관심 불러오기에서만 씀)
 *        asOf = 오늘 살 것의 기준 날짜({us, kr} 또는 문자열) · half = 앱 1회차 금액 {us, kr} · usOpen = 미국 정규장 여부 · fx = 원/달러
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { openOrder } from "./order.js";      // 210. 주문은 모두 같은 주문 창(src/OrderSheet.jsx)으로

const K = { panel: "#0F1420", panel2: "#161B2E", border: "rgba(255,255,255,.09)", text: "#E5E7EB", dim: "#9CA3AF", gold: "#F59E0B", up: "#30D158", down: "#FF453A", cyan: "#06B6D4" };
const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";
const TOK = "v7.kis.tok", PIN = "v7.kis.pin", BUD = "v7.kis.budget", BUD_KR = "v7.kis.budget.kr", MK = "v7.kis.mk";
/* 매수 제안 안전장치 (미검증 · 숫자는 여기서만 바꿉니다) */
const GUARD = { mktDown: -2, mktUp: 2,     // 나스닥100(QQQ)·S&P500(SPY) 중 나쁜 쪽이 −2% 이하면 전부 보류 · +2% 이상이면 주의만
                stDown: -5, stUp: 4,       // 종목이 기준 종가보다 −5% 이하 = 급락 보류 · +4% 이상 = 추격 보류
                slip: 0.5,                 // 지정가 = 지금 가격 + 0.5% (바로 체결되되 그 이상은 안 삼)
                fresh: 120 };              // 가격을 본 지 120초가 넘으면 다시 보게 함
const EXN = { NASD: "나스닥", NYSE: "뉴욕", AMEX: "아멕스", KRX: "한국거래소" };
const won = (v) => `${Math.round(Number(v) || 0).toLocaleString("ko-KR")}원`;
/** 🇰🇷 호가 단위 (2023-01 이후 코스피·코스닥 공통) — 서버(api/_lib/*.js)와 같은 표 */
const tickKr = (p) => p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000;
const upTick = (v) => { const t = tickKr(v); return Math.ceil(v / t) * t; };
const IDX = { us: [["QQQ", "나스닥100"], ["SPY", "S&P500"]], kr: [["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]] };
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

export default function KisPanel({ held = [], stocks = {}, picks: picksUs = [], watch = [], toggleWatch, asOf: asOfIn = "", half = null, usOpen = false, fx = null, pickNote: noteUs = "", kr = null, krOpen = false, onSync = null }) {
  const [mk, setMkRaw] = useState(() => (ls.get(MK) === "kr" ? "kr" : "us"));   // 🇺🇸 / 🇰🇷 전환
  const KR = mk === "kr";
  const asOf = (asOfIn && typeof asOfIn === "object" ? asOfIn[mk] : asOfIn) || "";   // 시장마다 종가 날짜가 다름 (🇺🇸 은 하루 늦음)
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
  const [live, setLive] = useState(null);             // 지금 가격 { quotes, idx, at }
  const [budgetUs, setBudgetUs] = useState(() => ls.get(BUD) || "");
  const [budgetKr, setBudgetKr] = useState(() => ls.get(BUD_KR) || "");
  const budgetRaw = KR ? budgetKr : budgetUs;
  const setBudget = (v) => { if (KR) { setBudgetKr(v); ls.set(BUD_KR, v); } else { setBudgetUs(v); ls.set(BUD, v); } };
  const [dayBuy, setDayBuy] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 20000); return () => clearInterval(id); }, []);   // "가격 본 지 ○초" 갱신

  useEffect(() => {
    let live = true;
    fetch("/api/broker").then((r) => r.json()).then((j) => { if (live) setInfo(j && j.ok ? j : { configured: false, off: true }); })
      .catch(() => { if (live) setInfo({ configured: false, off: true }); });
    return () => { live = false; };
  }, []);

  /** 서버 호출 한 번 — 토큰 꾸러미는 항상 갱신해서 보관 */
  const tokKey = `${TOK}.${info?.broker || "x"}`;            // 증권사마다 접속 토큰을 따로 보관
  const call = useCallback(async (body) => {
    const r = await fetch("/api/broker", { method: "POST", headers: { "Content-Type": "application/json", "x-kis-pin": pin || "" }, body: JSON.stringify({ ...body, ...(mk === "kr" ? { mk: "kr" } : {}), tok: ls.get(tokKey) }) });
    const j = await r.json();
    if (j.tok) ls.set(tokKey, j.tok);
    if (j.code === "pin") { setNeedPin(true); ls.set(PIN, ""); }
    else if (j.ok) { setNeedPin(false); ls.set(PIN, pin); }
    return j;
  }, [pin, mk, tokKey]);

  const run = useCallback(async (key, fn) => {
    setBusy(key); setMsg(""); setOk("");
    try { await fn(); } catch { setMsg("연결하지 못했습니다 — 잠시 뒤 다시 눌러 주세요"); }
    setBusy("");
  }, []);

  const loadAll = () => run("load", async () => {
    const j = await call({ what: "balance" });
    if (!j.ok) return setMsg(j.msg || "불러오지 못했습니다");
    setData(j);
    await new Promise((r) => setTimeout(r, 700));      // 모의 호출 간격(초당 제한)을 위해 잠깐 쉬고 주문 내역
    const o = await call({ what: "orders" });
    if (o.ok) { setOrders(o.orders); setDayBuy(o.dayBuy || 0); } else setMsg(o.msg || "주문 내역을 불러오지 못했습니다");
    if (info?.canOrder && picks.length > 0) { await new Promise((r) => setTimeout(r, 700)); await loadQuotes(); }
  });
  const loadQuotes = async () => {
    const j = await call({ what: "quote", idx: true, list: picks.slice(0, 8).map((p) => ({ t: p.t, ex: KR ? "KRX" : EX[stocks[p.t]?.ex] || "" })) });
    if (j.ok) setLive({ quotes: j.quotes || {}, idx: j.idx || {}, at: Date.now() }); else setMsg(j.msg || "지금 가격을 불러오지 못했습니다");
  };
  const reloadOrders = async () => { const o = await call({ what: "orders" }); if (o.ok) { setOrders(o.orders); setDayBuy(o.dayBuy || 0); } else setMsg(o.msg || ""); };

  const pick = (t, side, extra = {}) => {                // 종목 채우기: 지금 가격·거래소 자동
    const s = stocks[t];
    setForm((f) => ({ ...f, side, t, ex: KR ? "KRX" : extra.ex || EX[s?.ex] || (f.ex === "KRX" ? "NASD" : f.ex),
                      px: extra.px != null ? String(extra.px) : s?.c != null ? String(KR ? Math.round(s.c) : Math.round(s.c * 100) / 100) : f.px,
                      qty: extra.qty != null ? String(extra.qty) : f.qty }));
    setOk(""); setMsg("");
  };
  const amount = (Number(form.qty) || 0) * (Number(form.px) || 0);
  const M = (v, d = 0) => (KR ? won(v) : usd(v, d));                // 금액 표시: 🇰🇷 원 · 🇺🇸 달러
  const cap1 = KR ? (info?.maxKrw || 5000000) : (info?.maxUsd || 5000), capDay = KR ? (info?.maxDayKrw || 20000000) : (info?.maxDay || 20000);
  // 종목당 예산: 직접 넣은 값이 없으면 앱 1회차 금액(💰 투자금 ÷ 칸 ÷ 2) — 1건 상한을 넘지 않게
  const halfM = Math.floor(Number(half?.[mk]) || 0);
  const budgetAuto = halfM > 0 ? Math.min(halfM, cap1) : 0;
  const budget = budgetRaw || (budgetAuto ? String(budgetAuto) : "");
  const formErr = !(KR ? /^[0-9A-Z]{6}$/ : /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/).test(form.t.trim()) ? (KR ? "종목 코드 6자리를 넣어 주세요" : "종목 코드를 넣어 주세요")
    : !(Number(form.qty) >= 1) ? "수량은 1주 이상" : !(Number(form.px) > 0) ? "지정가를 넣어 주세요"
    : KR && Number(form.px) % tickKr(Number(form.px)) !== 0 ? `호가 단위 ${tickKr(Number(form.px)).toLocaleString("ko-KR")}원에 맞춰 주세요`
    : amount > cap1 ? `1건 상한 ${M(cap1)} 초과` : "";
  const openConfirm = () => { if (!formErr) setConfirm({ ...form, ex: KR ? "KRX" : form.ex, t: form.t.trim().toUpperCase(), qty: Math.floor(Number(form.qty)), px: KR ? Math.round(Number(form.px)) : Math.round(Number(form.px) * 100) / 100, rid: rid() }); };
  const send = () => run("order", async () => {
    const c = confirm; setConfirm(null);
    const j = await call({ what: "order", side: c.side, t: c.t, ex: c.ex, qty: c.qty, px: c.px, rid: c.rid, confirm: true, ...(c.warnOk ? { warnOk: true } : {}) });
    if (!j.ok && j.code === "warn" && j.warn && !c.warnOk)       // 증권사 경고(예: 미국 PTP 과세 확인) — 내용을 보여 주고 한 번 더 확인받아 다시 보냄
      return setConfirm({ ...c, rid: rid(), warnOk: true, note: `${BK} 경고: ${j.warn} — 읽고 괜찮으면 다시 보내 주세요` });
    if (!j.ok) { if (j.code === "unsure") { await new Promise((r) => setTimeout(r, 900)); await reloadOrders(); } return setMsg(j.msg || "주문이 거절되었습니다"); }
    setOk(`${BK} ${demo ? "모의" : "실전"} ${c.side === "buy" ? "매수" : "매도"} 주문을 보냈습니다 — ${c.t} ${c.qty}주 × ${M(c.px, 2)}${j.placed?.odno ? ` · 주문번호 ${j.placed.odno}` : ""} (체결은 주문 내역에서 확인)`);
    await new Promise((r) => setTimeout(r, 700)); await reloadOrders();
  });
  const cancel = (o) => run("cancel:" + o.odno, async () => {
    const j = await call({ what: "cancel", odno: o.odno, brno: o.brno, dt: o.dt, ocls: o.ocls, t: o.t, ex: o.ex, qty: o.open || o.qty });
    if (!j.ok) return setMsg(j.msg || "취소하지 못했습니다");
    setOk(`${o.t} 주문 ${o.odno} 취소를 보냈습니다`);
    await new Promise((r) => setTimeout(r, 700)); await reloadOrders();
  });
  const loadGroups = () => run("groups", async () => { setFav(null); const j = await call({ what: "groups" }); if (j.ok) setGroups(j.groups); else setMsg(j.msg || ""); });
  const loadGroup = (g) => run("group", async () => { const j = await call({ what: "group", code: g.code }); if (j.ok) setFav({ g, stocks: j.stocks }); else setMsg(j.msg || ""); });

  const mine = useMemo(() => new Set(held.filter((t) => isUs(t) !== KR)), [held, KR]);
  /* 143. 비밀번호가 저장돼 있으면 열 때 · 시장을 바꿀 때 자동으로 불러옴 (토큰은 하루 한 번만 새로 받으니 알림톡도 하루 한 번) */
  // 184. 잔고·주문을 받을 때마다 앱(내 종목 '체결 반영')에 알려 줌 — 주문을 보내거나 취소한 뒤에도
  useEffect(() => { if (onSync && (data || orders)) onSync({ mk, broker: info?.broker || "kis", label: BK, env: data?.env || info?.env || "demo", rows: data?.rows || [], orders: orders || [], at: Date.now() }); },
    [data, orders]);                                     // eslint-disable-line react-hooks/exhaustive-deps
  // 184. 내 종목 카드의 '한투로 매도/2회차' → 주문 칸을 채우고 그 자리로 이동
  // 189. 매도!(open) — 다음 개장 때 팔리도록 기준 종가보다 2.5% 낮은 지정가 (서버 거절선 3% 안쪽). 지정가가 시장 가격보다 낮으면 개장 가격으로 체결됩니다
  const prefillNow = (d) => {
    const s = stocks[d.t]; const extra = d.qty != null ? { qty: d.qty } : {};
    if (d.open && d.side === "sell" && s?.c > 0) {
      const raw = s.c * 0.975;
      extra.px = KR ? Math.max(tickKr(raw), Math.ceil(raw / tickKr(raw)) * tickKr(raw)) : Math.ceil(raw * 100) / 100;
    }
    pick(d.t, d.side || "buy", extra);
    if (d.open && d.side === "sell") setOk(`개장 매도: 기준 종가 ${KR ? won(s?.c) : usd(s?.c, 2)}보다 2.5% 낮은 지정가로 채웠습니다. 시장 가격이 이보다 높으면 개장 가격에 팔립니다(갭 하락이 2.5%보다 크면 대기로 남음). ${KR ? "장 시작 전(08:30~)에 넣어 두면 09:00 시가에 체결됩니다." : `미국은 ${BK} 주문 가능 시간에 넣어 주세요 — 장이 닫혀 있으면 ${BK}가 거절할 수 있습니다.`}`);
  };
  const pending = useRef(null);
  useEffect(() => {
    const on = (e) => { const d = e.detail || {}; if (!d.t) return;
      if ((d.mk || "us") !== mk) { pending.current = d; setMk(d.mk || "us"); return; }
      prefillNow(d);
      setTimeout(() => document.getElementById("kis-order")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); };
    window.addEventListener("kis-prefill", on); return () => window.removeEventListener("kis-prefill", on);
  });
  useEffect(() => { const d = pending.current; if (d && d.mk === mk) { pending.current = null; prefillNow(d);
    setTimeout(() => document.getElementById("kis-order")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); } }, [mk]);   // eslint-disable-line react-hooks/exhaustive-deps
  // 차트 화면의 '계좌로 1회차 주문' → 이 카드가 뜬 뒤 주문 칸을 채움 (카드가 없을 때 눌러도 놓치지 않게)
  // 주문 창에서 주문을 보내면 주문 내역을 다시 불러옴
  useEffect(() => { const f = () => { if (data || orders) setTimeout(() => reloadOrders(), 900); };
    window.addEventListener("broker-changed", f); return () => window.removeEventListener("broker-changed", f); });
  const autoKey = useRef("");
  useEffect(() => {
    if (!info?.configured || info.pinMissing || !pin || needPin || busy) return;
    if (autoKey.current === mk) return;
    autoKey.current = mk; loadAll();
  }, [info, mk]);                                        // eslint-disable-line react-hooks/exhaustive-deps
  const setMk = (m) => { if (m === mk || busy) return; setMkRaw(m); ls.set(MK, m); setData(null); setOrders(null); setLive(null); setDayBuy(0); setConfirm(null); setMsg(""); setOk("");
    setForm({ side: "buy", t: "", ex: m === "kr" ? "KRX" : "NASD", qty: "1", px: "" }); };
  const krSrc = kr ? (kr.list.length === 0 && kr.test && (data?.env || info?.env) !== "real" ? kr.test : kr) : { list: [], note: "" };
  const picks = KR ? krSrc.list : picksUs, pickNote = KR ? krSrc.note : noteUs;
  const demo = (data?.env || info?.env) !== "real";
  const BK = info?.label || "증권사";                        // 연결된 증권사 이름 (메리츠 · 한투 …)
  const MERITZ = info?.broker === "meritz";
  const box = { marginTop: 14, padding: "12px 14px", borderRadius: 12, background: K.panel, border: `1px solid ${K.border}`, color: K.text, fontSize: 13 };

  if (!info) return null;
  const head = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <b style={{ fontSize: 14 }}>🏦 {BK} 계좌</b>
      <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 99, border: `1px solid ${demo ? K.dim : K.gold}`, color: demo ? K.dim : K.gold }}>{demo ? "모의투자" : "실전"}</span>
      <span style={{ fontSize: 11, color: K.dim }}>{info.canOrder ? (demo ? "조회 + 모의 주문" : "조회 + 실전 주문") : "조회 전용"}</span>
      {info.configured && !info.pinMissing && <span role="tablist" aria-label="시장" style={{ display: "inline-flex", gap: 4, marginLeft: "auto" }}>
        {[["us", "🇺🇸 미국"], ["kr", "🇰🇷 한국"]].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={mk === k} onClick={() => setMk(k)} disabled={!!busy}
            style={{ ...quiet, minHeight: 32, padding: "2px 10px", fontSize: 12, color: mk === k ? K.text : K.dim, borderColor: mk === k ? K.gold : K.border, fontWeight: mk === k ? 700 : 500 }}>{l}</button>))}
      </span>}
    </div>);
  if (!info.configured || info.pinMissing) return (
    <div style={box}>{head}
      <div style={{ color: K.dim, marginTop: 6, lineHeight: 1.6 }}>
        {info.off ? "서버 연결 함수(/api/broker)를 찾지 못했습니다."
          : info.msg && !info.broker ? info.msg
          : !info.configured ? <>아직 연결 전입니다. Vercel → Settings → Environment Variables 에 <span style={{ fontFamily: MONO, color: K.text }}>{MERITZ ? "MERITZ_APP_KEY · MERITZ_APP_SECRET · APP_PIN" : "KIS_DEMO_APP_KEY · KIS_DEMO_APP_SECRET · KIS_DEMO_ACCOUNT · KIS_ENV · APP_PIN"}</span> 을 넣고 다시 배포하면 여기서 조회됩니다.</>
          : "Vercel 환경변수 APP_PIN(내가 정하는 비밀번호)을 넣어야 열립니다."}
      </div>
    </div>);

  // 계좌에 있는 종목 = 보유 중 → 내 종목 카드와 같은 말(매도! / 보유). '매수!'는 새로 살 때 말이라 여기선 쓰지 않음
  const sigOf = (r) => { const s = stocks[r.t]; if (!s) return null; const [txt, c] = s.action === "sell" ? SIG.sell : SIG.hold;
    return { txt, c, line: s.stLine, below: s.stLine && r.px && r.px < s.stLine }; };

  /* ── 매수 제안 계산 ── */
  const openFn = KR ? krOpen : usOpen;
  const usOpenNow = typeof openFn === "function" ? !!openFn() : !!openFn;
  const stale = !live || Date.now() - live.at > GUARD.fresh * 1000;
  const idxR = live ? IDX[mk].map(([k]) => live.idx[k]?.rate).filter((v) => typeof v === "number") : [];
  const mkt = { unknown: !!live && idxR.length === 0, halt: idxR.length > 0 && Math.min(...idxR) <= GUARD.mktDown, hot: idxR.length > 0 && Math.max(...idxR) >= GUARD.mktUp };
  const oldData = !!asOf && (Date.now() + 9 * 3600000 - Date.parse(asOf + "T00:00:00Z")) / 86400000 > 6;   // 금요일 종가 → 월요일 휴장 → 화요일 장(수요일 새벽)까지는 정상
  const have = new Set((data?.rows || []).map((r) => r.t));
  const waiting = new Set((orders || []).filter((o) => o.side === "buy" && o.open > 0 && !o.orgn).map((o) => o.t));
  const props = !live ? [] : picks.slice(0, 8).map((p) => {
    const q = live.quotes[p.t] || null, base = p.c || stocks[p.t]?.c || q?.base || 0, line = p.stLine || stocks[p.t]?.stLine || 0;
    const ch = q && base > 0 ? (q.last / base - 1) * 100 : 0;
    const px = q ? (KR ? upTick(q.last * (1 + GUARD.slip / 100)) : Math.round(q.last * (1 + GUARD.slip / 100) * 100) / 100) : 0;
    const cap = Math.min(Number(budget) || 0, cap1, Math.max(0, capDay - dayBuy));
    const qty = px > 0 ? Math.floor(cap / px) : 0;
    const no = (why, tone = "warn") => ({ t: p.t, n: p.n || stocks[p.t]?.n || "", q, base, line, ch, px, qty, ok: false, why, tone });
    if (!q) return no("지금 가격을 확인하지 못했습니다");
    if (have.has(p.t)) return no("이미 이 계좌에 있습니다", "info");
    if (waiting.has(p.t)) return no("매수 주문이 대기 중입니다", "info");
    if (oldData) return no(`추천 데이터가 ${asOf.slice(5).replace("-", "/")} 것이라 오래됐습니다 — 갱신 뒤에 제안합니다`, "bad");
    if (!usOpenNow) return no(KR ? "한국 정규장(09:00~15:30)이 열리면 살 수 있습니다" : "미국 정규장이 열리면 살 수 있습니다", "info");
    if (stale) return no("가격을 다시 본 뒤 살 수 있습니다");
    if (mkt.unknown) return no("시장 상태 확인 안 됨 — 보류");
    if (mkt.halt) return no("시장 급락 중 — 보류", "bad");
    if (line > 0 && q.last <= line) return no(`손절선 ${M(line, 2)} 아래 — 신호가 깨졌습니다`, "bad");
    if (ch <= GUARD.stDown) return no(`기준 종가보다 ${pct(ch)} — 급락 중이라 보류`, "bad");
    if (ch >= GUARD.stUp) return no(`기준 종가보다 ${pct(ch)} — 이미 많이 올라 추격 보류`);
    if (qty < 1) return no(capDay - dayBuy < px ? "하루 매수 상한에 닿았습니다" : `예산이 1주 값(${M(px, 2)})보다 적습니다`);
    return { t: p.t, n: p.n || stocks[p.t]?.n || "", q, base, line, ch, px, qty, ok: true };
  });
  const sellNow = (data?.rows || []).filter((r) => { const s = stocks[r.t]; return s && (s.action === "sell" || (s.stLine && r.px && r.px < s.stLine)); });

  return (
    <div style={box}>
      {head}
      {/* 217. 시장 급락 — 크게 · 맨 위 */}
      {live && mkt.halt && (
        <div role="alert" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(255,69,58,.14)", border: `2px solid ${K.down}` }}>
          <b style={{ color: K.down, fontSize: 15 }}>⚠ 시장 급락 중 — 매수 보류</b>
          <div style={{ marginTop: 3 }}>{IDX[mk].map(([k, l]) => `${l} ${live.idx[k] ? pct(live.idx[k].rate) : "—"}`).join(" · ")} (기준 {GUARD.mktDown}%)</div>
          <div style={{ color: K.dim, fontSize: 11.5, marginTop: 2 }}>매수 제안은 잠겼습니다. 그래도 사려면 주문 창에서 빨간 확인을 거쳐야 합니다 · 매도는 그대로</div>
        </div>)}
      {/* 218. 오래 체결 안 된 주문 — 잊지 않게 맨 위로 */}
      {(() => {
        const ageMin = (o) => { const d = String(o.dt || "").replace(/\D/g, ""), t = String(o.tm || "").replace(/\D/g, "").padEnd(6, "0");
          if (d.length !== 8) return null; const ms = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2) - 9, +t.slice(2, 4)); return (Date.now() - ms) / 60000; };
        const old = (orders || []).filter((o) => o.open > 0 && !o.orgn).map((o) => ({ o, a: ageMin(o) })).filter((x) => x.a != null && x.a >= 30);
        return old.length ? (
          <div role="alert" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "rgba(245,158,11,.10)", border: `1px solid ${K.gold}` }}>
            <b style={{ color: K.gold }}>체결 안 된 주문 {old.length}건 — 30분 넘게 대기 중</b>
            {old.map(({ o, a }) => (
              <div key={o.odno} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                <span style={{ fontFamily: MONO }}>{o.side === "buy" ? "매수" : "매도"} {KR ? (o.n || o.t) : o.t} {o.open}주 @ {M(o.px, 2)} · {Math.round(a)}분째</span>
                <button type="button" onClick={() => cancel(o)} disabled={!!busy} style={{ ...quiet, minHeight: 32, padding: "2px 10px", fontSize: 12 }}>취소</button>
                <button type="button" onClick={() => openOrder({ t: o.t, side: o.side, qty: o.open, m: mk })} style={{ ...quiet, minHeight: 32, padding: "2px 10px", fontSize: 12 }}>새 가격으로 다시</button>
              </div>))}
            <div style={{ color: K.dim, fontSize: 11.5, marginTop: 4 }}>지정가에 안 닿은 주문입니다. 그대로 두면 장이 끝날 때 사라집니다 · '새 가격으로 다시'는 이 주문을 먼저 취소한 뒤 쓰세요</div>
          </div>) : null; })()}
      <div style={{ marginTop: 6, color: K.dim, fontSize: 11.5, lineHeight: 1.5 }}>
        {BK}에서 체결된 거래는 <b style={{ color: K.text }}>내 종목 맨 위 '체결 반영'</b>에서 한 번 눌러 넣습니다{demo ? "(모의는 '모의' 표시)" : ""}. 누르기 전에는 투입금·빈 칸·텔레그램 합계에 섞이지 않습니다.
      </div>
      {(needPin || !pin) && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="앱 비밀번호 (APP_PIN)" autoComplete="off" aria-label="계좌 조회 비밀번호" style={{ ...inp, flex: "1 1 160px" }} />
        </div>)}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={loadAll} disabled={!!busy} style={{ ...btn, opacity: busy ? .6 : 1 }}>{busy === "load" ? "불러오는 중…" : data ? "다시 불러오기" : "잔고·주문내역 불러오기"}</button>
        {data && <span style={{ color: K.dim, fontSize: 12 }}>{new Date(data.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 기준</span>}
      </div>
      {msg && <div role="alert" style={{ color: K.down, marginTop: 8, lineHeight: 1.5 }}>⚠ {msg}</div>}
      {ok && <div role="status" style={{ color: K.up, marginTop: 8, lineHeight: 1.5 }}>✓ {ok}</div>}

      {data && (data.rows.length === 0
        ? <div style={{ color: K.dim, marginTop: 10 }}>보유한 {KR ? "한국" : "미국"} 주식이 없습니다{demo ? " (모의 계좌는 모의로 산 종목만 보입니다)" : ""}.</div>
        : <>
          <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 13 }}>
            {demo ? "모의 보유" : `${BK} 보유`} {data.sum.n}종목 · 매입 {M(data.sum.cost)} → 평가 {M(data.sum.val)} <b style={{ color: col(data.sum.pl) }}>{pct(data.sum.plPct)}</b>
          </div>
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
              <thead><tr style={{ color: K.dim }}>{["종목", `${BK} 시세`, "수익", "앱 신호", ""].map((h, i) => (
                <th key={i} style={{ padding: "5px 4px", borderBottom: `1px solid ${K.border}`, textAlign: i && i < 4 ? "right" : "left", fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>))}</tr></thead>
              <tbody>{data.rows.map((r) => { const td = { padding: "6px 4px", borderBottom: `1px solid ${K.border}`, textAlign: "right", fontFamily: MONO, whiteSpace: "nowrap", verticalAlign: "top" }; const sg = sigOf(r);
                return (<tr key={r.t + r.ex}>
                  <td style={{ ...td, textAlign: "left", whiteSpace: "normal" }}><b>{KR ? (r.n || stocks[r.t]?.n || r.t) : r.t}</b>
                    <div style={{ color: K.dim, fontFamily: "inherit", fontSize: 11 }}>{r.qty}주 · 평단 {M(r.avg, 2)}</div>
                    {mine.has(r.t) && <div style={{ color: K.gold, fontFamily: "inherit", fontSize: 11 }}>내 종목에도 있음</div>}</td>
                  <td style={td}>{M(r.px, 2)}</td>
                  <td style={{ ...td, color: col(r.pl) }}>{pct(r.plPct)}</td>
                  <td style={{ ...td, fontFamily: "inherit" }}>{sg ? <span style={{ color: sg.c, fontWeight: 700 }}>{sg.txt}</span> : <span style={{ color: K.dim }}>—</span>}
                    {sg?.below && <div style={{ color: K.down, fontSize: 11 }}>선 {M(sg.line, 0)} 아래</div>}</td>
                  <td style={{ ...td, textAlign: "left" }}>{info.canOrder && <button type="button" onClick={() => openOrder({ t: r.t, side: "sell", qty: r.ord || r.qty, held: r.ord || r.qty, m: mk })} style={{ ...quiet, minHeight: 32, padding: "2px 10px", fontSize: 12 }}>매도</button>}</td>
                </tr>); })}
              </tbody>
            </table>
          </div>
        </>)}

      {sellNow.length > 0 && (
        <div role="alert" style={{ marginTop: 10, padding: "8px 10px", borderRadius: 10, border: `1px solid ${K.down}`, color: K.text, lineHeight: 1.5 }}>
          <b style={{ color: K.down }}>매도 신호</b> <span style={{ fontFamily: MONO }}>{sellNow.map((r) => r.t).join(" · ")}</span>
          <div style={{ color: K.dim, fontSize: 11.5 }}>앱 규칙은 종가가 손절선 아래로 마감하면 매도입니다. 위 표의 "매도"를 누르면 주문 칸에 채워집니다.</div>
        </div>)}

      {info.canOrder && data && picks.length === 0 && pickNote && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${K.border}` }}>
          <b style={{ fontSize: 13 }}>오늘 매수 제안</b>
          <div style={{ color: K.gold, fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>{pickNote} — 오늘 탭과 같은 기준입니다. 그래도 넣으려면 아래 주문 칸을 쓰세요.</div>
        </div>)}

      {info.canOrder && data && picks.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${K.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <b style={{ fontSize: 13 }}>오늘 매수 제안</b>
            <span style={{ color: K.dim, fontSize: 11.5 }}>{asOf ? `${asOf.slice(5).replace("-", "/")} 종가로 뽑음` : "전날 종가로 뽑음"} · 오늘 탭과 같은 목록 · 지정가 = 지금 가격 +{GUARD.slip}%{KR ? " (호가 단위로 올림)" : ""}</span>
            <button type="button" onClick={() => run("quote", loadQuotes)} disabled={!!busy} style={{ ...quiet, minHeight: 30, padding: "2px 10px", fontSize: 12 }}>{busy === "quote" ? "보는 중…" : "가격 다시 보기"}</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap", fontSize: 12 }}>
            <label htmlFor="kis-budget" style={{ color: K.dim }}>종목당 예산 {KR ? "원" : "$"}{!budgetRaw && budgetAuto ? " (비우면 앱 1회차 금액)" : ""}</label>
            <input id="kis-budget" value={budgetRaw} placeholder={budgetAuto ? String(budgetAuto) : ""} inputMode="numeric" onChange={(e) => setBudget(e.target.value.replace(/\D/g, "").slice(0, KR ? 10 : 6))} style={{ ...inp, width: KR ? 120 : 96, minHeight: 34 }} />
            {!KR && fx && Number(budget) > 0 && <span style={{ color: K.dim }}>≈ {Math.round(Number(budget) * fx / 10000).toLocaleString("ko-KR")}만 원</span>}
            {KR && Number(budget) > 0 && <span style={{ color: K.dim }}>= {(Number(budget) / 10000).toLocaleString("ko-KR")}만 원</span>}
            <span style={{ color: K.dim }}>· 오늘 매수 {M(dayBuy)} / 하루 상한 {M(capDay)}</span>
          </div>
          {pickNote && <div style={{ color: K.dim, fontSize: 11.5, marginTop: 6 }}>{pickNote}</div>}
          {!live ? <div style={{ color: K.dim, marginTop: 8 }}>"가격 다시 보기"를 누르면 지금 가격으로 제안을 만듭니다.</div> : (<>
            <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5, color: mkt.halt ? K.down : mkt.hot ? K.gold : K.dim }}>
              시장 지금 {IDX[mk].map(([k, l]) => `${l} ${live.idx[k] ? pct(live.idx[k].rate) : "확인 안 됨"}`).join(" · ")}
              {mkt.halt ? ` — 급락 중이라 매수 제안을 모두 보류합니다 (기준 ${GUARD.mktDown}%)` : mkt.hot ? " — 급등 중입니다. 체결가가 높게 잡힐 수 있으니 주의" : mkt.unknown ? " — 시장 상태를 확인하지 못해 제안을 보류합니다" : ""}
              {" · "}{stale ? <b style={{ color: K.gold }}>가격을 본 지 {Math.round((Date.now() - live.at) / 60000)}분 — 다시 보기를 눌러 주세요</b> : "방금 가격"}
            </div>
            {props.map((x) => (
              <div key={x.t} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${K.border}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>{KR ? <><b>{x.n || x.t}</b> <span style={{ color: K.dim, fontSize: 12, fontFamily: MONO }}>{x.t}</span></> : <><b style={{ fontFamily: MONO }}>{x.t}</b> <span style={{ color: K.dim, fontSize: 12 }}>{x.n}</span></>}</div>
                  <div style={{ fontFamily: MONO, fontSize: 12, color: K.dim, lineHeight: 1.5 }}>
                    {x.q ? <>기준 {M(x.base, 2)} → 지금 <span style={{ color: K.text }}>{M(x.q.last, 2)}</span> <span style={{ color: col(x.ch) }}>{pct(x.ch)}</span>{x.line ? <> · 손절선 {M(x.line, 2)}</> : null}</> : "지금 가격 확인 안 됨"}
                  </div>
                  <div style={{ fontSize: 12, color: x.ok ? K.text : x.tone === "bad" ? K.down : K.gold, lineHeight: 1.5 }}>
                    {x.ok ? <span style={{ fontFamily: MONO }}>{x.qty}주 × {M(x.px, 2)} = {M(x.qty * x.px, 2)}{!KR && fx ? ` (약 ${Math.round(x.qty * x.px * fx / 10000).toLocaleString("ko-KR")}만 원)` : ""}</span> : x.why}
                  </div>
                </div>
                <button type="button" disabled={!x.ok || !!busy} aria-label={`${x.t} 사기`} onClick={() => openOrder({ t: x.t, side: "buy", qty: x.qty, px: x.px, m: mk })}
                  style={{ ...btn, opacity: x.ok && !busy ? 1 : .4, minWidth: 64 }}>사기</button>
              </div>))}
            <div style={{ color: K.dim, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
              보류 기준(미검증 안전장치): 시장 {GUARD.mktDown}% 이하 · 종목 {GUARD.stDown}% 이하 · 손절선 아래 · 종목 +{GUARD.stUp}% 이상(추격). 보류된 종목도 아래 주문 칸에서 직접 넣을 수는 있습니다.
              {" "}{BK} 시세가 늦게 올 수 있어, 지정가에 안 닿으면 대기로 남고 장이 끝나면 사라집니다.
            </div>
          </>)}
        </div>)}

      {info.canOrder && (
        <details id="kis-order" style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${K.border}` }}>
          <summary style={{ cursor: "pointer", minHeight: 32, display: "flex", alignItems: "center", gap: 8 }}>
            <b style={{ fontSize: 13 }}>직접 주문</b><span style={{ color: K.dim, fontSize: 11.5 }}>목록에 없는 종목 · 1건 상한 {M(cap1)} · 하루 매수 상한 {M(capDay)} ▾</span></summary>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 8, marginTop: 8 }}>
            <input value={form.t} onChange={(e) => setForm({ ...form, t: e.target.value.toUpperCase().replace(KR ? /[^A-Z0-9]/g : /[^A-Z0-9.\-]/g, "").slice(0, KR ? 6 : 10) })}
              placeholder={KR ? "종목 (예: 005930)" : "종목 (예: AMD)"} aria-label="주문 종목" style={inp} />
            {["buy", "sell"].map((sd) => (
              <button key={sd} type="button" disabled={!(KR ? /^[0-9A-Z]{6}$/ : /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/).test(form.t.trim())}
                onClick={() => { const r = (data?.rows || []).find((x) => x.t === form.t.trim()); openOrder({ t: form.t.trim(), side: sd, m: mk, ...(sd === "sell" && r ? { qty: r.ord || r.qty, held: r.ord || r.qty } : {}) }); }}
                style={{ ...btn, borderColor: sd === "buy" ? K.up : K.down, color: sd === "buy" ? K.up : K.down }}>{sd === "buy" ? "사기" : "팔기"}</button>))}
          </div>
          <div style={{ color: K.dim, fontSize: 11.5, marginTop: 6 }}>주문 창에서 지금 가격을 받아 수량·지정가를 정하고, 오늘 매수 제안과 같은 검사를 거친 뒤 보냅니다.</div>
        </details>)}

      {orders && (
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
                    <td style={{ ...td, fontFamily: MONO }}><b>{KR ? (o.n || o.t) : o.t}</b> {o.qty}주 × {M(o.px, 2)}</td>
                    <td style={{ ...td, color: K.dim }}>{o.filled > 0 ? `체결 ${o.filled}${o.open > 0 ? ` · 대기 ${o.open}` : ""}` : o.open > 0 ? `대기 ${o.open}` : ""} {o.kind && o.kind !== "보통" ? o.kind : o.state}{o.why ? ` · ${o.why}` : ""}</td>
                    <td style={td}>{info.canOrder && o.open > 0 && !o.orgn && <button type="button" onClick={() => cancel(o)} disabled={!!busy} style={{ ...quiet, minHeight: 30, padding: "2px 10px", fontSize: 12 }}>취소</button>}</td>
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

      {data && mine.size > 0 && (() => { const acct = new Set(data.rows.map((r) => r.t)); const only = [...mine].filter((t) => !acct.has(t));
        return only.length > 0 ? <div style={{ marginTop: 10, color: K.dim, fontSize: 11.5, lineHeight: 1.6 }}>앱 내 종목에만 있음: <span style={{ color: K.text, fontFamily: MONO }}>{only.join(" · ")}</span> — {MERITZ ? "메리츠 계좌에는 없습니다. 이미 팔았다면 내 종목에서 정리해 주세요." : "정상입니다. 서로 다른 계좌입니다."}</div> : null; })()}

      <div style={{ marginTop: 10, color: K.dim, fontSize: 11, lineHeight: 1.5 }}>
        {!info.canOrder ? `보기만 합니다. 주문은 서버 스위치(${MERITZ ? "MERITZ_ORDER=on" : "KIS_REAL_ORDER=on"})를 켜야 열립니다.` : demo ? "모의투자 주문입니다 — 가짜 돈입니다." : "실전 주문입니다 — 실제 돈이 나갑니다. 모든 주문은 확인 창을 거칩니다."}{MERITZ ? "" : " 조회할 때마다 한투 알림톡이 올 수 있습니다(접속 토큰을 새로 받는 날)."}
      </div>

      {confirm && (
        <div role="dialog" aria-modal="true" aria-label="주문 확인" onClick={() => setConfirm(null)}
          style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 360, background: K.panel2, border: `2px solid ${demo ? K.gold : K.down}`, borderRadius: 14, padding: 18, color: K.text }}>
            <div style={{ fontSize: 12, color: demo ? K.gold : K.down, fontWeight: 700 }}>{demo ? `${BK} 모의투자 · 지정가` : `⚠ ${BK} 실전 · 실제 돈 · 지정가`}</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}><span style={{ color: confirm.side === "buy" ? K.up : K.down }}>{confirm.side === "buy" ? "매수" : "매도"}</span> {KR && stocks[confirm.t]?.n ? `${stocks[confirm.t].n} ` : ""}{confirm.t}</div>
            <div style={{ fontFamily: MONO, fontSize: 15, marginTop: 6 }}>{confirm.qty}주 × {M(confirm.px, 2)} = <b>{M(confirm.qty * confirm.px, 2)}</b>{!KR && fx ? <span style={{ color: K.dim, fontSize: 12 }}> (약 {Math.round(confirm.qty * confirm.px * fx / 10000).toLocaleString("ko-KR")}만 원)</span> : null}</div>
            {confirm.note && <div style={{ color: K.dim, fontSize: 12, marginTop: 4 }}>{confirm.note}</div>}
            <div style={{ color: K.dim, fontSize: 12, marginTop: 4 }}>{EXN[confirm.ex]} · {demo ? "가짜 돈입니다." : "실제 계좌에서 실제 돈으로 주문됩니다."} 같은 주문이 두 번 나가지 않게 한 번만 전송됩니다.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button type="button" onClick={() => setConfirm(null)} style={{ ...quiet, flex: 1 }}>돌아가기</button>
              <button type="button" onClick={send} style={{ ...btn, flex: 1, background: K.gold, color: "#111", border: `1px solid ${K.gold}` }}>주문 보내기</button>
            </div>
          </div>
        </div>)}
    </div>);
}
