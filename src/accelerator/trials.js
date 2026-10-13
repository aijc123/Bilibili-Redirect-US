/* Optional balanced existing-traffic comparison. No replay or background media GET.
 * Blocks alternate ABBA/BAAB at random; not a fully controlled player experiment. */
(function(root){
  'use strict';
  const MODES={'4vs8':[4,8],'4vs16':[4,16],'4vs32':[4,32]};
  function plan(state,request,mode,at=Date.now(),random=Math.random){
    const arms=MODES[mode];if(!arms)return null;
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
      if(!s.trial||!/^\d+\|[0-9a-f]{8}\|4vs(?:8|16|32)\|\d+$/.test(s.trial.block||'')||
        !['A','B'].includes(s.trial.arm)||![0,1,2,3].includes(s.trial.slot)||s.trial.baseline!==4||![8,16,32].includes(s.trial.candidate))continue;
      (blocks[s.trial.block] ||= []).push(s);
    }
    let incomplete=0,mismatched=0;const groups={};
    for(const block of Object.values(blocks)){
      if(block.length!==4||new Set(block.map(s=>s.trial.slot)).size!==4){incomplete++;continue;}
      const A=block.filter(s=>s.trial.arm==='A'),B=block.filter(s=>s.trial.arm==='B');
      const condition=s=>[s.epoch,s.content,s.host,s.rangeBytes,s.inflight,s.requestedALPN==='h2'?'h2':'h1',[32,64,128].includes(s.minChunkKiB)?s.minChunkKiB:128].join('|');
      if(A.length!==2||B.length!==2||new Set(block.map(condition)).size!==1||
        new Set(block.map(s=>s.trial.candidate)).size!==1||
        new Set(A.map(s=>s.mode)).size!==1||new Set(B.map(s=>s.mode)).size!==1){mismatched++;continue;}
      const key=condition(A[0])+'|'+A[0].mode+'|'+B[0].mode+'|'+A[0].trial.candidate;
      const g=groups[key] ||= {baseline:A[0].trial.baseline,candidate:B[0].trial.candidate,actualA:A[0].mode,actualB:B[0].mode,blocks:0,cleanBlocks:0,failedA:0,failedB:0,logRatios:[]};
      g.blocks++;g.failedA+=A.filter(s=>!s.ok).length;g.failedB+=B.filter(s=>!s.ok).length;
      if(block.every(s=>s.ok)){
        const median=values=>root.BiliRangeMeasurements.quantile(values,0.5);
        const ratio=median(B.map(s=>s.bytes/s.elapsedMs))/median(A.map(s=>s.bytes/s.elapsedMs));
        if(Number.isFinite(ratio)&&ratio>0){g.cleanBlocks++;g.logRatios.push(Math.log(ratio));}
      }
    }
    return {incomplete,mismatched,groups:Object.entries(groups).map(([key,g])=>({key,baseline:g.baseline,candidate:g.candidate,
      actualA:g.actualA,actualB:g.actualB,blocks:g.blocks,cleanBlocks:g.cleanBlocks,
      failureA:g.failedA/(2*g.blocks),failureB:g.failedB/(2*g.blocks),
      ratio:g.logRatios.length?Math.exp(g.logRatios.reduce((n,v)=>n+v,0)/g.logRatios.length):null,
      interval:empiricalInterval(g.logRatios),equivalent:g.actualA===g.actualB,
      caveat:'原有流量交替；不是完整播放实验；缓存、负载和依赖仍可混杂。区间是块重采样经验范围。'}))};
  }
  root.BiliRangeTrials={plan,analyze,empiricalInterval};
})(globalThis);
