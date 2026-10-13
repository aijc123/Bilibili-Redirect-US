(async function(){
 let text='电脑中转未配置或不可达；此原型需要同 Wi-Fi 下的电脑服务。';
 const arg=typeof $argument==='object'&&$argument?$argument:{},c=globalThis.BiliGateway.config(arg);
 if(c){const data=await globalThis.BiliGateway.probe($httpClient,c,'/stats');
  if(data&&/^0\.1\.\d+(?:-experimental)?$/.test(data.version||'')){
   const n=value=>Number.isFinite(value)&&value>=0?value:0,last=data.last;
   text='电脑中转 '+data.version+'\n完成 '+n(data.completed)+' / 失败 '+n(data.failed)+' / 取消 '+n(data.cancelled)+
    '\n当前请求 '+n(data.activeRequests)+' / 上游任务 '+n(data.activeJobs)+' / 排队 '+n(data.queuedJobs);
   text+='\n连接复用 '+n(data.reusedRequests)+' / 空闲连接 '+n(data.idleConnections)+' / 连接池排队 '+n(data.agentQueuedJobs)+
    '\nDNS查询 '+n(data.dnsQueries)+' / 缓存命中 '+n(data.dnsCacheHits)+' / 合并等待 '+n(data.dnsCoalesced)+' / 失败 '+n(data.dnsFailures);
   if(last&&/^upos-[a-z0-9-]+\.(?:bilivideo\.com|akamaized\.net)$/.test(last.host||'')){
    text+='\n最近选择：'+last.host+'，'+n(last.bytes)+' 字节，首次写出 '+n(last.firstByteMs)+' ms，总耗时 '+n(last.elapsedMs)+' ms，'+n(last.pieces)+' 分片';
    if(Array.isArray(last.upstreamHosts))text+='\n实际上游：'+last.upstreamHosts.slice(0,32).filter(h=>/^[a-z0-9-]+\.(?:bilivideo\.com|akamaized\.net)$/.test(h)).join(', ')+'，跳转 '+n(last.redirects);
   }
   text+='\n仅电脑写出与上游任务统计，不等于手机收到的速度或播放器缓冲。';
  }
 }
 console.log(text);
 if(typeof $notification!=='undefined')try{$notification.post('Bili 电脑中转诊断','点通知复制摘要',text,{clipboard:text});}catch{}
 $done({title:'Bili 电脑中转诊断',content:text});
})();
