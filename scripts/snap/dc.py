"""263. ⑤ DC(퇴직연금) ETF 신호"""
from snap.common import *  # noqa
from snap.fetch import *  # noqa
from snap.indicators import *  # noqa
from snap.market import *  # noqa
from snap.extras import *  # noqa


def _mom(cd):
    m = {k: chg(cd, n) for k, n in (("m3",63),("m6",126),("m9",189),("m12",252))}
    vals = [v for v in m.values() if v is not None]
    return m, (sum(vals)/len(vals) if len(vals) == 4 else None)

def _vehicle(code, name, synth):
    """국내 상품 — 가격만 (매수 수량 계산용)"""
    if not code: return None
    cd, meta = fetch_candles(code + ".KS", tries=2, min_bars=20); time.sleep(0.2)
    if len(cd) < 2: return {"code": code, "name": name, "synth": synth, "c": None}
    return {"code": code, "name": name, "synth": synth, "c": _r(cd[-1]["c"], 0),
            "d1": _r(chg(cd, 1)), "d21": _r(chg(cd, 21)),
            "asOf": datetime.fromtimestamp(cd[-1]["t"], timezone.utc).strftime("%Y-%m-%d")}

def _state(d):
    """DC 규칙 상태 — 느린 ST 초록이면 보유, 빨강이면 그 몫은 안전자산"""
    if d is None or d.get("stSlow") is None: return "unknown"
    return "hold" if d["stSlow"] == 1 else "wait"

