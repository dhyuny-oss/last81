#!/usr/bin/env python3
"""
Alpha Terminal — Yahoo Finance 데이터 수집
- hourly 모드 (평일 매 시간): 관심종목 현재가만
- daily  모드 (평일 오후 6시): 전체 풀 + 알파스캔
- quarterly 모드 (수동): 재무데이터 수집
"""

import json, os, time, requests, sys
from datetime import datetime, timezone, timedelta

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
MODE = os.environ.get("COLLECT_MODE", "hourly")

# ── 한국투자증권 API ──────────────────────────────────────
KIS_APP_KEY = os.environ.get("KIS_APP_KEY", "")
KIS_APP_SECRET = os.environ.get("KIS_APP_SECRET", "")
KIS_ACCOUNT = os.environ.get("KIS_ACCOUNT", "")
KIS_BASE = "https://openapi.koreainvestment.com:9443"
KIS_TOKEN = None

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

# ── 한국 주요종목 폴백 (KRX 실패 시) ─────────────────────
KR_MAJOR_STOCKS = {
    # 코스피 시총 상위 + 거래 활발 종목 (~150개)
    "005930":("삼성전자",".KS"),"000660":("SK하이닉스",".KS"),"373220":("LG에너지솔루션",".KS"),
    "005380":("현대차",".KS"),"000270":("기아",".KS"),"068270":("셀트리온",".KS"),
    "035420":("NAVER",".KS"),"035720":("카카오",".KQ"),"006400":("삼성SDI",".KS"),
    "051910":("LG화학",".KS"),"003670":("포스코퓨처엠",".KS"),"005490":("POSCO홀딩스",".KS"),
    "055550":("신한지주",".KS"),"105560":("KB금융",".KS"),"086790":("하나금융지주",".KS"),
    "012330":("현대모비스",".KS"),"003550":("LG",".KS"),"066570":("LG전자",".KS"),
    "034730":("SK",".KS"),"015760":("한국전력",".KS"),"011200":("HMM",".KS"),
    "032830":("삼성생명",".KS"),"010130":("고려아연",".KS"),"030200":("KT",".KS"),
    "009150":("삼성전기",".KS"),"033780":("KT&G",".KS"),"017670":("SK텔레콤",".KS"),
    "028260":("삼성물산",".KS"),"010950":("S-Oil",".KS"),"018260":("삼성에스디에스",".KS"),
    "316140":("우리금융지주",".KS"),"000810":("삼성화재",".KS"),"011170":("롯데케미칼",".KS"),
    "024110":("기업은행",".KS"),"138040":("메리츠금융지주",".KS"),"021240":("코웨이",".KS"),
    "012450":("한화에어로스페이스",".KS"),"009540":("한국조선해양",".KS"),
    "003490":("대한항공",".KS"),"010140":("삼성중공업",".KS"),"329180":("HD현대중공업",".KS"),
    "034020":("두산에너빌리티",".KS"),"011790":("SKC",".KS"),"096770":("SK이노베이션",".KS"),
    "259960":("크래프톤",".KS"),"263750":("펄어비스",".KS"),"036570":("엔씨소프트",".KS"),
    "251270":("넷마블",".KS"),"352820":("하이브",".KS"),
    "207940":("삼성바이오로직스",".KS"),"326030":("SK바이오팜",".KS"),"128940":("한미약품",".KS"),
    "000720":("현대건설",".KS"),"047040":("대우건설",".KS"),"006360":("GS건설",".KS"),
    "004020":("현대제철",".KS"),"010060":("OCI홀딩스",".KS"),
    "090430":("아모레퍼시픽",".KS"),"285130":("SK케미칼",".KS"),"180640":("한진칼",".KS"),
    "047810":("한국항공우주",".KS"),"079550":("LIG넥스원",".KS"),
    "009830":("한화솔루션",".KS"),"267260":("HD현대일렉트릭",".KS"),"042660":("한화오션",".KS"),
    "011210":("현대위아",".KS"),"241560":("두산밥캣",".KS"),"161390":("한국타이어앤테크놀로지",".KS"),
    "302440":("SK바이오사이언스",".KS"),"377300":("카카오페이",".KS"),"323410":("카카오뱅크",".KS"),
    "000990":("DB하이텍",".KS"),"298050":("효성첨단소재",".KS"),
    "064350":("현대로템",".KS"),"071050":("한국금융지주",".KS"),
    "088350":("한화생명",".KS"),"036460":("한국가스공사",".KS"),"078930":("GS",".KS"),
    "097950":("CJ제일제당",".KS"),"051900":("LG생활건강",".KS"),"004990":("롯데지주",".KS"),
    "000100":("유한양행",".KS"),"271560":("오리온",".KS"),"004170":("신세계",".KS"),
    "383220":("F&F",".KS"),"307950":("현대오토에버",".KS"),"361610":("SK아이이테크놀로지",".KS"),
    "006800":("미래에셋증권",".KS"),"016360":("삼성증권",".KS"),"008770":("호텔신라",".KS"),
    "069960":("현대백화점",".KS"),"004370":("농심",".KS"),"282330":("BGF리테일",".KS"),
    "030000":("제일기획",".KS"),"002790":("아모레G",".KS"),"009240":("한샘",".KS"),
    "014680":("한솔케미칼",".KS"),"006280":("녹십자",".KS"),"000210":("DL",".KS"),
    "002380":("KCC",".KS"),"001040":("CJ",".KS"),"011780":("금호석유",".KS"),
    "003410":("쌍용C&E",".KS"),"006260":("LS",".KS"),"001570":("금양",".KS"),
    "006110":("삼아알미늄",".KS"),"007070":("GS리테일",".KS"),"008560":("메리츠증권",".KS"),
    "009270":("한화오션",".KS"),"014820":("동원시스템즈",".KS"),"016800":("퍼시스",".KS"),
    "018880":("한온시스템",".KS"),"020150":("일진머티리얼즈",".KS"),"023530":("롯데쇼핑",".KS"),
    "026960":("동서",".KS"),"029780":("삼성카드",".KS"),"032640":("LG유플러스",".KS"),
    "034220":("LG디스플레이",".KS"),"036530":("S&T홀딩스",".KS"),"042670":("HD현대인프라코어",".KS"),
    "044820":("코스맥스",".KS"),"047050":("포스코인터내셔널",".KS"),"052690":("한전기술",".KS"),
    "058850":("KG케미칼",".KS"),"069620":("대웅제약",".KS"),"071320":("지역난방공사",".KS"),
    "078520":("에이블씨엔씨",".KS"),"081660":("휠라홀딩스",".KS"),"084680":("이월드",".KS"),
    "100220":("비상교육",".KS"),"139480":("이마트",".KS"),"192820":("코스맥스비티아이",".KS"),
    "210980":("SK디앤디",".KS"),"214370":("케어젠",".KS"),"272210":("한화시스템",".KS"),
    "336260":("두산퓨얼셀",".KS"),"338100":("NH투자증권",".KS"),"352480":("씨에스베어링",".KQ"),
    # 코스닥 주요종목 (~50개)
    "042700":("한미반도체",".KQ"),"112040":("위메이드",".KQ"),"293490":("카카오게임즈",".KQ"),
    "041510":("에스엠",".KQ"),"122870":("와이지엔터",".KQ"),
    "247540":("에코프로비엠",".KQ"),"247550":("에코프로",".KQ"),
    "091990":("셀트리온헬스케어",".KQ"),"145020":("휴젤",".KQ"),"196170":("알테오젠",".KQ"),
    "095340":("ISC",".KQ"),"058470":("리노공업",".KQ"),
    "240810":("원익IPS",".KQ"),"357780":("솔브레인",".KQ"),"039030":("이오테크닉스",".KQ"),
    "166090":("하나머티리얼즈",".KQ"),"108320":("LX세미콘",".KQ"),"403870":("HPSP",".KQ"),
    "036830":("솔브레인홀딩스",".KQ"),"078340":("컴투스",".KQ"),
    "086520":("에코프로에이치엔",".KQ"),"348210":("넥스틴",".KQ"),"299030":("하나기술",".KQ"),
    "067160":("아프리카TV",".KQ"),"328130":("루닛",".KQ"),"950160":("코오롱티슈진",".KQ"),
    "039200":("오스코텍",".KQ"),"060250":("NHN한국사이버결제",".KQ"),"141080":("레고켐바이오",".KQ"),
    "214150":("클래시스",".KQ"),"222080":("씨아이에스",".KQ"),"237880":("클리오",".KQ"),
    "263860":("지니언스",".KQ"),"278280":("천보",".KQ"),"294090":("이오플로우",".KQ"),
    "317770":("엑세스바이오",".KQ"),"357550":("석경에이티",".KQ"),"376300":("디어유",".KQ"),
    "383310":("에코프로머티리얼즈",".KQ"),"394280":("오픈엣지테크놀로지",".KQ"),
    "041020":("폴라리스오피스",".KQ"),"060280":("큐렉소",".KQ"),"101490":("에스앤에스텍",".KQ"),
    "131970":("테스나",".KQ"),"175250":("아이큐어",".KQ"),"200710":("에이디테크놀로지",".KQ"),
    "253450":("스튜디오드래곤",".KQ"),"330860":("네이처셀",".KQ"),"365340":("성일하이텍",".KQ"),
}

