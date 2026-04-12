# ✦ APEX — 데이터 파이프라인 가이드

## 현재 상태 진단

### 앱이 사용하는 데이터 소스

| 엔드포인트 | 용도 | 현재 상태 |
|-----------|------|----------|
| `/data/stocks.json` | 전체 시세/지수/섹터/종목풀 | ❌ 파일 없으면 시뮬 모드 |
| `/api/search?q=` | 종목 검색 | ❌ 서버 없으면 로컬 DB 폴백 |
| `/api/quote?ticker=` | 개별 시세 | ❌ 서버 없으면 Yahoo 폴백 |
| `/api/candles?ticker=` | 개별 캔들 | ❌ 서버 없으면 Yahoo 폴백 |
| `/api/analyze` | AI 분석 | ❌ 서버 없으면 에러 (무해) |
| `/api/watchlist` | 관심종목 저장 | ❌ 서버 없으면 에러 (무해) |
| `corsproxy.io` → Yahoo | 개별 종목 폴백 | ⚠️ CORS 프록시 의존 (불안정) |

### 핵심 문제
**`/data/stocks.json`이 없으면 모든 것이 가짜입니다.**
- 차트: 랜덤 워크 (`genCandles`)
- 지수: 전부 0 또는 기본값
- 섹터: 빈 히트맵
- 점수: 의미 없는 숫자

---

## stocks.json 필요 구조

```json
{
  "updatedAt": "2025-04-13T15:30:00+09:00",
  
  "indices": {
    "^GSPC":  { "price": 5234.18, "changePct": -0.52, "chg3d": -1.6, "chg5d": -2.0 },
    "^IXIC":  { "price": 16312.45, "changePct": -0.71, "chg3d": -2.1, "chg5d": -2.8 },
    "^KS11":  { "price": 2487.35, "changePct": 0.85, "chg3d": 0.8, "chg5d": -0.5 },
    "^VIX":   { "price": 18.45, "changePct": -3.2 },
    "KRW=X":  { "price": 1365.20, "changePct": 0.15 },
    "^TNX":   { "price": 4.32, "changePct": -0.8 },
    "GC=F":   { "price": 2338.50, "changePct": 0.3 }
  },

  "sectors": {
    "XLK": { "label": "기술", "market": "us", "chg1W": 2.3, "chg1M": 5.1, "chg1d": 0.4, "members": ["AAPL","MSFT","NVDA"] },
    "XLF": { "label": "금융", "market": "us", "chg1W": -0.5, "chg1M": 1.2, "chg1d": -0.2, "members": ["JPM","BAC"] },
    "091160": { "label": "반도체", "market": "kr", "chg1W": 1.8, "chg1M": 4.2, "chg1d": 0.9, "members": ["005930","000660"] }
  },

  "breadth": {
    "kr": { "upPct": 58, "up": 520, "down": 380 },
    "us": { "upPct": 45, "up": 1800, "down": 2200 }
  },

  "stocks": {
    "005930": {
      "price": 72400,
      "changePct": 1.2,
      "chg3d": 2.5,
      "chg5d": 3.1,
      "volRatio": 145,
      "mktCap": 432000,
      "candles": [
        { "date": "3/1", "high": 71500, "low": 70200, "close": 71000, "volume": 12500000 },
        { "date": "3/2", "high": 72000, "low": 70800, "close": 71800, "volume": 15200000 }
      ]
    },
    "NVDA": {
      "price": 875.30,
      "changePct": -0.8,
      "chg3d": -2.1,
      "chg5d": 1.5,
      "volRatio": 112,
      "mktCap": 2150,
      "candles": [...]
    }
  },

  "pool": {
    "005930": { "label": "삼성전자", "market": "kr", "price": 72400, "changePct": 1.2, "rsPctRank": 75 },
    "NVDA":   { "label": "NVIDIA",  "market": "us", "price": 875.3, "changePct": -0.8, "rsPctRank": 92 }
  }
}
```

