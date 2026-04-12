#!/usr/bin/env python3
"""
APEX 데이터 수집 스크립트
사용법: pip install yfinance && python fetch_data.py
결과: public/data/stocks.json 생성
"""
import json, os, time
from datetime import datetime

try:
    import yfinance as yf
except ImportError:
    print("❌ yfinance 설치 필요: pip install yfinance")
    exit(1)

# ═══════════════════════════════════════════════════
# 설정: 여기에 보고 싶은 종목 추가
# ═══════════════════════════════════════════════════
WATCHLIST_KR = [
    "005930",  # 삼성전자
    "000660",  # SK하이닉스
    "373220",  # LG에너지솔루션
    "005380",  # 현대차
    "068270",  # 셀트리온
    "035420",  # NAVER
    "035720",  # 카카오
    "006400",  # 삼성SDI
    "051910",  # LG화학
    "012450",  # 한화에어로스페이스
]

WATCHLIST_US = [
    "NVDA", "AAPL", "TSLA", "MSFT", "AMZN",
    "GOOGL", "META", "AMD", "PLTR", "NFLX",
]

INDICES = ["^GSPC", "^IXIC", "^KS11", "^VIX", "KRW=X", "^TNX", "GC=F"]

SECTOR_ETFS = {
    "XLK": {"label": "기술", "market": "us"},
    "XLF": {"label": "금융", "market": "us"},
    "XLE": {"label": "에너지", "market": "us"},
    "XLV": {"label": "헬스케어", "market": "us"},
    "XLI": {"label": "산업재", "market": "us"},
    "XLY": {"label": "경기소비", "market": "us"},
    "XLP": {"label": "필수소비", "market": "us"},
    "XLU": {"label": "유틸리티", "market": "us"},
    "XLRE": {"label": "부동산", "market": "us"},
    "XLC": {"label": "통신", "market": "us"},
    "XLB": {"label": "소재", "market": "us"},
}

# ═══════════════════════════════════════════════════
# 수집 함수
# ═══════════════════════════════════════════════════
def safe_float(val, default=0):
    try: return float(val)
    except: return default

def fetch_index(ticker):
    try:
        t = yf.Ticker(ticker)
        hist = t.history(period="10d")
        if hist.empty: return None
        price = safe_float(hist['Close'].iloc[-1])
        prev = safe_float(hist['Close'].iloc[-2]) if len(hist) > 1 else price
        chg_pct = round((price - prev) / prev * 100, 2) if prev else 0
        chg3d = round((price - safe_float(hist['Close'].iloc[-4])) / safe_float(hist['Close'].iloc[-4]) * 100, 2) if len(hist) >= 4 else 0
        chg5d = round((price - safe_float(hist['Close'].iloc[-6])) / safe_float(hist['Close'].iloc[-6]) * 100, 2) if len(hist) >= 6 else 0
        return {"price": round(price, 2), "changePct": chg_pct, "chg3d": chg3d, "chg5d": chg5d}
    except Exception as e:
        print(f"  ⚠️ {ticker}: {e}")
        return None

def fetch_stock(ticker):
    suffixes = [".KS", ".KQ"] if (ticker.isdigit() and len(ticker) == 6) else [""]
    for suffix in suffixes:
        try:
            t = yf.Ticker(ticker + suffix)
            hist = t.history(period="6mo")
            if hist.empty: continue
            
            info = {}
            try: info = t.info or {}
            except: pass
            
            price = safe_float(hist['Close'].iloc[-1])
            if price <= 0: continue
            prev = safe_float(hist['Close'].iloc[-2]) if len(hist) > 1 else price
            
            # 캔들
            candles = []
            for idx, row in hist.iterrows():
                candles.append({
                    "date": f"{idx.month}/{idx.day}",
                    "high": round(safe_float(row['High']), 2),
                    "low": round(safe_float(row['Low']), 2),
                    "close": round(safe_float(row['Close']), 2),
                    "volume": int(safe_float(row['Volume'])),
                })
            
            chg3d = round((price - safe_float(hist['Close'].iloc[-4])) / safe_float(hist['Close'].iloc[-4]) * 100, 2) if len(hist) >= 4 else 0
            chg5d = round((price - safe_float(hist['Close'].iloc[-6])) / safe_float(hist['Close'].iloc[-6]) * 100, 2) if len(hist) >= 6 else 0
            
            vols = hist['Volume'].tail(20)
            vol_avg = safe_float(vols.mean())
            vol_ratio = round(safe_float(hist['Volume'].iloc[-1]) / vol_avg * 100) if vol_avg > 0 else 100
            
            is_kr = ticker.isdigit()
            mkt_cap = info.get("marketCap", 0) or 0
            
            return {
                "price": round(price, 2),
                "changePct": round((price - prev) / prev * 100, 2) if prev else 0,
                "chg3d": chg3d,
                "chg5d": chg5d,
                "volRatio": vol_ratio,
                "mktCap": round(mkt_cap / 1e8) if is_kr else round(mkt_cap / 1e9, 1),
                "candles": candles,
                "label": info.get("longName") or info.get("shortName") or ticker,
                "market": "kr" if is_kr else "us",
                "ticker": ticker,
            }
        except Exception as e:
            continue
    print(f"  ❌ {ticker}: 데이터 없음")
    return None

