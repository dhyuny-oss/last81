"""197. 규칙 스스로 점검 — build_snapshot.py 가 매번 부릅니다 (파일 쓰기는 build_snapshot.py 쪽에서).

   ① 그림자 비교 기록 (매일) — 규칙은 그대로 두고 '다른 규칙이었다면 오늘 빈 칸에 뭘 넣었나'를 적고 20거래일 뒤 채점
        sec3 = 🇺🇸 같은 업종 최대 3개 (196) · new = 강도 대신 '최근 신호 먼저'
        서로 다르게 고른 종목만 비교합니다 (같이 고른 종목은 차이를 만들지 않으므로)
   ② 데이터 이상 (매일) — 텔레그램으로 바로 알림
   ③ 성적표 (3주마다 토요일) — 실전 신호 성적 · 매도 규칙이 지켜 줬나 · 그림자 비교 · 규칙을 지켰나
        30건이 안 되면 '판단 보류'. 기준을 넘어도 '검토할 만함'일 뿐 — 규칙을 자동으로 바꾸지 않습니다.
"""
from datetime import datetime, timezone, timedelta

MIN_N = 30            # 이 건수 아래면 판단 보류
SHADOW_DIFF = 2.0     # 그림자 규칙이 20일 평균 +2%p 넘게 나아야 '검토할 만함'
EXCESS_BAD = -2.0     # 신호 20일 지수대비가 −2%p 아래면 '검토할 만함'
SAVED_BAD = 40        # 판 뒤 더 떨어진 비율이 40% 아래면 '검토할 만함' (매도가 손해를 막지 못함)
EVERY_DAYS = 21       # 성적표 간격 (3주)
KST = timezone(timedelta(hours=9))
RULE_NAME = {"sec3": "같은 업종 3개까지", "new": "최근 신호 먼저"}
KIND_NAME = {"strong": "강세", "pull": "눌림", "buy": "추세"}


