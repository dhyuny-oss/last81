#!/usr/bin/env python3
"""
Beta Terminal v0.4 — 미국 풀 전체 재무 수집 (PR #3c 단계 1)
================================================================================

목적:
  - stocks.json의 pool에서 미국 종목 전부 추출
  - yfinance로 재무 데이터 수집
  - 결과 → public/data/financials_us.json (별도 파일, 알파 안 건드림)

⚠️ 안전 원칙:
  - stocks.json 절대 안 건드림
  - 별도 파일에 저장 → 알파 영향 0%
  - 단계 2에서 stocks.json에 통합 (그때 알파 코드 검토 후)

처리량:
  - 미국 종목 ~500개 예상 (알파 daily가 수집한 풀)
  - yfinance 호출 평균 1초/종목 → 약 8~10분
  - 한국 종목은 이번 단계에서 스킵 (PR #3d 별도 진행)

수집 항목 (각 종목당):
  - 손익 latest + prior (연간)
  - 재무상태표 current + yearAgo
  - 현금흐름 latest + prior
  - keyStats (PE, PB, ROE, ROA, 시총, 마진, 베타, 목표가 등)
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


WORKSPACE = os.environ.get("GITHUB_WORKSPACE", ".")
STOCKS_PATH = os.path.join(WORKSPACE, "public", "data", "stocks.json")
OUTPUT_PATH = os.path.join(WORKSPACE, "public", "data", "financials_us.json")
LOG_PATH = os.path.join(WORKSPACE, "public", "data", "financials_us_log.txt")


# ─── 헬퍼 (PoC v0.3과 동일) ────────────────────────────────

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
    if not info:
        return {}
    def g(*keys):
        for k in keys:
            v = info.get(k)
            if v is not None:
                return v
        return None

    pb = g("priceToBook")
    if pb in (None, 0, 0.0):
        current_price = g("currentPrice", "regularMarketPrice", "previousClose")
        bv = g("bookValue")
        if current_price and bv and bv > 0:
            try:
                pb = float(current_price) / float(bv)
            except Exception:
                pb = None
        if pb in (None, 0, 0.0) and balance_current:
            equity = balance_current.get("totalEquity")
            mkt_cap = g("marketCap")
            if equity and equity > 0 and mkt_cap:
                try:
                    pb = float(mkt_cap) / float(equity)
                except Exception:
                    pass

    return {
        "marketCap":         g("marketCap"),
        "enterpriseValue":   g("enterpriseValue"),
        "trailingPE":        g("trailingPE"),
        "forwardPE":         g("forwardPE"),
        "priceToBook":       pb,
        "priceToSalesTTM":   g("priceToSalesTrailing12Months"),
        "evToEbitda":        g("enterpriseToEbitda"),
        "trailingEps":       g("trailingEps"),
        "forwardEps":        g("forwardEps"),
        "returnOnAssets":    g("returnOnAssets"),
        "returnOnEquity":    g("returnOnEquity"),
        "debtToEquity":      g("debtToEquity"),
        "currentRatio":      g("currentRatio"),
        "quickRatio":        g("quickRatio"),
        "grossMargins":      g("grossMargins"),
        "operatingMargins":  g("operatingMargins"),
        "profitMargins":     g("profitMargins"),
        "ebitdaMargins":     g("ebitdaMargins"),
        "dividendYield":     g("dividendYield"),
        "payoutRatio":       g("payoutRatio"),
        "beta":              g("beta"),
        "revenueGrowth":     g("revenueGrowth"),
        "earningsGrowth":    g("earningsGrowth"),
        "targetMeanPrice":         g("targetMeanPrice"),
        "targetHighPrice":         g("targetHighPrice"),
        "targetLowPrice":          g("targetLowPrice"),
        "numberOfAnalystOpinions": g("numberOfAnalystOpinions"),
        "sector":            g("sector"),
        "industry":          g("industry"),
        "longName":          g("longName", "shortName"),
        "currentPrice":      g("currentPrice", "regularMarketPrice"),
        "bookValuePerShare": g("bookValue"),
    }


def fetch_financials(yt):
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

        keyStats = extract_keystats(info, balance_current)

        if not info and income_latest is None and balance_current is None:
            return None, "응답 비어있음"

        currency = info.get("financialCurrency") or info.get("currency")
        fy_end = (income_latest or {}).get("endDate") if income_latest else None

        return {
            "updatedAt":     time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "currency":      currency,
            "fiscalYearEnd": fy_end,
            "income":   {"latest": income_latest, "prior":  income_prior},
            "balance":  {"current": balance_current, "yearAgo": balance_yearAgo},
            "cashflow": {"latest": cashflow_latest, "prior":  cashflow_prior},
            "keyStats": keyStats,
        }, "OK"

    except Exception as e:
        return None, f"{type(e).__name__}: {e}"


def is_complete(result):
    """필수 필드 다 있는지"""
    if not result:
        return False
    inc = result.get("income", {})
    bal = result.get("balance", {})
    cf = result.get("cashflow", {})
    ks = result.get("keyStats", {})
    if not inc.get("latest") or not inc.get("prior"):
        return False
    if not bal.get("current") or not bal.get("yearAgo"):
        return False
    if not cf.get("latest"):
        return False
    if cf["latest"].get("operatingCashflow") is None:
        return False
    for f in ["marketCap", "trailingPE", "priceToBook", "returnOnEquity"]:
        if ks.get(f) in (None, 0):
            return False
    return True


def main():
    print("=" * 70)
    print(f"Beta Terminal v0.4 — 미국 풀 재무 수집")
    print(f"yfinance: {yf.__version__}")
    print(f"시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    # ─── stocks.json 로드 (읽기 전용) ───
    if not os.path.exists(STOCKS_PATH):
        print(f"❌ {STOCKS_PATH} 없음")
        sys.exit(1)

    with open(STOCKS_PATH, "r", encoding="utf-8") as f:
        stocks_data = json.load(f)

    pool = stocks_data.get("pool", {})
    if not pool:
        print("❌ pool 데이터 없음 — daily 워크플로 먼저 실행 필요")
        sys.exit(1)

    # 미국 종목만 추출
    us_tickers = []
    for ticker, info in pool.items():
        market = info.get("market", "")
        if market == "us":
            us_tickers.append(ticker)

    total = len(us_tickers)
    print(f"\n📊 미국 종목 풀: {total}개")
    print(f"   (한국 종목은 이번 단계 스킵 — PR 별도)")

    if total == 0:
        print("❌ 미국 종목 없음")
        sys.exit(1)

    print(f"\n예상 시간: 약 {total * 1.0 / 60:.1f}분 (1초/종목)")
    print(f"결과 → {OUTPUT_PATH}")
    print()

    # ─── 수집 ───
    results = {}
    full_count = 0
    partial_count = 0
    fail_count = 0
    fail_reasons = {}

    for i, ticker in enumerate(us_tickers, 1):
        # yfinance 형식 (BRK.B → BRK-B 같은 변환은 알파 stocks.json에서 이미 처리됨)
        yt = ticker

        result, status = fetch_financials(yt)

        if result is None:
            fail_count += 1
            fail_reasons[ticker] = status
            print(f"  [{i}/{total}] {ticker:8s} ❌ {status[:40]}")
        else:
            results[ticker] = result
            if is_complete(result):
                full_count += 1
                marker = "✅"
            else:
                partial_count += 1
                marker = "⚠️"

            ks = result["keyStats"]
            mc = ks.get("marketCap")
            mc_str = f"{mc/1e9:.1f}B" if mc else "—"
            pe = ks.get("trailingPE")
            pe_str = f"{pe:.1f}" if pe else "—"

            print(f"  [{i}/{total}] {ticker:8s} {marker} 시총 {mc_str:>8s}  PE {pe_str:>5s}")

        # 진행률 (50개마다)
        if i % 50 == 0:
            print(f"  ─── 진행: {i}/{total} ({i/total*100:.0f}%) | "
                  f"완전 {full_count} 부분 {partial_count} 실패 {fail_count} ───")

        time.sleep(0.5)  # rate limit 방지

    # ─── 결과 저장 ───
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    output = {
        "_meta": {
            "type": "beta_financials_us",
            "version": "v0.4",
            "yfinance_version": yf.__version__,
            "generated": datetime.now().isoformat(),
            "warning": "이 파일은 베타 전용. stocks.json과 별개. 알파 영향 없음.",
            "stats": {
                "total": total,
                "full_complete": full_count,
                "partial": partial_count,
                "fail": fail_count,
                "success_rate": round((full_count + partial_count) / total * 100, 1) if total else 0,
            },
            "fail_samples": dict(list(fail_reasons.items())[:20]),
        },
        "data": results,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    file_size = os.path.getsize(OUTPUT_PATH) / 1024
    print(f"\n💾 저장: {OUTPUT_PATH} ({file_size:.0f}KB)")

    # 로그 파일
    log_lines = [
        f"# 미국 풀 재무 수집 결과",
        f"# {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"# yfinance v{yf.__version__}",
        f"",
        f"## 통계",
        f"- 시도: {total}",
        f"- 완전 수집: {full_count} ({full_count/total*100:.1f}%)",
        f"- 부분 수집: {partial_count} ({partial_count/total*100:.1f}%)",
        f"- 실패: {fail_count} ({fail_count/total*100:.1f}%)",
        f"- 파일 크기: {file_size:.0f}KB",
        f"",
        f"## 다음 단계 결정 기준",
        f"- 완전+부분 ≥ 80% → ✅ 단계 2 (stocks.json 통합) 진행",
        f"- 완전+부분 60~80% → ⚠️ 실패 패턴 분석 후 결정",
        f"- < 60% → ❌ 디버깅 필요",
    ]

    if fail_reasons:
        log_lines.append("")
        log_lines.append("## 실패 종목 샘플 (최대 20)")
        for t, reason in list(fail_reasons.items())[:20]:
            log_lines.append(f"- {t}: {reason[:60]}")

    with open(LOG_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines))

    print(f"📝 로그: {LOG_PATH}")

    print("\n" + "=" * 70)
    print(f"✅ 완료")
    print(f"   완전: {full_count} | 부분: {partial_count} | 실패: {fail_count}")
    print(f"   성공률: {(full_count + partial_count) / total * 100:.1f}%")
    print("=" * 70)


if __name__ == "__main__":
    main()
