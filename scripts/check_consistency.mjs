// 144. 서로 같아야 하는 값들이 실제로 같은지 확인합니다 (화면·서버·알림이 같은 답을 내는가).
//   실행: node scripts/check_consistency.mjs      (저장소 맨 위 폴더에서)
//   ❌ 가 하나라도 있으면 종료 코드 1 · ⚠ 는 "지금은 다르지만 다음 갱신 때 같아지는" 종류
import { readdirSync, readFileSync } from "node:fs";
import { pickToday } from "../src/picks.js";

const D = "public/data";
const J = (f) => JSON.parse(readFileSync(`${D}/${f}`, "utf-8"));
// 263. 스냅샷 파이프라인은 build_snapshot.py + scripts/snap/*.py 로 나뉨 → 그 이름으로 읽으면 전부 이어 붙여 봄
const SNAP = ["scripts/build_snapshot.py", ...readdirSync("scripts/snap").filter((f) => f.endsWith(".py")).sort().map((f) => `scripts/snap/${f}`)];
// 264. 앱 화면은 App.jsx + core.jsx + Tab*.jsx 로 나뉨 → "src/App.jsx" 로 읽으면 전부 이어 붙여 봄
const APPF = ["src/App.jsx", "src/core.jsx", ...readdirSync("src").filter((f) => /^Tab\w+\.jsx$/.test(f)).sort().map((f) => `src/${f}`)];
const T = (f) => f === "scripts/build_snapshot.py" ? SNAP.map((x) => readFileSync(x, "utf-8")).join("\n")
  : f === "scripts/notify.py" ? ["scripts/notify.py", "scripts/notify_lib.py", "scripts/notify_weekly.py"].map((x) => readFileSync(x, "utf-8")).join("\n")
  : f === "src/App.jsx" ? APPF.map((x) => readFileSync(x, "utf-8")).join("\n") : readFileSync(f, "utf-8");
