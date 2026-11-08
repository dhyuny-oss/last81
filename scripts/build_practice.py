"""295. 고르기 연습 문제 만들기 — 앱과 같은 계산 코드를 과거 날짜에 그대로 돌려 문제를 만듭니다.

  앱 화면(src/Practice.jsx)은 public/data/practice.json 하나만 읽습니다. 이 파일을 다시 만들 때 실행:

      python scripts/build_practice.py                       # 기본: 미국 60판 + 한국 40판 (+ 필터가 막은 날 '안 사기' 판)
      python scripts/build_practice.py --us 80 --kr 50 --seed 7 --out /tmp/practice.json

  ▣ 같은 코드를 쓰는 곳 (바뀌면 문제도 같이 바뀜)
    지표      scripts/snap/indicators.py  build_stock / supertrend_series / sma_series
    신호      scripts/snap/signals.py     decide_actions   (눌림·강세·추세 · config/rules.json signal)
    후보      거래대금 tvrMin (config/rules.json) · 그날 새로 '매수!'가 된 종목만
    필터      미국 = 나스닥100(^NDX) 종가가 200일선 아래 · 한국 = 폭(200일선 위 종목 비율)의 3년 하위 krBreadthPct%
    성적      다음 날 시가 매수 → 종가가 트레일링선(느린 ST 12,3) 아래로 마감하면 그다음 날 시가 매도 (앱 규칙과 같음)

  ▣ 한계 (화면에도 적습니다)
    · 지금 종목풀에 남은 종목만 표본으로 씀 → 과거에 사라진 종목이 없는 생존편향. '셋 중 상대 비교'라 영향은 줄지만 있음
    · RS·거래대금 백분위와 한국 폭은 표본 종목 안에서 계산한 근사값 (앱은 종목풀 전체)
    · 미국 매출 필터·업종 상한은 과거 재무 자료가 없어 적용하지 않음
"""
import argparse, bisect, json, os, random, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from snap.common import RULES, BREADTH_DAYS  # noqa
from snap.fetch import fetch_candles, fetch_kr  # noqa
from snap.indicators import ST_SET, build_stock, supertrend_series, sma_series, sma  # noqa
from snap.signals import decide_actions  # noqa

PRE = 126          # 신호일 이전 보여 주는 봉수 (6개월) — Practice.jsx 의 PRE 와 같아야 함
HORIZON = 120      # 신호 뒤 최대 추적 봉수 (이때까지 안 팔렸으면 '아직 보유' 로 끊음)
TAIL = 8           # 판 뒤 더 보여 주는 봉수
START = "2021-11-01"   # 2022 하락장을 포함하도록
WHY = {"pull": "눌림", "strong": "강세", "trend": "추세"}
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def day(ts): return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")


def pct_rank(vals, x):
    """build_snapshot.pct_fill 과 같은 순위 백분위 (같은 값은 가운데)"""
    arr = sorted(vals); n = len(arr)
    if n < 10: return None
    lo, hi = bisect.bisect_left(arr, x), bisect.bisect_right(arr, x)
    return round(min(100, max(0, ((lo + hi - 1) / 2) / max(1, n - 1) * 100)), 1)


# ── 자료 받기 (캐시) ────────────────────────────────────────────
def load(tk, m, cache):
    f = os.path.join(cache, tk.replace("^", "_") + ".json")
    if os.path.exists(f):
        try: return json.load(open(f))
        except Exception: pass
    if m == "kr" and not tk.startswith("^"): cd, meta, _ = fetch_kr(tk)      # 지수(^KS11)는 거래소 확정 없이 그대로
    else: cd, meta = fetch_candles(tk)
    out = {"cd": cd, "name": (meta or {}).get("longName") or (meta or {}).get("shortName") or tk}
    if cd: json.dump(out, open(f, "w"))
    time.sleep(0.1)
    return out


class Stock:
    """한 종목의 전체 이력과, 한 번만 계산해 두는 시계열"""
    def __init__(s, t, m, name, sector, cd):
        s.t, s.m, s.name, s.sector, s.cd = t, m, name, sector, cd
        s.c = [x["c"] for x in cd]; s.v = [x.get("v") or 0 for x in cd]
        s.idx = {day(x["t"]): i for i, x in enumerate(cd)}
        s.line, s.dir = supertrend_series(cd, *ST_SET[2])
        s.ma200 = sma_series(s.c, 200)