# ── 레이트 리밋 추적 ──────────────────────────────────────
_request_count = 0
_rate_limit_hits = 0

def fetch_yahoo(ticker, range_="6mo", interval="1d"):
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

# ── 한국투자증권 API 함수 ─────────────────────────────────
def kis_get_token():
    """OAuth 토큰 발급"""
    global KIS_TOKEN
    if not KIS_APP_KEY or not KIS_APP_SECRET:
        return None
    try:
        r = requests.post(f"{KIS_BASE}/oauth2/tokenP", json={
            "grant_type":"client_credentials",
            "appkey":KIS_APP_KEY, "appsecret":KIS_APP_SECRET,
        }, timeout=10)
        if r.status_code == 200:
            KIS_TOKEN = r.json().get("access_token")
            print(f"  ✅ 한투 API 토큰 발급 성공")
            return KIS_TOKEN
        else:
            print(f"  ❌ 한투 토큰 실패: {r.status_code} {r.text[:100]}")
    except Exception as e:
        print(f"  ❌ 한투 토큰 오류: {e}")
    return None

def kis_headers(tr_id):
    """API 호출용 헤더"""
    acct = KIS_ACCOUNT.replace("-","") if KIS_ACCOUNT else ""
    return {
        "authorization": f"Bearer {KIS_TOKEN}",
        "appkey": KIS_APP_KEY, "appsecret": KIS_APP_SECRET,
        "tr_id": tr_id,
        "custtype": "P",
    }

