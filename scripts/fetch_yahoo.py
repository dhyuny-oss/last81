#!/usr/bin/env python3
"""
Alpha Terminal — Yahoo Finance 데이터 수집
- hourly 모드 (평일 매 시간): 관심종목 현재가만
- daily  모드 (평일 오후 6시): 전체 풀 + 재무 + 알파스캔
"""

import json, os, time, requests
from datetime import datetime, timezone

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
MODE = os.environ.get("COLLECT_MODE", "hourly")

# ── 글로벌 지수 ───────────────────────────────────────────
INDICES = {
    "^GSPC": {"label":"S&P 500",  "market":"us"},
    "^IXIC": {"label":"NASDAQ",   "market":"us"},
    "^KS11": {"label":"KOSPI",    "market":"kr"},
    "^KQ11": {"label":"KOSDAQ",   "market":"kr"},
    "^N225": {"label":"닛케이",   "market":"jp"},
    "^SSEC": {"label":"상해종합", "market":"cn"},
    "^VIX":  {"label":"VIX",      "market":"us"},
}

# ── 기본 관심종목 폴백 ────────────────────────────────────
DEFAULT_WATCHLIST = {
    "NVDA":   {"label":"NVIDIA",    "sector":"Semiconductor","market":"us"},
    "AAPL":   {"label":"Apple",     "sector":"Technology",   "market":"us"},
    "MSFT":   {"label":"Microsoft", "sector":"Technology",   "market":"us"},
    "META":   {"label":"Meta",      "sector":"Technology",   "market":"us"},
    "TSLA":   {"label":"Tesla",     "sector":"Auto",         "market":"us"},
    "005930": {"label":"삼성전자",  "sector":"Semiconductor","market":"kr","suffix":".KS"},
    "000660": {"label":"SK하이닉스","sector":"Semiconductor","market":"kr","suffix":".KS"},
    "005380": {"label":"현대차",    "sector":"Auto",         "market":"kr","suffix":".KS"},
    "035420": {"label":"NAVER",     "sector":"Technology",   "market":"kr","suffix":".KS"},
    "035720": {"label":"카카오",    "sector":"Technology",   "market":"kr","suffix":".KQ"},
}

# ── 야후 파이낸스 요청 ────────────────────────────────────
def fetch_yahoo(ticker, range_="6mo", interval="1d"):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval={interval}&range={range_}"
    for _ in range(3):
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            if r.status_code == 200:
                d = r.json()
                if d.get("chart", {}).get("result"):
                    return d
        except Exception as e:
            print(f"    오류: {e}")
        time.sleep(2)
    return None

def fetch_fundamentals(ticker):
    """ROE, PER, 매출성장 수집"""
    url = f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{ticker}?modules=financialData,defaultKeyStatistics,incomeStatementHistory"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            return {}
        data = r.json()
        result = data.get("quoteSummary", {}).get("result", [{}])[0]
        fin    = result.get("financialData", {})
        stats  = result.get("defaultKeyStatistics", {})
        income = result.get("incomeStatementHistory", {}).get("incomeStatementHistory", [])

        roe = fin.get("returnOnEquity", {}).get("raw")
        roe = round(roe * 100, 1) if roe else 0

        per = stats.get("trailingPE", {}).get("raw")
        per = round(per, 1) if per else 0

        rev_growth = 0
        if len(income) >= 2:
            cur  = income[0].get("totalRevenue", {}).get("raw", 0)
            prev = income[1].get("totalRevenue", {}).get("raw", 0)
            if prev and cur:
                rev_growth = round((cur - prev) / abs(prev) * 100, 1)

        liquidity = fin.get("currentRatio", {}).get("raw", 0)
        liquidity = round(liquidity, 1) if liquidity else 0

        return {"roe": roe, "per": per, "revGrowth": rev_growth, "liquidity": liquidity}
    except:
        return {}

def parse_candles(raw):
    result = raw["chart"]["result"][0]
    ts   = result.get("timestamp", [])
    q    = result["indicators"]["quote"][0]
    meta = result["meta"]
    candles = []
    for i, t in enumerate(ts):
        close = q["close"][i]
        if not close or close <= 0:
            continue
        d = datetime.fromtimestamp(t, tz=timezone.utc)
        candles.append({
            "date":   f"{d.month}/{d.day}",
            "close":  round(float(close), 3),
            "high":   round(float(q["high"][i]  or close), 3),
            "low":    round(float(q["low"][i]   or close), 3),
            "volume": int(q["volume"][i] or 0),
        })
    return candles, meta

def calc_change(candles, n):
    if len(candles) <= n:
        return 0.0
    old = candles[-(n+1)]["close"]
    new = candles[-1]["close"]
    return round((new - old) / old * 100, 2) if old else 0.0

