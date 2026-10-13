// Optional self-hosted prototype. Default CLI binding is loopback, not a LAN service.
import http from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {range,cdn} from './btr.mjs';
import {mediaURL,makeTransport,streamRange} from './transport.mjs';
const VERSION='0.1.0-experimental',SERVICE='aijc123-bili-range-gateway';
const HOST=/^upos-sz-mirror[a-z0-9-]+\.bilivideo\.com$/;
const DEFAULTS=['upos-sz-mirror08c.bilivideo.com','upos-sz-mirrorhwo1.bilivideo.com','upos-sz-mirrorhw.bilivideo.com','upos-sz-mirrorali.bilivideo.com'];
const digest=value=>createHash('sha256').update(value).digest();
export function createGateway({token,threads=16,connections=8,minChunkKiB=128,transport,timeoutMs=8000}={}){
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{24,128}$/.test(token))throw Error('A private 24+ character token is required');
 const tokenHash=digest(token),upstream=transport||makeTransport({threads});
 const transfers=new Set(),routes=new Map();let declared=0;
 const stats={version:VERSION,completed:0,failed:0,cancelled:0,acceptedBytes:0,activeRequests:0,peakRequests:0,last:null};
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const authenticated=req=>{const supplied=req.headers['x-bili-gateway-token'];return typeof supplied==='string'&&supplied.length<=128&&timingSafeEqual(tokenHash,digest(supplied));};
 const snapshot=()=>({...stats,...upstream.stats?.(),scope:'Server writes and upstream jobs only; not App playback/buffer/actual Wi-Fi delivery'});
 const server=http.createServer({maxHeaderSize:32768},async(req,res)=>{
  res.on('error',()=>{});
  try{
  if(!authenticated(req)){json(res,401,{error:'authentication-required'});return;}
  if(req.method!=='GET'){json(res,405,{error:'method'});return;}
  if(!req.url?.startsWith('/')||req.url.startsWith('//')||req.url.length>32768){json(res,400,{error:'request'});return;}
  const input=new URL(req.url,'http://localhost');
  if(input.pathname==='/health'){json(res,200,{service:SERVICE,version:VERSION,ready:transfers.size<4&&declared<8*1024*1024});return;}
  if(input.pathname==='/stats'){json(res,200,snapshot());return;}
  if(input.pathname!=='/range'){json(res,404,{error:'endpoint'});return;}
  let source,requested;
  try{
   if(req.headers.cookie||req.headers.authorization||Object.keys(req.headers).some(h=>h.startsWith('if-')))throw Error('unsupported-headers');
   source=mediaURL(input.searchParams.get('source'));requested=range.parseRangeHeader(req.headers.range);
   if(!requested||!Number.isSafeInteger(requested.length)||requested.length>8*1024*1024)throw Error('unsupported-range');
  }catch{json(res,400,{error:'unsupported-media-or-range'});return;}
  if(transfers.size>=4||declared+requested.length>8*1024*1024){json(res,503,{error:'request-budget'});return;}
  const preferred=input.searchParams.get('cdn'),hosts=HOST.test(preferred||'')?[preferred,...DEFAULTS.filter(h=>h!==preferred)]:DEFAULTS;
  const routeKey=createHash('sha256').update(source.href+'|'+hosts.join(',')).digest('hex');
  for(const [key,item] of routes)if(Date.now()-item.at>15*60*1000)routes.delete(key);
  let item=routes.get(routeKey);
  if(!item){if(routes.size>=16)routes.delete(routes.keys().next().value);
   const bans=cdn.createBanList();item={at:Date.now(),resolver:cdn.createResolver({baseUrl:source.href},()=> 'custom',bans,()=>hosts)};routes.set(routeKey,item);}
  item.at=Date.now();
  const parent=new AbortController();transfers.add(parent);declared+=requested.length;
  stats.activeRequests=transfers.size;stats.peakRequests=Math.max(stats.peakRequests,transfers.size);
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;parent.abort();},Math.max(1000,Math.min(15000,timeoutMs)));
  res.on('close',()=>{if(!res.writableFinished)parent.abort();});req.on('aborted',()=>parent.abort());
  const safeHeaders={};for(const name of ['user-agent','referer','accept'])if(typeof req.headers[name]==='string')safeHeaders[name]=req.headers[name];
  const count=[1,2,4,8,16,32].includes(Number(input.searchParams.get('connections')))?Number(input.searchParams.get('connections')):connections;
  const floor=[32,64,128].includes(Number(input.searchParams.get('minChunkKiB')))?Number(input.searchParams.get('minChunkKiB')):minChunkKiB;
  try{
   // Select one node per frontend Range. Validate every part before forwarding its bytes.
   // BTR records real delivery and distinguishes refused node/address/pair in memory.
   const auto=input.searchParams.get('autoCDN')!=='false';
   const pool=item.resolver.rangeCandidates(),sample=item.samples||0;
   let first=pool[0];
   // Whole-request adaptation: do not mix different nodes' entities in one Range.
   // Only sizable media ranges explore; tiny init data proves availability, not speed.
   if(auto&&requested.length>=256*1024){
    const unmeasured=pool.filter(url=>item.resolver.speed(url)===0);
    if(sample<4)first=pool[sample%Math.max(1,pool.length)];
    else if(sample%20===0&&unmeasured.length)first=unmeasured[0];
    item.samples=sample+1;
   }
   if(!auto)first=pool.find(url=>new URL(url).hostname===(preferred||DEFAULTS[0]))||pool[0];
   const candidates=(auto?[first,...pool.filter(url=>url!==first)]:[first]).filter(Boolean).slice(0,3);
   if(!candidates.includes(source.href))candidates.push(source.href);
   let completed=false;
   for(const url of candidates){
    if(parent.signal.aborted)throw Error('cancelled');
    const attempt=new AbortController(),cancel=()=>attempt.abort();parent.signal.addEventListener('abort',cancel,{once:true});
    try{
     const result=await streamRange({url,requested,connections:count,minChunkKiB:floor,transport:upstream,response:res,controller:attempt,headers:safeHeaders});
     item.resolver.success(url,result.bytes>=256*1024?result.bytes*1000/Math.max(1,result.elapsedMs):0);stats.completed++;stats.acceptedBytes+=result.bytes;
     stats.last={host:new URL(url).hostname,...result};completed=true;break;
    }catch(error){
     if(!parent.signal.aborted||timedOut)item.resolver.failure(url,{name:timedOut?'TimeoutError':'Error',status:error.status||0},Number(error.receivedBytes)||0);
     if(res.headersSent||parent.signal.aborted)throw error;
    }finally{parent.signal.removeEventListener('abort',cancel);}
   }
   if(!completed)throw Error('upstream-failed');
  }catch{
   if(parent.signal.aborted&&!timedOut)stats.cancelled++;else stats.failed++;
   if(!res.headersSent&&!res.destroyed)json(res,502,{error:timedOut?'transfer-deadline':'upstream-failed'});else res.destroy();
  }finally{clearTimeout(timer);parent.abort();transfers.delete(parent);declared-=requested.length;stats.activeRequests=transfers.size;}
  }catch{if(!res.headersSent&&!res.destroyed)json(res,500,{error:'internal'});else res.destroy();}
 });
 server.maxConnections=64;server.headersTimeout=5000;server.requestTimeout=15000;
 server.on('close',()=>{for(const controller of transfers)controller.abort();upstream.close?.();routes.clear();});
 return {server,snapshot,shutdown(){for(const controller of transfers)controller.abort();upstream.close?.();server.closeIdleConnections();return new Promise(resolveClosed=>server.close(resolveClosed));}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const runtime=new URL('./.runtime/',import.meta.url);mkdirSync(runtime,{recursive:true});
 let token=process.env.BILI_GATEWAY_TOKEN;
 if(!token){try{token=JSON.parse(readFileSync(new URL('session.json',runtime),'utf8')).token;}catch{token=randomBytes(24).toString('base64url');}}
 const port=Number(process.env.BILI_GATEWAY_PORT)||9190,threads=Number(process.env.BILI_GATEWAY_THREADS)||16;
 const bind=process.argv.includes('--listen-lan')?'0.0.0.0':'127.0.0.1';
 writeFileSync(new URL('session.json',runtime),JSON.stringify({token,port,bind},null,2)+'\n',{mode:0o600});
 const gateway=createGateway({token,threads});
 gateway.server.listen(port,bind,()=>console.log(`Bili Range Gateway ${VERSION} listening ${bind}:${port}; private token remains in gateway/.runtime/session.json`));
 process.on('SIGINT',()=>gateway.shutdown().then(()=>process.exit(0)));
 process.on('SIGTERM',()=>gateway.shutdown().then(()=>process.exit(0)));
}
