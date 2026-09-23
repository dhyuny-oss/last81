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

VERSION   = "7.4.0"
UA        = {"User-Agent": "Mozilla/5.0"}
OUT_DIR   = "public/data"
KST       = timezone(timedelta(hours=9))
BARS_KEEP   = 200        # 차트에 보관할 봉수 (약 10개월)
RS_LOOKBACK = 126        # RS 백분위 기준 기간 (6개월) — 검증으로 정한 값
MIN_BARS  = 130          # 이보다 적으면 지표 일부 생략
# ── 시장 '폭' = 200일선 위 종목 비율 ─────────────────────────
#   백테스트 결론(3개월 보유, 발굴 바스켓):
#     한국  폭 백분위>40  전체 +5.85%p · 2010-18 +2.95%p · 2019-23 +4.72%p (전부 +)
#           지수 200일선  전체 +2.24%p · 2010-18 +2.24%p · 2024-26 -2.68%p (뒤집힘)
#     미국  폭·지수200일선·골든크로스·낙폭·변동성 등 15개 후보가
#           2010년 이후 모든 구간에서 (-) → 미국은 시장 게이트를 걸지 않습니다.
BREADTH_DAYS = 756       # 폭 백분위 기준 기간 (3년)
BREADTH_GATE = 40        # 한국: 폭 백분위가 이 아래면 위험

# ── 섹터 ETF (감마 통합: 12종) ────────────────────────────────
# GICS 업종명(위키피디아) → 섹터 ETF. 종목의 업종이 섹터 순위 몇 위인지 연결하는 표입니다.
GICS_TO_ETF = {
    "Information Technology": "XLK", "Financials": "XLF", "Energy": "XLE", "Health Care": "XLV",
    "Consumer Discretionary": "XLY", "Consumer Staples": "XLP", "Industrials": "XLI", "Utilities": "XLU",
    "Materials": "XLB", "Communication Services": "XLC", "Real Estate": "XLRE",
}
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
# 한국 배분 대상 — 섹터를 고르지 않고 이것 하나를 그냥 들고 갑니다 (검증 결과)
KR_ETF = ("069500.KS", "KODEX 200")

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
# 데이터 검사 규칙 (2026-09 — 코스닥 77종목이 조용히 틀렸던 사고 이후)
# ══════════════════════════════════════════════════════════════
# 상위 유니버스 파일의 이름이 뒤바뀐 종목 — 가격으로 확인해 바로잡습니다
NAME_FIX = {"192820": "코스맥스", "044820": "코스맥스비티아이"}
TV_MIN_KR  = 30e8      # 한국 거래대금 하한 (60일 평균, 원)
TV_MIN_US  = 30e6      # 미국 거래대금 하한 (60일 평균, 달러)
MIN_BARS   = 260     # 200일선·RS 를 계산할 수 있는 최소 봉수. 미달이면 아예 싣지 않습니다.
STALE_DAYS = 7       # 시장 기준일보다 이만큼 밀리면 거래정지·상장폐지로 보고 제외
JUMP_WARN  = 0.35    # 하루 ±35% 초과는 분할·오류 의심 → 경고만 (실제 급등락도 있으므로)
MIN_KEEP   = 0.95    # 시장별로 지난번의 95% 미만만 남으면 '쓰지 않고 종료'

def fetch_kr(tk, pause=0.15):
    """한국 종목의 거래소를 확정합니다.
       ★ 코스닥 종목에 .KS 를 붙이면 야후가 200 OK 로 '이름 없는 유령 시세'를 돌려줍니다.
         가격이 실제와 최대 14% 다르고 봉도 45개뿐인데, 예전 코드는 이것을 그대로 썼습니다.
         meta.exchangeName 으로만 확실히 갈립니다 — KSC=코스피, KOE=코스닥."""
    cd, meta = fetch_candles(tk + ".KS")
    ex = (meta.get("exchangeName") or "").upper()
    if ex == "KSC":                      # 코스피 확정
        return cd, meta, tk + ".KS"
    time.sleep(pause)
    cd2, meta2 = fetch_candles(tk + ".KQ")
    ex2 = (meta2.get("exchangeName") or "").upper()
    if ex2 == "KOE" and meta2.get("longName"):   # 코스닥 확정 (이름 없으면 유령)
        return cd2, meta2, tk + ".KQ"
    return [], meta2 or meta, tk          # 어느 쪽도 확정 못하면 버립니다

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

    # ★ 추세 매매 신호 재료 (2026-09 검증)
    #   매도 기준 = 느린 슈퍼트렌드(12,3) 빨강. "셋 중 하나라도 빨강"으로 팔면 평균 7일 보유에
    #   비용 빼면 남는 게 없었고, 느린 선 기준은 약 30일 보유·손익비 1.4~1.7 이었습니다.
    #   RSI↑·MACD↑ 는 넣어도 빼도 결과가 같아 '참고'로만 저장합니다.
    sl_line, sl_dir = supertrend_series(cd, *ST_SET[2])
    slow = sl_dir[-1] if sl_dir else None
    days = 0
    if slow is not None:
        for v in reversed(sl_dir):
            if v == slow: days += 1
            else: break
    rs_ser = rsi_series(c)
    d["stSlow"]   = None if slow is None else (1 if slow == 1 else 0)
    _ma20 = sma(c, 20)
    d["ma20p"]    = _r((px / _ma20 - 1) * 100) if _ma20 else None      # 급락 탭 '반등 확인' 용
    # ★ 트레일링 손절선 — 느린 슈퍼트렌드의 실제 선 값. 화면에 "여기 깨지면 매도"를 숫자로 보여주기 위해
    d["stLine"]   = _r(sl_line[-1], 0 if d["c"] >= 2000 else 2) if sl_line and sl_line[-1] is not None else None
    d["slowDays"] = days                       # 느린 선이 지금 색으로 바뀐 뒤 경과 봉수
    d["rsiUp"]    = bool(len(rs_ser) > 4 and rs_ser[-1] is not None and rs_ser[-4] is not None
                         and rs_ser[-1] > rs_ser[-4])
    d["macdUp"]   = bool(hist is not None and prevh is not None and hist > prevh)

    # ★ 눌림 신호 재료 — 2026-09 검증에서 가장 강했던 진입(한국 연 +21.8%, 같은 종목 보유 대비 +8.2%p)
    #   조건: 50일선>200일선 · 종가>200일선 · 느린ST 초록 · RSI(14)가 45 아래에서 위로 올라온 날
    ma50v, ma200v = sma(c, 50), sma(c, 200)
    r_now = rs_ser[-1] if rs_ser else None
    r_prev = rs_ser[-2] if len(rs_ser) > 1 else None
    d["rsi45"] = bool(r_now is not None and r_prev is not None and r_prev < 45 <= r_now)
    d["upTrend"] = bool(ma50v and ma200v and ma50v > ma200v and c[-1] > ma200v)
    return d

def _r(x, nd=2):
    return None if x is None else round(x, nd)

def _f(x):
    return "  —  " if x is None else f"{x:+.2f}%"

# ══════════════════════════════════════════════════════════════
# 시장 · 섹터
# ══════════════════════════════════════════════════════════════
def decide_judge(idx, breadth):
    """시장 판단.
       한국 : 폭(200일선 위 종목 비율)의 3년 백분위가 기준 아래면 위험.
              검증에서 지수 200일선보다 확실히 나았고 구간마다 뒤집히지 않았습니다.
       미국 : 게이트를 걸지 않습니다(gate=False).
              지수 200일선·골든크로스·낙폭·폭·변동성 등 15개 후보 전부
              2010년 이후 모든 구간에서 (-) 였습니다. 미국은 시장이 나빠지면
              발굴 후보 수가 알아서 35개→14개로 줄어드는 것이 실제 방어였습니다.
       판정 색은 양쪽 다 보여주되, 발굴탭의 '관망' 전환은 gate=True 인 시장에서만."""
    judge = {}
    for mkt, tk in (("us", "^GSPC"), ("kr", "^KS11")):
        i = idx.get(tk)
        if not i: continue
        b = breadth.get(mkt) or {}
        bv, bp = b.get("v"), b.get("pct")
        gate = (mkt == "kr")
        crash = ((i.get("d1") is not None and i["d1"] <= -5) or
                 (i.get("d21") is not None and i["d21"] <= -15))
        if mkt == "kr" and bp is not None:
            if bp < BREADTH_GATE:
                v, why = "risk", f"오르는 종목이 말랐습니다 (폭 {bv:.0f}% · 3년 하위 {bp:.0f}%)"
            elif crash:
                v, why = "warn", f"폭은 괜찮지만 지수가 급락했습니다 (폭 3년 상위 {100-bp:.0f}%)"
            else:
                v, why = "safe", f"오르는 종목이 넉넉합니다 (폭 {bv:.0f}% · 3년 상위 {100-bp:.0f}%)"
        else:
            # 폭 계산 전이거나 미국 — 200일선은 '참고'로만 표시
            m = i.get("ma200p")
            if m is None: v, why = "safe", "판단 보류"
            elif m < 0:   v, why = "risk" if gate else "warn", "지수가 200일선 아래"
            elif crash:   v, why = "warn", "지수 200일선 위지만 최근 급락"
            else:         v, why = "safe", "지수 200일선 위 · 급락 없음"
        judge[mkt] = {"verdict": v, "why": why, "index": tk, "gate": gate,
                      "breadth": bv, "breadthPct": bp,
                      "note": ("폭 백분위 기준 — 검증 통과" if gate else
                               "미국은 검증을 통과한 시장 타이밍 지표가 없어 참고용입니다")}
    return judge


