/**
 * /api/refresh — 휴대폰에서 데이터 갱신을 눌러 돌리기 위한 창구
 *
 * 왜 필요한가: 깃허브 Actions 의 "Run workflow" 버튼은 모바일 웹에서 누르기가 어렵습니다.
 *              그렇다고 앱에 깃허브 토큰을 넣으면 배포된 자바스크립트에 그대로 노출됩니다.
 *              그래서 토큰은 Vercel 환경변수(서버)에만 두고, 앱은 이 주소만 부릅니다.
 *
 * 필요한 환경변수 (Vercel → Settings → Environment Variables)
 *   GH_TOKEN      깃허브 세분화 토큰. 이 저장소에 Actions "Read and write" 권한만 주면 됩니다. (필수)
 *   REFRESH_KEY   (선택) 암호. 넣으면 이 암호를 아는 사람만 실행할 수 있습니다.
 *                 ★ 안 넣어도 됩니다. 대신 아래 '열린 모드' 제한이 자동으로 걸립니다 —
 *                   공개 주소라 누가 눌러 Actions 무료 한도를 태우는 것만 막으면 되기 때문입니다.
 *                     · 이미 돌고 있으면 시작하지 않음
 *                     · 마지막 수동 실행에서 30분이 안 지났으면 거절
 *                     · 최근 24시간에 수동 실행이 2번을 넘으면 거절
 *                   사람이 "지금 최신값 보고 싶다"고 누르는 데는 하루 2번이면 충분하고,
 *                   누가 장난쳐도 하루 2회(약 60분) 위로는 못 올라갑니다.
 *   GH_REPO       (선택) 기본값 dhyuny-oss/last81
 *   GH_WORKFLOW   (선택) 기본값 daily.yml
 *
 * 쓰는 법
 *   GET  /api/refresh   지금 돌고 있는지 · 마지막 실행이 언제 끝났는지
 *   POST /api/refresh   실행 시작 (헤더 x-key 에 REFRESH_KEY)
 */

const REPO = process.env.GH_REPO || "dhyuny-oss/last81";
const WF = process.env.GH_WORKFLOW || "daily.yml";
const API = "https://api.github.com";

const gh = (path, init = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "alpha-terminal",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!process.env.GH_TOKEN) {
    return res.status(500).json({ ok: false, code: "NO_TOKEN",
      msg: "Vercel 환경변수 GH_TOKEN 이 없습니다. Settings → Environment Variables 에서 추가하고 재배포해 주세요." });
  }
  const OPEN = !process.env.REFRESH_KEY;    // 암호를 안 넣으면 '열린 모드' + 자동 제한
  const MIN_GAP_MIN = 30;                   // 수동 실행 최소 간격
  const MAX_PER_DAY = 2;                    // 24시간 수동 실행 상한

  /* ── 상태 조회 — 누구나 볼 수 있게 둡니다(실행은 못 함) ── */
  if (req.method === "GET") {
    try {
      const r = await gh(`/repos/${REPO}/actions/workflows/${WF}/runs?per_page=30`);
      if (!r.ok) {
        const t = await r.text();
        return res.status(502).json({ ok: false, code: "GH_" + r.status,
          msg: r.status === 404
            ? `워크플로 ${WF} 를 찾지 못했습니다. .github/workflows/${WF} 가 있는지 확인해 주세요.`
            : `깃허브가 ${r.status} 를 돌려줬습니다. 토큰 권한(Actions 읽기/쓰기)을 확인해 주세요.`,
          detail: t.slice(0, 300) });
      }
      const j = await r.json();
      const runs = (j.workflow_runs || []).map(x => ({
        id: x.id, status: x.status, conclusion: x.conclusion,
        started: x.run_started_at || x.created_at, url: x.html_url, event: x.event,
      }));
      const live = runs.find(x => x.status === "queued" || x.status === "in_progress") || null;
      const manual = runs.filter(x => x.event === "workflow_dispatch");
      const lastManual = manual[0] || null;
      const sinceMin = lastManual ? Math.floor((Date.now() - new Date(lastManual.started).getTime()) / 60000) : null;
      return res.status(200).json({ ok: true, repo: REPO, workflow: WF, running: !!live, live, runs,
        needKey: !OPEN, open: OPEN,
        cooldownMin: (OPEN && sinceMin != null && sinceMin < MIN_GAP_MIN) ? MIN_GAP_MIN - sinceMin : 0 });
    } catch (e) {
      return res.status(502).json({ ok: false, code: "NET", msg: "깃허브에 연결하지 못했습니다.", detail: String(e).slice(0, 200) });
    }
  }

  /* ── 실행 — 암호가 맞아야 합니다 ── */
  if (req.method === "POST") {
    if (!OPEN) {
      const key = req.headers["x-key"] || "";
      if (key !== process.env.REFRESH_KEY) {
        return res.status(401).json({ ok: false, code: "BAD_KEY", msg: "암호가 다릅니다. 앱에서 다시 입력해 주세요." });
      }
    }
    try {
      // 이미 돌고 있으면 또 시작하지 않습니다 (무료 한도 낭비 방지)
      const cur = await gh(`/repos/${REPO}/actions/workflows/${WF}/runs?per_page=30`);
      if (cur.ok) {
        const j = await cur.json();
        const all = j.workflow_runs || [];
        const live = all.find(x => x.status === "queued" || x.status === "in_progress");
        if (live) {
          return res.status(200).json({ ok: true, already: true, msg: "이미 돌고 있습니다.",
            live: { id: live.id, status: live.status, started: live.run_started_at || live.created_at, url: live.html_url } });
        }
        if (OPEN) {
          const now = Date.now();
          const manual = all
            .filter(x => x.event === "workflow_dispatch")
            .map(x => new Date(x.run_started_at || x.created_at).getTime());
          const recent = manual.filter(t => now - t < 24 * 3600 * 1000);
          const gapMin = manual.length ? Math.floor((now - Math.max(...manual)) / 60000) : Infinity;
          if (gapMin < MIN_GAP_MIN) {
            return res.status(429).json({ ok: false, code: "COOLDOWN",
              msg: `방금 돌렸습니다. ${MIN_GAP_MIN - gapMin}분 뒤에 다시 눌러 주세요.`, waitMin: MIN_GAP_MIN - gapMin });
          }
          if (recent.length >= MAX_PER_DAY) {
            return res.status(429).json({ ok: false, code: "DAILY_CAP",
              msg: `오늘 수동 실행을 ${MAX_PER_DAY}번 다 썼습니다. 예약 실행(평일 16:00·06:30)은 그대로 돕니다.` });
          }
        }
      }
      const r = await gh(`/repos/${REPO}/actions/workflows/${WF}/dispatches`, {
        method: "POST", body: JSON.stringify({ ref: "main" }),
      });
      if (r.status !== 204) {
        const t = await r.text();
        return res.status(502).json({ ok: false, code: "GH_" + r.status,
          msg: r.status === 403 ? "토큰에 Actions 쓰기 권한이 없습니다."
             : r.status === 404 ? `워크플로 ${WF} 를 못 찾았거나 토큰이 이 저장소에 접근할 수 없습니다.`
             : `깃허브가 ${r.status} 를 돌려줬습니다.`,
          detail: t.slice(0, 300) });
      }
      return res.status(202).json({ ok: true, started: true, msg: "실행을 시작했습니다. 약 25분 걸립니다." });
    } catch (e) {
      return res.status(502).json({ ok: false, code: "NET", msg: "깃허브에 연결하지 못했습니다.", detail: String(e).slice(0, 200) });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, msg: "GET 또는 POST 만 됩니다." });
}
