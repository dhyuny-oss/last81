"""234 · 299. 메리츠 잔고에 없는 단기 보유 — 규칙은 이 파일 한 곳 (파이프라인 scripts/snap/today.py · 텔레그램 scripts/notify_lib.py 가 같이 씀)
   앱 쪽 같은 규칙: src/App.jsx brokerMiss · 점검: scripts/check_consistency.mjs brokerMiss — 바꾸면 세 곳을 같이
   이미 팔았거나 잘못 들어간 기록으로 보고 보유·칸 계산에서 뺍니다. 잔고 요약이 4일 넘게 묵었으면 판단하지 않고,
   잔고를 본 날 이후에 산 종목(그 사이 체결)은 빼지 않습니다."""
import datetime as _dt

MAX_AGE_DAYS = 4


def broker_miss(wl, today=None):
    b = (wl or {}).get("broker") or {}
    d = str(b.get("d") or "")
    try:
        age = ((today or _dt.date.today()) - _dt.date.fromisoformat(d)).days
    except Exception:
        return set()
    if age > MAX_AGE_DAYS: return set()
    out = set()
    for p in ((wl or {}).get("positions") or []):
        t = str(p.get("t", "")).upper(); m = "kr" if t.isdigit() else "us"
        if (p.get("role") or "swing") != "swing" or m not in b: continue
        tr = p.get("tr") or []
        d0 = str((tr[0].get("d") if tr else None) or p.get("date") or "")
        if t not in {str(x[0]).upper() for x in b[m]} and d0 < d: out.add(t)
    return out
