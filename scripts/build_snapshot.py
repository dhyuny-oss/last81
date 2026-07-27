#!/usr/bin/env python3
"""
Alpha Terminal v4 — 지표 스냅샷 파이프라인
════════════════════════════════════════════════════════════════
핵심 원칙: "한 번 계산, 어디서나 표시"
  · 모든 지표를 여기서 한 번만 계산해 snapshot.json 에 저장
  · 프론트/알림은 재계산 없이 읽기만 → 값이 어긋날 자리가 없음

감사에서 잡은 버그를 모두 수정한 계산기:
  · 일목균형 구름   : 최저 '저가' 사용 (기존 App.jsx 는 최고가만 써서 틀림)
  · 슈퍼트렌드     : 표준 추세플립, 실제 0~3 카운트 (기존은 0 아니면 3만 가능)
  · RSI           : Wilder 스무딩 1종만 (기존 단순평균/Wilder 혼용)
  · EMA           : 첫 period SMA 시드 1종만
  · RS            : 교차단면 백분위 1종만 (기존 차이값/백분위 혼용)
  · 거래량비       : 5일평균÷20일평균 (백테스트 최적) + 당일÷20일 둘 다 명시 저장
  · 섹터 1일       : chartPreviousClose 폴백 버그 수정 (1일 자리에 1개월 값이 들어갔음)

출력 3분할:
  public/data/snapshot.json  종목별 최신 지표값 (캔들 제외, 가벼움)
  public/data/market.json    지수·섹터·시장판단
  public/data/candles.json   차트용 일봉 (차트 열 때만 로드)
"""
import json, os, sys, time, math, urllib.request
from datetime import datetime, timezone, timedelta

VERSION   = "4.0.0"
UA        = {"User-Agent": "Mozilla/5.0"}
OUT_DIR   = "public/data"
KST       = timezone(timedelta(hours=9))
BARS_KEEP = 260          # 차트/200일선용 보관 봉수
MIN_BARS  = 130          # 이보다 적으면 지표 일부 생략

# ── 섹터 ETF (감마 통합: 12종) ────────────────────────────────
SECTOR_ETFS = {
    "XLK":"기술","XLF":"금융","XLE":"에너지","XLV":"헬스케어","XLY":"소비재",
    "XLP":"필수소비","XLI":"산업재","XLU":"유틸리티","XLB":"소재","XLC":"커뮤니케이션",
    "XLRE":"부동산","SMH":"반도체",
}
INDICES = {
    "^GSPC":("S&P500","us"), "^IXIC":("NASDAQ","us"), "^KS11":("KOSPI","kr"),
}
RISK = {"^VIX":"VIX", "^TNX":"US10Y", "^IRX":"US3M"}
BENCH = {"us":"^GSPC", "kr":"^KS11"}

# ══════════════════════════════════════════════════════════════
# 데이터 수집
# ══════════════════════════════════════════════════════════════
def fetch_candles(ticker, tries=3):
    """전체 히스토리 일봉. period1/period2 방식 (range=max 는 월봉을 줌)"""
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
           f"?period1=0&period2=9999999999&interval=1d")
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            d = json.load(urllib.request.urlopen(req, timeout=30))["chart"]["result"][0]
            q, ts = d["indicators"]["quote"][0], d["timestamp"]
            out = []
            for i in range(len(ts)):
                o,h,l,c,v = q["open"][i],q["high"][i],q["low"][i],q["close"][i],q["volume"][i]
                if None in (o,h,l,c): continue
                out.append({"t":ts[i],"o":round(o,4),"h":round(h,4),
                            "l":round(l,4),"c":round(c,4),"v":int(v or 0)})
            return out, d.get("meta", {})
        except Exception:
            if a == tries-1: return [], {}
            time.sleep(1.2*(a+1))
    return [], {}

# ══════════════════════════════════════════════════════════════
# 지표 (수정판 — 이 파일이 유일한 계산 위치)
# ══════════════════════════════════════════════════════════════
def sma(x, n):
    return sum(x[-n:])/n if len(x) >= n else None

def sma_series(x, n):
    if len(x) < n: return []
    out=[None]*(n-1); s=sum(x[:n]); out.append(s/n)
    for i in range(n, len(x)):
        s += x[i]-x[i-n]; out.append(s/n)
    return out

