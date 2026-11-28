/**
 * 184. 증권사 체결 → 내 종목 반영 (순수 함수 — 화면·점검 스크립트가 같이 씁니다)
 *
 * 입력
 *   orders  : 증권사 주문 내역 [{ odno, dt:"YYYYMMDD", side:"buy"|"sell", t, n, filled, fpx, px, open, qty, state }]
 *   rows    : 증권사 잔고 [{ t, n, qty, avg }]
 *   pos     : 앱 내 종목 [{ id, t, role, tr:[{d, px, amt}] }]
 *   applied : 이미 반영했거나 '무시'한 주문번호 Set
 *   ignored : '이번엔 무시'한 잔고 종목 Set
 *   trades  : 앱 매매 기록 — 321. 이미 매매 기록이 된 체결은 다시 제안하지 않음 (applied 는 기기마다 따로라 다른 기기에서 다시 뜨던 사고 · 2026-11-28)
 *
 * 출력
 *   items   : 반영 제안 [{ key, odnos, t, n, side, qty, px, d, kind, posId, label }]
 *             kind = new(새 보유 1회차) · t2(2회차) · add(추가 매수) · close(전량 매도) · partial(일부 매도 — 자동 반영 안 함)
 *   dup     : 앱에 이미 같은 날 기록이 있어 건너뛴 주문번호 (자동으로 '반영됨' 처리)
 *   extra   : 증권사엔 있는데 앱엔 없는 종목 [{ t, n, qty, avg }]
 *   waiting : 체결 대기 중인 매수 [{ t, n, qty, open, px, d }]
 */
const norm = (t) => String(t || "").trim().toUpperCase().replace("/", "-");
const ymd = (s) => (/^\d{8}$/.test(s || "") ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : String(s || "").slice(0, 10));
const dayDiff = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
const sharesOf = (p) => (Array.isArray(p.tr) && p.tr.length ? p.tr : [{ px: p.avg, amt: p.amt || 0 }])
  .reduce((s, t) => s + (t.px > 0 ? (t.amt || 0) / t.px : 0), 0);

