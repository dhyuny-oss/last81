#!/usr/bin/env python3
"""
Beta Terminal v0.2 — 재무 데이터 PoC (yfinance 기반)
================================================================================

⚠️ 안전 원칙:
  - stocks.json 절대 안 건드림
  - 결과는 public/data/financials_test.json 별도 저장
  - 알파의 quarterly.yml과 같은 'yfinance + requests' 스택 사용

PoC v0.1 (직접 quoteSummary 호출) → v0.2 변경:
  - HTTP 401 회피 위해 yfinance 라이브러리 사용
  - 알파 quarterly.yml과 동일한 의존성 (한몸 처럼 돌게)
  - yfinance가 내부적으로 crumb + cookie + retry 자동 처리

수집 항목:
  - 손익 (latest + prior 연간)
  - 재무상태표 (current + yearAgo)
  - 현금흐름 (latest + prior 연간)
  - keyStats (시총, PER, PBR, ROE, ROA, 부채비율, 마진, 베타 등)
  - 야후 애널리스트 목표가 (numberOfAnalystOpinions, targetMeanPrice 등)
"""

import json
import os
import sys
import time
from datetime import datetime

try:
    import yfinance as yf
except ImportError:
    print("❌ yfinance 모듈 없음 — workflow YAML에 'pip install yfinance' 확인")
    sys.exit(1)


# ─── 테스트 종목 10개 ─────────────────────────────────────
TEST_TICKERS = [
    ("AAPL",  "Tech 메가캡"),
    ("MSFT",  "Tech 메가캡"),
    ("BRK-B", "Holdings"),
    ("JNJ",   "Healthcare"),
    ("KO",    "Consumer Staples"),
    ("JPM",   "⚠️ Financial — 비율 의미 다름"),
    ("XOM",   "Energy 사이클릭"),
    ("WMT",   "Retail"),
    ("TSLA",  "Auto/Tech 고P/E"),
    ("PG",    "Consumer Staples 안정"),
]

WORKSPACE = os.environ.get("GITHUB_WORKSPACE", ".")
OUTPUT_PATH = os.path.join(WORKSPACE, "public", "data", "financials_test.json")
LOG_PATH = os.path.join(WORKSPACE, "public", "data", "financials_test_log.txt")


# ─── 헬퍼: pandas DataFrame에서 안전 추출 ─────────────────

def _df_get(df, row_keys, col_idx):
    """DataFrame에서 row 이름 list 중 첫 매치, col 인덱스로 값 추출.
    yfinance의 financials/balance_sheet/cashflow는 row=항목, col=날짜 형식.
    """
    if df is None or df.empty or col_idx >= len(df.columns):
        return None
    # row_keys가 단일 문자열이면 리스트로 변환
    if isinstance(row_keys, str):
        row_keys = [row_keys]
    for key in row_keys:
        if key in df.index:
            try:
                v = df.iloc[df.index.get_loc(key), col_idx]
                if v is None:
                    return None
                # NaN 처리
                import math
                v = float(v)
                if math.isnan(v):
                    return None
                return v
            except (KeyError, ValueError, IndexError):
                continue
    return None


def _df_date(df, col_idx):
    """DataFrame col의 날짜 추출 (YYYY-MM-DD)."""
    if df is None or df.empty or col_idx >= len(df.columns):
        return None
    try:
        col = df.columns[col_idx]
        if hasattr(col, "strftime"):
            return col.strftime("%Y-%m-%d")
        return str(col)[:10]
    except Exception:
        return None


def extract_income(df, col_idx):
    """손익계산서에서 우리 필요한 필드 추출."""
    if df is None or df.empty or col_idx >= len(df.columns):
        return None
    return {
        "endDate": _df_date(df, col_idx),
        "revenue":         _df_get(df, ["Total Revenue", "TotalRevenue"], col_idx),
        "costOfRevenue":   _df_get(df, ["Cost Of Revenue", "CostOfRevenue", "Cost of Revenue"], col_idx),
        "grossProfit":     _df_get(df, ["Gross Profit", "GrossProfit"], col_idx),
        "operatingIncome": _df_get(df, ["Operating Income", "OperatingIncome"], col_idx),
        "ebit":            _df_get(df, ["EBIT", "Ebit"], col_idx),
        "netIncome":       _df_get(df, ["Net Income", "NetIncome", "Net Income Common Stockholders"], col_idx),
    }


