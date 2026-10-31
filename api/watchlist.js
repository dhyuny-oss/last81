// api/watchlist.js
// 관심종목 추가/삭제 API (GitHub API로 watchlist.json 업데이트)

const REPO  = "dhyuny-oss/last81";
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";  // 두 이름 모두 허용
const PATH  = "public/data/watchlist.json";
const GH_API = `https://api.github.com/repos/${REPO}/contents/${PATH}`;

async function getFile() {
  const r = await fetch(GH_API, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
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
      Authorization: `Bearer ${TOKEN}`,
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
      res.setHeader("Cache-Control", "no-store");
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
      // ★ 228. 기기 간 덮어쓰기 막기 (2026-10-31 사고: 옛 기록이 남은 PC 가 열리자마자 폰의 보유 VEEV·WAT 를 9월 기록으로 덮어씀)
      //   앱은 마지막으로 본 서버 저장 시각(base)을 같이 보냅니다. 서버가 그보다 새로우면(다른 기기가 먼저 바꿈) 받지 않고 409 —
      //   앱이 서버 것을 받아 맞추거나, 사용자가 고르게 합니다. base 가 없는 예전 앱은 새로 고침을 안내합니다.
      //   (깃허브 읽기가 몇 초 늦을 수 있어 '같다'가 아니라 '서버가 더 새롭다'일 때만 막습니다)
      if (content.updatedAt && !req.body.force) {
        const base = String(req.body.base || "");
        if (!base) return res.status(409).json({ ok: false, error: "old_app", message: "앱이 예전 버전입니다 — 화면을 새로 고침(당겨서 새로 고침)해 주세요" });
        if (Date.parse(content.updatedAt) > Date.parse(base))
          return res.status(409).json({ ok: false, error: "stale", updatedAt: content.updatedAt, message: "다른 기기에서 먼저 바뀐 기록이 있습니다" });
      }
      // ★ 회차(tr) 를 그대로 보존합니다 — 예전엔 avg 만 받아서 앱의 새 형식이 '평단 0' 으로 저장됐고,
      //   텔레그램·장중 감시가 2회차 조건과 손익을 계산하지 못했습니다 (2026-09-22 수정)
      const num = (x) => { const v = Number(x); return Number.isFinite(v) && v > 0 ? v : 0; };
      // ★ 빈 기기 덮어쓰기 방지 (2026-09-25 사고: 기록이 빈 브라우저가 보유 6·관심 11을 지움)
      //   서버에 보유·관심이 있는데 둘 다 빈 목록이 오면, 앱이 force 를 붙인 경우(사용자가 확인)만 받습니다.
      const hadAny = (content.positions || []).length + (content.watch || []).length > 0;
      if (hadAny && positions.length === 0 && watch.length === 0 && !req.body.force) {
        return res.status(409).json({ ok: false, error: "empty_overwrite",
          message: `서버에 보유 ${(content.positions || []).length} · 관심 ${(content.watch || []).length}이 있어 빈 목록으로 덮어쓰지 않았습니다` });
      }
      if (hadAny) content.backup = { at: new Date().toISOString(), positions: content.positions, watch: content.watch, notes: content.notes };   // 직전 값 1개 보관
      content.positions = positions.map(p => {
        const tr = Array.isArray(p.tr) ? p.tr.slice(0, 10).map(t => ({
          d: String(t.d || "").slice(0, 10), px: num(t.px), amt: num(t.amt) })).filter(t => t.px > 0) : [];
        const avg = num(p.avg) || (tr.length ? (() => { const a = tr.reduce((x, t) => x + t.amt, 0), sh = tr.reduce((x, t) => x + (t.amt || 0) / t.px, 0); return sh > 0 ? a / sh : tr[0].px; })() : 0);
        return { t: String(p.t || "").slice(0, 12).toUpperCase(), avg: Math.round(avg * 10000) / 10000, tr,
                 role: ["swing", "long", "etf"].includes(p.role) ? p.role : "swing",
                 date: String(p.date || (tr[0] && tr[0].d) || "").slice(0, 10),
                 // 204. 단기↔장기 바꾼 기록 — 3주 점검이 '매도! 상태에서 장기로 바꿈'을 따로 셉니다
                 ...(Array.isArray(p.conv) && p.conv.length ? { conv: p.conv.slice(-5).map(c => ({ d: String(c.d || "").slice(0, 10), to: c.to === "long" ? "long" : "swing", sell: !!c.sell })) } : {}) };
      }).filter(p => p.t);
      content.watch = watch.map(t => String(t).slice(0, 12)).filter(Boolean);
      if (req.body.settings && typeof req.body.settings === "object") {   // 61. 앱 설정 — 오늘 후보·텔레그램이 같은 값을 쓰도록
        const st = req.body.settings, num = (x, lo, hi, d) => { const v = Number(x); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
        content.settings = { revMin: num(st.revMin, 0, 100, 10), slotsUs: Math.round(num(st.slotsUs, 1, 20, 7)), slotsKr: Math.round(num(st.slotsKr, 1, 20, 5)),
                             dcAmt: num(st.dcAmt, 0, 1e13, 0), dcMode: (st.dcMode === "hold" || st.dcMode === "dual") ? "hold" : "st", dcSemi: !!st.dcSemi,
                             // 98. 직투 금액 — 칸당·1회차 금액을 파이프라인(today.json)·텔레그램·AI 도구가 같은 값으로 씀. 안 보내면 이전 값 유지
                             usAmt: st.usAmt != null ? num(st.usAmt, 0, 1e9, 0) : (content.settings?.usAmt ?? null),
                             krAmt: st.krAmt != null ? num(st.krAmt, 0, 1e13, 0) : (content.settings?.krAmt ?? null) };
      }
      if (req.body.notes && typeof req.body.notes === "object") {   // 74. 종목 메모·내 목표가
        const out = {};
        for (const [t, v] of Object.entries(req.body.notes).slice(0, 300)) {
          if (!v || typeof v !== "object") continue;
          const tg = Number(v.tg); const m = String(v.m || "").slice(0, 500);
          if (!m && !(tg > 0)) continue;
          out[String(t).slice(0, 12).toUpperCase()] = { m, ...(tg > 0 ? { tg } : {}) };
        }
        content.notes = out;
      }
      if (Array.isArray(req.body.excludes))          // 종목풀에서 뺄 종목 (순위에 들어도 수집 안 함)
        content.excludes = req.body.excludes.map(t => String(t).slice(0, 12).toUpperCase()).filter(Boolean).slice(0, 200);
      if (Array.isArray(req.body.extras))            // 급히 넣는 종목 (다음 수집 때 종목풀에 포함)
        content.extras = req.body.extras.map(t => String(t).slice(0, 12).toUpperCase()).filter(Boolean).slice(0, 50);
      if (req.body.broker && typeof req.body.broker === "object") {   // 234. 메리츠 잔고 요약 — 텔레그램·오늘 후보가 '메리츠에 없는 기록'을 빼고 봄
        const b = req.body.broker, rows = (a) => (Array.isArray(a) ? a : []).slice(0, 100).map(x => [String((x || [])[0] || "").slice(0, 12).toUpperCase(), Math.max(0, Number((x || [])[1]) || 0)]).filter(x => x[0]);
        content.broker = { d: String(b.d || "").slice(0, 10), ...(b.us ? { us: rows(b.us) } : {}), ...(b.kr ? { kr: rows(b.kr) } : {}) };
      }
      if (Array.isArray(req.body.trades))            // 매매 기록 백업 (기기 분실 대비)
        content.trades = req.body.trades.slice(-300);
      content.updatedAt = new Date().toISOString();
      const ok = await saveFile(content, sha);
      return res.status(ok ? 200 : 500).json({
        ok, updatedAt: ok ? content.updatedAt : undefined, message: ok ? `보유 ${content.positions.length} · 관심 ${content.watch.length} 저장됨` : "저장 실패 — 잠시 뒤 다시 보냅니다" });
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
