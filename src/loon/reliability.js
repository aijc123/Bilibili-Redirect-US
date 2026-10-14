/* Completion-only circuit protection for repeated transport failures.
 * Stops parallel takeover; does not stop or measure the App's original request. */
(function(root){
 'use strict';
 const age=(at,now,ttl)=>Number.isFinite(at)&&at<=now&&now-at<ttl;
 function condition(state,request,now=Date.now()){
  const u=root.BiliRange.parseURL(request?.url);if(!u)return {phase:'normal'};
  const content=root.BiliRangeMeasurements.identity(state,request),epoch=Number(state.epoch)||0;
  const samples=(Array.isArray(state.measurements?.samples)?state.measurements.samples:[]).filter(s=>
   s&&s.epoch===epoch&&s.content===content&&s.adaptiveScheme===u.protocol&&age(s.at,now,60000))
   .sort((a,b)=>a.at-b.at).slice(-8);
  const errors=samples.filter(s=>s.ok===false&&s.reason==='transport');
  const last=errors[errors.length-1];
  if(!last||errors.filter(s=>last.at-s.at<20000).length<3)return {phase:'normal'};
  // Two completed, solo, unsplit successes are enough to leave protection.
  // This is transport recovery, not proof that playback or throughput recovered.
  const recovered=samples.filter(s=>s.ok===true&&s.mode===1&&s.inflight===0&&!s.trial&&
   Number.isFinite(s.from)&&s.from>=last.at&&s.from<s.at);
  let count=0,end=last.at;
  for(const sample of recovered)if(sample.from>=end){count++;end=sample.at;}
  if(count>=2)return {phase:'normal'};
  return {phase:now<last.at+15000?'rest':'probe',until:last.at+15000};
 }
 function configure(state,request,policy,now=Date.now()){
  if(policy.profile!=='automatic'||policy.options.enabled===false)return;
  if(root.BiliRange.eligible(request,policy.options,now).kind!=='eligible')return;
  const status=condition(state,request,now);policy.reliability=status;
  if(status.phase==='normal')return;
  policy.trialMode='off';
  if(status.phase==='rest'||Object.keys(root.BiliRangeBudget.active(state.leases,now)).length){
   policy.options.deferReason='transport-rest';delete policy.adaptive;return;
  }
  policy.options.connections=1;policy.reason='network-errors';
  if(policy.adaptive){policy.adaptive.choice=1;policy.adaptive.reason='network-errors';delete policy.adaptive.mode;}
 }
 function observe(state,request,policy,requestEpoch,latest,now=Date.now()){
  state.protection={};const previous=latest.protection?.last,epoch=Number(state.epoch)||0;
  if(previous&&previous.epoch===epoch&&age(previous.at,now,120000)&&
    ['normal','rest','probe'].includes(previous.phase)&&Number.isFinite(previous.until))state.protection.last={
     at:previous.at,epoch:previous.epoch,phase:previous.phase,until:previous.until};
  if(epoch!==requestEpoch||!policy.reliability)return;
  const status=condition(state,request,now);
  state.protection.last={at:now,epoch,phase:status.phase,until:Number(status.until)||0};
 }
 function report(state,now=Date.now()){
  const last=state.protection?.last;
  if(!last||last.epoch!==(Number(state.epoch)||0)||!age(last.at,now,120000)||
   !['normal','rest','probe'].includes(last.phase)||!Number.isFinite(last.until))return '';
  if(last.phase==='rest')return '接管保护：同一媒体网络错误密集，暂放行原请求；约'+Math.max(0,Math.ceil((last.until-now)/1000))+'秒后可用单任务检查恢复。原生下载结果不可见。';
  if(last.phase==='probe')return '接管保护：单任务恢复检查；有其他在途接管时继续放行。两次独立成功或证据过期后回到普通策略，不代表播放已不卡。';
  return '接管保护：当前没有命中网络错误退让条件；不代表没有卡顿。';
 }
 root.BiliRangeReliability={condition,configure,observe,report};
 const diagnostics=root.BiliRangeDiagnostics;
 if(diagnostics)for(const name of ['summary','report']){const original=diagnostics[name];diagnostics[name]=(state,...args)=>{
  const extra=report(state,...args);return original(state,...args)+(extra?'\n'+extra:'');};}
})(globalThis);
