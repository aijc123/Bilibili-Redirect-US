/* Loon adapter. Stores aggregates only; never stores or uploads media URLs. */
(function () {
  'use strict';
  const KEY = 'aijc123.BiliRange.v1', core = globalThis.BiliRange, diagnostics = globalThis.BiliRangeDiagnostics;
  let state;
  try { state = JSON.parse($persistentStore.read(KEY) || '{}'); } catch { state = {}; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
  let arg = typeof $argument === 'object' && $argument ? $argument : {};
  if (typeof $argument === 'string') { try { arg = JSON.parse($argument); } catch { if ($argument === 'Action=reset') arg = { Action: 'reset' }; } }
  if(!arg||typeof arg!=='object'||Array.isArray(arg))arg={};
  const epoch = state.epoch || 0;
  const save = () => $persistentStore.write(JSON.stringify(state), KEY);
  if (arg.Action === 'reset' || typeof $request === 'undefined' || !$request || typeof $request.url !== 'string' || !$request.url) {
    if (arg.Action === 'reset') { state.hosts = {}; state.epoch = epoch + 1; save(); $done({}); return; }
    const scores = Object.entries(state.hosts || {}).map(([h, v]) => `${h}: ${(Number(v.bps || 0) * 8 / 1e6).toFixed(1)} Mbps`);
    const summary = globalThis.BiliRangeProfile==='automatic'?diagnostics.summary(state):diagnostics.report(state) + '\n' + scores.join('\n');
    console.log(summary);
    if (typeof $notification !== 'undefined' && typeof $notification.post === 'function') {
      try { $notification.post('Bili Range 诊断', '点此通知复制摘要，然后粘贴到聊天', summary, { clipboard: summary }); } catch {}
    }
    $done({ title: 'Bili Range 实验版', content: summary }); return;
  }
  let finished = false;
  const done = result => { if (!finished) { finished = true; $done(result); } };
  const fetchRange = options => globalThis.BiliRangeHTTP.makeFetch($httpClient)(options);
  const policy=globalThis.BiliRangePolicy.resolve(state,$request,arg,globalThis.BiliRangeProfile);
  const options=policy.options;
  const plan=core.eligible($request,options);
  const parsed=plan.range;
  const trialPermission=plan.kind==='eligible'&&globalThis.BiliRangeTrials?globalThis.BiliRangeTrials.permission(state,$request,policy.trialMode,options.hosts[0]):null;
  const trialPlan=trialPermission?.allowed?globalThis.BiliRangeTrials.plan(state,$request,policy.trialMode):null;
  if(trialPlan){options.connections=trialPlan.connections;options.auto=false;}
  else if(trialPermission?.recovery){
    options.connections=trialPermission.baseline;options.minChunkKiB=128;options.auto=true;
    if(trialPermission.excludePreferred)options.hosts=options.hosts.slice(1);
  }
  const leases = globalThis.BiliRangeBudget.active(state.leases,Date.now());
  let inflight=Object.keys(leases).length;
  let lease;
  if (plan.kind==='eligible') {
    // Best-effort cross-context budget. Storage exposes no atomic compare-and-swap.
    const id=Date.now().toString(36) + Math.random().toString(36).slice(2);
    const admission=globalThis.BiliRangeBudget.admit({leases,now:Date.now(),bytes:parsed.length,
      wanted:core.split(parsed,options.connections,options.minChunkKiB*1024).length,globalJobs:policy.globalJobs,
      maxBufferedBytes:Math.max(4*1024*1024,options.maxBytes),id});
    if (!admission.ok) {
      state.leases=admission.leases;
      state.diagnostics = diagnostics.record(state.diagnostics, $request, {kind:'pass',reason:admission.reason},{policy,epoch});
      save(); done({}); return;
    }
    lease=id;inflight=admission.inflight;options.allocatedConnections=admission.count;
    if(trialPlan)state.trials=trialPlan.next;
    state.leases=admission.leases;
    if(save()===false){console.log('Bili Range 预算状态写入失败，放行原请求。');done({});return;}
  }
  core.accelerate({ request: $request, options, fetchRange, state }).then(result => {
    if (result.reason === 'internal') { done({}); return; }
    // Merge aggregate counters with the latest storage; separate script contexts may finish together.
    let latest;
    try { latest = JSON.parse($persistentStore.read(KEY) || '{}'); } catch { latest = {}; }
    if (!latest || typeof latest !== 'object' || Array.isArray(latest)) latest = {};
    state.diagnostics = diagnostics.record(latest.diagnostics, $request, result,{policy,epoch});
    if(globalThis.BiliRangeMeasurements){
      state.measurements=latest.measurements;
      globalThis.BiliRangeMeasurements.record(state,$request,result,{epoch,connections:options.connections,inflight,trial:trialPlan?.trial});
    }
    state.mediaInfos=latest.mediaInfos;
    state.playbackRate=policy.playbackRate;
    if(globalThis.BiliRangeMedia)globalThis.BiliRangeMedia.observe(state,$request,result,{epoch});
    state.lastNetworkReset=latest.lastNetworkReset;
    state.trials=latest.trials;
    state.trialSafety=latest.trialSafety;
    state.epoch = latest.epoch || 0;
    globalThis.BiliRangeTrials?.recordSafety(state,$request,result,{mode:policy.trialMode,trial:trialPlan?.trial,epoch});
    state.leases = latest.leases || {};
    if (lease) delete state.leases[lease];
    if (result.metrics?.host && state.epoch === epoch) state.hosts = { ...(latest.hosts || {}), [result.metrics.host]: state.hosts[result.metrics.host] };
    else state.hosts = latest.hosts || {};
    save();
    if (policy.debug) console.log(JSON.stringify({ kind: result.kind, reason: result.reason, metrics: result.metrics }));
    done(result.kind === 'response' ? { response: result.response } : {});
  }).catch(() => {
    // A local processing exception must not hold the admission budget until expiry.
    try {const latest=JSON.parse($persistentStore.read(KEY)||'{}');if(lease&&latest?.leases){delete latest.leases[lease];$persistentStore.write(JSON.stringify(latest),KEY);}}catch{}
    done({});
  });
})();