def ema_series(x, n):
    """첫 n개 SMA 시드 — 파이썬·JS 통일용 (유일한 EMA 정의)"""
    if len(x) < n: return []
    k = 2/(n+1); e = sum(x[:n])/n
    out = [None]*(n-1) + [e]
    for v in x[n:]:
        e = v*k + e*(1-k); out.append(e)
    return out

def rsi_wilder(c, n=14):
    """Wilder 스무딩 — 유일한 RSI 정의"""
    if len(c) < n+1: return None
    g=l=0.0
    for i in range(1, n+1):
        d = c[i]-c[i-1]; g += max(d,0); l += max(-d,0)
    ag, al = g/n, l/n
    for i in range(n+1, len(c)):
        d = c[i]-c[i-1]
        ag = (ag*(n-1)+max(d,0))/n
        al = (al*(n-1)+max(-d,0))/n
    if al == 0: return 100.0
    return 100 - 100/(1+ag/al)

def macd_hist(c, f=12, s=26, sig=9):
    ef, es = ema_series(c,f), ema_series(c,s)
    if not ef or not es: return None, None
    line = [(ef[i]-es[i]) if (ef[i] is not None and es[i] is not None) else None
            for i in range(len(c))]
    valid = [v for v in line if v is not None]
    sl = ema_series(valid, sig)
    if not sl or sl[-1] is None: return None, None
    hist = line[-1]-sl[-1]
    prevh = (valid[-2]-sl[-2]) if (len(valid)>1 and sl[-2] is not None) else None
    return hist, prevh

def atr_series(cd, n=14):
    if len(cd) < n+1: return []
    trs=[]
    for i in range(1,len(cd)):
        h,l,pc = cd[i]["h"],cd[i]["l"],cd[i-1]["c"]
        trs.append(max(h-l, abs(h-pc), abs(l-pc)))
    out=[None]*n; a=sum(trs[:n])/n; out.append(a)
    for x in trs[n:]:
        a=(a*(n-1)+x)/n; out.append(a)
    return out[:len(cd)]

def supertrend(cd, period, mult):
    """표준 추세플립 — 유일한 ST 정의. 반환 1=bull -1=bear"""
    a = atr_series(cd, period)
    if not a: return 1
    trend, fub, flb = 1, None, None
    for i in range(len(cd)):
        if i >= len(a) or a[i] is None: continue
        hl2 = (cd[i]["h"]+cd[i]["l"])/2
        ub, lb = hl2+mult*a[i], hl2-mult*a[i]
        pc = cd[i-1]["c"] if i>0 else cd[i]["c"]
        fub = ub if (fub is None or ub < fub or pc > fub) else fub
        flb = lb if (flb is None or lb > flb or pc < flb) else flb
        c = cd[i]["c"]
        if   trend ==  1 and c < flb: trend = -1
        elif trend == -1 and c > fub: trend =  1
    return trend

def st_count(cd):
    """★ 실제 0~3 카운트 (기존 App.jsx 는 0 아니면 3만 가능했음)"""
    if len(cd) < 20: return None
    return sum(1 for p,m in ((10,1),(11,2),(12,3)) if supertrend(cd,p,m) == 1)

def ichimoku_pos(cd):
    """★ 최저 '저가' 사용 (기존 App.jsx 는 최고가만 써서 구름 위치가 틀렸음)"""
    if len(cd) < 52: return None
    hi=[x["h"] for x in cd]; lo=[x["l"] for x in cd]; n=len(cd)
    mid = lambda s,e: (max(hi[s:e])+min(lo[s:e]))/2      # ← lows 정상 사용
    tenkan, kijun = mid(n-9,n), mid(n-26,n)
    spanA, spanB  = (tenkan+kijun)/2, mid(n-52,n)
    top, bot, c = max(spanA,spanB), min(spanA,spanB), cd[-1]["c"]
    return 1 if c > top else (-1 if c < bot else 0)      # 위/안/아래

def chg(cd, n):
    if len(cd) <= n: return None
    a, b = cd[-1]["c"], cd[-(n+1)]["c"]
    return (a/b-1)*100 if b else None

