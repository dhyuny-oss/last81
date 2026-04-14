/**
 * Alpha Terminal v2.3 — App.jsx
 * v2.3: 데이터 범위 통합 (pool↔stocks 일관성)
 *       navigateToStock — pool 종목 클릭 시 자동 추가
 *       selInfo/labInfo/posInfo pool 폴백
 *       allStocksForScan/poolFiltered useMemo 최적화
 *       removeStock 포지션 보호
 *       섹터 구성종목 클릭 네비게이션
 *       실험실 탭 pool 종목 확대
 * v2.2: 에쿼티커브 / 매매일지 / CSV내보내기 / 불타기룰(30/30/25/15)
 * 리디자인: 다크 네이비 / 만원단위 / AI분석 API경유 / 성적리셋 / quarterly모드
 */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  ComposedChart, Area, Line, Bar, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

// ═══════════════════════════════════════════════════════════
// 1. 색상 & 상수
// ═══════════════════════════════════════════════════════════
const C = {
  bg:"#000000", panel:"#1C1C1E", panel2:"#2C2C2E",
  border:"rgba(255,255,255,.08)", accent:"#0A84FF",
  green:"#30D158", red:"#FF453A", yellow:"#FFD60A",
  emerald:"#30D158", purple:"#BF5AF2",
  muted:"#636366", text:"#F5F5F7", sub:"#8E8E93", ema:"#FF9F0A",
  glass:"rgba(255,255,255,.06)",
};
const SIG = {
  BUY:  { bg:"rgba(48,209,88,.12)", color:"#30D158", border:"rgba(48,209,88,.35)" },
  HOLD: { bg:"rgba(255,214,10,.08)",  color:"#FFD60A", border:"rgba(255,214,10,.3)"  },
  SELL: { bg:"rgba(255,69,58,.08)", color:"#FF453A", border:"rgba(255,69,58,.3)" },
};
const PERIOD_DAYS = { "1M":22, "3M":66, "6M":130, "1Y":252, "ALL":9999 };
const INITIAL = [];

// ★ v2.2: 불타기 룰 (30/30/25/15 — 빠른 손절 전제)
// ★ v2.2: 불타기 룰 (기본/특별 모드)
const PYRAMID_BASIC = [
  { pct: 10, label: "보초", targetPct: 0 },
  { pct: 40, label: "1차 진입", targetPct: 2 },
  { pct: 40, label: "2차 추가", targetPct: 3 },
  { pct: 10, label: "3차 마무리", targetPct: 5 },
];
const PYRAMID_SPECIAL = [
  { pct: 5,  label: "보초", targetPct: 0 },
  { pct: 20, label: "1차 진입", targetPct: 2 },
  { pct: 20, label: "2차 추가", targetPct: 3 },
  { pct: 40, label: "3차 본격", targetPct: 5 },
  { pct: 15, label: "4차 마무리", targetPct: 10 },
];

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


// ═══════════════════════════════════════════════════════════
// 1b. Opportunity Score (★ v2.2: US/KR 분리)
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
function calcOppScoreUS(vix, spChg3d, sectorRS) {
  let score = 50;
  if (vix > 0) { if (vix < 15) score += 22; else if (vix < 20) score += 12; else if (vix < 25) score += 0; else if (vix < 30) score -= 12; else score -= 22; }
  if (spChg3d > 2) score += 18; else if (spChg3d > 0) score += 8; else if (spChg3d > -2) score -= 5; else score -= 18;
  const usBull = (sectorRS||[]).filter(s=>s.market==="us"&&s.chg1W>0).length;
  score += usBull * 3;
  return Math.max(0, Math.min(100, Math.round(score)));
}
function calcOppScoreKR(kospiChg3d, sectorRS) {
  let score = 50;
  if (kospiChg3d > 2) score += 22; else if (kospiChg3d > 0) score += 10; else if (kospiChg3d > -2) score -= 5; else score -= 22;
  const krBull = (sectorRS||[]).filter(s=>s.market==="kr"&&s.chg1W>0).length;
  score += krBull * 4;
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

// 매물대 저항선 감지
function findResistanceLevels(candles, curPrice) {
  if(!candles||candles.length<20)return[];
  const highs=candles.map(c=>c.high||c.close);
  const peaks=[];
  for(let i=3;i<highs.length-3;i++){
    if(highs[i]>highs[i-1]&&highs[i]>highs[i-2]&&highs[i]>highs[i-3]&&highs[i]>highs[i+1]&&highs[i]>highs[i+2]&&highs[i]>highs[i+3]){
      peaks.push(+highs[i].toFixed(2));
    }
  }
  const clustered=[];
  for(const p of peaks){
    const ex=clustered.find(c=>Math.abs(c.price-p)/p<0.015);
    if(ex){ex.count++;ex.price=(ex.price+p)/2;}
    else clustered.push({price:+p.toFixed(2),count:1});
  }
  return clustered.filter(c=>c.price>curPrice).sort((a,b)=>b.count-a.count).slice(0,3).sort((a,b)=>a.price-b.price);
}

// ADX (추세강도)
function calcADX(candles, p=14) {
  if(candles.length<p+1)return new Array(candles.length).fill(null);
  const plusDM=[],minusDM=[],tr=[];
  for(let i=1;i<candles.length;i++){
    const up=candles[i].high-candles[i-1].high,down=candles[i-1].low-candles[i].low;
    plusDM.push(up>down&&up>0?up:0);minusDM.push(down>up&&down>0?down:0);
    tr.push(Math.max(candles[i].high-candles[i].low,Math.abs(candles[i].high-candles[i-1].close),Math.abs(candles[i].low-candles[i-1].close)));
  }
  let sTR=tr.slice(0,p).reduce((a,b)=>a+b,0);
  let sPDM=plusDM.slice(0,p).reduce((a,b)=>a+b,0);
  let sMDM=minusDM.slice(0,p).reduce((a,b)=>a+b,0);
  const res=new Array(p).fill(null);const dx=[];
  for(let i=p;i<tr.length;i++){
    sTR=sTR-sTR/p+tr[i];sPDM=sPDM-sPDM/p+plusDM[i];sMDM=sMDM-sMDM/p+minusDM[i];
    const pDI=sTR>0?100*sPDM/sTR:0,mDI=sTR>0?100*sMDM/sTR:0,sum=pDI+mDI;
    dx.push(sum>0?100*Math.abs(pDI-mDI)/sum:0);
    res.push({pdi:+pDI.toFixed(1),mdi:+mDI.toFixed(1),adx:null});
  }
  if(dx.length<p)return res.map(r=>r||null);
  let adxVal=dx.slice(0,p).reduce((a,b)=>a+b,0)/p;
  const out=new Array(p*2).fill(null);
  for(let i=0;i<res.length-p;i++){
    adxVal=(adxVal*(p-1)+(dx[i+p]||0))/p;
    out.push({...res[p+i],adx:+adxVal.toFixed(1)});
  }
  return out;
}

// OBV (거래량균형)
function calcOBV(candles) {
  let obv=0;const res=[];
  for(let i=0;i<candles.length;i++){
    if(i>0){if(candles[i].close>candles[i-1].close)obv+=candles[i].volume;else if(candles[i].close<candles[i-1].close)obv-=candles[i].volume;}
    res.push(+(obv/1e6).toFixed(2));
  }
  return res;
}

function buildChartData(candles){
  const closes=candles.map(c=>c.close);
  const s1=calcST(candles,10,1),s2=calcST(candles,11,2),s3=calcST(candles,12,3);
  const ema50=calcEMA(closes,50),rsi=calcRSI(closes),{ml,sl,hist}=calcMACD(closes),atr=calcATR(candles);
  const hma20=calcHMA(closes,20);
  const sqzData=calcSqueeze(candles);
  const avwap=calcAVWAP(candles);
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
      avwap:avwap[ci]||null};
  });
  for(let i=1;i<data.length;i++){const c=data[i],p=data[i-1];const flip=c.bullCount===3&&p.bullCount<3,mx=c.macd>c.signal&&p.macd<=p.signal;if(flip&&mx)c.buyStrong=c.close;else if(flip)c.buyNormal=c.close;}
  const ac=data.map(d=>d.close);
  data.forEach((d,i)=>{d.ma20=i>=19?+(ac.slice(i-19,i+1).reduce((a,b)=>a+b)/20).toFixed(2):null;d.ma200=i>=199?+(ac.slice(i-199,i+1).reduce((a,b)=>a+b)/200).toFixed(2):null;});
  const adxData=calcADX(candles);const obvData=calcOBV(candles);
  const off2=candles.length-data.length;
  data.forEach((d,i)=>{const ci=i+off2;if(adxData[ci])Object.assign(d,adxData[ci]);if(obvData[ci]!=null)d.obv=obvData[ci];});
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
function calcEntryScore(chartData, vixVal, oppScore, stockInfo) {
  const last = chartData?.at(-1);
  if (!last) return { score: 0, breakdown: [], grade: "?" };
  let score = 0;
  const breakdown = [];

  // ① 구름 위 (15점)
  if (last.aboveCloud)       { score += 15; breakdown.push({label:"구름위",pts:15,ok:true}); }
  else if (last.nearCloud)   { score += 6;  breakdown.push({label:"구름접근",pts:6,ok:true}); }
  else                       {               breakdown.push({label:"구름아래",pts:0,ok:false}); }

  // ② 트리플ST (25점)
  const stC=[last.st1Bull,last.st2Bull,last.st3Bull].filter(v=>v!=null).length;
  if (stC===3)      { score+=25; breakdown.push({label:"ST3/3",pts:25,ok:true}); }
  else if (stC===2) { score+=12; breakdown.push({label:"ST2/3",pts:12,ok:true}); }
  else if (stC===1) { score+=4;  breakdown.push({label:"ST1/3",pts:4,ok:false}); }
  else              {             breakdown.push({label:"ST0/3",pts:0,ok:false}); }

  // ③ MACD 크로스 (15점)
  if (last.macd>last.signal&&last.hist>0) { score+=15; breakdown.push({label:"MACD↑크로스",pts:15,ok:true}); }
  else if (last.hist>0)                   { score+=6;  breakdown.push({label:"MACD양전",pts:6,ok:true}); }
  else                                    {             breakdown.push({label:"MACD음전",pts:0,ok:false}); }

  // ④ RS 상위 랭킹 (25점) — 추세추종 핵심
  const rsPct = stockInfo?.rsPctRank || 50;
  if (rsPct>=90)      { score+=25; breakdown.push({label:"RS상위10%",pts:25,ok:true}); }
  else if (rsPct>=80) { score+=18; breakdown.push({label:"RS상위20%",pts:18,ok:true}); }
  else if (rsPct>=60) { score+=10; breakdown.push({label:`RS상위${Math.round(100-rsPct)}%`,pts:10,ok:true}); }
  else if (rsPct>=40) { score+=3;  breakdown.push({label:`RS중위`,pts:3,ok:false}); }
  else                {             breakdown.push({label:`RS하위`,pts:0,ok:false}); }

  // ⑤ RSI 모멘텀 (10점) — 70+도 강한 추세
  const rsi = last.rsi;
  if (rsi>=60&&rsi<=80)       { score+=10; breakdown.push({label:`RSI${rsi?.toFixed(0)}강세`,pts:10,ok:true}); }
  else if (rsi>=50&&rsi<60)   { score+=7;  breakdown.push({label:`RSI${rsi?.toFixed(0)}`,pts:7,ok:true}); }
  else if (rsi>80)            { score+=5;  breakdown.push({label:`RSI${rsi?.toFixed(0)}과열`,pts:5,ok:true}); }
  else if (rsi>=40&&rsi<50)   { score+=3;  breakdown.push({label:`RSI${rsi?.toFixed(0)}약세`,pts:3,ok:false}); }
  else                        {             breakdown.push({label:`RSI${rsi?.toFixed(0)||'?'}저조`,pts:0,ok:false}); }

  // ⑥ 52주 신고가 (10점) — 돌파 = 추세 확인
  const w52Near = last.w52Near;
  const w52Break = stockInfo?.w52Breakout;
  if (w52Break)          { score+=10; breakdown.push({label:"신고가돌파",pts:10,ok:true}); }
  else if (w52Near)      { score+=5;  breakdown.push({label:"신고가근접",pts:5,ok:true}); }
  else                   {             breakdown.push({label:"신고가미달",pts:0,ok:false}); }

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

  // 차트 데이터 있을 때 → 전체 지표 활용
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

  // ★ v2.2: 차트 데이터 없을 때 → 풀 메타데이터로 보완 점수
  if(!last && s.rsPctRank) {
    if(s.rsPctRank>=90){sc+=15;signals.push("RS상위10%");}
    else if(s.rsPctRank>=70){sc+=8;signals.push("RS상위30%");}
  }
  if(!last && s.w52Breakout){sc+=10;signals.push("신고가돌파");}
  if(!last && s.volRatio) {
    s._volRatio = s.volRatio;
    if(s.volRatio>=200){sc+=10;signals.push("거래량급증");}
    else if(s.volRatio>=150){sc+=5;signals.push("거래량증가");}
  }
  if(!last && (s.chg3d||0)>3){sc+=5;signals.push("3일강세");}
  if(!last && (s.changePct||0)>2){sc+=5;signals.push("금일급등");}

  const mktCap=s.mktCap||0;
  const isKR=(s.market||"").includes("kr")||(s.ticker||"").length>5;
  s._signals=signals;s._rs=rs;
  return{score:Math.min(100,Math.max(0,sc)),signals,rs,volRatio:s._volRatio||s.volRatio||100};
}

// ═══════════════════════════════════════════════════════════
// 2b. ★ v2.2: CSV 내보내기 유틸
// ═══════════════════════════════════════════════════════════

// ★ v2.2: 피보나치 되돌림 계산
function calcFibonacci(candles, lookback=60) {
  if (!candles||candles.length<10) return null;
  const slice = candles.slice(-Math.min(lookback,candles.length));
  const high = Math.max(...slice.map(c=>c.high||c.close));
  const low = Math.min(...slice.map(c=>c.low||c.close));
  const range = high - low;
  if (range <= 0) return null;
  return {
    high: +high.toFixed(2), low: +low.toFixed(2),
    fib236: +(high - range*0.236).toFixed(2),
    fib382: +(high - range*0.382).toFixed(2),
    fib500: +(high - range*0.500).toFixed(2),
    fib618: +(high - range*0.618).toFixed(2),
    fib786: +(high - range*0.786).toFixed(2),
  };
}

// ★ v2.2: 거래대금 계산 (volume × close)
function calcTurnover(candles) {
  if (!candles||!candles.length) return 0;
  const last = candles[candles.length-1];
  return (last.volume||0) * (last.close||0);
}
function fmtTurnover(v, isKR) {
  if (!v) return "—";
  if (isKR) {
    if (v >= 1e12) return `${(v/1e12).toFixed(1)}조`;
    if (v >= 1e8) return `${(v/1e8).toFixed(0)}억`;
    return `${(v/1e6).toFixed(0)}백만`;
  }
  if (v >= 1e9) return `${(v/1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v/1e6).toFixed(0)}M`;
  return `${(v/1e3).toFixed(0)}K`;
}

function exportCSV(closedLog) {
  if (!closedLog?.length) return;
  const headers = ["종목","티커","진입가","청산가","손익%","진입일","청산일","보유일수","청산사유","신호"];
  const rows = closedLog.map(h => [
    h.label||"", h.ticker||"", h.entry||h.basePrice||"", h.exitPrice||h.current||"",
    h.pnl||h.finalPnl||"", h.addedDate||h.date||"", h.exitDate||"",
    h.holdDays||"", h.reason||"", (h.foundSignals||[]).join("+")
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = `alpha_trades_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════
// 2c. ★ v2.2: 에쿼티 커브 데이터 생성
// ═══════════════════════════════════════════════════════════
function buildEquityCurve(closedLog, initialCapital=10000000) {
  if (!closedLog?.length) return [];
  const sorted = [...closedLog].sort((a,b) => new Date(a.exitDate||a.addedDate||0) - new Date(b.exitDate||b.addedDate||0));
  let equity = initialCapital;
  return sorted.map((h, i) => {
    const pnlPct = parseFloat(h.pnl || h.finalPnl || 0);
    const tradeAmt = equity * 0.1;
    equity += tradeAmt * (pnlPct / 100);
    return {
      idx: i + 1,
      date: h.exitDate || `#${i+1}`,
      equity: Math.round(equity),
      pnlPct: +pnlPct.toFixed(2),
      label: h.label || h.ticker || "",
      cumPnl: +(((equity - initialCapital) / initialCapital) * 100).toFixed(2),
    };
  });
}

// ═══════════════════════════════════════════════════════════
// 2d. ★ v2.2: 브라우저 알림 헬퍼
// ═══════════════════════════════════════════════════════════
// ★ v2.2: 지수 미니차트 데이터 생성
function genIndexChart(price, chg3d, chg5d, vol=0.008) {
  if (!price || price <= 0) return [];
  const data = []; const now = new Date();
  let p = price / (1 + (chg5d||0)/100) * (1 - vol*2);
  for (let i = 30; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    if (d.getDay()===0||d.getDay()===6) continue;
    const drift = i <= 5 ? (chg5d||0)/500 : i <= 8 ? (chg3d||0)/300 : 0;
    p = p * (1 + (Math.random()-0.48)*vol + drift);
    data.push({ date:`${d.getMonth()+1}/${d.getDate()}`, close:+p.toFixed(2) });
  }
  if (data.length) data[data.length-1].close = price;
  return data;
}

function sendNotification(title, body, tag) {
  // 브라우저 알림
  if ("Notification" in window && Notification.permission === "granted") {
    try { new Notification(title, { body, icon: "📊", tag: tag||"alpha-terminal", renotify: true }); } catch {}
  }
}
function requestNotifPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

