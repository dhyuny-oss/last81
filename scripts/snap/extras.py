"""263. ④ 덧붙이는 자료 — 재무(financials_us.json) · 실적일 · 목표가 · 분기 매출 · 종목풀 읽기"""
from snap.common import *  # noqa
from snap.fetch import *  # noqa
from snap.indicators import *  # noqa
from snap.market import *  # noqa


# ══════════════════════════════════════════════════════════════
# DC(퇴직연금) — 국내 상장 ETF 로 사고, 판단은 미국 원본 ETF 신호로
# ══════════════════════════════════════════════════════════════
# 퇴직연금 계좌는 국내 상장 ETF 만 살 수 있고(위험자산 70% 한도, 레버리지·인버스 불가),
# 합성(스왑) ETF 는 증권사에 따라 막힐 수 있습니다 → synth=True 로 표시합니다.
# 코드는 야후에서 상품명을 직접 조회해 확인했습니다(2026-09-17).
# 판단은 미국 원본으로 합니다 — 국내 상품은 2020~2023년 상장이라 이력이 짧고,
#   원화 환산 신호(샤프 0.64)보다 원본 신호(0.69)가 검증에서 조금 나았습니다.
DC_US = [   # (미국 원본, 국내 코드, 국내 상품, 라벨, 합성)
    ("SPY",  "360750", "TIGER 미국S&P500",            "S&P500",     False),
    ("QQQ",  "133690", "TIGER 미국나스닥100",          "나스닥100",   False),
    ("XLK",  "463680", "KODEX 미국S&P500 테크놀로지",   "기술",       False),
    ("SMH",  "381180", "TIGER 미국필라델피아반도체나스닥", "반도체",     False),
    ("XLF",  "453650", "KODEX 미국S&P500 금융",         "금융",       False),
    ("XLV",  "453640", "KODEX 미국S&P500 헬스케어",      "헬스케어",    False),
    ("XLY",  "453660", "KODEX 미국S&P500 경기소비재",    "소비재",      False),
    ("XLP",  "453630", "KODEX 미국S&P500 필수소비재",    "필수소비",    False),
    ("XLU",  "463640", "KODEX 미국S&P500 유틸리티",      "유틸리티",    False),
    ("XLC",  "463690", "KODEX 미국S&P500 커뮤니케이션",   "커뮤니케이션", False),
    ("XLE",  "218420", "KODEX 미국S&P500에너지(합성)",   "에너지",      True),
    ("XLI",  "200030", "KODEX 미국S&P500산업재(합성)",   "산업재",      True),
    ("XLB",  None,     None,                          "소재",       False),
    ("XLRE", None,     None,                          "부동산",      False),
]
DC_KR = ("069500", "KODEX 200")
KR_SECT = [
    ("091160", "KODEX 반도체"), ("139260", "TIGER 200 IT"), ("305720", "KODEX 2차전지산업"),
    ("091170", "KODEX 은행"), ("102970", "KODEX 증권"), ("140700", "KODEX 보험"),
    ("091180", "KODEX 자동차"), ("139230", "TIGER 200 중공업"), ("117700", "KODEX 건설"),
    ("117460", "KODEX 에너지화학"), ("117680", "KODEX 철강"), ("143860", "TIGER 헬스케어"),
    ("244580", "KODEX 바이오"), ("157490", "TIGER 소프트웨어"), ("140710", "KODEX 운송"),
    ("266410", "KODEX 필수소비재"), ("266390", "KODEX 경기소비재"),
]
DC_WEIGHTS = {"nq": 0.2333, "us": 0.2333, "kr": 0.2333, "safe": 0.30}   # 230. 느린ST 규칙도 3지수 (예전 S&P 35 · 코스피 35)

SEC_CACHE = f"{OUT_DIR}/sec_rev.json"
TGT_CACHE = f"{OUT_DIR}/targets.json"