def cheap_at(stks, d):
    """날짜 d 의 RS·거래대금·200일선 거리 — 종가·거래량만으로 되는 싼 계산 (백분위는 표본 전체로)"""
    raw = {}
    for s in stks:
        j = s.idx.get(d)
        if j is None or j < 260: continue
        r126 = (s.c[j] / s.c[j - 126] - 1) * 100 if s.c[j - 126] else None
        tv = sum(s.c[k] * s.v[k] for k in range(j - 19, j + 1)) / 20
        d200 = (s.c[j] / s.ma200[j] - 1) * 100 if s.ma200[j] else None
        raw[s.t] = (j, r126, tv, d200)
    if len(raw) < 10: return {}
    out = {}
    cols = [[v[i] for v in raw.values() if v[i] is not None] for i in (1, 2, 3)]
    for t, (j, r126, tv, d200) in raw.items():
        out[t] = {"_j": j, "rs": pct_rank(cols[0], r126) if r126 is not None else None,
                  "tvr": pct_rank(cols[1], tv), "d200r": pct_rank(cols[2], d200) if d200 is not None else None}
    return out


def build_set(stks, cheap, tickers):
    """고른 종목만 앱 지표(build_stock)로 계산 → 강도 → 행동 판정 (앱 build_snapshot 과 같은 순서)"""
    by = {s.t: s for s in stks}
    out = {}
    for t in tickers:
        s, c = by[t], cheap[t]; j = c["_j"]
        b = build_stock(t, s.cd[max(0, j - 1000): j + 1], {}, s.name, s.m, s.sector)
        if not b: continue
        b.update(c)
        b["str"] = round((b["rs"] + b["d200r"]) / 2, 0) if (b.get("rs") is not None and b.get("d200r") is not None) else None
        out[t] = b
    decide_actions(out, {})
    return out


def kr_breadth(kr, cal):
    """표본 한국 종목 중 200일선 위 비율(%) — 날짜별. 분모가 너무 작은 날은 버림"""
    res = {}
    for d in cal:
        up = n = 0
        for s in kr:
            j = s.idx.get(d)
            if j is None or s.ma200[j] is None: continue
            n += 1; up += 1 if s.c[j] > s.ma200[j] else 0
        if n >= max(20, int(len(kr) * 0.6)): res[d] = up / n * 100
    return res


def gate_text(m, d, ndx, breadth, cal_kr):
    """그날 '새로 사지 않음'이었나 → (막힘 여부, 이유 문장). 자료가 모자라면 (None, None)"""
    if m == "us":
        j = ndx["idx"].get(d)
        if j is None or ndx["ma"][j] is None: return None, None
        gap = (ndx["c"][j] / ndx["ma"][j] - 1) * 100
        return gap < 0, f"나스닥100이 200일선 {'아래' if gap < 0 else '위'} ({gap:+.1f}%)"
    ds = [x for x in cal_kr if x <= d and x in breadth][-BREADTH_DAYS:]
    if len(ds) < 250 or d not in breadth: return None, None
    vals = [breadth[x] for x in ds]; today = vals[-1]
    p = int(sum(1 for v in vals if v < today) / len(vals) * 100 + 0.5)
    return p < RULES["krBreadthPct"], f"200일선 위 종목 {today:.0f}% (3년 하위 {p}%)"


def outcome(s, j):
    """신호일 j(종가 기준) → 다음 날 시가 매수, 느린 ST 빨강 마감 다음 날 시가 매도. 앱 규칙과 같음"""
    cd = s.cd
    if j + 2 >= len(cd): return None
    buy = cd[j + 1]["o"]
    if not buy: return None
    xi, op = None, False
    last = min(len(cd) - 2, j + HORIZON)
    for k in range(j + 1, last + 1):
        if s.dir[k] is not None and s.dir[k] != 1:    # 느린 ST 빨강 마감
            xi = k; break
    if xi is None:
        xi, op = last, True
    sell = cd[xi + 1]["o"] if not op else cd[xi]["c"]
    if not sell: return None
    peak = max(x["c"] for x in cd[j + 1: xi + 1]) / buy * 100 - 100
    return {"ret": round((sell / buy - 1) * 100, 1), "peak": round(max(peak, 0), 1), "days": xi - j, "xi": xi, "open": op}