def trend_template(cd):
    """추세 템플릿 (Minervini) — 캔들 260봉 보관으로 원본 252봉 사용 가능
       ※ 120봉 단축판은 통과율이 1/3로 떨어져(5.0% vs 14.4%) 실사용 후보가 너무 적어짐"""
    c = [x["c"] for x in cd]
    if len(c) < 253: return None
    ma50, ma150, ma200 = sma(c,50), sma(c,150), sma(c,200)
    if None in (ma50, ma150, ma200): return None
    ma200_prev = sma(c[:-22], 200) if len(c) >= 222 else None
    if ma200_prev is None: return None
    hi252, lo252, px = max(c[-252:]), min(c[-252:]), c[-1]
    return bool(
        px > ma150 and px > ma200 and ma150 > ma200 and ma200 > ma200_prev and
        ma50 > ma150 and ma50 > ma200 and px > ma50 and
        (px/lo252-1)*100 >= 30 and (px/hi252-1)*100 >= -25
    )

def rebreak(cd, win=252):
    """★ 재돌파 — 고점 대비 5%↓ 눌린 뒤 신고가 (백테스트 초과 +1.84%, 단순 신고가의 3배)"""
    if len(cd) < win+11: return None
    c=[x["c"] for x in cd]
    hi_prev = max(c[-(win+1):-1])
    if c[-1] <= hi_prev: return False
    hi_at10 = max(c[-(win+11):-11])
    dist10 = (c[-11]/hi_at10-1)*100 if hi_at10 else 0
    return bool(dist10 < -5)

def healthy_ratio(cd, years=3):
    """3년 중 200일선 위에 있던 비율 — 과매도 탭의 '우량' 판정 (12개월 중앙 +10.1%·승률 60%)"""
    need = 200 + 252          # 최소 1년치 창은 확보
    if len(cd) < need: return None
    c=[x["c"] for x in cd]
    ma = sma_series(c, 200)
    span = min(756, len(c)-200)
    above = sum(1 for i in range(len(c)-span, len(c))
                if ma[i] is not None and c[i] > ma[i])
    return round(above/span, 3)

# ══════════════════════════════════════════════════════════════
# 종목 1개 지표 계산
# ══════════════════════════════════════════════════════════════
def build_stock(ticker, cd, meta, name, market, sector):
    if len(cd) < 30: return None
    c = [x["c"] for x in cd]; v = [x["v"] for x in cd]
    px = c[-1]
    ma200 = sma(c, 200)
    v20 = sma(v, 20); v5 = sma(v, 5)
    hi252 = max(c[-252:]) if len(c) >= 252 else max(c)
    hist, prevh = macd_hist(c)
    turn20 = sma([c[i]*v[i] for i in range(len(c))][-20:], 20)
    d = {
        "t": ticker, "n": name, "m": market, "s": sector,
        "c": round(px, 4),
        "d1": _r(chg(cd,1)), "d3": _r(chg(cd,3)), "d5": _r(chg(cd,5)), "d21": _r(chg(cd,21)),
        "rsi": _r(rsi_wilder(c)),
        "macdH": _r(hist, 4), "macdX": (hist is not None and prevh is not None and prevh < 0 <= hist),
        "st": st_count(cd),
        "stPrev": st_count(cd[:-1]) if len(cd) > 21 else None,
        "cloud": ichimoku_pos(cd),
        "vr":  _r(v[-1]/v20, 3) if v20 else None,          # 당일 ÷ 20일평균
        "vr5": _r(v5/v20, 3) if (v5 and v20) else None,    # 5일 ÷ 20일평균 ★ 신호용
        "tv":  int(turn20) if turn20 else None,            # 거래대금 20일평균
        "ma200p": _r((px/ma200-1)*100) if ma200 else None,
        "w52p":   _r((px/hi252-1)*100) if hi252 else None,
        "tmpl": trend_template(cd),
        "brk":  rebreak(cd),
        "hlt":  healthy_ratio(cd),
        "bars": len(cd),
        "asOf": datetime.fromtimestamp(cd[-1]["t"], timezone.utc).strftime("%Y-%m-%d"),
    }
    # ★ ST 0→3 전환 = 진입 트리거 (기존 App.jsx 는 이 계산이 불가능했음)
    d["stFlip"] = bool(d["st"] == 3 and d["stPrev"] is not None and d["stPrev"] < 3)
    return d

def _r(x, nd=2):
    return None if x is None else round(x, nd)

