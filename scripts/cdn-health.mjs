// DNS / TLS reachability only. No media URL acquisition, video GET or speed ranking.
import {Resolver} from 'node:dns/promises';
import https from 'node:https';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const HOST=/^upos-sz-mirror[a-z0-9-]+\.bilivideo\.com$/;
const CODES=['ENOTFOUND','ENODATA','ETIMEOUT','ETIMEDOUT','ECANCELLED','ECONNRESET','ECONNREFUSED','ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE'];
const safeCode=error=>CODES.includes(error?.code)?error.code:'OTHER';
export async function dnsHealth(host){
 const resolver=new Resolver({timeout:1500,tries:1});
 const guard=setTimeout(()=>resolver.cancel(),2000),started=Date.now();
 try{
  const replies=await Promise.allSettled([resolver.resolve4(host),resolver.resolve6(host)]);
  const counts=replies.map(r=>r.status==='fulfilled'?r.value.length:0);
  return {elapsedMs:Date.now()-started,A:counts[0],AAAA:counts[1],ok:counts[0]+counts[1]>0,
   errors:replies.filter(r=>r.status==='rejected').map(r=>safeCode(r.reason))};
 }finally{clearTimeout(guard);}
}
export function tlsHealth(host){
 return new Promise(resolveResult=>{
  const started=Date.now();let ended=false,tlsMs=null,guard;
  const finish=value=>{if(ended)return;ended=true;clearTimeout(guard);resolveResult(value);};
  const req=https.request({hostname:host,path:'/',method:'HEAD',port:443,rejectUnauthorized:true,agent:false,
   headers:{'User-Agent':'Bilibili-Redirect-US-CDN-Health/1.0'}},res=>{
    finish({ok:true,elapsedMs:Date.now()-started,tlsMs,status:Number(res.statusCode)});res.destroy();
   });
  req.on('socket',socket=>socket.once('secureConnect',()=>{tlsMs=Date.now()-started;}));
  req.on('error',error=>finish({ok:false,elapsedMs:Date.now()-started,code:safeCode(error)}));
  guard=setTimeout(()=>req.destroy(Object.assign(Error('deadline'),{code:'ETIMEDOUT'})),3000);req.end();
 });
}
export async function collect(hosts,{dns=dnsHealth,tls=tlsHealth,now=Date.now,context='manual-development'}={}){
 if(!Array.isArray(hosts)||hosts.length>12||hosts.some(h=>typeof h!=='string'||!HOST.test(h)))throw Error('invalid-candidate-inventory');
 const queue=[...new Set(hosts)],rows=[];let cursor=0;
 async function worker(){
  while(cursor<queue.length){const host=queue[cursor++];
   let d,t;try{d=await dns(host);}catch(error){d={ok:false,code:safeCode(error)};}
   if(d.ok){try{t=await tls(host);}catch(error){t={ok:false,code:safeCode(error)};}}else t={ok:false,code:'DNS_UNAVAILABLE'};
   // Only fixed categorical / finite numerical fields are published, never error text or IPs.
   const number=n=>Number.isFinite(n)?n:null;
   rows.push({host,dns:{ok:d.ok===true,elapsedMs:number(d.elapsedMs),A:number(d.A),AAAA:number(d.AAAA)},
    tls:{ok:t.ok===true,elapsedMs:number(t.elapsedMs),tlsMs:number(t.tlsMs),status:number(t.status),
      code:t.ok?'HEAD_COMPLETED':CODES.includes(t.code)||t.code==='DNS_UNAVAILABLE'?t.code:'OTHER'},
    mediaUsable:'unknown',mediaMbps:null});
  }
 }
 await Promise.all([worker(),worker()]);
 return {schema:1,generatedAt:new Date(now()).toISOString(),context:context==='github-actions'?'github-actions':'manual-development',
  scope:'DNS and validated TLS/HEAD from this runner only; not phone media throughput. HTTP403 still means media usability unknown.',
  changesPlaybackDefault:false,mediaBenchmarkAvailable:false,rows:rows.sort((a,b)=>a.host.localeCompare(b.host))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const inventory=JSON.parse(readFileSync('data/cdn-candidates.json','utf8'));
 const snapshot=await collect(inventory.hosts,{context:process.env.CDN_PROBE_CONTEXT});
 writeFileSync('data/cdn-health.json',JSON.stringify(snapshot,null,2)+'\n');
 console.log(JSON.stringify({hosts:snapshot.rows.length,dnsOK:snapshot.rows.filter(r=>r.dns.ok).length,
  tlsOK:snapshot.rows.filter(r=>r.tls.ok).length,mediaBenchmarkAvailable:false,changesPlaybackDefault:false}));
}