export function planFills({ orders = [], rows = [], pos = [], applied = new Set(), ignored = new Set(), from = "", trades = [] } = {}) {
  // 321. 매매 기록에 이미 있는 체결 — 판 날(out)의 매도, 산 날~판 날(in~out) 사이의 매수
  const tOf = new Map();
  for (const x of trades || []) { if (!x?.t || !x.in || !x.out) continue; const k = norm(x.t); if (!tOf.has(k)) tOf.set(k, []); tOf.get(k).push(x); }
  const doneSell = (t, d) => (tOf.get(t) || []).some((x) => x.out === d);
  const doneBuy = (t, d) => (tOf.get(t) || []).some((x) => x.in <= d && d <= x.out);
  // from = 이 날짜(YYYY-MM-DD) 전 체결은 반영하지 않고 '지난 거래'로 넘김 — 자동 반영을 켜기 전 기록을 다시 끌어오지 않게 (2026-10-31 사고)
  // 같은 날 · 같은 종목 · 같은 방향 체결은 하나로 (평균 체결가)
  const groups = new Map();
  for (const o of orders) {
    if (!o || !(o.filled > 0) || applied.has(o.odno)) continue;
    const t = norm(o.t), d = ymd(o.sess || o.dt), key = `${t}|${o.side}|${d}`;   // 🇺🇸 은 미국 장 날짜(sess) — 한국 날짜로 적으면 새벽 체결이 하루 늦게 기록됨
    const g = groups.get(key) || { key, t, n: o.n || "", side: o.side, d, qty: 0, cost: 0, odnos: [] };
    const fp = o.fpx > 0 ? o.fpx : o.px;
    g.qty += o.filled; g.cost += o.filled * fp; g.odnos.push(o.odno);
    groups.set(key, g);
  }
  const items = [], dup = [], old = [];
  // 날짜 순으로 처리해야 '1회차 → 2회차'가 맞게 붙음
  const list = [...groups.values()].sort((a, b) => a.d.localeCompare(b.d) || (a.side === "buy" ? -1 : 1));
  const planned = new Map();             // 이번 묶음 안에서 생길 새 보유 (t → 회차 수)
  const plannedSh = new Map();           // 이번 묶음 안에서 생길 새 보유의 주수 (t → 주수) — 같은 묶음에서 산 뒤 판 것도 정리되게
  for (const g of list) {
    if (from && g.d < from) { old.push(...g.odnos); continue; }
    if (g.side === "sell" ? doneSell(g.t, g.d) : doneBuy(g.t, g.d)) { dup.push(...g.odnos); continue; }   // 321
    const px = g.qty > 0 ? g.cost / g.qty : 0;
    const p = pos.find((x) => norm(x.t) === g.t);
    const tr = p ? (Array.isArray(p.tr) && p.tr.length ? p.tr : [{ d: p.date, px: p.avg, amt: p.amt || 0 }]) : [];
    const base = { key: g.key, odnos: g.odnos, t: g.t, n: g.n, side: g.side, qty: g.qty, px, d: g.d, posId: p?.id ?? null };
    if (g.side === "buy") {
      // 이미 손으로 같은 날(±1일) 기록했으면 중복 — 건너뜀
      if (p && tr.some((x) => x.d && dayDiff(x.d, g.d) <= 1)) { dup.push(...g.odnos); continue; }
      // 330. 기록 첫날보다 앞선 매수는 이미 그 기록(잔고로 넣은 주수)에 들어 있음 — 11/28 '장기로 넣기' 위에 11/25 체결이 2회차로 붙어 88주가 176주가 됨
      const first = tr.map((x) => x.d).filter(Boolean).sort()[0];
      if (p && first && g.d < first) { dup.push(...g.odnos); continue; }
      const k = p ? tr.length : (planned.get(g.t) || 0);
      const kind = k === 0 ? "new" : k === 1 ? "t2" : "add";
      planned.set(g.t, k + 1); if (!p) plannedSh.set(g.t, (plannedSh.get(g.t) || 0) + g.qty);
      items.push({ ...base, kind, label: kind === "new" ? "새 보유 · 1회차" : kind === "t2" ? "기존 보유 · 2회차" : "기존 보유 · 추가 매수" });
    } else {
      if (!p && plannedSh.get(g.t)) {                                // 같은 묶음 안에서 새로 산 종목을 판 것 → 그것까지 정리
        const sh0 = plannedSh.get(g.t), full0 = g.qty >= sh0 * 0.9;
        items.push({ ...base, kind: full0 ? "close" : "partial", label: full0 ? "보유 정리 · 매매 기록에 추가" : `일부 매도(${g.qty} / 약 ${Math.round(sh0)}주) — 카드에서 직접 고쳐 주세요` });
        if (full0) { plannedSh.delete(g.t); planned.delete(g.t); }
        continue;
      }
      if (!p) { dup.push(...g.odnos); continue; }                    // 앱에 없는 종목을 판 것 — 반영할 게 없음
      const sh = sharesOf(p);
      const full = sh <= 0 || g.qty >= sh * 0.9;
      items.push({ ...base, kind: full ? "close" : "partial", label: full ? "보유 정리 · 매매 기록에 추가" : `일부 매도(${g.qty} / 약 ${Math.round(sh)}주) — 카드에서 직접 고쳐 주세요` });
    }
  }
  const have = new Set([...pos.map((x) => norm(x.t)), ...[...plannedSh.keys()]]);
  const extra = rows.filter((r) => r && r.qty > 0 && !have.has(norm(r.t)) && !ignored.has(norm(r.t)))
    .map((r) => ({ t: norm(r.t), n: r.n || "", qty: r.qty, avg: r.avg }));
  const waiting = orders.filter((o) => o && o.side === "buy" && o.open > 0 && !(o.state || "").includes("취소") && !(o.state || "").includes("거부"))
    .map((o) => ({ t: norm(o.t), n: o.n || "", qty: o.qty, open: o.open, px: o.px, d: ymd(o.dt), odno: o.odno }));
  return { items, dup: [...dup, ...old], old, extra, waiting };
}

