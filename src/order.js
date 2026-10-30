/** 210. 주문 창 열기 — 어느 화면에서든 같은 창(src/OrderSheet.jsx)이 그 자리에서 올라옵니다.
 *  openOrder({ t, side: "buy"|"sell", qty, m: "us"|"kr", px?, held?(보유 수량), tranche2?(2회차) }) */
export const openOrder = (d) => { try { window.dispatchEvent(new CustomEvent("order-open", { detail: d })); } catch {} };