def build_breadth(hist):
    """{market: {날짜: [200일선위 종목수, 전체]}} → 비율 시계열 + 오늘의 3년 백분위
       ★ 그날 값이 있는 종목이 너무 적은 날짜는 버립니다.
         상장 초기 구간(분모 1~2종목)과, 수집이 절반만 된 날의 가짜 급변을 막습니다."""
    out = {}
    for mkt, d in hist.items():
        if not d: continue
        maxden = max(e[1] for e in d.values())
        need = max(30, int(maxden * 0.6))
        ts = sorted(t for t, e in d.items() if e[1] >= need)
        if len(ts) < 120: continue
        ts = ts[-BREADTH_DAYS:]
        ser = [(t, d[t][0] / d[t][1] * 100) for t in ts]
        vals = [v for _, v in ser]
        today = vals[-1]
        # ★ 백분위는 정수로 확정해 둡니다.
        #   6.5 를 그대로 넘기면 파이썬 f"{x:.0f}" 는 6, 자바스크립트 Math.round 는 7 을 찍어
        #   같은 화면 안에서 "하위 6%"와 "하위 7%"가 동시에 보입니다.
        pct = int(sum(1 for v in vals if v < today) / len(vals) * 100 + 0.5)
        # 화면용으로 주 1회만 남깁니다 (756 → 약 150포인트)
        thin = ser[::5]
        if thin[-1][0] != ser[-1][0]: thin.append(ser[-1])
        out[mkt] = {"v": round(today, 1), "pct": pct, "n": len(vals),
                    "cov": d[ts[-1]][1], "univ": maxden,
                    "hist": [[t, round(v, 1)] for t, v in thin]}
    return out


SEC_CD = {}   # build_market 이 받은 섹터·KODEX200 캔들 (DC 계산에 재사용)
DC_CD  = {}   # DC 후보 ETF 원본 캔들 (듀얼 모멘텀 12개월 점수용)

def build_market():
    idx = {}
    idxbars = {}          # ★ 차트에 겹쳐 그릴 지수 종가 (시장별 1벌)
    for tk,(label,mkt) in INDICES.items():
        cd,_ = fetch_candles(tk); time.sleep(0.25)
        if len(cd) < 210:
            print(f"  ⚠️ {tk} 캔들 부족 {len(cd)}"); continue
        c=[x["c"] for x in cd]; ma200=sma(c,200)
        idx[tk] = {"label":label,"market":mkt,"c":_r(c[-1],2),
                   "d1":_r(chg(cd,1)),"d3":_r(chg(cd,3)),"d5":_r(chg(cd,5)),"d21":_r(chg(cd,21)),
                   "ma200p": _r((c[-1]/ma200-1)*100) if ma200 else None,
                   "asOf": datetime.fromtimestamp(cd[-1]["t"],timezone.utc).strftime("%Y-%m-%d")}
        # 벤치마크 지수만 봉을 남깁니다 (차트 오버레이용, 종목 파일과 같은 200봉)
        if BENCH.get(mkt) == tk:
            keep = cd[-BARS_KEEP:]
            idxbars[mkt] = {"label": label, "tk": tk,
                            "rows": [[x["t"], round(x["c"], 2)] for x in keep]}
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

    # 시장 판단 — 폭이 아직 없는 시점의 임시값. 종목 루프 뒤 decide_judge() 가 다시 씁니다.
    judge = decide_judge(idx, {})

    # 섹터 — ★ 캔들로 직접 계산 (chartPreviousClose 폴백 버그 회피)
    #
    # ★ 점수 방식을 바꿨습니다 (2026-08 검증).
    #   전에는 6개월 수익률 하나로 줄을 세웠습니다. 그런데 워크포워드에서
    #   학습 성적과 검증 성적의 상관이 -0.08 이었습니다 — 과거 성적으로
    #   '최적 룩백'을 고를 수 없다는 뜻입니다. 그래서 고르지 않기로 했습니다.
    #   3·6·9·12개월 수익률의 평균을 점수로 씁니다.
    #     6M 하나  : 지수 대비 +0.57%p (구간 95% [-3.50,+5.11] — 0을 포함)
    #     합의 4종 : 지수 대비 +3.99%p (구간 95% [+0.02,+7.34] — 유일하게 0 위)
    #                샤프 0.50→0.73 · 최대낙폭 -52.2%→-36.8%
    secs=[]
    for tk,label in SECTOR_ETFS.items():
        cd,_m = fetch_candles(tk); time.sleep(0.25)
        SEC_CD[tk] = (cd, _m)
        if len(cd) < 260:                      # 12개월 룩백을 쓰려면 252봉 필요
            print(f"  ⚠️ {tk} 캔들 부족 {len(cd)}"); continue
        c=[x["c"] for x in cd]; ma200=sma(c,200)
        m = {k: chg(cd, n) for k, n in (("m3",63),("m6",126),("m9",189),("m12",252))}
        vals = [v for v in m.values() if v is not None]
        score = sum(vals)/len(vals) if len(vals) == 4 else None   # 4개 다 있어야 점수
        secs.append({"tk":tk,"label":label,"c":_r(c[-1],2),
                     "d1":_r(chg(cd,1)),"d3":_r(chg(cd,3)),"d5":_r(chg(cd,5)),"d21":_r(chg(cd,21)),
                     "m3":_r(m["m3"]),"m6":_r(m["m6"]),"m9":_r(m["m9"]),"m12":_r(m["m12"]),
                     "score":_r(score),
                     "ma200p":_r((c[-1]/ma200-1)*100) if ma200 else None})
        print(f"  {label:8s} 점수 {_f(score)}  (3M {_f(m['m3'])} 6M {_f(m['m6'])} "
              f"9M {_f(m['m9'])} 12M {_f(m['m12'])})")
    secs.sort(key=lambda s: -(s["score"] if s["score"] is not None else -9999))
    for i,s in enumerate(secs): s["rank"] = i+1
    holds = [s["tk"] for s in secs[:3] if (s["score"] or 0) > 0]
    defense = len(holds) < 3

    # ── 한국 배분 — 로테이션이 아니라 '그냥 이것 하나' ──────────
    #   검증: 한국 섹터 ETF 31개를 전부 담아도 연 +5.51% 로 KODEX 200(+10.22%)보다 낮았고,
    #   워크포워드 검증에서 32개 설정 중 9개만 (+), 최대낙폭은 -62% 로 지수(-36%)의 1.7배였습니다.
    #   그래서 고르는 기능을 만들지 않고, 살 대상 하나를 화면에 그대로 띄웁니다.
    kretf = None
    cd,_ = fetch_candles(KR_ETF[0]); time.sleep(0.25)
    if len(cd) >= 260:
        c=[x["c"] for x in cd]; ma200=sma(c,200)
        mm = {k: chg(cd, n) for k, n in (("m3",63),("m6",126),("m9",189),("m12",252))}
        kretf = {"tk": KR_ETF[0], "code": KR_ETF[0].split(".")[0], "label": KR_ETF[1],
                 "c": _r(c[-1], 2), "d1": _r(chg(cd,1)), "d5": _r(chg(cd,5)), "d21": _r(chg(cd,21)),
                 "m3": _r(mm["m3"]), "m6": _r(mm["m6"]), "m9": _r(mm["m9"]), "m12": _r(mm["m12"]),
                 "ma200p": _r((c[-1]/ma200-1)*100) if ma200 else None}
        print(f"  {KR_ETF[1]:8s} {c[-1]:>10,.0f}원  6개월 {_f(mm['m6'])}  200일선 {_f(kretf['ma200p'])}")
    else:
        print(f"  ⚠️ {KR_ETF[0]} 캔들 부족 — 한국 배분 카드는 생략됩니다")

    # ★ 원/달러 — 배분탭이 "얼마 넣어서 몇 주"를 원화로 말하려면 필요합니다
    fx = None
    fx_cd,_ = fetch_candles("USDKRW=X"); time.sleep(0.2)
    if fx_cd: fx = _r(fx_cd[-1]["c"], 2)
    print(f"  USD/KRW  {fx}")

    SEC_CD["069500"] = (cd, {}) if len(cd) >= 260 else SEC_CD.get("069500")
    alloc = build_alloc_state(holds, defense, secs, kretf)
    return {"indices":idx, "risk":risk, "judge":judge, "fx":{"usdkrw":fx}, "idxbars":idxbars,
            "sectors":secs, "allocation":alloc}


# ── 분기 리밸런스 ─────────────────────────────────────────────
# 검증: 월 1회는 비용 0.3%만 되어도 초과수익이 사라졌습니다(연 교체 5.3회).
#       분기 1회는 연 교체 2.0회라 비용 0.5%에서도 남았습니다(+3.2%p).
#       해외주식 양도세 22%까지 생각하면 차이가 더 벌어집니다.
# 그래서 "지금 상위 3개"와 "실제로 들고 있어야 할 3개"를 따로 저장합니다.
# 사이에 순위가 바뀌어도 다음 분기까지는 손대지 않는 것이 규칙입니다.
ALLOC_STATE = f"{OUT_DIR}/alloc_state.json"
REBAL_MONTHS = (1, 4, 7, 10)

