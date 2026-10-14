/* Opt-in, local media test. Reuses the BTR-backed validated Range downloader.
 * The one captured signed address stays local; reports contain no URL or IP. */
(function(root){
  'use strict';
  const KEY='aijc123.BiliRange.v1',CAPTURE=KEY+'.mediaCapture',LOCK=KEY+'.mediaBenchmarkLock';
  const MiB=1024*1024,TTL=120000;
  const read=(store,key)=>{try{return JSON.parse(store.read(key)||'null');}catch{return null;}};
  const save=(store,key,value)=>store.write(value===null?null:JSON.stringify(value),key)!==false;
  const epoch=state=>Number(state?.epoch)||0;
  const live=(value,at)=>value&&Number.isFinite(value.until)&&value.until>at;
  function capture(store,request,result,requestEpoch,currentEpoch,at=Date.now()){
    try{
      const value=read(store,CAPTURE);
      if(!value||!['armed','ready'].includes(value.phase))return;
      if(!live(value,at)||value.epoch!==currentEpoch){save(store,CAPTURE,null);return;}
      if(requestEpoch!==currentEpoch||result.kind!=='response')return;
      const plan=root.BiliRange.eligible(request,{maxBytes:4*MiB},at);
      if(plan.kind!=='eligible'||request.url.length>16384)return;
      const deadline=/(?:[?&])deadline=(\d+)(?:&|$)/.exec(plan.u.query);
      const until=Math.min(value.until,deadline?Number(deadline[1])*1000-80000:value.until);
      if(until<=at)return;
      const headers={Range:`bytes=${plan.range.start}-${Math.min(plan.range.end,plan.range.start+MiB-1)}`};
      if(value.phase==='ready'){
        const previous=root.BiliRange.parseRange(root.BiliRange.headers(value.headers).range);
        if(previous&&previous.length>=Math.min(plan.range.length,MiB))return;
      }
      for(const name of ['user-agent','referer','accept'])if(plan.h[name])headers[name]=plan.h[name].slice(0,512);
      save(store,CAPTURE,{phase:'ready',at,until,epoch:currentEpoch,url:request.url,headers,
        preferred:root.BiliRange.isTargetHost(result.metrics?.host)?result.metrics.host:null});
    }catch{} // A benchmark failure must never prevent ordinary playback.
  }
  function validSample(sample,state,at){
    if(sample?.phase!=='ready'||!live(sample,at)||!Number.isFinite(sample.at)||sample.at>at||at-sample.at>=TTL||
      sample.epoch!==epoch(state)||typeof sample.url!=='string'||sample.url.length>16384)return false;
    const plan=root.BiliRange.eligible({method:'GET',url:sample.url,headers:sample.headers},{maxBytes:MiB},at);
    return plan.kind==='eligible';
  }
  function plan(sample,random=Math.random){
    const source=root.BiliRange.parseURL(sample.url).host;
    const pool=[sample.preferred,'upos-sz-mirror08c.bilivideo.com','upos-sz-mirrorbos.bilivideo.com',
      'upos-sz-mirrorcos.bilivideo.com','upos-sz-mirrorhwo1.bilivideo.com'];
    const hosts=[...new Set(pool.filter(h=>root.BiliRange.isTargetHost(h)&&h!==source))].slice(0,4);
    const targets=[{host:source,original:true},...hosts.map(host=>({host,original:false}))];
    const tasks=[];
    const arms=targets.map(()=>random()<0.5?[1,8,8,1]:[8,1,1,8]);
    for(let slot=0;slot<4;slot++)for(let offset=0;offset<targets.length;offset++){
      // Keep the source first so its validated bytes are the content reference.
      const index=slot===0?offset:(offset+slot)%targets.length;
      tasks.push({...targets[index],connections:arms[index][slot],slot});
    }
    return tasks;
  }
  const sameBytes=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
  async function run({sample,store,client,now=Date.now,random=Math.random,progress=()=>{}}){
    const started=now(),initial=read(store,KEY)||{};
    if(!validSample(sample,initial,started))return {rows:[],stop:'sample-expired',elapsedMs:0};
    const request={method:'GET',url:sample.url,headers:sample.headers},tasks=plan(sample,random),rows=[];
    const fetch=root.BiliRangeHTTP.makeFetch(client,now);let reference,referenceTotal,referenceHost,referenceOriginal,stop='complete';
    for(const task of tasks){
      const state=read(store,KEY)||{},at=now();
      if(epoch(state)!==sample.epoch){stop='network-changed';break;}
      if(Object.keys(root.BiliRangeBudget.active(state.leases,at)).length){stop='playback-active';break;}
      if(at-started>=65000){stop='time-budget';break;}
      if(!validSample(sample,state,at)){stop='sample-expired';break;}
      const range=root.BiliRange.parseRange(root.BiliRange.headers(sample.headers).range);
      const lease='media-'+at.toString(36)+Math.random().toString(36).slice(2),hadLeases=Object.prototype.hasOwnProperty.call(state,'leases');
      const admission=root.BiliRangeBudget.admit({leases:state.leases,now:at,bytes:range.length,
        wanted:root.BiliRange.split(range,task.connections).length,globalJobs:32,id:lease});
      if(!admission.ok){stop='playback-active';break;}
      state.leases=admission.leases;
      if(!save(store,KEY,state)){stop='store-failed';break;}
      const placeholder='upos-sz-mirror08c.bilivideo.com';
      let result;
      try{result=await root.BiliRange.accelerate({request,state:{},now,options:{enabled:true,auto:false,
        hosts:[task.original?placeholder:task.host],connections:task.connections,minChunkKiB:128,maxBytes:MiB,timeout:2500,alpn:'h1'},
        // Source mode fetches the actual captured URL; the core still validates
        // every part and concatenation. Its temporary host score is never saved.
        fetchRange:options=>fetch(task.original?{...options,url:sample.url}:options)});
      }finally{
        const latest=read(store,KEY)||{};
        if(latest.leases?.[lease]){
          delete latest.leases[lease];
          if(!hadLeases&&!Object.keys(latest.leases).length)delete latest.leases;
          save(store,KEY,latest);
        }
      }
      let ok=result.kind==='response',reason=ok?'ok':result.reason;
      const completedState=read(store,KEY)||{};
      if(epoch(completedState)!==sample.epoch){ok=false;reason='network-changed';stop=reason;}
      else if(Object.keys(root.BiliRangeBudget.active(completedState.leases,now())).length){ok=false;reason='playback-active';stop=reason;}
      if(ok){
        const total=root.BiliRange.contentRange(root.BiliRange.headers(result.response.headers)['content-range']).total;
        if(!reference){reference=result.response.body;referenceTotal=total;referenceHost=task.host;referenceOriginal=task.original;}
        else if(total!==referenceTotal||!sameBytes(reference,result.response.body)){ok=false;reason='content-different';}
      }
      const allowed=['transport','redirect-untrusted','redirect-limit','entity-mismatch','range-mismatch','length-mismatch',
        'content-range','content-length','encoded-body','non-media','content-different','expired-or-expiring','network-changed','playback-active'];
      reason=ok?'ok':allowed.includes(reason)||/^status-\d{3}$/.test(reason||'')?reason:'failed';
      const metrics=result.metrics||{},elapsedMs=Math.max(1,now()-at);
      rows.push({host:task.host,original:task.original,configured:task.connections,actual:Number(metrics.connections)||0,
        bytes:ok?result.response.body.length:0,elapsedMs,ok,reason,slot:task.slot});
      progress(rows.length,tasks.length);
      if(stop!=='complete')break;
    }
    return {rows,planned:tasks.length,elapsedMs:now()-started,stop,at:now(),referenceHost,referenceOriginal,
      rangeBytes:root.BiliRange.parseRange(root.BiliRange.headers(sample.headers).range).length};
  }
  function report(data){
    const end={complete:'完成', 'network-changed':'网络变化，已停止', 'playback-active':'检测到播放接管，已停止',
      'time-budget':'达到时间预算', 'sample-expired':'样本已过期', 'store-failed':'预算保存失败，未继续下载'};
    const rows=data.rows||[],lines=[`Bili 媒体测速：${rows.length}/${data.planned||0} 次范围下载，${end[data.stop]||'已停止'}，${data.elapsedMs} ms`,
      `同一媒体、相同字节范围 ${data.rangeBytes||0} B；原地址及最多4个CDN，h1偏好，128 KiB分片下限。`,
      `逐字节参考：${data.referenceHost||'未取得有效响应'}（${data.referenceOriginal?'原地址':'仅CDN响应一致性；不是已验证的原地址基线'}）。媒体类型未确认，采样窗口优先保留最大已见范围。`,
      '请求完成耗时含DNS/连接/重定向/返回等待；不读取播放器缓冲，不修改DNS或自动选择。'];
    for(const host of [...new Set(rows.map(r=>r.host))])for(const configured of [1,8]){
      const group=rows.filter(r=>r.host===host&&r.configured===configured),good=group.filter(r=>r.ok);
      const middle=values=>root.BiliRangeMeasurements.quantile(values,0.5);
      const rate=good.length?middle(good.map(r=>r.bytes*8/r.elapsedMs/1000)).toFixed(2):'未知';
      const errors={};for(const r of group.filter(r=>!r.ok))errors[r.reason]=(errors[r.reason]||0)+1;
      lines.push(`${group[0]?.original?'原地址':'CDN'} ${host} / 配置${configured}路（实际${[...new Set(group.map(r=>r.actual))].join('/')||'未测'}）：成功${good.length}/${group.length}，中位${rate} Mbps，尝试耗时${group.length?middle(group.map(r=>r.elapsedMs)).toFixed(0):'未知'} ms，失败${JSON.stringify(errors)}`);
    }
    lines.push('每档最多2次，含缓存与时间噪音；原地址也是脚本下载，不等于原生App基线，不能证明无卡顿。',
      '这是当前路由的真实媒体Range测试；没有固定Cloudflare/Google返回IP，不能据此宣称某个DNS的视频吞吐更快。',
      '计划有效范围总量最多20 MiB；服务器忽略Range、重定向等异常可能增加实际流量。报告不包含媒体地址、签名或IP。');
    return lines.join('\n');
  }
  async function manual(store,client,now=Date.now){
    const at=now(),lock=read(store,LOCK),state=read(store,KEY)||{},sample=read(store,CAPTURE);
    if(live(lock,at))return 'Bili 媒体测速正在运行，请勿重复启动。';
    if(!validSample(sample,state,at)){
      if(sample?.phase==='armed'&&live(sample,at)&&sample.epoch===epoch(state))return '尚未采到合格媒体请求。请回B站播放或拖动进度产生新下载，5–10秒后暂停，再次运行「Bili 媒体测速」。';
      const ok=save(store,CAPTURE,{phase:'armed',at,until:at+TTL,epoch:epoch(state)});
      return ok?'已准备采样：回B站播放5–10秒，然后暂停，回Loon再次运行「Bili 媒体测速」。仅手动启用后临时保存一条本机媒体地址，2分钟过期，下次脚本操作清理；测速会下载最多20次范围，不上传地址、不改配置。':'采样准备失败：本地存储写入失败。';
    }
    if(Object.keys(root.BiliRangeBudget.active(state.leases,at)).length)return '请先暂停B站视频，等待5秒再运行 Bili 媒体测速。';
    const token=at.toString(36)+Math.random().toString(36).slice(2);
    if(!save(store,LOCK,{until:at+90000,token}))return '测速未开始：本地运行锁写入失败。';
    try{
      if(!save(store,CAPTURE,null))return '测速未开始：临时媒体地址清理失败。';
      return report(await run({sample,store,client,now,progress:(done,total)=>console.log(`Bili 媒体测速进度：${done}/${total}`)}));
    }finally{if(read(store,LOCK)?.token===token)save(store,LOCK,null);}
  }
  root.BiliRangeMediaBenchmark={capture,validSample,plan,run,report,manual,KEY,CAPTURE,LOCK};
})(globalThis);
