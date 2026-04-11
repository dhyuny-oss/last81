/**
 * Vega v1.0 — App.jsx
 * 리디자인: 다크 네이비 / 만원단위 / AI분석 API경유 / 성적리셋 / quarterly모드
 */
import { useState, useEffect, useCallback } from "react";
import {
  ComposedChart, Area, Line, Bar, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

// ═══════════════════════════════════════════════════════════
// 1. 색상 & 상수
// ═══════════════════════════════════════════════════════════
const C = {
  bg:"#000", panel:"#09090f", panel2:"#0e0e18",
  border:"rgba(56,189,248,.18)", accent:"#38bdf8",
  green:"#22c55e", red:"#ef4444", yellow:"#facc15",
  emerald:"#10b981", purple:"#a78bfa",
  muted:"#64748b", text:"#f0f4f8", sub:"#94a3b8", ema:"#fb923c",
  glass:"rgba(255,255,255,.05)",
  card:"#09090f", nav:"#000",
};
const SIG = {
  BUY:  { bg:"rgba(16,185,129,.15)", color:"#4ade80", border:"#22c55e" },
  HOLD: { bg:"rgba(251,191,36,.1)",  color:"#fbbf24", border:"#f59e0b" },
  SELL: { bg:"rgba(239,68,68,.1)",   color:"#f87171", border:"#ef4444" },
};
const PERIOD_DAYS = { "1M":22, "3M":66, "6M":130, "1Y":252, "ALL":9999 };
const INITIAL = [];

const SEARCH_DB = {
  "GOOGL":{ label:"Google",  sector:"Technology",    market:"🇺🇸", price:175.8, target:210,   roe:29.4, per:22.1, rev:14.8, base:145,  vol:0.017, drift:0.0011, mktCap:2190, liquidity:3.2, revGrowth:15 },
  "AMD":  { label:"AMD",     sector:"Semiconductor", market:"🇺🇸", price:100.2, target:160,   roe:4.2,  per:44.8, rev:13.7, base:120,  vol:0.032, drift:-0.001, mktCap:163,  liquidity:6.8, revGrowth:14 },
  "AMZN": { label:"Amazon",  sector:"Consumer",      market:"🇺🇸", price:198.4, target:250,   roe:21.6, per:42.1, rev:12.3, base:165,  vol:0.019, drift:0.001,  mktCap:2110, liquidity:2.9, revGrowth:12 },
};

const KR_NAME_DB = {
  "삼성전자":"005930","삼성":"005930","sk하이닉스":"000660","하이닉스":"000660","SK하이닉스":"000660",
  "lg에너지솔루션":"373220","LG에너지솔루션":"373220","삼성바이오로직스":"207940","삼성바이오":"207940",
  "현대차":"005380","현대자동차":"005380","기아":"000270","기아차":"000270","셀트리온":"068270",
  "kb금융":"105560","KB금융":"105560","신한지주":"055550","신한":"055550","하나금융지주":"086790","하나금융":"086790",
  "포스코홀딩스":"005490","포스코":"005490","POSCO":"005490","삼성sdi":"006400","삼성SDI":"006400",
  "lg화학":"051910","LG화학":"051910","카카오뱅크":"323410","한국전력":"015760","삼성물산":"028260",
  "현대모비스":"012330","lg전자":"066570","LG전자":"066570","한화에어로스페이스":"012450","한화에어로":"012450",
  "한국항공우주":"047810","KAI":"047810","카카오":"035720","naver":"035420","NAVER":"035420","네이버":"035420",
  "엔씨소프트":"036570","엔씨":"036570","크래프톤":"259960","하이브":"352820","에코프로비엠":"247540","에코프로":"086520",
  "레인보우로보틱스":"277810","알테오젠":"196170","리가켐바이오":"141080","삼천당제약":"000250",
  "엔비디아":"NVDA","NVIDIA":"NVDA","애플":"AAPL","Apple":"AAPL","테슬라":"TSLA","Tesla":"TSLA",
  "마이크로소프트":"MSFT","MS":"MSFT","메타":"META","페이스북":"META","구글":"GOOGL","Google":"GOOGL","알파벳":"GOOGL",
  "아마존":"AMZN","Amazon":"AMZN","AMD":"AMD","인텔":"INTC","Intel":"INTC","팔란티어":"PLTR","Palantir":"PLTR",
  "아이온큐":"IONQ","IonQ":"IONQ","화이자":"PFE","Pfizer":"PFE","넷플릭스":"NFLX","Netflix":"NFLX",
};

const IRP_DB = [
  { ticker:"KODEX 200",    type:"국내주식", vol:0.018, drift:0.0008 },
  { ticker:"TIGER 미국S&P",type:"해외주식", vol:0.022, drift:0.001  },
  { ticker:"KODEX 나스닥", type:"해외주식", vol:0.028, drift:0.0012 },
  { ticker:"KODEX 국채3년",type:"채권",     vol:0.004, drift:0.0002 },
  { ticker:"TIGER 리츠",   type:"리츠",     vol:0.015, drift:0.0006 },
  { ticker:"KODEX 골드",   type:"원자재",   vol:0.012, drift:0.0003 },
  { ticker:"현금성자산",   type:"현금",     vol:0.001, drift:0.00015},
];
const typeCol = { 국내주식:C.accent, 해외주식:C.green, 채권:C.yellow, 리츠:C.purple, 원자재:"#fb923c", 현금:C.sub };

// ═══════════════════════════════════════════════════════════
// 1b. Opportunity Score
function calcOpportunityScore(vix, spChg3d, kospiChg3d, sectorRS) {
  let score = 50;
  if (vix > 0) {
    if (vix < 15) score += 20; else if (vix < 20) score += 10;
    else if (vix < 25) score += 0; else if (vix < 30) score -= 10; else score -= 20;
  }
  if (spChg3d > 2) score += 15; else if (spChg3d > 0) score += 8;
  else if (spChg3d > -2) score -= 5; else score -= 15;
  if (kospiChg3d > 2) score += 10; else if (kospiChg3d > 0) score += 5;
  else if (kospiChg3d > -2) score -= 3; else score -= 10;
  const bull = (sectorRS||[]).filter(s=>s.chg1W>0).length;
  score += bull * 2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ═══════════════════════════════════════════════════════════
// 2. 지표 계산
// ═══════════════════════════════════════════════════════════
function genCandles(info) {
  const data=[]; const now=new Date(); let p=info.base||info.price*0.88||100;
  for(let i=180;i>=0;i--){
    const d=new Date(now); d.setDate(d.getDate()-i);
    if(d.getDay()===0||d.getDay()===6) continue;
    p=p*(1+(Math.random()-.48)*(info.vol||0.02)+(info.drift||0.001));
    const r=p*(info.vol||0.02)*0.7;
    data.push({date:`${d.getMonth()+1}/${d.getDate()}`,high:+(p+Math.random()*r).toFixed(2),low:+(p-Math.random()*r).toFixed(2),close:+p.toFixed(2),volume:Math.floor((1e6+Math.random()*5e6)*(0.8+Math.random()*0.8))});
  }
  if(data.length) data[data.length-1].close=info.price||p;
  return data;
}
function calcST(candles,period,mult){
  const atrs=[];
  for(let i=1;i<candles.length;i++) atrs.push(Math.max(candles[i].high-candles[i].low,Math.abs(candles[i].high-candles[i-1].close),Math.abs(candles[i].low-candles[i-1].close)));
  const res=[];
  for(let i=period;i<candles.length;i++){
    const atr=atrs.slice(i-period,i).reduce((a,b)=>a+b)/period,hl2=(candles[i].high+candles[i].low)/2;
    let ub=hl2+mult*atr,lb=hl2-mult*atr; const prev=res[res.length-1];
    if(prev){lb=lb>prev.lb||candles[i-1].close<prev.lb?lb:prev.lb;ub=ub<prev.ub||candles[i-1].close>prev.ub?ub:prev.ub;}
    const trend=prev?(prev.trend===-1?(candles[i].close>prev.ub?1:-1):(candles[i].close<prev.lb?-1:1)):1;
    res.push({st:+(trend===1?lb:ub).toFixed(2),trend,lb,ub});
  }
  return res;
}
function calcEMA(closes,p){const k=2/(p+1);let e=closes[0];return closes.map(v=>{e=v*k+e*(1-k);return+e.toFixed(3);});}
function calcRSI(closes,p=14){
  const rsi=new Array(p).fill(null);let g=0,l=0;
  for(let i=1;i<=p;i++){const d=closes[i]-closes[i-1];if(d>0)g+=d;else l-=d;}
  let ag=g/p,al=l/p;rsi.push(al===0?100:+(100-100/(1+ag/al)).toFixed(2));
  for(let i=p+1;i<closes.length;i++){const d=closes[i]-closes[i-1];ag=(ag*(p-1)+(d>0?d:0))/p;al=(al*(p-1)+(d<0?-d:0))/p;rsi.push(al===0?100:+(100-100/(1+ag/al)).toFixed(2));}
  return rsi;
}
function calcMACD(closes,fast=12,slow=26,sig=9){
  const ef=calcEMA(closes,fast),es=calcEMA(closes,slow);
  const ml=closes.map((_,i)=>+(ef[i]-es[i]).toFixed(3)),sl=calcEMA(ml,sig);
  return{ml,sl,hist:ml.map((v,i)=>+(v-sl[i]).toFixed(3))};
}
function calcATR(candles,p=14){
  const trs=[];for(let i=1;i<candles.length;i++)trs.push(Math.max(candles[i].high-candles[i].low,Math.abs(candles[i].high-candles[i-1].close),Math.abs(candles[i].low-candles[i-1].close)));
  const res=new Array(p).fill(null);let atr=trs.slice(0,p).reduce((a,b)=>a+b)/p;res.push(+atr.toFixed(2));
  for(let i=p;i<trs.length;i++){atr=(atr*(p-1)+trs[i])/p;res.push(+atr.toFixed(2));}
  return res;
}

// ADX (평균방향지수) — 추세 강도. 25↑강한추세 20↓횡보
function calcADX(candles, p=14) {
  if (candles.length < p+1) return new Array(candles.length).fill(null);
  const plusDM=[], minusDM=[], tr=[];
  for(let i=1;i<candles.length;i++){
    const upMove=candles[i].high-candles[i-1].high;
    const downMove=candles[i-1].low-candles[i].low;
    plusDM.push(upMove>downMove&&upMove>0?upMove:0);
    minusDM.push(downMove>upMove&&downMove>0?downMove:0);
    tr.push(Math.max(candles[i].high-candles[i].low,Math.abs(candles[i].high-candles[i-1].close),Math.abs(candles[i].low-candles[i-1].close)));
  }
  // Smoothed averages
  let sTR=tr.slice(0,p).reduce((a,b)=>a+b,0);
  let sPDM=plusDM.slice(0,p).reduce((a,b)=>a+b,0);
  let sMDM=minusDM.slice(0,p).reduce((a,b)=>a+b,0);
  const res=new Array(p).fill(null);
  const dx=[];
  for(let i=p;i<tr.length;i++){
    sTR=sTR-sTR/p+tr[i];sPDM=sPDM-sPDM/p+plusDM[i];sMDM=sMDM-sMDM/p+minusDM[i];
    const pDI=sTR>0?100*sPDM/sTR:0;
    const mDI=sTR>0?100*sMDM/sTR:0;
    const sum=pDI+mDI;
    dx.push(sum>0?100*Math.abs(pDI-mDI)/sum:0);
    res.push({adx:null,pdi:+pDI.toFixed(1),mdi:+mDI.toFixed(1)});
  }
  // ADX = smoothed DX
  if(dx.length<p)return res.concat(new Array(candles.length-res.length).fill(null));
  let adxVal=dx.slice(0,p).reduce((a,b)=>a+b,0)/p;
  const finalRes=new Array(p*2).fill(null);
  for(let i=0;i<res.length;i++){
    if(i<p){finalRes.push({...res[p+i],adx:null});}
    else{
      adxVal=(adxVal*(p-1)+(dx[i]||0))/p;
      finalRes.push({...res[p+i],adx:+adxVal.toFixed(1)});
    }
  }
  return finalRes;
}

// OBV (거래량균형지수) — 매집/분산 감지
function calcOBV(candles) {
  const res=[0];
  for(let i=1;i<candles.length;i++){
    const prev=res[res.length-1];
    if(candles[i].close>candles[i-1].close) res.push(prev+(candles[i].volume||0));
    else if(candles[i].close<candles[i-1].close) res.push(prev-(candles[i].volume||0));
    else res.push(prev);
  }
  return res;
}
// HMA (Hull Moving Average)
function calcHMA(closes,p=20){
  const half=calcEMA(closes,Math.round(p/2));
  const full=calcEMA(closes,p);
  const diff=closes.map((_,i)=>2*half[i]-full[i]);
  return calcEMA(diff,Math.round(Math.sqrt(p)));
}

// ★ 11번: TTM Squeeze (볼린저밴드 vs 켈트너채널)
function calcSqueeze(candles, period=20) {
  const closes = candles.map(c=>c.close);
  const highs  = candles.map(c=>c.high);
  const lows   = candles.map(c=>c.low);
  const result = [];
  for (let i=0; i<candles.length; i++) {
    if (i < period-1) { result.push({sqzOn:null,sqzOff:null,mom:null,momUp:null}); continue; }
    const sliceC = closes.slice(i-period+1, i+1);
    const sma    = sliceC.reduce((a,b)=>a+b,0)/period;
    const std    = Math.sqrt(sliceC.reduce((a,b)=>a+(b-sma)**2,0)/period);
    const bbU = sma+2*std, bbL = sma-2*std;
    // ATR for Keltner
    let atrSum=0;
    for (let j=i-period+1; j<=i; j++) {
      atrSum += j>0 ? Math.max(highs[j]-lows[j], Math.abs(highs[j]-closes[j-1]), Math.abs(lows[j]-closes[j-1])) : highs[j]-lows[j];
    }
    const atr=atrSum/period;
    const kcU=sma+1.5*atr, kcL=sma-1.5*atr;
    const sqzOn = bbU<kcU && bbL>kcL;
    // 이전 상태와 비교해 sqzOff (방금 풀린 순간)
    const prevSqzOn = result.length>0&&result[result.length-1].sqzOn;
    const sqzOff    = !sqzOn && !!prevSqzOn;
    // 모멘텀 = close - ((최고+최저)/2 + SMA)/2
    const hiH=Math.max(...highs.slice(i-period+1,i+1));
    const loL=Math.min(...lows.slice(i-period+1,i+1));
    const mom=+(closes[i]-((hiH+loL)/2+sma)/2).toFixed(3);
    const prevMom = result.length>0 ? result[result.length-1].mom||0 : 0;
    result.push({sqzOn, sqzOff, mom, momUp: mom>=prevMom});
  }
  return result;
}

// ★ 11번: Anchored VWAP (최근 90일 최저점 앵커)
function calcAVWAP(candles) {
  if (!candles||candles.length<10) return new Array(candles?.length||0).fill(null);
  const recent = Math.min(90, candles.length);
  const slice  = candles.slice(-recent);
  const minIdx = slice.reduce((mi,c,i)=>c.close<slice[mi].close?i:mi, 0);
  const anchorIdx = candles.length - recent + minIdx;
  const result = new Array(anchorIdx).fill(null);
  let cumVol=0, cumTP=0;
  for (let i=anchorIdx; i<candles.length; i++) {
    const tp = (candles[i].high + candles[i].low + candles[i].close)/3;
    const v  = candles[i].volume||1;
    cumVol += v; cumTP += tp*v;
    result.push(cumVol>0 ? +(cumTP/cumVol).toFixed(3) : null);
  }
  return result;
}

// 전고점/매물대 저항선 감지
function findResistanceLevels(candles, curPrice) {
  if (!candles || candles.length < 20) return [];
  const highs = candles.map(c => c.high);
  const peaks = [];
  for (let i = 3; i < highs.length - 3; i++) {
    if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && highs[i] > highs[i-3]
     && highs[i] > highs[i+1] && highs[i] > highs[i+2] && highs[i] > highs[i+3]) {
      peaks.push(+highs[i].toFixed(2));
    }
  }
  // 가까운 값끼리 클러스터링 (1.5% 이내 = 같은 매물대)
  const clustered = [];
  for (const p of peaks) {
    const existing = clustered.find(c => Math.abs(c.price - p) / p < 0.015);
    if (existing) { existing.count++; existing.price = (existing.price + p) / 2; }
    else clustered.push({ price: +p.toFixed(2), count: 1 });
  }
  return clustered
    .filter(c => c.price > curPrice)   // 현재가 위만
    .sort((a, b) => b.count - a.count) // 매물 많은 순
    .slice(0, 3)
    .sort((a, b) => a.price - b.price); // 가까운 순 정렬
}

function buildChartData(candles){
  const closes=candles.map(c=>c.close);
  const s1=calcST(candles,10,1),s2=calcST(candles,11,2),s3=calcST(candles,12,3);
  const ema50=calcEMA(closes,50),rsi=calcRSI(closes),{ml,sl,hist}=calcMACD(closes),atr=calcATR(candles);
  const hma20=calcHMA(closes,20);
  const sqzData=calcSqueeze(candles);
  const avwap=calcAVWAP(candles);
  const adxData=calcADX(candles);
  const obvData=calcOBV(candles);
  const off=candles.length-s3.length;
  const data=s3.map((r3,i)=>{
    const ci=i+off,r1=s1[i+(s1.length-s3.length)],r2=s2[i+(s2.length-s3.length)];
    const allBull=r1?.trend===1&&r2?.trend===1&&r3.trend===1;
    const bullCount=[r1?.trend===1,r2?.trend===1,r3.trend===1].filter(Boolean).length;
    return{date:candles[ci].date,close:candles[ci].close,volume:candles[ci].volume,
      open:ci>0?candles[ci-1].close:candles[ci].close,
      st1Bull:allBull?r1.st:null,st1Bear:!allBull?r1.st:null,
      st2Bull:allBull?r2.st:null,st2Bear:!allBull?r2.st:null,
      st3Bull:allBull?r3.st:null,st3Bear:!allBull?r3.st:null,
      bullSignal:allBull?candles[ci].close:null,bearSignal:!allBull?candles[ci].close:null,
      ema50:ema50[ci],hma20:hma20[ci],rsi:rsi[ci],macd:ml[ci],signal:sl[ci],hist:hist[ci],atr:atr[ci],bullCount,allBull,
      sqzOn:sqzData[ci]?.sqzOn, sqzOff:sqzData[ci]?.sqzOff, sqzMom:sqzData[ci]?.mom, sqzMomUp:sqzData[ci]?.momUp,
      avwap:avwap[ci]||null,
      adx:adxData[ci]?.adx||null, pdi:adxData[ci]?.pdi||null, mdi:adxData[ci]?.mdi||null,
      obv:obvData[ci]||null};
  });
  for(let i=1;i<data.length;i++){const c=data[i],p=data[i-1];const flip=c.bullCount===3&&p.bullCount<3,mx=c.macd>c.signal&&p.macd<=p.signal;if(flip&&mx)c.buyStrong=c.close;else if(flip)c.buyNormal=c.close;}
  const ac=data.map(d=>d.close);
  data.forEach((d,i)=>{d.ma20=i>=19?+(ac.slice(i-19,i+1).reduce((a,b)=>a+b)/20).toFixed(2):null;});
  // 200일선
  data.forEach((d,i)=>{d.ma200=i>=199?+(ac.slice(i-199,i+1).reduce((a,b)=>a+b)/200).toFixed(2):null;});
  const last=data[data.length-1];
  last.aboveMa200=last.ma200?last.close>last.ma200:null;
  const w52H=Math.max(...ac.slice(-252)),w52L=Math.min(...ac.slice(-252));
  const last=data[data.length-1];
  last.w52High=+w52H.toFixed(2);last.w52Low=+w52L.toFixed(2);
  last.w52Near=last.close>=w52H*0.95;last.w52DistPct=+((last.close-w52H)/w52H*100).toFixed(1);
  // 골든크로스 3/10일 체크
  if(data.length>=11){
    const a3=ac.slice(-3).reduce((a,b)=>a+b)/3,a10=ac.slice(-10).reduce((a,b)=>a+b)/10;
    last.goldenCross=a3>a10;
  }
  const highs=candles.map(c=>c.high),lows=candles.map(c=>c.low);
  const midV=(arr,s,e)=>(Math.max(...arr.slice(s,e))+Math.min(...arr.slice(s,e)))/2;
  data.forEach((d,ii)=>{const cii=ii+off;if(cii>=25){const t=midV(highs,cii-8,cii+1),k=midV(highs,cii-25,cii+1);d.spanA=+((t+k)/2).toFixed(2);}d.spanB=cii>=51?+midV(highs,cii-51,cii+1).toFixed(2):null;if(d.spanA&&d.spanB){d.spanHigh=Math.max(d.spanA,d.spanB);d.spanLow=Math.min(d.spanA,d.spanB);}});
  const lp=last;const ct=lp.spanA&&lp.spanB?Math.max(lp.spanA,lp.spanB):null;
  lp.aboveCloud=ct&&lp.close>ct;lp.nearCloud=ct&&!lp.aboveCloud&&lp.close>=ct*0.97;lp.inCloud=ct&&lp.close<=ct&&lp.spanB&&lp.close>=lp.spanB;
  return data;
}

// ★ 5번: 진입 평점 계산 (참고용, 강제제한 없음)
function calcEntryScore(chartData, vixVal, oppScore) {
  const last = chartData?.at(-1);
  if (!last) return { score: 0, breakdown: [], grade: "?" };
  let score = 0;
  const breakdown = [];

  // ① 구름 위 (20점)
  if (last.aboveCloud)       { score += 20; breakdown.push({label:"구름위",pts:20,ok:true}); }
  else if (last.nearCloud)   { score += 8;  breakdown.push({label:"구름접근",pts:8,ok:true}); }
  else                       {               breakdown.push({label:"구름아래",pts:0,ok:false}); }

  // ② 트리플ST (25점)
  const stC=[last.st1Bull,last.st2Bull,last.st3Bull].filter(v=>v!=null).length;
  if (stC===3)      { score+=25; breakdown.push({label:"ST3/3",pts:25,ok:true}); }
  else if (stC===2) { score+=12; breakdown.push({label:"ST2/3",pts:12,ok:true}); }
  else if (stC===1) { score+=4;  breakdown.push({label:"ST1/3",pts:4,ok:false}); }
  else              {             breakdown.push({label:"ST0/3",pts:0,ok:false}); }

  // ③ MACD 크로스 (20점)
  if (last.macd>last.signal&&last.hist>0) { score+=20; breakdown.push({label:"MACD↑크로스",pts:20,ok:true}); }
  else if (last.hist>0)                   { score+=8;  breakdown.push({label:"MACD양전",pts:8,ok:true}); }
  else                                    {             breakdown.push({label:"MACD음전",pts:0,ok:false}); }

  // ④ VIX 시장환경 (15점)
  if (vixVal<18)       { score+=15; breakdown.push({label:"VIX쾌청",pts:15,ok:true}); }
  else if (vixVal<22)  { score+=10; breakdown.push({label:"VIX안정",pts:10,ok:true}); }
  else if (vixVal<27)  { score+=4;  breakdown.push({label:"VIX주의",pts:4,ok:false}); }
  else                 {             breakdown.push({label:"VIX위험",pts:0,ok:false}); }

  // ⑤ RSI 적정구간 (10점)
  if (last.rsi>=50&&last.rsi<=68)      { score+=10; breakdown.push({label:`RSI${last.rsi?.toFixed(0)}`,pts:10,ok:true}); }
  else if (last.rsi>=40&&last.rsi<50)  { score+=5;  breakdown.push({label:`RSI${last.rsi?.toFixed(0)}`,pts:5,ok:true}); }
  else if (last.rsi>68)               {             breakdown.push({label:`RSI과매수`,pts:0,ok:false}); }
  else                                 {             breakdown.push({label:`RSI과매도`,pts:0,ok:false}); }

  // ⑥ OppScore 환경 (10점)
  if (oppScore>=70)      { score+=10; breakdown.push({label:`OppScore${oppScore}`,pts:10,ok:true}); }
  else if (oppScore>=50) { score+=5;  breakdown.push({label:`OppScore${oppScore}`,pts:5,ok:true}); }
  else                   {            breakdown.push({label:`OppScore${oppScore}`,pts:0,ok:false}); }

  const s=Math.min(100,score);
  const grade=s>=85?"S":s>=70?"A":s>=55?"B":s>=40?"C":"D";
  return { score:s, breakdown, grade };
}

function getTSTSig(data){if(!data?.length)return{sig:"N/A",bull:0};const l=data[data.length-1];return{sig:l.bullCount===3?"BUY":l.bullCount>=2?"HOLD":"SELL",bull:l.bullCount};}

// 간략 주식 신호 (SECTORS 없이)
function getStockSig(chartData){
  const last=chartData?.at(-1);if(!last)return"HOLD";
  const stC=[last.st1Bull,last.st2Bull,last.st3Bull].filter(v=>v!=null).length;
  if(stC===3&&last.aboveCloud)return"BUY";
  if(stC===0)return"SELL";
  return"HOLD";
}

function alphaScore(s, chartData, idxRS) {
  const last=chartData?.at(-1);
  const cd=chartData||[];
  let sc=0;const signals=[];
  const mkt=(s.market||"").includes("kr")?"kospi":"spy";
  const spyChg5=idxRS?.[mkt]?.chg5d||0;
  const stockChg5=s.chg5d||0;
  const rs=+(stockChg5-spyChg5).toFixed(1);
  if(rs>5){sc+=35;signals.push("RS매우강");}else if(rs>2){sc+=25;signals.push("RS강");}else if(rs>0){sc+=15;signals.push("RS보통");}else if(rs<-3){sc-=10;}
  if(last?.aboveCloud){sc+=10;signals.push("구름위");}
  const stBull=[last?.st1Bull,last?.st2Bull,last?.st3Bull].filter(v=>v!=null).length;
  if(stBull===3){sc+=15;signals.push("ST매수");}else if(stBull>=2){sc+=8;}
  if(last?.goldenCross){sc+=10;signals.push("골든크로스");}
  if(cd.length>=5){
    const vols=cd.slice(-20).map(c=>c.volume||0).filter(v=>v>0);
    const avgVol=vols.length?vols.reduce((a,b)=>a+b,0)/vols.length:0;
    const todayVol=cd[cd.length-1]?.volume||0;
    const volRatio=avgVol>0?todayVol/avgVol:1;
    s._volRatio=+(volRatio*100).toFixed(0);
    if(volRatio>2){sc+=10;signals.push("거래량급증");}else if(volRatio>1.5){sc+=5;signals.push("거래량증가");}
  }
  if(last?.w52Near){sc+=5;signals.push("신고가근접");}
  const mktCap=s.mktCap||0;
  const isKR=(s.market||"").includes("kr")||(s.ticker||"").length>5;
  const minCap=isKR?5000:5;
  if(mktCap>0&&mktCap<minCap)return{score:0,signals:[],rs,volRatio:s._volRatio||100};
  s._signals=signals;s._rs=rs;
  return{score:Math.min(100,Math.max(0,sc)),signals,rs,volRatio:s._volRatio||100};
}

// ═══════════════════════════════════════════════════════════
// 3. 서브컴포넌트
// ═══════════════════════════════════════════════════════════
const Tip=({active,payload,label})=>{
  if(!active||!payload?.length)return null;
  return<div style={{background:"#0f172a",border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",fontSize:10}}><div style={{color:C.sub,marginBottom:4,fontWeight:700}}>{label}</div>{payload.filter(p=>p.value!=null).map((p,i)=><div key={i} style={{color:p.color||C.text}}>{p.name}: <b>{typeof p.value==="number"?p.value.toLocaleString(undefined,{maximumFractionDigits:2}):p.value}</b></div>)}</div>;
};
const BuyDot=({cx,cy,payload,dataKey})=>{if(!payload[dataKey])return null;const c=dataKey==="buyStrong"?"#4ade80":"#fbbf24",sz=dataKey==="buyStrong"?11:8;return<g><polygon points={`${cx},${cy-sz} ${cx-sz*.8},${cy+sz*.5} ${cx+sz*.8},${cy+sz*.5}`} fill={c} stroke="#000" strokeWidth="1" opacity=".9"/></g>;};
const HistBar=({x,y,width,height,value})=>{if(value==null)return null;const h=Math.abs(height),pos=value>0;return<rect x={x} y={pos?y:y+height-h} width={Math.max(1,width)} height={h} fill={pos?"rgba(34,197,94,.7)":"rgba(239,68,68,.7)"} rx={1}/>;};

// ── 가격 포맷 (한국: 만원단위, 미국: 그대로) ─────────────
function fmtKRW(v) {
  if (!v && v !== 0) return "—";
  if (v >= 100000000) return `${(v/100000000).toFixed(1)}억`;
  if (v >= 10000)     return `${(v/10000).toFixed(v>=100000?0:1)}만`;
  return v.toLocaleString("ko-KR");
}
function fmtPrice(v, isKR) {
  if (!v && v !== 0) return "—";
  if (isKR) return fmtKRW(v);
  if (v >= 10000) return v.toLocaleString("en",{maximumFractionDigits:0});
  return v.toFixed(2);
}

const css = {
  card: { background:C.panel, border:`1px solid ${C.border}`, borderRadius:10, padding:12, marginBottom:10 },
  panel2: { background:"rgba(255,255,255,.04)", border:"1px solid rgba(99,102,241,.12)", borderRadius:10, padding:"8px 12px" },
  sig: (type) => ({ ...SIG[type], borderRadius:6, padding:"2px 8px", fontWeight:700, fontSize:10, display:"inline-block", border:`1px solid ${SIG[type]?.border||C.border}` }),
  btn: (on=false) => ({ borderRadius:8, padding:"5px 12px", cursor:"pointer", fontWeight:600, fontSize:10, border:`1px solid ${on?C.accent:"rgba(99,115,140,.2)"}`, background:on?"rgba(56,189,248,.2)":"rgba(255,255,255,.04)", color:on?C.accent:C.muted }),
};

// ═══════════════════════════════════════════════════════════
// 4. 메인 앱
// ═══════════════════════════════════════════════════════════
function PoolList({pool,poolMarket,poolFilter,stocks,removeStock,setStocks,setPoolMsg,C,border,accent,muted,text,green,red}){
  const filtered=Object.entries(pool).filter(([ticker,info])=>{
    if(poolMarket==="kr"&&info.market!=="kr")return false;
    if(poolMarket==="us"&&info.market!=="us")return false;
    if(poolFilter){const q=poolFilter.toLowerCase();return ticker.toLowerCase().includes(q)||(info.label||"").toLowerCase().includes(q);}
    return true;
  });
  return(
    <div>
      <div style={{fontSize:9,color:muted,marginBottom:8}}>{filtered.length}개 표시 중</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:6}}>
        {filtered.slice(0,200).map(([ticker,info])=>{
          const inWatch=stocks.find(s=>s.ticker===ticker);
          const chg=info.changePct||0;
          return(
            <div key={ticker} style={{background:C.panel2,border:`1px solid ${inWatch?"rgba(56,189,248,.4)":C.border}`,borderRadius:7,padding:"7px 9px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <div style={{fontSize:9,fontWeight:700,color:inWatch?accent:text}}>{info.label||ticker}</div>
                  <div style={{fontSize:7,color:muted}}>{ticker}</div>
                </div>
                <button onClick={async()=>{
                  if(inWatch){removeStock(ticker);}
                  else{try{await fetch("/api/watchlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker,...info})});setStocks(p=>[...p,{ticker,...info,...(pool[ticker]||{})}]);setPoolMsg(`✅ ${info.label} 추가`);}catch{setPoolMsg("❌ 실패");}}
                  setTimeout(()=>setPoolMsg(""),3000);
                }} style={{background:inWatch?"rgba(99,102,241,.15)":"rgba(255,255,255,.04)",border:`1px solid ${inWatch?accent:border}`,borderRadius:4,padding:"2px 6px",cursor:"pointer",color:inWatch?accent:muted,fontSize:10,flexShrink:0}}>{inWatch?"★":"☆"}</button>
              </div>
              {info.price>0&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
                <span style={{fontSize:9}}>{info.market==="kr"?"₩":"$"}{(info.price||0).toLocaleString()}</span>
                <span style={{fontSize:8,fontWeight:700,color:chg>=0?green:red}}>{chg>=0?"+":""}{chg.toFixed(1)}%</span>
              </div>}
            </div>
          );
        })}
      </div>
      {filtered.length>200&&<div style={{textAlign:"center",padding:"10px",fontSize:9,color:muted}}>검색으로 범위를 좁혀주세요 ({filtered.length}개 중 200개 표시)</div>}
    </div>
  );
}

export default function App() {
  // ── 앱 상태 ─────────────────────────────────────────────
  const [stocks, setStocks] = useState(()=>{try{const s=localStorage.getItem("at_stocks");return s?JSON.parse(s):INITIAL;}catch{return INITIAL;}});
  const [sel, setSel]       = useState("NVDA");
  const [tab, setTab]       = useState("radar");
  const [charts, setCharts] = useState({});
  const [consensus, setConsensus] = useState({});
  const [search, setSearch] = useState("");
  const [searchRes, setSearchRes] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [addMsg, setAddMsg] = useState("");
  const [period, setPeriod] = useState("3M");
  const [selectedSector, setSelectedSector] = useState(null);

  // ── 데이터 상태 ──────────────────────────────────────────
  const [dataStatus, setDataStatus] = useState("loading");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [indicesData, setIndicesData] = useState({});
  const [sectorsData, setSectorsData] = useState({});
  const [breadthData, setBreadthData] = useState({kr:{upPct:0,up:0,down:0},us:{upPct:0,up:0,down:0}});
  const [rsKey, setRsKey]   = useState("chg1M");
  const [ibVol, setIbVol]   = useState(0);

  // ── 알파헌터 ────────────────────────────────────────────
  const [fVolRatio, setFVolRatio] = useState(60);
  // 추가 필터 조건
  const [fMarket, setFMarket]   = useState("all");   // all | kr | us
  const [fRS, setFRS]           = useState(0);        // vs시장 RS 최소 %p
  const [fCloud, setFCloud]     = useState("all");    // all | above | near
  const [fST, setFST]           = useState(0);        // 슈퍼트랜드 최소 개수 (0~3)
  const [alphaTab, setAlphaTab] = useState("filter");
  const [chartOpts, setChartOpts] = useState({ichi:true, st:true, avwap:true});
  const [alphaHitsRemote, setAlphaHitsRemote] = useState([]);
  const [pool, setPool]         = useState({});
  const [poolLoaded, setPoolLoaded] = useState(false);
  const [poolFilter, setPoolFilter] = useState("");
  const [poolMarket, setPoolMarket] = useState("all");
  const [poolMsg, setPoolMsg]   = useState("");
  const [watchlist, setWatchlist] = useState([]);
  const [conds, setConds]       = useState({ golden:true, box:false, angle:false, ichi:false, vol:false });

  // ── 스나이퍼 ────────────────────────────────────────────
  const [stopPct, setStopPct]   = useState(10);
  const [checklist, setChecklist] = useState({market:false,sector:false,stock:false,timing:false,risk:false});

  // ── 13번: 포지션 사이징 & 리스크 관리 ────────────────────
  const [riskSettings, setRiskSettings] = useState(()=>{
    try{const s=localStorage.getItem("at_risk");return s?JSON.parse(s):{totalCapital:10000000,maxPositions:10,maxWeightPct:30};}
    catch{return{totalCapital:10000000,maxPositions:10,maxWeightPct:30};}
  });
  const [showRiskPanel, setShowRiskPanel] = useState(false);

  // ── 12번: 불타기 + 트레일링컷 설정 ──────────────────────
  const [trailSettings, setTrailSettings] = useState(()=>{
    try{const s=localStorage.getItem("at_trail");return s?JSON.parse(s):{initialStopPct:10,trailPct:8,switchPct:10};}
    catch{return{initialStopPct:10,trailPct:8,switchPct:10};}
  });

  // ── 9번: 통합 추적 탭 ───────────────────────────────────
  const [trackTab, setTrackTab] = useState("watch"); // watch | hold | closed | stats
  const [tracking, setTracking] = useState(()=>{try{const s=localStorage.getItem("at_tracking");return s?JSON.parse(s):[];}catch{return [];}});
  const [positions, setPositions] = useState(()=>{try{const s=localStorage.getItem("at_positions");return s?JSON.parse(s):[];}catch{return [];}});
  const [closedLog, setClosedLog] = useState(()=>{try{const s=localStorage.getItem("at_closed");return s?JSON.parse(s):[];}catch{return [];}});

  // ── 10번: AI 성적 분석 ──────────────────────────────────
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiLoading, setAiLoading]   = useState(false);

  // ── 기타 ────────────────────────────────────────────────
  const [investNotes, setInvestNotes] = useState(()=>{try{return localStorage.getItem("at_notes")||"";}catch{return "";}});
  const [irpPort, setIrpPort] = useState([
    {ticker:"KODEX 200",type:"국내주식",weight:30,vol:0.018,drift:0.0008},
    {ticker:"TIGER 미국S&P",type:"해외주식",weight:25,vol:0.022,drift:0.001},
    {ticker:"KODEX 국채3년",type:"채권",weight:25,vol:0.004,drift:0.0002},
    {ticker:"TIGER 리츠",type:"리츠",weight:10,vol:0.015,drift:0.0006},
    {ticker:"KODEX 골드",type:"원자재",weight:10,vol:0.012,drift:0.0003},
  ]);
  const [irpYears, setIrpYears]   = useState(3);
  const [irpResult, setIrpResult] = useState(null);

  // ════════════════════════════════════════════════════════
  // ★ 데이터 로딩
  // ════════════════════════════════════════════════════════
  useEffect(()=>{
    fetch("/data/stocks.json")
      .then(r=>{if(!r.ok)throw new Error("no data");return r.json();})
      .then(json=>{
        const stocksJson=json.stocks||{};
        setIndicesData(json.indices||{});
        if(json.sectors&&Object.keys(json.sectors).length>0) setSectorsData(json.sectors);
        if(json.breadth) setBreadthData(json.breadth);
        if(json.ibVol) setIbVol(json.ibVol);
        if(Object.keys(stocksJson).length>0){
          setStocks(prev=>prev.map(s=>{
            const real=stocksJson[s.ticker];if(!real)return s;
            return{...s,price:real.price||s.price,chg3d:real.chg3d??s.chg3d,chg5d:real.chg5d??s.chg5d,changePct:real.changePct??0,volRatio:real.volRatio??s.volRatio??100,mktCap:real.mktCap??s.mktCap??0};
          }));
          const newCharts={};
          for(const[ticker,sd]of Object.entries(stocksJson)){
            if(sd.candles&&sd.candles.length>30){try{newCharts[ticker]={data:buildChartData(sd.candles),real:true};}catch{}}
          }
          setCharts(newCharts);
          setDataStatus("real");setLastUpdated(json.updatedAt);
        }else{setDataStatus("sim");}
      }).catch(()=>setDataStatus("sim"));
  },[]);

  // 포지션 현재가 + 트레일링 자동 갱신
  useEffect(()=>{
    if(!positions.length)return;
    setPositions(prev=>prev.map(pos=>{
      const cur=stocks.find(s=>s.ticker===pos.ticker)?.price||pos.current;
      const newMax=Math.max(pos.max||pos.entry,cur);
      const pnl=pos.entry>0?+((cur-pos.entry)/pos.entry*100).toFixed(2):0;
      const isKR=(pos.ticker?.length||0)>5;
      // 12번: switchPct 이상 수익 → 트레일링 전환
      const ts=trailSettings;
      const newTrail=pnl>=ts.switchPct
        ?+(newMax*(1-ts.trailPct/100)).toFixed(isKR?0:2)
        :+(pos.entry*(1-ts.initialStopPct/100)).toFixed(isKR?0:2);
      // 불타기 알림 체크
      const pyramid=pos.pyramid||[];
      const updatedPyramid=pyramid.map(lv=>{
        if(!lv.triggered&&pnl>=lv.targetPct){
          return{...lv,triggered:true,triggeredAt:new Date().toLocaleTimeString("ko-KR")};
        }
        return lv;
      });
      return{...pos,current:cur,max:newMax,pnl,trailStop:newTrail,trailMode:pnl>=ts.switchPct,pyramid:updatedPyramid};
    }));
  },[stocks]);

  // localStorage 저장
  useEffect(()=>{try{localStorage.setItem("at_stocks",JSON.stringify(stocks));}catch{}},[stocks]);
  useEffect(()=>{try{localStorage.setItem("at_positions",JSON.stringify(positions));}catch{}},[positions]);
  useEffect(()=>{try{localStorage.setItem("at_tracking",JSON.stringify(tracking));}catch{}},[tracking]);
  useEffect(()=>{try{localStorage.setItem("at_closed",JSON.stringify(closedLog));}catch{}},[closedLog]);
  useEffect(()=>{try{localStorage.setItem("at_notes",investNotes);}catch{}},[investNotes]);
  useEffect(()=>{try{localStorage.setItem("at_risk",JSON.stringify(riskSettings));}catch{}},[riskSettings]);
  useEffect(()=>{try{localStorage.setItem("at_trail",JSON.stringify(trailSettings));}catch{}},[trailSettings]);

  // 시뮬 차트 빌드
  useEffect(()=>{
    if(dataStatus==="loading")return;
    stocks.forEach(s=>{
      if(!charts[s.ticker]){
        const candles=genCandles(s);
        setCharts(prev=>({...prev,[s.ticker]:{data:buildChartData(candles),real:false}}));
      }
    });
  },[dataStatus]);

  // 선택 종목 변경
  useEffect(()=>{
    const info=stocks.find(s=>s.ticker===sel);if(!info)return;
    if(!charts[sel]){
      const candles=genCandles(info);
      setCharts(prev=>({...prev,[sel]:{data:buildChartData(candles),real:false}}));
    }
    if(!consensus[sel])fetchConsensus(sel,info.label,info.market);
  },[sel]);

  // 검색
  useEffect(()=>{
    if(!search.trim()){setSearchRes([]);setSearchLoading(false);return;}
    const q=search.trim();
    const already=stocks.map(s=>s.ticker);
    const timer=setTimeout(async()=>{
      setSearchLoading(true);
      try{
        const r=await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data=await r.json();
        const results=(data.results||[]).filter(item=>!already.includes(item.ticker)).slice(0,8);
        if(!results.length){
          const qUp=q.toUpperCase();
          const krMatch=KR_NAME_DB[q]||KR_NAME_DB[qUp]||Object.entries(KR_NAME_DB).find(([k])=>k.includes(q))?.[1];
          const ticker=krMatch||qUp;
          if(!already.includes(ticker))results.push({ticker,label:`"${q}" 실시간 조회`,_custom:true});
        }
        setSearchRes(results);
      }catch{
        const qUp=q.toUpperCase();
        const krMatch=KR_NAME_DB[q]||KR_NAME_DB[qUp]||Object.entries(KR_NAME_DB).find(([k])=>k.includes(q))?.[1];
        const res=[];
        if(krMatch&&!already.includes(krMatch))res.push({ticker:krMatch,label:`${q} (${krMatch})`,_custom:true});
        else if(!already.includes(qUp))res.push({ticker:qUp,label:`"${q}" 실시간 조회`,_custom:true});
        setSearchRes(res);
      }finally{setSearchLoading(false);}
    },300);
    return()=>clearTimeout(timer);
  },[search,stocks]);

  // AI 컨센서스
  const fetchConsensus=useCallback(async(ticker,label,market)=>{
    setConsensus(p=>{if(p[ticker]?.data||p[ticker]?.loading)return p;return{...p,[ticker]:{loading:true}};});
    const isKR=market==="🇰🇷";
    const prompt=`${label}(${ticker}) 최신 애널리스트 컨센서스를 검색해 JSON만 출력:\n{"targetMean":숫자,"targetHigh":숫자,"targetLow":숫자,"buyCount":숫자,"holdCount":숫자,"sellCount":숫자,"consensus":"Strong Buy|Buy|Hold|Sell","summary":"한국어50자","updatedAt":"YYYY-MM"}\n목표주가:${isKR?"원":"달러"}`;
    try{
      const r=await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt,tools:[{type:"web_search_20250305",name:"web_search"}],max_tokens:300})});
      const j=await r.json();
      const txt=j.content.filter(b=>b.type==="text").map(b=>b.text).join("").replace(/```json|```/g,"").trim();
      setConsensus(p=>({...p,[ticker]:{data:JSON.parse(txt),loading:false}}));
    }catch{setConsensus(p=>({...p,[ticker]:{error:"조회 실패",loading:false}}));}
  },[]);

  // 10번: AI 성적분석
  const runAIAnalysis=useCallback(async()=>{
    if(!closedLog.length){setAiAnalysis("❌ 청산 기록이 없어요. 먼저 포지션을 청산해주세요.");return;}
    setAiLoading(true);
    const summary={
      total:closedLog.length,
      winRate:+((closedLog.filter(h=>parseFloat(h.pnl)>0).length/closedLog.length*100).toFixed(1)),
      avgPnl:+(closedLog.reduce((a,h)=>a+parseFloat(h.pnl||0),0)/closedLog.length).toFixed(2),
      bestTrade:closedLog.reduce((a,h)=>parseFloat(h.pnl)>parseFloat(a.pnl)?h:a,closedLog[0]),
      worstTrade:closedLog.reduce((a,h)=>parseFloat(h.pnl)<parseFloat(a.pnl)?h:a,closedLog[0]),
      bySignal:{},
    };
    (closedLog).forEach(h=>{
      (h.foundSignals||[]).forEach(sig=>{
        if(!summary.bySignal[sig])summary.bySignal[sig]={count:0,wins:0,totalPnl:0};
        summary.bySignal[sig].count++;
        if(parseFloat(h.pnl)>0)summary.bySignal[sig].wins++;
        summary.bySignal[sig].totalPnl+=parseFloat(h.pnl||0);
      });
    });
    const prompt=`다음 알파 터미널 트레이딩 성과를 한국어로 분석해줘 (200자 이내):
거래수: ${summary.total}, 승률: ${summary.winRate}%, 평균손익: ${summary.avgPnl}%
최고: ${summary.bestTrade?.label} +${summary.bestTrade?.pnl}%
최저: ${summary.worstTrade?.label} ${summary.worstTrade?.pnl}%
신호별 승률: ${JSON.stringify(Object.entries(summary.bySignal).slice(0,5).map(([k,v])=>({신호:k,승률:+(v.wins/v.count*100).toFixed(0)+"%",평균:+(v.totalPnl/v.count).toFixed(1)+"%"})))}
개선점 3가지를 구체적으로 제안해줘.`;
    try{
      const r=await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt,max_tokens:400})});
      const j=await r.json();
      setAiAnalysis(j.content?.[0]?.text||"분석 실패");
    }catch{setAiAnalysis("❌ AI 분석 실패 — API 연결 확인");}
    finally{setAiLoading(false);}
  },[closedLog]);

  // 종목 추가
  async function addStock(item){
    if(stocks.find(s=>s.ticker===item.ticker)){setAddMsg("이미 추가됨");setTimeout(()=>setAddMsg(""),2000);return;}
    setSearch("");setSearchRes([]);setShowSearch(false);
    if(item._custom){
      setAddMsg(`🔍 ${item.ticker} 조회 중...`);
      const real=await fetchFromYahoo(item.ticker);
      if(real){
        setStocks(p=>[...p,real]);
        if(real.candles?.length>10){try{setCharts(prev=>({...prev,[real.ticker]:{data:buildChartData(real.candles),real:true}}));}catch{}}
        setSel(real.ticker);setTab("sniper");setAddMsg(`✅ ${real.label} 추가`);
      }else{setAddMsg(`❌ ${item.ticker} 조회 실패`);}
    }else{
      setStocks(p=>[...p,item]);setSel(item.ticker);setTab("sniper");setAddMsg(`✅ ${item.label||item.ticker} 추가`);
    }
    setTimeout(()=>setAddMsg(""),3000);
  }

  async function fetchFromYahoo(ticker){
    try{
      const qRes=await fetch(`/api/quote?ticker=${ticker}`);
      if(!qRes.ok)throw new Error("quote 실패");
      const qData=await qRes.json();
      if(qData.error)throw new Error(qData.error);
      let candles=[];
      try{const cRes=await fetch(`/api/candles?ticker=${ticker}`);if(cRes.ok){const cData=await cRes.json();candles=cData.candles||[];}}catch{}
      const price=qData.price||0;
      const isKR=/^\d{6}$/.test(ticker);
      return{...qData,chg3d:candles.length>3?+((candles.at(-1).close-candles.at(-4).close)/candles.at(-4).close*100).toFixed(2):0,chg5d:candles.length>5?+((candles.at(-1).close-candles.at(-6).close)/candles.at(-6).close*100).toFixed(2):0,candles,base:isKR?Math.round(price*0.88):+(price*0.88).toFixed(2),vol:0.02,drift:0.001};
    }catch(e){
      try{
        const isKR=/^\d{6}$/.test(ticker);
        const suffixes=isKR?[".KS",".KQ"]:[""];
        for(const sfx of suffixes){
          const url=`https://query1.finance.yahoo.com/v8/finance/chart/${ticker+sfx}?interval=1d&range=3mo`;
          const r=await fetch("https://corsproxy.io/?url="+encodeURIComponent(url),{signal:AbortSignal.timeout(8000)});
          if(!r.ok)continue;
          const json=await r.json();
          const res=json.chart?.result?.[0];if(!res)continue;
          const meta=res.meta;
          const price=parseFloat(meta.regularMarketPrice||meta.previousClose||0);if(!price)continue;
          const prev=parseFloat(meta.chartPreviousClose||meta.previousClose||price);
          const ts=res.timestamp||[],q=res.indicators?.quote?.[0]||{};
          const candles=ts.map((t,i)=>{const d=new Date(t*1000);return{date:`${d.getMonth()+1}/${d.getDate()}`,close:+(q.close?.[i]||price).toFixed(2),high:+(q.high?.[i]||price).toFixed(2),low:+(q.low?.[i]||price).toFixed(2),volume:q.volume?.[i]||0};}).filter(c=>c.close>0);
          return{ticker,label:meta.longName||meta.shortName||ticker,price,change:+(price-prev).toFixed(2),changePct:+((price-prev)/prev*100).toFixed(2),chg3d:candles.length>3?+((candles.at(-1).close-candles.at(-4).close)/candles.at(-4).close*100).toFixed(2):0,chg5d:candles.length>5?+((candles.at(-1).close-candles.at(-6).close)/candles.at(-6).close*100).toFixed(2):0,sector:"Technology",market:isKR?"🇰🇷":"🇺🇸",roe:0,per:0,rev:0,revGrowth:0,mktCap:meta.marketCap||0,target:+(price*1.2).toFixed(isKR?0:2),liquidity:2,base:+(price*0.88).toFixed(isKR?0:2),vol:0.02,drift:0.001,candles};
        }
      }catch{}
      return null;
    }
  }
  function removeStock(t){setStocks(p=>p.filter(s=>s.ticker!==t));if(sel===t)setSel(stocks[0]?.ticker||"");}

  // IRP 백테스트
  function runIrp(){
    const totalW=irpPort.reduce((a,s)=>a+s.weight,0);if(!totalW)return;
    setTimeout(()=>{
      const days=irpYears*252;
      const series=irpPort.map(s=>{let p=1;const pts=[1];for(let i=0;i<days;i++){p*=(1+(Math.random()-.47)*s.vol+s.drift);if(i%21===0)pts.push(+p.toFixed(4));}return{...s,weight:s.weight/totalW,pts};});
      const pts=series[0].pts.map((_,i)=>series.reduce((sum,s)=>sum+s.pts[i]*s.weight,0));
      const totalRet=pts.at(-1)-1,annRet=Math.pow(pts.at(-1),1/irpYears)-1;
      let peak=pts[0],mdd=0;pts.forEach(v=>{if(v>peak)peak=v;const dd=(v-peak)/peak;if(dd<mdd)mdd=dd;});
      const rets=pts.slice(1).map((v,i)=>v/pts[i]-1),avg=rets.reduce((a,b)=>a+b,0)/rets.length;
      const std=Math.sqrt(rets.reduce((a,b)=>a+(b-avg)**2,0)/rets.length)*Math.sqrt(252);
      const mn=Math.min(...pts),span=Math.max(...pts)-mn||.01;
      const coords=pts.map((v,i)=>`${(i/(pts.length-1)*300).toFixed(1)},${(80-(v-mn)/span*70).toFixed(1)}`).join(" ");
      setIrpResult({totalRet,annRet,mdd,sharpe:(annRet-.035)/std,years:irpYears,coords,up:pts.at(-1)>=pts[0]});
    },400);
  }

  // ── 파생 변수 ─────────────────────────────────────────────
  const SECTOR_RS=Object.entries(sectorsData).map(([etf,d])=>({name:d.label||etf,etf,market:d.market||"us",chg1W:d.chg1W||0,chg1M:d.chg1M||0,chg1d:d.chg1d||0,members:d.members||[]}));
  const selInfo  = stocks.find(s=>s.ticker===sel);
  const cd       = charts[sel];
  const lastD    = cd?.data?.at(-1);
  const sliced   = cd?.data?.slice(-PERIOD_DAYS[period])||[];
  const tstSig   = getTSTSig(cd?.data);
  const finalSig = tstSig.sig==="N/A"?"HOLD":tstSig.sig;
  const fs       = SIG[finalSig]||SIG.HOLD;
  const unit     = sel?.length>5?"원":"$";
  const curPrice = selInfo?.price||0;
  const stopPrice= curPrice>0?+(curPrice*(1-stopPct/100)).toFixed(unit==="원"?0:2):0;
  const w52High     = lastD?.w52High || 0;
  // R:R 역산 목표가 (손절기준 2:1, 3:1)
  const rrTarget2   = stopPrice>0&&curPrice>stopPrice ? +(curPrice+(curPrice-stopPrice)*2).toFixed(isKRSel?0:2) : 0;
  const rrTarget3   = stopPrice>0&&curPrice>stopPrice ? +(curPrice+(curPrice-stopPrice)*3).toFixed(isKRSel?0:2) : 0;
  // 매물대 저항선
  const resistLevels = cd?.data ? findResistanceLevels(cd.data.map(d=>({high:d.close*1.005,low:d.close*.995})), curPrice) : [];
  const resist1 = resistLevels[0]?.price || 0;
  const resist2 = resistLevels[1]?.price || 0;
  // 최종 목표가 (1순위: R:R 2:1, 없으면 52주 고점)
  const consTgt     = rrTarget2 || w52High || selInfo?.target || 0;
  const rrRatio     = stopPrice>0&&consTgt>0&&curPrice>stopPrice?+((consTgt-curPrice)/(curPrice-stopPrice)).toFixed(1):0;
  const checkOk  = Object.values(checklist).every(Boolean);
  const isKRSel  = (sel?.length||0)>5;

  const vixVal      = parseFloat(indicesData["^VIX"]?.price||20);
  const spChg3d     = indicesData["^GSPC"]?.chg3d??0;
  const kospiChg3d  = indicesData["^KS11"]?.chg3d??0;
  const oppScore    = calcOpportunityScore(vixVal,spChg3d,kospiChg3d,SECTOR_RS);
  const oppLabel    = oppScore>=70?"HIGH":oppScore>=45?"MODERATE":"LOW";
  const oppColor    = oppScore>=70?C.emerald:oppScore>=45?C.yellow:C.red;

  // 5번: 진입 평점
  const entryScore  = calcEntryScore(cd?.data, vixVal, oppScore);
  const entryGradeColor = {S:C.emerald,A:C.green,B:C.yellow,C:"#fb923c",D:C.red}[entryScore.grade]||C.muted;

  const idxRS = {
    spy:  {chg3d:indicesData["^GSPC"]?.chg3d??-1.6,chg5d:indicesData["^GSPC"]?.chg5d??-2.0},
    qqq:  {chg3d:indicesData["^IXIC"]?.chg3d??-2.1,chg5d:indicesData["^IXIC"]?.chg5d??-2.8},
    kospi:{chg3d:indicesData["^KS11"]?.chg3d??+0.8,chg5d:indicesData["^KS11"]?.chg5d??-0.5},
  };

  const alphaHits=stocks.filter(s=>{
    const isKR=(s.market||"").includes("kr")||(s.ticker||"").length>5;
    const minCap=isKR?5000:5;
    if((s.mktCap||0)>0&&(s.mktCap||0)<minCap)return false;
    if((s.volRatio||100)<fVolRatio)return false;
    // 시장 필터
    if(fMarket==="kr"&&!isKR)return false;
    if(fMarket==="us"&&isKR)return false;
    return true;
  }).map(s=>{
    const r=alphaScore(s,charts[s.ticker]?.data,idxRS);
    const last=charts[s.ticker]?.data?.at(-1);
    const stCount=[last?.st1Bull,last?.st2Bull,last?.st3Bull].filter(v=>v!=null).length;
    const cloudSt=last?.aboveCloud?"above":last?.nearCloud?"near":"below";
    const rsVal=r.rs||0;
    // RS 필터
    if(fRS>0&&rsVal<fRS)return{...s,...r,_hide:true};
    // 일목 필터
    if(fCloud==="above"&&cloudSt!=="above")return{...s,...r,_hide:true};
    if(fCloud==="near"&&cloudSt==="below")return{...s,...r,_hide:true};
    // ST 필터
    if(fST>0&&stCount<fST)return{...s,...r,_hide:true};
    return{...s,score:r.score,signals:r.signals,rs:r.rs,volRatio:r.volRatio,stCount,cloudSt};
  }).filter(s=>s.score>0&&!s._hide).sort((a,b)=>b.score-a.score);

  // 13번: 권장 매수금액 계산
  const perStockMax = riskSettings.totalCapital*(riskSettings.maxWeightPct/100);
  const pyramidAmts = [0.25,0.25,0.25,0.25].map(r=>Math.round(perStockMax*r));
  const currentExposure = positions.length;
  const overPositions   = currentExposure>=riskSettings.maxPositions;

  const TABS=[["radar","🌐 Market"],["alpha","🔍 Discover"],["sniper","📊 Chart"],["track",`📁 추적 (${tracking.length+positions.length})`],["pool","🗃 풀"]];

  const pageStyle={minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'-apple-system','SF Pro Display','Pretendard','DM Sans',sans-serif",display:"flex",flexDirection:"column",fontSize:12};

  const RSBar=()=>(
    <div style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:9,padding:"10px 14px",marginBottom:12}}>
      <div style={{fontSize:9,fontWeight:700,color:C.muted,marginBottom:7}}>📊 지수 RS 기준선</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
        {[["S&P 500",idxRS.spy],["NASDAQ",idxRS.qqq],["KOSPI",idxRS.kospi]].map(([name,d])=>(
          <div key={name} style={{textAlign:"center"}}>
            <div style={{fontSize:8,color:C.muted,marginBottom:3}}>{name}</div>
            <div style={{display:"flex",gap:3,justifyContent:"center"}}>
              {[["3D",d.chg3d],["5D",d.chg5d]].map(([lbl,v])=>(
                <span key={lbl} style={{fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:4,border:`1px solid ${v>=0?"rgba(34,197,94,.35)":"rgba(239,68,68,.35)"}`,background:v>=0?"rgba(34,197,94,.08)":"rgba(239,68,68,.08)",color:v>=0?C.green:C.red}}>{lbl} {v>=0?"+":""}{v}%</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={pageStyle}>
      <style>{`
        @keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes ap{0%,100%{border-color:rgba(239,68,68,.8)}50%{border-color:rgba(239,68,68,.2)}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-thumb{background:rgba(56,189,248,.2);border-radius:2px}
        input,select,textarea,button{font-family:inherit}
      `}</style>

      {/* ── 헤더 ─────────────────────────────────── */}
      <div style={{borderBottom:"1px solid rgba(255,255,255,.08)",padding:"10px 16px",background:"rgba(0,0,0,.97)",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",position:"sticky",top:0,zIndex:50}}>
        <div>
          <div style={{fontSize:15,fontWeight:800,color:"#ffffff",letterSpacing:.5}}>✦ Vega <span style={{fontSize:9,color:"rgba(255,255,255,.4)",fontWeight:400,letterSpacing:1}}>v1.0</span></div>
          <div style={{fontSize:8,color:"rgba(255,255,255,.35)"}}>시장 → 업종 → 종목발굴 → 차트 → 매매</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          {dataStatus==="loading"&&<div style={{display:"flex",gap:2,alignItems:"center",color:"rgba(255,255,255,.5)",fontSize:8}}>{[0,1,2].map(i=><div key={i} style={{width:3,height:3,borderRadius:"50%",background:"#60a5fa",animation:`bounce 1s ${i*.2}s infinite`}}/>)}로딩중</div>}
          {dataStatus==="real"&&<span style={{fontSize:8,color:"#86efac"}}>● 실시간{lastUpdated?` ${new Date(lastUpdated).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}`:""}</span>}
          {dataStatus==="sim"&&<span style={{fontSize:8,color:"#fcd34d"}}>● 시뮬레이션</span>}
        </div>
        {/* 포지션 사이징 버튼 */}
        <button onClick={()=>setShowRiskPanel(v=>!v)} style={{...css.btn(showRiskPanel),fontSize:8,padding:"3px 8px"}}>⚙ 리스크설정</button>
        {/* 리스크 설정 패널 */}
        {showRiskPanel&&<div style={{position:"absolute",top:"100%",left:14,right:14,background:C.panel,border:`1px solid ${C.border}`,borderRadius:12,padding:16,zIndex:100,boxShadow:"0 8px 32px rgba(0,0,0,.12)",boxShadow:"0 8px 32px rgba(0,0,0,.8)"}}>
          <div style={{fontSize:11,fontWeight:900,color:C.accent,marginBottom:10}}>⚙ 포지션 사이징 & 리스크 관리</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
            <div>
              <div style={{fontSize:9,color:C.muted,marginBottom:4}}>총 투자금</div>
              <input type="number" value={riskSettings.totalCapital} onChange={e=>setRiskSettings(p=>({...p,totalCapital:+e.target.value}))} style={{width:"100%",background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 8px",color:C.text,fontSize:10,outline:"none"}}/>
              <div style={{fontSize:8,color:C.muted,marginTop:2}}>₩{riskSettings.totalCapital.toLocaleString()}</div>
            </div>
            <div>
              <div style={{fontSize:9,color:C.muted,marginBottom:4}}>최대 종목 수</div>
              <input type="range" min="3" max="20" value={riskSettings.maxPositions} onChange={e=>setRiskSettings(p=>({...p,maxPositions:+e.target.value}))} style={{width:"100%",accentColor:C.accent}}/>
              <div style={{fontSize:10,fontWeight:700,color:C.accent,textAlign:"center"}}>{riskSettings.maxPositions}종목</div>
            </div>
            <div>
              <div style={{fontSize:9,color:C.muted,marginBottom:4}}>종목당 최대 비중</div>
              <input type="range" min="10" max="50" step="5" value={riskSettings.maxWeightPct} onChange={e=>setRiskSettings(p=>({...p,maxWeightPct:+e.target.value}))} style={{width:"100%",accentColor:C.emerald}}/>
              <div style={{fontSize:10,fontWeight:700,color:C.emerald,textAlign:"center"}}>{riskSettings.maxWeightPct}%</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
            <div>
              <div style={{fontSize:9,color:C.muted,marginBottom:4}}>초기 손절 %</div>
              <input type="range" min="3" max="20" value={trailSettings.initialStopPct} onChange={e=>setTrailSettings(p=>({...p,initialStopPct:+e.target.value}))} style={{width:"100%",accentColor:C.red}}/>
              <div style={{fontSize:10,fontWeight:700,color:C.red,textAlign:"center"}}>-{trailSettings.initialStopPct}%</div>
            </div>
            <div>
              <div style={{fontSize:9,color:C.muted,marginBottom:4}}>트레일링 %</div>
              <input type="range" min="3" max="20" value={trailSettings.trailPct} onChange={e=>setTrailSettings(p=>({...p,trailPct:+e.target.value}))} style={{width:"100%",accentColor:C.yellow}}/>
              <div style={{fontSize:10,fontWeight:700,color:C.yellow,textAlign:"center"}}>고점-{trailSettings.trailPct}%</div>
            </div>
            <div>
              <div style={{fontSize:9,color:C.muted,marginBottom:4}}>트레일링 전환 기준</div>
              <input type="range" min="3" max="30" value={trailSettings.switchPct} onChange={e=>setTrailSettings(p=>({...p,switchPct:+e.target.value}))} style={{width:"100%",accentColor:C.emerald}}/>
              <div style={{fontSize:10,fontWeight:700,color:C.emerald,textAlign:"center"}}>+{trailSettings.switchPct}% 이상</div>
            </div>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}>
            <div style={{fontSize:8,color:C.muted}}>종목당 최대 투자: ₩{perStockMax.toLocaleString()} · 1차 25%: ₩{pyramidAmts[0].toLocaleString()}</div>
            <button onClick={()=>setShowRiskPanel(false)} style={{...css.btn(),fontSize:9}}>닫기</button>
          </div>
        </div>}
        <div style={{position:"relative",marginLeft:"auto"}}>
          <input value={search} onChange={e=>{setSearch(e.target.value);setShowSearch(true);}} onFocus={()=>setShowSearch(true)}
            onKeyDown={e=>{if(e.key==="Enter"&&search.trim()){const q=search.trim(),qUp=q.toUpperCase();const krMatch=KR_NAME_DB[q]||KR_NAME_DB[qUp]||Object.entries(KR_NAME_DB).find(([k])=>k.includes(q))?.[1];const ticker=krMatch||qUp;const found=[...stocks,...Object.entries(SEARCH_DB).map(([t,v])=>({ticker:t,...v}))].find(s=>s.ticker===ticker);if(found)addStock(found);else addStock({ticker,label:q,_custom:true});setShowSearch(false);}}}
            placeholder="🔍 티커 입력 후 엔터" style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 10px",color:C.text,fontSize:10,outline:"none",width:165}}/>
          {(showSearch&&(searchLoading||searchRes.length>0))&&<div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:"#0f172a",border:`1px solid ${C.border}`,borderRadius:7,zIndex:200,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,.8)"}}>
            {searchLoading&&<div style={{padding:"10px 12px",color:C.muted,fontSize:10}}>🔍 검색 중...</div>}
            {!searchLoading&&searchRes.map((r,i)=><div key={i} onClick={()=>addStock(r)} style={{padding:"7px 11px",cursor:"pointer",borderBottom:"1px solid rgba(99,102,241,.08)",display:"flex",justifyContent:"space-between"}} onMouseEnter={e=>e.currentTarget.style.background="#ede9fe"} onMouseLeave={e=>e.currentTarget.style.background=""}><span style={{color:r._custom?C.accent:C.text,fontWeight:700}}>{r.label} <span style={{color:C.muted,fontSize:8}}>{r._custom?"":r.ticker}</span></span><span style={{color:r._custom?C.accent:C.sub,fontSize:8}}>{r.market||"🔍"}</span></div>)}
          </div>}
        </div>
        {addMsg&&<span style={{color:C.green,fontSize:9}}>{addMsg}</span>}
        <div style={{display:"flex",borderRadius:8,overflow:"hidden",border:"1px solid rgba(255,255,255,.1)",marginLeft:"auto"}}>
          {TABS.map(([k,l],i)=><button key={k} onClick={()=>setTab(k)} style={{background:tab===k?"rgba(56,189,248,.18)":"transparent",color:tab===k?C.accent:"rgba(255,255,255,.55)",border:"none",padding:"6px 11px",cursor:"pointer",fontSize:9,fontWeight:tab===k?700:400,whiteSpace:"nowrap",transition:"all .15s"}}>{l}</button>)}
        </div>
      </div>

      {/* ── 종목바 ───────────────────────────────── */}
      <div style={{display:"flex",gap:3,padding:"4px 12px",overflowX:"auto",borderBottom:"1px solid rgba(99,115,140,.12)",background:"rgba(0,0,0,.3)",alignItems:"center",flexShrink:0}}>
        <span style={{color:C.muted,fontSize:8,flexShrink:0}}>{stocks.length}종목</span>
        {stocks.map(stk=>{
          const sg=getStockSig(charts[stk.ticker]?.data);
          const ss=SIG[sg]||SIG.HOLD;
          return<div key={stk.ticker} style={{flexShrink:0,display:"flex"}}>
            <button onClick={()=>{setSel(stk.ticker);setTab("sniper");}} style={{background:sel===stk.ticker?"rgba(56,189,248,.18)":"transparent",border:`1px solid ${sel===stk.ticker?C.accent:C.border}`,borderRadius:"4px 0 0 4px",padding:"2px 5px",cursor:"pointer",display:"flex",flexDirection:"column"}}>
              <div style={{display:"flex",gap:2,alignItems:"center"}}>
                <span style={{color:sel===stk.ticker?C.accent:C.text,fontSize:9,fontWeight:700}}>{stk.label}</span>
                <span style={{...ss,borderRadius:3,padding:"0 3px",fontWeight:900,fontSize:7,display:"inline-block"}}>{sg[0]}</span>
              </div>
              {stk.changePct!=null&&<span style={{fontSize:7,color:stk.changePct>=0?C.green:C.red}}>{stk.changePct>=0?"+":""}{stk.changePct?.toFixed?.(1)}%</span>}
            </button>
            <button onClick={()=>removeStock(stk.ticker)} style={{background:"rgba(239,68,68,.06)",border:`1px solid ${C.border}`,borderLeft:"none",borderRadius:"0 4px 4px 0",padding:"2px 4px",cursor:"pointer",color:C.muted,fontSize:8}}>✕</button>
          </div>;
        })}
      </div>

      {/* ── 콘텐츠 ───────────────────────────────── */}
      <div style={{flex:1,overflow:"auto"}} onClick={()=>setShowSearch(false)}>

        {/* ══ TAB 1: 시장레이더 ══ */}
        {tab==="radar"&&<div style={{padding:"12px 16px"}}>
          {/* 흐름 배너 */}
          <div style={{background:"linear-gradient(135deg,#0f172a,#1e293b)",borderRadius:10,padding:"12px 16px",marginBottom:14,color:"#fff"}}>
            <div style={{fontSize:11,fontWeight:700,marginBottom:4}}>🌐 시장 현황 파악</div>
            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:9,color:"rgba(255,255,255,.6)"}}>
              <span style={{background:"rgba(59,130,246,.4)",borderRadius:4,padding:"2px 7px",color:"#fff",fontWeight:700}}>① 시장 확인 ←지금</span>
              <span>→</span>
              <span style={{background:"rgba(255,255,255,.08)",borderRadius:4,padding:"2px 7px"}}>② 주도업종 선택</span>
              <span>→</span>
              <span style={{background:"rgba(255,255,255,.08)",borderRadius:4,padding:"2px 7px"}}>③ 종목 필터</span>
              <span>→</span>
              <span style={{background:"rgba(255,255,255,.08)",borderRadius:4,padding:"2px 7px"}}>④ 차트 검증</span>
            </div>
            <div style={{fontSize:9,color:"rgba(255,255,255,.4)",marginTop:6}}>
              OppScore {oppScore}점 ({oppLabel}) · VIX {vixVal.toFixed(1)} · KR {kospiChg3d>=0?"+":""}{kospiChg3d.toFixed(1)}% · US {spChg3d>=0?"+":""}{spChg3d.toFixed(1)}%
            </div>
          </div>
          <div style={{fontSize:11,fontWeight:700,color:C.text,marginBottom:10,paddingLeft:2}}>지수 현황</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:8}}>
            {[["^GSPC","S&P 500","🇺🇸"],["^IXIC","NASDAQ","🇺🇸"],["^KS11","KOSPI","🇰🇷"]].map(([k,name,flag])=>{
              const d=indicesData[k];const pct=d?.changePct??0;const hasData=d&&d.price>0;
              return<div key={k} style={{border:`1px solid ${hasData?(pct>=0?"rgba(34,197,94,.3)":"rgba(239,68,68,.3)"):C.border}`,borderRadius:8,padding:"10px 12px",background:"rgba(255,255,255,.04)"}}>
                <div style={{fontSize:9,color:C.muted,marginBottom:4}}>{flag} {name}</div>
                <div style={{fontSize:22,fontWeight:900,marginBottom:2}}>{hasData?d.price.toLocaleString("ko-KR",{maximumFractionDigits:2}):"—"}</div>
                <div style={{color:pct>=0?C.green:C.red,fontWeight:700,fontSize:13}}>{hasData?`${pct>=0?"+":""}${(pct||0).toFixed(2)}% ${pct>=0?"▲":"▼"}`:"—"}</div>
                {hasData&&<div style={{fontSize:8,color:C.muted,marginTop:3}}>3일 {(d.chg3d||0)>=0?"+":""}{(d.chg3d||0).toFixed(1)}%</div>}
              </div>;
            })}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:14}}>
            {[["^VIX","VIX","⚡",v=>v<20?"안정":v<30?"주의":"위험",v=>v<20?C.emerald:v<30?C.yellow:C.red],
              ["KRW=X","USD/KRW","💱",v=>`${v?.toFixed(0)||"—"}원`,()=>C.text],
              ["^TNX","미국10Y","📈",v=>`${v?.toFixed(2)||"—"}%`,v=>v>4.5?C.red:v>3.5?C.yellow:C.emerald],
              ["GC=F","금","🥇",v=>`$${v?.toLocaleString()||"—"}`,()=>C.text],
            ].map(([k,name,flag,fmt,color])=>{
              const d=indicesData[k];const val=d?.price;const pct=d?.changePct??0;
              return<div key={k} style={{border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px",background:"rgba(255,255,255,.04)"}}>
                <div style={{fontSize:8,color:C.muted,marginBottom:2}}>{flag} {name}</div>
                <div style={{fontSize:13,fontWeight:900,margin:"2px 0",color:color(val)}}>{val?fmt(val):"—"}</div>
                <div style={{fontSize:9,color:pct>=0?C.green:C.red,fontWeight:700}}>{pct>=0?"+":""}{(pct||0).toFixed(2)}%</div>
              </div>;
            })}
          </div>

          <div style={{...css.card,marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:11,fontWeight:700,color:C.text}}>📊 섹터 RS 히트맵</div>
                <select value={rsKey} onChange={e=>setRsKey(e.target.value)} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(99,102,241,.18)",borderRadius:6,padding:"3px 8px",color:C.text,fontSize:9,cursor:"pointer"}}>
                  <option value="chg1W">1주</option><option value="chg1M">1개월</option>
                </select>
              </div>
              {/* 미국 섹터 — S&P 비교 */}
              {(()=>{
                const usSectors=[...SECTOR_RS].filter(s=>s.market==="us").sort((a,b)=>b[rsKey]-a[rsKey]);
                if(!usSectors.length)return null;
                const spRef=rsKey==="chg1W"?(idxRS.spy?.chg3d||0):(idxRS.spy?.chg5d||0);
                return<div style={{marginBottom:10}}>
                  <div style={{fontSize:9,fontWeight:700,color:C.muted,marginBottom:5}}>🇺🇸 미국 vs S&P500</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:3}}>
                    {usSectors.map((sec,i)=>{
                      const v=sec[rsKey],excess=+(v-spRef).toFixed(1),isTop=i<2;
                      const bg=excess>=3?"#dcfce7":excess>=0?"#f0fdf4":excess>-3?"#fef9c3":"#fee2e2";
                      const tc=excess>=3?"#15803d":excess>=0?"#166534":excess>-3?"#92400e":"#991b1b";
                      return<div key={sec.etf} onClick={()=>setSelectedSector(selectedSector===sec.etf?null:sec.etf)} style={{background:bg,borderRadius:6,padding:"5px 6px",border:selectedSector===sec.etf?"2px solid #3b82f6":isTop?"1px solid #86efac":"1px solid transparent",cursor:"pointer",textAlign:"center"}}>
                        <div style={{fontSize:8,fontWeight:600,color:C.sub,marginBottom:1}}>{sec.name}</div>
                        <div style={{fontSize:12,fontWeight:800,color:tc}}>{v>=0?"+":""}{v}%</div>
                        <div style={{fontSize:7,color:excess>=0?"#15803d":"#991b1b"}}>vs SP {excess>=0?"+":""}{excess}</div>
                      </div>;
                    })}
                  </div>
                </div>;
              })()}
              {/* 한국 섹터 — 코스피 비교 */}
              {(()=>{
                const krSectors=[...SECTOR_RS].filter(s=>s.market==="kr").sort((a,b)=>b[rsKey]-a[rsKey]);
                if(!krSectors.length)return null;
                const ksRef=rsKey==="chg1W"?(idxRS.kospi?.chg3d||0):(idxRS.kospi?.chg5d||0);
                return<div>
                  <div style={{fontSize:9,fontWeight:700,color:C.muted,marginBottom:5}}>🇰🇷 한국 vs KOSPI</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:3}}>
                    {krSectors.map((sec,i)=>{
                      const v=sec[rsKey],excess=+(v-ksRef).toFixed(1),isTop=i<2;
                      const bg=excess>=3?"#dcfce7":excess>=0?"#f0fdf4":excess>-3?"#fef9c3":"#fee2e2";
                      const tc=excess>=3?"#15803d":excess>=0?"#166534":excess>-3?"#92400e":"#991b1b";
                      return<div key={sec.etf} onClick={()=>setSelectedSector(selectedSector===sec.etf?null:sec.etf)} style={{background:bg,borderRadius:6,padding:"5px 6px",border:selectedSector===sec.etf?"2px solid #3b82f6":isTop?"1px solid #86efac":"1px solid transparent",cursor:"pointer",textAlign:"center"}}>
                        <div style={{fontSize:8,fontWeight:600,color:C.sub,marginBottom:1}}>{sec.name}</div>
                        <div style={{fontSize:12,fontWeight:800,color:tc}}>{v>=0?"+":""}{v}%</div>
                        <div style={{fontSize:7,color:excess>=0?"#15803d":"#991b1b"}}>vs KS {excess>=0?"+":""}{excess}</div>
                      </div>;
                    })}
                  </div>
                </div>;
              })()}
              {/* 선택된 섹터 구성종목 */}
              {selectedSector&&(()=>{
                const sec=SECTOR_RS.find(s=>s.etf===selectedSector);
                if(!sec||!sec.members?.length)return null;
                return<div style={{marginTop:10,background:"rgba(56,189,248,.1)",border:"1px solid #bfdbfe",borderRadius:8,padding:"8px 10px"}}>
                  <div style={{fontSize:9,fontWeight:700,color:C.accent,marginBottom:6}}>{sec.name} 구성종목</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                    {sec.members.map(ticker=>{
                      const s=stocks.find(x=>x.ticker===ticker);
                      const inWatch=watchlist.find(w=>w.ticker===ticker);
                      return<div key={ticker} style={{background:C.panel2,borderRadius:5,padding:"4px 8px",display:"flex",gap:6,alignItems:"center"}}>
                        <span style={{fontSize:9,fontWeight:700,color:C.text}}>{s?.label||ticker}</span>
                        {s?.changePct!=null&&<span style={{fontSize:8,color:(s.changePct||0)>=0?C.green:C.red}}>{(s.changePct||0)>=0?"+":""}{(s.changePct||0).toFixed(1)}%</span>}
                        <button onClick={e=>{e.stopPropagation();inWatch?setWatchlist(w=>w.filter(x=>x.ticker!==ticker)):setWatchlist(w=>[...w,{...(s||{ticker,label:ticker})}]);}} style={{background:"none",border:"none",color:inWatch?"#3b82f6":C.muted,cursor:"pointer",fontSize:11,padding:0}}>{inWatch?"★":"☆"}</button>
                      </div>;
                    })}
                  </div>
                </div>;
              })()}
            </div>
          {/* 상승/하락 비율 + OppScore */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
              <div style={css.card}>
                <div style={{fontSize:10,fontWeight:700,color:C.text,marginBottom:10}}>📊 상승/하락 비율</div>
                {[["🇰🇷 한국","kr"],["🇺🇸 미국","us"]].map(([label,mkt])=>{
                  const d=breadthData[mkt]||{upPct:0,up:0,down:0};
                  return<div key={mkt} style={{marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <span style={{fontSize:9,color:C.sub}}>{label}</span>
                      <span style={{fontSize:9,fontWeight:700,color:d.upPct>=50?C.green:C.red}}>{d.upPct}% 상승</span>
                    </div>
                    <div style={{height:7,background:"rgba(255,255,255,.06)",borderRadius:4,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${d.upPct}%`,background:d.upPct>=50?C.emerald:C.red,borderRadius:4,transition:"width .5s"}}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}>
                      <span style={{fontSize:7,color:C.green}}>▲{d.up}</span>
                      <span style={{fontSize:7,color:C.red}}>▼{d.down}</span>
                    </div>
                  </div>;
                })}
              </div>
              <div style={{...css.card,textAlign:"center",border:`2px solid ${oppColor}`}}>
                <div style={{fontSize:9,color:C.muted,marginBottom:4}}>Opportunity Score</div>
                <div style={{fontSize:36,fontWeight:900,color:oppColor,lineHeight:1}}>{oppScore}<span style={{fontSize:11,color:C.muted}}>/100</span></div>
                <div style={{fontSize:10,fontWeight:700,color:oppColor,marginTop:4,padding:"2px 10px",background:`${oppColor}18`,borderRadius:5,display:"inline-block"}}>{oppLabel}</div>
                <div style={{display:"flex",justifyContent:"space-around",marginTop:8,fontSize:8,color:C.muted}}>
                  <span>KR {kospiChg3d>=0?"+":""}{kospiChg3d.toFixed(1)}%</span>
                  <span>US {spChg3d>=0?"+":""}{spChg3d.toFixed(1)}%</span>
                  <span>VIX {vixVal.toFixed(1)}</span>
                </div>
              </div>
            </div>
        </div>}

        {/* ══ TAB 2: 알파헌터 ══ */}
        {tab==="alpha"&&<div style={{padding:"12px 16px"}}>
          {/* 흐름 안내 배너 */}
          <div style={{background:"linear-gradient(135deg,#0f172a,#1e293b)",borderRadius:10,padding:"12px 16px",marginBottom:14,color:"#fff"}}>
            <div style={{fontSize:11,fontWeight:700,marginBottom:4}}>🔍 종목 발굴 흐름</div>
            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:9,color:"rgba(255,255,255,.6)"}}>
              <span style={{background:"rgba(255,255,255,.08)",borderRadius:4,padding:"2px 7px",color:"#93c5fd"}}>① 시장 확인</span>
              <span>→</span>
              <span style={{background:"rgba(255,255,255,.08)",borderRadius:4,padding:"2px 7px",color:"#86efac"}}>② 주도업종 선택</span>
              <span>→</span>
              <span style={{background:"rgba(59,130,246,.3)",borderRadius:4,padding:"2px 7px",color:"#fff",fontWeight:700}}>③ 조건 필터링 ←지금</span>
              <span>→</span>
              <span style={{background:"rgba(255,255,255,.08)",borderRadius:4,padding:"2px 7px",color:"rgba(255,255,255,.5)"}}>④ 차트 검증</span>
            </div>
          </div>

          <div style={{display:"flex",gap:4,marginBottom:12}}>
            {[["filter","🔍 조건필터"],["pattern","📐 패턴감지"],["compare","⚖️ 비교뷰"]].map(([k,l])=>(
              <button key={k} onClick={()=>setAlphaTab(k)} style={{flex:1,padding:"7px 0",borderRadius:8,border:`1px solid ${alphaTab===k?C.accent:"rgba(99,115,140,.2)"}`,background:alphaTab===k?"rgba(56,189,248,.15)":"rgba(255,255,255,.03)",color:alphaTab===k?C.accent:C.muted,fontWeight:alphaTab===k?700:400,fontSize:10,cursor:"pointer"}}>{l}</button>
            ))}
          </div>

          {alphaTab==="filter"&&<div>
            {/* 필터 카드 */}
            <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:14,marginBottom:12}}>
              <div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:12}}>🎯 종목 필터 조건</div>

              {/* 1행: 시장 + ST */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:C.sub,marginBottom:6}}>🌏 시장</div>
                  <div style={{display:"flex",gap:4}}>
                    {[["all","전체"],["kr","🇰🇷 한국"],["us","🇺🇸 미국"]].map(([v,l])=>(
                      <button key={v} onClick={()=>setFMarket(v)} style={{flex:1,padding:"5px 0",borderRadius:6,border:`1px solid ${fMarket===v?C.accent:"rgba(99,115,140,.2)"}`,background:fMarket===v?"rgba(56,189,248,.2)":"rgba(255,255,255,.04)",color:fMarket===v?C.accent:C.muted,fontSize:9,fontWeight:fMarket===v?700:400,cursor:"pointer"}}>{l}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:C.sub,marginBottom:6}}>📈 슈퍼트랜드 최소 <span style={{color:C.accent,fontWeight:700}}>{fST === 0 ? "전체" : `${fST}개 이상`}</span></div>
                  <div style={{display:"flex",gap:4}}>
                    {[[0,"전체"],[1,"1개+"],[2,"2개+"],[3,"3개(풀)"]].map(([v,l])=>(
                      <button key={v} onClick={()=>setFST(v)} style={{flex:1,padding:"5px 0",borderRadius:6,border:`1px solid ${fST===v?C.accent:"rgba(99,115,140,.2)"}`,background:fST===v?"rgba(56,189,248,.2)":"rgba(255,255,255,.04)",color:fST===v?C.accent:C.muted,fontSize:8,fontWeight:fST===v?700:400,cursor:"pointer"}}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 2행: 일목구름 + RS */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:C.sub,marginBottom:6}}>☁️ 일목구름 위치</div>
                  <div style={{display:"flex",gap:4}}>
                    {[["all","전체"],["near","구름접근+"],["above","구름위만"]].map(([v,l])=>(
                      <button key={v} onClick={()=>setFCloud(v)} style={{flex:1,padding:"5px 0",borderRadius:6,border:`1px solid ${fCloud===v?C.accent:"rgba(99,115,140,.2)"}`,background:fCloud===v?"rgba(56,189,248,.2)":"rgba(255,255,255,.04)",color:fCloud===v?C.accent:C.muted,fontSize:8,fontWeight:fCloud===v?700:400,cursor:"pointer"}}>{l}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:C.sub,marginBottom:6}}>💪 RS강도 <span style={{color:C.accent,fontWeight:700}}>{fRS > 0 ? `+${fRS}%p 이상` : "전체"}</span></div>
                  <input type="range" min="0" max="10" step="0.5" value={fRS} onChange={e=>setFRS(+e.target.value)} style={{width:"100%",accentColor:C.accent,marginTop:4}}/>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:C.muted,marginTop:2}}>
                    <span>전체</span><span>+5%p</span><span>+10%p</span>
                  </div>
                </div>
              </div>

              {/* 3행: 거래대금 */}
              <div>
                <div style={{fontSize:10,fontWeight:600,color:C.sub,marginBottom:6}}>💰 거래대금비율 <span style={{color:C.accent,fontWeight:700}}>{fVolRatio > 0 ? `${fVolRatio}% 이상` : "전체"}</span> <span style={{fontSize:8,color:C.muted}}>(20일 평균 대비)</span></div>
                <input type="range" min="0" max="300" step="10" value={fVolRatio} onChange={e=>setFVolRatio(+e.target.value)} style={{width:"100%",accentColor:C.accent}}/>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:C.muted,marginTop:2}}>
                  <span>전체</span><span>100% (평균)</span><span>200% (급증)</span><span>300%</span>
                </div>
              </div>

              {/* 결과 카운트 + 리셋 */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,paddingTop:12,borderTop:"1px solid rgba(99,115,140,.1)"}}>
                <div style={{fontSize:13,fontWeight:700,color:C.accent}}>✅ {alphaHits.length}개 통과</div>
                <button onClick={()=>{setFMarket("all");setFST(0);setFCloud("all");setFRS(0);setFVolRatio(60);}} style={{fontSize:9,padding:"4px 10px",borderRadius:6,border:"1px solid rgba(99,102,241,.18)",background:"rgba(255,255,255,.04)",color:C.muted,cursor:"pointer"}}>초기화</button>
              </div>
            </div>
            {alphaHits.length===0
              ?<div style={{textAlign:"center",padding:"30px 0",color:C.muted}}>조건을 완화하거나 종목을 추가해보세요</div>
              :<div>
                {[["🇰🇷","한국",alphaHits.filter(s=>(s.market||"").includes("🇰🇷")||(s.ticker?.length||0)>5)],
                  ["🇺🇸","미국",alphaHits.filter(s=>!((s.market||"").includes("🇰🇷")||(s.ticker?.length||0)>5))]
                ].map(([flag,label,hits])=>hits.length===0?null:(
                  <div key={label} style={{marginBottom:16}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                      <span style={{fontSize:10,fontWeight:700,color:C.text}}>{flag} {label}</span>
                      <span style={{fontSize:9,color:C.muted,background:C.bg,borderRadius:4,padding:"1px 7px",border:"1px solid rgba(99,102,241,.2)"}}>{hits.length}개</span>
                    </div>
                    <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,minWidth:520}}>
                      <thead>
                        <tr style={{background:"rgba(255,255,255,.04)",borderBottom:"2px solid rgba(99,102,241,.15)"}}>
                          {["종목","점수","RS","거래량%","3일","5일","일목","ST","진입등급",""].map(h=>(
                            <th key={h} style={{padding:"6px 8px",textAlign:"left",color:C.purple,fontSize:8,fontWeight:700,whiteSpace:"nowrap"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {hits.map((stock,i)=>{
                          const cdc=charts[stock.ticker]?.data;
                          const lD=cdc?.at(-1);
                          const iSt=lD?.aboveCloud?"above":lD?.nearCloud?"near":"below";
                          const stC=[lD?.st1Bull,lD?.st2Bull,lD?.st3Bull].filter(v=>v!=null).length;
                          const es=calcEntryScore(cdc,vixVal,oppScore);
                          const isGold=(stock.score||0)>=85;
                          const inW=watchlist.find(w=>w.ticker===stock.ticker);
                          return(
                            <tr key={stock.ticker} style={{background:isGold?"rgba(251,191,36,.08)":i%2===0?C.panel:C.panel2,borderBottom:"1px solid rgba(99,102,241,.07)",cursor:"pointer"}}
                              onClick={()=>{setSel(stock.ticker);setTab("sniper");}}>
                              <td style={{padding:"7px 8px"}}>
                                <div style={{fontWeight:700,fontSize:10,color:C.text}}>{isGold?"✨ ":""}{stock.label}</div>
                                <div style={{fontSize:7,color:C.muted}}>{stock.ticker}</div>
                              </td>
                              <td style={{padding:"7px 8px"}}><span style={{fontWeight:800,fontSize:11,color:isGold?"#d97706":C.accent}}>{stock.score}pt</span></td>
                              <td style={{padding:"7px 8px",fontWeight:700,color:(stock.rs||0)>=3?"#059669":(stock.rs||0)>=0?"#4f46e5":"#dc2626"}}>{(stock.rs||0)>=0?"+":""}{(stock.rs||0).toFixed(1)}</td>
                              <td style={{padding:"7px 8px",color:(stock.volRatio||100)>=150?"#059669":(stock.volRatio||100)>=80?"#64748b":"#dc2626",fontWeight:600}}>{stock.volRatio||"-"}%</td>
                              <td style={{padding:"7px 8px",fontWeight:700,color:(stock.chg3d||0)>=0?"#059669":"#dc2626"}}>{(stock.chg3d||0)>=0?"+":""}{(stock.chg3d||0).toFixed(1)}%</td>
                              <td style={{padding:"7px 8px",fontWeight:700,color:(stock.chg5d||0)>=0?"#059669":"#dc2626"}}>{(stock.chg5d||0)>=0?"+":""}{(stock.chg5d||0).toFixed(1)}%</td>
                              <td style={{padding:"7px 8px"}}>
                                <span style={{fontSize:8,fontWeight:700,padding:"2px 5px",borderRadius:4,background:iSt==="above"?"#dcfce7":iSt==="near"?"#fef3c7":"#fee2e2",color:iSt==="above"?"#15803d":iSt==="near"?"#92400e":"#991b1b"}}>{iSt==="above"?"구름위":iSt==="near"?"접근":"아래"}</span>
                              </td>
                              <td style={{padding:"7px 8px"}}><span style={{fontWeight:700,color:stC===3?"#059669":stC>=2?"#d97706":"#9ca3af"}}>{stC}/3</span></td>
                              <td style={{padding:"7px 8px"}}>
                                <span style={{fontSize:9,fontWeight:800,padding:"2px 6px",borderRadius:4,background:es.grade==="S"?"#fef3c7":es.grade==="A"?"#dcfce7":es.grade==="B"?"#dbeafe":"#f1f5f9",color:es.grade==="S"?"#92400e":es.grade==="A"?"#15803d":es.grade==="B"?"#1d4ed8":"#64748b"}}>{es.grade}</span>
                              </td>
                              <td style={{padding:"7px 6px"}} onClick={e=>e.stopPropagation()}>
                                <div style={{display:"flex",gap:3}}>
                                  <button onClick={()=>{setTracking(p=>[...p,{id:Date.now(),ticker:stock.ticker,label:stock.label,market:stock.market,basePrice:stock.price||0,addedDate:new Date().toLocaleDateString("ko-KR"),foundScore:stock.score,foundSignals:stock.signals,foundRS:stock.rs,oppScoreAt:oppScore}]);setTab("track");setTrackTab("watch");}} style={{background:"rgba(16,185,129,.08)",border:"1px solid #bbf7d0",color:"#15803d",borderRadius:5,padding:"3px 7px",cursor:"pointer",fontSize:8,fontWeight:700}}>추적</button>
                                  <button onClick={()=>{inW?setWatchlist(w=>w.filter(x=>x.ticker!==stock.ticker)):setWatchlist(w=>[...w,{...stock}]);}} style={{background:inW?"rgba(56,189,248,.15)":"rgba(255,255,255,.04)",border:`1px solid ${inW?"#c4b5fd":"rgba(99,102,241,.2)"}`,color:inW?"#7c3aed":"#9ca3af",borderRadius:5,padding:"3px 7px",cursor:"pointer",fontSize:10}}>{inW?"★":"☆"}</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  </div>
                ))}
              </div>
            }
          </div>}

          {alphaTab==="pattern"&&<div style={css.card}>
            <div style={{fontSize:11,fontWeight:700,color:C.accent,marginBottom:4}}>📐 원격 알파 스캔</div>
            {alphaHitsRemote.length>0
              ?alphaHitsRemote.map(h=>(
                  <div key={h.ticker} onClick={()=>{if(!stocks.find(s=>s.ticker===h.ticker))setStocks(p=>[...p,h]);setSel(h.ticker);setTab("sniper");}} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 11px",borderRadius:8,background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,marginBottom:6,cursor:"pointer"}}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:11}}>{h.market==="kr"?"🇰🇷":"🇺🇸"} {h.label}</div>
                      <div style={{fontSize:8,color:C.muted,marginTop:2}}>{(h.signals||[]).join(" · ")}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:14,fontWeight:900,color:C.emerald}}>{h.score}점</div>
                    </div>
                  </div>
                ))
              :<div style={{textAlign:"center",padding:"30px 0",color:C.muted}}>daily Actions 실행 후 결과 표시</div>
            }
          </div>}

          {alphaTab==="compare"&&<div>
            <div style={{...css.card,marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:11,fontWeight:700,color:C.text}}>⚖️ 비교 뷰 <span style={{fontSize:9,color:C.muted,fontWeight:400}}>— 수급필터 ★ 또는 히트맵 ★ 누른 종목</span></div>
                {watchlist.length>0&&<button onClick={()=>setWatchlist([])} style={{fontSize:8,padding:"3px 8px",borderRadius:5,border:"1px solid rgba(99,102,241,.18)",background:"rgba(255,255,255,.04)",color:C.muted,cursor:"pointer"}}>전체 해제</button>}
              </div>
              {watchlist.length===0
                ?<div style={{textAlign:"center",padding:"30px 0",color:C.muted}}>
                    <div style={{fontSize:24,marginBottom:8}}>☆</div>
                    <div style={{fontSize:10}}>수급필터 카드의 ★ 버튼을 눌러 비교에 추가하세요</div>
                  </div>
                :<div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                    <thead>
                      <tr style={{background:"rgba(255,255,255,.04)",borderBottom:"2px solid rgba(99,115,140,.1)"}}>
                        {["종목","현재가","3일","5일","vs시장RS","거래량%","일목","ST","발굴점수",""].map(h=>(
                          <th key={h} style={{padding:"7px 8px",textAlign:"left",color:C.muted,fontSize:8,fontWeight:700}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...watchlist].sort((a,b)=>((b.rs||0)-(a.rs||0))).map((stock,i)=>{
                        const cdc=charts[stock.ticker]?.data;
                        const lD=cdc?.at(-1);
                        const iSt=lD?.aboveCloud?"above":lD?.nearCloud?"near":"below";
                        const stC=[lD?.st1Bull,lD?.st2Bull,lD?.st3Bull].filter(v=>v!=null).length;
                        const isKR=(stock.ticker?.length||0)>5;
                        const rs=stock.rs||((stock.chg5d||0)-(idxRS.spy?.chg5d||0));
                        return(
                          <tr key={stock.ticker} style={{borderBottom:"1px solid rgba(99,115,140,.08)",cursor:"pointer",background:i%2===0?C.panel:C.panel2}}
                            onClick={()=>{setSel(stock.ticker);setTab("sniper");}}>
                            <td style={{padding:"7px 8px"}}>
                              <div style={{fontWeight:700,fontSize:10}}>{stock.market} {stock.label}</div>
                              <div style={{fontSize:7,color:C.muted}}>{stock.ticker}</div>
                            </td>
                            <td style={{padding:"7px 8px",fontWeight:600}}>{isKR?fmtKRW(stock.price||0):((stock.price||0).toFixed(2))}{isKR?"원":"$"}</td>
                            <td style={{padding:"7px 8px",color:(stock.chg3d||0)>=0?C.green:C.red,fontWeight:700}}>{(stock.chg3d||0)>=0?"+":""}{(stock.chg3d||0).toFixed(1)}%</td>
                            <td style={{padding:"7px 8px",color:(stock.chg5d||0)>=0?C.green:C.red,fontWeight:700}}>{(stock.chg5d||0)>=0?"+":""}{(stock.chg5d||0).toFixed(1)}%</td>
                            <td style={{padding:"7px 8px",fontWeight:700,color:rs>=2?"#15803d":rs>=0?"#166534":C.red}}>{rs>=0?"+":""}{rs.toFixed(1)}%p</td>
                            <td style={{padding:"7px 8px",color:(stock.volRatio||100)>=150?C.green:(stock.volRatio||100)>=80?C.muted:C.red,fontWeight:600}}>{stock.volRatio||"-"}%</td>
                            <td style={{padding:"7px 8px"}}>
                              <span style={{fontSize:8,fontWeight:700,padding:"2px 5px",borderRadius:4,background:iSt==="above"?"#dcfce7":iSt==="near"?"#fef3c7":"#fee2e2",color:iSt==="above"?"#15803d":iSt==="near"?"#92400e":"#991b1b"}}>
                                {iSt==="above"?"구름위":iSt==="near"?"접근":"아래"}
                              </span>
                            </td>
                            <td style={{padding:"7px 8px"}}>
                              <span style={{fontSize:8,fontWeight:700,color:stC===3?C.green:stC>=2?C.yellow:C.muted}}>{stC}/3</span>
                            </td>
                            <td style={{padding:"7px 8px",fontWeight:700,color:C.accent}}>{stock.score||"-"}pt</td>
                            <td style={{padding:"7px 8px"}}>
                              <button onClick={e=>{e.stopPropagation();setWatchlist(w=>w.filter(x=>x.ticker!==stock.ticker));}} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:11}}>✕</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              }
            </div>
          </div>}
        </div>}

        {/* ══ TAB 3: 스나이퍼 ══ */}
        {tab==="sniper"&&selInfo&&<div style={{padding:"12px 14px"}}>
          <RSBar/>
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
            <div style={{fontWeight:900,fontSize:15}}>{selInfo.market} {selInfo.label}</div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontWeight:900,fontSize:17}}>{isKRSel?fmtKRW(curPrice):curPrice.toLocaleString(undefined,{maximumFractionDigits:2})}{unit}</span>
              {selInfo.changePct!=null&&<span style={{fontSize:11,fontWeight:700,color:selInfo.changePct>=0?C.green:C.red}}>{selInfo.changePct>=0?"+":""}{selInfo.changePct?.toFixed?.(2)}%</span>}
              {cd?.real&&<span style={{fontSize:7,background:"rgba(34,197,94,.15)",color:C.green,border:"1px solid rgba(34,197,94,.3)",borderRadius:3,padding:"1px 4px"}}>실시간</span>}
            </div>
            <div style={{background:lastD?.allBull?"rgba(16,185,129,.15)":"rgba(239,68,68,.1)",border:`1px solid ${lastD?.allBull?C.emerald:C.red}`,borderRadius:5,padding:"2px 8px",fontSize:9,fontWeight:700,color:lastD?.allBull?C.emerald:C.red}}>{lastD?.allBull?"🟢 3/3 매수배경":"🔴 비매수배경"}</div>
            <div style={{marginLeft:"auto",textAlign:"right"}}>
              <div style={{fontSize:7,color:C.muted}}>종합신호</div>
              <div style={{...fs,borderRadius:5,padding:"2px 10px",fontWeight:900,fontSize:12,border:`1px solid ${fs.border}`,display:"inline-block"}}>{finalSig}</div>
            </div>
          </div>

          {/* ★ 5번: 진입 평점 패널 */}
          <div style={{...css.card,border:`2px solid ${entryGradeColor}`,marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:11,fontWeight:700,color:C.accent}}>🎯 진입 평점 <span style={{fontSize:9,color:C.muted}}>(참고용 · 강제제한 없음)</span></div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{fontSize:28,fontWeight:900,color:entryGradeColor,lineHeight:1}}>{entryScore.score}<span style={{fontSize:11,color:C.muted}}>/100</span></div>
                <div style={{fontSize:22,fontWeight:900,color:entryGradeColor,background:`${entryGradeColor}18`,border:`2px solid ${entryGradeColor}`,borderRadius:8,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center"}}>{entryScore.grade}</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4}}>
              {entryScore.breakdown.map((b,i)=>(
                <div key={i} style={{background:b.ok?"rgba(16,185,129,.08)":"rgba(255,255,255,.03)",border:`1px solid ${b.ok?"rgba(16,185,129,.3)":"rgba(99,115,140,.1)"}`,borderRadius:5,padding:"4px 7px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:9,color:b.ok?C.text:C.muted}}>{b.label}</span>
                  <span style={{fontSize:10,fontWeight:700,color:b.ok?C.emerald:C.muted}}>+{b.pts}</span>
                </div>
              ))}
            </div>
          </div>

          {/* RS 비교 */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:10}}>
            <div style={css.panel2}>
              <div style={{fontSize:8,color:C.muted,marginBottom:3}}>{selInfo.label} 3일</div>
              <div style={{fontSize:17,fontWeight:900,color:(selInfo.chg3d||0)>=0?C.green:C.red}}>{(selInfo.chg3d||0)>=0?"+":""}{(selInfo.chg3d||0).toFixed?.(1)||0}%</div>
              <div style={{fontSize:7,color:C.sub,marginTop:2}}>vs시장 {((selInfo.chg3d||0)-idxRS.spy.chg3d)>=0?"+":""}{((selInfo.chg3d||0)-idxRS.spy.chg3d).toFixed(1)}%p</div>
            </div>
            <div style={css.panel2}>
              <div style={{fontSize:8,color:C.muted,marginBottom:3}}>{selInfo.label} 5일</div>
              <div style={{fontSize:17,fontWeight:900,color:(selInfo.chg5d||0)>=0?C.green:C.red}}>{(selInfo.chg5d||0)>=0?"+":""}{(selInfo.chg5d||0).toFixed?.(1)||0}%</div>
              <div style={{fontSize:7,color:C.sub,marginTop:2}}>vs시장 {((selInfo.chg5d||0)-idxRS.spy.chg5d)>=0?"+":""}{((selInfo.chg5d||0)-idxRS.spy.chg5d).toFixed(1)}%p</div>
            </div>
            <div style={{...css.panel2,background:((selInfo.chg5d||0)-idxRS.spy.chg5d)>0?"rgba(16,185,129,.08)":"rgba(239,68,68,.06)"}}>
              <div style={{fontSize:8,color:C.emerald,marginBottom:3}}>RS 강도</div>
              <div style={{fontSize:16,fontWeight:900,color:((selInfo.chg5d||0)-idxRS.spy.chg5d)>3?C.emerald:((selInfo.chg5d||0)-idxRS.spy.chg5d)>0?C.yellow:C.red}}>{((selInfo.chg5d||0)-idxRS.spy.chg5d)>3?"매우강":((selInfo.chg5d||0)-idxRS.spy.chg5d)>0?"보통":"약세"}</div>
            </div>
          </div>

          {/* 목표가 섹션 */}
          <div style={{background:"linear-gradient(135deg,rgba(99,102,241,.2),rgba(124,58,237,.2))",border:"1px solid #c4b5fd",borderRadius:12,padding:14,marginBottom:10}}>
            <div style={{fontSize:10,fontWeight:700,color:"#4f46e5",marginBottom:10}}>🎯 목표가 분석</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
              {/* R:R 2:1 */}
              <div style={{background:C.panel2,borderRadius:7,padding:"7px 9px",border:`1px solid ${C.border}`}}>
                <div style={{fontSize:8,color:C.purple,fontWeight:600,marginBottom:2}}>R:R 2:1 목표</div>
                <div style={{fontSize:15,fontWeight:800,color:"#4f46e5"}}>{rrTarget2>0?fmtPrice(rrTarget2,isKRSel)+unit:"—"}</div>
                <div style={{fontSize:7,color:"#8b5cf6"}}>손절기준 2배 수익</div>
              </div>
              {/* R:R 3:1 */}
              <div style={{background:C.panel2,borderRadius:7,padding:"7px 9px",border:`1px solid ${C.border}`}}>
                <div style={{fontSize:8,color:C.purple,fontWeight:600,marginBottom:2}}>R:R 3:1 목표</div>
                <div style={{fontSize:15,fontWeight:800,color:C.purple}}>{rrTarget3>0?fmtPrice(rrTarget3,isKRSel)+unit:"—"}</div>
                <div style={{fontSize:7,color:"#8b5cf6"}}>손절기준 3배 수익</div>
              </div>
              {/* 52주 고점 */}
              <div style={{background:C.panel2,borderRadius:7,padding:"8px 10px",border:`1px solid ${lastD?.w52Near?C.emerald:C.border}`}}>
                <div style={{fontSize:8,color:lastD?.w52Near?"#059669":"#64748b",fontWeight:600,marginBottom:2}}>52주 고점 {lastD?.w52Near?"★ 근접!":""}</div>
                <div style={{fontSize:15,fontWeight:800,color:lastD?.w52Near?"#059669":"#1e293b"}}>{w52High>0?fmtPrice(w52High,isKRSel)+unit:"—"}</div>
                <div style={{fontSize:7,color:"#64748b"}}>현재가 대비 {w52High>0?`${((w52High-curPrice)/curPrice*100).toFixed(1)}%`:"—"}</div>
              </div>
              {/* 매물대 1차 저항 */}
              <div style={{background:C.panel2,borderRadius:7,padding:"8px 10px",border:`1px solid rgba(251,146,60,.3)`}}>
                <div style={{fontSize:8,color:"#c2410c",fontWeight:600,marginBottom:2}}>📊 매물대 저항</div>
                <div style={{fontSize:13,fontWeight:800,color:"#ea580c"}}>
                  {resist1>0?fmtPrice(resist1,isKRSel)+unit:"데이터 부족"}
                </div>
                <div style={{fontSize:7,color:"#9ca3af"}}>{resist2>0?`2차: ${fmtPrice(resist2,isKRSel)+unit}`:"—"}</div>
              </div>
            </div>
            {/* 손절가 슬라이더 */}
            <div style={{background:C.panel2,borderRadius:7,padding:"8px 10px",border:`1px solid rgba(239,68,68,.3)`}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:9,fontWeight:600,color:"#dc2626"}}>🛑 손절가 설정</span>
                <span style={{fontSize:10,fontWeight:700,color:"#dc2626"}}>-{stopPct}% → {fmtPrice(stopPrice,isKRSel)}{unit}</span>
              </div>
              <input type="range" min="3" max="20" value={stopPct} onChange={e=>setStopPct(+e.target.value)} style={{width:"100%",accentColor:"#dc2626"}}/>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:"#9ca3af",marginTop:2}}>
                <span>-3%</span><span>-10%</span><span>-20%</span>
              </div>
            </div>
          </div>

          {/* 13번: 권장 매수금액 */}
          {perStockMax>0&&<div style={{background:"rgba(56,189,248,.06)",border:`1px solid rgba(56,189,248,.2)`,borderRadius:8,padding:"8px 12px",marginBottom:10}}>
            <div style={{fontSize:9,fontWeight:700,color:C.accent,marginBottom:6}}>💰 권장 매수금액 (총 {unit==="원"?"₩":"$"}{riskSettings.totalCapital.toLocaleString()} 기준)</div>
            {overPositions&&<div style={{fontSize:8,color:C.red,marginBottom:4}}>⚠ 최대 종목수 초과 ({currentExposure}/{riskSettings.maxPositions})</div>}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4}}>
              {["1차","2차","3차","4차"].map((lbl,i)=>(
                <div key={i} style={{background:"rgba(255,255,255,.06)",borderRadius:5,padding:"5px 7px",textAlign:"center"}}>
                  <div style={{fontSize:7,color:C.muted}}>{lbl} (25%)</div>
                  <div style={{fontSize:10,fontWeight:700,color:C.accent}}>₩{fmtKRW(pyramidAmts[i])}</div>
                </div>
              ))}
            </div>
            <div style={{fontSize:7,color:C.muted,marginTop:5}}>최대 비중: {riskSettings.maxWeightPct}% · 종목당 ₩{perStockMax.toLocaleString()}</div>
          </div>}

          {/* 매수 버튼 */}
          <button onClick={()=>{
            setPositions(p=>[...p,{id:Date.now(),ticker:sel,label:selInfo.label,market:selInfo.market,entry:curPrice,current:curPrice,max:curPrice,trailStop:+(curPrice*(1-trailSettings.initialStopPct/100)).toFixed(isKRSel?0:2),trailMode:false,target:consTgt,pnl:0,date:new Date().toLocaleDateString("ko-KR"),entryTime:new Date().toLocaleTimeString("ko-KR"),foundScore:entryScore.score,foundGrade:entryScore.grade,foundSignals:entryScore.breakdown.filter(b=>b.ok).map(b=>b.label),oppScoreAt:oppScore,pyramid:[{level:1,targetPct:5,triggered:false},{level:2,targetPct:10,triggered:false},{level:3,targetPct:15,triggered:false}]}]);
            setTab("track");setTrackTab("hold");setAddMsg(`📌 ${selInfo.label} 매수 등록`);setTimeout(()=>setAddMsg(""),2500);
          }} style={{width:"100%",background:"linear-gradient(135deg,#10b981,#059669)",border:`1px solid ${C.emerald}`,borderRadius:8,padding:"12px 16px",color:"#000",fontWeight:900,fontSize:11,cursor:"pointer",marginBottom:10}}>
            📈 매수 등록 → 추적 탭으로 이동
          </button>

          {/* 차트 */}
          {sliced.length>0&&<div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 6px 4px",marginBottom:6}}>
            {/* 차트 헤더 */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingLeft:6,paddingRight:6,marginBottom:8}}>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <span style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:5,background:lastD?.allBull?"rgba(16,185,129,.15)":"rgba(239,68,68,.1)",color:lastD?.allBull?"#15803d":"#991b1b"}}>{lastD?.allBull?"▲ 매수배경":"▼ 비매수배경"}</span>
                <span style={{fontSize:8,color:C.muted}}>{cd?.real?"실데이터":"시뮬"}</span>
              </div>
              <div style={{display:"flex",gap:4}}>
                {[["st","ST"],["avwap","AVWAP"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setChartOpts(o=>({...o,[k]:!o[k]}))} style={{fontSize:8,padding:"2px 8px",borderRadius:5,border:`1px solid ${chartOpts[k]?C.accent:"rgba(99,115,140,.2)"}`,background:chartOpts[k]?"rgba(56,189,248,.12)":"transparent",color:chartOpts[k]?C.accent:C.muted,cursor:"pointer",fontWeight:chartOpts[k]?700:400}}>{chartOpts[k]?"✓ ":""}{l}</button>
                ))}
              </div>
            </div>
            {/* 목표가/손절가/200일선 뱃지 */}
            {(consTgt>0||stopPrice>0)&&<div style={{display:"flex",gap:6,paddingLeft:6,paddingRight:6,marginBottom:8,flexWrap:"wrap"}}>
              {consTgt>0&&<div style={{display:"flex",alignItems:"center",gap:4,background:"rgba(56,189,248,.1)",border:"1px solid #bfdbfe",borderRadius:6,padding:"3px 10px"}}>
                <span style={{fontSize:8,color:C.accent,fontWeight:600}}>🎯 목표</span>
                <span style={{fontSize:10,fontWeight:800,color:C.accent}}>{fmtPrice(consTgt,isKRSel)}{unit}</span>
                {rrRatio>0&&<span style={{fontSize:7,color:C.muted,marginLeft:2}}>R:R {rrRatio}:1</span>}
              </div>}
              {stopPrice>0&&<div style={{display:"flex",alignItems:"center",gap:4,background:"rgba(239,68,68,.05)",border:"1px solid #fecaca",borderRadius:6,padding:"3px 10px"}}>
                <span style={{fontSize:8,color:"#dc2626",fontWeight:600}}>🛑 손절</span>
                <span style={{fontSize:10,fontWeight:800,color:"#dc2626"}}>{fmtPrice(stopPrice,isKRSel)}{unit}</span>
                <span style={{fontSize:7,color:C.muted,marginLeft:2}}>-{stopPct}%</span>
              </div>}
              {lastD?.ma200&&<div style={{display:"flex",alignItems:"center",gap:4,background:lastD.aboveMa200?"rgba(16,185,129,.12)":"rgba(251,191,36,.12)",border:`1px solid ${lastD.aboveMa200?"#bbf7d0":"#fde68a"}`,borderRadius:6,padding:"3px 10px"}}>
                <span style={{fontSize:8,color:lastD.aboveMa200?"#15803d":"#92400e",fontWeight:600}}>200일 {lastD.aboveMa200?"↑위":"↓아래"}</span>
                <span style={{fontSize:9,fontWeight:700,color:C.purple,marginLeft:2}}>{fmtPrice(lastD.ma200,isKRSel)}{unit}</span>
              </div>}
            </div>}
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={sliced} margin={{left:0,right:0}}>
                <CartesianGrid stroke="rgba(255,255,255,.05)"/>
                <XAxis dataKey="date" tick={{fill:"#9ca3af",fontSize:7}} tickLine={false} interval={Math.floor(sliced.length/5)||1}/>
                <YAxis yAxisId="p" tick={{fill:"#9ca3af",fontSize:7}} tickLine={false} domain={["auto","auto"]} tickFormatter={v=>isKRSel?`${(v/10000).toFixed(0)}만`:v.toFixed(0)} width={36}/>
                <YAxis yAxisId="v" orientation="right" hide domain={[0,dm=>dm*5]}/>
                <Tooltip content={<Tip/>}/>
                <Bar yAxisId="v" dataKey="volume" fill="rgba(148,163,184,.15)" radius={[2,2,0,0]}/>
                {consTgt>0&&<ReferenceLine yAxisId="p" y={consTgt} stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="5 3"/>}
                {stopPrice>0&&<ReferenceLine yAxisId="p" y={stopPrice} stroke="#dc2626" strokeWidth={1.5} strokeDasharray="5 3"/>}
                {lastD?.ma200&&<ReferenceLine yAxisId="p" y={lastD.ma200} stroke="#7c3aed" strokeWidth={1} strokeDasharray="8 4"/>}
                <Line yAxisId="p" type="monotone" dataKey="hma20" stroke="#ea580c" strokeWidth={1.2} dot={false} connectNulls strokeDasharray="4 2"/>
                {chartOpts.avwap&&<Line yAxisId="p" type="monotone" dataKey="avwap" stroke="#8b5cf6" strokeWidth={1.5} dot={false} connectNulls strokeDasharray="6 3"/>}
                <Area yAxisId="p" type="monotone" dataKey="close" stroke="#38bdf8" strokeWidth={2} fill="rgba(30,41,59,.04)" dot={false}/>
                {chartOpts.st&&["st1Bull","st2Bull","st3Bull"].map((k,i)=><Line key={k} yAxisId="p" type="monotone" dataKey={k} stroke="#059669" strokeWidth={2-i*.3} dot={false} connectNulls={false} strokeOpacity={1-.15*i}/>)}
                {chartOpts.st&&["st1Bear","st2Bear","st3Bear"].map((k,i)=><Line key={k} yAxisId="p" type="monotone" dataKey={k} stroke="#dc2626" strokeWidth={2-i*.3} dot={false} connectNulls={false} strokeOpacity={1-.15*i}/>)}
                <Scatter yAxisId="p" dataKey="buyStrong" fill="#059669" shape={<BuyDot dataKey="buyStrong"/>}/>
                <Scatter yAxisId="p" dataKey="buyNormal" fill="#d97706" shape={<BuyDot dataKey="buyNormal"/>}/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>}

          {/* ── 하단 지표 패널 ── */}
          {(()=>{
            const subTab = chartOpts.subTab||"adx";
            const setSubTab = (v)=>setChartOpts(o=>({...o,subTab:v}));

            // MACD
            const MACDPanel = (
              <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:7,padding:"6px 6px 3px",marginBottom:6}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,paddingLeft:4}}>
                  <span style={{fontSize:9,fontWeight:600,color:C.sub}}>MACD (12,26,9)</span>
                  <span style={{fontSize:9,color:lastD?.macd>(lastD?.signal||0)?C.green:C.red,fontWeight:700}}>{lastD?.macd>(lastD?.signal||0)?"▲ 골든":"▼ 데드"} {lastD?.hist?.toFixed(2)}</span>
                </div>
                <ResponsiveContainer width="100%" height={75}>
                  <ComposedChart data={sliced} margin={{left:0,right:0}}>
                    <XAxis dataKey="date" tick={false} tickLine={false}/>
                    <YAxis tick={{fill:"#9ca3af",fontSize:6}} tickLine={false} width={34} tickFormatter={v=>v.toFixed(1)}/>
                    <Tooltip content={<Tip/>}/>
                    <ReferenceLine y={0} stroke="rgba(255,255,255,.2)"/>
                    <Bar dataKey="hist" shape={<HistBar/>}/>
                    <Line type="monotone" dataKey="macd" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="MACD"/>
                    <Line type="monotone" dataKey="signal" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Signal"/>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            );

            return <>
              {MACDPanel}

              {/* ADX / RSI 토글 */}
              <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:7,padding:"6px 6px 3px",marginBottom:6}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,paddingLeft:4}}>
                  <div style={{display:"flex",gap:3}}>
                    {[["adx","ADX"],["rsi","RSI"]].map(([k,l])=>(
                      <button key={k} onClick={()=>setChartOpts(o=>({...o,subTab:k}))} style={{fontSize:8,padding:"1px 8px",borderRadius:4,border:`1px solid ${(chartOpts.subTab||"adx")===k?C.accent:"rgba(99,115,140,.2)"}`,background:(chartOpts.subTab||"adx")===k?"rgba(56,189,248,.15)":"rgba(255,255,255,.04)",color:(chartOpts.subTab||"adx")===k?C.accent:C.muted,cursor:"pointer",fontWeight:(chartOpts.subTab||"adx")===k?700:400}}>{l}</button>
                    ))}
                  </div>
                  {(chartOpts.subTab||"adx")==="adx"
                    ?<span style={{fontSize:9,fontWeight:700,color:lastD?.adx>=25?"#059669":lastD?.adx>=20?"#d97706":"#6b7280"}}>{lastD?.adx?"ADX "+lastD.adx.toFixed(0):"—"} {lastD?.adx>=25?"강한추세":lastD?.adx>=20?"추세형성":"횡보"}</span>
                    :<span style={{fontSize:9,fontWeight:700,color:lastD?.rsi>70?C.red:lastD?.rsi<30?C.green:C.muted}}>RSI {lastD?.rsi?.toFixed(0)||"—"} {lastD?.rsi>70?"과매수":lastD?.rsi<30?"과매도":"정상"}</span>
                  }
                </div>
                <ResponsiveContainer width="100%" height={75}>
                  <ComposedChart data={sliced} margin={{left:0,right:0}}>
                    <XAxis dataKey="date" tick={{fill:"#9ca3af",fontSize:6}} tickLine={false} interval={Math.floor(sliced.length/5)||1}/>
                    {(chartOpts.subTab||"adx")==="adx"
                      ?<YAxis domain={[0,60]} tick={{fill:"#9ca3af",fontSize:6}} tickLine={false} width={34} ticks={[20,25,40]}/>
                      :<YAxis domain={[0,100]} tick={{fill:"#9ca3af",fontSize:6}} tickLine={false} width={34} ticks={[30,50,70]}/>
                    }
                    <Tooltip content={<Tip/>}/>
                    {(chartOpts.subTab||"adx")==="adx"?<>
                      <ReferenceLine y={25} stroke="#059669" strokeDasharray="3 3" strokeWidth={1}/>
                      <ReferenceLine y={20} stroke="#d97706" strokeDasharray="3 3" strokeWidth={1}/>
                      <Line type="monotone" dataKey="adx" stroke="#38bdf8" strokeWidth={2} dot={false} name="ADX"/>
                      <Line type="monotone" dataKey="pdi" stroke="#059669" strokeWidth={1} dot={false} strokeDasharray="3 2" name="+DI"/>
                      <Line type="monotone" dataKey="mdi" stroke="#dc2626" strokeWidth={1} dot={false} strokeDasharray="3 2" name="-DI"/>
                    </>:<>
                      <ReferenceLine y={70} stroke="#dc2626" strokeDasharray="3 3" strokeWidth={1}/>
                      <ReferenceLine y={30} stroke="#059669" strokeDasharray="3 3" strokeWidth={1}/>
                      <ReferenceLine y={50} stroke="rgba(255,255,255,.2)" strokeWidth={1}/>
                      <Area type="monotone" dataKey="rsi" stroke="#3b82f6" fill="rgba(59,130,246,.07)" strokeWidth={1.5} dot={false} name="RSI"/>
                    </>}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* OBV 패널 */}
              <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:7,padding:"6px 6px 3px",marginBottom:6}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,paddingLeft:4}}>
                  <span style={{fontSize:9,fontWeight:600,color:C.sub}}>OBV (거래량균형)</span>
                  <span style={{fontSize:9,color:C.muted}}>상승 = 매집 · 하락 = 분산</span>
                </div>
                <ResponsiveContainer width="100%" height={65}>
                  <ComposedChart data={sliced} margin={{left:0,right:0}}>
                    <XAxis dataKey="date" tick={false} tickLine={false}/>
                    <YAxis tick={{fill:"#9ca3af",fontSize:6}} tickLine={false} width={34} tickFormatter={v=>{const abs=Math.abs(v);return abs>=1e6?`${(v/1e6).toFixed(0)}M`:abs>=1000?`${(v/1000).toFixed(0)}K`:`${v}`;}}/>
                    <Tooltip content={<Tip/>}/>
                    <Area type="monotone" dataKey="obv" stroke="#7c3aed" fill="rgba(124,58,237,.08)" strokeWidth={1.5} dot={false} name="OBV"/>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>;
          })()}

          {/* 기간 */}
          <div style={{display:"flex",gap:3,justifyContent:"center",marginBottom:10}}>
            {["1M","3M","6M","1Y","ALL"].map(p=><button key={p} onClick={()=>setPeriod(p)} style={{...css.btn(period===p),fontSize:8,padding:"2px 8px"}}>{p}</button>)}
          </div>

          {/* 보조지표 4개 */}
          <div style={{...css.card,marginBottom:10}}>
            <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8}}>📉 보조 지표</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7}}>
              {[
                {l:"RSI",v:lastD?.rsi?.toFixed(0)||"-",c:lastD?.rsi>70?C.red:lastD?.rsi<30?C.green:C.text,d:lastD?.rsi>70?"⚠과매수":lastD?.rsi<30?"🎯과매도":"정상"},
                {l:"MACD",v:lastD?.macd>lastD?.signal?"크로스↑":"크로스↓",c:lastD?.macd>lastD?.signal?C.green:C.red,d:lastD?.hist>0?"양봉":"음봉"},
                {l:"거래량",v:`${selInfo._volRatio||"-"}%`,c:(selInfo._volRatio||0)>=150?C.green:(selInfo._volRatio||0)>=100?C.yellow:C.muted,d:(selInfo._volRatio||0)>=150?"급증":(selInfo._volRatio||0)>=100?"증가":"보통"},
                {l:"RS강도",v:`${((selInfo.chg5d||0)-idxRS.spy.chg5d).toFixed(1)}%p`,c:((selInfo.chg5d||0)-idxRS.spy.chg5d)>3?C.emerald:((selInfo.chg5d||0)-idxRS.spy.chg5d)>0?C.yellow:C.red,d:((selInfo.chg5d||0)-idxRS.spy.chg5d)>3?"매우강":"보통"},
              ].map((m,i)=>(
                <div key={i} style={{background:"rgba(255,255,255,.04)",borderRadius:7,padding:"8px 10px",textAlign:"center"}}>
                  <div style={{fontSize:8,color:C.muted,marginBottom:3}}>{m.l}</div>
                  <div style={{fontSize:13,fontWeight:900,color:m.c}}>{m.v}</div>
                  <div style={{fontSize:7,color:C.sub,marginTop:2}}>{m.d}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 체크리스트 */}
          <div style={{...css.card,marginBottom:10,border:`1px solid ${checkOk?C.emerald:C.border}`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8}}>✅ 매매 전 체크리스트</div>
            {[
              ["market",lastD?.allBull&&vixVal<25,"📊 지수 추세 상승 (ST 매수배경 · VIX 25 이하)"],
              ["ma200",lastD?.aboveMa200===true,"📈 주가 200일선 위 (장기추세 상승)"],
              ["sector",true,"🏭 목표 업종이 당일 강세 섹터"],
              ["stock",entryScore.score>=55,"📈 진입평점 55pt+ (현재 "+entryScore.score+"pt)"],
              ["timing",lastD?.allBull&&(lastD?.macd||0)>(lastD?.signal||0),"⏰ 트리플 ST 매수 + MACD 크로스"],
              ["risk",stopPrice>0&&stopPrice<curPrice,"🛑 손절가 현재가 아래 확인"],
            ].map(([key,autoVal,label])=>(
              <div key={key} onClick={()=>setChecklist(c=>({...c,[key]:!c[key]}))} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid rgba(255,255,255,.05)`,cursor:"pointer"}}>
                <div style={{width:16,height:16,borderRadius:3,border:`1px solid ${(checklist[key]||autoVal)?C.emerald:C.border}`,background:(checklist[key]||autoVal)?"rgba(16,185,129,.2)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,flexShrink:0}}>
                  {(checklist[key]||autoVal)?<span style={{color:C.emerald}}>✓</span>:""}
                </div>
                <span style={{fontSize:9,color:(checklist[key]||autoVal)?C.text:C.muted}}>{label}</span>
                {autoVal&&<span style={{fontSize:7,color:C.emerald,marginLeft:"auto"}}>자동</span>}
              </div>
            ))}
          </div>
        </div>}
        {tab==="sniper"&&!selInfo&&<div style={{padding:"40px 20px",textAlign:"center",color:C.muted}}><div style={{fontSize:24,marginBottom:8}}>🎯</div><div>알파헌터에서 종목을 선택하거나 검색해주세요</div></div>}

        {/* ══ TAB 4: 추적 (통합) ══ */}
        {tab==="track"&&<div style={{padding:"12px 14px"}}>
          <div style={{fontSize:12,fontWeight:900,color:C.accent,marginBottom:10}}>📊 추적 탭</div>

          {/* 4 서브탭 */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4,marginBottom:14}}>
            {[["watch",`👁 관찰중 (${tracking.length})`],["hold",`💼 보유중 (${positions.length})`],["closed",`✅ 청산완료 (${closedLog.length})`],["stats","📈 성적분석"]].map(([k,l])=>(
              <button key={k} onClick={()=>setTrackTab(k)} style={{padding:"8px 4px",borderRadius:7,border:`1px solid ${trackTab===k?C.accent:C.border}`,background:trackTab===k?"rgba(56,189,248,.15)":"rgba(255,255,255,.03)",color:trackTab===k?C.accent:C.muted,fontWeight:trackTab===k?700:400,fontSize:9,cursor:"pointer"}}>{l}</button>
            ))}
          </div>

          {/* 관찰중 */}
          {trackTab==="watch"&&<div>
            {tracking.length===0
              ?<div style={{textAlign:"center",padding:"40px 0",color:C.muted}}><div style={{fontSize:28,marginBottom:8}}>👁</div><div>알파헌터에서 "추적시작" 버튼을 누르면 여기에 추가됩니다</div></div>
              :<div style={{display:"flex",flexDirection:"column",gap:10}}>
                {tracking.map((t,i)=>{
                  const info=stocks.find(s=>s.ticker===t.ticker);
                  const cur=info?.price||t.basePrice;
                  const chg=+((cur-t.basePrice)/t.basePrice*100).toFixed(2);
                  const rs=(info?.chg5d||0)-idxRS.spy.chg5d;
                  const isKR=(t.ticker?.length||0)>5;
                  return<div key={t.id||i} style={{...css.card}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div>
                        <div style={{fontWeight:900,fontSize:13}}>{t.market} {t.label}</div>
                        <div style={{fontSize:8,color:C.muted}}>관찰 시작: {t.addedDate} · 기준가 {isKR?"₩":"$"}{t.basePrice.toLocaleString()}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:20,fontWeight:900,color:chg>=0?C.green:C.red}}>{chg>=0?"+":""}{chg}%</div>
                        <div style={{fontSize:9,color:C.sub}}>{isKR?"₩":"$"}{isKR?fmtKRW(cur):cur.toLocaleString()}</div>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:8}}>
                      <div style={{background:"rgba(255,255,255,.06)",borderRadius:5,padding:"5px 7px",textAlign:"center"}}>
                        <div style={{fontSize:7,color:C.muted}}>발굴점수</div>
                        <div style={{fontSize:13,fontWeight:700,color:C.accent}}>{t.foundScore||"-"}</div>
                      </div>
                      <div style={{background:"rgba(255,255,255,.06)",borderRadius:5,padding:"5px 7px",textAlign:"center"}}>
                        <div style={{fontSize:7,color:C.muted}}>RS강도</div>
                        <div style={{fontSize:12,fontWeight:700,color:rs>2?C.emerald:rs>0?C.yellow:C.red}}>{rs>=0?"+":""}{rs.toFixed(1)}%p</div>
                      </div>
                      <div style={{background:"rgba(255,255,255,.06)",borderRadius:5,padding:"5px 7px",textAlign:"center"}}>
                        <div style={{fontSize:7,color:C.muted}}>OppScore</div>
                        <div style={{fontSize:12,fontWeight:700,color:oppColor}}>{t.oppScoreAt||oppScore}</div>
                      </div>
                      <div style={{background:"rgba(255,255,255,.06)",borderRadius:5,padding:"5px 7px",textAlign:"center"}}>
                        <div style={{fontSize:7,color:C.muted}}>진입등급</div>
                        <div style={{fontSize:12,fontWeight:700,color:entryGradeColor}}>{calcEntryScore(charts[t.ticker]?.data,vixVal,oppScore).grade}</div>
                      </div>
                    </div>
                    {(t.foundSignals||[]).length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:8}}>
                      {t.foundSignals.map(sig=><span key={sig} style={{fontSize:7,padding:"2px 6px",borderRadius:3,background:"rgba(56,189,248,.12)",color:C.accent}}>{sig}</span>)}
                    </div>}
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={()=>{setSel(t.ticker);setTab("sniper");}} style={{flex:1,background:"rgba(56,189,248,.1)",border:`1px solid ${C.accent}`,color:C.accent,borderRadius:6,padding:"6px 0",cursor:"pointer",fontSize:9,fontWeight:700}}>📈 스나이퍼</button>
                      <button onClick={()=>{
                        setPositions(p=>[...p,{id:Date.now(),ticker:t.ticker,label:t.label,market:t.market,entry:cur,current:cur,max:cur,trailStop:+(cur*(1-trailSettings.initialStopPct/100)).toFixed(isKR?0:2),trailMode:false,target:0,pnl:0,date:new Date().toLocaleDateString("ko-KR"),entryTime:new Date().toLocaleTimeString("ko-KR"),foundScore:t.foundScore,foundSignals:t.foundSignals,foundRS:t.foundRS,oppScoreAt:t.oppScoreAt,pyramid:[{level:1,targetPct:5,triggered:false},{level:2,targetPct:10,triggered:false},{level:3,targetPct:15,triggered:false}]}]);
                        setTracking(p=>p.filter((_,j)=>j!==i));
                        setTrackTab("hold");
                      }} style={{flex:1,background:"rgba(16,185,129,.1)",border:`1px solid ${C.emerald}`,color:C.emerald,borderRadius:6,padding:"6px 0",cursor:"pointer",fontSize:9,fontWeight:700}}>💼 매수 전환</button>
                      <button onClick={()=>{
                        setClosedLog(p=>[{...t,exitPrice:cur,pnl:chg,exitDate:new Date().toLocaleDateString("ko-KR"),reason:"관찰종료",phase:"watch"},...p]);
                        setTracking(p=>p.filter((_,j)=>j!==i));
                      }} style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,color:C.muted,borderRadius:6,padding:"6px 10px",cursor:"pointer",fontSize:9}}>✕ 제거</button>
                    </div>
                  </div>;
                })}
              </div>
            }
          </div>}

          {/* 보유중 */}
          {trackTab==="hold"&&<div>
            {/* 12번: 트레일링 설정 요약 */}
            <div style={{background:"rgba(250,204,21,.06)",border:`1px solid rgba(250,204,21,.2)`,borderRadius:8,padding:"8px 12px",marginBottom:12,display:"flex",gap:12,flexWrap:"wrap"}}>
              <span style={{fontSize:8,color:C.muted}}>⚙ 트레일링 설정:</span>
              <span style={{fontSize:8,color:C.red}}>초기손절 -{trailSettings.initialStopPct}%</span>
              <span style={{fontSize:8,color:C.yellow}}>│ 트레일링 고점-{trailSettings.trailPct}%</span>
              <span style={{fontSize:8,color:C.emerald}}>│ +{trailSettings.switchPct}% 달성 시 전환</span>
              <button onClick={()=>setShowRiskPanel(true)} style={{...css.btn(),fontSize:7,padding:"1px 6px",marginLeft:"auto"}}>변경</button>
            </div>
            {overPositions&&<div style={{background:"rgba(239,68,68,.08)",border:`1px solid rgba(239,68,68,.3)`,borderRadius:7,padding:"6px 10px",marginBottom:10,fontSize:9,color:C.red,fontWeight:700}}>⚠ 최대 종목수 초과 ({positions.length}/{riskSettings.maxPositions}) — 일부 포지션 청산 고려</div>}
            {positions.length===0
              ?<div style={{textAlign:"center",padding:"40px 0",color:C.muted}}><div style={{fontSize:28,marginBottom:8}}>💼</div><div>스나이퍼에서 "매수 등록" 또는 관찰중에서 "매수 전환"</div></div>
              :<div style={{display:"flex",flexDirection:"column",gap:12}}>
                {positions.map(pos=>{
                  const cur=pos.current,pnl=pos.pnl||0,trailStop=pos.trailStop;
                  const stopDist=trailStop>0?+((cur-trailStop)/cur*100).toFixed(1):10;
                  const near=stopDist<1.5;
                  const prog=pos.target>pos.entry?Math.max(0,Math.min(100,(cur-pos.entry)/(pos.target-pos.entry)*100)):0;
                  const u=pos.ticker.length>5?"원":"$";
                  const rs=(stocks.find(s=>s.ticker===pos.ticker)?.chg5d||0)-idxRS.spy.chg5d;
                  // ★ 7번: 거래량 급감 경고
                  const posVolRatio=stocks.find(s=>s.ticker===pos.ticker)?._volRatio||100;
                  const volDrop=posVolRatio<50;
                  // 불타기 알림
                  const pendingPyramid=(pos.pyramid||[]).filter(lv=>lv.triggered&&!lv.notified);
                  return<div key={pos.id} style={{...css.card,border:`2px solid ${near?"rgba(239,68,68,.8)":volDrop?"rgba(250,204,21,.6)":pos.trailMode?"rgba(250,204,21,.5)":C.border}`,animation:near?"ap 2s infinite":""}}>
                    {near&&<div style={{background:"rgba(239,68,68,.15)",borderRadius:5,padding:"4px 8px",fontSize:8,color:C.red,fontWeight:700,marginBottom:8}}>🚨 손절선 근접 ({stopDist.toFixed(1)}%) — 즉시 확인!</div>}
                    {volDrop&&!near&&<div style={{background:"rgba(250,204,21,.1)",borderRadius:5,padding:"4px 8px",fontSize:8,color:C.yellow,fontWeight:700,marginBottom:8}}>⚠️ 거래량 급감 ({posVolRatio}% / 20일평균) — 모멘텀 약화 주의</div>}
                    {/* 불타기 알림 */}
                    {pendingPyramid.map(lv=>(
                      <div key={lv.level} style={{background:"rgba(16,185,129,.12)",border:`1px solid ${C.emerald}`,borderRadius:5,padding:"4px 8px",fontSize:8,color:C.emerald,fontWeight:700,marginBottom:6}}>
                        🔥 불타기 {lv.level}차 목표 +{lv.targetPct}% 달성! ({lv.triggeredAt}) — 추가 매수 고려
                      </div>
                    ))}
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                      <div>
                        <div style={{fontWeight:900,fontSize:12}}>{pos.market} {pos.label}</div>
                        <div style={{fontSize:9,color:C.muted}}>진입 {u==="원"?fmtKRW(pos.entry):pos.entry.toLocaleString()}{u} · {pos.date}</div>
                        <div style={{display:"flex",gap:5,marginTop:3}}>
                          {pos.foundGrade&&<span style={{fontSize:7,background:`${entryGradeColor}18`,color:entryGradeColor,border:`1px solid ${entryGradeColor}`,borderRadius:3,padding:"1px 4px"}}>진입 {pos.foundGrade}등급</span>}
                          {pos.trailMode&&<span style={{fontSize:7,background:"rgba(250,204,21,.12)",color:C.yellow,border:`1px solid rgba(250,204,21,.3)`,borderRadius:3,padding:"1px 4px"}}>🔄 트레일링 모드</span>}
                        </div>
                      </div>
                      <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:22,fontWeight:900,color:pnl>=0?C.green:C.red}}>{pnl>=0?"+":""}{pnl.toFixed?.(2)||0}%</div>
                          <div style={{fontSize:9,color:C.sub}}>{u}{u==="원"?fmtKRW(cur):cur.toLocaleString()}</div>
                          <div style={{fontSize:8,color:rs>=0?C.emerald:C.red}}>RS {rs>=0?"+":""}{rs.toFixed(1)}%p</div>
                        </div>
                        <button onClick={()=>{
                          if(window.confirm(`${pos.label} 포지션을 청산하시겠어요?`)){
                            setClosedLog(h=>[{...pos,exitPrice:cur,exitDate:new Date().toLocaleDateString("ko-KR"),finalPnl:pnl,reason:"수동청산",phase:"hold"},...h]);
                            setPositions(p=>p.filter(x=>x.id!==pos.id));
                          }
                        }} style={{background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",color:C.red,borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:9,fontWeight:700,flexShrink:0}}>청산 ✕</button>
                      </div>
                    </div>

                    {/* 12번: 불타기 단계 */}
                    <div style={{fontSize:9,color:C.muted,fontWeight:700,marginBottom:5}}>🔥 불타기 계획</div>
                    <div style={{display:"flex",gap:4,marginBottom:10}}>
                      {[{label:"1차 진입",note:"진입가",triggered:true,entry:true},...(pos.pyramid||[]).map(lv=>({label:`${lv.level+1}차 불타기`,note:`+${lv.targetPct}%`,triggered:lv.triggered}))].map((lv,i)=>{
                        const targetPx=i===0?pos.entry:+(pos.entry*(1+(pos.pyramid?.[i-1]?.targetPct||0)/100)).toFixed(pos.ticker.length>5?0:2);
                        return<div key={i} style={{flex:1,borderRadius:7,padding:"6px 8px",border:`1px solid ${lv.triggered?"rgba(34,197,94,.4)":"rgba(99,115,140,.1)"}`,background:lv.triggered?"rgba(34,197,94,.06)":C.panel2,textAlign:"center"}}>
                          <div style={{fontSize:7,color:lv.triggered?C.green:C.muted,fontWeight:700,marginBottom:2}}>{lv.triggered?"✅":"⏳"} {lv.label}</div>
                          <div style={{fontSize:9,fontWeight:700,color:lv.triggered?C.green:C.sub}}>{lv.note}</div>
                          <div style={{fontSize:7,color:C.muted}}>{u}{u==="원"?fmtKRW(targetPx):targetPx.toLocaleString()}</div>
                          <div style={{fontSize:7,color:C.accent}}>₩{fmtKRW(pyramidAmts[i]||0)}</div>
                        </div>;
                      })}
                    </div>

                    {/* 12번: 손절 기준 (명확화) */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
                      <div style={{background:"rgba(239,68,68,.07)",border:"1px solid rgba(239,68,68,.25)",borderRadius:7,padding:"7px 10px"}}>
                        <div style={{fontSize:8,color:C.red,fontWeight:700}}>🛑 초기 손절 (-{trailSettings.initialStopPct}%)</div>
                        <div style={{fontSize:7,color:C.muted,marginBottom:3}}>매수가 기준 · +{trailSettings.switchPct}% 전까지</div>
                        <div style={{fontSize:16,fontWeight:900,color:C.red}}>{u}{u==="원"?fmtKRW(pos.entry*(1-trailSettings.initialStopPct/100)):(pos.entry*(1-trailSettings.initialStopPct/100)).toFixed(2)}</div>
                      </div>
                      <div style={{background:pos.trailMode?"rgba(250,204,21,.1)":"rgba(255,255,255,.03)",border:`1px solid ${pos.trailMode?"rgba(250,204,21,.4)":"rgba(99,115,140,.1)"}`,borderRadius:7,padding:"7px 10px"}}>
                        <div style={{fontSize:8,color:C.yellow,fontWeight:700}}>🔄 트레일링 (고점-{trailSettings.trailPct}%)</div>
                        <div style={{fontSize:7,color:C.muted,marginBottom:3}}>고점 {u}{pos.max?.toLocaleString()} {pos.trailMode?"·활성":"· 비활성"}</div>
                        <div style={{fontSize:16,fontWeight:900,color:pos.trailMode?C.yellow:C.muted}}>{u}{u==="원"?fmtKRW(trailStop):trailStop.toLocaleString()}</div>
                      </div>
                    </div>

                    {/* 진행 바 */}
                    {pos.target>pos.entry&&<>
                      <div style={{height:5,background:"rgba(255,255,255,.04)",borderRadius:3,overflow:"hidden",marginBottom:3}}>
                        <div style={{height:"100%",width:`${prog}%`,background:C.accent,borderRadius:3,transition:"width .5s"}}/>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:C.muted}}>
                        <span>진입 {u}{pos.entry.toLocaleString()}</span>
                        <span style={{color:C.accent}}>{prog.toFixed(0)}%</span>
                        <span>목표 {u}{pos.target.toLocaleString()}</span>
                      </div>
                    </>}
                  </div>;
                })}
              </div>
            }
          </div>}

          {/* 청산완료 */}
          {trackTab==="closed"&&<div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
              {[{l:"총 거래",v:closedLog.length},{l:"승률",v:closedLog.length?`${((closedLog.filter(h=>parseFloat(h.pnl||h.finalPnl)>0).length/closedLog.length)*100).toFixed(0)}%`:"—"},{l:"평균 손익",v:closedLog.length?`${(closedLog.reduce((a,h)=>a+parseFloat(h.pnl||h.finalPnl||0),0)/closedLog.length).toFixed(1)}%`:"—"},{l:"누적 손익",v:closedLog.length?`${closedLog.reduce((a,h)=>a+parseFloat(h.pnl||h.finalPnl||0),0).toFixed(1)}%`:"—"}].map(({l,v})=>(
                <div key={l} style={{...css.panel2,textAlign:"center"}}><div style={{fontSize:8,color:C.muted}}>{l}</div><div style={{fontSize:18,fontWeight:900}}>{v}</div></div>
              ))}
            </div>
            {closedLog.length===0
              ?<div style={{textAlign:"center",padding:"30px 0",color:C.muted}}>청산 기록 없음</div>
              :<div style={{...css.card,padding:0,overflow:"hidden"}}>
                <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr",padding:"6px 10px",background:"#f9fafb",fontSize:8,color:C.muted,fontWeight:700}}>
                  <span>종목</span><span>매수가</span><span>청산가</span><span>손익</span><span>이유</span>
                </div>
                {closedLog.map((h,i)=>{
                  const pnl=parseFloat(h.pnl||h.finalPnl||0);
                  const isKR=(h.ticker?.length||0)>5;
                  const u=isKR?"₩":"$";
                  const entry=h.entry||h.basePrice||0;
                  const exit=h.exitPrice||h.current||0;
                  return<div key={i} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr",padding:"8px 10px",borderTop:"1px solid rgba(99,115,140,.08)",fontSize:9,background:pnl>=0?"#f0fdf4":"#fff5f5"}}>
                    <div><div style={{fontWeight:700}}>{h.market} {h.label}</div><div style={{fontSize:7,color:C.muted}}>{h.addedDate||h.date} → {h.exitDate}</div></div>
                    <span>{u}{entry.toLocaleString()}</span>
                    <span>{u}{exit.toLocaleString()}</span>
                    <span style={{color:pnl>=0?C.green:C.red,fontWeight:700}}>{pnl>=0?"+":""}{pnl.toFixed(2)}%</span>
                    <span style={{color:C.muted,fontSize:8}}>{h.reason||"수동"}</span>
                  </div>;
                })}
              </div>
            }
          </div>}

          {trackTab==="stats"&&<div>
            {closedLog.length>0&&<div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}>
              <button onClick={()=>{if(window.confirm("성적 기록을 모두 초기화하시겠어요? 되돌릴 수 없습니다.")){setClosedLog([]);setAiAnalysis(null);}}} style={{...css.btn(),fontSize:9,color:C.red,borderColor:"rgba(248,113,113,.4)"}}>🗑 성적 초기화</button>
            </div>}
            {/* 요약 통계 */}
            {closedLog.length>0?<>
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginBottom:12}}>
                {/* 조건별 승률 */}
                <div style={css.card}>
                  <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8}}>📊 신호별 성과</div>
                  {(()=>{
                    const bySignal={};
                    closedLog.forEach(h=>{
                      (h.foundSignals||[]).forEach(sig=>{
                        if(!bySignal[sig])bySignal[sig]={count:0,wins:0,totalPnl:0};
                        bySignal[sig].count++;
                        const pnl=parseFloat(h.pnl||h.finalPnl||0);
                        if(pnl>0)bySignal[sig].wins++;
                        bySignal[sig].totalPnl+=pnl;
                      });
                    });
                    return Object.entries(bySignal).sort((a,b)=>b[1].count-a[1].count).map(([sig,d])=>{
                      const wr=+(d.wins/d.count*100).toFixed(0);
                      const avg=+(d.totalPnl/d.count).toFixed(1);
                      return<div key={sig} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 0",borderBottom:`1px solid rgba(255,255,255,.05)`}}>
                        <span style={{fontSize:9,color:C.text,flex:1}}>{sig}</span>
                        <span style={{fontSize:8,color:C.muted}}>{d.count}건</span>
                        <span style={{fontSize:9,fontWeight:700,color:wr>=60?C.green:wr>=40?C.yellow:C.red}}>{wr}%승</span>
                        <span style={{fontSize:9,fontWeight:700,color:avg>=0?C.emerald:C.red,minWidth:40,textAlign:"right"}}>{avg>=0?"+":""}{avg}%</span>
                      </div>;
                    });
                  })()}
                </div>

                {/* OppScore별 상관관계 */}
                <div style={css.card}>
                  <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8}}>🌡 OppScore별 성과</div>
                  {(()=>{
                    const bins=[{label:"HIGH (70+)",min:70,max:100},{label:"MID (45-69)",min:45,max:70},{label:"LOW (~44)",min:0,max:45}];
                    return bins.map(bin=>{
                      const items=closedLog.filter(h=>{const s=h.oppScoreAt||50;return s>=bin.min&&s<bin.max;});
                      if(!items.length)return<div key={bin.label} style={{fontSize:9,color:C.muted,padding:"5px 0"}}>{bin.label}: 데이터 없음</div>;
                      const wr=+(items.filter(h=>parseFloat(h.pnl||h.finalPnl||0)>0).length/items.length*100).toFixed(0);
                      const avg=+(items.reduce((a,h)=>a+parseFloat(h.pnl||h.finalPnl||0),0)/items.length).toFixed(1);
                      return<div key={bin.label} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 0",borderBottom:`1px solid rgba(255,255,255,.05)`}}>
                        <span style={{fontSize:9,color:C.text,flex:1}}>{bin.label}</span>
                        <span style={{fontSize:8,color:C.muted}}>{items.length}건</span>
                        <span style={{fontSize:9,fontWeight:700,color:wr>=60?C.green:wr>=40?C.yellow:C.red}}>{wr}%승</span>
                        <span style={{fontSize:9,fontWeight:700,color:avg>=0?C.emerald:C.red}}>{avg>=0?"+":""}{avg}%</span>
                      </div>;
                    });
                  })()}
                </div>
              </div>

              {/* 손익 분포 차트 */}
              <div style={css.card}>
                <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8}}>📉 손익 분포</div>
                <div style={{display:"flex",gap:2,alignItems:"flex-end",height:60}}>
                  {closedLog.slice(-20).map((h,i)=>{
                    const pnl=parseFloat(h.pnl||h.finalPnl||0);
                    const maxPnl=Math.max(...closedLog.map(x=>Math.abs(parseFloat(x.pnl||x.finalPnl||0))),1);
                    const h2=Math.max(4,Math.abs(pnl)/maxPnl*55);
                    return<div key={i} title={`${h.label}: ${pnl>=0?"+":""}${pnl.toFixed(1)}%`} style={{flex:1,height:h2,background:pnl>=0?"rgba(34,197,94,.7)":"rgba(239,68,68,.7)",borderRadius:"2px 2px 0 0",minWidth:3,cursor:"pointer"}} onClick={()=>{}}/>
                  })}
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:C.muted,marginTop:4}}>
                  <span>최근 20건</span><span>최신 →</span>
                </div>
              </div>

              {/* AI 분석 */}
              <div style={{...css.card,border:`1px solid ${C.purple}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.purple}}>🤖 AI 성적 분석</div>
                  <button onClick={runAIAnalysis} disabled={aiLoading} style={{...css.btn(false),fontSize:9,borderColor:C.purple,color:aiLoading?C.muted:C.purple,padding:"4px 12px"}}>
                    {aiLoading?"분석중...":"🔍 AI 분석 실행"}
                  </button>
                </div>
                {aiAnalysis
                  ?<div style={{fontSize:10,color:C.text,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{aiAnalysis}</div>
                  :<div style={{fontSize:9,color:C.muted}}>버튼을 눌러 Claude AI가 나의 매매 패턴과 개선점을 분석합니다.</div>
                }
              </div>

              {/* 투자 노트 */}
              <div style={css.card}>
                <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:7}}>📝 투자 노트</div>
                <textarea rows="4" value={investNotes} onChange={e=>setInvestNotes(e.target.value)} placeholder={"오늘의 시장 관찰, 매매 반성...\n예) NVDA 구름 돌파 확인, 내일 눌림목 2차 매수 고려"} style={{background:"#f9fafb",border:`1px solid ${C.border}`,borderRadius:8,padding:10,color:C.text,fontSize:10,resize:"vertical",outline:"none",lineHeight:1.8,width:"100%"}}/>
              </div>
            </>
            :<div style={{textAlign:"center",padding:"50px 0",color:C.muted}}>
              <div style={{fontSize:28,marginBottom:8}}>📊</div>
              <div>청산된 거래가 없습니다.<br/>보유중 탭에서 포지션을 청산하면 분석이 표시됩니다.</div>
            </div>}
          </div>}
        </div>}

        {/* ══ TAB 5: 종목풀 ══ */}
        {tab==="pool"&&<div style={{padding:"12px 14px"}}>
          <div style={{fontSize:12,fontWeight:900,color:C.accent,marginBottom:4}}>🗂 종목풀 관리</div>
          <div style={{fontSize:9,color:C.sub,marginBottom:12}}>코스피200 + 나스닥100 + S&P500 — ★ 눌러 관심종목 추가</div>
          <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
            <input value={poolFilter} onChange={e=>setPoolFilter(e.target.value)} placeholder="종목명/티커 검색..." style={{flex:1,minWidth:120,background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 10px",color:C.text,fontSize:10,outline:"none"}}/>
            {[["all","전체"],["kr","🇰🇷 한국"],["us","🇺🇸 미국"]].map(([v,l])=>(
              <button key={v} onClick={()=>setPoolMarket(v)} style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${poolMarket===v?C.accent:C.border}`,background:poolMarket===v?"rgba(56,189,248,.15)":"transparent",color:poolMarket===v?C.accent:C.muted,fontSize:9,cursor:"pointer"}}>{l}</button>
            ))}
            <button onClick={async()=>{
              setPoolMsg("📦 종목풀 로딩 중...");
              try{
                const r2=await fetch("/data/stocks.json?t="+Date.now());
                const j2=await r2.json();
                setPool(j2.pool||{});setPoolLoaded(true);
                setPoolMsg(`✅ ${Object.keys(j2.pool||{}).length}개 종목 로드됨`);
              }catch{setPoolMsg("❌ 로드 실패 — Actions daily 먼저 실행");}
              setTimeout(()=>setPoolMsg(""),4000);
            }} style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${C.accent}`,background:"rgba(56,189,248,.1)",color:C.accent,fontSize:9,cursor:"pointer",fontWeight:700}}>
              {poolLoaded?"🔄 새로고침":"📦 풀 로드"}
            </button>
          </div>
          {poolMsg&&<div style={{fontSize:9,color:C.accent,marginBottom:8,padding:"6px 10px",background:"rgba(56,189,248,.08)",borderRadius:6}}>{poolMsg}</div>}
          <div style={css.card}>
            <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8}}>⭐ 현재 관심종목 ({stocks.length}개)</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {stocks.map(s=>(
                <div key={s.ticker} style={{display:"flex",alignItems:"center",gap:4,background:"rgba(56,189,248,.08)",border:`1px solid rgba(56,189,248,.2)`,borderRadius:5,padding:"3px 8px"}}>
                  <span style={{fontSize:9,fontWeight:700,color:C.accent}}>{s.market} {s.label}</span>
                  <button onClick={()=>removeStock(s.ticker)} style={{background:"none",border:"none",color:"rgba(239,68,68,.6)",cursor:"pointer",fontSize:10,padding:0}}>✕</button>
                </div>
              ))}
            </div>
          </div>
          {!poolLoaded
            ?<div style={{textAlign:"center",padding:"40px 0",color:C.muted}}>
              <div style={{fontSize:24,marginBottom:8}}>📦</div>
              <div style={{fontSize:10}}>위 "풀 로드" 버튼을 눌러주세요</div>
            </div>
            :<PoolList pool={pool} poolMarket={poolMarket} poolFilter={poolFilter}
               stocks={stocks} removeStock={removeStock} setStocks={setStocks}
               setPoolMsg={setPoolMsg} C={C} border={C.border} accent={C.accent} muted={C.muted} text={C.text} green={C.green} red={C.red}/>
          }
        </div>}

      </div>
    </div>
  );
}
