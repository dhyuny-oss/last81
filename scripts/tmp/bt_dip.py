"""급락 우량주 검증 (임시 · 앱과 무관). 미국 종목풀 현재 명단 · 2014~ 일봉 · 월초 진입 · 3/6/12개월 뒤 수익.
조건(앱과 같음): 52주 고점 대비 -25% 이하 · 3년 중 200일선 위 비율 60% 이상 · 200일선 -50% 아래(훼손)는 제외
추가: 매출 증가(직전 회계연도, 결산 90일 뒤부터 안 것으로) · 목표가 괴리(그날까지 증권사별 마지막 목표가 평균 / 종가)"""
import json, sys, time, math, datetime as dt
import numpy as np, pandas as pd, yfinance as yf

U = json.load(open("public/data/universe.json"))["stocks"]
TK = sorted(t for t, v in U.items() if v.get("market") == "us")
BENCH = ["SPY", "QQQ"]
print("tickers", len(TK), flush=True)

def dl(tks):
    out = {}
    for i in range(0, len(tks), 80):
        part = tks[i:i+80]
        for k in range(3):
            try:
                df = yf.download(part, start="2014-01-01", auto_adjust=False, group_by="ticker", progress=False, threads=True)
                break
            except Exception as e:
                print("dl retry", e, flush=True); time.sleep(10)
        for t in part:
            try:
                d = df[t].dropna(subset=["Close"])
                if len(d) > 300: out[t] = d
            except Exception: pass
        print("prices", i + len(part), len(out), flush=True)
    return out

PX = dl(TK + BENCH)
spy, qqq = PX["SPY"], PX["QQQ"]

REV, TGT = {}, {}
for n, t in enumerate(TK):
    if t not in PX: continue
    for k in range(3):
        try:
            tk = yf.Ticker(t)
            inc = tk.income_stmt
            if inc is not None and not inc.empty and "Total Revenue" in inc.index:
                r = inc.loc["Total Revenue"].dropna().sort_index()
                REV[t] = [(pd.Timestamp(d), float(v)) for d, v in r.items() if v and v > 0]
            ud = tk.upgrades_downgrades
            sp = tk.splits
            if ud is not None and not ud.empty and "currentPriceTarget" in ud.columns:
                u = ud.reset_index()
                u["GradeDate"] = pd.to_datetime(u["GradeDate"]).dt.tz_localize(None)
                u = u[u["currentPriceTarget"] > 0][["GradeDate", "Firm", "currentPriceTarget"]].copy()
                if sp is not None and len(sp):
                    s2 = sp.copy(); s2.index = pd.to_datetime(s2.index).tz_localize(None)
                    u["adj"] = u["GradeDate"].apply(lambda g: float(np.prod([f for d0, f in s2.items() if d0 > g and f > 0])) if True else 1.0)
                    u["currentPriceTarget"] = u["currentPriceTarget"] / u["adj"]
                TGT[t] = u.sort_values("GradeDate")
            break
        except Exception as e:
            time.sleep(3 * (k + 1))
    time.sleep(0.25)
    if n % 50 == 0: print("fund", n, len(REV), len(TGT), flush=True)

def rev_growth(t, D):
    r = [x for x in REV.get(t, []) if x[0] + pd.Timedelta(days=90) <= D]
    if len(r) < 2: return None
    return r[-1][1] / r[-2][1] - 1

def tgt_gap(t, D, px):
    u = TGT.get(t)
    if u is None: return None
    w = u[(u["GradeDate"] <= D) & (u["GradeDate"] > D - pd.Timedelta(days=365))]
    if w.empty: return None
    last = w.groupby("Firm")["currentPriceTarget"].last()
    if len(last) < 3: return None
    return float(last.mean()) / px - 1

months = pd.date_range("2019-01-01", "2026-11-01", freq="MS")
H = {"3m": 63, "6m": 126, "12m": 252}
rows = []
PRE = {}
for t, d in PX.items():
    c = d["Close"].values; ma = pd.Series(c).rolling(200).mean().values
    above = np.concatenate([[0], np.cumsum(np.nan_to_num(c > ma, nan=0).astype(int))])
    PRE[t] = (c, d["Adj Close"].values, d["High"].values, ma, above, pd.Series(c).rolling(20).mean().values)