def kis_fetch_kr_price(ticker):
    """한국 주식 현재가 조회"""
    if not KIS_TOKEN: return None
    try:
        r = requests.get(f"{KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price",
            headers=kis_headers("FHKST01010100"),
            params={"FID_COND_MRKT_DIV_CODE":"J","FID_INPUT_ISCD":ticker},
            timeout=10)
        if r.status_code == 200:
            d = r.json().get("output",{})
            price = float(d.get("stck_prpr",0))
            prev  = float(d.get("stck_sdpr",0))  # 전일종가
            vol   = int(d.get("acml_vol",0))      # 누적거래량
            chg   = float(d.get("prdy_ctrt",0))   # 전일대비등락률
            if price > 0:
                return {"price":price,"prev":prev,"changePct":chg,"volume":vol}
    except Exception as e:
        pass
    return None

def kis_fetch_us_price(ticker):
    """미국 주식 현재가 조회"""
    if not KIS_TOKEN: return None
    # 거래소 판별
    excd = "NAS"  # 기본 나스닥
    nyse_prefixes = ["BRK","JPM","BAC","WFC","GS","MS","JNJ","PG","KO","XOM",
                     "CVX","WMT","HD","DIS","CAT","HON","BA","GE","MMM","IBM"]
    if any(ticker.startswith(p) for p in nyse_prefixes) or len(ticker) <= 2:
        excd = "NYS"
    amex_tickers = ["AMC","PLUG","SOUN"]
    if ticker in amex_tickers:
        excd = "AMS"
    try:
        r = requests.get(f"{KIS_BASE}/uapi/overseas-price/v1/quotations/price",
            headers=kis_headers("HHDFS00000300"),
            params={"AUTH":"","EXCD":excd,"SYMB":ticker},
            timeout=10)
        if r.status_code == 200:
            d = r.json().get("output",{})
            price = float(d.get("last",0) or d.get("stck_prpr",0))
            prev  = float(d.get("base",0) or d.get("stck_sdpr",0))
            chg   = float(d.get("rate",0) or d.get("prdy_ctrt",0))
            vol   = int(d.get("tvol",0) or d.get("acml_vol",0))
            if price > 0:
                return {"price":price,"prev":prev,"changePct":chg,"volume":vol}
        # 거래소 틀렸으면 다른 거래소 시도
        if r.status_code == 200 and not float(r.json().get("output",{}).get("last",0) or 0):
            for alt in ["NAS","NYS","AMS"]:
                if alt == excd: continue
                r2 = requests.get(f"{KIS_BASE}/uapi/overseas-price/v1/quotations/price",
                    headers=kis_headers("HHDFS00000300"),
                    params={"AUTH":"","EXCD":alt,"SYMB":ticker}, timeout=10)
                if r2.status_code == 200:
                    d2 = r2.json().get("output",{})
                    p2 = float(d2.get("last",0) or 0)
                    if p2 > 0:
                        return {"price":p2,"prev":float(d2.get("base",0)),"changePct":float(d2.get("rate",0)),"volume":int(d2.get("tvol",0))}
                time.sleep(0.1)
    except Exception as e:
        pass
    return None

