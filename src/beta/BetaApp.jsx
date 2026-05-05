/**
 * Beta Terminal v0.0 — 가치 평가 쌍둥이 앱
 *
 * 알파 터미널 (단기 매매 React 앱)과 함께 같은 GitHub 레포에서 동작.
 * - URL: /beta
 * - 진입점: beta.html → src/beta-main.jsx → BetaApp.jsx
 * - 데이터: public/data/stocks.json (알파와 공유)
 *
 * 현재 상태: 인프라 검증용 placeholder
 * 다음 단계: src/beta/tabs/DiscoveryTab.jsx 추가 (PR #2)
 */

export default function BetaApp() {
  const C = {
    bg: '#0A0E1A',
    text: '#E5E7EB',
    textDim: '#9CA3AF',
    gold: '#F59E0B',
    goldDim: '#92400E',
    blue: '#60A5FA',
    border: 'rgba(255,255,255,.08)',
  };

  const goAlpha = () => { window.location.href = '/'; };

  return (
    <div
      style={{
        background: C.bg,
        minHeight: '100vh',
        color: C.text,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: `linear-gradient(135deg, ${C.gold}, ${C.goldDim})`,
          color: '#1a1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 36,
          fontWeight: 800,
          marginBottom: 20,
          boxShadow: '0 4px 16px rgba(245, 158, 11, .25)',
        }}
      >
        β
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
        Beta Terminal
      </h1>
      <div style={{ fontSize: 13, color: C.textDim, marginBottom: 4 }}>
        가치 평가 · v0.0
      </div>
      <div
        style={{
          fontSize: 11,
          color: C.gold,
          background: 'rgba(245, 158, 11, .1)',
          border: '1px solid rgba(245, 158, 11, .25)',
          padding: '4px 10px',
          borderRadius: 6,
          marginTop: 8,
          marginBottom: 28,
          fontWeight: 600,
          letterSpacing: '0.04em',
        }}
      >
        🚧 인프라 검증 중 — 발굴탭 곧 추가
      </div>

      <div
        style={{
          maxWidth: 360,
          fontSize: 12,
          color: C.textDim,
          lineHeight: 1.7,
          padding: 16,
          background: 'rgba(255,255,255,.02)',
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          marginBottom: 24,
        }}
      >
        F-Score · Magic Formula · 적정가 모델 (PER · PBR · EV/EBITDA) 기반
        가치 발굴기. 알파 터미널 (단기 매매)과 같은 데이터 풀 공유.
      </div>

      <button
        onClick={goAlpha}
        style={{
          background: 'rgba(59, 130, 246, .12)',
          color: C.blue,
          border: '1px solid rgba(59, 130, 246, .3)',
          padding: '10px 20px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        ← α 알파 터미널로
      </button>

      <div style={{ position: 'fixed', bottom: 16, fontSize: 10, color: C.textDim }}>
        URL <span style={{ fontFamily: 'monospace', color: C.text }}>/beta</span> · 빌드 OK이면 인프라 검증 완료
      </div>
    </div>
  );
}