def calc_ema(closes, period):
    if len(closes) < period:
        return [None] * len(closes)
    k = 2 / (period + 1)
    ema = [None] * (period - 1)
    ema.append(sum(closes[:period]) / period)
    for c in closes[period:]:
        ema.append(ema[-1] * (1 - k) + c * k)
    return ema

# ── 기술적 지표 기반 알파 스캔 ────────────────────────────
def alpha_scan(ticker, info, candles, fundamentals):
    """종목이 알파 조건에 맞는지 체크 → 점수 반환"""
    if len(candles) < 20:
        return None

    closes  = [c["close"] for c in candles]
    volumes = [c["volume"] for c in candles]

    # EMA 계산
    ema3  = calc_ema(closes, 3)
    ema10 = calc_ema(closes, 10)
    ema20 = calc_ema(closes, 20)

    last_close = closes[-1]
    score = 0
    signals = []

    # ① 골든크로스 (3일선 > 10일선, 최근 3일 내 교차)
    if ema3[-1] and ema10[-1] and ema3[-3] and ema10[-3]:
        cross_now  = ema3[-1] > ema10[-1]
        cross_prev = ema3[-3] <= ema10[-3]
        if cross_now and cross_prev:
            score += 25
            signals.append("골든크로스")
        elif cross_now:
            score += 10  # 이미 위에 있음

    # ② 거래량 급증 (최근 5일 평균 > 20일 평균의 150%)
    if len(volumes) >= 20:
        vol5  = sum(volumes[-5:])  / 5
        vol20 = sum(volumes[-20:]) / 20
        if vol20 > 0 and vol5 > vol20 * 1.5:
            score += 20
            signals.append("거래량급증")

    # ③ 상승 모멘텀 (최근 5일 연속 양봉)
    recent = candles[-5:]
    if all(c["close"] >= c["open"] if "open" in c else c["close"] >= candles[max(0,i-1)]["close"]
           for i, c in enumerate(recent)):
        score += 10
        signals.append("상승모멘텀")

    # ④ 52주 고점 근접 (VCP)
    w52h = max(closes)
    if last_close >= w52h * 0.85:
        # 거래량 수축 확인
        vol_early  = sum(volumes[-20:-15]) / 5 if len(volumes) >= 20 else 0
        vol_recent = sum(volumes[-5:]) / 5
        if vol_early > 0 and vol_recent < vol_early * 0.7:
            score += 20
            signals.append("VCP")

    # ⑤ 3일/5일 등락 양호
    chg3 = calc_change(candles, 3)
    chg5 = calc_change(candles, 5)
    if chg3 > 2: score += 10
    if chg5 > 3: score += 10

    # ⑥ 재무 점수
    roe = fundamentals.get("roe", 0)
    rev = fundamentals.get("revGrowth", 0)
    per = fundamentals.get("per", 0)
    liq = fundamentals.get("liquidity", 0)

    if roe > 15:  score += 10
    if roe > 25:  score += 5
    if rev > 10:  score += 10
    if rev > 20:  score += 5
    if 0 < per < 30: score += 5
    if liq > 1.5: score += 5

    if score < 20:
        return None

    return {
        "ticker":    ticker,
        "label":     info.get("label", ticker),
        "market":    info.get("market", "us"),
        "sector":    info.get("sector", "Unknown"),
        "price":     last_close,
        "chg3d":     chg3,
        "chg5d":     chg5,
        "score":     score,
        "signals":   signals,
        "roe":       roe,
        "revGrowth": rev,
        "per":       per,
        "liquidity": liq,
        "changePct": calc_change(candles, 1),
    }

# ── 종목 목록 수집 ─────────────────────────────────────────
def get_kospi200():
    print("  KRX 코스피200...")
    try:
        r = requests.post(
            "https://www.krx.co.kr/comm/bldAttendant/getJsonData.cmd",
            data={"bld":"dbms/MDC/STAT/standard/MDCSTAT00601","locale":"ko_KR",
                  "idxIndMidclssCd":"02","trdDd":datetime.now().strftime("%Y%m%d"),
                  "share":"1","money":"1","csvxls_isNo":"false"},
            headers={**HEADERS,"Referer":"https://www.krx.co.kr/"}, timeout=15
        )
        stocks = {}
        for item in r.json().get("OutBlock_1", []):
            t = item.get("ISU_SRT_CD","").zfill(6)
            n = item.get("ISU_ABBRV","")
            if t and n:
                stocks[t] = {"label":n,"sector":"Korean","market":"kr","suffix":".KS"}
        print(f"    ✅ {len(stocks)}개")
        return stocks
    except Exception as e:
        print(f"    ❌ {e}")
        return {}