def kis_fetch_price(ticker, market="us"):
    """시장에 따라 한국/미국 분기"""
    if market == "kr":
        return kis_fetch_kr_price(ticker)
    else:
        return kis_fetch_us_price(ticker)

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
    if ema3[-1] and ema10[-1] and ema3[-3] and ema10[-3]:
        if ema3[-1] > ema10[-1] and ema3[-3] <= ema10[-3]:
            score += 25; signals.append("골든크로스")
        elif ema3[-1] > ema10[-1]:
            score += 10
    if len(volumes) >= 20:
        vol5  = sum(volumes[-5:])  / 5
        vol20 = sum(volumes[-20:]) / 20
        if vol20 > 0 and vol5 > vol20 * 1.5:
            score += 20; signals.append("거래량급증")
    w52h = max(closes)
    if last_close >= w52h * 0.85:
        vol_early  = sum(volumes[-20:-15]) / 5 if len(volumes) >= 20 else 0
        vol_recent = sum(volumes[-5:]) / 5
        if vol_early > 0 and vol_recent < vol_early * 0.7:
            score += 20; signals.append("VCP")
    chg3 = calc_change(candles, 3)
    chg5 = calc_change(candles, 5)
    if chg3 > 2: score += 10
    if chg5 > 3: score += 10
    rs_pct = info.get("rsPctRank", 50)
    if rs_pct >= 90: score += 25; signals.append("RS상위10%")
    elif rs_pct >= 80: score += 15; signals.append("RS상위20%")
    elif rs_pct >= 60: score += 5
    if info.get("w52Breakout"):
        score += 20; signals.append("신고가돌파")
    elif last_close >= max(closes) * 0.95:
        score += 5; signals.append("신고가근접")
    if score < 20:
        return None
    return {
        "ticker":ticker,"label":info.get("label",ticker),"market":info.get("market","us"),
        "sector":info.get("sector","Unknown"),"price":last_close,
        "chg3d":chg3,"chg5d":chg5,"score":score,"signals":signals,
        "changePct":calc_change(candles,1),
    }

# ── ★ 수정: 종목 목록 수집 (이전 거래일 자동 시도) ──────
def get_krx_volume_top(n=300):
    """KRX 거래대금 상위 종목 — 이전 거래일 자동 시도 + 대형 폴백"""
    print(f"  KRX 거래대금 상위 {n}개...")
    stocks = {}

    # 최근 5 거래일 시도 (장 전/주말에도 작동)
    today = datetime.now()
    dates_to_try = []
    for i in range(10):
        d = today - timedelta(days=i)
        if d.weekday() < 5:
            dates_to_try.append(d.strftime("%Y%m%d"))
        if len(dates_to_try) >= 5:
            break

    for try_date in dates_to_try:
        if len(stocks) >= 100:
            break
        print(f"    📅 {try_date} 시도...")

        for market_id, market_name in [("STK","코스피"), ("KSQ","코스닥")]:
            try:
                r = requests.post(
                    "https://www.krx.co.kr/comm/bldAttendant/getJsonData.cmd",
                    data={"bld":"dbms/MDC/STAT/standard/MDCSTAT01501","locale":"ko_KR",
                          "mktId":market_id,"trdDd":try_date,
                          "share":"1","money":"1","csvxls_isNo":"false"},
                    headers={**HEADERS,"Referer":"https://www.krx.co.kr/"}, timeout=15
                )
                items = r.json().get("OutBlock_1", [])
                for item in items:
                    try:
                        val = int(str(item.get("ACC_TRDVAL","0")).replace(",","") or "0")
                        item["_val"] = val
                    except:
                        item["_val"] = 0
                items.sort(key=lambda x: x["_val"], reverse=True)

                count = 0
                target = n * 2 // 3 if market_id == "STK" else n // 3
                for item in items:
                    if count >= target:
                        break
                    t = item.get("ISU_SRT_CD","").zfill(6)
                    name = item.get("ISU_ABBRV","")
                    if not t or not name:
                        continue
                    if item["_val"] < 100000000:  # 1억원 이상
                        continue
                    suffix = ".KS" if market_id == "STK" else ".KQ"
                    if t not in stocks:
                        stocks[t] = {"label":name,"sector":"Korean","market":"kr","suffix":suffix}
                        count += 1
                print(f"    ✅ {market_name} ({try_date}): {count}개")
            except Exception as e:
                print(f"    ❌ {market_name}: {e}")

    # ★ 항상 주요종목 보강 (KRX에서 누락된 대형주 보완)
    added_fallback = 0
    for t, (name, suffix) in KR_MAJOR_STOCKS.items():
        if t not in stocks:
            stocks[t] = {"label":name,"sector":"Korean","market":"kr","suffix":suffix}
            added_fallback += 1
    if added_fallback:
        print(f"    ➕ 주요종목 폴백 {added_fallback}개 추가")

    print(f"    📊 한국 총 {len(stocks)}개")
    return stocks

