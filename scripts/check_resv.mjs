// 249. 매수 예약(api/_lib/resv.js) 시험 — 깃허브·메리츠를 가짜로 바꿔 끼우고 규칙대로 사고/안 사는지 봅니다.
//   실행: node scripts/check_resv.mjs   (실제 주문·저장 없음)
import { INT } from "../api/_lib/meritz.js";
import { addResv, cancelResv, runResv, listResv } from "../api/_lib/resv.js";

process.env.MERITZ_ORDER = "on"; process.env.MERITZ_APP_KEY = "k"; process.env.MERITZ_APP_SECRET = "s";
let FILE = null, SHA = 0, CONFLICT_ONCE = false;
const TODAY = { asOfUs: "2026-11-06", asOfKr: "2026-11-06", cfg: { usGate: false, krGate: false }, candidates: [{ t: "AAA" }, { t: "BBB" }, { t: "CCC" }, { t: "DDD" }, { t: "EEE" }, { t: "005930" }] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes("/contents/public/data/today.json")) return new Response(JSON.stringify(TODAY), { status: 200 });
  if (url.includes("/contents/public/data/resv.json")) {
    if ((init.method || "GET") === "GET") {
      if (!FILE) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ sha: String(SHA), content: Buffer.from(JSON.stringify(FILE)).toString("base64") }), { status: 200 });
    }
    const b = JSON.parse(init.body);
    if (CONFLICT_ONCE) { CONFLICT_ONCE = false; SHA++; return new Response("{}", { status: 409 }); }
    if ((b.sha || null) !== (FILE ? String(SHA) : null)) return new Response("{}", { status: 409 });
    FILE = JSON.parse(Buffer.from(b.content, "base64").toString()); SHA++;
    return new Response(JSON.stringify({ content: { sha: String(SHA) } }), { status: 200 });
  }
  if (url.includes("api.telegram.org")) return new Response("{}", { status: 200 });
  return realFetch(url, init);
};
// 가짜 시각 (Date.now) · 가짜 메리츠
let NOW = 0; const realNow = Date.now; Date.now = () => NOW || realNow();
const at = (iso) => { NOW = Date.parse(iso); };
let Q = {}, IDX = { QQQ: { rate: 0.3 }, SPY: { rate: 0.1 } }, BAL = [], ORD = [], PLACED = [];
INT.getToken = async () => ({ token: "x", exp: Date.now() + 9e6 });
INT.sleep = async () => {};
INT.usBalance = async () => ({ rows: BAL }); INT.krBalance = async () => ({ rows: BAL });
INT.usOrders = async () => ORD; INT.krOrders = async () => ORD;
INT.usQuotes = async (c, ctx, b) => ({ quotes: Object.fromEntries(b.list.map((x) => [x.t, Q[x.t] || null])), idx: IDX });
INT.krQuotes = async (c, ctx, b) => ({ quotes: Object.fromEntries(b.list.map((x) => [x.t, Q[x.t] || null])), idx: { KOSPI: { rate: 0.2 }, KOSDAQ: { rate: -0.4 } } });
INT.placeOrder = async (c, ctx, b) => { PLACED.push(b); return { placed: { odno: "9" + PLACED.length, ...b } }; };
const nyMin = () => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(Date.now())).map((x) => [x.type, x.value])); return { wk: !["Sat", "Sun"].includes(p.weekday), m: +p.hour * 60 + +p.minute }; };
const krMin = () => { const d = new Date(Date.now() + 9 * 3600000); return { wk: d.getUTCDay() >= 1 && d.getUTCDay() <= 5, m: d.getUTCHours() * 60 + d.getUTCMinutes() }; };
INT.regularNow = (KR) => { const x = KR ? krMin() : nyMin(); return x.wk && (KR ? x.m >= 540 && x.m < 930 : x.m >= 570 && x.m < 960); };

let bad = 0;
const ok = (cond, msg) => { console.log(`${cond ? "✅" : "❌"} ${msg}`); if (!cond) bad++; };
const st = (t) => FILE.items.filter((x) => x.t === t).slice(-1)[0];

// ── 1. 토요일 아침(한국)에 예약 → 월요일(11/9) 뉴욕 날짜
at("2026-11-07T01:00:00Z");
for (const t of ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]) await addResv({ t, m: "us", qty: 10, base: 100, line: t === "DDD" ? 99 : 90, asOf: "2026-11-06", ex: "NASD" });
ok(FILE.items.length === 6 && FILE.items.every((x) => x.day === "20261109" && x.status === "wait"), "토요일 예약 → 11/9(월) 확인 · 6건");
let dup = ""; try { await addResv({ t: "AAA", m: "us", qty: 1, base: 100 }); } catch (e) { dup = e.message; }
ok(/이미 예약/.test(dup), "같은 종목 두 번 예약 막음");
let big = ""; try { await addResv({ t: "ZZZ", m: "us", qty: 40, base: 100 }); } catch (e) { big = e.message; }
ok(/상한/.test(big), "1건 상한($3,500) 넘는 예약 막음");
await cancelResv(st("FFF").id); ok(st("FFF").status === "cancel", "취소");

