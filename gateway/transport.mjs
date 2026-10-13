// Persistent validated HTTP/1 transport. URLs stay in this process, never logged.
import http from 'node:http';
import https from 'node:https';
import {lookup} from 'node:dns';
import {once} from 'node:events';
import {range,Semaphore,inspectRedirect} from './btr.mjs';
const HOST=/^(?:upos-(?:sz|hz|bstar1)-[a-z0-9-]+\.bilivideo\.com|cn-hk-eq-[a-z0-9-]+\.bilivideo\.com|upos-(?:sz|hz|bstar1)-mirrorakam\.akamaized\.net)$/;
export function mediaURL(value){
 if(typeof value!=='string'||value.length>8192||/[\s\\]/.test(value))throw Error('unsupported-media-url');
 let u;try{u=new URL(value);}catch{throw Error('unsupported-media-url');}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.hash||!HOST.test(u.hostname)||
  !/^\/upgcxcode\/[^?#]+$/.test(u.pathname)||u.port&&!['80','443','4483'].includes(u.port))throw Error('unsupported-media-url');
 const deadline=u.searchParams.get('deadline');if(deadline&&/^\d+$/.test(deadline)&&Number(deadline)*1000<Date.now()+15000)throw Error('expiring-media-url');
 return u;
}
export function makeTransport({threads=16,dial}={}){
 const limit=[4,8,16,32].includes(threads)?threads:16,slots=new Semaphore(limit),cache=new Map();
 const cachedLookup=(host,options,callback)=>{
  const key=host+'|'+String(options.family||0),known=cache.get(key);
  const answer=records=>{if(options.all)callback(null,records);else callback(null,records[0].address,records[0].family);};
  if(known&&Date.now()-known.at<60000){queueMicrotask(()=>answer(known.records));return;}
  lookup(host,{...options,all:true},(error,records)=>{if(error||!records?.length){callback(error||Error('dns'));return;}
   if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(key,{at:Date.now(),records});answer(records);});
 };
 const agentOptions={keepAlive:true,maxSockets:limit,maxTotalSockets:limit,maxFreeSockets:limit,lookup:cachedLookup};
 const agents={http:new http.Agent(agentOptions),https:new https.Agent(agentOptions)};
 async function open(url,part,{headers={},signal}={}){
  let parsed=mediaURL(url);
  const release=await slots.acquire(signal,0,Infinity,part.priority===0?0:2,true);let freed=false;
  const free=()=>{if(!freed){freed=true;release();}};
  const hop=()=>new Promise((resolve,reject)=>{
   if(signal?.aborted){free();reject(Error('cancelled'));return;}
   const target=parsed,secure=target.protocol==='https:',api=secure?https:http;
   const createRequest=dial?((u,o,cb)=>dial(u,o,cb)):((u,o,cb)=>api.request(u,o,cb));
   let request;try{request=createRequest(target,{method:'GET',agent:agents[secure?'https':'http'],signal,rejectUnauthorized:true,highWaterMark:65536,
    headers:{...headers,Range:`bytes=${part.start}-${part.end}`,'Accept-Encoding':'identity'}},response=>{
     response.pause();response.on('error',()=>{});
     resolve({status:response.statusCode,headers:response.headers,stream:response,free});
    });}catch{free();reject(Error('upstream-network'));return;}
   request.on('error',()=>{
    if(!signal?.aborted)for(const key of cache.keys())if(key.startsWith(target.hostname+'|'))cache.delete(key);
    reject(Error(signal?.aborted?'cancelled':'upstream-network'));
   });request.end();
  });
  try{
   for(let redirects=0;redirects<=2;redirects++){
    const result=await hop();
    if(![301,302,303,307,308].includes(Number(result.status))){result.stream.once('end',free);result.stream.once('close',free);return {...result,upstreamHost:parsed.hostname,redirects};}
    const inspected=inspectRedirect(parsed.href,result.headers?.location);result.stream.destroy();
    if(!inspected.url)throw Error('redirect-untrusted');
    if(redirects===2||inspected.url===parsed.href)throw Error('redirect-limit');
    // inspectRedirect has already enforced the trusted host/path/port/TLS gate.
    parsed=new URL(inspected.url);
   }
  }catch(error){free();throw error;}
 }
 return {open,slots,stats:()=>({activeJobs:slots.active,queuedJobs:slots.queue.length}),close(){agents.http.destroy();agents.https.destroy();cache.clear();}};
}
function checked(response,part,canonical){
 const h=response.headers||{},cr=range.parseContentRange(h['content-range']);
 if(Number(response.status)!==206)throw Object.assign(Error('upstream-status'),{status:Number(response.status)});
 if(!cr||cr.total===null||cr.start!==part.start||cr.end!==part.end)throw Error('upstream-range');
 if(h['content-encoding']&&h['content-encoding']!=='identity')throw Error('encoded-body');
 if(h['content-length']&&Number(h['content-length'])!==part.end-part.start+1)throw Error('upstream-length');
 if(/^(?:text\/|application\/(?:json|xml))/i.test(h['content-type']||''))throw Error('non-media');
 const value={total:cr.total,etag:h.etag,modified:h['last-modified'],type:h['content-type']};
 if(canonical&&Object.keys(value).some(key=>canonical[key]!==value[key]))throw Error('entity-mismatch');
 return value;
}
export async function streamRange({url,requested,connections=8,minChunkKiB=128,transport,response,controller,headers={}}){
 const count=[1,2,4,8,16,32].includes(connections)?connections:8,floor=[32,64,128].includes(minChunkKiB)?minChunkKiB:128;
 const parts=range.splitRange(requested.start,requested.end,count,floor*1024),hosts=new Set();let canonical,bytes=0,firstByteMs=null,redirects=0;
 const started=Date.now();
 // Attach failure handlers immediately; out-of-order errors never become unhandled promises.
 const pending=parts.map((part,index)=>transport.open(url,{...part,priority:index===0?0:2},{headers,signal:controller.signal}).then(value=>{
  return {ok:true,value};},error=>({ok:false,error})));
 try{
  for(let i=0;i<parts.length;i++){
   const next=await pending[i];if(!next.ok)throw next.error;
   const current=next.value,part=parts[i];canonical=checked(current,part,canonical);
   if(current.upstreamHost)hosts.add(current.upstreamHost);redirects+=current.redirects||0;
   let received=0;
   for await(const chunk of current.stream){
    if(controller.signal.aborted)throw Error('cancelled');
    if(received+chunk.length>part.end-part.start+1)throw Error('upstream-length');
    if(!chunk.length)continue;
    // Until the first validated byte exists, another node can still be tried.
    if(!response.headersSent){
     const h={'Content-Type':canonical.type||'application/octet-stream','Content-Range':`bytes ${requested.start}-${requested.end}/${canonical.total}`,
      'Content-Length':String(requested.length),'Accept-Ranges':'bytes','Cache-Control':'no-store'};
     if(canonical.etag)h.ETag=canonical.etag;if(canonical.modified)h['Last-Modified']=canonical.modified;
     response.writeHead(206,h);
    }
    received+=chunk.length;bytes+=chunk.length;if(firstByteMs===null)firstByteMs=Date.now()-started;
    if(!response.write(chunk))await once(response,'drain',{signal:controller.signal});
   }
   if(received!==part.end-part.start+1)throw Error('upstream-length');
   current.free?.();
  }
  if(bytes!==requested.length)throw Error('upstream-length');response.end();
  return {bytes,firstByteMs,elapsedMs:Date.now()-started,pieces:parts.length,upstreamHosts:[...hosts].sort(),redirects};
 }catch(error){throw Object.assign(Error(['cancelled','upstream-network','upstream-status','upstream-range','encoded-body','upstream-length','non-media','entity-mismatch','redirect-untrusted','redirect-limit'].includes(error?.message)?error.message:'upstream-failed'),
  {receivedBytes:bytes,...(Number.isFinite(error?.status)?{status:error.status}:{})});
 }finally{
  if(!response.writableEnded)controller.abort();
  const all=await Promise.all(pending);for(const item of all)if(item.ok){if(!item.value.stream.readableEnded)item.value.stream.destroy();item.value.free?.();}
 }
}
