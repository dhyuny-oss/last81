"""263. ③ 시장 — 지수 · 섹터 · 폭 · 판정(게이트) · 분기 점검일"""
from snap.common import *  # noqa
from snap.fetch import *  # noqa
from snap.indicators import *  # noqa


# ══════════════════════════════════════════════════════════════
# 시장 · 섹터
# ══════════════════════════════════════════════════════════════
def _run200(c):
    """156. 지수가 200일선 위/아래에 며칠째 있는지 — 양수 = 위 n일째, 음수 = 아래 n일째"""
    if len(c) < 201: return None
    cs = [0.0]
    for v in c: cs.append(cs[-1] + v)
    side = lambda i: c[i] >= (cs[i + 1] - cs[i - 199]) / 200
    last, n, i = side(len(c) - 1), 0, len(c) - 1
    while i >= 199 and side(i) == last: n += 1; i -= 1
    return n if last else -n

def blocked_of(j):
    """그 나라 판정이 '새로 사지 않음'인가 (blocked 가 None = 자료 없음 → 막지 않음)"""
    return bool((j or {}).get("blocked"))


def decide_judge(idx, breadth):
    """시장 판단 — 나라마다 '새로 사도 되는가' 한 가지를 정합니다. blocked=True 면 그 나라는 새로 사지 않음.
       한국 : 폭(200일선 위 종목 비율)의 3년 백분위가 BREADTH_GATE 아래면 막힘 (폭 자료가 없으면 코스피 200일선으로 대신)
       미국 : 나스닥100(^NDX)이 200일선 아래면 막힘 (자료가 없으면 blocked=None — 막지 않고 '확인 안 됨'으로 표시)
       verdict: risk(막힘) / warn(막히진 않았지만 지수가 급락) / safe — 화면·알림의 색과 문구가 모두 이 값을 읽습니다.
       근거 수치(검증 기간·연수익·낙폭)는 config/rules.json 의 _why 한 곳에만 둡니다."""
    judge = {}
    for mkt, tk in (("us", "^NDX"), ("kr", "^KS11")):
        i = idx.get(tk)
        if not i:
            if mkt == "us":   # 나스닥100 을 못 받음 — 막지 않고 '확인 안 됨'으로 (build_snapshot 이 지난 판정이 있으면 그걸 씀)
                judge["us"] = {"verdict": "safe", "why": "판단 보류 (나스닥100 자료 없음)", "index": tk, "blocked": None,
                               "breadth": None, "breadthPct": None, "basis": "나스닥100 200일선"}
            continue
        b = breadth.get(mkt) or {}
        bv, bp = b.get("v"), b.get("pct")
        crash = ((i.get("d1") is not None and i["d1"] <= -5) or
                 (i.get("d21") is not None and i["d21"] <= -15))
        m = i.get("ma200p")
        blocked = None
        if mkt == "kr" and bp is not None:
            blocked = bp < BREADTH_GATE
            if blocked:
                v, why = "risk", f"200일선 위 종목이 적습니다 (폭 {bv:.0f}% · 3년 하위 {bp:.0f}%)"
            elif crash:
                v, why = "warn", f"폭은 괜찮지만 지수가 급락했습니다 (폭 3년 상위 {100-bp:.0f}%)"
            else:
                v, why = "safe", f"200일선 위 종목이 넉넉합니다 (폭 {bv:.0f}% · 3년 상위 {100-bp:.0f}%)"
        elif m is None:
            v, why = "safe", "판단 보류 (지수 자료 없음)"
        else:
            blocked = m < 0
            name, jo, jo2 = ("나스닥100", "이", "은") if mkt == "us" else ("코스피", "가", "는")
            if blocked:  v, why = "risk", f"{name}{jo} 200일선 아래 ({m:+.1f}%)"
            elif crash:  v, why = "warn", f"{name}{jo2} 200일선 위지만 최근 급락"
            else:        v, why = "safe", f"{name} 200일선 위 · 급락 없음"
        judge[mkt] = {"verdict": v, "why": why, "index": tk, "blocked": blocked,
                      "breadth": bv, "breadthPct": bp,
                      "basis": "폭 3년 하위 40%" if mkt == "kr" else "나스닥100 200일선"}
        if mkt == "us":
            judge[mkt]["nq200"] = m                 # 나스닥100 이 200일선보다 몇 % 위(+)·아래(−)
            judge[mkt]["nqRun"] = i.get("run200")   # 그 상태가 며칠째인지 (아래면 음수)
    return judge


