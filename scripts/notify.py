#!/usr/bin/env python3
"""
Alpha Terminal v4 — 텔레그램 리포트
════════════════════════════════════════════════════════════════
이 파일은 지표를 하나도 계산하지 않습니다.
build_snapshot.py 가 만든 snapshot.json / market.json 을 "읽기만" 합니다.
→ 텔레그램에 찍히는 숫자와 앱 화면의 숫자가 어긋날 수 없습니다.

  ※ 옛 fetch_yahoo.py 의 리포트는 RSI 를 단순평균으로 다시 계산해서
    앱(Wilder)과 값이 달랐습니다. 그래서 여기로 옮겼습니다.

판단 규칙도 앱과 같은 것을 씁니다 (v5 — 백테스트 반영):
  🟢 후보     = 가격구조 + RS(6개월) 70↑ + RSI 75 이하 · 거래대금 하위 40% 제외
                ※ 돌파(재돌파·ST전환)는 필수에서 뺐습니다 — 후보를 85% 줄이는데
                  성과 차이가 없었고 목록이 매일 100% 뒤집혔습니다.
  🔵 장기 관찰 = 52주 고점 −40%↓ + 3년 건강도 60%↑ · ★ 미국 종목만
                ※ 한국은 −7.24%로 유의하게 손해라 제외합니다.

같은 종목을 매번 다시 보내지 않도록 notified.json 에 기록하고
COOLDOWN_DAYS 안에는 '신규' 로 치지 않습니다.

환경변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
          REPORT_MODE = full(기본) | brief   ※ brief 는 신규 신호가 있을 때만 발송
"""
import json, os, urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta

KST      = timezone(timedelta(hours=9))
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
# 선정 — 앱의 verdictFind / verdictOversold 와 같은 규칙
# ══════════════════════════════════════════════════════════════
def pick_entry(stocks, judge):
    out = []
    for s in stocks.values():
        if (s.get("tvr") or 0) < 40:                     # 유동성 하한
            continue
        if not s.get("tmpl"):                            # 가격구조 7조건
            continue
        if (s.get("rs") or 0) < 70:                      # 상대강도 (6개월 백분위)
            continue
        if (s.get("rsi") or 0) > 75:                     # 과열 제외
            continue
        s = dict(s)
        s["_wait"] = (judge.get(s["m"], {}).get("verdict") == "risk")
        out.append(s)
    out.sort(key=lambda x: -(x.get("rs") or 0))
    return out


def pick_oversold(stocks):
    """★ 미국 종목만. 한국은 검증에서 −7.24%(유의하게 손해)라 제외합니다."""
    out = [s for s in stocks.values()
           if s.get("m") == "us"
           and (s.get("tvr") or 0) >= 40
           and (s.get("w52p") is not None and s["w52p"] <= -40)
           and (s.get("hlt") or 0) >= 0.6]
    out.sort(key=lambda x: x.get("w52p") or 0)
    return out


