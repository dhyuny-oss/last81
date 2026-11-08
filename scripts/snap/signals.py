"""279. ③ 행동 판정 — buy(매수!) / watch(관망) / sell(매도!) 을 정하는 곳 (이 파일 한 곳)

앱 화면·텔레그램·장중 감시는 여기서 정한 값을 읽기만 합니다. 기준 숫자는 config/rules.json 의 "signal" 한 곳:
  rsMin          같은 시장 6개월 수익률 백분위 하한 (70)
  strongRsi      강세 = 추세 조건 + RSI 이 값 이상 (60)
  pullRsi        눌림(한국) = RSI(14)가 이 값 아래에서 위로 올라온 날 (45) — scripts/snap/indicators.py 가 rsi45 로 계산
  preRisingLo·preTurnRs·preTurnDays   예비(참고용, 매수! 아님)
바꿔 끼울 땐 decide_actions 만 교체하면 됩니다 (입력: stocks · market → 각 종목에 action·why·pull·strong·trend3·dip·pre·sec 를 붙임).
"""
from snap.common import *  # noqa
from snap.indicators import *  # noqa

SIG = RULES["signal"]


def decide_actions(stocks, market):
    # ══════════════════════════════════════════════════════════
    # ★ 행동 판정 — 여기서 한 번만 정합니다. 앱 4개 화면·텔레그램·장중 감시는 이 값을 읽기만 합니다.
    #   action: buy(매수!) / watch(관망) / sell(매도!)   ※ hold(보유)는 '들고 있는지'를 아는 앱 쪽에서 붙입니다
    #   why   : pull(눌림·한국) / strong(강세·한국·미국) / trend(추세) — 왜 매수인지
    #   검증(2008–26): 한국은 RSI 45 회복(눌림)이 모든 구간 +, 미국은 RSI 60 이상(강세)이 세 구간 모두 보유를 이김.
    #   180 (2026-10): 한국에도 강세 추가 — 눌림이 드물어 빈 칸을 약한 추세가 채우던 것을 강세가 대신.
    #     2010–26 한국 5칸·폭 게이트: 후보 순서·기준값(57~63)을 흔든 28번 중 26번이 지금보다 나음 (중앙값 연 19.7% → 24.7%).
    #     강세 신호 하나하나의 120일 지수대비 +7.4%p (눌림 +8.1, 추세 +2.7) · 기준 55~65 어디서나 +6~8%p.
    #   매도는 느린 슈퍼트렌드(12,3) 빨강 하나. −3%·고점−5%·2주 타임컷은 검증에서 성과를 깎아 쓰지 않습니다.
    # ══════════════════════════════════════════════════════════
    for d in stocks.values():
        rs_ok = (d.get("rs") or 0) >= SIG["rsMin"]
        up = bool(d.get("upTrend") and d.get("stSlow") == 1 and rs_ok)
        d["pull"]   = bool(up and d.get("rsi45"))                                            # 한국형
        d["strong"] = bool(up and (d.get("rsi") or 0) >= SIG["strongRsi"])                                # 강세 (한국·미국, 180)
        d["trend3"] = bool(d.get("st") == 3 and d.get("cloud") == 1 and rs_ok)                # 추세 확인형
        d["sig"] = "buy" if d["trend3"] else ("exit" if d.get("stSlow") == 0 else "keep")    # (구버전 호환)
        if d.get("stSlow") == 0:
            d["action"], d["why"] = "sell", "st"
        elif d["m"] == "kr" and d["pull"]:
            d["action"], d["why"] = "buy", "pull"
        elif d["strong"]:
            d["action"], d["why"] = "buy", "strong"
        elif d["trend3"]:
            d["action"], d["why"] = "buy", "trend"
        else:
            d["action"], d["why"] = "watch", None
        # 급락(과매도) 판정 — 참고용. 27번 재검증: 어떤 조합도 주도주 보유를 못 이김 → −40 특별취급 없앰
        dd, hl = d.get("w52p"), d.get("hlt")
        prof = (d.get("fin") or {}).get("prof")
        rebound = bool(d.get("ma20p") is not None and d["ma20p"] > 0)
        if dd is not None and hl is not None and dd <= -25 and hl >= 0.6:
            broken = (d.get("ma200p") or 0) < -50
            d["dip"] = "broken" if broken else ("watch" if (rebound and (prof or d["m"] == "kr")) else "wait")
        else:
            d["dip"] = None
        # 업종 → 섹터 ETF
        if d["m"] == "us" and d.get("t") in _SECTOR_FIX: d["s"] = _SECTOR_FIX[d["t"]]     # 172. 나스닥 분류 ≠ GICS (종목풀 교체 전에도 바로 반영)
        d["sec"] = GICS_TO_ETF.get(d.get("s") or "", None) if d["m"] == "us" else None
        # ★ 예비 후보 (관찰용, 매수! 아님) — 검증(2026-09): '강해질 것 같은' 트리거는 현행을 못 이김.
        #   그래도 다음 매수! 가 나올 자리를 미리 보기 위해 두 가지만 표시합니다.
        #   rising: 추세 유지 · RS 55~70 · 1달 시장대비 플러스   /   turn: 느린ST 초록 전환 3거래일 이내 · RS 50↑ · 200일선 위
        rsv = d.get("rs") or 0
        trend_ok = bool(d.get("upTrend") and d.get("stSlow") == 1)
        if d.get("action") != "buy" and d.get("stSlow") == 1:
            _idx = (market.get("indices") or {}).get("^KS11" if d["m"] == "kr" else ("^IXIC" if d.get("ex") in ("NMS", "NGM", "NCM") else "^GSPC")) or {}
            _rel = (d.get("d21") or 0) - (_idx.get("d21") or 0)
            if trend_ok and SIG["preRisingLo"] <= rsv < SIG["rsMin"] and _rel > 0:
                d["pre"] = "rising"
            elif (d.get("slowDays") or 99) <= SIG["preTurnDays"] and rsv >= SIG["preTurnRs"] and (d.get("ma200p") or -1) > 0:
                d["pre"] = "turn"
            else:
                d["pre"] = None
        else:
            d["pre"] = None

__all__ = [n for n in dir() if not n.startswith("__")]
