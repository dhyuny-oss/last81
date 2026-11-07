/**
 * 249. 매수 예약 (화면 쪽) — 서버 api/_lib/resv.js 와 짝
 *   장이 닫혀 있을 때 주문 창의 '사기' = 예약. 장이 열린 뒤 서버가 조건을 다시 보고 지정가로 삽니다(하루만 유효).
 *   useResv() : 예약 목록 { items, at } — 앱 어디서든 같은 목록 (오늘 탭 '⏰ 예약됨' · 내 종목 탭 '매수 예약' 카드)
 *   resvCall(): /api/broker 에 what: resvBuy* 로 보냄 (앱 비밀번호 필요)
 *   'resv-changed' 이벤트를 보내면 목록을 다시 불러옴
 */
import { useEffect, useState } from "react";

const PIN = "v7.kis.pin";
let S = { items: [], at: 0, err: "", win: null };
const subs = new Set();
const emit = () => subs.forEach((f) => f(S));
const pinOf = () => { try { return localStorage.getItem(PIN) || ""; } catch { return ""; } };

export async function resvCall(body) {
  const r = await fetch("/api/broker", { method: "POST", headers: { "Content-Type": "application/json", "x-kis-pin": pinOf() }, body: JSON.stringify(body) });
  return r.json();
}
let busy = null, lastRun = 0;
export function loadResv() {
  if (!pinOf()) return Promise.resolve(S);
  if (busy) return busy;
  busy = resvCall({ what: "resvBuyList" }).then((j) => {
    S = j.ok ? { items: j.items || [], at: Date.now(), err: "", win: j.win || null } : { ...S, err: j.msg || "예약 목록을 읽지 못했습니다" };
    emit(); maybeRun(); return S;
  }).catch(() => S).finally(() => { busy = null; });
  return busy;
}
/** 앱이 확인 시간(🇺🇸 개장 5분~2시간 30분 · 🇰🇷 09:30~11:30)에 열려 있으면 앱도 서버 확인을 한 번 부름 (10분에 한 번) */
function maybeRun() {
  const w = S.win; if (!w || Date.now() - lastRun < 10 * 60000) return;
  const due = ["us", "kr"].filter((m) => w[m]?.ph === "in" && S.items.some((x) => x.m === m && x.status === "wait" && x.day === w[m].d));
  if (!due.length) return;
  lastRun = Date.now();
  (async () => { for (const mk of due) { try { await resvCall({ what: "resvBuyRun", mk }); } catch {} } setTimeout(loadResv, 1500); })();
}
if (typeof window !== "undefined") {
  window.addEventListener("resv-changed", () => { setTimeout(loadResv, 300); });
  setInterval(() => { if (S.at && document.visibilityState !== "hidden") loadResv(); }, 5 * 60000);
}
export function useResv() {
  const [s, set] = useState(S);
  useEffect(() => { subs.add(set); if (!S.at) loadResv(); return () => { subs.delete(set); }; }, []);
  return s;
}
/** 이 종목에 기다리는 예약이 있나 */
export const resvOf = (items, t) => (items || []).find((x) => x.t === String(t).toUpperCase() && (x.status === "wait" || x.status === "run"));
export const RESV_ST = { wait: ["기다림", "#06B6D4"], run: ["확인 중", "#F59E0B"], sent: ["주문 보냄", "#30D158"], skip: ["안 삼", "#9CA3AF"], expired: ["만료", "#9CA3AF"], cancel: ["취소", "#9CA3AF"], fail: ["실패", "#FF453A"], unsure: ["확인 필요", "#FF453A"] };
export const resvDay = (d) => d ? `${+String(d).slice(4, 6)}/${+String(d).slice(6, 8)}` : "";
