#!/usr/bin/env python3
"""
Beta Terminal v0.3 — 재무 데이터 PoC (US + KR)
================================================================================

v0.2 → v0.3 변경:
  - 한국 종목 5개 추가 (`.KS` / `.KQ` 접미사 자동 처리)
  - BRK-B 스타일 PB 0.0 폴백 추가 (info.priceToBook 누락 시
    bookValue × sharesOutstanding 또는 currentPrice / bookValue 로 계산)
  - 한국 종목 데이터 가용성 진단 (어느 필드 누락되는지)

⚠️ 안전 원칙: stocks.json 안 건드림. 결과는 별도 financials_test.json.
"""

import json
import os
import sys
import time
from datetime import datetime

try:
    import yfinance as yf
except ImportError:
    print("❌ yfinance 모듈 없음")
    sys.exit(1)


# ─── 테스트 종목 (US 10 + KR 5 = 15) ──────────────────────
TEST_TICKERS = [
    # 미국 메가캡 + 다양한 섹터
    ("AAPL",      "us", "Tech 메가캡"),
    ("MSFT",      "us", "Tech 메가캡"),
    ("BRK-B",     "us", "Holdings ⚠ PB 폴백 테스트"),
    ("JNJ",       "us", "Healthcare"),
    ("KO",        "us", "Consumer Staples"),
    ("JPM",       "us", "⚠️ Financial — 비율 의미 다름"),
    ("XOM",       "us", "Energy 사이클릭"),
    ("WMT",       "us", "Retail"),
    ("TSLA",      "us", "Auto/Tech 고P/E"),
    ("PG",        "us", "Consumer Staples 안정"),
    # ── 한국 종목 5개 (PoC) ──
    ("005930.KS", "kr", "삼성전자 (코스피 시총 1위)"),
    ("000660.KS", "kr", "SK하이닉스 (반도체)"),
    ("035420.KS", "kr", "NAVER (인터넷)"),
    ("035720.KS", "kr", "카카오 (코스피)"),
    ("207940.KS", "kr", "삼성바이오로직스 (헬스)"),
]

WORKSPACE = os.environ.get("GITHUB_WORKSPACE", ".")
OUTPUT_PATH = os.path.join(WORKSPACE, "public", "data", "financials_test.json")
LOG_PATH = os.path.join(WORKSPACE, "public", "data", "financials_test_log.txt")


# ─── 헬퍼 ─────────────────────────────────────────────────

def _df_get(df, row_keys, col_idx):
    if df is None or df.empty or col_idx >= len(df.columns):
        return None
    if isinstance(row_keys, str):
        row_keys = [row_keys]
    for key in row_keys:
        if key in df.index:
            try:
                v = df.iloc[df.index.get_loc(key), col_idx]
                if v is None:
                    return None
                import math
                v = float(v)
                if math.isnan(v):
                    return None
                return v
            except (KeyError, ValueError, IndexError):
                continue
    return None


def _df_date(df, col_idx):
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
    if df is None or df.empty or col_idx >= len(df.columns):
        return None
    sl = _df_get(df, ["Short Term Debt", "ShortTermDebt", "Current Debt"], col_idx)
    lt = _df_get(df, ["Long Term Debt", "LongTermDebt", "Long Term Debt And Capital Lease Obligation"], col_idx)
    total_debt = (sl or 0) + (lt or 0) if (sl is not None or lt is not None) else None
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


def extract_keystats(info, balance_current=None):
    """info.priceToBook 누락 시 (BRK-B 사례) bookValue 기반 폴백 계산"""
    if not info:
        return {}

    def g(*keys):
        for k in keys:
            v = info.get(k)
            if v is not None:
                return v
        return None

    pb = g("priceToBook")

    # ── PB 폴백: priceToBook이 0/None일 때 ──
    # bookValue (= 주당순자산) × currentPrice / bookValue
    if pb in (None, 0, 0.0):
        current_price = g("currentPrice", "regularMarketPrice", "previousClose")
        book_value_per_share = g("bookValue")
        if current_price and book_value_per_share and book_value_per_share > 0:
            try:
                pb = float(current_price) / float(book_value_per_share)
            except Exception:
                pb = None
        # 그래도 None이면 — totalEquity / sharesOutstanding 으로 시도
        if pb in (None, 0, 0.0) and balance_current:
            equity = balance_current.get("totalEquity")
            shares = g("sharesOutstanding")
            mkt_cap = g("marketCap")
            if equity and equity > 0 and mkt_cap:
                try:
                    pb = float(mkt_cap) / float(equity)  # P/B = 시총/순자산
                except Exception:
                    pass

    return {
        "marketCap":            g("marketCap"),
        "enterpriseValue":      g("enterpriseValue"),
        "trailingPE":           g("trailingPE"),
        "forwardPE":            g("forwardPE"),
        "priceToBook":          pb,
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
        "currentPrice":         g("currentPrice", "regularMarketPrice"),
        "bookValuePerShare":    g("bookValue"),
    }