### 캔들 데이터 최소 요구량
- **차트 렌더링**: 최소 30개 (1.5개월)
- **지표 정확도**: 100개 이상 권장 (5개월)
- **MA200 표시**: 200개 필요 (약 10개월)
- **52주 판단**: 252개 필요 (1년)

---

## 방법 1: GitHub Actions + yfinance (권장)

### 장점
- 무료, 서버 불필요
- 매일 자동 실행
- GitHub Pages로 바로 호스팅

### 구조
```
repo/
├── .github/workflows/daily.yml    ← 크론잡
├── scripts/
│   └── fetch_data.py              ← 데이터 수집 스크립트
├── public/
│   └── data/
│       └── stocks.json            ← 생성된 데이터
└── src/
    └── App.jsx
```

### daily.yml 예시
```yaml
name: Daily Data Update
on:
  schedule:
    - cron: '0 7 * * 1-5'  # UTC 7시 = KST 16시 (장마감 후)
  workflow_dispatch:          # 수동 실행 가능

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install yfinance pandas
      - run: python scripts/fetch_data.py
      - run: |
          git config user.name "github-actions"
          git config user.email "actions@github.com"
          git add public/data/stocks.json
          git commit -m "📊 데이터 업데이트 $(date +%Y-%m-%d)" || true
          git push
```