def extract_balance(df, col_idx):
    """재무상태표에서 필드 추출."""
    if df is None or df.empty or col_idx >= len(df.columns):
        return None
    sl = _df_get(df, ["Short Term Debt", "ShortTermDebt", "Current Debt"], col_idx)
    lt = _df_get(df, ["Long Term Debt", "LongTermDebt", "Long Term Debt And Capital Lease Obligation"], col_idx)
    total_debt = (sl or 0) + (lt or 0) if (sl is not None or lt is not None) else None
    # yfinance가 직접 Total Debt 줄 때도 있음 — 있으면 그걸 우선
    direct_total = _df_get(df, ["Total Debt", "TotalDebt"], col_idx)
    if direct_total is not None:
        total_debt = direct_total
    return {
        "endDate": _df_date(df, col_idx),
        "totalAssets":        _df_get(df, ["Total Assets", "TotalAssets"], col_idx),
        "totalLiabilities":   _df_get(df, ["Total Liabilities Net Minority Interest", "Total Liab", "TotalLiab"], col_idx),
        "totalEquity":        _df_get(df, ["Total Equity Gross Minority Interest", "Stockholders Equity", "Total Stockholder Equity"], col_idx),
        "currentAssets":      _df_get(df, ["Current Assets", "Total Current Assets"], col_idx),
        "currentLiabilities": _df_get(df, ["Current Liabilities", "Total Current Liabilities"], col_idx),
        "cash":               _df_get(df, ["Cash And Cash Equivalents", "Cash"], col_idx),
        "totalDebt":          total_debt,
    }


def extract_cashflow(df, col_idx):
    """현금흐름표에서 필드 추출."""
    if df is None or df.empty or col_idx >= len(df.columns):
        return None
    return {
        "endDate": _df_date(df, col_idx),
        "operatingCashflow": _df_get(df, ["Operating Cash Flow", "Total Cash From Operating Activities", "Cash Flow From Continuing Operating Activities"], col_idx),
        "capex":             _df_get(df, ["Capital Expenditure", "Capital Expenditures"], col_idx),
        "freeCashflow":      _df_get(df, ["Free Cash Flow", "FreeCashFlow"], col_idx),
        "dividendsPaid":     _df_get(df, ["Cash Dividends Paid", "Dividends Paid", "Common Stock Dividend Paid"], col_idx),
        "netIncome":         _df_get(df, ["Net Income From Continuing Operations", "Net Income"], col_idx),
    }


def extract_keystats(info):
    """yfinance ticker.info 에서 비율/목표가 등 추출."""
    if not info:
        return {}
    # 안전 추출 (None 보존)
    def g(*keys):
        for k in keys:
            v = info.get(k)
            if v is not None:
                return v
        return None
    return {
        "marketCap":            g("marketCap"),
        "enterpriseValue":      g("enterpriseValue"),
        "trailingPE":           g("trailingPE"),
        "forwardPE":            g("forwardPE"),
        "priceToBook":          g("priceToBook"),
        "priceToSalesTTM":      g("priceToSalesTrailing12Months"),
        "evToEbitda":           g("enterpriseToEbitda"),
        "trailingEps":          g("trailingEps"),
        "forwardEps":           g("forwardEps"),
        "returnOnAssets":       g("returnOnAssets"),
        "returnOnEquity":       g("returnOnEquity"),
        "debtToEquity":         g("debtToEquity"),
        "currentRatio":         g("currentRatio"),
        "quickRatio":           g("quickRatio"),
        "grossMargins":         g("grossMargins"),
        "operatingMargins":     g("operatingMargins"),
        "profitMargins":        g("profitMargins"),
        "ebitdaMargins":        g("ebitdaMargins"),
        "dividendYield":        g("dividendYield"),
        "payoutRatio":          g("payoutRatio"),
        "beta":                 g("beta"),
        "revenueGrowth":        g("revenueGrowth"),
        "earningsGrowth":       g("earningsGrowth"),
        # 야후 애널리스트 목표가
        "targetMeanPrice":            g("targetMeanPrice"),
        "targetHighPrice":            g("targetHighPrice"),
        "targetLowPrice":             g("targetLowPrice"),
        "numberOfAnalystOpinions":    g("numberOfAnalystOpinions"),
        # 산업/섹터 메타
        "sector":               g("sector"),
        "industry":             g("industry"),
        "longName":             g("longName", "shortName"),
    }


# ─── 메인 fetch ────────────────────────────────────────

