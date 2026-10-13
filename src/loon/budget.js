/* Best-effort admission across Loon script contexts. The store has no atomic CAS.
 * Counts HTTP jobs, not guaranteed physical TCP sockets (HTTP/2 may multiplex). */
(function(root){
  'use strict';
  const integer=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Math.floor(Number(value)))):fallback;
  function active(raw,now){
    const out={};
    for(const [id,value] of Object.entries(raw||{})){
      // Accept old numeric leases conservatively during an update.
      const v=typeof value==='number'?{expires:value,jobs:4,bytes:4*1024*1024}:value;
      if(v&&Number.isFinite(v.expires)&&v.expires>now&&v.expires<=now+10000)
        out[id]={expires:v.expires,jobs:integer(v.jobs,32,1,32),bytes:integer(v.bytes,8*1024*1024,1,8*1024*1024)};
    }
    return out;
  }
  function admit({leases,now,bytes,wanted,globalJobs=16,maxRequests=4,maxBufferedBytes=4*1024*1024,id}){
    const live=active(leases,now),values=Object.values(live);
    const jobs=values.reduce((n,v)=>n+v.jobs,0),buffered=values.reduce((n,v)=>n+v.bytes,0);
    const limit=integer(globalJobs,16,4,32),requests=integer(maxRequests,4,1,4);
    const memory=integer(maxBufferedBytes,4*1024*1024,1024*1024,8*1024*1024);
    const count=Math.min(integer(wanted,4,1,32),limit-jobs);
    let reason;
    if(values.length>=requests)reason='budget-requests';
    else if(buffered+bytes>memory)reason='budget-bytes';
    else if(count<Math.min(2,wanted))reason='budget-jobs';
    if(reason)return {ok:false,reason,leases:live,jobs,buffered};
    live[id]={expires:now+8000,jobs:count,bytes};
    return {ok:true,leases:live,count,inflight:values.length,jobs:jobs+count,buffered:buffered+bytes};
  }
  root.BiliRangeBudget={active,admit};
})(globalThis);
