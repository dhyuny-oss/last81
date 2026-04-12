#!/usr/bin/env python3
"""
Alpha Terminal — Yahoo Finance 데이터 수집
- hourly 모드 (평일 매 시간): 관심종목 현재가만
- daily  모드 (평일 오후 6시): 전체 풀 + 알파스캔
- quarterly 모드 (수동): 재무데이터 수집
"""

import json, os, time, requests, sys
from datetime import datetime, timezone

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
MODE = os.environ.get("COLLECT_MODE", "hourly")

# ── 글로벌 지수 ───────────────────────────────────────────
INDICES = {
    "^GSPC":  {"label":"S&P 500",    "market":"us", "type":"index"},
    "^IXIC":  {"label":"NASDAQ",     "market":"us", "type":"index"},
    "^KS11":  {"label":"KOSPI",      "market":"kr", "type":"index"},
    "^VIX":   {"label":"VIX",        "market":"us", "type":"fear"},
    "KRW=X":  {"label":"USD/KRW",    "market":"fx",  "type":"fx"},
    "^TNX":   {"label":"미국10Y금리","market":"us", "type":"rate"},
    "GC=F":   {"label":"금",         "market":"us", "type":"commodity"},
    "CL=F":   {"label":"유가",       "market":"us", "type":"commodity"},
}

# 미국 섹터 ETF
US_SECTOR_ETFS = {
    "XLK":  {"label":"IT",      "members":["AAPL","MSFT","NVDA","AVGO","CRM"]},
    "XLF":  {"label":"금융",    "members":["JPM","BAC","WFC","GS","MS"]},
    "XLE":  {"label":"에너지",  "members":["XOM","CVX","COP","EOG","SLB"]},
    "XLV":  {"label":"헬스케어","members":["JNJ","UNH","LLY","ABBV","MRK"]},
    "XLY":  {"label":"소비재",  "members":["AMZN","TSLA","HD","MCD","NKE"]},
    "XLP":  {"label":"필수소비","members":["PG","KO","PEP","WMT","COST"]},
    "XLI":  {"label":"산업재",  "members":["GE","HON","CAT","UPS","RTX"]},
    "XLB":  {"label":"소재",    "members":["LIN","APD","SHW","FCX","NEM"]},
    "SOXX": {"label":"반도체",  "members":["NVDA","AMD","INTC","AVGO","QCOM"]},
    "XBI":  {"label":"바이오",  "members":["MRNA","BNTX","REGN","VRTX","GILD"]},
}

