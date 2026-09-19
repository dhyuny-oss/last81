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
def pick_entry(stocks, judge=None):
    """앱 발굴탭의 '신호' 필터와 같은 목록: ⭐눌림 또는 🟢매수신호, 거래대금 하위 40% 제외.
       예전의 '후보/관망(시장 위험이면 관망)' 개념은 없앴습니다 — 검증에서 종목 매매에 시장
       게이트를 붙이면 성과가 절반이 됐고, 앱에서도 같은 이유로 제거했습니다."""
    out = []
    for s in stocks.values():
        if (s.get("tvr") or 0) < 40:
            continue
        if not (s.get("pull") or s.get("sig") == "buy"):
            continue
        out.append(dict(s))
    # 눌림 먼저, 그다음 RS 높은 순 — 앱의 '신호순' 과 같은 순서
    out.sort(key=lambda x: (0 if x.get("pull") else 1, -(x.get("rs") or 0)))
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
    for p in (wl.get("positions") or []):
        d = look(p.get("t"))
        if not d: continue
        pl = ((d.get("c") or 0) / p["avg"] - 1) * 100 if p.get("avg") else None
        out = p.get("role") != "long" and d.get("stSlow") == 0
        mine.append((out, f"   {'🔴 매도' if out else '🟢 유지'} <b>{d.get('n') or p['t']}</b> "
                          f"{price(d.get('c'), d.get('m'))}"
                          + (f" {pct(pl)}" if pl is not None else "")
                          + (f" · 트레일링선 {price(d.get('stLine'), d.get('m'))}" if d.get("stLine") else "")))
    buys = []
    for t in (wl.get("watch") or []):
        d = look(t)
        if not d: continue
        if d.get("pull") or d.get("sig") == "buy":
            buys.append(f"   {'⭐ 눌림' if d.get('pull') else '🟢 매수'} <b>{d.get('n') or t}</b> "
                        f"{price(d.get('c'), d.get('m'))} · RS {int(d.get('rs') or 0)}")
    if mine or buys:
        L.append("")
        L.append("📁 <b>내 종목</b>")
        for _, line in sorted(mine, key=lambda x: not x[0]): L.append(line)
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
        npull = sum(1 for s in entry if s.get("pull"))
        nkr = sum(1 for s in entry if s["m"] == "kr")
        head = f"🔍 <b>신호 {len(entry)}</b> <i>(⭐눌림 {npull} · 🟢매수 {len(entry)-npull} · 🇰🇷{nkr} 🇺🇸{len(entry)-nkr})</i>"
        if new_entry: head += f" (신규 {len(new_entry)})"
        L.append(head)
        for s in entry[:MAX_ROWS]:
            mark = "🆕 " if is_new("entry", s["t"]) else ""
            flag = "🇰🇷" if s["m"] == "kr" else "🇺🇸"
            kind = "⭐눌림" if s.get("pull") else "🟢매수"
            trig = " · 재돌파" if s.get("brk") else (" · ST전환" if s.get("stFlip") else "")
            L.append(f"{mark}{flag} <b>{s['n']}</b> {price(s['c'], s['m'])} {pct(s.get('d1'))} {kind}")
            L.append(f"   RS {int(s.get('rs') or 0)}{trig} · 트레일링선 {price(s.get('stLine'), s['m'])}"
                     f" · 대금 {money(s.get('tv'), s['m'])}")
        if len(entry) > MAX_ROWS:
            L.append(f"   … 외 {len(entry)-MAX_ROWS}종목")
        L.append("<i>⭐눌림 = 추세 안에서 RSI 45 회복 (검증 1위) · 🟢매수 = ST 3개 초록+구름 위+RS 70↑ · 매도 = 트레일링선 아래 마감</i>")
    else:
        L.append("🔍 <b>신호 없음</b> — 오늘은 살 것이 없습니다")

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
    L.append("<i>🟢 매수신호 = 슈퍼트렌드 3개 초록 + 구름 위 + RS 70↑ · 매도 = 느린 슈퍼트렌드(12,3) 빨강</i>")
    L.append("<i>🔵 장기 관찰 = 미국 전용 · 손절 없이 12~24개월\n🏦 DC = 국내 상장 ETF로 매수 · 판단은 미국 원본 신호</i>")

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
