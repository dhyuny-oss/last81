#!/usr/bin/env python3
"""
Alpha Terminal v4 — 지표 스냅샷 파이프라인
════════════════════════════════════════════════════════════════
핵심 원칙: "한 번 계산, 어디서나 표시"
  · 모든 지표를 여기서 한 번만 계산해 snapshot.json 에 저장
  · 프론트/알림은 재계산 없이 읽기만 → 값이 어긋날 자리가 없음

감사에서 잡은 버그를 모두 수정한 계산기:
  · 일목균형 구름   : 최저 '저가' 사용 (기존 App.jsx 는 최고가만 써서 틀림)
  · 슈퍼트렌드     : 표준 추세플립, 실제 0~3 카운트 (기존은 0 아니면 3만 가능)
  · RSI           : Wilder 스무딩 1종만 (기존 단순평균/Wilder 혼용)
  · EMA           : 첫 period SMA 시드 1종만
  · RS            : 교차단면 백분위 1종만 (기존 차이값/백분위 혼용)
  · 거래량비       : 5일평균÷20일평균 (백테스트 최적) + 당일÷20일 둘 다 명시 저장
  · 섹터 1일       : chartPreviousClose 폴백 버그 수정 (1일 자리에 1개월 값이 들어갔음)

출력 3분할:
  public/data/snapshot.json  종목별 최신 지표값 (캔들 제외, 가벼움)
  public/data/market.json    지수·섹터·시장판단
  public/data/bars/<티커>.json  차트용 시계열 (누른 종목만 로드, 1개 약 16KB)
"""
# ★ 263. 단계별 모듈로 나눴습니다 — 여기엔 실행 순서(main)만 남김. 단계: scripts/snap/ (common → fetch → indicators → market → extras → dc → today)
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from snap.today import *  # noqa  — 앞 단계 이름이 모두 들어옴


# ══════════════════════════════════════════════════════════════
EXTRA_FILE = "scripts/tickers_extra.txt"

def load_extra(universe):
    """★ 내가 직접 넣는 종목 목록.

    scripts/tickers_extra.txt 에 한 줄에 하나씩 적으면 됩니다.
    깃허브 웹에서 그냥 파일 열어 고치시면 됩니다 — 형식은 셋 다 됩니다:

        AAPL                 (미국 — 이름은 야후에서 자동)
        005930               (숫자 6자리면 한국으로 인식, .KS→.KQ 자동)
        042660  한화오션        (이름을 직접 적고 싶을 때)

    # 로 시작하는 줄과 빈 줄은 무시합니다.
    이미 universe.json 에 있는 종목은 건너뜁니다(중복 추가 안 됨).
    """
    added = []
    # 앱에서 "종목풀에 추가"를 누르면 watchlist.json 의 extras 로 들어옵니다 (파일 수정 없이 즉시)
    try:
        wl = json.load(open(f"{OUT_DIR}/watchlist.json", encoding="utf-8"))
        for tk in (wl.get("extras") or []):
            tk = str(tk).strip().upper()
            if not tk or tk in universe: continue
            mkt = "kr" if (tk.isdigit() and len(tk) == 6) else "us"
            universe[tk] = {"name": tk, "market": mkt, "sector": "",
                            "y": tk + ".KS" if mkt == "kr" else tk}
            added.append(tk)
        if added: print(f"  ➕ 앱에서 추가한 종목 {len(added)}개: {', '.join(added)}")
    except Exception:
        pass
    if not os.path.exists(EXTRA_FILE):
        return added
    for raw in open(EXTRA_FILE, encoding="utf-8"):
        line = raw.split("#")[0].strip()
        if not line: continue
        parts = line.split(None, 1)
        tk = parts[0].strip().upper()
        name = parts[1].strip() if len(parts) > 1 else ""
        if not tk or tk in universe: continue
        mkt = "kr" if (tk.isdigit() and len(tk) == 6) else "us"
        universe[tk] = {"name": name or tk, "market": mkt, "sector": "",
                        "y": tk + (".KS" if mkt == "kr" else "")}
        added.append(tk)
    return added