# 한국 섹터 ETF
KR_SECTOR_ETFS = {
    "091160.KS": {"label":"반도체",  "members":["005930","000660","000990","058470"]},
    "305720.KS": {"label":"2차전지", "members":["006400","051910","373220","247540"]},
    "244580.KS": {"label":"바이오",  "members":["068270","207940","326030","091990"]},
    "091170.KS": {"label":"금융",    "members":["105560","055550","086790","316140"]},
    "091180.KS": {"label":"자동차",  "members":["005380","000270","012330","011210"]},
    "266360.KS": {"label":"IT",      "members":["035420","035720","259960","263750"]},
    "138230.KS": {"label":"철강",    "members":["005490","004020","010060","002220"]},
    "034830.KS": {"label":"건설",    "members":["000720","010140","047040","000210"]},
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

# ── 레이트 리밋 추적 ──────────────────────────────────────
_request_count = 0
_rate_limit_hits = 0

def fetch_yahoo(ticker, range_="6mo", interval="1d"):
    """야후 파이낸스 API 요청 (재시도 + 레이트리밋 보호)"""
    global _request_count, _rate_limit_hits
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval={interval}&range={range_}"
    for attempt in range(3):
        try:
            _request_count += 1
            r = requests.get(url, headers=HEADERS, timeout=20)
            if r.status_code == 200:
                d = r.json()
                if d.get("chart", {}).get("result"):
                    return d
            elif r.status_code in (429, 403):
                _rate_limit_hits += 1
                wait = min(30, 5 * (attempt + 1) * (_rate_limit_hits // 5 + 1))
                print(f"    ⚠ 레이트리밋 (누적 {_rate_limit_hits}회) — {wait}초 대기")
                time.sleep(wait)
                continue
            elif r.status_code >= 500:
                time.sleep(3)
                continue
        except requests.exceptions.Timeout:
            print(f"    ⏱ 타임아웃")
            time.sleep(2)
        except Exception as e:
            print(f"    오류: {e}")
            time.sleep(2)
    return None

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

def calc_vol_ratio(candles):
    vols = [c["volume"] for c in candles if c.get("volume", 0) > 0]
    if len(vols) < 5:
        return 100
    avg5  = sum(vols[-5:]) / 5
    avg20 = sum(vols[-20:]) / min(len(vols), 20)
    return round(avg5 / avg20 * 100, 1) if avg20 > 0 else 100

# ── 알파 스캔 ─────────────────────────────────────────────
def alpha_scan(ticker, info, candles):
    if len(candles) < 20:
        return None

    closes  = [c["close"] for c in candles]
    volumes = [c["volume"] for c in candles]

    ema3  = calc_ema(closes, 3)
    ema10 = calc_ema(closes, 10)

    last_close = closes[-1]
    score = 0
    signals = []

    # ① 골든크로스
    if ema3[-1] and ema10[-1] and ema3[-3] and ema10[-3]:
        if ema3[-1] > ema10[-1] and ema3[-3] <= ema10[-3]:
            score += 25
            signals.append("골든크로스")
        elif ema3[-1] > ema10[-1]:
            score += 10

    # ② 거래량 급증
    if len(volumes) >= 20:
        vol5  = sum(volumes[-5:])  / 5
        vol20 = sum(volumes[-20:]) / 20
        if vol20 > 0 and vol5 > vol20 * 1.5:
            score += 20
            signals.append("거래량급증")

    # ③ 52주 고점 근접 + VCP
    w52h = max(closes)
    if last_close >= w52h * 0.85:
        vol_early  = sum(volumes[-20:-15]) / 5 if len(volumes) >= 20 else 0
        vol_recent = sum(volumes[-5:]) / 5
        if vol_early > 0 and vol_recent < vol_early * 0.7:
            score += 20
            signals.append("VCP")

    # ④ 등락
    chg3 = calc_change(candles, 3)
    chg5 = calc_change(candles, 5)
    if chg3 > 2: score += 10
    if chg5 > 3: score += 10

    # ⑤ RS 상위 (풀에서 전달받은 rsPctRank)
    rs_pct = info.get("rsPctRank", 50)
    if rs_pct >= 90: score += 25; signals.append("RS상위10%")
    elif rs_pct >= 80: score += 15; signals.append("RS상위20%")
    elif rs_pct >= 60: score += 5

    # ⑥ 52주 신고가 돌파
    if info.get("w52Breakout"):
        score += 20
        signals.append("신고가돌파")
    elif last_close >= max(closes) * 0.95:
        score += 5
        signals.append("신고가근접")

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
        "changePct": calc_change(candles, 1),
    }

# ── 종목 목록 수집 ─────────────────────────────────────────
def get_krx_volume_top(n=300):
    """KRX 거래대금 상위 종목 (코스피+코스닥, 추세추종용)"""
    print(f"  KRX 거래대금 상위 {n}개...")
    stocks = {}
    for market_id, market_name in [("STK","코스피"), ("KSQ","코스닥")]:
        try:
            r = requests.post(
                "https://www.krx.co.kr/comm/bldAttendant/getJsonData.cmd",
                data={"bld":"dbms/MDC/STAT/standard/MDCSTAT01501","locale":"ko_KR",
                      "mktId":market_id,"trdDd":datetime.now().strftime("%Y%m%d"),
                      "share":"1","money":"1","csvxls_isNo":"false"},
                headers={**HEADERS,"Referer":"https://www.krx.co.kr/"}, timeout=15
            )
            items = r.json().get("OutBlock_1", [])
            # 거래대금 기준 정렬 (ACC_TRDVAL = 거래대금)
            for item in items:
                try:
                    val = int(str(item.get("ACC_TRDVAL","0")).replace(",","") or "0")
                    item["_val"] = val
                except:
                    item["_val"] = 0
            items.sort(key=lambda x: x["_val"], reverse=True)

            count = 0
            for item in items:
                if count >= (n * 2 // 3 if market_id == "STK" else n // 3):
                    break
                t = item.get("ISU_SRT_CD","").zfill(6)
                name = item.get("ISU_ABBRV","")
                if not t or not name:
                    continue
                # 시총 너무 작은 것 제외 (거래대금 1억 미만)
                if item["_val"] < 100000000:
                    continue
                suffix = ".KS" if market_id == "STK" else ".KQ"
                stocks[t] = {"label":name,"sector":"Korean","market":"kr","suffix":suffix}
                count += 1
            print(f"    ✅ {market_name}: {count}개")
        except Exception as e:
            print(f"    ❌ {market_name}: {e}")

    # 폴백: 실패 시 코스피200 방식
    if len(stocks) < 50:
        print("    ⚠ 거래대금 조회 실패 — 코스피200 폴백")
        try:
            r = requests.post(
                "https://www.krx.co.kr/comm/bldAttendant/getJsonData.cmd",
                data={"bld":"dbms/MDC/STAT/standard/MDCSTAT00601","locale":"ko_KR",
                      "idxIndMidclssCd":"02","trdDd":datetime.now().strftime("%Y%m%d"),
                      "share":"1","money":"1","csvxls_isNo":"false"},
                headers={**HEADERS,"Referer":"https://www.krx.co.kr/"}, timeout=15
            )
            for item in r.json().get("OutBlock_1", []):
                t = item.get("ISU_SRT_CD","").zfill(6)
                name = item.get("ISU_ABBRV","")
                if t and name:
                    stocks[t] = {"label":name,"sector":"Korean","market":"kr","suffix":".KS"}
        except:
            pass

    print(f"    📊 한국 총 {len(stocks)}개")
    return stocks

def get_us_stocks():
    """S&P 500 + 나스닥 주요종목 수집 (Wikipedia)"""
    print("  Wikipedia S&P500...")
    stocks = {}
    try:
        import re
        r = requests.get(
            "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
            headers=HEADERS, timeout=15
        )
        # 테이블 파싱 — 여러 패턴 시도
        patterns = [
            r'<td[^>]*><a[^>]+title="[^"]*"[^>]*>([A-Z.]{1,6})</a></td>\s*<td[^>]*><a[^>]+>([^<]+)</a>',
            r'<tr>\s*<td[^>]*><a[^>]+>([A-Z.]{1,6})</a></td>\s*<td[^>]*><a[^>]+>([^<]+)</a>',
            r'<td[^>]*>([A-Z.]{1,6})</td>\s*<td[^>]*>([^<]+)</td>',
        ]
        for pat in patterns:
            rows = re.findall(pat, r.text)
            if len(rows) > 100:
                break

        for ticker, name in rows[:520]:
            ticker = ticker.replace(".", "-").strip()
            if len(ticker) <= 6 and ticker.replace("-","").isalpha():
                stocks[ticker] = {"label":name.strip()[:30],"sector":"US","market":"us"}
        print(f"    ✅ S&P500: {len(stocks)}개")
    except Exception as e:
        print(f"    ❌ S&P500: {e}")

    # 폴백: 파싱 실패 시 주요 종목 하드코딩
    if len(stocks) < 50:
        print("    ⚠ Wikipedia 파싱 부족 — 하드코딩 TOP 100 사용")
        fallback = [
            "AAPL","MSFT","NVDA","AMZN","META","GOOGL","GOOG","BRK-B","LLY","AVGO",
            "JPM","TSLA","UNH","XOM","V","PG","MA","JNJ","COST","HD",
            "MRK","ABBV","NFLX","AMD","CRM","BAC","CVX","KO","PEP","TMO",
            "ADBE","WMT","ACN","MCD","LIN","CSCO","ABT","WFC","DHR","GE",
            "INTC","QCOM","AMAT","MU","LRCX","KLAC","MRVL","PANW","SNPS","CDNS",
            "NOW","INTU","BKNG","ISRG","VRTX","REGN","GILD","MRNA","AMGN","BIIB",
            "CAT","HON","UPS","RTX","DE","MMM","GD","LMT","BA","NOC",
            "GS","MS","BLK","SCHW","AXP","C","USB","PNC","TFC","COF",
            "PFE","BMY","ZTS","SYK","MDT","EW","BSX","DXCM","IDXX","A",
            "NKE","SBUX","TGT","LOW","TJX","ROST","DG","DLTR","ORLY","AZO",
        ]
        for t in fallback:
            if t not in stocks:
                stocks[t] = {"label":t,"sector":"US","market":"us"}

    return stocks

def load_watchlist():
    try:
        if os.path.exists("public/data/watchlist.json"):
            with open("public/data/watchlist.json","r",encoding="utf-8") as f:
                return json.load(f).get("stocks", DEFAULT_WATCHLIST)
    except:
        pass
    return DEFAULT_WATCHLIST

# ── 배치 수집 (레이트리밋 보호) ───────────────────────────
def fetch_pool_batch(pool, range_="3mo", batch_size=50, delay_between_batches=5):
    """종목 풀을 배치로 나눠서 수집. 레이트리밋 시 자동 감속."""
    global _rate_limit_hits
    results = {}
    items = list(pool.items())
    total = len(items)
    success = 0
    fail = 0

    for batch_start in range(0, total, batch_size):
        batch = items[batch_start:batch_start + batch_size]
        batch_num = batch_start // batch_size + 1
        total_batches = (total + batch_size - 1) // batch_size
        print(f"\n  📦 배치 {batch_num}/{total_batches} ({batch_start+1}~{min(batch_start+batch_size, total)}/{total})")

        for i, (ticker, info) in enumerate(batch):
            suffix = info.get("suffix","")
            yt = ticker + suffix
            idx = batch_start + i + 1
            print(f"    [{idx}/{total}] {ticker:8s}... ", end="", flush=True)

            raw = fetch_yahoo(yt, range_=range_)
            if not raw:
                print("❌")
                fail += 1
                time.sleep(0.3)
                continue

            try:
                candles, meta = parse_candles(raw)
                if not candles:
                    print("❌ 캔들없음")
                    fail += 1
                    continue

                price     = float(meta.get("regularMarketPrice") or candles[-1]["close"])
                prev      = float(meta.get("chartPreviousClose") or meta.get("previousClose") or price)
                changePct = round((price-prev)/prev*100, 2) if prev else 0
                mktCap    = float(meta.get("marketCap") or 0)
                isKR = info.get("market") == "kr"
                mktCapNorm = round(mktCap / 1e8, 1) if isKR else round(mktCap / 1e9, 2)

                results[ticker] = {
                    **{k:v for k,v in info.items() if k != "suffix"},
                    "ticker":ticker, "price":price,
                    "changePct":changePct,
                    "chg3d":calc_change(candles,3),
                    "chg5d":calc_change(candles,5),
                    "volRatio":calc_vol_ratio(candles),
                    "mktCap":mktCapNorm,
                    "candles": candles,  # daily에서는 캔들 포함
                }
                print(f"✅ {price:,.1f} ({changePct:+.1f}%)")
                success += 1
            except Exception as e:
                print(f"❌ {e}")
                fail += 1

            # 개별 딜레이 (레이트리밋 상황에 따라 조절)
            base_delay = 0.4
            if _rate_limit_hits > 10:
                base_delay = 1.5
            elif _rate_limit_hits > 5:
                base_delay = 1.0
            elif _rate_limit_hits > 2:
                base_delay = 0.7
            time.sleep(base_delay)

        # 배치 간 쉬기
        if batch_start + batch_size < total:
            rest = delay_between_batches
            if _rate_limit_hits > 5:
                rest = 15
            elif _rate_limit_hits > 2:
                rest = 10
            print(f"  ⏸ 배치 간 {rest}초 대기 (요청 {_request_count}건, 리밋 {_rate_limit_hits}회)")
            time.sleep(rest)

    print(f"\n  📊 수집 결과: 성공 {success} / 실패 {fail} / 전체 {total}")
    return results

# ── 메인 ──────────────────────────────────────────────────
def main():
    now_str = datetime.now(timezone.utc).isoformat()
    print(f"\n{'='*60}")
    print(f"  Vega [{MODE.upper()}] {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"{'='*60}\n")
    os.makedirs("public/data", exist_ok=True)

    # 기존 데이터 로드
    existing = {}
    if os.path.exists("public/data/stocks.json"):
        try:
            with open("public/data/stocks.json","r") as f:
                existing = json.load(f)
        except:
            pass

    # pool_data 초기화 (모든 모드에서 사용 가능하게)
    pool_data = {}

    output = {
        "stocks":  existing.get("stocks", {}),
        "indices": existing.get("indices", {}),
        "sectors": existing.get("sectors", {}),
        "pool":    existing.get("pool", {}),
        "breadth": existing.get("breadth", {"kr":{"upPct":0,"up":0,"down":0},"us":{"upPct":0,"up":0,"down":0}}),
        "ibVol":   existing.get("ibVol", 100),
        "updatedAt": now_str,
        "mode": MODE,
    }

    # ── 지수 (항상 수집) ──────────────────────────────────
    print("🌐 지수 수집...")
    for ticker, info in INDICES.items():
        print(f"  {info['label']:10s} ({ticker})... ", end="", flush=True)
        raw = fetch_yahoo(ticker, range_="1mo")
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
            }
            print(f"✅ {price:,.2f} ({changePct:+.2f}%)")
        except Exception as e:
            print(f"❌ {e}")
        time.sleep(0.5)

    # ══════════════════════════════════════════════════════
    # QUARTERLY 모드
    # ══════════════════════════════════════════════════════
    if MODE == "quarterly":
        print("\n📊 분기 재무데이터 수집은 현재 비활성화됨 (Yahoo v10 API 제한)")
        print("   향후 대안 API 연동 시 복원 예정\n")
        path = "public/data/stocks.json"
        with open(path,"w",encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, separators=(",",":"))
        return

    # ══════════════════════════════════════════════════════
    # DAILY 모드: 전체 풀 수집 + 알파 스캔
    # ══════════════════════════════════════════════════════
    if MODE == "daily":
        print("\n📦 전체 종목 풀 수집 중...")
        pool = {}
        pool.update(get_krx_volume_top(300))
        pool.update(get_us_stocks())

        # Phase 2-2: 사용자 관심종목도 풀에 병합
        watchlist = load_watchlist()
        for ticker, info in watchlist.items():
            if ticker not in pool:
                pool[ticker] = info
                print(f"  ➕ 관심종목 추가: {ticker} ({info.get('label','')})")

        print(f"  총 {len(pool)}개 종목 대상\n")

        # 배치 수집
        pool_data = fetch_pool_batch(pool, range_="3mo", batch_size=50, delay_between_batches=5)

        # RS 랭킹 계산 (5일 수익률 기준 전체 순위)
        print("\n📊 RS 랭킹 계산...")
        kr_stocks = [(t,s) for t,s in pool_data.items() if s.get("market")=="kr"]
        us_stocks = [(t,s) for t,s in pool_data.items() if s.get("market")=="us"]

        for group_name, group in [("🇰🇷",kr_stocks),("🇺🇸",us_stocks)]:
            group.sort(key=lambda x: x[1].get("chg5d",0), reverse=True)
            total = len(group)
            for rank, (ticker, _) in enumerate(group):
                pct_rank = round((1 - rank / max(total,1)) * 100, 1)
                pool_data[ticker]["rsRank"] = rank + 1
                pool_data[ticker]["rsPctRank"] = pct_rank
                # 52주 신고가 돌파 체크
                candles = pool_data[ticker].get("candles",[])
                if candles:
                    closes = [c["close"] for c in candles]
                    w52h = max(closes[:-1]) if len(closes) > 1 else closes[0]
                    cur = closes[-1]
                    pool_data[ticker]["w52Breakout"] = cur > w52h
                    pool_data[ticker]["w52DistPct"] = round((cur - w52h) / w52h * 100, 1) if w52h else 0
            print(f"  {group_name} {total}개 랭킹 완료")

        # 알파 스캔
        print("\n🎯 알파 스캔 중...")
        alpha_hits = []
        for ticker, stock in pool_data.items():
            candles = stock.get("candles", [])
            info = pool.get(ticker, stock)
            hit = alpha_scan(ticker, {**info, **stock}, candles)
            if hit:
                hit["rsRank"] = stock.get("rsRank", 0)
                hit["rsPctRank"] = stock.get("rsPctRank", 0)
                hit["w52Breakout"] = stock.get("w52Breakout", False)
                alpha_hits.append(hit)

        alpha_hits.sort(key=lambda x: x["score"], reverse=True)
        print(f"  ⭐ {len(alpha_hits)}개 알파 종목 발견")

        # 풀 데이터 저장 (캔들만 제거 — RS랭킹/52주 정보는 보존)
        pool_slim = {}
        for ticker, stock in pool_data.items():
            pool_slim[ticker] = {k:v for k,v in stock.items() if k != "candles"}
        output["pool"] = pool_slim

        # 알파 결과 저장
        with open("public/data/alpha_hits.json", "w", encoding="utf-8") as f:
            json.dump({
                "hits": alpha_hits[:50],  # 상위 50개만
                "count": len(alpha_hits),
                "scanned": len(pool_data),
                "updatedAt": now_str,
            }, f, ensure_ascii=False, separators=(",",":"))

        # 관심종목은 캔들 포함해서 stocks에 저장
        watchlist = load_watchlist()
        print(f"\n⭐ 관심종목 {len(watchlist)}개 캔들 데이터 보존...")
        for ticker, info in watchlist.items():
            if ticker in pool_data and pool_data[ticker].get("candles"):
                output["stocks"][ticker] = pool_data[ticker]
                print(f"  {ticker} ✅ (풀에서 가져옴)")
            else:
                # 풀에 없으면 별도 수집
                suffix = info.get("suffix","")
                raw = fetch_yahoo(ticker+suffix, range_="6mo")
                if raw:
                    try:
                        candles, meta = parse_candles(raw)
                        price = float(meta.get("regularMarketPrice") or candles[-1]["close"])
                        prev  = float(meta.get("chartPreviousClose") or meta.get("previousClose") or price)
                        changePct = round((price-prev)/prev*100,2) if prev else 0
                        mktCap = float(meta.get("marketCap") or 0)
                        isKR = info.get("market") == "kr"
                        output["stocks"][ticker] = {
                            **{k:v for k,v in info.items() if k!="suffix"},
                            "ticker":ticker,"price":price,"changePct":changePct,
                            "chg3d":calc_change(candles,3),"chg5d":calc_change(candles,5),
                            "volRatio":calc_vol_ratio(candles),
                            "mktCap":round(mktCap/1e8,1) if isKR else round(mktCap/1e9,2),
                            "candles":candles,"updatedAt":now_str,
                        }
                        print(f"  {ticker} ✅ (별도 수집)")
                    except:
                        print(f"  {ticker} ❌")
                time.sleep(0.5)

    # ══════════════════════════════════════════════════════
    # HOURLY 모드: 관심종목만
    # ══════════════════════════════════════════════════════
    else:
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
                    **{k:v for k,v in (output["stocks"].get(ticker, info)).items()},
                    "price":price,"changePct":changePct,
                    "chg3d":calc_change(candles,3),"chg5d":calc_change(candles,5),
                    "volRatio":calc_vol_ratio(candles),
                    "candles":candles,"updatedAt":now_str,
                }
                print(f"  {ticker} ✅ {price:,.2f} ({changePct:+.2f}%)")
            except Exception as e:
                print(f"  {ticker} ❌ {e}")
            time.sleep(0.5)

    # ── 섹터 ETF 수집 ─────────────────────────────────────
    print("\n📊 섹터 ETF 수집 중...")
    sectors_data = {}

    for etf_ticker, etf_info in {**US_SECTOR_ETFS, **KR_SECTOR_ETFS}.items():
        raw = fetch_yahoo(etf_ticker, range_="1mo")
        if not raw:
            continue
        try:
            candles, meta = parse_candles(raw)
            price = float(meta.get("regularMarketPrice") or candles[-1]["close"])
            prev  = float(meta.get("chartPreviousClose") or price)
            chg1d = round((price-prev)/prev*100, 2) if prev else 0
            mkt = "kr" if ".KS" in etf_ticker else "us"
            sectors_data[etf_ticker] = {
                **etf_info, "etf": etf_ticker, "market": mkt,
                "price": price, "chg1d": chg1d,
                "chg1W": calc_change(candles, 5),
                "chg1M": calc_change(candles, 21),
            }
            print(f"  {etf_info['label']:8s} ({etf_ticker}) ✅ {chg1d:+.2f}%")
        except Exception as e:
            print(f"  {etf_ticker} ❌ {e}")
        time.sleep(0.3)

    output["sectors"] = sectors_data

    # ── IB 거래량 ─────────────────────────────────────────
    print("\n📊 IB 거래량 계산...")
    ib_tickers = ["005930","000660","AAPL","MSFT","NVDA","META","TSLA","AMZN"]
    vol_ratios = []
    for ib_tick in ib_tickers:
        info = pool_data.get(ib_tick) or output["stocks"].get(ib_tick)
        if info and info.get("volRatio"):
            vol_ratios.append(info["volRatio"])

    if vol_ratios:
        output["ibVol"] = round(sum(vol_ratios) / len(vol_ratios), 1)
        print(f"  ✅ IB 거래량: {output['ibVol']}% ({len(vol_ratios)}개)")
    else:
        print("  ⚠ 기존값 유지")

    # ── 상승/하락 비율 ────────────────────────────────────
    if pool_data:
        print("\n📈 상승/하락 비율 계산...")
        kr_up = kr_down = us_up = us_down = 0
        for ticker, stock in pool_data.items():
            chg = stock.get("changePct", 0)
            mkt = stock.get("market", "")
            if mkt == "kr":
                if chg >= 0: kr_up += 1
                else: kr_down += 1
            elif mkt == "us":
                if chg >= 0: us_up += 1
                else: us_down += 1

        kr_total = kr_up + kr_down
        us_total = us_up + us_down
        output["breadth"] = {
            "kr": {"up":kr_up,"down":kr_down,"total":kr_total,
                   "upPct":round(kr_up/kr_total*100,1) if kr_total else 0},
            "us": {"up":us_up,"down":us_down,"total":us_total,
                   "upPct":round(us_up/us_total*100,1) if us_total else 0},
            "updatedAt": now_str,
        }
        print(f"  🇰🇷 상승 {kr_up} / 하락 {kr_down}")
        print(f"  🇺🇸 상승 {us_up} / 하락 {us_down}")

    # ── 저장 ─────────────────────────────────────────────
    path = "public/data/stocks.json"
    with open(path,"w",encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",",":"))

    size_kb = os.path.getsize(path) / 1024
    print(f"\n{'='*60}")
    print(f"  ✅ 완료 ({size_kb:.1f}KB)")
    print(f"  📡 API 요청: {_request_count}건 / 레이트리밋: {_rate_limit_hits}회")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    main()