def _day(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")


def _shift(iso, n):
    try:
        return (datetime.fromisoformat(iso) + timedelta(days=n)).strftime("%Y-%m-%d")
    except Exception:
        return ""


def _avg(v):
    return round(sum(v) / len(v), 2) if v else None


# ── ① 그림자 비교 ─────────────────────────────────────────────
def update_shadow_log(log, shadow, asof, series, keep_days=400):
    log = [x for x in (log or []) if isinstance(x, dict) and x.get("d")]
    added = 0
    if shadow and asof:
        for m, rules in shadow.items():
            act = {x["t"]: x["c"] for x in (rules.get("act") or [])}
            for rule, picks in rules.items():
                if rule == "act":
                    continue
                alt = {x["t"]: x["c"] for x in (picks or [])}
                for side, src, other in (("alt", alt, act), ("act", act, alt)):
                    for t, c in src.items():
                        if t in other or not c:
                            continue
                        # 같은 규칙·같은 쪽·같은 종목은 약 20거래일(28일) 안에 한 번만 — 매일 같은 종목이 겹쳐 세지지 않게
                        if any(x["rule"] == rule and x["side"] == side and x["t"] == t and x["d"] >= _shift(asof, -28) for x in log):
                            continue
                        log.append({"d": asof, "m": m, "rule": rule, "side": side, "t": t, "p": c})
                        added += 1
    for x in log:                                           # 채점 — 그날 종가 → 10·20거래일 뒤 종가
        if x.get("r20") is not None:
            continue
        ser = series.get(x["t"])
        rows = ser.get("rows") if isinstance(ser, dict) else ser
        if not rows:
            continue
        ds = [_day(r[0]) for r in rows]
        if x["d"] not in ds:
            continue
        i = ds.index(x["d"])
        for h in (10, 20):
            if i + h < len(rows) and rows[i + h][1]:
                x[f"r{h}"] = round((rows[i + h][1] / x["p"] - 1) * 100, 2)
    cutoff = _shift(asof, -keep_days) if asof else ""
    return [x for x in log if x["d"] >= cutoff], added


def shadow_summary(log):
    out = {}
    for rule in sorted({x["rule"] for x in log}):
        for m in ("us", "kr"):
            L = [x for x in log if x["rule"] == rule and x["m"] == m]
            if not L:
                continue
            A = [x["r20"] for x in L if x["side"] == "alt" and x.get("r20") is not None]
            B = [x["r20"] for x in L if x["side"] == "act" and x.get("r20") is not None]
            a, b = _avg(A), _avg(B)
            out[f"{rule}:{m}"] = {"nAlt": len(A), "nAct": len(B), "alt": a, "act": b,
                                  "diff": round(a - b, 2) if a is not None and b is not None else None,
                                  "pending": sum(1 for x in L if x.get("r20") is None), "since": min(x["d"] for x in L)}
    return out


# ── ② 데이터 이상 (매일) ───────────────────────────────────────
def anomalies(stocks, etfs, health, positions, now=None):
    now = now or datetime.now(KST)
    out = []
    for w in (health or {}).get("warn") or []:
        out.append(str(w))
    uni = (health or {}).get("universe") or 0
    if uni and (health.get("failed") or 0) > uni * 0.05:
        out.append(f"수집 실패 {health['failed']}/{uni}종목 (5% 넘음)")
    for m, lim in (("us", 4), ("kr", 4)):                 # 주말·연휴를 넘어 4일 넘게 묵은 종가
        a = max((d.get("asOf") or "" for d in stocks.values() if d.get("m") == m), default="")
        if a and a < (now - timedelta(days=lim)).strftime("%Y-%m-%d"):
            out.append(f"{'🇺🇸' if m == 'us' else '🇰🇷'} 종가가 {a} 에 멈춰 있음")
    known = set(stocks) | set(etfs or {}) | {((v.get("veh") or {}).get("code")) for v in (etfs or {}).values()}
    miss = [str(p.get("t")) for p in (positions or []) if str(p.get("t", "")).upper() not in known]
    if miss:
        out.append(f"보유 종목 데이터 없음: {', '.join(miss[:6])} (매도 신호를 볼 수 없음)")
    return out


# ── ③ 성적표 (3주마다) ─────────────────────────────────────────
def adherence(stocks, positions, slots_cfg):
    """지금 보유 상태로 본 '규칙을 지켰나' — 매도! 늦음 · 칸 초과 · 🇺🇸 같은 업종 두 칸"""
    late, by_m, by_sec = [], {"us": 0, "kr": 0}, {}
    for p in positions or []:
        if (p.get("role") or "swing") != "swing":
            continue
        t = str(p.get("t", "")).upper(); d = stocks.get(t)
        m = "kr" if t.isdigit() else "us"
        by_m[m] += 1
        if not d:
            continue
        if d.get("stSlow") == 0 and (d.get("slowDays") or 0) >= 2:
            late.append(f"{d.get('n') if m == 'kr' else t} {d.get('slowDays')}일째")
        if m == "us" and d.get("sec"):
            by_sec.setdefault(d["sec"], []).append(t)
    over = [f"{'🇺🇸' if m == 'us' else '🇰🇷'} {n}/{slots_cfg.get(m)}칸" for m, n in by_m.items() if slots_cfg.get(m) and n > slots_cfg[m]]
    dup = [" · ".join(v) for v in by_sec.values() if len(v) > 1]
    return {"late": late, "over": over, "dupSec": dup}


def build_report(live, shadow_sum, adh, anoms, asof):
    items = []
    summ = (live or {}).get("summary") or {}
    for k, v in sorted(summ.items()):                       # 1. 실전 신호 성적 (20거래일)
        kind, m = k.split(":")
        if m == "all":
            continue
        name = f"{KIND_NAME.get(kind, kind)} {'🇰🇷' if m == 'kr' else '🇺🇸'}"
        ex = v.get("excess")
        st = "wait" if v["n"] < MIN_N else ("review" if ex is not None and ex < EXCESS_BAD else "ok")
        items.append({"g": "신호 성적", "k": k, "st": st, "t": name,
                      "v": f"{v['n']}건 · 20일 평균 {v['avg']:+.1f}% · 지수대비 {ex:+.1f}%p · 오른 비율 {v['win']:.0f}%" if ex is not None else f"{v['n']}건 · 20일 평균 {v['avg']:+.1f}%"})
    rv = (live or {}).get("review") or {}
    if rv.get("judgedN") is not None:                         # 2. 매도 규칙이 지켜 줬나
        n, sp = rv.get("judgedN") or 0, rv.get("savedPct")
        st = "wait" if n < MIN_N else ("review" if sp is not None and sp < SAVED_BAD else "ok")
        items.append({"g": "매도 규칙", "k": "sell", "st": st, "t": "판 뒤 더 떨어졌나",
                      "v": f"판 신호 {n}건 중 {rv.get('savedN', 0)}건({f'{sp:.0f}' if sp is not None else '—'}%)이 판 값보다 지금 더 낮음"})
    for k, v in sorted((shadow_sum or {}).items()):          # 3. 그림자 비교
        rule, m = k.split(":")
        n = min(v["nAlt"], v["nAct"])
        st = "wait" if n < MIN_N else ("review" if (v.get("diff") or 0) >= SHADOW_DIFF else "ok")
        txt = (f"다르게 고른 종목 20일 평균: 그림자 {v['alt']:+.1f}% ({v['nAlt']}건) vs 지금 규칙 {v['act']:+.1f}% ({v['nAct']}건)"
               if v.get("alt") is not None and v.get("act") is not None else f"채점 대기 {v['pending']}건 ({v['since']}부터 기록)")
        items.append({"g": "그림자 비교", "k": k, "st": st, "t": f"{RULE_NAME.get(rule, rule)} {'🇰🇷' if m == 'kr' else '🇺🇸'}", "v": txt})
    a = adh or {}                                            # 4. 규칙을 지켰나 (지금 상태)
    items.append({"g": "규칙 지키기", "k": "late", "st": "warn" if a.get("late") else "ok", "t": "매도! 바로 팔았나",
                  "v": ("매도! 2일 넘게 보유: " + ", ".join(a["late"][:6])) if a.get("late") else "매도! 상태로 남은 종목 없음"})
    items.append({"g": "규칙 지키기", "k": "over", "st": "warn" if (a.get("over") or a.get("dupSec")) else "ok", "t": "칸 수 · 같은 업종",
                  "v": " · ".join(([f"칸 초과 {', '.join(a['over'])}"] if a.get("over") else []) + ([f"🇺🇸 같은 업종 두 칸: {' / '.join(a['dupSec'])}"] if a.get("dupSec") else [])) or "칸 수 안 · 🇺🇸 업종 겹침 없음"})
    if anoms:
        items.append({"g": "데이터", "k": "data", "st": "warn", "t": "데이터 이상", "v": " · ".join(anoms[:4])})
    n_rev = sum(1 for x in items if x["st"] == "review")
    n_warn = sum(1 for x in items if x["st"] == "warn")
    head = (f"검토할 만함 {n_rev}" if n_rev else "규칙 유지") + (f" · 확인 필요 {n_warn}" if n_warn else "")
    return {"at": datetime.now(KST).strftime("%Y-%m-%d"), "asOf": asof, "head": head, "items": items,
            "next": _shift(datetime.now(KST).strftime("%Y-%m-%d"), EVERY_DAYS),
            "rule": f"30건 미만은 판단 보류 · 그림자 규칙이 +{SHADOW_DIFF:.0f}%p 넘게 나을 때만 '검토할 만함' · 규칙은 자동으로 바뀌지 않음"}


def due(prev_report, is_full_saturday):
    """첫 성적표는 바로 · 그 뒤는 3주가 지난 토요일 전체 수집 때"""
    if not prev_report:
        return True
    if not is_full_saturday:
        return False
    return (prev_report.get("at") or "") <= _shift(datetime.now(KST).strftime("%Y-%m-%d"), -(EVERY_DAYS - 1))


def report_text(rep):
    """텔레그램용 (HTML)"""
    mark = {"ok": "✅", "wait": "⏳", "review": "🔎", "warn": "⚠️"}
    L = [f"🧪 <b>규칙 성적표</b> {rep['at'][5:].replace('-', '/')} — {rep['head']}"]
    g0 = None
    for x in rep["items"]:
        if x["g"] != g0:
            L.append(f"<b>{x['g']}</b>"); g0 = x["g"]
        L.append(f"{mark.get(x['st'], '·')} {x['t']}: {x['v']}")
    L.append(f"<i>{rep['rule']} · 다음 성적표 {rep['next'][5:].replace('-', '/')}</i>")
    return "\n".join(L)
