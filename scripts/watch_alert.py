#!/usr/bin/env python3
"""
장중 감시 — 알파터미널이 못 보는 시간을 메웁니다.

앱 데이터는 하루 두 번(16:17 / 06:23 KST)만 갱신되므로, 장중에 트레일링 손절선이
깨져도 알 수 없습니다. 이 스크립트는 '내가 들고 있는 종목'만 시간마다 확인합니다.

★ 신호를 새로 계산하지 않습니다. 앱이 정해 둔 stLine(트레일링 손절선)과
  내가 정한 퍼센트만 현재가와 비교합니다. 규칙을 흔들지 않기 위해서입니다.

확인하는 것 두 가지뿐입니다 (앱·텔레그램과 같은 규칙):
  1) 매도!  — 현재가가 트레일링선(느린 ST) 아래 → "종가까지 보고, 아래로 마감하면 매도"
  2) 2회차  — 1회차만 들고 있고 현재가가 1회차 매수가 +3% 이상 → "나머지 절반"
  −3% 손절·고점 −5%·타임컷은 검증에서 성과를 깎아 보지 않습니다.

환경변수
  TG_TOKEN / TG_CHAT   텔레그램 (없으면 화면 출력만)
  BASE                 데이터 주소 (기본 https://last81.vercel.app)
  STATE                중복 방지 파일 (기본 watch_state.json)
"""
import json, os, sys, urllib.request
from datetime import datetime, timezone, timedelta

KST   = timezone(timedelta(hours=9))
BASE  = os.environ.get("BASE", "https://last81.vercel.app")
STATE = os.environ.get("STATE", "watch_state.json")
UA    = {"User-Agent": "Mozilla/5.0"}

def get(url, timeout=20):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return json.load(r)

def load(name):
    """로컬 파일이 있으면 그걸, 없으면 배포된 주소에서"""
    p = f"public/data/{name}"
    if os.path.exists(p):
        return json.load(open(p, encoding="utf-8"))
    return get(f"{BASE}/data/{name}?t={int(datetime.now().timestamp())}")

def quote(sym):
    """현재가 (장중이면 실시간에 가까운 값)"""
    try:
        r = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=1d&interval=5m")
        m = r["chart"]["result"][0]["meta"]
        return m.get("regularMarketPrice") or m.get("previousClose")
    except Exception:
        return None

def symbol_of(d):
    """스냅샷의 ex 값으로 야후 심볼을 만듭니다 (.KS 코스피 / .KQ 코스닥)"""
    t = d["t"]
    return t + d["ex"] if d.get("m") == "kr" and d.get("ex", "").startswith(".") else t


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
    """한국 09:00~15:30 · 미국 정규장(서머타임 22:30~05:00, 겨울 23:30~06:00)"""
    dow, mins = now.weekday(), now.hour * 60 + now.minute
    dst = us_dst(now)
    kr = dow < 5 and 540 <= mins <= 930 and now.strftime("%Y-%m-%d") not in KR_HOLIDAYS
    a, b = (22 * 60 + 30, 5 * 60) if dst else (23 * 60 + 30, 6 * 60)
    us_day = now if mins >= a else now - timedelta(days=1)          # 미국 장은 한국 시간 자정을 넘깁니다
    us = ((dow < 5 and mins >= a) or (dow <= 5 and mins < b)) and us_day.strftime("%Y-%m-%d") not in US_HOLIDAYS
    return kr, us

def send(text):
    tok, chat = os.environ.get("TG_TOKEN"), os.environ.get("TG_CHAT")
    if not (tok and chat):
        print(text); return False
    try:
        body = json.dumps({"chat_id": chat, "text": text, "parse_mode": "HTML",
                           "disable_web_page_preview": True}).encode()
        req = urllib.request.Request(f"https://api.telegram.org/bot{tok}/sendMessage",
                                     data=body, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=15).read()
        return True
    except Exception as e:
        print("텔레그램 실패:", e); print(text); return False

def main():
    now = datetime.now(KST)
    kr_open, us_open = market_open(now)
    if not (kr_open or us_open):
        print(f"{now:%m-%d %H:%M} 휴장 — 건너뜀"); return

    snap = load("snapshot.json")
    stocks, etfs = snap.get("stocks", {}), snap.get("etfs", {})
    try:
        wl = load("watchlist.json")
    except Exception:
        print("watchlist.json 이 없습니다 — 앱 추적탭에서 '알림 연결'을 눌러 주세요"); return

    try:
        state = json.load(open(STATE, encoding="utf-8"))
    except Exception:
        state = {}
    today = now.strftime("%Y-%m-%d")
    state = {k: v for k, v in state.items() if v == today}   # 어제 기록은 버림

    msgs = []
    for p in (wl.get("positions") or []):
        d = stocks.get(p["t"]) or etfs.get(p["t"])
        if not d: continue
        if d.get("m") == "kr" and not kr_open: continue
        if d.get("m") != "kr" and not us_open: continue
        px = quote(symbol_of(d))
        if not px: continue
        name, cur = d.get("n") or p["t"], f"{px:,.2f}" if d.get("m") != "kr" else f"{px:,.0f}"
        hits = []
        line = d.get("stLine")
        if line and px < line:
            hits.append(("sell", f"🔴 <b>매도! 후보</b> {name} — 현재 {cur} < 트레일링선 {(f"{line:,.2f}" if d.get("m") != "kr" else f"{line:,.0f}")}\n"
                                 f"   종가가 선 아래로 마감하면 매도 (앱·텔레그램 저녁 판정과 같은 기준)"))
        tr = p.get("tr") if isinstance(p.get("tr"), list) and p.get("tr") else ([{"px": p.get("avg")}] if p.get("avg") else [])
        if p.get("role") == "swing" and len(tr) == 1 and tr[0].get("px") and d.get("stSlow") == 1 and tr[0]["px"] * 1.03 <= px <= tr[0]["px"] * 1.06:
            hits.append(("t2", f"🟢 <b>2회차 조건</b> {name} — 현재 {cur} ≥ 1회차 +3% ({(f"{tr[0]['px'] * 1.03:,.2f}" if d.get("m") != "kr" else f"{tr[0]['px'] * 1.03:,.0f}")}) · 나머지 절반"))
        for kind, text in hits:
            key = f"{p['t']}:{kind}"
            if state.get(key) == today: continue     # 하루 한 번만
            state[key] = today
            msgs.append(text)

    if msgs:
        send(f"⏱ <b>장중 감시</b> {now:%m/%d %H:%M} KST\n\n" + "\n\n".join(msgs)
             + "\n\n<i>신호를 새로 계산하지 않고 앱이 정한 트레일링선과 2회차 조건만 봅니다</i>")
        print(f"{len(msgs)}건 알림")
    else:
        print(f"{now:%m-%d %H:%M} 해당 없음 (보유 {len(wl.get('positions') or [])})")
    json.dump(state, open(STATE, "w"), ensure_ascii=False)

if __name__ == "__main__":
    main()