def build_breadth(hist):
    """{market: {날짜: [200일선위 종목수, 전체]}} → 비율 시계열 + 오늘의 3년 백분위
       ★ 그날 값이 있는 종목이 너무 적은 날짜는 버립니다.
         상장 초기 구간(분모 1~2종목)과, 수집이 절반만 된 날의 가짜 급변을 막습니다."""
    out = {}
    for mkt, d in hist.items():
        if not d: continue
        maxden = max(e[1] for e in d.values())
        need = max(30, int(maxden * 0.6))
        ts = sorted(t for t, e in d.items() if e[1] >= need)
        if len(ts) < 120: continue
        ts = ts[-BREADTH_DAYS:]
        ser = [(t, d[t][0] / d[t][1] * 100) for t in ts]
        vals = [v for _, v in ser]
        today = vals[-1]
        # ★ 백분위는 정수로 확정해 둡니다.
        #   6.5 를 그대로 넘기면 파이썬 f"{x:.0f}" 는 6, 자바스크립트 Math.round 는 7 을 찍어
        #   같은 화면 안에서 "하위 6%"와 "하위 7%"가 동시에 보입니다.
        pct = int(sum(1 for v in vals if v < today) / len(vals) * 100 + 0.5)
        # 화면용으로 주 1회만 남깁니다 (756 → 약 150포인트)
        thin = ser[::5]
        if thin[-1][0] != ser[-1][0]: thin.append(ser[-1])
        out[mkt] = {"v": round(today, 1), "pct": pct, "n": len(vals),
                    "cov": d[ts[-1]][1], "univ": maxden,
                    "hist": [[t, round(v, 1)] for t, v in thin]}
    return out


SEC_CD = {}   # build_market 이 받은 섹터·KODEX200 캔들 (DC 계산에 재사용)
IDX_CD = {}   # 187. build_market 이 받은 지수 캔들 — 오늘 탭 지수 줄을 누르면 여는 차트용
DC_CD  = {}   # DC 후보 ETF 원본 캔들 (듀얼 모멘텀 12개월 점수용)