def get_nasdaq100():
    """Wikipedia에서 나스닥100 종목 목록 가져오기"""
    print("  Wikipedia 나스닥100...")
    try:
        import re
        r = requests.get(
            "https://en.wikipedia.org/wiki/Nasdaq-100",
            headers=HEADERS, timeout=15
        )
        # 티커 파싱
        rows = re.findall(r'<td[^>]*><a[^>]+>([A-Z]{1,6})</a></td>\s*<td[^>]*>([^<]+)</td>', r.text)
        stocks = {}
        for ticker, name in rows[:110]:
            if len(ticker) <= 6 and ticker.isupper():
                stocks[ticker] = {"label":name.strip()[:30], "sector":"Technology", "market":"us"}
        # 못 가져오면 하드코딩 TOP 20으로 폴백
        if len(stocks) < 10:
            for t, n in [("AAPL","Apple"),("MSFT","Microsoft"),("NVDA","NVIDIA"),
                         ("META","Meta"),("GOOGL","Alphabet"),("AMZN","Amazon"),
                         ("TSLA","Tesla"),("AVGO","Broadcom"),("COST","Costco"),
                         ("NFLX","Netflix"),("AMD","AMD"),("ADBE","Adobe"),
                         ("INTC","Intel"),("QCOM","Qualcomm"),("AMAT","Applied Materials"),
                         ("MU","Micron"),("LRCX","Lam Research"),("KLAC","KLA Corp"),
                         ("MRVL","Marvell"),("PANW","Palo Alto")]:
                stocks[t] = {"label":n,"sector":"Technology","market":"us"}
        print(f"    ✅ {len(stocks)}개")
        return stocks
    except Exception as e:
        print(f"    ❌ {e}")
        return {}

def get_sp500():
    print("  Wikipedia S&P500...")
    try:
        import re
        r = requests.get(
            "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
            headers=HEADERS, timeout=15
        )
        rows = re.findall(r'<tr>\s*<td[^>]*><a[^>]+>([A-Z.]{1,6})</a></td>\s*<td[^>]*><a[^>]+>([^<]+)</a>', r.text)
        stocks = {}
        for ticker, name in rows[:500]:
            ticker = ticker.replace(".", "-")
            stocks[ticker] = {"label":name[:30],"sector":"US","market":"us"}
        print(f"    ✅ {len(stocks)}개")
        return stocks
    except Exception as e:
        print(f"    ❌ {e}")
        return {}

def load_watchlist():
    try:
        if os.path.exists("public/data/watchlist.json"):
            with open("public/data/watchlist.json","r",encoding="utf-8") as f:
                return json.load(f).get("stocks", DEFAULT_WATCHLIST)
    except:
        pass
    return DEFAULT_WATCHLIST

