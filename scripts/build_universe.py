#!/usr/bin/env python3
"""
262. ① 종목풀 (주 1회) — 이 단계는 '어떤 종목을 볼지'만 정합니다. 시세·지표는 ③ build_snapshot.py 가 직접 받습니다.

  입력   한투 공개 마스터(🇰🇷) · 위키 S&P500 + 나스닥 스크리너(🇺🇸) — scripts/universe.py
         public/data/watchlist.json (보유·관심·추가·빼기) · scripts/tickers_extra.txt (직접 넣는 종목)
  출력   public/data/universe.json      { updatedAt, stocks: { 티커: {label, market, sector, mcap, suffix} } }
         public/data/universe_log.json  이번 주 들어온·나간 종목 (앱 📦 종목풀 · 점검 탭)
  기준   🇰🇷 보통주 · 거래정지/관리/경고/정리매매 제외 · 시총 3,000억↑ · 거래대금 상위 150 ∪ 시총 상위 150
         🇺🇸 S&P500 전부 + 시총 $25B↑ · 거래대금 $50M↑ (같은 회사 다른 주식 종류는 하나만)
  안전   명단 수신이 실패하면 그 시장은 지난주 목록을 그대로 둠 · 이번 주 목록이 너무 작으면 정리(빼기)를 건너뜀

  예전 fetch_yahoo.py(2,056줄)를 대신합니다 — 그 파일은 옛 텔레그램·한투 시세·옛 매수 신호·6개월 캔들 수집까지 했지만
  지금 앱·알림이 쓰는 결과는 '목록'뿐이었습니다(나머지는 아무도 읽지 않음). 바꿔 끼울 땐 이 파일만 교체하면 됩니다.
  실행: python scripts/build_universe.py      (표준 라이브러리만 씀)
"""
import json, os, sys
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import universe as U

DATA = os.path.join(HERE, "..", "public", "data")
OUT = os.path.join(DATA, "universe.json")
LOG = os.path.join(DATA, "universe_log.json")
EXTRA = os.path.join(HERE, "tickers_extra.txt")


def _load(path, default):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:
        return default


def previous():
    """지난주 목록 — universe.json, 없으면 예전 stocks.json (처음 한 번 옮길 때)"""
    src = _load(OUT, None) or _load(os.path.join(DATA, "stocks.json"), {})
    out = {}
    for t, v in (src.get("stocks") or {}).items():
        sec = v.get("sector") or ""
        if sec in ("US", "Korean", "KR", "us", "kr"): sec = ""          # 예전 값은 업종이 아니라 시장 이름
        out[t] = {"label": v.get("label") or t, "market": (v.get("market") or "us").lower(), "sector": sec,
                  "mcap": v.get("mcap"), "suffix": v.get("suffix")}
    return out


def protected(wl):
    """순위와 무관하게 남길 종목 — 보유·관심·추가 + tickers_extra.txt"""
    keep = {p.get("t") for p in (wl.get("positions") or []) if p.get("t")}
    keep |= set(wl.get("watch") or []) | set(wl.get("extras") or [])
    try:
        for raw in open(EXTRA, encoding="utf-8"):
            line = raw.split("#")[0].strip()
            if line: keep.add(line.split()[0].upper())
    except Exception:
        pass
    return {str(t).upper() for t in keep if t}


