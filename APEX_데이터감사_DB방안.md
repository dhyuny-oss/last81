# ✦ APEX 데이터 감사 보고서 + DB 구축 방안

## 🔴 가짜 데이터 전수 조사

### 1. genCandles() — 랜덤 차트 생성 (가장 큰 문제)
**위치**: 99~107줄  
**동작**: `Math.random()`으로 180일치 가격을 만듦  
**영향**: stocks.json에 candles가 없는 모든 종목의 차트가 가짜  
```
사용처:
- 722줄: 시뮬 모드에서 모든 종목에 적용
- 732줄: 선택 종목에 candles 없을 때 적용
→ 차트, ST, MACD, RSI, 피보나치, ATR 등 모든 지표가 의미 없음
```

### 2. genIndexChart() — 가짜 지수 차트
**위치**: 481~492줄  
**동작**: 지수 가격 + 변동률로 역산해서 랜덤 차트 생성  
**영향**: 시장탭에서 지수 클릭 시 나오는 30일 차트가 가짜  
```
→ 실제 지수 캔들이 stocks.json에 없기 때문
```

### 3. SEARCH_DB — 하드코딩 시세 (고정값)
**위치**: 40~44줄  
```javascript
"GOOGL": { price:175.8, target:210, roe:29.4, per:22.1 ... }
"AMD":   { price:100.2, target:160, roe:4.2,  per:44.8 ... }
"AMZN":  { price:198.4, target:250, roe:21.6, per:42.1 ... }
```
**문제**: 가격이 코드 작성 시점의 값으로 고정  
**영향**: 검색 시 이 종목들은 항상 옛날 가격으로 표시  

### 4. idxRS fallback — 하드코딩 지수 변동률
**위치**: 1027~1029줄  
```javascript
spy:  { chg3d: ??-1.6, chg5d: ??-2.0 }   ← 진짜 데이터 없으면 이 값 사용
qqq:  { chg3d: ??-2.1, chg5d: ??-2.8 }
kospi:{ chg3d: ??+0.8, chg5d: ??-0.5 }
```
**문제**: 특정 날짜의 값이 영구적으로 박혀있음  
**영향**: RS강도, 알파점수, 시장기회점수 전부 왜곡  

### 5. fetchFromYahoo 하드코딩
**위치**: 870줄, 886줄  
```javascript
target: +(price*1.2)    ← 목표가를 현재가×1.2로 자동 설정
sector: "Technology"    ← 모든 종목을 기술주로 분류
vol: 0.02, drift: 0.001 ← 시뮬용 변동성 파라미터
```
**영향**: 야후에서 가져온 종목도 목표가/섹터가 가짜  

### 6. VIX fallback
**위치**: 1002줄  
```javascript
parseFloat(indicesData["^VIX"]?.price || 20)  ← VIX 기본 20
```
**영향**: 데이터 없으면 시장이 항상 "안정"으로 표시  

---

## 📊 현실 진단: 지금 뭐가 진짜고 뭐가 가짜?

| 항목 | stocks.json 있을 때 | 없을 때 (현재) |
|------|:---:|:---:|
| 지수 가격 | ✅ 실제 | ❌ 0 또는 기본값 |
| 지수 미니차트 | ❌ 항상 가짜 | ❌ 가짜 |
| 종목 가격 | ✅ 실제 | ❌ SEARCH_DB 고정값 |
| 종목 차트 (캔들) | ✅ 실제 | ❌ 랜덤 워크 |
| 기술 지표 (ST/MACD/RSI) | ✅ 실제 차트 기반 | ❌ 랜덤 기반 |
| RS 강도 | ✅ 실제 | ❌ 하드코딩 fallback |
| 거래량 비율 | ✅ 실제 | ❌ 기본 100% |
| 섹터 RS | ✅ 실제 | ❌ 빈 히트맵 |
| 시장기회점수 | ✅ 실제 | ❌ 가짜 기반 |
| 진입등급 | ✅ 실제 | ❌ 랜덤 기반 |
| 컨센서스 목표가 | ⚠️ AI API 의존 | ❌ price×1.2 |
| 피보나치 | ✅ 실제 차트 기반 | ❌ 랜덤 기반 |
| ATR 변동폭 | ✅ 실제 차트 기반 | ❌ 랜덤 기반 |

**결론: stocks.json에 실제 candles 데이터가 들어오면 대부분 해결됩니다.**

---

## 💾 DB 구축 방안 비교

### 방안 A: Supabase (추천 ⭐)
**비용**: 무료 (500MB, 50K 월 요청)  
**특징**: PostgreSQL 기반, REST API 자동 생성, 실시간 구독  

| 장점 | 단점 |
|------|------|
| 무료 500MB (3년치 일봉 충분) | 가입 필요 |
| SQL 쿼리 가능 | 초기 설정 약간 복잡 |
| 실시간 데이터 변경 감지 | |
| Dashboard에서 데이터 직접 확인 | |

**테이블 구조:**
```sql
-- 일봉 데이터 (핵심)
CREATE TABLE candles (
  id SERIAL,
  ticker TEXT,
  date DATE,
  open REAL, high REAL, low REAL, close REAL,
  volume BIGINT,
  PRIMARY KEY (ticker, date)
);

-- 일별 스냅샷
CREATE TABLE daily_snapshot (
  date DATE PRIMARY KEY,
  data JSONB  -- indices, sectors, breadth 전부
);

-- 내 매매 기록
CREATE TABLE trades (
  id SERIAL PRIMARY KEY,
  ticker TEXT, entry REAL, exit_price REAL,
  pnl REAL, entry_date DATE, exit_date DATE,
  signals TEXT[], reason TEXT
);
```