def build_market():
    idx = {}
    idxbars = {}          # ★ 차트에 겹쳐 그릴 지수 종가 (시장별 1벌)
    for tk,(label,mkt) in INDICES.items():
        cd,_ = fetch_candles(tk); time.sleep(0.25)
        if len(cd) < 210:
            print(f"  ⚠️ {tk} 캔들 부족 {len(cd)}"); continue
        est = None
        if tk == "^KS11":
            # 101. 야후 코스피 지수가 며칠씩 멈추는 일이 있음 (2026-09 추석 뒤 9/23 에 멈춰 +0.9% 로 표시, 실제 −2.7%)
            #      KODEX 200 이 더 최근 날짜를 갖고 있으면, 멈춘 날 이후를 KODEX 200 등락률로 이어 붙여 '추정'으로 씁니다.
            try:
                kd,_k = fetch_candles(KR_ETF[0]); time.sleep(0.25)
                day = lambda x: datetime.fromtimestamp(x["t"], timezone.utc).strftime("%Y-%m-%d")
                last = day(cd[-1])
                base = next((x for x in reversed(kd) if day(x) == last), None)
                after = [x for x in kd if day(x) > last]
                if base and after:
                    r = cd[-1]["c"] / base["c"]
                    cd = cd + [{"t": x["t"], "o": x["o"] * r, "h": x["h"] * r, "l": x["l"] * r, "c": x["c"] * r, "v": 0} for x in after]
                    est = f"{last} 이후 {len(after)}일은 KODEX 200 으로 추정"
                    print(f"  ⚠️ 코스피 지수가 {last} 에 멈춰 있어 KODEX 200 으로 {len(after)}일 이어 붙임")
            except Exception as e:
                print(f"  ⚠️ 코스피 대체 실패: {str(e)[:60]}")
        IDX_CD[tk] = (cd, label, mkt)
        c=[x["c"] for x in cd]; ma200=sma(c,200)
        idx[tk] = {"label":label,"market":mkt,"c":_r(c[-1],2),
                   "d1":_r(chg(cd,1)),"d3":_r(chg(cd,3)),"d5":_r(chg(cd,5)),"d21":_r(chg(cd,21)),
                   "ma200p": _r((c[-1]/ma200-1)*100) if ma200 else None, "run200": _run200(c),
                   "asOf": datetime.fromtimestamp(cd[-1]["t"],timezone.utc).strftime("%Y-%m-%d"), **({"est": est} if est else {})}
        # 벤치마크 지수만 봉을 남깁니다 (차트 오버레이용, 종목 파일과 같은 200봉)
        if BENCH.get(mkt) == tk:
            keep = cd[-BARS_KEEP:]
            idxbars[mkt] = {"label": label, "tk": tk,
                            "rows": [[x["t"], round(x["c"], 2)] for x in keep]}
        print(f"  {label:8s} {c[-1]:>10,.2f}  1일 {_f(idx[tk]['d1'])}  200일선 {_f(idx[tk]['ma200p'])}")

    risk = {}
    for tk,label in RISK.items():
        cd,_ = fetch_candles(tk); time.sleep(0.25)
        if not cd: continue
        risk[tk] = {"label":label,"c":_r(cd[-1]["c"],3),
                    "d1":_r(chg(cd,1)),"d5":_r(chg(cd,5)),"d21":_r(chg(cd,21)),
                    # ★ 금리는 그 자체가 % 입니다. 상대변화(+6.3%)만 보여주면
                    #   "6.3%포인트 올랐다"로 읽힙니다 → 절대 변화(%p)도 함께.
                    "d21p": _r(cd[-1]["c"]-cd[-22]["c"],3) if len(cd)>22 else None}
    if "^TNX" in risk and "^IRX" in risk:
        risk["curve"] = {"label":"10Y-3M","c":_r(risk["^TNX"]["c"]-risk["^IRX"]["c"],3)}

    # 시장 판단 — 폭이 아직 없는 시점의 임시값. 종목 루프 뒤 decide_judge() 가 다시 씁니다.
    judge = decide_judge(idx, {})

    # 섹터 — ★ 캔들로 직접 계산 (chartPreviousClose 폴백 버그 회피)
    #
    # ★ 점수 방식을 바꿨습니다 (2026-08 검증).
    #   전에는 6개월 수익률 하나로 줄을 세웠습니다. 그런데 워크포워드에서
    #   학습 성적과 검증 성적의 상관이 -0.08 이었습니다 — 과거 성적으로
    #   '최적 룩백'을 고를 수 없다는 뜻입니다. 그래서 고르지 않기로 했습니다.
    #   3·6·9·12개월 수익률의 평균을 점수로 씁니다.
    #     6M 하나  : 지수 대비 +0.57%p (구간 95% [-3.50,+5.11] — 0을 포함)
    #     합의 4종 : 지수 대비 +3.99%p (구간 95% [+0.02,+7.34] — 유일하게 0 위)
    #                샤프 0.50→0.73 · 최대낙폭 -52.2%→-36.8%
    secs=[]
    for tk,label in SECTOR_ETFS.items():
        cd,_m = fetch_candles(tk); time.sleep(0.25)
        SEC_CD[tk] = (cd, _m)
        if len(cd) < 260:                      # 12개월 룩백을 쓰려면 252봉 필요
            print(f"  ⚠️ {tk} 캔들 부족 {len(cd)}"); continue
        c=[x["c"] for x in cd]; ma200=sma(c,200)
        m = {k: chg(cd, n) for k, n in (("m3",63),("m6",126),("m9",189),("m12",252))}
        vals = [v for v in m.values() if v is not None]
        score = sum(vals)/len(vals) if len(vals) == 4 else None   # 4개 다 있어야 점수
        secs.append({"tk":tk,"label":label,"c":_r(c[-1],2),
                     "d1":_r(chg(cd,1)),"d3":_r(chg(cd,3)),"d5":_r(chg(cd,5)),"d21":_r(chg(cd,21)),
                     "m3":_r(m["m3"]),"m6":_r(m["m6"]),"m9":_r(m["m9"]),"m12":_r(m["m12"]),
                     "score":_r(score),
                     "ma200p":_r((c[-1]/ma200-1)*100) if ma200 else None})
        print(f"  {label:8s} 점수 {_f(score)}  (3M {_f(m['m3'])} 6M {_f(m['m6'])} "
              f"9M {_f(m['m9'])} 12M {_f(m['m12'])})")
    secs.sort(key=lambda s: -(s["score"] if s["score"] is not None else -9999))
    for i,s in enumerate(secs): s["rank"] = i+1
    holds = [s["tk"] for s in secs[:3] if (s["score"] or 0) > 0]
    defense = len(holds) < 3

    # ── 한국 배분 — 로테이션이 아니라 '그냥 이것 하나' ──────────
    #   검증: 한국 섹터 ETF 31개를 전부 담아도 연 +5.51% 로 KODEX 200(+10.22%)보다 낮았고,
    #   워크포워드 검증에서 32개 설정 중 9개만 (+), 최대낙폭은 -62% 로 지수(-36%)의 1.7배였습니다.
    #   그래서 고르는 기능을 만들지 않고, 살 대상 하나를 화면에 그대로 띄웁니다.
    kretf = None
    cd,_ = fetch_candles(KR_ETF[0]); time.sleep(0.25)
    if len(cd) >= 260:
        c=[x["c"] for x in cd]; ma200=sma(c,200)
        mm = {k: chg(cd, n) for k, n in (("m3",63),("m6",126),("m9",189),("m12",252))}
        kretf = {"tk": KR_ETF[0], "code": KR_ETF[0].split(".")[0], "label": KR_ETF[1],
                 "c": _r(c[-1], 2), "d1": _r(chg(cd,1)), "d5": _r(chg(cd,5)), "d21": _r(chg(cd,21)),
                 "m3": _r(mm["m3"]), "m6": _r(mm["m6"]), "m9": _r(mm["m9"]), "m12": _r(mm["m12"]),
                 "ma200p": _r((c[-1]/ma200-1)*100) if ma200 else None}
        print(f"  {KR_ETF[1]:8s} {c[-1]:>10,.0f}원  6개월 {_f(mm['m6'])}  200일선 {_f(kretf['ma200p'])}")
    else:
        print(f"  ⚠️ {KR_ETF[0]} 캔들 부족 — 한국 배분 카드는 생략됩니다")

    # ★ 원/달러 — 배분탭이 "얼마 넣어서 몇 주"를 원화로 말하려면 필요합니다
    fx = None
    fx_cd,_ = fetch_candles("USDKRW=X"); time.sleep(0.2)
    if fx_cd: fx = _r(fx_cd[-1]["c"], 2)
    print(f"  USD/KRW  {fx}")

    SEC_CD["069500"] = (cd, {}) if len(cd) >= 260 else SEC_CD.get("069500")
    alloc = build_alloc_state(holds, defense, secs, kretf)
    return {"indices":idx, "risk":risk, "judge":judge, "fx":{"usdkrw":fx}, "idxbars":idxbars,
            "sectors":secs, "allocation":alloc}