def make_row(s, b, j, oc, ma_ok=True):
    cd = s.cd
    base = s.c[j - PRE]
    end = min(len(cd) - 1, oc["xi"] + TAIL)
    seg = range(j - PRE, end + 1)
    rb = lambda v: None if v is None else round(v / base * 100, 1)
    c = [rb(s.c[k]) for k in seg]
    l = []
    for k in seg:
        ln = s.line[k]
        if ln is None: l.append(None)
        else: l.append(rb(ln) if s.dir[k] == 1 else -rb(ln))
    ma = [rb(s.ma200[k]) for k in seg]
    m1, m3, m6, m12 = (round((s.c[j] / s.c[j - n] - 1) * 100, 1) if j - n >= 0 else None for n in (21, 63, 126, 252))
    loss = round((1 - b["stLine"] / b["c"]) * 100, 1) if b.get("stLine") and b.get("c") else None
    return {"t": s.t, "n": s.name, "why": WHY.get(b.get("why"), ""), "str": b.get("str"), "rs": round(b.get("rs") or 0),
            "ma200p": b.get("ma200p"), "loss": loss, "rsi": round(b.get("rsi") or 0), "m1": m1, "m3": m3, "m6": m6, "m12": m12,
            "hi": b.get("w52p"), "atr": b.get("atrp"), "tvr": round(b.get("tvr") or 0), "sd": b.get("slowDays"),
            "c": c, "l": l, "ma": ma, "ret": oc["ret"], "peak": oc["peak"], "days": oc["days"], "open": oc["open"],
            "xi": oc["xi"] - (j - PRE), "cut": bool(oc["open"]), "rule": False, "_why": b.get("why")}


