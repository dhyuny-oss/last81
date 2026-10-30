// 144. 서로 같아야 하는 값들이 실제로 같은지 확인합니다 (화면·서버·알림이 같은 답을 내는가).
//   실행: node scripts/check_consistency.mjs      (저장소 맨 위 폴더에서)
//   ❌ 가 하나라도 있으면 종료 코드 1 · ⚠ 는 "지금은 다르지만 다음 갱신 때 같아지는" 종류
import { readFileSync } from "node:fs";
import { pickToday } from "../src/picks.js";

const D = "public/data";
const J = (f) => JSON.parse(readFileSync(`${D}/${f}`, "utf-8"));
const T = (f) => readFileSync(f, "utf-8");
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
const krGate = !!(market.judge?.kr?.gate && market.judge.kr.verdict === "risk");
const oldServer = !(today.rules && "krGate" in today.rules);       // 새 규칙(161·176) 전에 만든 today.json — 다음 갱신 때 같아짐
const cfg = { revMin: Number((wl.settings || {}).revMin ?? 10), slotsUs: Number((wl.settings || {}).slotsUs || 7), slotsKr: Number((wl.settings || {}).slotsKr || 5), krGate };
const app = pickToday(stocks, cfg, new Set(heldWl));
// 176. 한국 시장 위험이면 서버·앱 모두 한국 추천 0
ok(`🇰🇷 시장 ${market.judge?.kr?.verdict || "—"} → 한국 추천 ${krGate ? "0이어야 함" : "허용"} (서버 ${(today.pickKr || []).length} · 앱 ${app.pickKr.length})`,
   !krGate || ((today.pickKr || []).length === 0 && app.pickKr.length === 0), oldServer ? "서버 today.json 이 새 규칙 전에 만들어짐 — 다음 갱신 때 같아집니다" : "", stale || oldServer);
// 161. 미국 추천에 '이미 보유한 업종'이 없어야 함 (원칙 5)
const heldSecs = new Set(heldWl.map((t) => stocks[t]).filter((d) => d && d.m === "us" && d.sec).map((d) => d.sec));
const clash = (today.pickUs || []).filter((r) => heldSecs.has(r.sec)).map((r) => `${r.t}(${r.sec})`);
ok("🇺🇸 추천에 보유 종목과 같은 업종 없음", clash.length === 0, clash.join(","), stale);
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
const hol = (txt, name) => { const m = new RegExp(name + "[^\\n]*?[\\[{(]([^\\]})]*)").exec(txt); return m ? (m[1].match(/\d{4}-\d\d-\d\d/g) || []).sort().join(",") : null; };
const files = { "src/App.jsx": ["KR_HOLIDAYS", "US_HOLIDAYS"], "scripts/watch_alert.py": ["KR_HOLIDAYS", "US_HOLIDAYS"], "api/watch.py": ["KR_HOLIDAYS", "US_HOLIDAYS"], ".github/workflows/daily.yml": ["KR_HOL", "US_HOL"] };
for (const i of [0, 1]) {
  const got = Object.entries(files).map(([f, names]) => [f, hol(T(f), names[i] + " = ")]);
  ok(`${i ? "🇺🇸" : "🇰🇷"} 휴장일 4곳 동일 (${got[0][1]})`, got.every((g) => g[1] && g[1] === got[0][1]), got.map((g) => `${g[0]}: ${g[1]}`).join("\n     "));
}
const py = T("scripts/build_snapshot.py"), app_ = T("src/App.jsx"), picksJs = T("src/picks.js"), notify = T("scripts/notify.py");
const n = (re, txt) => { const m = re.exec(txt); return m ? Number(m[1]) : null; };
ok("매출 필터 기본값 10 (서버·앱 규칙·앱 설정)", n(/^REV_MIN = (\d+)/m, py) === 10 && n(/revMin = (\d+)/, picksJs) === 10 && n(/getRevMin[^\n]*v == null \? (\d+)/, app_) === 10);
ok("칸 수 기본값 🇺🇸7 · 🇰🇷5 (서버·알림·서버 저장·앱 규칙) — 168", /slotsUs"\) or 7\)/.test(py) && /slotsKr"\) or 5\)/.test(py) && /slotsUs"\) or 7\)/.test(notify) && /slotsKr"\) or 5\)/.test(notify)
  && /SLOTS_DEFAULT = \{ us: 7, kr: 5 \}/.test(picksJs) && !/plan\.slotsUs \|\| \d/.test(app_) && !/plan\.slotsKr \|\| \d/.test(app_)
  && /num\(st\.slotsUs, 1, 20, 7\)/.test(T("api/watchlist.js")) && /num\(st\.slotsKr, 1, 20, 5\)/.test(T("api/watchlist.js")));
