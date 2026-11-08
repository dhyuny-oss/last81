"""263. 스냅샷 파이프라인 공통 — 설정·상수·작은 도구 (scripts/build_snapshot.py 가 단계별 모듈로 나뉘며 생김)
   단계: snap.fetch(시세 받기) → snap.indicators(지표) → snap.market(시장·폭·판정) → snap.extras(재무·실적·목표가)
         → snap.dc(DC ETF) → snap.today(오늘 살 것·기록) → build_snapshot.main(순서대로 실행·저장)
   각 단계는 앞 단계 이름을 모두 받아 씀(from snap.<앞> import *) — 단계 하나만 고치거나 바꿔 끼울 수 있음
"""
import os as _os, sys as _sys
SCRIPTS_DIR = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))     # scripts/
if SCRIPTS_DIR not in _sys.path: _sys.path.insert(0, SCRIPTS_DIR)
import html as _htmllib
import json, os, sys, time, math, urllib.request
from datetime import datetime, timezone, timedelta

VERSION = "7.14.0"
UA        = {"User-Agent": "Mozilla/5.0"}
OUT_DIR   = "public/data"
KST       = timezone(timedelta(hours=9))
BARS_KEEP   = 200        # 차트에 보관할 봉수 (약 10개월)
RS_LOOKBACK = 126        # RS 백분위 기준 기간 (6개월) — 검증으로 정한 값
MIN_BARS  = 130          # 이보다 적으면 지표 일부 생략
# ── 시장 '폭' = 200일선 위 종목 비율 ─────────────────────────
#   백테스트 결론(3개월 보유, 발굴 바스켓):
#     한국  폭 백분위>40  전체 +5.85%p · 2010-18 +2.95%p · 2019-23 +4.72%p (전부 +)
#           지수 200일선  전체 +2.24%p · 2010-18 +2.24%p · 2024-26 -2.68%p (뒤집힘)
#     미국  폭·지수200일선·골든크로스·낙폭·변동성 등 15개 후보가
#           2010년 이후 모든 구간에서 (-) → 미국은 시장 게이트를 걸지 않습니다.
BREADTH_DAYS = 756       # 폭 백분위 기준 기간 (3년)
BREADTH_GATE = 40        # 한국: 폭 백분위가 이 아래면 위험

try:                                    # 172. 업종 고침표 — scripts/universe.py 한 곳에서
    sys.path.insert(0, SCRIPTS_DIR); from universe import SECTOR_FIX as _SECTOR_FIX
except Exception:
    _SECTOR_FIX = {"BRK-B": "Financials", "BRK-A": "Financials", "LNG": "Energy"}
# ── 섹터 ETF (감마 통합: 12종) ────────────────────────────────
# GICS 업종명(위키피디아) → 섹터 ETF. 종목의 업종이 섹터 순위 몇 위인지 연결하는 표입니다.
GICS_TO_ETF = {
    "Information Technology": "XLK", "Financials": "XLF", "Energy": "XLE", "Health Care": "XLV",
    "Consumer Discretionary": "XLY", "Consumer Staples": "XLP", "Industrials": "XLI", "Utilities": "XLU",
    "Materials": "XLB", "Communication Services": "XLC", "Real Estate": "XLRE",
}
SECTOR_ETFS = {
    "XLK":"기술","XLF":"금융","XLE":"에너지","XLV":"헬스케어","XLY":"소비재",
    "XLP":"필수소비","XLI":"산업재","XLU":"유틸리티","XLB":"소재","XLC":"커뮤니케이션",
    "XLRE":"부동산","SMH":"반도체",
}
INDICES = {
    "^GSPC":("S&P500","us"), "^IXIC":("NASDAQ","us"), "^KS11":("KOSPI","kr"),
    "^NDX":("나스닥100","us"),        # 252. 미국 새로 사기 판단 (나스닥100 200일선)
}
RISK = {"^VIX":"VIX", "^TNX":"US10Y", "^IRX":"US3M"}
BENCH = {"us":"^GSPC", "kr":"^KS11"}
# 한국 배분 대상 — 섹터를 고르지 않고 이것 하나를 그냥 들고 갑니다 (검증 결과)
KR_ETF = ("069500.KS", "KODEX 200")

from rules import R as RULES                          # 260. 규칙 숫자 한 파일 (config/rules.json)

def _write(path, obj):
    with open(path,"w",encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",",":"))

__all__ = [n for n in dir() if not n.startswith("__")]   # 밑줄 이름(_r · _write …)도 다음 단계가 쓰도록 내보냄