# ── 분기 리밸런스 ─────────────────────────────────────────────
# 검증: 월 1회는 비용 0.3%만 되어도 초과수익이 사라졌습니다(연 교체 5.3회).
#       분기 1회는 연 교체 2.0회라 비용 0.5%에서도 남았습니다(+3.2%p).
#       해외주식 양도세 22%까지 생각하면 차이가 더 벌어집니다.
# 그래서 "지금 상위 3개"와 "실제로 들고 있어야 할 3개"를 따로 저장합니다.
# 사이에 순위가 바뀌어도 다음 분기까지는 손대지 않는 것이 규칙입니다.
ALLOC_STATE = f"{OUT_DIR}/alloc_state.json"
REBAL_MONTHS = (1, 4, 7, 10)

def _q(d):  return f"{d.year}Q{(d.month-1)//3 + 1}"

from mktcal import LAST_YEAR as LAST_CAL_YEAR

def _next_rebal(d):
    """다음 비중 점검일 = 그 달 첫 '거래일' (239: 예전엔 1일이라 1/1 휴장일이 그대로 나왔음 · 주말·고정 공휴일을 건너뜀)"""
    def first_trading(y, m):
        x = datetime(y, m, 1, tzinfo=timezone.utc)
        from mktcal import KR_HOL                  # 257. 휴장일 한 파일 (예전엔 고정 공휴일만 · 설·추석·대체공휴일 빠짐)
        while x.weekday() >= 5 or x.strftime("%Y-%m-%d") in KR_HOL or (x.year > LAST_CAL_YEAR and x.strftime("%m-%d") in ("01-01", "03-01", "05-05", "06-06", "08-15", "10-03", "10-09", "12-25")):
            x += timedelta(days=1)
        return x
    for m in REBAL_MONTHS:
        if m > d.month: return first_trading(d.year, m)
    return first_trading(d.year + 1, REBAL_MONTHS[0])

