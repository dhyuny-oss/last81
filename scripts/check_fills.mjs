// 184. 한투 체결 → 내 종목 반영 규칙 점검 — 실행: node scripts/check_fills.mjs
import { planFills, applyFills } from "../src/fills.js";
let bad = 0; const ok = (n, c, d = "") => { console.log(`${c ? "✅" : "❌"} ${n}${c ? "" : " — " + d}`); if (!c) bad++; };
const pos = [
  { id: 1, t: "MPC", role: "swing", tr: [{ d: "2026-10-12", px: 462, amt: 2772 }] },          // 6주
  { id: 2, t: "NET", role: "swing", tr: [{ d: "2026-10-14", px: 323.6, amt: 10355.2 }] },    // 32주
  { id: 3, t: "VEEV", role: "swing", tr: [{ d: "2026-10-14", px: 301.5, amt: 3015 }] },      // 10주
];
const orders = [
  { odno: "1", dt: "20261020", side: "buy", t: "SHOP", n: "SHOPIFY", filled: 10, fpx: 170, px: 170.4, open: 0, qty: 10, state: "완료" },
  { odno: "2", dt: "20261020", side: "buy", t: "SHOP", n: "SHOPIFY", filled: 8, fpx: 170.5, px: 170.4, open: 0, qty: 8, state: "완료" },
  { odno: "3", dt: "20261020", side: "buy", t: "MPC", filled: 6, fpx: 479.8, px: 480, open: 0, qty: 6 },
  { odno: "4", dt: "20261020", side: "sell", t: "NET", filled: 32, fpx: 295.1, px: 295, open: 0, qty: 32 },
  { odno: "5", dt: "20261020", side: "sell", t: "VEEV", filled: 3, fpx: 300, px: 300, open: 0, qty: 3 },
  { odno: "6", dt: "20261013", side: "buy", t: "VEEV", filled: 10, fpx: 301.5, px: 301.5, open: 0, qty: 10 },   // 이미 손으로 기록(±1일)
  { odno: "7", dt: "20261020", side: "buy", t: "KDP", filled: 0, fpx: 0, px: 34.6, open: 92, qty: 92, state: "접수" },
  { odno: "8", dt: "20261020", side: "sell", t: "AAPL", filled: 3, fpx: 250, px: 250, open: 0, qty: 3 },          // 앱에 없음
  { odno: "9", dt: "20261019", side: "buy", t: "CTAS", filled: 15, fpx: 213, px: 213, open: 0, qty: 15 },
  { odno: "10", dt: "20261021", side: "buy", t: "CTAS", filled: 15, fpx: 220, px: 220, open: 0, qty: 15 },
];
const rows = [{ t: "MPC", qty: 12 }, { t: "VEEV", qty: 7 }, { t: "SHOP", qty: 18 }, { t: "TSLA", n: "TESLA", qty: 2, avg: 400 }, { t: "CTAS", qty: 30 }];
const r = planFills({ orders, rows, pos, applied: new Set(), ignored: new Set() });
const by = (t, s) => r.items.find((i) => i.t === t && i.side === s);
ok("SHOP 두 주문을 하나로 합침 (18주 · 평균가)", by("SHOP", "buy")?.qty === 18 && Math.abs(by("SHOP", "buy").px - (10 * 170 + 8 * 170.5) / 18) < 1e-9, JSON.stringify(by("SHOP", "buy")));
ok("SHOP = 새 보유 1회차", by("SHOP", "buy")?.kind === "new");
ok("MPC = 2회차", by("MPC", "buy")?.kind === "t2");
ok("NET 32주 매도 = 전량 정리", by("NET", "sell")?.kind === "close");
ok("VEEV 3/10주 매도 = 일부 매도(자동 반영 안 함)", by("VEEV", "sell")?.kind === "partial");
ok("VEEV 10/13 매수는 손으로 기록한 것 → 중복 처리", r.dup.includes("6") && !r.items.some((i) => i.odnos.includes("6")));
ok("앱에 없는 AAPL 매도는 반영 대상 아님", !by("AAPL", "sell") && r.dup.includes("8"));
ok("CTAS 10/19 → 1회차, 10/21 → 2회차 (같은 묶음 안 순서)", r.items.filter((i) => i.t === "CTAS").map((i) => i.kind).join(",") === "new,t2");
ok("체결 대기 KDP 92주", r.waiting.some((w) => w.t === "KDP" && w.open === 92));
ok("한투에만 있는 TSLA 표시 · 새로 반영될 SHOP·CTAS 는 제외", r.extra.map((e) => e.t).join(",") === "TSLA", JSON.stringify(r.extra));
const a0 = applyFills(pos, r.items.filter((i) => i.kind !== "partial"), { src: "kis-demo" });
const r2 = planFills({ orders, rows, pos: a0.pos, applied: new Set(["1", "2", "3", "4", "5", "8", "9", "10"]), ignored: new Set(["TSLA"]) });
ok("반영한 주문·무시한 종목은 다시 안 뜸", r2.items.length === 0 && r2.extra.length === 0 && r2.waiting.length === 1, JSON.stringify(r2));
const a = applyFills(pos, r.items.filter((i) => i.kind !== "partial"), { src: "kis-demo", mOf: () => "us" });
const P = (t) => a.pos.find((p) => p.t === t);
ok("SHOP 새 보유 생김 (모의 표시)", P("SHOP")?.tr.length === 1 && P("SHOP").src === "kis-demo" && Math.abs(P("SHOP").tr[0].amt - 3064) < 1);
ok("MPC 회차 2개", P("MPC")?.tr.length === 2 && P("MPC").tr[1].px === 479.8);
ok("NET 빠지고 매매 기록 1건 (손익 −8.8%)", !P("NET") && a.trades.length === 1 && Math.abs(a.trades[0].pl - (295.1 / 323.6 - 1) * 100) < 1e-9);
ok("VEEV 그대로 (일부 매도는 손으로)", P("VEEV")?.tr.length === 1);
ok("CTAS 회차 2개 (1회차 213 → 2회차 220)", P("CTAS")?.tr.map((t) => t.px).join(",") === "213,220");
ok("원래 배열은 바뀌지 않음", pos.length === 3 && pos[0].tr.length === 1);
process.exit(bad ? 1 : 0);