def _q(d):  return f"{d.year}Q{(d.month-1)//3 + 1}"

def _next_rebal(d):
    for m in REBAL_MONTHS:
        if m > d.month: return datetime(d.year, m, 1, tzinfo=timezone.utc)
    return datetime(d.year + 1, REBAL_MONTHS[0], 1, tzinfo=timezone.utc)

def build_alloc_state(holds, defense, secs, kretf=None):
    now = datetime.now(timezone.utc)
    q, due = _q(now), now.month in REBAL_MONTHS
    try:
        st = json.load(open(ALLOC_STATE, encoding="utf-8"))
    except Exception:
        st = None
    if st is None:
        # 첫 실행 — 지금 순위를 그대로 고정하고, 마지막 리밸런스 분기로 기록합니다
        st = {"quarter": q, "holds": holds, "at": now.strftime("%Y-%m-%d"), "init": True}
    elif due and st.get("quarter") != q:
        st = {"quarter": q, "holds": holds, "at": now.strftime("%Y-%m-%d"),
              "prev": st.get("holds", [])}
    _write(ALLOC_STATE, st)

    locked = st.get("holds", holds)
    lab = {s["tk"]: s["label"] for s in secs}
    rank = {s["tk"]: s["rank"] for s in secs}
    nr = _next_rebal(now)
    return {
        "holds": locked,                       # 지금 들고 있어야 할 3개 (분기 고정)
        "now": holds,                          # 오늘 기준 상위 3개 (참고)
        "defense": defense, "nPositive": len(holds),
        "quarter": st.get("quarter"), "lockedAt": st.get("at"),
        "rebalDue": bool(due and st.get("quarter") == q and not st.get("init")),
        "nextRebal": nr.strftime("%Y-%m-%d"),
        "daysToRebal": (nr - now).days,
        "drift": [{"tk": t, "label": lab.get(t, t), "rank": rank.get(t)}
                  for t in holds if t not in locked],       # 새로 올라온 것
        "dropped": [{"tk": t, "label": lab.get(t, t), "rank": rank.get(t)}
                    for t in locked if t not in holds],     # 밀려난 것
        "method": "3·6·9·12개월 수익률 평균 · 플러스인 것 중 상위 3개 · 동일가중 · 분기 리밸런스",
        "kr": {"bench": KR_ETF[0].split(".")[0], "name": KR_ETF[1], "etf": kretf,
               "rebal": False,
               "note": "한국은 섹터 로테이션을 하지 않습니다. 섹터 ETF 31개를 전부 담아도 연 +5.51%로 "
                       "KODEX 200(+10.22%)보다 낮았고, 검증 구간에서 32개 설정 중 9개만 (+)였으며 "
                       "최대낙폭은 -62%로 지수(-36%)의 1.7배였습니다."}
    }

# ══════════════════════════════════════════════════════════════
# DC(퇴직연금) — 국내 상장 ETF 로 사고, 판단은 미국 원본 ETF 신호로
# ══════════════════════════════════════════════════════════════
# 퇴직연금 계좌는 국내 상장 ETF 만 살 수 있고(위험자산 70% 한도, 레버리지·인버스 불가),
# 합성(스왑) ETF 는 증권사에 따라 막힐 수 있습니다 → synth=True 로 표시합니다.
# 코드는 야후에서 상품명을 직접 조회해 확인했습니다(2026-09-17).
# 판단은 미국 원본으로 합니다 — 국내 상품은 2020~2023년 상장이라 이력이 짧고,
#   원화 환산 신호(샤프 0.64)보다 원본 신호(0.69)가 검증에서 조금 나았습니다.
DC_US = [   # (미국 원본, 국내 코드, 국내 상품, 라벨, 합성)
    ("SPY",  "360750", "TIGER 미국S&P500",            "S&P500",     False),
    ("QQQ",  "133690", "TIGER 미국나스닥100",          "나스닥100",   False),
    ("XLK",  "463680", "KODEX 미국S&P500 테크놀로지",   "기술",       False),
    ("SMH",  "381180", "TIGER 미국필라델피아반도체나스닥", "반도체",     False),
    ("XLF",  "453650", "KODEX 미국S&P500 금융",         "금융",       False),
    ("XLV",  "453640", "KODEX 미국S&P500 헬스케어",      "헬스케어",    False),
    ("XLY",  "453660", "KODEX 미국S&P500 경기소비재",    "소비재",      False),
    ("XLP",  "453630", "KODEX 미국S&P500 필수소비재",    "필수소비",    False),
    ("XLU",  "463640", "KODEX 미국S&P500 유틸리티",      "유틸리티",    False),
    ("XLC",  "463690", "KODEX 미국S&P500 커뮤니케이션",   "커뮤니케이션", False),
    ("XLE",  "218420", "KODEX 미국S&P500에너지(합성)",   "에너지",      True),
    ("XLI",  "200030", "KODEX 미국S&P500산업재(합성)",   "산업재",      True),
    ("XLB",  None,     None,                          "소재",       False),
    ("XLRE", None,     None,                          "부동산",      False),
]
DC_KR = ("069500", "KODEX 200")
KR_SECT = [
    ("091160", "KODEX 반도체"), ("139260", "TIGER 200 IT"), ("305720", "KODEX 2차전지산업"),
    ("091170", "KODEX 은행"), ("102970", "KODEX 증권"), ("140700", "KODEX 보험"),
    ("091180", "KODEX 자동차"), ("139230", "TIGER 200 중공업"), ("117700", "KODEX 건설"),
    ("117460", "KODEX 에너지화학"), ("117680", "KODEX 철강"), ("143860", "TIGER 헬스케어"),
    ("244580", "KODEX 바이오"), ("157490", "TIGER 소프트웨어"), ("140710", "KODEX 운송"),
    ("266410", "KODEX 필수소비재"), ("266390", "KODEX 경기소비재"),
]
DC_WEIGHTS = {"us": 0.35, "kr": 0.35, "safe": 0.30}

def fin_flags(stocks):
    """미국 재무 참고 배지 — stocks.json 의 financials(연간 2개년)에서. 검증 불가라 조건이 아니라 '참고'입니다."""
    try:
        fin = json.load(open(f"{OUT_DIR}/stocks.json", encoding="utf-8")).get("financials") or {}
    except Exception:
        fin = {}
    n = 0
    for tk, d in stocks.items():
        f = fin.get(tk)
        if not isinstance(f, dict): continue
        inc = f.get("income") or {}
        la, pr = inc.get("latest") or {}, inc.get("prior") or {}
        rev, rev0 = la.get("revenue"), pr.get("revenue")
        ni, op = la.get("netIncome"), la.get("operatingIncome")
        d["fin"] = {
            "rev": _r((rev / rev0 - 1) * 100, 1) if rev and rev0 else None,     # 매출 전년比 %
            "opm": _r(op / rev * 100, 1) if op is not None and rev else None,   # 영업이익률 %
            "prof": (ni is not None and ni > 0),                                 # 흑자 여부
            "fy": la.get("endDate"),
        }
        n += 1
    print(f"  📑 재무 배지: {n}종목 (미국, 참고용)")

def _mom(cd):
    m = {k: chg(cd, n) for k, n in (("m3",63),("m6",126),("m9",189),("m12",252))}
    vals = [v for v in m.values() if v is not None]
    return m, (sum(vals)/len(vals) if len(vals) == 4 else None)

def _vehicle(code, name, synth):
    """국내 상품 — 가격만 (매수 수량 계산용)"""
    if not code: return None
    cd, meta = fetch_candles(code + ".KS", tries=2, min_bars=20); time.sleep(0.2)
    if len(cd) < 2: return {"code": code, "name": name, "synth": synth, "c": None}
    return {"code": code, "name": name, "synth": synth, "c": _r(cd[-1]["c"], 0),
            "d1": _r(chg(cd, 1)), "d21": _r(chg(cd, 21)),
            "asOf": datetime.fromtimestamp(cd[-1]["t"], timezone.utc).strftime("%Y-%m-%d")}

def _state(d):
    """DC 규칙 상태 — 느린 ST 초록이면 보유, 빨강이면 그 몫은 안전자산"""
    if d is None or d.get("stSlow") is None: return "unknown"
    return "hold" if d["stSlow"] == 1 else "wait"

def market_fx():
    try:
        return json.load(open(f"{OUT_DIR}/market.json", encoding="utf-8")).get("fx", {}).get("usdkrw")
    except Exception:
        return None

