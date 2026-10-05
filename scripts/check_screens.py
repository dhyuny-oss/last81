"""144. 화면끼리 같은 답을 내는지 확인 — 첫 화면 · 찾기 탭 · 한투 카드(칩·매수 제안)의 "오늘 살 것"이 같은가.
  준비: npm run build 뒤  npx vite preview --port 4228 --strictPort  를 띄워 두고
  실행: python3 scripts/check_screens.py        (playwright 필요 · 한투 서버는 부르지 않고 가짜 응답을 씁니다)
  보유는 서버 백업(watchlist.json)을 폰에 있는 것처럼 넣어 봅니다: 실제 보유 · 보유 없음 · 칸 꽉 참 · 투자금 0 · 일부 보유
"""
import asyncio, json, re, datetime, sys
from playwright.async_api import async_playwright
R=__import__("os").path.join(__import__("os").path.dirname(__file__),"..","public","data","")
wl=json.load(open(R+"watchlist.json")); td=json.load(open(R+"today.json"))
async def run(p,name,positions,plan):
    b=await p.chromium.launch(); ctx=await b.new_context(viewport={"width":390,"height":900})
    await ctx.clock.install(time=datetime.datetime(2026,10,6,15,0,tzinfo=datetime.timezone.utc))
    async def kis(route):
        rq=route.request
        if rq.method=="GET": return await route.fulfill(status=200,content_type="application/json",body=json.dumps({"ok":True,"configured":True,"env":"demo","pin":True,"pinMissing":False,"canOrder":True,"maxUsd":5000,"maxDay":20000,"hts":False}))
        bd=json.loads(rq.post_data); w_=bd["what"]; base={"ok":True,"env":"demo","at":1791298800000,"tok":"B"}
        if w_=="balance": base.update(rows=[],sum={"n":0,"cost":0,"val":0,"pl":0,"plPct":0})
        elif w_=="orders": base.update(orders=[],dayBuy=0)
        elif w_=="quote": base.update(quotes={q["t"]:{"ex":q["ex"] or "NASD","last":100,"base":100,"rate":0} for q in bd["list"]},idx={"QQQ":{"rate":0.1},"SPY":{"rate":0.1}})
        await route.fulfill(status=200,content_type="application/json",body=json.dumps(base))
    await ctx.route("**/api/**",lambda r:r.fulfill(status=200,content_type="application/json",body='{"ok":false}'))
    await ctx.route("**/api/kis",kis)
    await ctx.add_init_script("(()=>{const d=new Date(Date.now()+9*3600000);const dow=d.getUTCDay();const sat=new Date(d);sat.setUTCDate(d.getUTCDate()-((dow+1)%%7));localStorage.setItem('v7.rules.wk',sat.toISOString().slice(0,10));localStorage.setItem('v7.kis.pin','1234');localStorage.setItem('v4.pos',%s);localStorage.setItem('v11.plan',%s);localStorage.setItem('v9.revMin','10');})()"%(json.dumps(json.dumps(positions)),json.dumps(json.dumps(plan))))
    pg=await ctx.new_page(); errs=[]; pg.on("pageerror",lambda e: errs.append(str(e)))
    await pg.goto("http://localhost:4228/"); await pg.wait_for_timeout(3500)
    t=await pg.inner_text("body")
    home=re.search(r"오늘 살 것 (\d+)개 \(🇺🇸 (\d+) · 🇰🇷 (\d+)\)",t)
    await pg.locator("nav button",has_text="찾기").first.click(); await pg.wait_for_timeout(1500)
    t=await pg.inner_text("body"); i=t.find("오늘 살 것"); k=t.find("🇰🇷 한국",i); us=t[i:k if k>0 else i+3000]
    rows=re.findall(r"\n\d+\n([A-Z.]{1,6})[^\n]*\n[^\n]*\n(✓ 오늘 삼|대기 — 빈 칸 없음|[^\n]*)",us)
    buy=[r[0] for r in rows if "대기" not in r[1] and "오늘 삼" not in r[1]]
    head=re.search(r"(빈 칸 \d+ / \d+칸|칸이 다 참[^\n]*|투자금[^\n]*)",us)
    await pg.locator("nav button",has_text="내 종목").first.click(); await pg.wait_for_timeout(1500)
    await pg.get_by_role("button",name=re.compile("불러오기")).first.click(); await pg.wait_for_timeout(4000)
    t=await pg.inner_text("body"); j=t.find("오늘 살 것",t.find("🏦 한투 계좌")); e=t.find("매수",j)
    chips=re.findall(r"\b[A-Z]{1,5}\b",t[j+6:e]) if j>0 else []
    cards=[]
    for tk in set(chips+buy+[r["t"] for r in td["pickUs"]]):
        if await pg.get_by_role("button",name=f"{tk} 사기").count(): cards.append(tk)
    note=re.search(r"오늘 탭 기준[^\n]*",t)
    same= sorted(buy)==sorted(chips)==sorted(cards)
    print(f"{'✅' if same else '❌'} {name}: 첫 화면 {home.group(0) if home else '—'} | 찾기 탭 🇺🇸 [{head.group(1) if head else ''}] 살 것 {buy} | 한투 칩 {chips} · 제안 {sorted(cards)} | {note.group(0)[:40] if note else ''} | err {errs}")
    await b.close(); return same
async def main():
    st=wl["settings"]; plan={"slotsUs":st["slotsUs"],"slotsKr":st["slotsKr"],"dcAmt":st["dcAmt"],"usAmt":st["usAmt"],"krAmt":st["krAmt"],"cashAmt":0}
    P=[{**p,"id":1000+i} for i,p in enumerate(wl["positions"])]; ok=True
    async with async_playwright() as p:
        ok&=await run(p,"실제 보유 7 (서버 백업 그대로)",P,plan)
        ok&=await run(p,"보유 없음",[],plan)
        ok&=await run(p,"칸 꽉 참 (3칸)",P,{**plan,"slotsUs":3})
        ok&=await run(p,"미국 투자금 0",P[:2],{**plan,"usAmt":0})
        ok&=await run(p,"보유 3 · 5칸",P[:3],{**plan,"slotsUs":5})
    print("서버 today.json 🇺🇸:",[r["t"] for r in td["pickUs"]],td["slots"]["us"]); sys.exit(0 if ok else 1)
asyncio.run(main())