def get_us_stocks():
    """S&P 500 + 나스닥 주요종목 — Wikipedia + 대형 폴백"""
    print("  Wikipedia S&P500...")
    stocks = {}
    try:
        import re
        r = requests.get(
            "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
            headers=HEADERS, timeout=15
        )
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

    # ★ 확장된 폴백 — 테마별 핫 종목 (500개+)
    if len(stocks) < 500:
        print(f"    ⚠ Wikipedia 부족 ({len(stocks)}개) — 테마별 핫 종목 보강")
        fallback = [
            # ── 빅테크 + 메가캡 (30) ──
            "AAPL","MSFT","NVDA","AMZN","META","GOOGL","GOOG","BRK-B","LLY","AVGO",
            "JPM","TSLA","UNH","XOM","V","PG","MA","JNJ","COST","HD",
            "MRK","ABBV","NFLX","AMD","CRM","BAC","CVX","KO","PEP","TMO",
            # ── AI · 로보틱스 (30) ──
            "PLTR","AI","SOUN","IONQ","RGTI","PATH","UPST","BBAI","BIGB","DT",
            "SMCI","ARM","DELL","HPE","IBM","ORCL","SAP","SNOW","DDOG","MDB",
            "CRWD","NET","ZS","FTNT","PANW","WDAY","OKTA","ESTC","CFLT","GTLB",
            # ── 반도체 (25) ──
            "TSM","ASML","INTC","QCOM","AMAT","MU","LRCX","KLAC","MRVL","SNPS",
            "CDNS","ON","SWKS","MCHP","TXN","ADI","NXPI","WOLF","ACLS","MPWR",
            "CRUS","RMBS","MTSI","ALGM","FORM",
            # ── 양자컴퓨팅 (8) ──
            "QUBT","QBTS","ARQQ","QTUM",
            "IQM","DMYI","COLD","LASR",
            # ── 우주 · 방산 (15) ──
            "LMT","RTX","NOC","GD","BA","LHX","HII","TDG","HWM","KTOS",
            "RKLB","LUNR","RDW","ASTS","MNTS",
            # ── 핀테크 · 크립토 (25) ──
            "SQ","PYPL","COIN","HOOD","SOFI","AFRM","BILL","SHOP","SE","NU",
            "MELI","GRAB","CPNG","MSTR","RIOT","MARA","BITF","CLSK","HUT","CIFR",
            "BTBT","IREN","WULF","CORZ","HIVE",
            # ── 전기차 · 클린에너지 (20) ──
            "RIVN","LCID","NIO","XPEV","LI","F","GM","STLA","TM","HMC",
            "ENPH","SEDG","FSLR","RUN","NOVA","NEE","DUK","SO","AEP","D",
            # ── 바이오 · 헬스케어 (25) ──
            "ISRG","VRTX","REGN","GILD","MRNA","AMGN","BIIB","NBIX","EXAS","ARGX",
            "PFE","BMY","ZTS","SYK","MDT","EW","BSX","DXCM","IDXX","A",
            "CVS","CI","HUM","ELV","CNC",
            # ── SaaS · 클라우드 (20) ──
            "NOW","INTU","ADBE","BKNG","HUBS","ZI","PAYC","PCTY","VEEV","DOCU",
            "TEAM","BRZE","APP","RBRK","RDDT","ZM","TWLO","DSGX","WK","MNDY",
            # ── 소비재 · 리테일 (20) ──
            "NKE","SBUX","TGT","LOW","TJX","ROST","DG","DLTR","ORLY","AZO",
            "WMT","ACN","MCD","LIN","CSCO","ABT","WFC","DHR","GE","MNST",
            # ── 게임 · 엔터 · 스트리밍 (15) ──
            "DIS","CMCSA","RBLX","U","TTWO","EA","MTCH","PINS","LYV","SPOT",
            "ROKU","CHTR","FOX","PARA","WBD",
            # ── 플랫폼 · 모빌리티 (10) ──
            "UBER","LYFT","ABNB","DASH","DKNG","PENN","BKSY","JOBY","ACHR","EVTL",
            # ── 에너지 · 원자재 (20) ──
            "COP","SLB","EOG","DVN","HAL","OXY","MPC","VLO","PSX","LNG",
            "APD","SHW","ECL","PPG","DD","ALB","FMC","IFF","FCX","NEM",
            # ── 금융 · 보험 (15) ──
            "GS","MS","BLK","SCHW","AXP","C","USB","PNC","TFC","COF",
            "SPGI","ICE","CME","NDAQ","MCO",
            # ── 산업재 · 물류 (15) ──
            "CAT","HON","UPS","DE","ITW","EMR","ROK","PH","ETN","AME",
            "FDX","DAL","UAL","LUV","AAL",
            # ── 리얼에셋 · 인프라 (10) ──
            "AMT","PLD","CCI","EQIX","DLR","SPG","O","WELL","AVB","EQR",
            # ── 밈 · 소셜 화제 (15) ──
            "GME","AMC","BBBY","CLOV","WISH","OPEN","LAZR","MVST","QS","CHPT",
            "PLUG","BLNK","GOEV","WKHS","NKLA",
            # ── 최근 IPO · 고성장 (20) ──
            "CART","BIRK","VRT","IBKR","CAVA","DUOL","TOST","KVYO","ONON","CELH",
            "LNTH","IOT","SRAD","GFS","DOCS","GTLB","BRZE","RBRK","RDDT","MNDY",
            # ── 식품 · 필수소비 (15) ──
            "MDLZ","HSY","GIS","K","CPB","SJM","HRL","MKC","CHD","ADP",
            "PAYX","CTAS","CLX","KHC","KDP",
            # ── MLP · 에너지인프라 (10) ──
            "KMI","WMB","OKE","ET","EPD","MPLX","PAA","AM","TRGP","CTRA",
            # ── 중국 ADR · 해외 (20) ──
            "BABA","JD","PDD","BIDU","NIO","XPEV","LI","TME","BILI","IQ",
            "ZTO","VIPS","TAL","EDU","FUTU","TIGR","DIDI","YMM","MNSO","WB",
            # ── 통신 · 미디어 (10) ──
            "T","VZ","TMUS","GOOGL","GOOG","NFLX","DIS","CMCSA","SPOT","ROKU",
            # ── 사이버보안 확장 (10) ──
            "S","RPD","TENB","QLYS","VRNS","CYBR","SAIL","RDOG","HACK","CIBR",
            # ── 핵심 중형 성장주 (30) ──
            "AXON","WYNN","MGM","LVS","MAR","HLT","H","RCL","CCL","NCLH",
            "LULU","DECK","CROX","BIRK","SMAR","CFLT","GTLB","ESTC","DDOG","NET",
            "TTD","MGNI","PUBM","DSP","IAS","DV","ZETA","BRZE","SEMR","CINT",
            # ── 헬스케어 확장 (20) ──
            "VEEV","DOCS","HIMS","GDRX","TDOC","AMWL","OSCR","ACCD","PHR","RCM",
            "PODD","TNDM","SWAV","PRCT","NVCR","INSP","ALGN","XRAY","HOLX","TECH",
            # ── 산업재 · 인프라 확장 (15) ──
            "WM","RSG","GNRC","TT","IR","CARR","OTIS","JCI","TRANE","AOS",
            "SWK","FAST","WSO","RBC","GGG",
            # ── 소프트웨어 · SaaS 확장 (20) ──
            "PCOR","ALTR","NCNO","FROG","FRSH","PTC","ANSS","AZPN","MANH","BSY",
            "APPF","JAMF","TENB","ZUO","EVBG","CWMS","INTA","ALKT","BMBL","MTTR",
            # ── ETF 대용 개별주 (15) ──
            "BX","KKR","APO","ARES","OWL","CG","BAM","TPG","HLNE","STEP",
            "LPLA","RJF","HOOD","IBKR","SCHW",
        ]
        for t in fallback:
            if t not in stocks:
                stocks[t] = {"label":t,"sector":"US","market":"us"}

    print(f"    📊 미국 총 {len(stocks)}개")
    return stocks

