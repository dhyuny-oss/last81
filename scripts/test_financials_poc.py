#!/usr/bin/env python3
"""
Beta Terminal v0.1 — 재무 데이터 PoC
================================================================================

목적: GitHub Actions에서 안전하게 실행. 미국 10종목 재무 데이터 수집 시도.

⚠️ 안전 원칙:
  - stocks.json 절대 안 건드림 (알파 데이터 보호)
  - 결과는 public/data/financials_test.json 에 별도 저장
  - 실패해도 알파에 영향 0%

수집 항목:
  - 손익 (TTM + 최근 2년 연간)
  - 재무상태표 (현재 + 1년 전)
  - 현금흐름 (최근 2년 연간)
  - 야후 직접 제공 비율 (PER, PBR, ROE, ROA, 부채비율 등)
  - 야후 애널리스트 목표가
"""

import json
import os
import sys
import time
from datetime import datetime

try:
    import requests
except ImportError:
    print("❌ requests 모듈 없음 — workflow YAML에 'pip install requests' 확인")
    sys.exit(1)

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

# 테스트 종목 10개 (다양한 섹터 커버)
TEST_TICKERS = [
    ("AAPL",  "AAPL",  "Tech 메가캡"),
    ("MSFT",  "MSFT",  "Tech 메가캡"),
    ("BRK-B", "BRK-B", "Holdings"),
    ("JNJ",   "JNJ",   "Healthcare"),
    ("KO",    "KO",    "Consumer Staples"),
    ("JPM",   "JPM",   "⚠️ Financial — 비율 의미 다름"),
    ("XOM",   "XOM",   "Energy 사이클릭"),
    ("WMT",   "WMT",   "Retail"),
    ("TSLA",  "TSLA",  "Auto/Tech 고P/E"),
    ("PG",    "PG",    "Consumer Staples 안정"),
]

WORKSPACE = os.environ.get("GITHUB_WORKSPACE", ".")
OUTPUT_PATH = os.path.join(WORKSPACE, "public", "data", "financials_test.json")
LOG_PATH = os.path.join(WORKSPACE, "public", "data", "financials_test_log.txt")


def _yval(d, *keys):
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
        if cur is None:
            return None
    if isinstance(cur, dict) and "raw" in cur:
        return cur["raw"]
    return cur


def _income_pick(stmt):
    if not stmt:
        return None
    return {
        "endDate": _yval(stmt, "endDate", "fmt"),
        "revenue": _yval(stmt, "totalRevenue"),
        "costOfRevenue": _yval(stmt, "costOfRevenue"),
        "grossProfit": _yval(stmt, "grossProfit"),
        "operatingIncome": _yval(stmt, "operatingIncome"),
        "ebit": _yval(stmt, "ebit"),
        "netIncome": _yval(stmt, "netIncome"),
    }


def _balance_pick(stmt):
    if not stmt:
        return None
    sl = _yval(stmt, "shortLongTermDebt")
    lt = _yval(stmt, "longTermDebt")
    total_debt = (sl or 0) + (lt or 0) if (sl is not None or lt is not None) else None
    return {
        "endDate": _yval(stmt, "endDate", "fmt"),
        "totalAssets": _yval(stmt, "totalAssets"),
        "totalLiabilities": _yval(stmt, "totalLiab"),
        "totalEquity": _yval(stmt, "totalStockholderEquity"),
        "currentAssets": _yval(stmt, "totalCurrentAssets"),
        "currentLiabilities": _yval(stmt, "totalCurrentLiabilities"),
        "cash": _yval(stmt, "cash"),
        "totalDebt": total_debt,
    }


def _cashflow_pick(stmt):
    if not stmt:
        return None
    return {
        "endDate": _yval(stmt, "endDate", "fmt"),
        "operatingCashflow": _yval(stmt, "totalCashFromOperatingActivities"),
        "capex": _yval(stmt, "capitalExpenditures"),
        "dividendsPaid": _yval(stmt, "dividendsPaid"),
        "netIncome": _yval(stmt, "netIncome"),
    }


