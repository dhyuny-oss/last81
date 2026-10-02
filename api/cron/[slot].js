/**
 * /api/cron/us-1 · us-2 · kr-1 · kr-2 — 108. Vercel 자체 예약이 부르는 정시 갱신
 *
 * 왜: 깃허브 예약(schedule)은 7~8시간씩 늦게 도는 날이 많았습니다(2026-09-28~10-02 연속).
 *     Vercel 예약은 무료 요금제에서 '그 시간 안 어딘가'(최대 59분 늦음)에 돕니다. vercel.json 의 crons 참고.
 *     여기서는 깃허브 워크플로를 mode=daily 로 시작만 시킵니다 — 약 5분 · 종목풀 교체 없음 · 이미 최신이면 워크플로가 몇 초 만에 끝냄.
 *
 * 시각(UTC → 한국):  us-1 21시대 → 06시대(화~토) · us-2 22시대 → 07시대(보험)
 *                    kr-1 07시대 → 16시대(월~금) · kr-2 08시대 → 17시대(보험)
 *
 * 보호: Vercel 예약(User-Agent vercel-cron) 또는 CRON_SECRET 이 맞는 요청만 받습니다.
 *       이미 돌고 있거나 20분 안에 평일 갱신을 시작했으면 다시 시작하지 않습니다.
 */
const REPO = process.env.GH_REPO || "dhyuny-oss/last81";
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
const WF = process.env.GH_WORKFLOW || "daily.yml";
const API = "https://api.github.com";
const gh = (path, init = {}) => fetch(`${API}${path}`, {
  ...init,
  headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${TOKEN}`, "X-GitHub-Api-Version": "2022-11-28",
             "User-Agent": "alpha-terminal", ...(init.body ? { "Content-Type": "application/json" } : {}) },
});

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const ua = String(req.headers["user-agent"] || "");
  const secret = process.env.CRON_SECRET || "";
  const okAuth = secret ? req.headers.authorization === `Bearer ${secret}` : ua.startsWith("vercel-cron");
  if (!okAuth) return res.status(401).json({ ok: false, msg: "예약 실행 전용 주소입니다." });
  if (!TOKEN) return res.status(500).json({ ok: false, msg: "GH_TOKEN 이 없습니다." });
  try {
    const cur = await gh(`/repos/${REPO}/actions/workflows/${WF}/runs?per_page=20`);
    if (cur.ok) {
      const all = (await cur.json()).workflow_runs || [];
      if (all.some(x => x.status === "queued" || x.status === "in_progress"))
        return res.status(200).json({ ok: true, skipped: "이미 돌고 있음" });
      const last = all.filter(x => x.event === "workflow_dispatch" && /\((daily|quick)\)/.test(x.display_title || x.name || ""))
                      .map(x => new Date(x.run_started_at || x.created_at).getTime());
      if (last.length && Date.now() - Math.max(...last) < 20 * 60000)
        return res.status(200).json({ ok: true, skipped: "20분 안에 갱신함" });
    }
    const r = await gh(`/repos/${REPO}/actions/workflows/${WF}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main", inputs: { mode: "daily" } }) });
    if (r.status !== 204) return res.status(502).json({ ok: false, msg: `깃허브 응답 ${r.status}`, detail: (await r.text()).slice(0, 200) });
    return res.status(200).json({ ok: true, started: true, slot: req.query?.slot || null });
  } catch (e) {
    return res.status(502).json({ ok: false, msg: "깃허브 연결 실패", detail: String(e).slice(0, 200) });
  }
}