def build_alloc_state(holds, defense, secs, kretf=None):
    now = datetime.now(timezone.utc)
    q, due = _q(now), now.month in REBAL_MONTHS
    try:
        st = json.load(open(ALLOC_STATE, encoding="utf-8"))
    except Exception:
        st = None
    if st is None:
        # 첫 실행 — 지금 순위를 그대로 고정하고, 마지막 리밸런스 분기로 기록합니다
        st = {"quarter": q, "holds": holds, "at": now.strftime("%Y-%m-%d"), "init": True}
    elif due and st.get("quarter") != q:
        st = {"quarter": q, "holds": holds, "at": now.strftime("%Y-%m-%d"),
              "prev": st.get("holds", [])}
    _write(ALLOC_STATE, st)

    locked = st.get("holds", holds)
    lab = {s["tk"]: s["label"] for s in secs}
    rank = {s["tk"]: s["rank"] for s in secs}
    nr = _next_rebal(now)
    return {
        "holds": locked,                       # 지금 들고 있어야 할 3개 (분기 고정)
        "now": holds,                          # 오늘 기준 상위 3개 (참고)
        "defense": defense, "nPositive": len(holds),
        "quarter": st.get("quarter"), "lockedAt": st.get("at"),
        "rebalDue": bool(due and st.get("quarter") == q and not st.get("init")),
        "nextRebal": nr.strftime("%Y-%m-%d"),
        "daysToRebal": (nr - now).days,
        "drift": [{"tk": t, "label": lab.get(t, t), "rank": rank.get(t)}
                  for t in holds if t not in locked],       # 새로 올라온 것
        "dropped": [{"tk": t, "label": lab.get(t, t), "rank": rank.get(t)}
                    for t in locked if t not in holds],     # 밀려난 것
        "method": "3·6·9·12개월 수익률 평균 · 플러스인 것 중 상위 3개 · 동일가중 · 분기 리밸런스",
        "kr": {"bench": KR_ETF[0].split(".")[0], "name": KR_ETF[1], "etf": kretf,
               "rebal": False,
               "note": "한국은 섹터 로테이션을 하지 않습니다. 섹터 ETF 31개를 전부 담아도 연 +5.51%로 "
                       "KODEX 200(+10.22%)보다 낮았고, 검증 구간에서 32개 설정 중 9개만 (+)였으며 "
                       "최대낙폭은 -62%로 지수(-36%)의 1.7배였습니다."}
    }

__all__ = [n for n in dir() if not n.startswith("__")]   # 밑줄 이름(_r · _write …)도 다음 단계가 쓰도록 내보냄
