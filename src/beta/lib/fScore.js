/**
 * Beta Terminal — F-Score · Magic Formula · 적정가 모델 계산 v0.3
 * ============================================================================
 *
 * v0.2 → v0.3 변경:
 *   - candles 기반 RSI 14 계산 추가
 *   - candles 기반 변동성 (최근 20일 표준편차) 추가
 *   - 가격 변화율 1d / 3d / 5d 추가
 *   - 야후 목표가 대비 차이 (currentPrice vs targetMeanPrice)
 *   - oversold / box 카드 분류 활성화
 */

// ─── 헬퍼 ─────────────────────────────────────────────

const safeNum = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const safeDiv = (a, b) => {
  const x = safeNum(a);
  const y = safeNum(b);
  if (x === null || y === null || y === 0) return null;
  return x / y;
};

// ─── 가격 시계열 분석 ─────────────────────────────────

/** RSI 14 (Wilder smoothing) — 표준 공식 */
export function calculateRSI(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  const closes = candles.map(c => c.close).filter(c => c != null);
  if (closes.length < period + 1) return null;

  // 첫 N개 봉의 평균 gain/loss
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += -diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  // 이후 봉은 Wilder smoothing
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** 최근 N일 가격 변화율 (%) */
export function calculatePriceChange(candles, days) {
  if (!candles || candles.length < days + 1) return null;
  const recent = candles[candles.length - 1]?.close;
  const past = candles[candles.length - 1 - days]?.close;
  if (!recent || !past) return null;
  return ((recent - past) / past) * 100;
}

/**
 * 박스권 판정용 변동성 계산
 * 최근 20일 종가의 (최고 - 최저) / 평균 → %
 * 예: ±5% 이내면 박스권
 */
export function calculateBoxRange(candles, days = 20) {
  if (!candles || candles.length < days) return null;
  const recent = candles.slice(-days).map(c => c.close).filter(c => c != null);
  if (recent.length < days) return null;
  const max = Math.max(...recent);
  const min = Math.min(...recent);
  const avg = recent.reduce((s, x) => s + x, 0) / recent.length;
  if (avg === 0) return null;
  // 최고~최저 폭이 평균의 몇 % 인지
  return ((max - min) / avg) * 100;
}

// ─── F-Score (Piotroski 9-point, 8개 평가 가능) ───────

export function calculateFScore(fin) {
  if (!fin) return { score: 0, max: 8, components: {}, available: false };

  const inc = fin.income || {};
  const bal = fin.balance || {};
  const cf = fin.cashflow || {};
  const incL = inc.latest;
  const incP = inc.prior;
  const balC = bal.current;
  const balY = bal.yearAgo;
  const cfL = cf.latest;

  const components = {};

  if (incL && balC) {
    const roaL = safeDiv(incL.netIncome, balC.totalAssets);
    components.roaPositive = roaL !== null ? roaL > 0 : null;
  }
  if (cfL) {
    const cfo = safeNum(cfL.operatingCashflow);
    components.cfoPositive = cfo !== null ? cfo > 0 : null;
  }
  if (incL && incP && balC && balY) {
    const roaL = safeDiv(incL.netIncome, balC.totalAssets);
    const roaP = safeDiv(incP.netIncome, balY.totalAssets);
    components.roaImproving = roaL !== null && roaP !== null ? roaL > roaP : null;
  }
  if (cfL && incL) {
    const cfo = safeNum(cfL.operatingCashflow);
    const ni = safeNum(incL.netIncome);
    components.cfoOverNi = cfo !== null && ni !== null ? cfo > ni : null;
  }
  if (balC && balY) {
    const levL = safeDiv(balC.totalDebt, balC.totalAssets);
    const levY = safeDiv(balY.totalDebt, balY.totalAssets);
    components.leverageImproving = levL !== null && levY !== null ? levL < levY : null;
  }
  if (balC && balY) {
    const crL = safeDiv(balC.currentAssets, balC.currentLiabilities);
    const crY = safeDiv(balY.currentAssets, balY.currentLiabilities);
    components.currentRatioImproving = crL !== null && crY !== null ? crL > crY : null;
  }
  if (incL && incP) {
    const gmL = safeDiv(incL.grossProfit, incL.revenue);
    const gmP = safeDiv(incP.grossProfit, incP.revenue);
    components.grossMarginImproving = gmL !== null && gmP !== null ? gmL > gmP : null;
  }
  if (incL && incP && balC && balY) {
    const atL = safeDiv(incL.revenue, balC.totalAssets);
    const atP = safeDiv(incP.revenue, balY.totalAssets);
    components.assetTurnoverImproving = atL !== null && atP !== null ? atL > atP : null;
  }

  let score = 0;
  let max = 0;
  for (const v of Object.values(components)) {
    if (v === true) score++;
    if (v !== null) max++;
  }

  return {
    score,
    max,
    score9: max > 0 ? Math.round(score * 9 / max) : 0,
    components,
    available: max >= 5,
  };
}

// ─── Magic Formula ────────────────────────────────────

export function calculateMagicFormula(fin) {
  if (!fin) return { roc: null, ey: null, available: false };
  const inc = fin.income || {};
  const ks = fin.keyStats || {};
  const incL = inc.latest;
  if (!incL) return { roc: null, ey: null, available: false };

  const ebit = safeNum(incL.ebit) || safeNum(incL.operatingIncome);
  const ev = safeNum(ks.enterpriseValue) || safeNum(ks.marketCap);
  const ey = ebit && ev ? ebit / ev : null;
  const roc = safeNum(ks.returnOnEquity);

  return {
    roc,
    ey,
    available: roc !== null && ey !== null,
  };
}

// ─── 적정가 모델 ──────────────────────────────────────

export function calculateFairValue(fin) {
  if (!fin) return { models: [], median: null, agreement: null, available: false };

  const ks = fin.keyStats || {};
  const inc = fin.income || {};
  const incL = inc.latest;
  const incP = inc.prior;

  const models = [];

  // 모델 1: PER × EPS — 이익 성장 기반
  const pe = safeNum(ks.trailingPE);
  if (pe !== null && pe > 0 && incL && incP) {
    const niL = safeNum(incL.netIncome);
    const niP = safeNum(incP.netIncome);
    if (niL !== null && niP !== null && niP !== 0) {
      const earningsGrowth = (niL - niP) / Math.abs(niP);
      const pctChange = earningsGrowth * 50;
      models.push({
        name: 'PER × EPS',
        pct: Math.max(-50, Math.min(50, pctChange)),
        source: 'self',
      });
    }
  }

  // 모델 2: PBR × BPS — ROE × 8 공식
  const pb = safeNum(ks.priceToBook);
  const roe = safeNum(ks.returnOnEquity);
  if (pb !== null && pb > 0 && roe !== null) {
    const fairPB = Math.max(0.5, Math.min(15, roe * 8));
    const pctChange = ((fairPB - pb) / pb) * 100;
    models.push({
      name: 'PBR × BPS',
      pct: Math.max(-50, Math.min(50, pctChange)),
      source: 'self',
    });
  }

  // 모델 3: EV/EBITDA — 적정 10
  const ev2eb = safeNum(ks.evToEbitda);
  if (ev2eb !== null && ev2eb > 0) {
    const fairMultiple = 10;
    const pctChange = ((fairMultiple - ev2eb) / ev2eb) * 100;
    models.push({
      name: 'EV/EBITDA',
      pct: Math.max(-50, Math.min(50, pctChange)),
      source: 'self',
    });
  }

  if (models.length === 0) {
    return { models: [], median: null, agreement: null, available: false };
  }

  const pcts = models.map(m => m.pct).sort((a, b) => a - b);
  const median = pcts[Math.floor(pcts.length / 2)];

  const mean = pcts.reduce((s, x) => s + x, 0) / pcts.length;
  const variance = pcts.reduce((s, x) => s + (x - mean) ** 2, 0) / pcts.length;
  const stdDev = Math.sqrt(variance);

  let agreement;
  if (models.length === 1) agreement = 'low';
  else if (stdDev < 8) agreement = 'high';
  else if (stdDev < 18) agreement = 'mid';
  else agreement = 'low';

  return {
    models,
    median,
    agreement,
    available: models.length >= 2,
  };
}

// ─── 야후 목표가 대비 차이 ──────────────────────────────

/**
 * 현재가 vs 야후 애널리스트 목표가
 * @returns { pct: 양수면 목표가가 현재가보다 높음 (상승여력), 음수면 하락 }
 */
export function calculateTargetDiff(fin) {
  if (!fin) return null;
  const ks = fin.keyStats || {};
  const current = safeNum(ks.currentPrice);
  const target = safeNum(ks.targetMeanPrice);
  const high = safeNum(ks.targetHighPrice);
  const low = safeNum(ks.targetLowPrice);
  const numAnalysts = ks.numberOfAnalystOpinions;

  if (!current || current <= 0 || !target) return null;

  const pct = ((target - current) / current) * 100;
  const highPct = high ? ((high - current) / current) * 100 : null;
  const lowPct = low ? ((low - current) / current) * 100 : null;

  return {
    currentPrice: current,
    targetMean: target,
    targetHigh: high,
    targetLow: low,
    pct,           // 평균 목표가 vs 현재가
    highPct,
    lowPct,
    numAnalysts,
    available: numAnalysts && numAnalysts >= 3,  // 최소 3명 분석
  };
}

// ─── 통합 평가 ────────────────────────────────────────

export function evaluateStock(ticker, fin, poolInfo, candles) {
  if (!fin) return null;

  const ks = fin.keyStats || {};

  const fScoreResult = calculateFScore(fin);
  const mfResult = calculateMagicFormula(fin);
  const fairValueResult = calculateFairValue(fin);
  const targetDiff = calculateTargetDiff(fin);

  if (!fScoreResult.available && !fairValueResult.available) {
    return null;
  }

  // ── 가격 시계열 분석 ──
  const rsi = calculateRSI(candles);
  const boxRange = calculateBoxRange(candles, 20);
  const chg1d = calculatePriceChange(candles, 1);
  const chg3d = calculatePriceChange(candles, 3);
  const chg5d = calculatePriceChange(candles, 5);

  return {
    ticker,
    label: poolInfo?.label || ks.longName || ticker,
    market: poolInfo?.market || 'us',
    sector: ks.sector || poolInfo?.sector || '',
    industry: ks.industry || '',

    // F-Score
    fScore: fScoreResult.score9,
    fScoreRaw: fScoreResult.score,
    fScoreMax: fScoreResult.max,
    fScoreComponents: fScoreResult.components,

    // Magic Formula
    mfROC: mfResult.roc,
    mfEY: mfResult.ey,

    // 적정가
    fairValuePct: fairValueResult.median,
    fairValueModels: fairValueResult.models,
    agreement: fairValueResult.agreement,

    // raw 비율
    pe: safeNum(ks.trailingPE),
    pb: safeNum(ks.priceToBook),
    roe: safeNum(ks.returnOnEquity),
    roa: safeNum(ks.returnOnAssets),
    de: safeNum(ks.debtToEquity),
    cr: safeNum(ks.currentRatio),
    evToEbitda: safeNum(ks.evToEbitda),
    marketCap: safeNum(ks.marketCap),

    // 야후 목표가
    targetDiff,

    // 가격 시계열
    rsi,
    boxRange,
    chg1d,
    chg3d,
    chg5d,
    hasCandles: candles && candles.length >= 20,

    // 메타
    currentPrice: safeNum(ks.currentPrice),
  };
}

// ─── 카드별 분류 (oversold/box 활성화) ──────────────────

export function classifyForCards(evaluations) {
  const all = evaluations.filter(e => e !== null);

  // 카드 1: 최고점 (F-Score 8+)
  const top = all.filter(e => e.fScore >= 8);

  // 카드 2: 저평가 우량주 (F-Score 7+ AND 적정가 +20%)
  const value = all.filter(e =>
    e.fScore >= 7 &&
    e.fairValuePct !== null && e.fairValuePct >= 20
  );

  // 카드 3: 과매도 우량주 (F-Score 7+ AND RSI < 35)
  const oversold = all.filter(e =>
    e.fScore >= 7 &&
    e.rsi !== null && e.rsi < 35
  );

  // 카드 4: 박스권 우량주 (F-Score 7+ AND 박스 범위 ±10% 이내)
  const box = all.filter(e =>
    e.fScore >= 7 &&
    e.boxRange !== null && e.boxRange < 10
  );

  // 카드 5: 위험 종목 (F-Score 0-3)
  const risk = all.filter(e => e.fScore <= 3);

  const sortByFair = (a, b) => {
    const av = a.fairValuePct ?? -999;
    const bv = b.fairValuePct ?? -999;
    return bv - av;
  };

  return {
    top: top.sort(sortByFair),
    value: value.sort(sortByFair),
    oversold: oversold.sort((a, b) => (a.rsi || 99) - (b.rsi || 99)),  // 가장 과매도된 게 위
    box: box.sort((a, b) => (a.boxRange || 99) - (b.boxRange || 99)),  // 가장 좁은 박스가 위
    risk: risk.sort((a, b) => a.fScore - b.fScore),
  };
}

// ─── F-Score 분포 ─────────────────────────────────────

export function distributionFor(evaluations) {
  const counts = { 9: 0, 8: 0, 7: 0, 6: 0, '5-': 0 };
  for (const e of evaluations) {
    const s = e.fScore;
    if (s >= 9) counts['9']++;
    else if (s === 8) counts['8']++;
    else if (s === 7) counts['7']++;
    else if (s === 6) counts['6']++;
    else counts['5-']++;
  }
  return [
    { score: '9',  count: counts['9'] },
    { score: '8',  count: counts['8'] },
    { score: '7',  count: counts['7'] },
    { score: '6',  count: counts['6'] },
    { score: '5-', count: counts['5-'] },
  ];
}
