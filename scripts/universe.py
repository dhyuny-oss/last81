"""
종목풀 기준 — 주간 수집(fetch_yahoo)과 매일 계산(build_snapshot)이 같은 기준을 씁니다.

출처 (모두 무료·키 없음)
  🇰🇷 한국투자증권 공개 종목 마스터  — 공식 한글명 · 시가총액 · 거래정지 · 관리종목 · 시장경고 · 정리매매 · 우선주 · SPAC · 리츠/ETF 구분 · 전일 거래량
  🇺🇸 위키백과 S&P500 목록            — 티커 · GICS 업종
      나스닥 공개 스크리너             — 미국 상장 전 종목 시가총액 · 당일 거래대금 (ETF 는 목록에 없음)

기준 (2026-09-23 확정)
  🇰🇷 보통주만(우선주·SPAC·리츠·ETF 제외) · 거래정지/정리매매/관리종목/시장경고 제외 · 시총 3,000억 이상
      → (전일 거래대금 상위 150) ∪ (시총 상위 150)  ≈ 200종목
      거래대금만 쓰면 HMM·KT·크래프톤 같은 대형주가 하루 한산하면 빠지고 매주 들락날락해서, 시총 상위를 함께 둡니다
  🇺🇸 S&P500 전부 + (시총 $25B 이상 · 당일 거래대금 $50M 이상)  ≈ 645종목 — 밈주식·코인채굴·테마 ETF·소형주가 빠짐
  공통: 보유·관심·앱에서 추가·tickers_extra 는 보호 (기준과 무관하게 유지), 앱에서 '빼기' 한 종목은 제외
"""
import io, json, re, zipfile, urllib.request

KR_TOP_TV     = 150           # 거래대금 상위
KR_TOP_MCAP   = 150           # 시총 상위 (합집합)
KR_MIN_MCAP   = 3000          # 억원
US_MIN_MCAP   = 25e9          # 달러 (S&P500 밖 종목에만)
US_MIN_TV     = 50e6          # 달러 (당일 거래대금, S&P500 밖 종목에만)
UA = {"User-Agent": "Mozilla/5.0"}

# ── 한투 종목 마스터 ─────────────────────────────────────────────
_MST = "https://new.real.download.dws.co.kr/common/master/{m}_code.mst.zip"
_SPEC = {   # (끝부분 길이, 필드 폭) — 한투 공식 샘플 코드 기준. 줄바꿈 제외라 공식 값 −1
 "kospi": (227, [2,1,4,4,4,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,9,5,5,1,1,1,2,1,1,1,2,2,2,3,1,3,12,12,8,15,21,2,7,1,1,1,1,1,9,9,9,5,9,8,9,3,1,1,1],
   ['grp','capsz','i1','i2','i3','mfg','lowliq','gov','k200s','k100','k50','krx','etp','elw','krx100','ka','ks','kb','kbank','spac','ke','kst','hot','kmed','kcon','n1','ksec','kship','kins','ktr','sri','base','unit','ounit','halt','clear','admin','warn','warnpre','unfaith','backdoor','lock','par','inc','margin','credit','crd','pvol','face','listed','shares','capital','fym','ipo','pref','shorthot','surge','krx300','kospi','sales','op','ord','net','roe','ym','mcap','grpcode','crdx','loan','lend']),
 "kosdaq": (221, [2,1,4,4,4,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,9,5,5,1,1,1,2,1,1,1,2,2,2,3,1,3,12,12,8,15,21,2,7,1,1,1,1,9,9,9,5,9,8,9,3,1,1,1],
   ['grp','capsz','i1','i2','i3','venture','lowliq','krx','etp','krx100','ka','ks','kb','kbank','spac','ke','kst','hot','kmed','kcon','caution','ksec','kship','kins','ktr','kq150','base','unit','ounit','halt','clear','admin','warn','warnpre','unfaith','backdoor','lock','par','inc','margin','credit','crd','pvol','face','listed','shares','capital','fym','ipo','pref','shorthot','surge','krx300','sales','op','ord','net','roe','ym','mcap','grpcode','crdx','loan','lend']),
}

def _get(url, timeout=40):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()

