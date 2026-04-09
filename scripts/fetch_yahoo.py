#!/usr/bin/env python3
"""
Alpha Terminal — Yahoo Finance 데이터 수집 스크립트
GitHub Actions에서 매 시간 자동 실행

수집 내용:
  - 종목 현재가 + 6개월 캔들
  - 글로벌 지수 현재가 + 스파크라인
  - 섹터 ETF 등락률 (RS 히트맵용)
  - 섹터별 재무 기준값 (ROE/PER/매출성장) ← 자동 계산
"""

import json, os, time
from datetime import datetime, timezone
import requests

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

# ── 종목 목록 ─────────────────────────────────────────────
STOCKS = {
    "NVDA":   {"label":"NVIDIA",     "sector":"Semiconductor","market":"us","target":170,  "roe":91.4,"per":28.1,"revGrowth":122,"liquidity":8.2},
    "AAPL":   {"label":"Apple",      "sector":"Technology",   "market":"us","target":240,  "roe":160.1,"per":29.1,"revGrowth":5,  "liquidity":3.1},
    "TSLA":   {"label":"Tesla",      "sector":"Auto",         "market":"us","target":300,  "roe":18.3,"per":52.4,"revGrowth":1,  "liquidity":12.4},
    "MSFT":   {"label":"Microsoft",  "sector":"Technology",   "market":"us","target":500,  "roe":38.5,"per":34.1,"revGrowth":15, "liquidity":2.8},
    "META":   {"label":"Meta",       "sector":"Technology",   "market":"us","target":700,  "roe":32.1,"per":26.3,"revGrowth":21, "liquidity":4.2},
    "GOOGL":  {"label":"Google",     "sector":"Technology",   "market":"us","target":210,  "roe":29.4,"per":22.1,"revGrowth":15, "liquidity":3.2},
    "AMD":    {"label":"AMD",        "sector":"Semiconductor","market":"us","target":160,  "roe":4.2, "per":44.8,"revGrowth":14, "liquidity":6.8},
    "AMZN":   {"label":"Amazon",     "sector":"Consumer",     "market":"us","target":250,  "roe":21.6,"per":42.1,"revGrowth":12, "liquidity":2.9},
    "005930": {"label":"삼성전자",   "sector":"Semiconductor","market":"kr","suffix":".KS","target":75000, "roe":8.7, "per":14.2,"revGrowth":63,"liquidity":1.8},
    "000660": {"label":"SK하이닉스", "sector":"Semiconductor","market":"kr","suffix":".KS","target":240000,"roe":22.4,"per":10.1,"revGrowth":89,"liquidity":2.4},
    "005380": {"label":"현대차",     "sector":"Auto",         "market":"kr","suffix":".KS","target":280000,"roe":14.2,"per":5.8, "revGrowth":8, "liquidity":0.9},
    "035420": {"label":"NAVER",      "sector":"Technology",   "market":"kr","suffix":".KS","target":260000,"roe":8.9, "per":21.4,"revGrowth":12,"liquidity":1.2},
    "035720": {"label":"카카오",     "sector":"Technology",   "market":"kr","suffix":".KQ","target":58000, "roe":3.2, "per":38.7,"revGrowth":-4,"liquidity":2.1},
}

# ── 글로벌 지수 ───────────────────────────────────────────
INDICES = {
    "^GSPC": {"label":"S&P 500",  "market":"us"},
    "^IXIC": {"label":"NASDAQ",   "market":"us"},
    "^KS11": {"label":"KOSPI",    "market":"kr"},
    "^KQ11": {"label":"KOSDAQ",   "market":"kr"},
    "^N225": {"label":"닛케이",    "market":"jp"},
    "^SSEC": {"label":"상해종합",  "market":"cn"},
    "^VIX":  {"label":"VIX",      "market":"us"},
}