// ── 2. 월요일 개장 전(09:20 뉴욕)에는 아무것도 안 함
at("2026-11-09T14:20:00Z"); let r = await runResv({ only: "us" });
ok(r.done.length === 0 && PLACED.length === 0 && st("AAA").status === "wait", "개장 전 — 그대로 기다림");

// ── 3. 09:40 뉴욕 — 조건별
at("2026-11-09T14:40:00Z");
Q = { AAA: { ex: "NASD", last: 101, base: 100 }, BBB: { ex: "NYSE", last: 103.5, base: 100 }, CCC: { ex: "NASD", last: 94, base: 100 }, DDD: { ex: "NASD", last: 98.5, base: 100 }, EEE: { ex: "NASD", last: 100.2, base: 100 } };
BAL = [{ t: "EEE", qty: 3 }];
r = await runResv({ only: "us" });
ok(PLACED.length === 1 && PLACED[0].t === "AAA" && PLACED[0].px === 101.51 && PLACED[0].qty === 10 && PLACED[0].ex === "NASD" && PLACED[0].rid.startsWith("resv-"), `AAA 주문 — 101 × 1.005 → 101.51 · 10주 (${JSON.stringify(PLACED[0] || {})})`);
ok(st("AAA").status === "sent", "AAA 상태 = 주문 보냄");
ok(st("BBB").status === "skip" && /추격/.test(st("BBB").why), `BBB +3.5% → 추격 안 함 (${st("BBB").why})`);
ok(st("CCC").status === "skip" && /급락/.test(st("CCC").why), `CCC −6% → 급락 (${st("CCC").why})`);
ok(st("DDD").status === "skip" && /트레일링선/.test(st("DDD").why), `DDD 트레일링선 아래 (${st("DDD").why})`);
ok(st("EEE").status === "skip" && /이미/.test(st("EEE").why), `EEE 이미 보유 (${st("EEE").why})`);
r = await runResv({ only: "us" }); ok(PLACED.length === 1, "다시 불러도 두 번 사지 않음");

// ── 4. 시장 급락 · 신호 꺼짐 · 나스닥 필터 · 동시 실행
const fresh = async (t, extra = {}, when = "2026-11-09T22:00:00Z") => { at(when); await addResv({ t, m: "us", qty: 5, base: 50, line: 40, asOf: "2026-11-09", ex: "NASD", ...extra }); };
await fresh("GGG"); await fresh("HHH"); await fresh("III", { asOf: "2026-11-06" });
ok(st("GGG").day === "20261110", "장 마감 뒤 예약 → 다음 날(11/10)");
at("2026-11-10T14:45:00Z"); Q = { GGG: { ex: "NASD", last: 50.5 }, HHH: { ex: "NASD", last: 50.2 }, III: { ex: "NASD", last: 50.1 } }; BAL = [];
IDX = { QQQ: { rate: -2.3 }, SPY: { rate: -1.1 } }; TODAY.asOfUs = "2026-11-09"; TODAY.candidates = [{ t: "GGG" }, { t: "HHH" }];
CONFLICT_ONCE = true;                                  // 다른 실행과 한 번 부딪힘 → 다시 읽고 이어감
r = await runResv({ only: "us" });
ok(st("GGG").status === "skip" && /시장 급락/.test(st("GGG").why), `시장 급락 → 안 삼 (${st("GGG").why})`);
ok(st("III").status === "skip" && /신호가 꺼짐/.test(st("III").why), `새 종가에서 매수! 꺼짐 → 안 삼 (${st("III").why})`);
await fresh("JJJ", {}, "2026-11-10T22:00:00Z"); at("2026-11-11T14:45:00Z"); IDX = { QQQ: { rate: 0.5 }, SPY: { rate: 0.2 } }; TODAY.cfg.usGate = true; TODAY.candidates.push({ t: "JJJ" }); Q.JJJ = { ex: "NASD", last: 50 };
r = await runResv({ only: "us" });
ok(st("JJJ").status === "skip" && /나스닥100/.test(st("JJJ").why), `나스닥100 200일선 아래 → 안 삼 (${st("JJJ").why})`);
TODAY.cfg.usGate = false;