def fetch_financials(ticker, yt):
    modules = ",".join([
        "summaryDetail", "defaultKeyStatistics", "financialData",
        "incomeStatementHistory", "balanceSheetHistory", "cashflowStatementHistory",
    ])
    url = f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{yt}?modules={modules}"

    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            return None, f"HTTP {r.status_code}"
        result = r.json().get("quoteSummary", {}).get("result", [])
        if not result:
            return None, "빈 응답"
        d = result[0]
    except Exception as e:
        return None, f"예외: {e}"

    summary = d.get("summaryDetail") or {}
    keystats = d.get("defaultKeyStatistics") or {}
    fin = d.get("financialData") or {}

    income_hist = (d.get("incomeStatementHistory") or {}).get("incomeStatementHistory") or []
    income_annual = [_income_pick(s) for s in income_hist[:2]]
    while len(income_annual) < 2:
        income_annual.append(None)

    bal_hist = (d.get("balanceSheetHistory") or {}).get("balanceSheetStatements") or []
    balance_annual = [_balance_pick(s) for s in bal_hist[:2]]
    while len(balance_annual) < 2:
        balance_annual.append(None)

    cf_hist = (d.get("cashflowStatementHistory") or {}).get("cashflowStatements") or []
    cashflow_annual = [_cashflow_pick(s) for s in cf_hist[:2]]
    while len(cashflow_annual) < 2:
        cashflow_annual.append(None)

    keyStats = {
        "marketCap": _yval(summary, "marketCap"),
        "enterpriseValue": _yval(keystats, "enterpriseValue"),
        "trailingPE": _yval(summary, "trailingPE"),
        "forwardPE": _yval(summary, "forwardPE"),
        "priceToBook": _yval(keystats, "priceToBook"),
        "priceToSalesTTM": _yval(summary, "priceToSalesTrailing12Months"),
        "evToEbitda": _yval(keystats, "enterpriseToEbitda"),
        "trailingEps": _yval(keystats, "trailingEps"),
        "forwardEps": _yval(keystats, "forwardEps"),
        "returnOnAssets": _yval(fin, "returnOnAssets"),
        "returnOnEquity": _yval(fin, "returnOnEquity"),
        "debtToEquity": _yval(fin, "debtToEquity"),
        "currentRatio": _yval(fin, "currentRatio"),
        "grossMargins": _yval(fin, "grossMargins"),
        "operatingMargins": _yval(fin, "operatingMargins"),
        "profitMargins": _yval(fin, "profitMargins"),
        "dividendYield": _yval(summary, "dividendYield"),
        "beta": _yval(summary, "beta"),
        "targetMeanPrice": _yval(fin, "targetMeanPrice"),
        "targetHighPrice": _yval(fin, "targetHighPrice"),
        "targetLowPrice": _yval(fin, "targetLowPrice"),
        "numberOfAnalystOpinions": _yval(fin, "numberOfAnalystOpinions"),
    }

    fy_end = income_annual[0]["endDate"] if income_annual[0] else None

    return {
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "currency": _yval(fin, "financialCurrency") or _yval(summary, "currency"),
        "fiscalYearEnd": fy_end,
        "income": {
            "ttm": {
                "revenue": _yval(fin, "totalRevenue"),
                "ebitda": _yval(fin, "ebitda"),
                "operatingCashflow": _yval(fin, "operatingCashflow"),
                "freeCashflow": _yval(fin, "freeCashflow"),
            },
            "latest": income_annual[0],
            "prior": income_annual[1],
        },
        "balance": {
            "current": balance_annual[0],
            "yearAgo": balance_annual[1],
        },
        "cashflow": {
            "latest": cashflow_annual[0],
            "prior": cashflow_annual[1],
        },
        "keyStats": keyStats,
    }, "OK"


def analyze_completeness(result):
    if result is None:
        return ["전체 수집 실패"]
    missing = []
    inc = result["income"]
    bal = result["balance"]
    cf = result["cashflow"]
    ks = result["keyStats"]
    if not inc["latest"]: missing.append("income.latest")
    if not inc["prior"]:  missing.append("income.prior (델타 불가)")
    if not bal["current"]: missing.append("balance.current")
    if not bal["yearAgo"]: missing.append("balance.yearAgo (델타 불가)")
    if not cf["latest"]: missing.append("cashflow.latest")
    elif cf["latest"].get("operatingCashflow") is None:
        missing.append("cashflow.operatingCashflow")
    for f in ["marketCap", "trailingPE", "priceToBook", "returnOnEquity"]:
        if ks.get(f) is None:
            missing.append(f"keyStats.{f}")
    return missing


