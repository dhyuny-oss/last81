/**
 * Beta Terminal — F-Score · Magic Formula · 적정가 모델 계산
 * ============================================================================
 *
 * 입력: stocks.json의 financials[ticker] 객체
 * 출력: { fScore, mfRank, fairValue, ... } 종목별 평가 결과
 *
 * ⚠️ 모든 함수는 데이터 누락에 안전 (null 처리). 누락 시 부분 점수 반환.
 *
 * 한계 짚기:
 *   - 자기 5년 평균 multiple 계산은 데이터 부족 (Yahoo는 현재 multiple만 줌)
 *     → 현재 P/E, P/B, EV/EBITDA를 "기준선"으로 사용
 *   - F-Score 9개 중 일부 (특히 발행주식수 변화)는 yfinance에서 직접 안 받음
 *     → 8개 지표로 우선 계산, 나머지 1개는 추후 확장
 *   - 한국 종목 P/E 누락 → 모델 일치도 자동 낮아짐 (정직한 표시)
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

// ─── F-Score (Piotroski 9-point) ───────────────────────
// 1. ROA > 0
// 2. CFO > 0
// 3. ΔROA > 0 (전년 대비)
// 4. CFO > NI (수익의 질)
// 5. ΔLeverage < 0 (부채 감소)
// 6. ΔCurrent Ratio > 0 (유동성 개선)
// 7. 발행주식수 동일 또는 감소 (희석 없음) — yfinance에서 직접 안 옴, 스킵
// 8. ΔGross Margin > 0
// 9. ΔAsset Turnover > 0 (자산회전 개선)

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

  // 1. ROA > 0 (latest)
  if (incL && balC) {
    const roaL = safeDiv(incL.netIncome, balC.totalAssets);
    components.roaPositive = roaL !== null ? roaL > 0 : null;
  }

  // 2. CFO > 0
  if (cfL) {
    const cfo = safeNum(cfL.operatingCashflow);
    components.cfoPositive = cfo !== null ? cfo > 0 : null;
  }

  // 3. ΔROA > 0
  if (incL && incP && balC && balY) {
    const roaL = safeDiv(incL.netIncome, balC.totalAssets);
    const roaP = safeDiv(incP.netIncome, balY.totalAssets);
    components.roaImproving = roaL !== null && roaP !== null ? roaL > roaP : null;
  }

  // 4. CFO > NI (수익의 질)
  if (cfL && incL) {
    const cfo = safeNum(cfL.operatingCashflow);
    const ni = safeNum(incL.netIncome);
    components.cfoOverNi = cfo !== null && ni !== null ? cfo > ni : null;
  }

  // 5. ΔLeverage < 0 (totalDebt / totalAssets 감소)
  if (balC && balY) {
    const levL = safeDiv(balC.totalDebt, balC.totalAssets);
    const levY = safeDiv(balY.totalDebt, balY.totalAssets);
    components.leverageImproving = levL !== null && levY !== null ? levL < levY : null;
  }

  // 6. ΔCurrent Ratio > 0
  if (balC && balY) {
    const crL = safeDiv(balC.currentAssets, balC.currentLiabilities);
    const crY = safeDiv(balY.currentAssets, balY.currentLiabilities);
    components.currentRatioImproving = crL !== null && crY !== null ? crL > crY : null;
  }

  // 7. ΔGross Margin > 0
  if (incL && incP) {
    const gmL = safeDiv(incL.grossProfit, incL.revenue);
    const gmP = safeDiv(incP.grossProfit, incP.revenue);
    components.grossMarginImproving = gmL !== null && gmP !== null ? gmL > gmP : null;
  }

  // 8. ΔAsset Turnover > 0
  if (incL && incP && balC && balY) {
    const atL = safeDiv(incL.revenue, balC.totalAssets);
    const atP = safeDiv(incP.revenue, balY.totalAssets);
    components.assetTurnoverImproving = atL !== null && atP !== null ? atL > atP : null;
  }

  // 점수 합산 (true=1, false=0, null=skip)
  let score = 0;
  let max = 0;
  for (const v of Object.values(components)) {
    if (v === true) score++;
    if (v !== null) max++;
  }

  return {
    score,
    max,            // 실제 평가 가능한 항목 수 (보통 8, 일부 누락 시 적음)
    score9: max > 0 ? Math.round(score * 9 / max) : 0,  // 9점 만점으로 환산
    components,
    available: max >= 5,  // 5개 이상 평가됐을 때만 의미 있다고 간주
  };
}

// ─── Magic Formula ────────────────────────────────────
// ROC = EBIT / (Working Capital + Net PPE)
// EY  = EBIT / Enterprise Value
// → 두 지표의 종합 랭킹 (낮을수록 좋음)

export function calculateMagicFormula(fin) {
  if (!fin) return { roc: null, ey: null, available: false };

  const inc = fin.income || {};
  const ks = fin.keyStats || {};
  const incL = inc.latest;

  if (!incL) return { roc: null, ey: null, available: false };

  // ROC = EBIT / (시총 - 현금 + 부채) ≈ EBIT / EV (간이 버전)
  const ebit = safeNum(incL.ebit) || safeNum(incL.operatingIncome);
  const ev = safeNum(ks.enterpriseValue) || safeNum(ks.marketCap);

  const ey = ebit && ev ? ebit / ev : null;

  // ROC: ROE를 대용 (정확한 ROC는 추가 계산 필요 — 다음 버전)
  const roc = safeNum(ks.returnOnEquity);

  return {
    roc,
    ey,
    available: roc !== null && ey !== null,
  };
}

// ─── 적정가 모델 ──────────────────────────────────────
// 각 모델은 "현재가 대비 % 차이" 반환 (양수 = 저평가)
// 자기 5년 평균 multiple 데이터 없음 → 현재 multiple과 동일 가정 + 트렌드 보정

export function calculateFairValue(fin) {
  if (!fin) return { models: [], median: null, agreement: null, available: false };

  const ks = fin.keyStats || {};
  const inc = fin.income || {};
  const incL = inc.latest;
  const incP = inc.prior;

  const models = [];

  // 모델 1: PER × EPS — 자기 회복력 기반
  // 현재 PER이 자기 평균보다 낮으면 저평가, 이익 성장하면 추가 보정
  const pe = safeNum(ks.trailingPE);
  if (pe !== null && pe > 0 && incL && incP) {
    const niL = safeNum(incL.netIncome);
    const niP = safeNum(incP.netIncome);
    if (niL !== null && niP !== null && niP !== 0) {
      // 이익 성장률 기반 보정: 작년 대비 N% 성장 → 적정가 N% 상승
      const earningsGrowth = (niL - niP) / Math.abs(niP);
      // 보수적: 성장률의 절반만 반영 (역성장 시도 절반만)
      const pctChange = earningsGrowth * 50;
      models.push({
        name: 'PER × EPS',
        pct: Math.max(-50, Math.min(50, pctChange)),
        source: 'self',
      });
    }
  }

  // 모델 2: PBR × BPS
  // ROE 높으면 적정 PBR 높아야 함 (가치투자 공식: 적정 PBR = ROE × 10 같은 단순화)
  const pb = safeNum(ks.priceToBook);
  const roe = safeNum(ks.returnOnEquity);
  if (pb !== null && pb > 0 && roe !== null) {
    // 단순화: ROE × 10 = 적정 PBR (ROE 10% → 적정 PBR 1.0)
    // 보수적으로 ROE × 8
    const fairPB = Math.max(0.5, Math.min(15, roe * 8));
    const pctChange = ((fairPB - pb) / pb) * 100;
    models.push({
      name: 'PBR × BPS',
      pct: Math.max(-50, Math.min(50, pctChange)),
      source: 'self',
    });
  }

  // 모델 3: EV/EBITDA
  // EV/EBITDA가 8 미만 = 저평가, 15 이상 = 고평가 (전통적 기준)
  const ev2eb = safeNum(ks.evToEbitda);
  if (ev2eb !== null && ev2eb > 0) {
    // 적정 EV/EBITDA = 10 (시장 평균)
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

  // 중앙값
  const pcts = models.map(m => m.pct).sort((a, b) => a - b);
  const median = pcts[Math.floor(pcts.length / 2)];

  // 일치도: 표준편차 기반
  const mean = pcts.reduce((s, x) => s + x, 0) / pcts.length;
  const variance = pcts.reduce((s, x) => s + (x - mean) ** 2, 0) / pcts.length;
  const stdDev = Math.sqrt(variance);

  let agreement;
  if (models.length === 1) agreement = 'low';     // 모델 1개 = 신뢰 낮음
  else if (stdDev < 8) agreement = 'high';        // 매우 비슷
  else if (stdDev < 18) agreement = 'mid';        // 약간 분산
  else agreement = 'low';                         // 따로 놀음

  return {
    models,
    median,
    agreement,
    available: models.length >= 2,
  };
}

// ─── 통합: 한 종목 전체 평가 ────────────────────────────

export function evaluateStock(ticker, fin, poolInfo, candles) {
  if (!fin) {
    return null;
  }

  const ks = fin.keyStats || {};

  const fScoreResult = calculateFScore(fin);
  const mfResult = calculateMagicFormula(fin);
  const fairValueResult = calculateFairValue(fin);

  // 가치 평가 가능 여부
  if (!fScoreResult.available && !fairValueResult.available) {
    return null;
  }

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

    // 야후 애널리스트 목표가 (참고용)
    targetMeanPrice: safeNum(ks.targetMeanPrice),
    numberOfAnalystOpinions: ks.numberOfAnalystOpinions,
  };
}

// ─── 카드별 분류 ─────────────────────────────────────

export function classifyForCards(evaluations) {
  // 미국/한국 분리
  const all = evaluations.filter(e => e !== null);

  // 카드 1: 최고점 (F-Score 9, 또는 max 점수)
  const top = all.filter(e => e.fScore >= 8);

  // 카드 2: 저평가 우량주 (F-Score 7+ AND 적정가 +20%)
  const value = all.filter(e =>
    e.fScore >= 7 &&
    e.fairValuePct !== null && e.fairValuePct >= 20
  );

  // 카드 3: 과매도 우량주 (F-Score 7+ AND RSI < 35)
  // RSI는 candles에서 계산 — 다음 단계에서 (이번엔 빈 배열)
  const oversold = [];

  // 카드 4: 박스권 우량주 (F-Score 7+ AND 변동성 낮음)
  // 마찬가지로 candles 필요 — 다음 단계에서
  const box = [];

  // 카드 5: 위험 종목 (F-Score 0-3)
  const risk = all.filter(e => e.fScore <= 3);

  // 정렬: 적정가 % 내림차순 (가장 저평가된 게 위로)
  const sortByFair = (a, b) => {
    const av = a.fairValuePct ?? -999;
    const bv = b.fairValuePct ?? -999;
    return bv - av;
  };

  return {
    top: top.sort(sortByFair),
    value: value.sort(sortByFair),
    oversold: oversold.sort(sortByFair),
    box: box.sort(sortByFair),
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