def fetch_financials(ticker):
    """yfinance로 한 종목 재무 수집. 성공: (dict, 'OK') / 실패: (None, '에러')"""
    try:
        t = yf.Ticker(ticker)

        # info (시총, 비율, 목표가 등)
        try:
            info = t.info or {}
        except Exception as e:
            info = {}

        keyStats = extract_keystats(info)

        # 연간 손익
        try:
            inc_df = t.financials  # 4년치, col=날짜
        except Exception:
            inc_df = None
        income_latest = extract_income(inc_df, 0) if inc_df is not None else None
        income_prior  = extract_income(inc_df, 1) if inc_df is not None else None

        # 연간 재무상태표
        try:
            bal_df = t.balance_sheet
        except Exception:
            bal_df = None
        balance_current = extract_balance(bal_df, 0) if bal_df is not None else None
        balance_yearAgo = extract_balance(bal_df, 1) if bal_df is not None else None

        # 연간 현금흐름
        try:
            cf_df = t.cashflow
        except Exception:
            cf_df = None
        cashflow_latest = extract_cashflow(cf_df, 0) if cf_df is not None else None
        cashflow_prior  = extract_cashflow(cf_df, 1) if cf_df is not None else None

        # 데이터 한 개도 없으면 실패 처리
        if not info and income_latest is None and balance_current is None:
            return None, "yfinance 응답 없음 (info+재무 모두 비어있음)"

        # 통화/회계연도 끝
        currency = info.get("financialCurrency") or info.get("currency")
        fy_end = (income_latest or {}).get("endDate") if income_latest else None

        return {
            "updatedAt":     time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "currency":      currency,
            "fiscalYearEnd": fy_end,
            "income": {
                "latest": income_latest,
                "prior":  income_prior,
            },
            "balance": {
                "current": balance_current,
                "yearAgo": balance_yearAgo,
            },
            "cashflow": {
                "latest": cashflow_latest,
                "prior":  cashflow_prior,
            },
            "keyStats": keyStats,
        }, "OK"

    except Exception as e:
        return None, f"예외: {type(e).__name__}: {e}"


# ─── 결측 분석 ───────────────────────────────────────────

def analyze_completeness(result):
    if result is None:
        return ["전체 수집 실패"]
    missing = []
    inc, bal, cf, ks = result["income"], result["balance"], result["cashflow"], result["keyStats"]
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
    try:
        if abs(v) >= 1e12: return f"{v/1e12:.2f}T"
        if abs(v) >= 1e9:  return f"{v/1e9:.2f}B"
        if abs(v) >= 1e6:  return f"{v/1e6:.1f}M"
        return f"{v:.0f}"
    except Exception:
        return "—"


def fmt_ratio(v):
    if v is None: return "—"
    try:
        return f"{float(v):.2f}"
    except Exception:
        return "—"


# ─── 메인 ─────────────────────────────────────────────

def main():
    print("=" * 70)
    print(f"Beta Terminal v0.2 — 재무 PoC (yfinance)")
    print(f"yfinance: {yf.__version__}")
    print(f"시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"대상: {len(TEST_TICKERS)} 종목")
    print(f"결과 → {OUTPUT_PATH}")
    print("=" * 70)

    all_results = {}
    log_lines = [
        f"# Beta Terminal PoC 결과 (yfinance)",
        f"# 시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"# yfinance v{yf.__version__}",
        f"",
        f"| 티커 | 시총 | P/E | P/B | ROE | CR | CFO | 결측 | 메모 |",
        f"|------|------|-----|-----|-----|-----|-----|------|------|",
    ]

    success = 0
    skip = 0
    full = 0

    for ticker, note in TEST_TICKERS:
        print(f"\n[{ticker}] {note}")
        result, status = fetch_financials(ticker)

        if result is None:
            print(f"  ❌ 실패: {status}")
            log_lines.append(f"| {ticker} | ❌ | — | — | — | — | — | 실패 | {note} ({status}) |")
            skip += 1
            time.sleep(0.8)
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
              f"목표가: {fmt_ratio(ks.get('targetMeanPrice'))} | "
              f"애널 수: {ks.get('numberOfAnalystOpinions')} | "
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

        time.sleep(0.8)

    # 결과 저장
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump({
            "_meta": {
                "type": "beta_financials_test",
                "version": "v0.2-yfinance",
                "yfinance_version": yf.__version__,
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
    log_lines.append("")
    log_lines.append("## 알파 호환성")
    log_lines.append(f"- yfinance: 알파 quarterly.yml과 동일 의존성 ✅")
    log_lines.append(f"- 알파 stocks.json: 영향 없음 ✅")
    log_lines.append(f"- 다음 단계: 결과 좋으면 본 quarterly.yml에 통합")

    with open(LOG_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines))

    print("\n" + "=" * 70)
    print(f"✅ 완료: 성공 {success}/{len(TEST_TICKERS)} | 완전 수집 {full}")
    print(f"💾 {OUTPUT_PATH}")
    print(f"📝 {LOG_PATH}")
    print("=" * 70)


if __name__ == "__main__":
    main()
