/**
 * Alpha Terminal v3.3 — App.jsx
 * 데이터: GitHub Actions → /public/data/stocks.json → Yahoo Finance (1시간 갱신)
 * 폴백:  데이터 없으면 시뮬레이션 자동 사용
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
};
const SIG = {
  BUY:  { bg:"#14532d", color:"#4ade80", border:"#22c55e" },
  HOLD: { bg:"#451a03", color:"#fbbf24", border:"#f59e0b" },
  SELL: { bg:"#450a0a", color:"#f87171", border:"#ef4444" },
};
const SECTORS = {
  Semiconductor:{ roe:24.6, per:28.9, rev:22.1 },
  Technology:   { roe:28.5, per:32.1, rev:18.4 },
  Auto:         { roe: 9.8, per:12.4, rev: 6.3 },
  Finance:      { roe:12.3, per:10.2, rev: 5.1 },
  Consumer:     { roe:18.2, per:20.5, rev: 7.8 },
  Healthcare:   { roe:16.8, per:24.7, rev:10.2 },
  Energy:       { roe:14.1, per:11.3, rev: 4.5 },
};
const PERIOD_DAYS = { "1M":22, "3M":66, "6M":130, "1Y":252, "ALL":9999 };

// ── 기본 종목 (데이터 로딩 전 / 폴백 시 사용) ───────────────
const INITIAL = [
  { ticker:"NVDA",   label:"NVIDIA",    sector:"Semiconductor", market:"🇺🇸", price:112.5,  target:170,   roe:91.4, per:28.1, rev:122.4, base:80,    vol:0.028, drift:0.001,  mktCap:2750, liquidity:8.2,  revGrowth:122 },
  { ticker:"AAPL",   label:"Apple",     sector:"Technology",    market:"🇺🇸", price:193.6,  target:240,   roe:160.1,per:29.1, rev:4.9,   base:170,   vol:0.014, drift:0.0005, mktCap:2950, liquidity:3.1,  revGrowth:5   },
  { ticker:"TSLA",   label:"Tesla",     sector:"Auto",          market:"🇺🇸", price:242.0,  target:300,   roe:18.3, per:52.4, rev:1.1,   base:200,   vol:0.038, drift:-0.001, mktCap:775,  liquidity:12.4, revGrowth:1   },
  { ticker:"MSFT",   label:"Microsoft", sector:"Technology",    market:"🇺🇸", price:388.5,  target:500,   roe:38.5, per:34.1, rev:15.2,  base:350,   vol:0.016, drift:0.0008, mktCap:2890, liquidity:2.8,  revGrowth:15  },
  { ticker:"META",   label:"Meta",      sector:"Technology",    market:"🇺🇸", price:571.3,  target:700,   roe:32.1, per:26.3, rev:21.4,  base:500,   vol:0.022, drift:0.001,  mktCap:1450, liquidity:4.2,  revGrowth:21  },
  { ticker:"005930", label:"삼성전자",  sector:"Semiconductor", market:"🇰🇷", price:55700,  target:75000, roe:8.7,  per:14.2, rev:63.2,  base:55000, vol:0.016, drift:0.0005, mktCap:332,  liquidity:1.8,  revGrowth:63  },
  { ticker:"000660", label:"SK하이닉스",sector:"Semiconductor", market:"🇰🇷", price:182500, target:240000,roe:22.4, per:10.1, rev:88.5,  base:175000,vol:0.022, drift:0.0008, mktCap:133,  liquidity:2.4,  revGrowth:89  },
  { ticker:"005380", label:"현대차",    sector:"Auto",          market:"🇰🇷", price:204000, target:280000,roe:14.2, per:5.8,  rev:8.3,   base:200000,vol:0.018, drift:0.0005, mktCap:43,   liquidity:0.9,  revGrowth:8   },
  { ticker:"035420", label:"NAVER",     sector:"Technology",    market:"🇰🇷", price:201000, target:260000,roe:8.9,  per:21.4, rev:12.1,  base:195000,vol:0.018, drift:0.0005, mktCap:33,   liquidity:1.2,  revGrowth:12  },
  { ticker:"035720", label:"카카오",    sector:"Technology",    market:"🇰🇷", price:42850,  target:58000, roe:3.2,  per:38.7, rev:-4.1,  base:42000, vol:0.025, drift:-0.001, mktCap:19,   liquidity:2.1,  revGrowth:-4  },
];
const SEARCH_DB = {
  "GOOGL":{ label:"Google",  sector:"Technology",    market:"🇺🇸", price:175.8, target:210,   roe:29.4, per:22.1, rev:14.8, base:145,  vol:0.017, drift:0.0011, mktCap:2190, liquidity:3.2, revGrowth:15 },
  "AMD":  { label:"AMD",     sector:"Semiconductor", market:"🇺🇸", price:100.2, target:160,   roe:4.2,  per:44.8, rev:13.7, base:120,  vol:0.032, drift:-0.001, mktCap:163,  liquidity:6.8, revGrowth:14 },
  "AMZN": { label:"Amazon",  sector:"Consumer",      market:"🇺🇸", price:198.4, target:250,   roe:21.6, per:42.1, rev:12.3, base:165,  vol:0.019, drift:0.001,  mktCap:2110, liquidity:2.9, revGrowth:12 },
};

// 한국어 종목명 → 티커 변환 DB
const KR_NAME_DB = {
  // 코스피 대형주
  "삼성전자":"005930","삼성":"005930",
  "sk하이닉스":"000660","하이닉스":"000660","SK하이닉스":"000660",
  "lg에너지솔루션":"373220","LG에너지솔루션":"373220",
  "삼성바이오로직스":"207940","삼성바이오":"207940",
  "현대차":"005380","현대자동차":"005380",
  "기아":"000270","기아차":"000270",
  "셀트리온":"068270",
  "kb금융":"105560","KB금융":"105560",
  "신한지주":"055550","신한":"055550",
  "하나금융지주":"086790","하나금융":"086790",
  "포스코홀딩스":"005490","포스코":"005490","POSCO":"005490",
  "삼성sdi":"006400","삼성SDI":"006400",
  "lg화학":"051910","LG화학":"051910",
  "카카오뱅크":"323410",
  "한국전력":"015760",
  "삼성물산":"028260",
  "현대모비스":"012330",
  "lg전자":"066570","LG전자":"066570",
  "롯데케미칼":"011170",
  "sk이노베이션":"096770","SK이노베이션":"096770",
  "두산에너빌리티":"034020",
  "한화에어로스페이스":"012450","한화에어로":"012450",
  "한국항공우주":"047810","KAI":"047810",
  // 코스닥
  "카카오":"035720",
  "naver":"035420","NAVER":"035420","네이버":"035420",
  "카카오게임즈":"293490",
  "엔씨소프트":"036570","엔씨":"036570",
  "넷마블":"251270",
  "크래프톤":"259960",
  "펄어비스":"263750",
  "하이브":"352820","BTS":"352820",
  "에코프로비엠":"247540","에코프로":"086520",
  "레인보우로보틱스":"277810",
  "휴마시스":"205470",
  "알테오젠":"196170",
  "리가켐바이오":"141080",
  "삼천당제약":"000250",
  // 미국 (한국어 검색용)
  "엔비디아":"NVDA","NVIDIA":"NVDA",
  "애플":"AAPL","Apple":"AAPL",
  "테슬라":"TSLA","Tesla":"TSLA",
  "마이크로소프트":"MSFT","MS":"MSFT",
  "메타":"META","페이스북":"META",
  "구글":"GOOGL","Google":"GOOGL","알파벳":"GOOGL",
  "아마존":"AMZN","Amazon":"AMZN",
  "AMD":"AMD",
  "인텔":"INTC","Intel":"INTC",
  "팔란티어":"PLTR","Palantir":"PLTR",
  "아이온큐":"IONQ","IonQ":"IONQ",
  "화이자":"PFE","Pfizer":"PFE",
  "넷플릭스":"NFLX","Netflix":"NFLX",
  "스타벅스":"SBUX","Starbucks":"SBUX",
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
// 1b. Opportunity Score 계산 (VIX + 지수등락 + 섹터RS)
function calcOpportunityScore(vix, spChg3d, kospiChg3d, sectorRS) {
  let score = 50;
  if (vix > 0) {
    if (vix < 15) score += 20;
    else if (vix < 20) score += 10;
    else if (vix < 25) score += 0;
    else if (vix < 30) score -= 10;
    else score -= 20;
  }
  if (spChg3d > 2) score += 15;
  else if (spChg3d > 0) score += 8;
  else if (spChg3d > -2) score -= 5;
  else score -= 15;
  if (kospiChg3d > 2) score += 10;
  else if (kospiChg3d > 0) score += 5;
  else if (kospiChg3d > -2) score -= 3;
  else score -= 10;
  const bull = (sectorRS||[]).filter(s=>s.chg1W>0).length;
  score += bull * 2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// 2. 지표 계산
// ═══════════════════════════════════════════════════════════
function genCandles(info) {
  const data = []; const now = new Date(); let p = info.base;
  for (let i = 180; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    p = p * (1 + (Math.random() - 0.48) * info.vol + info.drift);
    const r = p * info.vol * 0.7;
    data.push({ date:`${d.getMonth()+1}/${d.getDate()}`, high:+(p+Math.random()*r).toFixed(2), low:+(p-Math.random()*r).toFixed(2), close:+p.toFixed(2), volume:Math.floor((1e6+Math.random()*5e6)*(0.8+Math.random()*0.8)) });
  }
  if (data.length) data[data.length-1].close = info.price;
  return data;
}
function calcST(candles, period, mult) {
  const atrs = [];
  for (let i=1; i<candles.length; i++) atrs.push(Math.max(candles[i].high-candles[i].low, Math.abs(candles[i].high-candles[i-1].close), Math.abs(candles[i].low-candles[i-1].close)));
  const res = [];
  for (let i=period; i<candles.length; i++) {
    const atr = atrs.slice(i-period,i).reduce((a,b)=>a+b)/period, hl2=(candles[i].high+candles[i].low)/2;
    let ub=hl2+mult*atr, lb=hl2-mult*atr; const prev=res[res.length-1];
    if (prev) { lb=lb>prev.lb||candles[i-1].close<prev.lb?lb:prev.lb; ub=ub<prev.ub||candles[i-1].close>prev.ub?ub:prev.ub; }
    const trend = prev?(prev.trend===-1?(candles[i].close>prev.ub?1:-1):(candles[i].close<prev.lb?-1:1)):1;
    res.push({ st:+(trend===1?lb:ub).toFixed(2), trend, lb, ub });
  }
  return res;
}
function calcEMA(closes, p) { const k=2/(p+1); let e=closes[0]; return closes.map(v=>{e=v*k+e*(1-k);return+e.toFixed(3);}); }
function calcRSI(closes, p=14) {
  const rsi=new Array(p).fill(null); let g=0,l=0;
  for(let i=1;i<=p;i++){const d=closes[i]-closes[i-1];if(d>0)g+=d;else l-=d;}
  let ag=g/p,al=l/p; rsi.push(al===0?100:+(100-100/(1+ag/al)).toFixed(2));
  for(let i=p+1;i<closes.length;i++){const d=closes[i]-closes[i-1];ag=(ag*(p-1)+(d>0?d:0))/p;al=(al*(p-1)+(d<0?-d:0))/p;rsi.push(al===0?100:+(100-100/(1+ag/al)).toFixed(2));}
  return rsi;
}
function calcMACD(closes,fast=12,slow=26,sig=9) {
  const ef=calcEMA(closes,fast),es=calcEMA(closes,slow);
  const ml=closes.map((_,i)=>+(ef[i]-es[i]).toFixed(3)),sl=calcEMA(ml,sig);
  return{ml,sl,hist:ml.map((v,i)=>+(v-sl[i]).toFixed(3))};
}
function calcATR(candles,p=14) {
  const trs=[];for(let i=1;i<candles.length;i++)trs.push(Math.max(candles[i].high-candles[i].low,Math.abs(candles[i].high-candles[i-1].close),Math.abs(candles[i].low-candles[i-1].close)));
  const res=new Array(p).fill(null);let atr=trs.slice(0,p).reduce((a,b)=>a+b)/p;res.push(+atr.toFixed(2));
  for(let i=p;i<trs.length;i++){atr=(atr*(p-1)+trs[i])/p;res.push(+atr.toFixed(2));}
  return res;
}
function buildChartData(candles) {
  const closes=candles.map(c=>c.close);
  const s1=calcST(candles,10,1),s2=calcST(candles,11,2),s3=calcST(candles,12,3);
  const ema50=calcEMA(closes,50),rsi=calcRSI(closes),{ml,sl,hist}=calcMACD(closes),atr=calcATR(candles);
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
      bullSignal:allBull?candles[ci].close:null,
      bearSignal:!allBull?candles[ci].close:null,
      ema50:ema50[ci],rsi:rsi[ci],macd:ml[ci],signal:sl[ci],hist:hist[ci],atr:atr[ci],bullCount,allBull};
  });
  for(let i=1;i<data.length;i++){const c=data[i],p=data[i-1],flip=c.bullCount===3&&p.bullCount<3,mx=c.macd>c.signal&&p.macd<=p.signal;if(flip&&mx)c.buyStrong=c.close;else if(flip)c.buyNormal=c.close;}
  const ac=data.map(d=>d.close);
  data.forEach((d,i)=>{d.ma20=i>=19?+(ac.slice(i-19,i+1).reduce((a,b)=>a+b)/20).toFixed(2):null;});
  const w52H=Math.max(...ac.slice(-252)),w52L=Math.min(...ac.slice(-252));
  const last=data[data.length-1];
  last.w52High=+w52H.toFixed(2);last.w52Low=+w52L.toFixed(2);
  last.w52Near=last.close>=w52H*0.95;last.w52DistPct=+((last.close-w52H)/w52H*100).toFixed(1);
  const highs=candles.map(c=>c.high),lows=candles.map(c=>c.low);
  const midV=(arr,s,e)=>(Math.max(...arr.slice(s,e))+Math.min(...arr.slice(s,e)))/2;
  data.forEach((d,ii)=>{const cii=ii+off;if(cii>=25){const t=midV(highs,cii-8,cii+1),k=midV(highs,cii-25,cii+1);d.spanA=+((t+k)/2).toFixed(2);}d.spanB=cii>=51?+midV(highs,cii-51,cii+1).toFixed(2):null;if(d.spanA&&d.spanB){d.spanHigh=Math.max(d.spanA,d.spanB);d.spanLow=Math.min(d.spanA,d.spanB);}});
  const lp=last;const ct=lp.spanA&&lp.spanB?Math.max(lp.spanA,lp.spanB):null;
  lp.aboveCloud=ct&&lp.close>ct;lp.nearCloud=ct&&!lp.aboveCloud&&lp.close>=ct*0.97;lp.inCloud=ct&&lp.close<=ct&&lp.spanB&&lp.close>=lp.spanB;
  return data;
}
function getQuantSig(s,b){const n=[s.roe>b.roe,s.per<b.per,s.rev>5].filter(Boolean).length;return n>=2?"BUY":n===1?"HOLD":"SELL";}
function getTSTSig(data){if(!data?.length)return{sig:"N/A",bull:0};const l=data[data.length-1];return{sig:l.bullCount===3?"BUY":l.bullCount>=2?"HOLD":"SELL",bull:l.bullCount};}
function getFinalSig(tst,quant,rsi){const sc={BUY:2,HOLD:1,SELL:0},t=(sc[tst]||0)+(sc[quant]||0);if(rsi>=75&&tst==="BUY")return"HOLD";return t>=3?"BUY":t<=1?"SELL":"HOLD";}
function alphaScore(s,chartData){
  const last=chartData?.[chartData.length-1],b=SECTORS[s.sector]||{roe:15,per:20,rev:10};let sc=0;
  if(last?.st1Bull!=null)sc+=12;if(last?.st2Bull!=null)sc+=12;if(last?.st3Bull!=null)sc+=12;
  if(s.roe>b.roe)sc+=10;if(s.per<b.per)sc+=8;if(s.rev>20)sc+=12;else if(s.rev>10)sc+=6;
  if(last?.w52Near)sc+=10;if(last?.aboveCloud)sc+=8;return Math.min(100,sc);
}

// ═══════════════════════════════════════════════════════════
// 3. 서브컴포넌트
// ═══════════════════════════════════════════════════════════
const Tip=({active,payload,label})=>{
  if(!active||!payload?.length)return null;
  return<div style={{background:"#0a0f1e",border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",fontSize:10}}><div style={{color:C.sub,marginBottom:4,fontWeight:700}}>{label}</div>{payload.filter(p=>p.value!=null).map((p,i)=><div key={i} style={{color:p.color||C.text}}>{p.name}: <b>{typeof p.value==="number"?p.value.toLocaleString(undefined,{maximumFractionDigits:2}):p.value}</b></div>)}</div>;
};
const BuyDot=({cx,cy,payload,dataKey})=>{if(!payload[dataKey])return null;const c=dataKey==="buyStrong"?"#4ade80":"#fbbf24",sz=dataKey==="buyStrong"?11:8;return<g><polygon points={`${cx},${cy-sz} ${cx-sz*.8},${cy+sz*.5} ${cx+sz*.8},${cy+sz*.5}`} fill={c} stroke="#000" strokeWidth="1" opacity=".9"/></g>;};
function CandleBar(props){
  const {x,y,width,height,close,open} = props;
  if(!x||!y||!width||!close) return null;
  const isBull=(close||0)>=(open||close);
  const color=isBull?"#22c55e":"#ef4444";
  const cx=x+width/2;
  const barH=Math.max(Math.abs(height||1),2);
  return <g>
    <rect x={x+1} y={y} width={Math.max(width-2,1)} height={barH} fill={color} opacity={0.85}/>
    <line x1={cx} y1={y-4} x2={cx} y2={y} stroke={color} strokeWidth={1}/>
    <line x1={cx} y1={y+barH} x2={cx} y2={y+barH+4} stroke={color} strokeWidth={1}/>
  </g>;
}
function BullSignal({cx,cy}){if(!cx||!cy)return null;return <polygon points={`${cx},${cy-9} ${cx-6},${cy+1} ${cx+6},${cy+1}`} fill="#22c55e"/>;}
function BearSignal({cx,cy}){if(!cx||!cy)return null;return <polygon points={`${cx},${cy+9} ${cx-6},${cy-1} ${cx+6},${cy-1}`} fill="#ef4444"/>;}
const HistBar=({x,y,width,height,value})=>{if(value==null)return null;const h=Math.abs(height),pos=value>0;return<rect x={x} y={pos?y:y+height-h} width={Math.max(1,width)} height={h} fill={pos?"rgba(34,197,94,.7)":"rgba(239,68,68,.7)"} rx={1}/>;};

// 인라인 스타일 헬퍼
const css = {
  card: { background:C.panel, border:`1px solid ${C.border}`, borderRadius:10, padding:12, marginBottom:10 },
  panel2: { background:C.panel2, border:`1px solid ${C.border}`, borderRadius:7, padding:"8px 10px" },
  sig: (type) => ({ ...SIG[type], borderRadius:4, padding:"1px 7px", fontWeight:900, fontSize:10, display:"inline-block", border:`1px solid ${SIG[type].border}` }),
  btn: (on=false) => ({ borderRadius:6, padding:"5px 11px", cursor:"pointer", fontWeight:700, fontSize:10, border:`1px solid ${on?C.accent:C.border}`, background:on?"rgba(56,189,248,.2)":"rgba(255,255,255,.04)", color:on?C.accent:C.muted }),
  ichi: (st) => ({ fontSize:8, fontWeight:700, padding:"2px 7px", borderRadius:4, display:"inline-block", ...(st==="above"?{background:"rgba(16,185,129,.15)",color:C.emerald,border:"1px solid rgba(16,185,129,.4)"}:st==="near"?{background:"rgba(250,204,21,.1)",color:C.yellow,border:"1px solid rgba(250,204,21,.4)"}:{background:"rgba(239,68,68,.1)",color:"#f87171",border:"1px solid rgba(239,68,68,.3)"}) }),
};

// ═══════════════════════════════════════════════════════════
// 4. 메인 앱
// ═══════════════════════════════════════════════════════════
export default function App() {
  // ── 앱 상태 ─────────────────────────────────────────────
  const [stocks, setStocks] = useState(()=>{
    try{const s=localStorage.getItem("at_stocks");return s?JSON.parse(s):INITIAL;}
    catch{return INITIAL;}
  });
  const [sel, setSel]           = useState("NVDA");
  const [tab, setTab]           = useState("radar");
  const [charts, setCharts]     = useState({});
  const [consensus, setConsensus] = useState({});
  const [search, setSearch]     = useState("");
  const [searchRes, setSearchRes] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [addMsg, setAddMsg]     = useState("");
  const [period, setPeriod]     = useState("3M");

  // ── 데이터 상태 ──────────────────────────────────────────
  const [dataStatus, setDataStatus] = useState("loading"); // loading|real|sim
  const [lastUpdated, setLastUpdated] = useState(null);
  const [indicesData, setIndicesData] = useState({});

  // ── Tab 1 ────────────────────────────────────────────────
  const [rsKey, setRsKey]   = useState("chg1M");
  const [ibVol, setIbVol]   = useState(0);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const SECTOR_RS = [
    {name:"반도체",etf:"SOXX",chg1W:-2.1,chg1M:-7.9,chg3M:-12.1},
    {name:"유틸리티",etf:"XLU",chg1W:+0.8,chg1M:-3.1,chg3M:-4.5},
    {name:"에너지",etf:"XLE",chg1W:+0.3,chg1M:-6.6,chg3M:-8.2},
    {name:"헬스케어",etf:"XLV",chg1W:-0.9,chg1M:-8.6,chg3M:-9.3},
    {name:"금융",etf:"XLF",chg1W:-1.2,chg1M:-12.4,chg3M:-15.1},
    {name:"IT",etf:"XLK",chg1W:-1.8,chg1M:-11.1,chg3M:-14.2},
    {name:"소비재",etf:"XLY",chg1W:-2.4,chg1M:-13.5,chg3M:-16.8},
    {name:"바이오",etf:"XBI",chg1W:-1.5,chg1M:-9.2,chg3M:-11.4},
    {name:"클라우드",etf:"SKYY",chg1W:-2.8,chg1M:-22.2,chg3M:-28.1},
  ];
  // spyRef는 idxRS.spy 사용으로 대체

  // ── Tab 2 ────────────────────────────────────────────────
  const [fLiq, setFLiq]   = useState(0.5);
  const [alphaTab, setAlphaTab]   = useState("filter");
  const [chartOpts, setChartOpts] = useState({ichi:true, st:true});
  const [alphaHitsRemote, setAlphaHitsRemote] = useState([]);
  const [alphaLoaded, setAlphaLoaded] = useState(false);
  const [alphaUpdatedAt, setAlphaUpdatedAt] = useState(null);
  const [pool, setPool]           = useState({});
  const [poolLoaded, setPoolLoaded] = useState(false);
  const [poolFilter, setPoolFilter] = useState("");
  const [poolMarket, setPoolMarket] = useState("all"); // all | kr | us
  const [poolMsg, setPoolMsg]     = useState(""); // filter | pattern | compare
  const [fRev, setFRev]   = useState(0);
  const [watchlist, setWatchlist] = useState([]);
  const [conds, setConds] = useState({ golden:true, box:false, angle:false, ichi:false, vol:false });

  // ── Tab 3 ────────────────────────────────────────────────
  const [stopPct, setStopPct] = useState(5);
  const [atrMult, setAtrMult] = useState(3.0);
  const [checklist, setChecklist] = useState({market:false,sector:false,stock:false,timing:false,risk:false});

  // ── Tab 4 ────────────────────────────────────────────────
  const [positions, setPositions] = useState(()=>{
    try{const s=localStorage.getItem("at_positions");return s?JSON.parse(s):[];}catch{return [];}
  });
  const [history, setHistory] = useState(()=>{
    try{const s=localStorage.getItem("at_history");return s?JSON.parse(s):[];}catch{return [];}
  });

  // ── Tab 5 (IRP) ──────────────────────────────────────────
  const [irpPort, setIrpPort]   = useState([
    {ticker:"KODEX 200",type:"국내주식",weight:30,vol:0.018,drift:0.0008},
    {ticker:"TIGER 미국S&P",type:"해외주식",weight:25,vol:0.022,drift:0.001},
    {ticker:"KODEX 국채3년",type:"채권",weight:25,vol:0.004,drift:0.0002},
    {ticker:"TIGER 리츠",type:"리츠",weight:10,vol:0.015,drift:0.0006},
    {ticker:"KODEX 골드",type:"원자재",weight:10,vol:0.012,drift:0.0003},
  ]);
  const [irpYears, setIrpYears] = useState(3);
  const [irpResult, setIrpResult] = useState(null);
  const [irpSearch, setIrpSearch] = useState("");
  const [investNotes, setInvestNotes] = useState(()=>{
    try{return localStorage.getItem("at_notes")||"";}catch{return "";}
  });

  // ── 추적 기록 ─────────────────────────────────────────────
  const [tracking, setTracking] = useState(()=>{
    try{const s=localStorage.getItem("at_tracking");return s?JSON.parse(s):[];}catch{return [];}
  });
  const [closedLog, setClosedLog] = useState(()=>{
    try{const s=localStorage.getItem("at_closed");return s?JSON.parse(s):[];}catch{return [];}
  });

  // ════════════════════════════════════════════════════════
  // ★ 핵심: stocks.json 에서 실제 데이터 로딩
  // ════════════════════════════════════════════════════════
  useEffect(() => {
    fetch("/data/stocks.json")
      .then(r => { if (!r.ok) throw new Error("no data"); return r.json(); })
      .then(json => {
        const stocksJson = json.stocks || {};
        const indicesJson = json.indices || {};

        // 지수 데이터 저장
        setIndicesData(indicesJson);

        // IB 거래량 (daily Actions에서 계산)
        if (json.ibVol) setIbVol(json.ibVol);

        // IB 거래량 (daily Actions에서 계산)
        if (json.ibVol) setIbVol(json.ibVol);

        // 종목 데이터 머지
        if (Object.keys(stocksJson).length > 0) {
          setStocks(prev => prev.map(s => {
            const real = stocksJson[s.ticker];
            if (!real) return s;
            return {
              ...s,
              price:     real.price     || s.price,
              chg3d:     real.chg3d     ?? s.chg3d,
              chg5d:     real.chg5d     ?? s.chg5d,
              changePct: real.changePct ?? 0,
            };
          }));

          // 차트 빌드 (실제 캔들 데이터 사용)
          const newCharts = {};
          for (const [ticker, sd] of Object.entries(stocksJson)) {
            if (sd.candles && sd.candles.length > 30) {
              try {
                newCharts[ticker] = { data: buildChartData(sd.candles), real: true };
              } catch {}
            }
          }
          setCharts(newCharts);
          setDataStatus("real");
          setLastUpdated(json.updatedAt);
        } else {
          setDataStatus("sim");
        }
      })
      .catch(() => setDataStatus("sim"));
  }, []);

  // stocks/positions/history 변경시 localStorage 자동 저장
  useEffect(()=>{try{localStorage.setItem("at_stocks",JSON.stringify(stocks));}catch{}},[stocks]);
  useEffect(()=>{try{localStorage.setItem("at_positions",JSON.stringify(positions));}catch{}},[positions]);
  useEffect(()=>{try{localStorage.setItem("at_history",JSON.stringify(history));}catch{}},[history]);
  useEffect(()=>{try{localStorage.setItem("at_tracking",JSON.stringify(tracking));}catch{}},[tracking]);
  useEffect(()=>{try{localStorage.setItem("at_closed",JSON.stringify(closedLog));}catch{}},[closedLog]);
  useEffect(()=>{try{localStorage.setItem("at_notes",investNotes);}catch{}},[investNotes]);

  // 시뮬 차트 빌드 (실제 데이터 없는 종목용)
  useEffect(() => {
    if (dataStatus === "loading") return;
    stocks.forEach(s => {
      if (!charts[s.ticker]) {
        const candles = genCandles(s);
        setCharts(prev => ({ ...prev, [s.ticker]: { data: buildChartData(candles), real: false } }));
      }
    });
  }, [dataStatus]);

  // 선택 종목 변경 시 컨센서스 조회
  useEffect(() => {
    const info = stocks.find(s => s.ticker === sel); if (!info) return;
    if (!charts[sel]) {
      const candles = genCandles(info);
      setCharts(prev => ({ ...prev, [sel]: { data: buildChartData(candles), real: false } }));
    }
    if (!consensus[sel]) fetchConsensus(sel, info.label, info.market);
  }, [sel]);

  // 검색
  useEffect(() => {
    if (!search.trim()) { setSearchRes([]); setSearchLoading(false); return; }
    const q = search.trim();
    const already = stocks.map(s => s.ticker);

    // 디바운스 300ms
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await r.json();
        const results = (data.results || [])
          .filter(item => !already.includes(item.ticker))
          .slice(0, 8);

        // 결과 없으면 직접 입력값으로 조회
        if (!results.length) {
          const qUp = q.toUpperCase();
          const krMatch = KR_NAME_DB[q] || KR_NAME_DB[qUp] ||
            Object.entries(KR_NAME_DB).find(([k])=>k.includes(q)||k.toUpperCase().includes(qUp))?.[1];
          const ticker = krMatch || qUp;
          if (!already.includes(ticker)) {
            results.push({ticker, label:`"${q}" 실시간 조회`, _custom:true});
          }
        }
        setSearchRes(results);
      } catch {
        // API 실패시 로컬 DB만 검색
        const qUp = q.toUpperCase();
        const krMatch = KR_NAME_DB[q] || KR_NAME_DB[qUp] ||
          Object.entries(KR_NAME_DB).find(([k])=>k.includes(q)||k.toUpperCase().includes(qUp))?.[1];
        const res = [];
        if (krMatch && !already.includes(krMatch)) {
          res.push({ticker:krMatch, label:`${q} (${krMatch})`, _custom:true});
        } else if (!already.includes(qUp)) {
          res.push({ticker:qUp, label:`"${q}" 실시간 조회`, _custom:true});
        }
        setSearchRes(res);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, stocks]);

  // ── AI 컨센서스 ──────────────────────────────────────────
  const fetchConsensus = useCallback(async (ticker, label, market) => {
    setConsensus(p => { if (p[ticker]?.data || p[ticker]?.loading) return p; return {...p,[ticker]:{loading:true}}; });
    const isKR = market==="🇰🇷";
    const prompt = `${label}(${ticker}) 최신 애널리스트 컨센서스를 검색해 JSON만 출력:\n{"targetMean":숫자,"targetHigh":숫자,"targetLow":숫자,"buyCount":숫자,"holdCount":숫자,"sellCount":숫자,"consensus":"Strong Buy|Buy|Hold|Sell","summary":"한국어50자","updatedAt":"YYYY-MM"}\n목표주가:${isKR?"원":"달러"}`;
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:300,tools:[{type:"web_search_20250305",name:"web_search"}],messages:[{role:"user",content:prompt}]})});
      const j = await r.json();
      const txt = j.content.filter(b=>b.type==="text").map(b=>b.text).join("").replace(/```json|```/g,"").trim();
      setConsensus(p=>({...p,[ticker]:{data:JSON.parse(txt),loading:false}}));
    } catch { setConsensus(p=>({...p,[ticker]:{error:"조회 실패",loading:false}})); }
  }, []);

  // ── AI 시황 브리핑 ────────────────────────────────────────
  const getAI = async () => {
    setAiLoading(true); setAiText("");
    const strongSec = [...SECTOR_RS].sort((a,b)=>b[rsKey]-a[rsKey]).slice(0,3).map(s=>s.name).join(", ");
    const topHits = alphaHits.slice(0,3).map(s=>s.label).join(", ") || "스캔 필요";
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:400,messages:[{role:"user",content:`시니어 퀀트 트레이더로서 오늘 매매 전략 3~4문장으로 핵심만:\nIB거래량:${ibVol}% | 강세섹터:${strongSec} | 퀀트상위:${topHits}`}]})});
      const d = await r.json(); setAiText(d.content?.[0]?.text||"응답 없음");
    } catch { setAiText("API 호출 실패"); }
    setAiLoading(false);
  };

  // ── 종목 추가/제거 ────────────────────────────────────────
  async function addStock(item) {
    if(stocks.find(s=>s.ticker===item.ticker)){setAddMsg("이미 추가됨");setTimeout(()=>setAddMsg(""),2000);return;}
    setSearch(""); setSearchRes([]); setShowSearch(false);
    if(item._custom){
      setAddMsg(`🔍 ${item.ticker} 조회 중...`);
      const real = await fetchFromYahoo(item.ticker);
      if(real){
        setStocks(p=>[...p,real]);
        if(real.candles&&real.candles.length>10){
          try{setCharts(prev=>({...prev,[real.ticker]:{data:buildChartData(real.candles),real:true}}));}catch{}
        }
        setSel(real.ticker); setTab("sniper");
        setAddMsg(`✅ ${real.label} 추가`);
      } else {
        setAddMsg(`❌ ${item.ticker} 조회 실패 — 티커 확인`);
      }
    } else {
      setStocks(p=>[...p,item]); setSel(item.ticker); setTab("sniper");
      setAddMsg(`✅ ${item.label} 추가`);
    }
    setTimeout(()=>setAddMsg(""),3000);
  }

  async function fetchFromYahoo(ticker){
    // 한국투자증권 API로 조회 (Vercel 서버 경유 → CORS 없음)
    try {
      // 1. 현재가 조회
      const qRes = await fetch(`/api/quote?ticker=${ticker}`);
      if(!qRes.ok) throw new Error("quote 실패");
      const qData = await qRes.json();
      if(qData.error) throw new Error(qData.error);

      // 2. 캔들 데이터 조회
      let candles = [];
      try {
        const cRes = await fetch(`/api/candles?ticker=${ticker}`);
        if(cRes.ok){
          const cData = await cRes.json();
          candles = cData.candles || [];
        }
      } catch {}

      const price = qData.price || 0;
      const isKR = /^\d{6}$/.test(ticker);
      return {
        ...qData,
        chg3d: candles.length>3 ? +((candles.at(-1).close-candles.at(-4).close)/candles.at(-4).close*100).toFixed(2) : 0,
        chg5d: candles.length>5 ? +((candles.at(-1).close-candles.at(-6).close)/candles.at(-6).close*100).toFixed(2) : 0,
        candles,
        base: isKR ? Math.round(price*0.88) : +(price*0.88).toFixed(2),
        vol: 0.02, drift: 0.001,
      };
    } catch(e) {
      console.error("KIS API 실패:", e.message);
      // 야후 파이낸스 폴백 시도
      try {
        const isKR = /^\d{6}$/.test(ticker);
        const suffixes = isKR ? [".KS",".KQ"] : [""];
        for (const sfx of suffixes) {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker+sfx}?interval=1d&range=3mo`;
          const r = await fetch("https://corsproxy.io/?url="+encodeURIComponent(url), {signal:AbortSignal.timeout(8000)});
          if (!r.ok) continue;
          const json = await r.json();
          const res = json.chart?.result?.[0];
          if (!res) continue;
          const meta = res.meta;
          const price = parseFloat(meta.regularMarketPrice||meta.previousClose||0);
          if (!price) continue;
          const prev = parseFloat(meta.chartPreviousClose||meta.previousClose||price);
          const ts = res.timestamp||[], q = res.indicators?.quote?.[0]||{};
          const candles = ts.map((t,i)=>{
            const d = new Date(t*1000);
            return {date:`${d.getMonth()+1}/${d.getDate()}`,close:+(q.close?.[i]||price).toFixed(2),high:+(q.high?.[i]||price).toFixed(2),low:+(q.low?.[i]||price).toFixed(2),volume:q.volume?.[i]||0};
          }).filter(c=>c.close>0);
          return {
            ticker, label: meta.longName||meta.shortName||ticker,
            price, change:+(price-prev).toFixed(2), changePct:+((price-prev)/prev*100).toFixed(2),
            chg3d: candles.length>3?+((candles.at(-1).close-candles.at(-4).close)/candles.at(-4).close*100).toFixed(2):0,
            chg5d: candles.length>5?+((candles.at(-1).close-candles.at(-6).close)/candles.at(-6).close*100).toFixed(2):0,
            sector:"Technology", market:isKR?"🇰🇷":"🇺🇸",
            roe:0, per:0, rev:0, revGrowth:0, mktCap:meta.marketCap||0,
            target:+(price*1.2).toFixed(isKR?0:2), liquidity:2,
            base:+(price*0.88).toFixed(isKR?0:2), vol:0.02, drift:0.001, candles,
          };
        }
      } catch {}
      return null;
    }
  }
  function removeStock(t){setStocks(p=>p.filter(s=>s.ticker!==t));if(sel===t)setSel(stocks[0]?.ticker||"");}

  // ── IRP 백테스트 ─────────────────────────────────────────
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
  const selInfo  = stocks.find(s=>s.ticker===sel);
  const bench    = selInfo ? SECTORS[selInfo.sector] : null;
  const cd       = charts[sel];
  const lastD    = cd?.data?.at(-1);
  const sliced   = cd?.data?.slice(-PERIOD_DAYS[period])||[];
  const tstSig   = getTSTSig(cd?.data);
  const quantSig = selInfo&&bench ? getQuantSig(selInfo,bench) : "N/A";
  const finalSig = selInfo&&bench ? getFinalSig(tstSig.sig,quantSig,lastD?.rsi||0) : "N/A";
  const fs       = SIG[finalSig]||SIG.HOLD;
  const unit     = sel?.length>5 ? "원" : "$";
  const curPrice = selInfo?.price||0;
  const w52H     = lastD?.w52High||0;
  const stopPrice= w52H>0 ? +(w52H*(1-stopPct/100)).toFixed(unit==="원"?0:2) : 0;
  const atrTgt   = lastD?.atr&&lastD?.ma20 ? +(lastD.ma20+lastD.atr*atrMult).toFixed(unit==="원"?0:2) : 0;
  const consTgt  = consensus[sel]?.data?.targetMean||selInfo?.target||0;
  const rsPremTgt= consTgt ? +(consTgt*1.1).toFixed(unit==="원"?0:2) : 0;
  const rrRatio  = stopPrice>0&&consTgt>0&&curPrice>stopPrice ? +((consTgt-curPrice)/(curPrice-stopPrice)).toFixed(1) : 0;
  const buyOk    = finalSig!=="SELL"; // R:R 제한 제거
  const checkOk  = Object.values(checklist).every(Boolean);

  // Opportunity Score 계산 (실시간)
  const vixVal = parseFloat(indicesData["^VIX"]?.price || 20);
  const spChg3d = indicesData["^GSPC"]?.chg3d ?? 0;
  const kospiChg3d = indicesData["^KS11"]?.chg3d ?? 0;
  const oppScore = calcOpportunityScore(vixVal, spChg3d, kospiChg3d, SECTOR_RS);
  const oppLabel = oppScore >= 70 ? "HIGH" : oppScore >= 45 ? "MODERATE" : "LOW";
  const oppColor = oppScore >= 70 ? C.emerald : oppScore >= 45 ? C.yellow : C.red;

  // VCP 패턴 감지 (거래량 수축 + 52주 고점 근접)
  function detectVCP(chartData) {
    if (!chartData || chartData.length < 20) return false;
    const recent = chartData.slice(-20);
    const vols = recent.map(d => d.volume).filter(v => v > 0);
    if (vols.length < 10) return false;
    const earlyVol = vols.slice(0,5).reduce((a,b)=>a+b,0)/5;
    const recentVol = vols.slice(-5).reduce((a,b)=>a+b,0)/5;
    const volContract = recentVol < earlyVol * 0.7;
    const prices = chartData.map(d => d.close);
    const w52H = Math.max(...prices);
    const cur = prices[prices.length-1];
    return volContract && cur >= w52H * 0.85;
  }
  // W 패턴 감지 (쌍바닥)
  function detectWPattern(chartData) {
    if (!chartData || chartData.length < 30) return false;
    const prices = chartData.slice(-30).map(d => d.close);
    const lows = [];
    for (let i=2; i<prices.length-2; i++) {
      if (prices[i]<prices[i-1]&&prices[i]<prices[i-2]&&prices[i]<prices[i+1]&&prices[i]<prices[i+2])
        lows.push({idx:i,price:prices[i]});
    }
    if (lows.length >= 2) {
      const [l1,l2] = lows.slice(-2);
      return Math.abs(l1.price-l2.price)/l1.price < 0.05 && l2.idx > l1.idx+5;
    }
    return false;
  }

  const alphaHits = stocks.filter(s=>{
    if((s.liquidity||0)<fLiq) return false;
    if(fRev>0 && (s.revGrowth||s.rev||0)<fRev) return false;
    return true;
  }).map(s=>({...s,score:alphaScore(s,charts[s.ticker]?.data)})).sort((a,b)=>b.score-a.score);

  // 지수 RS (실제 데이터 or 기본값)
  const idxRS = {
    spy:  { chg3d: indicesData["^GSPC"]?.chg3d ?? -1.6, chg5d: indicesData["^GSPC"]?.chg5d ?? -2.0 },
    qqq:  { chg3d: indicesData["^IXIC"]?.chg3d ?? -2.1, chg5d: indicesData["^IXIC"]?.chg5d ?? -2.8 },
    kospi:{ chg3d: indicesData["^KS11"]?.chg3d ?? +0.8, chg5d: indicesData["^KS11"]?.chg5d ?? -0.5 },
    kosdaq:{ chg3d:indicesData["^KQ11"]?.chg3d ?? +1.2, chg5d: indicesData["^KQ11"]?.chg5d ?? +0.9 },
  };

  const ichiStatus = lastD?.aboveCloud?"above":lastD?.nearCloud?"near":"below";

  const TABS=[["radar","📡 시장레이더"],["alpha","🎯 알파헌터"],["sniper","🔭 스나이퍼"],["watch",`👁 라이브워치${positions.length?` (${positions.length})`:""}`],["log","📋 기록"],["pool","🗂 종목풀"]];

  // ── 스타일 ──────────────────────────────────────────────
  const pageStyle = { minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"'DM Mono','JetBrains Mono',monospace", display:"flex", flexDirection:"column", fontSize:12 };

  // ── RS 기준선 컴포넌트 ─────────────────────────────────
  const RSBar = () => (
    <div style={{background:C.panel2,border:`1px solid ${C.border}`,borderRadius:9,padding:"10px 14px",marginBottom:12}}>
      <div style={{fontSize:9,fontWeight:700,color:C.muted,marginBottom:7}}>📊 지수 RS 기준선 — 종목 3일/5일과 비교하세요</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
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
      <style>{`@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}} *{box-sizing:border-box} ::-webkit-scrollbar{width:4px;height:4px} ::-webkit-scrollbar-thumb{background:rgba(56,189,248,.2);border-radius:2px} input,select,textarea,button{font-family:inherit}`}</style>

      {/* ── 헤더 ─────────────────────────────────── */}
      <div style={{borderBottom:`1px solid ${C.border}`,padding:"9px 14px",background:"rgba(0,0,0,.97)",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",position:"sticky",top:0,zIndex:50}}>
        <div>
          <div style={{fontSize:13,fontWeight:900,color:C.accent,letterSpacing:2}}>⚡ ALPHA TERMINAL <span style={{fontSize:9,color:C.muted,letterSpacing:1}}>v3.3</span></div>
          <div style={{fontSize:8,color:C.muted}}>Triple ST · Ichimoku · Quant · AI</div>
        </div>
        {/* 데이터 상태 표시 */}
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          {dataStatus==="loading" && <div style={{display:"flex",gap:2,alignItems:"center",color:C.accent,fontSize:8}}>{[0,1,2].map(i=><div key={i} style={{width:3,height:3,borderRadius:"50%",background:C.accent,animation:`bounce 1s ${i*.2}s infinite`}}/>)}데이터 로딩중</div>}
          {dataStatus==="real"    && <span style={{fontSize:8,color:C.green}}>🟢 실시간 데이터 {lastUpdated?`(${new Date(lastUpdated).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})} 기준)`:""}</span>}
          {dataStatus==="sim"     && <span style={{fontSize:8,color:C.yellow}}>🟡 시뮬레이션 (GitHub Actions 미실행)</span>}
        </div>
        <div style={{position:"relative",marginLeft:"auto"}}>
          <input value={search}
            onChange={e=>{setSearch(e.target.value);setShowSearch(true);}}
            onFocus={()=>setShowSearch(true)}
            onKeyDown={e=>{
              if(e.key==="Enter"&&search.trim()){
                const q=search.trim();
                const qUp=q.toUpperCase();
                // 한국어 이름 → 티커 변환
                const krTicker = KR_NAME_DB[q] || KR_NAME_DB[qUp] ||
                  Object.entries(KR_NAME_DB).find(([k])=>k.includes(q)||k.toUpperCase().includes(qUp))?.[1];
                const ticker = krTicker || qUp;
                const found=[...stocks,...Object.entries(SEARCH_DB).map(([t,v])=>({ticker:t,...v}))].find(s=>s.ticker===ticker);
                if(found) addStock(found);
                else addStock({ticker,label:q,_custom:true});
                setShowSearch(false);
              }
            }}
            placeholder="🔍 티커 입력 후 엔터 (예: PFE)" style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 10px",color:C.text,fontSize:10,outline:"none",width:165}}/>
          {(showSearch&&(searchLoading||searchRes.length>0))&&<div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:"#0f172a",border:`1px solid ${C.border}`,borderRadius:7,zIndex:200,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,.8)"}}>
            {searchLoading&&<div style={{padding:"10px 12px",color:C.muted,fontSize:10}}>🔍 검색 중...</div>}
            {!searchLoading&&searchRes.map((r,i)=><div key={i} onClick={()=>addStock(r)} style={{padding:"7px 11px",cursor:"pointer",borderBottom:"1px solid rgba(255,255,255,.05)",display:"flex",justifyContent:"space-between"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(56,189,248,.1)"} onMouseLeave={e=>e.currentTarget.style.background=""}><span style={{color:r._custom?C.accent:C.text,fontWeight:700}}>{r.label} <span style={{color:C.muted,fontSize:8}}>{r._custom?"":r.ticker}</span></span><span style={{color:r._custom?C.accent:C.sub,fontSize:8}}>{r.market||"🔍"}</span></div>)}
          </div>}
        </div>
        {addMsg && <span style={{color:C.green,fontSize:9}}>{addMsg}</span>}
        <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:`1px solid ${C.border}`}}>
          {TABS.map(([k,l])=><button key={k} onClick={()=>setTab(k)} style={{background:tab===k?"rgba(56,189,248,.18)":"transparent",color:tab===k?C.accent:C.muted,border:"none",padding:"5px 9px",cursor:"pointer",fontSize:9,fontWeight:tab===k?700:400,whiteSpace:"nowrap"}}>{l}</button>)}
        </div>
      </div>

      {/* ── 종목바 ───────────────────────────────── */}
      <div style={{display:"flex",gap:3,padding:"4px 10px",overflowX:"auto",borderBottom:`1px solid ${C.border}`,background:"rgba(0,0,0,.3)",alignItems:"center",flexShrink:0}}>
        <span style={{color:C.muted,fontSize:8,flexShrink:0}}>{stocks.length}종목</span>
        {stocks.map(stk=>{
          const b=SECTORS[stk.sector]||{},sg=getQuantSig(stk,b),ss=SIG[sg];
          const rd=stk;
          return<div key={stk.ticker} style={{flexShrink:0,display:"flex"}}>
            <button onClick={()=>{setSel(stk.ticker);setTab("sniper");}} style={{background:sel===stk.ticker?"rgba(56,189,248,.18)":"transparent",border:`1px solid ${sel===stk.ticker?C.accent:C.border}`,borderRadius:"4px 0 0 4px",padding:"2px 5px",cursor:"pointer",display:"flex",flexDirection:"column"}}>
              <div style={{display:"flex",gap:2,alignItems:"center"}}>
                <span style={{color:sel===stk.ticker?C.accent:C.text,fontSize:9,fontWeight:700}}>{stk.label}</span>
                <span style={{...css.sig(sg),fontSize:7,padding:"0 3px"}}>{sg[0]}</span>
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
        {tab==="radar"&&<div style={{padding:"12px 14px"}}>
          {/* 지수 현황 */}
          <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8,borderLeft:`3px solid ${C.accent}`,paddingLeft:8}}>글로벌 지수 현황</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:8}}>
            {[["^GSPC","S&P 500"],["^IXIC","NASDAQ"],["^KS11","KOSPI"]].map(([k,name])=>{
              const d=indicesData[k];
              const pct=d?.changePct??0;
              const hasData=d&&d.price>0;
              return<div key={k} style={{border:`1px solid ${hasData?(pct>=0?"rgba(34,197,94,.3)":"rgba(239,68,68,.3)"):C.border}`,borderRadius:8,padding:"8px 12px",background:C.panel2}}>
                <div style={{fontSize:9,color:C.muted,marginBottom:3}}>{name} {k.includes("KS")||k.includes("KQ")?"🇰🇷":"🇺🇸"}</div>
                <div style={{fontSize:20,fontWeight:900,marginBottom:2}}>{hasData?d.price.toLocaleString("ko-KR",{maximumFractionDigits:2}):"—"}</div>
                <div style={{color:pct>=0?C.green:C.red,fontWeight:700,fontSize:12}}>{hasData?(pct>=0?"+":""+(pct.toFixed?.(2)||0)+"% "+(pct>=0?"▲":"▼")):"데이터 없음"}</div>
              </div>;
            })}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:14}}>
            {[["^KQ11","KOSDAQ","🇰🇷"],["^N225","닛케이","🇯🇵"],["^SSEC","상해","🇨🇳"],["^VIX","VIX","⚡"]].map(([k,name,flag])=>{
              const d=indicesData[k];const pct=d?.changePct??0;
              return<div key={k} style={{border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px",background:C.panel2}}>
                <div style={{fontSize:8,color:C.muted}}>{name} {flag}</div>
                <div style={{fontSize:14,fontWeight:900,margin:"2px 0"}}>{d?.price?d.price.toLocaleString("ko-KR",{maximumFractionDigits:1}):"—"}</div>
                <div style={{fontSize:10,color:pct>=0?C.green:C.red,fontWeight:700}}>{pct>=0?"+":""}{pct.toFixed?.(2)}%</div>
              </div>;
            })}
          </div>

          {/* RS 히트맵 + IB 거래량 */}
          <div style={{display:"grid",gridTemplateColumns:"3fr 2fr",gap:12,marginBottom:12}}>
            <div style={css.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:11,fontWeight:700,color:C.accent}}>📊 섹터 RS 히트맵</div>
                <select value={rsKey} onChange={e=>setRsKey(e.target.value)} style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:5,padding:"2px 6px",color:C.text,fontSize:9}}>
                  <option value="chg1W">1주</option><option value="chg1M">1개월</option><option value="chg3M">3개월</option>
                </select>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4}}>
                {[...SECTOR_RS].sort((a,b)=>b[rsKey]-a[rsKey]).map((sec,i)=>{
                  const v=sec[rsKey],ref=(rsKey==="chg1W"?idxRS.spy.chg3d:rsKey==="chg1M"?-4.6:-5.2)||-4.6,excess=+(v-ref).toFixed(1),isTop=i<3;
                  const bg=excess>=0?`rgba(16,185,129,${.15+Math.min(.65,excess/15)})`:excess>-5?`rgba(250,204,21,${.1+Math.abs(excess)/20})`:`rgba(239,68,68,${.1+Math.min(.6,Math.abs(excess)/20)})`;
                  return<div key={sec.etf} style={{background:bg,borderRadius:6,padding:"5px 6px",border:isTop?`1px solid ${C.emerald}`:"1px solid rgba(255,255,255,.05)",boxShadow:isTop?`0 0 8px rgba(16,185,129,.35)`:""}}>
                    <div style={{fontSize:8,fontWeight:700,color:isTop?C.emerald:C.text}}>{sec.name}</div>
                    <div style={{fontSize:7,color:C.muted}}>{sec.etf}</div>
                    <div style={{fontSize:12,fontWeight:700,color:v>=0?C.green:C.red}}>{v>=0?"+":""}{v}%</div>
                    <div style={{fontSize:7,color:excess>=0?C.emerald:C.red}}>vs SPY {excess>=0?"+":""}{excess}%</div>
                  </div>;
                })}
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <div style={{...css.card,flex:1}}>
                <div style={{fontSize:11,fontWeight:700,color:C.accent,marginBottom:4}}>📈 초기균형 거래량</div>
                <div style={{fontSize:8,color:C.muted,marginBottom:10}}>장 시작 1시간 / 20일평균 <span style={{color:C.yellow}}>⚡ 150%↑ = 공격 진입</span></div>
                <div style={{textAlign:"center",marginBottom:10}}><span style={{fontSize:44,fontWeight:900,color:ibVol>=150?C.emerald:ibVol>=100?C.yellow:C.red}}>{ibVol}%</span></div>
                <div style={{position:"relative",height:12,background:"rgba(255,255,255,.07)",borderRadius:6,overflow:"hidden",marginBottom:8}}><div style={{height:"100%",width:`${Math.min(100,ibVol/3)}%`,background:ibVol>=150?C.emerald:ibVol>=100?C.yellow:C.red,borderRadius:6}}/><div style={{position:"absolute",left:"50%",top:0,width:1,height:"100%",background:"rgba(255,255,255,.3)"}}/></div>
                <div style={{background:ibVol>=150?"rgba(16,185,129,.1)":"rgba(239,68,68,.08)",border:`1px solid ${ibVol>=150?C.emerald:C.red}`,borderRadius:6,padding:6,fontSize:9,color:ibVol>=150?C.emerald:C.red,fontWeight:700,textAlign:"center",marginBottom:6}}>{ibVol>=150?"✅ 공격 매수 가능":ibVol>=100?"⚠ 관망":"🚫 진입 금지"}</div>
                <button onClick={()=>{}} style={{...css.btn(),width:"100%",fontSize:8,opacity:0.5}}>🔄 장 마감 후 자동갱신</button>
              </div>
              <div style={css.card}>
                <div style={{fontSize:9,fontWeight:700,color:C.accent,marginBottom:5}}>⚡ 오늘 공격성</div>
                <div style={{textAlign:"center",fontSize:13,fontWeight:900,color:ibVol>=150?C.emerald:C.yellow}}>{ibVol>=150?"🟢 공격적 매수":"🟡 선택적 진입"}</div>
              </div>
              <div style={{background:C.panel2,border:`2px solid ${oppColor}`,borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                <div style={{fontSize:8,color:C.muted,marginBottom:4}}>📊 Opportunity Score</div>
                <div style={{fontSize:34,fontWeight:900,color:oppColor,lineHeight:1}}>{oppScore}<span style={{fontSize:11}}>/100</span></div>
                <div style={{fontSize:10,fontWeight:900,color:oppColor,marginTop:3,padding:"2px 8px",background:`${oppColor}22`,borderRadius:4,display:"inline-block"}}>{oppLabel}</div>
                <div style={{display:"flex",justifyContent:"space-around",marginTop:6,fontSize:8,color:C.muted}}>
                  <span>KR {kospiChg3d>=0?"+":""}{kospiChg3d.toFixed(1)}%</span>
                  <span>US {spChg3d>=0?"+":""}{spChg3d.toFixed(1)}%</span>
                  <span>VIX {vixVal.toFixed(1)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* AI 브리핑 */}
          <div style={css.card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
              <div style={{fontSize:11,fontWeight:700,color:C.accent}}>🤖 AI 시황 브리핑</div>
              <button onClick={getAI} disabled={aiLoading} style={{...css.btn(),color:aiLoading?C.muted:C.accent,borderColor:C.accent}}>
                {aiLoading?"분석 중...":"시황 분석 ▶"}
              </button>
            </div>
            <p style={{fontSize:11,color:C.sub,lineHeight:1.9,margin:0}}>{aiText||"버튼을 눌러 현재 시장에 맞는 매매 전략을 받아보세요."}</p>
          </div>
        </div>}

        {/* ══ TAB 2: 알파헌터 ══ */}
        {tab==="alpha"&&<div style={{padding:"12px 14px"}}>

          {/* RS 기준선 - S&P/NASDAQ/KOSPI만 */}
          <div style={{background:C.panel2,border:`1px solid ${C.border}`,borderRadius:9,padding:"10px 14px",marginBottom:12}}>
            <div style={{fontSize:9,fontWeight:700,color:C.muted,marginBottom:7}}>📊 지수 RS 기준선 — 종목 3일/5일과 비교하세요</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
              {[["S&P 500",idxRS.spy],["NASDAQ",idxRS.qqq],["KOSPI",idxRS.kospi]].map(([name,d])=>(
                <div key={name} style={{textAlign:"center"}}>
                  <div style={{fontSize:8,color:C.muted,marginBottom:3}}>{name}</div>
                  <div style={{display:"flex",gap:3,justifyContent:"center",flexWrap:"wrap"}}>
                    <span style={{fontSize:9,fontWeight:700,padding:"2px 5px",borderRadius:4,border:`1px solid ${(d.chg3d||0)>=0?"rgba(34,197,94,.35)":"rgba(239,68,68,.35)"}`,background:(d.chg3d||0)>=0?"rgba(34,197,94,.08)":"rgba(239,68,68,.08)",color:(d.chg3d||0)>=0?C.green:C.red}}>3D {(d.chg3d||0)>=0?"+":""}{(d.chg3d||0).toFixed(1)}%</span>
                    <span style={{fontSize:9,fontWeight:700,padding:"2px 5px",borderRadius:4,border:`1px solid ${(d.chg5d||0)>=0?"rgba(34,197,94,.35)":"rgba(239,68,68,.35)"}`,background:(d.chg5d||0)>=0?"rgba(34,197,94,.08)":"rgba(239,68,68,.08)",color:(d.chg5d||0)>=0?C.green:C.red}}>5D {(d.chg5d||0)>=0?"+":""}{(d.chg5d||0).toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 서브탭 */}
          <div style={{display:"flex",gap:4,marginBottom:12}}>
            {[["filter","🔍 수급필터"],["pattern","📐 패턴감지"],["compare","⚖️ 비교뷰"]].map(([k,l])=>(
              <button key={k} onClick={()=>setAlphaTab(k)} style={{flex:1,padding:"7px 0",borderRadius:7,border:`1px solid ${alphaTab===k?C.accent:C.border}`,background:alphaTab===k?"rgba(56,189,248,.15)":"rgba(255,255,255,.03)",color:alphaTab===k?C.accent:C.muted,fontWeight:alphaTab===k?700:400,fontSize:10,cursor:"pointer"}}>{l}</button>
            ))}
          </div>

          {/* 수급필터 */}
          {alphaTab==="filter"&&(
            <div>
              <div style={css.card}>
                <div style={{fontSize:11,fontWeight:700,color:C.accent,marginBottom:8}}>📊 가변 필터</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                  <div>
                    <div style={{fontSize:9,color:C.muted,marginBottom:2}}>수급밀도 <span style={{color:C.accent,fontWeight:700}}>{fLiq.toFixed(1)}x</span> 이상</div>
                    <input type="range" min="0.5" max="5" step="0.1" value={fLiq} onChange={e=>setFLiq(+e.target.value)} style={{width:"100%",accentColor:C.accent}}/>
                  </div>
                  <div>
                    <div style={{fontSize:9,color:C.muted,marginBottom:2}}>매출성장 <span style={{color:C.green,fontWeight:700}}>{fRev}%</span> 이상</div>
                    <input type="range" min="0" max="150" step="5" value={fRev} onChange={e=>setFRev(+e.target.value)} style={{width:"100%",accentColor:C.green}}/>
                  </div>
                </div>
                <div style={{fontSize:9,color:C.muted,marginBottom:6,fontWeight:700}}>고정 조건</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
                  {[
                    ["golden","✅ 골드크로스","3일선이 10일선 상향 돌파 (최근 3일 내)"],
                    ["box","📦 박스권 돌파","횡보 후 저항선 돌파"],
                    ["angle","📐 상승각도 증가","모멘텀 가속"],
                    ["ichi","☁️ 일목구름 접근","구름대 5% 이내"],
                    ["vol","📊 거래량 급증","20일평균 200%↑"],
                    ["vcp","⚡ VCP 패턴","거래량 수축+고점 근접"]
                  ].map(([k,name,desc])=>(
                    <button key={k} onClick={()=>setConds(c=>({...c,[k]:!c[k]}))} style={{borderRadius:6,padding:"6px 8px",cursor:"pointer",textAlign:"left",border:`1px solid ${conds[k]?"rgba(16,185,129,.5)":"rgba(255,255,255,.1)"}`,background:conds[k]?"rgba(16,185,129,.1)":"rgba(255,255,255,.04)",color:conds[k]?C.emerald:C.muted}}>
                      <span style={{fontWeight:700,display:"block",fontSize:9}}>{conds[k]?"🟢 ":"⬜ "}{name}</span>
                      <span style={{fontSize:8,display:"block",color:conds[k]?"rgba(16,185,129,.7)":C.muted}}>{desc}</span>
                    </button>
                  ))}
                </div>
                <div style={{marginTop:8,fontSize:10,color:C.accent,fontWeight:700}}>🎯 {alphaHits.length}개 통과</div>
              </div>
              {alphaHits.length===0
                ? <div style={{textAlign:"center",padding:"30px 0",color:C.muted}}>조건을 완화해 보세요</div>
                : <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:10}}>
                    {alphaHits.map(stock=>{
                      const b=SECTORS[stock.sector]||{};
                      const sg=getQuantSig(stock,b);
                      const ss=SIG[sg];
                      const isGold=(stock.score||0)>=90;
                      const inWatch=watchlist.find(w=>w.ticker===stock.ticker);
                      const cd=charts[stock.ticker]?.data;
                      const lastD=cd?.at(-1);
                      const iSt=lastD?.aboveCloud?"above":lastD?.nearCloud?"near":"below";
                      const ichiColor=iSt==="above"?C.emerald:iSt==="near"?C.yellow:"#f87171";
                      const ichiText=iSt==="above"?"구름위":iSt==="near"?"접근":"아래";
                      const hasVCP=detectVCP(cd);
                      const hasW=detectWPattern(cd);
                      return (
                        <div key={stock.ticker} onClick={()=>{setSel(stock.ticker);setTab("sniper");}} style={{background:C.panel,border:`2px solid ${isGold?"#f59e0b":ss.border}`,borderRadius:10,padding:12,cursor:"pointer"}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                            <div>
                              <div style={{fontWeight:900,fontSize:12}}>{stock.market} {stock.label}</div>
                              <div style={{fontSize:8,color:C.muted}}>{stock.sector}</div>
                            </div>
                            <div style={{textAlign:"right"}}>
                              <span style={{background:ss.bg,color:ss.color,border:`1px solid ${ss.border}`,borderRadius:4,padding:"1px 6px",fontWeight:900,fontSize:10}}>{sg}</span>
                              <div style={{fontSize:13,fontWeight:900,color:C.accent,marginTop:2}}>{stock.score||0}점</div>
                            </div>
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,marginBottom:6}}>
                            <div style={{background:"rgba(0,0,0,.4)",borderRadius:4,padding:"3px 5px",textAlign:"center"}}>
                              <div style={{fontSize:7,color:C.muted}}>수급</div>
                              <div style={{fontSize:10,fontWeight:700,color:(stock.liquidity||0)>=fLiq?C.green:C.red}}>{stock.liquidity||"-"}x</div>
                            </div>
                            <div style={{background:"rgba(0,0,0,.4)",borderRadius:4,padding:"3px 5px",textAlign:"center"}}>
                              <div style={{fontSize:7,color:C.muted}}>매출↑</div>
                              <div style={{fontSize:10,fontWeight:700,color:(stock.revGrowth||stock.rev||0)>=fRev?C.green:C.red}}>{stock.revGrowth||stock.rev||0}%</div>
                            </div>
                            <div style={{background:"rgba(0,0,0,.4)",borderRadius:4,padding:"3px 5px",textAlign:"center"}}>
                              <div style={{fontSize:7,color:C.muted}}>ROE</div>
                              <div style={{fontSize:10,fontWeight:700,color:stock.roe>(b.roe||15)?C.green:C.red}}>{stock.roe}%</div>
                            </div>
                          </div>
                          <div style={{display:"flex",gap:6,alignItems:"center",background:"rgba(0,0,0,.3)",borderRadius:6,padding:"4px 8px",marginBottom:6}}>
                            <div style={{textAlign:"center",flex:1}}>
                              <div style={{fontSize:7,color:C.muted}}>3일</div>
                              <div style={{fontSize:11,fontWeight:700,color:(stock.chg3d||0)>=0?C.green:C.red}}>{(stock.chg3d||0)>=0?"+":""}{((stock.chg3d)||0).toFixed(1)}%</div>
                            </div>
                            <div style={{width:1,height:18,background:"rgba(255,255,255,.1)"}}/>
                            <div style={{textAlign:"center",flex:1}}>
                              <div style={{fontSize:7,color:C.muted}}>5일</div>
                              <div style={{fontSize:11,fontWeight:700,color:(stock.chg5d||0)>=0?C.green:C.red}}>{(stock.chg5d||0)>=0?"+":""}{((stock.chg5d)||0).toFixed(1)}%</div>
                            </div>
                            <div style={{width:1,height:18,background:"rgba(255,255,255,.1)"}}/>
                            <span style={{fontSize:8,fontWeight:700,color:ichiColor}}>{ichiText}</span>
                            <div style={{display:"flex",gap:2,marginLeft:"auto"}}>
                              {hasVCP&&<span style={{fontSize:7,background:"rgba(56,189,248,.15)",color:C.accent,borderRadius:3,padding:"1px 4px"}}>VCP</span>}
                              {hasW&&<span style={{fontSize:7,background:"rgba(34,197,94,.15)",color:C.green,borderRadius:3,padding:"1px 4px"}}>W</span>}
                            </div>
                          </div>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <span style={{fontSize:8,color:C.muted}}>탭하여 차트 →</span>
                            <button onClick={e=>{e.stopPropagation();inWatch?setWatchlist(w=>w.filter(x=>x.ticker!==stock.ticker)):setWatchlist(w=>[...w,{...stock}]);}} style={{background:inWatch?"rgba(167,139,250,.15)":"rgba(255,255,255,.04)",border:`1px solid ${inWatch?C.purple:C.border}`,color:inWatch?C.purple:C.muted,borderRadius:5,padding:"3px 8px",cursor:"pointer",fontSize:9}}>{inWatch?"★":"☆"}</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
              }
            </div>
          )}

          {/* 패턴감지 */}
          {alphaTab==="pattern"&&(
            <div style={css.card}>
              <div style={{fontSize:11,fontWeight:700,color:C.accent,marginBottom:4}}>📐 VCP / W패턴 감지</div>

              {stocks.filter(s=>{
                const cd=charts[s.ticker]?.data;
                return detectVCP(cd)||detectWPattern(cd);
              }).length===0
                ? <div style={{textAlign:"center",padding:"30px 0",color:C.muted}}>감지된 패턴 없음</div>
                : stocks.map(stock=>{
                    const cd=charts[stock.ticker]?.data;
                    const hasVCP=detectVCP(cd);
                    const hasW=detectWPattern(cd);
                    if(!hasVCP&&!hasW) return null;
                    return (
                      <div key={stock.ticker} onClick={()=>{setSel(stock.ticker);setTab("sniper");}} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 11px",borderRadius:8,background:C.panel2,border:`1px solid ${C.border}`,marginBottom:6,cursor:"pointer"}}>
                        <div style={{flex:1}}>
                          <div style={{fontWeight:700,fontSize:11}}>{stock.market} {stock.label}</div>
                          <div style={{fontSize:8,color:C.muted}}>{(stock.chg3d||0)>=0?"+":""}{(stock.chg3d||0).toFixed(1)}% 3일</div>
                        </div>
                        <div style={{display:"flex",gap:4}}>
                          {hasVCP&&<span style={{fontSize:9,fontWeight:700,padding:"3px 8px",borderRadius:5,background:"rgba(56,189,248,.15)",color:C.accent,border:`1px solid ${C.accent}`}}>⚡ VCP</span>}
                          {hasW&&<span style={{fontSize:9,fontWeight:700,padding:"3px 8px",borderRadius:5,background:"rgba(34,197,94,.15)",color:C.green,border:`1px solid ${C.green}`}}>W 패턴</span>}
                        </div>
                      </div>
                    );
                  }).filter(Boolean)
              }
            </div>
          )}

          {/* 비교뷰 */}
          {alphaTab==="compare"&&(
            <div style={css.card}>
              <div style={{fontSize:11,fontWeight:700,color:C.accent,marginBottom:4}}>⚖️ 관심종목 RS강도 비교</div>
              {watchlist.length===0
                ? <div style={{textAlign:"center",padding:"30px 0",color:C.muted}}>수급필터 탭에서 ★ 눌러 관심종목 추가</div>
                : <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,minWidth:480}}>
                      <thead>
                        <tr style={{background:"rgba(255,255,255,.04)"}}>
                          {["종목","현재가","3일","5일","vs SPY","RS","패턴","일목"].map(h=>(
                            <th key={h} style={{padding:"6px 8px",textAlign:"left",color:C.muted,fontSize:8,fontWeight:700,borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...watchlist].sort((a,b)=>((b.chg5d||0)-idxRS.spy.chg5d)-((a.chg5d||0)-idxRS.spy.chg5d)).map((stock,idx)=>{
                          const vs5d=+((stock.chg5d||0)-idxRS.spy.chg5d).toFixed(1);
                          const cd=charts[stock.ticker]?.data;
                          const lastD=cd?.at(-1);
                          const iSt=lastD?.aboveCloud?"above":lastD?.nearCloud?"near":"below";
                          const hasVCP=detectVCP(cd);
                          const hasW=detectWPattern(cd);
                          const isKR=(stock.ticker?.length||0)>5;
                          return (
                            <tr key={stock.ticker} onClick={()=>{setSel(stock.ticker);setTab("sniper");}} style={{borderBottom:`1px solid rgba(255,255,255,.04)`,cursor:"pointer",background:idx===0?"rgba(56,189,248,.05)":""}}>
                              <td style={{padding:"6px 8px",fontWeight:700,whiteSpace:"nowrap"}}>{stock.market} {stock.label}</td>
                              <td style={{padding:"6px 8px",whiteSpace:"nowrap"}}>{isKR?"₩":"$"}{(stock.price||0).toLocaleString()}</td>
                              <td style={{padding:"6px 8px",color:(stock.chg3d||0)>=0?C.green:C.red,fontWeight:700}}>{(stock.chg3d||0)>=0?"+":""}{(stock.chg3d||0).toFixed(1)}%</td>
                              <td style={{padding:"6px 8px",color:(stock.chg5d||0)>=0?C.green:C.red,fontWeight:700}}>{(stock.chg5d||0)>=0?"+":""}{(stock.chg5d||0).toFixed(1)}%</td>
                              <td style={{padding:"6px 8px",color:vs5d>=0?C.emerald:C.red,fontWeight:700}}>{vs5d>=0?"+":""}{vs5d}%p</td>
                              <td style={{padding:"6px 8px"}}><span style={{fontSize:9,fontWeight:700,color:vs5d>3?C.emerald:vs5d>0?C.yellow:C.red}}>{vs5d>3?"매우강":vs5d>0?"보통":"약세"}</span></td>
                              <td style={{padding:"6px 8px"}}>
                                {hasVCP&&<span style={{fontSize:7,background:"rgba(56,189,248,.12)",color:C.accent,borderRadius:3,padding:"1px 4px",marginRight:2}}>VCP</span>}
                                {hasW&&<span style={{fontSize:7,background:"rgba(34,197,94,.12)",color:C.green,borderRadius:3,padding:"1px 4px"}}>W</span>}
                                {!hasVCP&&!hasW&&<span style={{color:C.muted}}>—</span>}
                              </td>
                              <td style={{padding:"6px 8px"}}><span style={{fontSize:9,fontWeight:700,color:iSt==="above"?C.emerald:iSt==="near"?C.yellow:"#f87171"}}>{iSt==="above"?"구름위":iSt==="near"?"접근":"아래"}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{fontSize:8,color:C.muted,marginTop:6,textAlign:"right"}}>vs SPY 5일 기준 내림차순</div>
                  </div>
              }
            </div>
          )}

        </div>}

        {/* ══ TAB 3: 스나이퍼 ══ */}
        {tab==="sniper"&&selInfo&&<div style={{padding:"12px 14px"}}>
          <RSBar/>
          {/* 헤더 */}
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
            <div style={{fontWeight:900,fontSize:15}}>{selInfo.market} {selInfo.label}</div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontWeight:900,fontSize:17}}>{unit}{curPrice.toLocaleString(undefined,{maximumFractionDigits:2})}</span>
              {selInfo.changePct!=null&&<span style={{fontSize:11,fontWeight:700,color:selInfo.changePct>=0?C.green:C.red}}>{selInfo.changePct>=0?"+":""}{selInfo.changePct?.toFixed?.(2)}%</span>}
              {cd?.real&&<span style={{fontSize:7,background:"rgba(34,197,94,.15)",color:C.green,border:"1px solid rgba(34,197,94,.3)",borderRadius:3,padding:"1px 4px"}}>실시간</span>}
            </div>
            <div style={{background:lastD?.allBull?"rgba(16,185,129,.15)":"rgba(239,68,68,.1)",border:`1px solid ${lastD?.allBull?C.emerald:C.red}`,borderRadius:5,padding:"2px 8px",fontSize:9,fontWeight:700,color:lastD?.allBull?C.emerald:C.red}}>{lastD?.allBull?"🟢 3/3 매수배경":"🔴 비매수배경"}</div>
            <span style={css.ichi(ichiStatus)}>{ichiStatus==="above"?"☁️ 구름위":ichiStatus==="near"?"☁️ 구름접근":"☁️ 구름아래"}</span>
            <div style={{marginLeft:"auto",textAlign:"right"}}><div style={{fontSize:7,color:C.muted}}>종합신호</div><div style={{...SIG[finalSig],borderRadius:5,padding:"2px 10px",fontWeight:900,fontSize:12,border:`1px solid ${fs.border}`}}>{finalSig}</div></div>
          </div>

          {/* 3일/5일 vs 지수 */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:10}}>
            <div style={css.panel2}><div style={{fontSize:8,color:C.muted,marginBottom:3}}>{selInfo.label} 3일</div><div style={{fontSize:17,fontWeight:900,color:(selInfo.chg3d||0)>=0?C.green:C.red}}>{(selInfo.chg3d||0)>=0?"+":""}{(selInfo.chg3d||0).toFixed?.(1)||0}%</div><div style={{fontSize:7,color:C.sub,marginTop:2}}>SPY 대비 {((selInfo.chg3d||0)-idxRS.spy.chg3d)>=0?"+":""}{((selInfo.chg3d||0)-idxRS.spy.chg3d).toFixed(1)}%p</div></div>
            <div style={css.panel2}><div style={{fontSize:8,color:C.muted,marginBottom:3}}>{selInfo.label} 5일</div><div style={{fontSize:17,fontWeight:900,color:(selInfo.chg5d||0)>=0?C.green:C.red}}>{(selInfo.chg5d||0)>=0?"+":""}{(selInfo.chg5d||0).toFixed?.(1)||0}%</div><div style={{fontSize:7,color:C.sub,marginTop:2}}>SPY 대비 {((selInfo.chg5d||0)-idxRS.spy.chg5d)>=0?"+":""}{((selInfo.chg5d||0)-idxRS.spy.chg5d).toFixed(1)}%p</div></div>
            <div style={{...css.panel2,background:((selInfo.chg5d||0)-idxRS.spy.chg5d)>0?"rgba(16,185,129,.08)":"rgba(239,68,68,.06)",borderColor:((selInfo.chg5d||0)-idxRS.spy.chg5d)>0?"rgba(16,185,129,.4)":"rgba(239,68,68,.3)"}}>
              <div style={{fontSize:8,color:C.emerald,marginBottom:3}}>RS 강도</div>
              <div style={{fontSize:16,fontWeight:900,color:((selInfo.chg5d||0)-idxRS.spy.chg5d)>3?C.emerald:((selInfo.chg5d||0)-idxRS.spy.chg5d)>0?C.yellow:C.red}}>{((selInfo.chg5d||0)-idxRS.spy.chg5d)>3?"매우강":((selInfo.chg5d||0)-idxRS.spy.chg5d)>0?"보통":"약세"}</div>
            </div>
          </div>

          {/* 3중 목표가 */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:10}}>
            {[{l:"🏦 기관컨센서스",v:consTgt,c:C.accent,d:consensus[sel]?.data?"AI 검색 결과":"증권사 평균"},{l:"📐 ATR목표",v:atrTgt,c:C.yellow,d:`ATR×${atrMult.toFixed(1)}`},{l:"⭐ RS프리미엄",v:rsPremTgt,c:C.emerald,d:"+10%"},{l:"🛑 손절가",v:stopPrice,c:C.red,d:`고점 -${stopPct}%`}].map((t,i)=>(
              <div key={i} style={{...css.panel2}}>
                <div style={{fontSize:8,color:C.muted,marginBottom:3}}>{t.l}</div>
                <div style={{fontSize:14,fontWeight:900,color:t.c}}>{t.v>0?`${unit}${t.v.toLocaleString()}`:"-"}</div>
                <div style={{fontSize:7,color:C.muted}}>{t.d}</div>
              </div>
            ))}
          </div>

          {/* R:R + 매수버튼 */}
          <div style={{display:"flex",gap:10,marginBottom:10,alignItems:"flex-start",flexWrap:"wrap"}}>
            <button disabled={!checkOk} onClick={()=>{
              if(!checkOk)return;
              setPositions(p=>[...p,{id:Date.now(),ticker:sel,label:selInfo.label,market:selInfo.market,entry:curPrice,current:curPrice,max:curPrice,trailPct:stopPct,trailStop:stopPrice,target:consTgt,pnl:0,date:new Date().toLocaleDateString("ko-KR"),entryTime:new Date().toLocaleTimeString("ko-KR"),pyramid:[{level:1,targetPct:3,triggered:false,addRatio:50},{level:2,targetPct:6,triggered:false,addRatio:30},{level:3,targetPct:9,triggered:false,addRatio:20}]}]);
              setTab("watch");setAddMsg(`📌 ${selInfo.label} 매수 등록`);setTimeout(()=>setAddMsg(""),2500);
            }} style={{background:checkOk?"linear-gradient(135deg,#10b981,#059669)":"rgba(255,255,255,.05)",border:`1px solid ${checkOk?C.emerald:C.border}`,borderRadius:8,padding:"12px 16px",color:checkOk?"#000":C.muted,fontWeight:checkOk?900:400,fontSize:11,cursor:checkOk?"pointer":"not-allowed",alignSelf:"stretch"}}>
              {!checkOk?"☑ 체크리스트 미완":"📈 매수 기록"}
            </button>
          </div>

          {/* 차트 */}
          {sliced.length>0&&<div style={{background:lastD?.allBull?"rgba(16,185,129,.04)":"rgba(239,68,68,.03)",border:`1px solid ${lastD?.allBull?C.emerald:C.border}`,borderRadius:10,padding:"8px 6px 4px",marginBottom:6}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingLeft:8,paddingRight:8,marginBottom:6}}>
              <div style={{fontSize:8,color:C.muted}}>{lastD?.allBull?"🟢 매수배경":"🔴 비매수배경"} {cd?.real?"(실제)":"(시뮬)"}</div>
              <div style={{display:"flex",gap:4}}>
                {[["ichi","일목구름"],["st","슈퍼트랜드"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setChartOpts(o=>({...o,[k]:!o[k]}))} style={{fontSize:8,padding:"2px 7px",borderRadius:4,border:`1px solid ${chartOpts[k]?"rgba(56,189,248,.5)":"rgba(255,255,255,.15)"}`,background:chartOpts[k]?"rgba(56,189,248,.12)":"transparent",color:chartOpts[k]?C.accent:C.muted,cursor:"pointer"}}>{chartOpts[k]?"✓":""} {l}</button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={270}>
              <ComposedChart data={sliced} margin={{left:0,right:6}}>
                <CartesianGrid stroke="rgba(255,255,255,.03)"/>
                <XAxis dataKey="date" tick={{fill:C.muted,fontSize:7}} tickLine={false} interval={Math.floor(sliced.length/5)||1}/>
                <YAxis yAxisId="p" tick={{fill:C.muted,fontSize:7}} tickLine={false} domain={["auto","auto"]} tickFormatter={v=>unit==="원"?`${(v/1000).toFixed(0)}k`:v.toFixed(0)} width={40}/>
                <YAxis yAxisId="v" orientation="right" hide domain={[0,dm=>dm*5]}/>
                <Tooltip content={<Tip/>}/>
                <Bar yAxisId="v" dataKey="volume" fill="rgba(148,163,184,.1)" radius={[1,1,0,0]}/>
                {chartOpts.ichi&&<Area yAxisId="p" type="monotone" dataKey="spanHigh" stroke="rgba(34,197,94,.6)" fill="rgba(34,197,94,.18)" strokeWidth={1.5} dot={false} connectNulls/>}
                {chartOpts.ichi&&<Area yAxisId="p" type="monotone" dataKey="spanLow" stroke="rgba(239,68,68,.6)" fill="#0d1117" strokeWidth={1.5} dot={false} connectNulls/>}
                <Bar yAxisId="p" dataKey="close" shape={<CandleBar/>} isAnimationActive={false}/>
                {chartOpts.st&&["st1Bull","st2Bull","st3Bull"].map((k,i)=><Line key={k} yAxisId="p" type="monotone" dataKey={k} stroke={C.emerald} strokeWidth={2-i*.5} dot={false} connectNulls strokeOpacity={1-.25*i}/>)}
                {chartOpts.st&&["st1Bear","st2Bear","st3Bear"].map((k,i)=><Line key={k} yAxisId="p" type="monotone" dataKey={k} stroke={C.red} strokeWidth={2-i*.5} dot={false} connectNulls strokeOpacity={1-.25*i}/>)}
                {consTgt>0&&<ReferenceLine yAxisId="p" y={consTgt} stroke="transparent" label={{value:`▶ ${unit}${consTgt.toLocaleString()}`,fill:C.accent,fontSize:7,position:"insideRight"}}/>}
                {stopPrice>0&&<ReferenceLine yAxisId="p" y={stopPrice} stroke="transparent" label={{value:`▶ 손절 ${unit}${stopPrice.toLocaleString()}`,fill:C.red,fontSize:7,position:"insideRight"}}/>}
                <Scatter yAxisId="p" dataKey="buyStrong" fill="#4ade80" shape={<BuyDot dataKey="buyStrong"/>}/>
                <Scatter yAxisId="p" dataKey="buyNormal" fill="#fbbf24" shape={<BuyDot dataKey="buyNormal"/>}/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>}

          {/* MACD */}
          <div style={{...css.card,padding:"6px 6px 3px",marginBottom:6}}>
            <div style={{fontSize:7,color:C.muted,paddingLeft:6,marginBottom:3}}>MACD</div>
            <ResponsiveContainer width="100%" height={90}><ComposedChart data={sliced} margin={{left:0,right:6}}><XAxis dataKey="date" tick={false} tickLine={false}/><YAxis tick={{fill:C.muted,fontSize:6}} tickLine={false} width={40} tickFormatter={v=>v.toFixed(1)}/><Tooltip content={<Tip/>}/><ReferenceLine y={0} stroke="rgba(255,255,255,.15)"/><Bar dataKey="hist" shape={<HistBar/>}/><Line type="monotone" dataKey="macd" stroke={C.accent} strokeWidth={1.5} dot={false}/><Line type="monotone" dataKey="signal" stroke="#f59e0b" strokeWidth={1.5} dot={false}/></ComposedChart></ResponsiveContainer>
          </div>
          {/* RSI */}
          <div style={{...css.card,padding:"6px 6px 3px",marginBottom:6}}>
            <div style={{fontSize:7,color:C.muted,paddingLeft:6,marginBottom:3}}>RSI (14)</div>
            <ResponsiveContainer width="100%" height={90}><ComposedChart data={sliced} margin={{left:0,right:6}}><XAxis dataKey="date" tick={{fill:C.muted,fontSize:6}} tickLine={false} interval={Math.floor(sliced.length/5)||1}/><YAxis domain={[0,100]} tick={{fill:C.muted,fontSize:6}} tickLine={false} ticks={[30,70]} width={40}/><Tooltip content={<Tip/>}/><ReferenceLine y={70} stroke="rgba(239,68,68,.25)"/><ReferenceLine y={30} stroke="rgba(34,197,94,.25)"/><Area type="monotone" dataKey="rsi" stroke={C.accent} fill="rgba(56,189,248,.07)" strokeWidth={1.5} dot={false}/></ComposedChart></ResponsiveContainer>
          </div>

          {/* 기간 선택 */}
          <div style={{display:"flex",gap:3,justifyContent:"center",marginBottom:10}}>
            {["1M","3M","6M","1Y","ALL"].map(p=><button key={p} onClick={()=>setPeriod(p)} style={{...css.btn(period===p),fontSize:8,padding:"2px 8px"}}>{p}</button>)}
          </div>

          {/* 보조 지표 */}
          <div style={{...css.card,marginBottom:10}}>
            <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8}}>📉 보조 지표</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:7}}>
              {[{l:"RSI",v:lastD?.rsi?.toFixed(0)||"-",c:lastD?.rsi>70?C.red:lastD?.rsi<30?C.green:C.text,d:lastD?.rsi>70?"⚠과매수":lastD?.rsi<30?"🎯과매도":"정상"},
                {l:"MACD",v:lastD?.macd?.toFixed(2)||"-",c:(lastD?.macd||0)>0?C.green:C.red,d:(lastD?.macd||0)>=(lastD?.signal||0)?"골든":"데드"},
                {l:"ATR",v:lastD?.atr?.toFixed(2)||"-",c:C.yellow,d:"변동성"},
                {l:"MA20",v:lastD?.ma20?`${unit}${lastD.ma20.toLocaleString()}`:"—",c:(lastD?.close||0)>=(lastD?.ma20||999999)?C.green:C.red,d:(lastD?.close||0)>=(lastD?.ma20||0)?"가격 위":"가격 아래"},
                {l:"거래량",v:lastD?.volume?`${(lastD.volume/1e6).toFixed(1)}M`:"—",c:C.sub,d:"당일"},
              ].map((d,i)=><div key={i} style={{background:C.panel2,border:`1px solid ${C.border}`,borderRadius:8,padding:9,textAlign:"center"}}>
                <div style={{fontSize:7,color:C.muted,marginBottom:4}}>{d.l}</div>
                <div style={{fontSize:16,fontWeight:900,color:d.c,lineHeight:1.1}}>{d.v}</div>
                <div style={{fontSize:8,fontWeight:700,color:d.c,marginTop:3}}>{d.d}</div>
              </div>)}
            </div>
          </div>

          {/* 체크리스트 */}
          <div style={{...css.card,border:`1px solid ${checkOk?C.emerald:C.border}`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8}}>✅ 매매 전 체크리스트</div>
            {[["market","📊 지수 추세 상승 (S&P 구름 위 · VIX 20 이하)"],["sector","🏭 목표 업종이 당일 강세 섹터"],["stock","📈 퀀트 점수 60pt+ · 신호 3개 이상"],["timing","⏰ 트리플 ST 모두 BUY + MACD 크로스"],["risk","🛑 손절가 · R:R 2.0 이상 확인"]].map(([key,label])=>(
              <div key={key} onClick={()=>setChecklist(c=>({...c,[key]:!c[key]}))} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:"1px solid rgba(255,255,255,.04)",cursor:"pointer"}}>
                <div style={{width:16,height:16,borderRadius:3,border:`1.5px solid ${checklist[key]?C.emerald:C.muted}`,background:checklist[key]?"rgba(16,185,129,.2)":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  {checklist[key]&&<span style={{color:C.emerald,fontSize:10,fontWeight:900}}>✓</span>}
                </div>
                <span style={{fontSize:10,color:checklist[key]?C.text:C.muted}}>{label}</span>
              </div>
            ))}
            <div style={{marginTop:8,fontSize:9,color:checkOk?C.green:C.yellow,fontWeight:700}}>
              {Object.values(checklist).filter(Boolean).length}/5 완료{checkOk?" — 매수 진입 가능 ✅":" — 미완료 항목 확인 필요"}
            </div>
          </div>
        </div>}

        {/* ══ TAB 4: 라이브워치 ══ */}
        {tab==="watch"&&<div style={{padding:"12px 14px"}}>
          <div style={{fontSize:12,fontWeight:900,color:C.accent,marginBottom:12}}>👁 라이브워치 — 4분할 매수 추적</div>
          {positions.length===0?<div style={{textAlign:"center",padding:"60px 0",color:C.muted}}><div style={{fontSize:32,marginBottom:8}}>📭</div><div>스나이퍼 탭에서 R:R ≥ 2.0 종목을 매수 기록하세요</div></div>:
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {positions.map(pos=>{
              const cur=pos.current, pnl=pos.pnl||0, trailStop=pos.trailStop;
              const stopDist=trailStop>0?+((cur-trailStop)/cur*100).toFixed(1):10;
              const near=stopDist<1.5;
              const prog=pos.target>pos.entry?Math.max(0,Math.min(100,(cur-pos.entry)/(pos.target-pos.entry)*100)):0;
              const u=pos.ticker.length>5?"원":"$";
              return<div key={pos.id} style={{...css.card,border:`2px solid ${near?"rgba(239,68,68,.8)":C.border}`,animation:near?"ap 2s infinite":""}}>
                {near&&<div style={{background:"rgba(239,68,68,.15)",borderRadius:5,padding:"3px 8px",fontSize:8,color:C.red,fontWeight:700,marginBottom:8}}>🚨 손절선 근접 — 즉시 확인!</div>}
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <div><div style={{fontWeight:900,fontSize:12}}>{pos.market} {pos.label}</div><div style={{fontSize:9,color:C.muted}}>진입 {u}{pos.entry.toLocaleString()} · {pos.entryTime}</div></div>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <div style={{textAlign:"right"}}><div style={{fontSize:20,fontWeight:900,color:pnl>=0?C.green:C.red}}>{pnl>=0?"+":""}{pnl.toFixed?.(2)||0}%</div><div style={{fontSize:9,color:C.sub}}>{u}{cur.toLocaleString()}</div></div>
                    <button onClick={()=>{
                      if(window.confirm(`${pos.label} 포지션을 청산하시겠어요?`)){
                        setHistory(h=>[...h,{...pos,exitTime:new Date().toLocaleTimeString("ko-KR"),exitDate:new Date().toLocaleDateString("ko-KR"),finalPnl:pnl}]);
                        setPositions(p=>p.filter(x=>x.id!==pos.id));
                      }
                    }} style={{background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",color:C.red,borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:9,fontWeight:700,flexShrink:0}}>청산 ✕</button>
                  </div>
                </div>
                {/* 4분할 매수 */}
                <div style={{fontSize:9,color:C.muted,fontWeight:700,marginBottom:5}}>🛒 4분할 매수 계획 (각 25%)</div>
                <div style={{display:"flex",gap:4,marginBottom:10}}>
                  {pos.pyramid.map((lv,i)=>{
                    const targetPrice=+(pos.entry*(1+lv.targetPct/100)).toFixed(pos.ticker.length>5?0:2);
                    return<div key={i} style={{flex:1,borderRadius:7,padding:8,border:`1px solid ${lv.triggered?"rgba(34,197,94,.4)":"rgba(255,255,255,.08)"}`,background:lv.triggered?"rgba(34,197,94,.06)":C.panel2,textAlign:"center"}}>
                      <div style={{fontSize:7,color:lv.triggered?C.green:C.muted,fontWeight:700,marginBottom:2}}>{i===0?"✅ 1차 진입":lv.triggered?`✅ ${i+1}차 달성`:`⏳ ${i+1}차 대기`}</div>
                      <div style={{fontSize:10,fontWeight:700,color:lv.triggered?C.green:C.sub}}>{i===0?`${u}${pos.entry.toLocaleString()}`:`+${lv.targetPct}%`}</div>
                      <div style={{fontSize:7,color:C.muted}}>{i===0?"진입가 25%":`${u}${targetPrice.toLocaleString()}`}</div>
                    </div>;
                  })}
                </div>
                {/* 손절 기준 */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
                  <div style={{background:"rgba(239,68,68,.07)",border:"1px solid rgba(239,68,68,.25)",borderRadius:7,padding:"7px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div><div style={{fontSize:8,color:C.red,fontWeight:700}}>하드컷 (원금 -5%)</div><div style={{fontSize:7,color:C.muted}}>{u}{pos.entry.toLocaleString()}</div></div>
                    <div style={{fontSize:15,fontWeight:900,color:C.red}}>{u}{(pos.entry*0.95).toFixed(pos.ticker.length>5?0:2).toLocaleString?.()}</div>
                  </div>
                  <div style={{background:"rgba(250,204,21,.06)",border:"1px solid rgba(250,204,21,.25)",borderRadius:7,padding:"7px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div><div style={{fontSize:8,color:C.yellow,fontWeight:700}}>트레일링 (고점 -8%)</div><div style={{fontSize:7,color:C.muted}}>{u}{trailStop.toLocaleString()}</div></div>
                    <div style={{fontSize:15,fontWeight:900,color:C.yellow}}>{u}{trailStop.toLocaleString()}</div>
                  </div>
                </div>
                <div style={{height:5,background:"rgba(255,255,255,.07)",borderRadius:3,overflow:"hidden",marginBottom:3}}>
                  <div style={{height:"100%",width:`${prog}%`,background:C.accent,borderRadius:3,transition:"width .5s"}}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:C.muted}}>
                  <span>진입 {u}{pos.entry.toLocaleString()}</span><span style={{color:C.accent}}>{prog.toFixed(0)}%</span><span>목표 {u}{pos.target.toLocaleString()}</span>
                </div>
              </div>;
            })}
          </div>}
          {/* 히스토리 */}
          {history.length>0&&<div style={{marginTop:16}}>
            <div style={{fontSize:11,fontWeight:700,color:C.accent,marginBottom:8}}>📋 거래 히스토리</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
              {[{l:"총 거래",v:history.length},{l:"승률",v:`${history.length?((history.filter(h=>h.pnl>0).length/history.length)*100).toFixed(0):0}%`},{l:"평균 손익",v:`${history.length?(history.reduce((a,h)=>a+(h.pnl||0),0)/history.length).toFixed(1):0}%`}].map(({l,v})=>(
                <div key={l} style={{...css.panel2,textAlign:"center"}}><div style={{fontSize:8,color:C.muted}}>{l}</div><div style={{fontSize:16,fontWeight:700}}>{v}</div></div>
              ))}
            </div>
            <div style={{...css.card,padding:0,overflow:"hidden"}}>
              <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",padding:"6px 10px",background:"rgba(255,255,255,.03)",fontSize:8,color:C.muted,fontWeight:700}}>
                <span>종목</span><span>수익률</span><span>사유</span><span>시각</span>
              </div>
              {history.slice(0,20).map((h,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",padding:"7px 10px",borderTop:"1px solid rgba(255,255,255,.04)",fontSize:9}}>
                  <span style={{fontWeight:700}}>{h.market} {h.label}</span>
                  <span style={{color:(h.pnl||0)>=0?C.green:C.red,fontWeight:700}}>{(h.pnl||0)>=0?"+":""}{(h.pnl||0).toFixed?.(1)}%</span>
                  <span style={{color:C.muted,fontSize:8}}>{h.reason||"수동"}</span>
                  <span style={{color:C.sub,fontSize:8}}>{h.entryTime}</span>
                </div>
              ))}
            </div>
          </div>}
        </div>}

        {/* ══ TAB 5: 기록 ══ */}
        {tab==="log"&&<div style={{padding:"12px 14px"}}>
          <div style={{fontSize:12,fontWeight:900,color:C.accent,marginBottom:4}}>📋 추적 기록</div>
          <div style={{fontSize:9,color:C.sub,marginBottom:12}}>추적 시점 기준가 대비 현재 상승/하락. <span style={{color:C.yellow}}>추적 종료</span> 누르면 청산 기록으로 이동.</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
            {[{l:"추적 종목",v:tracking.length},{l:"청산 완료",v:closedLog.length},{l:"승률",v:closedLog.length?`${((closedLog.filter(h=>parseFloat(h.pnl)>0).length/closedLog.length)*100).toFixed(0)}%`:"—"},{l:"평균 손익",v:closedLog.length?`${(closedLog.reduce((a,h)=>a+parseFloat(h.pnl||0),0)/closedLog.length).toFixed(1)}%`:"—"}].map(({l,v})=>(
              <div key={l} style={{...css.panel2,textAlign:"center"}}><div style={{fontSize:8,color:C.muted}}>{l}</div><div style={{fontSize:18,fontWeight:900}}>{v}</div></div>
            ))}
          </div>
          {/* 추가 버튼 */}
          <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
            <input id="track-ticker" placeholder="티커 (예: NVDA)" style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 10px",color:C.text,fontSize:10,outline:"none",width:120}}/>
            <input id="track-price" placeholder="기준가" style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 10px",color:C.text,fontSize:10,outline:"none",width:100}}/>
            <button onClick={()=>{
              const t=document.getElementById("track-ticker").value.toUpperCase();
              const p=parseFloat(document.getElementById("track-price").value);
              if(!t||!p)return;
              const info=stocks.find(s=>s.ticker===t)||INITIAL.find(s=>s.ticker===t);
              setTracking(prev=>[...prev,{ticker:t,label:info?.label||t,market:info?.market||"🇺🇸",basePrice:p,addedDate:new Date().toLocaleDateString("ko-KR")}]);
              document.getElementById("track-ticker").value="";document.getElementById("track-price").value="";
            }} style={{...css.btn(true),fontSize:9}}>+ 추적 추가</button>
          </div>
          {/* 추적 목록 */}
          {tracking.length>0&&<>
            <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:7,borderLeft:`3px solid ${C.accent}`,paddingLeft:8}}>📍 추적 중</div>
            <div style={{...css.card,padding:0,overflow:"hidden",marginBottom:14}}>
              {tracking.map((t,i)=>{
                const info=stocks.find(s=>s.ticker===t.ticker);
                const cur=info?.price||t.basePrice;
                const chg=+((cur-t.basePrice)/t.basePrice*100).toFixed(2);
                const chg3d=info?.chg3d||0,chg5d=info?.chg5d||0;
                return<div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",borderBottom:"1px solid rgba(255,255,255,.04)",fontSize:10,flexWrap:"wrap"}}>
                  <div style={{minWidth:90}}><div style={{fontWeight:900}}>{t.market} {t.label}</div><div style={{fontSize:8,color:C.muted}}>{t.addedDate} · 기준 {info?.market==="🇰🇷"?"₩":"$"}{t.basePrice.toLocaleString()}</div></div>
                  <div style={{minWidth:55,textAlign:"center"}}><div style={{fontSize:7,color:C.muted}}>현재</div><div style={{fontWeight:700}}>{info?.market==="🇰🇷"?"₩":"$"}{cur.toLocaleString()}</div></div>
                  <div style={{minWidth:55,textAlign:"center"}}><div style={{fontSize:7,color:C.muted}}>등락</div><div style={{fontWeight:700,color:chg>=0?C.green:C.red}}>{chg>=0?"+":""}{chg}% {chg>=0?"▲":"▼"}</div></div>
                  <div style={{minWidth:40,textAlign:"center"}}><div style={{fontSize:7,color:C.muted}}>3일</div><div style={{fontSize:10,fontWeight:700,color:chg3d>=0?C.green:C.red}}>{chg3d>=0?"+":""}{chg3d.toFixed?.(1)}%</div></div>
                  <div style={{minWidth:40,textAlign:"center"}}><div style={{fontSize:7,color:C.muted}}>5일</div><div style={{fontSize:10,fontWeight:700,color:chg5d>=0?C.green:C.red}}>{chg5d>=0?"+":""}{chg5d.toFixed?.(1)}%</div></div>
                  <div style={{flex:1}}/>
                  <button onClick={()=>{
                    const info2=stocks.find(s=>s.ticker===t.ticker);
                    const cur2=info2?.price||t.basePrice;
                    const chg2=+((cur2-t.basePrice)/t.basePrice*100).toFixed(2);
                    setClosedLog(prev=>[{...t,exitPrice:cur2,pnl:chg2,exitDate:new Date().toLocaleDateString("ko-KR"),reason:"수동종료"},...prev]);
                    setTracking(prev=>prev.filter((_,j)=>j!==i));
                  }} style={{...css.btn(),fontSize:8,color:C.yellow,borderColor:"rgba(250,204,21,.4)",flexShrink:0}}>추적 종료</button>
                </div>;
              })}
            </div>
          </>}
          {/* 청산 기록 */}
          {closedLog.length>0&&<>
            <div style={{fontSize:10,fontWeight:700,color:C.muted,marginBottom:7,borderLeft:`3px solid ${C.muted}`,paddingLeft:8}}>✅ 청산 기록</div>
            <div style={{...css.card,padding:0,overflow:"hidden",marginBottom:14}}>
              {closedLog.map((h,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",borderBottom:"1px solid rgba(255,255,255,.04)",fontSize:10,background:parseFloat(h.pnl)>=0?"rgba(34,197,94,.04)":"rgba(239,68,68,.04)"}}>
                  <div style={{minWidth:90}}><div style={{fontWeight:900}}>{h.market} {h.label}</div><div style={{fontSize:8,color:C.muted}}>{h.addedDate} ~ {h.exitDate}</div></div>
                  <div style={{minWidth:75,textAlign:"center"}}><div style={{fontSize:7,color:C.muted}}>기준가</div><div>{h.market==="🇰🇷"?"₩":"$"}{h.basePrice.toLocaleString()}</div></div>
                  <div style={{minWidth:75,textAlign:"center"}}><div style={{fontSize:7,color:C.muted}}>청산가</div><div>{h.market==="🇰🇷"?"₩":"$"}{h.exitPrice.toLocaleString()}</div></div>
                  <div style={{flex:1,textAlign:"center"}}><div style={{fontSize:8,color:C.muted}}>최종 손익</div><div style={{fontSize:12,fontWeight:700,color:parseFloat(h.pnl)>=0?C.green:C.red}}>{parseFloat(h.pnl)>=0?"+":""}{parseFloat(h.pnl).toFixed(2)}% {parseFloat(h.pnl)>=0?"✅":"❌"}</div></div>
                  <div style={{fontSize:8,color:C.muted}}>{h.reason}</div>
                </div>
              ))}
            </div>
          </>}
          <div style={css.card}>
            <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:7}}>📝 투자 노트</div>
            <textarea rows="4" value={investNotes} onChange={e=>setInvestNotes(e.target.value)} placeholder={"오늘의 시장 관찰, 매매 반성...\n예) NVDA 구름 돌파 확인, 내일 눌림목 2차 매수 고려"} style={{background:"rgba(255,255,255,.03)",border:`1px solid ${C.border}`,borderRadius:8,padding:10,color:C.text,fontSize:10,resize:"vertical",outline:"none",lineHeight:1.8,width:"100%"}}/>
          </div>
        </div>}

        {/* ══ TAB 6: 전략가 ══ */}
        {tab==="strategy"&&<div style={{padding:"12px 14px"}}>
          <div style={{fontSize:12,fontWeight:900,color:C.accent,marginBottom:12}}>📊 전략가 — IRP & 팩터</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:C.accent,marginBottom:10}}>💼 IRP 포트폴리오</div>
              {irpPort.some(s=>s.weight>30)&&<div style={{background:"rgba(250,204,21,.08)",border:`1px solid ${C.yellow}`,borderRadius:6,padding:"5px 9px",fontSize:8,color:C.yellow,marginBottom:8}}>⚠ {irpPort.reduce((a,s)=>s.weight>a.weight?s:a,irpPort[0])?.ticker} 30% 초과 — 분산 권장</div>}
              <div style={{...css.card,marginBottom:8}}>
                {irpPort.map((sp,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:5,marginBottom:6}}>
                  <div style={{width:5,height:5,borderRadius:"50%",background:typeCol[sp.type]||C.muted,flexShrink:0}}/>
                  <span style={{fontSize:8,color:C.text,minWidth:95,flexShrink:0}}>{sp.ticker}</span>
                  <input type="range" min={0} max={60} value={sp.weight} onChange={e=>{setIrpPort(p=>p.map((x,j)=>j===i?{...x,weight:+e.target.value}:x));setIrpResult(null);}} style={{flex:1,accentColor:typeCol[sp.type]||C.muted,height:2}}/>
                  <span style={{fontSize:9,fontWeight:700,color:typeCol[sp.type]||C.muted,minWidth:24}}>{sp.weight}%</span>
                </div>)}
                <div style={{height:4,borderRadius:2,overflow:"hidden",display:"flex",marginTop:4}}>{irpPort.map((sp,i)=><div key={i} style={{flex:sp.weight,background:typeCol[sp.type]||C.muted,opacity:.8}}/>)}</div>
                <div style={{textAlign:"right",fontSize:8,marginTop:3,color:irpPort.reduce((a,sp)=>a+sp.weight,0)===100?C.green:C.yellow,fontWeight:700}}>합계 {irpPort.reduce((a,sp)=>a+sp.weight,0)}%</div>
              </div>
              <div style={{display:"flex",gap:3,marginBottom:6}}>
                {[1,3,5,10].map(y=><button key={y} onClick={()=>{setIrpYears(y);setIrpResult(null);}} style={{...css.btn(irpYears===y),flex:1,padding:"4px 0",fontSize:9}}>{y}년</button>)}
              </div>
              <button onClick={runIrp} style={{width:"100%",background:"linear-gradient(135deg,#38bdf8,#22c55e)",border:"none",borderRadius:6,padding:"8px",color:"#000",fontWeight:700,fontSize:11,cursor:"pointer"}}>▶ 백테스팅 실행</button>
              {irpResult&&<>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginTop:8}}>
                  {[{l:`총수익(${irpResult.years}년)`,v:`${(irpResult.totalRet*100).toFixed(1)}%`,c:irpResult.totalRet>=0?C.green:C.red},{l:"연환산",v:`${(irpResult.annRet*100).toFixed(1)}%`,c:irpResult.annRet>=0?C.green:C.red},{l:"MDD",v:`${(irpResult.mdd*100).toFixed(1)}%`,c:C.red},{l:"샤프",v:irpResult.sharpe.toFixed(2),c:irpResult.sharpe>=1?C.green:C.yellow}].map((k,i)=>(
                    <div key={i} style={{background:"rgba(255,255,255,.03)",borderRadius:6,padding:"6px 8px"}}><div style={{fontSize:7,color:C.muted}}>{k.l}</div><div style={{fontSize:15,fontWeight:700,color:k.c}}>{k.v}</div></div>
                  ))}
                </div>
                <svg width="100%" height="55" viewBox="0 0 300 55" preserveAspectRatio="none" style={{marginTop:8,borderRadius:5}}>
                  {irpResult.coords&&<><polygon points={`0,55 ${irpResult.coords} 300,55`} fill={irpResult.up?"rgba(34,197,94,.15)":"rgba(239,68,68,.15)"}/><polyline points={irpResult.coords} fill="none" stroke={irpResult.up?C.green:C.red} strokeWidth="2"/></>}
                </svg>
              </>}
            </div>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:C.accent,marginBottom:10}}>🔬 팩터 황금 수치</div>
              <div style={{...css.card,marginBottom:10}}>
                <div style={{fontSize:9,color:C.muted,marginBottom:8}}>내 기록 기반 최적 파라미터</div>
                {[{label:"최적 수급밀도",val:"3.2x",desc:"승률 최고",color:C.accent},{label:"최적 매출성장",val:"22%+",desc:"수익 종목 공통",color:C.green},{label:"평균 보유기간",val:"14일",desc:"최적 청산",color:C.yellow}].map((f,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid rgba(255,255,255,.05)"}}>
                    <div><div style={{fontSize:9,fontWeight:700,color:f.color}}>{f.label}</div><div style={{fontSize:7,color:C.muted}}>{f.desc}</div></div>
                    <span style={{fontSize:15,fontWeight:900,color:f.color}}>{f.val}</span>
                  </div>
                ))}
              </div>
              {/* 섹터 집중도 */}
              <div style={css.card}>
                <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8}}>📊 포지션 섹터 분포</div>
                {positions.length===0?<div style={{color:C.muted,fontSize:9,textAlign:"center",padding:"15px 0"}}>포지션 없음</div>:
                Object.entries(positions.reduce((acc,p)=>{const sec=stocks.find(x=>x.ticker===p.ticker)?.sector||"기타";acc[sec]=(acc[sec]||0)+1;return acc;},{})).map(([sec,n])=>{
                  const pct=+(n/positions.length*100).toFixed(0),warn=pct>30;
                  return<div key={sec} style={{marginBottom:6}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:8,marginBottom:2}}><span style={{color:warn?C.yellow:C.muted}}>{sec}</span><span style={{color:warn?C.yellow:C.text,fontWeight:700}}>{pct}%</span></div>
                    <div style={{height:4,background:"rgba(255,255,255,.05)",borderRadius:2}}><div style={{height:"100%",width:`${pct}%`,background:warn?C.yellow:C.accent,borderRadius:2}}/></div>
                    {warn&&<div style={{fontSize:7,color:C.yellow}}>⚠ 30% 초과 — 집중 위험</div>}
                  </div>;
                })}
              </div>
            </div>
          </div>
        </div>}

      {/* ══ TAB 6: 종목풀 ══ */}
        {tab==="pool"&&<div style={{padding:"12px 14px"}}>
          <div style={{fontSize:12,fontWeight:900,color:C.accent,marginBottom:4}}>🗂 종목풀 관리</div>
          <div style={{fontSize:9,color:C.sub,marginBottom:12}}>코스피200 + 나스닥100 + S&P500 — ★ 눌러 관심종목 추가 · 다음 수집부터 반영</div>

          {/* 컨트롤 */}
          <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
            <input
              value={poolFilter}
              onChange={e=>setPoolFilter(e.target.value)}
              placeholder="종목명/티커 검색..."
              style={{flex:1,minWidth:120,background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:6,padding:"5px 10px",color:C.text,fontSize:10,outline:"none"}}
            />
            {[["all","전체"],["kr","🇰🇷 한국"],["us","🇺🇸 미국"]].map(([v,l])=>(
              <button key={v} onClick={()=>setPoolMarket(v)} style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${poolMarket===v?C.accent:C.border}`,background:poolMarket===v?"rgba(56,189,248,.15)":"transparent",color:poolMarket===v?C.accent:C.muted,fontSize:9,cursor:"pointer"}}>{l}</button>
            ))}
            <button onClick={async()=>{
              if(poolLoaded) return;
              setPoolMsg("📦 종목풀 로딩 중...");
              try {
                const r = await fetch("/api/watchlist");
                const data = await r.json();
                // stocks.json의 pool 데이터도 함께 로드
                const r2 = await fetch("/data/stocks.json?t="+Date.now());
                const j2 = await r2.json();
                setPool(j2.pool || {});
                setPoolLoaded(true);
                setPoolMsg(`✅ ${Object.keys(j2.pool||{}).length}개 종목 로드됨`);
              } catch(e) {
                setPoolMsg("❌ 로드 실패 — Actions daily 모드 먼저 실행해주세요");
              }
              setTimeout(()=>setPoolMsg(""),4000);
            }} style={{padding:"5px 12px",borderRadius:6,border:`1px solid ${C.accent}`,background:"rgba(56,189,248,.1)",color:C.accent,fontSize:9,cursor:"pointer",fontWeight:700}}>
              {poolLoaded?"🔄 새로고침":"📦 풀 로드"}
            </button>
          </div>

          {poolMsg&&<div style={{fontSize:9,color:C.accent,marginBottom:8,padding:"6px 10px",background:"rgba(56,189,248,.08)",borderRadius:6}}>{poolMsg}</div>}

          {/* 관심종목 현황 */}
          <div style={css.card}>
            <div style={{fontSize:10,fontWeight:700,color:C.accent,marginBottom:8}}>⭐ 현재 관심종목 ({stocks.length}개)</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {stocks.map(s=>(
                <div key={s.ticker} style={{display:"flex",alignItems:"center",gap:4,background:"rgba(56,189,248,.08)",border:`1px solid rgba(56,189,248,.2)`,borderRadius:5,padding:"3px 8px"}}>
                  <span style={{fontSize:9,fontWeight:700,color:C.accent}}>{s.market} {s.label}</span>
                  <button onClick={async()=>{
                    try {
                      await fetch("/api/watchlist",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker:s.ticker})});
                      setStocks(p=>p.filter(x=>x.ticker!==s.ticker));
                      setPoolMsg(`🗑 ${s.label} 제외됨`);
                    } catch { setPoolMsg("❌ 제외 실패"); }
                    setTimeout(()=>setPoolMsg(""),3000);
                  }} style={{background:"none",border:"none",color:"rgba(239,68,68,.6)",cursor:"pointer",fontSize:10,padding:0,lineHeight:1}}>✕</button>
                </div>
              ))}
            </div>
          </div>

          {/* 종목풀 목록 */}
          {!poolLoaded
            ? <div style={{textAlign:"center",padding:"40px 0",color:C.muted}}>
                <div style={{fontSize:24,marginBottom:8}}>📦</div>
                <div style={{fontSize:10}}>위 "풀 로드" 버튼을 눌러주세요</div>
                <div style={{fontSize:9,color:C.muted,marginTop:4}}>daily Actions 실행 후 사용 가능</div>
              </div>
            : (()=>{
                const filtered = Object.entries(pool).filter(([ticker, info])=>{
                  if(poolMarket==="kr" && info.market!=="kr") return false;
                  if(poolMarket==="us" && info.market!=="us") return false;
                  if(poolFilter) {
                    const q=poolFilter.toLowerCase();
                    return ticker.toLowerCase().includes(q)||(info.label||"").toLowerCase().includes(q);
                  }
                  return true;
                });
                return (
                  <div>
                    <div style={{fontSize:9,color:C.muted,marginBottom:8}}>{filtered.length}개 표시 중</div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:6}}>
                      {filtered.slice(0,200).map(([ticker, info])=>{
                        const inWatch = stocks.find(s=>s.ticker===ticker);
                        const chg = info.changePct||0;
                        return (
                          <div key={ticker} style={{background:C.panel2,border:`1px solid ${inWatch?"rgba(56,189,248,.4)":C.border}`,borderRadius:7,padding:"7px 9px",display:"flex",flexDirection:"column",gap:3}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                              <div>
                                <div style={{fontSize:9,fontWeight:700,color:inWatch?C.accent:C.text}}>{info.label||ticker}</div>
                                <div style={{fontSize:7,color:C.muted}}>{ticker}</div>
                              </div>
                              <button onClick={async()=>{
                                if(inWatch){
                                  // 제외
                                  try {
                                    await fetch("/api/watchlist",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker})});
                                    setStocks(p=>p.filter(x=>x.ticker!==ticker));
                                    setPoolMsg(`🗑 ${info.label} 제외`);
                                  } catch { setPoolMsg("❌ 실패"); }
                                } else {
                                  // 추가
                                  try {
                                    await fetch("/api/watchlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker,...info})});
                                    setStocks(p=>[...p,{ticker,...info,...(pool[ticker]||{})}]);
                                    setPoolMsg(`✅ ${info.label} 추가 (다음 수집부터 반영)`);
                                  } catch { setPoolMsg("❌ 실패"); }
                                }
                                setTimeout(()=>setPoolMsg(""),3000);
                              }} style={{background:inWatch?"rgba(56,189,248,.15)":"rgba(255,255,255,.04)",border:`1px solid ${inWatch?C.accent:C.border}`,borderRadius:4,padding:"2px 6px",cursor:"pointer",color:inWatch?C.accent:C.muted,fontSize:10,flexShrink:0}}>
                                {inWatch?"★":"☆"}
                              </button>
                            </div>
                            {info.price>0&&(
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                                <span style={{fontSize:9,color:C.text}}>{info.market==="kr"?"₩":"$"}{(info.price||0).toLocaleString()}</span>
                                <span style={{fontSize:8,fontWeight:700,color:chg>=0?C.green:C.red}}>{chg>=0?"+":""}{chg.toFixed(1)}%</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {filtered.length>200&&<div style={{textAlign:"center",padding:"10px",fontSize:9,color:C.muted}}>검색으로 범위를 좁혀주세요 ({filtered.length}개 중 200개 표시)</div>}
                  </div>
                );
              })()
          }
        </div>}

      </div>
    </div>
  );
}
