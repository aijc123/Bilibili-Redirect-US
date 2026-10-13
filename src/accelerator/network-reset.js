/* Observable, isolated network epoch reset. No media downloads or notifications. */
(function () {
  'use strict';
  const KEY='aijc123.BiliRange.v1';
  let state={};
  try{state=JSON.parse($persistentStore.read(KEY)||'{}');}catch{}
  if(!state||typeof state!=='object'||Array.isArray(state))state={};
  const count=Object.keys(state.hosts||{}).length,epoch=Number(state.epoch)||0;
  state.hosts={};state.epoch=epoch+1;state.lastNetworkReset={at:Date.now(),clearedHosts:count,epoch:state.epoch};
  // Keep in-flight leases so a network reset cannot silently double the socket budget.
  const saved=$persistentStore.write(JSON.stringify(state),KEY);
  const message=saved===false?'Bili Range 网络变化未完成：本地写入失败\n未保存新的网络轮次或清除评分，请重试。':
    `Bili Range 网络变化处理完成\n网络epoch ${epoch} → ${state.epoch}\n清除 CDN 评分 ${count} 项\n在途租约保留，旧请求不会复活旧评分\n写入：已提交`;
  console.log(message);
  const finish=content=>$done({title:'Bili Range 网络变化',content});
  let arg=typeof $argument==='object'&&$argument?$argument:{};
  if(typeof $argument==='string')try{arg=JSON.parse($argument);}catch{}
  if(!arg||typeof arg!=='object'||Array.isArray(arg))arg={};
  if(saved===false||arg.Enabled===false||arg.WarmDNS!==true){finish(message);return;}
  if(typeof $dns==='undefined'||typeof $dns.query!=='function'){const skipped='DNS预热未执行：当前运行环境没有DNS API。';console.log(skipped);finish(message+'\n'+skipped);return;}
  const hosts=globalThis.BiliRangeCandidates.pool(arg.PreferredCDN,arg.CDNGroup).slice(0,4);
  let cursor=0,success=0,cached=0;const started=Date.now();
  const query=host=>new Promise(resolve=>{
    try{$dns.query({domain:host,timeout:1500},(error,result)=>{
      const valid=!error&&Array.isArray(result?.answers)&&result.answers.some(r=>r&&['A','AAAA'].includes(r.type));
      if(valid)success++;if(valid&&result.fromCache===true)cached++;resolve();
    });}catch{resolve();}
  });
  const worker=async()=>{while(cursor<hosts.length)await query(hosts[cursor++]);};
  Promise.all([worker(),worker()]).then(()=>{
    const warm={attempted:hosts.length,success,cached,elapsedMs:Date.now()-started};
    try{const latest=JSON.parse($persistentStore.read(KEY)||'{}');if(latest.epoch===state.epoch&&latest.lastNetworkReset){latest.lastNetworkReset.warm=warm;$persistentStore.write(JSON.stringify(latest),KEY);}}catch{}
    const summary=`DNS预热 ${success}/${hosts.length}，缓存命中 ${cached}，耗时 ${warm.elapsedMs} ms；未修改DNS配置，未下载视频。`;
    console.log(summary);finish(message+'\n'+summary);
  }).catch(()=>finish(message+'\nDNS预热失败，网络轮次重置已提交。'));
})();
