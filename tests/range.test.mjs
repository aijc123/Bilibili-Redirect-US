import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const context = { Uint8Array, Date, console };
vm.runInNewContext(readFileSync('vendor/btr-0302b345/range-core.js','utf8'),context);
vm.runInNewContext(readFileSync('src/accelerator/range-core.js','utf8'),context);
const core = context.BiliRange;
const request = { method: 'GET', url: 'https://upos-sz-mirroraliov.bilivideo.com/upgcxcode/test.m4s?upsig=abc&deadline=2999999999',
  headers: { Range: 'bytes=32768-1081343', Referer: 'https://www.bilibili.com', 'Accept-Encoding': 'gzip' } };
const entity = new Uint8Array(2 * 1024 * 1024).map((_,i)=>i%251);
const good = async ({part})=>({status:206,headers:{'Content-Range':`bytes ${part.start}-${part.end}/${entity.length}`,
  'Content-Type':'video/mp4',ETag:'"same"'},body:entity.slice(part.start,part.end+1)});
test('parallel ranges reconstruct exact bytes and preserve signed query',async()=>{
  let active=0, peak=0; const seen=[];
  const result=await core.accelerate({request,options:{connections:4},fetchRange:async x=>{
    seen.push(x); peak=Math.max(peak,++active); await new Promise(r=>setTimeout(r,10)); active--; return good(x);
  }});
  assert.equal(peak,4); assert.equal(result.kind,'response');
  assert.deepEqual(result.response.body,entity.slice(32768,1081344));
  assert.equal(result.response.headers['Content-Range'],`bytes 32768-1081343/${entity.length}`);
  assert.ok(seen.every(x=>x.url.endsWith('?upsig=abc&deadline=2999999999')));
  assert.ok(seen.every(x=>x.headers['Accept-Encoding']==='identity' && x.headers[core.INTERNAL]==='1'));
});
for(const [name,mutate] of [
 ['status',r=>({...r,status:200})], ['403',r=>({...r,status:403})],
 ['redirect',r=>({...r,status:302})], ['truncated',r=>({...r,body:r.body.slice(1)})],
 ['string body',r=>({...r,body:'invalid'})],
 ['wrong offset',r=>({...r,headers:{...r.headers,'Content-Range':`bytes 0-1/${entity.length}`}})],
 ['unknown total',r=>({...r,headers:{...r.headers,'Content-Range':'bytes 0-1/*'}})],
 ['compressed',r=>({...r,headers:{...r.headers,'Content-Encoding':'gzip'}})],
 ['html',r=>({...r,headers:{...r.headers,'Content-Type':'text/html'}})],
 ['content length',r=>({...r,headers:{...r.headers,'Content-Length':'3'}})],
]) test(`falls back on ${name}`,async()=>{
 const state={}; const r=await core.accelerate({request,state,fetchRange:async x=>mutate(await good(x))});
 assert.equal(r.kind,'pass'); assert.ok(state.hosts[core.DEFAULT_HOSTS[0]].blockedUntil > Date.now());
});
for(const field of ['ETag','Last-Modified','Content-Type','Content-Range'])test(`rejects inconsistent ${field}`,async()=>{
 let calls=0;
 const r=await core.accelerate({request,fetchRange:async x=>{const v=await good(x);
 if(calls++===1) v.headers[field]=field==='Content-Range'?`bytes ${x.part.start}-${x.part.end}/${entity.length+1}`:'different'; return v;}});
 assert.equal(r.kind,'pass');
});
for(const [label,patch] of [
 ['no range',{headers:{}}],['open range',{headers:{Range:'bytes=0-'}}],
 ['suffix',{headers:{Range:'bytes=-500'}}],['multi range',{headers:{Range:'bytes=0-100,200-300'}}],
 ['small',{headers:{Range:'bytes=0-100'}}],['huge',{headers:{Range:'bytes=0-999999999'}}],
 ['unsafe integer',{headers:{Range:'bytes=0-999999999999999999'}}],
 ['HEAD',{method:'HEAD'}],['other host',{url:'https://example.com/upgcxcode/a'}],
 ['cookie',{headers:{...request.headers,Cookie:'private'}}],
 ['conditional',{headers:{...request.headers,'If-Range':'"version"'}}],
 ['internal',{headers:{...request.headers,[core.INTERNAL]:'1'}}],
 ['expired',{url:request.url.replace('2999999999','1')}],
]) test(`bypasses ${label} without issuing requests`,async()=>{
 let called=false; const r=await core.accelerate({request:{...request,...patch},fetchRange:()=>{called=true;}});
 assert.equal(r.kind,'pass'); assert.equal(called,false);
});
test('failure waits for other callbacks before returning',async()=>{
 let finished=false;
 const r=await core.accelerate({request,fetchRange:async x=>{
  if(x.part.start===32768)throw Error('failed');
  await new Promise(r=>setTimeout(r,20));finished=true;return good(x);
 }}); assert.equal(r.kind,'pass');assert.equal(finished,true);
});
test('selection uses real throughput, expiry and cooldown',()=>{
 const hosts=core.DEFAULT_HOSTS, now=10000000;
 const state={hosts:Object.fromEntries(hosts.map((h,i)=>[h,{at:now-100,bps:i===1?400:100}]))};
 assert.equal(core.chooseHost(state,hosts,now),hosts[1]);
 state.hosts[hosts[1]].blockedUntil=now+100;
 assert.equal(core.chooseHost(state,hosts,now),hosts[0]);
 state.hosts[hosts[2]].at=1;
 assert.equal(core.chooseHost(state,hosts,now),hosts[2]);
});
test('adapter accepts plugin object, binary response and reports no signed URLs',async()=>{
 const storage={}; let completed=0;
 const result=await new Promise(resolve=>{
  const ctx={Uint8Array,Date,console,$request:request,$argument:{Connections:2,AutoCDN:false},
    $persistentStore:{read:k=>storage[k],write:(v,k)=>{storage[k]=v;return true;}},
    $httpClient:{get:(o,cb)=>{const range=core.parseRange(o.headers.Range);good({part:range}).then(r=>cb(null,r,r.body));}},
    $done:r=>{completed++;resolve(r);}};
  vm.runInNewContext(readFileSync('dist/lab/range.bundle.js','utf8'),ctx);
 });
 assert.equal(completed,1);assert.ok(result.response.body instanceof Uint8Array);
 assert.ok(!JSON.stringify(storage).includes('upsig'));assert.ok(!JSON.stringify(storage).includes('test.m4s'));
});
test('network-change string argument resets scores',()=>{
 let value=JSON.stringify({hosts:{abc:{bps:123}},diagnostics:{accelerated:1}});
 const ctx={Uint8Array,Date,console,$argument:'{"Action":"reset"}',$persistentStore:{read:()=>value,write:v=>{value=v;}},$done(){}};
 vm.runInNewContext(readFileSync('dist/lab/range.bundle.js','utf8'),ctx);
 assert.deepEqual(JSON.parse(value).hosts,{});assert.equal(JSON.parse(value).epoch,1);
});
test('single-connection control uses the same byte and validation path',async()=>{
 let calls=0; const r=await core.accelerate({request,options:{connections:1},fetchRange:async o=>{calls++;return good(o);}});
 assert.equal(calls,1);assert.equal(r.metrics.connections,1);
 assert.deepEqual(r.response.body,entity.slice(32768,1081344));
});
test('busy adapter passes request without multiplying concurrent transfers',()=>{
 let value=JSON.stringify({leases:Object.fromEntries(['a','b','c','d'].map(id=>[id,{expires:Date.now()+8000,jobs:4,bytes:1048576}]))}), completed=0, calls=0;
 const ctx={Uint8Array,Date,console,$request:request,$argument:{},
  $persistentStore:{read:()=>value,write:v=>{value=v;}},$httpClient:{get(){calls++;}},$done(){completed++;}};
 vm.runInNewContext(readFileSync('dist/lab/range.bundle.js','utf8'),ctx);
 assert.equal(completed,1);assert.equal(calls,0);assert.equal(JSON.parse(value).diagnostics.reasons['budget-requests'],1);
});
test('network changes during a download do not resurrect old host scores',async()=>{
 let value='{}';let resolve;
 const done=new Promise(r=>{resolve=r;});const callbacks=[];
 const ctx={Uint8Array,Date,console,$request:request,$argument:{Connections:2},
  $persistentStore:{read:()=>value,write:v=>{value=v;}},
  $httpClient:{get:(o,cb)=>callbacks.push({o,cb})},$done:resolve};
 vm.runInNewContext(readFileSync('dist/lab/range.bundle.js','utf8'),ctx);
 await new Promise(r=>setImmediate(r));
 const saved=JSON.parse(value);saved.epoch=1;saved.hosts={};value=JSON.stringify(saved);
 for(const {o,cb} of callbacks){const r=await good({part:core.parseRange(o.headers.Range)});cb(null,r,r.body);}
 await done;const after=JSON.parse(value);
 assert.deepEqual(after.hosts,{});assert.deepEqual(after.leases,{});assert.equal(after.epoch,1);
});
test('Loon adapter actually delegates parsing, splitting and concatenation to BTR',async()=>{
 const calls={};const ctx={Uint8Array,Date,console};
 vm.runInNewContext(readFileSync('vendor/btr-0302b345/range-core.js','utf8'),ctx);
 const original=ctx.__BILI_RANGE_CORE__;
 ctx.__BILI_RANGE_CORE__=Object.fromEntries(Object.entries(original).map(([key,fn])=>[key,(...args)=>{calls[key]=(calls[key]||0)+1;return fn(...args);} ]));
 vm.runInNewContext(readFileSync('src/accelerator/range-core.js','utf8'),ctx);
 const r=await ctx.BiliRange.accelerate({request,fetchRange:good});
 assert.equal(r.kind,'response');
 for(const name of ['parseRangeHeader','parseContentRange','splitRange','concatChunks'])assert.ok(calls[name]>0,name);
});
test('diagnostic aggregates describe unsupported requests without retaining private data',async()=>{
 let value='{}';let report;
 const execute=(req,arg)=>new Promise(resolve=>{
  const ctx={Uint8Array,Date,console,$argument:arg || {},
   $persistentStore:{read:()=>value,write:v=>{value=v;return true;}},$done:resolve};
  if(req)ctx.$request=req;
  vm.runInNewContext(readFileSync('dist/lab/range.bundle.js','utf8'),ctx);
 });
 await execute({method:'GET',url:'https://xy123.mcdn.bilivideo.cn:4483/upgcxcode/private-video.m4s?upsig=secret',headers:{Range:'bytes=0-'}});
 await execute({...request,headers:{Range:'bytes=0-'}});
 report=await execute();
 const saved=JSON.parse(value);
 assert.equal(saved.diagnostics.sources.MCDN,1);assert.equal(saved.diagnostics.shapes['open-ended'],2);
 assert.ok(report.content.includes('0.1.9-experimental'));
 for(const secret of ['private-video','upsig','secret','abc','deadline']){assert.ok(!value.includes(secret));assert.ok(!report.content.includes(secret));}
});
test('generated plugin observes MCDN but does not take it over',()=>{
 const plugin=readFileSync('dist/lab/BiliBili.Range.Lab.plugin','utf8');
 const regexText=plugin.split('\n').find(l=>l.startsWith('http-request ')).split(' script-path=')[0].slice('http-request '.length);
 const regex=new RegExp(regexText,'i');
 assert.ok(regex.test('https://xy123.mcdn.bilivideo.cn:4483/upgcxcode/video.m4s'));
 assert.ok(regex.test('https://d1--example.bilivideo.com/upgcxcode/video.m4s'));
 assert.ok(!regex.test('https://evil.example/upgcxcode/video.m4s'));
 assert.equal(core.parseURL('https://xy123.mcdn.bilivideo.cn:4483/upgcxcode/video.m4s'),null);
});
test('manual diagnosis logs and offers the exact summary for notification copy',()=>{
 let notified,logged,completed;
 const ctx={Uint8Array,Date,$argument:null,
  console:{log:v=>{logged=v;}},$persistentStore:{read:()=>'{"diagnostics":{"accelerated":2,"passed":1}}'},
  $notification:{post:(...args)=>{notified=args;}},$done:v=>{completed=v;}};
 vm.runInNewContext(readFileSync('dist/lab/range.bundle.js','utf8'),ctx);
 assert.equal(notified[3].clipboard,completed.content);
 assert.equal(logged,completed.content);
 assert.ok(completed.content.includes('接管 2 次 / 放行 1 次'));
});
for(const placeholder of [undefined,null,{}, {url:''}, {url:'https://example.com/dummy'}])test(`standalone diagnosis outputs a summary with request placeholder ${JSON.stringify(placeholder)}`,()=>{
 let logged,notified,finished=0;
 const ctx={Uint8Array,Date,$request:placeholder,
  console:{log:v=>{logged=v;}},$persistentStore:{read:()=>'{"diagnostics":{"accelerated":3,"passed":1}}'},
  $notification:{post:(...args)=>{notified=args;}},$done:()=>{finished++;}};
 vm.runInNewContext(readFileSync('dist/lab/diagnose.bundle.js','utf8'),ctx);
 assert.equal(finished,1);assert.ok(logged.includes('接管 3 次 / 放行 1 次'));
 assert.equal(notified[3].clipboard,logged);
});
test('standalone diagnosis logs a result even when notification permission fails',()=>{
 let logged,finished=0;
 const ctx={console:{log:v=>{logged=v;}},$persistentStore:{read:()=>null},
  $notification:{post:()=>{throw Error('disabled');}},$done:()=>{finished++;}};
 vm.runInNewContext(readFileSync('dist/lab/diagnose.bundle.js','utf8'),ctx);
 assert.ok(logged.includes('暂无请求'));assert.equal(finished,1);
});
test('manual placeholder in the full adapter does not silently run the download path',()=>{
 let logged,finished;
 const ctx={Uint8Array,Date,$request:{},$argument:null,
  console:{log:v=>{logged=v;}},$persistentStore:{read:()=>null},$done:v=>{finished=v;}};
 vm.runInNewContext(readFileSync('dist/lab/range.bundle.js','utf8'),ctx);
 assert.ok(logged.includes('暂无请求'));assert.ok(finished.content);
});
