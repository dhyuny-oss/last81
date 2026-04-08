#!/usr/bin/env python3
"""
Alpha Terminal — Yahoo Finance 데이터 수집 스크립트
GitHub Actions에서 매 시간 자동 실행됩니다.
"""

import json, os, time, sys
from datetime import datetime, timezone
import requests

# ── 수집할 종목 목록 ─────────────────────────────────────────
# suffix: 한국 코스피 = .KS, 코스닥 = .KQ, 미국 = 없음
STOCKS = {
    # 미국 주식
    "NVDA":  {"label":"NVIDIA",     "sector":"Semiconductor","market":"us","mktCap":2750,"roe":91.4,"per":28.1,"revGrowth":122,"liquidity":8.2,"target":170},
    "AAPL":  {"label":"Apple",      "sector":"Technology",   "market":"us","mktCap":2950,"roe":160.1,"per":29.1,"revGrowth":5,  "liquidity":3.1,"target":240},
    "TSLA":  {"label":"Tesla",      "sector":"Auto",         "market":"us","mktCap":775, "roe":18.3, "per":52.4,"revGrowth":1,  "liquidity":12.4,"target":300},
    "MSFT":  {"label":"Microsoft",  "sector":"Technology",   "market":"us","mktCap":2890,"roe":38.5, "per":34.1,"revGrowth":15, "liquidity":2.8,"target":500},
    "META":  {"label":"Meta",       "sector":"Technology",   "market":"us","mktCap":1450,"roe":32.1, "per":26.3,"revGrowth":21, "liquidity":4.2,"target":700},
    "GOOGL": {"label":"Google",     "sector":"Technology",   "market":"us","mktCap":2190,"roe":29.4, "per":22.1,"revGrowth":15, "liquidity":3.2,"target":210},
    "AMD":   {"label":"AMD",        "sector":"Semiconductor","market":"us","mktCap":163, "roe":4.2,  "per":44.8,"revGrowth":14, "liquidity":6.8,"target":160},
    "AMZN":  {"label":"Amazon",     "sector":"Consumer",     "market":"us","mktCap":2110,"roe":21.6, "per":42.1,"revGrowth":12, "liquidity":2.9,"target":250},
    # 한국 주식
    "005930":{"label":"삼성전자",   "sector":"Semiconductor","market":"kr","suffix":".KS","mktCap":332,"roe":8.7, "per":14.2,"revGrowth":63,"liquidity":1.8,"target":75000},
    "000660":{"label":"SK하이닉스","sector":"Semiconductor","market":"kr","suffix":".KS","mktCap":133,"roe":22.4,"per":10.1,"revGrowth":89,"liquidity":2.4,"target":240000},
    "005380":{"label":"현대차",     "sector":"Auto",         "market":"kr","suffix":".KS","mktCap":43, "roe":14.2,"per":5.8, "revGrowth":8, "liquidity":0.9,"target":280000},
    "035420":{"label":"NAVER",      "sector":"Technology",   "market":"kr","suffix":".KS","mktCap":33, "roe":8.9, "per":21.4,"revGrowth":12,"liquidity":1.2,"target":260000},
    "035720":{"label":"카카오",     "sector":"Technology",   "market":"kr","suffix":".KQ","mktCap":19, "roe":3.2, "per":38.7,"revGrowth":-4,"liquidity":2.1,"target":58000},
}

# ── 지수 목록 ─────────────────────────────────────────────────
INDICES = {
    "SPY":   {"label":"S&P 500",  "market":"us"},
    "QQQ":   {"label":"NASDAQ",   "market":"us"},
    "^KS11": {"label":"KOSPI",    "market":"kr"},
    "^KQ11": {"label":"KOSDAQ",   "market":"kr"},
    "^N225": {"label":"닛케이",    "market":"jp"},
    "^SSEC": {"label":"상해종합",  "market":"cn"},
    "^VIX":  {"label":"VIX",      "market":"us"},
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

def fetch_yahoo(ticker):
    """야후 파이낸스에서 6개월 일봉 데이터 가져오기 (3회 재시도)"""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=6mo"
    for attempt in range(3):
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            if r.status_code == 200:
                data = r.json()
                if data.get("chart", {}).get("result"):
                    return data
            print(f"    HTTP {r.status_code}, 재시도 {attempt+1}/3")
        except Exception as e:
            print(f"    오류: {e}, 재시도 {attempt+1}/3")
        time.sleep(2)
    return None

def parse_candles(raw):
    """야후 응답을 캔들 배열로 변환"""
    result = raw["chart"]["result"][0]
    ts = result.get("timestamp", [])
    q  = result["indicators"]["quote"][0]
    meta = result["meta"]

    candles = []
    for i, t in enumerate(ts):
        close = q["close"][i]
        if close is None or close <= 0:
            continue
        d = datetime.fromtimestamp(t, tz=timezone.utc)
        candles.append({
            "date":   f"{d.month}/{d.day}",
            "close":  round(float(close), 3),
            "high":   round(float(q["high"][i]   or close), 3),
            "low":    round(float(q["low"][i]    or close), 3),
            "volume": int(q["volume"][i] or 0),
        })
    return candles, meta

def calc_change(candles, n):
    """n일 전 대비 등락률"""
    if len(candles) <= n:
        return 0.0
    old = candles[-(n+1)]["close"]
    new = candles[-1]["close"]
    return round((new - old) / old * 100, 2) if old else 0.0

def main():
    now_str = datetime.now(timezone.utc).isoformat()
    print(f"\n=== Alpha Terminal 데이터 수집 시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ===\n")

    output = {
        "stocks":    {},
        "indices":   {},
        "updatedAt": now_str,
    }

    # ── 종목 수집 ──────────────────────────────────────────────
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
                "ticker":    ticker,
                "price":     price,
                "change":    change,
                "changePct": changePct,
                "chg3d":     calc_change(candles, 3),
                "chg5d":     calc_change(candles, 5),
                "candles":   candles,
                "updatedAt": now_str,
            })
            output["stocks"][ticker] = stock_out
            print(f"✅  {price:>10.2f}  ({changePct:+.2f}%)")
            success += 1
        except Exception as e:
            print(f"❌ 파싱 오류: {e}")

        time.sleep(0.7)

    # ── 지수 수집 ──────────────────────────────────────────────
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
                **info,
                "ticker":    ticker,
                "price":     price,
                "changePct": changePct,
                "chg3d":     calc_change(candles, 3),
                "chg5d":     calc_change(candles, 5),
                "spark":     [c["close"] for c in candles[-30:]],  # 스파크라인 30일
            }
            print(f"✅  {price:>10.2f}  ({changePct:+.2f}%)")
        except Exception as e:
            print(f"❌ 파싱 오류: {e}")
        time.sleep(0.7)

    # ── 저장 ───────────────────────────────────────────────────
    os.makedirs("public/data", exist_ok=True)
    path = "public/data/stocks.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(path) / 1024
    print(f"\n✅ 완료: {success}/{len(STOCKS)}개 종목 | {len(output['indices'])}개 지수")
    print(f"   저장: {path} ({size_kb:.1f} KB)")
    print(f"   시각: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

if __name__ == "__main__":
    main()