def fetch_sector(ticker, meta):
    try:
        t = yf.Ticker(ticker)
        hist = t.history(period="1mo")
        if hist.empty: return None
        price = safe_float(hist['Close'].iloc[-1])
        chg1d = round((price - safe_float(hist['Close'].iloc[-2])) / safe_float(hist['Close'].iloc[-2]) * 100, 2) if len(hist) >= 2 else 0
        chg1W = round((price - safe_float(hist['Close'].iloc[-6])) / safe_float(hist['Close'].iloc[-6]) * 100, 2) if len(hist) >= 6 else 0
        chg1M = round((price - safe_float(hist['Close'].iloc[0])) / safe_float(hist['Close'].iloc[0]) * 100, 2)
        return {**meta, "chg1W": chg1W, "chg1M": chg1M, "chg1d": chg1d}
    except:
        return None

# ═══════════════════════════════════════════════════
# 실행
# ═══════════════════════════════════════════════════
def main():
    print("=" * 50)
    print("✦ APEX 데이터 수집")
    print(f"  시각: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 50)
    
    # 1. 지수
    print("\n📊 지수 수집...")
    indices = {}
    for idx in INDICES:
        data = fetch_index(idx)
        if data:
            indices[idx] = data
            print(f"  ✅ {idx}: {data['price']}")
        time.sleep(0.3)
    
    # 2. 종목
    print(f"\n📈 종목 수집 ({len(WATCHLIST_KR)}+{len(WATCHLIST_US)}개)...")
    stocks = {}
    pool = {}
    for ticker in WATCHLIST_KR + WATCHLIST_US:
        data = fetch_stock(ticker)
        if data:
            stocks[ticker] = data
            pool[ticker] = {
                "label": data["label"],
                "market": data["market"],
                "price": data["price"],
                "changePct": data["changePct"],
            }
            is_kr = ticker.isdigit()
            print(f"  ✅ {ticker}: {data['label']} {'₩' if is_kr else '$'}{data['price']:,} ({len(data['candles'])}봉)")
        time.sleep(0.5)  # Yahoo 속도 제한 방지
    
    # 3. 섹터
    print("\n🏭 섹터 ETF 수집...")
    sectors = {}
    for etf, meta in SECTOR_ETFS.items():
        data = fetch_sector(etf, meta)
        if data:
            sectors[etf] = data
            print(f"  ✅ {etf}: {meta['label']} 1W={data['chg1W']:+.1f}%")
        time.sleep(0.3)
    
    # 4. 상승/하락 비율
    breadth = {}
    for mkt in ["kr", "us"]:
        items = {k: v for k, v in stocks.items() if (k.isdigit() if mkt == "kr" else not k.isdigit())}
        up = sum(1 for v in items.values() if v.get("changePct", 0) > 0)
        total = max(len(items), 1)
        breadth[mkt] = {"upPct": round(up / total * 100), "up": up, "down": total - up}
    
    # 5. JSON 저장
    result = {
        "updatedAt": datetime.now().isoformat(),
        "indices": indices,
        "sectors": sectors,
        "breadth": breadth,
        "stocks": stocks,
        "pool": pool,
    }
    
    out_dir = os.path.join("public", "data")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "stocks.json")
    
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    
    size_kb = os.path.getsize(out_path) / 1024
    print(f"\n{'=' * 50}")
    print(f"✅ 완료! {out_path}")
    print(f"   {len(stocks)}개 종목 · {len(indices)}개 지수 · {len(sectors)}개 섹터")
    print(f"   파일 크기: {size_kb:.0f}KB")
    print(f"{'=' * 50}")

if __name__ == "__main__":
    main()
