"""텔레그램 리포트 공통 — 읽기 도우미 · 숫자 표기 · 후보 고르기 · 발송

notify.py(매일)와 notify_weekly.py(토요일 주간)가 같이 씁니다. 이 파일은 지표를 계산하지 않고
build_snapshot.py 가 만든 값을 읽기만 합니다. 규칙 숫자는 config/rules.json (scripts/rules.py).
"""
import json, os, sys, html as _htmllib, urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta

KST      = timezone(timedelta(hours=9))

def earn_txt(d, within=7):
    """93. 실적 발표 D-n (그 시장 현지 날짜 기준) — within 일 안일 때만. 참고용 (매매 규칙 아님)"""
    e = (d or {}).get("earn")
    if not e: return ""
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("Asia/Seoul" if d.get("m") == "kr" else "America/New_York")
        n = (datetime.strptime(e, "%Y-%m-%d").date() - datetime.now(tz).date()).days
    except Exception:
        return ""
    if n < 0 or n > within: return ""
    return f" · 📅 실적 {'오늘' if n == 0 else f'D-{n}'}{'(예상)' if d.get('earnE') else ''}"
DATA     = "public/data"
STATE    = f"{DATA}/notified.json"
TOKEN    = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CHAT     = os.environ.get("TELEGRAM_CHAT_ID", "")
MODE     = os.environ.get("REPORT_MODE", "full").lower()
COOLDOWN_DAYS = 5          # 같은 종목을 며칠 안에 다시 '신규'로 알리지 않음
MAX_ROWS = 8               # 한 섹션에 최대 몇 종목까지 적을지
APP_URL  = "https://last81.vercel.app"

VERDICT = {"safe": "🟢 안전", "warn": "🟡 주의", "risk": "🔴 위험"}


# ══════════════════════════════════════════════════════════════
def load(path, default=None):
    try:
        with open(path, encoding="utf-8") as f: return json.load(f)
    except Exception: return default


def money(v, m):
    """앱과 같은 표기 — 한국은 조/억, 미국은 $B/$M"""
    if v is None: return "—"
    a = abs(v)
    if m == "kr":
        if a >= 1e12: return f"{a/1e12:.1f}조"
        if a >= 1e8:  return f"{a/1e8:.0f}억"
        return f"{a/1e4:.0f}만"
    if a >= 1e9: return f"${a/1e9:.1f}B"
    if a >= 1e6: return f"${a/1e6:.0f}M"
    return f"${a:,.0f}"


def price(v, m):
    return "—" if v is None else (f"₩{v:,.0f}" if m == "kr" else f"${v:,.2f}")


def yrs(v):
    """3.0년 → 3년 / 1.5년 → 1.5년"""
    if v is None: return "3"
    return f"{v:.0f}" if abs(v - round(v)) < 0.05 else f"{v:.1f}"


def pct(v, d=1):
    return "—" if v is None else f"{'+' if v >= 0 else ''}{v:.{d}f}%"


# ══════════════════════════════════════════════════════════════
# 선정 — 급락 관찰(과매도) 판정. 앱 TabFind 의 급락 탭과 같은 규칙
# ══════════════════════════════════════════════════════════════
# ★ 행동 단어 — 앱과 똑같이 파이프라인 action 을 읽습니다 (여기서 다시 판정하지 않습니다)
ACT = {"buy": "🟢 매수!", "sell": "🔴 매도!", "watch": "관망", "hold": "보유"}
WHY = {"pull": "눌림", "strong": "강세", "trend": "추세"}
def act_of(d, held=False):
    a = d.get("action") or "watch"
    if a == "sell": return "sell"
    return "hold" if held else a
def act_txt(d, held=False):
    a = act_of(d, held)
    why = WHY.get(d.get("why")) if a == "buy" else ("트레일링선 아래" if a == "sell" else None)
    return ACT[a] + (f" ({why})" if why else "")

from rules import R as RULES                                      # 260. 규칙 숫자 한 파일
REV_MIN = float(os.environ.get("REV_MIN", RULES["revMin"]))   # 앱 '매출 필터' 기본값 — 앱이 settings.revMin 을 보내면 그 값 (61)
try:
    _cfg = (json.load(open(f"{DATA}/watchlist.json", encoding="utf-8")).get("settings") or {})
    if "revMin" in _cfg: REV_MIN = float(_cfg["revMin"])
