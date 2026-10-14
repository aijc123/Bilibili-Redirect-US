/* Preserve the official media source; scope negative evidence to one signed
 * representation/node/network instead of confusing another track's success. */
(function(root){
 'use strict';
 const allowed=['transport','redirect-untrusted','redirect-limit','entity-mismatch','range-mismatch','length-mismatch',
  'content-range','content-length','encoded-body','non-media','status-403','status-404','status-410'];
 const fresh=(v,at,ttl)=>Number.isFinite(v)&&v<=at&&at-v<ttl;
 const epoch=state=>Number(state.epoch)||0;
 function entries(state,at){
  return Object.fromEntries(Object.entries(state.recovery?.entries||{}).filter(([key,v])=>{
   const parts=key.split('|');return parts.length===4&&parts[0]===String(epoch(state))&&/^[a-f0-9]{8}$/.test(parts[1])&&
    ['http','https'].includes(parts[2])&&root.BiliRange.isTargetHost(parts[3])&&v&&fresh(v.at,at,120000)&&
    Number.isInteger(v.failures)&&v.failures>=1&&v.failures<=5&&allowed.includes(v.reason)&&
    Number.isFinite(v.until)&&v.until>=v.at&&v.until<=v.at+60000;
  }).slice(-16).map(([key,v])=>[key,{at:v.at,until:v.until,failures:v.failures,reason:v.reason}]));
 }
 function key(state,request,host){
  const u=root.BiliRange.parseURL(request?.url);if(!u||!root.BiliRange.isTargetHost(host))return;
  // The existing identity intentionally omits authority for cross-CDN samples.
  // A refusal cache must also distinguish the donor host and explicit port.
  const alias={url:'https://'+u.host+'/upgcxcode/recovery-'+encodeURIComponent(u.authority.toLowerCase())+u.path+u.query};
  const content=root.BiliRangeMeasurements.identity(state,alias,true);
  return content?[epoch(state),content,u.protocol,host].join('|'):undefined;
 }
 function pool(state,request,base,at=Date.now()){
  const p=root.BiliRange.eligible(request,{maxBytes:4*1024*1024},at);
  if(p.kind!=='eligible')return base;
  const prior=entries(state,at),blocked=host=>Number(prior[key(state,request,host)]?.until)>at;
  const source=p.u.host;
  const pushback=(Array.isArray(state.measurements?.samples)?state.measurements.samples:[]).some(s=>
   s&&s.epoch===epoch(state)&&s.host===source&&!s.ok&&['status-412','status-429'].includes(s.reason)&&fresh(s.at,at,180000));
  // Respect origin load refusal; keep the existing shrink/rest policy instead
  // of treating a throttle as a reason to race another hostname.
  if(pushback)return [source];
  // The actual source can be faster than every forced CDN. Do not discard it
  // merely because a different node has once delivered some other media.
  if(!blocked(source)&&!(Number(state.hosts?.[source]?.blockedUntil)>at))return [source];
  return base.filter(host=>host!==source&&!blocked(host));
 }
 function observe(state,request,result,context,latest,at=Date.now()){
  state.recovery={schema:1,entries:entries(latest,at)};
  const previous=latest.recovery?.last;
  if(previous&&previous.epoch===epoch(state)&&fresh(previous.at,at,120000)&&
   root.BiliRange.isTargetHost(previous.source)&&root.BiliRange.isTargetHost(previous.selected))
   state.recovery.last={at:previous.at,epoch:previous.epoch,source:previous.source,selected:previous.selected};
  if(epoch(state)!==Number(context.epoch||0)||!result.metrics?.host)return;
  const host=result.metrics.host,k=key(state,request,host),u=root.BiliRange.parseURL(request.url);
  if(!k||!u)return;
  state.recovery.last={at,epoch:epoch(state),source:u.host,selected:host};
  if(result.kind==='response')delete state.recovery.entries[k];
  else if(allowed.includes(result.reason)){
   const old=state.recovery.entries[k],failures=old&&fresh(old.at,at,30000)?Math.min(5,old.failures+1):1;
   // A single network error may be transient; repeated ones rest this pair.
   const delay=result.reason==='transport'?(failures>=2?12000:0):60000;
   state.recovery.entries[k]={at,until:at+delay,failures,reason:result.reason};
  }
  state.recovery.entries=Object.fromEntries(Object.entries(state.recovery.entries).slice(-16));
 }
 function report(state,at=Date.now()){
  const v=state.recovery?.last;
  if(!v||v.epoch!==epoch(state)||!fresh(v.at,at,120000)||!root.BiliRange.isTargetHost(v.source)||!root.BiliRange.isTargetHost(v.selected))
   return '媒体选路：暂无近期结果；优先官方原地址，异常时才用CDN回退。';
  return `媒体选路：${v.source===v.selected?'保留官方原地址':'原地址异常后的CDN回退'} ${v.selected}。不代表已测出全局最快节点。`;
 }
 root.BiliRangeRecovery={pool,observe,report,entries,key};
 const diagnostics=root.BiliRangeDiagnostics;
 if(diagnostics)for(const name of ['summary','report']){const original=diagnostics[name];diagnostics[name]=(state,...args)=>original(state,...args)+'\n'+report(state,...args);}
})(globalThis);