def fmt_money(v):
    if v is None: return "—"
    if abs(v) >= 1e12: return f"{v/1e12:.2f}T"
    if abs(v) >= 1e9:  return f"{v/1e9:.2f}B"
    if abs(v) >= 1e6:  return f"{v/1e6:.1f}M"
    return f"{v:.0f}"


def fmt_ratio(v):
    return "—" if v is None else f"{v:.2f}"


def main():
    print("=" * 70)
    print(f"Beta Terminal v0.1 — 재무 PoC")
    print(f"시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"대상: {len(TEST_TICKERS)} 종목")
    print(f"결과 → {OUTPUT_PATH}")
    print("=" * 70)

    all_results = {}
    log_lines = [
        f"# Beta Terminal PoC 결과",
        f"# 시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"",
        f"| 티커 | 시총 | P/E | P/B | ROE | CR | CFO | 결측 | 메모 |",
        f"|------|------|-----|-----|-----|-----|-----|------|------|",
    ]

    success = 0
    skip = 0
    full = 0

    for ticker, yt, note in TEST_TICKERS:
        print(f"\n[{ticker}] {note}")
        result, status = fetch_financials(ticker, yt)

        if result is None:
            print(f"  ❌ 실패: {status}")
            log_lines.append(f"| {ticker} | ❌ | — | — | — | — | — | 실패 | {status} |")
            skip += 1
            time.sleep(0.5)
            continue

        all_results[ticker] = result
        success += 1
        ks = result["keyStats"]
        cf_l = result["cashflow"]["latest"] or {}
        missing = analyze_completeness(result)
        if not missing:
            full += 1

        print(f"  통화: {result['currency']} | FY끝: {result['fiscalYearEnd']}")
        print(f"  시총: {fmt_money(ks.get('marketCap'))} | "
              f"PE: {fmt_ratio(ks.get('trailingPE'))} | "
              f"PB: {fmt_ratio(ks.get('priceToBook'))} | "
              f"ROE: {fmt_ratio(ks.get('returnOnEquity'))}")
        print(f"  CFO: {fmt_money(cf_l.get('operatingCashflow'))} | "
              f"결측: {len(missing)}건")
        if missing:
            for m in missing[:5]:
                print(f"     - {m}")

        log_lines.append(
            f"| {ticker} | {fmt_money(ks.get('marketCap'))} | "
            f"{fmt_ratio(ks.get('trailingPE'))} | "
            f"{fmt_ratio(ks.get('priceToBook'))} | "
            f"{fmt_ratio(ks.get('returnOnEquity'))} | "
            f"{fmt_ratio(ks.get('currentRatio'))} | "
            f"{fmt_money(cf_l.get('operatingCashflow'))} | "
            f"{len(missing)}건 | {note} |"
        )

        time.sleep(0.5)

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump({
            "_meta": {
                "type": "beta_financials_test",
                "version": "v0.1",
                "generated": datetime.now().isoformat(),
                "warning": "이 파일은 PoC 결과. stocks.json과 별개. 알파 영향 없음.",
                "stats": {
                    "total": len(TEST_TICKERS),
                    "success": success,
                    "full_complete": full,
                    "skip": skip,
                },
            },
            "data": all_results,
        }, f, ensure_ascii=False, indent=2)

    log_lines.append("")
    log_lines.append(f"## 통계")
    log_lines.append(f"- 시도: {len(TEST_TICKERS)}")
    log_lines.append(f"- 성공: {success}")
    log_lines.append(f"- 완전 수집 (결측 0): {full}")
    log_lines.append(f"- 실패: {skip}")

    with open(LOG_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines))

    print("\n" + "=" * 70)
    print(f"✅ 완료: 성공 {success}/{len(TEST_TICKERS)} | 완전 수집 {full}")
    print(f"💾 {OUTPUT_PATH}")
    print(f"📝 {LOG_PATH}")
    print("=" * 70)


if __name__ == "__main__":
    main()
