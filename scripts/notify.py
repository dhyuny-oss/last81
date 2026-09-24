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

REV_MIN = float(os.environ.get("REV_MIN", 10))   # 앱 '매출 필터' 기본값 — 앱이 settings.revMin 을 보내면 그 값 (61)
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
        if (s.get("tvr") or 0) < 40:
            continue
        if s.get("action") != "buy" or not rev_ok(s):
            continue
        out.append(dict(s))
    # 오늘 살 것과 같은 순서: 눌림·강세 → 추세, 그 안에서 강도 점수(RS + 200일선 거리) 높은 순 (70)
    out.sort(key=lambda x: (0 if x.get("why") in ("pull", "strong") else 1, -(x.get("str") or x.get("rs") or 0)))
    return out


def pick_oversold(stocks):
    """★ 미국 종목만. 한국은 검증에서 −7.24%(유의하게 손해)라 제외합니다."""
    # 앱 급락 탭의 '관찰' 과 같은 판정 (파이프라인 dip=watch): −25%↓ · 3년 건강 60%↑ · 흑자 · 20일선 회복
    out = [s for s in stocks.values() if s.get("m") == "us" and (s.get("tvr") or 0) >= 40 and s.get("dip") == "watch"]
    out.sort(key=lambda x: x.get("w52p") or 0)
    return out


