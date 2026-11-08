#!/usr/bin/env python3
"""
Alpha Terminal — 텔레그램 리포트 (매일)
════════════════════════════════════════
이 파일은 지표를 하나도 계산하지 않습니다. build_snapshot.py 가 만든 snapshot.json · market.json · today.json 을
"읽기만" 합니다 → 텔레그램 숫자와 앱 화면 숫자가 어긋날 수 없습니다.

  notify.py          매일 리포트(build) + 발송 흐름(main)
  notify_lib.py      읽기 도우미 · 숫자 표기 · 후보 고르기 · 발송(send)
  notify_weekly.py   토요일 주간 리포트(build_weekly) — WEEKLY=1 일 때

리포트 순서: 시장(새로 사도 되는가) → 내 보유·관심 → 종목풀·데이터 점검 → DC → 매수 예약 결과 → 오늘 살 것 → 급락 관찰 → 청산 규칙 → 데이터 상태
규칙 숫자는 config/rules.json (scripts/rules.py) — 여기에 숫자를 다시 적지 않습니다.
같은 종목을 매번 다시 보내지 않도록 notified.json 에 기록하고 COOLDOWN_DAYS 안에는 '신규'로 치지 않습니다.

환경변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
          REPORT_MODE = full(기본) | brief   ※ brief 는 신규 신호가 있을 때만 발송
"""