except Exception:
    pass
def rev_ok(s):   # 대표 성장률(최근 분기 → 4분기 → 연간) 기준 — 앱과 같음
    f = s.get("fin") or {}
    g = f.get("growth", f.get("rev"))
    return REV_MIN <= 0 or s.get("m") == "kr" or g is None or g >= REV_MIN

def pick_entry(stocks, judge=None):
    """앱 발굴탭의 '신호' 필터와 같은 목록: ⭐눌림 또는 🟢매수신호, 거래대금 하위 40% 제외.
       예전의 '후보/관망(시장 위험이면 관망)' 개념은 없앴습니다 — 검증에서 종목 매매에 시장
       게이트를 붙이면 성과가 절반이 됐고, 앱에서도 같은 이유로 제거했습니다."""
    out = []
    for s in stocks.values():
        if (s.get("tvr") or 0) < RULES["tvrMin"]:
            continue
        if s.get("action") != "buy" or not rev_ok(s):
            continue
        out.append(dict(s))
    # 오늘 살 것과 같은 순서: 눌림·강세 → 추세, 그 안에서 강도(RS + 200일선 거리) 높은 순 (70)
    out.sort(key=lambda x: (0 if x.get("why") in ("pull", "strong") else 1, -(x.get("str") or x.get("rs") or 0)))
    return out


def pick_oversold(stocks):
    """★ 미국 종목만. 한국은 검증에서 -7.24%(유의하게 손해)라 제외합니다."""
    # 앱 급락 탭의 '관찰' 과 같은 판정 (파이프라인 dip=watch): -25%↓ · 3년 건강 60%↑ · 흑자 · 20일선 회복
    out = [s for s in stocks.values() if s.get("m") == "us" and (s.get("tvr") or 0) >= RULES["tvrMin"] and s.get("dip") == "watch"]
    out.sort(key=lambda x: x.get("w52p") or 0)
    return out


# ══════════════════════════════════════════════════════════════
from broker_rule import broker_miss      # 299. 규칙 한 곳 (scripts/broker_rule.py)


# ══════════════════════════════════════════════════════════════
def send(text):
    if not TOKEN or not CHAT:
        print("⚠️ TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 가 없어 발송을 건너뜁니다.")
        return False
    body = urllib.parse.urlencode({
        "chat_id": CHAT, "text": text[:4000], "parse_mode": "HTML",
        "disable_web_page_preview": "true",
    }).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{TOKEN}/sendMessage", data=body)
    try:
        r = json.load(urllib.request.urlopen(req, timeout=20))
        print("✅ 발송 완료" if r.get("ok") else f"❌ 발송 실패: {r}")
        return bool(r.get("ok"))
    except Exception as e:
        print(f"❌ 발송 실패: {e}")
        return False


def _first_trading_day(now):
    """이 달의 첫 거래일(주말·휴장일 제외)인가 — 06:23 미국 발송분 기준으로 판단"""
    from mktcal import KR_HOL                      # 257. 휴장일 한 파일
    d = now.date()
    from datetime import date, timedelta
    x = date(d.year, d.month, 1)
    while x.weekday() >= 5 or x.isoformat() in KR_HOL: x += timedelta(days=1)
    return d == x or os.environ.get("DC_MONTHLY") == "1"

def _fix_names(o):
    """135. 모든 'n'(이름) 값: 한 번 풀고 → 텔레그램 HTML 용으로 한 번만 이스케이프"""
    if isinstance(o, dict):
        for k, v in o.items():
            if k == "n" and isinstance(v, str): o[k] = _htmllib.escape(_htmllib.unescape(v), quote=False)
            else: _fix_names(v)
    elif isinstance(o, list):
        for v in o: _fix_names(v)
    return o

__all__ = ['ACT', 'APP_URL', 'CHAT', 'COOLDOWN_DAYS', 'DATA', 'KST', 'MAX_ROWS', 'MODE', 'REV_MIN', 'RULES', 'STATE', 'TOKEN', 'VERDICT', 'WHY', '_first_trading_day', '_fix_names', '_htmllib', 'act_of', 'act_txt', 'broker_miss', 'datetime', 'earn_txt', 'json', 'load', 'money', 'os', 'pct', 'pick_entry', 'pick_oversold', 'price', 'rev_ok', 'send', 'sys', 'timedelta', 'timezone', 'urllib', 'yrs']