for M in months:
    idx = spy.index[spy.index >= M]
    if not len(idx): break
    D = idx[0]
    qc = qqq["Close"][:D]; q200 = qc.rolling(200).mean().iloc[-1]
    regime = "weak" if qc.iloc[-1] < q200 else "strong"
    sp_i = spy.index.get_loc(D)
    fwd_b = {h: (spy["Adj Close"].iloc[sp_i + n] / spy["Adj Close"].iloc[sp_i] - 1) if sp_i + n < len(spy) else None for h, n in H.items()}
    for t in TK:
        d = PX.get(t)
        if d is None or D not in d.index: continue
        i = d.index.get_loc(D)
        if i < 452: continue
        c, ac, hi, ma200, above, m20 = PRE[t]
        span = min(756, i + 1 - 200)
        hlt = (above[i + 1] - above[i + 1 - span]) / span
        w52 = c[i] / np.nanmax(hi[max(0, i - 251):i + 1]) - 1
        ma200p = c[i] / ma200[i] - 1
        ma20 = m20[i]
        fwd = {h: (ac[i + n] / ac[i] - 1) if i + n < len(ac) else None for h, n in H.items()}
        dip = (w52 <= -0.25 and hlt >= 0.6 and ma200p > -0.5)
        rg = rev_growth(t, D) if dip else None
        gp = tgt_gap(t, D, c[i]) if dip else None
        rows.append(dict(D=str(D.date()), t=t, regime=regime, dip=dip, reb=bool(c[i] > ma20), rg=rg, gp=gp, w52=w52,
                         **{f"r{h}": fwd[h] for h in H}, **{f"b{h}": fwd_b[h] for h in H}))
    print("month", D.date(), len(rows), flush=True)

df = pd.DataFrame(rows)
df.to_csv("bt_rows.csv", index=False)
allm = df.groupby("D")[[f"r{h}" for h in H]].mean()          # 같은 날 종목풀 전체 평균 (같은 생존 편향을 가진 비교 기준)

def stats(sub, name, since=None):
    out = {"group": name}
    if since: sub = sub[sub["D"] >= since]
    out["obs"] = int(len(sub)); out["uniq"] = int(sub["t"].nunique()); out["months"] = int(sub["D"].nunique())
    for h in H:
        s = sub.dropna(subset=[f"r{h}"])
        if len(s) < 5: continue
        r = s[f"r{h}"]; ex_b = r - s[f"b{h}"]; ex_a = r - s["D"].map(allm[f"r{h}"])
        port = s.groupby("D").apply(lambda g: (g[f"r{h}"] - allm.loc[g.name, f"r{h}"]).mean())
        out[h] = dict(n=int(len(s)), avg=round(r.mean()*100, 1), med=round(r.median()*100, 1),
                      exSPY=round(ex_b.mean()*100, 1), exAll=round(ex_a.mean()*100, 1),
                      beatAll=round((ex_a > 0).mean()*100), lose20=round((r <= -0.2).mean()*100),
                      portEx=round(port.mean()*100, 1), portBeat=round((port > 0).mean()*100), portN=int(len(port)))
    return out

dp = df[df.dip]
G = [("전체 종목풀", df, None), ("급락(앱 조건)", dp, None), ("급락+반등(20일선 위)", dp[dp.reb], None),
     ("급락 [2023-04~]", dp, "2023-04"), ("급락+매출증가>0", dp[dp.rg > 0], "2023-04"), ("급락+매출증가≥10%", dp[dp.rg >= 0.10], "2023-04"),
     ("급락+매출감소", dp[dp.rg <= 0], "2023-04"),
     ("급락+목표가괴리≥30%", dp[dp.gp >= 0.30], None), ("급락+목표가괴리≥50%", dp[dp.gp >= 0.50], None), ("급락+목표가괴리<15%", dp[dp.gp < 0.15], None),
     ("급락+매출≥10%+괴리≥30%", dp[(dp.rg >= 0.10) & (dp.gp >= 0.30)], "2023-04"),
     ("급락 · 나스닥 200일선 아래", dp[dp.regime == "weak"], None), ("급락+매출≥10% · 나스닥 200일선 아래", dp[(dp.rg >= 0.10) & (dp.regime == "weak")], "2023-04"),
     ("급락+괴리≥30% · 나스닥 200일선 아래", dp[(dp.gp >= 0.30) & (dp.regime == "weak")], None)]
res = [stats(s, n, since) for n, s, since in G]
yr = {}
for y in sorted(dp["D"].str[:4].unique()):
    s = dp[dp["D"].str[:4] == y].dropna(subset=["r12m"])
    if len(s): yr[y] = dict(n=int(len(s)), exAll12=round((s["r12m"] - s["D"].map(allm["r12m"])).mean()*100, 1))
cov = dict(dipObs=int(len(dp)), withRev=int(dp.rg.notna().sum()), withGap=int(dp.gp.notna().sum()), revT=len(REV), tgtT=len(TGT), tickers=len(PX))
out = dict(res=res, byYear=yr, cov=cov, nowDip=sorted(dp[dp.D == dp.D.max()].t.tolist()))
json.dump(out, open("bt_result.json", "w"), ensure_ascii=False, indent=1)
print("RESULT_JSON_BEGIN"); print(json.dumps(out, ensure_ascii=False)); print("RESULT_JSON_END")
