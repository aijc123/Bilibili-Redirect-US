/* Aggregate request shapes only. No path, query, range offset, token or cookie values. */
(function (root) {
  'use strict';
  const VERSION = '0.1.14-experimental';
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
  function record(d, request, result,context={}) {
    d ||= {};
    d.accelerated ||= 0; d.passed ||= 0; d.reasons ||= {}; d.shapes ||= {}; d.sources ||= {};
    const s = shape(request);
    if(['bili-akamai','bili-mcdn','bili-other','external'].includes(result.metrics?.redirectFamily)){
      const families=d.redirectFamilies ||= {},family=result.metrics.redirectFamily;families[family]=(families[family]||0)+1;
    }
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
    const at=Date.now(),epoch=Number.isSafeInteger(context.epoch)?context.epoch:0,p=context.policy;
    const reason=Object.prototype.hasOwnProperty.call(names,result.reason)||/^status-\d{3}$/.test(result.reason||'')?result.reason:'other';
    d.events=(Array.isArray(d.events)?d.events:[]).filter(e=>e&&Number.isFinite(e.at)&&e.at<=at&&at-e.at<15*60*1000&&
      ['response','pass'].includes(e.kind)&&(Object.prototype.hasOwnProperty.call(names,e.reason)||/^status-\d{3}$/.test(e.reason||'')||['other','ok'].includes(e.reason)))
      .map(e=>({at:e.at,epoch:Number.isSafeInteger(e.epoch)?e.epoch:0,kind:e.kind,reason:e.reason})).slice(-119);
    d.events.push({at,epoch,kind:result.kind==='response'?'response':'pass',reason:result.kind==='response'?'ok':reason});
    if(p&&['automatic','advanced'].includes(p.profile))d.writer={version:VERSION,at,epoch,profile:p.profile,
      connections:[1,2,4,6,8,16,32].includes(p.options?.connections)?p.options.connections:0,
      minChunkKiB:[32,64,128].includes(p.options?.minChunkKiB)?p.options.minChunkKiB:128,
      reason:['baseline','load','network-errors','manual'].includes(p.reason)?p.reason:'baseline',
      count:d.accelerated+d.passed};
    return d;
  }
  function summary(state,at=Date.now()){
    const d=state.diagnostics||{},writer=d.writer,w=root.BiliRangeMeasurements?.analyze(state,at).window;
    const age=time=>Number.isFinite(time)&&time<=at?Math.round((at-time)/1000)+'秒前':'未知';
    const lines=[`Bili Range 自动诊断 ${VERSION}`,`累计接管 ${count(d.accelerated)} 次 / 放行 ${count(d.passed)} 次（包含升级前记录）`];
    if(writer&&/^0\.1\.\d+-experimental$/.test(writer.version||'')&&['automatic','advanced'].includes(writer.profile)){
      lines.push(`最近已标记请求脚本：${writer.version} / ${writer.profile==='automatic'?'自动':'对照工具'} / ${age(writer.at)}`);
      lines.push(`调度：上限${[1,2,4,6,8,16,32].includes(writer.connections)?writer.connections:'未知'}路，${[32,64,128].includes(writer.minChunkKiB)?writer.minChunkKiB:128} KiB下限；${({baseline:'常规',load:'在途负载收缩','network-errors':'近期网络错误收缩',manual:'手动对照'})[writer.reason]||'未知'}`);
      if(writer.count!==count(d.accelerated)+count(d.passed))lines.push('此后存在未标记版本的计数写入；可能有旧脚本或并行写入，版本标记不证明没有插件冲突。');
    }else lines.push('尚未收到带版本标记的新请求；诊断脚本更新不等于下载脚本已经生效。');
    const events=(Array.isArray(d.events)?d.events:[]).filter(e=>e&&e.epoch===(Number(state.epoch)||0)&&Number.isFinite(e.at)&&e.at<=at&&at-e.at<=30000),reasons={};
    for(const e of events)if(e.kind==='pass'&&(Object.prototype.hasOwnProperty.call(names,e.reason)||/^status-\d{3}$/.test(e.reason||'')))reasons[e.reason]=(reasons[e.reason]||0)+1;
    lines.push(`最近30秒事件记录：${events.length}条（最多保留120条）；放行原因：${Object.entries(reasons).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k,v])=>(names[k]||k)+' '+v).join('，')||'暂无'}`);
    if(w?.n){
      lines.push(`完成接管尝试：成功${w.success} / 失败${w.failed}；交付率 ${w.deliveryMbps===null?'未知':w.deliveryMbps.toFixed(2)} Mbps（仅接管流量）`);
      if(w.failed)lines.push('失败类别：'+Object.entries(w.failureReasons).map(([k,v])=>(names[k]||k)+' '+v).join('，'));
      if(w.n<8)lines.push('近期样本不足，不能判断提速或卡顿改善。');
    }else lines.push('最近30秒没有完成的接管尝试，当前速度未知；可能已缓冲、停止播放或主要是直接放行的小请求。');
    const last=d.last||{};
    if(root.BiliRange.isTargetHost(last.host)&&Number.isFinite(last.bytes)&&Number.isFinite(last.elapsedMs))
      lines.push(`最近成功：${last.host}；${Math.round(last.bytes/1024)} KiB / ${last.elapsedMs} ms；实际分片${[1,2,3,4,5,6,7,8,16,32].includes(last.connections)?last.connections:'未知'}；${age(last.finishedAt)}`);
    lines.push('小请求直接放行是正常策略，不等于下载失败。无法读取App实际清晰度、倍速、缓冲和卡顿次数；旧SIDX不能代表当前播放。',
      '反馈方法：保持同视频和清晰度，播放30–60秒后立即运行诊断；注明清晰度、倍速及是首开慢还是播放中卡顿。');
    return lines.join('\n');
  }
  function report(state) {
    const d = state.diagnostics || {}, reasons = Object.entries(d.reasons || {}).map(([k,v]) => `${names[k] || k}: ${v}`);
    return `版本 ${VERSION}\n接管 ${d.accelerated || 0} 次 / 放行 ${d.passed || 0} 次\n` +
      (reasons.join('\n') || '暂无请求') + '\n范围分布：' + JSON.stringify(d.shapes || {}) +
      '\n来源分类：' + JSON.stringify(d.sources || {}) + '\n最近传输：' + JSON.stringify(d.last || {}) +
      '\n并发记录：' + JSON.stringify(d.modes || {}) + '\n提示：不同视频的记录不能直接作为提速倍数。' +
      '\n实体校验拒绝字段：'+JSON.stringify(d.integrityFields||{})+
      '\n重定向拒绝类别：'+JSON.stringify(d.redirectFields||{})+
      '\n重定向拒绝域族：'+JSON.stringify(d.redirectFamilies||{})+'（固定分类，不保存Location；旧记录未知）'+
      (root.BiliRangeMeasurements?'\n\n'+root.BiliRangeMeasurements.report(state):'')+
      (root.BiliRangeMedia?'\n\n'+root.BiliRangeMedia.report(state):'')+
      (root.BiliRangeTrials?.safetyReport(state)?'\n\n'+root.BiliRangeTrials.safetyReport(state):'')+
      '\n最近网络重置：'+JSON.stringify(state.lastNetworkReset||{});
  }
  const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
  function snapshot(state,at=Date.now()){
    const d=state.diagnostics||{},reasons={};
    for(const [key,value] of Object.entries(d.reasons||{}))if(Object.prototype.hasOwnProperty.call(names,key)||/^status-\d{3}$/.test(key))reasons[key]=count(value);
    return {version:VERSION,epoch:count(state.epoch),at,accelerated:count(d.accelerated),passed:count(d.passed),reasons};
  }
  function deltaReport(current,previous){
    if(!previous||previous.version!==VERSION||previous.epoch!==current.epoch||!Number.isFinite(previous.at)||previous.at>=current.at||current.at-previous.at>24*60*60*1000||
      !Number.isSafeInteger(previous.accelerated)||!Number.isSafeInteger(previous.passed)||previous.accelerated<0||previous.passed<0||
      current.accelerated<previous.accelerated||current.passed<previous.passed)return '本次建立手动诊断对照起点；下次显示同版本、同网络轮次的新增计数。';
    const reasons=[];
    for(const [key,value] of Object.entries(current.reasons)){
      const before=count(previous.reasons?.[key]);if(value<before)return '累计计数已重置；本次重新建立手动诊断对照起点。';
      if(value>before)reasons.push((names[key]||key)+': '+(value-before));
    }
    return `自上次手动诊断 ${Math.round((current.at-previous.at)/1000)} 秒：新增接管 ${current.accelerated-previous.accelerated} / 放行 ${current.passed-previous.passed}\n新增原因：${reasons.join('，')||'无'}\n计数差不是测速，也不含播放器卡顿计数。`;
  }
  root.BiliRangeDiagnostics = { VERSION, shape, record, report,summary,snapshot,deltaReport,allowedReasons:Object.keys(names) };
})(globalThis);