def build_dc(secs, series):
    """반환: (etfs, dc) — etfs 는 차트·추적에서 종목처럼 쓰는 지표 묶음"""
    etfs, rank = {}, {s["tk"]: s for s in secs}
    us_rows = []
    for us, code, name, label, synth in DC_US:
        if us in SEC_CD and SEC_CD[us]:
            cd, meta = SEC_CD[us]
        else:
            cd, meta = fetch_candles(us); time.sleep(0.25)
        if len(cd) < 260:
            print(f"  ⚠️ DC {us} 캔들 부족 {len(cd)}"); continue
        DC_CD[us] = cd
        d = build_stock(us, cd, meta, f"{label} ({us})", "us", label)
        m, sc = _mom(cd)
        d.update({k: _r(v) for k, v in m.items()}); d["score"] = _r(sc)
        d["etf"] = True
        d["veh"] = _vehicle(code, name, synth)
        etfs[us] = d
        series[us] = build_series(cd, min(BARS_KEEP, len(cd)), 2)
        us_rows.append(us)
        v = d["veh"]
        print(f"  {label:8s} {us:5s} → {code or '국내 없음':7s} 점수 {_f(sc)}  "
              f"느린ST {'초록' if d['stSlow']==1 else '빨강'}  ST {d['st']}/3"
              + (f"  국내가 {v['c']:,}" if v and v.get('c') else ""))
    # 한국 코어 + 업종
    kr_rows = []
    for code, name in [DC_KR] + KR_SECT:
        if code in SEC_CD and SEC_CD[code]:
            cd, meta = SEC_CD[code]
        else:
            cd, meta = fetch_candles(code + ".KS"); time.sleep(0.2)
        if len(cd) < 260:
            print(f"  ⚠️ DC {code} 캔들 부족 {len(cd)}"); continue
        DC_CD[code] = cd
        d = build_stock(code, cd, meta, name, "kr", "업종")
        m, sc = _mom(cd)
        d.update({k: _r(v) for k, v in m.items()}); d["score"] = _r(sc)
        d["etf"] = True
        etfs[code] = d
        series[code] = build_series(cd, min(BARS_KEEP, len(cd)), 0 if d["c"] >= 2000 else 2)
        if code != DC_KR[0]: kr_rows.append(code)
    us_core = ["SPY", "QQQ"]
    us_sect = sorted([t for t in us_rows if t not in us_core],
                     key=lambda t: -(etfs[t]["score"] if etfs[t]["score"] is not None else -9999))
    kr_sect = sorted(kr_rows, key=lambda t: -(etfs[t]["score"] if etfs[t]["score"] is not None else -9999))
    spy, k200 = etfs.get("SPY"), etfs.get(DC_KR[0])
    # ★ 듀얼 모멘텀 균형형 (검증: DC 70/30 기준 연 +12.5%·MDD −20%·샤프 0.92 vs 현행 +7.2%·−10%·1.04)
    #   후보 3개(나스닥100·S&P500·코스피200)의 3·6·12개월 평균 수익률 상위 2개를 반반. 매월 1거래일 교체.
    #   ※ 느린ST 필터와 섞으면 성과가 크게 떨어져(19.7→9.5%) 섞지 않습니다 — 현행 규칙과 '택일'.
    fx = market_fx()
    def krw_score(d):      # 3·6·12개월 평균 수익률 (원본 캔들 기준)
        cd = DC_CD.get(d["t"]) if d else None
        if not cd or len(cd) < 253: return None
        c = [x["c"] for x in cd]
        vals = [c[-1] / c[-1-n] - 1 for n in (63, 126, 252)]
        return _r(sum(vals) / 3 * 100, 2)
    cands = []
    for key, d, veh in (("QQQ", etfs.get("QQQ"), (etfs.get("QQQ") or {}).get("veh")),
                        ("SPY", spy, (spy or {}).get("veh")),
                        (DC_KR[0], k200, {"code": DC_KR[0], "name": DC_KR[1]})):
        sc = krw_score(d)
        if sc is None: continue
        # 미국 ETF 는 달러 수익 + 환율 변화 근사 (fx 시계열이 없으면 달러 수익 그대로)
        cands.append({"sig": key, "label": {"QQQ": "나스닥100", "SPY": "S&P500"}.get(key, "코스피200"),
                      "score": sc, "buy": veh, "slow": (d or {}).get("stSlow")})
    cands.sort(key=lambda x: -x["score"])
    top2 = [c["sig"] for c in cands[:2] if c["score"] > 0]
    smh = etfs.get("SMH")
    dual = {"cands": cands, "hold": top2, "asOf": (spy or {}).get("asOf"),
            "rule": "매월 1거래일: 나스닥100·S&P500·코스피200 중 3·6·12개월 평균 상위 2개를 반반. 점수가 마이너스면 그 몫은 안전자산.",
            "evidence": {"cagr": 12.5, "mdd": -20, "sharpe": 0.92, "period": "2010–26 원화·DC 70/30"}}
    semi = {"sig": "SMH", "buy": (smh or {}).get("veh"), "state": _state(smh), "share": 0.10,
            "rule": "위험자산 70% 중 10%를 반도체 ETF 고정 칸으로. 느린ST 초록일 때만 보유, 빨강이면 안전자산. 재량 베팅 대신 칸으로 묶습니다."} if smh else None
    dc = {
        "dual": dual, "semi": semi,
        "weights": DC_WEIGHTS,
        "core": [
            {"key": "us", "sig": "SPY", "buy": (spy or {}).get("veh"), "state": _state(spy),
             "label": "미국 S&P500", "w": DC_WEIGHTS["us"]},
            {"key": "kr", "sig": DC_KR[0], "buy": {"code": DC_KR[0], "name": DC_KR[1], "synth": False,
                                                 "c": (k200 or {}).get("c")},
             "state": _state(k200), "label": "한국 코스피200", "w": DC_WEIGHTS["kr"]},
        ],
        "usCore": us_core, "usSect": us_sect, "krSect": kr_sect,
        "rule": "미국 S&P500 35% + 코스피200 35% + 안전자산 30%. 각 몫은 느린 슈퍼트렌드(12,3)가 초록일 때만 보유, 빨강이면 안전자산.",
        "evidence": {"cagr": 7.0, "mdd": -10.3, "sharpe": 1.03, "bh_cagr": 8.5, "bh_mdd": -22.5, "bh_sharpe": 0.80,
                     "period": "2007–2026 원화 · 비용 0.1% · 안전자산 연 3% 가정"},
    }
    return etfs, dc

# ══════════════════════════════════════════════════════════════
# 실전 검증 장부 — 신호가 난 날과 가격을 적어 두고, 그 뒤 실제로 어떻게 됐는지 매일 다시 셉니다.
#   백테스트(생존편향 있음)와 별개로 '앱이 실제로 낸 신호'의 성적입니다. 이게 진짜 검증입니다.
# ══════════════════════════════════════════════════════════════
LOG_FILE = f"{OUT_DIR}/signals_log.json"
LOG_KEEP_DAYS = 400

