"""263. ⑥ 오늘 살 것(today.json) · 신호 장부 · 추천 기록 · 메리츠에 없는 기록"""
from snap.common import *  # noqa
from snap.fetch import *  # noqa
from snap.indicators import *  # noqa
from snap.market import *  # noqa
from snap.signals import *  # noqa
from snap.extras import *  # noqa
from snap.dc import *  # noqa


# ══════════════════════════════════════════════════════════════
# 실전 검증 장부 — 신호가 난 날과 가격을 적어 두고, 그 뒤 실제로 어떻게 됐는지 매일 다시 셉니다.
#   백테스트(생존편향 있음)와 별개로 '앱이 실제로 낸 신호'의 성적입니다. 이게 진짜 검증입니다.
# ══════════════════════════════════════════════════════════════
LOG_FILE = f"{OUT_DIR}/signals_log.json"
LOG_KEEP_DAYS = 400

LIVE = RULES["live"]

def _kr_gate_on(market, date):
    """288. 예전 기록(blk 없음)을 채울 때 — 그 날짜의 한국 폭 백분위가 기준 아래였나. 폭 기록이 없으면 None(모름)"""
    try:
        hist = ((market.get("breadth") or {}).get("kr") or {}).get("hist") or []
        ts = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() + 86400
        vals = [v for t, v in hist if t <= ts]
        if len(vals) < 20: return None
        return (sum(1 for v in vals[:-1] if v < vals[-1]) / (len(vals) - 1) * 100) < BREADTH_GATE
    except Exception:
        return None