// ── 5. 만료 · 확인 중 끊김
await fresh("KKK", {}, "2026-11-11T22:00:00Z"); at("2026-11-12T19:00:00Z"); r = await runResv({ only: "us" });
ok(st("KKK").status === "expired" && /시간이 지나/.test(st("KKK").why), `확인 시간(개장 뒤 2시간 30분)이 지나면 만료 (${st("KKK").why})`);
await fresh("KK2", {}, "2026-11-11T22:00:00Z"); at("2026-11-13T14:40:00Z"); r = await runResv({ only: "us" });
ok(st("KK2").status === "expired" && /그날/.test(st("KK2").why), `그날 한 번도 못 돌면 다음 날 만료 (${st("KK2").why})`);
await fresh("LLL"); at("2026-11-13T14:40:00Z");
const L = st("LLL"); L.status = "run"; L.ranAt = "2026-11-13T14:30:00Z"; L.day = "20261113";
ORD = [{ t: "LLL", side: "buy", orgn: "", sess: "20261113", odno: "777", px: 50.3, qty: 5, state: "체결", open: 0 }];
r = await runResv({ only: "us" });
ok(st("LLL").status === "sent" && st("LLL").odno === "777", "확인 중 끊긴 예약 → 주문 내역에 있으면 '보냄'으로");
ORD = [];

// ── 6. 🇰🇷 09:10 에 예약 → 오늘 09:30 이후 확인 · 휴장일
at("2026-11-09T00:10:00Z"); await addResv({ t: "005930", m: "kr", qty: 10, base: 100000, line: 90000, asOf: "2026-11-06" });
ok(st("005930").day === "20261109", `🇰🇷 09:10 예약 → 오늘(11/9) ${st("005930").day}`);
at("2026-11-09T00:20:00Z"); r = await runResv({ only: "kr" }); ok(st("005930").status === "wait", "🇰🇷 09:20 — 아직 기다림");
at("2026-11-09T00:35:00Z"); Q["005930"] = { ex: "KRX", last: 101000 }; r = await runResv({ only: "kr" });
const k = PLACED.find((x) => x.t === "005930");
ok(k && k.px === 101600 && k.qty === 10, `🇰🇷 09:35 주문 — 101,000 × 1.005 = 101,505 → 호가 올림 101,600 (${k && k.px})`);
at("2026-12-24T23:50:00Z"); await addResv({ t: "000660", m: "kr", qty: 1, base: 200000, asOf: "2026-12-24" });
ok(st("000660").day === "20261228", `성탄절·주말을 건너뛰어 12/28(월) (${st("000660").day})`);

// ── 7. 끊긴 확인 다시 · 계좌 조회 실패 · 앱 데이터 못 읽음
await fresh("MMM", {}, "2026-11-12T22:00:00Z"); at("2026-11-13T14:50:00Z");
const M_ = st("MMM"); M_.status = "run"; M_.ranAt = "2026-11-13T14:40:00Z"; Q.MMM = { ex: "NASD", last: 50.4 }; TODAY.candidates.push({ t: "MMM" }); TODAY.asOfUs = "2026-11-12";
const n0 = PLACED.length; r = await runResv({ only: "us" });
ok(st("MMM").status === "sent" && PLACED.length === n0 + 1, "확인 중 끊김 + 주문 없음 + 아직 시간 안 → 다시 확인해서 삼");
await fresh("NNN", {}, "2026-11-12T22:00:00Z"); at("2026-11-13T14:55:00Z"); Q.NNN = { ex: "NASD", last: 50.1 }; TODAY.candidates.push({ t: "NNN" });
const bal0 = INT.usBalance; INT.usBalance = async () => { throw new Error("메리츠 서버에 연결하지 못했습니다"); };
r = await runResv({ only: "us" }); INT.usBalance = bal0;
ok(st("NNN").status === "wait" && /조회 실패/.test(st("NNN").note || ""), `계좌 조회 실패 → 기다림으로 되돌림 (${st("NNN").note})`);
const fetch0 = globalThis.fetch; globalThis.fetch = async (u, i) => String(u).includes("today.json") ? new Response("x", { status: 500 }) : fetch0(u, i);
at("2026-11-13T15:05:00Z"); r = await runResv({ only: "us" }); globalThis.fetch = fetch0;
ok(st("NNN").status === "skip" && /today\.json/.test(st("NNN").why), `앱 데이터를 못 읽으면 안 삼 (${st("NNN").why})`);

const L2 = await listResv(); ok(Array.isArray(L2.items) && L2.items.length > 0, "목록");
Date.now = realNow;
console.log(bad ? `\n❌ ${bad}개 실패` : "\n✅ 모두 통과");
process.exit(bad ? 1 : 0);
