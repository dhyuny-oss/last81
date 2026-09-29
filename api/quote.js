/**
 * /api/quote — 105. 지금 가격 (표시 전용 · 매수!·매도! 판정에는 쓰지 않음)
 *
 *   GET /api/quote?s=AAPL,META,005930.KS
 *   → { ok, at, q: { "AAPL": { p: 지금 가격, pc: 전날 종가, t: 마지막 체결 시각(초) } } }
 *
 * 야후 공개 시세(spark)를 한 번에 20종목씩 묶어 받습니다. 🇺🇸 은 거의 실시간, 🇰🇷 은 보통 약 20분 늦습니다.
 * 같은 요청은 30초 동안 Vercel 캐시로 돌려줘 야후를 두드리지 않습니다. 토큰·키 필요 없음.
 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const OK = /^[\^A-Za-z0-9.\-=]{1,15}$/;

async function spark(syms) {
  for (const host of ["query2", "query1"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(syms.join(","))}&range=1d&interval=5m`,
                            { headers: { "User-Agent": UA } });
      if (!r.ok) continue;
      const j = await r.json();
      if (j && !j.spark) return j;
    } catch { /* 다음 호스트로 */ }
  }
  return {};
}

export default async function handler(req, res) {
  const syms = [...new Set(String(req.query?.s || "").split(",").map(x => x.trim()).filter(x => OK.test(x)))].slice(0, 80);
  if (!syms.length) return res.status(400).json({ ok: false, msg: "s=티커,티커 가 필요합니다" });
  const chunks = [];
  for (let i = 0; i < syms.length; i += 20) chunks.push(syms.slice(i, i + 20));
  const parts = await Promise.all(chunks.map(spark));
  const q = {};
  for (const part of parts) {
    for (const [sym, v] of Object.entries(part || {})) {
      const cl = v?.close || [], ts = v?.timestamp || [];
      let i = cl.length - 1;
      while (i >= 0 && (cl[i] == null)) i--;
      if (i < 0) continue;
      q[sym] = { p: Math.round(cl[i] * 10000) / 10000, pc: v.chartPreviousClose ?? v.previousClose ?? null, t: ts[i] ?? null };
    }
  }
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=30");
  return res.status(200).json({ ok: true, at: Math.floor(Date.now() / 1000), q });
}
