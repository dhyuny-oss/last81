"""263. ② 지표 — 이동평균 · RSI · MACD · 슈퍼트렌드 · 일목 · 차트 시계열 · 종목 한 줄"""
from snap.common import *  # noqa
from snap.fetch import *  # noqa


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
    name = _htmllib.unescape(name) if isinstance(name, str) else name      # 135. "&amp;" → "&"
    c = [x["c"] for x in cd]; v = [x["v"] for x in cd]
    px = c[-1]
    ma200 = sma(c, 200)
    v20 = sma(v, 20); v5 = sma(v, 5)
    _v50 = sma(v, 50)
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
    d["ma20p"]    = _r((px / _ma20 - 1) * 100) if _ma20 else None      # 급락 탭 '반등 확인' · 차트 '자리 정보'
    d["vol"]      = _r(v5 / _v50, 2) if (v5 and _v50) else None        # 거래량 5일/50일 — 참고용 (거르면 성과 악화)
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

__all__ = [n for n in dir() if not n.startswith("__")]   # 밑줄 이름(_r · _write …)도 다음 단계가 쓰도록 내보냄
