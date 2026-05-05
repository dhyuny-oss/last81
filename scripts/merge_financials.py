#!/usr/bin/env python3
"""
Beta Terminal v0.5 — financials_us.json → stocks.json 통합
================================================================================

목적:
  - financials_us.json (베타가 만든 미국 재무 데이터)
  - → stocks.json의 'financials' 섹션에 병합
  - 알파의 다른 필드 (stocks, pool, indices, sectors, breadth 등) 절대 안 건드림

⚠️ 안전 원칙:
  - stocks.json의 키 중 'financials' 만 수정/추가
  - 다른 모든 키는 그대로 유지 (deep copy)
  - 백업 권장 (워크플로에서 git diff 확인하면 됨)

전략:
  - 알파의 quarterly.yml은 'earnings' 모듈만 사용 → financials[ticker].epsQuarterly/revQuarterly만
  - 베타가 추가하는 건 financials[ticker].income / balance / cashflow / keyStats
  - 같은 financials[ticker] 안에 두 종류 데이터 공존 가능 (필드 이름 안 겹침)

흐름:
  1. stocks.json 로드 (전체)
  2. financials_us.json 로드 (베타 데이터)
  3. stocks.json["financials"] 안에 베타 데이터 병합 (기존 epsQuarterly/revQuarterly 보존)
  4. stocks.json 저장 — 다른 필드는 그대로
"""

import json
import os
import sys
import time
from datetime import datetime

WORKSPACE = os.environ.get("GITHUB_WORKSPACE", ".")
STOCKS_PATH = os.path.join(WORKSPACE, "public", "data", "stocks.json")
US_PATH = os.path.join(WORKSPACE, "public", "data", "financials_us.json")
LOG_PATH = os.path.join(WORKSPACE, "public", "data", "financials_merge_log.txt")