const snap = J("snapshot.json"), market = J("market.json"), today = J("today.json"), wl = J("watchlist.json");
const stocks = snap.stocks;
let bad = 0, warn = 0;
const ok = (name, cond, detail = "", soft = false) => {
  if (cond) console.log(`✅ ${name}`);
  else if (soft) { warn++; console.log(`⚠  ${name}${detail ? `\n     ${detail}` : ""}`); }
  else { bad++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ""}`); }
};
const ids = (a) => (a || []).map((r) => r.t).join(",");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("── 1. 보유: 폰이 보낸 것 = 서버가 쓰는 것 ──");
const pos = wl.positions || [];
const heldWl = pos.map((p) => String(p.t).toUpperCase()).sort();
const heldToday = (today.held || []).map((h) => String(h.t).toUpperCase()).sort();
const builtAt = Date.parse(snap.meta?.generatedAt || 0), wlAt = Date.parse(wl.updatedAt || 0);
const stale = wlAt > builtAt;                      // 보유를 보낸 뒤 아직 추천을 다시 만들지 않음
ok(`today.json 보유(${heldToday.length}) = watchlist 보유(${heldWl.length})`, eq(heldWl, heldToday),
  `today: ${heldToday.join(",")}\n     watchlist: ${heldWl.join(",")}${stale ? "\n     → 보유를 바꾼 뒤 아직 갱신 전입니다. 다음 갱신 때 같아집니다" : ""}`, stale);
ok("보유 변경 뒤 추천이 다시 만들어졌는가", !stale, `watchlist ${wl.updatedAt} > 데이터 ${snap.meta?.generatedAt} — 그 사이 텔레그램·서버 추천은 옛 보유 기준`, true);

console.log("── 2. 오늘 살 것: 서버(today.json) = 앱 규칙(picks.js) = market.json 사본 ──");
const krGate = !!(market.judge?.kr?.blocked ?? (market.judge?.kr?.gate && market.judge.kr.verdict === "risk"));   // 옛 market.json 호환
const usGate = !!(market.judge?.us?.blocked ?? market.judge?.us?.nqGate);
const oldServer = !(today.rules && "usGate" in today.rules);       // 새 규칙(247·252) 전에 만든 today.json — 다음 갱신 때 같아짐
const cfg = { revMin: Number((wl.settings || {}).revMin ?? 10), slotsUs: Number((wl.settings || {}).slotsUs || 7), slotsKr: Number((wl.settings || {}).slotsKr || 5), krGate, usGate };
const app = pickToday(stocks, cfg, new Set(heldWl));
// 176. 한국 시장 위험이면 서버·앱 모두 한국 추천 0
ok(`🇰🇷 시장 ${market.judge?.kr?.verdict || "—"} → 한국 추천 ${krGate ? "0이어야 함" : "허용"} (서버 ${(today.pickKr || []).length} · 앱 ${app.pickKr.length})`,
   !krGate || ((today.pickKr || []).length === 0 && app.pickKr.length === 0), oldServer ? "서버 today.json 이 새 규칙 전에 만들어짐 — 다음 갱신 때 같아집니다" : "", stale || oldServer);
// 161 · 247. 미국 추천 + 보유가 같은 업종 3개를 넘지 않아야 함 (원칙 5)
const secN = {}; [...heldWl.map((t) => stocks[t]).filter((d) => d && d.m === "us" && d.sec), ...(today.pickUs || [])].forEach((d) => { secN[d.sec] = (secN[d.sec] || 0) + 1; });
const clash = Object.entries(secN).filter(([, v]) => v > 3).map(([k, v]) => `${k} ${v}개`);
ok("🇺🇸 추천 + 보유가 같은 업종 3개 이하", clash.length === 0, clash.join(","), stale || oldServer);
ok(`🇺🇸 나스닥100 200일선 ${usGate ? "아래 → 미국 추천 0이어야 함" : "위(또는 자료 없음) → 허용"} (서버 ${(today.pickUs || []).length} · 앱 ${app.pickUs.length})`,
   !usGate || ((today.pickUs || []).length === 0 && app.pickUs.length === 0), "", stale || oldServer);
ok(`🇺🇸 추천  서버 [${ids(today.pickUs)}] = 앱 [${ids(app.pickUs)}]`, ids(today.pickUs) === ids(app.pickUs), "", stale || oldServer);
ok(`🇰🇷 추천  서버 [${ids(today.pickKr)}] = 앱 [${ids(app.pickKr)}]`, ids(today.pickKr) === ids(app.pickKr), "", stale || oldServer);
ok("market.json 안의 today = today.json", eq(market.today, today));
const slot = (m, n) => { const h = pos.filter((p) => (p.role || "swing") === "swing" && (/^\d+$/.test(String(p.t)) === (m === "kr"))).length; return { n, held: h, free: Math.max(0, n - h) }; };
ok(`빈 칸 🇺🇸 서버 ${JSON.stringify(today.slots?.us)} = 계산 ${JSON.stringify(slot("us", cfg.slotsUs))}`, eq(today.slots?.us, slot("us", cfg.slotsUs)), "", stale);
ok(`빈 칸 🇰🇷 서버 ${JSON.stringify(today.slots?.kr)} = 계산 ${JSON.stringify(slot("kr", cfg.slotsKr))}`, eq(today.slots?.kr, slot("kr", cfg.slotsKr)), "", stale);

let plog = null; try { plog = J("picks_log.json"); } catch { plog = null; }
const lastPick = Array.isArray(plog) ? plog[plog.length - 1] : null;
ok("추천 기록(picks_log)의 마지막 날 = today.json", !!lastPick && lastPick.d === today.asOf && ids(lastPick.us) === ids(today.pickUs) && ids(lastPick.kr) === ids(today.pickKr),
  lastPick ? `기록 ${lastPick.d} [${ids(lastPick.us)}] / today ${today.asOf} [${ids(today.pickUs)}]` : "picks_log.json 없음 — 다음 데이터 갱신 때 생깁니다", !lastPick);
console.log("── 3. 가격·손절선·신호: today.json = snapshot.json ──");
const diffs = [];
for (const r of [...(today.pickUs || []), ...(today.pickKr || []), ...(today.held || []), ...(today.candidates || [])]) {
  const s = stocks[r.t]; if (!s) { if (r.state !== "데이터 없음") diffs.push(`${r.t}: snapshot 에 없음`); continue; }
  if (r.c != null && r.c !== s.c) diffs.push(`${r.t} 가격 ${r.c}≠${s.c}`);
  if (r.stLine != null && r.stLine !== s.stLine) diffs.push(`${r.t} 손절선 ${r.stLine}≠${s.stLine}`);
}
ok("추천·보유·후보의 가격과 손절선", diffs.length === 0, diffs.slice(0, 8).join(" · "));
const notBuy = [...(today.pickUs || []), ...(today.pickKr || [])].filter((r) => stocks[r.t]?.action !== "buy").map((r) => r.t);
ok("추천 종목은 모두 snapshot 에서 '매수!' 신호", notBuy.length === 0, notBuy.join(","), stale);
const sellMis = (today.held || []).filter((h) => stocks[h.t] && (h.action === "sell") !== (stocks[h.t].action === "sell")).map((h) => h.t);
ok("보유 종목의 매도 신호", sellMis.length === 0, sellMis.join(","));

console.log("── 4. 날짜·시장 판정 ──");
const mode = (m) => { const c = {}; for (const v of Object.values(stocks)) if (v.m === m && v.asOf) c[v.asOf] = (c[v.asOf] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0]; };
const asOfUs = mode("us"), asOfKr = mode("kr");
ok(`today.asOf(${today.asOf}) = 종목 기준일 중 최신(🇺🇸 ${asOfUs} · 🇰🇷 ${asOfKr})`, today.asOf === [asOfUs, asOfKr].sort().pop());
ok("snapshot 과 market 의 생성 시각", snap.meta?.generatedAt === market.meta?.generatedAt, `${snap.meta?.generatedAt} / ${market.meta?.generatedAt}`);
ok(`시장 판정 today(${JSON.stringify(today.market)}) = market.judge`, ["us", "kr"].every((m) => today.market?.[m] === market.judge?.[m]?.verdict));
const secA = ids((today.sectors || []).map((x) => ({ t: x.tk ?? x.t }))), secB = ids((market.sectors || []).slice(0, (today.sectors || []).length).map((x) => ({ t: x.tk })));
ok("업종 순위 today = market (앞쪽)", secA === secB, `${secA} / ${secB}`, true);

console.log("── 5. 코드에 여러 번 적힌 같은 값 ──");
// 257. 휴장일은 config/market.json 한 파일 — 코드에 날짜 목록을 다시 적지 않았는지
{ const cal = JSON.parse(T("config/market.json"));
  const users = { "src/App.jsx": /config\/market\.json/, "src/order.js": /config\/market\.json/, "api/_lib/meritz.js": /config\/market\.json/,
                  "scripts/notify.py": /from mktcal import/, "scripts/watch_alert.py": /from mktcal import/, "scripts/build_snapshot.py": /from mktcal import/, ".github/workflows/daily.yml": /config\/market\.json/ };
  const bad_ = Object.entries(users).filter(([f, re]) => !re.test(T(f)) || /"20\d\d-\d\d-\d\d", "20\d\d-\d\d-\d\d", "20\d\d-\d\d-\d\d"/.test(T(f))).map(([f]) => f);
  ok(`휴장일 한 파일(config/market.json · 🇰🇷 ${Object.keys(cal.kr).length} · 🇺🇸 ${Object.keys(cal.us).length}) — 7곳이 모두 그 파일을 읽음`, bad_.length === 0, bad_.join(", "));
  const yr = new Date().getFullYear(), mo = new Date().getMonth() + 1;
  ok(`휴장일이 내년(${yr + 1})까지 있음`, cal.lastYear >= (mo >= 11 ? yr + 1 : yr), "config/market.json 에 다음 해 휴장일을 넣으세요", true);
}
const py = T("scripts/build_snapshot.py"), app_ = T("src/App.jsx"), picksJs = T("src/picks.js"), notify = T("scripts/notify.py");
const n = (re, txt) => { const m = re.exec(txt); return m ? Number(m[1]) : null; };
// 260. 규칙 숫자는 config/rules.json 한 파일 — 각 파일이 그 파일을 읽고, 같은 숫자를 다시 적지 않았는지
{ const R = JSON.parse(T("config/rules.json"));
  const users = { "src/picks.js": /from "\.\/rules\.js"/, "src/App.jsx": /from "\.\/rules\.js"/, "src/OrderSheet.jsx": /from "\.\/rules\.js"/, "src/Broker.jsx": /from "\.\/rules\.js"/,
                  "api/_lib/resv.js": /config\/rules\.json/, "api/_lib/meritz.js": /config\/rules\.json/, "api/watchlist.js": /config\/rules\.json/,
                  "scripts/build_snapshot.py": /from rules import/, "scripts/notify.py": /from rules import/, "scripts/watch_alert.py": /from rules import/ };
  const miss = Object.entries(users).filter(([f, re]) => !re.test(T(f))).map(([f]) => f);
  ok(`규칙 숫자 한 파일(config/rules.json · 칸 ${R.slots.us}/${R.slots.kr} · 업종 ${R.secCap} · 매출 ${R.revMin} · 거래대금 ${R.tvrMin}) — 10곳이 읽음`, miss.length === 0, miss.join(", "));
  const lit = [["src/picks.js", /tvr \?\? 0\) >= 40|SEC_CAP = 3|us: 7, kr: 5/], ["src/App.jsx", /tvr \?\? 0\) >= 40|px \* 1\.0[36]\b/], ["scripts/build_snapshot.py", /tvr"\) or 0\) >= 40|\* 1\.0[36]\b|^SEC_CAP = 3/m],
               ["scripts/notify.py", /tvr"\) or 0\) >= 40|\* 1\.0[36]\b|or [75]\)/], ["scripts/watch_alert.py", /\* 1\.0[36]\b/]].filter(([f, re]) => re.test(T(f))).map(([f]) => f);
  ok("규칙 숫자를 코드에 다시 적은 곳 없음", lit.length === 0, lit.join(", "));
  ok(`계좌 지정가 여유(+${R.guard.slip}%)가 서버 매수 거절선(${R.guard.buyBand}%)보다 작음`, R.guard.slip < R.guard.buyBand && /RULES\.guard\.buyBand/.test(T("api/_lib/meritz.js")));
}
ok("새로 사지 않는 나라(blocked)를 서버·앱·알림이 같은 값으로 읽음 — 269",
  /kr_gate = blocked_of\(_jk\)/.test(py) && /us_gate = blocked_of\(/.test(py)
  && /usGateOf = \(market\) =>/.test(app_) && /krGateOf = \(market\) =>/.test(app_) && /\.blocked/.test(app_)
  && /_ju\.get\("blocked"\) and _open\.get\("us"\)/.test(notify) && /_jk\.get\("blocked"\) and _open\.get\("kr"\)/.test(notify)
  && !/\.get\("nqGate"\)|\.get\("gate"\)/.test(notify));
ok("화면에 '판정은 DC에만 사용'·근거 없는 16.9% 같은 옛 문구 없음 — 160", !/DC 판단에만 사용|ETF 배분\(DC\)에만|\+16\.9%·최대낙폭 −28%/.test(app_));
ok("폭 계산 날짜(breadthAsOf)가 데이터에 있음 — 171", !!market.breadthAsOf, "", true);
const brokerJs = T("api/_lib/meritz.js"), brokerUi = T("src/Broker.jsx");
ok("미국 개장 22:30/23:30 · 마감 05:00/06:00 (앱·감시)", /dst \? 1350 : 1410/.test(app_) && /dst \? 300 : 360/.test(app_)
  && [T("scripts/watch_alert.py")].every((t) => /\(22 \* 60 \+ 30, 5 \* 60\) if dst else \(23 \* 60 \+ 30, 6 \* 60\)/.test(t)));
ok("증권사 카드는 오늘 탭과 같은 선정 함수 사용", /brokerPicks\(stocks, pos, genDay/.test(app_) && !/picks=\{today\?\.pickUs/.test(app_));
// 259. 저장 단계 — 폴더 전체를 담고 내 기록(watchlist · resv)만 뺌
{ const yml = T(".github/workflows/daily.yml");
  ok("자동 수집 저장: public/data 전체 + watchlist·resv 제외", /git add -A public\/data\n/.test(yml) && /git reset -q -- public\/data\/watchlist\.json public\/data\/resv\.json/.test(yml));
  ok("저장 전 pull 이 바뀐 파일 때문에 멈추지 않음(--autostash)", /git pull --rebase --autostash origin main/.test(yml));
}

console.log(`\n${bad ? `❌ 다른 곳 ${bad}개` : "✅ 꼭 같아야 하는 값은 모두 같음"}${warn ? ` · ⚠ 갱신 대기 ${warn}개` : ""}`);
process.exit(bad ? 1 : 0);