def main():
    prev = previous()
    wl = _load(os.path.join(DATA, "watchlist.json"), {})
    pool, entry_excluded = {}, {}
    # 🇰🇷
    master = U.kr_master()
    if len(master) > 1000:
        kr_pool, kr_rs = U.build_kr_pool(master)
        pool.update(kr_pool); entry_excluded["kr"] = kr_rs
        print(f"🇰🇷 공식 명단 {len(master)} → 적격 상위 {len(kr_pool)} (입구 제외: {kr_rs})")
    else:
        kept = {t: v for t, v in prev.items() if v["market"] == "kr"}
        pool.update(kept)
        print(f"⚠️ 🇰🇷 공식 명단 수신 실패 → 지난주 한국 목록 유지 ({len(kept)}개)")
    # 🇺🇸
    sp, scr = U.sp500(), U.us_screener()
    if len(sp) > 400:
        us_pool, us_rs = U.build_us_pool(sp, scr)
        if len(scr) < 3000:   # 스크리너 실패 → S&P500 밖 종목이 한꺼번에 빠지지 않게 지난주 미국 종목 유지
            kept = {t: v for t, v in prev.items() if v["market"] == "us" and t not in us_pool}
            us_pool.update(kept)
            print(f"⚠️ 나스닥 스크리너 실패({len(scr)}) → S&P500 밖 종목은 지난주 목록 유지 ({len(kept)}개)")
        pool.update(us_pool); entry_excluded["us"] = us_rs
        print(f"🇺🇸 S&P {len(sp)} + 스크리너 {len(scr)} → {len(us_pool)} (입구 제외: {us_rs})")
    else:
        kept = {t: v for t, v in prev.items() if v["market"] == "us"}
        pool.update(kept)
        print(f"⚠️ 🇺🇸 S&P500 명단 수신 실패 → 지난주 미국 목록 유지 ({len(kept)}개)")
    # 앱 검색으로 넣은 종목 · 빼기
    for t, info in (wl.get("stocks") or {}).items():
        pool.setdefault(str(t).upper(), info)
    prot = protected(wl)
    excl = {str(t).upper() for t in (wl.get("excludes") or [])} - prot

    # 새 목록 = 이번 주 기준 통과 ∪ 보호 − 빼기. 이번 주 목록이 너무 작으면(수집 실패 의심) 지난주 것을 빼지 않음
    n_kr = sum(1 for v in pool.values() if v.get("market") == "kr")
    n_us = sum(1 for v in pool.values() if v.get("market") != "kr")
    prune = n_kr >= 120 and n_us >= 300
    if not prune: print(f"⚠️ 이번 주 목록이 작아서(한국 {n_kr} · 미국 {n_us}) 지난주 종목을 빼지 않습니다 — 수집 실패 의심")
    out = {}
    for t in (set(pool) | prot | (set(prev) if not prune else set())) - excl:
        info, old = pool.get(t) or {}, prev.get(t) or {}
        if not info and not old: continue                     # 보호 목록에만 있고 정보가 없는 종목은 ③ 단계가 이름을 채움(load_extra)
        sec = info.get("sector") if info.get("sector") not in (None, "", "US", "Korean") else old.get("sector", "")
        out[t] = {"label": (info.get("label") if info.get("market") == "kr" else None) or old.get("label") or info.get("label") or t,
                  "market": (info.get("market") or old.get("market") or "us").lower(), "sector": sec or "",
                  "mcap": info.get("mcap") if info.get("mcap") is not None else old.get("mcap"),
                  "suffix": info.get("suffix") or old.get("suffix")}
    json.dump({"updatedAt": datetime.now(timezone.utc).isoformat(), "stocks": dict(sorted(out.items()))},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    # 변경 기록
    pk, nk = set(prev), set(out)
    log = {"date": datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M KST"),
           "total": len(nk), "prevTotal": len(pk),
           "added": [{"t": t, "n": out[t]["label"], "m": out[t]["market"]} for t in sorted(nk - pk)],
           "removed": [{"t": t, "n": prev[t]["label"], "m": prev[t]["market"]} for t in sorted(pk - nk)],
           "entryExcluded": entry_excluded,
           "rules": {"kr": "보통주 · 거래정지/관리/경고/정리매매 제외 · 시총 3,000억↑ · 거래대금 상위 150 ∪ 시총 상위 150",
                     "us": "S&P500 + 시총 $25B↑ · 거래대금 $50M↑"}}
    json.dump(log, open(LOG, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"📦 종목풀 {len(pk)} → {len(nk)} (추가 {len(log['added'])} · 제외 {len(log['removed'])}) → universe.json")
    for x in log["added"][:8]: print(f"   ➕ {x['n']} ({x['t']})")
    for x in log["removed"][:8]: print(f"   ➖ {x['n']} ({x['t']})")


if __name__ == "__main__":
    main()
