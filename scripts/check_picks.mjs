// 96. 앱(src/picks.js)과 파이프라인(build_snapshot.build_today)이 같은 설정에서 같은 종목을 고르는지 확인합니다.
//   실행: node scripts/check_picks.mjs          (저장소 맨 위 폴더에서)
//   여러 설정(매출 필터 0·10·20 · 칸 수 3~10)으로 돌려 하나라도 다르면 실패(종료 코드 1)합니다.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pickToday } from "../src/picks.js";

const D = "public/data";
const snap = JSON.parse(readFileSync(`${D}/snapshot.json`, "utf-8"));
const market = JSON.parse(readFileSync(`${D}/market.json`, "utf-8"));
const wlRaw = readFileSync(`${D}/watchlist.json`, "utf-8");
const wl = JSON.parse(wlRaw);
const held = new Set((wl.positions || []).map(p => String(p.t || "").toUpperCase()));
const secRank = Object.fromEntries((market.sectors || []).map(x => [x.tk, [x.rank, x.label]]));

const cases = [
  { revMin: 10, slotsUs: 7, slotsKr: 5 }, { revMin: 0, slotsUs: 5, slotsKr: 3 },
  { revMin: 20, slotsUs: 3, slotsKr: 10 }, { revMin: 5, slotsUs: 10, slotsKr: 1 },
];
let bad = 0;
try {
  for (const cfg of cases) {
    writeFileSync(`${D}/watchlist.json`, JSON.stringify({ ...wl, settings: { ...(wl.settings || {}), ...cfg } }));
    const py = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, "scripts")
import build_snapshot as B
s = json.load(open("${D}/snapshot.json")); m = json.load(open("${D}/market.json"))
t = B.build_today(s["stocks"], m)
print(json.dumps({"us": [r["t"] for r in t["pickUs"]], "kr": [r["t"] for r in t["pickKr"]]}))
`], { encoding: "utf-8" }).trim().split("\n").pop());
    const js = pickToday(snap.stocks, cfg, held, { secRank });
    const a = { us: js.pickUs.map(r => r.t), kr: js.pickKr.map(r => r.t) };
    const same = JSON.stringify(a) === JSON.stringify(py);
    if (!same) bad++;
    console.log(`${same ? "✅ 같음" : "❌ 다름"}  매출 ${cfg.revMin}% · 🇺🇸 ${cfg.slotsUs}칸 · 🇰🇷 ${cfg.slotsKr}칸`,
      same ? `🇺🇸 ${a.us.join(",")} | 🇰🇷 ${a.kr.join(",")}` : `\n   앱   ${JSON.stringify(a)}\n   파이프라인 ${JSON.stringify(py)}`);
  }
} finally {
  writeFileSync(`${D}/watchlist.json`, wlRaw);          // 원래 파일로 되돌림
}
process.exit(bad ? 1 : 0);