### fetch_data.py 핵심 구조
```python
import yfinance as yf
import json
from datetime import datetime, timedelta

# ── 1. 지수 데이터 ─────────────────────────────
INDICES = {
    "^GSPC": "S&P 500",
    "^IXIC": "NASDAQ",
    "^KS11": "KOSPI",
    "^VIX": "VIX",
    "KRW=X": "USD/KRW",
    "^TNX": "US 10Y",
    "GC=F": "Gold",
}

def fetch_index(ticker):
    t = yf.Ticker(ticker)
    hist = t.history(period="10d")
    if hist.empty:
        return None
    price = float(hist['Close'].iloc[-1])
    prev = float(hist['Close'].iloc[-2]) if len(hist) > 1 else price
    chg_pct = round((price - prev) / prev * 100, 2)
    
    # 3일, 5일 변동률
    chg3d = round((price - float(hist['Close'].iloc[-4])) / float(hist['Close'].iloc[-4]) * 100, 2) if len(hist) >= 4 else 0
    chg5d = round((price - float(hist['Close'].iloc[-6])) / float(hist['Close'].iloc[-6]) * 100, 2) if len(hist) >= 6 else 0
    
    return {"price": round(price, 2), "changePct": chg_pct, "chg3d": chg3d, "chg5d": chg5d}

# ── 2. 종목 데이터 + 캔들 ──────────────────────
WATCHLIST_KR = ["005930", "000660", "373220", "005380", "068270"]
WATCHLIST_US = ["NVDA", "AAPL", "TSLA", "MSFT", "AMZN", "GOOGL", "META", "AMD"]

def fetch_stock(ticker):
    suffix = ".KS" if ticker.isdigit() and len(ticker) == 6 else ""
    t = yf.Ticker(ticker + suffix)
    
    # 6개월 일봉 (지표 계산용 충분한 데이터)
    hist = t.history(period="6mo")
    if hist.empty:
        # 코스닥이면 .KQ 시도
        if suffix == ".KS":
            t = yf.Ticker(ticker + ".KQ")
            hist = t.history(period="6mo")
        if hist.empty:
            return None
    
    info = t.info or {}
    price = float(hist['Close'].iloc[-1])
    prev = float(hist['Close'].iloc[-2]) if len(hist) > 1 else price
    
    # 캔들 데이터
    candles = []
    for idx, row in hist.iterrows():
        candles.append({
            "date": f"{idx.month}/{idx.day}",
            "high": round(float(row['High']), 2),
            "low": round(float(row['Low']), 2),
            "close": round(float(row['Close']), 2),
            "volume": int(row['Volume']),
        })
    
    # 3일, 5일 변동률
    chg3d = round((price - float(hist['Close'].iloc[-4])) / float(hist['Close'].iloc[-4]) * 100, 2) if len(hist) >= 4 else 0
    chg5d = round((price - float(hist['Close'].iloc[-6])) / float(hist['Close'].iloc[-6]) * 100, 2) if len(hist) >= 6 else 0
    
    # 거래량 비율 (20일 평균 대비)
    vols = hist['Volume'].tail(20)
    vol_ratio = round(float(hist['Volume'].iloc[-1]) / float(vols.mean()) * 100) if vols.mean() > 0 else 100
    
    return {
        "price": round(price, 2),
        "changePct": round((price - prev) / prev * 100, 2),
        "chg3d": chg3d,
        "chg5d": chg5d,
        "volRatio": vol_ratio,
        "mktCap": round(info.get("marketCap", 0) / 1e8) if ticker.isdigit() else round(info.get("marketCap", 0) / 1e9, 1),
        "candles": candles,
        "label": info.get("longName") or info.get("shortName") or ticker,
        "market": "kr" if ticker.isdigit() else "us",
    }

# ── 3. 섹터 ETF ────────────────────────────────
SECTOR_ETFS = {
    "XLK": {"label": "기술", "market": "us"},
    "XLF": {"label": "금융", "market": "us"},
    "XLE": {"label": "에너지", "market": "us"},
    "XLV": {"label": "헬스케어", "market": "us"},
    "XLI": {"label": "산업재", "market": "us"},
    "XLY": {"label": "경기소비", "market": "us"},
    "XLP": {"label": "필수소비", "market": "us"},
    "XLU": {"label": "유틸리티", "market": "us"},
}

def fetch_sector(ticker, info):
    t = yf.Ticker(ticker)
    hist = t.history(period="1mo")
    if hist.empty:
        return None
    price = float(hist['Close'].iloc[-1])
    chg1W = round((price - float(hist['Close'].iloc[-6])) / float(hist['Close'].iloc[-6]) * 100, 2) if len(hist) >= 6 else 0
    chg1M = round((price - float(hist['Close'].iloc[0])) / float(hist['Close'].iloc[0]) * 100, 2)
    chg1d = round((price - float(hist['Close'].iloc[-2])) / float(hist['Close'].iloc[-2]) * 100, 2) if len(hist) >= 2 else 0
    return {**info, "chg1W": chg1W, "chg1M": chg1M, "chg1d": chg1d}

# ── 4. 상승/하락 비율 (간이 계산) ───────────────
def calc_breadth(stocks_data, market):
    items = {k: v for k, v in stocks_data.items() if (k.isdigit() if market == "kr" else not k.isdigit())}
    up = sum(1 for v in items.values() if v.get("changePct", 0) > 0)
    down = len(items) - up
    return {"upPct": round(up / max(len(items), 1) * 100), "up": up, "down": down}

# ── 5. 실행 ─────────────────────────────────────
def main():
    print("📊 APEX 데이터 수집 시작...")
    
    # 지수
    indices = {}
    for ticker in INDICES:
        data = fetch_index(ticker)
        if data:
            indices[ticker] = data
            print(f"  ✅ {ticker}: {data['price']}")
    
    # 종목
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
            print(f"  ✅ {ticker}: {data['label']} ₩{data['price']}")
    
    # 섹터
    sectors = {}
    for ticker, info in SECTOR_ETFS.items():
        data = fetch_sector(ticker, info)
        if data:
            sectors[ticker] = data
    
    # 상승/하락
    breadth = {
        "kr": calc_breadth(stocks, "kr"),
        "us": calc_breadth(stocks, "us"),
    }
    
    # JSON 저장
    result = {
        "updatedAt": datetime.now().isoformat(),
        "indices": indices,
        "sectors": sectors,
        "breadth": breadth,
        "stocks": stocks,
        "pool": pool,
    }
    
    with open("public/data/stocks.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ 완료! {len(stocks)}개 종목, {len(indices)}개 지수 저장")

if __name__ == "__main__":
    main()
```

### 사용법
```bash
# 로컬 테스트
pip install yfinance pandas
python scripts/fetch_data.py

# GitHub Actions 수동 실행
# → repo > Actions > Daily Data Update > Run workflow
```

---

## 방법 2: Vercel API Routes (실시간 검색용)