def load_watchlist():
    try:
        if os.path.exists("public/data/watchlist.json"):
            with open("public/data/watchlist.json","r",encoding="utf-8") as f:
                return json.load(f).get("stocks", DEFAULT_WATCHLIST)
    except:
        pass
    return DEFAULT_WATCHLIST

def fetch_pool_batch(pool, range_="3mo", batch_size=50, delay_between_batches=5):
    global _rate_limit_hits
    results = {}
    items = list(pool.items())
    total = len(items)
    success = 0
    fail = 0
    kis_ok = 0
    for batch_start in range(0, total, batch_size):
        batch = items[batch_start:batch_start + batch_size]
        batch_num = batch_start // batch_size + 1
        total_batches = (total + batch_size - 1) // batch_size
        print(f"\n  📦 배치 {batch_num}/{total_batches} ({batch_start+1}~{min(batch_start+batch_size, total)}/{total})")
        for i, (ticker, info) in enumerate(batch):
            suffix = info.get("suffix","")
            yt = ticker + suffix
            mkt = info.get("market","us")
            idx = batch_start + i + 1
            print(f"    [{idx}/{total}] {ticker:8s}... ", end="", flush=True)

            # ★ 한투 API로 현재가 먼저 시도
            kis_price = kis_fetch_price(ticker, mkt) if KIS_TOKEN else None

            # Yahoo로 캔들 데이터 (차트 분석용)
            raw = fetch_yahoo(yt, range_=range_)
            candles = None
            meta = {}
            if raw:
                try:
                    candles, meta = parse_candles(raw)
                except:
                    candles = None

            if not candles and not kis_price:
                print("❌")
                fail += 1
                time.sleep(0.3)
                continue

            try:
                # 가격: 한투 우선 → Yahoo 폴백
                if kis_price:
                    price = kis_price["price"]
                    changePct = kis_price["changePct"]
                    kis_ok += 1
                    src = "KIS"
                elif candles:
                    price = float(meta.get("regularMarketPrice") or candles[-1]["close"])
                    if len(candles) >= 2:
                        changePct = round((candles[-1]["close"] - candles[-2]["close"]) / candles[-2]["close"] * 100, 2)
                    else:
                        prev = float(meta.get("previousClose") or meta.get("chartPreviousClose") or price)
                        changePct = round((price-prev)/prev*100, 2) if prev else 0
                    src = "YHO"
                else:
                    continue

                mktCap = float(meta.get("marketCap") or 0)
                isKR = mkt == "kr"
                mktCapNorm = round(mktCap / 1e8, 1) if isKR else round(mktCap / 1e9, 2)
                results[ticker] = {
                    **{k:v for k,v in info.items() if k != "suffix"},
                    "ticker":ticker, "price":price,
                    "changePct":changePct,
                    "chg3d":calc_change(candles,3) if candles else 0,
                    "chg5d":calc_change(candles,5) if candles else 0,
                    "volRatio":calc_vol_ratio(candles) if candles else 100,
                    "mktCap":mktCapNorm,
                    "candles": candles or [],
                }
                print(f"✅ [{src}] {price:,.1f} ({changePct:+.1f}%)")
                success += 1
            except Exception as e:
                print(f"❌ {e}")
                fail += 1
            base_delay = 0.3
            if KIS_TOKEN: base_delay = 0.2  # 한투 있으면 Yahoo 부담 줄어서 빠르게
            if _rate_limit_hits > 10: base_delay = 1.5
            elif _rate_limit_hits > 5: base_delay = 1.0
            elif _rate_limit_hits > 2: base_delay = 0.7
            time.sleep(base_delay)
        if batch_start + batch_size < total:
            rest = delay_between_batches
            if _rate_limit_hits > 5: rest = 15
            elif _rate_limit_hits > 2: rest = 10
            print(f"  ⏸ 배치 간 {rest}초 대기 (요청 {_request_count}건, 리밋 {_rate_limit_hits}회)")
            time.sleep(rest)
    print(f"\n  📊 수집 결과: 성공 {success} / 실패 {fail} / 전체 {total}")
    if kis_ok:
        print(f"  🔑 한투 API 가격: {kis_ok}건 사용")
    return results