def fetch_financials(yt):
    """yfinance로 한 종목 재무 수집."""
    try:
        t = yf.Ticker(yt)

        try:
            info = t.info or {}
        except Exception:
            info = {}

        try:
            inc_df = t.financials
        except Exception:
            inc_df = None
        income_latest = extract_income(inc_df, 0) if inc_df is not None else None
        income_prior  = extract_income(inc_df, 1) if inc_df is not None else None

        try:
            bal_df = t.balance_sheet
        except Exception:
            bal_df = None
        balance_current = extract_balance(bal_df, 0) if bal_df is not None else None
        balance_yearAgo = extract_balance(bal_df, 1) if bal_df is not None else None

        try:
            cf_df = t.cashflow
        except Exception:
            cf_df = None
        cashflow_latest = extract_cashflow(cf_df, 0) if cf_df is not None else None
        cashflow_prior  = extract_cashflow(cf_df, 1) if cf_df is not None else None

        # PB 폴백을 위해 balance_current 전달
        keyStats = extract_keystats(info, balance_current)

        if not info and income_latest is None and balance_current is None:
            return None, "yfinance 응답 없음 (info+재무 모두 비어있음)"

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


def analyze_completeness(result):
    if result is None:
        return ["전체 수집 실패"]
    missing = []
    inc, bal, cf, ks = result["income"], result["balance"], result["cashflow"], result["keyStats"]
    if not inc["latest"]: missing.append("income.latest")
    if not inc["prior"]:  missing.append("income.prior")
    if not bal["current"]: missing.append("balance.current")
    if not bal["yearAgo"]: missing.append("balance.yearAgo")
    if not cf["latest"]: missing.append("cashflow.latest")
    elif cf["latest"].get("operatingCashflow") is None:
        missing.append("cashflow.operatingCashflow")
    for f in ["marketCap", "trailingPE", "priceToBook", "returnOnEquity"]:
        if ks.get(f) is None or ks.get(f) == 0:
            missing.append(f"keyStats.{f}")
    return missing


def fmt_money(v, kr=False):
    if v is None: return "—"
    try:
        if kr:  # 원 단위
            if abs(v) >= 1e12: return f"{v/1e12:.2f}조"
            if abs(v) >= 1e8:  return f"{v/1e8:.1f}억"
            return f"{v:.0f}"
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


