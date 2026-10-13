import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createGateway} from '../gateway/server.mjs';
import {makeTransport,mediaURL} from '../gateway/transport.mjs';
import {range,Semaphore,cdn} from '../gateway/btr.mjs';
const TOKEN='fixture_private_key_1234567890123456';
const SOURCE='http://upos-sz-mirror08c.bilivideo.com/upgcxcode/fixture.m4s?upsig=private-example';
const checksum=bytes=>createHash('sha256').update(bytes).digest('hex');
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server.address().port;}
const get=(port,path,headers={})=>new Promise((resolve,reject)=>{
 const at=Date.now();const req=http.get({hostname:'127.0.0.1',port,path,agent:false,headers},res=>{
  const chunks=[];let first=null,ended=false;
  const finish=partial=>{if(ended)return;ended=true;resolve({status:res.statusCode,body:Buffer.concat(chunks),firstByteMs:first,elapsedMs:Date.now()-at,partial});};
  res.on('data',chunk=>{if(first===null)first=Date.now()-at;chunks.push(chunk);});res.on('end',()=>finish(false));res.on('aborted',()=>finish(true));res.on('error',()=>finish(true));
 });req.on('error',reject);
});
async function fixture({mismatch=false,hang=false,refuseHost=false,redirect=false,firstDNSFailure=false}={}){
 const size=2*1024*1024,data=Buffer.alloc(size);for(let i=0;i<size;i++)data[i]=i%251;
 let sockets=0,calls=0,active=0,peak=0;
 const backend=http.createServer((req,res)=>{
  calls++;active++;peak=Math.max(peak,active);res.on('close',()=>active--);
  assert.equal(req.headers['x-bili-gateway-token'],undefined);assert.equal(req.headers.cookie,undefined);assert.equal(req.headers.authorization,undefined);
  if(refuseHost&&req.headers.host.startsWith('upos-sz-mirrorali.')){res.writeHead(206,{'Content-Range':'bytes 0-131071/'+size,'Content-Type':'video/mp4'});res.flushHeaders();setTimeout(()=>res.destroy(),10);return;}
  if(redirect&&req.headers.host.startsWith('upos-sz-mirror08c.')){res.writeHead(302,{Location:'https://upos-sz-mirrorhwo1.bilivideo.com'+req.url});res.end();return;}
  const part=range.parseRangeHeader(req.headers.range);
  res.writeHead(206,{'Content-Range':`bytes ${part.start}-${part.end}/${size}`,'Content-Type':'video/mp4',ETag:mismatch&&part.start>0?'"other"':'"same"'});
  if(hang)return;
  let offset=part.start;
  const timer=setInterval(()=>{if(res.destroyed){clearInterval(timer);return;}
   const end=Math.min(offset+8192,part.end+1);res.write(data.subarray(offset,end));offset=end;
   if(offset>part.end){clearInterval(timer);res.end();}
  },8);res.on('close',()=>clearInterval(timer));
 });backend.on('connection',()=>sockets++);
 const backendPort=await listen(backend);
 let dnsCalls=0;
 // Test-only adapters map each CDN origin to loopback HTTP. Production uses
 // native HTTPS Agent and certificate validation; this fixture is not TLS proof.
 const transport=makeTransport({threads:8,createAgents:options=>({http:new http.Agent(options),https:new http.Agent(options)}),
  resolveDNS:(host,opts,callback)=>{const fail=firstDNSFailure&&++dnsCalls===1;setTimeout(()=>callback(fail?Error('fixture-private-dns-error'):null,[{address:'127.0.0.1',family:4}]),5);},
  dial:(url,options,cb)=>http.request(new URL(`http://${url.hostname}:${backendPort}${url.pathname}${url.search}`),
   {...options,headers:{...options.headers,Host:url.host}},cb)});
 const gateway=createGateway({token:TOKEN,threads:8,connections:8,transport,timeoutMs:1000});const port=await listen(gateway.server);
 const path='/range?source='+encodeURIComponent(SOURCE)+'&connections=8&autoCDN=false';
 return {port,path,data,transport,gateway,counts:()=>({sockets,calls,active,peak}),async close(){await gateway.shutdown();backend.closeAllConnections();await new Promise(resolve=>backend.close(resolve));}};
}
test('gateway directly loads BTR range, CDN resolver and cancellation-aware Semaphore',()=>{
 assert.equal(typeof range.splitRange,'function');assert.equal(typeof cdn.createBanList,'function');assert.equal(typeof Semaphore,'function');
});
test('media guard rejects credential, foreign, malformed and normalized traversal URLs',()=>{
 for(const url of ['https://evil.example/upgcxcode/a.m4s','https://upos-sz-mirror08c.bilivideo.com@127.0.0.1/upgcxcode/a.m4s',
  'http://127.0.0.1/upgcxcode/a.m4s','https://upos-sz-mirror08c.bilivideo.com/upgcxcode/../../admin',
  'https://upos-sz-mirror08c.bilivideo.com:9190/upgcxcode/a.m4s',SOURCE+'#token'])assert.throws(()=>mediaURL(url),/unsupported/);
 assert.equal(mediaURL(SOURCE).search,'?upsig=private-example');
});
test('private gateway streams byte-exact data before completion and reuses actual HTTP sockets',async()=>{
 const f=await fixture();try{
  const headers={'x-bili-gateway-token':TOKEN,Range:'bytes=0-1048575'};
  const one=await get(f.port,f.path,headers),firstCount=f.counts().sockets;
  assert.equal(one.status,206);assert.equal(one.partial,false);assert.equal(checksum(one.body),checksum(f.data.subarray(0,1048576)));
  assert.ok(one.firstByteMs<one.elapsedMs*0.75,JSON.stringify({first:one.firstByteMs,elapsed:one.elapsedMs}));
  const two=await get(f.port,f.path,headers);assert.equal(checksum(two.body),checksum(one.body));
  assert.ok(f.counts().sockets<=firstCount+1);assert.ok(f.counts().peak<=8);
  const stats=await get(f.port,'/stats',{'x-bili-gateway-token':TOKEN});const data=JSON.parse(stats.body);
  assert.equal(data.completed,2);assert.equal(data.activeRequests,0);assert.ok(!stats.body.toString().includes('private-example'));assert.ok(!stats.body.toString().includes(TOKEN));
  assert.equal(data.dnsQueries,1);assert.ok(data.dnsCoalesced>=7);assert.ok(data.reusedRequests>=8);assert.ok(data.idleConnections<=8);
 }finally{await f.close();}
});
test('unauthorized, bad URL, missing range and conditional requests never reach media transport',async()=>{
 const f=await fixture();try{
  assert.equal((await get(f.port,f.path,{Range:'bytes=0-1048575'})).status,401);
  const auth={'x-bili-gateway-token':TOKEN,Range:'bytes=0-1048575'};
  assert.equal((await get(f.port,'/range?source='+encodeURIComponent('http://127.0.0.1/upgcxcode/a.m4s'),auth)).status,400);
  assert.equal((await get(f.port,f.path,{'x-bili-gateway-token':TOKEN})).status,400);
  assert.equal((await get(f.port,f.path,{...auth,Cookie:'private'})).status,400);
  assert.equal((await get(f.port,f.path,{...auth,'If-Range':'private'})).status,400);
  assert.equal(f.counts().calls,0);
 }finally{await f.close();}
});
test('later entity mismatch closes a partial response before forwarding the mismatching piece',async()=>{
 const f=await fixture({mismatch:true});try{
  const result=await get(f.port,f.path,{'x-bili-gateway-token':TOKEN,Range:'bytes=0-1048575'});
  assert.equal(result.partial,true);assert.ok(result.body.length>0&&result.body.length<=131072);
  assert.equal(checksum(result.body),checksum(f.data.subarray(0,result.body.length)));
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(f.transport.stats().activeJobs,0);assert.equal(f.transport.stats().queuedJobs,0);
 }finally{await f.close();}
});
test('whole-transfer timeout cancels both active and queued jobs without leaving budgets occupied',async()=>{
 const f=await fixture({hang:true});try{
  const pending=get(f.port,f.path.replace('connections=8','connections=32')+'&minChunkKiB=32',{'x-bili-gateway-token':TOKEN,Range:'bytes=0-1048575'});
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(f.transport.stats().activeJobs,8);assert.equal(f.transport.stats().queuedJobs,24);
  const result=await pending;
  assert.ok(result.status===502||result.partial);await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(f.transport.stats().activeJobs,0);assert.equal(f.transport.stats().queuedJobs,0);assert.equal(f.gateway.snapshot().activeRequests,0);
 }finally{await f.close();}
});
test('zero-byte body failure can fall back before committing downstream headers',async()=>{
 const f=await fixture({refuseHost:true});try{
  const result=await get(f.port,f.path+'&cdn=upos-sz-mirrorali.bilivideo.com',{'x-bili-gateway-token':TOKEN,Range:'bytes=0-1048575'});
  assert.equal(result.status,206);assert.equal(result.partial,false);assert.equal(checksum(result.body),checksum(f.data.subarray(0,1048576)));
  for(let i=0;i<20&&!f.gateway.snapshot().last;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.gateway.snapshot().last.host,'upos-sz-mirror08c.bilivideo.com');
 }finally{await f.close();}
});
test('trusted redirects retain byte ranges and return exact streaming media',async()=>{
 const f=await fixture({redirect:true});try{
  const result=await get(f.port,f.path,{'x-bili-gateway-token':TOKEN,Range:'bytes=0-1048575'});
  assert.equal(result.status,206);assert.equal(result.partial,false);assert.equal(checksum(result.body),checksum(f.data.subarray(0,1048576)));
  assert.ok(f.counts().calls>=16);assert.ok(f.counts().peak<=8);
  for(let i=0;i<20&&!f.gateway.snapshot().last;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(f.gateway.snapshot().last.upstreamHosts,['upos-sz-mirrorhwo1.bilivideo.com']);assert.equal(f.gateway.snapshot().last.redirects,8);
 }finally{await f.close();}
});
test('idle keepalive sockets on a previous CDN cannot strand new-origin requests at the global limit',async()=>{
 const f=await fixture();try{
  const headers={'x-bili-gateway-token':TOKEN,Range:'bytes=0-1048575'};
  const warm=await get(f.port,f.path,headers);assert.equal(warm.status,206);assert.equal(warm.partial,false);
  await new Promise(resolve=>setTimeout(resolve,20));
  const switched=await get(f.port,f.path+'&cdn=upos-sz-mirrorhwo1.bilivideo.com',headers);
  assert.equal(switched.status,206);assert.equal(switched.partial,false);assert.equal(checksum(switched.body),checksum(warm.body));
  for(let i=0;i<20&&f.gateway.snapshot().last?.host!=='upos-sz-mirrorhwo1.bilivideo.com';i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.gateway.snapshot().last.host,'upos-sz-mirrorhwo1.bilivideo.com');
  assert.ok(switched.elapsedMs<950);assert.equal(f.transport.stats().queuedJobs,0);
  const third=await get(f.port,f.path+'&cdn=upos-sz-mirrorhw.bilivideo.com',headers);assert.equal(third.status,206);assert.equal(checksum(third.body),checksum(warm.body));
  await new Promise(resolve=>setTimeout(resolve,20));assert.ok(f.transport.stats().idleConnections<=8);assert.ok(f.transport.stats().retiredIdleConnections>=8,JSON.stringify({transport:f.transport.stats(),server:f.gateway.snapshot(),fixture:f.counts()}));
 }finally{await f.close();}
});
test('failed coalesced DNS lookup releases all waiters and does not poison a retry or expose raw DNS errors',async()=>{
 const f=await fixture({firstDNSFailure:true});try{
  const failures=await Promise.allSettled(Array.from({length:8},()=>f.transport.open(SOURCE,{start:0,end:8191})));
  assert.ok(failures.every(r=>r.status==='rejected'&&r.reason.message==='upstream-network'));
  assert.equal(f.transport.stats().dnsQueries,1);assert.equal(f.transport.stats().dnsFailures,1);assert.equal(f.transport.stats().activeJobs,0);
  const response=await f.transport.open(SOURCE,{start:0,end:8191}),chunks=[];for await(const chunk of response.stream)chunks.push(chunk);
  assert.equal(checksum(Buffer.concat(chunks)),checksum(f.data.subarray(0,8192)));assert.equal(f.transport.stats().dnsQueries,2);
  assert.ok(!JSON.stringify(f.gateway.snapshot()).includes('fixture-private-dns-error'));
 }finally{await f.close();}
});
test('every gateway CDN choice reaches its selected host even when the signed donor is HTTP',async()=>{
 const f=await fixture();try{
  for(const host of ['upos-sz-mirror08c.bilivideo.com','upos-sz-mirrorhwo1.bilivideo.com','upos-sz-mirrorhw.bilivideo.com','upos-sz-mirrorali.bilivideo.com']){
   const result=await get(f.port,f.path+'&cdn='+host,{'x-bili-gateway-token':TOKEN,Range:'bytes=0-262143'});
   assert.equal(result.status,206);assert.equal(result.partial,false);assert.equal(checksum(result.body),checksum(f.data.subarray(0,262144)));
   for(let i=0;i<20&&f.gateway.snapshot().last?.host!==host;i++)await new Promise(resolve=>setTimeout(resolve,10));
   assert.equal(f.gateway.snapshot().last.host,host);assert.deepEqual(f.gateway.snapshot().last.upstreamHosts,[host]);
  }
 }finally{await f.close();}
});
