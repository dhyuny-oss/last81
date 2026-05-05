/**
 * Beta Terminal — 발굴탭 (Discovery Tab) v0.1
 *
 * F-Score · Magic Formula · 적정가 모델 (PER/PBR/EV) 기반 가치 발굴기
 *
 * ⚠️ 현재 상태: 가짜 데이터로 동작하는 시안.
 *    실제 데이터 연결은 PR #3 (fetch_yahoo.py quarterly 확장) 후 PR #4에서.
 *
 * 카드 5개:
 *  - 💎 최고점 (F-Score 9)
 *  - 🔍 저평가 우량주 (F-Score 7+ AND 적정가 +20%)
 *  - 📉 과매도 우량주 (F-Score 7+ AND RSI < 35)
 *  - 📦 박스권 우량주 (F-Score 7+ AND 변동성 낮음)
 *  - ⚠️ 위험 종목 (F-Score 0-3)
 *
 * 종목 누르면 디테일 패널: 자기 5년 평균 모델 3개 + 업종 PER 비교 + 피어 표
 */

import { useState } from 'react';

export default function DiscoveryTab() {
  const [expanded, setExpanded] = useState({
    top: true, value: false, oversold: false, box: false, risk: false,
  });
  const [marketFilter, setMarketFilter] = useState('all');
  const [selectedKey, setSelectedKey] = useState(null);

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

  // ─── lucide-react 대신 인라인 SVG ───
  const IconChevronDown = ({ size = 16, color = "currentColor" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
  const IconArrowRight = ({ size = 16, color = "currentColor" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
  const IconX = ({ size = 12, color = "currentColor" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
  const IconStar = ({ size = 10, color = C.gold }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );

  // ─── 가짜 데이터 (시안용) ───
  const topPicks = [
    { ticker: "AAPL",   market: "us", label: "Apple",             fScore: 9, pe: 28.0, pb: 45.2, roe: 145, mfRank: 92,  fairValuePct: +5,  agreement: "high", epsSurprise: +4, industry: "Tech",            industryPER: 28.5 },
    { ticker: "MSFT",   market: "us", label: "Microsoft",         fScore: 9, pe: 31.5, pb: 11.5, roe:  35, mfRank: 89,  fairValuePct: +18, agreement: "high", epsSurprise: +7, industry: "Tech",            industryPER: 28.5 },
    { ticker: "005930", market: "kr", label: "삼성전자",           fScore: 9, pe: 12.5, pb:  1.2, roe:  10, mfRank: 78,  fairValuePct: +28, agreement: "high", epsSurprise: -2, industry: "반도체",          industryPER: 18.3 },
    { ticker: "JNJ",    market: "us", label: "Johnson & Johnson", fScore: 9, pe: 22.1, pb:  5.5, roe:  27, mfRank: 81,  fairValuePct: +10, agreement: "mid",  epsSurprise: +3, industry: "Healthcare",      industryPER: 18.0 },
    { ticker: "PG",     market: "us", label: "Procter & Gamble",  fScore: 9, pe: 25.3, pb:  8.1, roe:  31, mfRank: 76,  fairValuePct: +12, agreement: "high", epsSurprise: +2, industry: "Consumer Staples",industryPER: 23.0 },
  ];
  const valuePicks = [
    { ticker: "000660", market: "kr", label: "SK하이닉스",         fScore: 8, pe:  8.2, pb: 1.5, roe: 18, mfRank: 65, fairValuePct: +35, agreement: "mid",  epsSurprise: +11, industry: "반도체",     industryPER: 18.3 },
    { ticker: "BRK.B",  market: "us", label: "Berkshire Hathaway",fScore: 8, pe: 11.8, pb: 1.5, roe: 11, mfRank: 71, fairValuePct: +22, agreement: "high", epsSurprise: +1,  industry: "Holdings",   industryPER: 12.0 },
    { ticker: "035420", market: "kr", label: "NAVER",             fScore: 7, pe: 14.2, pb: 1.6, roe:  9, mfRank: 58, fairValuePct: +40, agreement: "low",  epsSurprise: +6,  industry: "Internet",   industryPER: 25.0 },
    { ticker: "JPM",    market: "us", label: "JPMorgan Chase",    fScore: 7, pe: 11.2, pb: 1.7, roe: 16, mfRank: 62, fairValuePct: +15, agreement: "high", epsSurprise: +5,  industry: "Banking",    industryPER: 11.5 },
  ];
  const oversoldPicks = [
    { ticker: "TGT",    market: "us", label: "Target",       fScore: 8, pe: 13.5, pb: 3.8, roe: 28, mfRank: 68, rsi: 28, fairValuePct: +28, agreement: "high", epsSurprise: -5, industry: "Retail",     industryPER: 17.5 },
    { ticker: "012330", market: "kr", label: "현대모비스",    fScore: 7, pe:  6.2, pb: 0.6, roe:  8, mfRank: 55, rsi: 32, fairValuePct: +45, agreement: "high", epsSurprise: +2, industry: "자동차부품", industryPER:  8.5 },
  ];
  const boxPicks = [
    { ticker: "KO",     market: "us", label: "Coca-Cola", fScore: 8, pe: 24.3, pb: 9.5, roe: 42, mfRank: 64, boxRange: "±3%", fairValuePct:  +8, agreement: "high", epsSurprise: +3, industry: "Beverages", industryPER: 22.0 },
    { ticker: "035720", market: "kr", label: "카카오",     fScore: 7, pe: 18.5, pb: 1.2, roe:  7, mfRank: 52, boxRange: "±5%", fairValuePct: +20, agreement: "mid",  epsSurprise: -1, industry: "Internet",  industryPER: 25.0 },
  ];
  const riskPicks = [
    { ticker: "TSLA", market: "us", label: "Tesla",      fScore: 3, pe: 78.5, pb: 11.2, roe:   8, mfRank: 320, fairValuePct: -22, agreement: "low",  epsSurprise: -18, industry: "Auto/EV",      industryPER: 32.0 },
    { ticker: "RIVN", market: "us", label: "Rivian",     fScore: 1, pe: null, pb:  2.1, roe: -45, mfRank: 480, fairValuePct: -45, agreement: "low",  epsSurprise: -32, industry: "Auto/EV",      industryPER: 32.0 },
    { ticker: "PLUG", market: "us", label: "Plug Power", fScore: 2, pe: null, pb:  0.8, roe: -32, mfRank: 460, fairValuePct: -38, agreement: "mid",  epsSurprise: -28, industry: "Clean Energy", industryPER: 25.0 },
  ];

  const industryPeers = {
    'Tech': [
      { ticker: 'AAPL', label: 'Apple', pe: 28.0, pb: 45.2, fScore: 9 },
      { ticker: 'MSFT', label: 'Microsoft', pe: 31.5, pb: 11.5, fScore: 9 },
      { ticker: 'GOOGL', label: 'Alphabet', pe: 24.5, pb: 7.0, fScore: 8 },
      { ticker: 'META', label: 'Meta', pe: 26.0, pb: 8.5, fScore: 7 },
    ],
    '반도체': [
      { ticker: '005930', label: '삼성전자', pe: 12.5, pb: 1.2, fScore: 9 },
      { ticker: '000660', label: 'SK하이닉스', pe: 8.2, pb: 1.5, fScore: 8 },
      { ticker: 'TSM', label: 'TSMC', pe: 22.1, pb: 5.8, fScore: 8 },
      { ticker: 'MU', label: 'Micron', pe: 14.0, pb: 1.9, fScore: 6 },
    ],
    'Healthcare': [
      { ticker: 'JNJ', label: 'J&J', pe: 22.1, pb: 5.5, fScore: 9 },
      { ticker: 'PFE', label: 'Pfizer', pe: 17.5, pb: 1.8, fScore: 5 },
      { ticker: 'LLY', label: 'Eli Lilly', pe: 75.0, pb: 65.0, fScore: 7 },
      { ticker: 'MRK', label: 'Merck', pe: 18.0, pb: 5.2, fScore: 8 },
    ],
    'Consumer Staples': [
      { ticker: 'PG', label: 'P&G', pe: 25.3, pb: 8.1, fScore: 9 },
      { ticker: 'KO', label: 'Coca-Cola', pe: 24.3, pb: 9.5, fScore: 8 },
      { ticker: 'PEP', label: 'PepsiCo', pe: 22.0, pb: 11.0, fScore: 7 },
      { ticker: 'WMT', label: 'Walmart', pe: 28.0, pb: 6.5, fScore: 7 },
    ],
    'Holdings': [
      { ticker: 'BRK.B', label: 'Berkshire', pe: 11.8, pb: 1.5, fScore: 8 },
      { ticker: 'BLK', label: 'BlackRock', pe: 22.0, pb: 3.2, fScore: 7 },
      { ticker: 'BX', label: 'Blackstone', pe: 35.0, pb: 8.5, fScore: 6 },
    ],
    'Internet': [
      { ticker: '035420', label: 'NAVER', pe: 14.2, pb: 1.6, fScore: 7 },
      { ticker: '035720', label: '카카오', pe: 18.5, pb: 1.2, fScore: 7 },
      { ticker: 'BABA', label: 'Alibaba', pe: 11.0, pb: 1.5, fScore: 6 },
    ],
    'Banking': [
      { ticker: 'JPM', label: 'JPMorgan', pe: 11.2, pb: 1.7, fScore: 7 },
      { ticker: 'BAC', label: 'B of A', pe: 13.5, pb: 1.2, fScore: 6 },
      { ticker: 'C', label: 'Citigroup', pe: 12.0, pb: 0.6, fScore: 5 },
      { ticker: 'WFC', label: 'Wells', pe: 13.0, pb: 1.4, fScore: 6 },
    ],
    'Retail': [
      { ticker: 'TGT', label: 'Target', pe: 13.5, pb: 3.8, fScore: 8 },
      { ticker: 'WMT', label: 'Walmart', pe: 28.0, pb: 6.5, fScore: 7 },
      { ticker: 'COST', label: 'Costco', pe: 50.0, pb: 18.0, fScore: 8 },
    ],
    'Beverages': [
      { ticker: 'KO', label: 'Coca-Cola', pe: 24.3, pb: 9.5, fScore: 8 },
      { ticker: 'PEP', label: 'PepsiCo', pe: 22.0, pb: 11.0, fScore: 7 },
      { ticker: 'MNST', label: 'Monster', pe: 32.0, pb: 7.0, fScore: 7 },
    ],
    '자동차부품': [
      { ticker: '012330', label: '현대모비스', pe: 6.2, pb: 0.6, fScore: 7 },
      { ticker: 'APTV', label: 'Aptiv', pe: 14.0, pb: 2.1, fScore: 6 },
      { ticker: 'MGA', label: 'Magna', pe: 9.5, pb: 1.0, fScore: 6 },
    ],
    'Auto/EV': [
      { ticker: 'TSLA', label: 'Tesla', pe: 78.5, pb: 11.2, fScore: 3 },
      { ticker: 'F', label: 'Ford', pe: 12.0, pb: 1.0, fScore: 5 },
      { ticker: 'GM', label: 'GM', pe: 6.0, pb: 0.8, fScore: 6 },
      { ticker: 'RIVN', label: 'Rivian', pe: null, pb: 2.1, fScore: 1 },
    ],
    'Clean Energy': [
      { ticker: 'PLUG', label: 'Plug Power', pe: null, pb: 0.8, fScore: 2 },
      { ticker: 'ENPH', label: 'Enphase', pe: 35.0, pb: 9.0, fScore: 6 },
      { ticker: 'BE', label: 'Bloom', pe: null, pb: 8.0, fScore: 4 },
    ],
  };

  const cardCounts = {
    top:      { all: 12, kr: 3, us: 9 },
    value:    { all: 17, kr: 8, us: 9 },
    oversold: { all:  5, kr: 2, us: 3 },
    box:      { all:  4, kr: 2, us: 2 },
    risk:     { all:  5, kr: 0, us: 5 },
  };
  const distributionData = {
    all: [{ score: '9', count: 12, color: C.gold }, { score: '8', count: 23, color: '#FCD34D' }, { score: '7', count: 45, color: '#FDE68A' }, { score: '6', count: 78, color: C.muted }, { score: '5-', count: 240, color: '#475569' }],
    kr:  [{ score: '9', count: 3,  color: C.gold }, { score: '8', count: 7,  color: '#FCD34D' }, { score: '7', count: 15, color: '#FDE68A' }, { score: '6', count: 28, color: C.muted }, { score: '5-', count: 80,  color: '#475569' }],
    us:  [{ score: '9', count: 9,  color: C.gold }, { score: '8', count: 16, color: '#FCD34D' }, { score: '7', count: 30, color: '#FDE68A' }, { score: '6', count: 50, color: C.muted }, { score: '5-', count: 160, color: '#475569' }],
  };
  const distribution = distributionData[marketFilter];
  const maxCount = Math.max(...distribution.map(d => d.count));
  distribution.forEach(d => { d.pct = Math.round(d.count / maxCount * 100); });
  const totalStocks = distribution.reduce((s, d) => s + d.count, 0);

  const filterStocks = (stocks) =>
    marketFilter === 'all' ? stocks : stocks.filter(s => s.market === marketFilter);

  const fmtPE = (pe) => pe == null ? '—' : pe.toFixed(1);
  const fmtROE = (roe) => `${roe > 0 ? '+' : ''}${roe.toFixed(0)}%`;
  const fmtPct = (n) => `${n > 0 ? '+' : ''}${n.toFixed(0)}%`;

  function generateModels(stock) {
    const variance = stock.agreement === 'high' ? 3 : stock.agreement === 'mid' ? 7 : 12;
    return [
      { name: 'PER × EPS',  pct: stock.fairValuePct + variance,                  source: 'self' },
      { name: 'PBR × BPS',  pct: stock.fairValuePct - variance,                  source: 'self' },
      { name: 'EV/EBITDA',  pct: stock.fairValuePct + (variance * 0.3),          source: 'self' },
    ];
  }
  function getIndustryModel(stock) {
    if (stock.pe == null) return null;
    const pct = ((stock.industryPER / stock.pe) - 1) * 100;
    return { name: '업종 PER 적용', pct, source: 'industry' };
  }

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
      <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 700, letterSpacing: '-0.02em', color, ...mono }}>
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
        RSI {value}
      </span>
    );
    if (type === 'box') return (
      <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '2px 6px',
        background: 'rgba(167, 139, 250, .15)', color: C.violet, border: '1px solid rgba(167, 139, 250, .3)', ...mono }}>
        {value}
      </span>
    );
    return null;
  }

  const SCALE = 50;
  function ValuationBar({ name, pct, source }) {
    const clamped = Math.max(-SCALE, Math.min(SCALE, pct));
    const isPositive = clamped >= 0;
    const barLeft  = isPositive ? 50 : 50 + (clamped / SCALE * 50);
    const barWidth = Math.abs(clamped / SCALE * 50);
    const barColor = source === 'industry'
      ? (isPositive ? C.violet : C.gold)
      : (isPositive ? C.emerald : C.red);

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, ...mono }}>
        <div style={{ width: 88, flexShrink: 0, color: C.textDim, display: 'flex', alignItems: 'center', gap: 4 }}>
          {source === 'industry' && <span style={{ color: C.violet, fontSize: 8 }}>◆</span>}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        </div>
        <div style={{ position: 'relative', flex: 1, height: 8, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,.04)' }}>
          <div style={{ position: 'absolute', top: 0, bottom: 0, width: 1, left: '50%', background: 'rgba(255,255,255,.2)' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, borderRadius: 999, left: `${barLeft}%`, width: `${barWidth}%`, background: barColor, transition: 'all 400ms ease' }} />
        </div>
        <div style={{ width: 42, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: barColor }}>
          {fmtPct(pct)}
        </div>
      </div>
    );
  }

  function ValuationSummary({ models }) {
    const pcts = models.map(m => m.pct);
    const sorted = [...pcts].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const median = sorted[Math.floor(sorted.length / 2)];
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

  function IndustrySection({ stock }) {
    const peers = industryPeers[stock.industry] || [];
    const inPool = peers.some(p => p.ticker === stock.ticker);
    const allPeers = inPool ? peers : [
      { ticker: stock.ticker, label: stock.label, pe: stock.pe, pb: stock.pb, fScore: stock.fScore },
      ...peers,
    ];
    const peSorted = [...allPeers].sort((a, b) => {
      if (a.pe == null) return 1;
      if (b.pe == null) return -1;
      return a.pe - b.pe;
    });
    const peRank = peSorted.findIndex(p => p.ticker === stock.ticker) + 1;
    const pbSorted = [...allPeers].sort((a, b) => a.pb - b.pb);
    const pbRank = pbSorted.findIndex(p => p.ticker === stock.ticker) + 1;
    const fSorted = [...allPeers].sort((a, b) => b.fScore - a.fScore);
    const fRank = fSorted.findIndex(p => p.ticker === stock.ticker) + 1;
    const total = allPeers.length;
    const industryModel = getIndustryModel(stock);

    function RankBadge({ rank, total, label }) {
      const isFirst = rank === 1;
      return (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 11, padding: '6px 8px', borderRadius: 4,
          background: isFirst ? 'rgba(245, 158, 11, .08)' : 'rgba(255,255,255,.02)',
        }}>
          <span style={{ color: C.textDim }}>{label}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, ...mono }}>
            {isFirst && <IconStar size={10} color={C.gold} />}
            <span style={{ color: isFirst ? C.gold : C.text, fontWeight: 700 }}>{rank}위</span>
            <span style={{ color: C.muted }}>/ {total}</span>
          </span>
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.violet, letterSpacing: '0.04em' }}>
            🏭 업종 비교 · {stock.industry}
          </div>
          <span style={{ fontSize: 10, color: C.muted, ...mono }}>{total}종목</span>
        </div>

        {industryModel ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, color: C.muted }}>
              업종 평균 PER ({stock.industryPER.toFixed(1)}) 적용 시
            </div>
            <ValuationBar name={industryModel.name} pct={industryModel.pct} source="industry" />
            <div style={{ fontSize: 9, color: C.muted, paddingLeft: 96 }}>
              현재 PER {stock.pe?.toFixed(1)} × (업종/현재) = 가격 변화
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 10, color: C.muted }}>
            업종 PER 적용 불가 — 적자 종목 (PER 없음)
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4, color: C.muted, letterSpacing: '0.04em' }}>
            업종 내 위치
          </div>
          <RankBadge rank={peRank} total={total} label="PER 저평가 순" />
          <RankBadge rank={pbRank} total={total} label="PBR 저평가 순" />
          <RankBadge rank={fRank} total={total} label="F-Score 순" />
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 6, color: C.muted, letterSpacing: '0.04em' }}>
            동종업계 (PER 저평가 순)
          </div>
          <div style={{ borderRadius: 4, overflow: 'hidden', border: `1px solid ${C.border}` }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4, padding: '6px 8px', fontSize: 9, fontWeight: 600, background: C.panel2, color: C.muted, letterSpacing: '0.04em' }}>
              <div style={{ gridColumn: 'span 1' }}></div>
              <div style={{ gridColumn: 'span 4' }}>티커</div>
              <div style={{ gridColumn: 'span 3', textAlign: 'right' }}>PER</div>
              <div style={{ gridColumn: 'span 2', textAlign: 'right' }}>PBR</div>
              <div style={{ gridColumn: 'span 2', textAlign: 'right' }}>F</div>
            </div>
            {peSorted.map((p, i) => {
              const isMe = p.ticker === stock.ticker;
              return (
                <div key={p.ticker} style={{
                  display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4,
                  padding: '6px 8px', fontSize: 10, fontVariantNumeric: 'tabular-nums', alignItems: 'center',
                  background: isMe ? 'rgba(245, 158, 11, .08)' : 'transparent',
                  borderTop: i > 0 ? `1px solid ${C.border}` : 'none', ...mono,
                }}>
                  <div style={{ gridColumn: 'span 1' }}>
                    {isMe && <IconStar size={10} color={C.gold} />}
                  </div>
                  <div style={{ gridColumn: 'span 4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isMe ? C.gold : C.text, fontWeight: isMe ? 700 : 400 }}>
                    {p.ticker}
                  </div>
                  <div style={{ gridColumn: 'span 3', textAlign: 'right', color: C.text }}>{fmtPE(p.pe)}</div>
                  <div style={{ gridColumn: 'span 2', textAlign: 'right', color: C.text }}>{p.pb.toFixed(1)}</div>
                  <div style={{ gridColumn: 'span 2', textAlign: 'right', fontWeight: 700, color: p.fScore >= 8 ? C.emerald : p.fScore >= 5 ? C.text : C.red }}>
                    {p.fScore}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 9, marginTop: 4, color: C.muted }}>
            ★ = 현재 종목. 시안에서 피어 풀은 4-5개로 제한, 실제는 업종 전체.
          </div>
        </div>
      </div>
    );
  }

  function DetailPanel({ stock, accent }) {
    const selfModels = generateModels(stock);
    const allModels = selfModels.slice();
    const indModel = getIndustryModel(stock);
    if (indModel) allModels.push(indModel);

    return (
      <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 12, borderRadius: 6, background: 'rgba(0,0,0,.25)', border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: accent, letterSpacing: '0.04em' }}>
            📊 적정가 분석
          </div>
          <button onClick={(e) => { e.stopPropagation(); setSelectedKey(null); }}
            style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted }}>
            <IconX size={12} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 10, color: C.emerald, fontWeight: 700, letterSpacing: '0.04em' }}>
            ━━ 자기 5년 평균 기준
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {selfModels.map((m, i) => (
              <ValuationBar key={i} name={m.name} pct={m.pct} source={m.source} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: C.muted, ...mono, paddingLeft: 96, paddingRight: 50 }}>
            <span>-{SCALE}%</span>
            <span style={{ color: C.textDim }}>현재가 0%</span>
            <span>+{SCALE}%</span>
          </div>
        </div>

        <ValuationSummary models={allModels} />

        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
          <IndustrySection stock={stock} />
        </div>

        <div style={{ fontSize: 9, lineHeight: 1.6, paddingTop: 4, color: C.muted }}>
          ※ 자기 평균 = 5년 평균 multiple × 펀더멘털. 업종 = 동종업계 평균 PER 적용.
          <span style={{ color: stock.agreement === 'low' ? C.red : C.muted }}>
            {' '}{stock.agreement === 'low' && '모델 일치도 낮음 → 평가 신뢰도 주의.'}
            {stock.agreement === 'mid' && '모델 일치도 중간.'}
            {stock.agreement === 'high' && '3개 모델 결과 비슷 → 평가 신뢰 가능.'}
          </span>
        </div>
      </div>
    );
  }

  function TickerRow({ stock, accentColor, signalType, cardId }) {
    const fairValuePositive = stock.fairValuePct > 0;
    const epsPositive = stock.epsSurprise > 0;
    const rowKey = `${cardId}:${stock.ticker}`;
    const isSelected = selectedKey === rowKey;
    const signalValue = signalType === 'rsi' ? stock.rsi : signalType === 'box' ? stock.boxRange : null;

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
                <span>P/B <span style={{ color: C.text }}>{stock.pb.toFixed(1)}</span></span>
                <span>ROE <span style={{ color: stock.roe > 0 ? C.emerald : C.red }}>{fmtROE(stock.roe)}</span></span>
                <span style={{ marginLeft: 'auto', color: C.muted }}>MF #{stock.mfRank}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, fontVariantNumeric: 'tabular-nums', paddingTop: 4, borderTop: `1px solid ${C.border}`, ...mono }}>
                <span style={{ color: C.muted }}>
                  적정가 <span style={{ color: fairValuePositive ? C.emerald : C.red, fontWeight: 700 }}>{fmtPct(stock.fairValuePct)}</span>
                </span>
                <AgreementDots level={stock.agreement} />
                <span style={{ marginLeft: 'auto', color: C.muted }}>
                  EPS <span style={{ color: epsPositive ? C.emerald : C.red, fontWeight: 600 }}>{fmtPct(stock.epsSurprise)}</span>
                </span>
              </div>
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

  function ExpandableCard({ id, accent, glow, icon, title, subtitle, count, stocks, signalType }) {
    const isOpen = expanded[id];
    const filtered = filterStocks(stocks);
    return (
      <div style={{
        borderRadius: 8, overflow: 'hidden',
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderLeft: `4px solid ${accent}`,
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
                  {count === 0
                    ? `${marketFilter === 'kr' ? '한국' : '미국'} 시장에 해당 종목 없음`
                    : subtitle}
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
            {filtered.length > 0 ? (
              <>
                {filtered.map((s, i) => (
                  <TickerRow key={s.ticker + i} stock={s} accentColor={accent} signalType={signalType} cardId={id} />
                ))}
                {filtered.length < count && (
                  <div style={{ textAlign: 'center', fontSize: 11, padding: '8px 0', color: C.muted }}>
                    + {count - filtered.length}개 더
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', fontSize: 11, padding: 12, color: C.muted }}>
                필터된 종목 없음
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

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: 420, margin: '0 auto', paddingBottom: 48 }}>
        {/* 헤더 */}
        <div style={{
          padding: '16px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, zIndex: 10, backdropFilter: 'blur(8px)',
          background: 'rgba(10, 14, 26, 0.85)', borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <button onClick={() => { window.location.href = '/'; }}
              style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, flexShrink: 0, cursor: 'pointer',
                background: 'rgba(59, 130, 246, .12)', color: '#60A5FA',
                border: '1px solid rgba(59, 130, 246, .25)' }}
              title="알파 터미널로 이동">
              α
            </button>
            <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, flexShrink: 0,
              background: `linear-gradient(135deg, ${C.gold}, ${C.goldDim})`, color: '#1a1a1a' }}>
              β
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text }}>
                Beta Terminal
              </div>
              <div style={{ fontSize: 10, color: C.textDim }}>가치 평가 · v0.1 시안</div>
            </div>
          </div>
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600, flexShrink: 0,
            background: 'rgba(245,158,11,.15)', color: C.gold, border: '1px solid rgba(245,158,11,.3)' }}>
            MOCK
          </span>
        </div>

        {/* 페이지 헤더 */}
        <div style={{ padding: '20px 16px 8px' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, color: C.text, margin: '0 0 4px' }}>
            🌟 가치 발굴
          </h1>
          <div style={{ fontSize: 11, marginBottom: 12, color: C.textDim }}>
            종목 누르면 · 자기 평균 + 업종 평균 + 업종 내 위치 + 피어 비교
          </div>
          <MarketFilterToggle />
        </div>

        {/* F-Score 분포 */}
        <div style={{ padding: '0 16px', marginTop: 16 }}>
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
            {distribution.map(d => (
              <div key={d.score} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 36, fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: d.color, ...mono }}>
                  {d.score}점
                </div>
                <div style={{ flex: 1, height: 8, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,.04)' }}>
                  <div style={{ height: '100%', borderRadius: 999, width: `${d.pct}%`, background: d.color, transition: 'width 600ms ease' }} />
                </div>
                <div style={{ width: 40, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: C.text, ...mono }}>
                  {d.count}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 카드 5개 */}
        <div style={{ padding: '0 16px', marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <ExpandableCard id="top"      accent={C.gold}    glow={C.goldGlow}    icon="💎" title="최고점 (F-Score 9)" subtitle="9개 지표 모두 통과"          count={cardCounts.top[marketFilter]}      stocks={topPicks} />
          <ExpandableCard id="value"    accent={C.emerald} glow={C.emeraldGlow} icon="🔍" title="저평가 우량주"       subtitle="F-Score 7+ AND 적정가 +20%" count={cardCounts.value[marketFilter]}    stocks={valuePicks} />
          <ExpandableCard id="oversold" accent={C.cyan}    glow={C.cyanGlow}    icon="📉" title="과매도 우량주"       subtitle="F-Score 7+ AND RSI < 35"   count={cardCounts.oversold[marketFilter]} stocks={oversoldPicks} signalType="rsi" />
          <ExpandableCard id="box"      accent={C.violet}  glow={C.violetGlow}  icon="📦" title="박스권 우량주"       subtitle="F-Score 7+ AND 변동성 낮음"  count={cardCounts.box[marketFilter]}      stocks={boxPicks}      signalType="box" />
          <ExpandableCard id="risk"     accent={C.red}     glow={C.redGlow}     icon="⚠️" title="위험 종목"           subtitle="F-Score 0-3 — 매수 주의"     count={cardCounts.risk[marketFilter]}     stocks={riskPicks} />
        </div>

        {/* 푸터 */}
        <div style={{ margin: '20px 16px 0', padding: 12, borderRadius: 6, fontSize: 11, lineHeight: 1.6,
          background: 'rgba(245,158,11,.06)', color: C.textDim, border: `1px solid rgba(245,158,11,.15)` }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: C.gold }}>
            ⚠️ MOCK 시안 — 가짜 데이터
          </div>
          실제 데이터 연결은 다음 단계 (PR #3 fetch_yahoo.py 확장 + PR #4 F-Score 계산).
          종목 누르면 적정가 디테일 펼침. <span style={{ color: '#60A5FA' }}>α 버튼/화살표</span>는 알파 점프.
        </div>
      </div>
    </div>
  );
}