# ══════════════════════════════════════════════════════════════
def build(snap, mkt, state, now):
    stocks = snap.get("stocks", {})
    judge  = mkt.get("judge", {})
    meta   = snap.get("meta", {})
    dc     = mkt.get("dc") or {}
    health = (snap.get("meta") or {}).get("health") or {}
    # 앱에서 '알림 연결'을 누르면 저장되는 내 보유·관심 목록
    try:
        wl = json.load(open(f"{DATA}/watchlist.json", encoding="utf-8"))
    except Exception:
        wl = {}
    etfs   = snap.get("etfs", {})

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
            tail = "" if j.get("gate") else " <i>(참고용)</i>"
            L.append(f"{flag} <b>{name} {VERDICT.get(j['verdict'], j['verdict'])}</b>{tail} "
                     f"<i>— {j.get('why','')}</i>")

    # ── 1.4 내 보유·관심 — 이것만 따로 먼저 알립니다 (남의 종목보다 내 종목이 먼저) ──
    mine, etfs_all = [], snap.get("etfs", {})
    look = lambda t: stocks.get(t) or etfs_all.get(t)
    def tr_of(p):
        tr = p.get("tr") if isinstance(p.get("tr"), list) and p.get("tr") else [{"px": p.get("avg"), "amt": p.get("amt") or 0}]
        return [t for t in tr if t.get("px")]
    for p in (wl.get("positions") or []):
        d = look(p.get("t"))
        if not d:   # 들고 있는데 데이터가 없음 → 거래정지·상장폐지·티커 변경 가능. 조용히 넘기지 않습니다
            mine.append((True, f"   ⚠️ <b>{p.get('t')}</b> 데이터 없음 — 거래정지·상장폐지·티커 변경 확인 필요",
                         "kr" if str(p.get("t", "")).isdigit() else "us", 0, 0))
            continue
        tr = tr_of(p); amt = sum(t.get("amt") or 0 for t in tr); sh = sum((t.get("amt") or 0) / t["px"] for t in tr)
        avg = (amt / sh) if sh else (tr[0]["px"] if tr else None)
        pl = ((d.get("c") or 0) / avg - 1) * 100 if avg else None
        out = p.get("role") != "long" and act_of(d, True) == "sell"
        warn = f" ⚠️{d.get('status') or '거래정지'}" if (d.get("halted") or d.get("status")) else ""
        line = (f"   {ACT['sell'] if out else ACT['hold']} <b>{d.get('n') or p['t']}</b>{warn} {price(d.get('c'), d.get('m'))}"
                + (f" {pct(pl)}" if pl is not None else "")
                + (f" · 트레일링선 {price(d.get('stLine'), d.get('m'))}" if d.get("stLine") else ""))
        # 2회차 조건: 1회차뿐이고 1회차 매수가 +3% 넘게 마감 · 느린ST 초록
        if p.get("role") == "swing" and len(tr) == 1 and d.get("c") and d.get("stSlow") == 1 and tr[0]["px"] * 1.03 <= d["c"] <= tr[0]["px"] * 1.06:
            line += f"\n      ✅ <b>2회차 조건 도달</b> (1회차 +3% = {price(tr[0]['px'] * 1.03, d.get('m'))} 넘음, +6% 안) — 나머지 절반"
        elif p.get("role") == "swing" and len(tr) == 1 and d.get("c") and d["c"] > tr[0]["px"] * 1.06:
            line += f"\n      ⛔ 추격 금지 — 1회차 대비 {(d['c'] / tr[0]['px'] - 1) * 100:+.1f}% (밴드 +3~6% 초과)"
        val = sum((t.get("amt") or 0) / t["px"] * (d.get("c") or t["px"]) for t in tr)
        mine.append((out, line, d.get("m") or ("kr" if str(p.get("t", "")).isdigit() else "us"), amt, val))
    buys = []
    for t in (wl.get("watch") or []):
        d = look(t)
        if not d: continue
        if d.get("action") == "buy":
            buys.append(f"   {act_txt(d)} <b>{d.get('n') or t}</b> {price(d.get('c'), d.get('m'))} · RS {int(d.get('rs') or 0)}")
    if mine or buys:
        L.append("")
        L.append("📁 <b>내 종목</b>")
        for mk, flag in (("us", "🇺🇸"), ("kr", "🇰🇷")):          # 69. 🇺🇸 먼저 · 시장별 소계 (달러는 달러, 원은 원)
            ms = [x for x in mine if x[2] == mk]
            if not ms: continue
            inv = sum(x[3] for x in ms); val = sum(x[4] for x in ms)
            L.append(f"  {flag} {len(ms)}종목" + (f" · 투입 {money(inv, mk)} → 평가 {money(val, mk)} ({(val/inv-1)*100:+.1f}%)" if inv else ""))
            for x in sorted(ms, key=lambda x: not x[0]): L.append(x[1])
        if buys:
            L.append("   <i>관심 목록 신호</i>")
            L += buys
    elif wl.get("updatedAt"):
        L.append("")
        L.append("📁 <b>내 종목</b> — 신호 없음")

    # ── 1.45 주간 종목풀 점검 — 바뀐 날에만 알립니다 ──
    try:
        uni = json.load(open(f"{DATA}/universe_log.json", encoding="utf-8"))
    except Exception:
        uni = None
    if uni and (uni.get("added") or uni.get("removed")):
        same_day = str(uni.get("date", ""))[:10] == now.astimezone(KST).strftime("%Y-%m-%d")
        if same_day:
            L.append("")
            L.append(f"📦 <b>주간 종목풀 점검</b> {uni.get('prevTotal')} → {uni.get('total')}종목")
            add = uni.get("added") or []; rem = uni.get("removed") or []
            if add:
                L.append("   ➕ " + ", ".join(f"{x['n']}" for x in add[:6]) + (f" 외 {len(add)-6}" if len(add) > 6 else ""))
            if rem:
                L.append("   ➖ " + ", ".join(f"{x['n']}" for x in rem[:6]) + (f" 외 {len(rem)-6}" if len(rem) > 6 else ""))

    # ── 1.5 데이터 검사 결과 — 제외된 종목을 조용히 넘기지 않습니다 ──
    if health:
        dr = health.get("dropped") or {}
        line = f"🩺 데이터 {health.get('kept','?')}종목 정상"
        if health.get("exchange"):
            line += f" (코스피 {health['exchange'].get('KS',0)}·코스닥 {health['exchange'].get('KQ',0)})"
        if dr: line += " · 제외 " + ", ".join(f"{k} {v}" for k, v in dr.items())
        if health.get("failed"): line += f" · 수집실패 {health['failed']}"
        L.append("")
        L.append(f"<i>{line}</i>")

    # ── 2. DC(퇴직연금) — 미국 S&P500 35% + 코스피200 35% + 안전자산 30% ──
    #   각 몫은 느린 슈퍼트렌드(12,3) 초록일 때만 보유. 색이 바뀐 날은 🔔 로 따로 알립니다.
    if dc.get("core"):
        L.append("")
        L.append("🏦 <b>DC 규칙</b> <i>(느린ST 초록=보유 · 빨강=안전자산)</i>")
        for c in dc["core"]:
            d = etfs.get(c.get("sig")) or {}
            st = c.get("state")
            buy = c.get("buy") or {}
            prev = (state.get(f"dc:{c['key']}") or {}).get("state")
            flip = (not first_run) and prev and prev != st and st in ("hold", "wait")
            mark = "🟢 보유" if st == "hold" else "🟡 대기" if st == "wait" else "⚪ 확인불가"
            days = d.get("slowDays")
            L.append(f"   {mark} <b>{c.get('label')}</b> {int(c.get('w',0)*100)}% → {buy.get('name','')} "
                     f"({buy.get('code','')}){f' · {days}거래일째' if days is not None else ''}")
            if flip:
                L.append("   🔔 <b>" + ("초록 전환 — 매수 시작" if st == "hold" else "빨강 전환 — 보유분 매도 → 안전자산") + "</b>")
            state[f"dc:{c['key']}"] = {"ts": now.timestamp(), "state": st}
        ab = mkt.get("allocation", {})
        L.append(f"   <i>안전자산 30%는 적격TDF·채권혼합형·예금 · 다음 비중 점검 {ab.get('nextRebal','분기 첫 거래일')}</i>")

    # ── 3. 신호 (앱 발굴탭과 같은 목록·같은 순서) ─────────────
    L.append("")
    if entry:
        nkr = sum(1 for s in entry if s["m"] == "kr")
        kinds = {}
        for s in entry: kinds[WHY.get(s.get("why"), "기타")] = kinds.get(WHY.get(s.get("why"), "기타"), 0) + 1
        ncut = sum(1 for d in stocks.values() if d.get("action") == "buy" and (d.get("tvr") or 0) >= 40 and not rev_ok(d))
        head = f"🔍 <b>매수! {len(entry)}</b> <i>({' · '.join(f'{k} {v}' for k, v in kinds.items())} · 🇰🇷{nkr} 🇺🇸{len(entry)-nkr})</i>"
        if ncut: head += f" <i>✂ 매출 +{REV_MIN:.0f}% 미만 {ncut} 제외</i>"
        if new_entry: head += f" (신규 {len(new_entry)})"
        L.append(head)
        for s in entry[:MAX_ROWS]:
            mark = "🆕 " if is_new("entry", s["t"]) else ""
            flag = "🇰🇷" if s["m"] == "kr" else "🇺🇸"
            f = s.get("fin") or {}
            g = f.get("growth", f.get("rev"))
            fin = (f" · 매출 {g:+.0f}%{'↑' if f.get('accel') else ''}" if g is not None else "") + (" · 적자" if f.get("prof") is False else "")
            gap = f" · 선까지 −{(1 - s['stLine'] / s['c']) * 100:.0f}%" if s.get("stLine") and s.get("c") else ""
            L.append(f"{mark}{flag} <b>{s['n']}</b> {price(s['c'], s['m'])} {pct(s.get('d1'))} {act_txt(s)}")
            L.append(f"   강도 {int(s.get('str') or 0)} · RS {int(s.get('rs') or 0)}{gap} · 하루 거래 {money(s.get('tv'), s['m'])}{fin}")
        if len(entry) > MAX_ROWS:
            L.append(f"   … 외 {len(entry)-MAX_ROWS}종목")
        L.append("<i>눌림 🇰🇷 = 추세 안 RSI 45 회복 · 강세 🇺🇸 = 추세 안 RSI 60↑ · 추세 = ST 3개 초록+구름 위 · 매도! = 트레일링선 아래 마감</i>")
    else:
        L.append("🔍 <b>매수! 없음</b> — 오늘은 살 것이 없습니다")

    # ── 4. 장기 관찰 (과매도) ─────────────────────────────
    if new_over:
        L.append("")
        L.append(f"🔵 <b>급락 관찰 신규 {len(new_over)}</b> <i>(전체 {len(over)} · 🇺🇸 · 참고용 · 소액 장기만)</i>")
        for s in new_over[:5]:
            L.append(f"🆕 관찰 <b>{s['n']}</b> 고점대비 {pct(s.get('w52p'),0)} · "
                     f"{yrs(s.get('hltY'))}년건강 {int((s.get('hlt') or 0)*100)}% · 20일선 회복")

    # ── 5. 청산 규칙 한 줄 (매번 같은 말을 하도록) ────────
    L.append("")
    L.append("<i>매수 = 한도의 절반 → 1회차 +3% 확인 후 나머지 절반 · 매도! = 트레일링선(느린 ST) 아래 마감 · 그 외 손절·타임컷 없음</i>")
    L.append("<i>🔵 급락 관찰 = 참고용 · 손절 없이 12~24개월 · 소액\n🏦 DC = 국내 상장 ETF로 매수 · 판단은 미국 원본 신호</i>")

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


