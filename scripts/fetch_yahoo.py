#!/usr/bin/env python3
"""
Alpha Terminal — Yahoo Finance 데이터 수집
- hourly 모드: watchlist.json 관심종목만 수집
- daily 모드: 코스피200 + S&P500 전체 + 관심종목 수집
"""

import json, os, time, sys, requests
from datetime import datetime, timezone

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
MODE = os.environ.get("COLLECT_MODE", "hourly")

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

# ── 기본 관심종목 (watchlist.json 없을 때 폴백) ──────────
DEFAULT_WATCHLIST = {
    "NVDA":   {"label":"NVIDIA",     "sector":"Semiconductor","market":"us"},
    "AAPL":   {"label":"Apple",      "sector":"Technology",   "market":"us"},
    "MSFT":   {"label":"Microsoft",  "sector":"Technology",   "market":"us"},
    "META":   {"label":"Meta",       "sector":"Technology",   "market":"us"},
    "TSLA":   {"label":"Tesla",      "sector":"Auto",         "market":"us"},
    "005930": {"label":"삼성전자",   "sector":"Semiconductor","market":"kr","suffix":".KS"},
    "000660": {"label":"SK하이닉스", "sector":"Semiconductor","market":"kr","suffix":".KS"},
    "005380": {"label":"현대차",     "sector":"Auto",         "market":"kr","suffix":".KS"},
    "035420": {"label":"NAVER",      "sector":"Technology",   "market":"kr","suffix":".KS"},
    "035720": {"label":"카카오",     "sector":"Technology",   "market":"kr","suffix":".KQ"},
}

def fetch_yahoo(ticker, range_="6mo", interval="1d"):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval={interval}&range={range_}"
    for _ in range(3):
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
            "high":   round(float(q["high"][i] or close), 3),
            "low":    round(float(q["low"][i]  or close), 3),
            "volume": int(q["volume"][i] or 0),
        })
    return candles, meta

def calc_change(candles, n):
    if len(candles) <= n:
        return 0.0
    old = candles[-(n+1)]["close"]
    new = candles[-1]["close"]
    return round((new - old) / old * 100, 2) if old else 0.0

def get_kospi200():
    """KRX에서 코스피200 종목 목록 가져오기"""
    print("  KRX 코스피200 종목 목록 가져오는 중...")
    try:
        url = "https://www.krx.co.kr/comm/bldAttendant/getJsonData.cmd"
        data = {
            "bld": "dbms/MDC/STAT/standard/MDCSTAT00601",
            "locale": "ko_KR",
            "idxIndMidclssCd": "02",
            "trdDd": datetime.now().strftime("%Y%m%d"),
            "share": "1",
            "money": "1",
            "csvxls_isNo": "false",
        }
        r = requests.post(url, data=data, headers={
            "User-Agent": HEADERS["User-Agent"],
            "Referer": "https://www.krx.co.kr/",
        }, timeout=15)
        result = r.json()
        stocks = {}
        for item in result.get("OutBlock_1", []):
            ticker = item.get("ISU_SRT_CD", "").zfill(6)
            name   = item.get("ISU_ABBRV", "")
            if ticker and name:
                stocks[ticker] = {"label": name, "sector": "Korean", "market": "kr", "suffix": ".KS"}
        print(f"  ✅ 코스피200: {len(stocks)}개")
        return stocks
    except Exception as e:
        print(f"  ❌ KRX 오류: {e}")
        return {}

def get_kosdaq150():
    """KRX에서 코스닥150 종목 목록 가져오기"""
    print("  KRX 코스닥150 종목 목록 가져오는 중...")
    try:
        url = "https://www.krx.co.kr/comm/bldAttendant/getJsonData.cmd"
        data = {
            "bld": "dbms/MDC/STAT/standard/MDCSTAT00601",
            "locale": "ko_KR",
            "idxIndMidclssCd": "03",
            "trdDd": datetime.now().strftime("%Y%m%d"),
            "share": "1",
            "money": "1",
            "csvxls_isNo": "false",
        }
        r = requests.post(url, data=data, headers={
            "User-Agent": HEADERS["User-Agent"],
            "Referer": "https://www.krx.co.kr/",
        }, timeout=15)
        result = r.json()
        stocks = {}
        for item in result.get("OutBlock_1", []):
            ticker = item.get("ISU_SRT_CD", "").zfill(6)
            name   = item.get("ISU_ABBRV", "")
            if ticker and name:
                stocks[ticker] = {"label": name, "sector": "Korean", "market": "kr", "suffix": ".KQ"}
        print(f"  ✅ 코스닥150: {len(stocks)}개")
        return stocks
    except Exception as e:
        print(f"  ❌ KRX 코스닥 오류: {e}")
        return {}

