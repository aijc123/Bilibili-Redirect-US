/* Manual DNS-only evidence. No media GET, private resolver logging, or config mutation. */
(function(root){
  'use strict';
  const HOSTS=['upos-sz-mirrorhwo1.bilivideo.com','upos-sz-mirror08c.bilivideo.com','upos-sz-mirrorhw.bilivideo.com','upos-sz-mirrorali.bilivideo.com'];
  const RESOLVERS=[{label:'当前Loon',protocol:'auto'},{label:'Cloudflare DoH',protocol:'doh',server:'https://cloudflare-dns.com/dns-query'},
    {label:'Google DoH',protocol:'doh',server:'https://dns.google/dns-query'}];
  const CODES=['INVALID_ARGUMENT','UNSUPPORTED_PROTOCOL','INVALID_SERVER','TIMEOUT','NO_ANSWER','QUERY_FAILED','UNAVAILABLE','TUNNEL_UNAVAILABLE'];
  async function run(query,now=Date.now){
    const started=now(),tasks=[],rows=[];let cursor=0;
    for(let round=0;round<2;round++)for(let h=0;h<HOSTS.length;h++)for(let r=0;r<RESOLVERS.length;r++)
      tasks.push({round:round+1,host:HOSTS[h],resolver:RESOLVERS[(r+round+h)%RESOLVERS.length]});
    async function worker(){
      while(cursor<tasks.length&&now()-started<12000){
        const task=tasks[cursor++],from=now();let answer;
        try{answer=await query({domain:task.host,protocol:task.resolver.protocol,...(task.resolver.server?{server:task.resolver.server}:{}),timeout:1500});}
        catch{answer={error:{code:'QUERY_FAILED'}};}
        const records=Array.isArray(answer?.result?.answers)?answer.result.answers:[];
        const counts={A:0,AAAA:0,CNAME:0};
        for(const record of records)if(record&&Object.prototype.hasOwnProperty.call(counts,record.type))counts[record.type]++;
        const error=answer?.error;
        rows.push({host:task.host,resolver:task.resolver.label,round:task.round,elapsedMs:Math.max(1,now()-from),
          cached:answer?.result?.fromCache===true,ok:!error&&counts.A+counts.AAAA>0,
          code:error?(CODES.includes(error.code)?error.code:'QUERY_FAILED'):counts.A+counts.AAAA?'OK':'NO_ANSWER',counts});
      }
    }
    await Promise.all([worker(),worker(),worker()]);
    return {at:now(),elapsedMs:now()-started,planned:tasks.length,completed:rows.length,skipped:tasks.length-rows.length,rows};
  }
  function report(data){
    const lines=[`Bili DNS 诊断：${data.completed}/${data.planned} 查询，未开始 ${data.skipped}，总耗时 ${data.elapsedMs} ms`,
      '只查询4个公开CDN域名；并发最多3；不修改全局DNS、不清空缓存、不下载视频。'];
    for(const host of HOSTS)for(const resolver of RESOLVERS){
      const rows=data.rows.filter(r=>r.host===host&&r.resolver===resolver.label),uncached=rows.filter(r=>r.ok&&!r.cached);
      const cached=rows.filter(r=>r.cached).length,errors=rows.filter(r=>!r.ok).map(r=>r.code);
      lines.push(`${host} / ${resolver.label}: 非缓存成功 ${uncached.length}，耗时 ${uncached.length?uncached.map(r=>r.elapsedMs+'ms').join(','):'未知'}，缓存 ${cached}，错误 ${errors.join(',')||'无'}，A/AAAA ${rows.map(r=>r.counts.A+'/'+r.counts.AAAA).join(',')||'无'}`);
    }
    lines.push('仅2轮，不能稳定排名；缓存与首次DoH握手影响结果，查询可能填充DNS缓存。',
      'DNS查询快不等于视频下载快；没有测试返回IP的HTTPS媒体吞吐，不能据此自动切换DNS或CDN。');
    return lines.join('\n');
  }
  root.BiliRangeDNS={run,report};
})(globalThis);

(function(){
  'use strict';
  if(typeof $done==='undefined')return;
  const finish=summary=>{
    console.log(summary);
    if(typeof $notification!=='undefined'&&typeof $notification.post==='function')try{$notification.post('Bili DNS 诊断','点通知复制摘要',summary,{clipboard:summary});}catch{}
    $done({title:'Bili DNS 诊断',content:summary});
  };
  if(typeof $dns==='undefined'||typeof $dns.query!=='function'){finish('Bili DNS 诊断不可用：需要 Loon Build 988+，并在支持DNS查询的 Tunnel 运行环境执行。');return;}
  const query=options=>new Promise(resolve=>$dns.query(options,(error,result)=>resolve({error,result})));
  globalThis.BiliRangeDNS.run(query).then(data=>finish(globalThis.BiliRangeDNS.report(data)))
    .catch(()=>finish('Bili DNS 诊断执行失败；未修改DNS设置。'));
})();
