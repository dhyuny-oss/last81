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
  public/data/bars/<티커>.json  차트용 시계열 (누른 종목만 로드, 1개 약 16KB)
"""
import json, os, sys, time, math, urllib.request
from datetime import datetime, timezone, timedelta

VERSION   = "5.0.0"
UA        = {"User-Agent": "Mozilla/5.0"}
OUT_DIR   = "public/data"
KST       = timezone(timedelta(hours=9))
BARS_KEEP   = 200        # 차트에 보관할 봉수 (약 10개월)
RS_LOOKBACK = 126        # RS 백분위 기준 기간 (6개월) — 검증으로 정한 값
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
def fetch_candles(ticker, tries=3, min_bars=200):
    """전체 히스토리 일봉. period1/period2 방식 (range=max 는 월봉을 줌)
       ★ query1 이 막히면 query2 로 한 번 더 (야후는 종종 한쪽만 404 를 냅니다)"""
    for a in range(tries):
        host = "query2" if a % 2 else "query1"
        url = (f"https://{host}.finance.yahoo.com/v8/finance/chart/{ticker}"
               f"?period1=0&period2=9999999999&interval=1d")
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
            # ★ 200 OK 인데 봉이 몇 개 안 오는 경우가 있습니다. 조용히 받아들이면
            #   ma200/추세템플릿이 전부 None 인 종목이 정상인 척 배포됩니다.
            if len(out) < min_bars and a < tries-1:
                time.sleep(1.2*(a+1)); continue
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
    if al == 0 and ag == 0: return None      # 완전 횡보 — 100 이 아니라 값 없음
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

ST_SET = ((10,1), (11,2), (12,3))   # 트리플 슈퍼트렌드 — 카운트와 차트가 같은 조합을 씁니다

def st_count(cd):
    """★ 실제 0~3 카운트 (기존 App.jsx 는 0 아니면 3만 가능했음)"""
    if len(cd) < 20: return None
    return sum(1 for p,m in ST_SET if supertrend(cd,p,m) == 1)

# 차트 파일의 열 순서 — 프론트가 이 이름으로 읽습니다 (인덱스 하드코딩 방지)
COLS = ["t","c","v","ma20","ma200","spanA","spanB",
        "st1","st2","st3","stDir","rsi","macd","hist"]
# st1/st2/st3 = 트리플 슈퍼트렌드 밴드 (아래 ST_SET 과 같은 조합).
# stDir = 3비트 묶음 (1비트=st1 상승, 2비트=st2, 4비트=st3) → 켜진 비트 수가 곧 ST n/3.

DISP = 26   # 선행스팬 변위

def ichimoku_pos(cd):
    """일목 구름 위치. 두 가지를 바로잡았습니다.
       ① 저가 사용 (기존 App.jsx 는 최고가만 써서 중간값이 틀렸음)
       ② ★ 선행스팬 26봉 변위 — 오늘 자리의 구름은 26봉 전 데이터로 만든 것입니다.
          변위를 빼먹으면 '아직 그려지지도 않은 미래 구름'과 오늘 종가를 비교하게 됩니다.
          실제 데이터에서 719종목 중 255종목(35%)의 판정이 달라졌습니다."""
    if len(cd) < 52 + DISP: return None
    hi=[x["h"] for x in cd]; lo=[x["l"] for x in cd]
    e = len(cd) - DISP                                   # 26봉 전에서 창을 끊습니다
    mid = lambda w: (max(hi[e-w:e])+min(lo[e-w:e]))/2
    tenkan, kijun = mid(9), mid(26)
    spanA, spanB  = (tenkan+kijun)/2, mid(52)
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
    # ★ 52주 고/저는 장중 고가·저가 기준 (증권사·차트사이트와 같은 정의).
    #   종가만 쓰면 INFY 처럼 -45% vs 실제 -63% 로 18%p 나 벌어집니다.
    hi252 = max(x["h"] for x in cd[-252:]); lo252 = min(x["l"] for x in cd[-252:])
    px = c[-1]
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
    # ★ 실제로 몇 년을 봤는지도 같이 돌려줍니다 — 상장 3년 미만 종목에
    #   "3년 건강도"라고 적어 놓는 것이 거짓말이 되지 않도록.
    return round(above/span, 3), round(span/252, 1)

# ══════════════════════════════════════════════════════════════
# 종목 1개 지표 계산
# ══════════════════════════════════════════════════════════════
def rsi_series(c, n=14):
    """RSI 시계열 — 마지막 값은 rsi_wilder() 와 정확히 일치합니다"""
    if len(c) < n+1: return [None]*len(c)
    out=[None]*n
    g=l=0.0
    for i in range(1, n+1):
        d=c[i]-c[i-1]; g+=max(d,0); l+=max(-d,0)
    ag, al = g/n, l/n
    out.append(None if (ag==0 and al==0) else (100.0 if al==0 else 100-100/(1+ag/al)))
    for i in range(n+1, len(c)):
        d=c[i]-c[i-1]
        ag=(ag*(n-1)+max(d,0))/n; al=(al*(n-1)+max(-d,0))/n
        out.append(None if (ag==0 and al==0) else (100.0 if al==0 else 100-100/(1+ag/al)))
    return out

def macd_series(c, f=12, s=26, sig=9):
    """MACD 선·시그널·히스토그램 시계열 — 마지막 hist 는 macd_hist() 와 일치"""
    n=len(c); ef, es = ema_series(c,f), ema_series(c,s)
    if not ef or not es: return [None]*n, [None]*n, [None]*n
    line=[(ef[i]-es[i]) if (ef[i] is not None and es[i] is not None) else None for i in range(n)]
    idx=[i for i,v in enumerate(line) if v is not None]
    sl=ema_series([line[i] for i in idx], sig)
    macd=[None]*n; sigl=[None]*n; hist=[None]*n
    for k,i in enumerate(idx):
        macd[i]=line[i]
        if k < len(sl) and sl[k] is not None:
            sigl[i]=sl[k]; hist[i]=line[i]-sl[k]
    return macd, sigl, hist

def supertrend_series(cd, period, mult):
    """슈퍼트렌드 밴드 시계열 + 방향. supertrend() 와 같은 루프라 마지막 방향이 일치합니다."""
    n=len(cd); a=atr_series(cd, period)
    if not a: return [None]*n, [None]*n
    line=[None]*n; dirs=[None]*n
    trend, fub, flb = 1, None, None
    for i in range(n):
        if i >= len(a) or a[i] is None: continue
        hl2=(cd[i]["h"]+cd[i]["l"])/2
        ub, lb = hl2+mult*a[i], hl2-mult*a[i]
        pc = cd[i-1]["c"] if i>0 else cd[i]["c"]
        fub = ub if (fub is None or ub < fub or pc > fub) else fub
        flb = lb if (flb is None or lb > flb or pc < flb) else flb
        c = cd[i]["c"]
        if   trend ==  1 and c < flb: trend = -1
        elif trend == -1 and c > fub: trend =  1
        line[i] = flb if trend == 1 else fub
        dirs[i] = trend
    return line, dirs

def ichimoku_series(cd):
    """구름 시계열. ★ 선행스팬을 26봉 앞으로 민 값을 각 봉 자리에 넣습니다 —
       그래야 화면의 구름과 ichimoku_pos() 의 위/안/아래 판정이 같은 것을 가리킵니다."""
    n=len(cd); hi=[x["h"] for x in cd]; lo=[x["l"] for x in cd]
    A=[None]*n; B=[None]*n
    mid=lambda e,w: (max(hi[e-w:e])+min(lo[e-w:e]))/2
    for i in range(n):
        e = i - DISP + 1                 # 이 봉 자리의 구름 = 26봉 전 창
        if e < 52: continue
        t, k = mid(e,9), mid(e,26)
        A[i] = (t+k)/2; B[i] = mid(e,52)
    return A, B

def build_series(cd, keep, nd):
    """차트용 시계열 한 벌. 화면은 이 값을 '그리기만' 합니다 — 지표 계산은 여기가 유일합니다."""
    c=[x["c"] for x in cd]
    ma20, ma200 = sma_series(c,20), sma_series(c,200)
    sA, sB = ichimoku_series(cd)
    # 트리플 슈퍼트렌드 — st_count() 와 완전히 같은 조합이라,
    # 차트에서 초록으로 보이는 선의 개수가 곧 "ST n/3" 입니다.
    tri = [supertrend_series(cd, p, m) for p, m in ST_SET]
    rsi = rsi_series(c)
    macd, sigl, hist = macd_series(c)
    def g(a, i):
        if i >= len(a) or a[i] is None: return None
        return round(a[i], nd)
    rows=[]
    for i in range(len(cd)-keep, len(cd)):
        mask, any_dir = 0, False
        for k,(_, dirs) in enumerate(tri):
            d = dirs[i] if i < len(dirs) else None
            if d is not None:
                any_dir = True
                if d == 1: mask |= (1 << k)
        rows.append([
            cd[i]["t"], round(cd[i]["c"], nd), int(cd[i]["v"] or 0),
            g(ma20,i), g(ma200,i), g(sA,i), g(sB,i),
            g(tri[0][0],i), g(tri[1][0],i), g(tri[2][0],i),
            (mask if any_dir else None),
            (None if i>=len(rsi) or rsi[i] is None else round(rsi[i],1)),
            (None if i>=len(macd) or macd[i] is None else round(macd[i],3)),
            (None if i>=len(hist) or hist[i] is None else round(hist[i],3)),
        ])
    return rows

def build_stock(ticker, cd, meta, name, market, sector):
    if len(cd) < 30: return None
    # ★ 종목명 — stocks.json 의 label 이 티커와 같으면(미국 425종목이 전부 그랬음)
    #   야후 meta 의 회사명으로 채웁니다. 추가 요청 0회 (이미 받아둔 응답).
    if not name or name == ticker:
        name = meta.get("longName") or meta.get("shortName") or ticker
    c = [x["c"] for x in cd]; v = [x["v"] for x in cd]
    px = c[-1]
    ma200 = sma(c, 200)
    v20 = sma(v, 20); v5 = sma(v, 5)
    # ★ 52주 고점은 장중 고가 기준 — 증권사·차트사이트와 같은 정의입니다.
    #   종가만 쓰면 INFY 가 -45% 로 나오지만 실제 고점 대비로는 -63% 입니다.
    win = cd[-252:] if len(cd) >= 252 else cd
    hi252 = max(x["h"] for x in win)
    hist, prevh = macd_hist(c)
    turn20 = sma([c[i]*v[i] for i in range(len(c))][-20:], 20)
    at = atr_series(cd, 14)
    atrp = (at[-1]/px*100) if (len(at) and at[-1] is not None and px) else None
    d = {
        "t": ticker, "n": name, "m": market, "s": sector,
        "atrp": _r(atrp, 2),                     # ★ 변동성 = ATR(14) ÷ 가격 %
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
        "hlt":  (healthy_ratio(cd) or (None,None))[0],
        "hltY": (healthy_ratio(cd) or (None,None))[1],   # 실제 관측 연수 (3년 미만이면 그대로 표시)
        "bars": len(cd),
        "asOf": datetime.fromtimestamp(cd[-1]["t"], timezone.utc).strftime("%Y-%m-%d"),
    }
    # ★ ST 0→3 전환 = 진입 트리거 (기존 App.jsx 는 이 계산이 불가능했음)
    d["stFlip"] = bool(d["st"] == 3 and d["stPrev"] is not None and d["stPrev"] < 3)
    return d

def _r(x, nd=2):
    return None if x is None else round(x, nd)

def _f(x):
    return "  —  " if x is None else f"{x:+.2f}%"

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
        print(f"  {label:8s} {c[-1]:>10,.2f}  1일 {_f(idx[tk]['d1'])}  200일선 {_f(idx[tk]['ma200p'])}")

    risk = {}
    for tk,label in RISK.items():
        cd,_ = fetch_candles(tk); time.sleep(0.25)
        if not cd: continue
        risk[tk] = {"label":label,"c":_r(cd[-1]["c"],3),
                    "d1":_r(chg(cd,1)),"d5":_r(chg(cd,5)),"d21":_r(chg(cd,21)),
                    # ★ 금리는 그 자체가 % 입니다. 상대변화(+6.3%)만 보여주면
                    #   "6.3%포인트 올랐다"로 읽힙니다 → 절대 변화(%p)도 함께.
                    "d21p": _r(cd[-1]["c"]-cd[-22]["c"],3) if len(cd)>22 else None}
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
    for tk,label in SECTOR_ETFS.items():
        cd,_ = fetch_candles(tk); time.sleep(0.25)
        if len(cd) < 130:
            print(f"  ⚠️ {tk} 캔들 부족"); continue
        c=[x["c"] for x in cd]; ma200=sma(c,200)
        secs.append({"tk":tk,"label":label,"c":_r(c[-1],2),
                     "d1":_r(chg(cd,1)),"d3":_r(chg(cd,3)),"d5":_r(chg(cd,5)),"d21":_r(chg(cd,21)),
                     "m3":_r(chg(cd,63)),"m6":_r(chg(cd,126)),
                     "ma200p":_r((c[-1]/ma200-1)*100) if ma200 else None})
        print(f"  {label:8s} 1일 {_f(secs[-1]['d1'])}  6개월 {_f(secs[-1]['m6'])}")
    secs.sort(key=lambda s: -(s["m6"] if s["m6"] is not None else -999))
    for i,s in enumerate(secs): s["rank"] = i+1
    holds = [s["tk"] for s in secs[:3] if (s["m6"] or 0) > 0]
    defense = len(holds) < 3

    # ★ 원/달러 — 배분탭이 "얼마 넣어서 몇 주"를 원화로 말하려면 필요합니다
    fx = None
    fx_cd,_ = fetch_candles("USDKRW=X"); time.sleep(0.2)
    if fx_cd: fx = _r(fx_cd[-1]["c"], 2)
    print(f"  USD/KRW  {fx}")

    return {"indices":idx, "risk":risk, "judge":judge, "fx":{"usdkrw":fx},
            "sectors":secs, "allocation":{"holds":holds,"defense":defense,"nPositive":len(holds)}}

# ══════════════════════════════════════════════════════════════
EXTRA_FILE = "scripts/tickers_extra.txt"

def load_extra(universe):
    """★ 내가 직접 넣는 종목 목록.

    scripts/tickers_extra.txt 에 한 줄에 하나씩 적으면 됩니다.
    깃허브 웹에서 그냥 파일 열어 고치시면 됩니다 — 형식은 셋 다 됩니다:

        AAPL                 (미국 — 이름은 야후에서 자동)
        005930               (숫자 6자리면 한국으로 인식, .KS→.KQ 자동)
        042660  한화오션        (이름을 직접 적고 싶을 때)

    # 로 시작하는 줄과 빈 줄은 무시합니다.
    이미 stocks.json 에 있는 종목은 건너뜁니다(중복 추가 안 됨).
    """
    if not os.path.exists(EXTRA_FILE):
        return []
    added = []
    for raw in open(EXTRA_FILE, encoding="utf-8"):
        line = raw.split("#")[0].strip()
        if not line: continue
        parts = line.split(None, 1)
        tk = parts[0].strip().upper()
        name = parts[1].strip() if len(parts) > 1 else ""
        if not tk or tk in universe: continue
        mkt = "kr" if (tk.isdigit() and len(tk) == 6) else "us"
        universe[tk] = {"name": name or tk, "market": mkt, "sector": "",
                        "y": tk + (".KS" if mkt == "kr" else "")}
        added.append(tk)
    return added

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    t0 = time.time()
    print("="*64); print(f"  Alpha Terminal 스냅샷 파이프라인 v{VERSION}"); print("="*64)

    # 유니버스 — 기존 stocks.json 승계 + 내가 직접 넣은 종목(EXTRA_FILE)
    src = json.load(open(f"{OUT_DIR}/stocks.json", encoding="utf-8"))
    universe = {}
    for tk, s in (src.get("stocks") or {}).items():
        mkt = (s.get("market") or "us").lower()
        # ★ 기존 sector 는 전부 "US"/"Korean" — 섹터가 아니라 시장 이름이라 버립니다
        sec = s.get("sector") or ""
        if sec in ("US", "Korean", "KR", "us", "kr"): sec = ""
        universe[tk] = {"name": s.get("label") or tk, "market": mkt,
                        "sector": sec,
                        "y": tk + (".KS" if mkt=="kr" and not tk.endswith(".KS") else "")}
    base_n = len(universe)
    extra_added = load_extra(universe)
    print(f"\n📋 유니버스 {len(universe)}종목 "
          f"(kr {sum(1 for x in universe.values() if x['market']=='kr')} · "
          f"us {sum(1 for x in universe.values() if x['market']=='us')})")
    print(f"   · stocks.json {base_n}개 + 직접추가 {len(extra_added)}개"
          + (f" → {', '.join(extra_added)}" if extra_added else ""))

    print("\n🌐 시장·섹터 수집")
    market = build_market()

    print(f"\n📊 종목 지표 계산 ({len(universe)}종목)")
    stocks, series = {}, {}

    def try_one(tk, info, pause):
        """1종목 처리. 성공하면 True. 코스닥(.KQ) 대체까지 포함."""
        cd, meta = fetch_candles(info["y"])
        if len(cd) < 30 and info["market"] == "kr" and info["y"].endswith(".KS"):
            # ★ 코스닥 종목은 .KS 가 아니라 .KQ — 43종목이 이 때문에 실패했음
            time.sleep(pause)
            cd, meta = fetch_candles(info["y"][:-3] + ".KQ")
            if len(cd) >= 30: info["y"] = info["y"][:-3] + ".KQ"
        if len(cd) < 30:
            time.sleep(pause); return False
        cd = cd[-max(BARS_KEEP, 1000):]                # 3년(756일) 건강도 + 200일선 = 956봉 필요
        d = build_stock(tk, cd, meta, info["name"], info["market"], info["sector"])
        time.sleep(pause)
        if not d: return False
        stocks[tk] = d
        # ★ 차트용 시계열 — 종목당 파일 1개.
        #   예전처럼 한 덩어리(candles.json)로 묶으면 차트 탭을 처음 열 때 9MB 를 받습니다.
        #   종목별로 쪼개면 누른 종목 하나만 16KB 받으면 됩니다.
        nd = 0 if d["c"] >= 2000 else 2       # 원화 종목은 소수점 불필요
        series[tk] = build_series(cd, min(BARS_KEEP, len(cd)), nd)
        return True

    fails = []
    for i,(tk,info) in enumerate(universe.items()):
        if not try_one(tk, info, 0.15): fails.append(tk)
        if (i+1) % 50 == 0:
            print(f"    {i+1}/{len(universe)}  성공 {len(stocks)} 실패 {len(fails)}  "
                  f"({time.time()-t0:.0f}s)", flush=True)

    # ★ 재시도 패스 — 실패의 대부분은 야후 일시적 스로틀입니다.
    #   간격을 4배로 늘려 한 번만 다시 시도합니다 (43종목이 이렇게 살아났습니다).
    if fails:
        print(f"\n🔁 실패 {len(fails)}종목 재시도 (간격 0.6초)")
        still = []
        for tk in fails:
            if not try_one(tk, universe[tk], 0.6): still.append(tk)
        print(f"    복구 {len(fails)-len(still)} · 최종 실패 {len(still)}")
        fails = still
        miss_extra = [t for t in fails if t in extra_added]
        if miss_extra:
            print(f"    ⚠️ 직접 추가한 종목 중 못 받은 것: {', '.join(miss_extra)}")
            print(f"       → 티커가 야후 기준인지 확인해 주세요 "
                  f"(한국은 6자리 숫자, 미국은 영문. 예: 042660 / AAPL)")

    # RS 백분위 — 교차단면 (시장별로 따로)
    print("\n📈 RS 백분위 계산 (교차단면)")
    for mkt in ("us","kr"):
        grp = [(tk,d) for tk,d in stocks.items() if d["m"]==mkt and d.get("d21") is not None]
        if len(grp) < 10: continue
        # ★ 126일(6개월) 수익률 기준.
        #   검증: 21/42/63/126/252일 중 126일이 양쪽 시장 모두 최고였습니다
        #   (미국 +5.16%★ / 한국 +4.92%★ · 63일은 +3.34/+2.92%).
        #   배분탭도 6개월 모멘텀을 쓰므로 앱 전체가 같은 기간으로 통일됩니다.
        # ★ 이력이 짧은 종목을 -999 로 밀어 넣으면 "RS 0.0" 이 되어
        #   진짜 폭락 종목과 구분이 안 됩니다 → 아예 값을 주지 않습니다(None).
        vals=[]
        for tk,d in grp:
            cds = series.get(tk)
            r63 = None
            if cds and len(cds) > RS_LOOKBACK:
                a,b = cds[-1][1], cds[-(RS_LOOKBACK+1)][1]
                r63 = (a/b-1)*100 if b else None
            if r63 is None: stocks[tk]["rs"] = None
            else: vals.append((tk, r63))
        n = len(vals)
        if n > 1:
            vals.sort(key=lambda x: x[1])
            # 동점은 평균 순위 (같은 수익률인데 백분위가 다르면 안 됩니다)
            i = 0
            while i < n:
                j = i
                while j+1 < n and vals[j+1][1] == vals[i][1]: j += 1
                pctl = round(((i+j)/2)/(n-1)*100, 1)
                for k in range(i, j+1): stocks[vals[k][0]]["rs"] = pctl
                i = j+1
        elif n == 1:
            stocks[vals[0][0]]["rs"] = 50.0
        print(f"  {mkt}: {n}종목 (이력부족 {len(grp)-n})")

    # 거래대금 백분위
    for mkt in ("us","kr"):
        # ★ tv==0 을 `if d.get("tv")` 로 걸러내면 그 종목엔 tvr 키가 아예 안 생겨
        #   프론트의 (tvr ?? 0) >= 40 에서 조용히 사라집니다 → None 체크로 변경
        grp = [(tk,d["tv"]) for tk,d in stocks.items() if d["m"]==mkt and d.get("tv") is not None]
        if len(grp) < 10: continue
        grp.sort(key=lambda x: x[1]); n=len(grp)
        i = 0
        while i < n:
            j = i
            while j+1 < n and grp[j+1][1] == grp[i][1]: j += 1
            pctl = round(((i+j)/2)/(n-1)*100, 1)
            for k in range(i, j+1): stocks[grp[k][0]]["tvr"] = pctl
            i = j+1

    # ══════════════════════════════════════════════════════════
    # ★ 안전장치 — 야후가 통째로 막힌 날 좋은 데이터를 빈 데이터로 덮어쓰지 않도록.
    #   기존 파일보다 종목 수가 20% 넘게 줄면 아무것도 쓰지 않고 실패 처리합니다.
    # ══════════════════════════════════════════════════════════
    MIN_OK = 0.8
    if len(stocks) < MIN_OK * len(universe):
        print(f"\n❌ 성공 {len(stocks)}/{len(universe)} — 유니버스의 {MIN_OK:.0%} 미만입니다. "
              f"기존 파일을 지키기 위해 쓰지 않고 종료합니다.")
        sys.exit(1)
    prev_n = 0
    try:
        prev_n = len(json.load(open(f"{OUT_DIR}/snapshot.json", encoding="utf-8"))["stocks"])
    except Exception: pass
    if prev_n and len(stocks) < prev_n * MIN_OK:
        print(f"\n❌ 이번 {len(stocks)}종목 < 기존 {prev_n}종목의 {MIN_OK:.0%}. "
              f"이상 축소로 보고 쓰지 않고 종료합니다.")
        sys.exit(1)

    # 변동성 백분위 — 시장 안에서 줄세우기 (미국 진입 신호로 사용)
    for mkt in ("us","kr"):
        grp = [(tk,d["atrp"]) for tk,d in stocks.items() if d["m"]==mkt and d.get("atrp") is not None]
        if len(grp) < 10: continue
        grp.sort(key=lambda x: x[1]); n=len(grp)
        i = 0
        while i < n:
            j = i
            while j+1 < n and grp[j+1][1] == grp[i][1]: j += 1
            pctl = round(((i+j)/2)/(n-1)*100, 1)
            for k in range(i, j+1): stocks[grp[k][0]]["atrr"] = pctl
            i = j+1

    now = datetime.now(timezone.utc)
    meta = {"version":VERSION, "generatedAt":now.isoformat(),
            "generatedKST":now.astimezone(KST).strftime("%Y-%m-%d %H:%M"),
            "failed": fails[:60],
            "pool": {"base": base_n, "extra": extra_added},
            "counts":{"stocks":len(stocks),"failed":len(fails),
                      "sectors":len(market["sectors"]),"indices":len(market["indices"])}}

    _write(f"{OUT_DIR}/snapshot.json", {"meta":meta,"stocks":stocks})
    _write(f"{OUT_DIR}/market.json",   {"meta":meta, **market})
    # 종목별 차트 파일
    bars_dir = f"{OUT_DIR}/bars"
    os.makedirs(bars_dir, exist_ok=True)
    for old in os.listdir(bars_dir):                  # 유니버스에서 빠진 종목 파일 정리
        if old.endswith(".json") and old[:-5] not in series:
            try: os.remove(os.path.join(bars_dir, old))
            except OSError: pass
    for tk, rows in series.items():
        _write(f"{bars_dir}/{tk}.json",
               {"v":VERSION,"t":tk,"cols":COLS,"rows":rows})
    bsz = sum(os.path.getsize(f"{bars_dir}/{t}.json") for t in series)

    print(f"\n{'='*64}")
    print(f"  ✅ 완료 {time.time()-t0:.0f}초 · 종목 {len(stocks)} · 실패 {len(fails)}")
    for f in ("snapshot","market"):
        pth=f"{OUT_DIR}/{f}.json"
        print(f"     {f+'.json':16s} {os.path.getsize(pth)/1024:>8,.0f} KB")
    print(f"     bars/*.json      {bsz/1024:>8,.0f} KB  ({len(series)}개 · 1종목 평균 {bsz/len(series)/1024:.1f} KB)")
    if fails: print(f"  ⚠️ 실패: {', '.join(fails[:12])}{' …' if len(fails)>12 else ''}")
    print("="*64)

def _write(path, obj):
    with open(path,"w",encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",",":"))

if __name__ == "__main__":
    main()
