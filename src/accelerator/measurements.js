/* Bounded local observational measurements. No raw URL, token, cookie or Wi-Fi name. */
(function (root) {
  'use strict';
  const MAX_SAMPLES = 120, RETAIN_MS = 15 * 60 * 1000;
  const median = values => quantile(values, 0.5);
  function quantile(values, p) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a,b)=>a-b), pos=(sorted.length-1)*p;
    const lo=Math.floor(pos), hi=Math.ceil(pos);
    return sorted[lo]+(sorted[hi]-sorted[lo])*(pos-lo);
  }
  function hash(text, salt) {
    let value=2166136261;
    const input=String(salt)+String(text);
    for(let i=0;i<input.length;i++)value=Math.imul(value^input.charCodeAt(i),16777619)>>>0;
    return value.toString(16).padStart(8,'0');
  }
  function rangeBucket(bytes) {
    return bytes<256*1024?'small':bytes<768*1024?'256-768KiB':bytes<=1280*1024?'near-1MiB':bytes<=2*1024*1024?'1.25-2MiB':'over-2MiB';
  }
  function identity(state,request){
    const u=root.BiliRange.parseURL(request.url);if(!u)return null;
    const m=state.measurements ||= {salt:Math.random().toString(36).slice(2),samples:[]};
    return hash(u.path,m.salt);
  }
  function record(state, request, result, context={}) {
    const at=Number(result.metrics?.finishedAt)||Date.now();
    const m=state.measurements ||= {salt:Math.random().toString(36).slice(2),samples:[]};
    m.samples=(Array.isArray(m.samples)?m.samples:[]).filter(s=>at-s.at<RETAIN_MS && at>=s.at);
    const u=root.BiliRange.parseURL(request.url);
    const range=root.BiliRange.parseRange(root.BiliRange.headers(request.headers).range);
    if(!u||!range||range.length<256*1024||!result.metrics) return;
    const r=result.metrics;
    const sample={at,from:Number(r.startedAt)||at-Math.max(1,Number(r.elapsedMs)||1),
      ok:result.kind==='response',reason:result.kind==='response'?'ok':
        (root.BiliRangeDiagnostics?.allowedReasons?.includes(result.reason)||/^status-\d{3}$/.test(result.reason||'')?result.reason:'other-failure'),
      bytes:result.kind==='response'?Number(r.bytes)||0:0,elapsedMs:Math.max(1,Number(r.elapsedMs)||1),
      requestedALPN:r.requestedALPN==='h2'?'h2':'h1',
      minChunkKiB:[32,64,128].includes(Number(r.minChunkKiB))?Number(r.minChunkKiB):128,
      mode:Number(r.connections)||Number(context.connections)||0,requestedMode:Number(r.configuredConnections)||Number(context.connections)||Number(r.connections)||0,host:String(r.host||''),
      epoch:Number(context.epoch)||0,content:identity(state,request),bucket:rangeBucket(range.length),rangeBytes:range.length,
      inflight:Number(context.inflight)||0,redirects:Number(r.redirects)||0,
      maxPieceMs:Number(r.maxPieceMs)||0,minPieceMs:Number(r.minPieceMs)||0};
    // Restrict the only stored hostname field. Invalid metrics cannot introduce other text.
    if(!/^upos-sz-mirror[a-z0-9-]+\.bilivideo\.com$/.test(sample.host))return;
    if(['total','etag','last-modified','content-type'].includes(r.integrityField))sample.integrityField=r.integrityField;
    if(['malformed','source','host','credentials','downgrade','port','path-wrapper','path'].includes(r.redirectField))sample.redirectField=r.redirectField;
    const trial=sanitizeTrial(context.trial);if(trial)sample.trial=trial;
    m.samples.push(sample);m.samples=m.samples.slice(-MAX_SAMPLES);
  }
  function unionMs(intervals) {
    if(!intervals.length)return 0;
    const sorted=intervals.map(i=>[i[0],i[1]]).sort((a,b)=>a[0]-b[0]);
    let from=sorted[0][0],to=sorted[0][1],total=0;
    for(const interval of sorted.slice(1)) {
      if(interval[0]<=to)to=Math.max(to,interval[1]);
      else {total+=Math.max(0,to-from);[from,to]=interval;}
    }
    return total+Math.max(0,to-from);
  }
  function peak(intervals) {
    const events=[];
    for(const [a,b] of intervals){events.push([a,1],[b,-1]);}
    events.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    let active=0,max=0;for(const [,delta] of events){active+=delta;max=Math.max(max,active);}return max;
  }
  function summarize(samples) {
    const ok=samples.filter(s=>s.ok),rates=ok.map(s=>s.bytes*8/s.elapsedMs/1000),latencies=ok.map(s=>s.elapsedMs);
    const spreads=ok.filter(s=>Number.isFinite(s.minPieceMs)&&Number.isFinite(s.maxPieceMs)&&s.minPieceMs>0&&s.maxPieceMs>=s.minPieceMs).map(s=>s.maxPieceMs-s.minPieceMs);
    return {n:samples.length,success:ok.length,failed:samples.length-ok.length,
      failureRate:samples.length?(samples.length-ok.length)/samples.length:0,
      p50Mbps:median(rates),p10Mbps:quantile(rates,0.1),p50Ms:median(latencies),p90Ms:quantile(latencies,0.9),
      p90AttemptMs:quantile(samples.map(s=>s.elapsedMs),0.9),pieceSpreadN:spreads.length,p50PieceSpreadMs:median(spreads),p90PieceSpreadMs:quantile(spreads,0.9),
      bytes:ok.reduce((n,s)=>n+s.bytes,0),noise:ok.length<8?'样本不足':rates.length&&quantile(rates,0.9)/Math.max(0.001,quantile(rates,0.1))>2?'波动较大':'仍有缓存与时间噪音'};
  }
  function analyze(state, at=Date.now()) {
    const valid=s=>s&&typeof s==='object'&&/^upos-sz-mirror[a-z0-9-]+\.bilivideo\.com$/.test(s.host||'')&&/^[0-9a-f]{8}$/.test(s.content||'')&&
      ['small','256-768KiB','near-1MiB','1.25-2MiB','over-2MiB'].includes(s.bucket)&&
      [s.at,s.from,s.bytes,s.elapsedMs,s.mode,s.epoch,s.inflight].every(Number.isFinite);
    const samples=(Array.isArray(state.measurements?.samples)?state.measurements.samples:[]).filter(s=>valid(s)&&at-s.at<RETAIN_MS&&at>=s.at).slice(-MAX_SAMPLES);
    const recent=samples.filter(s=>s.epoch===(Number(state.epoch)||0)&&at-s.at<=30000),delivered=recent.filter(s=>s.ok);
    const intervals=recent.map(s=>[s.from,s.at]);
    const bytes=delivered.reduce((n,s)=>n+s.bytes,0);
    // Include failed attempt time: excluding it would inflate apparent delivery.
    const elapsed=recent.length?Math.max(1000,Math.max(...recent.map(s=>s.at))-Math.min(...recent.map(s=>s.from))):0;
    const occupied=unionMs(intervals);
    const groups={};
    for(const s of samples){const key=[s.epoch,s.content,s.host,s.bucket,s.inflight,s.requestedALPN==='h2'?'h2':'h1',[32,64,128].includes(s.minChunkKiB)?s.minChunkKiB:128,s.mode].join('|');(groups[key] ||= []).push(s);}
    const comparisons={};
    for(const s of samples){
      if(!Number.isSafeInteger(s.rangeBytes)||s.rangeBytes<=0||![1,2,4,6,8,16,32].includes(s.requestedMode))continue;
      const key=[s.epoch,s.content,s.host,s.rangeBytes,s.inflight,s.requestedALPN==='h2'?'h2':'h1',[32,64,128].includes(s.minChunkKiB)?s.minChunkKiB:128].join('|');
      ((comparisons[key] ||= {})[s.requestedMode+':'+s.mode] ||= []).push(s);
    }
    const contrasts=[];
    for(const [key,modes] of Object.entries(comparisons)) {
      const keys=Object.keys(modes).sort((a,b)=>Number(a.split(':')[0])-Number(b.split(':')[0]));
      for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++) {
        const [settingA,actualA]=keys[i].split(':').map(Number),[settingB,actualB]=keys[j].split(':').map(Number);
        // Natural request-size caps and budget reductions are not changes of settings.
        if(settingA===settingB||actualA===actualB)continue;
        const a=summarize(modes[keys[i]]),b=summarize(modes[keys[j]]);
        if(!a.success||!b.success)continue;
        contrasts.push({group:key,baseline:actualA,candidate:actualB,baselineSetting:settingA,candidateSetting:settingB,baselineN:a.n,candidateN:b.n,
          medianRatio:b.p50Mbps/a.p50Mbps,baselineP90Ms:a.p90Ms,candidateP90Ms:b.p90Ms,
          adequate:a.success>=8&&b.success>=8,causal:false,warning:'不同字节范围/缓存状态仍可能混杂；不是因果提速倍数'});
      }
    }
    const failureReasons={};for(const s of recent.filter(s=>!s.ok)){
      const reason=root.BiliRangeDiagnostics?.allowedReasons?.includes(s.reason)||/^status-\d{3}$/.test(s.reason||'')?s.reason:'other-failure';failureReasons[reason]=(failureReasons[reason]||0)+1;
    }
    return {trials:root.BiliRangeTrials?root.BiliRangeTrials.analyze(samples):null,window:{n:recent.length,success:delivered.length,failed:recent.length-delivered.length,failureReasons,bytes,spanMs:elapsed,occupiedMs:occupied,
      deliveryMbps:elapsed?bytes*8/elapsed/1000:null,activeMbps:occupied?bytes*8/occupied/1000:null,
      peakCompletedOverlap:peak(intervals),scope:'完成接管尝试的成功字节 / 含失败的时间区间；不含原请求放行流量，不能直接推断播放器缓冲'},
      groups:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,summarize(v)])),contrasts:contrasts.slice(-12),samples:samples.length};
  }
  function report(state,at=Date.now()) {
    const a=analyze(state,at),w=a.window,fmt=n=>n===null?'未知':Number(n).toFixed(2);
    const lines=[`客观采样：保留 ${a.samples} 条 / 最近30秒 ${w.n} 条`,
      `窗口交付率 ${fmt(w.deliveryMbps)} Mbps；尝试活跃区间交付率 ${fmt(w.activeMbps)} Mbps；完成尝试重叠峰值 ${w.peakCompletedOverlap}`,
      `最近尝试成功 ${w.success} / 失败 ${w.failed}；失败类别 ${JSON.stringify(w.failureReasons)}（只含已完成接管尝试）`,
      '分层条件：网络epoch / 临时表示组 / CDN / 请求大小 / 在途负载 / 请求ALPN / 分片下限KiB / 实际并发',
      'ALPN表示请求偏好；API未报告实际协商协议，也不提供实际TCP连接数。',
      '下列为每请求分布，含连接/重定向/返回等待，API不提供真实TTFB或播放器卡顿计数：'];
    for(const [key,v] of Object.entries(a.groups).slice(-12))lines.push(`${key}: n=${v.n}, 错误=${(v.failureRate*100).toFixed(1)}%, p50=${fmt(v.p50Mbps)} Mbps, p10=${fmt(v.p10Mbps)} Mbps, 成功p90=${fmt(v.p90Ms)} ms, 尝试p90=${fmt(v.p90AttemptMs)} ms（含失败）, ${v.noise}`+
      (v.pieceSpreadN?`；片耗时差p50/p90=${fmt(v.p50PieceSpreadMs)}/${fmt(v.p90PieceSpreadMs)} ms，n=${v.pieceSpreadN}`:''));
    for(const c of a.contrasts)lines.push(`观察对照 设置${c.baselineSetting}→${c.candidateSetting} / 分片${c.baseline}→${c.candidate}: 中位比=${c.medianRatio.toFixed(2)}, n=${c.baselineN}/${c.candidateN}, ${c.adequate?'样本达到最低门槛':'样本不足'}；不是因果倍数`);
    if(!a.contrasts.length)lines.push('暂无相同精确字节数且设置确实不同的对照；自然分成6/8片不能当作调高并发收益，旧样本缺精确长度时不比较。');
    if(a.trials){
      lines.push(`交替块对照：未完成块 ${a.trials.incomplete}，条件不一致块 ${a.trials.mismatched}`);
      for(const g of a.trials.groups.slice(-6))lines.push(`设置 ${g.baseline}→${g.candidate} / 实际 ${g.actualA}→${g.actualB}路，块 ${g.cleanBlocks}/${g.blocks}，错误 ${(g.failureA*100).toFixed(1)}%/${(g.failureB*100).toFixed(1)}%，尝试耗时p90 ${fmt(g.p90MsA)}/${fmt(g.p90MsB)} ms（含失败），比值 ${fmt(g.ratio)}，经验区间 ${g.interval?g.interval.map(fmt).join('～'):'样本不足'}${g.equivalent?'；实际并发相同，不能验证高路数效果':''}`);
      if(a.trials.groups.length)lines.push('块重采样范围不是保证；仍有缓存、负载及样本依赖，不代表卡顿下降倍数。');
    }
    lines.push(w.scope);return lines.join('\n');
  }
  const TRIAL_MODES=Object.freeze({'4vs8':Object.freeze([4,8]),'4vs16':Object.freeze([4,16]),'4vs32':Object.freeze([4,32]),
    '8vs16':Object.freeze([8,16]),'8vs32':Object.freeze([8,32])});
  function sanitizeTrial(trial){
    if(!trial||typeof trial.block!=='string'||trial.block.length>80)return null;
    const match=/^\d+\|[0-9a-f]{8}\|([48]vs(?:8|16|32))\|\d+$/.exec(trial.block),arms=match&&TRIAL_MODES[match[1]];
    if(!arms||![0,1,2,3].includes(trial.slot)||!['A','B'].includes(trial.arm)||trial.baseline!==arms[0]||trial.candidate!==arms[1])return null;
    return {block:trial.block,slot:trial.slot,arm:trial.arm,baseline:trial.baseline,candidate:trial.candidate};
  }
  root.BiliRangeMeasurements={record,identity,analyze,report,quantile,unionMs,rangeBucket,TRIAL_MODES,sanitizeTrial};
})(globalThis);