def main():
    now_str = datetime.now(timezone.utc).isoformat()
    print(f"\n=== Alpha Terminal [{MODE.upper()}] {datetime.now().strftime('%Y-%m-%d %H:%M')} ===\n")
    os.makedirs("public/data", exist_ok=True)

    # 기존 데이터 로드
    existing = {}
    if os.path.exists("public/data/stocks.json"):
        try:
            with open("public/data/stocks.json","r") as f:
                existing = json.load(f)
        except:
            pass

    output = {
        "stocks":  existing.get("stocks", {}),
        "indices": existing.get("indices", {}),
        "sectors": existing.get("sectors", {}),
        "pool":    existing.get("pool", {}),
        "updatedAt": now_str,
        "mode": MODE,
    }

    # ── 지수 (항상 수집) ──────────────────────────────────
    print("🌐 지수 수집...")
    for ticker, info in INDICES.items():
        print(f"  {info['label']:10s} ({ticker})... ", end="", flush=True)
        raw = fetch_yahoo(ticker)
        if not raw:
            print("❌")
            continue
        try:
            candles, meta = parse_candles(raw)
            price     = float(meta.get("regularMarketPrice") or (candles[-1]["close"] if candles else 0))
            prev      = float(meta.get("chartPreviousClose") or meta.get("previousClose") or price)
            changePct = round((price-prev)/prev*100, 2) if prev else 0
            output["indices"][ticker] = {
                **info, "ticker":ticker, "price":price,
                "changePct":changePct,
                "chg3d":calc_change(candles,3),
                "chg5d":calc_change(candles,5),
                "spark":[c["close"] for c in candles[-30:]],
            }
            print(f"✅ {price:,.2f} ({changePct:+.2f}%)")
        except Exception as e:
            print(f"❌ {e}")
        time.sleep(0.5)

    if MODE == "daily":
        # ── DAILY: 전체 풀 수집 + 알파 스캔 ─────────────
        print("\n📦 전체 종목 풀 수집 중...")
        pool = {}
        pool.update(get_kospi200())
        pool.update(get_nasdaq100())
        pool.update(get_sp500())
        print(f"  총 {len(pool)}개 종목")

        alpha_hits = []
        pool_data  = {}
        success = 0

        for i, (ticker, info) in enumerate(pool.items()):
            suffix = info.get("suffix","")
            yt = ticker + suffix
            print(f"  [{i+1}/{len(pool)}] {ticker:8s}... ", end="", flush=True)

            raw = fetch_yahoo(yt, range_="3mo")
            if not raw:
                print("❌")
                time.sleep(0.3)
                continue

            try:
                candles, meta = parse_candles(raw)
                if not candles:
                    print("❌ 캔들없음")
                    continue

                price     = float(meta.get("regularMarketPrice") or candles[-1]["close"])
                prev      = float(meta.get("chartPreviousClose") or meta.get("previousClose") or price)
                changePct = round((price-prev)/prev*100, 2) if prev else 0

                stock_data = {
                    **{k:v for k,v in info.items() if k!="suffix"},
                    "ticker":ticker, "price":price,
                    "changePct":changePct,
                    "chg3d":calc_change(candles,3),
                    "chg5d":calc_change(candles,5),
                    "updatedAt":now_str,
                }

                # 재무 데이터 (미국 주식만 - 야후 재무 정확도 높음)
                fundamentals = {}
                if info.get("market") == "us":
                    fundamentals = fetch_fundamentals(ticker)
                    stock_data.update(fundamentals)
                    time.sleep(0.3)

                pool_data[ticker] = stock_data

                # 알파 스캔
                hit = alpha_scan(ticker, info, candles, fundamentals)
                if hit:
                    hit["price"]     = price
                    hit["changePct"] = changePct
                    alpha_hits.append(hit)
                    print(f"⭐ {price:,.1f} 점수:{hit['score']} {','.join(hit['signals'])}")
                else:
                    print(f"  {price:,.1f} ({changePct:+.1f}%)")

                success += 1
            except Exception as e:
                print(f"❌ {e}")
            time.sleep(0.4)

        # 알파 결과 저장
        alpha_hits.sort(key=lambda x: x["score"], reverse=True)
        output["pool"] = pool_data

        with open("public/data/alpha_hits.json", "w", encoding="utf-8") as f:
            json.dump({
                "hits": alpha_hits,
                "count": len(alpha_hits),
                "scanned": success,
                "updatedAt": now_str,
            }, f, ensure_ascii=False, separators=(",",":"))

        print(f"\n🎯 알파 스캔 완료: {len(alpha_hits)}개 발견 / {success}개 스캔")

        # 관심종목 6개월 데이터도 업데이트
        watchlist = load_watchlist()
        print(f"\n⭐ 관심종목 {len(watchlist)}개 6개월 데이터 업데이트...")
        for ticker, info in watchlist.items():
            suffix = info.get("suffix","")
            raw = fetch_yahoo(ticker+suffix, range_="6mo")
            if not raw:
                continue
            try:
                candles, meta = parse_candles(raw)
                price     = float(meta.get("regularMarketPrice") or candles[-1]["close"])
                prev      = float(meta.get("chartPreviousClose") or meta.get("previousClose") or price)
                changePct = round((price-prev)/prev*100,2) if prev else 0
                output["stocks"][ticker] = {
                    **{k:v for k,v in info.items() if k!="suffix"},
                    "ticker":ticker,"price":price,"changePct":changePct,
                    "chg3d":calc_change(candles,3),"chg5d":calc_change(candles,5),
                    "candles":candles,"updatedAt":now_str,
                }
                print(f"  {ticker} ✅")
            except:
                pass
            time.sleep(0.5)

    else:
        # ── HOURLY: 관심종목만 ────────────────────────────
        print("\n⭐ 관심종목 현재가 업데이트...")
        watchlist = load_watchlist()
        for ticker, info in watchlist.items():
            suffix = info.get("suffix","")
            raw = fetch_yahoo(ticker+suffix)
            if not raw:
                continue
            try:
                candles, meta = parse_candles(raw)
                price     = float(meta.get("regularMarketPrice") or candles[-1]["close"])
                prev      = float(meta.get("chartPreviousClose") or meta.get("previousClose") or price)
                changePct = round((price-prev)/prev*100,2) if prev else 0
                output["stocks"][ticker] = {
                    **{k:v for k,v in (output["stocks"].get(ticker,info)).items()},
                    "price":price,"changePct":changePct,
                    "chg3d":calc_change(candles,3),"chg5d":calc_change(candles,5),
                    "candles":candles,"updatedAt":now_str,
                }
                print(f"  {ticker} ✅ {price:,.2f} ({changePct:+.2f}%)")
            except Exception as e:
                print(f"  {ticker} ❌ {e}")
            time.sleep(0.5)

    # ── 저장 ─────────────────────────────────────────────
    path = "public/data/stocks.json"
    with open(path,"w",encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",",":"))

    print(f"\n✅ 완료 ({os.path.getsize(path)/1024:.1f}KB)\n")

if __name__ == "__main__":
    main()
