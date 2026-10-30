"""
197. 규칙 스스로 점검 — 보고와 표시만 합니다. 규칙(매수!·매도!·오늘 살 것)은 절대 바꾸지 않습니다.
─────────────────────────────────────────────
  ① 데이터 이상 (매일)   날짜가 멈춤 · 수집 실패 · 빈 값 · 같은 회사 중복 · 하루 ±35% 넘는 급변
  ② 대안 그림자 기록 (매일)  같은 날 후보로 '만약 이랬다면'을 따로 적어 둡니다 — 실제 추천에는 안 씀
       기준   = 지금 규칙 (강도 순 · 🇺🇸 같은 업종 하나)
       업종3  = 🇺🇸 같은 업종 최대 3개
       최신순 = 매수! 된 지 오래 안 된 순
       비상−10% = 기준 종목을 사고 종가가 −10% 닿으면 바로 판다면
     성적 = 그날 고른 종목을 20거래일 들고 있었을 때 평균 수익률 (기록이 쌓인 것만)
  ③ 3주 보고 (3주마다 토요일)  신호 종류별 성적 · 판 뒤 더 떨어진 비율 · 그림자 비교 · 처리 안 된 매도!
결과: public/data/self_check.json → 앱 점검 탭 카드 · 텔레그램(notify.py)
"""
import json, os
from datetime import datetime, timezone, timedelta, date

KST = timezone(timedelta(hours=9))
SHADOW_FILE = "shadow_log.json"
OUT_FILE = "self_check.json"
REPORT_ANCHOR = date(2026, 10, 31)      # 첫 보고 토요일 — 여기서 21일마다
H = 20                                  # 성적 = 20거래일 뒤
MIN_DAYS, MIN_PICKS = 8, 30             # 판정은 이만큼 쌓인 뒤에만 (그 전엔 '쌓는 중')
GAP = 1.5                               # 대안이 기준보다 평균 1.5%p 넘게 나아야 '검토 후보'


def _load(path, default):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:
        return default


def _r(v, n=2):
    return None if v is None else round(float(v), n)


def _day(ts):          # 차트 파일 시각: 🇰🇷 그날 00:00 UTC · 🇺🇸 그날 13:30 UTC → UTC 날짜가 곧 거래일
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")


def next_report(today):
    if today <= REPORT_ANCHOR: return REPORT_ANCHOR
    return today + timedelta(days=(21 - (today - REPORT_ANCHOR).days % 21) % 21)


# ─────────────────────────── ① 데이터 이상
def anomalies(stocks, health, today_kst):
    out = []
    add = lambda lvl, msg: out.append({"lvl": lvl, "msg": msg})
    for m, flag, lim in (("kr", "🇰🇷", 4), ("us", "🇺🇸", 5)):
        L = [d for d in stocks.values() if d.get("m") == m]
        if not L:
            add("err", f"{flag} 종목이 하나도 없습니다"); continue
        top = max((d.get("asOf") or "") for d in L)
        try:
            lag = (today_kst - date.fromisoformat(top[:10])).days
        except Exception:
            lag = 99
        if lag > lim: add("err", f"{flag} 가격 날짜가 {top[:10]} 에 멈춤 ({lag}일 전)")
        old = [d for d in L if (d.get("asOf") or "") < top]
        if len(old) > 0.05 * len(L): add("warn", f"{flag} {len(old)}종목이 최신 날짜가 아님 ({', '.join(d['t'] for d in old[:5])}…)")
        miss = [d for d in L if d.get("c") is None or d.get("stLine") is None or d.get("str") is None]
        if len(miss) > 0.03 * len(L): add("warn", f"{flag} 가격·선·강도 빈 값 {len(miss)}종목")
        if m == "us":
            nf = [d for d in L if not d.get("fin")]
            if len(nf) > 0.15 * len(L): add("warn", f"🇺🇸 재무(매출) 없음 {len(nf)}/{len(L)} — 매출 필터가 덜 걸러짐")
    uni = (health or {}).get("universe") or 0
    fails = (health or {}).get("failed") or 0
    if uni and fails > 0.03 * uni: add("warn", f"수집 실패 {fails}/{uni}")
    names = {}
    for d in stocks.values():
        k = (d.get("m"), str(d.get("n") or "").lower().replace(" class a", "").replace(" class b", "").strip(" .,"))
        if k[1]: names.setdefault(k, []).append(d["t"])
    dup = [v for v in names.values() if len(v) > 1]
    if dup: add("warn", "같은 회사 중복: " + " · ".join("/".join(v) for v in dup[:5]))
    jump = [d for d in stocks.values() if d.get("d1") is not None and abs(d["d1"]) > 35 and not d.get("status")]
    if jump: add("info", "하루 ±35% 넘는 급변(데이터 확인): " + " · ".join(f"{d['t']} {d['d1']:+.0f}%" for d in jump[:6]))
    return out