def update_signal_log(stocks, series, idx_series):
    try:
        log = json.load(open(LOG_FILE, encoding="utf-8"))
    except Exception:
        log = []
    today = max((d.get("asOf") or "") for d in stocks.values()) if stocks else ""
    have = {x["t"] for x in log if (today[:10] and x["d"] >= _shift_days(today, -20))}   # 종목당 20거래일 안 한 번
    added = 0
    for t, d in stocks.items():
        if d.get("action") != "buy" or not d.get("asOf") or not d.get("c") or t in have: continue
        f = d.get("fin") or {}
        k = {"pull": "pull", "strong": "strong", "trend": "buy"}.get(d.get("why"), "buy")   # 앱·알림과 같은 근거 하나
        log.append({"d": d["asOf"], "t": t, "n": d.get("n"), "m": d["m"], "k": k, "p": d["c"],
                    "fin": {"rev": f.get("rev"), "prof": f.get("prof")} if f else None,   # 6개월 뒤 재무 유무별 성적 비교용
                    "sec": d.get("sec"), "both": bool(d.get("strong") and d.get("trend3"))})
        added += 1
    # 옛 기록의 같은 날·같은 종목 중복은 하나로 합칩니다 (강세·추세 둘 다 기록되던 버전)
    seen_dt, dedup = set(), []
    for x in sorted(log, key=lambda x: (x["d"], x["t"], {"pull": 0, "strong": 0, "buy": 1}.get(x["k"], 2))):
        if (x["d"], x["t"]) in seen_dt: continue
        seen_dt.add((x["d"], x["t"])); dedup.append(x)
    log = dedup
    cutoff = _shift_days(today, -LOG_KEEP_DAYS) if today else ""
    log = [x for x in log if x["d"] >= cutoff]
    # 이후 성과 계산 — 신호일 종가 → 5·10·20거래일 뒤, 그리고 지금까지
    def close_at(rows, date, offset):
        ds = [r[0] for r in rows]
        if date not in ds: return None
        i = ds.index(date) + offset
        return rows[i][1] if 0 <= i < len(rows) else None
    idx_rows = {m: [(r[0], r[1]) for r in v] for m, v in idx_series.items()}
    for x in log:
        ser = series.get(x["t"])           # build_series 는 행 목록을 바로 돌려줍니다
        x["r"] = {}
        rows = ser.get("rows") if isinstance(ser, dict) else ser
        if not rows: continue
        rr = [(datetime.fromtimestamp(r[0], timezone.utc).strftime("%Y-%m-%d"), r[1]) for r in rows]
        ir = idx_rows.get(x["m"], [])
        for h in (5, 10, 20):
            c1 = close_at(rr, x["d"], h); i0 = close_at(ir, x["d"], 0); i1 = close_at(ir, x["d"], h)
            if c1: x["r"][str(h)] = _r((c1 / x["p"] - 1) * 100, 2)
            if c1 and i0 and i1: x["r"][f"x{h}"] = _r((c1 / x["p"] - i1 / i0) * 100, 2)
        c_now = rr[-1][1] if rr else None
        if c_now: x["r"]["now"] = _r((c_now / x["p"] - 1) * 100, 2)
    _write(LOG_FILE, log)
    # 요약 — 20거래일이 지난 신호만 성적으로 칩니다
    summ = {}
    for k in ("pull", "buy", "strong"):
        for m in ("kr", "us", "all"):
            L = [x for x in log if x["k"] == k and (m == "all" or x["m"] == m) and x.get("r", {}).get("20") is not None]
            if len(L) < 3: continue
            r20 = [x["r"]["20"] for x in L]; ex = [x["r"]["x20"] for x in L if x["r"].get("x20") is not None]
            summ[f"{k}:{m}"] = {"n": len(L), "avg": _r(sum(r20) / len(r20), 2), "win": _r(sum(1 for v in r20 if v > 0) / len(r20) * 100, 0),
                                "excess": _r(sum(ex) / len(ex), 2) if ex else None, "med": _r(sorted(r20)[len(r20) // 2], 2)}
    pending = sum(1 for x in log if x.get("r", {}).get("20") is None)
    done = sum(1 for x in log if x.get("r", {}).get("20") is not None)
    # ★ 드리프트 경보 — 최근 30건 승률 20% 미만, 또는 20일 지수대비가 최근 8주 연속 마이너스면 "규칙 재검토"
    recent = [x for x in log if x.get("r", {}).get("20") is not None][-30:]
    drift = None
    if len(recent) >= 30:
        win = sum(1 for x in recent if x["r"]["20"] > 0) / len(recent) * 100
        ex = [x["r"].get("x20") for x in recent if x["r"].get("x20") is not None]
        exm = sum(ex) / len(ex) if ex else None
        reasons = []
        if win < 20: reasons.append(f"최근 30건 승률 {win:.0f}% (기준 20%)")
        if exm is not None and exm < -3: reasons.append(f"최근 30건 지수대비 {exm:+.1f}%p")
        drift = {"flag": bool(reasons), "win": _r(win, 0), "excess": _r(exm, 2) if exm is not None else None, "reasons": reasons}
        if reasons: print("  🚨 드리프트 경보:", " · ".join(reasons))
    print(f"  📒 실전 장부: 기록 {len(log)}건 (+{added}) · 20일 성적 확정 {done} · 대기 {pending}")
    return {"summary": summ, "n": len(log), "pending": pending, "since": min((x["d"] for x in log), default=None),
            "drift": drift, "kinds": ["pull", "buy", "strong"]}

REV_MIN = 10        # 앱 '매출 필터' 기본값과 같게

def build_today(stocks, market):
    idx = market.get("indices") or {}
    secrank = {x["tk"]: (x["rank"], x["label"]) for x in (market.get("sectors") or [])}
    try:
        wl = json.load(open(f"{OUT_DIR}/watchlist.json", encoding="utf-8"))
    except Exception:
        wl = {}
    held = {str(p.get("t", "")).upper() for p in (wl.get("positions") or [])}
    try:
        log = json.load(open(LOG_FILE, encoding="utf-8"))
    except Exception:
        log = []
    dates = sorted({x["d"] for x in log}); pos_of = {d: i for i, d in enumerate(dates)}
    first = {}
    for x in log:
        if x["t"] not in first or x["d"] < first[x["t"]]: first[x["t"]] = x["d"]
    def age(t):
        d0 = first.get(t); return (pos_of[dates[-1]] - pos_of[d0] + 1) if (d0 in pos_of and dates) else None
    def rel(d):
        i = idx.get("^KS11" if d["m"] == "kr" else ("^IXIC" if d.get("ex") == "NMS" else "^GSPC")) or {}
        return _r(d["d21"] - i["d21"], 1) if d.get("d21") is not None and i.get("d21") is not None else None
    def row(d):
        gap = _r((d["c"] / d["stLine"] - 1) * 100, 1) if d.get("stLine") else None
        f = d.get("fin") or {}
        return {"t": d["t"], "n": d.get("n"), "m": d["m"], "why": d.get("why"), "rs": d.get("rs"), "c": d["c"], "stLine": d.get("stLine"),
                "gap": gap, "rel": rel(d), "sec": d.get("sec"), "secRank": secrank.get(d.get("sec"), (None, None))[0],
                "secLabel": secrank.get(d.get("sec"), (None, None))[1], "rev": f.get("rev"), "prof": f.get("prof"),
                "mcap": d.get("mcap"), "tv": d.get("tv"), "age": age(d["t"]), "rsi": d.get("rsi"), "held": d["t"] in held}
    buys = [row(d) for d in stocks.values() if d.get("action") == "buy" and (d.get("tvr") or 0) >= 40]
    def reasons(r):
        out = []
        if r["prof"] is False: out.append("적자")
        if r["m"] == "us" and r["rev"] is not None and r["rev"] < REV_MIN: out.append(f"매출 {r['rev']:+.0f}%")
        if r["gap"] is not None and r["gap"] > 20: out.append(f"선까지 {r['gap']:.0f}%")
        if r["held"]: out.append("보유 중")
        return out
    rank = lambda r: ((1 if r["why"] == "trend" else 0) * 1000 + (r["secRank"] or 99) * 10 - (r["rs"] or 0) / 100)
    cands = sorted(buys, key=rank)
    excluded, pick_us, pick_kr, used = [], [], [], set()
    for r in cands:
        why = reasons(r)
        if why: excluded.append({"t": r["t"], "n": r["n"], "m": r["m"], "why": why}); continue
        if r["m"] == "us":
            key = r["sec"] or f"?{r['t']}"
            if key in used: excluded.append({"t": r["t"], "n": r["n"], "m": "us", "why": ["같은 업종 이미 선택"]}); continue
            if len(pick_us) < 5: pick_us.append(r); used.add(key)
        elif len(pick_kr) < 3:
            pick_kr.append(r)
    heldrows = []
    for p in (wl.get("positions") or []):
        d = stocks.get(str(p.get("t", "")).upper())
        if not d: heldrows.append({"t": p.get("t"), "state": "데이터 없음"}); continue
        tr = p.get("tr") if isinstance(p.get("tr"), list) and p.get("tr") else ([{"px": p.get("avg"), "amt": 0}] if p.get("avg") else [])
        t2 = None
        if p.get("role") == "swing" and len(tr) == 1 and tr and tr[0].get("px"):
            lo, hi = tr[0]["px"] * 1.03, tr[0]["px"] * 1.06
            t2 = "도달" if (lo <= d["c"] <= hi and d.get("stSlow") == 1) else ("추격 금지" if d["c"] > hi else f"목표 {lo:.2f}")
        heldrows.append({"t": d["t"], "n": d.get("n"), "m": d["m"], "c": d["c"], "action": "sell" if d.get("action") == "sell" else "hold",
                         "stLine": d.get("stLine"), "gap": _r((d["c"] / d["stLine"] - 1) * 100, 1) if d.get("stLine") else None,
                         "tranche2": t2, "halted": bool(d.get("halted") or d.get("status"))})
    dips = [row(d) | {"w52p": d.get("w52p"), "hlt": d.get("hlt")} for d in stocks.values() if d.get("dip") == "watch" and d["m"] == "us"]
    dips.sort(key=lambda r: r.get("w52p") or 0)
    dual = (market.get("dc") or {}).get("dual") or {}
    return {"asOf": max((d.get("asOf") or "" for d in stocks.values()), default=None),
            "rules": {"buy": "action=buy", "rev": f"🇺🇸 매출 +{REV_MIN}%↑ (재무 있으면) · 적자 제외", "gap": "트레일링선까지 20% 이하", "sector": "🇺🇸 업종 하나씩 최대 5 · 🇰🇷 최대 3",
                      "tranche": "1회차 = 한도 절반 → +3~6% 마감 & 느린ST 초록이면 나머지 절반 · 매도 = 종가 < 트레일링선"},
            "market": {m: (market.get("judge") or {}).get(m, {}).get("verdict") for m in ("us", "kr")},
            "sectors": [{"tk": x["tk"], "label": x["label"], "rank": x["rank"], "score": x.get("score")} for x in (market.get("sectors") or [])[:6]],
            "candidates": cands, "pickUs": pick_us, "pickKr": pick_kr, "excluded": excluded[:30], "held": heldrows,
            "dips": dips[:8], "dc": {"hold": dual.get("hold"), "cands": dual.get("cands")}}

def _shift_days(iso, n):
    try:
        return (datetime.fromisoformat(iso) + timedelta(days=n)).strftime("%Y-%m-%d")
    except Exception:
        return ""

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
    added = []
    # 앱에서 "종목풀에 추가"를 누르면 watchlist.json 의 extras 로 들어옵니다 (파일 수정 없이 즉시)
    try:
        wl = json.load(open(f"{OUT_DIR}/watchlist.json", encoding="utf-8"))
        for tk in (wl.get("extras") or []):
            tk = str(tk).strip().upper()
            if not tk or tk in universe: continue
            mkt = "kr" if (tk.isdigit() and len(tk) == 6) else "us"
            universe[tk] = {"name": tk, "market": mkt, "sector": "",
                            "y": tk + ".KS" if mkt == "kr" else tk}
            added.append(tk)
        if added: print(f"  ➕ 앱에서 추가한 종목 {len(added)}개: {', '.join(added)}")
    except Exception:
        pass
    if not os.path.exists(EXTRA_FILE):
        return added
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

def pct_fill(stocks, raw_key, out_key, ref, focus, value_fn=None):
    """시장별 백분위. 전체 스캔이면 순위로 계산하고 분포를 ref 에 저장,
       감시 모드(주도주만 스캔)면 지난 전체 분포(ref) 위치로 계산합니다 — 주도주끼리만 줄세우면 왜곡되기 때문."""
    import bisect
    for mkt in ("us", "kr"):
        vals = []
        for tk, d in stocks.items():
            if d["m"] != mkt: continue
            v = value_fn(tk, d) if value_fn else d.get(raw_key)
            if v is None: d[out_key] = None
            else: vals.append((tk, v))
        if focus and ref.get(mkt, {}).get(out_key):
            arr = ref[mkt][out_key]; n = len(arr)
            for tk, v in vals:
                lo, hi = bisect.bisect_left(arr, v), bisect.bisect_right(arr, v)
                stocks[tk][out_key] = round(min(100, max(0, ((lo + hi - 1) / 2) / max(1, n - 1) * 100)), 1)
            continue
        n = len(vals)
        if n < 10:
            continue
        vals.sort(key=lambda x: x[1])
        i = 0
        while i < n:
            j = i
            while j + 1 < n and vals[j + 1][1] == vals[i][1]: j += 1
            pctl = round(((i + j) / 2) / (n - 1) * 100, 1)
            for k in range(i, j + 1): stocks[vals[k][0]][out_key] = pctl
            i = j + 1
        ref.setdefault(mkt, {})[out_key] = [round(v, 4) for _, v in vals]   # 다음 평일 감시 모드용


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
        universe[tk] = {"name": NAME_FIX.get(tk) or s.get("label") or tk, "market": mkt,
                        "sector": sec, "mcap": s.get("mcap"),
                        "y": tk + (".KS" if mkt=="kr" and not tk.endswith(".KS") else "")}
    base_n = len(universe)
    extra_added = load_extra(universe)
    # 앱 📦 종목풀 탭에서 '빼기' 한 종목 — 보유·관심·추가에 있으면 무시(보호 우선)
    try:
        _wl = json.load(open(f"{OUT_DIR}/watchlist.json", encoding="utf-8"))
        _prot = {str(p.get("t", "")).upper() for p in (_wl.get("positions") or [])} | {str(t).upper() for t in (_wl.get("watch") or []) + (_wl.get("extras") or [])}
        _ex = [str(t).upper() for t in (_wl.get("excludes") or []) if str(t).upper() not in _prot]
        _gone = [t for t in _ex if universe.pop(t, None) is not None]
        if _gone: print(f"  ➖ 앱에서 뺀 종목 {len(_gone)}개: {', '.join(_gone[:10])}")
    except Exception:
        _prot = set()
    PROT = set(_prot) | {str(t).upper() for t in extra_added}      # 기준과 무관하게 유지하는 종목

    # ★ 한국 공식 명단 검사 (한투 공개 마스터, 매일) — 주중에 새로 거래정지·관리·경고로 지정될 수 있어 매번 확인합니다
    #   · 이름은 공식 한글명으로 교정 (손 명단의 코드·이름 오류가 앱에 그대로 뜨던 문제)
    #   · 거래정지/정리매매/관리종목/투자경고·위험/우선주/SPAC/리츠·ETF/공식 명단에 없음 → 수집 전에 제외 (보유·관심·추가는 보호)
    #   · 시총 기준은 주간 수집에서만 적용 (매일 흔들리지 않게)
    import universe as U
    KRM = U.kr_master()
    KR_CUT = []
    if len(KRM) > 1000:
        for tk in [t for t, u in universe.items() if u["market"] == "kr"]:
            x = KRM.get(tk)
            if x:
                universe[tk]["name"] = x["name"]; universe[tk]["mcap"] = x["mcap"]
            if tk in PROT:
                r0 = U.kr_status_reason(x)
                if r0 and not r0.startswith("시총"): universe[tk]["status"] = r0     # 보호 종목은 남기되 상태를 표시
                continue
            r = U.kr_status_reason(x)
            if r and not r.startswith("시총"):
                KR_CUT.append((r, tk, universe[tk]["name"])); universe.pop(tk, None)
        if KR_CUT: print(f"  🚫 공식 명단 기준 제외 {len(KR_CUT)}: " + ", ".join(f"{n}({r})" for r, _, n in KR_CUT[:8]))
    else:
        print("  ⚠️ 한투 공식 명단을 받지 못해 이번엔 상태 검사를 건너뜁니다")

    # ★ 감시 모드 (평일) — 신호가 날 수 있는 종목만 봅니다.
    #   눌림·매수 신호는 RS 70↑ 주도주에서만, 과매도는 고점 −25%↓ 에서만 나므로
    #   토요일 전체 스캔에서 RS 60↑ 또는 과매도 후보였던 종목 + 내 종목·관심·추가 만 평일에 다시 받습니다.
    #   실측: 711 → 약 370종목 (신호 종목 56/56 포함). 실행 시간·요청 수가 절반 아래로.
    focus = os.environ.get("FOCUS") == "1"
    ref, prev_mkt, full_n = {}, {}, len(universe)
    try:
        prev_snap = json.load(open(f"{OUT_DIR}/snapshot.json", encoding="utf-8"))
        prev_mkt = json.load(open(f"{OUT_DIR}/market.json", encoding="utf-8"))
        ref = prev_mkt.get("ref") or {}
        full_n = (prev_snap.get("meta", {}).get("health") or {}).get("fullUniverse") or len(universe)
    except Exception:
        prev_snap = None
    if focus and prev_snap and ref:
        prot = set()
        try:
            wl = json.load(open(f"{OUT_DIR}/watchlist.json", encoding="utf-8"))
            prot |= {p.get("t") for p in (wl.get("positions") or []) if p.get("t")}
            prot |= set(wl.get("watch") or []) | set(wl.get("extras") or []) | set(extra_added)
        except Exception:
            prot |= set(extra_added)
        keep = {t for t, d in prev_snap.get("stocks", {}).items()
                if (d.get("rs") or 0) >= 60 or ((d.get("w52p") or 0) <= -25 and (d.get("hlt") or 0) >= 0.6)}
        keep |= {str(t).upper() for t in prot if t}
        fu = {t: v for t, v in universe.items() if t in keep}
        n_kr = sum(1 for v in fu.values() if v["market"] == "kr"); n_us = len(fu) - n_kr
        if n_kr >= 40 and n_us >= 60:
            universe = fu
            print(f"\n🎯 감시 모드: 전체 {full_n} 중 {len(universe)}종목만 (kr {n_kr} · us {n_us}) — 토요일에 전체 재스캔")
        else:
            focus = False
            print(f"\n⚠️ 감시 풀이 너무 작아({n_kr}/{n_us}) 전체 스캔으로 전환")
    elif focus:
        focus = False
        print("\n⚠️ 지난 전체 스캔 기록이 없어 전체 스캔으로 실행")
    if not focus:
        ref = {}    # 전체 스캔이면 분포를 새로 만듭니다
    print(f"\n📋 유니버스 {len(universe)}종목 "
          f"(kr {sum(1 for x in universe.values() if x['market']=='kr')} · "
          f"us {sum(1 for x in universe.values() if x['market']=='us')})")
    print(f"   · stocks.json {base_n}개 + 직접추가 {len(extra_added)}개"
          + (f" → {', '.join(extra_added)}" if extra_added else ""))

    print("\n🌐 시장·섹터 수집")
    market = build_market()

    print(f"\n📊 종목 지표 계산 ({len(universe)}종목)")
    stocks, series = {}, {}

    bhist = {"us": {}, "kr": {}}

    def collect_breadth(cd, mkt):
        """이 종목이 매일 200일선 위였는지를 날짜별로 더합니다.
           종목마다 상장일이 달라 분모(그날 값이 있는 종목 수)도 함께 셉니다."""
        c = [x["c"] for x in cd]
        ma = sma_series(c, 200)
        d = bhist.get(mkt)
        if d is None: return
        for i in range(max(0, len(cd) - BREADTH_DAYS), len(cd)):
            m = ma[i] if i < len(ma) else None
            if m is None or not m: continue
            e = d.get(cd[i]["t"])
            if e is None: e = d[cd[i]["t"]] = [0, 0]
            e[1] += 1
            if c[i] > m: e[0] += 1

    drops = {}      # 제외 사유별 기록 — 조용히 사라지지 않게 남깁니다
    warns = []
    def drop(reason, tk, name, detail=""):
        drops.setdefault(reason, []).append({"t": tk, "n": name, "d": detail})
    for r, tk, n in KR_CUT: drop(r, tk, n)

    def try_one(tk, info, pause):
        """1종목 처리. 검사를 통과한 것만 싣습니다 (종목 수보다 정확도 우선)."""
        if info["market"] == "kr":
            cd, meta, sym = fetch_kr(tk, pause)
            if sym.endswith((".KS", ".KQ")): info["y"] = sym
        else:
            cd, meta = fetch_candles(info["y"])
        if len(cd) < 30:
            time.sleep(pause); return False               # 수집 실패 → 재시도 대상
        # ① 상품명 확인 — 이름 없는 응답은 유령 시세입니다
        if info["market"] == "kr" and not meta.get("longName"):
            drop("유령 시세(이름 없음)", tk, info["name"], info["y"]); time.sleep(pause); return True
        # ② 봉 수 확인 — 200일선·RS 를 못 만드는 종목은 반쪽 지표로 싣지 않습니다
        if len(cd) < MIN_BARS:
            drop("이력 부족", tk, info["name"], f"{len(cd)}봉"); time.sleep(pause); return True
        # ③ 최근 거래 확인
        halted = all((b.get("v") or 0) == 0 for b in cd[-5:])
        if halted and tk not in PROT:
            drop("거래 없음", tk, info["name"]); time.sleep(pause); return True
        cd = cd[-max(BARS_KEEP, 1000):]                # 3년(756일) 건강도 + 200일선 = 956봉 필요
        d = build_stock(tk, cd, meta, info["name"], info["market"], info["sector"])
        time.sleep(pause)
        if not d: return False
        # ④ 하루 ±35% 초과는 분할·오류 의심 → 경고만 남깁니다 (실제 급등락도 있으므로)
        if d.get("d1") is not None and abs(d["d1"]) > JUMP_WARN * 100:
            warns.append({"t": tk, "n": info["name"], "w": f"1일 {d['d1']:+.1f}%"})
        d["ex"] = info["y"][-3:] if info["market"] == "kr" else (meta.get("exchangeName") or "US")
        if halted: d["halted"] = True          # 보유·관심 종목인데 최근 5일 거래 없음 → 거래정지 표시
        stocks[tk] = d
        # ★ 차트용 시계열 — 종목당 파일 1개.
        #   예전처럼 한 덩어리(candles.json)로 묶으면 차트 탭을 처음 열 때 9MB 를 받습니다.
        #   종목별로 쪼개면 누른 종목 하나만 16KB 받으면 됩니다.
        nd = 0 if d["c"] >= 2000 else 2       # 원화 종목은 소수점 불필요
        series[tk] = build_series(cd, min(BARS_KEEP, len(cd)), nd)
        collect_breadth(cd, info["market"])
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

    # ★ 거래대금 하한 (60일 평균) — 🇰🇷 30억 · 🇺🇸 $30M. 팔 때 가격을 밀지 않을 만큼. 보유·관심·추가는 보호
    for tk in list(stocks):
        d = stocks[tk]; kr = d["m"] == "kr"; lim = TV_MIN_KR if kr else TV_MIN_US
        if tk not in PROT and d.get("tv") is not None and d["tv"] < lim:
            drop("거래대금 미달", tk, d.get("n") or tk, f"{d['tv'] / (1e8 if kr else 1e6):.0f}{'억' if kr else '$M'}")
            stocks.pop(tk, None); series.pop(tk, None)
        elif tk in stocks:
            mc = (universe.get(tk) or {}).get("mcap")
            if mc: d["mcap"] = mc                     # 🇰🇷 억원 · 🇺🇸 달러
            st_ = (universe.get(tk) or {}).get("status")
            if st_: d["status"] = st_                 # 보호 종목의 공식 상태 (거래정지·관리종목 등)

    # RS 백분위 — 6개월 수익률의 시장 내 순위 (검증: 21/42/63/126/252일 중 126일이 최고)
    print("\n📈 RS·거래대금 백분위" + (" (감시 모드: 지난 전체 분포 기준)" if focus else ""))
    def r126(tk, d):
        cds = series.get(tk)
        if cds and len(cds) > RS_LOOKBACK and cds[-(RS_LOOKBACK+1)][1]:
            return (cds[-1][1] / cds[-(RS_LOOKBACK+1)][1] - 1) * 100
        return None
    pct_fill(stocks, None, "rs", ref, focus, value_fn=r126)
    pct_fill(stocks, "tv", "tvr", ref, focus)
    for mkt in ("us", "kr"):
        n = sum(1 for d in stocks.values() if d["m"] == mkt and d.get("rs") is not None)
        print(f"  {mkt}: RS {n}종목")

    # ══════════════════════════════════════════════════════════
    # ★ 안전장치 — 야후가 통째로 막힌 날 좋은 데이터를 빈 데이터로 덮어쓰지 않도록.
    #   기존 파일보다 종목 수가 20% 넘게 줄면 아무것도 쓰지 않고 실패 처리합니다.
    # ══════════════════════════════════════════════════════════
    # ⑤ 시세 정지 제외 — 시장 기준일보다 STALE_DAYS 넘게 밀린 종목 (상장폐지·거래정지)
    from datetime import date as _date
    refdate = {}     # (백분위 분포를 담는 ref 와 이름이 겹치지 않게)
    for mkt in ("kr", "us"):
        ds = sorted(d["asOf"] for d in stocks.values() if d["m"] == mkt and d.get("asOf"))
        if ds: refdate[mkt] = ds[-1]
    for tk in [t for t, d in stocks.items() if d.get("asOf") and refdate.get(d["m"])]:
        d = stocks[tk]
        gap = (_date.fromisoformat(refdate[d["m"]]) - _date.fromisoformat(d["asOf"])).days
        if gap > STALE_DAYS:
            if tk in PROT:
                d["halted"] = True; continue     # 들고 있거나 관심 종목이면 남기고 '거래정지'로 표시
            drop("시세 정지", tk, d.get("n") or tk, f"{d['asOf']} ({gap}일 전)")
            stocks.pop(tk, None); series.pop(tk, None)

    # ⑥ 시장별 안전장치 — 나쁜 데이터로 덮어쓰느니 지난 데이터를 그대로 두는 편이 낫습니다
    prev_by_mkt, prev_n = {}, 0
    try:
        _p = json.load(open(f"{OUT_DIR}/snapshot.json", encoding="utf-8"))["stocks"]
        prev_n = len(_p)
        for v in _p.values(): prev_by_mkt[v["m"]] = prev_by_mkt.get(v["m"], 0) + 1
    except Exception: pass
    now_by_mkt = {}
    for v in stocks.values(): now_by_mkt[v["m"]] = now_by_mkt.get(v["m"], 0) + 1
    # ★ '수집이 망가졌나'만 봅니다 — 기준(거래정지·거래대금 등)으로 일부러 뺀 종목은 실패가 아닙니다.
    #   시장별로 받으려던 종목 중 '수집 실패'가 10% 를 넘으면 쓰지 않고 종료 (야후 차단·네트워크 장애)
    uni_by_mkt = {}
    for u in universe.values(): uni_by_mkt[u["market"]] = uni_by_mkt.get(u["market"], 0) + 1
    fail_by_mkt = {}
    for t in fails:
        m_ = (universe.get(t) or {}).get("market", "us"); fail_by_mkt[m_] = fail_by_mkt.get(m_, 0) + 1
    for mkt, un in uni_by_mkt.items():
        fr = fail_by_mkt.get(mkt, 0) / max(1, un)
        if un >= 30 and fr > 0.10:
            print(f"\n❌ {mkt} 시장 수집 실패 {fail_by_mkt.get(mkt, 0)}/{un} ({fr:.0%}) — 망가진 것으로 보고 파일을 쓰지 않고 종료합니다.")
            sys.exit(1)

    # ⑦ 검사 결과 보고 — 제외된 종목이 화면에서 소리 없이 사라지지 않게 남깁니다
    health = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "universe": len(universe), "kept": len(stocks),
        "byMarket": {m: {"kept": now_by_mkt.get(m, 0), "prev": prev_by_mkt.get(m, 0)} for m in ("kr", "us")},
        "dropped": {r: len(v) for r, v in drops.items()},
        "droppedList": {r: v[:40] for r, v in drops.items()},
        "failed": len(fails), "failedList": fails[:40],
        "warn": warns[:40],
        "exchange": {"KS": sum(1 for d in stocks.values() if d.get("ex") == ".KS"),
                     "KQ": sum(1 for d in stocks.values() if d.get("ex") == ".KQ")},
        "rules": {"minBars": MIN_BARS, "staleDays": STALE_DAYS, "minKeep": MIN_KEEP},
        "mode": "focus" if focus else "full", "fullUniverse": full_n,
    }
    print("\n🩺 데이터 검사")
    print(f"  유니버스 {len(universe)} → 사용 {len(stocks)} "
          f"(한국 {now_by_mkt.get('kr',0)} · 미국 {now_by_mkt.get('us',0)})")
    for r, v in sorted(drops.items(), key=lambda x: -len(x[1])):
        print(f"  제외 {r}: {len(v)}종목 — {', '.join(x['n'] for x in v[:6])}{' …' if len(v) > 6 else ''}")
    if warns: print(f"  ⚠️ 급변 경고 {len(warns)}종목: {', '.join(w['n']+'('+w['w']+')' for w in warns[:6])}")
    print(f"  거래소 확정: 코스피 {health['exchange']['KS']} · 코스닥 {health['exchange']['KQ']}")
    _write(f"{OUT_DIR}/data_health.json", health)

    MIN_OK = 0.8
    if len(fails) > (1 - MIN_OK) * len(universe):
        print(f"\n❌ 수집 실패 {len(fails)}/{len(universe)} — 20% 를 넘습니다. 기존 파일을 지키기 위해 쓰지 않고 종료합니다.")
        sys.exit(1)
    # (지난번 대비 급감 비교는 뺐습니다 — 주간 기준으로 종목풀이 줄어드는 것은 정상이고, 망가짐은 위 '수집 실패율'로 잡습니다)

    # ══════════════════════════════════════════════════════════
    # ★ 행동 판정 — 여기서 한 번만 정합니다. 앱 4개 화면·텔레그램·장중 감시는 이 값을 읽기만 합니다.
    #   action: buy(매수!) / watch(관망) / sell(매도!)   ※ hold(보유)는 '들고 있는지'를 아는 앱 쪽에서 붙입니다
    #   why   : pull(눌림·한국) / strong(강세·미국) / trend(추세) — 왜 매수인지
    #   검증(2008–26): 한국은 RSI 45 회복(눌림)이 모든 구간 +, 미국은 RSI 60 이상(강세)이 세 구간 모두 보유를 이김.
    #   매도는 느린 슈퍼트렌드(12,3) 빨강 하나. −3%·고점−5%·2주 타임컷은 검증에서 성과를 깎아 쓰지 않습니다.
    # ══════════════════════════════════════════════════════════
    fin_flags(stocks)
    for d in stocks.values():
        rs_ok = (d.get("rs") or 0) >= 70
        up = bool(d.get("upTrend") and d.get("stSlow") == 1 and rs_ok)
        d["pull"]   = bool(up and d.get("rsi45"))                                            # 한국형
        d["strong"] = bool(up and (d.get("rsi") or 0) >= 60 and d["m"] == "us")              # 미국형
        d["trend3"] = bool(d.get("st") == 3 and d.get("cloud") == 1 and rs_ok)                # 추세 확인형
        d["sig"] = "buy" if d["trend3"] else ("exit" if d.get("stSlow") == 0 else "keep")    # (구버전 호환)
        if d.get("stSlow") == 0:
            d["action"], d["why"] = "sell", "st"
        elif d["m"] == "kr" and d["pull"]:
            d["action"], d["why"] = "buy", "pull"
        elif d["m"] == "us" and d["strong"]:
            d["action"], d["why"] = "buy", "strong"
        elif d["trend3"]:
            d["action"], d["why"] = "buy", "trend"
        else:
            d["action"], d["why"] = "watch", None
        # 급락(과매도) 판정 — 참고용. 27번 재검증: 어떤 조합도 주도주 보유를 못 이김 → −40 특별취급 없앰
        dd, hl = d.get("w52p"), d.get("hlt")
        prof = (d.get("fin") or {}).get("prof")
        rebound = bool(d.get("ma20p") is not None and d["ma20p"] > 0)
        if dd is not None and hl is not None and dd <= -25 and hl >= 0.6:
            broken = (d.get("ma200p") or 0) < -50
            d["dip"] = "broken" if broken else ("watch" if (rebound and (prof or d["m"] == "kr")) else "wait")
        else:
            d["dip"] = None
        # 업종 → 섹터 ETF
        d["sec"] = GICS_TO_ETF.get(d.get("s") or "", None) if d["m"] == "us" else None
        # ★ 예비 후보 (관찰용, 매수! 아님) — 검증(2026-09): '강해질 것 같은' 트리거는 현행을 못 이김.
        #   그래도 다음 매수! 가 나올 자리를 미리 보기 위해 두 가지만 표시합니다.
        #   rising: 추세 유지 · RS 55~70 · 1달 시장대비 플러스   /   turn: 느린ST 초록 전환 3거래일 이내 · RS 50↑ · 200일선 위
        rsv = d.get("rs") or 0
        trend_ok = bool(d.get("upTrend") and d.get("stSlow") == 1)
        if d.get("action") != "buy" and d.get("stSlow") == 1:
            _idx = (market.get("indices") or {}).get("^KS11" if d["m"] == "kr" else ("^IXIC" if d.get("ex") == "NMS" else "^GSPC")) or {}
            _rel = (d.get("d21") or 0) - (_idx.get("d21") or 0)
            if trend_ok and 55 <= rsv < 70 and _rel > 0:
                d["pre"] = "rising"
            elif (d.get("slowDays") or 99) <= 3 and rsv >= 50 and (d.get("ma200p") or -1) > 0:
                d["pre"] = "turn"
            else:
                d["pre"] = None
        else:
            d["pre"] = None

    # 변동성 백분위 — 시장 안에서 줄세우기 (미국 진입 신호로 사용)
    pct_fill(stocks, "atrp", "atrr", ref, focus)
    # 화면·알림 어디서도 쓰지 않는 중간값 제거는 모든 백분위 계산이 끝난 '뒤'에
    DROP = ("atrp", "macdX", "stPrev", "vr", "vr5", "rsi45", "upTrend")
    for d in stocks.values():
        for k in DROP: d.pop(k, None)

    # 시장 '폭' — 200일선 위 종목 비율과 그 3년 백분위. 한국 판단의 근거입니다.
    print("\n🌡️ 시장 폭 계산" + (" (감시 모드: 토요일 전체 스캔 값 유지)" if focus else ""))
    if focus and prev_mkt.get("breadth"):
        breadth = prev_mkt["breadth"]
        market["breadthAsOf"] = prev_mkt.get("breadthAsOf") or prev_snap.get("meta", {}).get("generatedKST", "")[:10]
    else:
        breadth = build_breadth(bhist)
        market["breadthAsOf"] = datetime.now(KST).strftime("%Y-%m-%d")
    for mkt in ("kr","us"):
        b = breadth.get(mkt)
        print(f"  {mkt}: " + (f"{b['v']:.1f}% · 3년 백분위 {b['pct']:.0f} ({b['n']}일 기준)"
                              if b else "표본 부족 — 200일선 판단으로 대체"))
    market["breadth"] = breadth
    market["judge"]   = decide_judge(market["indices"], breadth)
    market["ref"]     = ref if ref else prev_mkt.get("ref") or {}     # 평일 감시 모드가 쓸 분포
    for mkt, j in market["judge"].items():
        print(f"  판단 {mkt}: {j['verdict']} — {j['why']}"
              f"{'' if j['gate'] else '  (참고용, 게이트 없음)'}")

    # 실전 장부 갱신 (지수는 market 의 idxbars 를 날짜 문자열로 바꿔서)
    try:
        idx_series = {}
        for m, key in (("kr", "kr"), ("us", "us")):
            rows = (market.get("idxbars", {}).get(key) or {}).get("rows") or []
            idx_series[m] = [(datetime.fromtimestamp(r[0], timezone.utc).strftime("%Y-%m-%d"), r[1]) for r in rows]
        market["live"] = update_signal_log(stocks, series, idx_series)
    except Exception as e:
        print("  ⚠️ 실전 장부 갱신 실패:", e); market["live"] = None

    # ══════════════════════════════════════════════════════════
    # ★ today.json — 오늘 후보를 파이프라인이 확정해 작은 파일로. (48번)
    #   AI 도구는 이것만 읽으면 되고, 텔레그램 5칸 추천·앱 선정과 같은 규칙이라 서로 어긋나지 않습니다.
    #   규칙: action=buy · 미국 매출 +10%↑(재무 있으면) · 적자 제외 · 트레일링선까지 20% 이하 · 보유 제외 · 업종 하나씩 · 🇺🇸 5 · 🇰🇷 3
    # ══════════════════════════════════════════════════════════
    try:
        market["today"] = build_today(stocks, market)
        _write(f"{OUT_DIR}/today.json", market["today"])
        print(f"  📝 today.json: 후보 {len(market['today']['candidates'])} · 🇺🇸 추천 {len(market['today']['pickUs'])} · 🇰🇷 {len(market['today']['pickKr'])} · 제외 {len(market['today']['excluded'])}")
    except Exception as e:
        print("  ⚠️ today.json 실패:", e)

    print("\n🏦 DC(퇴직연금) ETF 신호")
    etfs, dc = build_dc(market["sectors"], series)
    market["dc"] = dc

    now = datetime.now(timezone.utc)
    meta = {"version":VERSION, "generatedAt":now.isoformat(),
            "generatedKST":now.astimezone(KST).strftime("%Y-%m-%d %H:%M"),
            "failed": fails[:60],
            "pool": {"base": base_n, "extra": extra_added},
            "counts":{"stocks":len(stocks),"failed":len(fails),
                      "sectors":len(market["sectors"]),"indices":len(market["indices"])}}

    meta["counts"]["etfs"] = len(etfs)
    try:
        _fin = json.load(open(f"{OUT_DIR}/stocks.json", encoding="utf-8")).get("financials") or {}
        _d = max((str(v.get("betaUpdatedAt") or v.get("updatedAt") or "") for v in _fin.values() if isinstance(v, dict)), default="")
        meta["finUpdated"] = _d[:10] or None
    except Exception:
        meta["finUpdated"] = None
    meta["health"] = {"kept": health["kept"], "universe": health["universe"],
                      "dropped": health["dropped"], "failed": health["failed"],
                      "byMarket": health["byMarket"], "exchange": health["exchange"],
                      "mode": health["mode"], "fullUniverse": health["fullUniverse"]}
    _write(f"{OUT_DIR}/snapshot.json", {"meta":meta,"stocks":stocks,"etfs":etfs})
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
