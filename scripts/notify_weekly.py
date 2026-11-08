"""텔레그램 주간 리포트 (토요일 전체 스캔 뒤) — notify.py main() 이 WEEKLY=1 일 때 부릅니다"""
from notify_lib import *  # noqa
from notify_lib import _first_trading_day, _fix_names  # noqa  (밑줄 이름은 import * 에 안 들어옴)
import json, os, sys
from datetime import datetime, timezone, timedelta


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
    _mw = broker_miss(wl)                    # 234
    if _mw: wl = {**wl, "positions": [p for p in (wl.get("positions") or []) if str(p.get("t", "")).upper() not in _mw]}
    ps = wl.get("positions") or []
    sells = [p for p in ps if p.get("role") != "long" and (stocks.get(p["t"]) or {}).get("action") == "sell"]
    near = []
    for p in ps:
        d = stocks.get(p["t"]) or {}
        if d.get("stLine") and d.get("c") and d.get("stSlow") == 1 and (1 - d["stLine"] / d["c"]) * 100 < 5: near.append(d.get("n") or p["t"])
    L.append(f"2️⃣ 내 종목 {len(ps)} · 매도! {len(sells)} · 선까지 −5% 이내 {len(near)}" + (f" ({', '.join(near[:4])})" if near else ""))
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
    if dr and dr.get("flag"): L.append("   📊 앱 실적: " + " · ".join(dr["reasons"]) + " — 지켜보는 중 (점검 탭 앱 실적)")
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
        td = _fix_names(json.load(open(f"{DATA}/today.json", encoding="utf-8")))
    except Exception:
        td = None
    if td and td.get("pickUs") is not None:
        _sl = (td.get("slots") or {}).get("us") or {}
        _free = _sl.get("free")
        L.append("4️⃣½ 🇺🇸 추천 (강도 순 · 업종 분산 · 적자·매출 부진·보유 제외)"
                 + (f" · <b>빈 칸 {_free}/{_sl.get('n')}</b>" if _free is not None else ""))
        if _free == 0:
            L.append(f"   ⛔ <b>칸이 다 찼습니다 (보유 {_sl.get('held')} · {_sl.get('n')}칸) — 새로 사지 않습니다.</b> 아래는 칸이 비면 살 순번")
        elif _free is not None and _free < len(td["pickUs"]):
            L.append(f"   위에서 {_free}개만 삽니다 — 나머지는 대기")
        for i, r in enumerate(td["pickUs"], 1):
            L.append(f"   {i}. <b>{r['t']}</b> {(r.get('n') or '')[:18]} · {WHY.get(r.get('why'),'')} · 강도{int(r.get('str') or 0)} · RS{int(r.get('rs') or 0)}"
                     + (f" · 선까지 −{r['loss']:.0f}%" if r.get("loss") is not None else "") + (f" · 매출{(r.get('growth') if r.get('growth') is not None else r['rev']):+.0f}%{'↑' if r.get('accel') else ''}" if (r.get("growth") is not None or r.get("rev") is not None) else "")
                     + (f" · 🆕{int(r['since'][5:7])}/{int(r['since'][8:10])}~ {r['age']}일째" if (r.get("age") and r.get("since")) else (f" · 🆕{r['age']}일째" if r.get("age") else ""))
                     + (f" · 1회차 {r['sh']}주" if r.get("sh") else "")
                     + earn_txt(r))
        if td.get("excluded"): L.append("   <i>제외: " + ", ".join(f"{x['t']}({'·'.join(x['why'])})" for x in td["excluded"][:8]) + "</i>")
        if ((td.get("size") or {}).get("us") or {}).get("amt"):
            _z = td["size"]["us"]; L.append(f"   <i>🇺🇸 칸당 ${_z['slot']:,.0f} · 1회차 ${_z['half']:,.0f} ({_z['slots']}칸)</i>")
        _krz = (td.get("size") or {}).get("kr")
        if td.get("pickKr"): L.append("   🇰🇷 " + ", ".join(f"{r.get('n')}({WHY.get(r.get('why'),'')})" for r in td["pickKr"])
                                     + (" — 🇰🇷 투자금 0원 (쉬는 중)" if (_krz and not _krz.get("amt")) else (" — 시장 위험이면 새로 사지 않음" if td.get("market", {}).get("kr") == "risk" else "")))
    else:
      # (today.json 이 없을 때의 예비 계산)
      secrank = {x["tk"]: x["rank"] for x in (mkt.get("sectors") or [])}
      held = {p.get("t") for p in ((wl or {}).get("positions") or [])}
      buys = [d for d in stocks.values() if d.get("action") == "buy" and (d.get("tvr") or 0) >= RULES["tvrMin"] and d.get("m") == "us" and d.get("t") not in held]
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
      krb = [d for d in stocks.values() if d.get("action") == "buy" and d.get("m") == "kr" and (d.get("tvr") or 0) >= RULES["tvrMin"]]
      if krb:
          L.append("   🇰🇷 " + ", ".join(f"{d['n']}({WHY.get(d.get('why'),'')})" for d in sorted(krb, key=rk)[:4]) + (" — 시장 위험: 새로 사지 않음" if (mkt.get("judge") or {}).get("kr", {}).get("verdict") == "risk" else ""))
    # 5 DC
    dc = mkt.get("dc") or {}
    _h3 = ((wl or {}).get("settings") or {}).get("dcMode", "st") in ("hold", "dual")
    if _h3 and (dc.get("hold3") or {}).get("items"):
        L.append("5️⃣ DC 3지수 보유 (내 규칙): 나스닥100·S&P500·코스피200 각 23% — 1월 첫 거래일에만 비중 맞춤")
    for c in (dc.get("core") or []):
        L.append(f"   느린 ST 규칙{' (참고)' if _h3 else ' (내 규칙)'} {c.get('label')}: {'보유' if c.get('state')=='hold' else '대기'}")
    h = meta.get("health") or {}
    L.append(f"<i>🩺 {h.get('kept','?')}종목 · {meta.get('generatedKST','')} · 전략 결정은 앱 점검 탭 5번에 한 줄</i>")
    L.append(f'<a href="{APP_URL}">점검 탭 열기 →</a>')
    return "\n".join(L)