import json, os, sys
from datetime import datetime, timezone, timedelta
from notify_lib import *  # noqa
from notify_lib import _first_trading_day, _fix_names  # noqa
from notify_weekly import build_weekly


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
    _miss = broker_miss(wl)                  # 234. 메리츠에 없는 기록 — 경고만 하고 아래 계산에서는 뺌
    if _miss: wl = {**wl, "positions": [p for p in (wl.get("positions") or []) if str(p.get("t", "")).upper() not in _miss]}
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
            L.append(f"{flag} <b>{name} {VERDICT.get(j['verdict'], j['verdict'])}</b> "
                     f"<i>— {j.get('why','')}</i>")
            if k == "us" and j.get("blocked") is not None:      # 252. 미국 새로 사기는 나스닥100 200일선으로
                L.append(f"   {'⛔ <b>나스닥100 200일선 아래' if j['blocked'] else '✅ 나스닥100 200일선 위'}"
                         f"({(j.get('nq200') or 0):+.1f}%) → 미국 {'새로 사지 않음</b>' if j['blocked'] else '새로 사기 가능'}")
                # 255. 하락장 QQQ 반등 — 기록만 (실제 규칙 아님 · 신호가 생기거나 끝난 날만 한 줄)
                try:
                    _b = ((json.load(open(f"{DATA}/self_check.json", encoding="utf-8")).get("report") or {}).get("bounce") or {})
                except Exception:
                    _b = {}
                if _b.get("today") in ("in", "out"):
                    _sm = _b.get("sum") or {}
                    _hist = f" · 지금까지 {_sm['n']}번 이긴 비율 {_sm['win']:.0f}% 평균 {_sm['avg']:+.1f}%" if _sm.get("n") else ""
                    L.append(f"   📎 <i>기록만: QQQ 반등 {'시작(RSI2 ' + str(round((_b.get('open') or {}).get('rsi2') or 0)) + ')' if _b['today'] == 'in' else '끝'} — 실제로 사지 않음{_hist}</i>")

    # ── 1.4 내 보유·관심 — 이것만 따로 먼저 알립니다 (남의 종목보다 내 종목이 먼저) ──
    mine, etfs_all = [], snap.get("etfs", {})
    veh_all = {v["veh"]["code"]: {**v, "c": v["veh"].get("c"), "n": v["veh"].get("name") or v.get("n"), "m": "kr"}
               for v in etfs_all.values() if (v.get("veh") or {}).get("code")}   # 200. DC용 국내 ETF(360750 등) = 미국 원본 신호로 봄
    look = lambda t: stocks.get(t) or etfs_all.get(t) or veh_all.get(t)
    def tr_of(p):
        tr = p.get("tr") if isinstance(p.get("tr"), list) and p.get("tr") else [{"px": p.get("avg"), "amt": p.get("amt") or 0}]
        return [t for t in tr if t.get("px")]
    for p in (wl.get("positions") or []):
        d = look(p.get("t"))
        if not d:   # 들고 있는데 데이터가 없음 → 거래정지·상장폐지·티커 변경 가능. 조용히 넘기지 않습니다
            _a0 = sum(t.get("amt") or 0 for t in tr_of(p))         # 238. 합계는 앱처럼 넣은 돈 그대로 (평가는 모름 → 원금으로)
            mine.append((True, f"   ⚠️ <b>{p.get('t')}</b> 데이터 없음 — 거래정지·상장폐지·티커 변경 확인 필요",
                         "kr" if str(p.get("t", "")).isdigit() else "us", _a0, _a0, 0))
            continue
        tr = tr_of(p); amt = sum(t.get("amt") or 0 for t in tr); sh = sum((t.get("amt") or 0) / t["px"] for t in tr)
        avg = (amt / sh) if sh else (tr[0]["px"] if tr else None)
        pl = ((d.get("c") or 0) / avg - 1) * 100 if avg else None
        out = p.get("role") != "long" and act_of(d, True) == "sell"
        warn = f" ⚠️{d.get('status') or '거래정지'}" if (d.get("halted") or d.get("status")) else ""
        # 74. 목표가까지 거리 — 내 목표가 우선, 없으면 애널리스트 평균 (참고용 · 매도 신호 아님)
        _nt = (wl.get("notes") or {}).get(str(p.get("t", "")).upper()) or {}
        _tg = _nt.get("tg") or (d.get("tgt") or {}).get("a")
        tgt_part = ""
        if _tg and d.get("c"):
            _gap = (_tg / d["c"] - 1) * 100
            tgt_part = f" · {'🎯 목표 도달(매도 신호 아님)' if _gap <= 0 else f'목표까지 {_gap:+.0f}%'}{'' if _nt.get('tg') else '(애널)'}"
        line = (f"   {ACT['sell'] if out else ACT['hold']} <b>{d.get('n') or p['t']}</b>{warn} {price(d.get('c'), d.get('m'))}"
                + (f" {pct(pl)}" if pl is not None else "")
                + (f" · 트레일링선 {price(d.get('stLine'), d.get('m'))}" if d.get("stLine") else "") + tgt_part + earn_txt(d))
        # 2회차 조건: 1회차뿐이고 1회차 매수가 +3% 넘게 마감 · 느린 ST 초록
        _after = bool(tr) and (not tr[0].get("d") or str(d.get("asOf") or "") > str(tr[0].get("d"))[:10])   # 1회차를 산 뒤의 종가여야 함 (앱과 같음)
        if p.get("role") == "swing" and len(tr) == 1 and d.get("c") and d.get("stSlow") == 1 and _after and tr[0]["px"] * RULES["tranche2"]["lo"] <= d["c"] <= tr[0]["px"] * RULES["tranche2"]["hi"]:
            # 109. 투자금 한도 확인 — 이미 넣은 돈 + 2회차(= 1회차 금액)가 직투 금액을 넘으면 건너뜀 (앱과 같은 판정)
            _mk = d.get("m") or "us"; _cap = (wl.get("settings") or {}).get("usAmt" if _mk == "us" else "krAmt")
            _inv = sum(sum((t.get("amt") or 0) for t in tr_of(q)) for q in (wl.get("positions") or [])
                       if q.get("role") != "etf" and (str(q.get("t", "")).isdigit() == (_mk == "kr")))
            _add = tr[0].get("amt") or 0
            if _cap and _inv + _add > _cap * 1.001:
                line += f"\n      ⚠️ 2회차 조건은 됐지만 <b>투자금 한도 초과 — 건너뜀</b> ({money(_inv, _mk)} 투입 / 직투 {money(_cap, _mk)})"
            else:
                line += f"\n      ✅ <b>2회차 조건 도달</b> (1회차 +3% = {price(tr[0]['px'] * RULES['tranche2']['lo'], d.get('m'))} 넘음, +6% 안) — 1회차와 같은 금액{f' {money(_add, _mk)}' if _add else ''}"
        elif p.get("role") == "swing" and len(tr) == 1 and d.get("c") and d["c"] > tr[0]["px"] * RULES["tranche2"]["hi"]:
            line += f"\n      ⛔ 추격 금지 — 1회차 대비 {(d['c'] / tr[0]['px'] - 1) * 100:+.1f}% (밴드 +3~6% 초과)"
        val = sum((t.get("amt") or 0) / t["px"] * (d.get("c") or t["px"]) for t in tr)
        # 92. 위험 합계 재료 — 스윙·선 위 종목만: 선에 닿으면 잃는 금액 (장기 보유는 선으로 팔지 않아 제외)
        risk = val * (1 - d["stLine"] / d["c"]) if (p.get("role") != "long" and not out and d.get("stSlow") == 1 and d.get("stLine") and d.get("c")) else 0
        mine.append((out, line, d.get("m") or ("kr" if str(p.get("t", "")).isdigit() else "us"), amt, val, risk))
    buys = []
    _own = {str(q.get("t", "")).upper() for q in (wl.get("positions") or [])}
    for t in (wl.get("watch") or []):
        if str(t if isinstance(t, str) else (t or {}).get("t", "")).upper() in _own: continue    # 134. 보유 종목은 위 '내 종목'에 이미 나옴 — 관심 신호에서 뺌
        d = look(t)
        if not d: continue
        if d.get("action") == "buy":
            buys.append(f"   {act_txt(d)} <b>{d.get('n') or t}</b> {price(d.get('c'), d.get('m'))} · RS {int(d.get('rs') or 0)}")
    if mine or buys or _miss:
        L.append("")
        L.append("📁 <b>내 종목</b>")
        if _miss:
            L.append(f"  ⚠️ <b>메리츠 잔고에 없는 기록 {len(_miss)}개</b> ({' · '.join(sorted(_miss))}) — 이미 팔았거나 잘못 들어간 기록입니다. 앱 내 종목 맨 위에서 정리해 주세요 · 아래 계산에서는 뺐습니다")
        for mk, flag in (("us", "🇺🇸"), ("kr", "🇰🇷")):          # 69. 🇺🇸 먼저 · 시장별 소계 (달러는 달러, 원은 원)
            ms = [x for x in mine if x[2] == mk]
            if not ms: continue
            inv = sum(x[3] for x in ms); val = sum(x[4] for x in ms); rk = sum(x[5] for x in ms)
            L.append(f"  {flag} {len(ms)}종목" + (f" · 투입 {money(inv, mk)} → 평가 {money(val, mk)} ({(val/inv-1)*100:+.1f}%)" if inv else "")
                     + (f" · 전부 선 닿으면 −{money(rk, mk)}" if rk > 0 else ""))
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

    # ── 2. DC(퇴직연금) — 나스닥100 · S&P500 · 코스피200 각 23% + 안전자산 30% (230) ──
    #   각 몫은 느린 슈퍼트렌드(12,3) 초록일 때만 보유. 색이 바뀐 날은 🔔 로 따로 알립니다.
    # 99. 앱 DC 탭에서 고른 규칙 하나로만 알립니다 (예전엔 듀얼을 골라도 매일 느린 ST 상태를 보내 화면과 반대로 보였음)
    # 182. 듀얼 모멘텀 → '3지수 그냥 보유'로 바뀜. 예전에 듀얼을 고른 사람은 3지수 보유로 봅니다.
    dc_hold3 = ((wl or {}).get("settings") or {}).get("dcMode", "st") in ("hold", "dual")
    h3 = dc.get("hold3") or {}
    if dc_hold3 and h3.get("items"):
        L.append("")
        L.append("🏦 <b>DC 규칙 · 3지수 보유</b> <i>(나스닥100·S&P500·코스피200 각 23% + 안전자산 30%)</i>")
        L.append("   <i>1년에 한 번(1월 첫 거래일) 비중만 맞춥니다 · 그 사이 오르내림으로는 사고팔지 않습니다</i>")
    if dc.get("core"):
        if not dc_hold3:
            L.append("")
            L.append("🏦 <b>DC 규칙</b> <i>(느린 ST 초록=보유 · 빨강=안전자산)</i>")
        _dcL = L if not dc_hold3 else []          # 3지수 보유면 느린 ST 줄은 보내지 않고 상태만 기록
        for c in dc["core"]:
            d = etfs.get(c.get("sig")) or {}
            st = c.get("state")
            buy = c.get("buy") or {}
            prev = (state.get(f"dc:{c['key']}") or {}).get("state")
            flip = (not first_run) and prev and prev != st and st in ("hold", "wait")
            mark = "🟢 보유" if st == "hold" else "🟡 대기" if st == "wait" else "⚪ 확인불가"
            days = d.get("slowDays")
            _dcL.append(f"   {mark} <b>{c.get('label')}</b> {int(c.get('w',0)*100)}% → {buy.get('name','')} "
                     f"({buy.get('code','')}){f' · {days}거래일째' if days is not None else ''}")
            if flip:
                _dcL.append("   🔔 <b>" + ("초록 전환 — 매수 시작" if st == "hold" else "빨강 전환 — 보유분 매도 → 안전자산") + "</b>")
            state[f"dc:{c['key']}"] = {"ts": now.timestamp(), "state": st}
        ab = mkt.get("allocation", {})
        _dcL.append(f"   <i>안전자산 30%는 적격TDF·채권혼합형·예금 · 다음 비중 점검 {ab.get('nextRebal','분기 첫 거래일')}</i>")

    # ── 249. 매수 예약 — 지난 확인 결과 · 기다리는 예약 (서버가 바로 못 보냈어도 아침에 한 번은 보이게)
    try:
        _rv = (json.load(open(f"{DATA}/resv.json", encoding="utf-8")).get("items") or [])
    except Exception:
        _rv = []
    if _rv:
        _cut = (now.astimezone(timezone.utc) - timedelta(hours=20)).strftime("%Y-%m-%dT%H:%M:%S")   # resv.json 은 세계표준시(Z)
        _ic = {"sent": "✅", "skip": "⏭", "expired": "⌛", "fail": "⚠️", "unsure": "❓"}
        _done = [x for x in _rv if x.get("status") in _ic and str(x.get("doneAt") or "") >= _cut]
        _wait = [x for x in _rv if x.get("status") in ("wait", "run")]
        _nm = lambda x: x.get("n") or x["t"] if x.get("m") == "kr" else x["t"]
        if _done:
            L.append("")
            L.append("⏰ <b>매수 예약 결과</b>")
            for x in _done:
                L.append(f"   {_ic[x['status']]} <b>{_nm(x)}</b> " + (f"{x.get('qty')}주 지정가 {price(x.get('px'), x.get('m', 'us'))} 주문 보냄" if x["status"] == "sent" else f"사지 않음 — {x.get('why') or x['status']}"))
        if _wait:
            L.append("⏰ 예약 기다림: " + " · ".join(f"{_nm(x)} {x.get('qty')}주({str(x.get('day', ''))[4:6].lstrip('0')}/{str(x.get('day', ''))[6:8].lstrip('0')})" for x in _wait))

    # ── 3. 신호 (앱 발굴탭과 같은 목록·같은 순서) ─────────────
    L.append("")
    if entry:
        nkr = sum(1 for s in entry if s["m"] == "kr")
        kinds = {}
        for s in entry: kinds[WHY.get(s.get("why"), "기타")] = kinds.get(WHY.get(s.get("why"), "기타"), 0) + 1
        ncut = sum(1 for d in stocks.values() if d.get("action") == "buy" and (d.get("tvr") or 0) >= RULES["tvrMin"] and not rev_ok(d))
        head = f"🔍 <b>매수! {len(entry)}</b> <i>({' · '.join(f'{k} {v}' for k, v in kinds.items())} · 🇰🇷{nkr} 🇺🇸{len(entry)-nkr})</i>"
        if ncut: head += f" <i>✂ 매출 +{REV_MIN:.0f}% 미만 {ncut} 제외</i>"
        if new_entry: head += f" (신규 {len(new_entry)})"
        L.append(head)
        # 109. 빈 칸 — 앱 '오늘 살 것'과 같은 계산 (칸 수 − 들고 있는 단기 종목 수). 칸이 차면 아래 목록은 참고
        _cfg = (wl.get("settings") or {})
        _note, _open, _freeN = [], {}, {}
        _held = {str(q.get("t", "")).upper() for q in (wl.get("positions") or [])}
        for _m, _f, _n in (("us", "🇺🇸", int(_cfg.get("slotsUs") or RULES["slots"]["us"])), ("kr", "🇰🇷", int(_cfg.get("slotsKr") or RULES["slots"]["kr"]))):
            _h = sum(1 for q in (wl.get("positions") or []) if (q.get("role") or "swing") == "swing" and (str(q.get("t", "")).isdigit() == (_m == "kr")))
            _amt = _cfg.get("usAmt" if _m == "us" else "krAmt")
            _note.append(f"{_f} 투자금 0" if _amt == 0 else (f"{_f} ⚠️ <b>칸보다 많이 보유</b>({_h}/{_n}) — 앱 기록 확인" if _h > _n else f"{_f} <b>칸이 다 참</b>({_h}/{_n})" if _h >= _n else f"{_f} 빈 칸 {_n - _h}/{_n}"))
            _open[_m] = (_amt != 0) and _h < _n
            _freeN[_m] = max(0, _n - _h)
        # 176. 한국 시장 '위험'이면 한국은 새로 사지 않음 (앱 '오늘 살 것'·today.json 과 같은 규칙)
        _jk = ((mkt or {}).get("judge") or {}).get("kr") or {}
        if _jk.get("blocked") and _open.get("kr"):
            _open["kr"] = False
            _note = [x if not x.startswith("🇰🇷") else "🇰🇷 <b>시장 위험 — 새로 사지 않음</b> · 남는 원화는 단기채·국고채3년" for x in _note]
        # 252. 🇺🇸 나스닥100 이 200일선 아래면 미국은 새로 사지 않음 (앱·today.json 과 같은 규칙 · 보유는 트레일링선대로)
        _ju = ((mkt or {}).get("judge") or {}).get("us") or {}
        if _ju.get("blocked") and _open.get("us"):
            _open["us"] = False
            _note = [x if not x.startswith("🇺🇸") else f"🇺🇸 <b>나스닥100 200일선 아래({_ju.get('nq200'):+.1f}%) — 새로 사지 않음</b> · 남는 달러는 SGOV·BIL" for x in _note]
        L.append("   " + " · ".join(_note) + " — <i>빈 칸만큼만 삽니다</i>")
        # 114. 이미 가진 종목은 빼고, 살 수 없는 시장(칸이 참 · 투자금 0)은 목록을 접습니다 (앱 '오늘 살 것'과 같게)
        rows = [s for s in entry if str(s["t"]).upper() not in _held and _open.get(s["m"])]
        _hid = len(entry) - len(rows)
        # ★ 앱 '오늘 살 것'과 같은 목록 — 파이프라인이 확정한 today.json (업종 3개까지 · 적자·재무 없음·매출 부진·보유 제외 · 빈 칸만큼)
        #   예전엔 매수! 전체를 강도 순으로 보여 줘서, 앱이 같은 업종이라 뺀 종목(XOM·CVX 등)이 텔레그램엔 '살 것'처럼 보였음
        _wait = []
        try:
            _td = _fix_names(json.load(open(f"{DATA}/today.json", encoding="utf-8")))
        except Exception:
            _td = None
        if _td and _td.get("pickUs") is not None:
            _sl = _td.get("slots") or {}
            _pk = []
            for _m in ("us", "kr"):
                if not _open.get(_m): continue
                _lst = [stocks.get(r["t"]) for r in (_td.get("pickUs") if _m == "us" else (_td.get("pickKr") or [])) if stocks.get(r["t"]) and str(r["t"]).upper() not in _held]
                _fr = _freeN.get(_m, len(_lst))          # 빈 칸 = 지금 보유 기준 (위 줄과 같은 수)
                _pk += _lst[:_fr]; _wait += _lst[_fr:]
            _hid = len(entry) - len(_pk) - len(_wait)
            rows = _pk
            L.append(f"🛒 <b>오늘 살 것 {len(rows)}</b> <i>(앱 '오늘 살 것'과 같은 목록)</i>")
        if not rows:
            _why0 = "두 시장 모두 새로 사지 않는 날이라" if not any(_open.values()) else "지금 살 수 있는 칸이 없어"
            L.append(f"   <i>{_why0} 목록은 접었습니다 · 전체는 앱 찾기 탭</i>")
        for s in rows[:MAX_ROWS]:
            mark = "🆕 " if is_new("entry", s["t"]) else ""
            flag = "🇰🇷" if s["m"] == "kr" else "🇺🇸"
            f = s.get("fin") or {}
            g = f.get("growth", f.get("rev"))
            fin = (f" · 매출 {g:+.0f}%{'↑' if f.get('accel') else ''}" if g is not None else "") + (" · 적자" if f.get("prof") is False else "")
            gap = f" · 선까지 −{(1 - s['stLine'] / s['c']) * 100:.0f}%" if s.get("stLine") and s.get("c") else ""
            L.append(f"{mark}{flag} <b>{s['n']}</b> {price(s['c'], s['m'])} {pct(s.get('d1'))} {act_txt(s)}")
            L.append(f"   강도 {int(s.get('str') or 0)} · RS {int(s.get('rs') or 0)}{gap} · 하루 거래 {money(s.get('tv'), s['m'])}{fin}{earn_txt(s)}")
        if len(rows) > MAX_ROWS:
            L.append(f"   … 외 {len(rows)-MAX_ROWS}종목")
        if _wait:
            L.append("   <i>대기(칸이 비면 이 순서): " + " · ".join(str(s.get("t") if s.get("m") == "us" else s.get("n")) for s in _wait) + "</i>")
        if _hid > 0 and rows:                 # 238. 칸이 없어 목록을 접었을 때는 겹치는 말을 하지 않음
            L.append(f"   <i>그 밖의 매수! {_hid}개는 보유·같은 업종·적자·매출 부진 등으로 뺐습니다 — 앱 찾기 탭</i>")
        L.append("<i>강세 = 추세 안 RSI 60↑ · 눌림 🇰🇷 = 추세 안 RSI 45 회복 · 추세 = ST 3개 초록+구름 위 · 매도! = 트레일링선 아래 마감</i>")
    else:
        L.append("🔍 <b>매수! 없음</b> — 오늘은 살 것이 없습니다")

    # ── 4. 장기 관찰 (과매도) ─────────────────────────────
    if new_over:
        L.append("")
        L.append(f"🔵 <b>급락 관찰 신규 {len(new_over)}</b> <i>(전체 {len(over)} · 🇺🇸 · 참고용 · 소액 장기만)</i>")
        for s in new_over[:5]:
            L.append(f"🆕 관찰 <b>{s['n']}</b> 고점대비 {pct(s.get('w52p'),0)} · "
                     f"{yrs(s.get('hltY'))}년건강 {int((s.get('hlt') or 0)*100)}% · 20일선 회복")

    # ── 4.9 1월 첫 거래일: DC 비중 맞춤 목표 (앱 💰 투자금의 DC 금액 · 3지수 보유 모드일 때 · 182) ──
    try:
        cfg = (wl.get("settings") or {})
        h3 = ((mkt.get("dc") or {}).get("hold3") or {})
        if cfg.get("dcMode") in ("hold", "dual") and cfg.get("dcAmt") and h3.get("items") and now.month == 1 and _first_trading_day(now):
            total = float(cfg["dcAmt"]); hold = h3["items"]
            semi = False; share = 0.0; riskw = 0.70          # 225. 반도체 고정 칸은 뺐음
            L.append(""); L.append(f"🏦 <b>DC 1년에 한 번 비중 맞춤</b> (총 {money(total, 'kr')} · 오늘 이 금액대로 맞추면 됩니다)")
            for c in hold:
                L.append(f"   {(c.get('buy') or {}).get('code', '—')} {(c.get('buy') or {}).get('name') or c['label']} · {money(total * riskw / 3, 'kr')}")
            if semi: L.append(f"   {((mkt.get('dc') or {}).get('semi') or {}).get('buy', {}).get('code', '')} 반도체 고정 칸 · {money(total * share, 'kr')}")
            safe = 1 - riskw - share
            L.append(f"   안전자산(TDF·채권혼합·예금) · {money(total * safe, 'kr')}")
    except Exception as e:
        print("  ⚠️ DC 목표 안내 실패:", e)

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
    for k in [k for k, v in state.items() if isinstance(v, dict) and v.get("ts", 0) < ts - 86400 * 30]:   # 197. 점검 기록(chkAn·chkRep)은 글자라 건너뜀
        del state[k]                                    # 30일 지난 기록은 정리

    return "\n".join(L), len(new_entry) + len(new_over)