def kr_master():
    """{코드: {name, suffix(.KS/.KQ), grp, halt, clear, admin, warn, spac, pref, mcap(억), tv(전일 거래대금 원)}} — 실패하면 {}"""
    out = {}
    for m, suf in (("kospi", ".KS"), ("kosdaq", ".KQ")):
        try:
            z = zipfile.ZipFile(io.BytesIO(_get(_MST.format(m=m))))
            data = z.read(z.namelist()[0]).decode("cp949", errors="replace")
        except Exception as e:
            print(f"  ⚠️ 한투 마스터({m}) 수신 실패: {e}")
            continue
        tail, widths, cols = _SPEC[m]
        for line in data.splitlines():
            if len(line) < tail + 21: continue
            p1, p2 = line[:-tail], line[-tail:]
            code, name = p1[0:9].strip(), p1[21:].strip()
            if not (len(code) == 6 and code.isdigit()): continue
            v, pos = {}, 0
            for w, c in zip(widths, cols):
                v[c] = p2[pos:pos + w].strip(); pos += w
            def n(k):
                try: return int(v.get(k) or 0)
                except ValueError: return 0
            out[code] = {"name": name, "suffix": suf, "grp": v["grp"],
                         "halt": v["halt"] == "Y", "clear": v["clear"] == "Y", "admin": v["admin"] == "Y",
                         "warn": v["warn"] not in ("", "00"), "spac": v["spac"] == "Y",
                         "pref": v["pref"] not in ("", "0"), "mcap": n("mcap"), "tv": n("pvol") * n("base")}
    return out

def kr_status_reason(x):
    """입구에서 빼는 사유 (없으면 None) — 보유·관심·추가 종목에는 적용하지 않습니다"""
    if not x: return "공식 명단에 없음(상장폐지·코드 오류)"
    if x["grp"] != "ST": return {"EF": "ETF", "RT": "리츠", "EN": "ETN"}.get(x["grp"], "주식 아님")
    if x["spac"]: return "SPAC"
    if x["pref"]: return "우선주"
    if x["halt"]: return "거래정지"
    if x["clear"]: return "정리매매"
    if x["admin"]: return "관리종목"
    if x["warn"]: return "투자경고·위험"
    if x["mcap"] < KR_MIN_MCAP: return f"시총 {KR_MIN_MCAP:,}억 미만"
    return None

def build_kr_pool(master, n_tv=KR_TOP_TV, n_mc=KR_TOP_MCAP):
    """적격 보통주 중 (거래대금 상위 n_tv) ∪ (시총 상위 n_mc) — 반환 (pool, 사유별 제외 수)"""
    reasons, ok = {}, []
    for code, x in master.items():
        r = kr_status_reason(x)
        if r:
            if x.get("grp") == "ST": reasons[r] = reasons.get(r, 0) + 1
            continue
        ok.append((code, x))
    pick = dict(sorted(ok, key=lambda kv: -kv[1]["tv"])[:n_tv])
    pick.update(dict(sorted(ok, key=lambda kv: -kv[1]["mcap"])[:n_mc]))
    pool = {c: {"label": x["name"], "sector": "Korean", "market": "kr", "suffix": x["suffix"], "mcap": x["mcap"]}
            for c, x in pick.items()}
    return pool, reasons

# ── 미국 ─────────────────────────────────────────────────────────
def sp500():
    """{티커: GICS 업종} — 위키백과. 실패하면 {}"""
    try:
        html = _get("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies").decode("utf-8", "replace")
        rows = re.findall(r'<a[^>]+>([A-Z.]{1,6})</a></td>\s*<td[^>]*><a[^>]+>([^<]+)</a></td>\s*<td[^>]*>([^<]+)</td>', html)
        return {t.replace(".", "-"): (n.strip(), s.strip()) for t, n, s in rows}
    except Exception as e:
        print(f"  ⚠️ S&P500 목록 실패: {e}"); return {}

NASDAQ_TO_GICS = {   # 나스닥 스크리너 업종 → GICS 이름 (섹터 ETF 연결용 근사)
    "Technology": "Information Technology", "Finance": "Financials", "Health Care": "Health Care",
    "Consumer Discretionary": "Consumer Discretionary", "Consumer Staples": "Consumer Staples",
    "Industrials": "Industrials", "Energy": "Energy", "Utilities": "Utilities", "Real Estate": "Real Estate",
    "Basic Materials": "Materials", "Telecommunications": "Communication Services",
}

def us_screener():
    """{티커: {name, mcap, tv, sector}} — 나스닥 공개 스크리너 (ETF 없음). 실패하면 {}"""
    try:
        j = json.loads(_get("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true").decode())
        out = {}
        for x in j["data"]["rows"]:
            t = x["symbol"].strip().replace("/", "-")
            if "^" in t or not t: continue
            def f(k):
                try: return float(str(x.get(k) or 0).replace("$", "").replace(",", ""))
                except ValueError: return 0.0
            out[t] = {"name": x.get("name", ""), "mcap": f("marketCap"), "tv": f("lastsale") * f("volume"), "sector": x.get("sector", "")}
        return out
    except Exception as e:
        print(f"  ⚠️ 나스닥 스크리너 실패: {e}"); return {}

