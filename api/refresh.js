/**
 * /api/refresh — 휴대폰에서 데이터 갱신을 눌러 돌리기 위한 창구
 *
 * 왜 필요한가: 깃허브 Actions 의 "Run workflow" 버튼은 모바일 웹에서 누르기가 어렵습니다.
 *              그렇다고 앱에 깃허브 토큰을 넣으면 배포된 자바스크립트에 그대로 노출됩니다.
 *              그래서 토큰은 Vercel 환경변수(서버)에만 두고, 앱은 이 주소만 부릅니다.
 *
 * 필요한 환경변수 (Vercel → Settings → Environment Variables)
 *   GH_TOKEN      깃허브 세분화 토큰. 이 저장소에 Actions "Read and write" 권한만 주면 됩니다.
 *   REFRESH_KEY   내가 정하는 아무 암호. 앱에서 한 번 입력해 두면 기기에 저장됩니다.
 *                 ★ 이게 없으면 이 API 는 아예 동작하지 않습니다(공개 주소라 누구나 눌러
 *                   Actions 무료 한도를 태울 수 있기 때문입니다).
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
  if (!process.env.REFRESH_KEY) {
    return res.status(500).json({ ok: false, code: "NO_KEY",
      msg: "Vercel 환경변수 REFRESH_KEY 가 없습니다. 아무 암호나 정해 넣어 주세요(이게 없으면 누구나 눌러 무료 한도를 태울 수 있어 막아 둡니다)." });
  }

  /* ── 상태 조회 — 누구나 볼 수 있게 둡니다(실행은 못 함) ── */
  if (req.method === "GET") {
    try {
      const r = await gh(`/repos/${REPO}/actions/workflows/${WF}/runs?per_page=3`);
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
      return res.status(200).json({ ok: true, repo: REPO, workflow: WF, running: !!live, live, runs });
    } catch (e) {
      return res.status(502).json({ ok: false, code: "NET", msg: "깃허브에 연결하지 못했습니다.", detail: String(e).slice(0, 200) });
    }
  }

  /* ── 실행 — 암호가 맞아야 합니다 ── */
  if (req.method === "POST") {
    const key = req.headers["x-key"] || "";
    if (key !== process.env.REFRESH_KEY) {
      return res.status(401).json({ ok: false, code: "BAD_KEY", msg: "암호가 다릅니다. 앱에서 다시 입력해 주세요." });
    }
    try {
      // 이미 돌고 있으면 또 시작하지 않습니다 (무료 한도 낭비 방지)
      const cur = await gh(`/repos/${REPO}/actions/workflows/${WF}/runs?per_page=3`);
      if (cur.ok) {
        const j = await cur.json();
        const live = (j.workflow_runs || []).find(x => x.status === "queued" || x.status === "in_progress");
        if (live) {
          return res.status(200).json({ ok: true, already: true, msg: "이미 돌고 있습니다.",
            live: { id: live.id, status: live.status, started: live.run_started_at || live.created_at, url: live.html_url } });
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
