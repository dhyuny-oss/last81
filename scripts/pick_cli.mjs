// 261. 파이프라인(build_snapshot.build_today)이 '오늘 살 것'을 고를 때 부르는 다리 — 고르는 규칙은 src/picks.js 의 pickFrom 한 곳뿐
//   입력(표준입력 JSON): { rows, cfg: {revMin, slotsUs, slotsKr, krGate, usGate}, heldSec }
//   출력(표준출력 JSON): { pickUs: [티커…], pickKr: [티커…], excluded: [{t,n,m,why}…], order: [티커…] }
import { pickFrom } from "../src/picks.js";
let raw = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const { rows = [], cfg = {}, heldSec = {} } = JSON.parse(raw || "{}");
  const P = pickFrom(rows, cfg, heldSec);
  process.stdout.write(JSON.stringify({ pickUs: P.pickUs.map((r) => r.t), pickKr: P.pickKr.map((r) => r.t), excluded: P.excluded, order: P.order.map((r) => r.t) }));
});