def attach_targets(stocks, prot):
    """74. 🇺🇸 애널리스트 목표가 (나스닥 공개 API) — 참고용, 매매 규칙에는 쓰지 않음.
       매수!·보유·관심 종목만, 7일 지난 것만 새로 받음 (한 번에 최대 80개 · 요청 사이 0.25초)"""
    import datetime as _dt, urllib.request as _u
    try:
        cache = json.load(open(TGT_CACHE, encoding="utf-8"))
    except Exception:
        cache = {}
    today = _dt.date.today().isoformat()
    want = [t for t, d in stocks.items() if d["m"] == "us" and (d.get("action") == "buy" or t in prot)]
    stale = [t for t in want if (_dt.date.today() - _dt.date.fromisoformat(cache.get(t, {}).get("d", "2000-01-01"))).days > 7][:80]
    got = 0
    for t in stale:
        try:
            r = _u.urlopen(_u.Request(f"https://api.nasdaq.com/api/analyst/{t}/targetprice",
                                      headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"}), timeout=12)
            c = ((json.load(r).get("data") or {}).get("consensusOverview") or {})
            num = lambda k: (float(c[k]) if c.get(k) not in (None, "", "N/A") else None)
            if num("priceTarget"):
                cache[t] = {"a": num("priceTarget"), "h": num("highPriceTarget"), "l": num("lowPriceTarget"),
                            "b": c.get("buy"), "hd": c.get("hold"), "s": c.get("sell"), "d": today}
                got += 1
            else:
                cache[t] = {"d": today}                       # 목표가 없음 — 7일 뒤 다시
        except Exception:
            pass
        time.sleep(0.25)
    if got or stale:
        _write(TGT_CACHE, cache)
    n = 0
    for t, d in stocks.items():
        x = cache.get(t)
        if x and x.get("a"):
            d["tgt"] = {k: x.get(k) for k in ("a", "h", "l", "b", "hd", "s", "d")}; n += 1
    print(f"  🎯 애널리스트 목표가: {n}종목 (이번에 새로 {got})")

EARN_CACHE = f"{OUT_DIR}/earnings.json"

def attach_earnings(stocks, universe_all=None, market=None):
    """110·111. 같은 요청으로 🇺🇸 PER(최근 12개월)·예상 PER 도 받습니다 — 참고 표시용.
       종목: d["pe"] · d["fpe"] (적자·자료 없음이면 없음). 업종: 종목풀 '전체' 🇺🇸 종목의 중앙값을 market["sectors"] 에 pe·fpe·n 으로 붙입니다
       (평일 간이 수집는 강한 종목만 보므로, 업종 중앙값은 전체 종목풀을 따로 조회해 계산). 🇰🇷 은 야후에 PER 이 없습니다.
       93. 다음 실적 발표일 (야후 공개 시세 API) — 참고 표시용, 매매 규칙에는 쓰지 않음 (과거 발표일 자료가 없어 검증 불가).
       한 번에 150종목씩 묶어 받습니다(약 6번 요청). 실패하면 지난번 값 중 아직 지나지 않은 날짜만 씁니다.
       날짜는 그 시장 현지 날짜 (🇺🇸 뉴욕 · 🇰🇷 서울). earnE = 회사가 확정 안 한 '예상일'"""
    import http.cookiejar as _cj, urllib.request as _u
    from zoneinfo import ZoneInfo
    TZ = {"us": ZoneInfo("America/New_York"), "kr": ZoneInfo("Asia/Seoul")}
    now = time.time()
    try:
        cache = json.load(open(EARN_CACHE, encoding="utf-8"))
    except Exception:
        cache = {}
    ysym = {}
    for t, d in stocks.items():
        ysym[(t + (d.get("ex") or ".KS")) if d["m"] == "kr" else t.replace(".", "-")] = t
    for t, v in (universe_all or {}).items():                     # 업종 PER 용 — 스냅샷에 없는 🇺🇸 종목도 조회
        if v.get("market") == "us" and t not in stocks: ysym.setdefault(t.replace(".", "-"), t)
    fresh, ok, val = {}, False, {}
    past = dict(cache.get("p") or {})        # 199. 지난 실적 발표일 (발표가 지나면 여기로 — 발표 뒤 주가 반응 계산용, 종목당 최근 4번)
    xdiv = {}                                # 199. 다음 배당락일
    pos = lambda x: round(float(x), 1) if isinstance(x, (int, float)) and 0 < x < 5000 else None
    try:
        jar = _cj.CookieJar()
        op = _u.build_opener(_u.HTTPCookieProcessor(jar))
        op.addheaders = [("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36")]
        try:
            op.open("https://fc.yahoo.com", timeout=10)            # 쿠키만 받으면 됨 (404 가 정상)
        except Exception:
            pass
        crumb = op.open("https://query2.finance.yahoo.com/v1/test/getcrumb", timeout=10).read().decode().strip()
        if not crumb or "<" in crumb: raise RuntimeError("crumb")
        keys = list(ysym)
        for i in range(0, len(keys), 150):
            b = keys[i:i + 150]
            u = ("https://query2.finance.yahoo.com/v7/finance/quote?symbols=" + ",".join(b) + f"&crumb={crumb}"
                 "&fields=earningsTimestampStart,earningsTimestamp,isEarningsDateEstimate,trailingPE,forwardPE,exDividendDate")
            r = json.load(op.open(u, timeout=20))
            for q in (r.get("quoteResponse") or {}).get("result") or []:
                t = ysym.get(q.get("symbol"))
                if not t: continue
                pe, fpe = pos(q.get("trailingPE")), pos(q.get("forwardPE"))
                if pe or fpe: val[t] = [pe, fpe]
                if t not in stocks: continue
                ts = q.get("earningsTimestampStart") or q.get("earningsTimestamp")
                if ts and ts > now - 86400:                       # 이미 지난 발표는 버림
                    day = datetime.fromtimestamp(ts, TZ[stocks[t]["m"]]).strftime("%Y-%m-%d")
                    fresh[t] = [day, 1 if q.get("isEarningsDateEstimate") else 0]
                for _k in ("earningsTimestamp", "earningsTimestampStart"):   # 199. 막 지난 발표일은 기록해 둠
                    _ts = q.get(_k)
                    if _ts and now - 120 * 86400 < _ts <= now and not q.get("isEarningsDateEstimate"):
                        _day = datetime.fromtimestamp(_ts, TZ[stocks[t]["m"]]).strftime("%Y-%m-%d")
                        if _day not in (past.get(t) or []): past[t] = sorted((past.get(t) or []) + [_day])[-4:]
                _xd = q.get("exDividendDate")
                if _xd and _xd > now - 86400:
                    xdiv[t] = datetime.fromtimestamp(_xd, TZ[stocks[t]["m"]]).strftime("%Y-%m-%d")
            ok = True
            time.sleep(0.3)
    except Exception as e:
        print(f"  📅 실적 발표일: 받기 실패 ({str(e)[:60]}) — 지난번 값 사용")
    base = fresh if ok else (cache.get("e") or {})
    if not ok: xdiv = cache.get("x") or {}
    for t, d in stocks.items():                                    # 199. 배당락일 · 지난 발표일
        today_local = datetime.now(TZ[d["m"]]).strftime("%Y-%m-%d")
        if xdiv.get(t) and xdiv[t] >= today_local: d["exDiv"] = xdiv[t]
        if past.get(t): d["earnPast"] = past[t][-1]
    n = 0
    for t, d in stocks.items():
        x = base.get(t)
        if not x: continue
        today_local = datetime.now(TZ[d["m"]]).strftime("%Y-%m-%d")
        if x[0] < today_local: continue                            # 캐시에 남은 지난 날짜
        d["earn"] = x[0]
        if x[1]: d["earnE"] = 1
        n += 1
    # PER — 받기에 실패하면 지난번 값
    if not ok: val = cache.get("v") or {}
    npe = 0
    for t, d in stocks.items():
        x = val.get(t)
        if not x: continue
        if x[0]: d["pe"] = x[0]
        if x[1]: d["fpe"] = x[1]
        npe += 1
    # 업종 중앙값 (종목풀 전체 🇺🇸 · GICS 업종 → 섹터 ETF 키)
    if market is not None and val:
        import statistics as _st
        grp = {}
        sec_of = lambda t: _SECTOR_FIX.get(t) or (stocks.get(t) or {}).get("s") or ((universe_all or {}).get(t) or {}).get("sector") or ""
        for t, x in val.items():
            k = GICS_TO_ETF.get(sec_of(t))
            if not k: continue
            g = grp.setdefault(k, [[], []])
            if x[0]: g[0].append(x[0])
            if x[1]: g[1].append(x[1])
        for x in (market.get("sectors") or []):
            g = grp.get(x.get("tk"))
            if g and len(g[1]) >= 3:
                x["pe"] = round(_st.median(g[0]), 1) if len(g[0]) >= 3 else None
                x["fpe"] = round(_st.median(g[1]), 1)
                x["n"] = len(g[1])
    if ok:
        keep = {t: v for t, v in (cache.get("e") or {}).items() if t not in stocks}   # 간이 수집에서 안 본 종목은 지난 값 유지
        keep.update(fresh)
        _write(EARN_CACHE, {"d": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "e": keep, "v": val, "p": past, "x": xdiv})
    print(f"  📅 실적 발표일: {n}종목 · PER {npe}종목")

def attach_earn_rx(stocks, series):
    """199. 지난 실적 발표 뒤 주가 반응 — 발표 전날 종가 → 발표 다음 거래일 종가 (장 전·장 뒤 발표 모두 포함하는 이틀 구간)"""
    n = 0
    for t, d in stocks.items():
        p = d.get("earnPast"); rows = series.get(t)
        if not p or not rows: continue
        off = 9 * 3600 if d["m"] == "kr" else 0
        days = [datetime.fromtimestamp(r[0] + off, timezone.utc).strftime("%Y-%m-%d") for r in rows]
        i = next((k for k, x in enumerate(days) if x >= p), None)
        if i is None or i == 0 or i + 1 >= len(rows): continue
        before, after = rows[i - 1][1], rows[i + 1][1] if days[i] == p else rows[i][1]
        if before and after:
            d["earnRx"] = _r((after / before - 1) * 100, 1); n += 1
    if n: print(f"  📅 지난 실적 발표 뒤 반응: {n}종목")

def attach_quarterly(stocks, refresh=False):
    """51. 분기 매출 성장 (SEC 공시) — 최근 분기 전년 동기 대비가 기본, 없으면 4분기 합계, 그것도 없으면 연간.
       전체 스캔(토요일·수동)이거나 캐시가 6일 넘으면 새로 받습니다 (약 15초·10MB)."""
    import datetime as _dt
    cache = {}
    try:
        cache = json.load(open(SEC_CACHE, encoding="utf-8"))
    except Exception:
        pass
    age = 99
    try:
        age = (_dt.date.today() - _dt.date.fromisoformat(cache.get("asOf", "2000-01-01"))).days
    except Exception:
        pass
    if refresh or age > 6 or not cache.get("data"):
        try:
            import universe as U
            us = [t for t, d in stocks.items() if d["m"] == "us"]
            got = U.sec_revenue(us)
            if len(got) > 50:
                cache = {"asOf": _dt.date.today().isoformat(), "data": got}
                _write(SEC_CACHE, cache)
                print(f"  📊 분기 매출(SEC): {len(got)}종목 새로 받음")
        except Exception as e:
            print("  ⚠️ 분기 매출 수신 실패 — 지난 값 사용:", e)
    data = cache.get("data") or {}
    n = 0
    for t, d in stocks.items():
        q = data.get(t)
        if not q: continue
        f = d.setdefault("fin", {})
        f.update({"qyoy": q.get("yoy"), "qprev": q.get("prev"), "ttm": q.get("ttm"), "accel": q.get("accel"), "q": q.get("q")})
        n += 1
    for d in stocks.values():   # 필터·정렬이 쓰는 대표 성장률: 분기 → 4분기 → 연간
        f = d.get("fin")
        if f: f["growth"] = next((x for x in (f.get("qyoy"), f.get("ttm"), f.get("rev")) if x is not None), None)
    print(f"  📊 분기 매출 붙임: {n}종목 (캐시 {cache.get('asOf')})")

def load_universe():
    """① 종목풀 — universe.json (scripts/build_universe.py 가 만듦)"""
    try:
        return json.load(open(f"{OUT_DIR}/universe.json", encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit("❌ 종목풀(universe.json)이 없습니다 — scripts/build_universe.py 를 먼저 실행하세요")


def load_fin():
    """② 미국 재무 — financials_us.json 의 data (scripts/fetch_financials_us.py 가 만듦)"""
    return json.load(open(f"{OUT_DIR}/financials_us.json", encoding="utf-8")).get("data") or {}


def fin_flags(stocks):
    """미국 재무 참고 배지 — financials_us.json(연간 2개년)에서. 검증 불가라 조건이 아니라 '참고'입니다."""
    try:
        fin = load_fin()
    except Exception:
        fin = {}
    n = 0
    for tk, d in stocks.items():
        f = fin.get(tk)
        if not isinstance(f, dict): continue
        inc = f.get("income") or {}
        la, pr = inc.get("latest") or {}, inc.get("prior") or {}
        rev, rev0 = la.get("revenue"), pr.get("revenue")
        ni, op = la.get("netIncome"), la.get("operatingIncome")
        d["fin"] = {
            "rev": _r((rev / rev0 - 1) * 100, 1) if rev and rev0 else None,     # 매출 전년比 %
            "opm": _r(op / rev * 100, 1) if op is not None and rev else None,   # 영업이익률 %
            "prof": (ni is not None and ni > 0),                                 # 흑자 여부
            "fy": la.get("endDate"),
        }
        n += 1
    print(f"  📑 재무 배지: {n}종목 (미국, 참고용)")

__all__ = [n for n in dir() if not n.startswith("__")]   # 밑줄 이름(_r · _write …)도 다음 단계가 쓰도록 내보냄