def build_weekly(snap, mkt, now):
    """토요일 주간 리포트 — 점검 탭 5단계를 읽기만 해도 채울 수 있게"""
    stocks = snap.get("stocks", {}); meta = snap.get("meta", {})
    live = mkt.get("live") or {}
    L = [f"📅 <b>주간 점검</b> {now.strftime('%m/%d')} (토)"]
    # 1 종목풀
    try: uni = json.load(open(f"{DATA}/universe_log.json", encoding="utf-8"))
    except Exception: uni = None
    if uni:
        L.append(f"1️⃣ 종목풀 {uni.get('prevTotal')} → {uni.get('total')} · ➕{len(uni.get('added') or [])} ➖{len(uni.get('removed') or [])}")
        if uni.get("added"):   L.append("   ➕ " + ", ".join(x["n"] for x in uni["added"][:6]))
        if uni.get("removed"): L.append("   ➖ " + ", ".join(x["n"] for x in uni["removed"][:6]))
    # 2 내 종목
    try: wl = json.load(open(f"{DATA}/watchlist.json", encoding="utf-8"))
    except Exception: wl = {}
    ps = wl.get("positions") or []
    sells = [p for p in ps if p.get("role") != "long" and (stocks.get(p["t"]) or {}).get("action") == "sell"]
    near = []
    for p in ps:
        d = stocks.get(p["t"]) or {}
        if d.get("stLine") and d.get("c") and d.get("stSlow") == 1 and (d["c"] / d["stLine"] - 1) * 100 < 5: near.append(d.get("n") or p["t"])
    L.append(f"2️⃣ 내 종목 {len(ps)} · 매도! {len(sells)} · 트레일링선 여유 5% 미만 {len(near)}" + (f" ({', '.join(near[:4])})" if near else ""))
    # 3 실전 성적
    summ = live.get("summary") or {}
    if summ:
        parts = []
        for k, v in summ.items():
            if k.endswith(":all"): continue
            kind, m = k.split(":"); parts.append(f"{ {'pull':'눌림','strong':'강세','buy':'추세'}.get(kind, kind)}{'🇰🇷' if m=='kr' else '🇺🇸'} {v['n']}건 승률{v['win']:.0f}% 지수대비{v['excess']:+.1f}%p" if v.get("excess") is not None else f"{kind}{m} {v['n']}건 승률{v['win']:.0f}%")
        L.append("3️⃣ 실전 성적(20일): " + " · ".join(parts))
    else:
        L.append(f"3️⃣ 실전 성적: 기록 {live.get('n', 0)}건 · 20거래일 뒤부터 집계 (대기 {live.get('pending', 0)})")
    dr = live.get("drift")
    if dr and dr.get("flag"): L.append("   🚨 <b>규칙 재검토</b>: " + " · ".join(dr["reasons"]))
    # 4 이번 주 신호 수
    try: log = json.load(open(f"{DATA}/signals_log.json", encoding="utf-8"))
    except Exception: log = []
    wk = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    week = [x for x in log if x.get("d", "") >= wk]
    L.append(f"4️⃣ 이번 주 신호 {len(week)}건 (🇰🇷 {sum(1 for x in week if x['m']=='kr')} · 🇺🇸 {sum(1 for x in week if x['m']!='kr')})")
    # 57. 이번 주 이탈한 신호 — 규칙대로 팔았으면 얼마였나 (공부용)
    outs = [x for x in log if (x.get("x") or {}).get("d", "") >= wk and x.get("p")]
    if outs:
        L.append(f"   📉 이번 주 이탈 {len(outs)}건 (규칙 손익 평균 {sum((x['x']['p']/x['p']-1)*100 for x in outs)/len(outs):+.1f}%)")
        for x in sorted(outs, key=lambda x: (x['x']['p']/x['p']))[:5]:
            L.append(f"      {x.get('n') or x['t']} {x['d'][5:]}→{x['x']['d'][5:]} {(x['x']['p']/x['p']-1)*100:+.1f}%")
    # 4.5 이번 주 5칸 추천 — 파이프라인이 확정한 today.json 을 그대로 (앱·AI 도구와 같은 목록). 없으면 같은 규칙으로 계산
    try:
        td = json.load(open(f"{DATA}/today.json", encoding="utf-8"))
    except Exception:
        td = None
    if td and td.get("pickUs") is not None:
        L.append("4️⃣½ 🇺🇸 추천 (강도 점수 순 · 업종 분산 · 적자·매출 부진·보유 제외)")
        for i, r in enumerate(td["pickUs"], 1):
            L.append(f"   {i}. <b>{r['t']}</b> {(r.get('n') or '')[:18]} · {WHY.get(r.get('why'),'')} · 강도{int(r.get('str') or 0)} · RS{int(r.get('rs') or 0)}"
                     + (f" · 선까지 −{r['loss']:.0f}%" if r.get("loss") is not None else "") + (f" · 매출{(r.get('growth') if r.get('growth') is not None else r['rev']):+.0f}%{'↑' if r.get('accel') else ''}" if (r.get("growth") is not None or r.get("rev") is not None) else "")
                     + (f" · 🆕{r['age']}일째" if r.get("age") else ""))
        if td.get("excluded"): L.append("   <i>제외: " + ", ".join(f"{x['t']}({'·'.join(x['why'])})" for x in td["excluded"][:8]) + "</i>")
        if td.get("pickKr"): L.append("   🇰🇷 " + ", ".join(f"{r.get('n')}({WHY.get(r.get('why'),'')})" for r in td["pickKr"]) + (" — 시장 위험이면 쉬어도 됨" if td.get("market", {}).get("kr") == "risk" else ""))
    else:
      # (today.json 이 없을 때의 예비 계산)
      secrank = {x["tk"]: x["rank"] for x in (mkt.get("sectors") or [])}
      held = {p.get("t") for p in ((wl or {}).get("positions") or [])}
      buys = [d for d in stocks.values() if d.get("action") == "buy" and (d.get("tvr") or 0) >= 40 and d.get("m") == "us" and d.get("t") not in held]
      def rk(d): return (1 if d.get("why") == "trend" else 0) * 1000 - (d.get("str") or 0)
      picks, used, drop = [], set(), []
      for d in sorted(buys, key=rk):
          f = d.get("fin") or {}; gap = (1 - d["stLine"] / d["c"]) * 100 if d.get("stLine") and d.get("c") else None   # 선까지(닿으면 잃는 폭)
          why = []
          if f.get("prof") is False: why.append("적자")
          if REV_MIN > 0 and f.get("rev") is not None and f["rev"] < REV_MIN: why.append(f"매출{f['rev']:+.0f}%")
          if why: drop.append(f"{d['t']}({'·'.join(why)})"); continue
          sec = d.get("sec") or f"?{d['t']}"      # 업종 정보가 없으면 분산 규칙을 적용하지 않음
          if sec in used: continue
          picks.append(d); used.add(sec)
          if len(picks) >= 5: break
      if picks:
          L.append("4️⃣½ 🇺🇸 5칸 추천 (업종 분산 · 적자·매출 부진 제외)")
          for i, d in enumerate(picks, 1):
              f = d.get("fin") or {}; gap = (1 - d["stLine"] / d["c"]) * 100 if d.get("stLine") and d.get("c") else None   # 선까지(닿으면 잃는 폭)
              L.append(f"   {i}. <b>{d['t']}</b> {d.get('n','')[:18]} · {WHY.get(d.get('why'),'')} · RS{int(d.get('rs') or 0)}"
                       + (f" · 선까지 −{gap:.0f}%" if gap is not None else "") + (f" · 매출{f['rev']:+.0f}%" if f.get("rev") is not None else ""))
          if drop: L.append("   <i>제외: " + ", ".join(drop[:8]) + "</i>")
      krb = [d for d in stocks.values() if d.get("action") == "buy" and d.get("m") == "kr" and (d.get("tvr") or 0) >= 40]
      if krb:
          L.append("   🇰🇷 " + ", ".join(f"{d['n']}({WHY.get(d.get('why'),'')})" for d in sorted(krb, key=rk)[:4]) + (" — 시장 위험이면 쉬어도 됨" if (mkt.get("judge") or {}).get("kr", {}).get("verdict") == "risk" else ""))
    # 5 DC
    dc = mkt.get("dc") or {}
    dual = dc.get("dual") or {}
    if dual.get("cands"):
        L.append("5️⃣ DC 듀얼 모멘텀: " + " · ".join(f"{c['label']} {c['score']:+.1f}%{' ●' if c['sig'] in (dual.get('hold') or []) else ''}" for c in dual["cands"]))
    for c in (dc.get("core") or []):
        L.append(f"   느린ST 규칙 {c.get('label')}: {'보유' if c.get('state')=='hold' else '대기'}")
    h = meta.get("health") or {}
    L.append(f"<i>🩺 {h.get('kept','?')}종목 · {meta.get('generatedKST','')} · 전략 결정은 앱 점검 탭 5번에 한 줄</i>")
    L.append(f'<a href="{APP_URL}">점검 탭 열기 →</a>')
    return "\n".join(L)

def main():
    snap = load(f"{DATA}/snapshot.json")
    mkt  = load(f"{DATA}/market.json")
    if not snap or not mkt:
        print("❌ snapshot.json / market.json 이 없습니다. build_snapshot.py 를 먼저 실행하세요.")
        return
    state = load(STATE, {}) or {}
    now = datetime.now(KST)

    if os.environ.get("WEEKLY") == "1":          # 토요일 전체 스캔 뒤 주간 리포트 (daily.yml 이 넣어 줍니다)
        text = build_weekly(snap, mkt, now)
        print(text); send(text)

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