# ── 섹터 ETF + 재무 계산용 대표 종목 ─────────────────────
SECTOR_ETFS = {
    "Semiconductor": {"etf":"SOXX", "members":["NVDA","AMD","INTC","AVGO","QCOM","MU"]},
    "Technology":    {"etf":"XLK",  "members":["MSFT","AAPL","GOOGL","META","CRM","ORCL"]},
    "Auto":          {"etf":"XLY",  "members":["TSLA","GM","F","RIVN","TM","HMC"]},
    "Finance":       {"etf":"XLF",  "members":["JPM","BAC","WFC","GS","MS","BLK"]},
    "Consumer":      {"etf":"XLP",  "members":["AMZN","WMT","COST","TGT","HD","MCD"]},
    "Healthcare":    {"etf":"XLV",  "members":["JNJ","UNH","PFE","ABBV","MRK","LLY"]},
    "Energy":        {"etf":"XLE",  "members":["XOM","CVX","COP","EOG","SLB","MPC"]},
    "Industrial":    {"etf":"XLI",  "members":["GE","HON","CAT","UPS","RTX","LMT"]},
    "Bio":           {"etf":"XBI",  "members":["MRNA","BNTX","REGN","VRTX","ALNY","GILD"]},
    "Cloud":         {"etf":"SKYY", "members":["AMZN","MSFT","GOOGL","CRM","NOW","SNOW"]},
    "AI":            {"etf":"AIQ",  "members":["NVDA","MSFT","GOOGL","META","AMD","AVGO"]},
    "Nuclear":       {"etf":"URA",  "members":["CCJ","NXE","UEC","DNN","UUUU","BWXT"]},
}

def fetch_yahoo(ticker, range_="6mo", interval="1d"):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval={interval}&range={range_}"
    for attempt in range(3):
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            if r.status_code == 200:
                data = r.json()
                if data.get("chart", {}).get("result"):
                    return data
        except Exception as e:
            print(f"    오류: {e}")
        time.sleep(2)
    return None

def fetch_fundamentals(ticker):
    """종목 재무 데이터 (ROE, PER, 매출성장) 가져오기"""
    url = f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{ticker}?modules=financialData,defaultKeyStatistics,incomeStatementHistory"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            return None
        data = r.json()
        result = data.get("quoteSummary", {}).get("result", [{}])[0]
        fin    = result.get("financialData", {})
        stats  = result.get("defaultKeyStatistics", {})
        income = result.get("incomeStatementHistory", {}).get("incomeStatementHistory", [])

        roe = fin.get("returnOnEquity", {}).get("raw")
        roe = round(roe * 100, 1) if roe else None

        per = stats.get("trailingPE", {}).get("raw")
        per = round(per, 1) if per else None

        rev_growth = None
        if len(income) >= 2:
            rev_cur  = income[0].get("totalRevenue", {}).get("raw", 0)
            rev_prev = income[1].get("totalRevenue", {}).get("raw", 0)
            if rev_prev and rev_cur:
                rev_growth = round((rev_cur - rev_prev) / abs(rev_prev) * 100, 1)

        return {"roe": roe, "per": per, "revGrowth": rev_growth}
    except:
        return None

def parse_candles(raw):
    result = raw["chart"]["result"][0]
    ts = result.get("timestamp", [])
    q  = result["indicators"]["quote"][0]
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

