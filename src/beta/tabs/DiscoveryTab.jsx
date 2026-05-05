/**
 * Beta Terminal — 발굴탭 v0.3
 * ============================================================================
 *
 * v0.2 → v0.3 변경:
 *   - 가변 사이즈 (모바일 ~ 데스크톱 자동) — 알파처럼
 *   - 종목 디테일에 1/3/5일 변화율 + 야후 목표가 대비 차이 추가
 *   - 과매도 (RSI<35) / 박스권 (변동폭<10%) 카드 활성화
 *   - 종목 행에 RSI / 박스 폭 시그널 태그
 */

import { useState, useEffect } from 'react';
import {
  evaluateStock,
  classifyForCards,
  distributionFor,
} from '../lib/fScore.js';

export default function DiscoveryTab() {
  const [expanded, setExpanded] = useState({
    top: true, value: false, oversold: false, box: false, risk: false,
  });
  const [marketFilter, setMarketFilter] = useState('all');
  const [selectedKey, setSelectedKey] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [evaluations, setEvaluations] = useState([]);
  const [meta, setMeta] = useState({ total: 0, withFinancials: 0, evaluated: 0 });

  // ─── 색상 ───
  const C = {
    bg: "#0A0E1A", panel: "#0F1420", panel2: "#161B2E",
    border: "rgba(255,255,255,.08)",
    gold: "#F59E0B", goldDim: "#92400E", goldGlow: "rgba(245, 158, 11, .12)",
    emerald: "#30D158", emeraldGlow: "rgba(48, 209, 88, .12)",
    cyan: "#06B6D4", cyanGlow: "rgba(6, 182, 212, .12)",
    violet: "#A78BFA", violetGlow: "rgba(167, 139, 250, .12)",
    red: "#FF453A", redGlow: "rgba(255, 69, 58, .12)",
    muted: "#8A93A6", text: "#E5E7EB", textDim: "#9CA3AF",
  };
  const mono = { fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", monospace' };

  // ─── 데이터 로드 ───
  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        const r = await fetch('/data/stocks.json', { cache: 'no-cache' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (cancelled) return;

        const financials = data.financials || {};
        const pool = data.pool || {};
        const stocks = data.stocks || {};

        const evals = [];
        let withFin = 0;
        for (const [ticker, fin] of Object.entries(financials)) {
          if (!fin.income && !fin.balance) continue;
          withFin++;
          const poolInfo = pool[ticker] || stocks[ticker] || {};
          const candles = stocks[ticker]?.candles || [];
          const result = evaluateStock(ticker, fin, poolInfo, candles);
          if (result) evals.push(result);
        }

        setEvaluations(evals);
        setMeta({
          total: Object.keys(pool).length + Object.keys(stocks).length,
          withFinancials: withFin,
          evaluated: evals.length,
          updatedAt: data.updatedAt,
          betaMergedAt: data.betaMergedAt,
        });
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => { cancelled = true; };
  }, []);

  const filteredEvals = marketFilter === 'all'
    ? evaluations
    : evaluations.filter(e => e.market === marketFilter);

  const cards = classifyForCards(filteredEvals);
  const distribution = distributionFor(filteredEvals);

  const distColors = {
    '9': C.gold, '8': '#FCD34D', '7': '#FDE68A', '6': C.muted, '5-': '#475569',
  };

  // ─── SVG 아이콘 ───
  const IconChevronDown = ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
  const IconArrowRight = ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
  const IconX = ({ size = 12 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );

  // ─── 헬퍼 ───
  const fmtPE = (pe) => pe == null ? '—' : pe.toFixed(1);
  const fmtPB = (pb) => pb == null ? '—' : pb.toFixed(1);
  const fmtROE = (roe) => roe == null ? '—' : `${roe > 0 ? '+' : ''}${(roe * 100).toFixed(0)}%`;
  const fmtPct = (n) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(0)}%`;
  const fmtPctDecimal = (n) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;

  function MarketBadge({ market }) {
    const isUS = market === 'us';
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '2px 6px', marginRight: 6,
        background: isUS ? 'rgba(59, 130, 246, .15)' : 'rgba(255, 69, 58, .15)',
        color: isUS ? '#60A5FA' : '#FCA5A5',
        border: `1px solid ${isUS ? 'rgba(59, 130, 246, .3)' : 'rgba(255, 69, 58, .3)'}`,
      }}>
        {isUS ? 'US' : 'KR'}
      </span>
    );
  }

  function AgreementDots({ level }) {
    const filled = level === 'high' ? 3 : level === 'mid' ? 2 : 1;
    const color = level === 'high' ? C.emerald : level === 'mid' ? C.gold : C.muted;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 700, color, ...mono }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{ opacity: i < filled ? 1 : 0.25 }}>●</span>
        ))}
      </span>
    );
  }

  function SignalTag({ type, value }) {
    if (type === 'rsi') return (
      <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '2px 6px',
        background: 'rgba(6, 182, 212, .15)', color: C.cyan, border: '1px solid rgba(6, 182, 212, .3)', ...mono }}>
        RSI {value.toFixed(0)}
      </span>
    );
    if (type === 'box') return (
      <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '2px 6px',
        background: 'rgba(167, 139, 250, .15)', color: C.violet, border: '1px solid rgba(167, 139, 250, .3)', ...mono }}>
        ±{(value/2).toFixed(1)}%
      </span>
    );
    return null;
  }

  const SCALE = 50;
  function ValuationBar({ name, pct, source = 'self' }) {
    const clamped = Math.max(-SCALE, Math.min(SCALE, pct));
    const isPositive = clamped >= 0;
    const barLeft = isPositive ? 50 : 50 + (clamped / SCALE * 50);
    const barWidth = Math.abs(clamped / SCALE * 50);
    const barColor = isPositive ? C.emerald : C.red;

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, ...mono }}>
        <div style={{ width: 88, flexShrink: 0, color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </div>
        <div style={{ position: 'relative', flex: 1, height: 8, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,.04)' }}>
          <div style={{ position: 'absolute', top: 0, bottom: 0, width: 1, left: '50%', background: 'rgba(255,255,255,.2)' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, borderRadius: 999, left: `${barLeft}%`, width: `${barWidth}%`, background: barColor, transition: 'all 400ms ease' }} />
        </div>
        <div style={{ width: 50, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: barColor }}>
          {fmtPct(pct)}
        </div>
      </div>
    );
  }

  function ValuationSummary({ models }) {
    if (!models || models.length === 0) return null;
    const pcts = models.map(m => m.pct).sort((a, b) => a - b);
    const min = pcts[0];
    const max = pcts[pcts.length - 1];
    const median = pcts[Math.floor(pcts.length / 2)];
    const avg = pcts.reduce((s, x) => s + x, 0) / pcts.length;

    const items = [
      { label: '최저', value: min },
      { label: '평균', value: avg },
      { label: '중앙값', value: median, emphasis: true },
      { label: '최고', value: max },
    ];

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
        {items.map((it, i) => (
          <div key={i} style={{
            padding: '6px 8px', borderRadius: 4, textAlign: 'center',
            background: it.emphasis ? 'rgba(48, 209, 88, .08)' : 'rgba(255,255,255,.02)',
            border: `1px solid ${it.emphasis ? 'rgba(48, 209, 88, .25)' : C.border}`,
          }}>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.04em' }}>{it.label}</div>
            <div style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: it.value > 0 ? C.emerald : C.red, ...mono }}>
              {fmtPct(it.value)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ─── 추가 동향 (1/3/5일 + 목표가) ───
  function PriceMovementSection({ stock }) {
    const showCandles = stock.hasCandles && (stock.chg1d != null || stock.chg3d != null || stock.chg5d != null);
    const showTarget = stock.targetDiff && stock.targetDiff.available;

    if (!showCandles && !showTarget) return null;

    return (
      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: C.cyan, letterSpacing: '0.04em', marginBottom: 8 }}>
          📈 최근 동향
        </div>

        {/* 가격 변화율 */}
        {showCandles && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: showTarget ? 8 : 0 }}>
            {[
              { label: '1일', value: stock.chg1d },
              { label: '3일', value: stock.chg3d },
              { label: '5일', value: stock.chg5d },
            ].map((it, i) => (
              <div key={i} style={{
                padding: '6px 8px', borderRadius: 4, textAlign: 'center',
                background: 'rgba(255,255,255,.02)',
                border: `1px solid ${C.border}`,
              }}>
                <div style={{ fontSize: 9, color: C.muted, letterSpacing: '0.04em' }}>{it.label}</div>
                <div style={{
                  fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                  color: it.value == null ? C.muted : it.value >= 0 ? C.emerald : C.red,
                  ...mono,
                }}>
                  {fmtPctDecimal(it.value)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 야후 목표가 */}
        {showTarget && (
          <div style={{
            padding: 8, borderRadius: 4,
            background: 'rgba(6, 182, 212, .04)',
            border: `1px solid rgba(6, 182, 212, .15)`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, fontSize: 10 }}>
              <span style={{ color: C.muted }}>야후 애널리스트 목표가 ({stock.targetDiff.numAnalysts}명)</span>
              <span style={{
                color: stock.targetDiff.pct > 0 ? C.emerald : C.red,
                fontWeight: 700, ...mono,
              }}>
                {fmtPctDecimal(stock.targetDiff.pct)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.textDim, ...mono }}>
              <span>현재 ${stock.targetDiff.currentPrice.toFixed(2)}</span>
              <span>→</span>
              <span>평균 ${stock.targetDiff.targetMean.toFixed(2)}</span>
            </div>
            {stock.targetDiff.targetLow != null && stock.targetDiff.targetHigh != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: C.muted, ...mono, marginTop: 2 }}>
                <span>저 ${stock.targetDiff.targetLow.toFixed(2)} ({fmtPctDecimal(stock.targetDiff.lowPct)})</span>
                <span>고 ${stock.targetDiff.targetHigh.toFixed(2)} ({fmtPctDecimal(stock.targetDiff.highPct)})</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  function DetailPanel({ stock, accent }) {
    const models = stock.fairValueModels || [];

    return (
      <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 12, borderRadius: 6, background: 'rgba(0,0,0,.25)', border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: accent, letterSpacing: '0.04em' }}>
            📊 적정가 분석 ({stock.industry || '업종 미상'})
          </div>
          <button onClick={(e) => { e.stopPropagation(); setSelectedKey(null); }}
            style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted }}>
            <IconX size={12} />
          </button>
        </div>

        {/* 적정가 모델 */}
        {models.length > 0 ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 10, color: C.emerald, fontWeight: 700, letterSpacing: '0.04em' }}>
                ━━ 자기 5년 평균 기준 (간이 모델)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {models.map((m, i) => (
                  <ValuationBar key={i} name={m.name} pct={m.pct} source={m.source} />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: C.muted, ...mono, paddingLeft: 96, paddingRight: 50 }}>
                <span>-{SCALE}%</span>
                <span style={{ color: C.textDim }}>현재가 0%</span>
                <span>+{SCALE}%</span>
              </div>
            </div>

            <ValuationSummary models={models} />
          </>
        ) : (
          <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', padding: 12 }}>
            적정가 모델 계산 불가 — 데이터 부족
          </div>
        )}

        {/* 최근 동향 + 목표가 */}
        <PriceMovementSection stock={stock} />

        {/* F-Score 컴포넌트 */}
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.gold, letterSpacing: '0.04em', marginBottom: 8 }}>
            🎯 F-Score 컴포넌트 ({stock.fScoreRaw}/{stock.fScoreMax} 평가됨)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
            {Object.entries(stock.fScoreComponents || {}).map(([k, v]) => {
              const labels = {
                roaPositive: 'ROA > 0',
                cfoPositive: 'CFO > 0',
                roaImproving: 'ROA 개선',
                cfoOverNi: 'CFO > 순이익',
                leverageImproving: '부채 감소',
                currentRatioImproving: '유동성 개선',
                grossMarginImproving: '마진 개선',
                assetTurnoverImproving: '자산회전 개선',
              };
              const color = v === true ? C.emerald : v === false ? C.red : C.muted;
              const mark = v === true ? '✓' : v === false ? '✗' : '—';
              return (
                <div key={k} style={{ fontSize: 10, padding: '4px 8px', display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,.02)', borderRadius: 3 }}>
                  <span style={{ color: C.textDim }}>{labels[k] || k}</span>
                  <span style={{ color, fontWeight: 700 }}>{mark}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ fontSize: 9, lineHeight: 1.6, paddingTop: 4, color: C.muted }}>
          ※ 적정가는 자기 5년 평균 multiple 기준 간이 모델 (이익 성장률 + ROE 보정).
          {stock.market === 'kr' && ' 한국 종목은 P/E 누락 잦음 → 일치도 자동 낮음.'}
        </div>
      </div>
    );
  }

  function TickerRow({ stock, accentColor, cardId, signalType }) {
    const fairValuePositive = stock.fairValuePct != null && stock.fairValuePct > 0;
    const rowKey = `${cardId}:${stock.ticker}`;
    const isSelected = selectedKey === rowKey;
    const signalValue = signalType === 'rsi' ? stock.rsi
                      : signalType === 'box' ? stock.boxRange
                      : null;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{
          borderRadius: 6, transition: 'all 200ms ease',
          background: isSelected ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.02)',
          border: `1px solid ${isSelected ? accentColor : C.border}`,
          boxShadow: isSelected ? `0 0 0 1px ${accentColor}40` : 'none',
        }}>
          <div style={{ display: 'flex' }}>
            <button onClick={() => setSelectedKey(prev => prev === rowKey ? null : rowKey)}
              style={{ flex: 1, textAlign: 'left', padding: '10px 12px', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', borderRadius: '6px 0 0 6px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1 }}>
                  <MarketBadge market={stock.market} />
                  <span style={{ fontWeight: 600, fontSize: 14, flexShrink: 0, color: C.text, ...mono }}>{stock.ticker}</span>
                  <span style={{ marginLeft: 8, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.textDim }}>{stock.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {signalType && signalValue != null && <SignalTag type={signalType} value={signalValue} />}
                  <span style={{ fontWeight: 700, fontSize: 14, color: accentColor, ...mono }}>{stock.fScore}/9</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 11, fontVariantNumeric: 'tabular-nums', marginBottom: 4, color: C.textDim, ...mono }}>
                <span>P/E <span style={{ color: C.text }}>{fmtPE(stock.pe)}</span></span>
                <span>P/B <span style={{ color: C.text }}>{fmtPB(stock.pb)}</span></span>
                <span>ROE <span style={{ color: stock.roe != null && stock.roe > 0 ? C.emerald : C.red }}>{fmtROE(stock.roe)}</span></span>
              </div>
              {stock.fairValuePct != null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, fontVariantNumeric: 'tabular-nums', paddingTop: 4, borderTop: `1px solid ${C.border}`, ...mono }}>
                  <span style={{ color: C.muted }}>
                    적정가 <span style={{ color: fairValuePositive ? C.emerald : C.red, fontWeight: 700 }}>
                      {fmtPct(stock.fairValuePct)}
                    </span>
                  </span>
                  <AgreementDots level={stock.agreement} />
                  {stock.targetDiff && stock.targetDiff.available && (
                    <span style={{ marginLeft: 'auto', color: C.muted }}>
                      목표가 <span style={{ color: stock.targetDiff.pct > 0 ? C.emerald : C.red, fontWeight: 600 }}>
                        {fmtPctDecimal(stock.targetDiff.pct)}
                      </span>
                    </span>
                  )}
                </div>
              )}
            </button>

            <button onClick={(e) => { e.stopPropagation(); window.location.href = '/'; }}
              style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: '0 6px 6px 0', flexShrink: 0, background: 'rgba(59, 130, 246, .06)', borderLeft: `1px solid ${C.border}`, border: 'none', borderLeftWidth: 1, color: '#60A5FA', cursor: 'pointer' }}
              title="알파 터미널로 이동">
              <IconArrowRight size={16} />
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em' }}>α</span>
            </button>
          </div>
        </div>
        {isSelected && <DetailPanel stock={stock} accent={accentColor} />}
      </div>
    );
  }

  function ExpandableCard({ id, accent, glow, icon, title, subtitle, stocks, signalType }) {
    const isOpen = expanded[id];
    const count = stocks.length;
    return (
      <div style={{
        borderRadius: 8, overflow: 'hidden',
        background: C.panel, border: `1px solid ${C.border}`, borderLeft: `4px solid ${accent}`,
        opacity: count === 0 ? 0.45 : 1,
      }}>
        <button onClick={() => count > 0 && setExpanded(s => ({ ...s, [id]: !s[id] }))}
          disabled={count === 0}
          style={{ width: '100%', padding: '16px', textAlign: 'left', background: 'transparent', border: 'none', color: 'inherit', cursor: count === 0 ? 'default' : 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: accent, letterSpacing: '0.04em' }}>
                {icon} {title}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <div style={{ fontSize: 36, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: accent, ...mono, lineHeight: 1 }}>
                  {count}
                </div>
                <div style={{ fontSize: 11, lineHeight: 1.4, color: C.textDim }}>
                  {count === 0 ? '해당 종목 없음' : subtitle}
                </div>
              </div>
            </div>
            {count > 0 && (
              <div style={{ flexShrink: 0, marginLeft: 8, marginTop: 4, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, background: glow, color: accent, transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 200ms ease' }}>
                <IconChevronDown size={16} />
              </div>
            )}
          </div>
        </button>
        {isOpen && count > 0 && (
          <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stocks.slice(0, 30).map((s, i) => (
              <TickerRow key={s.ticker + i} stock={s} accentColor={accent} cardId={id} signalType={signalType} />
            ))}
            {stocks.length > 30 && (
              <div style={{ textAlign: 'center', fontSize: 11, padding: '8px 0', color: C.muted }}>
                + {stocks.length - 30}개 더 (상위 30개만 표시)
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  function MarketFilterToggle() {
    const opts = [
      { id: 'all', label: '전체' },
      { id: 'kr', label: '🇰🇷 한국' },
      { id: 'us', label: '🇺🇸 미국' },
    ];
    return (
      <div style={{ display: 'inline-flex', padding: 2, borderRadius: 8, gap: 2, background: C.panel, border: `1px solid ${C.border}` }}>
        {opts.map(o => {
          const active = marketFilter === o.id;
          return (
            <button key={o.id} onClick={() => setMarketFilter(o.id)}
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', border: 'none',
                background: active ? `linear-gradient(135deg, ${C.gold}, ${C.goldDim})` : 'transparent',
                color: active ? '#1a1a1a' : C.textDim,
                boxShadow: active ? '0 1px 4px rgba(245, 158, 11, .25)' : 'none',
              }}>
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  const totalStocks = distribution.reduce((s, d) => s + d.count, 0);
  const maxCount = Math.max(...distribution.map(d => d.count), 1);

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif' }}>
      {/* ★ 가변 사이즈: maxWidth 100% / 모바일 ~ 데스크톱 자동 */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 16px', paddingBottom: 48 }}>
        {/* 헤더 */}
        <div style={{
          padding: '16px 0 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, zIndex: 10, backdropFilter: 'blur(8px)',
          background: 'rgba(10, 14, 26, 0.85)', borderBottom: `1px solid ${C.border}`,
          margin: '0 -16px', paddingLeft: 16, paddingRight: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <button onClick={() => { window.location.href = '/'; }}
              style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, flexShrink: 0, cursor: 'pointer',
                background: 'rgba(59, 130, 246, .12)', color: '#60A5FA',
                border: '1px solid rgba(59, 130, 246, .25)' }}>α</button>
            <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, flexShrink: 0,
              background: `linear-gradient(135deg, ${C.gold}, ${C.goldDim})`, color: '#1a1a1a' }}>
              β
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text }}>
                Beta Terminal
              </div>
              <div style={{ fontSize: 10, color: C.textDim }}>가치 평가 · v0.3</div>
            </div>
          </div>
          {!loading && !error && (
            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600, flexShrink: 0,
              background: 'rgba(48, 209, 88, .15)', color: C.emerald, border: '1px solid rgba(48, 209, 88, .3)' }}>
              LIVE
            </span>
          )}
        </div>

        {/* 페이지 헤더 */}
        <div style={{ padding: '20px 0 8px' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: C.text, margin: '0 0 4px' }}>
            🌟 가치 발굴
          </h1>
          <div style={{ fontSize: 11, marginBottom: 12, color: C.textDim }}>
            {loading ? '데이터 로딩 중...' :
             error ? `오류: ${error}` :
             `${meta.evaluated}종목 평가 완료 (전체 풀 ${meta.total}, 재무 데이터 ${meta.withFinancials})`}
          </div>
          <MarketFilterToggle />
        </div>

        {loading && (
          <div style={{ padding: '60px 0', textAlign: 'center', color: C.muted, fontSize: 13 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
            stocks.json 로드 중...
          </div>
        )}

        {error && (
          <div style={{ margin: '20px 0', padding: 16, borderRadius: 8, background: 'rgba(255,69,58,.08)', border: `1px solid ${C.red}`, fontSize: 12, color: C.text }}>
            <div style={{ fontWeight: 600, color: C.red, marginBottom: 4 }}>⚠️ 데이터 로드 실패</div>
            <div style={{ color: C.textDim }}>{error}</div>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* F-Score 분포 */}
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.textDim }}>
                  F-Score 분포
                  {marketFilter !== 'all' && (
                    <span style={{ marginLeft: 6, color: C.gold }}>
                      · {marketFilter === 'kr' ? '한국' : '미국'}
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: C.muted, ...mono }}>
                  총 {totalStocks}종목
                </span>
              </div>
              <div style={{ borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, background: C.panel, border: `1px solid ${C.border}` }}>
                {distribution.map(d => {
                  const pct = Math.round(d.count / maxCount * 100);
                  return (
                    <div key={d.score} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 36, fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: distColors[d.score], ...mono }}>
                        {d.score}점
                      </div>
                      <div style={{ flex: 1, height: 8, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,.04)' }}>
                        <div style={{ height: '100%', borderRadius: 999, width: `${pct}%`, background: distColors[d.score], transition: 'width 600ms ease' }} />
                      </div>
                      <div style={{ width: 40, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: C.text, ...mono }}>
                        {d.count}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 카드 5개 — 가변 사이즈일 때 2열 그리드 (md 이상) */}
            <div style={{
              marginTop: 16,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
              gap: 12,
            }}>
              <ExpandableCard id="top"      accent={C.gold}    glow={C.goldGlow}    icon="💎" title="최고점 (F-Score 8+)" subtitle="펀더멘털 상위" stocks={cards.top} />
              <ExpandableCard id="value"    accent={C.emerald} glow={C.emeraldGlow} icon="🔍" title="저평가 우량주"      subtitle="F-Score 7+ AND 적정가 +20%" stocks={cards.value} />
              <ExpandableCard id="oversold" accent={C.cyan}    glow={C.cyanGlow}    icon="📉" title="과매도 우량주"      subtitle="F-Score 7+ AND RSI < 35" stocks={cards.oversold} signalType="rsi" />
              <ExpandableCard id="box"      accent={C.violet}  glow={C.violetGlow}  icon="📦" title="박스권 우량주"      subtitle="F-Score 7+ AND 변동폭 ±10% 이내" stocks={cards.box} signalType="box" />
              <ExpandableCard id="risk"     accent={C.red}     glow={C.redGlow}     icon="⚠️" title="위험 종목"          subtitle="F-Score 0-3 — 매수 주의" stocks={cards.risk} />
            </div>

            {/* 푸터 */}
            <div style={{ margin: '20px 0 0', padding: 12, borderRadius: 6, fontSize: 11, lineHeight: 1.6,
              background: 'rgba(48,209,88,.06)', color: C.textDim, border: `1px solid rgba(48,209,88,.15)` }}>
              <div style={{ fontWeight: 600, marginBottom: 4, color: C.emerald }}>
                ✅ 실데이터 연결됨
              </div>
              {meta.betaMergedAt && (
                <div>마지막 갱신: {new Date(meta.betaMergedAt).toLocaleString('ko-KR')}</div>
              )}
              <div>F-Score 9점 만점, 적정가 = PER/PBR/EV 모델 중앙값. 종목 클릭 시 1/3/5일 변화율 + 야후 목표가 표시.</div>
              <div style={{ marginTop: 4, color: C.muted, fontSize: 10 }}>
                ⚠️ 한국 종목은 P/E 누락 잦음 → 모델 일치도 자동 낮음.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
