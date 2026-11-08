"""263. ① 시세 받기 — 야후 일봉 · 한국 거래소 확인"""
from snap.common import *  # noqa


# ══════════════════════════════════════════════════════════════
# 데이터 수집
# ══════════════════════════════════════════════════════════════
_RUN_TS = time.time()      # 100. 실행 시작 시각 하나로 판단 — 수집 도중 마감 시각을 넘어도 종목마다 날짜가 섞이지 않게

def _drop_partial(out, ticker):
    """100. 장이 아직 안 끝난 오늘 봉은 버립니다 — 매수!·매도! 는 '확정 종가'로만 판정하기 위해.
       (2026-09-28 사고: 예약이 늦게 돌아 미국 장중 가격이 9/28 종가로 저장되고, 장중 값으로 매도 신호가 켜짐)
       🇰🇷 15:45 KST · 🇺🇸 16:10 뉴욕 시각 전이면, 그 시장 '오늘' 날짜의 봉을 뺍니다. 환율(=X)·선물(=F)은 24시간이라 그대로."""
    if not out or ticker.endswith(("=X", "=F")): return out
    try:
        from zoneinfo import ZoneInfo
        kr = ticker.endswith((".KS", ".KQ")) or ticker in ("^KS11", "^KQ11", "^KS200")
        tz = ZoneInfo("Asia/Seoul" if kr else "America/New_York")
        now = datetime.fromtimestamp(_RUN_TS, tz)
        cut = now.replace(hour=15, minute=45, second=0, microsecond=0) if kr else now.replace(hour=16, minute=10, second=0, microsecond=0)
        last = datetime.fromtimestamp(out[-1]["t"], tz)
        if last.date() == now.date() and now < cut:
            return out[:-1]
    except Exception:
        pass
    return out

def fetch_candles(ticker, tries=3, min_bars=200):
    """전체 히스토리 일봉. period1/period2 방식 (range=max 는 월봉을 줌)
       ★ query1 이 막히면 query2 로 한 번 더 (야후는 종종 한쪽만 404 를 냅니다)"""
    for a in range(tries):
        host = "query2" if a % 2 else "query1"
        url = (f"https://{host}.finance.yahoo.com/v8/finance/chart/{ticker}"
               f"?period1=0&period2=9999999999&interval=1d")
        try:
            req = urllib.request.Request(url, headers=UA)
            d = json.load(urllib.request.urlopen(req, timeout=30))["chart"]["result"][0]
            q, ts = d["indicators"]["quote"][0], d["timestamp"]
            out = []
            for i in range(len(ts)):
                o,h,l,c,v = q["open"][i],q["high"][i],q["low"][i],q["close"][i],q["volume"][i]
                if None in (o,h,l,c): continue
                out.append({"t":ts[i],"o":round(o,4),"h":round(h,4),
                            "l":round(l,4),"c":round(c,4),"v":int(v or 0)})
            # ★ 200 OK 인데 봉이 몇 개 안 오는 경우가 있습니다. 조용히 받아들이면
            #   ma200/추세템플릿이 전부 None 인 종목이 정상인 척 배포됩니다.
            if len(out) < min_bars and a < tries-1:
                time.sleep(1.2*(a+1)); continue
            return _drop_partial(out, ticker), d.get("meta", {})
        except Exception:
            if a == tries-1: return [], {}
            time.sleep(1.2*(a+1))
    return [], {}

# ══════════════════════════════════════════════════════════════
# 데이터 검사 규칙 (2026-09 — 코스닥 77종목이 조용히 틀렸던 사고 이후)
# ══════════════════════════════════════════════════════════════
# 상위 유니버스 파일의 이름이 뒤바뀐 종목 — 가격으로 확인해 바로잡습니다
NAME_FIX = {"192820": "코스맥스", "044820": "코스맥스비티아이"}
TV_MIN_KR  = 30e8      # 한국 거래대금 하한 (20일 평균, 원)
TV_MIN_US  = 30e6      # 미국 거래대금 하한 (20일 평균, 달러)
MIN_BARS   = 260     # 200일선·RS 를 계산할 수 있는 최소 봉수. 미달이면 아예 싣지 않습니다.
STALE_DAYS = 7       # 시장 기준일보다 이만큼 밀리면 거래정지·상장폐지로 보고 제외
JUMP_WARN  = 0.35    # 하루 ±35% 초과는 분할·오류 의심 → 경고만 (실제 급등락도 있으므로)
MIN_KEEP   = 0.95    # 시장별로 지난번의 95% 미만만 남으면 '쓰지 않고 종료'

def fetch_kr(tk, pause=0.15):
    """한국 종목의 거래소를 확정합니다.
       ★ 코스닥 종목에 .KS 를 붙이면 야후가 200 OK 로 '이름 없는 유령 시세'를 돌려줍니다.
         가격이 실제와 최대 14% 다르고 봉도 45개뿐인데, 예전 코드는 이것을 그대로 썼습니다.
         meta.exchangeName 으로만 확실히 갈립니다 — KSC=코스피, KOE=코스닥."""
    cd, meta = fetch_candles(tk + ".KS")
    ex = (meta.get("exchangeName") or "").upper()
    if ex == "KSC":                      # 코스피 확정
        return cd, meta, tk + ".KS"
    time.sleep(pause)
    cd2, meta2 = fetch_candles(tk + ".KQ")
    ex2 = (meta2.get("exchangeName") or "").upper()
    if ex2 == "KOE" and meta2.get("longName"):   # 코스닥 확정 (이름 없으면 유령)
        return cd2, meta2, tk + ".KQ"
    return [], meta2 or meta, tk          # 어느 쪽도 확정 못하면 버립니다

__all__ = [n for n in dir() if not n.startswith("__")]   # 밑줄 이름(_r · _write …)도 다음 단계가 쓰도록 내보냄
