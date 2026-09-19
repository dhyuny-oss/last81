#!/usr/bin/env python3
"""
장중 감시 — 알파터미널이 못 보는 시간을 메웁니다.

앱 데이터는 하루 두 번(16:17 / 06:23 KST)만 갱신되므로, 장중에 트레일링 손절선이
깨져도 알 수 없습니다. 이 스크립트는 '내가 들고 있는 종목'만 시간마다 확인합니다.

★ 신호를 새로 계산하지 않습니다. 앱이 정해 둔 stLine(트레일링 손절선)과
  내가 정한 퍼센트만 현재가와 비교합니다. 규칙을 흔들지 않기 위해서입니다.

환경변수
  TG_TOKEN / TG_CHAT   텔레그램 (없으면 화면 출력만)
  BASE                 데이터 주소 (기본 https://last81.vercel.app)
  ADD_PCT  +3          추가매수 알림 기준
  HOLD_PCT +5          대기 알림 기준
  CUT_PCT  -3          손절 알림 기준
  STATE                중복 방지 파일 (기본 watch_state.json)
"""
import json, os, sys, urllib.request
from datetime import datetime, timezone, timedelta

KST   = timezone(timedelta(hours=9))
BASE  = os.environ.get("BASE", "https://last81.vercel.app")
STATE = os.environ.get("STATE", "watch_state.json")
ADD   = float(os.environ.get("ADD_PCT", 3))
HOLD  = float(os.environ.get("HOLD_PCT", 5))
CUT   = float(os.environ.get("CUT_PCT", -3))
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

def market_open(now):
    """한국 09:00~15:30 · 미국 정규장(서머타임 22:30~05:00, 겨울 23:30~06:00)"""
    dow, mins = now.weekday(), now.hour * 60 + now.minute
    dst = 3 <= now.month <= 10
    kr = dow < 5 and 540 <= mins <= 930
    a, b = (22 * 60 + 30, 5 * 60) if dst else (23 * 60 + 30, 6 * 60)
    us = (dow < 5 and mins >= a) or (dow <= 5 and mins < b)
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
        if line and d.get("stSlow") == 1 and px < line:
            hits.append(("line", f"🔻 <b>{name}</b> 트레일링선 이탈 — 현재 {cur} / 선 {line:,.0f}\n"
                                 f"   종가가 선 아래로 마감하면 매도"))
        if p.get("avg"):
            pl = (px / p["avg"] - 1) * 100
            if pl <= CUT:   hits.append(("cut",  f"🔴 <b>{name}</b> {pl:+.1f}% — 손절 기준({CUT}%) 도달"))
            elif pl >= HOLD: hits.append(("hold", f"🟡 <b>{name}</b> {pl:+.1f}% — 대기 구간({HOLD}%↑)"))
            elif pl >= ADD:  hits.append(("add",  f"🟢 <b>{name}</b> {pl:+.1f}% — 추가매수 기준({ADD}%) 도달"))
        for kind, text in hits:
            key = f"{p['t']}:{kind}"
            if state.get(key) == today: continue     # 하루 한 번만
            state[key] = today
            msgs.append(text)

    if msgs:
        send(f"⏱ <b>장중 감시</b> {now:%m/%d %H:%M} KST\n\n" + "\n\n".join(msgs)
             + "\n\n<i>신호를 새로 계산하지 않고 앱이 정한 선과 내 퍼센트만 비교합니다</i>")
        print(f"{len(msgs)}건 알림")
    else:
        print(f"{now:%m-%d %H:%M} 해당 없음 (보유 {len(wl.get('positions') or [])})")
    json.dump(state, open(STATE, "w"), ensure_ascii=False)

if __name__ == "__main__":
    main()
