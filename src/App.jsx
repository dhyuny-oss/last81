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
  bg:"#0F1419", panel:"#1A2332", panel2:"#1E293B",
  border:"rgba(148,163,184,.12)", accent:"#3B82F6",
  green:"#22C55E", red:"#EF4444", yellow:"#F59E0B",
  emerald:"#10B981", purple:"#8B5CF6",
  muted:"#64748B", text:"#E2E8F0", sub:"#94A3B8", ema:"#F97316",
  glass:"rgba(148,163,184,.06)",
};
const SIG = {
  BUY:  { bg:"rgba(34,197,94,.08)", color:"#22C55E", border:"rgba(34,197,94,.25)" },
  HOLD: { bg:"rgba(245,158,11,.06)",  color:"#F59E0B", border:"rgba(245,158,11,.2)"  },
  SELL: { bg:"rgba(239,68,68,.06)", color:"#EF4444", border:"rgba(239,68,68,.2)" },
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
  "SK텔레콤":"017670","sk텔레콤":"017670","SKT":"017670","KT":"030200","kt":"030200",
  "LG":"003550","lg":"003550","한화":"000880","SK":"034730","sk":"034730",
  "현대건설":"000720","대우건설":"047040","DL이앤씨":"375500","삼성엔지니어링":"028050",
  "한화오션":"042660","HD한국조선해양":"009540","현대중공업":"329180","삼성중공업":"010140",
  "현대로템":"064350","한화시스템":"272210","LIG넥스원":"079550",
  "두산에너빌리티":"034020","한전기술":"052690","SK이노베이션":"096770",
  "아모레퍼시픽":"090430","LG생활건강":"051900","CJ제일제당":"097950",
  "SK바이오팜":"326030","SK스퀘어":"402340","카카오페이":"377300",
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
  // ★ v2.3: 캔들 패턴 + 엔벨로프
  data.forEach((d,i)=>{
    const ci2=i+off;
    const o=candles[ci2].open||d.close,h=candles[ci2].high||d.close,l=candles[ci2].low||d.close,c=d.close;
    const body=Math.abs(c-o),range=h-l||1;
    d.candleOpen=o;d.candleHigh=h;d.candleLow=l;
    d.isBull=c>o;
    d.bodyPct=c>0?+(body/c*100).toFixed(2):0; // 몸통 크기 %
    d.upperWickPct=+((h-Math.max(o,c))/range*100).toFixed(1); // 위꼬리 비율
    d.lowerWickPct=+((Math.min(o,c)-l)/range*100).toFixed(1); // 아래꼬리 비율
    d.bigBull=c>o&&d.bodyPct>=5; // 장대양봉 (5%+)
    d.cleanCandle=c>o&&d.upperWickPct<20; // 깔끔한 양봉 (위꼬리 20% 이하)
    d.bigBullClean=d.bigBull&&d.cleanCandle; // 장대양봉 + 깔끔
    // 엔벨로프 (20,20)
    if(d.ma20){d.envUpper=+(d.ma20*1.20).toFixed(2);d.envLower=+(d.ma20*0.80).toFixed(2);d.nearEnvLower=c<=d.envLower*1.02;}
  });
  return data;
}

// ═══════════════════════════════════════════════════════════
// ★ v2.3: 진입타이밍 — "방금 시작했냐?" (변화의 순간 감지)
// ═══════════════════════════════════════════════════════════
function calcEntryTiming(chartData) {
  if (!chartData || chartData.length < 10) return { score:0, signals:[], grade:"?" };
  let score = 0; const signals = [];
  const L = chartData.length;
  const d = chartData;

  // ① ST 플립 (최대 25pt) — 최근 며칠 내 전환일수록 높음
  for (let ago = 0; ago < Math.min(5, L-1); ago++) {
    const ci = L-1-ago, pi = ci-1;
    const stNow = [d[ci].st1Bull,d[ci].st2Bull,d[ci].st3Bull].filter(v=>v!=null).length;
    const stPrev = [d[pi].st1Bull,d[pi].st2Bull,d[pi].st3Bull].filter(v=>v!=null).length;
    if (stNow === 3 && stPrev < 3) {
      const pts = ago === 0 ? 25 : ago <= 1 ? 20 : ago <= 2 ? 15 : 10;
      score += pts; signals.push(`ST돌파${ago===0?"오늘":ago+"일전"}`); break;
    } else if (stNow > stPrev && stNow >= 2) {
      const pts = ago === 0 ? 12 : ago <= 2 ? 8 : 5;
      score += pts; signals.push(`ST개선${ago===0?"":ago+"일전"}`); break;
    }
  }

  // ② MACD 골든크로스 (최대 20pt)
  for (let ago = 0; ago < Math.min(5, L-1); ago++) {
    const ci = L-1-ago, pi = ci-1;
    if (d[ci].macd > d[ci].signal && d[pi].macd <= d[pi].signal) {
      const pts = ago === 0 ? 20 : ago <= 1 ? 16 : ago <= 2 ? 12 : 8;
      score += pts; signals.push(`MACD↑${ago===0?"오늘":ago+"일전"}`); break;
    }
  }

  // ③ 구름 돌파 (최대 15pt)
  for (let ago = 0; ago < Math.min(5, L-1); ago++) {
    const ci = L-1-ago, pi = ci-1;
    if (d[ci].aboveCloud && !d[pi].aboveCloud) {
      const pts = ago === 0 ? 15 : ago <= 2 ? 10 : 6;
      score += pts; signals.push(`구름돌파${ago===0?"오늘":ago+"일전"}`); break;
    }
  }

  // ④ 스퀴즈 해제 (최대 15pt)
  for (let ago = 0; ago < Math.min(3, L); ago++) {
    if (d[L-1-ago].sqzOff) {
      const pts = ago === 0 ? 15 : ago <= 1 ? 12 : 8;
      score += pts; signals.push(`스퀴즈해제${ago===0?"":""+ago+"일전"}`); break;
    }
  }

  // ⑤ RSI 50 상향돌파 (최대 10pt)
  for (let ago = 0; ago < Math.min(5, L-1); ago++) {
    const ci = L-1-ago, pi = ci-1;
    if (d[ci].rsi >= 50 && d[pi].rsi < 50) {
      const pts = ago === 0 ? 10 : ago <= 2 ? 7 : 4;
      score += pts; signals.push(`RSI돌파50`); break;
    }
  }

  // ⑥ 거래량 스파이크 (최대 15pt)
  const vols = d.slice(-21, -1).map(c => c.volume || 0).filter(v => v > 0);
  const avgVol = vols.length ? vols.reduce((a,b) => a+b, 0) / vols.length : 0;
  const todayVol = d[L-1].volume || 0;
  if (avgVol > 0) {
    const ratio = todayVol / avgVol;
    if (ratio > 2.5) { score += 15; signals.push(`거래량${Math.round(ratio*100)}%`); }
    else if (ratio > 2) { score += 12; signals.push(`거래량급증`); }
    else if (ratio > 1.5) { score += 6; signals.push(`거래량증가`); }
  }

  const s = Math.min(100, Math.max(0, score));
  const grade = s >= 70 ? "🔥" : s >= 45 ? "⚡" : s >= 20 ? "💤" : "—";
  return { score: s, signals, grade };
}

// ═══════════════════════════════════════════════════════════
// ★ v2.3: 추세강도 — "세질거냐? 오래갈거냐?" (지속성 판단)
// ═══════════════════════════════════════════════════════════
function calcTrendDurability(chartData) {
  if (!chartData || chartData.length < 10) return { score:0, signals:[], grade:"?" };
  let score = 0; const signals = [];
  const L = chartData.length;
  const d = chartData;
  const last = d[L-1];

  // ① ADX 기울기 — 추세 강화 중인가 (최대 20pt)
  if (last.adx != null) {
    const adxPrev = d[Math.max(0, L-4)]?.adx;
    const adxSlope = adxPrev != null ? last.adx - adxPrev : 0;
    if (last.adx > 25 && adxSlope > 3) { score += 20; signals.push("ADX상승↑"); }
    else if (last.adx > 25 && adxSlope > 0) { score += 14; signals.push("ADX유지"); }
    else if (last.adx > 20 && adxSlope > 0) { score += 8; signals.push("ADX형성중"); }
    else if (last.adx <= 20) { signals.push("ADX약세"); }
    else { score += 3; }
  }

  // ② +DI > -DI 방향 확인 (최대 10pt)
  if (last.pdi != null && last.mdi != null) {
    if (last.pdi > last.mdi) { score += 10; signals.push("+DI우위"); }
  }

  // ③ OBV 동행 — 가격과 거래량 방향 일치 (최대 15pt)
  if (L >= 10 && last.obv != null) {
    const obv5ago = d[L-6]?.obv;
    const price5ago = d[L-6]?.close;
    if (obv5ago != null && price5ago) {
      const priceUp = last.close > price5ago;
      const obvUp = last.obv > obv5ago;
      if (priceUp && obvUp) { score += 15; signals.push("OBV동행"); }
      else if (priceUp && !obvUp) { signals.push("OBV이탈⚠"); }
      else if (!priceUp && obvUp) { score += 5; signals.push("OBV선행"); }
    }
  }

  // ④ MACD 히스토그램 가속 (최대 15pt)
  if (L >= 4) {
    const h1 = d[L-1].hist, h2 = d[L-2].hist, h3 = d[L-3].hist;
    if (h1 != null && h2 != null && h3 != null) {
      if (h1 > 0 && h1 > h2 && h2 > h3) { score += 15; signals.push("MACD가속"); }
      else if (h1 > 0 && h1 > h2) { score += 10; signals.push("MACD증가"); }
      else if (h1 > 0) { score += 4; signals.push("MACD양전"); }
      else if (h1 < 0 && h1 < h2) { signals.push("MACD악화"); }
    }
  }

  // ⑤ EMA 정배열 (최대 15pt)
  const ema20 = last.ma20, ema50 = last.ema50;
  const above200 = last.ma200 ? last.close > last.ma200 : null;
  if (ema20 && ema50 && ema20 > ema50) {
    if (above200 === true) { score += 15; signals.push("EMA정배열"); }
    else if (above200 === null) { score += 10; signals.push("20>50정배열"); }
    else { score += 5; signals.push("단기정배열"); }
  } else if (ema20 && ema50 && ema20 < ema50) {
    signals.push("EMA역배열");
  }

  // ⑥ RSI 건강 구간 (최대 15pt)
  const rsi = last.rsi;
  if (rsi >= 50 && rsi <= 65) { score += 15; signals.push(`RSI${rsi?.toFixed(0)}최적`); }
  else if (rsi > 65 && rsi <= 75) { score += 10; signals.push(`RSI${rsi?.toFixed(0)}강세`); }
  else if (rsi > 40 && rsi < 50) { score += 5; signals.push(`RSI${rsi?.toFixed(0)}약세`); }
  else if (rsi > 75) { score += 3; signals.push(`RSI${rsi?.toFixed(0)}과열`); }
  else if (rsi != null) { signals.push(`RSI${rsi?.toFixed(0)}저조`); }

  // ⑦ ST 유지 기간 보너스 (최대 10pt) — 오래 유지 = 안정적
  let stDays = 0;
  for (let i = L-1; i >= Math.max(0, L-20); i--) {
    const sc = [d[i].st1Bull, d[i].st2Bull, d[i].st3Bull].filter(v => v != null).length;
    if (sc >= 2) stDays++; else break;
  }
  if (stDays >= 10) { score += 10; signals.push(`ST${stDays}일유지`); }
  else if (stDays >= 5) { score += 6; signals.push(`ST${stDays}일유지`); }
  else if (stDays >= 3) { score += 3; }

  const s = Math.min(100, Math.max(0, score));
  const grade = s >= 70 ? "A" : s >= 50 ? "B" : s >= 30 ? "C" : "D";
  return { score: s, signals, grade };
}