/** 반영 — 새 내 종목 배열과 매매 기록 추가분을 돌려줍니다 (화면 상태는 부르는 쪽이 바꿈) */
export function applyFills(pos, items, { src = "kis", mOf = () => "us", nameOf = () => "" } = {}) {
  let next = pos.map((p) => ({ ...p, tr: Array.isArray(p.tr) && p.tr.length ? p.tr.map((t) => ({ ...t })) : [{ d: p.date, px: p.avg, amt: p.amt || 0 }] }));
  const trades = [];
  let id = Date.now();
  for (const it of items) {
    const amt = Math.round(it.qty * it.px * 100) / 100;
    const i = next.findIndex((p) => norm(p.t) === it.t);
    if (it.kind === "new" && i < 0) {
      next.push({ id: id++, t: it.t, role: "swing", date: it.d, tr: [{ d: it.d, px: it.px, amt }], src });
    } else if ((it.kind === "t2" || it.kind === "add" || it.kind === "new") && i >= 0) {
      next[i] = { ...next[i], tr: [...next[i].tr, { d: it.d, px: it.px, amt }] };
    } else if (it.kind === "close" && i >= 0) {
      const p = next[i];
      if (p.tr[0]?.d && it.d < p.tr[0].d) continue;     // 321. 산 날보다 앞선 매도는 이 보유의 것이 아님 (11/24 매도가 11/25 매수에 붙었던 사고)
      const inv = p.tr.reduce((s, t) => s + (t.amt || 0), 0), sh = p.tr.reduce((s, t) => s + (t.px > 0 ? (t.amt || 0) / t.px : 0), 0);
      const avg = sh > 0 ? inv / sh : p.tr[0].px;
      const days = Math.max(1, Math.round((Date.parse(it.d) - Date.parse(p.tr[0].d)) / 86400000));
      trades.push({ t: p.t, n: nameOf(p.t) || it.n || p.t, m: mOf(p.t), role: p.role, buy: avg, sell: it.px, in: p.tr[0].d, out: it.d, days,
                    pl: (it.px / avg - 1) * 100, k: p.tr.length, inv, src });
      next = next.filter((_, j) => j !== i);
    }
  }
  return { pos: next, trades };
}

/** 321. 매매 기록 정리 — 똑같은 기록 두 번 · 판 날이 산 날보다 앞선 기록은 뺌 (2026-11-28 12:03 다시 반영 사고로 생긴 2건) */
export function cleanTrades(trades = []) {
  const seen = new Set();
  return (trades || []).filter((x) => {
    if (!x) return false;
    if (x.in && x.out && x.out < x.in) return false;
    const k = [norm(x.t), x.in, x.out, Math.round((x.buy || 0) * 1e4), Math.round((x.sell || 0) * 1e4), Math.round((x.inv || 0) * 100)].join("|");
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

/** 330. 보유 회차 정리 — 가격·금액이 똑같은 회차가 두 번이면 앞선 날 하나만 (잔고로 넣은 뒤 같은 체결이 다시 붙은 경우) · 바뀐 게 없으면 같은 배열 */
export function cleanPos(pos = []) {
  let changed = false;
  const out = (pos || []).map((p) => {
    if (!Array.isArray(p?.tr) || p.tr.length < 2) return p;
    const keep = new Map();
    for (const t of [...p.tr].sort((a, b) => String(a.d || "").localeCompare(String(b.d || "")))) {
      const k = `${Math.round((t.px || 0) * 1e4)}|${Math.round((t.amt || 0) * 100)}`;
      if (!keep.has(k)) keep.set(k, t);
    }
    if (keep.size === p.tr.length) return p;
    changed = true;
    const tr = [...keep.values()];
    return { ...p, tr, date: tr[0]?.d || p.date };
  });
  return changed ? out : pos;
}