# ══════════════════════════════════════════════════════════════
# 시장 · 섹터
# ══════════════════════════════════════════════════════════════
def build_market():
    idx = {}
    for tk,(label,mkt) in INDICES.items():
        cd,_ = fetch_candles(tk); time.sleep(0.25)
        if len(cd) < 210:
            print(f"  ⚠️ {tk} 캔들 부족 {len(cd)}"); continue
        c=[x["c"] for x in cd]; ma200=sma(c,200)
        idx[tk] = {"label":label,"market":mkt,"c":_r(c[-1],2),
                   "d1":_r(chg(cd,1)),"d3":_r(chg(cd,3)),"d5":_r(chg(cd,5)),"d21":_r(chg(cd,21)),
                   "ma200p": _r((c[-1]/ma200-1)*100) if ma200 else None,
                   "asOf": datetime.fromtimestamp(cd[-1]["t"],timezone.utc).strftime("%Y-%m-%d")}
        print(f"  {label:8s} {c[-1]:>10,.2f}  1일 {idx[tk]['d1']:+.2f}%  200일선 {idx[tk]['ma200p']:+.1f}%")

    risk = {}
    for tk,label in RISK.items():
        cd,_ = fetch_candles(tk); time.sleep(0.25)
        if not cd: continue
        risk[tk] = {"label":label,"c":_r(cd[-1]["c"],3),
                    "d1":_r(chg(cd,1)),"d5":_r(chg(cd,5)),"d21":_r(chg(cd,21))}
    if "^TNX" in risk and "^IRX" in risk:
        risk["curve"] = {"label":"10Y-3M","c":_r(risk["^TNX"]["c"]-risk["^IRX"]["c"],3)}

    # 시장 판단 — 200일선 위=안전 / 아래=위험 / 위지만 급락=주의
    judge = {}
    for mkt, tk in (("us","^GSPC"), ("kr","^KS11")):
        i = idx.get(tk)
        if not i or i["ma200p"] is None: continue
        if i["ma200p"] < 0:
            v, why = "risk", "200일선 아래"
        elif (i["d1"] is not None and i["d1"] <= -5) or (i["d21"] is not None and i["d21"] <= -15):
            v, why = "warn", "200일선 위지만 최근 급락"
        else:
            v, why = "safe", "200일선 위 · 급락 없음"
        judge[mkt] = {"verdict":v, "why":why, "index":tk}

    # 섹터 — ★ 캔들로 직접 계산 (chartPreviousClose 폴백 버그 회피)
    secs=[]
    spy_cd,_ = fetch_candles("^GSPC"); time.sleep(0.2)
    for tk,label in SECTOR_ETFS.items():
        cd,_ = fetch_candles(tk); time.sleep(0.25)
        if len(cd) < 130:
            print(f"  ⚠️ {tk} 캔들 부족"); continue
        c=[x["c"] for x in cd]; ma200=sma(c,200)
        secs.append({"tk":tk,"label":label,"c":_r(c[-1],2),
                     "d1":_r(chg(cd,1)),"d3":_r(chg(cd,3)),"d5":_r(chg(cd,5)),"d21":_r(chg(cd,21)),
                     "m3":_r(chg(cd,63)),"m6":_r(chg(cd,126)),
                     "ma200p":_r((c[-1]/ma200-1)*100) if ma200 else None})
        print(f"  {label:8s} 1일 {secs[-1]['d1']:+6.2f}%  6개월 {secs[-1]['m6']:+7.2f}%")
    secs.sort(key=lambda s: -(s["m6"] if s["m6"] is not None else -999))
    for i,s in enumerate(secs): s["rank"] = i+1
    holds = [s["tk"] for s in secs[:3] if (s["m6"] or 0) > 0]
    defense = len(holds) < 3

    return {"indices":idx, "risk":risk, "judge":judge,
            "sectors":secs, "allocation":{"holds":holds,"defense":defense,"nPositive":len(holds)}}

