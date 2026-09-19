// api/watchlist.js
// 관심종목 추가/삭제 API (GitHub API로 watchlist.json 업데이트)

const REPO  = "dhyuny-oss/last81";
const PATH  = "public/data/watchlist.json";
const GH_API = `https://api.github.com/repos/${REPO}/contents/${PATH}`;

async function getFile() {
  const r = await fetch(GH_API, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
    }
  });
  if (r.status === 404) return { content: { stocks: {} }, sha: null };
  const data = await r.json();
  const content = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8"));
  return { content, sha: data.sha };
}

async function saveFile(content, sha) {
  const body = {
    message: `📋 관심종목 업데이트 ${new Date().toLocaleString("ko-KR")}`,
    content: Buffer.from(JSON.stringify(content, null, 2)).toString("base64"),
  };
  if (sha) body.sha = sha;
  const r = await fetch(GH_API, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return r.ok;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ★ 쓰기는 암호가 있어야 합니다. 이 주소는 공개돼 있어서, 막지 않으면
  //   누구나 내 보유·관심 목록을 덮어쓸 수 있습니다. 읽기(GET)는 그대로 열어 둡니다.
  const KEY = process.env.REFRESH_KEY || "";
  if (req.method !== "GET" && KEY && (req.headers["x-key"] || "") !== KEY) {
    return res.status(401).json({ ok: false, error: "암호가 필요합니다 (x-key)" });
  }

  try {
    // GET - 관심종목 목록 조회
    if (req.method === "GET") {
      const { content } = await getFile();
      return res.status(200).json(content);
    }

    // POST (bulk) - 앱의 보유/관심을 통째로 저장 → 텔레그램 알림이 이 목록을 봅니다
    if (req.method === "POST" && req.body && req.body.bulk) {
      const { positions = [], watch = [] } = req.body;
      if (!Array.isArray(positions) || !Array.isArray(watch))
        return res.status(400).json({ error: "positions/watch 배열 필요" });
      if (positions.length > 100 || watch.length > 200)
        return res.status(400).json({ error: "목록이 너무 깁니다" });
      const { content, sha } = await getFile();
      content.positions = positions.map(p => ({
        t: String(p.t || "").slice(0, 12), avg: Number(p.avg) || 0,
        role: ["swing", "long", "etf"].includes(p.role) ? p.role : "swing",
        date: String(p.date || "").slice(0, 10),
      })).filter(p => p.t);
      content.watch = watch.map(t => String(t).slice(0, 12)).filter(Boolean);
      content.updatedAt = new Date().toISOString();
      const ok = await saveFile(content, sha);
      return res.status(ok ? 200 : 500).json({
        ok, message: ok ? `보유 ${content.positions.length} · 관심 ${content.watch.length} 저장됨` : "저장 실패" });
    }

    // POST - 관심종목 추가
    if (req.method === "POST") {
      const { ticker, label, sector, market, suffix } = req.body;
      if (!ticker) return res.status(400).json({ error: "ticker 필요" });
      const { content, sha } = await getFile();
      if (!content.stocks) content.stocks = {};
      content.stocks[ticker] = { label, sector, market, ...(suffix ? { suffix } : {}), addedAt: new Date().toISOString() };
      content.updatedAt = new Date().toISOString();
      const ok = await saveFile(content, sha);
      return res.status(ok ? 200 : 500).json({ ok, message: ok ? `${label} 추가됨 (다음 수집 시 반영)` : "저장 실패" });
    }

    // DELETE - 관심종목 삭제
    if (req.method === "DELETE") {
      const { ticker } = req.body;
      if (!ticker) return res.status(400).json({ error: "ticker 필요" });
      const { content, sha } = await getFile();
      if (content.stocks?.[ticker]) {
        delete content.stocks[ticker];
        content.updatedAt = new Date().toISOString();
        const ok = await saveFile(content, sha);
        return res.status(ok ? 200 : 500).json({ ok, message: ok ? `${ticker} 삭제됨` : "저장 실패" });
      }
      return res.status(404).json({ error: "종목 없음" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