def pct_fill(stocks, raw_key, out_key, ref, focus, value_fn=None):
    """시장별 백분위. 전체 스캔이면 순위로 계산하고 분포를 ref 에 저장,
       감시 모드(주도주만 스캔)면 지난 전체 분포(ref) 위치로 계산합니다 — 주도주끼리만 줄세우면 왜곡되기 때문."""
    import bisect
    for mkt in ("us", "kr"):
        vals = []
        for tk, d in stocks.items():
            if d["m"] != mkt: continue
            v = value_fn(tk, d) if value_fn else d.get(raw_key)
            if v is None: d[out_key] = None
            else: vals.append((tk, v))
        if focus and ref.get(mkt, {}).get(out_key):
            arr = ref[mkt][out_key]; n = len(arr)
            for tk, v in vals:
                lo, hi = bisect.bisect_left(arr, v), bisect.bisect_right(arr, v)
                stocks[tk][out_key] = round(min(100, max(0, ((lo + hi - 1) / 2) / max(1, n - 1) * 100)), 1)
            continue
        n = len(vals)
        if n < 10:
            continue
        vals.sort(key=lambda x: x[1])
        i = 0
        while i < n:
            j = i
            while j + 1 < n and vals[j + 1][1] == vals[i][1]: j += 1
            pctl = round(((i + j) / 2) / (n - 1) * 100, 1)
            for k in range(i, j + 1): stocks[vals[k][0]][out_key] = pctl
            i = j + 1
        ref.setdefault(mkt, {})[out_key] = [round(v, 4) for _, v in vals]   # 다음 평일 감시 모드용


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    t0 = time.time()
    print("="*64); print(f"  Alpha Terminal 스냅샷 파이프라인 v{VERSION}"); print("="*64)

    # 유니버스 — ① 종목 목록 단계(build_universe.py)의 universe.json + 내가 직접 넣은 종목(EXTRA_FILE)
    src = load_universe()
    universe = {}
    for tk, s in (src.get("stocks") or {}).items():
        mkt = (s.get("market") or "us").lower()
        # ★ 기존 sector 는 전부 "US"/"Korean" — 섹터가 아니라 시장 이름이라 버립니다
        sec = s.get("sector") or ""
        if sec in ("US", "Korean", "KR", "us", "kr"): sec = ""
        universe[tk] = {"name": NAME_FIX.get(tk) or s.get("label") or tk, "market": mkt,
                        "sector": sec, "mcap": s.get("mcap"),
                        "y": tk + (".KS" if mkt=="kr" and not tk.endswith(".KS") else "")}
    base_n = len(universe)
    extra_added = load_extra(universe)
    # 앱 📦 종목풀 탭에서 '빼기' 한 종목 — 보유·관심·추가에 있으면 무시(보호 우선)
    try:
        _wl = json.load(open(f"{OUT_DIR}/watchlist.json", encoding="utf-8"))
        _prot = {str(p.get("t", "")).upper() for p in (_wl.get("positions") or [])} | {str(t).upper() for t in (_wl.get("watch") or []) + (_wl.get("extras") or [])}
        _ex = [str(t).upper() for t in (_wl.get("excludes") or []) if str(t).upper() not in _prot]
        _gone = [t for t in _ex if universe.pop(t, None) is not None]
        if _gone: print(f"  ➖ 앱에서 뺀 종목 {len(_gone)}개: {', '.join(_gone[:10])}")
    except Exception:
        _prot = set()
    PROT = set(_prot) | {str(t).upper() for t in extra_added}      # 기준과 무관하게 유지하는 종목
    # 191. 같은 회사의 다른 주식 종류(BRK-A·GOOG)는 매일 빼 둡니다 — 주간 교체 전에도 바로 적용 · 보유·관심이면 그대로
    try:
        from universe import SAME_CO_DROP as _SAME
    except Exception:
        _SAME = {"BRK-A": "BRK-B", "GOOG": "GOOGL", "FOX": "FOXA", "NWS": "NWSA"}
    _dup = [t for t in _SAME if t in universe and t not in PROT and universe.pop(t, None) is not None]
    if _dup: print(f"  ➖ 같은 회사 다른 주식 {len(_dup)}개 제외: {', '.join(_dup)}")

    # ★ 한국 공식 명단 검사 (한투 공개 마스터, 매일) — 주중에 새로 거래정지·관리·경고로 지정될 수 있어 매번 확인합니다
    #   · 이름은 공식 한글명으로 교정 (손 명단의 코드·이름 오류가 앱에 그대로 뜨던 문제)
    #   · 거래정지/정리매매/관리종목/투자경고·위험/우선주/SPAC/리츠·ETF/공식 명단에 없음 → 수집 전에 제외 (보유·관심·추가는 보호)
    #   · 시총 기준은 주간 수집에서만 적용 (매일 흔들리지 않게)
    import universe as U
    KRM = U.kr_master()
    KR_CUT = []
    if len(KRM) > 1000:
        for tk in [t for t, u in universe.items() if u["market"] == "kr"]:
            x = KRM.get(tk)
            if x:
                universe[tk]["name"] = x["name"]; universe[tk]["mcap"] = x["mcap"]
            if tk in PROT:
                r0 = U.kr_status_reason(x)
                if r0 and not r0.startswith("시총"): universe[tk]["status"] = r0     # 보호 종목은 남기되 상태를 표시
                continue
            r = U.kr_status_reason(x)
            if r and not r.startswith("시총"):
                KR_CUT.append((r, tk, universe[tk]["name"]))
        # ★ 두 번째 안전장치 — 한국 종목의 15% 넘게 한꺼번에 빠지면 명단 쪽 문제로 보고 이번 검사를 취소합니다
        n_kr = sum(1 for u in universe.values() if u["market"] == "kr")
        if len(KR_CUT) > max(15, n_kr * 0.15):
            print(f"  ⚠️ 공식 명단 기준 제외가 {len(KR_CUT)}/{n_kr} 로 비정상 — 명단 오류로 보고 이번엔 아무것도 빼지 않습니다")
            KR_CUT = []
        for r, tk, _ in KR_CUT: universe.pop(tk, None)
        if KR_CUT: print(f"  🚫 공식 명단 기준 제외 {len(KR_CUT)}: " + ", ".join(f"{n}({r})" for r, _, n in KR_CUT[:8]))
    else:
        print("  ⚠️ 한투 공식 명단을 받지 못해 이번엔 상태 검사를 건너뜁니다")

    # ★ 감시 모드 (평일) — 신호가 날 수 있는 종목만 봅니다.
    #   눌림·매수 신호는 RS 70↑ 주도주에서만, 과매도는 고점 −25%↓ 에서만 나므로
    #   토요일 전체 스캔에서 RS 60↑ 또는 과매도 후보였던 종목 + 내 종목·관심·추가 만 평일에 다시 받습니다.
    #   실측: 711 → 약 370종목 (신호 종목 56/56 포함). 실행 시간·요청 수가 절반 아래로.
    focus = os.environ.get("FOCUS") == "1"
    ref, prev_mkt, full_n = {}, {}, len(universe)
    try:
        prev_snap = json.load(open(f"{OUT_DIR}/snapshot.json", encoding="utf-8"))
        prev_mkt = json.load(open(f"{OUT_DIR}/market.json", encoding="utf-8"))
        ref = prev_mkt.get("ref") or {}
        # 175. 전체 수 = 이번 명단 그대로 (예전엔 지난 값을 계속 이어 써서 교체 뒤에도 옛 숫자가 남았음)
    except Exception:
        prev_snap = None
    universe_all = dict(universe)        # 110. 업종 PER 은 감시 모드에서도 종목풀 전체로 계산
    if focus and prev_snap and ref:
        prot = set()
        try:
            wl = json.load(open(f"{OUT_DIR}/watchlist.json", encoding="utf-8"))
            prot |= {p.get("t") for p in (wl.get("positions") or []) if p.get("t")}
            prot |= set(wl.get("watch") or []) | set(wl.get("extras") or []) | set(extra_added)
        except Exception:
            prot |= set(extra_added)
        # 115. 감시 풀은 토요일 전체 스캔 직후 한 번만 고르고, 평일에는 그대로 둡니다.
        #   (예전: 평일마다 다시 걸러서 RS 가 60 아래로 잠깐 내려간 종목이 빠지고 토요일까지 못 돌아왔음 — 298 → 278 → 266)
        _prev_focus = ((prev_snap.get("meta", {}).get("health") or {}).get("mode") == "focus")
        keep = {t for t, d in prev_snap.get("stocks", {}).items()
                if _prev_focus or (d.get("rs") or 0) >= 60 or ((d.get("w52p") or 0) <= -25 and (d.get("hlt") or 0) >= 0.6)}
        keep |= {str(t).upper() for t in prot if t}
        fu = {t: v for t, v in universe.items() if t in keep}
        n_kr = sum(1 for v in fu.values() if v["market"] == "kr"); n_us = len(fu) - n_kr
        if n_kr >= 40 and n_us >= 60:
            universe = fu
            print(f"\n🎯 감시 모드: 전체 {full_n} 중 {len(universe)}종목만 (kr {n_kr} · us {n_us}) — 토요일에 전체 재스캔")
        else:
            focus = False
            print(f"\n⚠️ 감시 풀이 너무 작아({n_kr}/{n_us}) 전체 스캔으로 전환")
    elif focus:
        focus = False
        print("\n⚠️ 지난 전체 스캔 기록이 없어 전체 스캔으로 실행")
    if not focus:
        ref = {}    # 전체 스캔이면 분포를 새로 만듭니다
    print(f"\n📋 유니버스 {len(universe)}종목 "
          f"(kr {sum(1 for x in universe.values() if x['market']=='kr')} · "
          f"us {sum(1 for x in universe.values() if x['market']=='us')})")
    print(f"   · universe.json {base_n}개 + 직접추가 {len(extra_added)}개"
          + (f" → {', '.join(extra_added)}" if extra_added else ""))

    print("\n🌐 시장·섹터 수집")
    market = build_market()
    # ★ 벤치마크 지수는 필수 — 하나라도 빠지면 판정·비교·DC 가 빈 채로 배포되므로 지난 파일을 지키고 중단합니다
    _need = [k for k in ("^GSPC", "^IXIC", "^KS11") if k not in (market.get("indices") or {})]
    if _need:
        print(f"\n❌ 지수 수집 실패 {', '.join(_need)} — 시장 판정을 만들 수 없어 파일을 쓰지 않고 종료합니다 (야후 일시 장애일 가능성)")
        sys.exit(1)

    print(f"\n📊 종목 지표 계산 ({len(universe)}종목)")
    stocks, series = {}, {}

    bhist = {"us": {}, "kr": {}}

    def collect_breadth(cd, mkt):
        """이 종목이 매일 200일선 위였는지를 날짜별로 더합니다.
           종목마다 상장일이 달라 분모(그날 값이 있는 종목 수)도 함께 셉니다."""
        c = [x["c"] for x in cd]
        ma = sma_series(c, 200)
        d = bhist.get(mkt)
        if d is None: return
        for i in range(max(0, len(cd) - BREADTH_DAYS), len(cd)):
            m = ma[i] if i < len(ma) else None
            if m is None or not m: continue
            e = d.get(cd[i]["t"])
            if e is None: e = d[cd[i]["t"]] = [0, 0]
            e[1] += 1
            if c[i] > m: e[0] += 1

    drops = {}      # 제외 사유별 기록 — 조용히 사라지지 않게 남깁니다
    warns = []
    def drop(reason, tk, name, detail=""):
        drops.setdefault(reason, []).append({"t": tk, "n": name, "d": detail})
    for r, tk, n in KR_CUT: drop(r, tk, n)

    def try_one(tk, info, pause):
        """1종목 처리. 검사를 통과한 것만 싣습니다 (종목 수보다 정확도 우선)."""
        if info["market"] == "kr":
            cd, meta, sym = fetch_kr(tk, pause)
            if sym.endswith((".KS", ".KQ")): info["y"] = sym
        else:
            cd, meta = fetch_candles(info["y"])
        if len(cd) < 30:
            time.sleep(pause); return False               # 수집 실패 → 재시도 대상
        # ① 상품명 확인 — 이름 없는 응답은 유령 시세입니다
        if info["market"] == "kr" and not meta.get("longName"):
            drop("유령 시세(이름 없음)", tk, info["name"], info["y"]); time.sleep(pause); return True
        # ② 봉 수 확인 — 200일선·RS 를 못 만드는 종목은 반쪽 지표로 싣지 않습니다
        if len(cd) < MIN_BARS:
            drop("이력 부족", tk, info["name"], f"{len(cd)}봉"); time.sleep(pause); return True
        # ③ 최근 거래 확인
        halted = all((b.get("v") or 0) == 0 for b in cd[-5:])
        if halted and tk not in PROT:
            drop("거래 없음", tk, info["name"]); time.sleep(pause); return True
        cd = cd[-max(BARS_KEEP, 1000):]                # 3년(756일) 건강도 + 200일선 = 956봉 필요
        d = build_stock(tk, cd, meta, info["name"], info["market"], info["sector"])
        time.sleep(pause)
        if not d: return False
        # ④ 하루 ±35% 초과는 분할·오류 의심 → 경고만 남깁니다 (실제 급등락도 있으므로)
        if d.get("d1") is not None and abs(d["d1"]) > JUMP_WARN * 100:
            warns.append({"t": tk, "n": info["name"], "w": f"1일 {d['d1']:+.1f}%"})
        d["ex"] = info["y"][-3:] if info["market"] == "kr" else (meta.get("exchangeName") or "US")
        if halted: d["halted"] = True          # 보유·관심 종목인데 최근 5일 거래 없음 → 거래정지 표시
        stocks[tk] = d
        # ★ 차트용 시계열 — 종목당 파일 1개.
        #   예전처럼 한 덩어리(candles.json)로 묶으면 차트 탭을 처음 열 때 9MB 를 받습니다.
        #   종목별로 쪼개면 누른 종목 하나만 16KB 받으면 됩니다.
        nd = 0 if d["c"] >= 2000 else 2       # 원화 종목은 소수점 불필요
        series[tk] = build_series(cd, min(BARS_KEEP, len(cd)), nd)
        collect_breadth(cd, info["market"])
        return True

    fails = []
    for i,(tk,info) in enumerate(universe.items()):
        if not try_one(tk, info, 0.15): fails.append(tk)
        if (i+1) % 50 == 0:
            print(f"    {i+1}/{len(universe)}  성공 {len(stocks)} 실패 {len(fails)}  "
                  f"({time.time()-t0:.0f}s)", flush=True)

    # ★ 재시도 패스 — 실패의 대부분은 야후 일시적 스로틀입니다.
    #   간격을 4배로 늘려 한 번만 다시 시도합니다 (43종목이 이렇게 살아났습니다).
    if fails:
        print(f"\n🔁 실패 {len(fails)}종목 재시도 (간격 0.6초)")
        still = []
        for tk in fails:
            if not try_one(tk, universe[tk], 0.6): still.append(tk)
        print(f"    복구 {len(fails)-len(still)} · 최종 실패 {len(still)}")
        fails = still
        miss_extra = [t for t in fails if t in extra_added]
        if miss_extra:
            print(f"    ⚠️ 직접 추가한 종목 중 못 받은 것: {', '.join(miss_extra)}")
            print(f"       → 티커가 야후 기준인지 확인해 주세요 "
                  f"(한국은 6자리 숫자, 미국은 영문. 예: 042660 / AAPL)")

    # ★ 거래대금 하한 (20일 평균) — 🇰🇷 30억 · 🇺🇸 $30M. 팔 때 가격을 밀지 않을 만큼. 보유·관심·추가는 보호
    for tk in list(stocks):
        d = stocks[tk]; kr = d["m"] == "kr"; lim = TV_MIN_KR if kr else TV_MIN_US
        if tk not in PROT and d.get("tv") is not None and d["tv"] < lim:
            drop("거래대금 미달", tk, d.get("n") or tk, f"{d['tv'] / (1e8 if kr else 1e6):.0f}{'억' if kr else '$M'}")
            stocks.pop(tk, None); series.pop(tk, None)
        elif tk in stocks:
            mc = (universe.get(tk) or {}).get("mcap")
            if mc: d["mcap"] = mc                     # 🇰🇷 억원 · 🇺🇸 달러
            st_ = (universe.get(tk) or {}).get("status")
            if st_: d["status"] = st_                 # 보호 종목의 공식 상태 (거래정지·관리종목 등)

    # RS 백분위 — 6개월 수익률의 시장 내 순위 (검증: 21/42/63/126/252일 중 126일이 최고)
    print("\n📈 RS·거래대금 백분위" + (" (감시 모드: 지난 전체 분포 기준)" if focus else ""))
    def r126(tk, d):
        cds = series.get(tk)
        if cds and len(cds) > RS_LOOKBACK and cds[-(RS_LOOKBACK+1)][1]:
            return (cds[-1][1] / cds[-(RS_LOOKBACK+1)][1] - 1) * 100
        return None
    pct_fill(stocks, None, "rs", ref, focus, value_fn=r126)
    pct_fill(stocks, "tv", "tvr", ref, focus)
    # ★ 70. 강도 점수 — 매수! 중 무엇부터 살지. 검증(2008–26, 규칙은 2010–18에서 정하고 2019–26에 적용):
    #   🇺🇸 5칸 2019–23 +50.0%·2024–26 +38.4% (RS 순 +41.3%·+26.8%, 업종 순위 먼저 +13.3%·+16.9%)
    #   🇰🇷 3칸 +48.0%·+39.4% (RS 순 +44.5%·+23.0%). 둘 다 그날 종가로 계산되는 값이라 당시에도 알 수 있었음.
    pct_fill(stocks, "ma200p", "d200r", ref, focus)
    for d in stocks.values():
        d["str"] = _r((d["rs"] + d["d200r"]) / 2, 0) if (d.get("rs") is not None and d.get("d200r") is not None) else None
    for mkt in ("us", "kr"):
        n = sum(1 for d in stocks.values() if d["m"] == mkt and d.get("rs") is not None)
        print(f"  {mkt}: RS {n}종목")

    # ══════════════════════════════════════════════════════════
    # ★ 안전장치 — 야후가 통째로 막힌 날 좋은 데이터를 빈 데이터로 덮어쓰지 않도록.
    #   기존 파일보다 종목 수가 20% 넘게 줄면 아무것도 쓰지 않고 실패 처리합니다.
    # ══════════════════════════════════════════════════════════
    # ⑤ 시세 정지 제외 — 시장 기준일보다 STALE_DAYS 넘게 밀린 종목 (상장폐지·거래정지)
    from datetime import date as _date
    refdate = {}     # (백분위 분포를 담는 ref 와 이름이 겹치지 않게)
    for mkt in ("kr", "us"):
        ds = sorted(d["asOf"] for d in stocks.values() if d["m"] == mkt and d.get("asOf"))
        if ds: refdate[mkt] = ds[-1]
    for tk in [t for t, d in stocks.items() if d.get("asOf") and refdate.get(d["m"])]:
        d = stocks[tk]
        gap = (_date.fromisoformat(refdate[d["m"]]) - _date.fromisoformat(d["asOf"])).days
        if gap > STALE_DAYS:
            if tk in PROT:
                d["halted"] = True; continue     # 들고 있거나 관심 종목이면 남기고 '거래정지'로 표시
            drop("시세 정지", tk, d.get("n") or tk, f"{d['asOf']} ({gap}일 전)")
            stocks.pop(tk, None); series.pop(tk, None)

    # ⑥ 시장별 안전장치 — 나쁜 데이터로 덮어쓰느니 지난 데이터를 그대로 두는 편이 낫습니다
    prev_by_mkt, prev_n = {}, 0
    try:
        _p = json.load(open(f"{OUT_DIR}/snapshot.json", encoding="utf-8"))["stocks"]
        prev_n = len(_p)
        for v in _p.values(): prev_by_mkt[v["m"]] = prev_by_mkt.get(v["m"], 0) + 1
    except Exception: pass
    now_by_mkt = {}
    for v in stocks.values(): now_by_mkt[v["m"]] = now_by_mkt.get(v["m"], 0) + 1
    # ★ '수집이 망가졌나'만 봅니다 — 기준(거래정지·거래대금 등)으로 일부러 뺀 종목은 실패가 아닙니다.
    #   시장별로 받으려던 종목 중 '수집 실패'가 10% 를 넘으면 쓰지 않고 종료 (야후 차단·네트워크 장애)
    uni_by_mkt = {}
    for u in universe.values(): uni_by_mkt[u["market"]] = uni_by_mkt.get(u["market"], 0) + 1
    fail_by_mkt = {}
    for t in fails:
        m_ = (universe.get(t) or {}).get("market", "us"); fail_by_mkt[m_] = fail_by_mkt.get(m_, 0) + 1
    for mkt, un in uni_by_mkt.items():
        fr = fail_by_mkt.get(mkt, 0) / max(1, un)
        if un >= 30 and fr > 0.10:
            print(f"\n❌ {mkt} 시장 수집 실패 {fail_by_mkt.get(mkt, 0)}/{un} ({fr:.0%}) — 망가진 것으로 보고 파일을 쓰지 않고 종료합니다.")
            sys.exit(1)

    # ⑦ 검사 결과 보고 — 제외된 종목이 화면에서 소리 없이 사라지지 않게 남깁니다
    health = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "universe": len(universe), "kept": len(stocks),
        "byMarket": {m: {"kept": now_by_mkt.get(m, 0), "prev": prev_by_mkt.get(m, 0)} for m in ("kr", "us")},
        "dropped": {r: len(v) for r, v in drops.items()},
        "droppedList": {r: v[:40] for r, v in drops.items()},
        "failed": len(fails), "failedList": fails[:40],
        "warn": warns[:40],
        "exchange": {"KS": sum(1 for d in stocks.values() if d.get("ex") == ".KS"),
                     "KQ": sum(1 for d in stocks.values() if d.get("ex") == ".KQ")},
        "rules": {"minBars": MIN_BARS, "staleDays": STALE_DAYS, "minKeep": MIN_KEEP},
        "mode": "focus" if focus else "full", "fullUniverse": full_n,
    }
    print("\n🩺 데이터 검사")
    print(f"  유니버스 {len(universe)} → 사용 {len(stocks)} "
          f"(한국 {now_by_mkt.get('kr',0)} · 미국 {now_by_mkt.get('us',0)})")
    for r, v in sorted(drops.items(), key=lambda x: -len(x[1])):
        print(f"  제외 {r}: {len(v)}종목 — {', '.join(x['n'] for x in v[:6])}{' …' if len(v) > 6 else ''}")
    if warns: print(f"  ⚠️ 급변 경고 {len(warns)}종목: {', '.join(w['n']+'('+w['w']+')' for w in warns[:6])}")
    print(f"  거래소 확정: 코스피 {health['exchange']['KS']} · 코스닥 {health['exchange']['KQ']}")
    _write(f"{OUT_DIR}/data_health.json", health)

    MIN_OK = 0.8
    if len(fails) > (1 - MIN_OK) * len(universe):
        print(f"\n❌ 수집 실패 {len(fails)}/{len(universe)} — 20% 를 넘습니다. 기존 파일을 지키기 위해 쓰지 않고 종료합니다.")
        sys.exit(1)
    # (지난번 대비 급감 비교는 뺐습니다 — 주간 기준으로 종목풀이 줄어드는 것은 정상이고, 망가짐은 위 '수집 실패율'로 잡습니다)

    # ══════════════════════════════════════════════════════════
    # ★ 행동 판정 — 여기서 한 번만 정합니다. 앱 4개 화면·텔레그램·장중 감시는 이 값을 읽기만 합니다.
    #   action: buy(매수!) / watch(관망) / sell(매도!)   ※ hold(보유)는 '들고 있는지'를 아는 앱 쪽에서 붙입니다
    #   why   : pull(눌림·한국) / strong(강세·한국·미국) / trend(추세) — 왜 매수인지
    #   검증(2008–26): 한국은 RSI 45 회복(눌림)이 모든 구간 +, 미국은 RSI 60 이상(강세)이 세 구간 모두 보유를 이김.
    #   180 (2026-10): 한국에도 강세 추가 — 눌림이 드물어 빈 칸을 약한 추세가 채우던 것을 강세가 대신.
    #     2010–26 한국 5칸·폭 게이트: 후보 순서·기준값(57~63)을 흔든 28번 중 26번이 지금보다 나음 (중앙값 연 19.7% → 24.7%).
    #     강세 신호 하나하나의 120일 지수대비 +7.4%p (눌림 +8.1, 추세 +2.7) · 기준 55~65 어디서나 +6~8%p.
    #   매도는 느린 슈퍼트렌드(12,3) 빨강 하나. −3%·고점−5%·2주 타임컷은 검증에서 성과를 깎아 쓰지 않습니다.
    # ══════════════════════════════════════════════════════════
    fin_flags(stocks)
    attach_quarterly(stocks, refresh=not focus)
    attach_targets(stocks, PROT)
    attach_earnings(stocks, universe_all, market)
    attach_earn_rx(stocks, series)
    for d in stocks.values():
        rs_ok = (d.get("rs") or 0) >= 70
        up = bool(d.get("upTrend") and d.get("stSlow") == 1 and rs_ok)
        d["pull"]   = bool(up and d.get("rsi45"))                                            # 한국형
        d["strong"] = bool(up and (d.get("rsi") or 0) >= 60)                                # 강세 (한국·미국, 180)
        d["trend3"] = bool(d.get("st") == 3 and d.get("cloud") == 1 and rs_ok)                # 추세 확인형
        d["sig"] = "buy" if d["trend3"] else ("exit" if d.get("stSlow") == 0 else "keep")    # (구버전 호환)
        if d.get("stSlow") == 0:
            d["action"], d["why"] = "sell", "st"
        elif d["m"] == "kr" and d["pull"]:
            d["action"], d["why"] = "buy", "pull"
        elif d["strong"]:
            d["action"], d["why"] = "buy", "strong"
        elif d["trend3"]:
            d["action"], d["why"] = "buy", "trend"
        else:
            d["action"], d["why"] = "watch", None
        # 급락(과매도) 판정 — 참고용. 27번 재검증: 어떤 조합도 주도주 보유를 못 이김 → −40 특별취급 없앰
        dd, hl = d.get("w52p"), d.get("hlt")
        prof = (d.get("fin") or {}).get("prof")
        rebound = bool(d.get("ma20p") is not None and d["ma20p"] > 0)
        if dd is not None and hl is not None and dd <= -25 and hl >= 0.6:
            broken = (d.get("ma200p") or 0) < -50
            d["dip"] = "broken" if broken else ("watch" if (rebound and (prof or d["m"] == "kr")) else "wait")
        else:
            d["dip"] = None
        # 업종 → 섹터 ETF
        if d["m"] == "us" and d.get("t") in _SECTOR_FIX: d["s"] = _SECTOR_FIX[d["t"]]     # 172. 나스닥 분류 ≠ GICS (종목풀 교체 전에도 바로 반영)
        d["sec"] = GICS_TO_ETF.get(d.get("s") or "", None) if d["m"] == "us" else None
        # ★ 예비 후보 (관찰용, 매수! 아님) — 검증(2026-09): '강해질 것 같은' 트리거는 현행을 못 이김.
        #   그래도 다음 매수! 가 나올 자리를 미리 보기 위해 두 가지만 표시합니다.
        #   rising: 추세 유지 · RS 55~70 · 1달 시장대비 플러스   /   turn: 느린ST 초록 전환 3거래일 이내 · RS 50↑ · 200일선 위
        rsv = d.get("rs") or 0
        trend_ok = bool(d.get("upTrend") and d.get("stSlow") == 1)
        if d.get("action") != "buy" and d.get("stSlow") == 1:
            _idx = (market.get("indices") or {}).get("^KS11" if d["m"] == "kr" else ("^IXIC" if d.get("ex") in ("NMS", "NGM", "NCM") else "^GSPC")) or {}
            _rel = (d.get("d21") or 0) - (_idx.get("d21") or 0)
            if trend_ok and 55 <= rsv < 70 and _rel > 0:
                d["pre"] = "rising"
            elif (d.get("slowDays") or 99) <= 3 and rsv >= 50 and (d.get("ma200p") or -1) > 0:
                d["pre"] = "turn"
            else:
                d["pre"] = None
        else:
            d["pre"] = None

    # 변동성 백분위 — 시장 안에서 줄세우기 (미국 진입 신호로 사용)
    pct_fill(stocks, "atrp", "atrr", ref, focus)
    # 화면·알림 어디서도 쓰지 않는 중간값 제거는 모든 백분위 계산이 끝난 '뒤'에
    DROP = ("atrp", "macdX", "stPrev", "vr", "vr5", "rsi45", "upTrend")
    for d in stocks.values():
        for k in DROP: d.pop(k, None)

    # 시장 '폭' — 200일선 위 종목 비율과 그 3년 백분위. 한국 판단의 근거입니다.
    print("\n🌡️ 시장 폭 계산" + (" (감시 모드: 토요일 전체 스캔 값 유지)" if focus else ""))
    if focus and prev_mkt.get("breadth"):
        breadth = prev_mkt["breadth"]
        market["breadthAsOf"] = prev_mkt.get("breadthAsOf") or prev_snap.get("meta", {}).get("generatedKST", "")[:10]
    else:
        breadth = build_breadth(bhist)
        market["breadthAsOf"] = datetime.now(KST).strftime("%Y-%m-%d")
    for mkt in ("kr","us"):
        b = breadth.get(mkt)
        print(f"  {mkt}: " + (f"{b['v']:.1f}% · 3년 백분위 {b['pct']:.0f} ({b['n']}일 기준)"
                              if b else "표본 부족 — 200일선 판단으로 대체"))
    market["breadth"] = breadth
    market["judge"]   = decide_judge(market["indices"], breadth)
    # 252. 나스닥100 을 못 받은 날은 지난 판정을 그대로 (하루 수집 실패로 필터가 풀리지 않게)
    _ju, _pj = market["judge"].get("us") or {}, ((prev_mkt or {}).get("judge") or {}).get("us") or {}
    if _ju and _ju.get("blocked") is None and _pj.get("blocked") is not None:
        _ju.update({"blocked": _pj["blocked"], "verdict": _pj.get("verdict", _ju["verdict"]), "why": _pj.get("why", _ju["why"]),
                    "nq200": _pj.get("nq200"), "nqRun": _pj.get("nqRun"), "nqStale": True})
        print(f"  ⚠️ 나스닥100 수집 실패 — 지난 판정 유지 (200일선 {_pj.get('nq200')}%)")
    market["ref"]     = ref if ref else prev_mkt.get("ref") or {}     # 평일 감시 모드가 쓸 분포
    for mkt, j in market["judge"].items():
        print(f"  판단 {mkt}: {j['verdict']} — {j['why']}"
              f"  → {'새로 사지 않음' if j.get('blocked') else '새로 사기 가능' if j.get('blocked') is False else '확인 안 됨'}")

    # 실전 장부 갱신 (지수는 market 의 idxbars 를 날짜 문자열로 바꿔서)
    try:
        idx_series = {}
        for m, key in (("kr", "kr"), ("us", "us")):
            rows = (market.get("idxbars", {}).get(key) or {}).get("rows") or []
            idx_series[m] = [(datetime.fromtimestamp(r[0], timezone.utc).strftime("%Y-%m-%d"), r[1]) for r in rows]
        market["live"] = update_signal_log(stocks, series, idx_series)
    except Exception as e:
        print("  ⚠️ 실전 장부 갱신 실패:", e); market["live"] = None

    # ══════════════════════════════════════════════════════════
    # ★ today.json — 오늘 후보를 파이프라인이 확정해 작은 파일로. (48번)
    #   AI 도구는 이것만 읽으면 되고, 텔레그램 5칸 추천·앱 선정과 같은 규칙이라 서로 어긋나지 않습니다.
    #   규칙: action=buy · 미국 매출 +10%↑(재무 있으면) · 적자 제외 · 트레일링선까지 20% 이하 · 보유 제외 · 업종 3개까지 · 🇺🇸 7 · 🇰🇷 5 · 나스닥100 200일선 아래면 🇺🇸 안 삼
    # ══════════════════════════════════════════════════════════
    try:
        market["today"] = build_today(stocks, market)
        _write(f"{OUT_DIR}/today.json", market["today"])
        print(f"  📝 today.json: 후보 {len(market['today']['candidates'])} · 🇺🇸 추천 {len(market['today']['pickUs'])} · 🇰🇷 {len(market['today']['pickKr'])} · 제외 {len(market['today']['excluded'])}")
    except Exception as e:
        print("  ⚠️ today.json 실패:", e)
    # 152. 추천 기록 — 날마다 '오늘 살 것'(빈 칸 수만큼 = buy)과 대기 순번을 쌓아 둡니다. 앱의 복기·차트 표시가 읽습니다.
    try:
        write_picks_log(market["today"])
    except Exception as e:
        print("  ⚠️ picks_log.json 실패:", e)

    print("\n🏦 DC(퇴직연금) ETF 신호")
    etfs, dc = build_dc(market["sectors"], series)
    market["dc"] = dc
    # 187. 지수 차트 — 종목·ETF 와 같은 차트 화면으로 열리게 지수도 같은 모양으로 내보냅니다 (매수 대상 아님: idx 표시)
    #      파일 이름에 ^ 가 들어가지 않게 읽기 쉬운 이름으로 (SPX · NASDAQ · KOSPI)
    IDX_KEY = {"^GSPC": ("SPX", "S&P500 지수"), "^IXIC": ("NASDAQ", "나스닥 종합지수"), "^KS11": ("KOSPI", "코스피 지수"), "^NDX": ("NDX", "나스닥100 지수")}
    for _tk, (_cd, _label, _mkt) in IDX_CD.items():
        if _tk not in IDX_KEY: continue
        try:
            _key, _nm = IDX_KEY[_tk]
            _d = build_stock(_key, _cd, {}, _nm, _mkt, "지수")
            if not _d: continue
            _d.update({"etf": True, "idx": True, "src": _tk})
            etfs[_key] = _d
            series[_key] = build_series(_cd, min(BARS_KEEP, len(_cd)), 2)
        except Exception as e:
            print(f"  ⚠️ 지수 차트 {_tk} 실패: {str(e)[:60]}")

    now = datetime.now(timezone.utc)
    meta = {"version":VERSION, "generatedAt":now.isoformat(),
            "generatedKST":now.astimezone(KST).strftime("%Y-%m-%d %H:%M"),
            "failed": fails[:60],
            "pool": {"base": base_n, "extra": extra_added},
            "counts":{"stocks":len(stocks),"failed":len(fails),
                      "sectors":len(market["sectors"]),"indices":len(market["indices"])}}

    meta["counts"]["etfs"] = len(etfs)
    try:
        _fin = load_fin()
        _d = max((str(v.get("betaUpdatedAt") or v.get("updatedAt") or "") for v in _fin.values() if isinstance(v, dict)), default="")
        meta["finUpdated"] = _d[:10] or None
    except Exception:
        meta["finUpdated"] = None
    meta["health"] = {"kept": health["kept"], "universe": health["universe"],
                      "dropped": health["dropped"], "failed": health["failed"],
                      "byMarket": health["byMarket"], "exchange": health["exchange"],
                      "mode": health["mode"], "fullUniverse": health["fullUniverse"]}
    _write(f"{OUT_DIR}/snapshot.json", {"meta":meta,"stocks":stocks,"etfs":etfs})
    _write(f"{OUT_DIR}/market.json",   {"meta":meta, **market})
    # 종목별 차트 파일
    bars_dir = f"{OUT_DIR}/bars"
    os.makedirs(bars_dir, exist_ok=True)
    for old in os.listdir(bars_dir):                  # 유니버스에서 빠진 종목 파일 정리
        if old.endswith(".json") and old[:-5] not in series:
            try: os.remove(os.path.join(bars_dir, old))
            except OSError: pass
    for tk, rows in series.items():
        _write(f"{bars_dir}/{tk}.json",
               {"v":VERSION,"t":tk,"cols":COLS,"rows":rows})
    bsz = sum(os.path.getsize(f"{bars_dir}/{t}.json") for t in series)
    # 197. 규칙 스스로 점검 — 데이터 이상 · 대안 그림자 기록 · 3주 보고 (보고만 · 규칙은 안 바꿈)
    try:
        import self_check
        self_check.run(OUT_DIR, stocks, series, market, health)
    except Exception as e:
        print("  ⚠️ 규칙 점검 실패:", str(e)[:120])

    print(f"\n{'='*64}")
    print(f"  ✅ 완료 {time.time()-t0:.0f}초 · 종목 {len(stocks)} · 실패 {len(fails)}")
    for f in ("snapshot","market"):
        pth=f"{OUT_DIR}/{f}.json"
        print(f"     {f+'.json':16s} {os.path.getsize(pth)/1024:>8,.0f} KB")
    print(f"     bars/*.json      {bsz/1024:>8,.0f} KB  ({len(series)}개 · 1종목 평균 {bsz/len(series)/1024:.1f} KB)")
    if fails: print(f"  ⚠️ 실패: {', '.join(fails[:12])}{' …' if len(fails)>12 else ''}")
    print("="*64)

if __name__ == "__main__":
    main()