# ══════════════════════════════════════════════════════════════
def build(snap, mkt, state, now):
    stocks = snap.get("stocks", {})
    judge  = mkt.get("judge", {})
    meta   = snap.get("meta", {})
    alloc  = mkt.get("allocation", {})
    sectors = {s["tk"]: s for s in mkt.get("sectors", [])}

    entry = pick_entry(stocks, judge)
    over  = pick_oversold(stocks)

    cut = (now - timedelta(days=COOLDOWN_DAYS)).timestamp()
    first_run = not state          # 처음엔 전 종목이 '신규'가 되어 도배됩니다
    def is_new(tag, tk):
        if first_run: return False
        rec = state.get(f"{tag}:{tk}")
        return not (rec and rec.get("ts", 0) > cut)
    new_entry = [s for s in entry if is_new("entry", s["t"])]
    new_over  = [s for s in over  if is_new("over",  s["t"])]

    if MODE == "brief" and not new_entry and not new_over:
        return None, 0

    L = [f"⚡ <b>Alpha Terminal</b>  {now.strftime('%m/%d %H:%M')} KST"
         + ("  <i>· 첫 리포트</i>" if first_run else "")]

    # ── 1. 시장 판단 ──────────────────────────────────────
    for k, flag, name in (("us", "🇺🇸", "미국"), ("kr", "🇰🇷", "한국")):
        j = judge.get(k)
        if j:
            L.append(f"{flag} <b>{name} {VERDICT.get(j['verdict'], j['verdict'])}</b> "
                     f"<i>— {j.get('why','')}</i>")

    # ── 2. 이번 달 배분 ───────────────────────────────────
    if alloc.get("defense"):
        L.append("")
        L.append(f"🛡 <b>배분: 방어</b> — 6개월 플러스 섹터가 {alloc.get('nPositive',0)}개뿐")
    elif alloc.get("holds"):
        picks = " · ".join(
            f"{t}({sectors.get(t,{}).get('label','')} {pct(sectors.get(t,{}).get('m6'),0)})"
            for t in alloc["holds"])
        L.append("")
        L.append(f"🧺 <b>배분</b> 3분할 — {picks}")

    # ── 3. 진입후보 ───────────────────────────────────────
    L.append("")
    if entry:
        nkr = sum(1 for s in entry if s["m"] == "kr")
        head = f"🟢 <b>후보 {len(entry)}</b> <i>(🇰🇷{nkr} · 🇺🇸{len(entry)-nkr})</i>"
        if new_entry: head += f" (신규 {len(new_entry)})"
        L.append(head)
        for s in entry[:MAX_ROWS]:
            mark = "🆕 " if is_new("entry", s["t"]) else ""
            flag = "🇰🇷" if s["m"] == "kr" else "🇺🇸"
            trig = " · 재돌파" if s.get("brk") else (" · ST전환" if s.get("stFlip") else "")
            volc = f" · ⚡변동성 {int(s['atrr'])}" if s.get("atrr") is not None else ""
            wait = " ⚠️시장위험→관망" if s.get("_wait") else ""
            L.append(f"{mark}{flag} <b>{s['n']}</b> {price(s['c'], s['m'])} {pct(s.get('d1'))}")
            L.append(f"   RS {int(s.get('rs') or 0)}{volc}{trig} · RSI {s.get('rsi',0):.0f}"
                     f" · 대금 {money(s.get('tv'), s['m'])}{wait}")
        if len(entry) > MAX_ROWS:
            L.append(f"   … 외 {len(entry)-MAX_ROWS}종목")
    else:
        L.append("🟢 <b>진입후보 없음</b> — 조건 미충족")

    # ── 4. 장기 관찰 (과매도) ─────────────────────────────
    if new_over:
        L.append("")
        L.append(f"🔵 <b>장기 관찰 신규 {len(new_over)}</b> <i>(전체 {len(over)} · 🇺🇸 전용)</i>")
        for s in new_over[:5]:
            warn = " ⚠️구조훼손 의심" if (s.get("ma200p") or 0) < -50 else ""
            L.append(f"🆕 <b>{s['n']}</b> 고점대비 {pct(s.get('w52p'),0)} · "
                     f"{yrs(s.get('hltY'))}년건강 {int((s.get('hlt') or 0)*100)}% · RSI {s.get('rsi',0):.0f}{warn}")

    # ── 5. 청산 규칙 한 줄 (매번 같은 말을 하도록) ────────
    L.append("")
    L.append("<i>🟢 후보 = 단기 · 손절 평단 −10% · 최소 3~6개월 보유 (손절 넓힌 만큼 종목당 금액은 줄이세요)</i>")
    L.append("<i>🔵 장기 관찰 = 미국 전용 · 손절 없이 12~24개월</i>")

    # ── 6. 데이터 상태 ────────────────────────────────────
    cnt = meta.get("counts", {})
    tail = f"📦 {meta.get('generatedKST','')} · {cnt.get('stocks',0)}종목"
    if cnt.get("failed"): tail += f" · 못받음 {cnt['failed']}"
    if meta.get("pool", {}).get("extra"): tail += f" · 직접추가 {len(meta['pool']['extra'])}"
    L.append(tail)
    L.append(f'<a href="{APP_URL}">앱에서 보기 →</a>')

    # 상태 갱신
    ts = now.timestamp()
    for s in entry: state[f"entry:{s['t']}"] = {"ts": ts, "n": s["n"]}
    for s in over:  state[f"over:{s['t']}"]  = {"ts": ts, "n": s["n"]}
    for k in [k for k, v in state.items() if v.get("ts", 0) < ts - 86400 * 30]:
        del state[k]                                    # 30일 지난 기록은 정리

    return "\n".join(L), len(new_entry) + len(new_over)


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


def main():
    snap = load(f"{DATA}/snapshot.json")
    mkt  = load(f"{DATA}/market.json")
    if not snap or not mkt:
        print("❌ snapshot.json / market.json 이 없습니다. build_snapshot.py 를 먼저 실행하세요.")
        return
    state = load(STATE, {}) or {}
    now = datetime.now(KST)

    text, n_new = build(snap, mkt, state, now)
    if text is None:
        print("ℹ️ brief 모드 · 신규 신호 없음 — 발송 안 함")
        return

    print("─" * 56); print(text.replace("<b>", "").replace("</b>", "")
                            .replace("<i>", "").replace("</i>", "")); print("─" * 56)
    print(f"신규 {n_new}건 · {len(text)}자")

    if send(text):
        with open(STATE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