def update_signal_log(stocks, series, idx_series, market=None):
    try:
        log = json.load(open(LOG_FILE, encoding="utf-8"))
    except Exception:
        log = []
    today = max((d.get("asOf") or "") for d in stocks.values()) if stocks else ""
    have = {x["t"] for x in log if (today[:10] and x["d"] >= _shift_days(today, -20))}   # 종목당 20거래일 안 한 번
    added = 0
    for t, d in stocks.items():
        if d.get("action") != "buy" or not d.get("asOf") or not d.get("c") or t in have: continue
        f = d.get("fin") or {}
        k = {"pull": "pull", "strong": "strong", "trend": "buy"}.get(d.get("why"), "buy")   # 앱·알림과 같은 근거 하나
        log.append({"d": d["asOf"], "t": t, "n": d.get("n"), "m": d["m"], "k": k, "p": d["c"],
                    "fin": {"rev": f.get("rev"), "qyoy": f.get("qyoy"), "growth": f.get("growth"), "prof": f.get("prof")} if f else None,   # 6개월 뒤 성장주 신호 성적 비교용
                    "sec": d.get("sec"), "both": bool(d.get("strong") and d.get("trend3")),
                    "blk": (blocked_of(((market or {}).get("judge") or {}).get(d["m"])) if ((market or {}).get("judge") or {}).get(d["m"]) else None)})   # 288. 그날 '새로 사지 않음'이던 나라인가
        added += 1
    # 193. 규칙 확정 전(2026-09) 버전이 남긴 '미국 눌림' 기록은 지금 규칙에 없는 신호라 지웁니다 (점검 탭 표에 '눌림 🇺🇸'로 보였음)
    log = [x for x in log if not (x.get("m") == "us" and x.get("k") == "pull")]
    # 옛 기록의 같은 날·같은 종목 중복은 하나로 합칩니다 (강세·추세 둘 다 기록되던 버전)
    seen_dt, dedup = set(), []
    for x in sorted(log, key=lambda x: (x["d"], x["t"], {"pull": 0, "strong": 0, "buy": 1}.get(x["k"], 2))):
        if (x["d"], x["t"]) in seen_dt: continue
        seen_dt.add((x["d"], x["t"])); dedup.append(x)
    log = dedup
    cutoff = _shift_days(today, -LOG_KEEP_DAYS) if today else ""
    log = [x for x in log if x["d"] >= cutoff]
    for x in log:                                         # 288. 옛 기록 채우기 — 한국은 폭 기록으로, 미국은 모르면 None
        if "blk" not in x:
            x["blk"] = _kr_gate_on(market or {}, x["d"]) if x.get("m") == "kr" else None
    # 이후 성과 계산 — 신호일 종가 → 5·10·20거래일 뒤, 그리고 지금까지
    def close_at(rows, date, offset):
        ds = [r[0] for r in rows]
        if date not in ds: return None
        i = ds.index(date) + offset
        return rows[i][1] if 0 <= i < len(rows) else None
    idx_rows = {m: [(r[0], r[1]) for r in v] for m, v in idx_series.items()}
    for x in log:
        ser = series.get(x["t"])           # build_series 는 행 목록을 바로 돌려줍니다
        rows = ser.get("rows") if isinstance(ser, dict) else ser
        if not rows: continue              # ★ 간이 수집라 오늘 안 받은 종목은 지난 성적을 그대로 둡니다 (예전엔 여기서 지워졌음)
        x["r"] = {}
        rr = [(datetime.fromtimestamp(r[0], timezone.utc).strftime("%Y-%m-%d"), r[1]) for r in rows]
        # ★ 57. 규칙대로라면 언제 팔았나 — 신호 다음 날부터 처음으로 느린 ST 가 빨강(stDir 4비트 꺼짐)이 된 날의 종가
        ex_, peak = None, x["p"]
        for r in rows:
            dd = datetime.fromtimestamp(r[0], timezone.utc).strftime("%Y-%m-%d")
            if dd <= x["d"]: continue
            if r[1]: peak = max(peak, r[1])
            if r[10] is not None and not (r[10] & 4):
                ex_ = {"d": dd, "p": r[1]}; break
        x["x"] = ex_
        x["peak"] = _r((peak / x["p"] - 1) * 100, 2) if x.get("p") else None
        ir = idx_rows.get(x["m"], [])
        for h in (5, 10, 20):
            c1 = close_at(rr, x["d"], h); i0 = close_at(ir, x["d"], 0); i1 = close_at(ir, x["d"], h)
            if c1: x["r"][str(h)] = _r((c1 / x["p"] - 1) * 100, 2)
            if c1 and i0 and i1: x["r"][f"x{h}"] = _r((c1 / x["p"] - i1 / i0) * 100, 2)
        c_now = rr[-1][1] if rr else None
        if c_now: x["r"]["now"] = _r((c_now / x["p"] - 1) * 100, 2)
    _write(LOG_FILE, log)
    # 요약 — 20거래일이 지난 신호만 성적으로 칩니다. 288: 그날 '새로 사지 않음'이던 나라의 신호는 앱이 사지 않았을 것이라 따로 셉니다
    def _rule_ret(x):                                     # 290. 규칙대로 = 이탈했으면 이탈가, 아니면 지금까지
        if x.get("x") and x.get("p"): return (x["x"]["p"] / x["p"] - 1) * 100
        return (x.get("r") or {}).get("now")
    def _stat(L, rule_only=False):
        r20 = [x["r"]["20"] for x in L if x.get("r", {}).get("20") is not None]
        ex = [x["r"]["x20"] for x in L if x.get("r", {}).get("x20") is not None]
        rr = [v for v in (_rule_ret(x) for x in L) if v is not None]
        out = {"n": len(r20), "avg": _r(sum(r20) / len(r20), 2) if r20 else None,
               "win": _r(sum(1 for v in r20 if v > 0) / len(r20) * 100, 0) if r20 else None,
               "excess": _r(sum(ex) / len(ex), 2) if ex else None, "med": _r(sorted(r20)[len(r20) // 2], 2) if r20 else None,
               # 290. 규칙대로(이탈까지 보유) 성적 — 20일 고정이 아니라 앱 규칙 그대로
               "rule": {"n": len(rr), "avg": _r(sum(rr) / len(rr), 2) if rr else None,
                        "win": _r(sum(1 for v in rr if v > 0) / len(rr) * 100, 0) if rr else None,
                        "exited": sum(1 for x in L if x.get("x")), "open": sum(1 for x in L if not x.get("x")),
                        "days": len({x["d"] for x in L})}}
        return out
    summ, summ_blk = {}, {}
    for k in ("pull", "buy", "strong"):
        for m in ("kr", "us", "all"):
            base = [x for x in log if x["k"] == k and (m == "all" or x["m"] == m)]
            L = [x for x in base if not x.get("blk") and x.get("r", {}).get("20") is not None]
            if len(L) >= 3: summ[f"{k}:{m}"] = _stat([x for x in base if not x.get("blk")])
            B = [x for x in base if x.get("blk")]
            if len(B) >= 3 and m != "all": summ_blk[f"{k}:{m}"] = _stat(B)
    pending = sum(1 for x in log if x.get("r", {}).get("20") is None)
    done = sum(1 for x in log if x.get("r", {}).get("20") is not None)
    # ★ 드리프트 경보 — 289. 같은 날 몰려 뜬 신호는 한 묶음이라, 최근 N건이 서로 다른 신호일 minDays일 이상일 때만 판정 (필터가 막은 신호는 제외)
    recent = [x for x in log if not x.get("blk") and x.get("r", {}).get("20") is not None][-LIVE["recent"]:]
    drift = None
    if len(recent) >= LIVE["recent"]:
        nd = len({x["d"] for x in recent})
        win = sum(1 for x in recent if x["r"]["20"] > 0) / len(recent) * 100
        ex = [x["r"].get("x20") for x in recent if x["r"].get("x20") is not None]
        exm = sum(ex) / len(ex) if ex else None
        reasons = []
        if nd < LIVE["minDays"]:
            note = f"최근 {len(recent)}건이 신호일 {nd}일에 몰려 있어 판정 보류 (신호일 {LIVE['minDays']}일 이상 필요)"
        else:
            note = None
            if win < LIVE["driftWin"]: reasons.append(f"최근 {len(recent)}건 승률 {win:.0f}% (기준 {LIVE['driftWin']}%)")
            if exm is not None and exm < LIVE["driftExcess"]: reasons.append(f"최근 {len(recent)}건 지수대비 {exm:+.1f}%p")
        drift = {"flag": bool(reasons), "win": _r(win, 0), "excess": _r(exm, 2) if exm is not None else None, "reasons": reasons, "days": nd, "note": note}
        if reasons: print("  🚨 드리프트 경보:", " · ".join(reasons))
    print(f"  📒 실전 장부: 기록 {len(log)}건 (+{added}) · 20일 성적 확정 {done} · 대기 {pending}")
    # 57. 복기 요약 — 이탈한 신호의 규칙 손익과 '판 뒤 더 떨어졌나'
    exited = [x for x in log if x.get("x") and x.get("p")]
    # 162. 앱 점검 탭과 같은 계산 — '판 뒤'는 판 날 다음 종가가 있는 신호만 (오늘 판 것은 아직 비교할 값이 없어 뺌)
    last_px, last_dt = {}, {}
    for x in exited:
        ser = series.get(x["t"]); rows = ser.get("rows") if isinstance(ser, dict) else ser
        if rows:
            last_px[x["t"]] = rows[-1][1]
            last_dt[x["t"]] = datetime.fromtimestamp(rows[-1][0], timezone.utc).strftime("%Y-%m-%d")
    judged = [x for x in exited if x["t"] in last_dt and (x["x"].get("d") or "") < last_dt[x["t"]]]
    good = [x for x in judged if last_px[x["t"]] < x["x"]["p"]]
    review = {"exited": len(exited), "holding": sum(1 for x in log if not x.get("x")),
              "ruleAvg": _r(sum((x["x"]["p"] / x["p"] - 1) * 100 for x in exited) / len(exited), 2) if exited else None,
              "savedPct": _r(len(good) / len(judged) * 100, 0) if judged else None, "savedN": len(good), "judgedN": len(judged)}
    return {"summary": summ, "n": len(log), "pending": pending, "since": min((x["d"] for x in log), default=None), "review": review,
            "drift": drift, "blocked": summ_blk, "kinds": ["pull", "buy", "strong"]}
REV_MIN = RULES["revMin"]        # 앱 '매출 필터' 기본값 — 앱이 settings.revMin 을 보내면 그 값을 씁니다 (61)
LINE_MAX_LOSS = 17  # 트레일링선까지(닿으면 잃는 폭) 17% 넘으면 오늘 후보에서 제외 — 예전 '선까지 20%'(c/선-1)와 같은 기준 (62)

PICKS_LOG = f"{OUT_DIR}/picks_log.json"
def write_picks_log(t, keep=400):
    """today.json 한 장을 picks_log.json 에 날짜별 한 줄로 더합니다 (같은 날짜는 덮어씀 · 최근 keep 일)"""
    if not t or not t.get("asOf"): return
    try:
        log = json.load(open(PICKS_LOG, encoding="utf-8"))
        if not isinstance(log, list): log = []
    except Exception:
        log = []
    row = {"d": t["asOf"], "du": t.get("asOfUs") or t["asOf"], "dk": t.get("asOfKr") or t["asOf"]}   # 211. 시장별 종가 날짜
    for m, key in (("us", "pickUs"), ("kr", "pickKr")):
        free = ((t.get("slots") or {}).get(m) or {}).get("free")
        amt = ((t.get("size") or {}).get(m) or {}).get("amt")
        nbuy = 0 if amt is not None and amt <= 0 else (free if free is not None else len(t.get(key) or []))
        row[m] = [{"t": r["t"], "n": r.get("n"), "i": i + 1, "buy": i < nbuy, "c": r.get("c"), "line": r.get("stLine")}
                  for i, r in enumerate(t.get(key) or [])]
    log = [x for x in log if x.get("d") != row["d"]] + [row]
    log.sort(key=lambda x: x["d"])
    _write(PICKS_LOG, log[-keep:])
    print(f"  📝 picks_log.json: {len(log[-keep:])}일 · 오늘 🇺🇸 살 것 {sum(1 for x in row['us'] if x['buy'])}/{len(row['us'])} · 🇰🇷 {sum(1 for x in row['kr'] if x['buy'])}/{len(row['kr'])}")

from broker_rule import broker_miss      # 299. 규칙 한 곳 (scripts/broker_rule.py)

SEC_CAP = RULES["secCap"]                              # 247. 🇺🇸 같은 업종 최대 종목 수 (src/picks.js SEC_CAP 와 같음)

def pick_with_app_rules(rows, cfg, held_sec):
    """261. '오늘 살 것'을 고르는 규칙은 src/picks.js 의 pickFrom 한 곳 — scripts/pick_cli.mjs 를 node 로 불러 같은 함수를 씀"""
    import subprocess
    here = SCRIPTS_DIR
    out = subprocess.run(["node", os.path.join(here, "pick_cli.mjs")], input=json.dumps({"rows": rows, "cfg": cfg, "heldSec": held_sec}),
                         capture_output=True, text=True, timeout=60, cwd=os.path.join(here, ".."))
    if out.returncode != 0:
        raise RuntimeError(f"오늘 살 것 계산(node pick_cli.mjs) 실패: {out.stderr[-400:]}")
    return json.loads(out.stdout)


def build_today(stocks, market):
    idx = market.get("indices") or {}
    secrank = {x["tk"]: (x["rank"], x["label"]) for x in (market.get("sectors") or [])}
    try:
        wl = json.load(open(f"{OUT_DIR}/watchlist.json", encoding="utf-8"))
    except Exception:
        wl = {}
    _miss = broker_miss(wl)                 # 234. 메리츠에 없는 기록은 보유·칸 계산에서 뺌
    if _miss: wl = {**wl, "positions": [p for p in (wl.get("positions") or []) if str(p.get("t", "")).upper() not in _miss]}
    held = {str(p.get("t", "")).upper() for p in (wl.get("positions") or [])}
    cfg = wl.get("settings") or {}
    rev_min = float(cfg.get("revMin", REV_MIN)); slots_us = int(cfg.get("slotsUs") or RULES["slots"]["us"]); slots_kr = int(cfg.get("slotsKr") or RULES["slots"]["kr"])   # 168. 기본 = 권장 7·5 (src/picks.js SLOTS_DEFAULT)
    # 새로 사지 않는 나라 — judge.{kr,us}.blocked (scripts/snap/market.py decide_judge). 근거 수치는 config/rules.json _why
    _jk = (market.get("judge") or {}).get("kr") or {}
    kr_gate = blocked_of(_jk)
    us_gate = blocked_of((market.get("judge") or {}).get("us"))
    # 98. 1회차 금액 — 앱 💰 투자금(직투 금액 ÷ 칸 수의 절반). 앱이 금액을 보낸 적이 없으면 넣지 않음
    size = {}
    for _m, _amt, _n in (("us", cfg.get("usAmt"), slots_us), ("kr", cfg.get("krAmt"), slots_kr)):
        if _amt is not None:
            _slot = float(_amt) / _n if _n else 0.0
            size[_m] = {"amt": _amt, "slots": _n, "slot": round(_slot, 2), "half": round(_slot / 2, 2)}
    try:
        log = json.load(open(LOG_FILE, encoding="utf-8"))
    except Exception:
        log = []
    # 87. 매수! 된 날 = 장부에서 그 종목의 '가장 최근' 기록일 (장부는 같은 종목을 20일 안에 한 번만 적음 → 최근 기록 = 이번 신호의 첫날)
    #     며칠째 = 그 시장의 장부 날짜 수로 셈 (예전엔 가장 오래된 기록 · 두 시장 날짜를 섞어 셌음)
    first, mdates = {}, {}
    for x in log:
        if x.get("k") not in ("pull", "strong", "buy"): continue
        mdates.setdefault(x.get("m"), set()).add(x["d"])
        if x["t"] not in first or x["d"] > first[x["t"]]: first[x["t"]] = x["d"]
    mdates = {m: sorted(v) for m, v in mdates.items()}
    def age(t):
        d0 = first.get(t); ds = mdates.get((stocks.get(t) or {}).get("m")) or []
        return (len(ds) - ds.index(d0)) if d0 in ds else None
    def rel(d):
        i = idx.get("^KS11" if d["m"] == "kr" else ("^IXIC" if d.get("ex") in ("NMS", "NGM", "NCM") else "^GSPC")) or {}
        return _r(d["d21"] - i["d21"], 1) if d.get("d21") is not None and i.get("d21") is not None else None
    def row(d):
        loss = _r((1 - d["stLine"] / d["c"]) * 100, 1) if (d.get("stLine") and d.get("c")) else None   # 선에 닿으면 잃는 폭 %
        f = d.get("fin") or {}
        return {"t": d["t"], "n": d.get("n"), "m": d["m"], "why": d.get("why"), "rs": d.get("rs"), "c": d["c"], "stLine": d.get("stLine"),
                "growth": f.get("growth"), "qyoy": f.get("qyoy"), "accel": f.get("accel"), "ma20p": d.get("ma20p"),
                "str": d.get("str"), "ma200p": d.get("ma200p"),
                "loss": loss, "rel": rel(d), "sec": d.get("sec"), "secRank": secrank.get(d.get("sec"), (None, None))[0],
                "secLabel": secrank.get(d.get("sec"), (None, None))[1], "rev": f.get("rev"), "prof": f.get("prof"),
                "mcap": d.get("mcap"), "tv": d.get("tv"), "age": age(d["t"]), "since": first.get(d["t"]), "rsi": d.get("rsi"), "held": d["t"] in held,
                "earn": d.get("earn"), "earnE": d.get("earnE"), "pe": d.get("pe"), "fpe": d.get("fpe")}
    buys = [row(d) for d in stocks.values() if d.get("action") == "buy" and (d.get("tvr") or 0) >= RULES["tvrMin"]]
    # 161 · 247. 같은 업종 몫 — 이미 보유한 미국 종목도 그 업종 몫으로 셈
    held_sec = {}
    for p in (wl.get("positions") or []):
        _d = stocks.get(str(p.get("t", "")).upper())
        if _d and _d.get("m") == "us" and _d.get("sec"): held_sec.setdefault(_d["sec"], []).append(_d["t"])
    # ★ 261. 고르는 규칙은 앱과 같은 함수 하나(src/picks.js pickFrom) — node 로 부름. 실패하면 today.json 을 만들지 않고 멈춤(지난 파일 유지)
    P = pick_with_app_rules(buys, {"revMin": rev_min, "slotsUs": slots_us, "slotsKr": slots_kr, "krGate": kr_gate, "usGate": us_gate}, held_sec)
    by_t = {r["t"]: r for r in buys}
    cands = [by_t[t] for t in P["order"]]
    pick_us, pick_kr, excluded = [by_t[t] for t in P["pickUs"]], [by_t[t] for t in P["pickKr"]], P["excluded"]
    # 109. 빈 칸 = 칸 수 − 지금 들고 있는 단기 종목 수. 0 이면 새로 사지 않음 (앱·텔레그램·AI 도구가 같은 숫자를 봄)
    slots = {}
    for _m, _n in (("us", slots_us), ("kr", slots_kr)):
        _h = sum(1 for p in (wl.get("positions") or []) if (p.get("role") or "swing") == "swing"
                 and (str(p.get("t", "")).isdigit() == (_m == "kr")))
        slots[_m] = {"n": _n, "held": _h, "free": max(0, _n - _h)}
    for r in pick_us + pick_kr:                     # 98. 1회차 몇 주 (앱 '오늘 살 것'과 같은 계산)
        h = (size.get(r["m"]) or {}).get("half")
        r["sh"] = int(h // r["c"]) if (h and r.get("c")) else None
    heldrows = []
    for p in (wl.get("positions") or []):
        d = stocks.get(str(p.get("t", "")).upper())
        if not d: heldrows.append({"t": p.get("t"), "state": "데이터 없음"}); continue
        tr = p.get("tr") if isinstance(p.get("tr"), list) and p.get("tr") else ([{"px": p.get("avg"), "amt": 0}] if p.get("avg") else [])
        t2 = None
        if p.get("role") == "swing" and len(tr) == 1 and tr and tr[0].get("px"):
            lo, hi = tr[0]["px"] * RULES["tranche2"]["lo"], tr[0]["px"] * RULES["tranche2"]["hi"]
            after = not tr[0].get("d") or str(d.get("asOf") or "") > str(tr[0]["d"])[:10]   # 1회차를 산 뒤의 종가여야 함 (앱 nextTrancheOf 와 같음)
            t2 = "도달" if (after and lo <= d["c"] <= hi and d.get("stSlow") == 1) else ("추격 금지" if d["c"] > hi else f"목표 {lo:.2f}")
        heldrows.append({"t": d["t"], "n": d.get("n"), "m": d["m"], "c": d["c"], "action": "sell" if d.get("action") == "sell" else "hold",
                         "stLine": d.get("stLine"), "loss": _r((1 - d["stLine"] / d["c"]) * 100, 1) if d.get("stLine") else None,
                         "tranche2": t2, "halted": bool(d.get("halted") or d.get("status")), "earn": d.get("earn"), "earnE": d.get("earnE")})
    dips = [row(d) | {"w52p": d.get("w52p"), "hlt": d.get("hlt")} for d in stocks.values() if d.get("dip") == "watch" and d["m"] == "us"]
    dips.sort(key=lambda r: r.get("w52p") or 0)
    h3 = (market.get("dc") or {}).get("hold3") or {}
    return {"asOf": max((d.get("asOf") or "" for d in stocks.values()), default=None),
            # 211. 시장마다 종가 날짜가 다름 (🇺🇸 은 한국 날짜보다 하루 늦음) — 추천 기록·화면 날짜는 이 값으로
            "asOfUs": max((d.get("asOf") or "" for d in stocks.values() if d.get("m") == "us"), default=None),
            "asOfKr": max((d.get("asOf") or "" for d in stocks.values() if d.get("m") == "kr"), default=None),
            "rules": {"buy": "action=buy", "rev": f"🇺🇸 매출 +{rev_min:.0f}%↑ (최근 분기 전년 동기 대비 → 없으면 4분기 합계 → 연간) · 적자 제외",
                      "order": "강세·눌림 먼저 → 강도(RS 백분위와 200일선 거리 백분위의 평균) 높은 순",
                      "sector": f"🇺🇸 같은 업종은 {SEC_CAP}개까지 — 보유 종목 업종 포함 · 최대 {slots_us} · 🇰🇷 최대 {slots_kr}",
                      "usGate": "🇺🇸 나스닥100 이 200일선 아래면 새로 사지 않음 · 보유는 트레일링선대로" + (" — 지금 작동 중" if us_gate else ""),
                      "krGate": "🇰🇷 시장 '위험'(폭 3년 하위 40% 아래 · 주 1회 계산)이면 새로 사지 않음 · 보유는 트레일링선대로" + (" — 지금 작동 중" if kr_gate else ""),
                      "tranche": "1회차 = 한도 절반 → +3~6% 마감 & 느린 ST 초록이면 나머지 절반 · 매도 = 종가 < 트레일링선"},
            "market": {m: (market.get("judge") or {}).get(m, {}).get("verdict") for m in ("us", "kr")},
            "sectors": [{"tk": x["tk"], "label": x["label"], "rank": x["rank"], "score": x.get("score")} for x in (market.get("sectors") or [])[:6]],
            "cfg": {"revMin": rev_min, "slotsUs": slots_us, "slotsKr": slots_kr, "krGate": kr_gate, "usGate": us_gate, "secCap": SEC_CAP},   # 197. 그림자 기록이 같은 설정으로 고르게
            "candidates": cands, "pickUs": pick_us, "pickKr": pick_kr, "size": size, "slots": slots, "excluded": excluded[:30], "held": heldrows, "brokerMiss": sorted(_miss),
            "dips": dips[:8], "dc": {"hold3": [x["label"] for x in (h3.get("items") or [])]}}

def _shift_days(iso, n):
    try:
        return (datetime.fromisoformat(iso) + timedelta(days=n)).strftime("%Y-%m-%d")
    except Exception:
        return ""

__all__ = [n for n in dir() if not n.startswith("__")]   # 밑줄 이름(_r · _write …)도 다음 단계가 쓰도록 내보냄