def build_dc(secs, series):
    """반환: (etfs, dc) — etfs 는 차트·추적에서 종목처럼 쓰는 지표 묶음"""
    etfs, rank = {}, {s["tk"]: s for s in secs}
    us_rows = []
    for us, code, name, label, synth in DC_US:
        if us in SEC_CD and SEC_CD[us]:
            cd, meta = SEC_CD[us]
        else:
            cd, meta = fetch_candles(us); time.sleep(0.25)
        if len(cd) < 260:
            print(f"  ⚠️ DC {us} 캔들 부족 {len(cd)}"); continue
        DC_CD[us] = cd
        d = build_stock(us, cd, meta, f"{label} ({us})", "us", label)
        m, sc = _mom(cd)
        d.update({k: _r(v) for k, v in m.items()}); d["score"] = _r(sc)
        d["etf"] = True
        d["veh"] = _vehicle(code, name, synth)
        etfs[us] = d
        series[us] = build_series(cd, min(BARS_KEEP, len(cd)), 2)
        us_rows.append(us)
        v = d["veh"]
        print(f"  {label:8s} {us:5s} → {code or '국내 없음':7s} 점수 {_f(sc)}  "
              f"느린ST {'초록' if d['stSlow']==1 else '빨강'}  ST {d['st']}/3"
              + (f"  국내가 {v['c']:,}" if v and v.get('c') else ""))
    # 한국 코어 + 업종
    kr_rows = []
    for code, name in [DC_KR] + KR_SECT:
        if code in SEC_CD and SEC_CD[code]:
            cd, meta = SEC_CD[code]
        else:
            cd, meta = fetch_candles(code + ".KS"); time.sleep(0.2)
        if len(cd) < 260:
            print(f"  ⚠️ DC {code} 캔들 부족 {len(cd)}"); continue
        DC_CD[code] = cd
        d = build_stock(code, cd, meta, name, "kr", "업종")
        m, sc = _mom(cd)
        d.update({k: _r(v) for k, v in m.items()}); d["score"] = _r(sc)
        d["etf"] = True
        etfs[code] = d
        series[code] = build_series(cd, min(BARS_KEEP, len(cd)), 0 if d["c"] >= 2000 else 2)
        if code != DC_KR[0]: kr_rows.append(code)
    us_core = ["SPY", "QQQ"]
    us_sect = sorted([t for t in us_rows if t not in us_core],
                     key=lambda t: -(etfs[t]["score"] if etfs[t]["score"] is not None else -9999))
    kr_sect = sorted(kr_rows, key=lambda t: -(etfs[t]["score"] if etfs[t]["score"] is not None else -9999))
    spy, k200 = etfs.get("SPY"), etfs.get(DC_KR[0])
    # ★ 182. 3지수 그냥 보유 (듀얼 모멘텀을 대신하는 '수익 쪽' 선택지)
    #   나스닥100·S&P500·코스피200 각 23.3% + 안전자산 30% · 1년에 한 번(1월 첫 거래일) 비중을 원래대로 맞춤 · 환노출 상품.
    #   검증 2008-03~2026-10 원화·비용 0.1%: 연 +12.7% · 최대낙폭 −21% · 샤프 1.07 · 1년 매매 1번
    #     vs 듀얼 모멘텀 +11.9% · −21% · 0.96 · 1년 6번 / 느린ST(기본) +6.3% · −12% · 0.91
    #   3년씩 잘라 보면 62번 중 42번 듀얼보다 나음. 비중 맞춤을 매달·분기·매년 어느 쪽으로 해도 12.4~12.7%로 같음.
    #   ※ 나스닥을 빼면(S&P+코스피) 11.0%로 듀얼보다 낮음 — 나스닥 몫이 핵심.
    qqq = etfs.get("QQQ")
    # ★ 230 · 256. 검증 다시 (2026-11-08 · 2008-03~2026-10 원화 · 비용 0.1% · 안전자산 연 3% · 위험 70/안전 30 · 매년 1월 비중 맞춤)
    #   256: 야후 KODEX200(069500) 자료가 2007-02~2009-04 비어 있어 예전 값(12.4% 등)은 사실상 2009-04부터였음
    #        → 그 구간을 코스피 지수로 이어 붙여 2008 금융위기를 넣고 다시 계산
    #   3지수 보유        연 +11.6% · 최대낙폭 −23.4% · 샤프 0.69 (샤프 = (연수익−3%)/변동성)   (2009-04~ 이면 12.5% · −22.3%)
    #   느린ST 3지수      연 +7.1%  · 최대낙폭 −13.3% · 샤프 0.56 · 몫마다 1년 약 8번 매매       (2009-04~ 이면 7.3%)
    #   느린ST S&P·코스피 연 +6.1%  · 최대낙폭 −15.8% · 샤프 0.42
    #   느린ST S&P·코스피 연 +6.3%  · 최대낙폭 −15.8% · 샤프 0.46  → 3지수가 3년 구간 188개 중 145개에서 나음 · 비용 0.3%·분기 맞춤에도 같음
    #   최대낙폭은 2026-10 코스피 급락(한 달 −17%)이 들어간 값 (그 전까지는 −8~9%)
    EV = {"period": "2008-03~2026-10 원화 · 비용 0.1% · 안전자산 연 3% · 2008 위기 포함(코스피 지수로 보충)"}
    hold3 = {"items": [{"sig": "QQQ", "label": "나스닥100", "buy": (qqq or {}).get("veh")},
                       {"sig": "SPY", "label": "S&P500", "buy": (spy or {}).get("veh")},
                       {"sig": DC_KR[0], "label": "코스피200", "buy": {"code": DC_KR[0], "name": DC_KR[1], "c": (k200 or {}).get("c")}}],   # 226. 주수 계산용 가격
             "w": 0.70 / 3, "asOf": (spy or {}).get("asOf"),
             "rule": "나스닥100·S&P500·코스피200 각 23.3% + 안전자산 30%. 1년에 한 번(1월 첫 거래일)만 비중을 원래대로 맞춤. 그 사이엔 사고팔지 않음.",
             "evidence": {**EV, "cagr": 11.6, "mdd": -23.4, "sharpe": 0.69, "st_cagr": 7.1, "st_mdd": -13.3}}
    # 225. 반도체 고정 칸은 뺐음 — 검증에서 느린ST로 켜고 끄면 3지수 보유보다 연 −0.5%p · 낙폭 거의 같음, 그냥 보유는 나스닥100과 겹치는 베팅
    w3 = round(0.70 / 3, 4)
    dc = {
        "hold3": hold3, "semi": None,
        "weights": DC_WEIGHTS,
        "core": [
            {"key": "nq", "sig": "QQQ", "buy": (qqq or {}).get("veh"), "state": _state(qqq), "label": "미국 나스닥100", "w": w3},
            {"key": "us", "sig": "SPY", "buy": (spy or {}).get("veh"), "state": _state(spy),
             "label": "미국 S&P500", "w": w3},
            {"key": "kr", "sig": DC_KR[0], "buy": {"code": DC_KR[0], "name": DC_KR[1], "synth": False,
                                                 "c": (k200 or {}).get("c")},
             "state": _state(k200), "label": "한국 코스피200", "w": w3},
        ],
        "usCore": us_core, "usSect": us_sect, "krSect": kr_sect,
        "rule": "나스닥100·S&P500·코스피200 각 23.3% + 안전자산 30%. 각 몫은 느린 슈퍼트렌드(12,3)가 초록일 때만 보유, 빨강이면 안전자산.",
        "evidence": {**EV, "cagr": 7.1, "mdd": -13.3, "sharpe": 0.56, "bh_cagr": 11.6, "bh_mdd": -23.4, "bh_sharpe": 0.69},
    }
    return etfs, dc

__all__ = [n for n in dir() if not n.startswith("__")]   # 밑줄 이름(_r · _write …)도 다음 단계가 쓰도록 내보냄