종목 검색 시 실시간으로 데이터를 가져오는 서버리스 함수.

### api/quote.js
```javascript
import yahooFinance from 'yahoo-finance2';

export default async function handler(req, res) {
  const { ticker } = req.query;
  const suffix = /^\d{6}$/.test(ticker) ? '.KS' : '';
  
  try {
    const quote = await yahooFinance.quote(ticker + suffix);
    res.json({
      ticker,
      label: quote.longName || quote.shortName || ticker,
      price: quote.regularMarketPrice,
      changePct: quote.regularMarketChangePercent?.toFixed(2),
      market: /^\d{6}$/.test(ticker) ? '🇰🇷' : '🇺🇸',
      mktCap: quote.marketCap,
    });
  } catch {
    // 코스닥 시도
    if (suffix === '.KS') {
      try {
        const quote = await yahooFinance.quote(ticker + '.KQ');
        res.json({ /* same as above */ });
      } catch { res.json({ error: '조회 실패' }); }
    } else {
      res.json({ error: '조회 실패' });
    }
  }
}
```

---

## 방법 3: 지금 당장 실데이터 보는 법

GitHub Actions 설정 없이 **로컬에서 바로** 테스트:

```bash
# 1. Python 스크립트 실행
pip install yfinance
python scripts/fetch_data.py

# 2. 생성된 stocks.json 확인
cat public/data/stocks.json | head -50

# 3. 개발 서버 실행
npm run dev
# → 브라우저에서 🟢 실시간 표시 확인
```

---

## 관리할 종목 리스트

`fetch_data.py`의 `WATCHLIST_KR`와 `WATCHLIST_US`에 추가:

```python
# 내가 보는 한국 종목
WATCHLIST_KR = [
    "005930",  # 삼성전자
    "000660",  # SK하이닉스
    "373220",  # LG에너지솔루션
    "005380",  # 현대차
    "068270",  # 셀트리온
    "035420",  # NAVER
    "035720",  # 카카오
    # ... 추가
]

# 내가 보는 미국 종목
WATCHLIST_US = [
    "NVDA", "AAPL", "TSLA", "MSFT", "AMZN",
    "GOOGL", "META", "AMD", "PLTR", "NFLX",
    # ... 추가
]
```

앱에서 검색으로 추가한 종목은 localStorage에만 저장되므로,
**자주 보는 종목은 여기에 넣어야** 매일 자동으로 데이터가 갱신됩니다.

---

## 데이터 갱신 주기 권장

| 데이터 | 주기 | 방법 |
|--------|------|------|
| stocks.json (전체) | 매일 16시 (KST) | GitHub Actions cron |
| 개별 종목 조회 | 실시간 | Vercel API 또는 Yahoo 폴백 |
| 섹터 RS | 매일 | stocks.json에 포함 |
| 상승/하락 비율 | 매일 | stocks.json에 포함 |

---

## 체크리스트: 실데이터 전환

- [ ] `scripts/fetch_data.py` 생성
- [ ] 로컬에서 `python fetch_data.py` 실행 → `stocks.json` 생성 확인
- [ ] 앱에서 🟢 실시간 표시 확인
- [ ] 차트에 "실시간" 뱃지 확인 (시뮬 아님)
- [ ] GitHub Actions `daily.yml` 설정
- [ ] 수동 Run workflow → 자동 커밋 확인
- [ ] (선택) Vercel API routes 설정

---

## ⚠️ yfinance 주의사항

- **무료이지만 비공식 API** — Yahoo가 차단할 수 있음
- **요청 속도 제한** — 종목 50개 이상이면 `time.sleep(0.5)` 추가
- **한국 종목**: `.KS` (코스피) 또는 `.KQ` (코스닥) 접미사 필요
- **장 중에는 15분 지연** — 장 마감 후 실행 권장
- **대안**: `financedatareader` (한국), `Alpha Vantage` (API key 필요)

---

*이 파일대로 설정하면 APEX의 모든 차트, 지표, 점수가 실제 시장 데이터 기반으로 동작합니다.*