// ═══════════════════════════════════════════════════════════
// 3. 서브컴포넌트
// ═══════════════════════════════════════════════════════════
function Tip({active,payload,label}){
  if(!active||!payload?.length)return null;
  return<div style={{background:"#0a0f1e",border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",fontSize:10}}><div style={{color:C.sub,marginBottom:4,fontWeight:700}}>{label}</div>{payload.filter(p=>p.value!=null).map((p,i)=><div key={i} style={{color:p.color||C.text}}>{p.name}: <b>{typeof p.value==="number"?p.value.toLocaleString(undefined,{maximumFractionDigits:2}):p.value}</b></div>)}</div>;
}
function BuyDot({cx,cy,payload,dataKey}){if(!payload?.[dataKey])return null;const c=dataKey==="buyStrong"?"#4ade80":"#FFD60A",sz=dataKey==="buyStrong"?11:8;return<g><polygon points={`${cx},${cy-sz} ${cx-sz*.8},${cy+sz*.5} ${cx+sz*.8},${cy+sz*.5}`} fill={c} stroke="#000" strokeWidth="1" opacity=".9"/></g>;}
function HistBar({x,y,width,height,value}){if(value==null)return null;const h=Math.abs(height),pos=value>0;return<rect x={x} y={pos?y:y+height-h} width={Math.max(1,width)} height={h} fill={pos?"rgba(34,197,94,.7)":"rgba(255,69,58,.7)"} rx={1}/>;}

// ── 가격 포맷 (★ v2.2: K단위 통일) ─────────────
function fmtKRW(v) {
  if (!v && v !== 0) return "—";
  if (Math.abs(v) >= 1000000) return `${(v/1000).toLocaleString("ko-KR",{maximumFractionDigits:0})}K`;
  if (Math.abs(v) >= 1000) return `${Math.round(v/1000).toLocaleString()}K`;
  return v.toLocaleString("ko-KR");
}
function fmtPrice(v, isKR) {
  if (!v && v !== 0) return "—";
  if (isKR) return fmtKRW(v);
  if (v >= 10000) return v.toLocaleString("en",{maximumFractionDigits:0});
  return v.toFixed(2);
}

// ★ v2.3: 종목명 표시 — 미국=티커, 한국=이름(절단)
function fmtName(s, maxLen=6) {
  if (!s) return "—";
  const ticker = s.ticker || "";
  const label = s.label || ticker;
  const isKR = (s.market||"").includes("kr") || (s.market||"").includes("🇰🇷") || /^\d{6}$/.test(ticker);
  if (isKR) {
    // 한국: 이름 절단
    return label.length > maxLen ? label.slice(0, maxLen) : label;
  }
  // 미국: 티커
  return ticker;
}
// 풀네임 (차트 등 넓은 공간용)
function fmtFullName(s) {
  if (!s) return "—";
  const ticker = s.ticker || "";
  const label = s.label || ticker;
  const isKR = (s.market||"").includes("kr") || (s.market||"").includes("🇰🇷") || /^\d{6}$/.test(ticker);
  if (isKR) return `${label} ${ticker}`;
  return `${ticker} ${label}`;
}

const css = {
  card: { background:"#1C1C1E", border:`1px solid rgba(255,255,255,.06)`, borderRadius:14, padding:16, marginBottom:14 },
  panel2: { background:"#2C2C2E", border:`1px solid rgba(255,255,255,.06)`, borderRadius:12, padding:"10px 14px" },
  btn: (on=false) => ({ borderRadius:10, padding:"6px 14px", cursor:"pointer", fontWeight:600, fontSize:11, border:`1px solid ${on?"rgba(10,132,255,.4)":"rgba(255,255,255,.08)"}`, background:on?"rgba(10,132,255,.15)":"rgba(255,255,255,.04)", color:on?C.accent:C.muted }),
};

// ═══════════════════════════════════════════════════════════
// 4. 메인 앱
// ═══════════════════════════════════════════════════════════
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
  // ★ v2.2: 실험실 탭
  const [labStock, setLabStock] = useState(null);
  const [labPoint, setLabPoint] = useState(null);
  // ★ v2.2: 지수 미니차트
  const [selIndex, setSelIndex] = useState(null);

  // ── 데이터 상태 ──────────────────────────────────────────
  const [dataStatus, setDataStatus] = useState("loading");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [indicesData, setIndicesData] = useState({});
  const [sectorsData, setSectorsData] = useState({});
  const [breadthData, setBreadthData] = useState({kr:{upPct:0,up:0,down:0},us:{upPct:0,up:0,down:0}});
  const [rsKey, setRsKey]   = useState("chg1M");
  const [ibVol, setIbVol]   = useState(0);

  // ── 발굴탭 ────────────────────────────────────────────
  const [fVolRatio, setFVolRatio] = useState(0);
  const [alphaSort, setAlphaSort] = useState("score"); // score, accel, rs, chg3d, vol
  const [fMarket, setFMarket]   = useState("all");
  const [fST, setFST]           = useState(0);
  const [fCloud, setFCloud]     = useState("all");
  const [fRS, setFRS]           = useState(0);
  const [alphaTab, setAlphaTab] = useState("filter");
  const [chartOpts, setChartOpts] = useState({ichi:false, st:true, avwap:false, adx:false, obv:false});
  const [alphaHitsRemote, setAlphaHitsRemote] = useState([]);
  const [pool, setPool]         = useState({});
  const [poolLoaded, setPoolLoaded] = useState(false);
  const [poolFilter, setPoolFilter] = useState("");
  const [poolMarket, setPoolMarket] = useState("all");
  const [poolMsg, setPoolMsg]   = useState("");
  const [watchlist, setWatchlist] = useState(()=>{try{const s=localStorage.getItem("at_watchlist");return s?JSON.parse(s):[];}catch{return [];}});

  // ── 백테스트 ────────────────────────────────────────────
  const [btConds, setBtConds] = useState({st3:true, cloud:true, macdCross:false, volSurge:false, w52:false});
  const [btStopPct, setBtStopPct] = useState(10);
  const [btTargetPct, setBtTargetPct] = useState(20);
  const [btResult, setBtResult] = useState(null);

  // ── 차트 진입 ────────────────────────────────────────────
  const [stopPct, setStopPct]   = useState(()=>{ try{const s=localStorage.getItem("at_trail");return s?JSON.parse(s).initialStopPct||5:5;}catch{return 5;} });
  const [stockMode, setStockMode] = useState("basic"); // 종목별 기본/특별 토글
  const [checklist, setChecklist] = useState({market:false,sector:false,stock:false,timing:false,risk:false});

  // ── 13번: 포지션 사이징 & 리스크 관리 ────────────────────
  const [riskSettings, setRiskSettings] = useState(()=>{
    try{const s=localStorage.getItem("at_risk");return s?JSON.parse(s):{totalCapital:5000000,specialCapital:10000000,maxPositions:10,maxWeightPct:100,investMode:"basic"};}
    catch{return{totalCapital:5000000,specialCapital:10000000,maxPositions:10,maxWeightPct:100,investMode:"basic"};}
  });
  const [showRiskPanel, setShowRiskPanel] = useState(false);

  // ── 12번: 불타기 + 트레일링컷 설정 ──────────────────────
  const [trailSettings, setTrailSettings] = useState(()=>{
    try{const s=localStorage.getItem("at_trail");return s?JSON.parse(s):{initialStopPct:5,trailPct:8,switchPct:10,timeCutDays:14,timeCutPct:3};}
    catch{return{initialStopPct:5,trailPct:8,switchPct:10,timeCutDays:14,timeCutPct:3};}
  });

  // ★ v2.2: 투자모드에 따른 불타기룰
  const isSpecial = riskSettings.investMode === "special";
  const PYRAMID_RULES = isSpecial ? PYRAMID_SPECIAL : PYRAMID_BASIC;
  const activeCapital = isSpecial ? (riskSettings.specialCapital||10000000) : (riskSettings.totalCapital||5000000);

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

  // ── ★ v2.2: 매매 일지 ──────────────────────────────────
  const [tradeJournal, setTradeJournal] = useState(()=>{try{const s=localStorage.getItem("at_journal");return s?JSON.parse(s):[];}catch{return [];}});
  const [journalDraft, setJournalDraft] = useState({ticker:"",type:"진입",reason:"",emotion:"보통",note:""});

  // ── ★ v2.2: 알림 시스템 ──────────────────────────────────
  const [alerts, setAlerts] = useState([]);

  // ════════════════════════════════════════════════════════
  // ★ 데이터 로딩
  // ════════════════════════════════════════════════════════
  // 알림 권한 요청
  useEffect(()=>{requestNotifPermission();},[]);

  useEffect(()=>{
    fetch("/data/stocks.json")
      .then(r=>{if(!r.ok)throw new Error("no data");return r.json();})
      .then(json=>{
        const stocksJson=json.stocks||{};
        setIndicesData(json.indices||{});
        if(json.sectors&&Object.keys(json.sectors).length>0) setSectorsData(json.sectors);
        if(json.breadth) setBreadthData(json.breadth);
        // ★ v2.3: 풀 자동 로드
        const poolData = json.pool&&Object.keys(json.pool).length>0 ? json.pool : {};
        if(Object.keys(poolData).length>0){setPool(poolData);setPoolLoaded(true);}
        if(json.ibVol) setIbVol(json.ibVol);
        if(Object.keys(stocksJson).length>0){
          setStocks(prev=>prev.map(s=>{
            const real=stocksJson[s.ticker];if(!real)return s;
            // ★ v2.3 FIX: changePct를 캔들 데이터로 보정 (chartPreviousClose 오류 방지)
            let correctedChgPct = real.changePct ?? 0;
            if(real.candles && real.candles.length >= 2){
              const last = real.candles.at(-1)?.close;
              const prev2 = real.candles.at(-2)?.close;
              if(last > 0 && prev2 > 0) correctedChgPct = +((last - prev2) / prev2 * 100).toFixed(2);
            }
            return{...s,price:real.price||s.price,chg3d:real.chg3d??s.chg3d,chg5d:real.chg5d??s.chg5d,changePct:correctedChgPct,volRatio:real.volRatio??s.volRatio??100,mktCap:real.mktCap??s.mktCap??0};
          }));
          const newCharts={};
          // ① 실시간 캔들 데이터 보유 종목
          for(const[ticker,sd]of Object.entries(stocksJson)){
            if(sd.candles&&sd.candles.length>30){try{newCharts[ticker]={data:buildChartData(sd.candles),real:true};}catch{}}
          }
          // ② ★ v2.3: pool 종목 중 price>0 이고 차트 미보유 → 시뮬 차트 생성
          //    (돌파감지/진입평점 범위 확대, 대형주 편향 해소)
          const poolEntries = Object.entries(poolData);
          let batchIdx = 0;
          const BATCH = 50;
          function buildPoolBatch(){
            const slice = poolEntries.slice(batchIdx, batchIdx+BATCH);
            if(!slice.length) return;
            const batchCharts = {};
            for(const [ticker,info] of slice){
              if(newCharts[ticker] || !info.price || info.price<=0) continue;
              try{
                const candles = genCandles({
                  price: info.price, base: info.base||(info.price*0.88),
                  vol: info.vol||0.02, drift: info.drift||0.001
                });
                batchCharts[ticker] = {data:buildChartData(candles),real:false};
              }catch{}
            }
            if(Object.keys(batchCharts).length>0){
              setCharts(prev=>({...prev,...batchCharts}));
            }
            batchIdx += BATCH;
            if(batchIdx < poolEntries.length) setTimeout(buildPoolBatch, 100);
          }
          setCharts(newCharts);
          // pool 차트 배치 생성 시작 (UI 블로킹 방지)
          if(poolEntries.length>0) setTimeout(buildPoolBatch, 300);
          setDataStatus("real");setLastUpdated(json.updatedAt);
        }else{setDataStatus("sim");}
      }).catch(()=>setDataStatus("sim"));
  },[]);

  // 포지션 현재가 + 트레일링 자동 갱신
  useEffect(()=>{
    if(!positions.length)return;
    setPositions(prev=>prev.map(pos=>{
      const cur=(stocks.find(s=>s.ticker===pos.ticker)||pool[pos.ticker])?.price||pos.current;
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
          // ★ v2.2: 브라우저 알림 발사
          const msg=`${pos.label} +${pnl.toFixed(1)}% → ${lv.level||lv.step||""}차 불타기 목표 도달!`;
          sendNotification("🔥 불타기 알림", msg, `pyramid-${pos.id}-${lv.level||lv.step}`);
          setAlerts(a=>[{id:Date.now(),type:"pyramid",msg,ticker:pos.ticker,time:new Date().toLocaleTimeString("ko-KR")},...a].slice(0,20));
          return{...lv,triggered:true,triggeredAt:new Date().toLocaleTimeString("ko-KR")};
        }
        return lv;
      });
      // ★ v2.2: 매도 목표가 도달 알림
      const target=pos.target||0;
      if(target>0&&cur>=target&&!pos._targetAlerted){
        const msg2=`${pos.label} 목표가 도달! 현재 ${cur.toLocaleString()} ≥ 목표 ${target.toLocaleString()} (+${pnl.toFixed(1)}%)`;
        sendNotification("🎯 목표가 도달", msg2, `target-${pos.id}`);
        setAlerts(a=>[{id:Date.now(),type:"target",msg:msg2,ticker:pos.ticker,time:new Date().toLocaleTimeString("ko-KR")},...a].slice(0,20));
        pos._targetAlerted=true;
      }
      // ★ v2.2: 손절선 근접 알림 (5% 이내)
      const trailDist=pos.trailStop>0?((cur-newTrail)/cur*100):99;
      if(trailDist<2&&!pos._stopAlerted){
        const msg3=`${pos.label} 손절선 근접! 현재가-손절가 ${trailDist.toFixed(1)}%`;
        sendNotification("🚨 손절선 근접", msg3, `stop-${pos.id}`);
        setAlerts(a=>[{id:Date.now(),type:"stop",msg:msg3,ticker:pos.ticker,time:new Date().toLocaleTimeString("ko-KR")},...a].slice(0,20));
        pos._stopAlerted=true;
      }else if(trailDist>=5){pos._stopAlerted=false;}
      // ★ v2.2: 타임컷 판정 (박스권 감지)
      const entryDate=pos.date||pos.entryDate;
      const daysHeld=entryDate?Math.round((Date.now()-new Date(entryDate).getTime())/86400000):0;
      const absPnl=Math.abs(pnl);
      const isTimeCut=daysHeld>=ts.timeCutDays&&absPnl<=(ts.timeCutPct||3);
      const timeCutInfo={daysHeld,isTimeCut,absPnl};
      return{...pos,current:cur,max:newMax,pnl,trailStop:newTrail,trailMode:pnl>=ts.switchPct,pyramid:updatedPyramid,timeCutInfo};
    }));
  },[stocks,pool,trailSettings]);

  // localStorage 저장
  useEffect(()=>{try{localStorage.setItem("at_stocks",JSON.stringify(stocks));}catch{}},[stocks]);
  useEffect(()=>{try{localStorage.setItem("at_positions",JSON.stringify(positions));}catch{}},[positions]);
  useEffect(()=>{try{localStorage.setItem("at_tracking",JSON.stringify(tracking));}catch{}},[tracking]);
  useEffect(()=>{try{localStorage.setItem("at_closed",JSON.stringify(closedLog));}catch{}},[closedLog]);
  useEffect(()=>{try{localStorage.setItem("at_notes",investNotes);}catch{}},[investNotes]);
  useEffect(()=>{try{localStorage.setItem("at_risk",JSON.stringify(riskSettings));}catch{}},[riskSettings]);
  useEffect(()=>{try{localStorage.setItem("at_trail",JSON.stringify(trailSettings));}catch{}},[trailSettings]);
  useEffect(()=>{try{localStorage.setItem("at_journal",JSON.stringify(tradeJournal));}catch{}},[tradeJournal]);
  useEffect(()=>{try{localStorage.setItem("at_watchlist",JSON.stringify(watchlist));}catch{}},[watchlist]);

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
    const info=stocks.find(s=>s.ticker===sel) || (pool[sel] ? {ticker:sel, ...pool[sel]} : null);
    if(!info)return;
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

  // ★ v2.2: 매매 일지 추가
  function addJournalEntry() {
    if (!journalDraft.ticker && !journalDraft.note) return;
    const tk = journalDraft.ticker || sel || "";
    const stk = stocks.find(s=>s.ticker===tk) || (pool[tk] ? {ticker:tk, ...pool[tk]} : null);
    const cData = charts[tk]?.data;
    const lastPt = cData?.at(-1);
    const stCount = [lastPt?.st1Bull,lastPt?.st2Bull,lastPt?.st3Bull].filter(v=>v!=null).length;
    const entry = {
      id: Date.now(),
      date: new Date().toLocaleDateString("ko-KR"),
      time: new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"}),
      ...journalDraft,
      ticker: tk,
      // ★ 자동 기록 데이터
      price: stk?.price || 0,
      changePct: stk?.changePct || 0,
      stCount,
      rsi: lastPt?.rsi ? +lastPt.rsi.toFixed(0) : null,
      cloud: lastPt?.aboveCloud?"구름위":lastPt?.nearCloud?"접근":"아래",
      entryGrade: calcEntryScore(cData,vixVal,oppScore,pool[tk]||stk||{}).grade,
      oppScore,
    };
    setTradeJournal(prev => [entry, ...prev]);
    setJournalDraft({ticker:"",type:"진입",reason:"",emotion:"보통",note:""});
  }

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
      // ★ v2.3: changePct를 캔들 기반 1일 변동률로 보정
      let changePct = qData.changePct ?? 0;
      if(candles.length>=2){
        const lastC=candles.at(-1)?.close, prevC=candles.at(-2)?.close;
        if(lastC>0&&prevC>0) changePct = +((lastC-prevC)/prevC*100).toFixed(2);
      }
      return{...qData,changePct,chg3d:candles.length>3?+((candles.at(-1).close-candles.at(-4).close)/candles.at(-4).close*100).toFixed(2):0,chg5d:candles.length>5?+((candles.at(-1).close-candles.at(-6).close)/candles.at(-6).close*100).toFixed(2):0,candles,base:isKR?Math.round(price*0.88):+(price*0.88).toFixed(2),vol:0.02,drift:0.001};
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
          // ★ v2.3 FIX: previousClose(전일종가) 우선 → 1일 변동률
          // chartPreviousClose는 차트 시작(3개월전) 가격이므로 사용 금지
          const prevClose=parseFloat(meta.previousClose||meta.chartPreviousClose||price);
          const ts=res.timestamp||[],q=res.indicators?.quote?.[0]||{};
          const candles=ts.map((t,i)=>{const d=new Date(t*1000);return{date:`${d.getMonth()+1}/${d.getDate()}`,close:+(q.close?.[i]||price).toFixed(2),high:+(q.high?.[i]||price).toFixed(2),low:+(q.low?.[i]||price).toFixed(2),volume:q.volume?.[i]||0};}).filter(c=>c.close>0);
          // 1일 변동률: 캔들 마지막 2개로 직접 계산 (가장 정확)
          const dayChgPct = candles.length>=2
            ? +((candles.at(-1).close - candles.at(-2).close) / candles.at(-2).close * 100).toFixed(2)
            : +((price - prevClose) / prevClose * 100).toFixed(2);
          return{ticker,label:meta.longName||meta.shortName||ticker,price,change:+(price-prevClose).toFixed(2),changePct:dayChgPct,chg3d:candles.length>3?+((candles.at(-1).close-candles.at(-4).close)/candles.at(-4).close*100).toFixed(2):0,chg5d:candles.length>5?+((candles.at(-1).close-candles.at(-6).close)/candles.at(-6).close*100).toFixed(2):0,sector:"Technology",market:isKR?"🇰🇷":"🇺🇸",roe:0,per:0,rev:0,revGrowth:0,mktCap:meta.marketCap||0,target:+(price*1.2).toFixed(isKR?0:2),liquidity:2,base:+(price*0.88).toFixed(isKR?0:2),vol:0.02,drift:0.001,candles};
        }
      }catch{}
      return null;
    }
  }
  function removeStock(t){
    // ★ 개선: 보유 포지션이 있는 종목은 삭제 방지
    if(positions.find(p=>p.ticker===t)){setAddMsg("⚠️ 보유 포지션이 있어 삭제할 수 없습니다");setTimeout(()=>setAddMsg(""),3000);return;}
    setStocks(p=>p.filter(s=>s.ticker!==t));if(sel===t)setSel(stocks[0]?.ticker||"");
  }

  // ★ v2.3: pool 전용 종목도 차트 탭에서 볼 수 있도록 자동 추가 + 실시간 보강
  function navigateToStock(ticker, stockInfo) {
    const alreadyIn = stocks.find(s => s.ticker === ticker);
    const info = stockInfo || pool[ticker] || {};
    if (!alreadyIn) {
      setStocks(p => [...p, { ticker, ...info }]);
    }
    // 차트가 없으면 즉시 시뮬 차트 생성 (빈 화면 방지)
    if (!charts[ticker]) {
      const p = info.price || 100;
      const candles = genCandles({ price: p, base: info.base || p * 0.88, vol: info.vol || 0.02, drift: info.drift || 0.001 });
      setCharts(prev => ({ ...prev, [ticker]: { data: buildChartData(candles), real: false } }));
    }
    setSel(ticker);
    setTab("sniper");
    // ★ 배경: 실시간 캔들 데이터 시도 (시뮬→실시간 자동 전환)
    if (!charts[ticker]?.real) {
      fetchFromYahoo(ticker).then(real => {
        if (real && real.candles?.length > 10) {
          // 종목 정보 갱신
          setStocks(p => p.map(s => s.ticker === ticker ? { ...s, ...real, candles: undefined } : s));
          try { setCharts(prev => ({ ...prev, [ticker]: { data: buildChartData(real.candles), real: true } })); } catch {}
        }
      }).catch(() => {});
    }
  }

  // ── Phase 5: 백테스트 엔진 ──────────────────────────────
  function runBacktest() {
    const trades = [];
    // 차트 데이터가 있는 모든 종목을 스캔
    const targetTickers = Object.keys(charts).filter(t => charts[t]?.data?.length > 30);
    if (!targetTickers.length) { setBtResult({trades:[],msg:"차트 데이터 없음"}); return; }

    for (const ticker of targetTickers) {
      const data = charts[ticker].data;
      const stockInfo = stocks.find(s=>s.ticker===ticker) || pool[ticker] || {};

      for (let i = 20; i < data.length - 5; i++) {
        const d = data[i];
        const prev = data[i-1];

        // 조건 체크
        let pass = true;
        const matched = [];

        if (btConds.st3) {
          if (d.bullCount !== 3) pass = false;
          else matched.push("ST3/3");
        }
        if (btConds.cloud) {
          if (!d.aboveCloud) pass = false;
          else matched.push("구름위");
        }
        if (btConds.macdCross) {
          const cross = d.macd > d.signal && prev.macd <= prev.signal;
          if (!cross) pass = false;
          else matched.push("MACD↑");
        }
        if (btConds.volSurge) {
          const vols = data.slice(Math.max(0,i-20),i).map(x=>x.volume).filter(v=>v>0);
          const avg20 = vols.length ? vols.reduce((a,b)=>a+b,0)/vols.length : 0;
          if (!(avg20 > 0 && d.volume > avg20 * 1.5)) pass = false;
          else matched.push("거래량↑");
        }
        if (btConds.w52) {
          const w52h = Math.max(...data.slice(Math.max(0,i-252),i).map(x=>x.close));
          if (!(d.close >= w52h * 0.95)) pass = false;
          else matched.push("신고가");
        }

        if (!pass || matched.length === 0) continue;

        // 진입 → 결과 시뮬레이션
        const entry = d.close;
        const stopLoss = entry * (1 - btStopPct / 100);
        const takeProfit = entry * (1 + btTargetPct / 100);
        let exitPrice = null, exitReason = "", holdDays = 0;

        for (let j = i + 1; j < data.length; j++) {
          holdDays++;
          if (data[j].low <= stopLoss) { exitPrice = stopLoss; exitReason = "손절"; break; }
          if (data[j].high >= takeProfit) { exitPrice = takeProfit; exitReason = "익절"; break; }
          if (j === data.length - 1) { exitPrice = data[j].close; exitReason = "보유중"; }
        }

        if (exitPrice) {
          const pnl = +((exitPrice - entry) / entry * 100).toFixed(2);
          trades.push({ ticker, label: stockInfo.label||ticker, date: d.date, entry, exitPrice, pnl, reason: exitReason, holdDays, signals: matched });
        }

        // 같은 종목에서 연속 진입 방지 (최소 5일 간격)
        i += 4;
      }
    }

    const wins = trades.filter(t => t.pnl > 0).length;
    const total = trades.length;
    const avgPnl = total ? +(trades.reduce((a,t) => a+t.pnl, 0) / total).toFixed(2) : 0;
    const maxWin = total ? Math.max(...trades.map(t=>t.pnl)) : 0;
    const maxLoss = total ? Math.min(...trades.map(t=>t.pnl)) : 0;
    const profitFactor = (()=>{
      const grossWin = trades.filter(t=>t.pnl>0).reduce((a,t)=>a+t.pnl,0);
      const grossLoss = Math.abs(trades.filter(t=>t.pnl<0).reduce((a,t)=>a+t.pnl,0));
      return grossLoss > 0 ? +(grossWin/grossLoss).toFixed(2) : grossWin > 0 ? 999 : 0;
    })();

    setBtResult({
      trades: trades.sort((a,b)=>b.pnl-a.pnl),
      total, wins, winRate: total ? +(wins/total*100).toFixed(1) : 0,
      avgPnl, maxWin: +maxWin.toFixed(2), maxLoss: +maxLoss.toFixed(2),
      profitFactor, stockCount: targetTickers.length,
    });
  }

  // ── 파생 변수 ─────────────────────────────────────────────
  const SECTOR_RS=Object.entries(sectorsData).map(([etf,d])=>({name:d.label||etf,etf,market:d.market||"us",chg1W:d.chg1W||0,chg1M:d.chg1M||0,chg1d:d.chg1d||0,members:d.members||[]}));
  const selInfo  = stocks.find(s=>s.ticker===sel) || (pool[sel] ? {ticker:sel, ...pool[sel]} : null);
  const cd       = charts[sel];
  const lastD    = cd?.data?.at(-1);
  const sliced   = cd?.data?.slice(-PERIOD_DAYS[period])||[];
  const tstSig   = getTSTSig(cd?.data);
  const finalSig = tstSig.sig==="N/A"?"HOLD":tstSig.sig;
  const fs       = SIG[finalSig]||SIG.HOLD;
  const unit     = sel?.length>5?"₩":"$";
  const isKRSel  = (sel?.length||0)>5;
  const curPrice = selInfo?.price||0;
  const stopPrice= curPrice>0?+(curPrice*(1-stopPct/100)).toFixed(isKRSel?0:2):0;
  const w52High  = charts[sel]?.data?.at(-1)?.w52High||0;
  const rrTarget2= stopPrice>0&&curPrice>stopPrice?+(curPrice+(curPrice-stopPrice)*2).toFixed(isKRSel?0:2):0;
  const rrTarget3= stopPrice>0&&curPrice>stopPrice?+(curPrice+(curPrice-stopPrice)*3).toFixed(isKRSel?0:2):0;
  const consTgt  = rrTarget2||w52High||consensus[sel]?.data?.targetMean||selInfo?.target||0;
  const rrRatio  = stopPrice>0&&consTgt>0&&curPrice>stopPrice?+((consTgt-curPrice)/(curPrice-stopPrice)).toFixed(1):0;
  const checkOk  = Object.values(checklist).every(Boolean);

  const vixVal      = parseFloat(indicesData["^VIX"]?.price||20);
  const spChg3d     = indicesData["^GSPC"]?.chg3d??0;
  const kospiChg3d  = indicesData["^KS11"]?.chg3d??0;
  const oppScore    = calcOpportunityScore(vixVal,spChg3d,kospiChg3d,SECTOR_RS);
  const oppLabel    = oppScore>=70?"HIGH":oppScore>=45?"MODERATE":"LOW";
  const oppColor    = oppScore>=70?C.emerald:oppScore>=45?C.yellow:C.red;

  // ★ v2.2: US/KR 분리 점수
  const oppScoreUS  = calcOppScoreUS(vixVal,spChg3d,SECTOR_RS);
  const oppScoreKR  = calcOppScoreKR(kospiChg3d,SECTOR_RS);
  const oppColorUS  = oppScoreUS>=70?C.emerald:oppScoreUS>=45?C.yellow:C.red;
  const oppColorKR  = oppScoreKR>=70?C.emerald:oppScoreKR>=45?C.yellow:C.red;

  // 5번: 진입 평점 (풀 데이터에서 RS랭킹/52주 정보 전달)
  const selPoolInfo = pool[sel] || selInfo || {};
  const entryScore  = calcEntryScore(cd?.data, vixVal, oppScore, selPoolInfo);
  const entryGradeColor = {S:C.emerald,A:C.green,B:C.yellow,C:"#FF9F0A",D:C.red}[entryScore.grade]||C.muted;

  // ★ v2.2: 피보나치 + ATR 일변동폭 + 거래대금
  const fibLevels = cd?.data ? calcFibonacci(cd.data.map(d=>({high:d.close*1.005,low:d.close*0.995,close:d.close}))) : null;
  const atrDaily = lastD?.atr && curPrice>0 ? +((lastD.atr/curPrice)*100).toFixed(2) : null;
  const atrDaysToTarget = atrDaily>0 && consTgt>curPrice ? Math.ceil(((consTgt-curPrice)/curPrice*100)/atrDaily) : null;
  const selTurnover = cd?.data?.length ? calcTurnover(cd.data.map(d=>({volume:d.volume,close:d.close}))) : 0;

  const idxRS = {
    spy:  {chg3d:indicesData["^GSPC"]?.chg3d??-1.6,chg5d:indicesData["^GSPC"]?.chg5d??-2.0},
    qqq:  {chg3d:indicesData["^IXIC"]?.chg3d??-2.1,chg5d:indicesData["^IXIC"]?.chg5d??-2.8},
    kospi:{chg3d:indicesData["^KS11"]?.chg3d??+0.8,chg5d:indicesData["^KS11"]?.chg5d??-0.5},
  };

  // ★ v2.2: 발굴탭 — 종목풀 전체 스캔 (관심종목 + 풀 합산)
  const allStocksForScan = useMemo(() => {
    const merged = {};
    stocks.forEach(s => { merged[s.ticker] = s; });
    Object.entries(pool).forEach(([ticker, info]) => {
      if (!merged[ticker]) {
        merged[ticker] = { ticker, ...info };
      } else {
        merged[ticker] = { ...merged[ticker], rsPctRank:info.rsPctRank, rsRank:info.rsRank, w52Breakout:info.w52Breakout, w52DistPct:info.w52DistPct };
      }
    });
    return Object.values(merged);
  }, [stocks, pool]);

  const alphaHits=allStocksForScan.filter(s=>{
    const isKR=(s.market||"").includes("kr")||(s.ticker||"").length>5;
    if((s.volRatio||100)<fVolRatio)return false;
    if(fMarket==="kr"&&!isKR)return false;
    if(fMarket==="us"&&isKR)return false;
    return true;
  }).map(s=>{
    const r=alphaScore(s,charts[s.ticker]?.data,idxRS);
    const lD=charts[s.ticker]?.data?.at(-1);
    const stCount=[lD?.st1Bull,lD?.st2Bull,lD?.st3Bull].filter(v=>v!=null).length;
    const cloudSt=lD?.aboveCloud?"above":lD?.nearCloud?"near":"below";
    const rsVal=r.rs||0;
    if(fST>0&&stCount<fST)return null;
    if(fCloud==="above"&&cloudSt!=="above"&&lD)return null;
    if(fCloud==="near"&&cloudSt==="below"&&lD)return null;
    if(fRS>0&&rsVal<fRS)return null;
    // ★ v2.2: 가속 신호 계산
    const chg3d=s.chg3d||0, chg5d=s.chg5d||0;
    const accelTags=[];
    let accelScore=0;
    if(chg3d>0&&chg3d>chg5d){accelTags.push("🚀가속");accelScore+=3;}
    if(chg3d>2&&chg5d>0){accelTags.push("⚡급등");accelScore+=2;}
    const pD=charts[s.ticker]?.data?.at(-2);
    const stPrev=pD?[pD.st1Bull,pD.st2Bull,pD.st3Bull].filter(v=>v!=null).length:0;
    if(stCount>stPrev&&stCount>=2){accelTags.push("📈ST↑");accelScore+=2;}
    if(stCount===3&&stPrev<3){accelTags.push("🔥ST풀");accelScore+=3;}
    if(lD&&pD&&lD.macd>lD.signal&&pD.macd<=pD.signal){accelTags.push("⚡MACD↑");accelScore+=2;}
    if((s.volRatio||100)>=200){accelTags.push("💥거래량");accelScore+=1;}
    if(lD?.sqzOff){accelTags.push("💎스퀴즈");accelScore+=2;}
    // ★ v2.3: 진입평점 사전 계산
    const es=calcEntryScore(charts[s.ticker]?.data,vixVal,oppScore,pool[s.ticker]||s);
    return{...s,score:r.score,signals:r.signals,rs:r.rs,volRatio:s.volRatio||r.volRatio,stCount,cloudSt,accelTags,accelScore,chg3d,chg5d,entryScore:es.score,entryGrade:es.grade};
  }).filter(s=>s!=null).sort((a,b)=>{
    if(alphaSort==="entry")return(b.entryScore||0)-(a.entryScore||0)||(b.score||0)-(a.score||0);
    if(alphaSort==="accel")return(b.accelScore||0)-(a.accelScore||0)||(b.score||0)-(a.score||0);
    if(alphaSort==="rs")return(b.rs||0)-(a.rs||0);
    if(alphaSort==="chg3d")return(b.chg3d||0)-(a.chg3d||0);
    if(alphaSort==="vol")return(b.volRatio||0)-(a.volRatio||0);
    return(b.score||0)-(a.score||0);
  });

  // pool 필터링
  const poolFiltered = useMemo(() => Object.entries(pool).filter(([ticker,info])=>{
    if(poolMarket==="kr"&&info.market!=="kr")return false;
    if(poolMarket==="us"&&info.market!=="us")return false;
    if(poolFilter){const q=poolFilter.toLowerCase();return ticker.toLowerCase().includes(q)||(info.label||"").toLowerCase().includes(q);}
    return true;
  }), [pool, poolMarket, poolFilter]);

  // 13번: 권장 매수금액 계산
  const perStockMax = activeCapital;
  const pyramidAmts = PYRAMID_RULES.map(r=>Math.round(activeCapital*r.pct/100));
  const currentExposure = positions.length;
  const overPositions   = currentExposure>=riskSettings.maxPositions;

  // ★ v2.2: 에쿼티 커브 데이터
  const equityCurveData = buildEquityCurve(closedLog, riskSettings.totalCapital);

  const TABS=[["radar","🌐 시장"],["focus","🎯 집중"],["alpha","🔍 발굴"],["sniper","📊 차트"],["track",`📁 추적 (${tracking.length+positions.length})`],["lab","🔬 실험실"],["pool","🗃 종목풀"]];

  const pageStyle={minHeight:"100vh",background:"#000000",color:C.text,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display','Pretendard',sans-serif",display:"flex",flexDirection:"column",fontSize:12,WebkitFontSmoothing:"antialiased"};

  function RSBar(){return(
    <div style={{background:C.panel2,border:`1px solid ${C.border}`,borderRadius:9,padding:"10px 14px",marginBottom:12}}>
      <div style={{fontSize:9,fontWeight:700,color:C.muted,marginBottom:7}}>📊 지수 RS 기준선</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
        {[["S&P 500",idxRS.spy],["NASDAQ",idxRS.qqq],["KOSPI",idxRS.kospi]].map(([name,d])=>(
          <div key={name} style={{textAlign:"center"}}>
            <div style={{fontSize:8,color:C.muted,marginBottom:3}}>{name}</div>
            <div style={{display:"flex",gap:3,justifyContent:"center"}}>
              {[["3D",d.chg3d],["5D",d.chg5d]].map(([lbl,v])=>(
                <span key={lbl} style={{fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:4,border:`1px solid ${v>=0?"rgba(34,197,94,.35)":"rgba(255,69,58,.35)"}`,background:v>=0?"rgba(34,197,94,.08)":"rgba(255,69,58,.08)",color:v>=0?C.green:C.red}}>{lbl} {v>=0?"+":""}{v}%</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );}

  return (
    <div style={pageStyle}>
      <style>{`
        @keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes ap{0%,100%{border-color:rgba(255,69,58,.8)}50%{border-color:rgba(255,69,58,.2)}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:3px}
        ::-webkit-scrollbar-track{background:transparent}
        input,select,textarea,button{font-family:inherit}
      `}</style>

      {/* ── 헤더 ─────────────────────────────────── */}
      <div style={{borderBottom:`1px solid ${C.border}`,padding:"10px 16px",background:"#0d1526",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",position:"sticky",top:0,zIndex:50}}>
        <div>
          <div style={{fontSize:15,fontWeight:900,color:C.accent,letterSpacing:3}}>✦ ALPHA TERMINAL <span style={{fontSize:10,color:C.muted,letterSpacing:1,fontWeight:400}}>v2.3</span></div>
          <div style={{fontSize:9,color:C.muted}}>추세추종 · RS랭킹 · 백테스트</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          {dataStatus==="loading"&&<div style={{display:"flex",gap:2,alignItems:"center",color:C.accent,fontSize:8}}>{[0,1,2].map(i=><div key={i} style={{width:3,height:3,borderRadius:"50%",background:C.accent,animation:`bounce 1s ${i*.2}s infinite`}}/>)}로딩중</div>}
          {dataStatus==="real"&&<span style={{fontSize:8,color:C.green}}>🟢 실시간{lastUpdated?` (${new Date(lastUpdated).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})})`:""}</span>}
          {dataStatus==="sim"&&<span style={{fontSize:8,color:C.yellow}}>🟡 시뮬레이션</span>}
        </div>
        {/* 포지션 사이징 버튼 */}
        <button onClick={()=>setShowRiskPanel(v=>!v)} style={{...css.btn(showRiskPanel),fontSize:8,padding:"3px 8px"}}>⚙ 리스크설정</button>
        {/* 리스크 설정 패널 */}
        {showRiskPanel&&<div style={{position:"absolute",top:"100%",left:14,right:14,background:"#1C1C1E",border:`1px solid ${C.accent}`,borderRadius:14,padding:16,zIndex:100,boxShadow:"0 8px 32px rgba(0,0,0,.8)",maxHeight:"80vh",overflowY:"auto"}}>
          <div style={{fontSize:12,fontWeight:900,color:C.accent,marginBottom:12}}>⚙ 리스크 관리 센터</div>

          {/* 투자 모드 토글 */}
          <div style={{display:"flex",gap:6,marginBottom:14}}>
            {[["basic","기본 (₩"+fmtKRW(riskSettings.totalCapital)+")"],["special","특별 (₩"+fmtKRW(riskSettings.specialCapital||10000000)+")"]].map(([k,l])=>(
              <button key={k} onClick={()=>setRiskSettings(p=>({...p,investMode:k}))} style={{flex:1,padding:"8px",borderRadius:8,border:`2px solid ${riskSettings.investMode===k?C.accent:C.border}`,background:riskSettings.investMode===k?"rgba(10,132,255,.15)":"rgba(255,255,255,.03)",color:riskSettings.investMode===k?C.accent:C.muted,fontSize:10,fontWeight:700,cursor:"pointer"}}>{k==="special"?"⭐ ":""}{l}</button>
            ))}
          </div>

          {/* 투자금 설정 */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:12}}>
            <div>
              <div style={{fontSize:9,color:C.muted,marginBottom:4}}>기본 투자금</div>
              <input type="number" value={riskSettings.totalCapital} onChange={e=>setRiskSettings(p=>({...p,totalCapital:+e.target.value}))} style={{width:"100%",background:"rgba(255,255,255,.07)",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 8px",color:C.text,fontSize:10,outline:"none"}}/>
              <div style={{fontSize:8,color:C.muted,marginTop:2}}>₩{fmtKRW(riskSettings.totalCapital)}</div>
            </div>
            <div>
              <div style={{fontSize:9,color:C.muted,marginBottom:4}}>특별 투자금</div>
              <input type="number" value={riskSettings.specialCapital||10000000} onChange={e=>setRiskSettings(p=>({...p,specialCapital:+e.target.value}))} style={{width:"100%",background:"rgba(255,255,255,.07)",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 8px",color:C.text,fontSize:10,outline:"none"}}/>
              <div style={{fontSize:8,color:C.muted,marginTop:2}}>₩{fmtKRW(riskSettings.specialCapital||10000000)}</div>
            </div>
            <div>
              <div style={{fontSize:9,color:C.muted,marginBottom:4}}>최대 종목 수</div>
              <input type="range" min="3" max="20" value={riskSettings.maxPositions} onChange={e=>setRiskSettings(p=>({...p,maxPositions:+e.target.value}))} style={{width:"100%",accentColor:C.accent}}/>
              <div style={{fontSize:10,fontWeight:700,color:C.accent,textAlign:"center"}}>{riskSettings.maxPositions}종목</div>
            </div>
          </div>

          {/* 손절/트레일링 설정 */}
          <div style={{paddingTop:12,borderTop:`1px solid ${C.border}`}}>
            <div style={{fontSize:9,fontWeight:700,color:C.red,marginBottom:8}}>🛡 손절 & 트레일링</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
              <div>
                <div style={{fontSize:8,color:C.muted,marginBottom:4}}>초기 손절</div>
                <input type="range" min="3" max="15" value={trailSettings.initialStopPct} onChange={e=>setTrailSettings(p=>({...p,initialStopPct:+e.target.value}))} style={{width:"100%",accentColor:C.red}}/>
                <div style={{fontSize:11,fontWeight:700,color:C.red,textAlign:"center"}}>-{trailSettings.initialStopPct}%</div>
              </div>
              <div>
                <div style={{fontSize:8,color:C.muted,marginBottom:4}}>트레일링 폭</div>
                <input type="range" min="3" max="15" value={trailSettings.trailPct} onChange={e=>setTrailSettings(p=>({...p,trailPct:+e.target.value}))} style={{width:"100%",accentColor:C.yellow}}/>
                <div style={{fontSize:11,fontWeight:700,color:C.yellow,textAlign:"center"}}>고점-{trailSettings.trailPct}%</div>
              </div>
              <div>
                <div style={{fontSize:8,color:C.muted,marginBottom:4}}>전환 기준</div>
                <input type="range" min="3" max="30" value={trailSettings.switchPct} onChange={e=>setTrailSettings(p=>({...p,switchPct:+e.target.value}))} style={{width:"100%",accentColor:C.emerald}}/>
                <div style={{fontSize:11,fontWeight:700,color:C.emerald,textAlign:"center"}}>+{trailSettings.switchPct}%시 전환</div>
              </div>
            </div>
          </div>

          {/* 타임컷 설정 */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
            <div>
              <div style={{fontSize:8,color:C.muted,marginBottom:4}}>⏰ 타임컷 기간</div>
              <input type="range" min="5" max="30" value={trailSettings.timeCutDays||14} onChange={e=>setTrailSettings(p=>({...p,timeCutDays:+e.target.value}))} style={{width:"100%",accentColor:"#FF9F0A"}}/>
              <div style={{fontSize:11,fontWeight:700,color:"#FF9F0A",textAlign:"center"}}>{trailSettings.timeCutDays||14}일</div>
            </div>
            <div>
              <div style={{fontSize:8,color:C.muted,marginBottom:4}}>⏰ 박스권 범위</div>
              <input type="range" min="1" max="8" step="0.5" value={trailSettings.timeCutPct||3} onChange={e=>setTrailSettings(p=>({...p,timeCutPct:+e.target.value}))} style={{width:"100%",accentColor:"#FF9F0A"}}/>
              <div style={{fontSize:11,fontWeight:700,color:"#FF9F0A",textAlign:"center"}}>±{trailSettings.timeCutPct||3}%</div>
            </div>
          </div>

          {/* ★ 불타기 룰 시뮬레이션 (10,000원 기준 예시) */}
          <div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
            <div style={{fontSize:9,fontWeight:700,color:C.purple,marginBottom:4}}>📐 불타기 룰 ({isSpecial?"⭐특별":"기본"} ₩{fmtKRW(activeCapital)})</div>
            <div style={{fontSize:8,color:C.muted,marginBottom:8}}>만원짜리 종목 기준 시뮬레이션</div>
            <div style={{display:"grid",gridTemplateColumns:`repeat(${PYRAMID_RULES.length},1fr)`,gap:4,marginBottom:8}}>
              {PYRAMID_RULES.map((r,i)=>{
                const amt=Math.round(activeCapital*r.pct/100);
                const shares=Math.floor(amt/10000);
                return <div key={i} style={{background:"rgba(191,90,242,.06)",border:`1px solid rgba(191,90,242,.2)`,borderRadius:8,padding:"6px",textAlign:"center"}}>
                  <div style={{fontSize:8,color:C.purple,fontWeight:700}}>{r.label}</div>
                  <div style={{fontSize:14,fontWeight:900,color:C.text}}>{r.pct}%</div>
                  <div style={{fontSize:9,color:C.accent,fontWeight:700}}>₩{fmtKRW(amt)}</div>
                  <div style={{fontSize:7,color:C.muted}}>{shares}주 × ₩10,000</div>
                  <div style={{fontSize:7,color:r.targetPct>0?C.emerald:C.muted}}>{r.targetPct>0?`평단+${r.targetPct}%시`:"진입시"}</div>
                </div>;
              })}
            </div>
            {/* 손절 금액 표시 */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
              <div style={{background:"rgba(255,69,58,.06)",borderRadius:6,padding:"6px",textAlign:"center"}}>
                <div style={{fontSize:7,color:C.red}}>보초 손절 (-{trailSettings.initialStopPct}%)</div>
                <div style={{fontSize:12,fontWeight:900,color:C.red}}>-₩{fmtKRW(Math.round(pyramidAmts[0]*trailSettings.initialStopPct/100))}</div>
                <div style={{fontSize:7,color:C.muted}}>₩{fmtKRW(pyramidAmts[0])}의 {trailSettings.initialStopPct}%</div>
              </div>
              <div style={{background:"rgba(255,214,10,.06)",borderRadius:6,padding:"6px",textAlign:"center"}}>
                <div style={{fontSize:7,color:C.yellow}}>트레일링 전환</div>
                <div style={{fontSize:12,fontWeight:900,color:C.yellow}}>+{trailSettings.switchPct}%</div>
                <div style={{fontSize:7,color:C.muted}}>이후 고점-{trailSettings.trailPct}%</div>
              </div>
              <div style={{background:"rgba(255,159,10,.06)",borderRadius:6,padding:"6px",textAlign:"center"}}>
                <div style={{fontSize:7,color:"#FF9F0A"}}>타임컷</div>
                <div style={{fontSize:12,fontWeight:900,color:"#FF9F0A"}}>{trailSettings.timeCutDays||14}일</div>
                <div style={{fontSize:7,color:C.muted}}>±{trailSettings.timeCutPct||3}% 이내</div>
              </div>
            </div>
          </div>

          <div style={{display:"flex",justifyContent:"flex-end",marginTop:12}}>
            <button onClick={()=>setShowRiskPanel(false)} style={{...css.btn(true),fontSize:10,padding:"6px 16px"}}>닫기</button>
          </div>
        </div>}
        <div style={{position:"relative",marginLeft:"auto"}}>
          <input value={search} onChange={e=>{setSearch(e.target.value);setShowSearch(true);}} onFocus={()=>setShowSearch(true)}
            onKeyDown={e=>{if(e.key==="Enter"&&search.trim()){const q=search.trim(),qUp=q.toUpperCase();const krMatch=KR_NAME_DB[q]||KR_NAME_DB[qUp]||Object.entries(KR_NAME_DB).find(([k])=>k.includes(q))?.[1];const ticker=krMatch||qUp;const found=[...stocks,...Object.entries(SEARCH_DB).map(([t,v])=>({ticker:t,...v}))].find(s=>s.ticker===ticker);if(found)addStock(found);else addStock({ticker,label:q,_custom:true});setShowSearch(false);}}}
            placeholder="🔍 티커 입력 후 엔터" style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 10px",color:C.text,fontSize:10,outline:"none",width:165}}/>
          {(showSearch&&(searchLoading||searchRes.length>0))&&<div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:"#0f172a",border:`1px solid ${C.border}`,borderRadius:7,zIndex:200,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,.8)"}}>
            {searchLoading&&<div style={{padding:"10px 12px",color:C.muted,fontSize:10}}>🔍 검색 중...</div>}
            {!searchLoading&&searchRes.map((r,i)=><div key={i} onClick={()=>addStock(r)} style={{padding:"7px 11px",cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,.05)",display:"flex",justifyContent:"space-between"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(56,189,248,.1)"} onMouseLeave={e=>e.currentTarget.style.background=""}><span style={{color:r._custom?C.accent:C.text,fontWeight:700}}>{r.label} <span style={{color:C.muted,fontSize:8}}>{r._custom?"":r.ticker}</span></span><span style={{color:r._custom?C.accent:C.sub,fontSize:8}}>{r.market||"🔍"}</span></div>)}
          </div>}
        </div>
        {addMsg&&<span style={{color:C.green,fontSize:9}}>{addMsg}</span>}
        <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:`1px solid ${C.border}`}}>
          {TABS.map(([k,l])=><button key={k} onClick={()=>setTab(k)} style={{background:tab===k?"rgba(56,189,248,.18)":"transparent",color:tab===k?C.accent:C.muted,border:"none",padding:"5px 9px",cursor:"pointer",fontSize:9,fontWeight:tab===k?700:400,whiteSpace:"nowrap"}}>{l}</button>)}
        </div>
      </div>

      {/* ── 종목바 ───────────────────────────────── */}
      <div style={{display:"flex",gap:4,padding:"5px 12px",overflowX:"auto",borderBottom:`1px solid ${C.border}`,background:"#0d1526",alignItems:"center",flexShrink:0}}>
        <span style={{color:C.muted,fontSize:9,flexShrink:0}}>{stocks.length}종목</span>
        {stocks.map(stk=>{
          const sg=getStockSig(charts[stk.ticker]?.data);
          const ss=SIG[sg]||SIG.HOLD;
          const cd2=charts[stk.ticker]?.data;
          const isFlip=cd2&&cd2.length>=2&&cd2.at(-1)?.bullCount===3&&cd2.at(-2)?.bullCount<3;
          return<div key={stk.ticker} style={{flexShrink:0,display:"flex"}}>
            <button onClick={()=>{setSel(stk.ticker);setTab("sniper");}} style={{background:sel===stk.ticker?"rgba(56,189,248,.18)":"transparent",border:`1px solid ${sel===stk.ticker?C.accent:C.border}`,borderRadius:"5px 0 0 5px",padding:"3px 6px",cursor:"pointer",display:"flex",flexDirection:"column"}}>
              <div style={{display:"flex",gap:3,alignItems:"center"}}>
                {isFlip&&<span style={{fontSize:7}}>🚀</span>}
                <span style={{color:sel===stk.ticker?C.accent:C.text,fontSize:10,fontWeight:700,maxWidth:52,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fmtName(stk)}</span>
                <span style={{...ss,borderRadius:3,padding:"0 4px",fontWeight:900,fontSize:8,display:"inline-block"}}>{sg[0]}</span>
              </div>
              {stk.changePct!=null&&<span style={{fontSize:8,color:stk.changePct>=0?C.green:C.red}}>{stk.changePct>=0?"+":""}{stk.changePct?.toFixed?.(1)}%</span>}
            </button>
            <button onClick={()=>removeStock(stk.ticker)} style={{background:"rgba(255,69,58,.06)",border:`1px solid ${C.border}`,borderLeft:"none",borderRadius:"0 5px 5px 0",padding:"2px 5px",cursor:"pointer",color:C.muted,fontSize:9}}>✕</button>
          </div>;
        })}
      </div>

      {/* ── ★ v2.2: 알림 배너 ─────────────────────── */}
      {alerts.length>0&&<div style={{background:"#0d1526",borderBottom:`1px solid ${C.border}`,padding:"0 12px",maxHeight:80,overflowY:"auto"}}>
        {alerts.slice(0,3).map(a=>(
          <div key={a.id} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",borderBottom:"1px solid rgba(255,255,255,.03)",animation:"pulse 2s ease-in-out 3"}}>
            <span style={{fontSize:10}}>{a.type==="pyramid"?"🔥":a.type==="target"?"🎯":a.type==="stop"?"🚨":"⏰"}</span>
            <span style={{fontSize:9,color:a.type==="stop"?C.red:a.type==="pyramid"?C.emerald:a.type==="target"?C.accent:"#FF9F0A",flex:1,fontWeight:600}}>{a.msg}</span>
            <span style={{fontSize:7,color:C.muted}}>{a.time}</span>
            <button onClick={()=>setAlerts(p=>p.filter(x=>x.id!==a.id))} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:9,padding:0}}>✕</button>
          </div>
        ))}
        {alerts.length>3&&<div style={{fontSize:8,color:C.muted,textAlign:"center",padding:2,cursor:"pointer"}} onClick={()=>setAlerts([])}>+{alerts.length-3}개 더 · 모두 지우기</div>}
      </div>}

      {/* ── 콘텐츠 ───────────────────────────────── */}
      <div style={{flex:1,overflow:"auto"}} onClick={()=>setShowSearch(false)}>

        {/* ══ TAB 1: 시장레이더 ══ */}
        {tab==="radar"&&<div style={{padding:"12px 14px"}}>
          <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8,borderLeft:`3px solid ${C.accent}`,paddingLeft:8}}>글로벌 지수 현황</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:8}}>
            {[["^GSPC","S&P 500","🇺🇸"],["^IXIC","NASDAQ","🇺🇸"],["^KS11","KOSPI","🇰🇷"]].map(([k,name,flag])=>{
              const d=indicesData[k];const pct=d?.changePct??0;const hasData=d&&d.price>0;
              return<div key={k} onClick={()=>setSelIndex(selIndex===k?null:k)} style={{border:`1px solid ${selIndex===k?C.accent:hasData?(pct>=0?"rgba(34,197,94,.3)":"rgba(255,69,58,.3)"):C.border}`,borderRadius:8,padding:"10px 12px",background:selIndex===k?"rgba(10,132,255,.08)":C.panel2,cursor:"pointer"}}>
                <div style={{fontSize:9,color:C.muted,marginBottom:4}}>{flag} {name} {selIndex===k?"▼":"▶"}</div>
                <div style={{fontSize:22,fontWeight:900,marginBottom:2}}>{hasData?d.price.toLocaleString("ko-KR",{maximumFractionDigits:2}):"—"}</div>
                <div style={{color:pct>=0?C.green:C.red,fontWeight:700,fontSize:13}}>{hasData?`${pct>=0?"+":""}${(pct||0).toFixed(2)}% ${pct>=0?"▲":"▼"}`:"—"}</div>
                {hasData&&<div style={{fontSize:8,color:C.muted,marginTop:3}}>3일 {(d.chg3d||0)>=0?"+":""}{(d.chg3d||0).toFixed(1)}%</div>}
              </div>;
            })}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:8}}>
            {[["^VIX","VIX","⚡",v=>v<20?"안정":v<30?"주의":"위험",v=>v<20?C.emerald:v<30?C.yellow:C.red],
              ["KRW=X","USD/KRW","💱",v=>`${v?.toFixed(0)||"—"}원`,()=>C.text],
              ["^TNX","미국10Y","📈",v=>`${v?.toFixed(2)||"—"}%`,v=>v>4.5?C.red:v>3.5?C.yellow:C.emerald],
              ["GC=F","금","🥇",v=>`$${v?.toLocaleString()||"—"}`,()=>C.text],
            ].map(([k,name,flag,fmt,color])=>{
              const d=indicesData[k];const val=d?.price;const pct=d?.changePct??0;
              return<div key={k} onClick={()=>setSelIndex(selIndex===k?null:k)} style={{border:`1px solid ${selIndex===k?C.accent:C.border}`,borderRadius:8,padding:"7px 10px",background:selIndex===k?"rgba(10,132,255,.08)":C.panel2,cursor:"pointer"}}>
                <div style={{fontSize:8,color:C.muted,marginBottom:2}}>{flag} {name} {selIndex===k?"▼":""}</div>
                <div style={{fontSize:13,fontWeight:900,margin:"2px 0",color:color(val)}}>{val?fmt(val):"—"}</div>
                <div style={{fontSize:9,color:pct>=0?C.green:C.red,fontWeight:700}}>{pct>=0?"+":""}{(pct||0).toFixed(2)}%</div>
              </div>;
            })}
          </div>
          {/* ★ v2.2: 지수 미니차트 */}
          {selIndex&&(()=>{
            const d=indicesData[selIndex];if(!d||!d.price)return null;
            const idxNames={"^GSPC":"S&P 500","^IXIC":"NASDAQ","^KS11":"KOSPI","^VIX":"VIX","KRW=X":"USD/KRW","^TNX":"미국 10Y 금리","GC=F":"금"};
            const chartD=genIndexChart(d.price, d.chg3d||0, d.chg5d||0, selIndex==="^VIX"?0.025:0.008);
            if(!chartD.length)return null;
            const minP=Math.min(...chartD.map(c=>c.close)),maxP=Math.max(...chartD.map(c=>c.close));
            const pct=d.changePct||0;
            return<div style={{...css.card,marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:11,fontWeight:700,color:C.accent}}>{idxNames[selIndex]||selIndex} 30일 추이</div>
                <div style={{display:"flex",gap:8,fontSize:9}}>
                  <span style={{color:C.muted}}>3일 <span style={{color:(d.chg3d||0)>=0?C.green:C.red,fontWeight:700}}>{(d.chg3d||0)>=0?"+":""}{(d.chg3d||0).toFixed(1)}%</span></span>
                  <span style={{color:C.muted}}>5일 <span style={{color:(d.chg5d||0)>=0?C.green:C.red,fontWeight:700}}>{(d.chg5d||0)>=0?"+":""}{(d.chg5d||0).toFixed(1)}%</span></span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={130}>
                <ComposedChart data={chartD} margin={{left:0,right:6}}>
                  <CartesianGrid stroke="rgba(255,255,255,.05)"/>
                  <XAxis dataKey="date" tick={{fill:C.muted,fontSize:7}} tickLine={false} interval={Math.floor(chartD.length/5)||1}/>
                  <YAxis domain={[minP*0.998,maxP*1.002]} tick={{fill:C.muted,fontSize:7}} tickLine={false} width={50} tickFormatter={v=>v>=10000?`${(v/1000).toFixed(0)}k`:v.toFixed(1)}/>
                  <Tooltip content={<Tip/>}/>
                  <Area type="monotone" dataKey="close" stroke={pct>=0?C.emerald:C.red} fill={pct>=0?"rgba(48,209,88,.1)":"rgba(255,69,58,.1)"} strokeWidth={2} dot={false}/>
                </ComposedChart>
              </ResponsiveContainer>
            </div>;
          })()}
          <div style={{display:"grid",gridTemplateColumns:"3fr 2fr",gap:12,marginBottom:12}}>
            <div style={css.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:11,fontWeight:700,color:C.accent}}>📊 섹터 RS 히트맵</div>
                <select value={rsKey} onChange={e=>setRsKey(e.target.value)} style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:5,padding:"2px 6px",color:C.text,fontSize:9}}>
                  <option value="chg1W">1주</option><option value="chg1M">1개월</option>
                </select>
              </div>
              {[["🇺🇸 미국 vs S&P500","us","spy"],["🇰🇷 한국 vs KOSPI","kr","kospi"]].map(([label,mkt,ref])=>{
                const filtered=[...SECTOR_RS].filter(s=>s.market===mkt).sort((a,b)=>b[rsKey]-a[rsKey]);
                if(!filtered.length)return null;
                const refVal=rsKey==="chg1W"?(idxRS[ref]?.chg3d||0):(idxRS[ref]?.chg5d||0);
                return<div key={mkt} style={{marginBottom:10}}>
                  <div style={{fontSize:8,fontWeight:700,color:C.muted,marginBottom:4}}>{label}</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:3}}>
                    {filtered.map((sec,i)=>{
                      const v=sec[rsKey]||0,excess=+(v-refVal).toFixed(1),isTop=i<2;
                      const bg=excess>=3?"rgba(48,209,88,.45)":excess>=0?"rgba(48,209,88,.2)":excess>-3?"rgba(250,204,21,.2)":"rgba(255,69,58,.3)";
                      return<div key={sec.etf} onClick={()=>setSelectedSector(selectedSector===sec.etf?null:sec.etf)} style={{background:bg,borderRadius:5,padding:"5px 4px",border:selectedSector===sec.etf?`2px solid ${C.accent}`:isTop?`1px solid ${C.emerald}`:"1px solid rgba(255,255,255,.05)",cursor:"pointer",textAlign:"center"}}>
                        <div style={{fontSize:7,fontWeight:700,color:isTop?C.emerald:C.sub}}>{sec.name}</div>
                        <div style={{fontSize:11,fontWeight:700,color:v>=0?C.green:C.red}}>{v>=0?"+":""}{v.toFixed(1)}%</div>
                        <div style={{fontSize:7,color:excess>=0?C.emerald:C.red}}>vs {mkt==="us"?"SP":"KS"} {excess>=0?"+":""}{excess.toFixed(1)}</div>
                      </div>;
                    })}
                  </div>
                </div>;
              })}
              {selectedSector&&(()=>{
                const sec=SECTOR_RS.find(s=>s.etf===selectedSector);
                if(!sec)return null;
                // ★ v2.2: 섹터 미니차트
                const secChartD=genIndexChart(100*(1+sec.chg1M/100), sec.chg1W||0, sec.chg1M||0, 0.012);
                return<div style={{marginTop:8,background:"rgba(10,132,255,.06)",border:`1px solid rgba(10,132,255,.15)`,borderRadius:7,padding:"8px 10px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <div style={{fontSize:9,fontWeight:700,color:C.accent}}>{sec.name} ({sec.etf})</div>
                    <div style={{display:"flex",gap:6,fontSize:8}}>
                      <span style={{color:(sec.chg1W||0)>=0?C.green:C.red}}>1W {(sec.chg1W||0)>=0?"+":""}{(sec.chg1W||0).toFixed(1)}%</span>
                      <span style={{color:(sec.chg1M||0)>=0?C.green:C.red}}>1M {(sec.chg1M||0)>=0?"+":""}{(sec.chg1M||0).toFixed(1)}%</span>
                    </div>
                  </div>
                  {secChartD.length>3&&<ResponsiveContainer width="100%" height={80}>
                    <ComposedChart data={secChartD} margin={{left:0,right:6}}>
                      <XAxis dataKey="date" tick={{fill:C.muted,fontSize:6}} tickLine={false} interval={Math.floor(secChartD.length/4)||1}/>
                      <YAxis tick={{fill:C.muted,fontSize:6}} tickLine={false} width={35} domain={["auto","auto"]}/>
                      <Tooltip content={<Tip/>}/>
                      <Area type="monotone" dataKey="close" stroke={(sec.chg1M||0)>=0?C.emerald:C.red} fill={(sec.chg1M||0)>=0?"rgba(48,209,88,.1)":"rgba(255,69,58,.1)"} strokeWidth={2} dot={false}/>
                    </ComposedChart>
                  </ResponsiveContainer>}
                  {sec.members?.length>0&&<>
                  <div style={{fontSize:8,fontWeight:700,color:C.muted,marginTop:4,marginBottom:4}}>구성종목</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                    {(sec.members||[]).map(ticker=>{
                      const s=stocks.find(x=>x.ticker===ticker);
                      const pInfo=pool[ticker]||{};
                      const merged=s||pInfo;
                      const label=s?.label||pInfo.label||Object.entries(KR_NAME_DB).find(([k,v])=>v===ticker)?.[0]||ticker;
                      const inWatch=watchlist.find(w=>w.ticker===ticker);
                      return<div key={ticker} style={{background:"rgba(255,255,255,.05)",borderRadius:5,padding:"4px 8px",display:"flex",gap:6,alignItems:"center",cursor:"pointer"}} onClick={()=>navigateToStock(ticker,{...pInfo,...s,label})}>
                        <span style={{fontSize:10,fontWeight:700}}>{label}</span>
                        {merged?.changePct!=null&&<span style={{fontSize:9,color:(merged.changePct||0)>=0?C.green:C.red}}>{(merged.changePct||0)>=0?"+":""}{(merged.changePct||0).toFixed(1)}%</span>}
                        <button onClick={e=>{e.stopPropagation();if(inWatch){setWatchlist(w=>w.filter(x=>x.ticker!==ticker));setAddMsg(`☆ ${label} 제거`);}else{setWatchlist(w=>[...w,s||{ticker,label,...pInfo}]);setAddMsg(`★ ${label} 관심 추가`);}setTimeout(()=>setAddMsg(""),2000);}} style={{background:"none",border:"none",color:inWatch?C.accent:C.muted,cursor:"pointer",fontSize:11,padding:0}}>{inWatch?"★":"☆"}</button>
                      </div>;
                    })}
                  </div>
                  </>}
                </div>;
              })()}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <div style={{...css.card,flex:0}}>
                <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8}}>📊 상승/하락 비율</div>
                {[["🇰🇷 한국","kr"],["🇺🇸 미국","us"]].map(([label,mkt])=>{
                  const d=breadthData[mkt]||{upPct:0,up:0,down:0};
                  return<div key={mkt} style={{marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                      <span style={{fontSize:9,color:C.muted}}>{label}</span>
                      <span style={{fontSize:9,fontWeight:700,color:d.upPct>=50?C.green:C.red}}>{d.upPct}% 상승</span>
                    </div>
                    <div style={{height:6,background:"rgba(255,255,255,.08)",borderRadius:3,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${d.upPct}%`,background:d.upPct>=50?C.emerald:C.red,borderRadius:3,transition:"width .5s"}}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}>
                      <span style={{fontSize:7,color:C.green}}>▲{d.up}</span>
                      <span style={{fontSize:7,color:C.red}}>▼{d.down}</span>
                    </div>
                  </div>;
                })}
              </div>
              <div style={{background:C.panel2,border:`2px solid ${oppColor}`,borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                <div style={{fontSize:8,color:C.muted,marginBottom:6}}>📊 시장 기회 점수</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div style={{background:"rgba(0,0,0,.5)",borderRadius:8,padding:"8px 6px",border:`1px solid ${oppColorUS}`}}>
                    <div style={{fontSize:7,color:C.muted}}>🇺🇸 미국</div>
                    <div style={{fontSize:28,fontWeight:900,color:oppColorUS,lineHeight:1.1}}>{oppScoreUS}<span style={{fontSize:9,color:C.muted}}>/100</span></div>
                    <div style={{fontSize:8,color:oppColorUS,fontWeight:700}}>{oppScoreUS>=70?"HIGH":oppScoreUS>=45?"MID":"LOW"}</div>
                    <div style={{fontSize:7,color:C.muted,marginTop:2}}>S&P {spChg3d>=0?"+":""}{spChg3d.toFixed(1)}% · VIX {vixVal.toFixed(0)}</div>
                  </div>
                  <div style={{background:"rgba(0,0,0,.5)",borderRadius:8,padding:"8px 6px",border:`1px solid ${oppColorKR}`}}>
                    <div style={{fontSize:7,color:C.muted}}>🇰🇷 한국</div>
                    <div style={{fontSize:28,fontWeight:900,color:oppColorKR,lineHeight:1.1}}>{oppScoreKR}<span style={{fontSize:9,color:C.muted}}>/100</span></div>
                    <div style={{fontSize:8,color:oppColorKR,fontWeight:700}}>{oppScoreKR>=70?"HIGH":oppScoreKR>=45?"MID":"LOW"}</div>
                    <div style={{fontSize:7,color:C.muted,marginTop:2}}>KOSPI {kospiChg3d>=0?"+":""}{kospiChg3d.toFixed(1)}%</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>}

        {/* ══ TAB: 집중 — 오늘 볼 종목 ══ */}
        {tab==="focus"&&<div style={{padding:"12px 14px"}}>
          <div style={{fontSize:13,fontWeight:900,color:C.accent,marginBottom:4,borderLeft:`3px solid ${C.accent}`,paddingLeft:8}}>🎯 오늘의 집중 종목</div>
          <div style={{fontSize:9,color:C.sub,marginBottom:12}}>추천 · 돌파 · 진입평점 — 지금 주목할 종목</div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:14}}>
            <div style={{background:"rgba(191,90,242,.06)",border:`1px solid rgba(191,90,242,.2)`,borderRadius:8,padding:"8px",textAlign:"center"}}>
              <div style={{fontSize:8,color:C.purple}}>종합추천</div>
              <div style={{fontSize:22,fontWeight:900,color:C.purple}}>{allStocksForScan.filter(s=>{const r=alphaScore(s,charts[s.ticker]?.data,idxRS);return r.score>50;}).length}</div>
              <div style={{fontSize:7,color:C.muted}}>50pt 이상</div>
            </div>
            <div style={{background:"rgba(48,209,88,.06)",border:`1px solid rgba(48,209,88,.2)`,borderRadius:8,padding:"8px",textAlign:"center"}}>
              <div style={{fontSize:8,color:C.emerald}}>돌파감지</div>
              <div style={{fontSize:22,fontWeight:900,color:C.emerald}}>{(()=>{let c=0;allStocksForScan.forEach(s=>{const d=charts[s.ticker]?.data;if(!d||d.length<2)return;const t=d.at(-1),y=d.at(-2);const stT=[t.st1Bull,t.st2Bull,t.st3Bull].filter(v=>v!=null).length;const stY=[y.st1Bull,y.st2Bull,y.st3Bull].filter(v=>v!=null).length;if(stT>stY||(t.macd>t.signal&&y.macd<=y.signal)||(t.aboveCloud&&!y.aboveCloud))c++;});return c;})()}</div>
              <div style={{fontSize:7,color:C.muted}}>신호 변화</div>
            </div>
            <div style={{background:"rgba(10,132,255,.06)",border:`1px solid rgba(10,132,255,.2)`,borderRadius:8,padding:"8px",textAlign:"center"}}>
              <div style={{fontSize:8,color:C.accent}}>A등급+</div>
              <div style={{fontSize:22,fontWeight:900,color:C.accent}}>{allStocksForScan.filter(s=>{const d=charts[s.ticker]?.data;if(!d||d.length<10)return false;return calcEntryScore(d,vixVal,oppScore,pool[s.ticker]||s).score>=70;}).length}</div>
              <div style={{fontSize:7,color:C.muted}}>진입평점 70+</div>
            </div>
          </div>

          {/* ★ v2.2: AI 상승 추천 종목 TOP5 */}
          <div style={css.card}>
            <div style={{fontSize:11,fontWeight:700,color:C.purple,marginBottom:8}}>🏆 AI 추천 — 상승 유력 TOP5</div>
            <div style={{fontSize:8,color:C.muted,marginBottom:10}}>RS강도 + ST신호 + 구름 + 거래량 + 모멘텀 기반 종합 점수</div>
            {(()=>{
              const ranked = allStocksForScan.map(s => {
                const cData = charts[s.ticker]?.data;
                const {score, signals, rs} = alphaScore(s, cData, idxRS);
                const lastPt = cData?.at(-1);
                const stCount = [lastPt?.st1Bull,lastPt?.st2Bull,lastPt?.st3Bull].filter(v=>v!=null).length;
                const cloudSt = lastPt?.aboveCloud?"구름위":lastPt?.nearCloud?"접근":"아래";
                const es = calcEntryScore(cData, vixVal, oppScore, pool[s.ticker]||s);
                return {...s, score, signals, rs, stCount, cloudSt, entryGrade:es.grade, entryScore:es.score};
              }).filter(s => s.score > 20).sort((a,b) => b.score - a.score).slice(0,5);

              if (!ranked.length) return <div style={{textAlign:"center",padding:"20px",color:C.muted}}>종목을 추가하면 추천이 표시됩니다</div>;
              return ranked.map((s,i) => {
                const medal = i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}`;
                return <div key={s.ticker} onClick={()=>navigateToStock(s.ticker,s)} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderBottom:`1px solid rgba(255,255,255,.05)`,cursor:"pointer",background:i===0?"rgba(191,90,242,.06)":"transparent",borderRadius:i===0?8:0}}>
                  <span style={{fontSize:16,minWidth:24}}>{medal}</span>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontWeight:900,fontSize:12,maxWidth:60,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fmtName(s)}</span>
                      <span style={{fontSize:11,fontWeight:900,padding:"1px 5px",borderRadius:4,background:s.entryGrade==="S"?"rgba(48,209,88,.2)":s.entryGrade==="A"?"rgba(10,132,255,.15)":"rgba(255,255,255,.06)",color:s.entryGrade==="S"?C.emerald:s.entryGrade==="A"?C.accent:C.muted}}>{s.entryGrade}{s.entryScore}</span>
                      <span style={{fontSize:8,color:C.muted}}>ST{s.stCount}/3 · {s.cloudSt}</span>
                    </div>
                    <div style={{display:"flex",gap:3,marginTop:3}}>
                      {(s.signals||[]).slice(0,4).map(sig=><span key={sig} style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(191,90,242,.1)",color:C.purple}}>{sig}</span>)}
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:16,fontWeight:900,color:C.accent}}>{s.score}<span style={{fontSize:9,color:C.muted}}>pt</span></div>
                    <div style={{fontSize:9,color:(s.rs||0)>=0?C.emerald:C.red}}>RS {(s.rs||0)>=0?"+":""}{(s.rs||0).toFixed(1)}</div>
                  </div>
                </div>;
              });
            })()}
          </div>

          {/* ★ v2.2: 🚀 오늘의 돌파 감지 */}
          <div style={css.card}>
            <div style={{fontSize:11,fontWeight:700,color:C.emerald,marginBottom:8}}>🚀 오늘의 돌파 감지</div>
            <div style={{fontSize:8,color:C.muted,marginBottom:10}}>어제 대비 신호가 바뀐 종목 — 상승 시작 포착</div>
            {(()=>{
              const breakouts = allStocksForScan.map(s => {
                const cData = charts[s.ticker]?.data;
                if(!cData||cData.length<3) return null;
                const today = cData.at(-1), yesterday = cData.at(-2), d3 = cData.at(-3);
                const signals = [];
                // ST 플립 (매도→매수)
                const stToday = [today.st1Bull,today.st2Bull,today.st3Bull].filter(v=>v!=null).length;
                const stYest = [yesterday.st1Bull,yesterday.st2Bull,yesterday.st3Bull].filter(v=>v!=null).length;
                if(stToday===3 && stYest<3) signals.push({type:"🔥 ST돌파",desc:`ST ${stYest}→3/3`,color:C.emerald});
                else if(stToday>stYest) signals.push({type:"📈 ST개선",desc:`ST ${stYest}→${stToday}/3`,color:C.green});
                // MACD 골든크로스
                if(today.macd>today.signal && yesterday.macd<=yesterday.signal) signals.push({type:"⚡ MACD↑",desc:"골든크로스 발생",color:C.accent});
                // 구름 돌파
                if(today.aboveCloud && !yesterday.aboveCloud) signals.push({type:"☁️ 구름돌파",desc:"일목구름 상향 돌파",color:C.emerald});
                // 거래량 폭발
                const vols = cData.slice(-21,-1).map(d=>d.volume||0).filter(v=>v>0);
                const avgVol = vols.length?vols.reduce((a,b)=>a+b,0)/vols.length:0;
                if(avgVol>0 && today.volume > avgVol*2) signals.push({type:"💥 거래량",desc:`${Math.round(today.volume/avgVol*100)}% 폭증`,color:C.yellow});
                // 스퀴즈 해제
                if(today.sqzOff) signals.push({type:"💎 스퀴즈",desc:"압축 해제! 방향 주목",color:C.purple});
                if(!signals.length) return null;
                const {score} = alphaScore(s, cData, idxRS);
                return {...s, signals, score, stCount:stToday};
              }).filter(Boolean).sort((a,b)=>b.signals.length-a.signals.length||b.score-a.score);

              if(!breakouts.length) return <div style={{textAlign:"center",padding:"15px",color:C.muted,fontSize:9}}>오늘 신규 돌파 종목이 없습니다</div>;
              return breakouts.slice(0,8).map(s=>(
                <div key={s.ticker} onClick={()=>navigateToStock(s.ticker,s)} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",borderBottom:`1px solid rgba(255,255,255,.05)`,cursor:"pointer"}}>
                  <span style={{fontWeight:900,fontSize:11,minWidth:55,maxWidth:55,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fmtName(s)}</span>
                  <div style={{flex:1,display:"flex",gap:3,flexWrap:"wrap"}}>
                    {s.signals.map((sig,i)=><span key={i} style={{fontSize:8,padding:"2px 6px",borderRadius:4,background:`${sig.color}15`,border:`1px solid ${sig.color}40`,color:sig.color,fontWeight:700}}>{sig.type}</span>)}
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:14,fontWeight:900,color:C.accent}}>{s.score}<span style={{fontSize:8,color:C.muted}}>pt</span></div>
                    <div style={{fontSize:8,color:(s.changePct||0)>=0?C.green:C.red}}><span style={{color:C.muted}}>1D</span> {(s.changePct||0)>=0?"+":""}{(s.changePct||0).toFixed(1)}%</div>
                  </div>
                </div>
              ));
            })()}
          </div>

          {/* ★ v2.2: 진입평점 순위 — 캔들 보유 종목 전체 */}
          <div style={css.card}>
            <div style={{fontSize:11,fontWeight:700,color:C.accent,marginBottom:8}}>🎯 진입평점 순위</div>
            <div style={{fontSize:8,color:C.muted,marginBottom:10}}>캔들 데이터 보유 종목 중 진입 조건이 좋은 순서</div>
            {(()=>{
              const graded = allStocksForScan.map(s=>{
                const cData = charts[s.ticker]?.data;
                if(!cData||cData.length<10) return null;
                const es = calcEntryScore(cData, vixVal, oppScore, pool[s.ticker]||s);
                const lastPt = cData.at(-1);
                const stCount = [lastPt?.st1Bull,lastPt?.st2Bull,lastPt?.st3Bull].filter(v=>v!=null).length;
                const cloudSt = lastPt?.aboveCloud?"구름위":lastPt?.nearCloud?"접근":"아래";
                return {...s, entryGrade:es.grade, entryScore:es.score, breakdown:es.breakdown, stCount, cloudSt};
              }).filter(Boolean).filter(s=>s.entryScore>30).sort((a,b)=>b.entryScore-a.entryScore);

              if(!graded.length) return <div style={{textAlign:"center",padding:"15px",color:C.muted,fontSize:9}}>캔들 데이터가 있는 종목이 없습니다 — Daily 실행 후 확인</div>;
              return graded.slice(0,15).map((s,i)=>{
                const gc = {S:C.emerald,A:C.green,B:C.yellow,C:"#FF9F0A",D:C.red}[s.entryGrade]||C.muted;
                return <div key={s.ticker} onClick={()=>navigateToStock(s.ticker,s)} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",borderBottom:`1px solid rgba(255,255,255,.05)`,cursor:"pointer",background:i<3?`${gc}08`:"transparent"}}>
                  <span style={{fontSize:22,fontWeight:900,color:gc,minWidth:28}}>{s.entryGrade}</span>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:11,maxWidth:70,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fmtName(s,8)}</div>
                    <div style={{display:"flex",gap:4,marginTop:2}}>
                      <span style={{fontSize:7,color:C.muted}}>ST{s.stCount}/3</span>
                      <span style={{fontSize:7,color:C.muted}}>{s.cloudSt}</span>
                      {s.breakdown?.filter(b=>b.ok).slice(0,3).map(b=><span key={b.label} style={{fontSize:7,padding:"0px 4px",borderRadius:3,background:`${gc}12`,color:gc}}>{b.label}</span>)}
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:16,fontWeight:900,color:gc}}>{s.entryScore}<span style={{fontSize:9,color:C.muted}}>/100</span></div>
                    <div style={{fontSize:8,color:(s.changePct||0)>=0?C.green:C.red}}><span style={{color:C.muted}}>1D</span> {(s.changePct||0)>=0?"+":""}{(s.changePct||0).toFixed(1)}%</div>
                  </div>
                </div>;
              });
            })()}
          </div>
        </div>}
        {/* ══ TAB 2: 발굴탭 ══ */}
        {tab==="alpha"&&<div style={{padding:"12px 14px"}}>
          <RSBar/>
          <div style={{display:"flex",gap:4,marginBottom:12}}>
            {[["filter","🔍 수급필터"],["backtest","🔬 백테스트"],["compare","⚖️ 비교뷰"]].map(([k,l])=>(
              <button key={k} onClick={()=>setAlphaTab(k)} style={{flex:1,padding:"7px 0",borderRadius:7,border:`1px solid ${alphaTab===k?C.accent:C.border}`,background:alphaTab===k?"rgba(10,132,255,.12)":"rgba(255,255,255,.03)",color:alphaTab===k?C.accent:C.muted,fontWeight:alphaTab===k?700:400,fontSize:10,cursor:"pointer"}}>{l}</button>
            ))}
          </div>

          {alphaTab==="filter"&&<div>
            <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:10,padding:14,marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:700,color:C.accent,marginBottom:12}}>🎯 종목 필터 조건</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:C.sub,marginBottom:5}}>🌏 시장</div>
                  <div style={{display:"flex",gap:3}}>
                    {[["all","전체"],["kr","🇰🇷 한국"],["us","🇺🇸 미국"]].map(([v,l])=>(
                      <button key={v} onClick={()=>setFMarket(v)} style={{flex:1,padding:"5px 0",borderRadius:5,border:`1px solid ${fMarket===v?C.accent:C.border}`,background:fMarket===v?"rgba(56,189,248,.18)":"rgba(255,255,255,.04)",color:fMarket===v?C.accent:C.muted,fontSize:8,fontWeight:fMarket===v?700:400,cursor:"pointer"}}>{l}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:C.sub,marginBottom:5}}>📈 슈퍼트랜드 <span style={{color:C.accent}}>{fST===0?"전체":`${fST}개+`}</span></div>
                  <div style={{display:"flex",gap:3}}>
                    {[[0,"전체"],[1,"1개+"],[2,"2개+"],[3,"풀"]].map(([v,l])=>(
                      <button key={v} onClick={()=>setFST(v)} style={{flex:1,padding:"5px 0",borderRadius:5,border:`1px solid ${fST===v?C.accent:C.border}`,background:fST===v?"rgba(56,189,248,.18)":"rgba(255,255,255,.04)",color:fST===v?C.accent:C.muted,fontSize:8,fontWeight:fST===v?700:400,cursor:"pointer"}}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:C.sub,marginBottom:5}}>☁️ 일목구름</div>
                  <div style={{display:"flex",gap:3}}>
                    {[["all","전체"],["near","접근+"],["above","구름위"]].map(([v,l])=>(
                      <button key={v} onClick={()=>setFCloud(v)} style={{flex:1,padding:"5px 0",borderRadius:5,border:`1px solid ${fCloud===v?C.accent:C.border}`,background:fCloud===v?"rgba(56,189,248,.18)":"rgba(255,255,255,.04)",color:fCloud===v?C.accent:C.muted,fontSize:8,fontWeight:fCloud===v?700:400,cursor:"pointer"}}>{l}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:9,fontWeight:600,color:C.sub,marginBottom:5}}>💪 RS강도 <span style={{color:C.accent}}>{fRS>0?`+${fRS}%p이상`:"전체"}</span></div>
                  <input type="range" min="0" max="10" step="0.5" value={fRS} onChange={e=>setFRS(+e.target.value)} style={{width:"100%",accentColor:C.accent,marginTop:4}}/>
                </div>
              </div>
              <div>
                <div style={{fontSize:9,fontWeight:600,color:C.sub,marginBottom:5}}>💰 거래대금 <span style={{color:C.accent}}>{fVolRatio>0?`${fVolRatio}% 이상`:"전체"}</span></div>
                <input type="range" min="0" max="300" step="10" value={fVolRatio} onChange={e=>setFVolRatio(+e.target.value)} style={{width:"100%",accentColor:C.accent}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
                <div style={{fontSize:12,fontWeight:700,color:C.accent}}>✅ {alphaHits.length}개 통과</div>
                <button onClick={()=>{setFMarket("all");setFST(0);setFCloud("all");setFRS(0);setFVolRatio(0);}} style={{fontSize:8,padding:"3px 10px",borderRadius:5,border:`1px solid ${C.border}`,background:"rgba(255,255,255,.04)",color:C.muted,cursor:"pointer"}}>초기화</button>
              </div>
            </div>
            {alphaHits.length===0
              ?<div style={{textAlign:"center",padding:"30px 0",color:C.muted}}>조건을 완화하거나 종목을 추가해보세요</div>
              :<div>
                {/* ★ v2.3: 정렬 버튼 — 진입평점 추가 */}
                <div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap"}}>
                  {[["score","📊 종합점수"],["entry","🎯 진입평점"],["accel","🔥 가속신호"],["rs","💪 RS강도"],["chg3d","📈 3일수익"],["vol","💥 거래량"]].map(([k,l])=>(
                    <button key={k} onClick={()=>setAlphaSort(k)} style={{padding:"3px 8px",borderRadius:4,fontSize:8,fontWeight:alphaSort===k?700:400,border:`1px solid ${alphaSort===k?C.accent:C.border}`,background:alphaSort===k?"rgba(10,132,255,.12)":"transparent",color:alphaSort===k?C.accent:C.muted,cursor:"pointer"}}>{l}</button>
                  ))}
                  <span style={{fontSize:8,color:C.muted,marginLeft:"auto"}}>{alphaHits.filter(s=>s.accelScore>0).length}개 가속중 🔥</span>
                </div>
                {[["🇰🇷 한국",true,"^KS11","KOSPI"],["🇺🇸 미국",false,"^GSPC","S&P 500"]].map(([label,isKR,idxKey,idxName])=>{
                  const hits=alphaHits.filter(s=>{const k=(s.market||"").includes("kr")||(s.ticker||"").length>5;return isKR?k:!k;});
                  if(!hits.length)return null;
                  const idxD=indicesData[idxKey];const idxPct=idxD?.changePct??0;
                  return<div key={label} style={{marginBottom:16}}>
                    <div style={{fontSize:10,fontWeight:700,color:C.text,marginBottom:6,display:"flex",alignItems:"center",gap:6}}>
                      {label}
                      <span style={{fontSize:8,color:C.muted,background:C.panel2,borderRadius:4,padding:"1px 6px",border:`1px solid ${C.border}`}}>{hits.length}개</span>
                      <span style={{fontSize:8,marginLeft:"auto",color:idxPct>=0?C.green:C.red,fontWeight:700}}>{idxName} {idxPct>=0?"+":""}{idxPct.toFixed(2)}%</span>
                      <span style={{fontSize:8,color:C.muted}}>3D {(idxD?.chg3d||0)>=0?"+":""}{(idxD?.chg3d||0).toFixed(1)}%</span>
                    </div>
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,minWidth:720,tableLayout:"fixed"}}>
                        <thead>
                          <tr style={{background:"rgba(255,255,255,.04)",borderBottom:`2px solid ${C.border}`}}>
                            {["종목","점수","가속","RS%","거래량%","3D","5D","일목","ST","진입평점",""].map(h=>(
                              <th key={h} style={{padding:"6px 8px",textAlign:"left",color:C.purple,fontSize:8,fontWeight:700,whiteSpace:"nowrap"}}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {hits.map((stock,i)=>{
                            const cdc=charts[stock.ticker]?.data;
                            const lD=cdc?.at(-1);const prevD=cdc?.at(-2);
                            const iSt=lD?.aboveCloud?"above":lD?.nearCloud?"near":"below";
                            const stC=[lD?.st1Bull,lD?.st2Bull,lD?.st3Bull].filter(v=>v!=null).length;
                            const es=calcEntryScore(cdc,vixVal,oppScore,pool[stock.ticker]||stock);
                            const isGold=(stock.score||0)>=85;
                            const inW=watchlist.find(w=>w.ticker===stock.ticker);
                            const pInfo=pool[stock.ticker]||{};
                            const rsPct=pInfo.rsPctRank||0;
                            const isBreakout=pInfo.w52Breakout;
                            const isFlip=lD?.bullCount===3&&prevD?.bullCount<3;
                            return(
                              <tr key={stock.ticker} style={{background:stock.accelScore>=5?"rgba(255,159,10,.12)":isFlip?"rgba(48,209,88,.1)":isBreakout?"rgba(255,214,10,.1)":isGold?"rgba(255,214,10,.06)":i%2===0?C.panel:C.panel2,borderBottom:`1px solid ${C.border}`,cursor:"pointer"}}
                                onClick={()=>navigateToStock(stock.ticker,stock)}>
                                <td style={{padding:"7px 8px"}}>
                                  <div style={{fontWeight:700,fontSize:11,maxWidth:65,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{isFlip?"🚀":isBreakout?"🔥":isGold?"✨":""}{fmtName(stock,7)}</div>
                                  <div style={{fontSize:7,color:C.muted}}>{/^\d{6}$/.test(stock.ticker)?stock.ticker:stock.label?.slice(0,10)}{isFlip?" ST돌파":isBreakout?" 신고가":""}</div>
                                </td>
                                <td style={{padding:"7px 8px"}}><span style={{fontWeight:800,fontSize:11,color:isGold?"#FF9F0A":C.accent}}>{stock.score}pt</span></td>
                                <td style={{padding:"4px 6px"}}>{stock.accelTags?.length>0?<div style={{display:"flex",flexWrap:"wrap",gap:2}}>{stock.accelTags.slice(0,2).map((t,j)=><span key={j} style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(255,159,10,.12)",border:"1px solid rgba(255,159,10,.3)",color:"#FF9F0A",fontWeight:700,whiteSpace:"nowrap"}}>{t}</span>)}</div>:<span style={{fontSize:8,color:C.muted}}>—</span>}</td>
                                <td style={{padding:"7px 8px"}}><span style={{fontWeight:700,fontSize:10,color:rsPct>=80?C.emerald:rsPct>=60?C.accent:C.muted}}>{rsPct>=80?"상위"+Math.round(100-rsPct)+"%":rsPct>=60?"중상":rsPct>0?"중하":"—"}</span></td>
                                <td style={{padding:"7px 8px",color:(stock.volRatio||100)>=150?C.emerald:(stock.volRatio||100)>=80?C.muted:C.red,fontWeight:600}}>{stock.volRatio||"-"}%</td>
                                <td style={{padding:"7px 8px",fontWeight:700,color:(stock.chg3d||0)>=0?C.green:C.red}}>{(stock.chg3d||0)>=0?"+":""}{(stock.chg3d||0).toFixed(1)}%</td>
                                <td style={{padding:"7px 8px",fontWeight:700,color:(stock.chg5d||0)>=0?C.green:C.red}}>{(stock.chg5d||0)>=0?"+":""}{(stock.chg5d||0).toFixed(1)}%</td>
                                <td style={{padding:"7px 8px"}}>
                                  <span style={{fontSize:8,fontWeight:700,padding:"2px 5px",borderRadius:4,background:iSt==="above"?"rgba(48,209,88,.2)":iSt==="near"?"rgba(250,204,21,.2)":"rgba(255,69,58,.2)",color:iSt==="above"?C.emerald:iSt==="near"?C.yellow:C.red}}>{iSt==="above"?"구름위":iSt==="near"?"접근":"아래"}</span>
                                </td>
                                <td style={{padding:"7px 8px"}}><span style={{fontWeight:700,color:stC===3?C.emerald:stC>=2?C.yellow:C.muted}}>{stC}/3</span></td>
                                <td style={{padding:"7px 8px"}}>
                                  <div style={{display:"flex",alignItems:"center",gap:3}}>
                                    <span style={{fontSize:12,fontWeight:900,color:es.grade==="S"?C.emerald:es.grade==="A"?C.green:es.grade==="B"?C.yellow:es.grade==="C"?"#FF9F0A":C.red}}>{es.grade}</span>
                                    <span style={{fontSize:8,color:C.muted}}>{es.score}</span>
                                  </div>
                                </td>
                                <td style={{padding:"7px 6px"}} onClick={e=>e.stopPropagation()}>
                                  <div style={{display:"flex",gap:3}}>
                                    <button onClick={()=>{setTracking(p=>[...p,{id:Date.now(),ticker:stock.ticker,label:stock.label,market:stock.market,basePrice:stock.price||0,addedDate:new Date().toLocaleDateString("ko-KR"),foundScore:stock.score,foundSignals:stock.signals,foundRS:stock.rs,oppScoreAt:oppScore}]);setTab("track");setTrackTab("watch");}} style={{background:"rgba(48,209,88,.08)",border:`1px solid ${C.emerald}`,color:C.emerald,borderRadius:5,padding:"3px 7px",cursor:"pointer",fontSize:8,fontWeight:700}}>추적</button>
                                    <button onClick={()=>{inW?setWatchlist(w=>w.filter(x=>x.ticker!==stock.ticker)):setWatchlist(w=>[...w,{...stock}]);}} style={{background:inW?"rgba(10,132,255,.12)":"rgba(255,255,255,.04)",border:`1px solid ${inW?C.accent:C.border}`,color:inW?C.accent:C.muted,borderRadius:5,padding:"3px 7px",cursor:"pointer",fontSize:10}}>{inW?"★":"☆"}</button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>;
                })}
              </div>
            }          </div>}

          {alphaTab==="backtest"&&<div>
            <div style={{...css.card,border:`1px solid ${C.purple}`}}>
              <div style={{fontSize:11,fontWeight:700,color:C.purple,marginBottom:10}}>🔬 전략 백테스트</div>
              <div style={{fontSize:8,color:C.muted,marginBottom:12}}>조건 조합을 선택하면 보유 종목들의 과거 데이터로 시뮬레이션합니다</div>

              {/* 조건 토글 */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:12}}>
                {[["st3","ST 3/3","트리플ST 매수"],["cloud","구름위","일목 구름 위"],["macdCross","MACD↑","MACD 골든크로스"],["volSurge","거래량↑","20일 평균 150%+"],["w52","신고가","52주 고점 95%+"]].map(([k,label,desc])=>(
                  <button key={k} onClick={()=>setBtConds(c=>({...c,[k]:!c[k]}))} style={{padding:"8px 4px",borderRadius:7,border:`1px solid ${btConds[k]?C.purple:C.border}`,background:btConds[k]?"rgba(191,90,242,.15)":"rgba(255,255,255,.03)",color:btConds[k]?C.purple:C.muted,fontSize:9,fontWeight:btConds[k]?700:400,cursor:"pointer",textAlign:"center"}}>
                    <div>{btConds[k]?"✓ ":""}{label}</div>
                    <div style={{fontSize:7,color:C.muted,marginTop:2}}>{desc}</div>
                  </button>
                ))}
              </div>

              {/* 손절/익절 설정 */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                <div>
                  <div style={{fontSize:9,color:C.red,fontWeight:600,marginBottom:4}}>🛑 손절 -{btStopPct}%</div>
                  <input type="range" min="3" max="25" value={btStopPct} onChange={e=>setBtStopPct(+e.target.value)} style={{width:"100%",accentColor:C.red}}/>
                </div>
                <div>
                  <div style={{fontSize:9,color:C.emerald,fontWeight:600,marginBottom:4}}>🎯 익절 +{btTargetPct}%</div>
                  <input type="range" min="5" max="50" step="5" value={btTargetPct} onChange={e=>setBtTargetPct(+e.target.value)} style={{width:"100%",accentColor:C.emerald}}/>
                </div>
              </div>

              <button onClick={runBacktest} style={{width:"100%",background:"linear-gradient(135deg,#BF5AF2,#BF5AF2)",border:"none",borderRadius:8,padding:"10px",color:"#fff",fontWeight:900,fontSize:11,cursor:"pointer",marginBottom:10}}>
                🔬 백테스트 실행 ({Object.keys(charts).length}종목 스캔)
              </button>

              {/* 결과 */}
              {btResult&&<div>
                {btResult.msg
                  ?<div style={{textAlign:"center",padding:"20px",color:C.muted}}>{btResult.msg}</div>
                  :<>
                    {/* 요약 카드 */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:12}}>
                      {[
                        {l:"총 거래",v:btResult.total,c:C.text},
                        {l:"승률",v:`${btResult.winRate}%`,c:btResult.winRate>=50?C.emerald:C.red},
                        {l:"평균 손익",v:`${btResult.avgPnl>=0?"+":""}${btResult.avgPnl}%`,c:btResult.avgPnl>=0?C.emerald:C.red},
                        {l:"Profit Factor",v:btResult.profitFactor,c:btResult.profitFactor>=1.5?C.emerald:btResult.profitFactor>=1?C.yellow:C.red},
                      ].map(({l,v,c})=>(
                        <div key={l} style={{background:C.panel2,borderRadius:8,padding:"8px 6px",textAlign:"center"}}>
                          <div style={{fontSize:7,color:C.muted}}>{l}</div>
                          <div style={{fontSize:16,fontWeight:900,color:c}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:12}}>
                      <div style={{background:C.panel2,borderRadius:6,padding:"6px",textAlign:"center"}}>
                        <div style={{fontSize:7,color:C.muted}}>최대 수익</div>
                        <div style={{fontSize:12,fontWeight:700,color:C.green}}>+{btResult.maxWin}%</div>
                      </div>
                      <div style={{background:C.panel2,borderRadius:6,padding:"6px",textAlign:"center"}}>
                        <div style={{fontSize:7,color:C.muted}}>최대 손실</div>
                        <div style={{fontSize:12,fontWeight:700,color:C.red}}>{btResult.maxLoss}%</div>
                      </div>
                      <div style={{background:C.panel2,borderRadius:6,padding:"6px",textAlign:"center"}}>
                        <div style={{fontSize:7,color:C.muted}}>스캔 종목</div>
                        <div style={{fontSize:12,fontWeight:700,color:C.accent}}>{btResult.stockCount}개</div>
                      </div>
                    </div>

                    {/* 승률 바 */}
                    <div style={{height:8,background:"rgba(255,69,58,.3)",borderRadius:4,overflow:"hidden",marginBottom:12}}>
                      <div style={{height:"100%",width:`${btResult.winRate}%`,background:C.emerald,borderRadius:4,transition:"width .5s"}}/>
                    </div>

                    {/* 거래 목록 */}
                    <div style={{fontSize:9,fontWeight:700,color:C.accent,marginBottom:6}}>📋 시뮬 거래 (최근 30건)</div>
                    <div style={{maxHeight:250,overflowY:"auto"}}>
                      {btResult.trades.slice(0,30).map((t,i)=>(
                        <div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 0",borderBottom:`1px solid rgba(255,255,255,.04)`,fontSize:9}}>
                          <span style={{fontWeight:700,minWidth:50,color:C.text}}>{t.label?.substring(0,6)||t.ticker}</span>
                          <span style={{color:C.muted,fontSize:7}}>{t.date}</span>
                          <span style={{color:C.muted,fontSize:7}}>{t.holdDays}일</span>
                          <div style={{flex:1,display:"flex",gap:2,flexWrap:"wrap"}}>
                            {t.signals.map(s=><span key={s} style={{fontSize:6,padding:"1px 4px",borderRadius:2,background:"rgba(191,90,242,.1)",color:C.purple}}>{s}</span>)}
                          </div>
                          <span style={{fontWeight:700,color:t.pnl>=0?C.green:C.red,minWidth:45,textAlign:"right"}}>{t.pnl>=0?"+":""}{t.pnl}%</span>
                          <span style={{fontSize:7,color:t.reason==="익절"?C.emerald:t.reason==="손절"?C.red:C.muted}}>{t.reason}</span>
                        </div>
                      ))}
                    </div>
                    {btResult.total===0&&<div style={{textAlign:"center",padding:"20px",color:C.muted}}>조건에 맞는 진입 시점이 없습니다. 조건을 줄여보세요.</div>}
                  </>
                }
              </div>}
            </div>
          </div>}

          {alphaTab==="compare"&&<div style={css.card}>
            <div style={{fontSize:11,fontWeight:700,color:C.accent,marginBottom:4}}>⚖️ 관심종목 RS강도 비교</div>
            {watchlist.length===0
              ?<div style={{textAlign:"center",padding:"30px 0",color:C.muted}}>히트맵 ★ 눌러 추가</div>
              :<div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,minWidth:560}}>
                  <thead><tr style={{background:"rgba(255,255,255,.04)"}}>
                    {["종목","현재가","3D","5D","vs시장","거래량","일목","진입평점"].map(h=>(
                      <th key={h} style={{padding:"6px 8px",textAlign:"left",color:C.muted,fontSize:8,fontWeight:700,borderBottom:`1px solid ${C.border}`}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {[...watchlist].sort((a,b)=>((b.rs||0)-(a.rs||0))).map((stock,i)=>{
                      const cdc=charts[stock.ticker]?.data;const lD=cdc?.at(-1);
                      const iSt=lD?.aboveCloud?"above":lD?.nearCloud?"near":"below";
                      const isKR=(stock.ticker?.length||0)>5;
                      const es2=calcEntryScore(cdc,vixVal,oppScore,pool[stock.ticker]||stock);
                      return(
                        <tr key={stock.ticker} onClick={()=>navigateToStock(stock.ticker,stock)} style={{borderBottom:`1px solid rgba(255,255,255,.04)`,cursor:"pointer"}}>
                          <td style={{padding:"6px 8px",fontWeight:700}}>{fmtName(stock)}</td>
                          <td style={{padding:"6px 8px"}}>{isKR?"₩":"$"}{isKR?fmtKRW(stock.price||0):(stock.price||0).toLocaleString()}</td>
                          <td style={{padding:"6px 8px",color:(stock.chg3d||0)>=0?C.green:C.red,fontWeight:700}}>{(stock.chg3d||0)>=0?"+":""}{(stock.chg3d||0).toFixed(1)}%</td>
                          <td style={{padding:"6px 8px",color:(stock.chg5d||0)>=0?C.green:C.red,fontWeight:700}}>{(stock.chg5d||0)>=0?"+":""}{(stock.chg5d||0).toFixed(1)}%</td>
                          <td style={{padding:"6px 8px",color:(stock.rs||0)>=0?C.emerald:C.red,fontWeight:700}}>{(stock.rs||0)>=0?"+":""}{(stock.rs||0).toFixed(1)}%p</td>
                          <td style={{padding:"6px 8px",color:(stock.volRatio||100)>=150?C.green:C.muted}}>{stock.volRatio||"-"}%</td>
                          <td style={{padding:"6px 8px"}}><span style={{fontSize:9,fontWeight:700,color:iSt==="above"?C.emerald:iSt==="near"?C.yellow:"#FF453A"}}>{iSt==="above"?"구름위":iSt==="near"?"접근":"아래"}</span></td>
                          <td style={{padding:"6px 8px"}}><span style={{fontSize:11,fontWeight:900,color:es2.grade==="S"?C.emerald:es2.grade==="A"?C.green:es2.grade==="B"?C.yellow:C.muted}}>{es2.grade}</span><span style={{fontSize:8,color:C.muted,marginLeft:2}}>{es2.score}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            }
          </div>}
        </div>}

        {/* ══ TAB 3: 차트 ══ */}
        {tab==="sniper"&&selInfo&&<div style={{padding:"12px 14px"}}>
          <RSBar/>
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
            <div style={{fontWeight:900,fontSize:15}}>{fmtFullName(selInfo)}</div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontWeight:900,fontSize:17}}>{unit}{isKRSel?fmtKRW(curPrice):curPrice.toLocaleString(undefined,{maximumFractionDigits:2})}</span>
              {selInfo.changePct!=null&&<span style={{fontSize:11,fontWeight:700,color:selInfo.changePct>=0?C.green:C.red}}><span style={{fontSize:8,color:C.muted}}>1D</span> {selInfo.changePct>=0?"+":""}{selInfo.changePct?.toFixed?.(2)}%</span>}
              {cd?.real&&<span style={{fontSize:7,background:"rgba(34,197,94,.15)",color:C.green,border:"1px solid rgba(34,197,94,.3)",borderRadius:3,padding:"1px 4px"}}>실시간</span>}
              {cd&&!cd.real&&<button onClick={async()=>{
                setAddMsg("🔄 실시간 데이터 조회 중...");
                const real=await fetchFromYahoo(sel);
                if(real&&real.candles?.length>10){
                  setStocks(p=>p.map(s=>s.ticker===sel?{...s,...real,candles:undefined}:s));
                  try{setCharts(prev=>({...prev,[sel]:{data:buildChartData(real.candles),real:true}}));}catch{}
                  setAddMsg("✅ 실시간 차트로 전환됨");
                }else{setAddMsg("❌ 실시간 데이터 조회 실패");}
                setTimeout(()=>setAddMsg(""),3000);
              }} style={{fontSize:7,background:"rgba(255,214,10,.1)",color:C.yellow,border:"1px solid rgba(255,214,10,.3)",borderRadius:3,padding:"1px 6px",cursor:"pointer"}}>시뮬 · 🔄 실시간 전환</button>}
            </div>
            <div style={{background:lastD?.allBull?"rgba(48,209,88,.15)":"rgba(255,69,58,.1)",border:`1px solid ${lastD?.allBull?C.emerald:C.red}`,borderRadius:5,padding:"2px 8px",fontSize:9,fontWeight:700,color:lastD?.allBull?C.emerald:C.red}}>{lastD?.allBull?"🟢 3/3 매수배경":"🔴 비매수배경"}</div>
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
                <div key={i} style={{background:b.ok?"rgba(48,209,88,.08)":"rgba(255,255,255,.03)",border:`1px solid ${b.ok?"rgba(48,209,88,.3)":"rgba(255,255,255,.08)"}`,borderRadius:5,padding:"4px 7px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:9,color:b.ok?C.text:C.muted}}>{b.label}</span>
                  <span style={{fontSize:10,fontWeight:700,color:b.ok?C.emerald:C.muted}}>+{b.pts}</span>
                </div>
              ))}
            </div>
          </div>

          {/* RS 비교 */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:10}}>
            <div style={css.panel2}>
              <div style={{fontSize:8,color:C.muted,marginBottom:3}}>{fmtName(selInfo)} <span style={{color:C.accent}}>3D</span></div>
              <div style={{fontSize:17,fontWeight:900,color:(selInfo.chg3d||0)>=0?C.green:C.red}}>{(selInfo.chg3d||0)>=0?"+":""}{(selInfo.chg3d||0).toFixed?.(1)||0}%</div>
              <div style={{fontSize:7,color:C.sub,marginTop:2}}>vs시장 {((selInfo.chg3d||0)-idxRS.spy.chg3d)>=0?"+":""}{((selInfo.chg3d||0)-idxRS.spy.chg3d).toFixed(1)}%p</div>
            </div>
            <div style={css.panel2}>
              <div style={{fontSize:8,color:C.muted,marginBottom:3}}>{fmtName(selInfo)} <span style={{color:C.accent}}>5D</span></div>
              <div style={{fontSize:17,fontWeight:900,color:(selInfo.chg5d||0)>=0?C.green:C.red}}>{(selInfo.chg5d||0)>=0?"+":""}{(selInfo.chg5d||0).toFixed?.(1)||0}%</div>
              <div style={{fontSize:7,color:C.sub,marginTop:2}}>vs시장 {((selInfo.chg5d||0)-idxRS.spy.chg5d)>=0?"+":""}{((selInfo.chg5d||0)-idxRS.spy.chg5d).toFixed(1)}%p</div>
            </div>
            <div style={{...css.panel2,background:((selInfo.chg5d||0)-idxRS.spy.chg5d)>0?"rgba(48,209,88,.08)":"rgba(255,69,58,.06)"}}>
              <div style={{fontSize:8,color:C.emerald,marginBottom:3}}>RS 강도</div>
              <div style={{fontSize:16,fontWeight:900,color:((selInfo.chg5d||0)-idxRS.spy.chg5d)>3?C.emerald:((selInfo.chg5d||0)-idxRS.spy.chg5d)>0?C.yellow:C.red}}>{((selInfo.chg5d||0)-idxRS.spy.chg5d)>3?"매우강":((selInfo.chg5d||0)-idxRS.spy.chg5d)>0?"보통":"약세"}</div>
            </div>
          </div>

          {/* ★ v2.3: 컨센서스 목표가 + 예상수익률 */}
          <div style={{background:"linear-gradient(135deg,rgba(10,132,255,.08),rgba(191,90,242,.08))",border:`2px solid ${C.accent}`,borderRadius:12,padding:"14px 16px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
              <div>
                <div style={{fontSize:9,color:C.muted,marginBottom:4}}>🎯 목표가</div>
                <div style={{fontSize:28,fontWeight:900,color:C.accent,lineHeight:1}}>{consTgt>0?`${unit}${fmtPrice(consTgt,isKRSel)}`:"조회중..."}</div>
                {consTgt>0&&curPrice>0&&<div style={{fontSize:8,color:C.muted,marginTop:4}}>현재 {unit}{fmtPrice(curPrice,isKRSel)} 대비</div>}
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:9,color:C.muted,marginBottom:4}}>예상 수익률</div>
                {consTgt>0&&curPrice>0?<>
                  <div style={{fontSize:32,fontWeight:900,color:consTgt>curPrice?C.emerald:C.red,lineHeight:1}}>{consTgt>curPrice?"+":""}{((consTgt-curPrice)/curPrice*100).toFixed(1)}%</div>
                  <div style={{fontSize:9,color:C.muted,marginTop:4}}>R:R {rrRatio}:1</div>
                </>:<div style={{fontSize:20,color:C.muted}}>—</div>}
              </div>
            </div>
            {/* 컨센서스 상세 */}
            {consensus[sel]?.data&&(()=>{
              const c=consensus[sel].data;
              return<div style={{borderTop:`1px solid ${C.border}`,paddingTop:8}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:6}}>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:7,color:C.muted}}>컨센서스</div>
                    <div style={{fontSize:10,fontWeight:900,color:c.consensus?.includes("Buy")?C.emerald:c.consensus?.includes("Sell")?C.red:C.yellow}}>{c.consensus||"—"}</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:7,color:C.muted}}>목표 상단</div>
                    <div style={{fontSize:10,fontWeight:700,color:C.green}}>{c.targetHigh?`${unit}${fmtPrice(c.targetHigh,isKRSel)}`:"—"}</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:7,color:C.muted}}>목표 하단</div>
                    <div style={{fontSize:10,fontWeight:700,color:C.red}}>{c.targetLow?`${unit}${fmtPrice(c.targetLow,isKRSel)}`:"—"}</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:7,color:C.muted}}>애널리스트</div>
                    <div style={{fontSize:9}}><span style={{color:C.green}}>{c.buyCount||0}매수</span>·<span style={{color:C.muted}}>{c.holdCount||0}중립</span>·<span style={{color:C.red}}>{c.sellCount||0}매도</span></div>
                  </div>
                </div>
                {c.summary&&<div style={{fontSize:8,color:C.sub,background:"rgba(0,0,0,.3)",borderRadius:5,padding:"4px 8px"}}>{c.summary}</div>}
                {c.updatedAt&&<div style={{fontSize:7,color:C.muted,textAlign:"right",marginTop:4}}>기준: {c.updatedAt}</div>}
              </div>;
            })()}
            {consensus[sel]?.loading&&<div style={{fontSize:8,color:C.accent,textAlign:"center",padding:6}}>🔄 컨센서스 조회 중...</div>}
            {!consensus[sel]&&<button onClick={()=>fetchConsensus(sel,selInfo?.label,selInfo?.market)} style={{width:"100%",background:"rgba(10,132,255,.08)",border:`1px solid ${C.accent}`,borderRadius:6,padding:"6px",color:C.accent,fontSize:9,cursor:"pointer",marginTop:4}}>🔍 컨센서스 조회</button>}
            {/* ATR 도달 예상 */}
            {atrDaysToTarget&&<div style={{fontSize:8,color:C.muted,marginTop:6,textAlign:"center"}}>📈 ATR 기준 목표 도달 예상: <span style={{color:C.accent,fontWeight:700}}>약 {atrDaysToTarget}거래일</span> (일변동 {atrDaily}%)</div>}
          </div>

          {/* 목표가 / 손절가 + 수익 추정 */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>
            <div style={{background:"rgba(10,132,255,.08)",border:`1px solid rgba(56,189,248,.3)`,borderRadius:8,padding:"9px 10px",textAlign:"center"}}>
              <div style={{fontSize:8,color:C.muted,marginBottom:2}}>R:R 2:1 목표</div>
              <div style={{fontSize:14,fontWeight:800,color:C.accent}}>{rrTarget2>0?`${unit}${fmtPrice(rrTarget2,isKRSel)}`:"—"}</div>
              {rrTarget2>0&&curPrice>0&&<div style={{fontSize:9,color:C.green,marginTop:2}}>+{((rrTarget2-curPrice)/curPrice*100).toFixed(1)}% · ₩{fmtKRW(Math.round(pyramidAmts[0]*((rrTarget2-curPrice)/curPrice)))}</div>}
            </div>
            <div style={{background:"rgba(191,90,242,.08)",border:"1px solid rgba(191,90,242,.3)",borderRadius:8,padding:"9px 10px",textAlign:"center"}}>
              <div style={{fontSize:8,color:C.muted,marginBottom:2}}>R:R 3:1 목표</div>
              <div style={{fontSize:14,fontWeight:800,color:C.purple}}>{rrTarget3>0?`${unit}${fmtPrice(rrTarget3,isKRSel)}`:"—"}</div>
              {rrTarget3>0&&curPrice>0&&<div style={{fontSize:9,color:C.green,marginTop:2}}>+{((rrTarget3-curPrice)/curPrice*100).toFixed(1)}% · ₩{fmtKRW(Math.round(pyramidAmts[0]*((rrTarget3-curPrice)/curPrice)))}</div>}
            </div>
            <div style={{background:"rgba(48,209,88,.08)",border:`1px solid rgba(48,209,88,.3)`,borderRadius:8,padding:"9px 10px",textAlign:"center"}}>
              <div style={{fontSize:8,color:C.muted,marginBottom:2}}>52주 고점</div>
              <div style={{fontSize:14,fontWeight:800,color:C.emerald}}>{w52High>0?`${unit}${fmtPrice(w52High,isKRSel)}`:"—"}</div>
              {w52High>0&&curPrice>0&&<div style={{fontSize:9,color:w52High>curPrice?C.green:C.yellow,marginTop:2}}>{w52High>curPrice?`+${((w52High-curPrice)/curPrice*100).toFixed(1)}%`:"돌파중"}</div>}
            </div>
          </div>
          {curPrice>0&&charts[sel]?.data?.length>0&&findResistanceLevels(charts[sel].data.map(d=>({high:d.close*1.005,close:d.close})),curPrice).length>0&&<div style={{background:"rgba(255,159,10,.06)",border:"1px solid rgba(255,159,10,.25)",borderRadius:8,padding:"9px 12px",marginBottom:8}}>
            <div style={{fontSize:8,fontWeight:700,color:"#FF9F0A",marginBottom:5}}>🧱 매물대 저항선</div>
            <div style={{display:"flex",gap:8}}>
              {findResistanceLevels(charts[sel].data.map(d=>({high:d.close*1.005,close:d.close})),curPrice).map((lv,i)=>(
                <div key={i} style={{textAlign:"center",flex:1}}>
                  <div style={{fontSize:7,color:C.muted}}>저항{i+1}</div>
                  <div style={{fontSize:12,fontWeight:700,color:"#FF9F0A"}}>{unit}{fmtPrice(lv.price,isKRSel)}</div>
                </div>
              ))}
            </div>
          </div>}

          {/* ★ v2.2: 피보나치 되돌림 */}
          {fibLevels&&<div style={{background:"rgba(191,90,242,.06)",border:"1px solid rgba(191,90,242,.25)",borderRadius:8,padding:"9px 12px",marginBottom:8}}>
            <div style={{fontSize:8,fontWeight:700,color:C.purple,marginBottom:5}}>📐 피보나치 되돌림 (60일)</div>
            <div style={{display:"flex",gap:4}}>
              {[["고점",fibLevels.high,C.green],["38.2%",fibLevels.fib382,C.accent],["50%",fibLevels.fib500,C.yellow],["61.8%",fibLevels.fib618,C.purple],["저점",fibLevels.low,C.red]].map(([lbl,price,col])=>(
                <div key={lbl} style={{flex:1,textAlign:"center",padding:"3px 0",borderRadius:4,background:curPrice>=price*0.99&&curPrice<=price*1.01?`${col}22`:"transparent",border:curPrice>=price*0.99&&curPrice<=price*1.01?`1px solid ${col}`:"1px solid transparent"}}>
                  <div style={{fontSize:7,color:C.muted}}>{lbl}</div>
                  <div style={{fontSize:10,fontWeight:700,color:col}}>{unit}{fmtPrice(price,isKRSel)}</div>
                  <div style={{fontSize:7,color:price>curPrice?C.green:C.red}}>{price>curPrice?"+":""}{((price-curPrice)/curPrice*100).toFixed(1)}%</div>
                </div>
              ))}
            </div>
          </div>}

          {/* ★ v2.2: 매수 시뮬레이터 (풀세트) */}
          {perStockMax>0&&<div style={{...css.card,border:`1px solid ${C.accent}`,marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:10,fontWeight:700,color:C.accent}}>🧮 매수 시뮬레이터</div>
              <div style={{display:"flex",gap:4}}>
                {[["basic",`기본 ₩${fmtKRW(riskSettings.totalCapital)}`],["special",`⭐특별 ₩${fmtKRW(riskSettings.specialCapital||10000000)}`]].map(([k,l])=>(
                  <button key={k} onClick={()=>setStockMode(k)} style={{padding:"3px 8px",borderRadius:5,fontSize:8,fontWeight:stockMode===k?700:400,border:`1px solid ${stockMode===k?C.accent:C.border}`,background:stockMode===k?"rgba(10,132,255,.15)":"transparent",color:stockMode===k?C.accent:C.muted,cursor:"pointer"}}>{l}</button>
                ))}
              </div>
            </div>
            {(()=>{
              const sMode = stockMode==="special";
              const sPyramid = sMode ? PYRAMID_SPECIAL : PYRAMID_BASIC;
              const sCapital = sMode ? (riskSettings.specialCapital||10000000) : (riskSettings.totalCapital||5000000);
              const sAmts = sPyramid.map(r=>Math.round(sCapital*r.pct/100));
            return <>
            {overPositions&&<div style={{fontSize:8,color:C.red,marginBottom:6}}>⚠ 최대 종목수 초과 ({currentExposure}/{riskSettings.maxPositions})</div>}

            {/* ATR 일변동폭 */}
            {atrDaily&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>
              <div style={{background:"rgba(0,0,0,.5)",borderRadius:6,padding:"6px",textAlign:"center"}}>
                <div style={{fontSize:7,color:C.muted}}>ATR 일변동폭</div>
                <div style={{fontSize:14,fontWeight:900,color:C.accent}}>±{atrDaily}%</div>
                <div style={{fontSize:7,color:C.muted}}>하루 평균 움직임</div>
              </div>
              <div style={{background:"rgba(0,0,0,.5)",borderRadius:6,padding:"6px",textAlign:"center"}}>
                <div style={{fontSize:7,color:C.muted}}>거래대금</div>
                <div style={{fontSize:14,fontWeight:900,color:C.text}}>{fmtTurnover(selTurnover,isKRSel)}</div>
                <div style={{fontSize:7,color:C.muted}}>금일 추정</div>
              </div>
              <div style={{background:"rgba(0,0,0,.5)",borderRadius:6,padding:"6px",textAlign:"center"}}>
                <div style={{fontSize:7,color:C.muted}}>목표 도달 예상</div>
                <div style={{fontSize:14,fontWeight:900,color:atrDaysToTarget?C.emerald:C.muted}}>{atrDaysToTarget?`~${atrDaysToTarget}일`:"—"}</div>
                <div style={{fontSize:7,color:C.muted}}>ATR 기준 추정</div>
              </div>
            </div>}

            {/* 단계별 매수 시뮬 */}
            <div style={{fontSize:8,fontWeight:700,color:C.purple,marginBottom:6}}>📐 분할매수 시뮬레이션 ({sMode?"⭐특별":"기본"} ₩{fmtKRW(sCapital)})</div>
            <div style={{display:"grid",gridTemplateColumns:`repeat(${sPyramid.length},1fr)`,gap:4,marginBottom:8}}>
              {sPyramid.map((r,i)=>{
                const amt=sAmts[i];
                const shares=curPrice>0?Math.floor(amt/curPrice):0;
                const triggerPrice=i===0?curPrice:+(curPrice*(1+r.targetPct/100)).toFixed(isKRSel?0:2);
                return <div key={i} style={{background:"rgba(191,90,242,.06)",border:`1px solid rgba(191,90,242,.2)`,borderRadius:6,padding:"6px",textAlign:"center"}}>
                  <div style={{fontSize:8,color:C.purple,fontWeight:700}}>{r.label}</div>
                  <div style={{fontSize:12,fontWeight:900,color:C.text}}>{r.pct}%</div>
                  <div style={{fontSize:8,color:C.accent,fontWeight:700}}>₩{fmtKRW(amt)}</div>
                  <div style={{fontSize:7,color:C.muted}}>{shares}주 × {unit}{fmtPrice(triggerPrice,isKRSel)}</div>
                  <div style={{fontSize:7,color:i===0?C.muted:C.emerald}}>{i===0?"진입시":`평단+${r.targetPct}%`}</div>
                </div>;
              })}
            </div>

            {/* 손절/수익 금액 표시 */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:6}}>
              <div style={{background:"rgba(255,69,58,.08)",borderRadius:6,padding:"6px",textAlign:"center"}}>
                <div style={{fontSize:7,color:C.red}}>보초 손절 (-{trailSettings.initialStopPct}%)</div>
                <div style={{fontSize:12,fontWeight:900,color:C.red}}>-₩{fmtKRW(Math.round(sAmts[0]*trailSettings.initialStopPct/100))}</div>
                <div style={{fontSize:7,color:C.muted}}>손절가 {unit}{fmtPrice(curPrice*(1-trailSettings.initialStopPct/100),isKRSel)}</div>
              </div>
              <div style={{background:"rgba(48,209,88,.08)",borderRadius:6,padding:"6px",textAlign:"center"}}>
                <div style={{fontSize:7,color:C.emerald}}>전량투입+목표 도달</div>
                <div style={{fontSize:12,fontWeight:900,color:C.emerald}}>{consTgt>curPrice?`+₩${fmtKRW(Math.round(sCapital*((consTgt-curPrice)/curPrice)))}`:"—"}</div>
                <div style={{fontSize:7,color:C.muted}}>R:R {rrRatio}:1</div>
              </div>
              <div style={{background:"rgba(191,90,242,.08)",borderRadius:6,padding:"6px",textAlign:"center"}}>
                <div style={{fontSize:7,color:C.purple}}>트레일링 전환</div>
                <div style={{fontSize:12,fontWeight:900,color:C.purple}}>+{trailSettings.switchPct}%</div>
                <div style={{fontSize:7,color:C.muted}}>이후 고점-{trailSettings.trailPct}%</div>
              </div>
            </div>
            <div style={{fontSize:7,color:C.muted}}>{sMode?"⭐특별":"기본"} ₩{fmtKRW(sCapital)} · 손절 -{trailSettings.initialStopPct}% · 타임컷 {trailSettings.timeCutDays}일</div>
            </>;
            })()}
          </div>}

          {/* 기간 선택 + 차트 */}
          {sliced.length>0&&<>
          <div style={{display:"flex",gap:4,justifyContent:"center",marginBottom:6}}>
            {["1M","3M","6M","1Y","ALL"].map(p=><button key={p} onClick={()=>setPeriod(p)} style={{...css.btn(period===p),fontSize:9,padding:"4px 10px"}}>{p}</button>)}
          </div>
          <div style={{background:lastD?.allBull?"rgba(48,209,88,.05)":"rgba(255,69,58,.04)",border:`1px solid ${lastD?.allBull?"rgba(48,209,88,.3)":C.border}`,borderRadius:10,padding:"8px 6px 4px",marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingLeft:8,paddingRight:8,marginBottom:6}}>
              <div style={{fontSize:9,color:C.muted}}>{lastD?.allBull?"🟢 매수배경":"🔴 비매수배경"} {cd?.real?"(실제)":"(시뮬)"}</div>
              <div style={{display:"flex",gap:4}}>
                {[["ichi","일목"],["st","ST"],["avwap","AVWAP"],["adx","ADX"],["obv","OBV"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setChartOpts(o=>({...o,[k]:!o[k]}))} style={{fontSize:8,padding:"3px 7px",borderRadius:4,border:`1px solid ${chartOpts[k]?"rgba(10,132,255,.5)":"rgba(255,255,255,.15)"}`,background:chartOpts[k]?"rgba(56,189,248,.12)":"transparent",color:chartOpts[k]?C.accent:C.muted,cursor:"pointer"}}>{chartOpts[k]?"✓":""} {l}</button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={270}>
              <ComposedChart data={sliced} syncId="stockChart" margin={{left:0,right:6}}>
                <CartesianGrid stroke="rgba(255,255,255,.03)"/>
                <XAxis dataKey="date" tick={{fill:C.muted,fontSize:7}} tickLine={false} interval={Math.floor(sliced.length/5)||1}/>
                <YAxis yAxisId="p" tick={{fill:C.muted,fontSize:7}} tickLine={false} domain={["auto","auto"]} tickFormatter={v=>unit==="₩"?`${(v/1000).toFixed(0)}k`:v.toFixed(0)} width={40}/>
                <YAxis yAxisId="v" orientation="right" hide domain={[0,dm=>dm*5]}/>
                <Tooltip content={<Tip/>}/>
                <Bar yAxisId="v" dataKey="volume" fill="rgba(148,163,184,.1)" radius={[1,1,0,0]}/>
                {/* HMA/200일선 */}
                <Line yAxisId="p" type="monotone" dataKey="hma20" stroke="#FF9F0A" strokeWidth={1.5} dot={false} connectNulls strokeDasharray="4 2"/>
                <Line yAxisId="p" type="monotone" dataKey="ma200" stroke="rgba(148,163,184,.6)" strokeWidth={1.2} dot={false} connectNulls strokeDasharray="3 3"/>
                {/* ★ 11번: Anchored VWAP */}
                {chartOpts.avwap&&<Line yAxisId="p" type="monotone" dataKey="avwap" stroke="#BF5AF2" strokeWidth={1.8} dot={false} connectNulls strokeDasharray="6 3"/>}
                {chartOpts.ichi&&<Area yAxisId="p" type="monotone" dataKey="spanA" stroke="rgba(34,197,94,.7)" fill="rgba(34,197,94,.12)" strokeWidth={1.5} dot={false} connectNulls/>}
                {chartOpts.ichi&&<Area yAxisId="p" type="monotone" dataKey="spanB" stroke="rgba(255,69,58,.7)" fill="rgba(255,69,58,.12)" strokeWidth={1.5} dot={false} connectNulls/>}
                <Area yAxisId="p" type="monotone" dataKey="close" stroke="#ffffff" strokeWidth={2.5} fill="rgba(255,255,255,.03)" dot={false}/>
                {chartOpts.st&&["st1Bull","st2Bull","st3Bull"].map((k,i)=><Line key={k} yAxisId="p" type="monotone" dataKey={k} stroke={C.emerald} strokeWidth={2.5-i*.5} dot={false} connectNulls={false} strokeOpacity={1-.2*i}/>)}
                {chartOpts.st&&["st1Bear","st2Bear","st3Bear"].map((k,i)=><Line key={k} yAxisId="p" type="monotone" dataKey={k} stroke={C.red} strokeWidth={2.5-i*.5} dot={false} connectNulls={false} strokeOpacity={1-.2*i}/>)}
                {consTgt>0&&<ReferenceLine yAxisId="p" y={consTgt} stroke="transparent" label={{value:`▶ ${unit}${consTgt.toLocaleString()}`,fill:C.accent,fontSize:7,position:"insideRight"}}/>}
                {stopPrice>0&&<ReferenceLine yAxisId="p" y={stopPrice} stroke="transparent" label={{value:`▶ 손절 ${unit}${stopPrice.toLocaleString()}`,fill:C.red,fontSize:7,position:"insideRight"}}/>}
                <Scatter yAxisId="p" dataKey="buyStrong" fill="#4ade80" shape={<BuyDot dataKey="buyStrong"/>}/>
                <Scatter yAxisId="p" dataKey="buyNormal" fill="#FFD60A" shape={<BuyDot dataKey="buyNormal"/>}/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* MACD */}
          <div style={{...css.card,padding:"6px 6px 3px",marginBottom:6}}>
            <div style={{fontSize:8,color:C.muted,paddingLeft:6,marginBottom:3}}>MACD</div>
            <ResponsiveContainer width="100%" height={80}>
              <ComposedChart data={sliced} syncId="stockChart" margin={{left:0,right:6}}>
                <XAxis dataKey="date" tick={false} tickLine={false}/>
                <YAxis tick={{fill:C.muted,fontSize:6}} tickLine={false} width={40} tickFormatter={v=>v.toFixed(1)}/>
                <Tooltip content={<Tip/>}/>
                <ReferenceLine y={0} stroke="rgba(255,255,255,.15)"/>
                <Bar dataKey="hist" shape={<HistBar/>}/>
                <Line type="monotone" dataKey="macd" stroke={C.accent} strokeWidth={1.5} dot={false}/>
                <Line type="monotone" dataKey="signal" stroke="#f59e0b" strokeWidth={1.5} dot={false}/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* RSI */}
          <div style={{...css.card,padding:"6px 6px 3px",marginBottom:6}}>
            <div style={{fontSize:8,color:C.muted,paddingLeft:6,marginBottom:3}}>RSI (14) — 현재 {lastD?.rsi?.toFixed(0)||"—"}</div>
            <ResponsiveContainer width="100%" height={80}>
              <ComposedChart data={sliced} syncId="stockChart" margin={{left:0,right:6}}>
                <XAxis dataKey="date" tick={{fill:C.muted,fontSize:6}} tickLine={false} interval={Math.floor(sliced.length/5)||1}/>
                <YAxis domain={[0,100]} tick={{fill:C.muted,fontSize:6}} tickLine={false} ticks={[30,70]} width={40}/>
                <Tooltip content={<Tip/>}/>
                <ReferenceLine y={70} stroke="rgba(255,69,58,.25)"/>
                <ReferenceLine y={30} stroke="rgba(34,197,94,.25)"/>
                <Area type="monotone" dataKey="rsi" stroke={C.accent} fill="rgba(56,189,248,.07)" strokeWidth={1.5} dot={false}/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* ADX 패널 */}
          {chartOpts.adx&&<div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:7,padding:"6px 6px 3px",marginBottom:6}}>
            <div style={{fontSize:7,color:C.muted,paddingLeft:6,marginBottom:3}}>ADX <span style={{color:lastD?.adx>=25?C.emerald:C.muted}}>{lastD?.adx?.toFixed(0)||"—"} {lastD?.adx>=25?"(추세강)":"(횡보)"}</span></div>
            <ResponsiveContainer width="100%" height={70}>
              <ComposedChart data={sliced} syncId="stockChart" margin={{left:0,right:6}}>
                <XAxis dataKey="date" tick={false} tickLine={false}/>
                <YAxis domain={[0,100]} tick={{fill:C.muted,fontSize:6}} tickLine={false} ticks={[25,50]} width={40}/>
                <Tooltip content={<Tip/>}/>
                <ReferenceLine y={25} stroke="rgba(255,255,255,.15)"/>
                <Line type="monotone" dataKey="adx" stroke={C.accent} strokeWidth={2} dot={false} connectNulls/>
                <Line type="monotone" dataKey="pdi" stroke={C.emerald} strokeWidth={1} dot={false} connectNulls strokeDasharray="3 2"/>
                <Line type="monotone" dataKey="mdi" stroke={C.red} strokeWidth={1} dot={false} connectNulls strokeDasharray="3 2"/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>}

          {/* OBV 패널 */}
          {chartOpts.obv&&<div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:7,padding:"6px 6px 3px",marginBottom:6}}>
            <div style={{fontSize:7,color:C.muted,paddingLeft:6,marginBottom:3}}>OBV (백만)</div>
            <ResponsiveContainer width="100%" height={70}>
              <ComposedChart data={sliced} syncId="stockChart" margin={{left:0,right:6}}>
                <XAxis dataKey="date" tick={false} tickLine={false}/>
                <YAxis tick={{fill:C.muted,fontSize:6}} tickLine={false} width={40} tickFormatter={v=>v.toFixed(0)}/>
                <Tooltip content={<Tip/>}/>
                <Area type="monotone" dataKey="obv" stroke={C.purple} fill="rgba(191,90,242,.08)" strokeWidth={1.5} dot={false} connectNulls/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>}

          {/* ★ 11번: Squeeze TTM */}
          <div style={{...css.card,padding:"6px 6px 3px",marginBottom:6}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingLeft:6,marginBottom:3}}>
              <span style={{fontSize:7,color:C.muted}}>Squeeze TTM <span style={{fontSize:6,color:lastD?.sqzOn?"#FFD60A":"rgba(255,255,255,.3)"}}>● {lastD?.sqzOn?"스퀴즈 압축중":"스퀴즈 해제"}</span></span>
              <span style={{fontSize:7,color:lastD?.sqzMomUp?C.green:C.red}}>{lastD?.sqzMomUp?"▲ 모멘텀↑":"▼ 모멘텀↓"}</span>
            </div>
            <ResponsiveContainer width="100%" height={70}>
              <ComposedChart data={sliced} syncId="stockChart" margin={{left:0,right:6}}>
                <XAxis dataKey="date" tick={false} tickLine={false}/>
                <YAxis tick={{fill:C.muted,fontSize:6}} tickLine={false} width={40} tickFormatter={v=>v.toFixed(1)}/>
                <Tooltip content={<Tip/>}/>
                <ReferenceLine y={0} stroke="rgba(255,255,255,.2)"/>
                <Bar dataKey="sqzMom" shape={(props)=>{
                  const {x,y,width,height,payload}=props;
                  if(payload?.sqzMom==null)return null;
                  const pos=payload.sqzMom>=0;
                  const rising=payload.sqzMomUp;
                  const fill=pos?(rising?"#30D158":"#5AD58C"):(rising?"#FF6961":"#FF453A");
                  const h=Math.abs(height||0);
                  return<rect x={x} y={pos?y:y+height-h} width={Math.max(1,width)} height={h} fill={fill} rx={1}/>;
                }}/>
              </ComposedChart>
            </ResponsiveContainer>
            {/* 스퀴즈 도트 */}
            <div style={{display:"flex",gap:2,paddingLeft:6,paddingBottom:3,overflowX:"hidden"}}>
              {sliced.slice(-40).map((d,i)=>(
                <div key={i} style={{width:4,height:4,borderRadius:"50%",flexShrink:0,
                  background:d.sqzOff?"#FF453A":d.sqzOn?"#FFD60A":"rgba(255,255,255,.2)"}}
                  title={d.sqzOn?"압축중":d.sqzOff?"해제!":"없음"}/>
              ))}
            </div>
            <div style={{display:"flex",gap:8,paddingLeft:6,fontSize:7,color:C.muted,paddingBottom:2}}>
              <span>🟡 압축중</span><span>🔴 해제</span><span>⚪ 없음</span>
            </div>
          </div>
          </>}

          {/* 보조지표 4개 */}
          <div style={{...css.card,marginBottom:10}}>
            <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8}}>📉 보조 지표</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:7}}>
              {[
                {l:"RSI",v:lastD?.rsi?.toFixed(0)||"-",c:lastD?.rsi>70?C.red:lastD?.rsi<30?C.green:C.text,d:lastD?.rsi>70?"⚠과매수":lastD?.rsi<30?"🎯과매도":"정상"},
                {l:"MACD",v:lastD?.macd>lastD?.signal?"크로스↑":"크로스↓",c:lastD?.macd>lastD?.signal?C.green:C.red,d:lastD?.hist>0?"양봉":"음봉"},
                {l:"거래량",v:`${selInfo?.volRatio||selInfo?._volRatio||"-"}%`,c:(selInfo?.volRatio||selInfo?._volRatio||0)>=150?C.green:(selInfo?.volRatio||selInfo?._volRatio||0)>=100?C.yellow:C.muted,d:(selInfo?.volRatio||selInfo?._volRatio||0)>=150?"급증":"보통"},
                {l:"거래대금",v:fmtTurnover(selTurnover,isKRSel),c:C.text,d:isKRSel?"원":"USD"},
                {l:"RS강도",v:`${((selInfo.chg5d||0)-idxRS.spy.chg5d).toFixed(1)}%p`,c:((selInfo.chg5d||0)-idxRS.spy.chg5d)>3?C.emerald:((selInfo.chg5d||0)-idxRS.spy.chg5d)>0?C.yellow:C.red,d:((selInfo.chg5d||0)-idxRS.spy.chg5d)>3?"매우강":"보통"},
              ].map((m,i)=>(
                <div key={i} style={{background:C.panel2,borderRadius:7,padding:"8px 10px",textAlign:"center"}}>
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
              ["sector",true,"🏭 목표 업종이 당일 강세 섹터"],
              ["stock",entryScore.score>=55,"📈 진입평점 55pt+ (현재 "+entryScore.score+"pt)"],
              ["timing",lastD?.allBull&&(lastD?.macd||0)>(lastD?.signal||0),"⏰ 트리플 ST 매수 + MACD 크로스"],
              ["risk",stopPrice>0&&stopPrice<curPrice,"🛑 손절가 현재가 아래 확인"],
            ].map(([key,autoVal,label])=>(
              <div key={key} onClick={()=>setChecklist(c=>({...c,[key]:!c[key]}))} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid rgba(255,255,255,.05)`,cursor:"pointer"}}>
                <div style={{width:16,height:16,borderRadius:3,border:`1px solid ${(checklist[key]||autoVal)?C.emerald:C.border}`,background:(checklist[key]||autoVal)?"rgba(48,209,88,.2)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,flexShrink:0}}>
                  {(checklist[key]||autoVal)?<span style={{color:C.emerald}}>✓</span>:""}
                </div>
                <span style={{fontSize:9,color:(checklist[key]||autoVal)?C.text:C.muted}}>{label}</span>
                {autoVal&&<span style={{fontSize:7,color:C.emerald,marginLeft:"auto"}}>자동</span>}
              </div>
            ))}
          </div>

          {/* 매수 등록 (맨 마지막 — 체크리스트 완료 후) */}
          <button onClick={()=>{
            if(!checkOk)return;
            const snap={stCount:[lastD?.st1Bull,lastD?.st2Bull,lastD?.st3Bull].filter(v=>v!=null).length,cloud:lastD?.aboveCloud?"above":lastD?.nearCloud?"near":"below",macdCross:lastD?.macd>lastD?.signal,macdHist:lastD?.hist>0,rsi:lastD?.rsi?+lastD.rsi.toFixed(0):null,rsRank:selPoolInfo?.rsRank||null,rsPctRank:selPoolInfo?.rsPctRank||null,volRatio:selInfo?.volRatio||selInfo?._volRatio||null,w52Breakout:selPoolInfo?.w52Breakout||false,vix:+vixVal.toFixed(1),oppScore,entryGrade:entryScore.grade,entryPts:entryScore.score,conditions:entryScore.breakdown.filter(b=>b.ok).map(b=>b.label)};
            const sMode2=stockMode==="special";const sPyr2=sMode2?PYRAMID_SPECIAL:PYRAMID_BASIC;const sCap2=sMode2?(riskSettings.specialCapital||10000000):(riskSettings.totalCapital||5000000);
            const initAmt=prompt("보초 실제 투입 금액 (만원 단위, 예: 50):");
            if(!initAmt)return;
            const realAmt=parseInt(initAmt)*10000;
            setPositions(p=>[...p,{id:Date.now(),ticker:sel,label:selInfo.label,market:selInfo.market,entry:curPrice,current:curPrice,max:curPrice,trailStop:+(curPrice*(1-trailSettings.initialStopPct/100)).toFixed(isKRSel?0:2),trailMode:false,target:consTgt,pnl:0,date:new Date().toLocaleDateString("ko-KR"),entryTime:new Date().toLocaleTimeString("ko-KR"),foundScore:entryScore.score,foundGrade:entryScore.grade,foundSignals:entryScore.breakdown.filter(b=>b.ok).map(b=>b.label),snapshot:snap,oppScoreAt:oppScore,investMode:stockMode,pyramid:sPyr2.map((r,i)=>({step:i+1,label:r.label,pct:r.pct,targetPct:r.targetPct,triggered:i===0,amount:Math.round(sCap2*r.pct/100),actualAmount:i===0?realAmt:0,executedAt:i===0?new Date().toLocaleDateString("ko-KR"):""}))}]);
            setTab("track");setTrackTab("hold");setAddMsg(`📌 ${selInfo.label} 보초 ₩${fmtKRW(realAmt)} 매수 (${sMode2?"⭐특별":"기본"})`);setTimeout(()=>setAddMsg(""),3000);
          }} style={{width:"100%",background:checkOk?"linear-gradient(135deg,#30D158,#28a745)":"rgba(255,255,255,.05)",border:`1px solid ${checkOk?C.emerald:C.border}`,borderRadius:10,padding:"14px 16px",color:checkOk?"#000":C.muted,fontWeight:900,fontSize:12,cursor:checkOk?"pointer":"not-allowed",opacity:checkOk?1:0.5}}>
            {checkOk?`📈 보초 매수 등록 (${stockMode==="special"?"⭐특별":"기본"} ₩${fmtKRW(stockMode==="special"?(riskSettings.specialCapital||10000000):(riskSettings.totalCapital||5000000))})`:"✅ 체크리스트를 먼저 완료하세요"}
          </button>
        </div>}
        {tab==="sniper"&&!selInfo&&<div style={{padding:"40px 20px",textAlign:"center",color:C.muted}}><div style={{fontSize:24,marginBottom:8}}>🎯</div><div>발굴탭에서 종목을 선택하거나 검색해주세요</div></div>}

        {/* ══ TAB 4: 추적 (통합) ══ */}
        {tab==="track"&&<div style={{padding:"12px 14px"}}>
          <div style={{fontSize:12,fontWeight:900,color:C.accent,marginBottom:10}}>📊 추적 탭</div>

          {/* 4 서브탭 */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:4,marginBottom:14}}>
            {[["watch",`👁 관찰중 (${tracking.length})`],["hold",`💼 보유중 (${positions.length})`],["closed",`✅ 청산 (${closedLog.length})`],["stats","📈 성적분석"],["journal","📝 일지"]].map(([k,l])=>(
              <button key={k} onClick={()=>setTrackTab(k)} style={{padding:"8px 4px",borderRadius:7,border:`1px solid ${trackTab===k?C.accent:C.border}`,background:trackTab===k?"rgba(10,132,255,.12)":"rgba(255,255,255,.03)",color:trackTab===k?C.accent:C.muted,fontWeight:trackTab===k?700:400,fontSize:9,cursor:"pointer"}}>{l}</button>
            ))}
          </div>

          {/* 관찰중 */}
          {trackTab==="watch"&&<div>
            {tracking.length===0
              ?<div style={{textAlign:"center",padding:"40px 0",color:C.muted}}><div style={{fontSize:28,marginBottom:8}}>👁</div><div>발굴탭에서 "추적시작" 버튼을 누르면 여기에 추가됩니다</div></div>
              :<div style={{display:"flex",flexDirection:"column",gap:10}}>
                {tracking.map((t,i)=>{
                  const info=stocks.find(s=>s.ticker===t.ticker) || (pool[t.ticker] ? {ticker:t.ticker, ...pool[t.ticker]} : null);
                  const cur=info?.price||t.basePrice;
                  const chg=+((cur-t.basePrice)/t.basePrice*100).toFixed(2);
                  const rs=(info?.chg5d||0)-idxRS.spy.chg5d;
                  const isKR=(t.ticker?.length||0)>5;
                  return<div key={t.id||i} style={{...css.card}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div>
                        <div style={{fontWeight:900,fontSize:13}}>{fmtName(t,8)}</div>
                        <div style={{fontSize:7,color:C.sub}}>{/^\d{6}$/.test(t.ticker)?t.ticker:t.label?.slice(0,12)}</div>
                        <div style={{fontSize:8,color:C.muted}}>관찰 시작: {t.addedDate} · 기준가 {isKR?"₩":"$"}{isKR?fmtKRW(t.basePrice):t.basePrice.toLocaleString()}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:20,fontWeight:900,color:chg>=0?C.green:C.red}}>{chg>=0?"+":""}{chg}%</div>
                        <div style={{fontSize:9,color:C.sub}}>{isKR?"₩":"$"}{isKR?fmtKRW(cur):cur.toLocaleString()}</div>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:8}}>
                      <div style={{background:"rgba(0,0,0,.6)",borderRadius:5,padding:"5px 7px",textAlign:"center"}}>
                        <div style={{fontSize:7,color:C.muted}}>발굴점수</div>
                        <div style={{fontSize:13,fontWeight:700,color:C.accent}}>{t.foundScore||"-"}</div>
                      </div>
                      <div style={{background:"rgba(0,0,0,.6)",borderRadius:5,padding:"5px 7px",textAlign:"center"}}>
                        <div style={{fontSize:7,color:C.muted}}>RS강도</div>
                        <div style={{fontSize:12,fontWeight:700,color:rs>2?C.emerald:rs>0?C.yellow:C.red}}>{rs>=0?"+":""}{rs.toFixed(1)}%p</div>
                      </div>
                      <div style={{background:"rgba(0,0,0,.6)",borderRadius:5,padding:"5px 7px",textAlign:"center"}}>
                        <div style={{fontSize:7,color:C.muted}}>OppScore</div>
                        <div style={{fontSize:12,fontWeight:700,color:oppColor}}>{t.oppScoreAt||oppScore}</div>
                      </div>
                      <div style={{background:"rgba(0,0,0,.6)",borderRadius:5,padding:"5px 7px",textAlign:"center"}}>
                        <div style={{fontSize:7,color:C.muted}}>진입등급</div>
                        <div style={{fontSize:12,fontWeight:700,color:entryGradeColor}}>{calcEntryScore(charts[t.ticker]?.data,vixVal,oppScore,pool[t.ticker]||t).grade}</div>
                      </div>
                    </div>
                    {(t.foundSignals||[]).length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:8}}>
                      {t.foundSignals.map(sig=><span key={sig} style={{fontSize:7,padding:"2px 6px",borderRadius:3,background:"rgba(56,189,248,.12)",color:C.accent}}>{sig}</span>)}
                    </div>}
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={()=>navigateToStock(t.ticker,t)} style={{flex:1,background:"rgba(56,189,248,.1)",border:`1px solid ${C.accent}`,color:C.accent,borderRadius:6,padding:"6px 0",cursor:"pointer",fontSize:9,fontWeight:700}}>📈 차트 보기</button>
                      <button onClick={()=>{
                        const cdc=charts[t.ticker]?.data;const lD=cdc?.at(-1);const pInfo=pool[t.ticker]||{};
                        const snap={
                          stCount:[lD?.st1Bull,lD?.st2Bull,lD?.st3Bull].filter(v=>v!=null).length,
                          cloud:lD?.aboveCloud?"above":lD?.nearCloud?"near":"below",
                          macdCross:lD?.macd>lD?.signal,macdHist:lD?.hist>0,
                          rsi:lD?.rsi?+lD.rsi.toFixed(0):null,
                          rsRank:pInfo.rsRank||null,rsPctRank:pInfo.rsPctRank||null,
                          volRatio:info?.volRatio||null,w52Breakout:pInfo.w52Breakout||false,
                          vix:+vixVal.toFixed(1),oppScore,
                          entryGrade:calcEntryScore(cdc,vixVal,oppScore,pInfo).grade,
                          entryPts:calcEntryScore(cdc,vixVal,oppScore,pInfo).score,
                          conditions:(t.foundSignals||[]),
                        };
                        setPositions(p=>[...p,{id:Date.now(),ticker:t.ticker,label:t.label,market:t.market,entry:cur,current:cur,max:cur,trailStop:+(cur*(1-trailSettings.initialStopPct/100)).toFixed(isKR?0:2),trailMode:false,target:0,pnl:0,date:new Date().toLocaleDateString("ko-KR"),entryTime:new Date().toLocaleTimeString("ko-KR"),foundScore:t.foundScore,foundSignals:t.foundSignals,foundRS:t.foundRS,snapshot:snap,oppScoreAt:t.oppScoreAt,investMode:"basic",pyramid:PYRAMID_BASIC.map((r,idx)=>({step:idx+1,label:r.label,pct:r.pct,targetPct:r.targetPct,triggered:idx===0,amount:Math.round((riskSettings.totalCapital||5000000)*r.pct/100)}))}]);
                        setTracking(p=>p.filter((_,j)=>j!==i));
                        setTrackTab("hold");
                      }} style={{flex:1,background:"rgba(48,209,88,.1)",border:`1px solid ${C.emerald}`,color:C.emerald,borderRadius:6,padding:"6px 0",cursor:"pointer",fontSize:9,fontWeight:700}}>💼 매수 전환</button>
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
              <span style={{fontSize:8,color:"#FF9F0A"}}>│ ⏰ 타임컷 {trailSettings.timeCutDays||14}일/±{trailSettings.timeCutPct||3}%</span>
              <button onClick={()=>setShowRiskPanel(true)} style={{...css.btn(),fontSize:7,padding:"1px 6px",marginLeft:"auto"}}>변경</button>
            </div>
            {overPositions&&<div style={{background:"rgba(255,69,58,.08)",border:`1px solid rgba(255,69,58,.3)`,borderRadius:7,padding:"6px 10px",marginBottom:10,fontSize:9,color:C.red,fontWeight:700}}>⚠ 최대 종목수 초과 ({positions.length}/{riskSettings.maxPositions}) — 일부 포지션 청산 고려</div>}
            {positions.length===0
              ?<div style={{textAlign:"center",padding:"40px 0",color:C.muted}}><div style={{fontSize:28,marginBottom:8}}>💼</div><div>차트에서 "매수 등록" 또는 관찰중에서 "매수 전환"</div></div>
              :<div style={{display:"flex",flexDirection:"column",gap:12}}>
                {positions.map(pos=>{
                  const cur=pos.current,pnl=pos.pnl||0,trailStop=pos.trailStop;
                  const stopDist=trailStop>0?+((cur-trailStop)/cur*100).toFixed(1):10;
                  const near=stopDist<1.5;
                  const prog=pos.target>pos.entry?Math.max(0,Math.min(100,(cur-pos.entry)/(pos.target-pos.entry)*100)):0;
                  const u=pos.ticker.length>5?"₩":"$";
                  const rs=((stocks.find(s=>s.ticker===pos.ticker)||pool[pos.ticker])?.chg5d||0)-idxRS.spy.chg5d;
                  // ★ 7번: 거래량 급감 경고
                  const posStk=stocks.find(s=>s.ticker===pos.ticker)||pool[pos.ticker]||{};
                  const posVolRatio=posStk._volRatio||posStk.volRatio||100;
                  const volDrop=posVolRatio<50;
                  // 불타기 알림
                  const pendingPyramid=(pos.pyramid||[]).filter(lv=>lv.triggered&&!lv.notified);
                  // ★ v2.2: 타임컷 판정
                  const tc=pos.timeCutInfo||{};
                  const isTimeCut=tc.isTimeCut;
                  // ★ v2.2: BUY/HOLD/SELL 판정
                  const posLd=charts[pos.ticker]?.data?.at(-1);
                  const posStCount=[posLd?.st1Bull,posLd?.st2Bull,posLd?.st3Bull].filter(v=>v!=null).length;
                  const nextPyramid=(pos.pyramid||[]).find(lv=>!lv.triggered);
                  const holdSignal=near?"SELL":isTimeCut?"SELL":posStCount===0&&posLd?"SELL":pnl<-7?"SELL":volDrop&&pnl<0?"SELL"
                    :nextPyramid&&pnl>=nextPyramid.targetPct?"ADD":posStCount===3&&pnl>0&&rs>0?"ADD"
                    :"HOLD";
                  const holdColor=holdSignal==="SELL"?C.red:holdSignal==="ADD"?C.emerald:C.yellow;
                  const holdEmoji=holdSignal==="SELL"?"🔴":holdSignal==="ADD"?"🟢":"🟡";
                  const holdLabel=holdSignal==="SELL"?"매도검토":holdSignal==="ADD"?"추가매수":"홀드";
                  return<div key={pos.id} style={{...css.card,border:`2px solid ${near?"rgba(255,69,58,.8)":isTimeCut?"rgba(255,159,10,.7)":volDrop?"rgba(250,204,21,.6)":pos.trailMode?"rgba(250,204,21,.5)":C.border}`,animation:near?"ap 2s infinite":""}}>
                    {/* 매매 신호 배너 */}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,padding:"5px 10px",borderRadius:6,background:`${holdColor}10`,border:`1px solid ${holdColor}30`}}>
                      <span style={{fontSize:10,fontWeight:900,color:holdColor}}>{holdEmoji} {holdLabel}</span>
                      <span style={{fontSize:8,color:C.muted}}>{posLd?`ST${posStCount}/3`:"—"} · 수익 {pnl>=0?"+":""}{pnl.toFixed(1)}% · {nextPyramid?`다음 불타기 +${nextPyramid.targetPct}%`:"불타기 완료"}</span>
                    </div>
                    {near&&<div style={{background:"rgba(255,69,58,.15)",borderRadius:5,padding:"4px 8px",fontSize:8,color:C.red,fontWeight:700,marginBottom:8}}>🚨 손절선 근접 ({stopDist.toFixed(1)}%) — 즉시 확인!</div>}
                    {isTimeCut&&!near&&<div style={{background:"rgba(255,159,10,.12)",border:"1px solid rgba(255,159,10,.4)",borderRadius:5,padding:"6px 10px",fontSize:8,color:"#FF9F0A",fontWeight:700,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span>⏰ 타임컷 경고 — {tc.daysHeld}일 보유, 손익 ±{tc.absPnl?.toFixed(1)}% (박스권 {trailSettings.timeCutDays}일/{trailSettings.timeCutPct}% 기준)</span>
                      <button onClick={()=>{
                        if(window.confirm(`${pos.label}: ${tc.daysHeld}일간 ±${tc.absPnl?.toFixed(1)}% 정체. 타임컷 청산하시겠습니까?`)){
                          setClosedLog(h=>[{...pos,exitPrice:cur,exitDate:new Date().toLocaleDateString("ko-KR"),finalPnl:pnl,reason:"타임컷",phase:"hold",holdDays:pos.timeCutInfo?.daysHeld||0},...h]);
                          setPositions(p=>p.filter(x=>x.id!==pos.id));
                        }
                      }} style={{background:"rgba(255,159,10,.2)",border:"1px solid #FF9F0A",color:"#FF9F0A",borderRadius:4,padding:"2px 8px",cursor:"pointer",fontSize:8,fontWeight:700,flexShrink:0}}>⏰ 타임컷 청산</button>
                    </div>}
                    {volDrop&&!near&&!isTimeCut&&<div style={{background:"rgba(250,204,21,.1)",borderRadius:5,padding:"4px 8px",fontSize:8,color:C.yellow,fontWeight:700,marginBottom:8}}>⚠️ 거래량 급감 ({posVolRatio}% / 20일평균) — 모멘텀 약화 주의</div>}
                    {/* 불타기 알림 */}
                    {pendingPyramid.map(lv=>(
                      <div key={lv.level} style={{background:"rgba(48,209,88,.12)",border:`1px solid ${C.emerald}`,borderRadius:5,padding:"4px 8px",fontSize:8,color:C.emerald,fontWeight:700,marginBottom:6}}>
                        🔥 불타기 {lv.level}차 목표 +{lv.targetPct}% 달성! ({lv.triggeredAt}) — 추가 매수 고려
                      </div>
                    ))}

                    {/* ★ v2.3: 상태 대시보드 — 타임컷·손절·목표 시각화 */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:10}}>
                      {/* 타임컷 타이머 */}
                      <div style={{background:"rgba(0,0,0,.5)",borderRadius:8,padding:"8px",textAlign:"center"}}>
                        <div style={{fontSize:7,color:isTimeCut?"#FF9F0A":C.muted,fontWeight:700}}>⏰ 타임컷</div>
                        <div style={{fontSize:16,fontWeight:900,color:isTimeCut?"#FF9F0A":(tc.daysHeld||0)>=((trailSettings.timeCutDays||14)-3)?C.yellow:C.text}}>{tc.daysHeld||0}<span style={{fontSize:9,color:C.muted}}>/{trailSettings.timeCutDays||14}일</span></div>
                        <div style={{height:4,background:"rgba(255,255,255,.1)",borderRadius:2,marginTop:4,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${Math.min(100,((tc.daysHeld||0)/(trailSettings.timeCutDays||14))*100)}%`,background:isTimeCut?"#FF9F0A":(tc.daysHeld||0)>=((trailSettings.timeCutDays||14)-3)?C.yellow:"rgba(255,255,255,.2)",borderRadius:2,transition:"width .5s"}}/>
                        </div>
                        {isTimeCut&&<div style={{fontSize:7,color:"#FF9F0A",marginTop:2,fontWeight:700}}>⚠ 초과</div>}
                      </div>
                      {/* 손절 거리 */}
                      <div style={{background:near?"rgba(255,69,58,.12)":"rgba(0,0,0,.5)",borderRadius:8,padding:"8px",textAlign:"center",border:near?`1px solid ${C.red}`:"none"}}>
                        <div style={{fontSize:7,color:near?C.red:C.muted,fontWeight:700}}>🛡 손절선</div>
                        <div style={{fontSize:16,fontWeight:900,color:near?C.red:stopDist<5?C.yellow:C.emerald}}>{stopDist}%</div>
                        <div style={{height:4,background:"rgba(255,255,255,.1)",borderRadius:2,marginTop:4,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${Math.max(5,Math.min(100,stopDist*10))}%`,background:near?C.red:stopDist<5?C.yellow:C.emerald,borderRadius:2}}/>
                        </div>
                        <div style={{fontSize:7,color:C.muted,marginTop:2}}>{pos.trailMode?"트레일링":"초기 고정"} {u}{u==="₩"?fmtKRW(trailStop):trailStop?.toFixed(2)}</div>
                      </div>
                      {/* 목표 진행률 */}
                      <div style={{background:"rgba(0,0,0,.5)",borderRadius:8,padding:"8px",textAlign:"center"}}>
                        <div style={{fontSize:7,color:C.muted,fontWeight:700}}>🎯 목표</div>
                        <div style={{fontSize:16,fontWeight:900,color:prog>=100?C.emerald:prog>=50?C.accent:C.text}}>{prog>0?`${Math.round(prog)}%`:"—"}</div>
                        {pos.target>0&&<>
                          <div style={{height:4,background:"rgba(255,255,255,.1)",borderRadius:2,marginTop:4,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${Math.min(100,prog)}%`,background:prog>=100?C.emerald:C.accent,borderRadius:2,transition:"width .5s"}}/>
                          </div>
                          <div style={{fontSize:7,color:C.muted,marginTop:2}}>{u}{u==="₩"?fmtKRW(pos.target):pos.target?.toFixed(2)}</div>
                        </>}
                      </div>
                    </div>

                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                      <div>
                        <div style={{fontWeight:900,fontSize:12}}>{fmtName(pos,8)}</div>
                        <div style={{fontSize:9,color:C.muted}}>진입 {u}{u==="₩"?fmtKRW(pos.entry):pos.entry.toLocaleString()} · {pos.date} <span style={{color:(pos.timeCutInfo?.daysHeld||0)>=(trailSettings.timeCutDays||14)?"#FF9F0A":C.muted}}>({pos.timeCutInfo?.daysHeld||0}일째)</span></div>
                        <div style={{display:"flex",gap:5,marginTop:3}}>
                          {pos.foundGrade&&(()=>{const gc={S:C.emerald,A:C.green,B:C.yellow,C:"#FF9F0A",D:C.red}[pos.foundGrade]||C.muted;return<span style={{fontSize:7,background:`${gc}18`,color:gc,border:`1px solid ${gc}`,borderRadius:3,padding:"1px 4px"}}>진입 {pos.foundGrade}등급</span>;})()}
                          {pos.trailMode&&<span style={{fontSize:7,background:"rgba(250,204,21,.12)",color:C.yellow,border:`1px solid rgba(250,204,21,.3)`,borderRadius:3,padding:"1px 4px"}}>🔄 트레일링</span>}
                          <span style={{fontSize:7,background:`${holdColor}15`,color:holdColor,border:`1px solid ${holdColor}`,borderRadius:3,padding:"1px 4px",fontWeight:700}}>{holdEmoji} {holdLabel}</span>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:22,fontWeight:900,color:pnl>=0?C.green:C.red}}>{pnl>=0?"+":""}{pnl.toFixed?.(2)||0}%</div>
                          <div style={{fontSize:9,color:C.sub}}>{u}{u==="₩"?fmtKRW(cur):cur.toLocaleString()}</div>
                          <div style={{fontSize:8,color:rs>=0?C.emerald:C.red}}>RS {rs>=0?"+":""}{rs.toFixed(1)}%p</div>
                        </div>
                        <button onClick={()=>{
                          if(window.confirm(`${pos.label} 포지션을 청산하시겠어요?`)){
                            setClosedLog(h=>[{...pos,exitPrice:cur,exitDate:new Date().toLocaleDateString("ko-KR"),finalPnl:pnl,reason:"수동청산",phase:"hold",holdDays:pos.timeCutInfo?.daysHeld||0},...h]);
                            setPositions(p=>p.filter(x=>x.id!==pos.id));
                          }
                        }} style={{background:"rgba(255,69,58,.1)",border:"1px solid rgba(255,69,58,.3)",color:C.red,borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:9,fontWeight:700,flexShrink:0}}>청산 ✕</button>
                      </div>
                    </div>

                    {/* 12번: 불타기 단계 */}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                      <div style={{fontSize:9,color:C.muted,fontWeight:700}}>🔥 불타기 계획</div>
                      <div style={{display:"flex",gap:3}}>
                        {[["basic","기본"],["special","⭐특별"]].map(([k,l])=>(
                          <button key={k} onClick={()=>setPositions(p=>p.map(x=>x.id===pos.id?{...x,investMode:k,pyramid:(k==="special"?PYRAMID_SPECIAL:PYRAMID_BASIC).map((r,j)=>({step:j+1,label:r.label,pct:r.pct,targetPct:r.targetPct,triggered:j===0||(x.pyramid?.[j]?.triggered||false),amount:Math.round((k==="special"?(riskSettings.specialCapital||10000000):(riskSettings.totalCapital||5000000))*r.pct/100)}))}:x))} style={{padding:"2px 6px",borderRadius:4,fontSize:7,fontWeight:(pos.investMode||"basic")===k?700:400,border:`1px solid ${(pos.investMode||"basic")===k?C.accent:C.border}`,background:(pos.investMode||"basic")===k?"rgba(10,132,255,.15)":"transparent",color:(pos.investMode||"basic")===k?C.accent:C.muted,cursor:"pointer"}}>{l}</button>
                        ))}
                      </div>
                    </div>
                    {(()=>{
                      const posMode=pos.investMode||"basic";
                      const posPyr=posMode==="special"?PYRAMID_SPECIAL:PYRAMID_BASIC;
                      const posCap=posMode==="special"?(riskSettings.specialCapital||10000000):(riskSettings.totalCapital||5000000);
                      const posAmts=posPyr.map(r=>Math.round(posCap*r.pct/100));
                      return <div style={{display:"grid",gridTemplateColumns:`repeat(${posPyr.length},1fr)`,gap:4,marginBottom:10}}>
                        {posPyr.map((r,i)=>{
                          const step=pos.pyramid?.[i]||{};
                          const triggered=step.triggered||false;
                          const targetPx=i===0?pos.entry:+(pos.entry*(1+r.targetPct/100)).toFixed(pos.ticker.length>5?0:2);
                          const actualAmt=step.actualAmount||0;
                          return<div key={i} style={{borderRadius:7,padding:"6px 4px",border:`1px solid ${triggered?"rgba(48,209,88,.4)":"rgba(255,255,255,.08)"}`,background:triggered?"rgba(48,209,88,.06)":C.panel2,textAlign:"center"}}>
                            <div style={{fontSize:7,color:triggered?C.green:C.muted,fontWeight:700,marginBottom:2}}>{triggered?"✅":"⏳"} {r.label}</div>
                            <div style={{fontSize:9,fontWeight:700,color:triggered?C.green:C.sub}}>{i===0?"진입가":`평단+${r.targetPct}%`}</div>
                            <div style={{fontSize:7,color:C.muted}}>{u}{u==="₩"?fmtKRW(targetPx):targetPx.toLocaleString()}</div>
                            <div style={{fontSize:8,color:C.accent,fontWeight:700}}>₩{fmtKRW(posAmts[i])}</div>
                            {triggered&&actualAmt>0&&<div style={{fontSize:7,color:C.emerald,marginTop:2}}>실투 ₩{fmtKRW(actualAmt)}</div>}
                            {!triggered&&i>0&&<button onClick={()=>{
                              const amt=prompt(`${r.label} 실제 투입 금액 (만원 단위, 예: 200):`);
                              if(amt){
                                const realAmt=parseInt(amt)*10000;
                                setPositions(p=>p.map(x=>{
                                  if(x.id!==pos.id)return x;
                                  const newPyr=[...(x.pyramid||[])];
                                  if(newPyr[i])newPyr[i]={...newPyr[i],triggered:true,actualAmount:realAmt,executedAt:new Date().toLocaleDateString("ko-KR")};
                                  return{...x,pyramid:newPyr};
                                }));
                              }
                            }} style={{marginTop:3,fontSize:7,padding:"2px 6px",borderRadius:3,border:`1px solid ${C.accent}`,background:"rgba(10,132,255,.1)",color:C.accent,cursor:"pointer",fontWeight:700}}>실행</button>}
                          </div>;
                        })}
                      </div>;
                    })()}

                    {/* 12번: 손절 기준 (명확화) */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
                      <div style={{background:"rgba(255,69,58,.07)",border:"1px solid rgba(255,69,58,.25)",borderRadius:7,padding:"7px 10px"}}>
                        <div style={{fontSize:8,color:C.red,fontWeight:700}}>🛑 초기 손절 (-{trailSettings.initialStopPct}%)</div>
                        <div style={{fontSize:7,color:C.muted,marginBottom:3}}>매수가 기준 · +{trailSettings.switchPct}% 전까지</div>
                        <div style={{fontSize:16,fontWeight:900,color:C.red}}>{u}{u==="₩"?fmtKRW(pos.entry*(1-trailSettings.initialStopPct/100)):(pos.entry*(1-trailSettings.initialStopPct/100)).toFixed(2)}</div>
                      </div>
                      <div style={{background:pos.trailMode?"rgba(250,204,21,.1)":"rgba(255,255,255,.03)",border:`1px solid ${pos.trailMode?"rgba(250,204,21,.4)":"rgba(255,255,255,.1)"}`,borderRadius:7,padding:"7px 10px"}}>
                        <div style={{fontSize:8,color:C.yellow,fontWeight:700}}>🔄 트레일링 (고점-{trailSettings.trailPct}%)</div>
                        <div style={{fontSize:7,color:C.muted,marginBottom:3}}>고점 {u}{pos.max?.toLocaleString()} {pos.trailMode?"·활성":"· 비활성"}</div>
                        <div style={{fontSize:16,fontWeight:900,color:pos.trailMode?C.yellow:C.muted}}>{u}{u==="₩"?fmtKRW(trailStop):trailStop.toLocaleString()}</div>
                      </div>
                    </div>

                    {/* 진행 바 */}
                    {pos.target>pos.entry&&<>
                      <div style={{height:5,background:"rgba(255,255,255,.07)",borderRadius:3,overflow:"hidden",marginBottom:3}}>
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
            {/* ★ v2.2: CSV 내보내기 + 초기화 */}
            {closedLog.length>0&&<div style={{display:"flex",gap:6,marginBottom:10}}>
              <button onClick={()=>exportCSV(closedLog)} style={{...css.btn(),fontSize:9,borderColor:C.emerald,color:C.emerald}}>📥 CSV 내보내기</button>
              <button onClick={()=>{if(window.confirm("모든 청산 기록을 삭제하시겠습니까?"))setClosedLog([]);}} style={{...css.btn(),fontSize:9,borderColor:C.red,color:C.red}}>🗑 초기화</button>
            </div>}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
              {[{l:"총 거래",v:closedLog.length},{l:"승률",v:closedLog.length?`${((closedLog.filter(h=>parseFloat(h.pnl||h.finalPnl)>0).length/closedLog.length)*100).toFixed(0)}%`:"—"},{l:"평균 손익",v:closedLog.length?`${(closedLog.reduce((a,h)=>a+parseFloat(h.pnl||h.finalPnl||0),0)/closedLog.length).toFixed(1)}%`:"—"},{l:"누적 손익",v:closedLog.length?`${closedLog.reduce((a,h)=>a+parseFloat(h.pnl||h.finalPnl||0),0).toFixed(1)}%`:"—"}].map(({l,v})=>(
                <div key={l} style={{...css.panel2,textAlign:"center"}}><div style={{fontSize:8,color:C.muted}}>{l}</div><div style={{fontSize:18,fontWeight:900}}>{v}</div></div>
              ))}
            </div>
            {closedLog.length===0
              ?<div style={{textAlign:"center",padding:"30px 0",color:C.muted}}>청산 기록 없음</div>
              :<div style={{...css.card,padding:0,overflow:"hidden"}}>
                <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 0.7fr 0.8fr",padding:"6px 10px",background:"rgba(255,255,255,.03)",fontSize:8,color:C.muted,fontWeight:700}}>
                  <span>종목</span><span>매수가</span><span>청산가</span><span>손익</span><span>보유</span><span>이유</span>
                </div>
                {closedLog.map((h,i)=>{
                  const pnl=parseFloat(h.pnl||h.finalPnl||0);
                  const isKR=(h.ticker?.length||0)>5;
                  const u=isKR?"₩":"$";
                  const entry=h.entry||h.basePrice||0;
                  const exit=h.exitPrice||h.current||0;
                  return<div key={i} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 0.7fr 0.8fr",padding:"8px 10px",borderTop:"1px solid rgba(255,255,255,.04)",fontSize:9,background:pnl>=0?"rgba(34,197,94,.03)":"rgba(255,69,58,.03)"}}>
                    <div><div style={{fontWeight:700}}>{fmtName(h,8)}</div><div style={{fontSize:7,color:C.muted}}>{h.addedDate||h.date} → {h.exitDate}</div></div>
                    <span>{u}{isKR?fmtKRW(entry):entry.toLocaleString()}</span>
                    <span>{u}{isKR?fmtKRW(exit):exit.toLocaleString()}</span>
                    <span style={{color:pnl>=0?C.green:C.red,fontWeight:700}}>{pnl>=0?"+":""}{pnl.toFixed(2)}%</span>
                    <span style={{color:C.muted,fontSize:8}}>{h.holdDays?`${h.holdDays}일`:"—"}</span>
                    <span style={{color:h.reason==="타임컷"?"#FF9F0A":C.muted,fontSize:8}}>{h.reason||"수동"}</span>
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
              {/* ★ v2.2: 에쿼티 커브 */}
              {equityCurveData.length>1&&<div style={css.card}>
                <div style={{fontSize:10,fontWeight:700,color:C.emerald,marginBottom:8}}>📈 에쿼티 커브 (누적 수익률)</div>
                <ResponsiveContainer width="100%" height={150}>
                  <ComposedChart data={equityCurveData} margin={{left:0,right:6}}>
                    <CartesianGrid stroke="rgba(255,255,255,.06)"/>
                    <XAxis dataKey="idx" tick={{fill:C.muted,fontSize:7}} tickLine={false}/>
                    <YAxis tick={{fill:C.muted,fontSize:7}} tickLine={false} width={45} tickFormatter={v=>`${v>=0?"+":""}${v}%`}/>
                    <Tooltip content={({active,payload})=>{
                      if(!active||!payload?.length)return null;
                      const d2=payload[0]?.payload;
                      return<div style={{background:"#0a0f1e",border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",fontSize:10}}>
                        <div style={{color:C.sub,fontWeight:700}}>#{d2.idx} {d2.label}</div>
                        <div style={{color:d2.cumPnl>=0?C.green:C.red,fontWeight:900}}>누적: {d2.cumPnl>=0?"+":""}{d2.cumPnl}%</div>
                        <div style={{color:C.muted}}>자산: ₩{fmtKRW(d2.equity)}</div>
                      </div>;
                    }}/>
                    <ReferenceLine y={0} stroke="rgba(255,255,255,.2)"/>
                    <Area type="monotone" dataKey="cumPnl" stroke={C.emerald} fill="rgba(48,209,88,.1)" strokeWidth={2} dot={false}/>
                    <Line type="monotone" dataKey="cumPnl" stroke={C.emerald} strokeWidth={2} dot={{fill:C.emerald,r:2}}/>
                  </ComposedChart>
                </ResponsiveContainer>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:C.muted,marginTop:4}}>
                  <span>초기: ₩{fmtKRW(riskSettings.totalCapital)}</span>
                  <span style={{color:(equityCurveData.at(-1)?.cumPnl||0)>=0?C.green:C.red,fontWeight:700}}>현재: ₩{fmtKRW(equityCurveData.at(-1)?.equity||riskSettings.totalCapital)} ({(equityCurveData.at(-1)?.cumPnl||0)>=0?"+":""}{equityCurveData.at(-1)?.cumPnl||0}%)</span>
                </div>
              </div>}
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

              {/* 조합별 성과 분석 (스냅샷 기반) */}
              <div style={css.card}>
                <div style={{fontSize:10,fontWeight:700,color:C.purple,marginBottom:8}}>🧬 조건 조합별 성과</div>
                <div style={{fontSize:8,color:C.muted,marginBottom:8}}>매수 시 스냅샷을 기반으로 어떤 조건 조합이 수익을 냈는지 분석합니다</div>
                {(()=>{
                  // 스냅샷이 있는 거래만 분석
                  const withSnap = closedLog.filter(h=>h.snapshot);
                  if(withSnap.length < 3) return <div style={{fontSize:9,color:C.muted,padding:"10px 0",textAlign:"center"}}>스냅샷 데이터 {withSnap.length}건 — 3건 이상 필요</div>;

                  // 주요 조건 추출
                  const combos = {};
                  withSnap.forEach(h=>{
                    const s = h.snapshot;
                    const pnl = parseFloat(h.pnl||h.finalPnl||0);
                    // 핵심 조건 키 생성
                    const keys = [];
                    if(s.stCount===3) keys.push("ST3/3");
                    else if(s.stCount>=2) keys.push("ST2+");
                    if(s.cloud==="above") keys.push("구름위");
                    if(s.macdCross) keys.push("MACD↑");
                    if(s.rsPctRank>=80) keys.push("RS상위20%");
                    if(s.w52Breakout) keys.push("신고가");
                    if(s.rsi>=60) keys.push("RSI강세");

                    // 개별 + 2개 조합 + 전체 조합
                    keys.forEach(k=>{
                      if(!combos[k]) combos[k]={count:0,wins:0,totalPnl:0,type:"단일"};
                      combos[k].count++; if(pnl>0) combos[k].wins++; combos[k].totalPnl+=pnl;
                    });
                    // 2개 조합
                    for(let i=0;i<keys.length;i++){
                      for(let j=i+1;j<keys.length;j++){
                        const combo=`${keys[i]}+${keys[j]}`;
                        if(!combos[combo]) combos[combo]={count:0,wins:0,totalPnl:0,type:"조합"};
                        combos[combo].count++; if(pnl>0) combos[combo].wins++; combos[combo].totalPnl+=pnl;
                      }
                    }
                    // 전체 조합 (3개+)
                    if(keys.length>=3){
                      const full=keys.join("+");
                      if(!combos[full]) combos[full]={count:0,wins:0,totalPnl:0,type:"풀조합"};
                      combos[full].count++; if(pnl>0) combos[full].wins++; combos[full].totalPnl+=pnl;
                    }
                  });

                  return Object.entries(combos)
                    .filter(([,d])=>d.count>=2)
                    .sort((a,b)=>{
                      const wrA=a[1].wins/a[1].count, wrB=b[1].wins/b[1].count;
                      return wrB-wrA || b[1].count-a[1].count;
                    })
                    .slice(0,12)
                    .map(([combo,d])=>{
                      const wr=+(d.wins/d.count*100).toFixed(0);
                      const avg=+(d.totalPnl/d.count).toFixed(1);
                      return<div key={combo} style={{display:"flex",alignItems:"center",gap:4,padding:"5px 0",borderBottom:`1px solid rgba(255,255,255,.05)`}}>
                        <span style={{fontSize:7,color:d.type==="풀조합"?C.purple:d.type==="조합"?C.accent:C.muted,background:d.type==="풀조합"?"rgba(191,90,242,.1)":"transparent",borderRadius:3,padding:"1px 4px",flexShrink:0}}>{d.type}</span>
                        <span style={{fontSize:9,color:C.text,flex:1,fontWeight:d.type==="풀조합"?700:400}}>{combo}</span>
                        <span style={{fontSize:8,color:C.muted}}>{d.count}건</span>
                        <span style={{fontSize:9,fontWeight:700,color:wr>=60?C.green:wr>=40?C.yellow:C.red}}>{wr}%</span>
                        <span style={{fontSize:9,fontWeight:700,color:avg>=0?C.emerald:C.red,minWidth:38,textAlign:"right"}}>{avg>=0?"+":""}{avg}%</span>
                      </div>;
                    });
                })()}
              </div>
              {/* 손익 분포 차트 */}
              <div style={css.card}>
                <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8}}>📉 손익 분포</div>
                <div style={{display:"flex",gap:2,alignItems:"flex-end",height:60}}>
                  {closedLog.slice(-20).map((h,i)=>{
                    const pnl=parseFloat(h.pnl||h.finalPnl||0);
                    const maxPnl=Math.max(...closedLog.map(x=>Math.abs(parseFloat(x.pnl||x.finalPnl||0))),1);
                    const h2=Math.max(4,Math.abs(pnl)/maxPnl*55);
                    return<div key={i} title={`${h.label}: ${pnl>=0?"+":""}${pnl.toFixed(1)}%`} style={{flex:1,height:h2,background:pnl>=0?"rgba(34,197,94,.7)":"rgba(255,69,58,.7)",borderRadius:"2px 2px 0 0",minWidth:3,cursor:"pointer"}} onClick={()=>{}}/>
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
                <textarea rows="4" value={investNotes} onChange={e=>setInvestNotes(e.target.value)} placeholder={"오늘의 시장 관찰, 매매 반성...\n예) NVDA 구름 돌파 확인, 내일 눌림목 2차 매수 고려"} style={{background:"rgba(255,255,255,.03)",border:`1px solid ${C.border}`,borderRadius:8,padding:10,color:C.text,fontSize:10,resize:"vertical",outline:"none",lineHeight:1.8,width:"100%"}}/>
              </div>
            </>
            :<div style={{textAlign:"center",padding:"50px 0",color:C.muted}}>
              <div style={{fontSize:28,marginBottom:8}}>📊</div>
              <div>청산된 거래가 없습니다.<br/>보유중 탭에서 포지션을 청산하면 분석이 표시됩니다.</div>
            </div>}
          </div>}

          {/* ★ v2.2: 매매 일지 탭 */}
          {trackTab==="journal"&&<div>
            <div style={css.card}>
              <div style={{fontSize:10,fontWeight:700,color:C.purple,marginBottom:10}}>📝 매매 일지 작성</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                <div>
                  <div style={{fontSize:8,color:C.muted,marginBottom:3}}>종목</div>
                  <input value={journalDraft.ticker} onChange={e=>setJournalDraft(p=>({...p,ticker:e.target.value}))} placeholder={sel||"티커"} style={{width:"100%",background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",color:C.text,fontSize:10,outline:"none"}}/>
                </div>
                <div>
                  <div style={{fontSize:8,color:C.muted,marginBottom:3}}>유형</div>
                  <select value={journalDraft.type} onChange={e=>setJournalDraft(p=>({...p,type:e.target.value}))} style={{width:"100%",background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:5,padding:"5px",color:C.text,fontSize:10}}>
                    {["진입","추가매수","일부청산","전량청산","관찰","반성"].map(t2=><option key={t2} value={t2}>{t2}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{fontSize:8,color:C.muted,marginBottom:3}}>감정상태</div>
                  <select value={journalDraft.emotion} onChange={e=>setJournalDraft(p=>({...p,emotion:e.target.value}))} style={{width:"100%",background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:5,padding:"5px",color:C.text,fontSize:10}}>
                    {["차분","자신감","불안","FOMO","욕심","보통"].map(em=><option key={em} value={em}>{em}</option>)}
                  </select>
                </div>
              </div>
              <div style={{marginBottom:8}}>
                <div style={{fontSize:8,color:C.muted,marginBottom:3}}>사유 / 근거</div>
                <input value={journalDraft.reason} onChange={e=>setJournalDraft(p=>({...p,reason:e.target.value}))} placeholder="예: ST3/3 전환 + 거래량 급증, 섹터 RS 상위" style={{width:"100%",background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",color:C.text,fontSize:10,outline:"none"}}/>
              </div>
              <div style={{marginBottom:8}}>
                <div style={{fontSize:8,color:C.muted,marginBottom:3}}>메모</div>
                <textarea rows="2" value={journalDraft.note} onChange={e=>setJournalDraft(p=>({...p,note:e.target.value}))} placeholder="추가 메모..." style={{width:"100%",background:"rgba(255,255,255,.03)",border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",color:C.text,fontSize:10,outline:"none",resize:"vertical"}}/>
              </div>
              <button onClick={addJournalEntry} style={{width:"100%",background:"linear-gradient(135deg,#BF5AF2,#BF5AF2)",border:"none",borderRadius:8,padding:"8px",color:"#fff",fontWeight:700,fontSize:10,cursor:"pointer"}}>✏️ 일지 저장</button>
            </div>
            {tradeJournal.length>0&&<div style={{display:"flex",gap:6,marginBottom:8}}>
              <button onClick={()=>{
                const hd=["날짜","시간","종목","유형","감정","사유","메모","가격","등락%","ST","RSI","구름","등급"];
                const rw=tradeJournal.map(j=>[j.date,j.time,j.ticker,j.type,j.emotion,j.reason,j.note,j.price||"",j.changePct||"",j.stCount!=null?`${j.stCount}/3`:"",j.rsi||"",j.cloud||"",j.entryGrade||""]);
                const csv2=[hd,...rw].map(r=>r.map(v=>`"${(v||"").replace(/"/g,'""')}"`).join(",")).join("\n");
                const blob=new Blob(["\uFEFF"+csv2],{type:"text/csv;charset=utf-8;"});
                const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`alpha_journal_${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);
              }} style={{...css.btn(),fontSize:9,borderColor:C.emerald,color:C.emerald}}>📥 일지 CSV</button>
              <span style={{fontSize:8,color:C.muted,alignSelf:"center"}}>{tradeJournal.length}건 기록</span>
            </div>}
            {tradeJournal.map(j=>{
              const emotionColor=j.emotion==="차분"?C.emerald:j.emotion==="자신감"?C.green:j.emotion==="불안"?C.yellow:j.emotion==="FOMO"?C.red:j.emotion==="욕심"?C.red:C.muted;
              return<div key={j.id} style={{...css.card,padding:"10px 14px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <span style={{fontSize:8,color:C.muted}}>{j.date} {j.time}</span>
                    <span style={{fontSize:9,fontWeight:700,color:C.accent}}>{j.ticker}</span>
                    <span style={{fontSize:8,padding:"1px 6px",borderRadius:4,background:j.type==="진입"?"rgba(48,209,88,.12)":j.type.includes("청산")?"rgba(255,69,58,.12)":"rgba(10,132,255,.08)",color:j.type==="진입"?C.emerald:j.type.includes("청산")?C.red:C.accent}}>{j.type}</span>
                    <span style={{fontSize:8,padding:"1px 6px",borderRadius:4,background:`${emotionColor}18`,color:emotionColor}}>{j.emotion}</span>
                  </div>
                  <button onClick={()=>setTradeJournal(p=>p.filter(x=>x.id!==j.id))} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:10}}>✕</button>
                </div>
                {j.reason&&<div style={{fontSize:9,color:C.text,marginBottom:2}}>📌 {j.reason}</div>}
                {j.price>0&&<div style={{display:"flex",gap:8,fontSize:8,color:C.muted,marginBottom:2}}>
                  <span>₩{fmtKRW(j.price)}</span>
                  {j.changePct!=null&&<span style={{color:(j.changePct||0)>=0?C.green:C.red}}>{(j.changePct||0)>=0?"+":""}{(j.changePct||0).toFixed(1)}%</span>}
                  {j.stCount!=null&&<span>ST{j.stCount}/3</span>}
                  {j.cloud&&<span>{j.cloud}</span>}
                  {j.rsi&&<span>RSI{j.rsi}</span>}
                  {j.entryGrade&&<span style={{color:j.entryGrade==="S"?C.emerald:j.entryGrade==="A"?C.green:C.yellow}}>{j.entryGrade}등급</span>}
                </div>}
                {j.note&&<div style={{fontSize:9,color:C.sub}}>{j.note}</div>}
              </div>;
            })}
            {tradeJournal.length===0&&<div style={{textAlign:"center",padding:"30px",color:C.muted}}><div style={{fontSize:24,marginBottom:8}}>📝</div>매매 일지를 작성하면 패턴 파악에 도움이 됩니다</div>}
          </div>}
        </div>}

        {/* ══ TAB: 실험실 ══ */}
        {tab==="lab"&&<div style={{padding:"12px 14px"}}>
          <div style={{fontSize:12,fontWeight:900,color:C.purple,marginBottom:4}}>🔬 실험실 — 지표 연구소</div>
          <div style={{fontSize:9,color:C.sub,marginBottom:12}}>매수/매도 신호를 차트에 표시 · 클릭하면 그 시점 지표값 전부 · 어떤 신호가 잘 맞는지 성과 분석</div>

          {/* 종목 선택 */}
          <div style={{display:"flex",gap:4,marginBottom:12,flexWrap:"wrap"}}>
            {/* ★ FIX: stocks + pool(차트 보유) 합산 표시 */}
            {(()=>{
              const seen=new Set();
              const labStocks=[];
              stocks.forEach(s=>{if(!seen.has(s.ticker)){seen.add(s.ticker);labStocks.push(s);}});
              Object.entries(pool).forEach(([ticker,info])=>{if(!seen.has(ticker)&&charts[ticker]?.data?.length>10){seen.add(ticker);labStocks.push({ticker,...info});}});
              return labStocks.slice(0,30).map(s=>(
                <button key={s.ticker} onClick={()=>{setLabStock(s.ticker);setLabPoint(null);}} style={{padding:"4px 10px",borderRadius:5,fontSize:9,fontWeight:labStock===s.ticker?700:400,border:`1px solid ${labStock===s.ticker?C.accent:C.border}`,background:labStock===s.ticker?"rgba(10,132,255,.12)":"rgba(255,255,255,.03)",color:labStock===s.ticker?C.accent:!stocks.find(x=>x.ticker===s.ticker)?"#FF9F0A":C.muted,cursor:"pointer"}}>{fmtName(s)}</button>
              ));
            })()}
          </div>

          {labStock&&(()=>{
            const labCd = charts[labStock]?.data;
            if(!labCd||labCd.length<10) return <div style={{textAlign:"center",padding:"30px",color:C.muted}}>데이터 부족</div>;
            const labSliced = labCd.slice(-90);
            const labSel = labPoint!=null ? labSliced[labPoint] : null;
            const labInfo = stocks.find(s=>s.ticker===labStock) || (pool[labStock] ? {ticker:labStock, ...pool[labStock]} : null);
            const isKR3 = (labStock?.length||0)>5;

            // ★ 매수/매도 신호 감지
            const sigMarkers = [];
            for(let i=1;i<labSliced.length;i++){
              const d=labSliced[i], p=labSliced[i-1];
              const stN=[d.st1Bull,d.st2Bull,d.st3Bull].filter(v=>v!=null).length;
              const stP=[p.st1Bull,p.st2Bull,p.st3Bull].filter(v=>v!=null).length;
              // 매수 신호
              if(stN===3&&stP<3) sigMarkers.push({i,date:d.date,type:"ST플립",side:"buy",emoji:"🔥",color:C.emerald});
              if(d.macd>d.signal&&p.macd<=p.signal) sigMarkers.push({i,date:d.date,type:"MACD↑",side:"buy",emoji:"⚡",color:C.accent});
              if(d.aboveCloud&&!p.aboveCloud) sigMarkers.push({i,date:d.date,type:"구름돌파",side:"buy",emoji:"☁️",color:"#64D2FF"});
              if(d.sqzOff&&p.sqzOn) sigMarkers.push({i,date:d.date,type:"스퀴즈해제",side:"buy",emoji:"💎",color:C.purple});
              const vols=labSliced.slice(Math.max(0,i-20),i).map(x=>x.volume||0).filter(v=>v>0);
              const avgV=vols.length?vols.reduce((a,b)=>a+b,0)/vols.length:0;
              if(avgV>0&&d.volume>avgV*2&&d.close>p.close) sigMarkers.push({i,date:d.date,type:"거래량폭발",side:"buy",emoji:"💥",color:C.yellow});
              // 매도 신호
              if(stN<3&&stP===3) sigMarkers.push({i,date:d.date,type:"ST이탈",side:"sell",emoji:"⛔",color:C.red});
              if(d.macd<d.signal&&p.macd>=p.signal) sigMarkers.push({i,date:d.date,type:"MACD↓",side:"sell",emoji:"📉",color:"#FF453A"});
              if(!d.aboveCloud&&p.aboveCloud) sigMarkers.push({i,date:d.date,type:"구름이탈",side:"sell",emoji:"🌧",color:"#FF9F0A"});
              if(d.rsi>78) sigMarkers.push({i,date:d.date,type:"RSI과매수",side:"sell",emoji:"⚠️",color:"#FFD60A"});
            }

            // ★ 신호 성과 분석: 매수 후 5일/10일/20일 수익률
            const sigPerf = {};
            sigMarkers.filter(s=>s.side==="buy").forEach(sig=>{
              if(!sigPerf[sig.type]) sigPerf[sig.type]={count:0,sum5:0,sum10:0,sum20:0,wins:0};
              const entry=labSliced[sig.i]?.close;
              if(!entry)return;
              sigPerf[sig.type].count++;
              const after5=labSliced[Math.min(sig.i+5,labSliced.length-1)]?.close||entry;
              const after10=labSliced[Math.min(sig.i+10,labSliced.length-1)]?.close||entry;
              const after20=labSliced[Math.min(sig.i+20,labSliced.length-1)]?.close||entry;
              sigPerf[sig.type].sum5+=(after5-entry)/entry*100;
              sigPerf[sig.type].sum10+=(after10-entry)/entry*100;
              sigPerf[sig.type].sum20+=(after20-entry)/entry*100;
              if(after10>entry) sigPerf[sig.type].wins++;
            });
            // 매도 신호 성과
            const sellPerf = {};
            sigMarkers.filter(s=>s.side==="sell").forEach(sig=>{
              if(!sellPerf[sig.type]) sellPerf[sig.type]={count:0,sum5:0,wins:0};
              const entry=labSliced[sig.i]?.close;
              if(!entry)return;
              sellPerf[sig.type].count++;
              const after5=labSliced[Math.min(sig.i+5,labSliced.length-1)]?.close||entry;
              sellPerf[sig.type].sum5+=(after5-entry)/entry*100;
              if(after5<entry) sellPerf[sig.type].wins++;
            });

            return <div>
              {/* 신호 범례 */}
              <div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap"}}>
                <span style={{fontSize:8,fontWeight:700,color:C.emerald}}>▲ 매수신호:</span>
                {["🔥ST플립","⚡MACD↑","☁️구름돌파","💎스퀴즈","💥거래량"].map(s=><span key={s} style={{fontSize:7,color:C.muted}}>{s}</span>)}
                <span style={{fontSize:8,fontWeight:700,color:C.red,marginLeft:8}}>▼ 매도신호:</span>
                {["⛔ST이탈","📉MACD↓","🌧구름이탈","⚠️RSI과매수"].map(s=><span key={s} style={{fontSize:7,color:C.muted}}>{s}</span>)}
              </div>

              {/* 차트 + 신호 마커 */}
              <div style={{...css.card,padding:"6px 6px 3px",marginBottom:8}}>
                <div style={{fontSize:9,fontWeight:700,color:C.accent,paddingLeft:6,marginBottom:4}}>📊 {labInfo?.label||labStock} — 신호 + 클릭 분석</div>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={labSliced} margin={{left:0,right:6}} onClick={(e)=>{if(e&&e.activeTooltipIndex!=null)setLabPoint(e.activeTooltipIndex);}}>
                    <XAxis dataKey="date" tick={{fill:C.muted,fontSize:7}} tickLine={false} interval={Math.floor(labSliced.length/6)||1}/>
                    <YAxis tick={{fill:C.muted,fontSize:7}} tickLine={false} domain={["auto","auto"]} width={45} tickFormatter={v=>isKR3?`${(v/1000).toFixed(0)}k`:v.toFixed(0)}/>
                    <Tooltip content={<Tip/>}/>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)"/>
                    {labSel&&<ReferenceLine x={labSel.date} stroke={C.accent} strokeWidth={2} strokeDasharray="4 2"/>}
                    <Area type="monotone" dataKey="close" stroke="rgba(10,132,255,.5)" fill="rgba(56,189,248,.05)" strokeWidth={1.5} dot={false}/>
                    {/* 매수 신호 마커 — 삼각형 위 */}
                    <Scatter data={sigMarkers.filter(s=>s.side==="buy").map(s=>({...labSliced[s.i],_sig:s.emoji+s.type,_color:s.color,_idx:s.i}))} dataKey="close" shape={(props)=>{
                      const {cx,cy,payload}=props;if(!cx||!cy)return null;
                      return<g onClick={()=>setLabPoint(payload._idx)}><polygon points={`${cx},${cy-12} ${cx-5},${cy-4} ${cx+5},${cy-4}`} fill={payload._color} stroke={payload._color} strokeWidth={1}/><text x={cx} y={cy-14} textAnchor="middle" fill={payload._color} fontSize={8}>{payload._sig?.slice(0,2)}</text></g>;
                    }}/>
                    {/* 매도 신호 마커 — 삼각형 아래 */}
                    <Scatter data={sigMarkers.filter(s=>s.side==="sell").map(s=>({...labSliced[s.i],_sig:s.emoji+s.type,_color:s.color,_idx:s.i}))} dataKey="close" shape={(props)=>{
                      const {cx,cy,payload}=props;if(!cx||!cy)return null;
                      return<g onClick={()=>setLabPoint(payload._idx)}><polygon points={`${cx},${cy+12} ${cx-5},${cy+4} ${cx+5},${cy+4}`} fill={payload._color} stroke={payload._color} strokeWidth={1}/><text x={cx} y={cy+22} textAnchor="middle" fill={payload._color} fontSize={8}>{payload._sig?.slice(0,2)}</text></g>;
                    }}/>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* 선택된 시점의 지표 스냅샷 */}
              {labSel?<div style={{...css.card,border:`1px solid ${C.accent}`,marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8}}>📌 {labSel.date} 시점 — 전체 지표</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:8}}>
                  {[
                    {l:"종가",v:isKR3?`₩${fmtKRW(labSel.close)}`:`$${labSel.close?.toFixed(2)}`,c:C.text},
                    {l:"거래량",v:labSel.volume?`${(labSel.volume/1e6).toFixed(1)}M`:"—",c:C.text},
                    {l:"RSI",v:labSel.rsi?.toFixed(0)||"—",c:labSel.rsi>70?C.red:labSel.rsi<30?C.green:C.text},
                    {l:"MACD",v:labSel.macd?.toFixed(2)||"—",c:labSel.macd>labSel.signal?C.green:C.red},
                    {l:"Signal",v:labSel.signal?.toFixed(2)||"—",c:C.muted},
                    {l:"히스토",v:labSel.hist?.toFixed(2)||"—",c:(labSel.hist||0)>=0?C.green:C.red},
                    {l:"ST신호",v:`${[labSel.st1Bull,labSel.st2Bull,labSel.st3Bull].filter(v=>v!=null).length}/3`,c:[labSel.st1Bull,labSel.st2Bull,labSel.st3Bull].filter(v=>v!=null).length===3?C.emerald:C.yellow},
                    {l:"일목구름",v:labSel.aboveCloud?"구름위":labSel.nearCloud?"접근":"아래",c:labSel.aboveCloud?C.emerald:labSel.nearCloud?C.yellow:C.red},
                    {l:"스퀴즈",v:labSel.sqzOn?"🟡압축":labSel.sqzOff?"🔴해제":"⚪없음",c:labSel.sqzOn?C.yellow:labSel.sqzOff?C.red:C.muted},
                    {l:"모멘텀",v:labSel.sqzMom?.toFixed(1)||"—",c:(labSel.sqzMom||0)>=0?C.green:C.red},
                    {l:"ADX",v:labSel.adx?.toFixed(0)||"—",c:(labSel.adx||0)>=25?C.emerald:C.muted},
                    {l:"ATR",v:labSel.atr?.toFixed(2)||"—",c:C.text},
                  ].map((m,i)=>(
                    <div key={i} style={{background:"rgba(0,0,0,.5)",borderRadius:5,padding:"5px",textAlign:"center"}}>
                      <div style={{fontSize:6,color:C.muted}}>{m.l}</div>
                      <div style={{fontSize:11,fontWeight:900,color:m.c}}>{m.v}</div>
                    </div>
                  ))}
                </div>

                {/* 이 시점 신호 */}
                {(()=>{const sigs=sigMarkers.filter(s=>s.i===labPoint);return sigs.length?<div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap"}}>{sigs.map((s,i)=><span key={i} style={{fontSize:8,padding:"2px 8px",borderRadius:4,background:`${s.color}18`,border:`1px solid ${s.color}40`,color:s.color,fontWeight:700}}>{s.emoji} {s.type} ({s.side==="buy"?"매수":"매도"})</span>)}</div>:null;})()}

                {/* 이 시점에 샀다면? */}
                <div style={{background:"rgba(191,90,242,.06)",border:"1px solid rgba(191,90,242,.25)",borderRadius:8,padding:"8px 10px"}}>
                  <div style={{fontSize:9,fontWeight:700,color:C.purple,marginBottom:6}}>🧪 이 시점에 샀다면?</div>
                  {(()=>{
                    const buyPrice = labSel.close;
                    const after = labSliced.slice(labPoint);
                    const latestPrice = after.at(-1)?.close||buyPrice;
                    const pnlPct = ((latestPrice-buyPrice)/buyPrice*100).toFixed(2);
                    const daysHeld = after.length-1;
                    const maxPrice = Math.max(...after.map(d=>d.close||0));
                    const maxPnl = ((maxPrice-buyPrice)/buyPrice*100).toFixed(2);
                    const minPrice = Math.min(...after.map(d=>d.close||0));
                    const maxDD = ((minPrice-buyPrice)/buyPrice*100).toFixed(2);
                    // 최적 매도 시점 찾기
                    let bestSellDay=0,bestSellPnl=0;
                    after.forEach((d,j)=>{const p2=((d.close-buyPrice)/buyPrice*100);if(p2>bestSellPnl){bestSellPnl=p2;bestSellDay=j;}});
                    return <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5}}>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:6,color:C.muted}}>현재 손익</div>
                        <div style={{fontSize:13,fontWeight:900,color:pnlPct>=0?C.green:C.red}}>{pnlPct>=0?"+":""}{pnlPct}%</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:6,color:C.muted}}>보유일</div>
                        <div style={{fontSize:13,fontWeight:900,color:C.text}}>{daysHeld}일</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:6,color:C.muted}}>최대 수익</div>
                        <div style={{fontSize:13,fontWeight:900,color:C.emerald}}>+{maxPnl}%</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:6,color:C.muted}}>최대 하락</div>
                        <div style={{fontSize:13,fontWeight:900,color:C.red}}>{maxDD}%</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontSize:6,color:C.muted}}>최적매도</div>
                        <div style={{fontSize:13,fontWeight:900,color:C.purple}}>{bestSellDay}일째</div>
                        <div style={{fontSize:6,color:C.emerald}}>+{bestSellPnl.toFixed(1)}%</div>
                      </div>
                    </div>;
                  })()}
                </div>
              </div>
              :<div style={{textAlign:"center",padding:"20px",color:C.muted,fontSize:10}}>👆 차트 위 아무 날짜를 클릭하세요 (▲매수 ▼매도 신호 표시)</div>}

              {/* ★ 신호 성과 분석 */}
              <div style={css.card}>
                <div style={{fontSize:10,fontWeight:700,color:C.emerald,marginBottom:8}}>📈 매수 신호 성과 분석 (90일)</div>
                <div style={{fontSize:8,color:C.muted,marginBottom:6}}>각 신호 발생 후 평균 수익률 · 어떤 신호가 상승을 잘 잡았나?</div>
                {Object.keys(sigPerf).length===0?<div style={{fontSize:9,color:C.muted,textAlign:"center",padding:10}}>매수 신호 없음</div>
                :<div style={{overflowX:"auto"}}>
                  <div style={{display:"grid",gridTemplateColumns:"1.2fr 0.5fr 0.5fr 0.8fr 0.8fr 0.8fr",gap:0,fontSize:8,minWidth:350}}>
                    <div style={{padding:"4px 8px",fontWeight:700,color:C.muted,borderBottom:`1px solid ${C.border}`}}>신호</div>
                    <div style={{padding:"4px 8px",fontWeight:700,color:C.muted,borderBottom:`1px solid ${C.border}`}}>횟수</div>
                    <div style={{padding:"4px 8px",fontWeight:700,color:C.muted,borderBottom:`1px solid ${C.border}`}}>승률</div>
                    <div style={{padding:"4px 8px",fontWeight:700,color:C.muted,borderBottom:`1px solid ${C.border}`}}>5일후</div>
                    <div style={{padding:"4px 8px",fontWeight:700,color:C.muted,borderBottom:`1px solid ${C.border}`}}>10일후</div>
                    <div style={{padding:"4px 8px",fontWeight:700,color:C.muted,borderBottom:`1px solid ${C.border}`}}>20일후</div>
                    {Object.entries(sigPerf).sort((a,b)=>(b[1].sum10/b[1].count)-(a[1].sum10/a[1].count)).map(([name,d])=>{
                      const avg5=(d.sum5/d.count).toFixed(1),avg10=(d.sum10/d.count).toFixed(1),avg20=(d.sum20/d.count).toFixed(1);
                      const winRate=Math.round(d.wins/d.count*100);
                      return <React.Fragment key={name}>
                        <div style={{padding:"5px 8px",fontWeight:700}}>{name}</div>
                        <div style={{padding:"5px 8px"}}>{d.count}회</div>
                        <div style={{padding:"5px 8px",color:winRate>=60?C.emerald:winRate>=40?C.yellow:C.red,fontWeight:700}}>{winRate}%</div>
                        <div style={{padding:"5px 8px",color:avg5>=0?C.green:C.red}}>{avg5>=0?"+":""}{avg5}%</div>
                        <div style={{padding:"5px 8px",color:avg10>=0?C.green:C.red,fontWeight:700}}>{avg10>=0?"+":""}{avg10}%</div>
                        <div style={{padding:"5px 8px",color:avg20>=0?C.green:C.red}}>{avg20>=0?"+":""}{avg20}%</div>
                      </React.Fragment>;
                    })}
                  </div>
                </div>}
              </div>

              <div style={css.card}>
                <div style={{fontSize:10,fontWeight:700,color:C.red,marginBottom:8}}>📉 매도 신호 성과 (도망 타이밍)</div>
                <div style={{fontSize:8,color:C.muted,marginBottom:6}}>신호 발생 후 5일 평균 하락률 · 높을수록 좋은 탈출 신호</div>
                {Object.keys(sellPerf).length===0?<div style={{fontSize:9,color:C.muted,textAlign:"center",padding:10}}>매도 신호 없음</div>
                :<div style={{display:"grid",gridTemplateColumns:"1.2fr 0.5fr 0.5fr 1fr",gap:0,fontSize:8}}>
                  <div style={{padding:"4px 8px",fontWeight:700,color:C.muted,borderBottom:`1px solid ${C.border}`}}>신호</div>
                  <div style={{padding:"4px 8px",fontWeight:700,color:C.muted,borderBottom:`1px solid ${C.border}`}}>횟수</div>
                  <div style={{padding:"4px 8px",fontWeight:700,color:C.muted,borderBottom:`1px solid ${C.border}`}}>적중률</div>
                  <div style={{padding:"4px 8px",fontWeight:700,color:C.muted,borderBottom:`1px solid ${C.border}`}}>5일후 평균</div>
                  {Object.entries(sellPerf).sort((a,b)=>(a[1].sum5/a[1].count)-(b[1].sum5/b[1].count)).map(([name,d])=>{
                    const avg5=(d.sum5/d.count).toFixed(1);
                    const winRate=Math.round(d.wins/d.count*100);
                    return <React.Fragment key={name}>
                      <div style={{padding:"5px 8px",fontWeight:700}}>{name}</div>
                      <div style={{padding:"5px 8px"}}>{d.count}회</div>
                      <div style={{padding:"5px 8px",color:winRate>=60?C.emerald:winRate>=40?C.yellow:C.red,fontWeight:700}}>{winRate}%</div>
                      <div style={{padding:"5px 8px",color:avg5<0?C.emerald:C.red,fontWeight:700}}>{avg5>=0?"+":""}{avg5}%</div>
                    </React.Fragment>;
                  })}
                </div>}
              </div>

              {/* ★ v2.2: 조합 자동 분석 — 최적 전략 찾기 */}
              <div style={css.card}>
                <div style={{fontSize:10,fontWeight:700,color:C.purple,marginBottom:8}}>🧬 조합 분석 — 최적 매수 조건 찾기</div>
                <div style={{fontSize:8,color:C.muted,marginBottom:8}}>2개 이상 신호가 동시 발생한 시점의 성과 · 조합이 많을수록 정확도↑</div>
                {(()=>{
                  // 각 날짜에 어떤 매수 신호가 있었는지 매핑
                  const daySignals = {};
                  sigMarkers.filter(s=>s.side==="buy").forEach(s=>{
                    if(!daySignals[s.i]) daySignals[s.i]=[];
                    daySignals[s.i].push(s.type);
                  });

                  // 조합별 성과 계산
                  const combos = {};
                  const condNames = ["ST플립","MACD↑","구름돌파","스퀴즈해제","거래량폭발"];
                  
                  // 2개 조합
                  for(let a=0;a<condNames.length;a++){
                    for(let b=a+1;b<condNames.length;b++){
                      const key = `${condNames[a]} + ${condNames[b]}`;
                      combos[key]={count:0,wins:0,sum10:0,sum20:0,signals:2};
                    }
                  }
                  // 3개 조합
                  for(let a=0;a<condNames.length;a++){
                    for(let b=a+1;b<condNames.length;b++){
                      for(let c=b+1;c<condNames.length;c++){
                        const key = `${condNames[a]} + ${condNames[b]} + ${condNames[c]}`;
                        combos[key]={count:0,wins:0,sum10:0,sum20:0,signals:3};
                      }
                    }
                  }
                  // 풀 조합
                  combos["풀조합 (3개+)"]={count:0,wins:0,sum10:0,sum20:0,signals:99};

                  Object.entries(daySignals).forEach(([idx,sigs])=>{
                    const i=+idx;
                    const entry=labSliced[i]?.close;
                    if(!entry)return;
                    const after10=labSliced[Math.min(i+10,labSliced.length-1)]?.close||entry;
                    const after20=labSliced[Math.min(i+20,labSliced.length-1)]?.close||entry;
                    const pnl10=(after10-entry)/entry*100;
                    const pnl20=(after20-entry)/entry*100;
                    const win=after10>entry;

                    // 2개 조합 체크
                    for(let a=0;a<condNames.length;a++){
                      for(let b=a+1;b<condNames.length;b++){
                        if(sigs.includes(condNames[a])&&sigs.includes(condNames[b])){
                          const key=`${condNames[a]} + ${condNames[b]}`;
                          combos[key].count++;combos[key].sum10+=pnl10;combos[key].sum20+=pnl20;if(win)combos[key].wins++;
                        }
                      }
                    }
                    // 3개 조합 체크
                    for(let a=0;a<condNames.length;a++){
                      for(let b=a+1;b<condNames.length;b++){
                        for(let c=b+1;c<condNames.length;c++){
                          if(sigs.includes(condNames[a])&&sigs.includes(condNames[b])&&sigs.includes(condNames[c])){
                            const key=`${condNames[a]} + ${condNames[b]} + ${condNames[c]}`;
                            combos[key].count++;combos[key].sum10+=pnl10;combos[key].sum20+=pnl20;if(win)combos[key].wins++;
                          }
                        }
                      }
                    }
                    // 풀 조합
                    if(sigs.length>=3){combos["풀조합 (3개+)"].count++;combos["풀조합 (3개+)"].sum10+=pnl10;combos["풀조합 (3개+)"].sum20+=pnl20;if(win)combos["풀조합 (3개+)"].wins++;}
                  });

                  const ranked = Object.entries(combos).filter(([,d])=>d.count>0).sort((a,b)=>{
                    const aWr=a[1].wins/a[1].count, bWr=b[1].wins/b[1].count;
                    return bWr-aWr || (b[1].sum10/b[1].count)-(a[1].sum10/a[1].count);
                  });

                  if(!ranked.length) return <div style={{fontSize:9,color:C.muted,textAlign:"center",padding:15}}>동시 발생한 조합이 없습니다 — 데이터가 더 쌓이면 나타납니다</div>;

                  return <>
                    <div style={{display:"grid",gridTemplateColumns:"2fr 0.5fr 0.6fr 0.8fr 0.8fr",gap:0,fontSize:8}}>
                      <div style={{padding:"4px 8px",fontWeight:700,color:C.muted,borderBottom:`1px solid ${C.border}`}}>조합</div>
                      <div style={{padding:"4px 8px",fontWeight:700,color:C.muted,borderBottom:`1px solid ${C.border}`}}>횟수</div>
                      <div style={{padding:"4px 8px",fontWeight:700,color:C.muted,borderBottom:`1px solid ${C.border}`}}>승률</div>
                      <div style={{padding:"4px 8px",fontWeight:700,color:C.muted,borderBottom:`1px solid ${C.border}`}}>10일후</div>
                      <div style={{padding:"4px 8px",fontWeight:700,color:C.muted,borderBottom:`1px solid ${C.border}`}}>20일후</div>
                      {ranked.slice(0,10).map(([name,d])=>{
                        const wr=Math.round(d.wins/d.count*100);
                        const avg10=(d.sum10/d.count).toFixed(1);
                        const avg20=(d.sum20/d.count).toFixed(1);
                        const isBest=wr>=60&&avg10>0;
                        return <React.Fragment key={name}>
                          <div style={{padding:"5px 8px",fontWeight:700,color:isBest?C.emerald:C.text,background:isBest?"rgba(48,209,88,.06)":"transparent"}}>{isBest?"⭐ ":""}{name}</div>
                          <div style={{padding:"5px 8px",background:isBest?"rgba(48,209,88,.06)":"transparent"}}>{d.count}회</div>
                          <div style={{padding:"5px 8px",color:wr>=60?C.emerald:wr>=40?C.yellow:C.red,fontWeight:700,background:isBest?"rgba(48,209,88,.06)":"transparent"}}>{wr}%</div>
                          <div style={{padding:"5px 8px",color:avg10>=0?C.green:C.red,fontWeight:700,background:isBest?"rgba(48,209,88,.06)":"transparent"}}>{avg10>=0?"+":""}{avg10}%</div>
                          <div style={{padding:"5px 8px",color:avg20>=0?C.green:C.red,background:isBest?"rgba(48,209,88,.06)":"transparent"}}>{avg20>=0?"+":""}{avg20}%</div>
                        </React.Fragment>;
                      })}
                    </div>
                    {ranked.find(([,d])=>d.wins/d.count>=0.6)&&<div style={{marginTop:8,padding:"8px 10px",background:"rgba(48,209,88,.08)",border:"1px solid rgba(48,209,88,.25)",borderRadius:8}}>
                      <div style={{fontSize:9,fontWeight:700,color:C.emerald}}>💡 추천: {ranked.find(([,d])=>d.wins/d.count>=0.6)?.[0]}</div>
                      <div style={{fontSize:8,color:C.muted,marginTop:2}}>이 조합이 {labInfo?.label}에서 승률 {Math.round(ranked.find(([,d])=>d.wins/d.count>=0.6)?.[1].wins/ranked.find(([,d])=>d.wins/d.count>=0.6)?.[1].count*100)}%로 가장 높았습니다 (90일 기준)</div>
                    </div>}
                  </>;
                })()}
              </div>

              {/* ★ v2.2: 최적 매도 타이밍 분석 */}
              <div style={css.card}>
                <div style={{fontSize:10,fontWeight:700,color:"#FF9F0A",marginBottom:8}}>⏱ 보유 기간별 평균 수익률</div>
                <div style={{fontSize:8,color:C.muted,marginBottom:8}}>매수 신호 발생 후 며칠 보유가 최적인가?</div>
                {(()=>{
                  const buyDays = sigMarkers.filter(s=>s.side==="buy");
                  if(!buyDays.length) return <div style={{fontSize:9,color:C.muted,textAlign:"center",padding:10}}>매수 신호 없음</div>;
                  const periods = [1,3,5,7,10,15,20];
                  const results = periods.map(days=>{
                    let sum=0,count=0;
                    buyDays.forEach(sig=>{
                      const entry=labSliced[sig.i]?.close;
                      const exit=labSliced[Math.min(sig.i+days,labSliced.length-1)]?.close;
                      if(entry&&exit){sum+=(exit-entry)/entry*100;count++;}
                    });
                    return {days, avg:count?+(sum/count).toFixed(2):0, count};
                  });
                  const best = results.reduce((a,b)=>b.avg>a.avg?b:a);
                  return <>
                    <div style={{display:"flex",gap:4,marginBottom:6}}>
                      {results.map(r=>(
                        <div key={r.days} style={{flex:1,textAlign:"center",padding:"6px 2px",borderRadius:6,background:r.days===best.days?"rgba(48,209,88,.12)":"rgba(0,0,0,.5)",border:r.days===best.days?`1px solid ${C.emerald}`:"1px solid transparent"}}>
                          <div style={{fontSize:7,color:C.muted}}>{r.days}일</div>
                          <div style={{fontSize:12,fontWeight:900,color:r.avg>=0?C.green:C.red}}>{r.avg>=0?"+":""}{r.avg}%</div>
                        </div>
                      ))}
                    </div>
                    <div style={{fontSize:8,color:C.emerald,fontWeight:700}}>💡 최적 보유기간: {best.days}일 (평균 {best.avg>=0?"+":""}{best.avg}%)</div>
                  </>;
                })()}
              </div>
            </div>;
          })()}
        </div>}

        {/* ══ TAB 5: 종목풀 ══ */}
        {tab==="pool"&&<div style={{padding:"12px 14px"}}>
          <div style={{fontSize:12,fontWeight:900,color:C.accent,marginBottom:4}}>🗂 종목풀 관리</div>
          <div style={{fontSize:9,color:C.sub,marginBottom:12}}>거래대금 상위 종목 — ★ 눌러 관심종목 추가</div>
          <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
            <input value={poolFilter} onChange={e=>setPoolFilter(e.target.value)} placeholder="종목명/티커 검색..." style={{flex:1,minWidth:120,background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 10px",color:C.text,fontSize:10,outline:"none"}}/>
            {[["all","전체"],["kr","🇰🇷 한국"],["us","🇺🇸 미국"]].map(([v,l])=>(
              <button key={v} onClick={()=>setPoolMarket(v)} style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${poolMarket===v?C.accent:C.border}`,background:poolMarket===v?"rgba(10,132,255,.12)":"transparent",color:poolMarket===v?C.accent:C.muted,fontSize:9,cursor:"pointer"}}>{l}</button>
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
          {poolMsg&&<div style={{fontSize:9,color:C.accent,marginBottom:8,padding:"6px 10px",background:"rgba(10,132,255,.08)",borderRadius:6}}>{poolMsg}</div>}
          <div style={css.card}>
            <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8}}>⭐ 현재 관심종목 ({stocks.length}개)</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {stocks.map(s=>(
                <div key={s.ticker} style={{display:"flex",alignItems:"center",gap:4,background:"rgba(10,132,255,.08)",border:`1px solid rgba(10,132,255,.15)`,borderRadius:5,padding:"3px 8px"}}>
                  <span style={{fontSize:9,fontWeight:700,color:C.accent}}>{fmtName(s,8)}</span>
                  <button onClick={()=>removeStock(s.ticker)} style={{background:"none",border:"none",color:"rgba(255,69,58,.6)",cursor:"pointer",fontSize:10,padding:0}}>✕</button>
                </div>
              ))}
            </div>
          </div>
          {!poolLoaded
            ?<div style={{textAlign:"center",padding:"40px 0",color:C.muted}}><div style={{fontSize:24,marginBottom:8}}>📦</div><div style={{fontSize:10}}>위 "풀 로드" 버튼을 눌러주세요</div></div>
            :<div>
              <div style={{fontSize:9,color:C.muted,marginBottom:8}}>{poolFiltered.length}개 표시 중</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:6}}>
                {poolFiltered.slice(0,200).map(([ticker,info])=>{
                  const inWatch=stocks.find(s=>s.ticker===ticker);
                  const chg=info.changePct||0;
                  return<div key={ticker} style={{background:C.panel2,border:`1px solid ${inWatch?"rgba(56,189,248,.4)":C.border}`,borderRadius:7,padding:"7px 9px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <div style={{fontSize:9,fontWeight:700,color:inWatch?C.accent:C.text,maxWidth:80,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fmtName({ticker,...info},8)}</div>
                        <div style={{fontSize:7,color:C.muted}}>{/^\d{6}$/.test(ticker)?ticker:info.label?.slice(0,12)||""}</div>
                      </div>
                      <button onClick={async()=>{
                        if(inWatch){removeStock(ticker);}
                        else{try{await fetch("/api/watchlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker,...info})});setStocks(p=>[...p,{ticker,...info,...(pool[ticker]||{})}]);setPoolMsg(`✅ ${info.label} 추가`);}catch{setPoolMsg("❌ 실패");}}
                        setTimeout(()=>setPoolMsg(""),3000);
                      }} style={{background:inWatch?"rgba(10,132,255,.12)":"rgba(255,255,255,.04)",border:`1px solid ${inWatch?C.accent:C.border}`,borderRadius:4,padding:"2px 6px",cursor:"pointer",color:inWatch?C.accent:C.muted,fontSize:10,flexShrink:0}}>{inWatch?"★":"☆"}</button>
                    </div>
                    {info.price>0&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
                      <span style={{fontSize:9}}>{info.market==="kr"?"₩":"$"}{info.market==="kr"?fmtKRW(info.price||0):(info.price||0).toLocaleString()}</span>
                      <span style={{fontSize:8,fontWeight:700,color:chg>=0?C.green:C.red}}><span style={{color:C.muted,fontWeight:400}}>1D</span>{chg>=0?"+":""}{chg.toFixed(1)}%</span>
                    </div>}
                  </div>;
                })}
              </div>
              {poolFiltered.length>200&&<div style={{textAlign:"center",padding:"10px",fontSize:9,color:C.muted}}>검색으로 범위를 좁혀주세요 ({poolFiltered.length}개 중 200개 표시)</div>}
            </div>}
        </div>}

      </div>
    </div>
  );
}