// ★ 5번: 진입 평점 (레거시 — 하위호환용, 내부적으로 두 점수 합산)
function calcEntryScore(chartData, vixVal, oppScore, stockInfo) {
  const timing = calcEntryTiming(chartData);
  const durability = calcTrendDurability(chartData);
  const combined = Math.round(timing.score * 0.5 + durability.score * 0.5);
  const grade = combined >= 70 ? "S" : combined >= 55 ? "A" : combined >= 40 ? "B" : combined >= 25 ? "C" : "D";
  return { score: combined, breakdown: [...timing.signals, ...durability.signals].map(s => ({label:s, pts:0, ok:true})), grade };
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
  return<div style={{background:"#111827",border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",fontSize:10}}><div style={{color:C.sub,marginBottom:4,fontWeight:700}}>{label}</div>{payload.filter(p=>p.value!=null).map((p,i)=><div key={i} style={{color:p.color||C.text}}>{p.name}: <b>{typeof p.value==="number"?p.value.toLocaleString(undefined,{maximumFractionDigits:2}):p.value}</b></div>)}</div>;
}
function BuyDot({cx,cy,payload,dataKey}){if(!payload?.[dataKey])return null;const c=dataKey==="buyStrong"?"#4ade80":"#F59E0B",sz=dataKey==="buyStrong"?11:8;return<g><polygon points={`${cx},${cy-sz} ${cx-sz*.8},${cy+sz*.5} ${cx+sz*.8},${cy+sz*.5}`} fill={c} stroke="#000" strokeWidth="1" opacity=".9"/></g>;}
function HistBar({x,y,width,height,value}){if(value==null)return null;const h=Math.abs(height),pos=value>0;return<rect x={x} y={pos?y:y+height-h} width={Math.max(1,width)} height={h} fill={pos?"rgba(34,197,94,.7)":"rgba(239,68,68,.7)"} rx={1}/>;}

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
function fmtName(s, maxLen=8) {
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
  card: { background:"#1A2332", border:`1px solid rgba(148,163,184,.08)`, borderRadius:12, padding:16, marginBottom:14, boxShadow:"0 1px 3px rgba(0,0,0,.2)" },
  panel2: { background:"#1E293B", border:`1px solid rgba(148,163,184,.08)`, borderRadius:10, padding:"10px 14px" },
  btn: (on=false) => ({ borderRadius:8, padding:"6px 14px", cursor:"pointer", fontWeight:600, fontSize:11, border:`1px solid ${on?"rgba(59,130,246,.35)":"rgba(148,163,184,.12)"}`, background:on?"rgba(59,130,246,.1)":"rgba(148,163,184,.04)", color:on?C.accent:C.muted }),
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
  const [companyInfo, setCompanyInfo] = useState({}); // ★ v2.3: 회사 소개
  const [search, setSearch] = useState("");
  const [searchRes, setSearchRes] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [addMsg, setAddMsg] = useState("");
  const [navSource, setNavSource] = useState(""); // 종목 발견 소스 추적
  const [period, setPeriod] = useState("3M");
  const [chartRefDate, setChartRefDate] = useState(null); // 청산 기록에서 클릭한 날짜
  const [selectedSector, setSelectedSector] = useState(null);
  // ★ v2.2: 실험실 탭
  const [labStock, setLabStock] = useState(null);
  const [labPoint, setLabPoint] = useState(null);
  // labMarket 제거됨 — focusMarket 사용
  // ★ v2.3: 집중탭 뷰 전환
  const [focusView, setFocusView] = useState(null); // null=기본 | "ranked" | "breakout" | "entry"
  const [focusMarket, setFocusMarket] = useState("all"); // all | kr | us
  // ★ v2.2: 지수 미니차트
  const [selIndex, setSelIndex] = useState(null);

  // ── 데이터 상태 ──────────────────────────────────────────
  const [dataStatus, setDataStatus] = useState("loading");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [indicesData, setIndicesData] = useState({});
  const [sectorsData, setSectorsData] = useState({});
  const [breadthData, setBreadthData] = useState({kr:{upPct:0,up:0,down:0},us:{upPct:0,up:0,down:0}});
  const [fearGreed, setFearGreed] = useState({score:0,rating:""});
  const [rsKey, setRsKey]   = useState("chg1M");
  const [ibVol, setIbVol]   = useState(0);

  // ── 발굴탭 ────────────────────────────────────────────
  const [fVolRatio, setFVolRatio] = useState(0);
  const [alphaSort, setAlphaSort] = useState("score"); // score, accel, rs, chg3d, vol
  const [alphaMinScore, setAlphaMinScore] = useState(30); // 최소 종합점수 필터
  // ★ v2.3: 기법 조건 튜닝 — 기본값
  const STRATEGY_DEFAULTS={d0:{bodyPct:5,volMin:150,minScore:4},sj:{highPct:95,minScore:4},entry:{timingMin:55,durMin:55},tr:{volMin:110,minScore:5}};
  const [stratCfg,setStratCfg]=useState(()=>{try{const s=localStorage.getItem("at_strat_cfg");return s?JSON.parse(s):STRATEGY_DEFAULTS;}catch{return STRATEGY_DEFAULTS;}});
  useEffect(()=>{localStorage.setItem("at_strat_cfg",JSON.stringify(stratCfg));},[stratCfg]);
  const [expandedCombo,setExpandedCombo]=useState(null); // 패턴 발굴 확장
  const [scanCardOpen,setScanCardOpen]=useState({}); // 기법 카드 접기/펼치기
  const [customCombos,setCustomCombos]=useState(()=>{try{const s=localStorage.getItem("at_custom_combos");return s?JSON.parse(s):[];}catch{return [];}});
  useEffect(()=>{localStorage.setItem("at_custom_combos",JSON.stringify(customCombos));},[customCombos]);
  const [comboHistory,setComboHistory]=useState(()=>{try{const s=localStorage.getItem("at_combo_history");return s?JSON.parse(s):[];}catch{return [];}});
  useEffect(()=>{localStorage.setItem("at_combo_history",JSON.stringify(comboHistory));},[comboHistory]);
  const [alphaMarket, setAlphaMarket] = useState("all"); // all | kr | us
  const [fMarket, setFMarket]   = useState("all");
  const [fST, setFST]           = useState(0);
  const [fCloud, setFCloud]     = useState("all");
  const [fRS, setFRS]           = useState(0);
  const [alphaTab, setAlphaTab] = useState("filter");
  const [chartOpts, setChartOpts] = useState({ichi:false, st:true, avwap:false, adx:false, obv:false});
  const [showIndicDetail, setShowIndicDetail] = useState(false);
  const [userTargets, setUserTargets] = useState({}); // {ticker: price}
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
  const [showManualEntry, setShowManualEntry] = useState(false);

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
        if(json.sectors&&Object.keys(json.sectors).length>0) {
          setSectorsData(json.sectors);
          // ★ 디버그: 섹터 데이터 필드 확인
          const entries=Object.entries(json.sectors);
          const usSample=entries.find(([k,v])=>!(/^\d/.test(k)||k.includes("KODEX")||k.includes("TIGER")));
          const krSample=entries.find(([k,v])=>/^\d/.test(k)||k.includes("KODEX")||k.includes("TIGER"));
          if(usSample)console.log("[Alpha] US섹터(",usSample[0],") 키:",Object.keys(usSample[1]).join(","),"값:",JSON.stringify(usSample[1]).slice(0,300));
          if(krSample)console.log("[Alpha] KR섹터(",krSample[0],") 키:",Object.keys(krSample[1]).join(","),"값:",JSON.stringify(krSample[1]).slice(0,300));
        }
        if(json.breadth) setBreadthData(json.breadth);
        if(json.fearGreed) setFearGreed(json.fearGreed);
        // ★ v2.3: 풀 자동 로드
        const poolData = json.pool&&Object.keys(json.pool).length>0 ? json.pool : {};
        if(Object.keys(poolData).length>0){
          setPool(poolData);setPoolLoaded(true);
          // ★ 디버그: 풀 시장별 분포
          const poolEntries=Object.entries(poolData);
          const krCount=poolEntries.filter(([t,v])=>/^\d{6}$/.test(t)||v.market==="kr").length;
          const usCount=poolEntries.filter(([t,v])=>!/^\d{6}$/.test(t)&&v.market!=="kr").length;
          console.log(`[Alpha] 풀 로드: 총 ${poolEntries.length}개 (🇰🇷${krCount} 🇺🇸${usCount})`,usCount<10?"⚠️ US 종목 부족! 백엔드 스크립트 확인 필요":"");
        }
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
          // ★ pool에서도 이름 매칭
          if(!krMatch){
            const poolMatch=Object.entries(pool).find(([t,v])=>(v.label||"").includes(q));
            if(poolMatch&&!already.includes(poolMatch[0]))results.push({ticker:poolMatch[0],...poolMatch[1]});
          }
          const ticker=krMatch||qUp;
          if(!results.length&&!already.includes(ticker))results.push({ticker,label:`"${q}" 실시간 조회`,_custom:true});
        }
        setSearchRes(results);
      }catch{
        const qUp=q.toUpperCase();
        const krMatch=KR_NAME_DB[q]||KR_NAME_DB[qUp]||Object.entries(KR_NAME_DB).find(([k])=>k.includes(q))?.[1];
        const res=[];
        // ★ pool에서도 이름 매칭
        const poolMatches=Object.entries(pool).filter(([t,v])=>(v.label||"").includes(q)||(t||"").toUpperCase().includes(qUp)).slice(0,5);
        poolMatches.forEach(([t,v])=>{if(!already.includes(t))res.push({ticker:t,...v});});
        if(!res.length){
          if(krMatch&&!already.includes(krMatch))res.push({ticker:krMatch,label:`${q} (${krMatch})`,_custom:true});
          else if(!already.includes(qUp))res.push({ticker:qUp,label:`"${q}" 실시간 조회`,_custom:true});
        }
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

  // ★ v2.3: 회사 소개 + 최근 뉴스
  const fetchCompanyInfo=useCallback(async(ticker,label,market)=>{
    setCompanyInfo(p=>{if(p[ticker]?.data||p[ticker]?.loading)return p;return{...p,[ticker]:{loading:true}};});
    const prompt=`${label}(${ticker}) 회사 정보를 검색해 JSON만 출력 (백틱 없이):\n{"description":"이 회사가 뭐하는 곳인지 한국어 2문장","sector":"업종","founded":"설립년도","ceo":"대표","news":[{"title":"최근 뉴스 제목1","date":"날짜"},{"title":"최근 뉴스 제목2","date":"날짜"},{"title":"최근 뉴스 제목3","date":"날짜"}]}`;
    try{
      const r=await fetch("/api/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt,tools:[{type:"web_search_20250305",name:"web_search"}],max_tokens:500})});
      const j=await r.json();
      const txt=j.content.filter(b=>b.type==="text").map(b=>b.text).join("").replace(/```json|```/g,"").trim();
      setCompanyInfo(p=>({...p,[ticker]:{data:JSON.parse(txt),loading:false}}));
    }catch{setCompanyInfo(p=>({...p,[ticker]:{error:"조회 실패",loading:false}}));}
  },[]);
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
          return{ticker,label:meta.longName||meta.shortName||ticker,price,change:+(price-prevClose).toFixed(2),changePct:dayChgPct,chg3d:candles.length>3?+((candles.at(-1).close-candles.at(-4).close)/candles.at(-4).close*100).toFixed(2):0,chg5d:candles.length>5?+((candles.at(-1).close-candles.at(-6).close)/candles.at(-6).close*100).toFixed(2):0,sector:"Technology",market:isKR?"🇰🇷":"🇺🇸",roe:0,per:0,rev:0,revGrowth:0,mktCap:meta.marketCap||0,target:0,liquidity:2,base:+(price*0.88).toFixed(isKR?0:2),vol:0.02,drift:0.001,candles};
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

  // ★ v2.3: pool 전용 종목도 차트 탭에서 볼 수 있도록 자동 추가
  function navigateToStock(ticker, stockInfo, source) {
    if(source) setNavSource(source);
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
    // ★ v2.3 FIX: 자동 fetch 제거 — 차트탭의 "실시간 전환" 버튼으로 수동 전환
    // (발굴탭과 차트탭 점수 불일치 방지)
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
  const SECTOR_RS=Object.entries(sectorsData).map(([etf,d])=>{
    // ★ v2.3: market 필드 없으면 ETF 티커로 추론
    let mkt = d.market || "us";
    if(!d.market){
      const isKRTicker = /^\d/.test(etf) || etf.includes("KODEX") || etf.includes("TIGER") || etf.includes("코스");
      mkt = isKRTicker ? "kr" : "us";
    }
    // ★ v2.3 FIX: 필드명 폴백 강화 — 백엔드 필드명에 상관없이 숫자 값 추출
    const pick = (...keys) => { for(const k of keys){ const v=parseFloat(d[k]); if(!isNaN(v)&&v!==0) return v; } return 0; };
    const w = pick("chg1W","change1W","weekChange","changePct_1w","pct1w","week","1w","chg_1w","changePercent1W");
    const m = pick("chg1M","change1M","monthChange","changePct_1m","pct1m","month","1m","chg_1m","changePercent1M","chg");
    const day = pick("chg1d","changePct","dayChange","change1D","pct1d","changePercent","todayChange");
    return{name:d.label||d.name||etf,etf,market:mkt,chg1W:w||day,chg1M:m||w||day,chg1d:day,members:d.members||d.stocks||[]};
  });
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
  // ★ v2.3: 목표가 — 컨센서스 우선, 없으면 후보 중 최선
  const consTgtCalc = (()=>{
    if(userTargets[sel]>0) return {price:userTargets[sel], src:"사용자설정"};
    if(consensus[sel]?.data?.targetMean) return {price:consensus[sel].data.targetMean, src:"컨센서스"};
    const candidates = [
      selInfo?.target>0 && {price:selInfo.target, src:"설정목표"},
      w52High>curPrice*1.02 && {price:w52High, src:"52주고점"},
      rrTarget2>0 && {price:rrTarget2, src:"R:R 2:1"},
    ].filter(Boolean);
    if(!candidates.length) return {price:0, src:""};
    return candidates.sort((a,b)=>b.price-a.price)[0];
  })();
  const consTgt = consTgtCalc.price;
  const consTgtSrc = consTgtCalc.src;
  const rrRatio  = stopPrice>0&&consTgt>0&&curPrice>stopPrice?+((consTgt-curPrice)/(curPrice-stopPrice)).toFixed(1):0;

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

  // ★ v2.3: 진입타이밍 + 추세강도
  const selPoolInfo = pool[sel] || selInfo || {};
  const selTiming   = calcEntryTiming(cd?.data);
  const selDurability = calcTrendDurability(cd?.data);
  const entryScore  = calcEntryScore(cd?.data, vixVal, oppScore, selPoolInfo);
  const entryGradeColor = {S:C.emerald,A:C.green,B:C.yellow,C:"#F97316",D:C.red}[entryScore.grade]||C.muted;

  // ★ v2.3 FIX: 체크리스트 — autoVal 반영 (자동체크 항목도 통과)
  const checkAutoVals = {
    market: !!(lastD?.allBull && vixVal < 25),
    sector: true,
    stock: selTiming.score >= 40 && selDurability.score >= 40,
    timing: !!(lastD?.allBull && (lastD?.macd||0) > (lastD?.signal||0)),
    risk: stopPrice > 0 && stopPrice < curPrice,
  };
  const checkOk = Object.keys(checklist).every(k => checklist[k] || checkAutoVals[k]);

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
    if(!charts[s.ticker]?.real)return false; // ★ 시뮬 차트 제외 — 실제 데이터만
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
    // ★ v2.3: 타이밍 + 강도 사전 계산
    const cData=charts[s.ticker]?.data;
    const es=calcEntryScore(cData,vixVal,oppScore,pool[s.ticker]||s);
    const tm=calcEntryTiming(cData);
    const dr=calcTrendDurability(cData);
    return{...s,score:r.score,signals:r.signals,rs:r.rs,volRatio:s.volRatio||r.volRatio,stCount,cloudSt,accelTags,accelScore,chg3d,chg5d,entryScore:es.score,entryGrade:es.grade,timing:tm.score,durability:dr.score,timingGrade:tm.grade,durabilityGrade:dr.grade};
  }).filter(s=>s!=null).sort((a,b)=>{
    if(alphaSort==="timing")return(b.timing||0)-(a.timing||0)||(b.durability||0)-(a.durability||0);
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

  const TABS=[["radar","🌐 시장"],["focus","🎯 집중"],["alpha","🔍 발굴"],["scanner","📡 분석"],["sniper","📊 차트"],["track",`📁 추적 (${tracking.length+positions.length})`],["pool","🗃 종목풀"]];

  const pageStyle={minHeight:"100vh",background:"#0F1419",color:C.text,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display','Pretendard',sans-serif",display:"flex",flexDirection:"column",fontSize:12,WebkitFontSmoothing:"antialiased"};

  function RSBar(){return(
    <div style={{background:C.panel2,border:`1px solid ${C.border}`,borderRadius:9,padding:"10px 14px",marginBottom:12}}>
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
  );}

  return (
    <div style={pageStyle}>
      <style>{`
        @keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes ap{0%,100%{border-color:rgba(239,68,68,.8)}50%{border-color:rgba(239,68,68,.2)}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:3px}
        ::-webkit-scrollbar-track{background:transparent}
        input,select,textarea,button{font-family:inherit}
      `}</style>

      {/* ── 헤더 ─────────────────────────────────── */}
      <div style={{borderBottom:`1px solid ${C.border}`,padding:"8px 14px",background:"#111827",position:"sticky",top:0,zIndex:50}}>
        {/* 1행: 로고 + 상태 + 검색 + 설정 */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          <span style={{fontSize:15,fontWeight:900,color:C.accent,letterSpacing:2}}>✦ AT</span>
          <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
            {dataStatus==="loading"&&<span style={{fontSize:9,color:C.accent}}>로딩중...</span>}
            {dataStatus==="real"&&(()=>{
              const now=new Date();const h=now.getHours(),m=now.getMinutes(),t=h*60+m;
              const krOpen=t>=540&&t<=930;const usOpen=t>=1410||t<=360;
              const upd=lastUpdated?new Date(lastUpdated):null;
              const updH=upd?upd.getHours():0;const updT=upd?(updH*60+upd.getMinutes()):0;
              const krLabel=!upd?"—":updT>=930?"종가":updT>=540?"장중":"전일";
              const usLabel=!upd?"—":updT>=360&&updT<1410?"종가":updT>=1410?"장중":"전일";
              const updFmt=upd?`${upd.getMonth()+1}/${upd.getDate()} ${upd.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}`:"";
              return<>
                <span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:krOpen?"rgba(34,197,94,.12)":"rgba(148,163,184,.04)",color:krOpen?C.green:C.muted,fontWeight:600}}>🇰🇷 {krOpen?"장중":krLabel}</span>
                <span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:usOpen?"rgba(34,197,94,.12)":"rgba(148,163,184,.04)",color:usOpen?C.green:C.muted,fontWeight:600}}>🇺🇸 {usOpen?"장중":usLabel}</span>
                {updFmt&&<span style={{fontSize:8,color:C.muted}}>{updFmt}</span>}
              </>;
            })()}
            {dataStatus==="sim"&&<span style={{fontSize:9,color:C.yellow}}>🟡 시뮬</span>}
          </div>
          <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
            <div style={{position:"relative"}}>
              <input value={search} onChange={e=>{setSearch(e.target.value);setShowSearch(true);}} onFocus={()=>setShowSearch(true)}
                onKeyDown={e=>{if(e.key==="Enter"&&search.trim()){const q=search.trim(),qUp=q.toUpperCase();const krMatch=KR_NAME_DB[q]||KR_NAME_DB[qUp]||Object.entries(KR_NAME_DB).find(([k])=>k.includes(q))?.[1];const ticker=krMatch||qUp;const found=[...stocks,...Object.entries(SEARCH_DB).map(([t,v])=>({ticker:t,...v}))].find(s=>s.ticker===ticker);if(found){addStock(found);}else{const poolMatch=Object.entries(pool).find(([t,v])=>t===ticker||(v.label||"").includes(q));if(poolMatch){navigateToStock(poolMatch[0],{ticker:poolMatch[0],...poolMatch[1]});}else{addStock({ticker,label:q,_custom:true});}}setShowSearch(false);}}}
                placeholder="🔍 종목 검색" style={{background:"rgba(148,163,184,.05)",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 10px",color:C.text,fontSize:10,outline:"none",width:130}}/>
              {(showSearch&&(searchLoading||searchRes.length>0))&&<div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:"#1E293B",border:`1px solid ${C.border}`,borderRadius:7,zIndex:200,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,.8)"}}>
                {searchLoading&&<div style={{padding:"10px 12px",color:C.muted,fontSize:10}}>🔍 검색 중...</div>}
                {!searchLoading&&searchRes.map((r,i)=><div key={i} onClick={()=>addStock(r)} style={{padding:"7px 11px",cursor:"pointer",borderBottom:"1px solid rgba(148,163,184,.05)",display:"flex",justifyContent:"space-between"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(59,130,246,.1)"} onMouseLeave={e=>e.currentTarget.style.background=""}><span style={{color:r._custom?C.accent:C.text,fontWeight:700}}>{r.label} <span style={{color:C.muted,fontSize:8}}>{r._custom?"":r.ticker}</span></span><span style={{color:r._custom?C.accent:C.sub,fontSize:8}}>{r.market||"🔍"}</span></div>)}
              </div>}
            </div>
            <button onClick={()=>setShowRiskPanel(v=>!v)} style={{fontSize:10,padding:"5px 8px",borderRadius:5,border:`1px solid ${showRiskPanel?C.accent:C.border}`,background:showRiskPanel?"rgba(59,130,246,.12)":"transparent",color:showRiskPanel?C.accent:C.muted,cursor:"pointer",fontWeight:600}}>⚙</button>
            <button onClick={()=>setShowManualEntry(v=>!v)} style={{fontSize:10,padding:"5px 8px",borderRadius:5,border:`1px solid ${showManualEntry?C.emerald:C.border}`,background:showManualEntry?"rgba(34,197,94,.12)":"transparent",color:showManualEntry?C.emerald:C.muted,cursor:"pointer",fontWeight:600}}>📝</button>
          </div>
        </div>
        {addMsg&&<div style={{fontSize:8,color:C.green,marginBottom:4}}>{addMsg}</div>}
        {/* ★ 수동 보유종목 등록 */}
        {showManualEntry&&<div style={{position:"absolute",top:"100%",left:14,right:14,background:"#1A2332",border:`1px solid ${C.emerald}`,borderRadius:14,padding:16,zIndex:100,boxShadow:"0 8px 32px rgba(0,0,0,.8)"}}>
          <div style={{fontSize:12,fontWeight:900,color:C.emerald,marginBottom:12}}>📝 보유종목 수동 등록</div>
          <div style={{fontSize:8,color:C.muted,marginBottom:12}}>기존 보유 종목을 직접 입력해서 추적에 추가합니다</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <div>
              <div style={{fontSize:9,color:C.muted,marginBottom:4}}>종목명 또는 티커</div>
              <input id="manual_ticker" placeholder="예: 삼성전자, NVDA" style={{width:"100%",background:"rgba(255,255,255,.07)",border:`1px solid ${C.border}`,borderRadius:6,padding:"6px 8px",color:C.text,fontSize:10,outline:"none"}}/>
            </div>
            <div>
              <div style={{fontSize:9,color:C.muted,marginBottom:4}}>매수일</div>
              <input id="manual_date" type="date" defaultValue={new Date().toISOString().slice(0,10)} style={{width:"100%",background:"rgba(255,255,255,.07)",border:`1px solid ${C.border}`,borderRadius:6,padding:"6px 8px",color:C.text,fontSize:10,outline:"none"}}/>
            </div>
            <div>
              <div style={{fontSize:9,color:C.muted,marginBottom:4}}>매수가 (1주당)</div>
              <input id="manual_price" type="number" placeholder="예: 82000" style={{width:"100%",background:"rgba(255,255,255,.07)",border:`1px solid ${C.border}`,borderRadius:6,padding:"6px 8px",color:C.text,fontSize:10,outline:"none"}}/>
            </div>
            <div>
              <div style={{fontSize:9,color:C.muted,marginBottom:4}}>투입 금액 (만원)</div>
              <input id="manual_amount" type="number" placeholder="예: 100" style={{width:"100%",background:"rgba(255,255,255,.07)",border:`1px solid ${C.border}`,borderRadius:6,padding:"6px 8px",color:C.text,fontSize:10,outline:"none"}}/>
            </div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{
              const tickerInput=document.getElementById("manual_ticker")?.value?.trim();
              const dateInput=document.getElementById("manual_date")?.value;
              const priceInput=+document.getElementById("manual_price")?.value;
              const amtInput=+document.getElementById("manual_amount")?.value*10000;
              if(!tickerInput||!priceInput||!amtInput){setAddMsg("❌ 종목/매수가/금액을 모두 입력하세요");setTimeout(()=>setAddMsg(""),3000);return;}
              const qUp=tickerInput.toUpperCase();
              const krMatch=KR_NAME_DB[tickerInput]||KR_NAME_DB[qUp]||Object.entries(KR_NAME_DB).find(([k])=>k.includes(tickerInput))?.[1];
              const poolMatch=Object.entries(pool).find(([t,v])=>t===tickerInput||t===(krMatch||qUp)||(v.label||"").includes(tickerInput));
              const ticker=krMatch||poolMatch?.[0]||qUp;
              const label=poolMatch?.[1]?.label||tickerInput;
              const market=poolMatch?.[1]?.market||(/^\d{6}$/.test(ticker)?"kr":"us");
              const isKR=market==="kr";
              const entryDate=dateInput?new Date(dateInput).toLocaleDateString("ko-KR"):new Date().toLocaleDateString("ko-KR");
              const autoMode=amtInput>(riskSettings.totalCapital||5000000)?"special":"basic";
              const autoCap=autoMode==="special"?(riskSettings.specialCapital||10000000):(riskSettings.totalCapital||5000000);
              const autoPyr=autoMode==="special"?PYRAMID_SPECIAL:PYRAMID_BASIC;
              // 불타기 단계 중 투입금액까지 자동 채우기
              let remaining=amtInput;
              const pyramid=autoPyr.map((r,i)=>{
                const stepAmt=Math.round(autoCap*r.pct/100);
                const filled=remaining>=stepAmt;
                const actual=filled?stepAmt:Math.max(0,remaining);
                remaining-=actual;
                return{step:i+1,label:r.label,pct:r.pct,targetPct:r.targetPct,triggered:actual>0,amount:stepAmt,actualAmount:actual,executedAt:actual>0?entryDate:""};
              });
              // ★ 트레일링 계산: 현재가 + 매수일 이후 최고가 조회
              const curInfo2=stocks.find(s=>s.ticker===ticker)||pool[ticker];
              const curPrice2=curInfo2?.price||priceInput;
              const cData2=charts[ticker]?.data;
              let maxPrice2=Math.max(priceInput,curPrice2);
              if(cData2&&dateInput){
                const entryMo=new Date(dateInput).getMonth()+1;const entryDa=new Date(dateInput).getDate();
                let started=false;
                cData2.forEach(d=>{
                  if(!started){const dd=d.date||"";if(dd.includes(`${entryMo}/${entryDa}`)||dd.includes(`${entryMo}-${entryDa}`)||new Date(dd)>=new Date(dateInput))started=true;}
                  if(started&&d.close>maxPrice2)maxPrice2=d.close;
                });
              }
              const pnl2=+((curPrice2-priceInput)/priceInput*100).toFixed(2);
              const trailMode2=pnl2>=trailSettings.switchPct;
              const trailStop2=trailMode2
                ?+(maxPrice2*(1-trailSettings.trailPct/100)).toFixed(isKR?0:2)
                :+(priceInput*(1-trailSettings.initialStopPct/100)).toFixed(isKR?0:2);
              setPositions(p=>[...p,{id:Date.now(),ticker,label,market,entry:priceInput,current:curPrice2,max:maxPrice2,trailStop:trailStop2,trailMode:trailMode2,target:0,pnl:pnl2,date:entryDate,entryTime:"수동등록",foundScore:0,foundSignals:["수동등록"],source:"수동",foundTiming:0,foundDurability:0,snapshot:{},oppScoreAt:0,investMode:autoMode,pyramid}]);
              setShowManualEntry(false);setTab("track");setTrackTab("hold");
              setAddMsg(`📝 ${label} ₩${fmtKRW(amtInput)} 수동 등록 (${autoMode==="special"?"⭐특별":"기본"})`);setTimeout(()=>setAddMsg(""),3000);
            }} style={{flex:1,background:"linear-gradient(135deg,#22C55E,#16A34A)",border:"none",borderRadius:8,padding:"10px",color:"#fff",fontWeight:900,fontSize:11,cursor:"pointer"}}>📝 보유 등록</button>
            <button onClick={()=>setShowManualEntry(false)} style={{padding:"10px 16px",borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,fontSize:10,cursor:"pointer"}}>취소</button>
          </div>
        </div>}
        {/* 리스크 설정 패널 */}
        {showRiskPanel&&<div style={{position:"absolute",top:"100%",left:14,right:14,background:"#1A2332",border:`1px solid ${C.accent}`,borderRadius:14,padding:16,zIndex:100,boxShadow:"0 8px 32px rgba(0,0,0,.8)",maxHeight:"80vh",overflowY:"auto"}}>
          <div style={{fontSize:12,fontWeight:900,color:C.accent,marginBottom:12}}>⚙ 리스크 관리 센터</div>

          {/* 투자 모드 토글 */}
          <div style={{display:"flex",gap:6,marginBottom:14}}>
            {[["basic","기본 (₩"+fmtKRW(riskSettings.totalCapital)+")"],["special","특별 (₩"+fmtKRW(riskSettings.specialCapital||10000000)+")"]].map(([k,l])=>(
              <button key={k} onClick={()=>setRiskSettings(p=>({...p,investMode:k}))} style={{flex:1,padding:"8px",borderRadius:8,border:`2px solid ${riskSettings.investMode===k?C.accent:C.border}`,background:riskSettings.investMode===k?"rgba(59,130,246,.15)":"rgba(148,163,184,.03)",color:riskSettings.investMode===k?C.accent:C.muted,fontSize:10,fontWeight:700,cursor:"pointer"}}>{k==="special"?"⭐ ":""}{l}</button>
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
              <input type="range" min="5" max="30" value={trailSettings.timeCutDays||14} onChange={e=>setTrailSettings(p=>({...p,timeCutDays:+e.target.value}))} style={{width:"100%",accentColor:"#F97316"}}/>
              <div style={{fontSize:11,fontWeight:700,color:"#F97316",textAlign:"center"}}>{trailSettings.timeCutDays||14}일</div>
            </div>
            <div>
              <div style={{fontSize:8,color:C.muted,marginBottom:4}}>⏰ 박스권 범위</div>
              <input type="range" min="1" max="8" step="0.5" value={trailSettings.timeCutPct||3} onChange={e=>setTrailSettings(p=>({...p,timeCutPct:+e.target.value}))} style={{width:"100%",accentColor:"#F97316"}}/>
              <div style={{fontSize:11,fontWeight:700,color:"#F97316",textAlign:"center"}}>±{trailSettings.timeCutPct||3}%</div>
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
                return <div key={i} style={{background:"rgba(139,92,246,.06)",border:`1px solid rgba(139,92,246,.2)`,borderRadius:8,padding:"6px",textAlign:"center"}}>
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
              <div style={{background:"rgba(239,68,68,.06)",borderRadius:6,padding:"6px",textAlign:"center"}}>
                <div style={{fontSize:7,color:C.red}}>보초 손절 (-{trailSettings.initialStopPct}%)</div>
                <div style={{fontSize:12,fontWeight:900,color:C.red}}>-₩{fmtKRW(Math.round(pyramidAmts[0]*trailSettings.initialStopPct/100))}</div>
                <div style={{fontSize:7,color:C.muted}}>₩{fmtKRW(pyramidAmts[0])}의 {trailSettings.initialStopPct}%</div>
              </div>
              <div style={{background:"rgba(245,158,11,.06)",borderRadius:6,padding:"6px",textAlign:"center"}}>
                <div style={{fontSize:7,color:C.yellow}}>트레일링 전환</div>
                <div style={{fontSize:12,fontWeight:900,color:C.yellow}}>+{trailSettings.switchPct}%</div>
                <div style={{fontSize:7,color:C.muted}}>이후 고점-{trailSettings.trailPct}%</div>
              </div>
              <div style={{background:"rgba(249,115,22,.06)",borderRadius:6,padding:"6px",textAlign:"center"}}>
                <div style={{fontSize:7,color:"#F97316"}}>타임컷</div>
                <div style={{fontSize:12,fontWeight:900,color:"#F97316"}}>{trailSettings.timeCutDays||14}일</div>
                <div style={{fontSize:7,color:C.muted}}>±{trailSettings.timeCutPct||3}% 이내</div>
              </div>
            </div>
          </div>

          <div style={{display:"flex",justifyContent:"flex-end",marginTop:12}}>
            <button onClick={()=>setShowRiskPanel(false)} style={{...css.btn(true),fontSize:10,padding:"6px 16px"}}>닫기</button>
          </div>
        </div>}
        {/* 2행: 탭바 */}
        <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:`1px solid ${C.border}`,overflowX:"auto"}}>
          {TABS.map(([k,l])=><button key={k} onClick={()=>setTab(k)} style={{background:tab===k?"rgba(59,130,246,.18)":"transparent",color:tab===k?C.accent:C.muted,border:"none",padding:"5px 7px",cursor:"pointer",fontSize:8,fontWeight:tab===k?700:400,whiteSpace:"nowrap"}}>{l}</button>)}
        </div>
      </div>

      {/* ── 종목바 ───────────────────────────────── */}
      <div style={{display:"flex",gap:4,padding:"5px 12px",overflowX:"auto",borderBottom:`1px solid ${C.border}`,background:"#111827",alignItems:"center",flexShrink:0}}>
        <span style={{color:C.muted,fontSize:9,flexShrink:0}}>{stocks.length}종목</span>
        {stocks.map(stk=>{
          const sg=getStockSig(charts[stk.ticker]?.data);
          const ss=SIG[sg]||SIG.HOLD;
          const cd2=charts[stk.ticker]?.data;
          const isFlip=cd2&&cd2.length>=2&&cd2.at(-1)?.bullCount===3&&cd2.at(-2)?.bullCount<3;
          return<div key={stk.ticker} style={{flexShrink:0,display:"flex"}}>
            <button onClick={()=>{setSel(stk.ticker);setTab("sniper");}} style={{background:sel===stk.ticker?"rgba(59,130,246,.18)":"transparent",border:`1px solid ${sel===stk.ticker?C.accent:C.border}`,borderRadius:"5px 0 0 5px",padding:"3px 6px",cursor:"pointer",display:"flex",flexDirection:"column"}}>
              <div style={{display:"flex",gap:3,alignItems:"center"}}>
                {isFlip&&<span style={{fontSize:7}}>🚀</span>}
                <span style={{color:sel===stk.ticker?C.accent:C.text,fontSize:10,fontWeight:700,maxWidth:52,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fmtName(stk)}</span>
                <span style={{...ss,borderRadius:3,padding:"0 4px",fontWeight:900,fontSize:8,display:"inline-block"}}>{sg[0]}</span>
              </div>
              {stk.changePct!=null&&<span style={{fontSize:8,color:stk.changePct>=0?C.green:C.red}}>{stk.changePct>=0?"+":""}{stk.changePct?.toFixed?.(1)}%</span>}
            </button>
            <button onClick={()=>removeStock(stk.ticker)} style={{background:"rgba(239,68,68,.06)",border:`1px solid ${C.border}`,borderLeft:"none",borderRadius:"0 5px 5px 0",padding:"2px 5px",cursor:"pointer",color:C.muted,fontSize:9}}>✕</button>
          </div>;
        })}
      </div>

      {/* ── ★ v2.2: 알림 배너 ─────────────────────── */}
      {alerts.length>0&&<div style={{background:"#111827",borderBottom:`1px solid ${C.border}`,padding:"0 12px",maxHeight:80,overflowY:"auto"}}>
        {alerts.slice(0,3).map(a=>(
          <div key={a.id} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",borderBottom:"1px solid rgba(148,163,184,.03)",animation:"pulse 2s ease-in-out 3"}}>
            <span style={{fontSize:10}}>{a.type==="pyramid"?"🔥":a.type==="target"?"🎯":a.type==="stop"?"🚨":"⏰"}</span>
            <span style={{fontSize:9,color:a.type==="stop"?C.red:a.type==="pyramid"?C.emerald:a.type==="target"?C.accent:"#F97316",flex:1,fontWeight:600}}>{a.msg}</span>
            <span style={{fontSize:7,color:C.muted}}>{a.time}</span>
            <button onClick={()=>setAlerts(p=>p.filter(x=>x.id!==a.id))} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:9,padding:0}}>✕</button>
          </div>
        ))}
        {alerts.length>3&&<div style={{fontSize:8,color:C.muted,textAlign:"center",padding:2,cursor:"pointer"}} onClick={()=>setAlerts([])}>+{alerts.length-3}개 더 · 모두 지우기</div>}
      </div>}

      {/* ── 콘텐츠 ───────────────────────────────── */}
      <div style={{flex:1,overflow:"auto"}} onClick={()=>setShowSearch(false)}>

        {/* ══ TAB 1: 시장레이더 ══ */}
        {tab==="radar"&&<div style={{padding:"10px 10px"}}>
          <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8,borderLeft:`3px solid ${C.accent}`,paddingLeft:8}}>글로벌 지수 현황</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:6}}>
            {[["^GSPC","S&P","🇺🇸"],["^IXIC","NDQ","🇺🇸"],["^KS11","KOSPI","🇰🇷"]].map(([k,name,flag])=>{
              const d=indicesData[k];const pct=d?.changePct??0;const hasData=d&&d.price>0;
              return<div key={k} onClick={()=>setSelIndex(selIndex===k?null:k)} style={{border:`1px solid ${selIndex===k?C.accent:hasData?(pct>=0?"rgba(34,197,94,.3)":"rgba(239,68,68,.3)"):C.border}`,borderRadius:8,padding:"8px 10px",background:selIndex===k?"rgba(59,130,246,.08)":C.panel2,cursor:"pointer"}}>
                <div style={{fontSize:10,color:C.muted,marginBottom:3,fontWeight:600}}>{flag} {name}</div>
                <div style={{fontSize:18,fontWeight:900,marginBottom:1}}>{hasData?d.price.toLocaleString("ko-KR",{maximumFractionDigits:0}):"—"}</div>
                <div style={{color:pct>=0?C.green:C.red,fontWeight:700,fontSize:11}}>{hasData?`${pct>=0?"+":""}${(pct||0).toFixed(2)}%`:"—"}</div>
                {hasData&&<div style={{fontSize:7,color:C.muted,marginTop:2}}>3D {(d.chg3d||0)>=0?"+":""}{(d.chg3d||0).toFixed(1)}%</div>}
              </div>;
            })}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4,marginBottom:6}}>
            {[["^VIX","VIX","⚡",v=>v<20?"안정":v<30?"주의":"위험",v=>v<20?C.emerald:v<30?C.yellow:C.red],
              ["KRW=X","원/달러","💱",v=>`${v?.toFixed(0)||"—"}`,()=>C.text],
              ["^TNX","10Y","📈",v=>`${v?.toFixed(2)||"—"}%`,v=>v>4.5?C.red:v>3.5?C.yellow:C.emerald],
              ["GC=F","금","🥇",v=>`$${v?.toLocaleString()||"—"}`,()=>C.text],
            ].map(([k,name,flag,fmt,color])=>{
              const d=indicesData[k];const val=d?.price;const pct=d?.changePct??0;
              return<div key={k} onClick={()=>setSelIndex(selIndex===k?null:k)} style={{border:`1px solid ${selIndex===k?C.accent:C.border}`,borderRadius:7,padding:"5px 6px",background:selIndex===k?"rgba(59,130,246,.08)":C.panel2,cursor:"pointer"}}>
                <div style={{fontSize:7,color:C.muted,marginBottom:1}}>{flag}{name}</div>
                <div style={{fontSize:11,fontWeight:900,color:color(val)}}>{val?fmt(val):"—"}</div>
                <div style={{fontSize:8,color:pct>=0?C.green:C.red,fontWeight:700}}>{pct>=0?"+":""}{(pct||0).toFixed(1)}%</div>
              </div>;
            })}
          </div>
          {/* ★ v2.3: 공포탐욕지수 */}
          {fearGreed.score>0&&<div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",marginBottom:6,background:C.panel2,borderRadius:8,border:`1px solid ${fearGreed.score>=60?"rgba(34,197,94,.3)":fearGreed.score>=40?"rgba(245,158,11,.3)":"rgba(239,68,68,.3)"}`}}>
            <span style={{fontSize:9,color:C.muted}}>😱 공포탐욕</span>
            <span style={{fontSize:18,fontWeight:900,color:fearGreed.score>=75?C.emerald:fearGreed.score>=55?C.green:fearGreed.score>=40?C.yellow:fearGreed.score>=25?C.red:"#DC2626"}}>{Math.round(fearGreed.score)}</span>
            <span style={{fontSize:8,fontWeight:700,color:fearGreed.score>=75?C.emerald:fearGreed.score>=55?C.green:fearGreed.score>=40?C.yellow:fearGreed.score>=25?C.red:"#DC2626"}}>{fearGreed.score>=75?"극도의 탐욕":fearGreed.score>=55?"탐욕":fearGreed.score>=40?"중립":fearGreed.score>=25?"공포":"극도의 공포"}</span>
            {fearGreed.prevClose>0&&<span style={{fontSize:7,color:C.muted,marginLeft:"auto"}}>전일 {Math.round(fearGreed.prevClose)}</span>}
          </div>}
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
                  <CartesianGrid stroke="rgba(148,163,184,.05)"/>
                  <XAxis dataKey="date" tick={{fill:C.muted,fontSize:7}} tickLine={false} interval={Math.floor(chartD.length/5)||1}/>
                  <YAxis domain={[minP*0.998,maxP*1.002]} tick={{fill:C.muted,fontSize:7}} tickLine={false} width={50} tickFormatter={v=>v>=10000?`${(v/1000).toFixed(0)}k`:v.toFixed(1)}/>
                  <Tooltip content={<Tip/>}/>
                  <Area type="monotone" dataKey="close" stroke={pct>=0?C.emerald:C.red} fill={pct>=0?"rgba(34,197,94,.1)":"rgba(239,68,68,.1)"} strokeWidth={2} dot={false}/>
                </ComposedChart>
              </ResponsiveContainer>
            </div>;
          })()}
          <div style={{marginBottom:10}}>
            {/* ★ v2.3: 시장 너비 + 기회점수 통합 바 */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:10}}>
              {[["🇺🇸","us",oppScoreUS,oppColorUS,spChg3d,"S&P"],["🇰🇷","kr",oppScoreKR,oppColorKR,kospiChg3d,"KSP"]].map(([flag,mkt,opp,oppC,chg,idx])=>{
                const bd=breadthData[mkt]||{upPct:0,up:0,down:0};
                return<div key={mkt} style={{background:C.panel2,border:`1px solid ${oppC}`,borderRadius:8,padding:"8px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <span style={{fontSize:8,color:C.muted}}>{flag} 기회</span>
                    <span style={{fontSize:18,fontWeight:900,color:oppC}}>{opp}<span style={{fontSize:8,color:C.muted}}>/100</span></span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:4}}>
                    <div style={{flex:1,height:5,background:"rgba(148,163,184,.12)",borderRadius:3,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${bd.upPct}%`,background:bd.upPct>=50?C.emerald:C.red,borderRadius:3}}/>
                    </div>
                    <span style={{fontSize:7,color:bd.upPct>=50?C.green:C.red,fontWeight:700,minWidth:28}}>{bd.upPct}%↑</span>
                  </div>
                  <div style={{fontSize:7,color:C.muted}}>{idx} {chg>=0?"+":""}{chg.toFixed(1)}% · ▲{bd.up} ▼{bd.down}</div>
                </div>;
              })}
            </div>

            {/* 섹터 히트맵 */}
            <div style={css.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:700,color:C.accent}}>📊 섹터 RS</div>
                <select value={rsKey} onChange={e=>setRsKey(e.target.value)} style={{background:"rgba(148,163,184,.05)",border:`1px solid ${C.border}`,borderRadius:5,padding:"2px 6px",color:C.text,fontSize:9}}>
                  <option value="chg1W">1주</option><option value="chg1M">1개월</option>
                </select>
              </div>
              {[["🇺🇸 미국 vs S&P500","us","spy"],["🇰🇷 한국 vs KOSPI","kr","kospi"]].map(([label,mkt,ref])=>{
                const filtered=[...SECTOR_RS].filter(s=>s.market===mkt).sort((a,b)=>b[rsKey]-a[rsKey]);
                const allZero=filtered.length>0&&filtered.every(s=>(s[rsKey]||0)===0);
                if(!filtered.length)return<div key={mkt} style={{marginBottom:8}}><div style={{fontSize:8,color:C.muted}}>{label}</div><div style={{fontSize:8,color:C.yellow,padding:4}}>섹터 데이터 없음 — Daily Actions에서 {mkt==="us"?"미국":"한국"} 섹터 수집 필요</div></div>;
                const refVal=rsKey==="chg1W"?(idxRS[ref]?.chg3d||0):(idxRS[ref]?.chg5d||0);
                return<div key={mkt} style={{marginBottom:10}}>
                  <div style={{fontSize:8,fontWeight:700,color:C.muted,marginBottom:4}}>{label}{allZero&&<span style={{color:C.yellow,marginLeft:6}}>⚠ 데이터 미갱신</span>}</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:2}}>
                    {filtered.map((sec,i)=>{
                      const v=sec[rsKey]||0,excess=+(v-refVal).toFixed(1),isTop=i<2;
                      const bg=excess>=3?"rgba(34,197,94,.45)":excess>=0?"rgba(34,197,94,.2)":excess>-3?"rgba(250,204,21,.2)":"rgba(239,68,68,.3)";
                      return<div key={sec.etf} onClick={()=>setSelectedSector(selectedSector===sec.etf?null:sec.etf)} style={{background:bg,borderRadius:4,padding:"4px 2px",border:selectedSector===sec.etf?`2px solid ${C.accent}`:isTop?`1px solid ${C.emerald}`:"1px solid rgba(148,163,184,.05)",cursor:"pointer",textAlign:"center"}}>
                        <div style={{fontSize:6,fontWeight:700,color:isTop?C.emerald:C.sub}}>{sec.name}</div>
                        <div style={{fontSize:10,fontWeight:700,color:v>=0?C.green:C.red}}>{v>=0?"+":""}{v.toFixed(1)}%</div>
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
                return<div style={{marginTop:8,background:"rgba(59,130,246,.06)",border:`1px solid rgba(59,130,246,.15)`,borderRadius:7,padding:"8px 10px"}}>
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
                      <Area type="monotone" dataKey="close" stroke={(sec.chg1M||0)>=0?C.emerald:C.red} fill={(sec.chg1M||0)>=0?"rgba(34,197,94,.1)":"rgba(239,68,68,.1)"} strokeWidth={2} dot={false}/>
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
                      return<div key={ticker} style={{background:"rgba(148,163,184,.05)",borderRadius:5,padding:"4px 8px",display:"flex",gap:6,alignItems:"center",cursor:"pointer"}} onClick={()=>navigateToStock(ticker,{...pInfo,...s,label})}>
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
          </div>

        </div>}

        {/* ══ TAB: 집중 — 오늘의 통합 추천 ══ */}
        {tab==="focus"&&<div style={{padding:"12px 14px"}}>
          <div style={{fontSize:13,fontWeight:900,color:C.accent,marginBottom:4,borderLeft:`3px solid ${C.accent}`,paddingLeft:8}}>🎯 오늘의 추천</div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:9,color:C.sub}}>모든 기법 통합 스캔 — 다중 기법 매칭 종목 우선</div>
            {lastUpdated&&<div style={{fontSize:7,color:C.muted}}>📡 {lastUpdated}</div>}
          </div>
          <div style={{display:"flex",gap:4,marginBottom:10}}>
            {[["all","전체"],["kr","🇰🇷 한국"],["us","🇺🇸 미국"]].map(([v,l])=>(
              <button key={v} onClick={()=>setFocusMarket(v)} style={{padding:"4px 12px",borderRadius:5,border:`1px solid ${focusMarket===v?C.accent:C.border}`,background:focusMarket===v?"rgba(59,130,246,.12)":"transparent",color:focusMarket===v?C.accent:C.muted,fontSize:9,fontWeight:focusMarket===v?700:400,cursor:"pointer"}}>{l}</button>
            ))}
          </div>
          {/* 시장 상태 경고 */}
          {oppScore<45&&<div style={{padding:"8px 12px",marginBottom:8,background:"rgba(239,68,68,.08)",borderRadius:8,border:"1px solid rgba(239,68,68,.2)"}}>
            <div style={{fontSize:9,fontWeight:700,color:C.red}}>⚠️ 기회점수 {Math.round(oppScore)} LOW — 매수 비추천 구간</div>
            <div style={{fontSize:8,color:C.muted}}>시장 환경이 불리합니다. 아래 추천은 참고만 하고 현금 비중을 높이세요.</div>
          </div>}
          {oppScore>=45&&oppScore<70&&<div style={{padding:"6px 12px",marginBottom:8,background:"rgba(245,158,11,.06)",borderRadius:8,border:"1px solid rgba(245,158,11,.15)"}}>
            <div style={{fontSize:8,color:"#F59E0B"}}>🟡 기회점수 {Math.round(oppScore)} — 선별적 매수. 확실한 종목만.</div>
          </div>}
          {(()=>{
          const realStocks = allStocksForScan.filter(s=>charts[s.ticker]?.real).filter(s=>focusMarket==="all"?true:focusMarket==="kr"?((s.ticker?.length||0)>5||(s.market||"").includes("kr")):((s.ticker?.length||0)<=5&&!(s.market||"").includes("kr"))).filter(s=>{
            const isKR2=(s.ticker?.length||0)>5||(s.market||"").includes("kr");
            if(!isKR2&&s.mktCap>0&&s.mktCap<3)return false;
            if(isKR2&&s.mktCap>0&&s.mktCap<1000)return false; // 한국 시총 1000억 미만 제외
            return true;
          });
          if(!realStocks.length)return<div style={{textAlign:"center",padding:"20px",color:C.muted,fontSize:9}}>실시간 데이터 로딩 중... Daily Actions 실행 후 확인해주세요</div>;

          // 기회점수 LOW 경고
          const oppWarn=oppScore<45;

          // ★ 모든 기법 통합 스캔
          const unified=realStocks.map(s=>{
            const cd=charts[s.ticker]?.data;if(!cd||cd.length<10)return null;
            const L=cd.length;const last=cd[L-1];const prev=cd[L-2];if(!last||!prev)return null;
            const tags=[];
            // 1. AI추천 (alphaScore 75+)
            const asc=alphaScore(s,cd,idxRS);
            if(asc.score>=75)tags.push({tag:"AI추천",color:C.purple,score:asc.score+"pt"});
            // 2. 돌파감지 (신호 2개+ 동시)
            const stT=[last.st1Bull,last.st2Bull,last.st3Bull].filter(v=>v!=null).length;
            const stY=[prev.st1Bull,prev.st2Bull,prev.st3Bull].filter(v=>v!=null).length;
            let bkSigs=0;
            if(stT>stY)bkSigs++;if(last.macd>last.signal&&prev.macd<=prev.signal)bkSigs++;
            if(last.aboveCloud&&!prev.aboveCloud)bkSigs++;if(last.sqzOff&&prev.sqzOn)bkSigs++;
            const vols=cd.slice(-21,-1).map(d=>d.volume||0).filter(v=>v>0);
            const avgVol=vols.length?vols.reduce((a,b)=>a+b,0)/vols.length:0;
            if(avgVol>0&&last.volume>avgVol*2)bkSigs++;
            if(bkSigs>=2)tags.push({tag:"돌파",color:C.emerald,score:bkSigs+"개"});
            // 3. 진입적기 (⚡55+💪55+)
            const tm=calcEntryTiming(cd);const dr=calcTrendDurability(cd);
            if(tm.score>=stratCfg.entry.timingMin&&dr.score>=stratCfg.entry.durMin)tags.push({tag:"진입적기",color:C.accent,score:"⚡"+tm.score});
            // 4. D+0 (4/6+)
            const closes=cd.map(x=>x.close);const prevHigh=Math.max(...closes.slice(0,-5));
            const volR=s.volRatio||s._volRatio||100;
            const rs2=asc.rs||0;const bodyPct=last.bodyPct||0;const uW=last.upperWickPct||0;
            const d0c=[last.close>=prevHigh*0.98,bodyPct>=stratCfg.d0.bodyPct,volR>=stratCfg.d0.volMin,rs2>0,last.isBull,last.isBull&&uW<20].filter(Boolean).length;
            if(d0c>=stratCfg.d0.minScore)tags.push({tag:"D+0",color:"#F97316",score:d0c+"/6"});
            // 5. 6체크 (4/6+)
            const w52h=Math.max(...closes);
            const sjc=[last.close>=w52h*(stratCfg.sj.highPct/100),last.close>=prevHigh*(stratCfg.sj.highPct/100),last.isBull&&volR>=stratCfg.d0.volMin,volR>=stratCfg.d0.volMin,last.isBull&&uW<20,last.sqzOff||(!last.sqzOn&&prev?.sqzOn)].filter(Boolean).length;
            if(sjc>=stratCfg.sj.minScore)tags.push({tag:"6체크",color:C.emerald,score:sjc+"/6"});
            // 6. 전환초기 (5/6+)
            const rsiR=(last.rsi||0)>(prev.rsi||0)&&(last.rsi||0)>(cd[L-4]?.rsi||0)&&(last.rsi||0)>=40;
            const nearCl=last.nearCloud||last.inCloud||(last.spanHigh&&last.close>=last.spanLow*0.97&&last.close<=last.spanHigh*1.03);
            const macdU2=(last.macd>last.signal)||(last.hist>0&&prev?.hist<=0)||(last.hist>(prev?.hist||0));
            const trc=[(stT>=2&&stY<stT)||stT===2,rsiR,nearCl,rs2>0,volR>=stratCfg.tr.volMin,macdU2].filter(Boolean).length;
            if(trc>=stratCfg.tr.minScore)tags.push({tag:"전환초기",color:C.accent,score:trc+"/6"});
            // 7. 편입된 커스텀 조합
            if(customCombos.length>0){
              const keyMap2={"ST 3/3":stT===3,"MACD 양전":last.macd>last.signal,"RSI 50~70":(last.rsi||0)>=50&&(last.rsi||0)<=70,"구름 위":!!last.aboveCloud,"ADX 25+":(last.adx||0)>=25,"거래량 150%+":volR>=150,"스퀴즈해제":!!last.sqzOff,"EMA정배열":(last.ema20||0)>(last.ema50||0)&&(last.ema50||0)>(last.ema200||0)&&(last.ema200||0)>0,"MA20위":last.close>(last.ema20||0)&&(last.ema20||0)>0,"3연속양봉":last.isBull&&prev?.isBull&&(cd[L-3]?.isBull),"거래량3↑":last.volume>(prev?.volume||0)&&(prev?.volume||0)>(cd[L-3]?.volume||0),"RSI50돌파":(last.rsi||0)>=50&&(last.rsi||0)<=55&&(prev?.rsi||0)<50,"갭상승":last.open>(prev?.close||0)*1.01,"20일신고":last.close>=Math.max(...cd.slice(-21,-1).map(x=>x.close)),"MACD가속":(last.hist||0)>(prev?.hist||0)&&(prev?.hist||0)>(cd[L-3]?.hist||0)};
              customCombos.forEach((cc,ci)=>{
                if(cc.keys.every(k=>keyMap2[k]))tags.push({tag:"발굴#"+(ci+1),color:"#F59E0B",score:cc.keys.length+"조건"});
              });
            }
            if(!tags.length)return null;
            return{...s,tags,tagCount:tags.length,score:asc.score,timing:tm.score,durability:dr.score,rs:rs2,stCount:stT,candleClose:last.close};
          }).filter(Boolean).sort((a,b)=>b.tagCount-a.tagCount||b.score-a.score);

          const multiTag=unified.filter(u=>u.tagCount>=2).length;
          return<>
          {/* 기회점수 LOW 경고 */}
          {oppWarn&&<div style={{background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.2)",borderRadius:8,padding:"8px 12px",marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:14}}>⚠️</span>
            <div>
              <div style={{fontSize:9,fontWeight:700,color:C.red}}>기회점수 {oppScore} LOW — 매수 주의</div>
              <div style={{fontSize:7,color:C.muted}}>시장 환경이 불리합니다. 오늘은 관망을 권장합니다.</div>
            </div>
          </div>}
          {/* 요약 카드 */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:12}}>
            <div style={{background:C.panel2,borderRadius:8,padding:"8px",textAlign:"center"}}>
              <div style={{fontSize:7,color:C.muted}}>추천 종목</div>
              <div style={{fontSize:22,fontWeight:900,color:C.accent}}>{unified.length}</div>
            </div>
            <div style={{background:"rgba(139,92,246,.08)",borderRadius:8,padding:"8px",textAlign:"center",border:`1px solid rgba(139,92,246,.2)`}}>
              <div style={{fontSize:7,color:C.purple}}>2기법+ 중복</div>
              <div style={{fontSize:22,fontWeight:900,color:C.purple}}>{multiTag}</div>
              <div style={{fontSize:6,color:C.muted}}>높은 신뢰도</div>
            </div>
            <div style={{background:C.panel2,borderRadius:8,padding:"8px",textAlign:"center"}}>
              <div style={{fontSize:7,color:C.muted}}>스캔 대상</div>
              <div style={{fontSize:22,fontWeight:900,color:C.text}}>{realStocks.length}</div>
            </div>
          </div>

          {/* 기법 필터 */}
          <div style={{display:"flex",gap:3,marginBottom:10,flexWrap:"wrap"}}>
            {[["all","전체",C.accent],["AI추천","AI추천",C.purple],["돌파","돌파",C.emerald],["진입적기","진입적기",C.accent],["D+0","D+0","#F97316"],["6체크","6체크",C.emerald],["전환초기","전환초기",C.accent]].map(([k,l,c])=>(
              <button key={k} onClick={()=>setFocusView(focusView===k?null:k)} style={{padding:"3px 8px",borderRadius:4,fontSize:8,fontWeight:focusView===k||(!focusView&&k==="all")?700:400,border:`1px solid ${focusView===k||((!focusView)&&k==="all")?c:C.border}`,background:focusView===k||((!focusView)&&k==="all")?c+"18":"transparent",color:focusView===k||((!focusView)&&k==="all")?c:C.muted,cursor:"pointer"}}>{l}</button>
            ))}
          </div>

          {/* 통합 종목 리스트 */}
          <div style={{maxHeight:600,overflowY:"auto"}}>
            {unified.filter(u=>!focusView||focusView==="all"||u.tags.some(t=>t.tag===focusView)).map((s,i)=>(
              <div key={s.ticker} onClick={()=>navigateToStock(s.ticker,s,"집중_통합")} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 8px",borderBottom:`1px solid rgba(148,163,184,.04)`,cursor:"pointer",background:s.tagCount>=3?"rgba(139,92,246,.06)":s.tagCount>=2?"rgba(59,130,246,.04)":"transparent"}}>
                <span style={{fontSize:9,fontWeight:900,color:s.tagCount>=2?C.purple:C.muted,minWidth:14}}>{i+1}</span>
                <div style={{minWidth:60,maxWidth:80}}>
                  <div style={{fontWeight:700,fontSize:9,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fmtName(s)}</div>
                  <div style={{fontSize:7,color:C.muted}}>{(s.ticker?.length||0)>5?"₩"+fmtKRW(s.price||0):"$"+(s.price||0).toFixed(1)}</div>
                </div>
                <div style={{display:"flex",gap:2,flex:1,flexWrap:"wrap"}}>
                  {s.tags.map((t,j)=><span key={j} style={{fontSize:6,padding:"1px 4px",borderRadius:2,background:t.color+"15",color:t.color,fontWeight:700}}>{t.tag} <span style={{fontWeight:400}}>{t.score}</span></span>)}
                </div>
                <div style={{textAlign:"right",minWidth:45}}>
                  <div style={{fontSize:9,fontWeight:700,color:(s.changePct||0)>=0?C.green:C.red}}>{(s.changePct||0)>=0?"+":""}{(s.changePct||0).toFixed(1)}%</div>
                  {(()=>{const div=s.candleClose&&s.price?+((s.price-s.candleClose)/s.candleClose*100).toFixed(1):0;
                    if(Math.abs(div)>=3)return<div style={{fontSize:6,color:C.red,fontWeight:700}}>⚠️ 지표대비 {div>0?"+":""}{div}%</div>;
                    return<div style={{fontSize:7,color:(s.chg3d||0)>=0?C.green:C.red}}>3D {(s.chg3d||0)>=0?"+":""}{(s.chg3d||0).toFixed(1)}%</div>;
                  })()}
                </div>
              </div>
            ))}
          </div>
          {unified.length===0&&<div style={{textAlign:"center",padding:30,color:C.muted,fontSize:9}}>현재 기법 조건을 충족하는 종목이 없습니다</div>}
          </>})()}
        </div>}
        {/* ══ TAB: 🔍 발굴 — TOP40 분석 + 패턴 발견 ══ */}
        {tab==="alpha"&&<div style={{padding:"12px 14px"}}>
          <div style={{fontSize:13,fontWeight:900,color:C.emerald,marginBottom:4,borderLeft:`3px solid ${C.emerald}`,paddingLeft:8}}>🔍 발굴 — 상승주에서 패턴 찾기</div>
          <div style={{fontSize:9,color:C.sub,marginBottom:8}}>캔들 데이터 보유 종목 중 최근 5일 상승 TOP 분석 → 공통 패턴 발견 → 분석탭에 편입</div>
          <div style={{display:"flex",gap:4,marginBottom:10}}>
            {[["all","전체 TOP80"],["kr","🇰🇷 한국 TOP40"],["us","🇺🇸 미국 TOP40"]].map(([v,l])=>(
              <button key={v} onClick={()=>setAlphaMarket(v)} style={{padding:"4px 12px",borderRadius:5,border:`1px solid ${alphaMarket===v?C.emerald:C.border}`,background:alphaMarket===v?"rgba(34,197,94,.1)":"transparent",color:alphaMarket===v?C.emerald:C.muted,fontSize:9,fontWeight:alphaMarket===v?700:400,cursor:"pointer"}}>{l}</button>
            ))}
          </div>
          {(()=>{
            // TOP40 상승주 분석
            const isKRticker=(t)=>(t?.length||0)>5;
            const allReal=Object.entries(charts).filter(([t,c])=>c?.data?.length>=20&&c.real);
            const filtered=allReal.filter(([t])=>alphaMarket==="all"?true:alphaMarket==="kr"?isKRticker(t):!isKRticker(t));
            const top40=filtered.map(([ticker,c])=>{
              const d=c.data;const L=d.length;
              const chg5=L>5?+((d[L-1].close-d[L-6].close)/d[L-6].close*100).toFixed(2):0;
              if(chg5<=0)return null;
              const sp=d[Math.max(0,L-6)];const sp2=d[Math.max(0,L-7)];const sp3=d[Math.max(0,L-8)];
              if(!sp)return null;
              const info=stocks.find(s=>s.ticker===ticker)||pool[ticker]||{};
              const stC=[sp?.st1Bull,sp?.st2Bull,sp?.st3Bull].filter(v=>v!=null).length;
              const macdUp=sp.macd>sp.signal;const rsi=sp.rsi||0;
              const cloud=!!sp.aboveCloud;const adxOk=(sp.adx||0)>=25;
              const volR=(sp.volRatio||100);
              const ema20=sp.ema20||0,ema50=sp.ema50||0,ema200=sp.ema200||0;
              const indicators={
                st:stC===3,macd:macdUp,rsi70:rsi>=50&&rsi<=70,cloud,adx:adxOk,
                volHigh:volR>=150,sqzOff:!!sp.sqzOff,
                emaAlign:ema20>ema50&&ema50>ema200&&ema200>0,
                above20:sp.close>ema20&&ema20>0,
                consUp:sp.isBull&&sp2?.isBull&&sp3?.isBull,
                volUp3:sp.volume>(sp2?.volume||0)&&(sp2?.volume||0)>(sp3?.volume||0)&&sp3?.volume>0,
                rsi50x:rsi>=50&&rsi<=55&&(sp2?.rsi||0)<50,
                gapUp:sp.open>(sp2?.close||0)*1.01,
                highNew:sp.close>=Math.max(...d.slice(Math.max(0,L-26),L-6).map(x=>x.close)),
                histUp:(sp.hist||0)>(sp2?.hist||0)&&(sp2?.hist||0)>(sp3?.hist||0)
              };
              const activeInds=Object.entries(indicators).filter(([k,v])=>v).map(([k])=>k);
              return{ticker,label:info.label||ticker,chg5,indicators,activeInds,price:d[L-1].close,isKR:isKRticker(ticker)};
            }).filter(Boolean).sort((a,b)=>b.chg5-a.chg5).slice(0,alphaMarket==="all"?80:40);
            if(!top40.length)return<div style={{textAlign:"center",padding:30,color:C.muted,fontSize:9}}>최근 5일 상승 종목이 없습니다 — 시장 전체 약세</div>;
            const n=top40.length;
            const indLabels={st:"ST3/3",macd:"MACD양전",rsi70:"RSI50~70",cloud:"구름위",adx:"ADX25+",volHigh:"거래량150%+",sqzOff:"스퀴즈해제",emaAlign:"EMA정배열",above20:"MA20위",consUp:"3연속양봉",volUp3:"거래량3↑",rsi50x:"RSI50돌파",gapUp:"갭상승",highNew:"20일신고",histUp:"MACD가속"};
            const pats=Object.keys(indLabels).map(k=>({k,l:indLabels[k],count:top40.filter(s=>s.indicators[k]).length,pct:Math.round(top40.filter(s=>s.indicators[k]).length/n*100)})).sort((a,b)=>b.pct-a.pct);
            // 조합 발견
            const patKeys=Object.keys(indLabels);
            const combos=[];
            for(let i=0;i<patKeys.length;i++){for(let j=i+1;j<patKeys.length;j++){for(let k=j+1;k<patKeys.length;k++){
              const matched=top40.filter(s=>s.indicators[patKeys[i]]&&s.indicators[patKeys[j]]&&s.indicators[patKeys[k]]);
              if(matched.length>=3)combos.push({keys:[indLabels[patKeys[i]],indLabels[patKeys[j]],indLabels[patKeys[k]]],keyIds:[patKeys[i],patKeys[j],patKeys[k]],count:matched.length,pct:Math.round(matched.length/n*100),avgRet:+(matched.reduce((a,m)=>a+m.chg5,0)/matched.length).toFixed(1),stocks:matched});
            }}}
            combos.sort((a,b)=>b.avgRet-a.avgRet);
            return<>
            {/* 상승 종목 리스트 */}
            <div style={css.card}>
              <div onClick={()=>setScanCardOpen(p=>({...p,top40:!p.top40}))} style={{display:"flex",justifyContent:"space-between",cursor:"pointer",marginBottom:4}}>
                <span style={{fontSize:11,fontWeight:700,color:C.emerald}}>📈 최근 5일 상승 TOP{top40.length} (캔들 데이터 보유)</span>
                <span style={{fontSize:8,color:C.muted}}>{scanCardOpen.top40?"▲":"▼"}</span>
              </div>
              {scanCardOpen.top40!==false&&<div style={{maxHeight:350,overflowY:"auto"}}>
                {top40.map((s,i)=>(
                  <div key={s.ticker} onClick={()=>navigateToStock(s.ticker,s,"발굴_TOP40")} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 6px",borderBottom:`1px solid rgba(148,163,184,.04)`,cursor:"pointer"}}>
                    <span style={{fontSize:9,fontWeight:900,color:i<3?C.emerald:C.muted,minWidth:14}}>{i+1}</span>
                    <div style={{minWidth:55,maxWidth:70}}>
                      <div style={{fontWeight:700,fontSize:9,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.label}</div>
                      <div style={{fontSize:7,color:C.muted}}>{s.isKR?"₩"+fmtKRW(s.price):"$"+s.price.toFixed(1)}</div>
                    </div>
                    <div style={{display:"flex",gap:1,flex:1,flexWrap:"wrap"}}>
                      {s.activeInds.slice(0,5).map(k=><span key={k} style={{fontSize:5,padding:"0px 2px",borderRadius:1,background:"rgba(34,197,94,.08)",color:C.emerald}}>{indLabels[k]}</span>)}
                    </div>
                    <span style={{fontSize:10,fontWeight:900,color:C.green}}>+{s.chg5}%</span>
                  </div>
                ))}
              </div>}
            </div>

            {/* 공통 DNA */}
            <div style={css.card}>
              <div style={{fontSize:11,fontWeight:700,color:C.accent,marginBottom:6}}>📊 공통 DNA — 이 종목들이 오르기 전 공통점</div>
              {pats.map(p=>(
                <div key={p.k} style={{display:"flex",alignItems:"center",gap:4,marginBottom:2}}>
                  <span style={{fontSize:7,color:C.muted,minWidth:60}}>{p.l}</span>
                  <div style={{flex:1,height:5,background:"rgba(148,163,184,.08)",borderRadius:2,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${p.pct}%`,background:p.pct>=70?C.emerald:p.pct>=50?C.green:"#F59E0B",borderRadius:2}}/>
                  </div>
                  <span style={{fontSize:8,fontWeight:700,color:p.pct>=70?C.emerald:C.muted,minWidth:28}}>{p.pct}%</span>
                  <span style={{fontSize:7,color:C.muted}}>{p.count}/{n}</span>
                </div>
              ))}
            </div>

            {/* 조합 발견 + 편입 */}
            {combos.length>0&&<div style={css.card}>
              <div style={{fontSize:11,fontWeight:700,color:"#F59E0B",marginBottom:4}}>🆕 발견된 조합 TOP5 — 분석탭에 편입 가능</div>
              <div style={{fontSize:8,color:C.muted,marginBottom:8}}>클릭하면 매칭 종목 확인 · [📌 편입] 누르면 분석탭에서 기존 기법과 경쟁</div>
              {combos.slice(0,5).map((cb,i)=>{
                const isOpen=expandedCombo===("a"+i);
                const isAdopted=customCombos.some(cc=>cc.keys.join(",")=== cb.keys.join(","));
                return<div key={i} style={{marginBottom:6}}>
                  <div onClick={()=>setExpandedCombo(isOpen?null:"a"+i)} style={{padding:"6px 8px",background:isAdopted?"rgba(139,92,246,.08)":i===0?"rgba(34,197,94,.06)":"rgba(148,163,184,.04)",borderRadius:6,border:isAdopted?`1px solid rgba(139,92,246,.25)`:i===0?`1px solid rgba(34,197,94,.2)`:`1px solid ${C.border}`,cursor:"pointer"}}>
                    <div style={{display:"flex",alignItems:"center",gap:3,marginBottom:2}}>
                      <span style={{fontSize:9,fontWeight:900,color:i===0?"#F59E0B":C.muted}}>{i+1}.</span>
                      {cb.keys.map(k=><span key={k} style={{fontSize:7,padding:"1px 4px",borderRadius:2,background:"rgba(59,130,246,.1)",color:C.accent,fontWeight:600}}>{k}</span>)}
                      <span style={{marginLeft:"auto",fontSize:7,color:C.muted}}>{isOpen?"▲":"▼"} {cb.count}종목</span>
                    </div>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <span style={{fontSize:8,color:C.muted}}>평균 <span style={{color:C.green,fontWeight:700}}>+{cb.avgRet}%</span> · {cb.pct}%{i===0?" 🏆":""}{isAdopted?" ✅편입됨":""}</span>
                      {!isAdopted&&<button onClick={e=>{e.stopPropagation();setCustomCombos(p=>[...p,{keys:cb.keys,addedAt:new Date().toISOString()}]);setComboHistory(p=>[...p,{keys:cb.keys,avgRet:cb.avgRet,count:cb.count,action:"편입",date:new Date().toLocaleDateString("ko-KR")}]);}} style={{fontSize:7,padding:"2px 8px",borderRadius:3,border:`1px solid ${C.purple}`,background:"rgba(139,92,246,.1)",color:C.purple,fontWeight:700,cursor:"pointer"}}>📌 분석탭에 편입</button>}
                      {isAdopted&&<button onClick={e=>{e.stopPropagation();setCustomCombos(p=>p.filter(cc=>cc.keys.join(",")!==cb.keys.join(",")));setComboHistory(p=>[...p,{keys:cb.keys,action:"제거",date:new Date().toLocaleDateString("ko-KR")}]);}} style={{fontSize:7,padding:"2px 6px",borderRadius:3,border:`1px solid ${C.red}`,background:"rgba(239,68,68,.06)",color:C.red,cursor:"pointer"}}>제거</button>}
                    </div>
                  </div>
                  {isOpen&&cb.stocks.length>0&&<div style={{padding:"4px 0",maxHeight:200,overflowY:"auto",background:"rgba(148,163,184,.02)",borderRadius:"0 0 6px 6px"}}>
                    {cb.stocks.sort((a,b)=>b.chg5-a.chg5).slice(0,10).map(ms=>(
                      <div key={ms.ticker} onClick={()=>navigateToStock(ms.ticker,ms,"발굴_패턴")} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",borderBottom:`1px solid rgba(148,163,184,.03)`,cursor:"pointer",fontSize:8}}>
                        <span style={{fontWeight:700,minWidth:55,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ms.label}</span>
                        <span style={{color:C.green,fontWeight:700}}>+{ms.chg5}%</span>
                        <div style={{display:"flex",gap:1,flex:1,flexWrap:"wrap"}}>
                          {ms.activeInds.slice(0,4).map(k=><span key={k} style={{fontSize:5,padding:"0px 2px",borderRadius:1,background:"rgba(148,163,184,.06)",color:C.sub}}>{indLabels[k]}</span>)}
                        </div>
                      </div>
                    ))}
                  </div>}
                </div>;
              })}
            </div>}

            {/* 편입 이력 */}
            {comboHistory.length>0&&<div style={css.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{fontSize:9,fontWeight:700,color:C.muted}}>📜 편입/제거 이력 ({comboHistory.length}건)</span>
                <button onClick={()=>{if(confirm("이력을 전부 삭제하시겠습니까?"))setComboHistory([]);}} style={{fontSize:7,padding:"2px 6px",borderRadius:3,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,cursor:"pointer"}}>전체삭제</button>
              </div>
              <div style={{maxHeight:120,overflowY:"auto"}}>
                {[...comboHistory].reverse().map((h,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:4,padding:"2px 0",borderBottom:`1px solid rgba(148,163,184,.03)`,fontSize:7}}>
                    <span style={{color:h.action==="편입"?C.emerald:C.red,fontWeight:700,minWidth:16}}>{h.action==="편입"?"✅":"❌"}</span>
                    <span style={{color:C.muted,minWidth:45}}>{h.date}</span>
                    <div style={{display:"flex",gap:1,flex:1,flexWrap:"wrap"}}>
                      {h.keys.map(k=><span key={k} style={{padding:"0px 3px",borderRadius:1,background:"rgba(148,163,184,.06)",color:C.sub,fontSize:6}}>{k}</span>)}
                    </div>
                    {h.avgRet!=null&&<span style={{color:C.green,fontSize:7}}>+{h.avgRet}%</span>}
                  </div>
                ))}
              </div>
            </div>}
            </>;
          })()}
        </div>}

        {/* ══ TAB: 📡 분석 — 전략 검증 + 시장 패턴 ══ */}
        {tab==="scanner"&&<div style={{padding:"12px 14px"}}>
          <div style={{fontSize:12,fontWeight:900,color:C.accent,marginBottom:4}}>📡 분석 — 전략 검증 + 시장 패턴</div>
          <div style={{fontSize:8,color:C.sub,marginBottom:10}}>기법별 스크리닝 + 검증 + 시장 패턴 분석</div>
          <div style={{display:"flex",gap:4,marginBottom:10}}>
            {[["all","전체"],["kr","🇰🇷 한국"],["us","🇺🇸 미국"]].map(([v,l])=>(
              <button key={v} onClick={()=>setFocusMarket(v)} style={{padding:"4px 12px",borderRadius:5,border:`1px solid ${focusMarket===v?C.accent:C.border}`,background:focusMarket===v?"rgba(59,130,246,.12)":"transparent",color:focusMarket===v?C.accent:C.muted,fontSize:9,fontWeight:focusMarket===v?700:400,cursor:"pointer"}}>{l}</button>
            ))}
          </div>

          {(()=>{
            const isKRt=(t)=>(t?.length||0)>5;
            const scanned=Object.entries(charts).filter(([t,c])=>c?.data?.length>=20&&c.real).filter(([t])=>focusMarket==="all"?true:focusMarket==="kr"?isKRt(t):!isKRt(t)).map(([ticker,c])=>{
              const d=c.data;const L=d.length;const last=d[L-1];const prev=d[L-2];
              if(!last||!prev)return null;
              const info=stocks.find(s=>s.ticker===ticker)||pool[ticker]||{};
              const isKR=isKRt(ticker);
              const closes=d.map(x=>x.close);
              const w52h=Math.max(...closes);const w52l=Math.min(...closes);
              const prevHigh=Math.max(...closes.slice(0,-5));
              const chg1=L>1?+((last.close-prev.close)/prev.close*100).toFixed(2):0;
              const rs=((info.chg5d||0)-(indicesData["^GSPC"]?.chg5d||0));
              const volR=info.volRatio||info._volRatio||100;

              // 캔들 패턴
              const bodyPct=last.bodyPct||0;
              const upperWick=last.upperWickPct||0;
              const isBull=last.isBull;
              const bigBull=last.bigBull;
              const cleanCandle=last.cleanCandle;
              const bigBullClean=last.bigBullClean;

              // D+0 조건 (config: stratCfg.d0)
              const d0_highBreak=last.close>=prevHigh*0.98;
              const d0_bigCandle=bodyPct>=stratCfg.d0.bodyPct;
              const d0_volume=volR>=stratCfg.d0.volMin;
              const d0_sector=rs>0;
              const d0_score=[d0_highBreak,d0_bigCandle,d0_volume,d0_sector,isBull,cleanCandle].filter(Boolean).length;

              // 신정재 6체크 (config: stratCfg.sj)
              const sj_newHigh=last.close>=w52h*(stratCfg.sj.highPct/100);
              const sj_gapSmall=last.close>=prevHigh*(stratCfg.sj.highPct/100);
              const sj_bullVol=isBull&&volR>=stratCfg.d0.volMin;
              const sj_volUp=volR>=stratCfg.d0.volMin;
              const sj_clean=isBull&&upperWick<20;
              const sj_squeeze=last.sqzOff||(!last.sqzOn&&prev?.sqzOn);
              const sj_score=[sj_newHigh,sj_gapSmall,sj_bullVol,sj_volUp,sj_clean,sj_squeeze].filter(Boolean).length;
              const sj_checks=[
                {ok:sj_newHigh,label:"신고가"},
                {ok:sj_gapSmall,label:"이격좁음"},
                {ok:sj_bullVol,label:"양봉+거래"},
                {ok:sj_volUp,label:"거래↑"},
                {ok:sj_clean,label:"깔끔양봉"},
                {ok:sj_squeeze,label:"조정해제"},
              ];

              // 엔벨로프 하단 근접
              const envLower=last.envLower||0;
              const nearEnv=last.nearEnvLower;

              // ★ 추세 전환 초기 감지
              const stCount=last.bullCount||0;
              const prevSt=prev?.bullCount||0;
              const st_rising=stCount>=2&&prevSt<stCount; // ST 1→2 또는 2→3 전환
              const st_is2=stCount===2; // 현재 2/3 상태
              const rsi_val=last.rsi||0;
              const rsi_prev=prev?.rsi||0;
              const rsi_prev3=L>3?(d[L-4]?.rsi||0):0;
              const rsi_rising=rsi_val>rsi_prev&&rsi_val>rsi_prev3&&rsi_val>=40; // RSI 3일 연속 우상향 + 40 이상
              const near_cloud=last.nearCloud||last.inCloud||(last.spanHigh&&last.close>=last.spanLow*0.97&&last.close<=last.spanHigh*1.03); // 구름 인접
              const rs_positive=rs>0;
              const tr_volUp=volR>=stratCfg.tr.volMin; // 거래량 config
              const tr_macdUp=(last.macd>last.signal)||(last.hist>0&&prev?.hist<=0)||(last.hist>(prev?.hist||0));
              const tr_checks=[
                {ok:st_rising||st_is2,label:"ST↑2"},
                {ok:rsi_rising,label:"RSI↑"},
                {ok:near_cloud,label:"구름"},
                {ok:rs_positive,label:"RS"},
                {ok:tr_volUp,label:"거래량"},
                {ok:tr_macdUp,label:"MACD"},
              ];
              const tr_score=tr_checks.filter(c=>c.ok).length;

              return{ticker,label:info.label||ticker,market:info.market,price:last.close,chg1,rs:+rs.toFixed(1),volR,bodyPct,upperWick,isBull,bigBull,cleanCandle,bigBullClean,d0_score,sj_score,sj_checks,nearEnv,envLower,w52h,isKR,mktCap:info.mktCap||0,changePct:info.changePct||0,tr_score,tr_checks,stCount,rsi_val:+rsi_val.toFixed(0)};
            }).filter(Boolean);

            // D+0 후보
            const d0hits=scanned.filter(s=>s.d0_score>=stratCfg.d0.minScore).sort((a,b)=>b.d0_score-a.d0_score);
            // 신정재 후보
            const sjhits=scanned.filter(s=>s.sj_score>=stratCfg.sj.minScore).sort((a,b)=>b.sj_score-a.sj_score);
            // 엔벨로프 하단 근접
            const envhits=scanned.filter(s=>s.nearEnv&&s.mktCap>(s.isKR?500:5)).sort((a,b)=>a.price/a.envLower-b.price/b.envLower);
            // 추세 전환 초기
            const trhits=scanned.filter(s=>s.tr_score>=stratCfg.tr.minScore).sort((a,b)=>b.tr_score-a.tr_score||b.rs-a.rs);

            return<>
              {/* ── D+0 장대양봉 돌파 ── */}
              <div style={css.card}>
                <div onClick={()=>setScanCardOpen(p=>({...p,d0:!p.d0}))} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",marginBottom:4}}><span style={{fontSize:11,fontWeight:700,color:"#F97316"}}>🔥 D+0 돌파 ({d0hits.length})</span><span style={{fontSize:8,color:C.muted}}>{scanCardOpen.d0?"▲ 접기":"▼ 펼치기"}</span></div>
                <div style={{display:scanCardOpen.d0===false?"none":"block"}}>
                <div style={{fontSize:8,color:C.muted,marginBottom:8}}>전고점 돌파 + 장대양봉(5%+) + 거래량 폭발 + 주도섹터</div>
                {d0hits.length===0?<div style={{textAlign:"center",padding:20,color:C.muted,fontSize:9}}>현재 D+0 조건 충족 종목 없음</div>
                :<div style={{maxHeight:350,overflowY:"auto"}}>
                  {d0hits.map((s,i)=>(
                    <div key={s.ticker} onClick={()=>navigateToStock(s.ticker,s,"스캐너_D0")} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 8px",borderBottom:`1px solid rgba(148,163,184,.04)`,cursor:"pointer",background:s.d0_score>=5?"rgba(249,115,22,.06)":"transparent"}}>
                      <span style={{fontSize:9,fontWeight:900,color:"#F97316",minWidth:14}}>{i+1}</span>
                      <div style={{minWidth:65,maxWidth:80}}>
                        <div style={{fontWeight:700,fontSize:9,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fmtName(s)}</div>
                        <div style={{fontSize:7,color:C.muted}}>{s.isKR?"₩"+fmtKRW(s.price):"$"+s.price.toFixed(1)}</div>
                      </div>
                      <div style={{display:"flex",gap:2,flex:1,flexWrap:"wrap"}}>
                        {s.bigBullClean&&<span style={{fontSize:6,padding:"1px 3px",borderRadius:2,background:"rgba(249,115,22,.12)",color:"#F97316",fontWeight:700}}>장대양봉</span>}
                        {s.d0_score>=5&&<span style={{fontSize:6,padding:"1px 3px",borderRadius:2,background:"rgba(34,197,94,.12)",color:C.emerald,fontWeight:700}}>전고돌파</span>}
                        {s.volR>=200&&<span style={{fontSize:6,padding:"1px 3px",borderRadius:2,background:"rgba(239,68,68,.12)",color:C.red,fontWeight:700}}>거래폭발</span>}
                        {s.rs>3&&<span style={{fontSize:6,padding:"1px 3px",borderRadius:2,background:"rgba(59,130,246,.12)",color:C.accent,fontWeight:700}}>주도주</span>}
                      </div>
                      <div style={{textAlign:"right",minWidth:50}}>
                        <div style={{fontSize:9,fontWeight:900,color:s.chg1>=0?C.green:C.red}}>{s.chg1>=0?"+":""}{s.chg1}%</div>
                        <div style={{fontSize:7,color:C.muted}}>체크 {s.d0_score}/6</div>
                      </div>
                    </div>
                  ))}
                </div>}
                <div style={{fontSize:7,color:C.muted,marginTop:6}}>D+1: 내일 전일종가 눌림목에서 매수 검토 · 익절 5~10% · 손절 지지선-1%</div>
                </div>
              </div>

              {/* ── 신정재 6체크포인트 ── */}
              <div style={css.card}>
                <div onClick={()=>setScanCardOpen(p=>({...p,sj:!p.sj}))} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",marginBottom:4}}><span style={{fontSize:11,fontWeight:700,color:C.emerald}}>✅ 6체크 ({sjhits.length})</span><span style={{fontSize:8,color:C.muted}}>{scanCardOpen.sj?"▲ 접기":"▼ 펼치기"}</span></div>
                <div style={{display:scanCardOpen.sj===false?"none":"block"}}>
                <div style={{fontSize:8,color:C.muted,marginBottom:8}}>신고가 + 이격좁음 + 양봉거래 + 거래↑ + 깔끔양봉 + 조정해제</div>
                {sjhits.length===0?<div style={{textAlign:"center",padding:20,color:C.muted,fontSize:9}}>현재 4/6 이상 충족 종목 없음</div>
                :<div style={{maxHeight:400,overflowY:"auto"}}>
                  {sjhits.map((s,i)=>(
                    <div key={s.ticker} onClick={()=>navigateToStock(s.ticker,s,"스캐너_6체크")} style={{display:"flex",alignItems:"center",gap:5,padding:"6px 8px",borderBottom:`1px solid rgba(148,163,184,.04)`,cursor:"pointer",background:s.sj_score>=5?"rgba(34,197,94,.06)":"transparent"}}>
                      <span style={{fontSize:9,fontWeight:900,color:C.emerald,minWidth:14}}>{i+1}</span>
                      <div style={{minWidth:65,maxWidth:80}}>
                        <div style={{fontWeight:700,fontSize:9,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fmtName(s)}</div>
                        <div style={{fontSize:7,color:C.muted}}>{s.isKR?"₩"+fmtKRW(s.price):"$"+s.price.toFixed(1)}</div>
                      </div>
                      <div style={{display:"flex",gap:2,flex:1,flexWrap:"wrap"}}>
                        {s.sj_checks.map((ck,j)=><span key={j} style={{fontSize:6,padding:"1px 3px",borderRadius:2,background:ck.ok?"rgba(34,197,94,.1)":"rgba(148,163,184,.03)",color:ck.ok?C.emerald:C.muted,fontWeight:ck.ok?700:400}}>{ck.ok?"✓":"✗"}{ck.label}</span>)}
                      </div>
                      <div style={{textAlign:"right",minWidth:40}}>
                        <div style={{fontSize:11,fontWeight:900,color:s.sj_score>=5?C.emerald:s.sj_score>=4?C.yellow:C.muted}}>{s.sj_score}/6</div>
                        <div style={{fontSize:7,color:s.chg1>=0?C.green:C.red}}>{s.chg1>=0?"+":""}{s.chg1}%</div>
                      </div>
                    </div>
                  ))}
                </div>}
                <div style={{fontSize:7,color:C.muted,marginTop:6}}>종가매수: 오후 3:18~20분 확인 후 매수 · 당일 저점 미이탈 확인 · 추세 믿고 눌림 매수</div>
              </div>

              {/* ── 엔벨로프 하단 근접 ── */}
              <div style={css.card}>
                <div onClick={()=>setScanCardOpen(p=>({...p,env:!p.env}))} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",marginBottom:4}}><span style={{fontSize:11,fontWeight:700,color:C.purple}}>📐 엔벨로프 ({envhits.length})</span><span style={{fontSize:8,color:C.muted}}>{scanCardOpen.env?"▲ 접기":"▼ 펼치기"}</span></div>
                <div style={{display:scanCardOpen.env===false?"none":"block"}}>
                <div style={{fontSize:8,color:C.muted,marginBottom:8}}>Envelope(20,20) 하한선 2% 이내 근접 우량주</div>
                {envhits.length===0?<div style={{textAlign:"center",padding:20,color:C.muted,fontSize:9}}>현재 엔벨로프 하단 근접 종목 없음 — 시장이 강세일 수 있습니다</div>
                :<div style={{maxHeight:300,overflowY:"auto"}}>
                  {envhits.map((s,i)=>(
                    <div key={s.ticker} onClick={()=>navigateToStock(s.ticker,s,"스캐너_엔벨")} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 8px",borderBottom:`1px solid rgba(148,163,184,.04)`,cursor:"pointer"}}>
                      <span style={{fontSize:9,fontWeight:900,color:C.purple,minWidth:14}}>{i+1}</span>
                      <div style={{minWidth:65,maxWidth:80}}>
                        <div style={{fontWeight:700,fontSize:9,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fmtName(s)}</div>
                      </div>
                      <div style={{flex:1,fontSize:8,color:C.muted}}>
                        현재 {s.isKR?"₩"+fmtKRW(s.price):"$"+s.price.toFixed(1)} · 하한 {s.isKR?"₩"+fmtKRW(s.envLower):"$"+s.envLower.toFixed(1)}
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:9,fontWeight:700,color:C.red}}>{s.changePct>=0?"+":""}{(s.changePct||0).toFixed(1)}%</div>
                      </div>
                    </div>
                  ))}
                </div>}
                <div style={{fontSize:7,color:C.muted,marginTop:6}}>MA20 × 0.80 기준 · 과매도 반등 매매 · 손절 엔벨로프 하단 이탈 시</div>
                </div>
              </div>

              {/* ── 추세 전환 초기 감지 ── */}
              <div style={css.card}>
                <div onClick={()=>setScanCardOpen(p=>({...p,tr:!p.tr}))} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",marginBottom:4}}><span style={{fontSize:11,fontWeight:700,color:C.accent}}>🔄 전환초기 ({trhits.length})</span><span style={{fontSize:8,color:C.muted}}>{scanCardOpen.tr?"▲ 접기":"▼ 펼치기"}</span></div>
                <div style={{display:scanCardOpen.tr===false?"none":"block"}}>
                <div style={{fontSize:8,color:C.muted,marginBottom:8}}>ST 2/3 + RSI 우상향 + 구름 인접 + RS 강 + 거래량 110%+ + MACD↑ → 5/6 이상</div>
                {trhits.length===0?<div style={{textAlign:"center",padding:20,color:C.muted,fontSize:9}}>현재 추세 전환 초기 종목 없음</div>
                :<div style={{maxHeight:350,overflowY:"auto"}}>
                  {trhits.map((s,i)=>(
                    <div key={s.ticker} onClick={()=>navigateToStock(s.ticker,s,"스캐너_전환")} style={{display:"flex",alignItems:"center",gap:5,padding:"6px 8px",borderBottom:`1px solid rgba(148,163,184,.06)`,cursor:"pointer",background:s.tr_score>=6?"rgba(59,130,246,.06)":"transparent"}}>
                      <span style={{fontSize:9,fontWeight:900,color:C.accent,minWidth:14}}>{i+1}</span>
                      <div style={{minWidth:65,maxWidth:80}}>
                        <div style={{fontWeight:700,fontSize:9,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fmtName(s)}</div>
                        <div style={{fontSize:7,color:C.muted}}>{s.isKR?"₩"+fmtKRW(s.price):"$"+s.price.toFixed(1)}</div>
                      </div>
                      <div style={{display:"flex",gap:2,flex:1,flexWrap:"wrap"}}>
                        {s.tr_checks.map((ck,j)=><span key={j} style={{fontSize:6,padding:"1px 3px",borderRadius:2,background:ck.ok?"rgba(59,130,246,.1)":"rgba(148,163,184,.03)",color:ck.ok?C.accent:C.muted,fontWeight:ck.ok?700:400}}>{ck.ok?"✓":"✗"}{ck.label}</span>)}
                      </div>
                      <div style={{textAlign:"right",minWidth:50}}>
                        <div style={{fontSize:8,color:C.muted}}>ST {s.stCount}/3 · RSI {s.rsi_val}</div>
                        <div style={{fontSize:9,fontWeight:700,color:s.tr_score>=6?C.accent:C.muted}}>{s.tr_score}/6</div>
                      </div>
                    </div>
                  ))}
                </div>}
                <div style={{fontSize:7,color:C.muted,marginTop:6}}>ST 3/3 완성 전 선점 · 구름 돌파 확인 후 매수 · 3/3 미완성 시 손절 -5%</div>
                </div>
              </div>

              {/* ── 📊 5주 리그 대시보드 ── */}
              <div style={css.card}>
                <div style={{fontSize:11,fontWeight:700,color:"#F59E0B",marginBottom:4}}>📊 5주 리그 — 기법별 성적표</div>
                <div style={{fontSize:8,color:C.muted,marginBottom:8}}>5/10/15/20/25일 전 시점에서 각 기법이 추천했을 종목의 실제 수익률</div>
                {(()=>{
                  const weeks=[{d:5,label:"1주전"},{d:10,label:"2주전"},{d:15,label:"3주전"},{d:20,label:"4주전"},{d:25,label:"5주전"}];
                  const tagDefs=["AI추천","돌파","진입적기","D+0","6체크"];
                  const league={};
                  tagDefs.forEach(t=>{league[t]={weeks:[],totalW:0,totalL:0,totalRet:0,totalN:0};});
                  weeks.forEach(wk=>{
                    const wPerf={};tagDefs.forEach(t=>{wPerf[t]={w:0,l:0,ret:0,n:0};});
                    scanned.forEach(s=>{
                      const cd=charts[s.ticker]?.data;if(!cd||cd.length<wk.d+5)return;
                      const L=cd.length;const ago=cd[L-1-wk.d];const ago2=cd[L-2-wk.d];const now2=cd[L-1];
                      if(!ago||!ago2||!now2)return;
                      const ret=+((now2.close-ago.close)/ago.close*100).toFixed(2);
                      const stC=[ago.st1Bull,ago.st2Bull,ago.st3Bull].filter(v=>v!=null).length;
                      const macdUp=ago.macd>ago.signal;const rsi=ago.rsi||0;
                      const cloud=ago.aboveCloud||ago.close>(ago.spanHigh||0);
                      const adxOk=(ago.adx||0)>=25;
                      const volR5=ago.volume&&cd.slice(L-1-wk.d-20,L-1-wk.d).length>0?Math.round(ago.volume/(cd.slice(L-1-wk.d-20,L-1-wk.d).reduce((a,x)=>a+(x.volume||0),0)/20||1)*100):100;
                      const alphaS=(stC>=3?25:stC>=2?15:0)+(cloud?20:0)+(macdUp?15:0)+(adxOk?15:0)+(volR5>=150?15:0)+(rsi>=50&&rsi<=70?10:0);
                      if(alphaS>=75){wPerf["AI추천"].n++;wPerf["AI추천"].ret+=ret;if(ret>0)wPerf["AI추천"].w++;else wPerf["AI추천"].l++;}
                      const prevStC=[ago2?.st1Bull,ago2?.st2Bull,ago2?.st3Bull].filter(v=>v!=null).length;
                      let bkS=0;if(stC>prevStC)bkS++;if(macdUp&&!(ago2?.macd>ago2?.signal))bkS++;if(cloud&&!ago2?.aboveCloud)bkS++;if(ago.sqzOff&&!ago2?.sqzOff)bkS++;if(volR5>=200)bkS++;
                      if(bkS>=2){wPerf["돌파"].n++;wPerf["돌파"].ret+=ret;if(ret>0)wPerf["돌파"].w++;else wPerf["돌파"].l++;}
                      if(stC===3&&macdUp&&rsi>=50&&rsi<=70){wPerf["진입적기"].n++;wPerf["진입적기"].ret+=ret;if(ret>0)wPerf["진입적기"].w++;else wPerf["진입적기"].l++;}
                      const closes5=cd.slice(0,L-wk.d).map(x=>x.close);const pH5=closes5.length>5?Math.max(...closes5.slice(-20)):0;
                      const bPct5=ago.bodyPct||0;const uW5=ago.upperWickPct||0;
                      const d0c5=[ago.close>=pH5*0.98,bPct5>=stratCfg.d0.bodyPct,volR5>=stratCfg.d0.volMin,true,ago.isBull,ago.isBull&&uW5<20].filter(Boolean).length;
                      if(d0c5>=stratCfg.d0.minScore){wPerf["D+0"].n++;wPerf["D+0"].ret+=ret;if(ret>0)wPerf["D+0"].w++;else wPerf["D+0"].l++;}
                      const w52h5=Math.max(...closes5.slice(-252));
                      const sjc5=[ago.close>=w52h5*(stratCfg.sj.highPct/100),ago.close>=pH5*(stratCfg.sj.highPct/100),ago.isBull&&volR5>=stratCfg.d0.volMin,volR5>=stratCfg.d0.volMin,ago.isBull&&uW5<20,ago.sqzOff||(!ago.sqzOn&&ago2?.sqzOn)].filter(Boolean).length;
                      if(sjc5>=stratCfg.sj.minScore){wPerf["6체크"].n++;wPerf["6체크"].ret+=ret;if(ret>0)wPerf["6체크"].w++;else wPerf["6체크"].l++;}
                    });
                    tagDefs.forEach(t=>{
                      const p=wPerf[t];
                      league[t].weeks.push({...p,avg:p.n>0?+(p.ret/p.n).toFixed(1):null});
                      league[t].totalW+=p.w;league[t].totalL+=p.l;league[t].totalRet+=p.ret;league[t].totalN+=p.n;
                    });
                  });
                  const ranked=tagDefs.map(t=>({tag:t,...league[t],avgRet:league[t].totalN>0?+(league[t].totalRet/league[t].totalN).toFixed(1):0,wr:league[t].totalN>0?Math.round(league[t].totalW/(league[t].totalW+league[t].totalL)*100):0})).sort((a,b)=>b.avgRet-a.avgRet);
                  return<>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:8,minWidth:380}}>
                      <thead><tr style={{borderBottom:`2px solid ${C.border}`}}>
                        <th style={{padding:"4px",textAlign:"left",color:C.accent,fontSize:7}}>기법</th>
                        {weeks.map(w=><th key={w.d} style={{padding:"4px",textAlign:"center",color:C.muted,fontSize:7}}>{w.label}</th>)}
                        <th style={{padding:"4px",textAlign:"center",color:"#F59E0B",fontSize:7}}>평균</th>
                        <th style={{padding:"4px",textAlign:"center",color:C.accent,fontSize:7}}>승률</th>
                        <th style={{padding:"4px",textAlign:"center",color:C.muted,fontSize:7}}>추세</th>
                      </tr></thead>
                      <tbody>{ranked.map((r,ri)=>(
                        <tr key={r.tag} style={{borderBottom:`1px solid ${C.border}`,background:ri===0?"rgba(34,197,94,.06)":"transparent"}}>
                          <td style={{padding:"5px 4px",fontWeight:700,fontSize:9,color:ri===0?C.emerald:C.text}}>{ri===0?"🏆 ":""}{r.tag}</td>
                          {r.weeks.map((w,wi)=><td key={wi} style={{padding:"4px",textAlign:"center",color:w.avg===null?C.muted:w.avg>=0?C.green:C.red,fontWeight:700}}>{w.avg===null?"—":w.avg>=0?"+"+w.avg+"%":w.avg+"%"}</td>)}
                          <td style={{padding:"4px",textAlign:"center",fontWeight:900,color:r.avgRet>=0?C.green:C.red}}>{r.avgRet>=0?"+":""}{r.avgRet}%</td>
                          <td style={{padding:"4px",textAlign:"center",fontWeight:700,color:r.wr>=60?C.green:r.wr>=40?"#F59E0B":C.red}}>{r.wr}%</td>
                          <td style={{padding:"4px",textAlign:"center"}}>{(()=>{const recent=r.weeks.slice(0,3).filter(w=>w.avg!==null);const up=recent.filter(w=>w.avg>0).length;return up>=2?"↑":up===0?"↓":"→";})()}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  {/* 인사이트 */}
                  <div style={{marginTop:8,padding:"6px 10px",background:"rgba(59,130,246,.04)",borderRadius:6,border:`1px solid rgba(59,130,246,.1)`}}>
                    <div style={{fontSize:8,color:C.accent,fontWeight:700,marginBottom:3}}>💡 인사이트</div>
                    {ranked[0]&&ranked[0].avgRet>0&&<div style={{fontSize:8,color:C.sub}}>✅ {ranked[0].tag}이 평균 +{ranked[0].avgRet}%로 1위. 이 기법에 집중하세요.</div>}
                    {ranked.at(-1)&&ranked.at(-1).avgRet<0&&<div style={{fontSize:8,color:C.sub}}>⚠️ {ranked.at(-1).tag}은 평균 {ranked.at(-1).avgRet}%로 저조. 조건 강화 또는 폐기 검토.</div>}
                    {ranked.filter(r=>r.totalN<3).length>0&&<div style={{fontSize:8,color:C.muted}}>📊 {ranked.filter(r=>r.totalN<3).map(r=>r.tag).join(", ")} — 데이터 부족, 더 지켜보세요.</div>}
                  </div>
                  </>;
                })()}
              </div>

              {/* ── 🔬 기법 해부 — 조건별 기여도 ── */}
              <div style={css.card}>
                <div style={{fontSize:11,fontWeight:700,color:C.purple,marginBottom:4}}>🔬 기법 해부 — 어떤 조건이 발목 잡나?</div>
                <div style={{fontSize:8,color:C.muted,marginBottom:8}}>5일 전 기준, 각 기법의 세부 조건별 승률 분석</div>
                {(()=>{
                  // 5일 전 기준 조건별 승률
                  const condPerf={d0:{},sj:{}};
                  const d0Labels=["전고돌파","장대양봉","거래량","주도섹터","양봉","깔끔캔들"];
                  const sjLabels=["신고가","이격좁음","양봉거래","거래↑","깔끔양봉","조정해제"];
                  d0Labels.forEach(l=>{condPerf.d0[l]={w:0,l:0};});
                  sjLabels.forEach(l=>{condPerf.sj[l]={w:0,l:0};});
                  scanned.forEach(s=>{
                    const cd=charts[s.ticker]?.data;if(!cd||cd.length<12)return;
                    const L=cd.length;const ago=cd[L-6];const ago2=cd[L-7];const now2=cd[L-1];
                    if(!ago||!ago2||!now2)return;
                    const ret=+((now2.close-ago.close)/ago.close*100).toFixed(2);
                    const win=ret>0;
                    const closes5=cd.slice(0,L-5).map(x=>x.close);const pH=closes5.length>5?Math.max(...closes5.slice(-20)):0;
                    const volR5=ago.volume&&cd.slice(L-26,L-6).length>0?Math.round(ago.volume/(cd.slice(L-26,L-6).reduce((a,x)=>a+(x.volume||0),0)/20||1)*100):100;
                    const d0Conds=[ago.close>=pH*0.98,(ago.bodyPct||0)>=stratCfg.d0.bodyPct,volR5>=stratCfg.d0.volMin,true,ago.isBull,ago.isBull&&(ago.upperWickPct||100)<20];
                    const d0Tot=d0Conds.filter(Boolean).length;
                    if(d0Tot>=stratCfg.d0.minScore){d0Conds.forEach((ok,i)=>{if(ok){if(win)condPerf.d0[d0Labels[i]].w++;else condPerf.d0[d0Labels[i]].l++;}});}
                    const w52h5=Math.max(...closes5.slice(-252));
                    const sjConds=[ago.close>=w52h5*(stratCfg.sj.highPct/100),ago.close>=pH*(stratCfg.sj.highPct/100),ago.isBull&&volR5>=stratCfg.d0.volMin,volR5>=stratCfg.d0.volMin,ago.isBull&&(ago.upperWickPct||100)<20,ago.sqzOff||(!ago.sqzOn&&ago2?.sqzOn)];
                    const sjTot=sjConds.filter(Boolean).length;
                    if(sjTot>=stratCfg.sj.minScore){sjConds.forEach((ok,i)=>{if(ok){if(win)condPerf.sj[sjLabels[i]].w++;else condPerf.sj[sjLabels[i]].l++;}});}
                  });
                  const renderConds=(title,color,perfs,labels)=>{
                    const entries=labels.map(l=>({label:l,...perfs[l],total:perfs[l].w+perfs[l].l})).filter(e=>e.total>0);
                    if(!entries.length)return<div style={{fontSize:8,color:C.muted,marginBottom:6}}>{title}: 데이터 부족</div>;
                    return<div style={{marginBottom:10}}>
                      <div style={{fontSize:9,fontWeight:700,color,marginBottom:4}}>{title}</div>
                      {entries.sort((a,b)=>(a.w/(a.total||1))-(b.w/(b.total||1))).map(e=>{
                        const wr=Math.round(e.w/e.total*100);
                        return<div key={e.label} style={{display:"flex",alignItems:"center",gap:4,marginBottom:3}}>
                          <span style={{fontSize:7,color:C.muted,minWidth:50}}>{e.label}</span>
                          <div style={{flex:1,height:4,background:"rgba(148,163,184,.1)",borderRadius:2,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${wr}%`,background:wr>=60?C.emerald:wr>=40?"#F59E0B":C.red,borderRadius:2}}/>
                          </div>
                          <span style={{fontSize:8,fontWeight:700,color:wr>=60?C.green:wr>=40?"#F59E0B":C.red,minWidth:28}}>{wr}%</span>
                          <span style={{fontSize:7,color:C.muted}}>{e.total}건</span>
                          {wr<40&&<span style={{fontSize:6,color:C.red}}>❌약함</span>}
                        </div>;
                      })}
                    </div>;
                  };
                  return<>
                    {renderConds("🔥 D+0 돌파","#F97316",condPerf.d0,d0Labels)}
                    {renderConds("✅ 6체크",C.emerald,condPerf.sj,sjLabels)}
                  </>;
                })()}
              </div>


              {/* ── 🔧 조건 튜닝 ── */}
              <div style={css.card}>
                <div style={{fontSize:11,fontWeight:700,color:"#F59E0B",marginBottom:4}}>🔧 조건 튜닝 — 검증 기반 자동 제안</div>
                <div style={{fontSize:8,color:C.muted,marginBottom:10}}>1주 전 검증 결과를 기반으로 조건 강화/완화를 제안합니다</div>
                {(()=>{
                  // 1주전 검증 데이터 재계산 (간략)
                  const perf={};
                  scanned.forEach(s=>{
                    const cd2=charts[s.ticker]?.data;if(!cd2||cd2.length<10)return;
                    const L2=cd2.length;const ago=cd2[L2-6];const now2=cd2[L2-1];
                    if(!ago||!now2)return;
                    const ret=+((now2.close-ago.close)/ago.close*100).toFixed(2);
                    if(s.d0_score>=stratCfg.d0.minScore){if(!perf.d0)perf.d0={w:0,l:0,t:0};perf.d0.t+=ret;if(ret>0)perf.d0.w++;else perf.d0.l++;}
                    if(s.sj_score>=stratCfg.sj.minScore){if(!perf.sj)perf.sj={w:0,l:0,t:0};perf.sj.t+=ret;if(ret>0)perf.sj.w++;else perf.sj.l++;}
                    if(s.tr_score>=stratCfg.tr.minScore){if(!perf.tr)perf.tr={w:0,l:0,t:0};perf.tr.t+=ret;if(ret>0)perf.tr.w++;else perf.tr.l++;}
                  });
                  const strategies=[
                    {key:"d0",name:"🔥 D+0",cfg:[
                      {k:"bodyPct",label:"장대양봉",unit:"%",min:3,max:8,step:1},
                      {k:"volMin",label:"거래량",unit:"%",min:100,max:250,step:10},
                      {k:"minScore",label:"충족기준",unit:"/6",min:3,max:6,step:1}
                    ]},
                    {key:"sj",name:"✅ 6체크",cfg:[
                      {k:"highPct",label:"신고가근접",unit:"%",min:85,max:100,step:1},
                      {k:"minScore",label:"충족기준",unit:"/6",min:3,max:6,step:1}
                    ]},
                    {key:"entry",name:"🎯 진입적기",cfg:[
                      {k:"timingMin",label:"⚡타이밍",unit:"",min:30,max:70,step:5},
                      {k:"durMin",label:"💪강도",unit:"",min:30,max:70,step:5}
                    ]},
                    {key:"tr",name:"🔄 전환초기",cfg:[
                      {k:"volMin",label:"거래량",unit:"%",min:100,max:200,step:10},
                      {k:"minScore",label:"충족기준",unit:"/6",min:3,max:6,step:1}
                    ]}
                  ];
                  return<>
                  {strategies.map(st=>{
                    const p=perf[st.key];
                    const total=p?(p.w+p.l):0;
                    const wr=total>0?Math.round(p.w/total*100):null;
                    const avg=total>0?+(p.t/total).toFixed(1):null;
                    // 자동 제안
                    let suggestion=null;
                    if(total===0)suggestion={text:"데이터 부족 — 1주 전 검증 결과가 쌓이면 제안됩니다",color:C.muted};
                    else if(wr!==null&&wr<40)suggestion={text:`승률 ${wr}% → 조건 강화 추천 (슬라이더를 올려보세요)`,color:C.red};
                    else if(wr>=70&&total<=3)suggestion={text:`승률 ${wr}%로 우수하나 ${total}건뿐 → 조건 완화해서 후보 늘리기`,color:C.accent};
                    else if(wr>=60)suggestion={text:`승률 ${wr}% — 현재 설정이 잘 맞고 있습니다 ✅`,color:C.emerald};
                    else suggestion={text:`승률 ${wr}% — 보통. 조건 강화하면 승률↑ 종목수↓`,color:"#F59E0B"};
                    return<div key={st.key} style={{marginBottom:10,padding:"8px 10px",background:C.panel2,borderRadius:8}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                        <span style={{fontSize:10,fontWeight:700}}>{st.name}</span>
                        {wr!==null&&<div style={{display:"flex",gap:6,fontSize:8}}>
                          <span style={{color:C.muted}}>{total}건</span>
                          <span style={{color:wr>=60?C.green:wr>=40?"#F59E0B":C.red,fontWeight:700}}>승률 {wr}%</span>
                          <span style={{color:avg>=0?C.green:C.red,fontWeight:700}}>{avg>=0?"+":""}{avg}%</span>
                        </div>}
                      </div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:4}}>
                        {st.cfg.map(c=>(
                          <div key={c.k} style={{display:"flex",alignItems:"center",gap:3}}>
                            <span style={{fontSize:7,color:C.muted,minWidth:40}}>{c.label}</span>
                            <input type="range" min={c.min} max={c.max} step={c.step} value={stratCfg[st.key][c.k]} onChange={e=>setStratCfg(p=>({...p,[st.key]:{...p[st.key],[c.k]:+e.target.value}}))} style={{width:60,accentColor:C.accent}}/>
                            <span style={{fontSize:8,fontWeight:700,color:C.accent,minWidth:24}}>{stratCfg[st.key][c.k]}{c.unit}</span>
                          </div>
                        ))}
                      </div>
                      {suggestion&&<div style={{fontSize:7,color:suggestion.color,marginTop:2}}>💡 {suggestion.text}</div>}
                    </div>;
                  })}
                  <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
                    <button onClick={()=>setStratCfg(STRATEGY_DEFAULTS)} style={{fontSize:8,padding:"4px 12px",borderRadius:5,border:`1px solid ${C.border}`,background:"transparent",color:C.muted,cursor:"pointer"}}>↩ 초기화</button>
                  </div>
                  </>;
                })()}
              </div>

              {/* 기법 설명 */}
              <div style={{marginTop:10,padding:"10px 12px",background:"rgba(255,255,255,.02)",borderRadius:8,border:`1px solid ${C.border}`}}>
                <div style={{fontSize:9,fontWeight:700,color:C.muted,marginBottom:6}}>📖 기법 요약</div>
                <div style={{fontSize:8,color:C.sub,lineHeight:1.6}}>
                  <b style={{color:"#F97316"}}>D+0,1</b>: 주도섹터 대장주가 전고점 돌파 + 첫 장대양봉 → 다음날(D+1) 눌림목 매수. 익절 5~10%.
                  <br/><b style={{color:C.emerald}}>6체크</b>: ①신고가 ②전고점이격좁음 ③양봉+거래대금 ④거래량증가 ⑤위꼬리짧음 ⑥기간조정 → 종가확인 후 매수.
                  <br/><b style={{color:C.purple}}>엔벨로프</b>: MA20 -20% 밴드 근접 대형주 → 과매도 반등 매수. KOSPI200급.
                  <br/><b style={{color:C.accent}}>전환초기</b>: ST 1→2 + RSI↑ + 구름인접 + RS강 → 3/3 전 선점. 손절 -5%.
                </div>
              </div>


            </>;
          })()}
        </div>}


        {/* ══ TAB 3: 차트 ══ */}
        {tab==="sniper"&&selInfo&&<div style={{padding:"12px 14px"}}>
          <RSBar/>
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
            <div style={{fontWeight:900,fontSize:15}}>{fmtFullName(selInfo)}</div>
            <button onClick={()=>setCompanyInfo(p=>({...p,[sel]:p[sel]?null:true}))} style={{fontSize:8,background:companyInfo[sel]?"rgba(59,130,246,.15)":"rgba(59,130,246,.08)",border:`1px solid ${C.accent}`,borderRadius:4,padding:"2px 6px",color:C.accent,cursor:"pointer",fontWeight:600}}>🏢 {companyInfo[sel]?"접기":"회사정보"}</button>
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
              }} style={{fontSize:7,background:"rgba(245,158,11,.1)",color:C.yellow,border:"1px solid rgba(245,158,11,.3)",borderRadius:3,padding:"1px 6px",cursor:"pointer"}}>시뮬 · 🔄 실시간 전환</button>}
            </div>
            <div style={{marginLeft:"auto",display:"flex",gap:4,alignItems:"center"}}>
              {(()=>{
                const stC=[lastD?.st1Bull,lastD?.st2Bull,lastD?.st3Bull].filter(v=>v!=null).length;
                const label=finalSig==="BUY"&&stC===3?"🟢 매수":finalSig==="BUY"?"🟡 매수주의":finalSig==="SELL"?"🔴 매도":stC===3?"🟡 관망":"⚪ 대기";
                const bg=finalSig==="BUY"&&stC===3?"rgba(34,197,94,.15)":finalSig==="BUY"?"rgba(250,204,21,.12)":finalSig==="SELL"?"rgba(239,68,68,.15)":stC===3?"rgba(250,204,21,.08)":"rgba(148,163,184,.05)";
                const bc=finalSig==="BUY"&&stC===3?C.emerald:finalSig==="BUY"?C.yellow:finalSig==="SELL"?C.red:stC===3?C.yellow:C.border;
                const tc=finalSig==="BUY"&&stC===3?C.emerald:finalSig==="BUY"?C.yellow:finalSig==="SELL"?C.red:stC===3?C.yellow:C.muted;
                return<div style={{background:bg,border:`1px solid ${bc}`,borderRadius:5,padding:"3px 10px",textAlign:"center"}}>
                  <div style={{fontSize:11,fontWeight:900,color:tc}}>{label}</div>
                  <div style={{fontSize:7,color:C.muted}}>ST {stC}/3{lastD?.aboveCloud?" · 구름위":""}</div>
                </div>;
              })()}
            </div>
          </div>

          {/* ★ v2.3: 회사 정보 카드 — 기존 데이터 + 외부 링크 */}
          {companyInfo[sel]&&(()=>{
            const pi=pool[sel]||{};const si=selInfo||{};
            const mktCapVal=si.mktCap||pi.mktCap||0;
            const isKR4=isKRSel;
            const mktCapStr=isKR4?(mktCapVal>=10000?`${(mktCapVal/10000).toFixed(1)}조`:`${mktCapVal.toFixed(0)}억`):(mktCapVal>=1000?`$${(mktCapVal/1000).toFixed(0)}T`:mktCapVal>=1?`$${mktCapVal.toFixed(0)}B`:`$${(mktCapVal*1000).toFixed(0)}M`);
            const rsRank=pi.rsRank||si.rsRank;const rsPct=pi.rsPctRank||si.rsPctRank;
            const naverUrl=isKR4?`https://finance.naver.com/item/main.naver?code=${sel}`:null;
            const yahooUrl=`https://finance.yahoo.com/quote/${isKR4?sel+".KS":sel}`;
            const googleUrl=`https://www.google.com/search?q=${encodeURIComponent((si.label||sel)+" 주식 기업정보")}`;
            return<div style={{...css.card,marginBottom:10,border:`1px solid rgba(59,130,246,.2)`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <span style={{fontSize:10,fontWeight:700,color:C.accent}}>🏢 {si.label||sel}</span>
                <button onClick={()=>setCompanyInfo(p=>({...p,[sel]:null}))} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:9}}>✕</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4,marginBottom:8}}>
                {[
                  {l:"티커",v:sel,c:C.accent},
                  {l:"시가총액",v:mktCapVal>0?mktCapStr:"—",c:C.text},
                  {l:"섹터",v:si.sector||pi.sector||"—",c:C.text},
                  {l:"시장",v:isKR4?"🇰🇷 한국":"🇺🇸 미국",c:C.text},
                  {l:"RS순위",v:rsRank?`${rsRank}위`:"—",c:rsPct>=80?C.emerald:rsPct>=50?C.yellow:C.muted},
                  {l:"RS상위",v:rsPct?`${Math.round(100-rsPct)}%`:"—",c:rsPct>=80?C.emerald:C.muted},
                  {l:"거래량비",v:(si.volRatio||si._volRatio||pi.volRatio)?`${si.volRatio||si._volRatio||pi.volRatio}%`:"—",c:(si.volRatio||100)>=150?C.green:C.muted},
                  {l:"52주",v:pi.w52Breakout?"🔥돌파":pi.w52DistPct!=null?`${pi.w52DistPct}%`:"—",c:pi.w52Breakout?C.emerald:C.muted},
                ].map((m,i)=><div key={i} style={{background:"rgba(0,0,0,.4)",borderRadius:5,padding:"5px",textAlign:"center"}}>
                  <div style={{fontSize:6,color:C.muted}}>{m.l}</div>
                  <div style={{fontSize:10,fontWeight:700,color:m.c}}>{m.v}</div>
                </div>)}
              </div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {naverUrl&&<a href={naverUrl} target="_blank" rel="noopener noreferrer" style={{fontSize:8,padding:"4px 10px",borderRadius:5,background:"rgba(3,199,90,.1)",border:"1px solid rgba(3,199,90,.3)",color:"#16A34A",fontWeight:700,textDecoration:"none"}}>📊 네이버증권</a>}
                <a href={yahooUrl} target="_blank" rel="noopener noreferrer" style={{fontSize:8,padding:"4px 10px",borderRadius:5,background:"rgba(106,13,173,.1)",border:"1px solid rgba(106,13,173,.3)",color:"#6A0DAD",fontWeight:700,textDecoration:"none"}}>📈 Yahoo Finance</a>
                <a href={googleUrl} target="_blank" rel="noopener noreferrer" style={{fontSize:8,padding:"4px 10px",borderRadius:5,background:"rgba(66,133,244,.1)",border:"1px solid rgba(66,133,244,.3)",color:"#4285F4",fontWeight:700,textDecoration:"none"}}>🔍 Google 검색</a>
              </div>
            </div>;
          })()}

          {/* ★ v2.3: 타이밍 + 강도 + RS 통합 패널 */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:10}}>
            <div style={{background:selTiming.score>=45?"rgba(249,115,22,.08)":"rgba(148,163,184,.03)",border:`2px solid ${selTiming.score>=70?"#F97316":selTiming.score>=45?C.yellow:"rgba(255,255,255,.1)"}`,borderRadius:10,padding:"10px 12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <span style={{fontSize:9,fontWeight:700,color:"#F97316"}}>⚡ 진입타이밍</span>
                <span style={{fontSize:8,color:C.muted}}>{selTiming.grade}</span>
              </div>
              <div style={{fontSize:28,fontWeight:900,color:selTiming.score>=70?"#F97316":selTiming.score>=45?C.yellow:C.muted,lineHeight:1,marginBottom:6}}>{selTiming.score}<span style={{fontSize:10,color:C.muted}}>/100</span></div>
              <div style={{display:"flex",flexWrap:"wrap",gap:2}}>
                {selTiming.signals.slice(0,4).map(s=><span key={s} style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(249,115,22,.12)",color:"#F97316"}}>{s}</span>)}
                {!selTiming.signals.length&&<span style={{fontSize:7,color:C.muted}}>최근 변화 없음</span>}
              </div>
            </div>
            <div style={{background:selDurability.score>=50?"rgba(34,197,94,.06)":"rgba(148,163,184,.03)",border:`2px solid ${selDurability.score>=70?C.emerald:selDurability.score>=50?C.green:"rgba(255,255,255,.1)"}`,borderRadius:10,padding:"10px 12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <span style={{fontSize:9,fontWeight:700,color:C.emerald}}>💪 추세강도</span>
                <span style={{fontSize:8,color:C.muted}}>{selDurability.grade}</span>
              </div>
              <div style={{fontSize:28,fontWeight:900,color:selDurability.score>=70?C.emerald:selDurability.score>=50?C.green:C.muted,lineHeight:1,marginBottom:6}}>{selDurability.score}<span style={{fontSize:10,color:C.muted}}>/100</span></div>
              <div style={{display:"flex",flexWrap:"wrap",gap:2}}>
                {selDurability.signals.slice(0,4).map(s=><span key={s} style={{fontSize:7,padding:"1px 4px",borderRadius:3,background:"rgba(34,197,94,.1)",color:C.emerald}}>{s}</span>)}
                {!selDurability.signals.length&&<span style={{fontSize:7,color:C.muted}}>추세 미형성</span>}
              </div>
            </div>
          </div>
          {/* RS + 종합 판정 통합 */}
          <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:10,padding:"6px 10px",background:selTiming.score>=45&&selDurability.score>=50?"rgba(34,197,94,.06)":selTiming.score>=45?"rgba(245,158,11,.06)":"rgba(148,163,184,.03)",borderRadius:8,border:`1px solid ${selTiming.score>=45&&selDurability.score>=50?C.emerald:selTiming.score>=45?C.yellow:C.border}`}}>
            <span style={{fontSize:9,fontWeight:900,color:selTiming.score>=45&&selDurability.score>=50?C.emerald:selTiming.score>=45&&selDurability.score<30?C.yellow:selTiming.score<20&&selDurability.score>=50?C.muted:C.sub}}>
              {selTiming.score>=45&&selDurability.score>=50?"✅ 진입 검토":selTiming.score>=45&&selDurability.score<30?"⚠️ 추세확인 필요":selTiming.score<20&&selDurability.score>=50?"유지중 · 신규진입 아님":"대기"}
            </span>
            <span style={{marginLeft:"auto",display:"flex",gap:8,fontSize:8}}>
              <span style={{color:C.muted}}>3D <span style={{color:(selInfo.chg3d||0)>=0?C.green:C.red,fontWeight:700}}>{(selInfo.chg3d||0)>=0?"+":""}{(selInfo.chg3d||0).toFixed(1)}%</span></span>
              <span style={{color:C.muted}}>5D <span style={{color:(selInfo.chg5d||0)>=0?C.green:C.red,fontWeight:700}}>{(selInfo.chg5d||0)>=0?"+":""}{(selInfo.chg5d||0).toFixed(1)}%</span></span>
              <span style={{color:C.muted}}>RS <span style={{color:((selInfo.chg5d||0)-idxRS.spy.chg5d)>3?C.emerald:((selInfo.chg5d||0)-idxRS.spy.chg5d)>0?C.yellow:C.red,fontWeight:700}}>{((selInfo.chg5d||0)-idxRS.spy.chg5d)>=0?"+":""}{((selInfo.chg5d||0)-idxRS.spy.chg5d).toFixed(1)}</span></span>
            </span>
          </div>

          {/* ★ v2.3: 피보/저항선 돌파 체크 */}
          {cd?.data?.length>20&&curPrice>0&&(()=>{
            const closes=cd.data.map(d=>d.close);
            const high=Math.max(...closes);
            const low=Math.min(...closes);
            const range=high-low;
            const fib236=high-range*0.236, fib382=high-range*0.382, fib500=high-range*0.5, fib618=high-range*0.618;
            const ma20=lastD?.ma20||0, ma50=lastD?.ema50||0, ma200=lastD?.ma200||0;
            const levels=[
              {l:"52주 고점",p:high,icon:"👑"},
              {l:"피보 23.6%",p:fib236,icon:"📐"},
              {l:"피보 38.2%",p:fib382,icon:"📐"},
              {l:"20일선",p:ma20,icon:"📊"},
              {l:"피보 50%",p:fib500,icon:"📐"},
              {l:"50일선",p:ma50,icon:"📊"},
              {l:"피보 61.8%",p:fib618,icon:"📐"},
              {l:"200일선",p:ma200,icon:"📊"},
              {l:"52주 저점",p:low,icon:"🔻"},
            ].filter(lv=>lv.p>0).sort((a,b)=>b.p-a.p);
            const passed2=levels.filter(lv=>curPrice>=lv.p).length;
            return<div style={{...css.card,marginBottom:10,padding:"10px 12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <span style={{fontSize:10,fontWeight:700,color:C.accent}}>📐 가격 레벨 돌파 현황</span>
                <span style={{fontSize:10,fontWeight:900,color:passed2>=levels.length-2?C.emerald:passed2>=levels.length/2?C.yellow:C.muted}}>돌파 {passed2}/{levels.length}</span>
              </div>
              <div style={{position:"relative"}}>
                {levels.map((lv,i)=>{
                  const passed=curPrice>=lv.p;
                  const near=!passed&&curPrice>=lv.p*0.97;
                  const isCurrent=i>0&&levels[i-1]&&curPrice<levels[i-1].p&&curPrice>=lv.p;
                  return<div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0",borderBottom:`1px solid rgba(148,163,184,.04)`,background:isCurrent?"rgba(59,130,246,.08)":"transparent"}}>
                    <span style={{fontSize:10,width:14}}>{passed?"✅":near?"🔶":"⬜"}</span>
                    <span style={{fontSize:8,color:passed?C.emerald:near?C.yellow:C.muted,flex:1}}>{lv.icon} {lv.l}</span>
                    <span style={{fontSize:9,fontWeight:700,color:passed?C.text:C.muted}}>{isKRSel?"₩"+fmtKRW(Math.round(lv.p)):"$"+lv.p.toFixed(2)}</span>
                    <span style={{fontSize:7,color:passed?C.green:C.red}}>{((curPrice-lv.p)/lv.p*100).toFixed(1)}%</span>
                  </div>;
                })}
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 0",background:"rgba(59,130,246,.12)",borderRadius:4,marginTop:4}}>
                  <span style={{fontSize:10,width:14}}>📍</span>
                  <span style={{fontSize:8,color:C.accent,fontWeight:700,flex:1}}>현재가</span>
                  <span style={{fontSize:10,fontWeight:900,color:C.accent}}>{isKRSel?"₩"+fmtKRW(curPrice):"$"+curPrice.toFixed(2)}</span>
                </div>
              </div>
            </div>;
          })()}

          {/* ★ v2.3: 컨센서스 목표가 + 예상수익률 */}
          <div style={{background:"linear-gradient(135deg,rgba(59,130,246,.08),rgba(139,92,246,.08))",border:`2px solid ${consTgtSrc==="컨센서스"?C.accent:consTgt>0?"rgba(245,158,11,.4)":"rgba(255,255,255,.12)"}`,borderRadius:12,padding:"14px 16px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
              <div>
                <div style={{fontSize:9,color:C.muted,marginBottom:4}}>🎯 목표가 {consTgtSrc&&<span style={{color:C.accent,fontSize:7}}>({consTgtSrc})</span>}
                  <button onClick={()=>{const v=prompt(`목표가 입력 (${isKRSel?"원":"USD"}):`,consTgt>0?Math.round(consTgt):"");if(v&&+v>0)setUserTargets(p=>({...p,[sel]:+v}));}} style={{marginLeft:4,background:"none",border:`1px solid ${C.border}`,borderRadius:3,padding:"1px 5px",color:C.accent,fontSize:7,cursor:"pointer"}}>✏️ 수정</button>
                  {userTargets[sel]>0&&<button onClick={()=>setUserTargets(p=>{const n={...p};delete n[sel];return n;})} style={{marginLeft:2,background:"none",border:"none",color:C.muted,fontSize:7,cursor:"pointer"}}>초기화</button>}
                </div>
                {consTgt>0?<>
                  <div style={{fontSize:28,fontWeight:900,color:C.accent,lineHeight:1}}>{unit}{fmtPrice(consTgt,isKRSel)}</div>
                  <div style={{fontSize:8,color:C.muted,marginTop:4}}>현재 {unit}{fmtPrice(curPrice,isKRSel)} 대비</div>
                </>:<div>
                  <div style={{fontSize:16,color:C.muted,lineHeight:1}}>조회 필요</div>
                  {!consensus[sel]&&<button onClick={()=>fetchConsensus(sel,selInfo?.label,selInfo?.market)} style={{marginTop:6,background:"rgba(59,130,246,.12)",border:`1px solid ${C.accent}`,borderRadius:5,padding:"4px 12px",color:C.accent,fontSize:9,cursor:"pointer",fontWeight:700}}>🔍 컨센서스 조회</button>}
                  {consensus[sel]?.loading&&<div style={{fontSize:9,color:C.accent,marginTop:4}}>조회 중...</div>}
                </div>}
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
            {!consensus[sel]&&<button onClick={()=>fetchConsensus(sel,selInfo?.label,selInfo?.market)} style={{width:"100%",background:"rgba(59,130,246,.08)",border:`1px solid ${C.accent}`,borderRadius:6,padding:"6px",color:C.accent,fontSize:9,cursor:"pointer",marginTop:4}}>🔍 컨센서스 조회</button>}
            {/* ATR 도달 예상 */}
            {atrDaysToTarget&&<div style={{fontSize:8,color:C.muted,marginTop:6,textAlign:"center"}}>📈 ATR 기준 목표 도달 예상: <span style={{color:C.accent,fontWeight:700}}>약 {atrDaysToTarget}거래일</span> (일변동 {atrDaily}%)</div>}
          </div>

          {/* 목표가 / 손절가 + 수익 추정 */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>
            <div style={{background:"rgba(59,130,246,.08)",border:`1px solid rgba(59,130,246,.3)`,borderRadius:8,padding:"9px 10px",textAlign:"center"}}>
              <div style={{fontSize:8,color:C.muted,marginBottom:2}}>R:R 2:1 목표</div>
              <div style={{fontSize:14,fontWeight:800,color:C.accent}}>{rrTarget2>0?`${unit}${fmtPrice(rrTarget2,isKRSel)}`:"—"}</div>
              {rrTarget2>0&&curPrice>0&&<div style={{fontSize:9,color:C.green,marginTop:2}}>+{((rrTarget2-curPrice)/curPrice*100).toFixed(1)}% · ₩{fmtKRW(Math.round(pyramidAmts[0]*((rrTarget2-curPrice)/curPrice)))}</div>}
            </div>
            <div style={{background:"rgba(139,92,246,.08)",border:"1px solid rgba(139,92,246,.3)",borderRadius:8,padding:"9px 10px",textAlign:"center"}}>
              <div style={{fontSize:8,color:C.muted,marginBottom:2}}>R:R 3:1 목표</div>
              <div style={{fontSize:14,fontWeight:800,color:C.purple}}>{rrTarget3>0?`${unit}${fmtPrice(rrTarget3,isKRSel)}`:"—"}</div>
              {rrTarget3>0&&curPrice>0&&<div style={{fontSize:9,color:C.green,marginTop:2}}>+{((rrTarget3-curPrice)/curPrice*100).toFixed(1)}% · ₩{fmtKRW(Math.round(pyramidAmts[0]*((rrTarget3-curPrice)/curPrice)))}</div>}
            </div>
            <div style={{background:"rgba(34,197,94,.08)",border:`1px solid rgba(34,197,94,.3)`,borderRadius:8,padding:"9px 10px",textAlign:"center"}}>
              <div style={{fontSize:8,color:C.muted,marginBottom:2}}>52주 고점</div>
              <div style={{fontSize:14,fontWeight:800,color:C.emerald}}>{w52High>0?`${unit}${fmtPrice(w52High,isKRSel)}`:"—"}</div>
              {w52High>0&&curPrice>0&&<div style={{fontSize:9,color:w52High>curPrice?C.green:C.yellow,marginTop:2}}>{w52High>curPrice?`+${((w52High-curPrice)/curPrice*100).toFixed(1)}%`:"돌파중"}</div>}
            </div>
          </div>
          {curPrice>0&&charts[sel]?.data?.length>0&&findResistanceLevels(charts[sel].data.map(d=>({high:d.close*1.005,close:d.close})),curPrice).length>0&&<div style={{background:"rgba(249,115,22,.06)",border:"1px solid rgba(249,115,22,.25)",borderRadius:8,padding:"9px 12px",marginBottom:8}}>
            <div style={{fontSize:8,fontWeight:700,color:"#F97316",marginBottom:5}}>🧱 매물대 저항선</div>
            <div style={{display:"flex",gap:8}}>
              {findResistanceLevels(charts[sel].data.map(d=>({high:d.close*1.005,close:d.close})),curPrice).map((lv,i)=>(
                <div key={i} style={{textAlign:"center",flex:1}}>
                  <div style={{fontSize:7,color:C.muted}}>저항{i+1}</div>
                  <div style={{fontSize:12,fontWeight:700,color:"#F97316"}}>{unit}{fmtPrice(lv.price,isKRSel)}</div>
                </div>
              ))}
            </div>
          </div>}

          {/* ★ v2.2: 피보나치 되돌림 */}
          {fibLevels&&<div style={{background:"rgba(139,92,246,.06)",border:"1px solid rgba(139,92,246,.25)",borderRadius:8,padding:"9px 12px",marginBottom:8}}>
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

          {/* ★ v2.3: 가격 위치 + 모멘텀 인사이트 */}
          {cd?.data?.length>10&&(()=>{
            const closes=cd.data.map(d=>d.close);
            const low=Math.min(...closes),high=Math.max(...closes);
            const range=high-low;
            const pct=range>0?((curPrice-low)/range*100):50;
            const toHigh=high>curPrice?+((high-curPrice)/curPrice*100).toFixed(1):0;
            const toTarget=consTgt>curPrice?+((consTgt-curPrice)/curPrice*100).toFixed(1):0;
            // 모멘텀 판정
            const rsi=lastD?.rsi;const macdUp=lastD?.macd>lastD?.signal;const histUp=lastD?.hist>(cd.data.at(-2)?.hist||0);
            const adxUp=(lastD?.adx||0)>=25;const emaOk=lastD?.ma20>lastD?.ema50;
            const momentum=rsi>75?"⚠️ 과열 주의 — RSI "+rsi?.toFixed(0)+" 과매수 영역"
              :macdUp&&histUp&&adxUp?"💪 모멘텀 가속 중 — MACD↑ ADX강세 히스토↑"
              :macdUp&&emaOk?"📈 상승 추세 유지 — MACD양전 정배열"
              :macdUp?"🔄 전환 시도 — MACD양전 확인중"
              :rsi<30?"🎯 과매도 반등 가능 — RSI "+rsi?.toFixed(0)
              :"⏸ 방향 탐색 중 — 명확한 추세 없음";
            const momColor=rsi>75?C.red:macdUp&&histUp&&adxUp?C.emerald:macdUp?C.accent:rsi<30?C.yellow:C.muted;
            return<div style={{...css.card,marginBottom:10}}>
              {/* 가격 레인지 바 */}
              <div style={{fontSize:9,fontWeight:700,color:C.accent,marginBottom:6}}>📍 가격 위치</div>
              <div style={{position:"relative",height:28,background:"rgba(148,163,184,.04)",borderRadius:6,marginBottom:4,overflow:"hidden"}}>
                <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${Math.min(100,pct)}%`,background:"linear-gradient(90deg,rgba(239,68,68,.2),rgba(34,197,94,.2))",borderRadius:6}}/>
                <div style={{position:"absolute",left:`${Math.min(98,pct)}%`,top:0,height:"100%",width:2,background:C.accent}}/>
                {consTgt>0&&consTgt>low&&consTgt<=high*1.5&&<div style={{position:"absolute",left:`${Math.min(98,Math.max(0,(consTgt-low)/range*100))}%`,top:0,height:"100%",width:2,background:C.purple,opacity:0.6}}/>}
                <div style={{position:"absolute",left:4,top:4,fontSize:7,color:C.muted}}>최저 {isKRSel?"₩"+fmtKRW(low):"$"+low.toFixed(1)}</div>
                <div style={{position:"absolute",right:4,top:4,fontSize:7,color:C.muted}}>최고 {isKRSel?"₩"+fmtKRW(high):"$"+high.toFixed(1)}</div>
                <div style={{position:"absolute",left:`${Math.min(85,Math.max(5,pct))}%`,bottom:3,fontSize:7,fontWeight:700,color:C.accent}}>현재</div>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:C.muted,marginBottom:8}}>
                <span>레인지 {pct.toFixed(0)}% 위치</span>
                {toHigh>0&&<span>전고점까지 +{toHigh}%</span>}
                {toTarget>0&&<span style={{color:C.purple}}>목표까지 +{toTarget}%</span>}
              </div>
              {/* 모멘텀 인사이트 */}
              <div style={{padding:"6px 10px",borderRadius:6,background:`${momColor}08`,border:`1px solid ${momColor}30`,marginBottom:6}}>
                <div style={{fontSize:9,fontWeight:700,color:momColor}}>{momentum}</div>
              </div>
              {/* ATR 정보 */}
              {atrDaily&&<div style={{display:"flex",gap:8,fontSize:8,color:C.muted}}>
                <span>하루 변동 <span style={{color:C.accent,fontWeight:700}}>±{atrDaily}%</span></span>
                <span>거래대금 <span style={{color:C.text,fontWeight:700}}>{fmtTurnover(selTurnover,isKRSel)}</span></span>
                {atrDaysToTarget>0&&<span>목표까지 <span style={{color:C.emerald,fontWeight:700}}>~{atrDaysToTarget}일</span></span>}
              </div>}
            </div>;
          })()}

          {/* 기간 선택 + 차트 */}
          {sliced.length>0&&<>
          <div style={{display:"flex",gap:4,justifyContent:"center",marginBottom:6}}>
            {["1M","3M","6M","1Y","ALL"].map(p=><button key={p} onClick={()=>setPeriod(p)} style={{...css.btn(period===p),fontSize:9,padding:"4px 10px"}}>{p}</button>)}
          </div>
          <div style={{background:lastD?.allBull?"rgba(34,197,94,.05)":"rgba(239,68,68,.04)",border:`1px solid ${lastD?.allBull?"rgba(34,197,94,.3)":C.border}`,borderRadius:10,padding:"8px 6px 4px",marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingLeft:8,paddingRight:8,marginBottom:6}}>
              <div style={{fontSize:9,color:C.muted}}>{lastD?.allBull?"🟢 매수배경":"🔴 비매수배경"} {cd?.real?"(실제)":"(시뮬)"}</div>
              <div style={{display:"flex",gap:4}}>
                {[["ichi","일목"],["st","ST"],["avwap","AVWAP"],["adx","ADX"],["obv","OBV"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setChartOpts(o=>({...o,[k]:!o[k]}))} style={{fontSize:8,padding:"3px 7px",borderRadius:4,border:`1px solid ${chartOpts[k]?"rgba(59,130,246,.5)":"rgba(255,255,255,.15)"}`,background:chartOpts[k]?"rgba(59,130,246,.12)":"transparent",color:chartOpts[k]?C.accent:C.muted,cursor:"pointer"}}>{chartOpts[k]?"✓":""} {l}</button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={270}>
              <ComposedChart data={sliced} syncId="stockChart" margin={{left:0,right:6}}>
                <CartesianGrid stroke="rgba(148,163,184,.03)"/>
                <XAxis dataKey="date" tick={{fill:C.muted,fontSize:7}} tickLine={false} interval={Math.floor(sliced.length/5)||1}/>
                <YAxis yAxisId="p" tick={{fill:C.muted,fontSize:7}} tickLine={false} domain={["auto","auto"]} tickFormatter={v=>unit==="₩"?`${(v/1000).toFixed(0)}k`:v.toFixed(0)} width={40}/>
                <YAxis yAxisId="v" orientation="right" hide domain={[0,dm=>dm*5]}/>
                <Tooltip content={<Tip/>}/>
                <Bar yAxisId="v" dataKey="volume" fill="rgba(148,163,184,.1)" radius={[1,1,0,0]}/>
                {/* HMA/200일선 */}
                <Line yAxisId="p" type="monotone" dataKey="hma20" stroke="#F97316" strokeWidth={1.5} dot={false} connectNulls strokeDasharray="4 2"/>
                <Line yAxisId="p" type="monotone" dataKey="ma200" stroke="rgba(148,163,184,.6)" strokeWidth={1.2} dot={false} connectNulls strokeDasharray="3 3"/>
                {/* ★ 11번: Anchored VWAP */}
                {chartOpts.avwap&&<Line yAxisId="p" type="monotone" dataKey="avwap" stroke="#8B5CF6" strokeWidth={1.8} dot={false} connectNulls strokeDasharray="6 3"/>}
                {chartOpts.ichi&&<Area yAxisId="p" type="monotone" dataKey="spanA" stroke="rgba(34,197,94,.7)" fill="rgba(34,197,94,.12)" strokeWidth={1.5} dot={false} connectNulls/>}
                {chartOpts.ichi&&<Area yAxisId="p" type="monotone" dataKey="spanB" stroke="rgba(239,68,68,.7)" fill="rgba(239,68,68,.12)" strokeWidth={1.5} dot={false} connectNulls/>}
                <Area yAxisId="p" type="monotone" dataKey="close" stroke="#ffffff" strokeWidth={2.5} fill="rgba(148,163,184,.03)" dot={false}/>
                {chartOpts.st&&["st1Bull","st2Bull","st3Bull"].map((k,i)=><Line key={k} yAxisId="p" type="monotone" dataKey={k} stroke={C.emerald} strokeWidth={2.5-i*.5} dot={false} connectNulls={false} strokeOpacity={1-.2*i}/>)}
                {chartOpts.st&&["st1Bear","st2Bear","st3Bear"].map((k,i)=><Line key={k} yAxisId="p" type="monotone" dataKey={k} stroke={C.red} strokeWidth={2.5-i*.5} dot={false} connectNulls={false} strokeOpacity={1-.2*i}/>)}
                {consTgt>0&&<ReferenceLine yAxisId="p" y={consTgt} stroke="transparent" label={{value:`▶ ${unit}${consTgt.toLocaleString()}`,fill:C.accent,fontSize:7,position:"insideRight"}}/>}
                {stopPrice>0&&<ReferenceLine yAxisId="p" y={stopPrice} stroke="transparent" label={{value:`▶ 손절 ${unit}${stopPrice.toLocaleString()}`,fill:C.red,fontSize:7,position:"insideRight"}}/>}
                {chartRefDate&&<ReferenceLine x={chartRefDate} stroke="#8B5CF6" strokeWidth={2} strokeDasharray="4 2" label={{value:"📌",fill:"#8B5CF6",fontSize:10,position:"top"}}/>}
                <Scatter yAxisId="p" dataKey="buyStrong" fill="#4ade80" shape={<BuyDot dataKey="buyStrong"/>}/>
                <Scatter yAxisId="p" dataKey="buyNormal" fill="#F59E0B" shape={<BuyDot dataKey="buyNormal"/>}/>
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
                <ReferenceLine y={70} stroke="rgba(239,68,68,.25)"/>
                <ReferenceLine y={30} stroke="rgba(34,197,94,.25)"/>
                <Area type="monotone" dataKey="rsi" stroke={C.accent} fill="rgba(59,130,246,.07)" strokeWidth={1.5} dot={false}/>
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
                <Area type="monotone" dataKey="obv" stroke={C.purple} fill="rgba(139,92,246,.08)" strokeWidth={1.5} dot={false} connectNulls/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>}

          {/* ★ 11번: Squeeze TTM */}
          <div style={{...css.card,padding:"6px 6px 3px",marginBottom:6}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingLeft:6,marginBottom:3}}>
              <span style={{fontSize:7,color:C.muted}}>Squeeze TTM <span style={{fontSize:6,color:lastD?.sqzOn?"#F59E0B":"rgba(255,255,255,.3)"}}>● {lastD?.sqzOn?"스퀴즈 압축중":"스퀴즈 해제"}</span></span>
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
                  const fill=pos?(rising?"#22C55E":"#4ADE80"):(rising?"#F87171":"#DC2626");
                  const h=Math.abs(height||0);
                  return<rect x={x} y={pos?y:y+height-h} width={Math.max(1,width)} height={h} fill={fill} rx={1}/>;
                }}/>
              </ComposedChart>
            </ResponsiveContainer>
            {/* 스퀴즈 도트 */}
            <div style={{display:"flex",gap:2,paddingLeft:6,paddingBottom:3,overflowX:"hidden"}}>
              {sliced.slice(-40).map((d,i)=>(
                <div key={i} style={{width:4,height:4,borderRadius:"50%",flexShrink:0,
                  background:d.sqzOff?"#DC2626":d.sqzOn?"#F59E0B":"rgba(255,255,255,.2)"}}
                  title={d.sqzOn?"압축중":d.sqzOff?"해제!":"없음"}/>
              ))}
            </div>
            <div style={{display:"flex",gap:8,paddingLeft:6,fontSize:7,color:C.muted,paddingBottom:2}}>
              <span>🟡 압축중</span><span>🔴 해제</span><span>⚪ 없음</span>
            </div>
          </div>
          </>}

          {/* ★ v2.3: 지표 요약 + 상세 접기 */}
          <div style={{...css.card,marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}} onClick={()=>setShowIndicDetail(!showIndicDetail)}>
              <div style={{fontSize:9,fontWeight:700,color:C.accent}}>📊 지표 현황</div>
              <span style={{fontSize:8,color:C.muted,cursor:"pointer"}}>{showIndicDetail?"상세 ▲":"상세 ▼"}</span>
            </div>
            {(()=>{
              const rsi=lastD?.rsi;const macdUp=lastD?.macd>lastD?.signal;const histUp=lastD?.hist>(cd?.data?.at(-2)?.hist||0);
              const adx=lastD?.adx||0;const adxUp=adx>=25;const volR=selInfo?.volRatio||selInfo?._volRatio||100;
              const rs=((selInfo?.chg5d||0)-idxRS.spy.chg5d);
              const items=[
                macdUp&&histUp?{icon:"🟢",text:`MACD 양전 + 히스토 증가 (가속)`,c:C.emerald}
                :macdUp?{icon:"🟡",text:`MACD 양전 (모멘텀 유지)`,c:C.yellow}
                :{icon:"🔴",text:`MACD 음전 (하락 모멘텀)`,c:C.red},
                rsi>75?{icon:"⚠️",text:`RSI ${rsi?.toFixed(0)} 과열 — 단기 조정 가능`,c:C.red}
                :rsi>=50&&rsi<=70?{icon:"🟢",text:`RSI ${rsi?.toFixed(0)} 건강 구간`,c:C.emerald}
                :rsi<30?{icon:"🎯",text:`RSI ${rsi?.toFixed(0)} 과매도 — 반등 가능`,c:C.yellow}
                :{icon:"⚪",text:`RSI ${rsi?.toFixed(0)||"—"}`,c:C.muted},
                adxUp?{icon:"📈",text:`ADX ${adx.toFixed(0)} — 추세 강함`,c:C.emerald}:{icon:"➖",text:`ADX ${adx.toFixed(0)} — 추세 약함`,c:C.muted},
                volR>=200?{icon:"💥",text:`거래량 ${volR}% — 폭발`,c:C.emerald}:volR>=150?{icon:"📊",text:`거래량 ${volR}% — 증가`,c:C.green}:{icon:"📉",text:`거래량 ${volR}% — 보통`,c:C.muted},
                rs>3?{icon:"🚀",text:`RS +${rs.toFixed(1)}%p — 시장 대비 매우 강`,c:C.emerald}:rs>0?{icon:"💪",text:`RS +${rs.toFixed(1)}%p — 시장 대비 강`,c:C.yellow}:{icon:"📉",text:`RS ${rs.toFixed(1)}%p — 시장 대비 약`,c:C.red},
              ];
              return<>
                <div style={{marginTop:6}}>
                  {items.map((it,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0"}}>
                    <span style={{fontSize:10}}>{it.icon}</span>
                    <span style={{fontSize:8,color:it.c,fontWeight:600}}>{it.text}</span>
                  </div>)}
                </div>
                {showIndicDetail&&<div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5,marginTop:8,paddingTop:8,borderTop:`1px solid ${C.border}`}}>
                  {[
                    {l:"RSI",v:rsi?.toFixed(0)||"-",c:rsi>70?C.red:rsi<30?C.green:C.text},
                    {l:"MACD",v:lastD?.macd?.toFixed(2)||"-",c:macdUp?C.green:C.red},
                    {l:"히스토",v:lastD?.hist?.toFixed(2)||"-",c:(lastD?.hist||0)>0?C.green:C.red},
                    {l:"ADX",v:adx.toFixed(0),c:adxUp?C.emerald:C.muted},
                    {l:"ATR%",v:atrDaily?`±${atrDaily}`:"-",c:C.accent},
                  ].map((m,i)=><div key={i} style={{background:"rgba(0,0,0,.4)",borderRadius:5,padding:"4px",textAlign:"center"}}>
                    <div style={{fontSize:6,color:C.muted}}>{m.l}</div>
                    <div style={{fontSize:11,fontWeight:900,color:m.c}}>{m.v}</div>
                  </div>)}
                </div>}
              </>;
            })()}
          </div>

          {/* ★ v2.3: 관찰 등록 버튼 */}
          {!tracking.find(t=>t.ticker===sel)&&!positions.find(p=>p.ticker===sel)&&<button onClick={()=>{
            const cdc2=cd?.data;const tm2=calcEntryTiming(cdc2);const dr2=calcTrendDurability(cdc2);
            const{score,signals,rs}=alphaScore(selInfo,cdc2,idxRS);
            setTracking(p=>[...p,{id:Date.now(),ticker:sel,label:selInfo.label,market:selInfo.market,basePrice:curPrice,addedDate:new Date().toLocaleDateString("ko-KR"),foundScore:score,foundSignals:signals,foundRS:rs,foundTiming:tm2.score,foundDurability:dr2.score,oppScoreAt:oppScore,source:navSource||"차트"}]);
            setAddMsg(`👁 ${selInfo.label} 관찰 등록 (⚡${tm2.score} 💪${dr2.score})`);setTimeout(()=>setAddMsg(""),3000);
          }} style={{width:"100%",background:"rgba(59,130,246,.08)",border:`1px solid ${C.accent}`,borderRadius:8,padding:"10px",color:C.accent,fontWeight:700,fontSize:11,cursor:"pointer",marginBottom:10}}>
            👁 관찰 등록 — 추적탭에서 모니터링
          </button>}
          {tracking.find(t=>t.ticker===sel)&&<div style={{textAlign:"center",padding:"8px",marginBottom:10,borderRadius:8,background:"rgba(59,130,246,.06)",border:`1px solid ${C.accent}`}}>
            <span style={{fontSize:9,color:C.accent}}>👁 관찰 중 — </span>
            <button onClick={()=>{setTab("track");setTrackTab("watch");}} style={{fontSize:9,color:C.accent,background:"none",border:"none",cursor:"pointer",textDecoration:"underline",fontWeight:700}}>추적탭에서 확인</button>
          </div>}

          {/* 체크리스트 */}
          <div style={{...css.card,marginBottom:10,border:`1px solid ${checkOk?C.emerald:C.border}`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8}}>✅ 매매 전 체크리스트</div>
            {[
              ["market",lastD?.allBull&&vixVal<25,"📊 지수 추세 상승 (ST 매수배경 · VIX 25 이하)"],
              ["sector",true,"🏭 목표 업종이 당일 강세 섹터"],
              ["stock",selTiming.score>=40&&selDurability.score>=40,"📈 타이밍 "+selTiming.score+" · 강도 "+selDurability.score],
              ["timing",lastD?.allBull&&(lastD?.macd||0)>(lastD?.signal||0),"⏰ 트리플 ST 매수 + MACD 크로스"],
              ["risk",stopPrice>0&&stopPrice<curPrice,"🛑 손절가 현재가 아래 확인"],
            ].map(([key,autoVal,label])=>(
              <div key={key} onClick={()=>setChecklist(c=>({...c,[key]:!c[key]}))} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid rgba(148,163,184,.05)`,cursor:"pointer"}}>
                <div style={{width:16,height:16,borderRadius:3,border:`1px solid ${(checklist[key]||autoVal)?C.emerald:C.border}`,background:(checklist[key]||autoVal)?"rgba(34,197,94,.2)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,flexShrink:0}}>
                  {(checklist[key]||autoVal)?<span style={{color:C.emerald}}>✓</span>:""}
                </div>
                <span style={{fontSize:9,color:(checklist[key]||autoVal)?C.text:C.muted}}>{label}</span>
                {autoVal&&<span style={{fontSize:7,color:C.emerald,marginLeft:"auto"}}>자동</span>}
              </div>
            ))}
          </div>

          {/* 매수 등록 */}
          <button onClick={()=>{
            if(!checkOk)return;
            const snap={stCount:[lastD?.st1Bull,lastD?.st2Bull,lastD?.st3Bull].filter(v=>v!=null).length,cloud:lastD?.aboveCloud?"above":lastD?.nearCloud?"near":"below",macdCross:lastD?.macd>lastD?.signal,rsi:lastD?.rsi?+lastD.rsi.toFixed(0):null,vix:+vixVal.toFixed(1),oppScore,foundTiming:selTiming.score,foundDurability:selDurability.score};
            const initAmt=prompt("투입 금액 (만원 단위, 예: 50):");
            if(!initAmt)return;
            const realAmt=parseInt(initAmt)*10000;
            const autoMode=realAmt>(riskSettings.totalCapital||5000000)?"special":"basic";
            const autoCap=autoMode==="special"?(riskSettings.specialCapital||10000000):(riskSettings.totalCapital||5000000);
            const autoPyr=autoMode==="special"?PYRAMID_SPECIAL:PYRAMID_BASIC;
            // ★ 불타기 단계 자동 채우기: 투입금액까지 알아서 채움
            let remaining=realAmt;
            const pyramid=autoPyr.map((r,i)=>{
              const stepAmt=Math.round(autoCap*r.pct/100);
              const filled=remaining>=stepAmt;
              const actual=filled?stepAmt:Math.max(0,remaining);
              remaining-=actual;
              return{step:i+1,label:r.label,pct:r.pct,targetPct:r.targetPct,triggered:actual>0,amount:stepAmt,actualAmount:actual,executedAt:actual>0?new Date().toLocaleDateString("ko-KR"):""};
            });
            setPositions(p=>[...p,{id:Date.now(),ticker:sel,label:selInfo.label,market:selInfo.market,entry:curPrice,current:curPrice,max:curPrice,trailStop:+(curPrice*(1-trailSettings.initialStopPct/100)).toFixed(isKRSel?0:2),trailMode:false,target:consTgt,pnl:0,date:new Date().toLocaleDateString("ko-KR"),entryTime:new Date().toLocaleTimeString("ko-KR"),foundScore:entryScore.score,foundSignals:entryScore.breakdown.filter(b=>b.ok).map(b=>b.label),foundTiming:selTiming.score,foundDurability:selDurability.score,snapshot:snap,oppScoreAt:oppScore,source:navSource||"차트",investMode:autoMode,pyramid}]);
            setTab("track");setTrackTab("hold");setAddMsg(`📌 ${selInfo.label} ₩${fmtKRW(realAmt)} 보초 매수 (${autoMode==="special"?"⭐특별":"기본"})`);setTimeout(()=>setAddMsg(""),3000);
          }} style={{width:"100%",background:checkOk?"linear-gradient(135deg,#22C55E,#16A34A)":"rgba(148,163,184,.05)",border:`1px solid ${checkOk?C.emerald:C.border}`,borderRadius:10,padding:"14px 16px",color:checkOk?"#000":C.muted,fontWeight:900,fontSize:12,cursor:checkOk?"pointer":"not-allowed",opacity:checkOk?1:0.5}}>
            {checkOk?"📈 보초 매수 등록":"✅ 체크리스트를 먼저 완료하세요"}
          </button>
        </div>}
        {tab==="sniper"&&!selInfo&&<div style={{padding:"40px 20px",textAlign:"center",color:C.muted}}><div style={{fontSize:24,marginBottom:8}}>🎯</div><div>발굴탭에서 종목을 선택하거나 검색해주세요</div></div>}

        {/* ══ TAB 4: 추적 (통합) ══ */}
        {tab==="track"&&<div style={{padding:"12px 14px"}}>
          <div style={{fontSize:12,fontWeight:900,color:C.accent,marginBottom:10}}>📊 추적 탭</div>

          {/* 4 서브탭 */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:4,marginBottom:14}}>
            {[["watch",`👁 관찰중 (${tracking.length})`],["hold",`💼 보유중 (${positions.length})`],["closed",`✅ 청산 (${closedLog.length})`],["stats","📈 성적분석"],["journal","📝 일지"]].map(([k,l])=>(
              <button key={k} onClick={()=>setTrackTab(k)} style={{padding:"8px 4px",borderRadius:7,border:`1px solid ${trackTab===k?C.accent:C.border}`,background:trackTab===k?"rgba(59,130,246,.12)":"rgba(148,163,184,.03)",color:trackTab===k?C.accent:C.muted,fontWeight:trackTab===k?700:400,fontSize:9,cursor:"pointer"}}>{l}</button>
            ))}
          </div>

          {/* 관찰중 */}
          {trackTab==="watch"&&<div>
            {tracking.length===0
              ?<div style={{textAlign:"center",padding:"40px 0",color:C.muted}}><div style={{fontSize:28,marginBottom:8}}>👁</div><div style={{fontSize:10}}>차트탭에서 "👁 관찰" 또는 발굴탭에서 "추적"을 누르면 추가됩니다</div></div>
              :<div style={{display:"flex",flexDirection:"column",gap:8}}>
                {tracking.map((t,i)=>{
                  const info=stocks.find(s=>s.ticker===t.ticker) || (pool[t.ticker] ? {ticker:t.ticker, ...pool[t.ticker]} : null);
                  const cur=info?.price||t.basePrice;
                  const chg=+((cur-t.basePrice)/t.basePrice*100).toFixed(2);
                  const isKR=(t.ticker?.length||0)>5;
                  const cdc=charts[t.ticker]?.data;
                  const tm=calcEntryTiming(cdc);
                  const dr=calcTrendDurability(cdc);
                  const daysWatched=t.addedDate?Math.round((Date.now()-new Date(t.addedDate).getTime())/86400000):0;
                  return<div key={t.id||i} style={{...css.card,border:`1px solid ${chg>=5?C.emerald:chg<=-3?C.red:C.border}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <div>
                        <span style={{fontWeight:900,fontSize:12}}>{fmtName(t,8)}</span>
                        <span style={{fontSize:7,color:C.muted,marginLeft:6}}>{daysWatched}일째 관찰</span>
                        {t.source&&<span style={{fontSize:6,marginLeft:4,padding:"1px 4px",borderRadius:2,background:"rgba(139,92,246,.1)",color:C.purple}}>{t.source}</span>}
                      </div>
                      <div style={{textAlign:"right"}}>
                        <span style={{fontSize:18,fontWeight:900,color:chg>=0?C.green:C.red}}>{chg>=0?"+":""}{chg}%</span>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:4,marginBottom:6,fontSize:8,color:C.muted}}>
                      <span>기준 {isKR?"₩":"$"}{isKR?fmtKRW(t.basePrice):t.basePrice.toLocaleString()}</span>
                      <span>→ 현재 {isKR?"₩":"$"}{isKR?fmtKRW(cur):cur.toLocaleString()}</span>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:4,marginBottom:8}}>
                      <div style={{background:"rgba(249,115,22,.06)",borderRadius:5,padding:"4px",textAlign:"center",border:`1px solid ${tm.score>=55?"#F97316":"transparent"}`}}>
                        <div style={{fontSize:6,color:C.muted}}>⚡타이밍</div>
                        <div style={{fontSize:14,fontWeight:900,color:tm.score>=55?"#F97316":tm.score>=40?C.yellow:C.muted}}>{tm.score}</div>
                      </div>
                      <div style={{background:"rgba(34,197,94,.06)",borderRadius:5,padding:"4px",textAlign:"center",border:`1px solid ${dr.score>=55?C.emerald:"transparent"}`}}>
                        <div style={{fontSize:6,color:C.muted}}>💪강도</div>
                        <div style={{fontSize:14,fontWeight:900,color:dr.score>=55?C.emerald:dr.score>=40?C.green:C.muted}}>{dr.score}</div>
                      </div>
                      <div style={{background:"rgba(0,0,0,.4)",borderRadius:5,padding:"4px",textAlign:"center"}}>
                        <div style={{fontSize:6,color:C.muted}}>종합</div>
                        <div style={{fontSize:14,fontWeight:900,color:C.accent}}>{t.foundScore||"—"}</div>
                      </div>
                      <div style={{background:"rgba(0,0,0,.4)",borderRadius:5,padding:"4px",textAlign:"center"}}>
                        <div style={{fontSize:6,color:C.muted}}>1D</div>
                        <div style={{fontSize:14,fontWeight:900,color:(info?.changePct||0)>=0?C.green:C.red}}>{(info?.changePct||0)>=0?"+":""}{(info?.changePct||0).toFixed(1)}%</div>
                      </div>
                    </div>
                    {(t.foundSignals||[]).length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:2,marginBottom:6}}>
                      <span style={{fontSize:7,color:C.muted}}>등록사유:</span>
                      {t.foundSignals.slice(0,4).map(sig=><span key={sig} style={{fontSize:6,padding:"1px 4px",borderRadius:2,background:"rgba(59,130,246,.1)",color:C.accent}}>{sig}</span>)}
                    </div>}
                    {tm.score>=55&&dr.score>=55&&<div style={{background:"rgba(34,197,94,.08)",borderRadius:5,padding:"4px 8px",marginBottom:6,textAlign:"center"}}>
                      <span style={{fontSize:8,fontWeight:700,color:C.emerald}}>✅ 진입 조건 충족 — 매수 전환 검토</span>
                    </div>}
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={()=>navigateToStock(t.ticker,t)} style={{flex:1,background:"rgba(59,130,246,.1)",border:`1px solid ${C.accent}`,color:C.accent,borderRadius:6,padding:"6px 0",cursor:"pointer",fontSize:9,fontWeight:700}}>📊 차트</button>
                      <button onClick={()=>{
                        const lD=cdc?.at(-1);const pInfo=pool[t.ticker]||{};
                        const snap={stCount:[lD?.st1Bull,lD?.st2Bull,lD?.st3Bull].filter(v=>v!=null).length,cloud:lD?.aboveCloud?"above":lD?.nearCloud?"near":"below",vix:+vixVal.toFixed(1),oppScore,foundTiming:tm.score,foundDurability:dr.score};
                        const amt=prompt("투입 금액 (만원 단위, 예: 50):");
                        if(!amt)return;const realAmt=parseInt(amt)*10000;
                        const autoMode=realAmt>(riskSettings.totalCapital||5000000)?"special":"basic";
                        const autoCap=autoMode==="special"?(riskSettings.specialCapital||10000000):(riskSettings.totalCapital||5000000);
                        const autoPyr=autoMode==="special"?PYRAMID_SPECIAL:PYRAMID_BASIC;
                        let remaining2=realAmt;
                        const pyramid=autoPyr.map((r,idx)=>{
                          const stepAmt=Math.round(autoCap*r.pct/100);
                          const filled=remaining2>=stepAmt;
                          const actual=filled?stepAmt:Math.max(0,remaining2);
                          remaining2-=actual;
                          return{step:idx+1,label:r.label,pct:r.pct,targetPct:r.targetPct,triggered:actual>0,amount:stepAmt,actualAmount:actual,executedAt:actual>0?new Date().toLocaleDateString("ko-KR"):""};
                        });
                        setPositions(p=>[...p,{id:Date.now(),ticker:t.ticker,label:t.label,market:t.market,entry:cur,current:cur,max:cur,trailStop:+(cur*(1-trailSettings.initialStopPct/100)).toFixed(isKR?0:2),trailMode:false,target:0,pnl:0,date:new Date().toLocaleDateString("ko-KR"),entryTime:new Date().toLocaleTimeString("ko-KR"),foundScore:t.foundScore,foundSignals:t.foundSignals,foundRS:t.foundRS,foundTiming:tm.score,foundDurability:dr.score,snapshot:snap,oppScoreAt:t.oppScoreAt,source:t.source||"관찰",investMode:autoMode,pyramid}]);
                        setTracking(p=>p.filter((_,j)=>j!==i));
                        setTrackTab("hold");setAddMsg(`📌 ${t.label} ₩${fmtKRW(realAmt)} 매수 전환 (${autoMode==="special"?"⭐특별":"기본"})`);setTimeout(()=>setAddMsg(""),3000);
                      }} style={{flex:1,background:"rgba(34,197,94,.1)",border:`1px solid ${C.emerald}`,color:C.emerald,borderRadius:6,padding:"6px 0",cursor:"pointer",fontSize:9,fontWeight:700}}>💼 매수 전환</button>
                      <button onClick={()=>{
                        setClosedLog(p=>[{...t,exitPrice:cur,pnl:chg,exitDate:new Date().toLocaleDateString("ko-KR"),reason:"관찰종료",phase:"watch"},...p]);
                        setTracking(p=>p.filter((_,j)=>j!==i));
                      }} style={{background:"rgba(148,163,184,.05)",border:`1px solid ${C.border}`,color:C.muted,borderRadius:6,padding:"6px 8px",cursor:"pointer",fontSize:9}}>✕</button>
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
              <span style={{fontSize:8,color:"#F97316"}}>│ ⏰ 타임컷 {trailSettings.timeCutDays||14}일/±{trailSettings.timeCutPct||3}%</span>
              <button onClick={()=>setShowRiskPanel(true)} style={{...css.btn(),fontSize:7,padding:"1px 6px",marginLeft:"auto"}}>변경</button>
            </div>
            {overPositions&&<div style={{background:"rgba(239,68,68,.08)",border:`1px solid rgba(239,68,68,.3)`,borderRadius:7,padding:"6px 10px",marginBottom:10,fontSize:9,color:C.red,fontWeight:700}}>⚠ 최대 종목수 초과 ({positions.length}/{riskSettings.maxPositions}) — 일부 포지션 청산 고려</div>}
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
                  return<div key={pos.id} style={{...css.card,border:`2px solid ${near?"rgba(239,68,68,.8)":isTimeCut?"rgba(249,115,22,.7)":volDrop?"rgba(250,204,21,.6)":pos.trailMode?"rgba(250,204,21,.5)":C.border}`,animation:near?"ap 2s infinite":""}}>
                    {/* 매매 신호 배너 */}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,padding:"5px 10px",borderRadius:6,background:`${holdColor}10`,border:`1px solid ${holdColor}30`}}>
                      <span style={{fontSize:10,fontWeight:900,color:holdColor}}>{holdEmoji} {holdLabel}</span>
                      <span style={{fontSize:8,color:C.muted}}>{posLd?`ST${posStCount}/3`:"—"} · 수익 {pnl>=0?"+":""}{pnl.toFixed(1)}% · {nextPyramid?`다음 불타기 +${nextPyramid.targetPct}%`:"불타기 완료"}</span>
                    </div>
                    {near&&<div style={{background:"rgba(239,68,68,.15)",borderRadius:5,padding:"4px 8px",fontSize:8,color:C.red,fontWeight:700,marginBottom:8}}>🚨 손절선 근접 ({stopDist.toFixed(1)}%) — 즉시 확인!</div>}
                    {isTimeCut&&!near&&<div style={{background:"rgba(249,115,22,.12)",border:"1px solid rgba(249,115,22,.4)",borderRadius:5,padding:"6px 10px",fontSize:8,color:"#F97316",fontWeight:700,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span>⏰ 타임컷 경고 — {tc.daysHeld}일 보유, 손익 ±{tc.absPnl?.toFixed(1)}% (박스권 {trailSettings.timeCutDays}일/{trailSettings.timeCutPct}% 기준)</span>
                      <button onClick={()=>{
                        if(window.confirm(`${pos.label}: ${tc.daysHeld}일간 ±${tc.absPnl?.toFixed(1)}% 정체. 타임컷 청산하시겠습니까?`)){
                          setClosedLog(h=>[{...pos,exitPrice:cur,exitDate:new Date().toLocaleDateString("ko-KR"),finalPnl:pnl,reason:"타임컷",phase:"hold",holdDays:pos.timeCutInfo?.daysHeld||0},...h]);
                          setPositions(p=>p.filter(x=>x.id!==pos.id));
                        }
                      }} style={{background:"rgba(249,115,22,.2)",border:"1px solid #F97316",color:"#F97316",borderRadius:4,padding:"2px 8px",cursor:"pointer",fontSize:8,fontWeight:700,flexShrink:0}}>⏰ 타임컷 청산</button>
                    </div>}
                    {volDrop&&!near&&!isTimeCut&&<div style={{background:"rgba(250,204,21,.1)",borderRadius:5,padding:"4px 8px",fontSize:8,color:C.yellow,fontWeight:700,marginBottom:8}}>⚠️ 거래량 급감 ({posVolRatio}% / 20일평균) — 모멘텀 약화 주의</div>}
                    {/* 불타기 알림 */}
                    {pendingPyramid.map(lv=>(
                      <div key={lv.level} style={{background:"rgba(34,197,94,.12)",border:`1px solid ${C.emerald}`,borderRadius:5,padding:"4px 8px",fontSize:8,color:C.emerald,fontWeight:700,marginBottom:6}}>
                        🔥 불타기 {lv.level}차 목표 +{lv.targetPct}% 달성! ({lv.triggeredAt}) — 추가 매수 고려
                      </div>
                    ))}

                    {/* ★ v2.3: 상태 대시보드 — 타임컷·손절·목표 시각화 */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:10}}>
                      {/* 타임컷 타이머 */}
                      <div style={{background:"rgba(0,0,0,.5)",borderRadius:8,padding:"8px",textAlign:"center"}}>
                        <div style={{fontSize:7,color:isTimeCut?"#F97316":C.muted,fontWeight:700}}>⏰ 타임컷</div>
                        <div style={{fontSize:16,fontWeight:900,color:isTimeCut?"#F97316":(tc.daysHeld||0)>=((trailSettings.timeCutDays||14)-3)?C.yellow:C.text}}>{tc.daysHeld||0}<span style={{fontSize:9,color:C.muted}}>/{trailSettings.timeCutDays||14}일</span></div>
                        <div style={{height:4,background:"rgba(255,255,255,.1)",borderRadius:2,marginTop:4,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${Math.min(100,((tc.daysHeld||0)/(trailSettings.timeCutDays||14))*100)}%`,background:isTimeCut?"#F97316":(tc.daysHeld||0)>=((trailSettings.timeCutDays||14)-3)?C.yellow:"rgba(255,255,255,.2)",borderRadius:2,transition:"width .5s"}}/>
                        </div>
                        {isTimeCut&&<div style={{fontSize:7,color:"#F97316",marginTop:2,fontWeight:700}}>⚠ 초과</div>}
                      </div>
                      {/* 손절 거리 */}
                      <div style={{background:near?"rgba(239,68,68,.12)":"rgba(0,0,0,.5)",borderRadius:8,padding:"8px",textAlign:"center",border:near?`1px solid ${C.red}`:"none"}}>
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
                        <div style={{fontSize:9,color:C.muted}}>진입 {u}{u==="₩"?fmtKRW(pos.entry):pos.entry.toLocaleString()} · {pos.date} <span style={{color:(pos.timeCutInfo?.daysHeld||0)>=(trailSettings.timeCutDays||14)?"#F97316":C.muted}}>({pos.timeCutInfo?.daysHeld||0}일째)</span>{pos.source&&<span style={{fontSize:6,marginLeft:4,padding:"1px 4px",borderRadius:2,background:"rgba(139,92,246,.1)",color:C.purple}}>{pos.source}</span>}</div>
                        <div style={{display:"flex",gap:5,marginTop:3}}>
                          {pos.foundGrade&&(()=>{const gc={S:C.emerald,A:C.green,B:C.yellow,C:"#F97316",D:C.red}[pos.foundGrade]||C.muted;return<span style={{fontSize:7,background:`${gc}18`,color:gc,border:`1px solid ${gc}`,borderRadius:3,padding:"1px 4px"}}>진입 {pos.foundGrade}등급</span>;})()}
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
                        }} style={{background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",color:C.red,borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:9,fontWeight:700,flexShrink:0}}>청산 ✕</button>
                      </div>
                    </div>

                    {/* 12번: 불타기 단계 */}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                      <div style={{fontSize:9,color:C.muted,fontWeight:700}}>🔥 불타기 계획</div>
                      <div style={{display:"flex",gap:3}}>
                        {[["basic","기본"],["special","⭐특별"]].map(([k,l])=>(
                          <button key={k} onClick={()=>setPositions(p=>p.map(x=>x.id===pos.id?{...x,investMode:k,pyramid:(k==="special"?PYRAMID_SPECIAL:PYRAMID_BASIC).map((r,j)=>({step:j+1,label:r.label,pct:r.pct,targetPct:r.targetPct,triggered:j===0||(x.pyramid?.[j]?.triggered||false),amount:Math.round((k==="special"?(riskSettings.specialCapital||10000000):(riskSettings.totalCapital||5000000))*r.pct/100)}))}:x))} style={{padding:"2px 6px",borderRadius:4,fontSize:7,fontWeight:(pos.investMode||"basic")===k?700:400,border:`1px solid ${(pos.investMode||"basic")===k?C.accent:C.border}`,background:(pos.investMode||"basic")===k?"rgba(59,130,246,.15)":"transparent",color:(pos.investMode||"basic")===k?C.accent:C.muted,cursor:"pointer"}}>{l}</button>
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
                          return<div key={i} style={{borderRadius:7,padding:"6px 4px",border:`1px solid ${triggered?"rgba(34,197,94,.4)":"rgba(148,163,184,.12)"}`,background:triggered?"rgba(34,197,94,.06)":C.panel2,textAlign:"center"}}>
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
                            }} style={{marginTop:3,fontSize:7,padding:"2px 6px",borderRadius:3,border:`1px solid ${C.accent}`,background:"rgba(59,130,246,.1)",color:C.accent,cursor:"pointer",fontWeight:700}}>실행</button>}
                          </div>;
                        })}
                      </div>;
                    })()}

                    {/* 12번: 손절 기준 (명확화) */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
                      <div style={{background:"rgba(239,68,68,.07)",border:"1px solid rgba(239,68,68,.25)",borderRadius:7,padding:"7px 10px"}}>
                        <div style={{fontSize:8,color:C.red,fontWeight:700}}>🛑 초기 손절 (-{trailSettings.initialStopPct}%)</div>
                        <div style={{fontSize:7,color:C.muted,marginBottom:3}}>매수가 기준 · +{trailSettings.switchPct}% 전까지</div>
                        <div style={{fontSize:16,fontWeight:900,color:C.red}}>{u}{u==="₩"?fmtKRW(pos.entry*(1-trailSettings.initialStopPct/100)):(pos.entry*(1-trailSettings.initialStopPct/100)).toFixed(2)}</div>
                      </div>
                      <div style={{background:pos.trailMode?"rgba(250,204,21,.1)":"rgba(148,163,184,.03)",border:`1px solid ${pos.trailMode?"rgba(250,204,21,.4)":"rgba(255,255,255,.1)"}`,borderRadius:7,padding:"7px 10px"}}>
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
                <div style={{display:"grid",gridTemplateColumns:"0.5fr 1.5fr 0.8fr 0.8fr 0.8fr 0.7fr",padding:"6px 10px",background:"rgba(148,163,184,.03)",fontSize:7,color:C.muted,fontWeight:700}}>
                  <span>구분</span><span>종목</span><span>손익</span><span>이유</span><span>이후</span><span>판정</span>
                </div>
                {closedLog.map((h,i)=>{
                  const pnl=parseFloat(h.pnl||h.finalPnl||0);
                  const isKR=(h.ticker?.length||0)>5;
                  const exit=h.exitPrice||h.current||0;
                  const isWatch=h.phase==="watch";
                  const curInfo=stocks.find(s=>s.ticker===h.ticker)||pool[h.ticker];
                  const curP=curInfo?.price||0;
                  const afterPct=exit>0&&curP>0?+((curP-exit)/exit*100).toFixed(1):null;
                  const goodSell=afterPct!==null&&afterPct<-2;
                  const badSell=afterPct!==null&&afterPct>5;
                  return<div key={i} style={{display:"grid",gridTemplateColumns:"0.5fr 1.5fr 0.8fr 0.8fr 0.8fr 0.7fr",padding:"7px 10px",borderTop:"1px solid rgba(148,163,184,.04)",fontSize:9,background:pnl>=0?"rgba(34,197,94,.03)":"rgba(239,68,68,.03)"}}>
                    <span style={{fontSize:7,color:isWatch?C.accent:C.emerald,fontWeight:700}}>{isWatch?"👁":"💼"}</span>
                    <div>
                      <div style={{fontWeight:700,fontSize:9}}>{fmtName(h)}</div>
                      <div style={{fontSize:6,color:C.accent,cursor:"pointer",textDecoration:"underline"}} onClick={()=>{
                        navigateToStock(h.ticker,h);
                        if(h.exitDate){
                          const parts=h.exitDate.split(/[.\/-]/);
                          const mo=parseInt(parts[parts.length-2]||parts[0]);
                          const da=parseInt(parts[parts.length-1]||parts[1]);
                          const cData=charts[h.ticker]?.data;
                          if(cData){const match=cData.find(d=>{const dd=d.date||"";return dd.includes(`${mo}/${da}`)||dd.includes(`${mo}-${da}`);});if(match)setChartRefDate(match.date);}
                        }
                      }}>{h.exitDate||"—"} 정리</div>
                    </div>
                    <span style={{color:pnl>=0?C.green:C.red,fontWeight:700}}>{pnl>=0?"+":""}{pnl.toFixed(1)}%</span>
                    <span style={{color:h.reason==="타임컷"?"#F97316":h.reason==="손절"?C.red:h.reason==="관찰종료"?C.accent:C.muted,fontSize:8}}>{h.reason||"수동"}</span>
                    <span style={{color:afterPct>0?C.green:afterPct<0?C.red:C.muted,fontWeight:600,fontSize:8}}>{afterPct!==null?`${afterPct>0?"+":""}${afterPct}`:"—"}</span>
                    <span style={{fontSize:7,fontWeight:700,color:goodSell?C.emerald:badSell?C.red:C.muted}}>{afterPct===null?"—":goodSell?"✅잘팔":badSell?"😢아쉬":"적절"}</span>
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
                    <CartesianGrid stroke="rgba(148,163,184,.06)"/>
                    <XAxis dataKey="idx" tick={{fill:C.muted,fontSize:7}} tickLine={false}/>
                    <YAxis tick={{fill:C.muted,fontSize:7}} tickLine={false} width={45} tickFormatter={v=>`${v>=0?"+":""}${v}%`}/>
                    <Tooltip content={({active,payload})=>{
                      if(!active||!payload?.length)return null;
                      const d2=payload[0]?.payload;
                      return<div style={{background:"#111827",border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",fontSize:10}}>
                        <div style={{color:C.sub,fontWeight:700}}>#{d2.idx} {d2.label}</div>
                        <div style={{color:d2.cumPnl>=0?C.green:C.red,fontWeight:900}}>누적: {d2.cumPnl>=0?"+":""}{d2.cumPnl}%</div>
                        <div style={{color:C.muted}}>자산: ₩{fmtKRW(d2.equity)}</div>
                      </div>;
                    }}/>
                    <ReferenceLine y={0} stroke="rgba(255,255,255,.2)"/>
                    <Area type="monotone" dataKey="cumPnl" stroke={C.emerald} fill="rgba(34,197,94,.1)" strokeWidth={2} dot={false}/>
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
                      return<div key={sig} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 0",borderBottom:`1px solid rgba(148,163,184,.05)`}}>
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
                      return<div key={bin.label} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 0",borderBottom:`1px solid rgba(148,163,184,.05)`}}>
                        <span style={{fontSize:9,color:C.text,flex:1}}>{bin.label}</span>
                        <span style={{fontSize:8,color:C.muted}}>{items.length}건</span>
                        <span style={{fontSize:9,fontWeight:700,color:wr>=60?C.green:wr>=40?C.yellow:C.red}}>{wr}%승</span>
                        <span style={{fontSize:9,fontWeight:700,color:avg>=0?C.emerald:C.red}}>{avg>=0?"+":""}{avg}%</span>
                      </div>;
                    });
                  })()}
                </div>
              </div>

              {/* ★ v2.3: 소스별 성과 분석 */}
              <div style={css.card}>
                <div style={{fontSize:10,fontWeight:700,color:C.purple,marginBottom:8}}>📍 소스별 성과 — 어디서 고른 종목이 잘 맞나?</div>
                {(()=>{
                  const bySource={};
                  closedLog.forEach(h=>{
                    const src=h.source||"미분류";
                    if(!bySource[src])bySource[src]={count:0,wins:0,totalPnl:0};
                    bySource[src].count++;
                    const pnl=parseFloat(h.pnl||h.finalPnl||0);
                    if(pnl>0)bySource[src].wins++;
                    bySource[src].totalPnl+=pnl;
                  });
                  const entries=Object.entries(bySource).sort((a,b)=>b[1].count-a[1].count);
                  if(!entries.length)return<div style={{fontSize:9,color:C.muted,textAlign:"center",padding:10}}>청산 기록이 쌓이면 소스별 성과를 비교합니다</div>;
                  return entries.map(([src,d])=>{
                    const wr=+(d.wins/d.count*100).toFixed(0);
                    const avg=+(d.totalPnl/d.count).toFixed(1);
                    return<div key={src} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 0",borderBottom:`1px solid rgba(148,163,184,.05)`}}>
                      <span style={{fontSize:7,padding:"2px 6px",borderRadius:3,background:"rgba(139,92,246,.1)",color:C.purple,fontWeight:700,minWidth:50}}>{src}</span>
                      <span style={{fontSize:8,color:C.muted}}>{d.count}건</span>
                      <div style={{flex:1,height:4,background:"rgba(148,163,184,.1)",borderRadius:2,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${wr}%`,background:wr>=60?C.emerald:wr>=40?C.yellow:C.red,borderRadius:2}}/>
                      </div>
                      <span style={{fontSize:9,fontWeight:700,color:wr>=60?C.green:wr>=40?C.yellow:C.red,minWidth:30}}>{wr}%</span>
                      <span style={{fontSize:9,fontWeight:700,color:avg>=0?C.emerald:C.red,minWidth:40,textAlign:"right"}}>{avg>=0?"+":""}{avg}%</span>
                    </div>;
                  });
                })()}
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
                      return<div key={combo} style={{display:"flex",alignItems:"center",gap:4,padding:"5px 0",borderBottom:`1px solid rgba(148,163,184,.05)`}}>
                        <span style={{fontSize:7,color:d.type==="풀조합"?C.purple:d.type==="조합"?C.accent:C.muted,background:d.type==="풀조합"?"rgba(139,92,246,.1)":"transparent",borderRadius:3,padding:"1px 4px",flexShrink:0}}>{d.type}</span>
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
                <textarea rows="4" value={investNotes} onChange={e=>setInvestNotes(e.target.value)} placeholder={"오늘의 시장 관찰, 매매 반성...\n예) NVDA 구름 돌파 확인, 내일 눌림목 2차 매수 고려"} style={{background:"rgba(148,163,184,.03)",border:`1px solid ${C.border}`,borderRadius:8,padding:10,color:C.text,fontSize:10,resize:"vertical",outline:"none",lineHeight:1.8,width:"100%"}}/>
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
                  <input value={journalDraft.ticker} onChange={e=>setJournalDraft(p=>({...p,ticker:e.target.value}))} placeholder={sel||"티커"} style={{width:"100%",background:"rgba(148,163,184,.05)",border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",color:C.text,fontSize:10,outline:"none"}}/>
                </div>
                <div>
                  <div style={{fontSize:8,color:C.muted,marginBottom:3}}>유형</div>
                  <select value={journalDraft.type} onChange={e=>setJournalDraft(p=>({...p,type:e.target.value}))} style={{width:"100%",background:"rgba(148,163,184,.05)",border:`1px solid ${C.border}`,borderRadius:5,padding:"5px",color:C.text,fontSize:10}}>
                    {["진입","추가매수","일부청산","전량청산","관찰","반성"].map(t2=><option key={t2} value={t2}>{t2}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{fontSize:8,color:C.muted,marginBottom:3}}>감정상태</div>
                  <select value={journalDraft.emotion} onChange={e=>setJournalDraft(p=>({...p,emotion:e.target.value}))} style={{width:"100%",background:"rgba(148,163,184,.05)",border:`1px solid ${C.border}`,borderRadius:5,padding:"5px",color:C.text,fontSize:10}}>
                    {["차분","자신감","불안","FOMO","욕심","보통"].map(em=><option key={em} value={em}>{em}</option>)}
                  </select>
                </div>
              </div>
              <div style={{marginBottom:8}}>
                <div style={{fontSize:8,color:C.muted,marginBottom:3}}>사유 / 근거</div>
                <input value={journalDraft.reason} onChange={e=>setJournalDraft(p=>({...p,reason:e.target.value}))} placeholder="예: ST3/3 전환 + 거래량 급증, 섹터 RS 상위" style={{width:"100%",background:"rgba(148,163,184,.05)",border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",color:C.text,fontSize:10,outline:"none"}}/>
              </div>
              <div style={{marginBottom:8}}>
                <div style={{fontSize:8,color:C.muted,marginBottom:3}}>메모</div>
                <textarea rows="2" value={journalDraft.note} onChange={e=>setJournalDraft(p=>({...p,note:e.target.value}))} placeholder="추가 메모..." style={{width:"100%",background:"rgba(148,163,184,.03)",border:`1px solid ${C.border}`,borderRadius:5,padding:"5px 8px",color:C.text,fontSize:10,outline:"none",resize:"vertical"}}/>
              </div>
              <button onClick={addJournalEntry} style={{width:"100%",background:"linear-gradient(135deg,#8B5CF6,#8B5CF6)",border:"none",borderRadius:8,padding:"8px",color:"#fff",fontWeight:700,fontSize:10,cursor:"pointer"}}>✏️ 일지 저장</button>
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
                    <span style={{fontSize:8,padding:"1px 6px",borderRadius:4,background:j.type==="진입"?"rgba(34,197,94,.12)":j.type.includes("청산")?"rgba(239,68,68,.12)":"rgba(59,130,246,.08)",color:j.type==="진입"?C.emerald:j.type.includes("청산")?C.red:C.accent}}>{j.type}</span>
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


        {/* ══ TAB 5: 종목풀 ══ */}
        {tab==="pool"&&<div style={{padding:"12px 14px"}}>
          <div style={{fontSize:12,fontWeight:900,color:C.accent,marginBottom:4}}>🗂 종목풀 관리</div>
          <div style={{fontSize:9,color:C.sub,marginBottom:12}}>
            {(()=>{
              const entries=Object.entries(pool);
              const kr=entries.filter(([t,v])=>/^\d{6}$/.test(t)||v.market==="kr").length;
              const us=entries.length-kr;
              return`총 ${entries.length}개 (🇰🇷${kr} · 🇺🇸${us})${us<10?" ⚠️ US종목 부족":""}`;
            })()}
          </div>
          <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
            <input value={poolFilter} onChange={e=>setPoolFilter(e.target.value)} placeholder="종목명/티커 검색..." style={{flex:1,minWidth:120,background:"rgba(148,163,184,.05)",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 10px",color:C.text,fontSize:10,outline:"none"}}/>
            {[["all","전체"],["kr","🇰🇷 한국"],["us","🇺🇸 미국"]].map(([v,l])=>(
              <button key={v} onClick={()=>setPoolMarket(v)} style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${poolMarket===v?C.accent:C.border}`,background:poolMarket===v?"rgba(59,130,246,.12)":"transparent",color:poolMarket===v?C.accent:C.muted,fontSize:9,cursor:"pointer"}}>{l}</button>
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
            }} style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${C.accent}`,background:"rgba(59,130,246,.1)",color:C.accent,fontSize:9,cursor:"pointer",fontWeight:700}}>
              {poolLoaded?"🔄 새로고침":"📦 풀 로드"}
            </button>
          </div>
          {poolMsg&&<div style={{fontSize:9,color:C.accent,marginBottom:8,padding:"6px 10px",background:"rgba(59,130,246,.08)",borderRadius:6}}>{poolMsg}</div>}
          <div style={css.card}>
            <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8}}>⭐ 현재 관심종목 ({stocks.length}개)</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {stocks.map(s=>(
                <div key={s.ticker} style={{display:"flex",alignItems:"center",gap:4,background:"rgba(59,130,246,.08)",border:`1px solid rgba(59,130,246,.15)`,borderRadius:5,padding:"3px 8px"}}>
                  <span style={{fontSize:9,fontWeight:700,color:C.accent}}>{fmtName(s,8)}</span>
                  <button onClick={()=>removeStock(s.ticker)} style={{background:"none",border:"none",color:"rgba(239,68,68,.6)",cursor:"pointer",fontSize:10,padding:0}}>✕</button>
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
                  return<div key={ticker} style={{background:C.panel2,border:`1px solid ${inWatch?"rgba(59,130,246,.4)":C.border}`,borderRadius:7,padding:"7px 9px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <div style={{fontSize:9,fontWeight:700,color:inWatch?C.accent:C.text,maxWidth:80,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fmtName({ticker,...info},8)}</div>
                        <div style={{fontSize:7,color:C.muted}}>{/^\d{6}$/.test(ticker)?ticker:info.label?.slice(0,12)||""}</div>
                      </div>
                      <button onClick={async()=>{
                        if(inWatch){removeStock(ticker);}
                        else{try{await fetch("/api/watchlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker,...info})});setStocks(p=>[...p,{ticker,...info,...(pool[ticker]||{})}]);setPoolMsg(`✅ ${info.label} 추가`);}catch{setPoolMsg("❌ 실패");}}
                        setTimeout(()=>setPoolMsg(""),3000);
                      }} style={{background:inWatch?"rgba(59,130,246,.12)":"rgba(148,163,184,.04)",border:`1px solid ${inWatch?C.accent:C.border}`,borderRadius:4,padding:"2px 6px",cursor:"pointer",color:inWatch?C.accent:C.muted,fontSize:10,flexShrink:0}}>{inWatch?"★":"☆"}</button>
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