def main():
    now_str = datetime.now(timezone.utc).isoformat()
    print(f"\n=== Alpha Terminal 데이터 수집: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ===\n")

    output = {
        "stocks":  {},
        "indices": {},
        "sectors": {},
        "updatedAt": now_str,
    }

    # 1. 종목 수집
    print("📈 종목 데이터 수집 중...")
    success = 0
    for ticker, info in STOCKS.items():
        suffix = info.get("suffix", "")
        yahoo_ticker = ticker + suffix
        print(f"  {ticker:8s} ({yahoo_ticker}) ... ", end="", flush=True)
        raw = fetch_yahoo(yahoo_ticker)
        if not raw:
            print("❌ 실패")
            continue
        try:
            candles, meta = parse_candles(raw)
            if not candles:
                print("❌ 캔들 없음")
                continue
            price     = float(meta.get("regularMarketPrice") or candles[-1]["close"])
            prev      = float(meta.get("chartPreviousClose") or meta.get("previousClose") or price)
            change    = round(price - prev, 3)
            changePct = round((change / prev * 100) if prev else 0, 2)
            stock_out = {k: v for k, v in info.items() if k != "suffix"}
            stock_out.update({
                "ticker": ticker, "price": price, "change": change,
                "changePct": changePct,
                "chg3d": calc_change(candles, 3),
                "chg5d": calc_change(candles, 5),
                "candles": candles, "updatedAt": now_str,
            })
            output["stocks"][ticker] = stock_out
            print(f"✅  {price:>10.2f}  ({changePct:+.2f}%)")
            success += 1
        except Exception as e:
            print(f"❌ {e}")
        time.sleep(0.7)

    # 2. 지수 수집
    print("\n🌐 지수 데이터 수집 중...")
    for ticker, info in INDICES.items():
        print(f"  {info['label']:10s} ({ticker}) ... ", end="", flush=True)
        raw = fetch_yahoo(ticker)
        if not raw:
            print("❌ 실패")
            continue
        try:
            candles, meta = parse_candles(raw)
            price     = float(meta.get("regularMarketPrice") or (candles[-1]["close"] if candles else 0))
            prev      = float(meta.get("chartPreviousClose") or meta.get("previousClose") or price)
            changePct = round((price - prev) / prev * 100, 2) if prev else 0
            output["indices"][ticker] = {
                **info, "ticker": ticker, "price": price,
                "changePct": changePct,
                "chg3d": calc_change(candles, 3),
                "chg5d": calc_change(candles, 5),
                "spark": [c["close"] for c in candles[-30:]],
            }
            print(f"✅  {price:>10.2f}  ({changePct:+.2f}%)")
        except Exception as e:
            print(f"❌ {e}")
        time.sleep(0.7)

    # 3. 섹터 ETF + 재무 기준값 자동 계산
    print("\n📊 섹터 기준값 자동 계산 중...")
    for sector_name, sector_info in SECTOR_ETFS.items():
        etf     = sector_info["etf"]
        members = sector_info["members"]
        print(f"\n  [{sector_name}] ETF={etf}")

        # ETF 등락률
        etf_chg = {"chg1W": 0.0, "chg1M": 0.0, "chg3M": 0.0}
        raw_etf = fetch_yahoo(etf)
        if raw_etf:
            try:
                c, _ = parse_candles(raw_etf)
                if c:
                    etf_chg["chg1W"] = calc_change(c, 5)
                    etf_chg["chg1M"] = calc_change(c, 21)
                    etf_chg["chg3M"] = calc_change(c, 63)
                print(f"    ETF: 1W={etf_chg['chg1W']:+.1f}%  1M={etf_chg['chg1M']:+.1f}%  3M={etf_chg['chg3M']:+.1f}%")
            except Exception as e:
                print(f"    ETF 오류: {e}")
        time.sleep(0.5)

        # 구성종목 재무 평균
        roes, pers, revs = [], [], []
        for m in members:
            print(f"    재무 {m} ... ", end="", flush=True)
            fund = fetch_fundamentals(m)
            if fund:
                if fund["roe"]       is not None: roes.append(fund["roe"])
                if fund["per"]       is not None: pers.append(fund["per"])
                if fund["revGrowth"] is not None: revs.append(fund["revGrowth"])
                print(f"ROE={fund['roe']}  PER={fund['per']}  Rev={fund['revGrowth']}")
            else:
                print("❌")
            time.sleep(0.8)

        avg_roe = round(sum(roes)/len(roes), 1) if roes else 15.0
        avg_per = round(sum(pers)/len(pers), 1) if pers else 20.0
        avg_rev = round(sum(revs)/len(revs), 1) if revs else 5.0

        output["sectors"][sector_name] = {
            "etf": etf, "roe": avg_roe, "per": avg_per, "rev": avg_rev,
            **etf_chg, "updatedAt": now_str,
        }
        print(f"    ✅ 평균 → ROE={avg_roe}  PER={avg_per}  Rev={avg_rev}%")

    # 4. 저장
    os.makedirs("public/data", exist_ok=True)
    path = "public/data/stocks.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(path) / 1024
    print(f"\n✅ 완료: 종목 {success}개 | 지수 {len(output['indices'])}개 | 섹터 {len(output['sectors'])}개 | {size_kb:.1f}KB\n")

if __name__ == "__main__":
    main()