# ─────────────────────────── ② 그림자 기록
def _variants(cands, cfg):
    rev_min, su, sk, gate = cfg.get("revMin", 10), cfg.get("slotsUs", 7), cfg.get("slotsKr", 5), cfg.get("krGate", False)
    ok = [r for r in cands if r.get("prof") is not False
          and not (rev_min > 0 and r["m"] == "us" and r.get("growth") is not None and r["growth"] < rev_min)]
    strength = lambda r: ((1 if r.get("why") == "trend" else 0) * 1000 - (r.get("str") or 0), r["t"])
    newest = lambda r: (r.get("age") if r.get("age") is not None else 999,) + strength(r)

    def pick(order, cap):
        us, kr, used = [], [], {}
        for r in sorted(ok, key=order):
            if r["m"] == "us":
                key = r.get("sec") or f"?{r['t']}"
                if used.get(key, 0) >= cap or len(us) >= su: continue
                us.append(r); used[key] = used.get(key, 0) + 1
            elif not gate and len(kr) < sk:
                kr.append(r)
        return {"us": [[r["t"], r["c"]] for r in us], "kr": [[r["t"], r["c"]] for r in kr]}
    return {"base": pick(strength, 1), "cap3": pick(strength, 3), "newest": pick(newest, 1)}


VAR_NAME = {"base": "지금 규칙", "cap3": "같은 업종 3개까지", "newest": "최신순", "stop10": "비상 −10% 손절"}


def shadow(out_dir, today_obj, series, stocks):
    """기록 한 줄 = 그날(시장별 최신 거래일) 세 가지 고르기. 🇰🇷·🇺🇸 날짜가 달라 시장마다 따로 적습니다 ({d, m, base, cap3, newest})"""
    log = _load(f"{out_dir}/{SHADOW_FILE}", [])
    if not isinstance(log, list): log = []
    if today_obj and today_obj.get("cfg"):
        V = _variants(today_obj.get("candidates") or [], today_obj["cfg"])
        for m in ("us", "kr"):
            d0 = max((d.get("asOf") or "" for d in stocks.values() if d.get("m") == m), default="")[:10]
            if not d0: continue
            row = {"d": d0, "m": m, **{v: {m: V[v][m]} for v in V}}
            old = next((x for x in log if x.get("d") == d0 and x.get("m") == m), None)
            if old: row["r"] = old.get("r", {})
            log = [x for x in log if not (x.get("d") == d0 and x.get("m") == m)] + [row]
    log.sort(key=lambda x: (x["d"], x.get("m", ""))); log = log[-600:]

    # 20거래일 성적 — 계산된 값은 기록에 남겨 다음에 다시 안 셈 (차트 파일이 없어져도 유지)
    days_cache = {}
    def path(t, m):
        if t not in days_cache:
            rows = series.get(t) or []
            if isinstance(rows, dict): rows = rows.get("rows") or []
            days_cache[t] = ([_day(r[0]) for r in rows], [r[1] for r in rows])
        return days_cache[t]
    for x in log:
        res = x.setdefault("r", {})
        for v in ("base", "cap3", "newest"):
            for m in ("us", "kr"):
                for t, c in x.get(v, {}).get(m, []):
                    key = f"{m}:{t}"
                    if key in res or not c: continue
                    ds, cs = path(t, m)
                    if x["d"] not in ds: continue
                    i = ds.index(x["d"])
                    if i + H >= len(cs) or not cs[i + H]: continue
                    seg = [p for p in cs[i + 1:i + H + 1] if p]
                    hit = next((p for p in seg if p <= c * 0.9), None)
                    res[key] = [_r((cs[i + H] / c - 1) * 100), _r((hit / c - 1) * 100) if hit else None]
    _write(f"{out_dir}/{SHADOW_FILE}", log)

    def score(v, m):
        vals, nd = [], 0
        for x in log:
            src = "base" if v == "stop10" else v
            L = [x["r"].get(f"{m}:{t}") for t, _ in x.get(src, {}).get(m, [])]
            L = [a for a in L if a]
            if not L: continue
            nd += 1
            vals += [(a[1] if (v == "stop10" and a[1] is not None) else a[0]) for a in L]
        return {"days": nd, "n": len(vals), "avg": _r(sum(vals) / len(vals)) if vals else None,
                "win": _r(sum(1 for a in vals if a > 0) / len(vals) * 100, 0) if vals else None}
    summ = {}
    for m, vs in (("us", ("base", "cap3", "newest", "stop10")), ("kr", ("base", "newest", "stop10"))):
        sc = {v: score(v, m) for v in vs}
        b = sc["base"]
        for v, s in sc.items():
            ready = s["days"] >= MIN_DAYS and s["n"] >= MIN_PICKS and b["n"] >= MIN_PICKS
            s["name"] = VAR_NAME[v]
            if v == "base": s["verdict"] = "기준" if ready else f"쌓는 중 ({s['n']}/{MIN_PICKS}건)"
            elif not ready: s["verdict"] = f"쌓는 중 ({s['n']}/{MIN_PICKS}건)"
            else:
                g = s["avg"] - b["avg"]
                s["gap"] = _r(g)
                s["verdict"] = f"대안이 {g:+.1f}%p — 검토 후보" if g > GAP else (f"대안이 {g:+.1f}%p — 지금 규칙 유지" if g < -GAP else f"차이 {g:+.1f}%p — 작음")
        summ[m] = sc
    return {"days": len(log), "since": log[0]["d"] if log else None, "summary": summ}