def build_us_pool(sp, scr):
    """S&P500 전부 + (시총 $25B↑ · 거래대금 $50M↑). 반환 (pool, 사유별 제외 수)"""
    pool, reasons = {}, {}
    for t, (name, gics) in sp.items():
        pool[t] = {"label": name[:30], "sector": gics, "market": "us", "mcap": (scr.get(t) or {}).get("mcap")}
    for t, x in scr.items():
        if t in pool: continue
        if x["mcap"] < US_MIN_MCAP: reasons["시총 $25B 미만"] = reasons.get("시총 $25B 미만", 0) + 1; continue
        if x["tv"] < US_MIN_TV: reasons["거래대금 $50M 미만"] = reasons.get("거래대금 $50M 미만", 0) + 1; continue
        pool[t] = {"label": re.sub(r"\s+(Common Stock|Class [A-C].*|American Depositary.*|Ordinary Shares.*)$", "", x["name"])[:30],
                   "sector": NASDAQ_TO_GICS.get(x["sector"], ""), "market": "us", "mcap": x["mcap"]}
    return pool, reasons

if __name__ == "__main__":
    M = kr_master(); kp, kr_r = build_kr_pool(M)
    print("한국 마스터", len(M), "→ 풀", len(kp), "| 제외", kr_r)
    S = sp500(); X = us_screener(); up, us_r = build_us_pool(S, X)
    print("미국 S&P", len(S), "스크리너", len(X), "→ 풀", len(up), "| 제외", us_r)

# ── 51. 미국 분기 매출 (SEC 공시 · frames API — 분기 하나에 전 회사, 0.4MB) ─────────
SEC_UA = {"User-Agent": "AlphaTerminal personal research contact@example.com", "Accept-Encoding": "identity"}
REV_TAGS = ("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet")

def _sec(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=SEC_UA), timeout=60).read())

def sec_revenue(tickers, today=None):
    """{티커: {q, yoy, prev, ttm, accel}} — 최근 분기 매출의 전년 동기 대비(%), 직전 분기의 같은 값, 최근 4분기 합계 전년 대비, 가속 여부.
       해외 ADR(20-F 공시)은 SEC 분기 데이터가 없어 빠집니다 → 연간 값으로 폴백."""
    import datetime as _dt, time as _t
    today = today or _dt.date.today()
    cik_of = {}
    try:
        for v in _sec("https://www.sec.gov/files/company_tickers.json").values():
            cik_of[v["ticker"].upper().replace(".", "-")] = int(v["cik_str"])
    except Exception as e:
        print(f"  ⚠️ SEC 티커 목록 실패: {e}"); return {}
    y, q = today.year, (today.month - 1) // 3 + 1
    qs = []
    for _ in range(10):                       # 최근 10개 달력 분기
        q -= 1
        if q == 0: y, q = y - 1, 4
        qs.append((y, q))
    qs = qs[::-1]
    years = sorted({a for a, _ in qs})
    data = {}                                 # cik → {frame: val}
    for tag in REV_TAGS:
        for fr in [f"CY{a}Q{b}" for a, b in qs] + [f"CY{a}" for a in years]:
            try:
                for r in _sec(f"https://data.sec.gov/api/xbrl/frames/us-gaap/{tag}/USD/{fr}.json")["data"]:
                    data.setdefault(r["cik"], {}).setdefault(fr, r["val"])     # 앞 태그 우선
            except Exception:
                pass
            _t.sleep(0.12)                    # SEC 권장 속도(초당 10회) 아래
    out = {}
    for t in tickers:
        c = cik_of.get(t.upper())
        if not c or c not in data: continue
        f = data[c]
        for a in years:                        # 4분기가 연간 보고서에만 있으면 연간 − (1~3분기)
            k4 = f"CY{a}Q4"
            if k4 not in f and f"CY{a}" in f and all(f"CY{a}Q{i}" in f for i in (1, 2, 3)):
                f[k4] = f[f"CY{a}"] - sum(f[f"CY{a}Q{i}"] for i in (1, 2, 3))
        keys = [f"CY{a}Q{b}" for a, b in qs]
        have = [k for k in keys if f.get(k)]
        if not have: continue
        last = have[-1]
        if keys.index(last) < len(keys) - 3: continue    # 최근 3개 분기 안에 값이 없으면 오래된 것
        def yoy_of(k):
            a, b = int(k[2:6]), int(k[7])
            p = f.get(f"CY{a-1}Q{b}")
            return round((f[k] / p - 1) * 100, 1) if (p and f.get(k) and p > 0) else None
        yoy = yoy_of(last)
        i = keys.index(last)
        prev = yoy_of(keys[i - 1]) if i >= 1 and f.get(keys[i - 1]) else None
        ttm = None
        if i >= 7 and all(f.get(keys[j]) for j in range(i - 7, i + 1)):
            now4 = sum(f[keys[j]] for j in range(i - 3, i + 1)); pre4 = sum(f[keys[j]] for j in range(i - 7, i - 3))
            ttm = round((now4 / pre4 - 1) * 100, 1) if pre4 > 0 else None
        if yoy is None and ttm is None: continue
        out[t] = {"q": last, "yoy": yoy, "prev": prev, "ttm": ttm,
                  "accel": bool(yoy is not None and prev is not None and yoy > prev)}
    return out