# ══════════════════════════════════════════════════════════════
def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    t0 = time.time()
    print("="*64); print(f"  Alpha Terminal 스냅샷 파이프라인 v{VERSION}"); print("="*64)

    # 유니버스 — 기존 stocks.json 에서 승계
    src = json.load(open(f"{OUT_DIR}/stocks.json", encoding="utf-8"))
    universe = {}
    for tk, s in (src.get("stocks") or {}).items():
        mkt = (s.get("market") or "us").lower()
        universe[tk] = {"name": s.get("label") or tk, "market": mkt,
                        "sector": s.get("sector") or "",
                        "y": tk + (".KS" if mkt=="kr" and not tk.endswith(".KS") else "")}
    print(f"\n📋 유니버스 {len(universe)}종목 "
          f"(kr {sum(1 for x in universe.values() if x['market']=='kr')} · "
          f"us {sum(1 for x in universe.values() if x['market']=='us')})")

    print("\n🌐 시장·섹터 수집")
    market = build_market()

    print(f"\n📊 종목 지표 계산 ({len(universe)}종목)")
    stocks, candles, fails = {}, {}, []
    for i,(tk,info) in enumerate(universe.items()):
        cd, meta = fetch_candles(info["y"])
        if len(cd) < 30 and info["market"] == "kr" and info["y"].endswith(".KS"):
            # ★ 코스닥 종목은 .KS 가 아니라 .KQ — 44종목이 이 때문에 실패했음
            cd, meta = fetch_candles(info["y"][:-3] + ".KQ")
            if len(cd) >= 30: info["y"] = info["y"][:-3] + ".KQ"
            time.sleep(0.15)
        if len(cd) < 30:
            fails.append(tk); time.sleep(0.15); continue
        cd = cd[-max(BARS_KEEP, 1000):]                # 3년(756일) 건강도 + 200일선 = 956봉 필요
        d = build_stock(tk, cd, meta, info["name"], info["market"], info["sector"])
        if d:
            stocks[tk] = d
            candles[tk] = [[x["t"],x["o"],x["h"],x["l"],x["c"],x["v"]] for x in cd[-BARS_KEEP:]]
        else:
            fails.append(tk)
        if (i+1) % 50 == 0:
            print(f"    {i+1}/{len(universe)}  성공 {len(stocks)} 실패 {len(fails)}  "
                  f"({time.time()-t0:.0f}s)", flush=True)
        time.sleep(0.15)

    # RS 백분위 — 교차단면 (시장별로 따로)
    print("\n📈 RS 백분위 계산 (교차단면)")
    for mkt in ("us","kr"):
        grp = [(tk,d) for tk,d in stocks.items() if d["m"]==mkt and d.get("d21") is not None]
        if len(grp) < 10: continue
        # 63일 수익률 기준 (백테스트와 동일)
        vals=[]
        for tk,d in grp:
            cds = candles.get(tk)
            r63 = None
            if cds and len(cds) > 63:
                a,b = cds[-1][4], cds[-64][4]
                r63 = (a/b-1)*100 if b else None
            vals.append((tk, r63 if r63 is not None else -999))
        vals.sort(key=lambda x: x[1])
        n = len(vals)
        for rank,(tk,_) in enumerate(vals):
            stocks[tk]["rs"] = round(rank/(n-1)*100, 1) if n > 1 else 50.0
        print(f"  {mkt}: {n}종목")

    # 거래대금 백분위
    for mkt in ("us","kr"):
        grp = [(tk,d["tv"]) for tk,d in stocks.items() if d["m"]==mkt and d.get("tv")]
        if len(grp) < 10: continue
        grp.sort(key=lambda x: x[1]); n=len(grp)
        for rank,(tk,_) in enumerate(grp):
            stocks[tk]["tvr"] = round(rank/(n-1)*100, 1)

    now = datetime.now(timezone.utc)
    meta = {"version":VERSION, "generatedAt":now.isoformat(),
            "generatedKST":now.astimezone(KST).strftime("%Y-%m-%d %H:%M"),
            "counts":{"stocks":len(stocks),"failed":len(fails),
                      "sectors":len(market["sectors"]),"indices":len(market["indices"])}}

    _write(f"{OUT_DIR}/snapshot.json", {"meta":meta,"stocks":stocks})
    _write(f"{OUT_DIR}/market.json",   {"meta":meta, **market})
    _write(f"{OUT_DIR}/candles.json",  {"meta":{"version":VERSION,"bars":BARS_KEEP},"candles":candles})

    print(f"\n{'='*64}")
    print(f"  ✅ 완료 {time.time()-t0:.0f}초 · 종목 {len(stocks)} · 실패 {len(fails)}")
    for f in ("snapshot","market","candles"):
        p=f"{OUT_DIR}/{f}.json"
        print(f"     {f+'.json':16s} {os.path.getsize(p)/1024:>8,.0f} KB")
    if fails: print(f"  ⚠️ 실패: {', '.join(fails[:12])}{' …' if len(fails)>12 else ''}")
    print("="*64)

def _write(path, obj):
    with open(path,"w",encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",",":"))

if __name__ == "__main__":
    main()
