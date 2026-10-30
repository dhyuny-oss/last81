/** 210. 주문 창 열기 — 어느 화면에서든 같은 창(src/OrderSheet.jsx)이 그 자리에서 올라옵니다.
 *  openOrder({ t, side: "buy"|"sell", qty, m: "us"|"kr", px?, held?(보유 수량), tranche2?(2회차) }) */
export const openOrder = (d) => { try { window.dispatchEvent(new CustomEvent("order-open", { detail: d })); } catch {} };

/* 223. 다음 정규장이 열리는 날 — 예약 매도가 언제 나가는지 보여 줄 때 (서버 api/_lib/meritz.js nextOpenDay 와 같은 계산 · 같은 휴장일) */
const HOL = {
  kr: new Set(["2026-09-24", "2026-09-25", "2026-10-05", "2026-10-09", "2026-12-25", "2026-12-31", "2027-01-01"]),
  us: new Set(["2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"]),
};
/** → { d: "2026-11-02", label: "11/2(월) 밤 개장 때" } · 🇺🇸 은 뉴욕 날짜(= 한국에서 그날 밤 개장) */
export function nextOpen(KR, now = Date.now()) {
  const z = KR ? "Asia/Seoul" : "America/New_York", open = KR ? 540 : 570;
  const at = (ms) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const p0 = at(now), before = +p0.hour * 60 + +p0.minute < open;
  const W = { Mon: "월", Tue: "화", Wed: "수", Thu: "목", Fri: "금" };
  for (let i = before ? 0 : 1; i < 15; i++) {
    const p = at(now + i * 86400000), d = `${p.year}-${p.month}-${p.day}`;
    if (p.weekday === "Sat" || p.weekday === "Sun" || HOL[KR ? "kr" : "us"].has(d)) continue;
    const md = `${+p.month}/${+p.day}(${W[p.weekday]})`;
    return { d, label: KR ? `${md} 09:00 장 시작 때` : `${md} 밤 미국 장 시작 때` };
  }
  return { d: "", label: "다음 개장 때" };
}
