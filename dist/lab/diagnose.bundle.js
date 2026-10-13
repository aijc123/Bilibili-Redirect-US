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
    return {n:samples.length,success:ok.length,failed:samples.length-ok.length,
      failureRate:samples.length?(samples.length-ok.length)/samples.length:0,
      p50Mbps:median(rates),p10Mbps:quantile(rates,0.1),p50Ms:median(latencies),p90Ms:quantile(latencies,0.9),
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
    return {trials:root.BiliRangeTrials?root.BiliRangeTrials.analyze(samples):null,window:{n:recent.length,bytes,spanMs:elapsed,occupiedMs:occupied,
      deliveryMbps:elapsed?bytes*8/elapsed/1000:null,activeMbps:occupied?bytes*8/occupied/1000:null,
      peakCompletedOverlap:peak(intervals),scope:'完成接管尝试的成功字节 / 含失败的时间区间；不含原请求放行流量，不能直接推断播放器缓冲'},
      groups:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,summarize(v)])),contrasts:contrasts.slice(-12),samples:samples.length};
  }
  function report(state,at=Date.now()) {
    const a=analyze(state,at),w=a.window,fmt=n=>n===null?'未知':Number(n).toFixed(2);
    const lines=[`客观采样：保留 ${a.samples} 条 / 最近30秒 ${w.n} 条`,
      `窗口交付率 ${fmt(w.deliveryMbps)} Mbps；尝试活跃区间交付率 ${fmt(w.activeMbps)} Mbps；完成尝试重叠峰值 ${w.peakCompletedOverlap}`,
      '分层条件：网络epoch / 临时表示组 / CDN / 请求大小 / 在途负载 / 请求ALPN / 分片下限KiB / 实际并发',
      'ALPN表示请求偏好；API未报告实际协商协议，也不提供实际TCP连接数。',
      '下列为每请求分布，含连接/重定向/返回等待，API不提供真实TTFB或播放器卡顿计数：'];
    for(const [key,v] of Object.entries(a.groups).slice(-12))lines.push(`${key}: n=${v.n}, 错误=${(v.failureRate*100).toFixed(1)}%, p50=${fmt(v.p50Mbps)} Mbps, p10=${fmt(v.p10Mbps)} Mbps, p90=${fmt(v.p90Ms)} ms, ${v.noise}`);
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

/* Optional balanced existing-traffic comparison. No replay or background media GET.
 * Blocks alternate ABBA/BAAB at random; not a fully controlled player experiment. */
(function(root){
  'use strict';
  const MODES=root.BiliRangeMeasurements.TRIAL_MODES;
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
  root.BiliRangeTrials={plan,analyze,empiricalInterval};
})(globalThis);

/* Observe complete SIDX boxes already present in successful buffered responses.
 * Uses pinned BTR parser. No extra GET, response hook, or media URL persistence. */
(function(root){
  'use strict';
  function observe(state,request,result,context={}){
    try{
      if(result.kind!=='response'||!root.__BILI_SIDX__)return;
      const range=root.BiliRange.parseRange(root.BiliRange.headers(request.headers).range),body=result.response?.body;
      if(!range||range.start>65536||!(body instanceof Uint8Array))return;
      const sidx=root.__BILI_SIDX__.parseSidx(body.subarray(0,65536),range.start);
      if(!sidx||sidx.segments.length>2048)return;
      const segments=sidx.segments;
      if(segments.some(s=>!Number.isSafeInteger(s.length)||s.length<=0||!Number.isFinite(s.durationSeconds)||s.durationSeconds<=0))return;
      const bytes=segments.reduce((n,s)=>n+s.length,0),duration=segments.reduce((n,s)=>n+s.durationSeconds,0);
      const rates=segments.map(s=>s.length*8/s.durationSeconds/1e6),average=bytes*8/duration/1e6;
      if(!Number.isFinite(average)||average<=0||average>1000)return;
      const at=Number(result.metrics?.finishedAt)||Date.now(),content=root.BiliRangeMeasurements.identity(state,request);
      const type=root.BiliRange.headers(result.response.headers)['content-type']||'';
      const item={at,epoch:Number(context.epoch)||0,content,averageMbps:average,
        p90SegmentMbps:root.BiliRangeMeasurements.quantile(rates,0.9),maxSegmentMbps:Math.max(...rates),
        segments:segments.length,durationSeconds:duration,type:/^video\//i.test(type)?'video':/^audio\//i.test(type)?'audio':'unknown'};
      state.mediaInfos=(Array.isArray(state.mediaInfos)?state.mediaInfos:[]).filter(v=>v.content!==content&&at-v.at<15*60*1000).slice(-3);
      state.mediaInfos.push(item);
    }catch{} // Metadata observation must never cause a valid media response to fall back.
  }
  function report(state,at=Date.now()){
    const infos=(Array.isArray(state.mediaInfos)?state.mediaInfos:[]).filter(v=>v&&v.epoch===(Number(state.epoch)||0)&&at-v.at<15*60*1000&&
      /^[0-9a-f]{8}$/.test(v.content||'')&&['video','audio','unknown'].includes(v.type)&&
      [v.averageMbps,v.p90SegmentMbps,v.maxSegmentMbps,v.durationSeconds].every(n=>Number.isFinite(n)&&n>0)).slice(-4);
    if(!infos.length)return '码率需求：未知；合格既有响应尚未包含完整SIDX。小范围初始化通常放行，不额外取索引。';
    const speed=[1,1.25,1.5,2].includes(Number(state.playbackRate))?Number(state.playbackRate):1.5;
    return [`SIDX已见表示；诊断假设倍速 ${speed}（没有读取或改变 App 实际倍速）：`,
      ...infos.map(v=>`${v.content} / ${v.type}: 均值 ${v.averageMbps.toFixed(2)} Mbps，段p90 ${v.p90SegmentMbps.toFixed(2)} Mbps，均值×倍速 ${(v.averageMbps*speed).toFixed(2)} Mbps，索引段 ${v.segments}`),
      '仅已见表示的索引估计；当前表示未知，不含其他音视频表示、传输开销或缓冲余量，不能保证不卡顿。'].join('\n');
  }
  root.BiliRangeMedia={observe,report};
})(globalThis);

/* Aggregate request shapes only. No path, query, range offset, token or cookie values. */
(function (root) {
  'use strict';
  const VERSION = '0.1.11-experimental';
  const names = {
    internal: '内部请求', 'not-media-get': '暂不支持的媒体请求',
    'conditional-or-auth': '带条件或认证请求头', disabled: '实验下载已关闭',
    'unbounded-or-multiple-range': '开放或多段范围', 'no-range': '没有 Range',
    'small-range': '范围小于 256 KiB', 'large-range': '范围超过上限',
    'expired-or-expiring': '签名过期或即将过期', cooldown: '候选暂时冷却',
    busy: '已达到接管预算', transport: '子请求网络错误', 'entity-mismatch': '分块实体不一致',
    'budget-requests':'在途接管请求已满', 'budget-jobs':'全局子请求预算已满', 'budget-bytes':'缓冲字节预算已满',
    'redirect-untrusted': '重定向目标未通过校验', 'redirect-limit': '重定向循环或超过上限',
    'range-mismatch': '返回范围不符', 'length-mismatch': '返回长度不符',
    'encoded-body':'返回内容仍被编码', 'content-range':'返回总长度缺失或无效', 'content-length':'声明长度与实际不符', 'non-media':'返回非媒体内容',
  };
  function shape(request) {
    const h = root.BiliRange.headers(request.headers);
    const raw = h.range || '', parsed = root.BiliRange.parseRange(raw);
    let range = raw ? 'invalid' : 'absent';
    if (/^bytes=\d+-$/i.test(raw)) range = 'open-ended';
    else if (/^bytes=-\d+$/i.test(raw)) range = 'suffix';
    else if (raw.includes(',')) range = 'multiple';
    else if (parsed) range = parsed.length < 256 * 1024 ? 'under-256KiB' :
      parsed.length <= 2 * 1024 * 1024 ? '256KiB-2MiB' : parsed.length <= 4 * 1024 * 1024 ? '2-4MiB' :
      parsed.length <= 8 * 1024 * 1024 ? '4-8MiB' : 'over-8MiB';
    // Classify the authority only; never retain arbitrary host text.
    const authority = /^https?:\/\/([^/?#]+)/i.exec(request.url || '')?.[1]?.toLowerCase() || '';
    const source = authority.includes('.mcdn.bilivideo.cn') ? 'MCDN' :
      authority.endsWith('.akamaized.net') || authority.includes('.akamaized.net:') ? 'Akamai' :
      authority.startsWith('upos-') ? 'UPOS' : authority.startsWith('cn-hk-eq-') ? 'HK' : 'other';
    return { range, source };
  }
  function record(d, request, result) {
    d ||= {};
    d.accelerated ||= 0; d.passed ||= 0; d.reasons ||= {}; d.shapes ||= {}; d.sources ||= {};
    const s = shape(request);
    if(['total','etag','last-modified','content-type'].includes(result.metrics?.integrityField)){
      const fields=d.integrityFields ||= {},field=result.metrics.integrityField;fields[field]=(fields[field]||0)+1;
    }
    if(['malformed','source','host','credentials','downgrade','port','path-wrapper','path'].includes(result.metrics?.redirectField)){
      const fields=d.redirectFields ||= {},field=result.metrics.redirectField;fields[field]=(fields[field]||0)+1;
    }
    d.shapes[s.range] = (d.shapes[s.range] || 0) + 1;
    d.sources[s.source] = (d.sources[s.source] || 0) + 1;
    if (result.kind === 'response') {
      d.accelerated++; d.last = result.metrics;
      const mode = String(result.metrics.connections), stats = (d.modes ||= {});
      const m = stats[mode] ||= { requests: 0, bytes: 0, elapsedMs: 0 };
      m.requests++; m.bytes += result.metrics.bytes; m.elapsedMs += result.metrics.elapsedMs;
    } else { d.passed++; d.reasons[result.reason] = (d.reasons[result.reason] || 0) + 1; }
    return d;
  }
  function report(state) {
    const d = state.diagnostics || {}, reasons = Object.entries(d.reasons || {}).map(([k,v]) => `${names[k] || k}: ${v}`);
    return `版本 ${VERSION}\n接管 ${d.accelerated || 0} 次 / 放行 ${d.passed || 0} 次\n` +
      (reasons.join('\n') || '暂无请求') + '\n范围分布：' + JSON.stringify(d.shapes || {}) +
      '\n来源分类：' + JSON.stringify(d.sources || {}) + '\n最近传输：' + JSON.stringify(d.last || {}) +
      '\n并发记录：' + JSON.stringify(d.modes || {}) + '\n提示：不同视频的记录不能直接作为提速倍数。' +
      '\n实体校验拒绝字段：'+JSON.stringify(d.integrityFields||{})+
      '\n重定向拒绝类别：'+JSON.stringify(d.redirectFields||{})+
      (root.BiliRangeMeasurements?'\n\n'+root.BiliRangeMeasurements.report(state):'')+
      (root.BiliRangeMedia?'\n\n'+root.BiliRangeMedia.report(state):'')+
      '\n最近网络重置：'+JSON.stringify(state.lastNetworkReset||{});
  }
  root.BiliRangeDiagnostics = { VERSION, shape, record, report, allowedReasons:Object.keys(names) };
})(globalThis);

/* Standalone manual entry: never inspects $request or starts media downloads. */
(function () {
  'use strict';
  let state = {}, readError = false;
  try {
    const raw = $persistentStore.read('aijc123.BiliRange.lab.v1');
    state = JSON.parse(raw || '{}');
    if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
  } catch { readError = true; }
  let summary;
  try { summary = globalThis.BiliRangeDiagnostics.report(state); }
  catch { summary = '诊断统计格式异常，请将此提示发回聊天。'; }
  if (readError) summary += '\n本次无法读取本地统计，请将此提示发回聊天。';
  console.log(summary);
  if (typeof $notification !== 'undefined' && typeof $notification.post === 'function') {
    try { $notification.post('Bili Range 诊断', '点通知复制，或分享当前日志截图', summary, { clipboard: summary }); } catch {}
  }
  $done({ title: 'Bili Range 诊断', content: summary });
})();