# ─────────────────────────── ③ 3주 보고
KIND = {"buy": "추세", "strong": "강세", "pull": "눌림"}


def signal_check(live):
    out = []
    for k, v in ((live or {}).get("summary") or {}).items():
        kind, m = k.split(":")
        if m == "all": continue
        flag = "🇰🇷" if m == "kr" else "🇺🇸"
        if v["n"] < MIN_PICKS:
            out.append({"k": f"{KIND.get(kind, kind)} {flag}", "n": v["n"], "verdict": f"쌓는 중 ({v['n']}/{MIN_PICKS}건)", **v}); continue
        ex = v.get("excess")
        verdict = ("지수보다 나음 — 기대대로" if (ex or 0) > 0 and v["win"] >= 40
                   else "지수보다 못함 — 다음 보고까지 지켜보기" if (ex or 0) < 0 else "지수와 비슷")
        out.append({"k": f"{KIND.get(kind, kind)} {flag}", "verdict": verdict, **v})
    return sorted(out, key=lambda x: x["k"])


def held_sells(stocks, wl, prev, today_s):
    since, out = {}, []
    old = (prev or {}).get("sellSince") or {}
    for p in (wl or {}).get("positions") or []:
        t = str(p.get("t", "")).upper(); d = stocks.get(t)
        if not d or d.get("action") != "sell" or p.get("role") == "long": continue   # 장기는 매도 규칙 밖
        since[t] = old.get(t) or today_s
        n = (date.fromisoformat(today_s) - date.fromisoformat(since[t])).days
        out.append({"t": t, "n": d.get("n"), "m": d.get("m"), "since": since[t], "days": n})
    return since, sorted(out, key=lambda x: -x["days"])