**데이터 규모 추정:**
```
종목 20개 × 일봉 252일 × 100 bytes = ~500KB/년
지수 7개 × 252일 × 50 bytes = ~90KB/년
3년 누적: ~2MB → 500MB 무료 한도 내 매우 여유
```

### 방안 B: Google Sheets (가장 쉬움)
**비용**: 완전 무료  
**특징**: 스프레드시트가 곧 DB, API 무료  

| 장점 | 단점 |
|------|------|
| 바로 사용 가능 | 속도 느림 (1-3초) |
| 엑셀처럼 직접 수정 가능 | 5MB 시트 제한 |
| Apps Script로 자동화 | 구조화 어려움 |

### 방안 C: Vercel + Blob Storage
**비용**: 무료 (Hobby plan)  
**특징**: 앱 호스팅 + 스토리지 통합  

| 장점 | 단점 |
|------|------|
| 프론트엔드와 한 곳에서 관리 | Blob 256MB 제한 |
| Serverless API 자동 | SQL 쿼리 불가 |
| Edge에서 빠른 응답 | |

### 방안 D: GitHub Actions + JSON 파일 (최소 설정)
**비용**: 완전 무료  
**특징**: 서버 없이 GitHub에 데이터 저장  

| 장점 | 단점 |
|------|------|
| 서버/DB 설정 0 | 과거 데이터 누적 어려움 |
| GitHub Pages로 바로 서빙 | 파일 커져면 느려짐 |
| 이미 만든 fetch_data.py 사용 | 실시간 조회 불가 |

---

## ⭐ 추천 조합: Supabase + GitHub Actions

```
[GitHub Actions] ──매일 16시──→ [yfinance로 수집] ──저장──→ [Supabase DB]
                                                              │
[APEX 앱] ──────────────────── 조회 ──────────────────────────┘
```

### 1단계: Supabase 설정 (10분)
1. supabase.com 가입 (GitHub 로그인)
2. New Project 생성
3. 위 SQL로 테이블 생성
4. API 키 복사 (Settings → API)

### 2단계: fetch_data.py 수정 (Supabase 저장)
```python
# pip install supabase
from supabase import create_client

SUPABASE_URL = "https://xxxx.supabase.co"
SUPABASE_KEY = "eyJhbG..."  # anon key

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def save_candle(ticker, date, high, low, close, volume):
    supabase.table("candles").upsert({
        "ticker": ticker,
        "date": str(date),
        "high": high, "low": low, "close": close,
        "volume": volume,
    }).execute()

def save_snapshot(data):
    supabase.table("daily_snapshot").upsert({
        "date": datetime.now().strftime("%Y-%m-%d"),
        "data": data,
    }).execute()
```

### 3단계: 앱에서 Supabase 직접 조회
```javascript
// App.jsx에서 직접 Supabase 호출
const SUPABASE_URL = "https://xxxx.supabase.co";
const SUPABASE_KEY = "eyJhbG..."; // anon key (공개 가능)

async function fetchCandles(ticker, days=180) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/candles?ticker=eq.${ticker}&order=date.desc&limit=${days}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  return (await res.json()).reverse();
}
```

### 4단계: stocks.json 제거 → DB에서 직접 로드
```javascript
// 기존: fetch("/data/stocks.json")
// 변경: fetch from Supabase
useEffect(() => {
  const loadFromDB = async () => {
    const snapshot = await fetch(`${SUPABASE_URL}/rest/v1/daily_snapshot?order=date.desc&limit=1`, ...);
    const data = await snapshot.json();
    if (data[0]) {
      setIndicesData(data[0].data.indices);
      setSectorsData(data[0].data.sectors);
      // ...
      setDataStatus("real");
    }
  };
  loadFromDB();
}, []);
```

---

## 💰 비용 비교

| 서비스 | 월 비용 | 저장 용량 | 요청 제한 |
|--------|---------|-----------|-----------|
| **Supabase** | $0 | 500MB | 50K/월 |
| **Google Sheets** | $0 | 5MB/시트 | 무제한 |
| **Vercel Hobby** | $0 | 256MB Blob | 무제한 |
| **GitHub Actions** | $0 | 1GB repo | 2000분/월 |
| **Neon (PostgreSQL)** | $0 | 512MB | 무제한 |
| **Railway** | $5/월 | 1GB | 무제한 |
| **Firebase** | $0 | 1GB | 50K/일 |

**개인 트레이딩 대시보드 기준 추천:**
- 1순위: **Supabase** (무료, SQL, 충분한 용량)
- 2순위: **GitHub Actions + JSON** (가장 간단, DB 없이)
- 3순위: **Vercel + KV** (앱과 통합)

---

## 🔧 실행 계획 (우선순위)

### 즉시 (1단계)
- [ ] `fetch_data.py` 로컬 실행 → stocks.json 생성 → 차트 실데이터 확인
- [ ] SEARCH_DB 하드코딩 제거 or 빈 객체로 변경
- [ ] idxRS fallback 값을 0으로 변경

### 이번 주 (2단계)
- [ ] Supabase 프로젝트 생성
- [ ] fetch_data.py → Supabase 저장 연동
- [ ] GitHub Actions daily.yml 설정

### 다음 주 (3단계)
- [ ] App.jsx → Supabase에서 직접 로드
- [ ] genCandles() 제거 (실데이터 필수화)
- [ ] 실험실 탭 추가 (실데이터 기반 학습)
- [ ] 지수 캔들도 DB에 저장 → 진짜 미니차트

---

*데이터가 진짜가 되면, APEX의 모든 기능이 비로소 의미를 갖습니다.*