def main():
    snap = load(f"{DATA}/snapshot.json")
    mkt  = load(f"{DATA}/market.json")
    if not snap or not mkt:
        print("❌ snapshot.json / market.json 이 없습니다. build_snapshot.py 를 먼저 실행하세요.")
        return
    state = load(STATE, {}) or {}
    now = datetime.now(KST)
    # 135. 텔레그램은 HTML 모드 — 이름의 & < > 는 한 번만 이스케이프 (이미 &amp; 로 들어온 이름도 한 번 풀고 다시 씌움)
    _fix_names(snap); _fix_names(mkt)

    if os.environ.get("WEEKLY") == "1":          # 토요일 전체 스캔 뒤 주간 리포트 (daily.yml 이 넣어 줍니다)
        text = build_weekly(snap, mkt, now)
        print(text); send(text)

    # 197. 규칙 점검 — 데이터 이상은 내용이 바뀔 때만 · 3주 보고는 보고 날(토) 한 번만
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import self_check as _sc
        chk = load(f"{DATA}/self_check.json")
        if chk:
            an = _sc.anomaly_text(chk)
            key = "|".join(a["msg"] for a in chk.get("anomalies") or [] if a["lvl"] in ("err", "warn"))
            if an and state.get("chkAn") != key and send(an): state["chkAn"] = key
            if not an: state.pop("chkAn", None)
            rd = (chk.get("report") or {}).get("date")
            if chk.get("due") and rd and state.get("chkRep") != rd and send(_sc.report_text(chk)): state["chkRep"] = rd
            with open(STATE, "w", encoding="utf-8") as f:
                json.dump(state, f, ensure_ascii=False, separators=(",", ":"))
    except Exception as e:
        print("  ⚠️ 규칙 점검 알림 실패:", str(e)[:120])

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
