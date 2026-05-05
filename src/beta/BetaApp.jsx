/**
 * Beta Terminal v0.1 — 가치 평가 쌍둥이 앱
 *
 * 알파 터미널 (단기 매매 React 앱)과 함께 같은 GitHub 레포에서 동작.
 * - URL: /beta
 * - 진입점: beta.html → src/beta-main.jsx → BetaApp.jsx → DiscoveryTab.jsx
 * - 데이터: public/data/stocks.json (알파와 공유)
 *
 * v0.1 (PR #2): 발굴탭 시안 (MOCK 데이터)
 * 다음: PR #3 (fetch_yahoo.py 확장) → PR #4 (F-Score 계산 + 진짜 데이터)
 */

import DiscoveryTab from './tabs/DiscoveryTab.jsx';

export default function BetaApp() {
  return <DiscoveryTab />;
}