def main():
    now_str = datetime.now(timezone.utc).isoformat()
    print(f"\n{'='*60}")
    print(f"  Alpha Terminal [{MODE.upper()}] {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"{'='*60}\n")
    os.makedirs("public/data", exist_ok=True)

    existing = {}
    if os.path.exists("public/data/stocks.json"):
        try:
            with open("public/data/stocks.json","r") as f:
                existing = json.load(f)
        except:
            pass

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

    # ── 한투 API 토큰 ─────────────────────────────────────
    if KIS_APP_KEY and KIS_APP_SECRET:
        print("🔑 한투 API 연결 중...")
        kis_get_token()
    else:
        print("ℹ️ 한투 API 키 없음 — Yahoo 단독 모드")

    # ── 지수 ──────────────────────────────────────────────
    print("🌐 지수 수집...")
    for ticker, info in INDICES.items():
        print(f"  {info['label']:10s} ({ticker})... ", end="", flush=True)
        raw = fetch_yahoo(ticker, range_="1mo")
        if not raw:
            print("❌"); continue
        try:
            candles, meta = parse_candles(raw)
            price     = float(meta.get("regularMarketPrice") or (candles[-1]["close"] if candles else 0))
            prev      = float(meta.get("previousClose") or meta.get("chartPreviousClose") or price)
            changePct = round((price-prev)/prev*100, 2) if prev else 0
            output["indices"][ticker] = {
                **info, "ticker":ticker, "price":price, "changePct":changePct,
                "chg3d":calc_change(candles,3), "chg5d":calc_change(candles,5),
            }
            print(f"✅ {price:,.2f} ({changePct:+.2f}%)")
        except Exception as e:
            print(f"❌ {e}")
        time.sleep(0.5)

    if MODE == "quarterly":
        print("\n📊 분기 재무데이터 수집은 현재 비활성화됨")
        path = "public/data/stocks.json"
        with open(path,"w",encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, separators=(",",":"))
        return

    if MODE == "daily":
        print(f"\n📦 전체 종목 풀 수집 중...")
        pool = {}
        pool.update(get_krx_volume_top(300))
        pool.update(get_us_stocks())

        watchlist = load_watchlist()
        for ticker, info in watchlist.items():
            if ticker not in pool:
                pool[ticker] = info
                print(f"  ➕ 관심종목 추가: {ticker} ({info.get('label','')})")

        kr_pool = sum(1 for t,v in pool.items() if v.get("market")=="kr")
        us_pool = len(pool) - kr_pool
        print(f"  총 {len(pool)}개 종목 대상 (🇰🇷{kr_pool} 🇺🇸{us_pool})\n")
        pool_data = fetch_pool_batch(pool, range_="3mo", batch_size=50, delay_between_batches=5)

        # ★ 수집 결과 분포 확인
        kr_ok = sum(1 for t,v in pool_data.items() if v.get("market")=="kr")
        us_ok = len(pool_data) - kr_ok
        print(f"\n  📊 수집 성공 분포: 🇰🇷{kr_ok} 🇺🇸{us_ok} (총 {len(pool_data)}개)")
        if us_ok < 10:
            print(f"  ⚠️ US 종목 부족! Yahoo 레이트리밋 가능성 — 배치 딜레이 증가 필요")

        # RS 랭킹
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

        # ★ 상위 100개 종목은 캔들 포함 저장 (ST/MACD/구름 분석용)
        # RS 상위 50 + 알파점수 상위 50 합산 (중복 제거)
        candle_keepers = set()
        rs_sorted = sorted(pool_data.items(), key=lambda x: x[1].get("rsPctRank",0), reverse=True)
        for t, _ in rs_sorted[:50]:
            candle_keepers.add(t)
        for hit in alpha_hits[:50]:
            candle_keepers.add(hit["ticker"])
        # 관심종목도 무조건 포함
        watchlist = load_watchlist()
        for t in watchlist:
            candle_keepers.add(t)
        print(f"\n📊 캔들 보존 대상: {len(candle_keepers)}개 (RS상위50 + 알파50 + 관심종목)")

        pool_slim = {}
        for ticker, stock in pool_data.items():
            if ticker in candle_keepers:
                # 캔들 포함 저장 → stocks에도 넣기
                output["stocks"][ticker] = stock
                pool_slim[ticker] = {k:v for k,v in stock.items() if k != "candles"}
                pool_slim[ticker]["hasCandles"] = True
            else:
                pool_slim[ticker] = {k:v for k,v in stock.items() if k != "candles"}
        output["pool"] = pool_slim

        with open("public/data/alpha_hits.json", "w", encoding="utf-8") as f:
            json.dump({"hits":alpha_hits[:50],"count":len(alpha_hits),"scanned":len(pool_data),"updatedAt":now_str}, f, ensure_ascii=False, separators=(",",":"))

        # 관심종목 중 풀에 없는 것만 별도 수집
        print(f"\n⭐ 관심종목 추가 수집...")
        for ticker, info in watchlist.items():
            if ticker in pool_data and pool_data[ticker].get("candles"):
                print(f"  {ticker} ✅ (이미 포함)")
            elif ticker not in output["stocks"]:
                suffix = info.get("suffix","")
                raw = fetch_yahoo(ticker+suffix, range_="6mo")
                if raw:
                    try:
                        candles, meta = parse_candles(raw)
                        price = float(meta.get("regularMarketPrice") or candles[-1]["close"])
                        prev  = float(meta.get("previousClose") or meta.get("chartPreviousClose") or price)
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
    else:
        print("\n⭐ 관심종목 현재가 업데이트...")
        watchlist = load_watchlist()
        for ticker, info in watchlist.items():
            suffix = info.get("suffix","")
            raw = fetch_yahoo(ticker+suffix)
            if not raw: continue
            try:
                candles, meta = parse_candles(raw)
                price     = float(meta.get("regularMarketPrice") or candles[-1]["close"])
                prev      = float(meta.get("previousClose") or meta.get("chartPreviousClose") or price)
                changePct = round((price-prev)/prev*100,2) if prev else 0
                output["stocks"][ticker] = {
                    **{k:v for k,v in (output["stocks"].get(ticker, info)).items()},
                    "price":price,"changePct":changePct,
                    "chg3d":calc_change(candles,3),"chg5d":calc_change(candles,5),
                    "volRatio":calc_vol_ratio(candles),"candles":candles,"updatedAt":now_str,
                }
                print(f"  {ticker} ✅ {price:,.2f} ({changePct:+.2f}%)")
            except Exception as e:
                print(f"  {ticker} ❌ {e}")
            time.sleep(0.5)

    # ── 섹터 ETF ──────────────────────────────────────────
    print("\n📊 섹터 ETF 수집 중...")
    sectors_data = {}
    for etf_ticker, etf_info in {**US_SECTOR_ETFS, **KR_SECTOR_ETFS}.items():
        raw = fetch_yahoo(etf_ticker, range_="1mo")
        if not raw: continue
        try:
            candles, meta = parse_candles(raw)
            price = float(meta.get("regularMarketPrice") or candles[-1]["close"])
            prev  = float(meta.get("previousClose") or meta.get("chartPreviousClose") or price)
            chg1d = round((price-prev)/prev*100, 2) if prev else 0
            mkt = "kr" if ".KS" in etf_ticker else "us"
            sectors_data[etf_ticker] = {
                **etf_info, "etf":etf_ticker, "market":mkt, "price":price, "chg1d":chg1d,
                "chg1W":calc_change(candles, 5), "chg1M":calc_change(candles, 21),
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
            "kr":{"up":kr_up,"down":kr_down,"total":kr_total,"upPct":round(kr_up/kr_total*100,1) if kr_total else 0},
            "us":{"up":us_up,"down":us_down,"total":us_total,"upPct":round(us_up/us_total*100,1) if us_total else 0},
            "updatedAt":now_str,
        }
        print(f"  🇰🇷 상승 {kr_up} / 하락 {kr_down}")
        print(f"  🇺🇸 상승 {us_up} / 하락 {us_down}")

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