def rank(r): return (1000 if r["_why"] == "trend" else 0) - (r["str"] or 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--us", type=int, default=60); ap.add_argument("--kr", type=int, default=40)
    ap.add_argument("--pool-us", type=int, default=100); ap.add_argument("--pool-kr", type=int, default=70)
    ap.add_argument("--seed", type=int, default=1); ap.add_argument("--out", default=os.path.join(ROOT, "public/data/practice.json"))
    ap.add_argument("--cache", default=os.path.join(os.environ.get("TMPDIR", "/tmp"), "practice_cache"))
    ap.add_argument("--max-blocked", type=int, default=20, help="필터가 막은 날의 '안 사기' 판 수 (시장별 합계)")
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    rng = random.Random(a.seed)
    uni = json.load(open(os.path.join(ROOT, "public/data/universe.json"), encoding="utf-8"))["stocks"]
    old = {}
    try: old = json.load(open(os.path.join(ROOT, "public/data/practice.json"), encoding="utf-8")).get("info", {})
    except Exception: pass
    pools = {}
    for m, n in (("us", a.pool_us), ("kr", a.pool_kr)):
        tks = sorted(t for t, u in uni.items() if u.get("market") == m)
        rng.shuffle(tks); pools[m] = tks[:int(n * (2.0 if m == 'kr' else 1.4))]      # 이력이 모자라거나 거래소를 못 가린 종목을 빼도 n 개가 남도록 여유 (한국은 더 많이)
    print(f"📥 시세 받기: 🇺🇸 {len(pools['us'])} · 🇰🇷 {len(pools['kr'])} + 지수")
    jobs = [(t, m) for m in ("us", "kr") for t in pools[m]] + [("^GSPC", "us"), ("^NDX", "us"), ("^KS11", "kr")]
    with ThreadPoolExecutor(4) as ex:
        res = list(ex.map(lambda j: load(j[0], j[1], a.cache), jobs))
    data = {j[0]: r for j, r in zip(jobs, res)}
    stks = {"us": [], "kr": []}
    for m in ("us", "kr"):
        for t in pools[m]:
            r = data[t]
            if len(r["cd"]) >= 900:                          # 3년 건강도 + 6개월 앞 + 신호 뒤까지 필요
                stks[m].append(Stock(t, m, uni[t].get("label") or r["name"] or t, uni[t].get("sector") or "", r["cd"]))
        stks[m] = stks[m][: (a.pool_us if m == "us" else a.pool_kr)]
        print(f"  {m}: 사용 {len(stks[m])}종목")
    ndx_cd = data["^NDX"]["cd"]
    ndx = {"c": [x["c"] for x in ndx_cd], "idx": {day(x["t"]): i for i, x in enumerate(ndx_cd)}}
    ndx["ma"] = sma_series(ndx["c"], 200)
    cal = {"us": [day(x["t"]) for x in data["^GSPC"]["cd"]], "kr": [day(x["t"]) for x in data["^KS11"]["cd"]]}
    breadth = kr_breadth(stks["kr"], cal["kr"])

    rounds, blocked_pool = [], []
    for m, want in (("us", a.us), ("kr", a.kr)):
        days = [d for d in cal[m] if d >= START][:-(HORIZON + 5)]
        rng.shuffle(days)
        got = 0; tried = 0; t0 = time.time()
        for d in days:
            if got >= want and len(blocked_pool) >= a.max_blocked * 3: break
            tried += 1
            k = cal[m].index(d)
            prev = cal[m][k - 1]
            ch = cheap_at(stks[m], d)
            if not ch: continue
            RSMIN = RULES["signal"]["rsMin"]
            pre = [t for t, c in ch.items() if (c["rs"] or 0) >= RSMIN and (c["tvr"] or 0) >= RULES["tvrMin"]]   # 매수! 조건에 RS·거래대금이 들어 있어 이것만 계산
            today = build_set(stks[m], ch, pre)
            buys = [t for t, b in today.items() if b.get("action") == "buy"]
            if len(buys) < 3: continue
            chp = cheap_at(stks[m], prev)
            was = build_set(stks[m], chp, [t for t in buys if t in chp]) if chp else {}
            new = [t for t in buys if (was.get(t) or {}).get("action") != "buy"]
            if len(new) < 3: continue
            blk, why = gate_text(m, d, ndx, breadth, cal["kr"])
            if blk is None: continue                       # 필터 자료가 모자란 날은 쓰지 않음
            pick = rng.sample(new, 3)
            rows = []
            for t in pick:
                s = next(x for x in stks[m] if x.t == t); b = today[t]
                oc = outcome(s, b["_j"])
                if not oc: break
                rows.append(make_row(s, b, b["_j"], oc))
            if len(rows) < 3: continue
            min(rows, key=rank)["rule"] = True
            rd = {"m": m, "d": d, "nc": len(new), "rows": rows}
            if blk:
                rd["blocked"] = True; rd["gate"] = why
                blocked_pool.append(rd)
            elif got < want:
                got += 1; rounds.append(rd)
            if tried % 20 == 0: print(f"  {m}: 날짜 {tried}개 확인 · 일반 {got} · 막힌 날 {len(blocked_pool)} · {time.time() - t0:.0f}s")
        print(f"  {m}: 일반 {got}판")
    # 막힌 날은 시장별로 고르게, 최대 --max-blocked 판
    rng.shuffle(blocked_pool)
    bl = []
    for m in ("us", "kr"):
        bl += [r for r in blocked_pool if r["m"] == m][: a.max_blocked // 2]
    rounds += bl
    rng.shuffle(rounds)
    for r in rounds:
        for x in r["rows"]: x.pop("_why", None)
    info = {}
    for r in rounds:
        for x in r["rows"]:
            info[x["t"]] = old.get(x["t"]) or [(uni.get(x["t"]) or {}).get("sector") or "", ""]
    out = {"meta": {"n": len(rounds), "made": datetime.now().strftime("%Y-%m-%d"), "pre": PRE, "from": START,
                    "blocked": len(bl), "src": "scripts/build_practice.py",
                    "note": "앱과 같은 계산 코드를 과거 날짜에 돌려 만듦 · 지금 종목풀 표본(생존편향) · RS·거래대금·한국 폭은 표본 안 근사값 · 미국 매출·업종 상한 미적용"},
           "info": info, "rounds": rounds}
    json.dump(out, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"✅ {a.out}: {len(rounds)}판 (안 사기 {len(bl)}) · {os.path.getsize(a.out) / 1e6:.1f}MB")


if __name__ == "__main__":
    main()
