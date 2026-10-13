/* Optional balanced existing-traffic comparison. No replay or background media GET.
 * Blocks alternate ABBA/BAAB at random; not a fully controlled player experiment. */
(function(root){
  'use strict';
  const MODES=root.BiliRangeMeasurements.TRIAL_MODES;
  const SAFETY_TTL=10*60*1000;
  function safetyKey(state,request,mode,host){
    if(!Array.isArray(MODES[mode])||!root.BiliRange.isTargetHost(host))return null;
    const identity=root.BiliRangeMeasurements.identity(state,request,true);return identity?[Number(state.epoch)||0,identity,mode,host].join('|'):null;
  }
  function safetyEntries(state,at=Date.now()){
    return Object.fromEntries(Object.entries(state.trialSafety||{}).filter(([key,value])=>
      /^\d+\|[0-9a-f]{8}\|(?:4vs(?:8|16|32)|8vs(?:16|32))\|[^|]+$/.test(key)&&root.BiliRange.isTargetHost(key.split('|')[3])&&
      key.startsWith((Number(state.epoch)||0)+'|')&&value&&Number.isFinite(value.at)&&value.at<=at&&at-value.at<SAFETY_TTL&&
      (root.BiliRangeDiagnostics?.allowedReasons?.includes(value.reason)||/^status-\d{3}$/.test(value.reason||''))).slice(-8));
  }
  function permission(state,request,mode,host,at=Date.now()){
    const key=safetyKey(state,request,mode,host);if(!key)return {allowed:false,recovery:false};
    const entries=safetyEntries(state,at),pause=entries[key],cooling=Number(state.hosts?.[host]?.blockedUntil)>at;
    const excludePreferred=Boolean(pause&&pause.reason!=='transport');
    return {allowed:!pause&&!cooling,recovery:Boolean(pause||cooling),baseline:MODES[mode][0],excludePreferred};
  }
  function recordSafety(state,request,result,{mode,trial,epoch}={},at=Date.now()){
    if(!trial||result.kind==='response'||!result.metrics?.host||Number(state.epoch||0)!==Number(epoch||0))return;
    const key=safetyKey(state,request,mode,result.metrics.host);if(!key)return;
    const reason=root.BiliRangeDiagnostics?.allowedReasons?.includes(result.reason)||/^status-\d{3}$/.test(result.reason||'')?result.reason:'transport';
    state.trialSafety={...safetyEntries(state,at),[key]:{at,reason}};
    state.trialSafety=Object.fromEntries(Object.entries(state.trialSafety).slice(-8));
    // Resume with a new balanced block; never splice the paused partial block.
    const groupKey=trial.block.slice(0,trial.block.lastIndexOf('|')),group=state.trials?.groups?.[groupKey];
    if(group&&Number.isSafeInteger(group.counter))group.counter=Math.ceil(group.counter/4)*4;
  }
  function safetyReport(state,at=Date.now()){
    const entries=Object.entries(safetyEntries(state,at));if(!entries.length)return '';
    return '对照安全暂停：'+entries.map(([key,value])=>key.split('|')[3]+' / '+value.reason).join('，')+
      '\n当前节点/签名地址/对照组合失败后暂停10分钟；期间使用4/8路与128 KiB普通自动选CDN恢复，不纳入并发对照。更换节点、地址签名、另一对照模式或网络轮次可重新检查。';
  }
  function plan(state,request,mode,at=Date.now(),random=Math.random){
    const arms=MODES[mode];if(!Array.isArray(arms))return null;
    const identity=root.BiliRangeMeasurements.identity(state,request);if(!identity)return null;
    const key=[Number(state.epoch)||0,identity,mode].join('|');
    const groups=Object.fromEntries(Object.entries(state.trials?.groups||{}).filter(([,v])=>v&&at-v.at<15*60*1000).slice(-3));
    const previous=groups[key];
    const counter=previous&&Number.isSafeInteger(previous.counter)&&previous.counter>=0?previous.counter:0,slot=counter%4,block=Math.floor(counter/4);
    const reverse=slot===0?random()<0.5:previous.reverse;
    const arm=(reverse?[1,0,0,1]:[0,1,1,0])[slot];
    groups[key]={at,counter:counter+1,reverse};
    return {connections:arms[arm],trial:{block:key+'|'+block,slot,arm:arm?'B':'A',baseline:arms[0],candidate:arms[1]},next:{groups}};
  }
  function empiricalInterval(logRatios){
    if(logRatios.length<5)return null;
    let seed=0x1a2b3c4d;const estimates=[];
    for(let i=0;i<600;i++){
      let total=0;
      for(let j=0;j<logRatios.length;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;total+=logRatios[seed%logRatios.length];}
      estimates.push(Math.exp(total/logRatios.length));
    }
    return [root.BiliRangeMeasurements.quantile(estimates,0.025),root.BiliRangeMeasurements.quantile(estimates,0.975)];
  }
  function analyze(samples){
    const blocks={};
    for(const s of samples){
      if(!root.BiliRangeMeasurements.sanitizeTrial(s.trial))continue;
      (blocks[s.trial.block] ||= []).push(s);
    }
    let incomplete=0,mismatched=0;const groups={};
    for(const block of Object.values(blocks)){
      if(block.length!==4||new Set(block.map(s=>s.trial.slot)).size!==4){incomplete++;continue;}
      const A=block.filter(s=>s.trial.arm==='A'),B=block.filter(s=>s.trial.arm==='B');
      const condition=s=>[s.epoch,s.content,s.host,s.rangeBytes,s.inflight,s.requestedALPN==='h2'?'h2':'h1',[32,64,128].includes(s.minChunkKiB)?s.minChunkKiB:128].join('|');
      if(A.length!==2||B.length!==2||new Set(block.map(condition)).size!==1||
        new Set(block.map(s=>s.trial.baseline+':'+s.trial.candidate)).size!==1||
        new Set(A.map(s=>s.mode)).size!==1||new Set(B.map(s=>s.mode)).size!==1){mismatched++;continue;}
      const key=condition(A[0])+'|'+A[0].mode+'|'+B[0].mode+'|'+A[0].trial.baseline+'|'+A[0].trial.candidate;
      const g=groups[key] ||= {baseline:A[0].trial.baseline,candidate:B[0].trial.candidate,actualA:A[0].mode,actualB:B[0].mode,blocks:0,cleanBlocks:0,failedA:0,failedB:0,logRatios:[],latencyA:[],latencyB:[]};
      g.blocks++;g.failedA+=A.filter(s=>!s.ok).length;g.failedB+=B.filter(s=>!s.ok).length;
      g.latencyA.push(...A.map(s=>s.elapsedMs).filter(n=>Number.isFinite(n)&&n>0));g.latencyB.push(...B.map(s=>s.elapsedMs).filter(n=>Number.isFinite(n)&&n>0));
      if(block.every(s=>s.ok)){
        const median=values=>root.BiliRangeMeasurements.quantile(values,0.5);
        const ratio=median(B.map(s=>s.bytes/s.elapsedMs))/median(A.map(s=>s.bytes/s.elapsedMs));
        if(Number.isFinite(ratio)&&ratio>0){g.cleanBlocks++;g.logRatios.push(Math.log(ratio));}
      }
    }
    return {incomplete,mismatched,groups:Object.entries(groups).map(([key,g])=>({key,baseline:g.baseline,candidate:g.candidate,
      actualA:g.actualA,actualB:g.actualB,blocks:g.blocks,cleanBlocks:g.cleanBlocks,
      failureA:g.failedA/(2*g.blocks),failureB:g.failedB/(2*g.blocks),
      p90MsA:root.BiliRangeMeasurements.quantile(g.latencyA,0.9),p90MsB:root.BiliRangeMeasurements.quantile(g.latencyB,0.9),
      ratio:g.logRatios.length?Math.exp(g.logRatios.reduce((n,v)=>n+v,0)/g.logRatios.length):null,
      interval:empiricalInterval(g.logRatios),equivalent:g.actualA===g.actualB,
      caveat:'原有流量交替；不是完整播放实验；缓存、负载和依赖仍可混杂。区间是块重采样经验范围。'}))};
  }
  root.BiliRangeTrials={plan,analyze,empiricalInterval,permission,recordSafety,safetyReport};
})(globalThis);