def get_sp500():
    """Wikipedia에서 S&P 500 종목 목록 가져오기"""
    print("  Wikipedia S&P500 종목 목록 가져오는 중...")
    try:
        import re
        r = requests.get(
            "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
            headers=HEADERS, timeout=15
        )
        # 티커와 회사명 파싱
        tickers = re.findall(r'<td><a[^>]+>([A-Z]{1,5})</a></td>', r.text)
        names   = re.findall(r'<td><a[^>]+title="([^"]+)"[^>]*>(?:[A-Z]{1,5})</a></td>', r.text)
        stocks = {}
        for i, ticker in enumerate(tickers[:500]):
            name = names[i] if i < len(names) else ticker
            stocks[ticker] = {"label": name[:30], "sector": "US", "market": "us"}
        print(f"  ✅ S&P500: {len(stocks)}개")
        return stocks
    except Exception as e:
        print(f"  ❌ Wikipedia 오류: {e}")
        return {}

def load_watchlist():
    """watchlist.json 로드 (없으면 기본값)"""
    try:
        if os.path.exists("public/data/watchlist.json"):
            with open("public/data/watchlist.json", "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("stocks", DEFAULT_WATCHLIST)
    except:
        pass
    return DEFAULT_WATCHLIST

def collect_stocks(stock_dict, now_str, range_="6mo", label=""):
    """종목 딕셔너리에서 야후 파이낸스 데이터 수집"""
    results = {}
    total = len(stock_dict)
    success = 0
    for i, (ticker, info) in enumerate(stock_dict.items()):
        suffix = info.get("suffix", "")
        yahoo_ticker = ticker + suffix
        print(f"  [{i+1}/{total}] {ticker:8s} ... ", end="", flush=True)
        raw = fetch_yahoo(yahoo_ticker, range_=range_)
        if not raw:
            print("❌")
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
                "ticker":    ticker,
                "price":     price,
                "change":    change,
                "changePct": changePct,
                "chg3d":     calc_change(candles, 3),
                "chg5d":     calc_change(candles, 5),
                "candles":   candles,
                "updatedAt": now_str,
            })
            results[ticker] = stock_out
            print(f"✅ {price:>10.2f} ({changePct:+.2f}%)")
            success += 1
        except Exception as e:
            print(f"❌ {e}")
        time.sleep(0.5)
    print(f"  {label} 완료: {success}/{total}개")
    return results

def main():
    now_str = datetime.now(timezone.utc).isoformat()
    print(f"\n=== Alpha Terminal [{MODE.upper()}] 수집: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ===\n")

    os.makedirs("public/data", exist_ok=True)

    # 기존 데이터 로드
    existing = {}
    if os.path.exists("public/data/stocks.json"):
        try:
            with open("public/data/stocks.json", "r") as f:
                existing = json.load(f)
        except:
            pass

    output = {
        "stocks":    existing.get("stocks", {}),
        "indices":   existing.get("indices", {}),
        "sectors":   existing.get("sectors", {}),
        "pool":      existing.get("pool", {}),
        "updatedAt": now_str,
        "mode":      MODE,
    }

    # ── 지수 수집 (항상) ────────────────────────────────
    print("🌐 지수 데이터 수집 중...")
    for ticker, info in INDICES.items():
        print(f"  {info['label']:10s} ({ticker}) ... ", end="", flush=True)
        raw = fetch_yahoo(ticker)
        if not raw:
            print("❌")
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
            print(f"✅ {price:>10.2f} ({changePct:+.2f}%)")
        except Exception as e:
            print(f"❌ {e}")
        time.sleep(0.5)

    if MODE == "daily":
        # ── DAILY: 전체 풀 수집 ─────────────────────────
        print("\n📦 전체 풀 수집 (코스피200 + 코스닥150 + S&P500)")

        pool = {}
        pool.update(get_kospi200())
        pool.update(get_kosdaq150())
        pool.update(get_sp500())

        if pool:
            print(f"\n총 {len(pool)}개 종목 데이터 수집 중...")
            # 전체 풀은 단기 데이터만 (1개월) - 시간 절약
            pool_data = collect_stocks(pool, now_str, range_="1mo", label="전체풀")
            output["pool"] = pool_data
            # 관심종목은 6개월 데이터
            watchlist = load_watchlist()
            watch_tickers = {k: pool.get(k, v) for k, v in watchlist.items()}
            if watch_tickers:
                print("\n⭐ 관심종목 6개월 데이터 수집 중...")
                watch_data = collect_stocks(watch_tickers, now_str, range_="6mo", label="관심종목")
                output["stocks"] = watch_data
        else:
            # KRX/Wikipedia 실패 시 기본 종목만
            watchlist = load_watchlist()
            output["stocks"] = collect_stocks(watchlist, now_str, label="기본종목")

    else:
        # ── HOURLY: 관심종목만 수집 ─────────────────────
        print("\n⭐ 관심종목 수집 중...")
        watchlist = load_watchlist()
        output["stocks"] = collect_stocks(watchlist, now_str, label="관심종목")

    # ── 저장 ─────────────────────────────────────────────
    path = "public/data/stocks.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(path) / 1024
    pool_count = len(output.get("pool", {}))
    stock_count = len(output.get("stocks", {}))
    print(f"\n✅ 완료: 관심종목 {stock_count}개 | 풀 {pool_count}개 | {size_kb:.1f}KB\n")

if __name__ == "__main__":
    main()
