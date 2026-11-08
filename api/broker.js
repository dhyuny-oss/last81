/**
 * /api/broker — 계좌 연결 단일 창구 (잔고 · 주문내역 · 주문 · 취소 · 지금 가격)
 * ════════════════════════════════════════════════════════════
 * 화면(src/Kis.jsx)은 이 주소만 부릅니다. 어느 증권사로 보낼지는 Vercel 환경변수 BROKER 하나로 정합니다.
 *
 *   BROKER=meritz   메리츠 (기본값 — 비워 두면 메리츠)      → api/_lib/meritz.js
 *   (267. 한투 어댑터 api/_lib/kis.js 는 안 써서 지웠습니다 — 필요하면 깃 기록 2026-11-08 이전에서 되살림)
 *
 * ▣ 증권사 바꾸는 법
 *   1) Vercel → Settings → Environment Variables 에서 BROKER 값만 바꿈
 *   2) 그 증권사 키가 들어 있는지 확인 (메리츠: MERITZ_* — 파일 맨 위 설명)
 *   3) 다시 배포 → 앱을 새로고침하면 카드 이름·주문 경로가 바뀝니다
 *   새 증권사를 붙일 때는 api/_lib/<이름>.js 를 같은 약속(what = balance·orders·order·cancel·quote)으로 만들고 아래 표에 한 줄 추가합니다.
 *
 * ▣ 공통 비밀번호: APP_PIN (예전 이름 KIS_PIN 도 그대로 읽음)
 * ※ 시세·거래대금 수집(GitHub Actions)은 이 파일과 무관합니다 — 증권사를 바꿔도 데이터 수집은 그대로입니다.
 */
import meritz from "./_lib/meritz.js";
import { cfg as mzCfg, INT as MZ } from "./_lib/meritz.js";
import { listResv, addResv, cancelResv, runResv } from "./_lib/resv.js";

const BROKERS = {
  meritz: { label: "메리츠", run: meritz },
};

export default async function handler(req, res) {
  const id = String(process.env.BROKER || "meritz").trim().toLowerCase();
  const b = BROKERS[id];
  if (!b) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: false, configured: false, code: "setup", msg: `BROKER=${id} 는 모르는 증권사입니다 — ${Object.keys(BROKERS).join(" · ")} 중 하나로 넣어 주세요` });
  }
  // 응답마다 어느 증권사인지 붙여 줌 (화면 이름표 · 내 종목 '체결 반영' 출처 표시에 씀)
  const json = res.json.bind(res);
  res.json = (obj) => json(obj && typeof obj === "object" ? { broker: id, label: b.label, ...obj } : obj);
  // 249. 매수 예약 (메리츠만) — 목록 · 넣기 · 취소 · 지금 확인. 증권사 토큰 없이 깃허브 파일만 다룸(확인만 계좌를 봄)
  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  if (req.method === "POST" && /^resvBuy/.test(String(body.what || ""))) {
    res.setHeader("Cache-Control", "no-store");
    if (id !== "meritz") return res.status(200).json({ ok: false, msg: "매수 예약은 메리츠 연결에서만 됩니다" });
    const c = mzCfg();
    if (!c.pin || !MZ.pinOk(c, req.headers["x-kis-pin"])) { await MZ.sleep(700); return res.status(200).json({ ok: false, code: "pin", msg: "비밀번호가 맞지 않습니다" }); }
    try {
      const out = body.what === "resvBuyList" ? await listResv()
        : body.what === "resvBuyAdd" ? await addResv(body)
        : body.what === "resvBuyCancel" ? await cancelResv(String(body.id || ""))
        : body.what === "resvBuyRun" ? await runResv({ only: body.mk === "kr" ? "kr" : body.mk === "us" ? "us" : null })
        : null;
      if (!out) return res.status(400).json({ ok: false, msg: "what 은 resvBuyList · resvBuyAdd · resvBuyCancel · resvBuyRun 중 하나" });
      return res.status(200).json({ ok: true, ...out });
    } catch (e) {
      return res.status(200).json({ ok: false, code: e?.unsure ? "unsure" : "resv", msg: String(e?.message || e).slice(0, 300) });
    }
  }
  return b.run(req, res);
}
