/**
 * 96. 오늘 살 것 — 앱이 지금 설정(칸 수·매출 필터)으로 바로 고릅니다.
 *
 * 파이프라인(scripts/build_snapshot.py 의 build_today)과 **같은 규칙을 한 줄씩 옮긴 것**입니다.
 * 규칙을 바꿀 때는 두 곳을 함께 바꾸고, scripts/check_picks.mjs 로 두 결과가 같은지 확인합니다.
 *
 *   후보   : action = buy · 거래대금 백분위 40 이상
 *   빼기   : 적자 · 🇺🇸 재무 자료 없음(224) · 🇺🇸 매출 성장 < 매출 필터(값이 있을 때만) · 이미 보유
 *   순서   : 강세·눌림 먼저 → 강도 점수 높은 순
 *   🇺🇸    : 같은 업종(섹터 ETF)은 하나 · 이미 보유한 종목의 업종도 '사용 중'(161 · 원칙 5) · 최대 slotsUs
 *   🇰🇷    : 최대 slotsKr · 시장 '위험'(폭 3년 하위 40% 아래, krGate)이면 새로 사지 않음(176 · 2010–26 검증 연 11.4% → 24.1%)
 */
export const SLOTS_DEFAULT = { us: 7, kr: 5 };        // 168. 권장 칸 수 = 기본값 (앱·파이프라인·점검 스크립트 공통)
export const KR_GATE_WHY = "시장 위험 — 한국 새로 사지 않음";
export const NO_FIN_WHY = "재무 자료 없음 — 적자 여부 확인 전";
export function pickToday(stocks, { revMin = 10, slotsUs = SLOTS_DEFAULT.us, slotsKr = SLOTS_DEFAULT.kr, krGate = false } = {}, held = new Set(), extra = {}) {
  const { secRank = {}, age = {}, since = {} } = extra;
  const lossOf = (d) => (d.stLine && d.c) ? Math.round((1 - d.stLine / d.c) * 1000) / 10 : null;
  const row = (d) => {
    const f = d.fin || {};
    const sr = secRank[d.sec] || [];
    return {
      t: d.t, n: d.n, m: d.m, why: d.why, rs: d.rs, c: d.c, stLine: d.stLine,
      growth: f.growth ?? null, qyoy: f.qyoy ?? null, accel: f.accel, ma20p: d.ma20p,
      str: d.str, ma200p: d.ma200p, loss: lossOf(d), sec: d.sec, secRank: sr[0] ?? null, secLabel: sr[1] ?? null,
      rev: f.rev ?? null, prof: f.prof, mcap: d.mcap, tv: d.tv, rsi: d.rsi,
      age: age[d.t] ?? null, since: since[d.t] ?? null, held: held.has(d.t), earn: d.earn, earnE: d.earnE,
    };
  };
  const buys = Object.values(stocks).filter(d => d && d.action === "buy" && (d.tvr ?? 0) >= 40).map(row);
  const reasons = (r) => {
    const out = [];
    if (r.prof === false) out.push("적자");
    // 224. 🇺🇸 재무 자료가 아직 없으면(새로 들어온 종목 — 분기 수집 전) 적자·매출 검사를 할 수 없어 뺌. 예전엔 그냥 통과해 적자 회사(GH)가 1위로 나옴
    else if (r.m === "us" && r.prof == null) out.push(NO_FIN_WHY);
    if (revMin > 0 && r.m === "us" && r.growth != null && r.growth < revMin) out.push(`매출 ${r.growth >= 0 ? "+" : ""}${r.growth.toFixed(0)}%`);
    if (r.held) out.push("보유 중");
    return out;
  };
  const rank = (r) => (r.why === "trend" ? 1 : 0) * 1000 - (r.str ?? 0);
  // 점수가 같으면 티커 순 (파이프라인과 같은 순서)
  const cands = buys.slice().sort((a, b) => (rank(a) - rank(b)) || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const excluded = [], us = [], kr = [], used = new Set(), heldSec = {};
  for (const t of held) { const d = stocks[t]; if (d && d.m === "us" && d.sec && !heldSec[d.sec]) heldSec[d.sec] = t; }
  for (const r of cands) {
    const why = reasons(r);
    if (why.length) { excluded.push({ t: r.t, n: r.n, m: r.m, why }); continue; }
    if (r.m === "us") {
      const key = r.sec || `?${r.t}`;
      if (heldSec[key]) { excluded.push({ t: r.t, n: r.n, m: "us", why: [`같은 업종 보유 중(${heldSec[key]})`] }); continue; }
      if (used.has(key)) { excluded.push({ t: r.t, n: r.n, m: "us", why: ["같은 업종 이미 선택"] }); continue; }
      if (us.length < slotsUs) { us.push(r); used.add(key); }
    } else if (krGate) {
      excluded.push({ t: r.t, n: r.n, m: "kr", why: [KR_GATE_WHY] });
    } else if (kr.length < slotsKr) {
      kr.push(r);
    }
  }
  return { pickUs: us, pickKr: kr, excluded, candidates: buys };
}