def main():
    print("=" * 70)
    print(f"Beta Terminal v0.3 — 재무 PoC (US + KR)")
    print(f"yfinance: {yf.__version__}")
    print(f"시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"대상: {len(TEST_TICKERS)} 종목 (US 10 + KR 5)")
    print("=" * 70)

    all_results = {}
    log_lines = [
        f"# Beta Terminal PoC v0.3 결과 (US + KR)",
        f"# 시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"# yfinance v{yf.__version__}",
        f"",
        f"## 미국 종목 (10)",
        f"",
        f"| 티커 | 시총 | P/E | P/B | ROE | CR | CFO | 결측 | 메모 |",
        f"|------|------|-----|-----|-----|-----|-----|------|------|",
    ]

    success = 0
    full = 0
    skip = 0
    us_full = us_partial = us_fail = 0
    kr_full = kr_partial = kr_fail = 0

    for yt, market, note in TEST_TICKERS:
        # 키는 .KS / .KQ 빼고
        key = yt.replace(".KS", "").replace(".KQ", "")

        print(f"\n[{key}] ({market}) {note}")
        result, status = fetch_financials(yt)

        if result is None:
            print(f"  ❌ 실패: {status}")
            log_lines.append(f"| {key} | ❌ | — | — | — | — | — | 실패 | {note} ({status}) |")
            skip += 1
            if market == "us": us_fail += 1
            else: kr_fail += 1
            time.sleep(0.8)
            continue

        all_results[key] = {**result, "_market": market, "_yahooTicker": yt}
        success += 1
        ks = result["keyStats"]
        cf_l = result["cashflow"]["latest"] or {}
        missing = analyze_completeness(result)
        if not missing:
            full += 1
            if market == "us": us_full += 1
            else: kr_full += 1
        else:
            if market == "us": us_partial += 1
            else: kr_partial += 1

        is_kr = market == "kr"
        print(f"  통화: {result['currency']} | FY끝: {result['fiscalYearEnd']}")
        print(f"  시총: {fmt_money(ks.get('marketCap'), is_kr)} | "
              f"PE: {fmt_ratio(ks.get('trailingPE'))} | "
              f"PB: {fmt_ratio(ks.get('priceToBook'))} | "
              f"ROE: {fmt_ratio(ks.get('returnOnEquity'))}")
        print(f"  CFO: {fmt_money(cf_l.get('operatingCashflow'), is_kr)} | "
              f"목표가: {fmt_ratio(ks.get('targetMeanPrice'))} | "
              f"애널 수: {ks.get('numberOfAnalystOpinions')} | "
              f"섹터: {ks.get('sector')} | "
              f"결측: {len(missing)}건")
        if missing:
            for m in missing[:5]:
                print(f"     - {m}")

        log_lines.append(
            f"| {key} | {fmt_money(ks.get('marketCap'), is_kr)} | "
            f"{fmt_ratio(ks.get('trailingPE'))} | "
            f"{fmt_ratio(ks.get('priceToBook'))} | "
            f"{fmt_ratio(ks.get('returnOnEquity'))} | "
            f"{fmt_ratio(ks.get('currentRatio'))} | "
            f"{fmt_money(cf_l.get('operatingCashflow'), is_kr)} | "
            f"{len(missing)}건 | {note} |"
        )

        # KR 섹션 헤더 삽입
        if yt == TEST_TICKERS[9][0]:  # 마지막 미국 종목 다음
            log_lines.append("")
            log_lines.append("## 한국 종목 (5)")
            log_lines.append("")
            log_lines.append(f"| 티커 | 시총 | P/E | P/B | ROE | CR | CFO | 결측 | 메모 |")
            log_lines.append(f"|------|------|-----|-----|-----|-----|-----|------|------|")

        time.sleep(0.8)

    # 결과 저장
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump({
            "_meta": {
                "type": "beta_financials_test",
                "version": "v0.3-yfinance-us-kr",
                "yfinance_version": yf.__version__,
                "generated": datetime.now().isoformat(),
                "warning": "PoC 결과. stocks.json과 별개. 알파 영향 없음.",
                "stats": {
                    "total": len(TEST_TICKERS),
                    "success": success,
                    "full_complete": full,
                    "skip": skip,
                    "us": {"full": us_full, "partial": us_partial, "fail": us_fail},
                    "kr": {"full": kr_full, "partial": kr_partial, "fail": kr_fail},
                },
            },
            "data": all_results,
        }, f, ensure_ascii=False, indent=2)

    log_lines.append("")
    log_lines.append("## 통계")
    log_lines.append(f"- 시도: {len(TEST_TICKERS)}")
    log_lines.append(f"- 성공: {success}")
    log_lines.append(f"- 완전 수집 (결측 0): {full}")
    log_lines.append(f"- 실패: {skip}")
    log_lines.append("")
    log_lines.append(f"### 미국 (10종목)")
    log_lines.append(f"- 완전: {us_full} | 부분: {us_partial} | 실패: {us_fail}")
    log_lines.append("")
    log_lines.append(f"### 한국 (5종목) ⭐ PR #3b 핵심 검증")
    log_lines.append(f"- 완전: {kr_full} | 부분: {kr_partial} | 실패: {kr_fail}")
    log_lines.append("")
    log_lines.append("## 다음 단계 결정 기준")
    log_lines.append(f"- 한국 완전 수집 ≥ 3 → ✅ PR #3c (UI 연결) 진행 가능")
    log_lines.append(f"- 한국 완전 수집 < 3 → ⚠️ 자기 5년 평균 모델로 충분한지 추가 분석 필요")
    log_lines.append(f"- 한국 모두 실패 → ❌ DART API 별도 작업 (다음 스프린트)")

    with open(LOG_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines))

    print("\n" + "=" * 70)
    print(f"✅ 완료")
    print(f"   미국: 완전 {us_full} | 부분 {us_partial} | 실패 {us_fail}")
    print(f"   한국: 완전 {kr_full} | 부분 {kr_partial} | 실패 {kr_fail}")
    print(f"💾 {OUTPUT_PATH}")
    print(f"📝 {LOG_PATH}")
    print("=" * 70)


if __name__ == "__main__":
    main()
