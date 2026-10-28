/**
 * /api/info — 198. '이 회사는' 카드 (표시 전용 · 매수!·매도! 판정에는 쓰지 않음)
 *
 *   GET /api/info?t=CVX&m=us&n=Chevron
 *   GET /api/info?t=222800&m=kr&n=심텍
 *   → { ok, t, m, name, about, news: [{ title, src, date, link }], ir: { title, date } | null, at }
 *
 * 자료원 (토큰·키 필요 없음 · 모두 공개 페이지)
 *   🇺🇸 회사 소개  네이버 해외주식 (한글 기업 개요)
 *   🇰🇷 회사 소개  와이즈리포트 기업개요 (네이버 증권의 회사 정보 제공처)
 *   🇰🇷 일정       네이버 증권 종목 일정 (실적 발표·IR)
 *   뉴스           구글 뉴스 한국어 검색 (최근 3건)
 * ※ 네이버·와이즈리포트는 공식 공개 API 가 아닙니다. 막히면 그 칸만 비우고 앱은 링크로 대신합니다.
 * 같은 요청은 6시간 동안 Vercel 캐시로 돌려줍니다 (자료원을 자주 두드리지 않게).
 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const OK_US = /^[A-Z][A-Z0-9.\-]{0,9}$/, OK_KR = /^[0-9A-Z]{6}$/;

async function get(url, ms = 6000) {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" }, signal: ac.signal });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; } finally { clearTimeout(tm); }
}
const clean = (s) => String(s || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
/** 앞 두 문장만 (화면용) — 문장 끝: '다.' '임.' '음.' '. ' */
function firstSentences(s, n = 2, max = 220) {
  const t = clean(s); if (!t) return "";
  const parts = t.split(/(?<=(?:다|임|음|함|됨)\.)\s+|(?<=\.)\s+(?=[A-Z가-힣])/);
  let out = parts.slice(0, n).join(" ");
  if (out.length > max) out = out.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
  return out;
}

async function usAbout(t) {
  const codes = [t, `${t}.O`, `${t}.K`];
  for (const c of codes) {
    const txt = await get(`https://api.stock.naver.com/stock/${encodeURIComponent(c)}/overview`);
    if (!txt) continue;
    try {
      const j = JSON.parse(txt);
      if (j && (j.summary || j.companyName)) return { name: j.companyName || "", about: firstSentences(j.summary), industry: j.industry?.industryGroupKor || "" };
    } catch { /* 다음 코드로 */ }
  }
  return null;
}
async function krAbout(t) {
  const html = await get(`https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd=${t}`);
  if (!html) return null;
  const m = html.match(/class="cmp_comment"[^>]*>([\s\S]*?)<\/(?:td|div|p|ul)>/i) || html.match(/cmp_comment[\s\S]{0,40}?>([\s\S]{20,1200}?)</i);
  const about = m ? firstSentences(clean(m[1]).replace(/^동사는\s*/, ""), 2) : "";
  return about ? { about } : null;
}
async function krIr(t) {
  const txt = await get(`https://m.stock.naver.com/api/stock/${t}/integration`);
  if (!txt) return null;
  try {
    const ir = JSON.parse(txt)?.irScheduleInfo;
    return ir?.title && ir?.irScheduleDate ? { title: clean(ir.title), date: String(ir.irScheduleDate).slice(0, 10) } : null;
  } catch { return null; }
}
async function news(q) {
  const xml = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`);
  if (!xml) return [];
  const out = [];
  const cut = Date.now() - 21 * 86400000;           // 3주 안 기사만
  for (const it of xml.split("<item>").slice(1)) {
    const tag = (k) => { const m = it.match(new RegExp(`<${k}[^>]*>([\\s\\S]*?)</${k}>`)); return m ? clean(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")) : ""; };
    const title = tag("title"), link = tag("link"), src = tag("source"), when = Date.parse(tag("pubDate"));
    if (!title || !link || !(when > cut)) continue;
    if (/\|.*(가격|Chg%)|^\S+\|/.test(title) || /TradingKey/i.test(src)) continue;     // 시세 자동 글(제목이 'CVX|가격:…') 제외
    out.push({ title: src && title.endsWith(` - ${src}`) ? title.slice(0, -(src.length + 3)) : title, src, link, when,
               date: new Date(when + 9 * 3600000).toISOString().slice(0, 10) });
    if (out.length >= 8) break;
  }
  return out.sort((a, b) => b.when - a.when).slice(0, 3).map(({ when, ...x }) => x);      // 관련도 상위 8건 중 최근 3건
}

export default async function handler(req, res) {
  const m = String(req.query?.m || "").toLowerCase() === "kr" ? "kr" : "us";
  const t = String(req.query?.t || "").toUpperCase().trim();
  const n = String(req.query?.n || "").replace(/[<>"]/g, "").trim().slice(0, 40);
  if (!(m === "kr" ? OK_KR : OK_US).test(t)) return res.status(400).json({ ok: false, msg: "t=티커 가 필요합니다" });
  let name = n, about = "", industry = "", ir = null;
  if (m === "us") {
    const a = await usAbout(t);
    if (a) { about = a.about; industry = a.industry; if (a.name) name = a.name; }
  } else {
    const [a, i] = await Promise.all([krAbout(t), krIr(t)]);
    if (a) about = a.about; ir = i;
  }
  // 뉴스 검색어: 🇰🇷 종목명 · 🇺🇸 한글 회사명(네이버) → 없으면 영문명 + 주가
  const q = m === "kr" ? `"${name || t}"` : name && /[가-힣]/.test(name) ? `"${name}" 주가` : `${n || t} 주가`;
  let items = await news(q);
  if (!items.length && m === "us") items = await news(`${n || t} 주가`);          // 한글 회사명으로 안 나오면 영문명
  if (!items.length && m === "us") items = await news(`${t} stock`);
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");
  return res.status(200).json({ ok: true, t, m, name, about, industry, news: items, ir, at: Date.now() });
}