def main():
    print("=" * 70)
    print(f"Beta Terminal v0.5 — financials_us → stocks.json 병합")
    print(f"시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    # ─── 1. 입력 파일 검증 ───
    if not os.path.exists(STOCKS_PATH):
        print(f"❌ {STOCKS_PATH} 없음")
        sys.exit(1)
    if not os.path.exists(US_PATH):
        print(f"❌ {US_PATH} 없음 — quarterly-us.yml 먼저 실행 필요")
        sys.exit(1)

    # ─── 2. 로드 ───
    with open(STOCKS_PATH, "r", encoding="utf-8") as f:
        stocks = json.load(f)
    with open(US_PATH, "r", encoding="utf-8") as f:
        us_data = json.load(f)

    print(f"\n📂 stocks.json 로드 — 키: {list(stocks.keys())}")
    print(f"📂 financials_us.json 로드 — 종목: {len(us_data.get('data', {}))}")

    # ─── 3. 안전 검증: stocks.json의 핵심 필드 존재 확인 ───
    required_keys = ["stocks", "pool", "updatedAt"]
    for k in required_keys:
        if k not in stocks:
            print(f"⚠️ stocks.json에 '{k}' 없음 — 비정상 상태일 수 있음 (계속 진행)")

    # 알파의 기존 데이터 통계 (변경 안 됨 검증용)
    before_stats = {
        "stocks_count": len(stocks.get("stocks", {})),
        "pool_count": len(stocks.get("pool", {})),
        "indices_count": len(stocks.get("indices", {})),
        "sectors_count": len(stocks.get("sectors", {})),
        "has_breadth": "breadth" in stocks,
        "has_fearGreed": "fearGreed" in stocks,
    }
    print(f"\n📊 알파 데이터 (변경 전):")
    for k, v in before_stats.items():
        print(f"   {k}: {v}")

    # ─── 4. 병합 ───
    # financials 섹션이 없으면 생성
    if "financials" not in stocks:
        stocks["financials"] = {}

    financials = stocks["financials"]

    # 기존 알파 epsQuarterly/revQuarterly 보존
    alpha_quarterly_count = sum(1 for v in financials.values() if "epsQuarterly" in v or "revQuarterly" in v)
    print(f"\n📊 알파의 기존 분기 데이터: {alpha_quarterly_count}종목")

    # 베타 데이터 병합
    us_results = us_data.get("data", {})
    added = 0
    updated = 0

    for ticker, beta_fin in us_results.items():
        if ticker in financials:
            # 기존 알파 데이터 보존 + 베타 필드 추가
            existing = financials[ticker]
            # 알파의 epsQuarterly/revQuarterly 그대로 두고 베타 필드만 추가
            existing["income"] = beta_fin.get("income")
            existing["balance"] = beta_fin.get("balance")
            existing["cashflow"] = beta_fin.get("cashflow")
            existing["keyStats"] = beta_fin.get("keyStats")
            existing["currency"] = beta_fin.get("currency")
            existing["fiscalYearEnd"] = beta_fin.get("fiscalYearEnd")
            existing["betaUpdatedAt"] = beta_fin.get("updatedAt")  # 베타 갱신 시각
            updated += 1
        else:
            # 신규 종목 — 통째로 추가
            beta_fin["betaUpdatedAt"] = beta_fin.pop("updatedAt", None)
            financials[ticker] = beta_fin
            added += 1

    # ─── 5. 알파 데이터 무결성 검증 (변경되지 않았는지) ───
    after_stats = {
        "stocks_count": len(stocks.get("stocks", {})),
        "pool_count": len(stocks.get("pool", {})),
        "indices_count": len(stocks.get("indices", {})),
        "sectors_count": len(stocks.get("sectors", {})),
        "has_breadth": "breadth" in stocks,
        "has_fearGreed": "fearGreed" in stocks,
    }
    print(f"\n📊 알파 데이터 (변경 후):")
    for k, v in after_stats.items():
        marker = "✅" if v == before_stats[k] else "⚠️ 변경됨!"
        print(f"   {k}: {v} {marker}")

    # 무결성 깨졌으면 중단
    if after_stats != before_stats:
        print("\n❌ 알파 데이터 무결성 깨짐 — 저장하지 않음")
        sys.exit(1)

    # ─── 6. 저장 ───
    # 알파의 updatedAt 형식 유지 — 알파의 갱신 시각 그대로
    # (병합 시각은 별도 betaMergedAt 필드로 추가)
    stocks["betaMergedAt"] = datetime.utcnow().isoformat() + "Z"

    with open(STOCKS_PATH, "w", encoding="utf-8") as f:
        # 알파 코드와 동일한 separators 사용 (compact, line 1614의 패턴)
        json.dump(stocks, f, ensure_ascii=False, separators=(",", ":"))

    file_size = os.path.getsize(STOCKS_PATH) / 1024
    print(f"\n💾 저장: {STOCKS_PATH} ({file_size:.0f}KB)")

    # ─── 7. 로그 ───
    log_lines = [
        f"# financials_us → stocks.json 병합 결과",
        f"# {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"",
        f"## 병합 통계",
        f"- 베타 미국 데이터: {len(us_results)}종목",
        f"- 신규 추가: {added}",
        f"- 기존 업데이트: {updated}",
        f"- 알파 분기 데이터 보존: {alpha_quarterly_count}",
        f"",
        f"## 알파 데이터 무결성 (변경 전 = 후)",
        f"- stocks: {before_stats['stocks_count']} → {after_stats['stocks_count']} ✅",
        f"- pool: {before_stats['pool_count']} → {after_stats['pool_count']} ✅",
        f"- indices: {before_stats['indices_count']} → {after_stats['indices_count']} ✅",
        f"- sectors: {before_stats['sectors_count']} → {after_stats['sectors_count']} ✅",
        f"",
        f"## 파일 크기",
        f"- stocks.json: {file_size:.0f}KB",
        f"",
        f"## 다음 단계",
        f"- ✅ 베타 UI에서 stocks.json의 financials 섹션 fetch 가능",
        f"- → PR #3c 단계 3: DiscoveryTab.jsx 수정 (가짜 데이터 → 진짜 데이터)",
    ]

    with open(LOG_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines))

    print(f"📝 로그: {LOG_PATH}")

    print("\n" + "=" * 70)
    print(f"✅ 병합 완료")
    print(f"   신규 {added} | 업데이트 {updated} | 알파 무결성 ✅")
    print("=" * 70)


if __name__ == "__main__":
    main()