ok("한국 시장 게이트를 서버·앱·알림이 같은 판정으로 씀 — 176", /kr_gate = bool\(_jk\.get\("gate"\) and _jk\.get\("verdict"\) == "risk"\)/.test(py)
  && /krGateOf = \(market\) => !!\(market\?\.judge\?\.kr\?\.gate && market\.judge\.kr\.verdict === "risk"\)/.test(app_) && /_jk\.get\("gate"\) and _jk\.get\("verdict"\) == "risk"/.test(notify));
ok("화면에 '판정은 DC에만 사용'·근거 없는 16.9% 같은 옛 문구 없음 — 160", !/DC 판단에만 사용|ETF 배분\(DC\)에만|\+16\.9%·최대낙폭 −28%/.test(app_));
ok("폭 계산 날짜(breadthAsOf)가 데이터에 있음 — 171", !!market.breadthAsOf, "", true);
ok("거래대금 순위 하한 40 (서버·앱 규칙)", /tvr \?\? 0\) >= 40/.test(picksJs) && /tvr"\)? or 0\) >= 40|tvr.*>= 40/.test(py));
const kisJs = T("api/_lib/kis.js") + T("api/_lib/meritz.js"), kisUi = T("src/Kis.jsx");
ok("미국 개장 22:30/23:30 · 마감 05:00/06:00 (앱·감시 2곳)", /dst \? 1350 : 1410/.test(app_) && /dst \? 300 : 360/.test(app_)
  && [T("scripts/watch_alert.py"), T("api/watch.py")].every((t) => /\(22 \* 60 \+ 30, 5 \* 60\) if dst else \(23 \* 60 \+ 30, 6 \* 60\)/.test(t)));
ok("한투 카드는 오늘 탭과 같은 선정 함수 사용", /kisPicks\(stocks, pos, genDay/.test(app_) && !/picks=\{today\?\.pickUs/.test(app_));
ok("계좌 지정가 여유(+0.5%)가 서버 매수 거절선(메리츠 1.5%)보다 작음", (n(/slip: ([\d.]+)/, kisUi) ?? 99) < 1.5 && /q\.last \* 1\.015/.test(T("api/_lib/meritz.js")));

// 자동 수집이 새로 쓰는 파일은 저장(커밋) 목록에 있어야 함 — 빠지면 저장 단계가 통째로 실패 (2026-10-10 picks_log.json 사고)
{ const bs = T("scripts/build_snapshot.py"), yml = T(".github/workflows/daily.yml");
  const consts = Object.fromEntries([...bs.matchAll(/^(\w+) = f"\{OUT_DIR\}\/([\w.]+\.json)"/gm)].map((m) => [m[1], m[2]]));
  const written = new Set([...bs.matchAll(/_write\(f"\{OUT_DIR\}\/([\w.]+\.json)"/g)].map((m) => m[1]));
  for (const [k, f] of Object.entries(consts)) if (new RegExp(`_write\\(${k}\\b`).test(bs) || new RegExp(`open\\(${k}, "w"`).test(bs)) written.add(f);
  const listed = new Set((/for f in ([^;]+); do/.exec(yml)?.[1] || "").trim().split(/\s+/));
  const miss = [...written].filter((f) => !listed.has(f));
  ok(`자동 수집이 쓰는 파일 ${written.size}개가 모두 저장 목록에 있음`, miss.length === 0, `빠짐: ${miss.join(", ")} → .github/workflows/daily.yml 의 for f in 목록에 넣어야 저장 단계가 실패하지 않습니다`);
  ok("저장 전 pull 이 바뀐 파일 때문에 멈추지 않음(--autostash)", /git pull --rebase --autostash origin main/.test(yml));
}

console.log(`\n${bad ? `❌ 다른 곳 ${bad}개` : "✅ 꼭 같아야 하는 값은 모두 같음"}${warn ? ` · ⚠ 갱신 대기 ${warn}개` : ""}`);
process.exit(bad ? 1 : 0);