def run(out_dir, stocks, series, market, health):
    now = datetime.now(KST); today = now.date(); today_s = today.isoformat()
    prev = _load(f"{out_dir}/{OUT_FILE}", {})
    wl = _load(f"{out_dir}/watchlist.json", {})
    an = anomalies(stocks, health, today)
    sh = shadow(out_dir, market.get("today"), series, stocks)
    live = market.get("live") or {}
    since, sells = held_sells(stocks, wl, prev, today_s)
    nxt = next_report(today)
    due = today.weekday() == 5 and (today - REPORT_ANCHOR).days % 21 == 0 and today >= REPORT_ANCHOR
    rv = live.get("review") or {}
    report = {"date": today_s if due else (prev.get("report") or {}).get("date"),
              "next": nxt.isoformat() if not due else (today + timedelta(days=21)).isoformat(),
              "signals": signal_check(live),
              "saved": {"pct": rv.get("savedPct"), "n": rv.get("judgedN"), "ruleAvg": rv.get("ruleAvg")},
              "drift": live.get("drift"),
              "shadow": sh, "sells": sells,
              # 204. 매도! 상태에서 장기로 바꾼 종목 — 규칙을 피해 간 것인지 돌아보기용
              "conv": [{"t": str(p.get("t", "")).upper(), "d": c.get("d"), "n": (stocks.get(str(p.get("t", "")).upper()) or {}).get("n")}
                       for p in (wl or {}).get("positions") or [] if p.get("role") == "long" for c in (p.get("conv") or []) if c.get("sell")]}
    obj = {"at": now.strftime("%Y-%m-%d %H:%M"), "anomalies": an, "report": report, "due": due, "sellSince": since,
           "note": "보고·표시만 합니다 — 규칙은 사람이 확인하고 바꿉니다"}
    _write(f"{out_dir}/{OUT_FILE}", obj)
    lv = {"err": "❌", "warn": "⚠️", "info": "ℹ️"}
    print(f"\n🔎 규칙 점검 — 데이터 이상 {len(an)}건 · 그림자 기록 {sh['days']}일 · 처리 안 된 매도! {len(sells)} · 다음 3주 보고 {report['next']}{' (오늘)' if due else ''}")
    for a in an: print(f"  {lv.get(a['lvl'], '·')} {a['msg']}")
    return obj


# ─────────────────────────── 텔레그램 글 (notify.py 가 씀)
def report_text(o):
    r = o.get("report") or {}
    L = ["<b>🔎 알파터미널 3주 점검</b>", "<i>보고만 합니다 — 규칙은 자동으로 바뀌지 않습니다</i>", ""]
    L.append("<b>① 신호별 성적 (20거래일 · 쌓인 기록만)</b>")
    for s in r.get("signals") or []:
        L.append(f"· {s['k']} {s['n']}건" + (f" 평균 {s['avg']:+.1f}% · 승률 {s['win']:.0f}% · 지수대비 {s['excess']:+.1f}%p" if s.get("excess") is not None and s['n'] >= MIN_PICKS else "") + f" → {s['verdict']}")
    sv = r.get("saved") or {}
    if sv.get("pct") is not None: L.append(f"· 판 뒤 더 떨어진 비율 {sv['pct']:.0f}% ({sv['n']}건) — 50% 넘으면 파는 규칙이 제 몫을 함")
    if (r.get("drift") or {}).get("flag"): L.append("🚨 드리프트: " + " · ".join(r["drift"]["reasons"]))
    L += ["", "<b>② 대안 비교 (같은 날 후보 · 20거래일 들고 있었다면)</b>"]
    for m, flag in (("us", "🇺🇸"), ("kr", "🇰🇷")):
        for v, s in ((r.get("shadow") or {}).get("summary") or {}).get(m, {}).items():
            L.append(f"· {flag} {s['name']}: " + (f"평균 {s['avg']:+.1f}% ({s['n']}건) · " if s.get("avg") is not None else "") + s["verdict"])
    L += ["", "<b>③ 처리 안 된 매도!</b>"]
    sells = r.get("sells") or []
    L += [f"· {x['n'] if x['m'] == 'kr' else x['t']} — 매도! {x['days']}일째" for x in sells] or ["· 없음"]
    if r.get("conv"): L += ["⚠️ 매도! 상태에서 장기로 바꿈: " + " · ".join(f"{x['n'] if str(x['t']).isdigit() else x['t']} ({x['d']})" for x in r["conv"])]
    an = o.get("anomalies") or []
    if an: L += ["", "<b>데이터 이상</b>"] + [f"· {a['msg']}" for a in an]
    L += ["", f"다음 보고 {r.get('next')}"]
    return "\n".join(L)


def anomaly_text(o):
    an = [a for a in (o.get("anomalies") or []) if a["lvl"] in ("err", "warn")]
    if not an: return None
    return "\n".join(["<b>⚠️ 알파터미널 데이터 점검</b>"] + [f"· {a['msg']}" for a in an] + ["", "<i>앱 점검 탭에서도 볼 수 있습니다</i>"])


def _write(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)
