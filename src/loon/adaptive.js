/* Loon completion-only adaptive candidate, Apache-2.0, aijc123.
 * BTR inspired: judge gains, back off refusals, rest before another trial.
 * Reuses BiliRangeTrials' ABBA planner, matching and block resampling directly.
 * Does not invent BTR buffer/stall/progress signals or issue extra media GETs. */
(function(root){
  'use strict';
  const C=__BILI_ADAPTIVE_CONFIG__;
  const M=()=>root.BiliRangeMeasurements,T=()=>root.BiliRangeTrials;
  const last=values=>values?.[values.length-1];
  const median=values=>M().quantile(values,0.5);
  const goodTime=(value,at,ttl)=>Number.isFinite(value)&&value<=at&&at-value<ttl;
  function entries(state,at){
    return Object.fromEntries(Object.entries(state.adaptive?.entries||{}).filter(([key,v])=>
      /^\d+\|[a-f0-9]{8}\|[^|]+\|\d+$/.test(key)&&key.startsWith((Number(state.epoch)||0)+'|')&&
      root.BiliRange.isTargetHost(key.split('|')[2])&&v&&goodTime(v.at,at,C.sampleTTL))
      .slice(-8).map(([key,v])=>[key,{at:v.at,choice:[4,8,16,32].includes(v.choice)?v.choice:8,
        baselineMs:Number.isFinite(v.baselineMs)&&v.baselineMs>0?v.baselineMs:0,
        pausedUntil:goodTime(v.pausedUntil-C.pauseMs,at,C.pauseMs)?v.pausedUntil:0}]));
  }
  function scope(state,request,host,bytes,entity){
    const identity=M().identity(state,request,true);
    if(!identity)return null;
    const scheme=root.BiliRange.parseURL(request.url)?.protocol;
    if(!entity)entity=last((Array.isArray(state.measurements?.samples)?state.measurements.samples:[]).filter(x=>x&&x.ok&&x.epoch===(Number(state.epoch)||0)&&x.host===host&&
      x.rangeBytes===bytes&&x.adaptiveScheme===scheme&&x.adaptiveSignature===identity&&/^[a-f0-9]{8}$/.test(x.adaptiveEntity||'')))?.adaptiveEntity||'00000000';
    // Alias only for the existing trial planner's group key; never sent to HTTP.
    const alias={...request,url:'https://'+host+'/upgcxcode/adaptive-'+identity+'-'+scheme+'-'+bytes+'-'+entity+'.m4s'};
    const token=M().identity(state,alias);
    return {key:[Number(state.epoch)||0,token,host,bytes].join('|'),alias,token};
  }
  function samplesFor(state,condition,host,bytes,at){
    return (Array.isArray(state.measurements?.samples)?state.measurements.samples:[]).filter(s=>
      s&&s.epoch===(Number(state.epoch)||0)&&s.content===condition.content&&s.host===host&&s.rangeBytes===bytes&&
      s.adaptiveScheme===condition.scheme&&s.adaptiveSignature===condition.signature&&
      s.inflight===0&&s.requestedALPN==='h1'&&s.minChunkKiB===128&&goodTime(s.at,at,C.sampleTTL)&&
      Number.isFinite(s.from)&&s.from<=s.at&&Number.isFinite(s.elapsedMs)&&s.elapsedMs>0);
  }
  function evidence(samples,token,epoch,mode){
    const prefix=epoch+'|'+token+'|'+mode+'|';
    const scoped=samples.filter(s=>s.trial?.block?.startsWith(prefix));
    // A block stretched over a pause/seek cannot be a local speed comparison.
    const times={};for(const s of scoped)(times[s.trial.block] ||= []).push(s);
    const close=scoped.filter(s=>{
      const group=times[s.trial.block];return Math.max(...group.map(v=>v.at))-Math.min(...group.map(v=>v.from))<=C.blockMaxMs;
    });
    const g=T().analyze(close).groups.find(g=>!g.equivalent);
    if(!g||g.actualA!==g.baseline||g.actualB!==g.candidate||g.cleanBlocks<C.cleanBlocks||g.blocks!==g.cleanBlocks||!g.interval||g.failureA||g.failureB)return {choice:null,g};
    if(g.interval[0]>=C.gainMargin&&g.p90MsB<=g.p90MsA*C.maxTailRegression)return {choice:g.candidate,g};
    if(g.interval[1]<=C.plateauMargin&&g.p90MsA<=g.p90MsB*C.plateauMargin)return {choice:g.baseline,g};
    return {choice:null,g};
  }
  function configure(state,request,policy,at=Date.now()){
    if(policy.profile!=='automatic'||policy.options.enabled===false)return;
    const eligible=root.BiliRange.eligible(request,policy.options,at);
    if(eligible.kind!=='eligible')return;
    const host=root.BiliRange.chooseHost(state,policy.options.hosts,at);
    if(!host)return;
    const bytes=eligible.range.length,condition={content:M().identity(state,request),signature:M().identity(state,request,true),scheme:eligible.u.protocol};
    const allSamples=samplesFor(state,condition,host,bytes,at),epoch=Number(state.epoch)||0;
    const entity=last(allSamples.filter(x=>x.ok&&/^[a-f0-9]{8}$/.test(x.adaptiveEntity||'')))?.adaptiveEntity||'00000000';
    const samples=allSamples.filter(x=>!x.ok||x.adaptiveEntity===entity),s=scope(state,request,host,bytes,entity);
    if(!s)return;
    const ctx={key:s.key,token:s.token,host,bytes,epoch,choice:8,reason:'warmup',baselineMs:0};
    policy.adaptive=ctx;
    const previous=entries(state,at)[s.key];
    const allRecent=(Array.isArray(state.measurements?.samples)?state.measurements.samples:[]).filter(x=>
      x&&x.epoch===epoch&&x.host===host&&goodTime(x.at,at,C.pauseMs));
    // Server pushback is a load signal, not proof a signed object is unavailable.
    if(allRecent.some(x=>!x.ok&&['status-412','status-429'].includes(x.reason))){
      policy.options.connections=4;ctx.choice=4;ctx.reason='pushback';return;
    }
    if(policy.reason!=='baseline'){ctx.reason=policy.reason;ctx.choice=policy.options.connections;return;}
    if(previous?.pausedUntil>at){ctx.reason='rest';ctx.choice=previous.choice;policy.options.connections=previous.choice;return;}
    // Keep cold start unchanged, and don't compare naturally size-capped arms.
    if(bytes<1024*1024){ctx.reason='size-cap';return;}
    const normal=samples.filter(x=>!x.trial&&x.ok&&x.bytes===bytes&&goodTime(x.at,at,C.warmTTL));
    const progressing=samples.filter(x=>x.ok&&x.bytes===bytes&&x.trial?.block?.startsWith(epoch+'|'+s.token+'|')&&goodTime(x.at,at,C.warmTTL));
    if(normal.length<C.warmSamples&&progressing.length<C.maxProbeRequests){ctx.reason='warmup';return;}
    if(samples.some(x=>!x.ok&&goodTime(x.at,at,60000))){ctx.reason='recent-failure';return;}
    let choice=8,stage='4vs8',lastEvidence;
    for(const [mode,minimum] of [['4vs8',1024*1024],['8vs16',2*1024*1024],['16vs32',4*1024*1024]]){
      if(bytes<minimum)break;
      stage=mode;const e=evidence(samples,s.token,epoch,mode);
      if(e.choice===null)break;
      choice=e.choice;lastEvidence=e.g;
      if(choice===e.g.baseline)break;
      stage=null;
    }
    ctx.choice=choice;ctx.reason=lastEvidence?'learned':'baseline';
    ctx.baselineMs=lastEvidence?(choice===lastEvidence.baseline?lastEvidence.p90MsA:lastEvidence.p90MsB):0;
    policy.options.connections=choice;
    // Regression after selection invalidates the preference; no App stalls inferred.
    if(previous?.choice===choice&&previous.baselineMs>0){
      const latest=normal.filter(x=>x.at>previous.at&&x.requestedMode===choice).slice(-4);
      if(latest.length===4&&median(latest.map(x=>x.elapsedMs))>previous.baselineMs*1.5){
        ctx.reason='regression';ctx.choice=8;policy.options.connections=8;return;
      }
    }
    if(!stage||lastEvidence?.baseline===choice)return;
    const early=evidence(samples,s.token,epoch,stage).g;
    if(stage!=='4vs8'&&early?.cleanBlocks>=1&&early.blocks===early.cleanBlocks&&early.ratio<=0.75){
      ctx.reason='probe-loss';return;
    }
    if(samples.some(x=>x.trial&&goodTime(x.at,at,C.probeGapMs))){ctx.reason='probe-spacing';return;}
    // Existing completed requests only, idle admission, bounded exploration.
    if(Object.keys(root.BiliRangeBudget.active(state.leases,at)).length){ctx.reason='busy';return;}
    const groupKey=epoch+'|'+s.token+'|'+stage;
    const group=state.trials?.groups?.[groupKey];
    const counter=group&&goodTime(group.at,at,15*60*1000)?group.counter:0;
    if(Number.isSafeInteger(counter)&&counter>=C.maxProbeRequests){ctx.reason='inconclusive';return;}
    if(!T().permission(state,request,stage,host,at).allowed){ctx.reason='rest';return;}
    policy.options.hosts=[host,...policy.options.hosts.filter(h=>h!==host)];
    policy.trialMode=stage;ctx.mode=stage;ctx.reason='compare';
  }
  function plan(state,request,mode,at=Date.now(),random=Math.random){
    const bytes=root.BiliRange.parseRange(root.BiliRange.headers(request.headers).range)?.length;
    const host=root.BiliRange.chooseHost(state,root.BiliRangeCandidates.pool('upos-sz-mirror08c.bilivideo.com','all'),at);
    const s=host&&scope(state,request,host,bytes);
    return s?T().plan(state,s.alias,mode,at,random):null;
  }
  function observe(state,request,result,context,latest,at=Date.now()){
    state.adaptive={schema:1,entries:entries(latest,at)};
    const ctx=context.policy?.adaptive;
    if(!ctx||Number(state.epoch||0)!==Number(context.epoch||0))return;
    const sample=last(state.measurements?.samples);
    if(sample&&result.metrics&&sample.at===result.metrics.finishedAt){
      sample.adaptiveScheme=root.BiliRange.parseURL(request.url)?.protocol;
      sample.adaptiveSignature=M().identity(state,request,true);
      if(result.kind==='response'){
        const headers=root.BiliRange.headers(result.response.headers);
        const tag=[headers.etag||'',headers['last-modified']||'',headers['content-type']||'',root.BiliRange.contentRange(headers['content-range']).total];
        sample.adaptiveEntity=M().identity(state,{url:'https://'+ctx.host+'/upgcxcode/entity-'+encodeURIComponent(JSON.stringify(tag))});
      }
    }
    const old=state.adaptive.entries[ctx.key];
    if(['regression','pushback','probe-loss'].includes(ctx.reason)){
      state.adaptive.entries[ctx.key]={at,choice:ctx.reason==='probe-loss'?ctx.choice:8,baselineMs:0,pausedUntil:at+C.pauseMs};
    }else if(ctx.reason==='learned'&&(!old||old.choice!==ctx.choice)){
      state.adaptive.entries[ctx.key]={at,choice:ctx.choice,baselineMs:ctx.baselineMs,pausedUntil:0};
    }
    // Reuse the exact-byte/load matcher, additionally reject completed overlaps.
    if(context.trial){
      const r=result.metrics,others=latest.measurements?.samples||[];
      const overlap=Object.keys(root.BiliRangeBudget.active(latest.leases,at)).length>1||r&&others.some(x=>x&&x.epoch===ctx.epoch&&
        !(x.trial?.block===context.trial.block&&x.trial?.slot===context.trial.slot)&&
        x.at>r.startedAt&&x.from<r.finishedAt);
      if(overlap&&state.measurements?.samples?.length){
        const sample=last(state.measurements.samples);
        if(sample.trial?.block===context.trial.block){sample.inflight=1;}
      }
    }
    state.adaptive.entries=Object.fromEntries(Object.entries(state.adaptive.entries).slice(-8));
    const reasons=['warmup','size-cap','baseline','learned','pushback','rest','load','network-errors','recent-failure','regression','busy','inconclusive','compare','probe-loss','probe-spacing'];
    state.adaptive.last={at,epoch:ctx.epoch,choice:[4,8,16,32].includes(ctx.choice)?ctx.choice:8,
      reason:reasons.includes(ctx.reason)?ctx.reason:'baseline',mode:['4vs8','8vs16','16vs32'].includes(ctx.mode)?ctx.mode:null};
  }
  function report(state,at=Date.now()){
    const last=state.adaptive?.last;
    if(!last||last.epoch!==(Number(state.epoch)||0)||!goodTime(last.at,at,120000))return '并发调优：暂无当前网络的新结果；冷启动保持原8路策略。';
    const labels={warmup:'积累普通请求', 'size-cap':'请求较小，不试高并发',baseline:'原8路策略',learned:'同条件观察选择',pushback:'服务端拒绝负载，暂用4路',
      rest:'调优冷却',load:'负载收缩','network-errors':'网络错误收缩','recent-failure':'近期失败，暂停比较',regression:'变慢后恢复8路',busy:'在途负载，不比较',
      inconclusive:'比较预算用完，证据不足，保留原策略',compare:'原有请求交替比较','probe-loss':'比较明显变慢，恢复已有策略并冷却','probe-spacing':'比较间隔，使用已有策略'};
    return `并发调优：${labels[last.reason]||'未知'}；偏好${[4,8,16,32].includes(last.choice)?last.choice:'未知'}路${last.mode?' / '+last.mode:''}。观察收益不是卡顿或因果提速证明。`;
  }
  function safeConfigure(state,request,policy,...args){
    const original={...policy,options:{...policy.options,hosts:policy.options.hosts?.slice()}};
    try{configure(state,request,policy,...args);}catch{Object.assign(policy,original);delete policy.adaptive;}
  }
  root.BiliRangeAdaptive={configure:safeConfigure,plan,observe,report,evidence,scope,config:C};
  const diag=root.BiliRangeDiagnostics;
  if(diag)for(const name of ['summary','report']){const original=diag[name];diag[name]=(state,...args)=>original(state,...args)+'\n'+report(state,...args);}
})(globalThis);
