"""
장중 감시 — Vercel 파이썬 서버리스 함수 (36번)
  주소: /api/watch   (GET)   cron-job.org 같은 외부 스케줄러가 장중 매시 정각에 부릅니다.
  하는 일 (앱·텔레그램·감시 스크립트와 같은 규칙, 신호를 새로 만들지 않음):
    1) 매도! 후보 — 현재가 < 트레일링선(느린 ST)
    2) 2회차 조건 — 1회차만 들고 있고 현재가가 1회차 +3%~+6% 밴드 안
  환경변수 (Vercel Settings → Environment Variables):
    TG_TOKEN, TG_CHAT         텔레그램 (없으면 결과만 JSON 으로 반환)
    REFRESH_KEY (선택)        있으면 ?key= 로 같은 암호를 넘겨야 실행
  중복 방지: 같은 날 같은 종목·사유는 한 번만 → 상태를 저장할 곳이 없어 '직전 1시간 내 같은 알림'만 막습니다 (짧은 메모리)
"""
import json, os, time, urllib.request, urllib.parse
from http.server import BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor

KST = timezone(timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0"}
_LAST = {}   # {key: ts} — 함수 인스턴스가 살아 있는 동안만 유지

def get(url, timeout=8):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return json.load(r)

def quote(sym):
    try:
        m = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=1d&interval=5m")["chart"]["result"][0]["meta"]
        return m.get("regularMarketPrice") or m.get("previousClose")
    except Exception:
        return None

def symbol_of(d):
    return d["t"] + d["ex"] if d.get("m") == "kr" and str(d.get("ex", "")).startswith(".") else d["t"]


# 휴장일 (2026) — 매년 12월에 다음 해 것을 추가하세요. 출처: 한국거래소·NYSE 공지
KR_HOLIDAYS = {"2026-09-24", "2026-09-25", "2026-10-05", "2026-10-09", "2026-12-25", "2026-12-31"}
US_HOLIDAYS = {"2026-11-26", "2026-12-25"}

def us_dst(now_kst):
    """미국 서머타임: 3월 둘째 일요일 ~ 11월 첫째 일요일 (예전 '3~10월' 근사는 3월 초·11월 초에 틀렸음)"""
    import datetime as _dt
    y = now_kst.year
    def nth_sunday(month, n):
        d = _dt.date(y, month, 1); first = d + _dt.timedelta(days=(6 - d.weekday()) % 7)
        return first + _dt.timedelta(weeks=n - 1)
    return nth_sunday(3, 2) <= now_kst.date() < nth_sunday(11, 1)

def market_open(now):
    dow, mins = now.weekday(), now.hour * 60 + now.minute
    dst = us_dst(now)
    kr = dow < 5 and 540 <= mins <= 930 and now.strftime("%Y-%m-%d") not in KR_HOLIDAYS
    a, b = (22 * 60 + 30, 5 * 60) if dst else (23 * 60 + 30, 6 * 60)
    us_day = now if mins >= a else now - timedelta(days=1)          # 미국 장은 한국 시간 자정을 넘깁니다
    us = ((dow < 5 and mins >= a) or (dow <= 5 and mins < b)) and us_day.strftime("%Y-%m-%d") not in US_HOLIDAYS
    return kr, us

def send(text):
    tok, chat = os.environ.get("TG_TOKEN"), os.environ.get("TG_CHAT")
    if not (tok and chat): return False
    body = json.dumps({"chat_id": chat, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True}).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{tok}/sendMessage", data=body, headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=8).read()
    return True

def run(base):
    now = datetime.now(KST)
    kr_open, us_open = market_open(now)
    if not (kr_open or us_open):
        return {"ok": True, "skipped": "휴장", "now": now.strftime("%m-%d %H:%M")}
    snap = get(f"{base}/data/snapshot.json?t={int(time.time())}", 15)
    stocks, etfs = snap.get("stocks", {}), snap.get("etfs", {})
    try:
        wl = get(f"{base}/data/watchlist.json?t={int(time.time())}")
    except Exception:
        return {"ok": False, "msg": "watchlist.json 없음 — 앱에서 🔔 알림 연결"}
    targets = []
    for p in (wl.get("positions") or []):
        d = stocks.get(p["t"]) or etfs.get(p["t"])
        if not d: continue
        if (d.get("m") == "kr" and not kr_open) or (d.get("m") != "kr" and not us_open): continue
        targets.append((p, d))
    with ThreadPoolExecutor(8) as ex:
        prices = list(ex.map(lambda x: quote(symbol_of(x[1])), targets))
    msgs, hits = [], []
    for (p, d), px in zip(targets, prices):
        if not px: continue
        name = d.get("n") or p["t"]; cur = f"{px:,.2f}" if d.get("m") != "kr" else f"{px:,.0f}"
        line = d.get("stLine")
        tr = p.get("tr") if isinstance(p.get("tr"), list) and p.get("tr") else ([{"px": p.get("avg")}] if p.get("avg") else [])
        if line and px < line:
            hits.append((f"{p['t']}:sell", f"🔴 <b>매도! 후보</b> {name} — 현재 {cur} < 트레일링선 {(f"{line:,.2f}" if d.get("m") != "kr" else f"{line:,.0f}")}\n   종가가 선 아래로 마감하면 매도"))
        if p.get("role") == "swing" and len(tr) == 1 and tr[0].get("px") and d.get("stSlow") == 1 and tr[0]["px"] * 1.03 <= px <= tr[0]["px"] * 1.06:
            hits.append((f"{p['t']}:t2", f"🟢 <b>2회차 조건</b> {name} — 현재 {cur} ≥ 1회차 +3% ({(f"{tr[0]['px'] * 1.03:,.2f}" if d.get("m") != "kr" else f"{tr[0]['px'] * 1.03:,.0f}")}) · 나머지 절반"))
    for key, text in hits:
        if time.time() - _LAST.get(key, 0) < 3600: continue    # 1시간 내 중복 억제
        _LAST[key] = time.time(); msgs.append(text)
    sent = False
    if msgs:
        sent = send(f"⏱ <b>장중 감시</b> {now:%m/%d %H:%M} KST\n\n" + "\n\n".join(msgs)
                    + "\n\n<i>앱이 정한 트레일링선과 2회차 조건만 봅니다</i>")
    return {"ok": True, "now": now.strftime("%m-%d %H:%M"), "checked": len(targets), "alerts": len(msgs), "sent": sent, "items": msgs}

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        key = os.environ.get("REFRESH_KEY") or ""
        if key and (q.get("key", [""])[0] != key):
            return self._json(401, {"ok": False, "msg": "key 필요"})
        base = os.environ.get("BASE") or f"https://{self.headers.get('host')}"
        try:
            out = run(base)
        except Exception as e:
            out = {"ok": False, "msg": str(e)[:200]}
        self._json(200, out)
    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json; charset=utf-8"); self.end_headers(); self.wfile.write(body)
