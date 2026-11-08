"""257. 휴장일 — config/market.json 한 파일 (앱 src · 서버 api · 이 파이프라인 · daily.yml 이 모두 같은 파일을 읽음)
   from mktcal import KR_HOL, US_HOL, is_open_day
"""
import json, os
_P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config", "market.json")
_C = json.load(open(_P, encoding="utf-8"))
KR_HOL = set(_C.get("kr", {}))
US_HOL = set(_C.get("us", {}))
NAMES = {**_C.get("us", {}), **_C.get("kr", {})}
LAST_YEAR = int(_C.get("lastYear") or 0)


def is_open_day(m, ymd):
    """ymd = 'YYYY-MM-DD' (🇺🇸 은 뉴욕 날짜) — 주말·휴장일이면 False"""
    from datetime import date
    d = date.fromisoformat(ymd)
    return d.weekday() < 5 and ymd not in (KR_HOL if m == "kr" else US_HOL)
