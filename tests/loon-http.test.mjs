import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const ctx={Uint8Array,Date,console};
for(const p of ['vendor/btr-0302b345/range-core.js','src/accelerator/range-core.js','src/accelerator/loon-http.js'])vm.runInNewContext(readFileSync(p,'utf8'),ctx);
const api=ctx.BiliRangeHTTP;
const url='https://upos-sz-mirror08c.bilivideo.com/upgcxcode/a.m4s?upsig=private';
const options={url,headers:{Range:'bytes=0-262143','Accept-Encoding':'identity','x-bili-range-internal':'1'},timeout:2500};
test('follows a trusted 302 without losing range or leaking to a third party',async()=>{
 const seen=[];
 const fetch=api.makeFetch({get(o,cb){seen.push(o);cb(null,seen.length===1?
  {status:302,headers:{Location:'https://cn-gdfs-ct-01-01.bilivideo.com/upgcxcode/a.m4s?upsig=private'}}:
  {status:206,headers:{'Content-Range':'bytes 0-262143/1000000'}},new Uint8Array(262144));}});
 const r=await fetch(options);
 assert.equal(r.status,206);assert.equal(r.redirects,1);assert.equal(seen.length,2);
 assert.ok(seen.every(o=>o.headers.Range==='bytes=0-262143' && o['auto-redirect']===false && o.insecure===false));
});
for(const location of [
 'https://evil.example/upgcxcode/a.m4s?upsig=private',
 'https://bilivideo.com.evil.example/upgcxcode/a.m4s?upsig=private',
 'https://evil@upos-sz-mirror08c.bilivideo.com/upgcxcode/a.m4s?upsig=private',
 'http://upos-sz-mirror08c.bilivideo.com/upgcxcode/a.m4s?upsig=private',
 'https://upos-sz-mirror08c.bilivideo.com/upgcxcode/other.m4s?upsig=private',
 'https://upos-sz-mirror08c.bilivideo.com:8080/upgcxcode/a.m4s?upsig=private',
 'https://upos-sz-mirror08c.bilivideo.com\\@evil.example/upgcxcode/a.m4s',
])test(`rejects unsafe redirect ${location.split('?')[0]}`,async()=>{
 let calls=0;const fetch=api.makeFetch({get(o,cb){calls++;cb(null,{status:302,headers:{Location:location}},null);}});
 await assert.rejects(()=>fetch(options),/redirect-untrusted/);assert.equal(calls,1);
});
test('accepts relative redirects and stops a redirect loop',async()=>{
 assert.equal(api.redirectURL(url,'//cn-gdfs-ct-01-01.bilivideo.com/upgcxcode/a.m4s?x=1'),'https://cn-gdfs-ct-01-01.bilivideo.com/upgcxcode/a.m4s?x=1');
 assert.equal(api.redirectURL(url,'/upgcxcode/a.m4s?x=1'),'https://upos-sz-mirror08c.bilivideo.com/upgcxcode/a.m4s?x=1');
 const fetch=api.makeFetch({get(o,cb){cb(null,{status:302,headers:{Location:o.url}},null);}});
 await assert.rejects(()=>fetch(options),/redirect-limit/);
});
test('redirect hops share one total timeout budget',async()=>{
 let clock=0,calls=0;const fetch=api.makeFetch({get(o,cb){calls++;clock=2450;cb(null,{status:302,headers:{Location:'https://cn-gdfs-ct-01-01.bilivideo.com/upgcxcode/a.m4s'}},null);}},()=>clock);
 await assert.rejects(()=>fetch(options),/transport/);assert.equal(calls,1);
});
test('two redirects are allowed but a third is refused before another fetch',async()=>{
 for(const redirectCount of [2,3]) {
  let calls=0;
  const fetch=api.makeFetch({get(o,cb){calls++;
   if(calls<=redirectCount)cb(null,{status:302,headers:{Location:`https://cn-gdfs-ct-01-01.bilivideo.com/upgcxcode/a.m4s?hop=${calls}`}},null);
   else cb(null,{status:206,headers:{}},new Uint8Array(1));
  }});
  if(redirectCount===2){const r=await fetch(options);assert.equal(r.redirects,2);}
  else await assert.rejects(()=>fetch(options),/redirect-limit/);
  assert.equal(calls,3);
 }
});
test('a missing callback response becomes a handled network error',async()=>{
 const fetch=api.makeFetch({get(o,cb){cb(null,null,null);}});
 await assert.rejects(()=>fetch(options),/transport/);
});
test('transient failures use short increasing cooldown and success clears it',async()=>{
 const req={method:'GET',url,headers:{Range:'bytes=0-1048575'}},state={};let now=100000;
 const bad=()=>Promise.reject(Error('network'));
 let r=await ctx.BiliRange.accelerate({request:req,state,options:{auto:false},now:()=>now,fetchRange:bad});
 assert.equal(r.metrics.cooldownMs,1500);
 now+=1600;r=await ctx.BiliRange.accelerate({request:req,state,options:{auto:false},now:()=>now,fetchRange:bad});
 assert.equal(r.metrics.cooldownMs,3000);
 now+=3100;r=await ctx.BiliRange.accelerate({request:req,state,options:{auto:false},now:()=>now,fetchRange:async o=>({status:206,headers:{'Content-Range':`bytes ${o.part.start}-${o.part.end}/2000000`},body:new Uint8Array(o.part.end-o.part.start+1)})});
 assert.equal(r.kind,'response');assert.equal(state.hosts[ctx.BiliRange.DEFAULT_HOSTS[0]].failures,0);
});
test('one signed path refusal no longer disables a whole candidate for a minute',async()=>{
 const req={method:'GET',url,headers:{Range:'bytes=0-1048575'}};
 const r=await ctx.BiliRange.accelerate({request:req,fetchRange:async()=>({status:403,headers:{},body:new Uint8Array()})});
 assert.equal(r.reason,'status-403');assert.equal(r.metrics.cooldownMs,1500);
});
test('candidate bundle uses trusted redirect transport end to end',async()=>{
 const logs=[],seen=[];let stored='{}';
 const result=await new Promise(resolve=>{
  const context={Uint8Array,Date,console:{log:s=>logs.push(s)},$argument:{AutoCDN:false,Connections:4},
   $request:{method:'GET',url,headers:{Range:'bytes=0-1048575'}},
   $persistentStore:{read:()=>stored,write:v=>{stored=v;return true;}},$done:resolve,
   $httpClient:{get(o,cb){seen.push(o);if(o.url.includes('mirrorhwo1')){cb(null,{status:302,headers:{Location:'https://cn-gdfs-ct-01-01.bilivideo.com/upgcxcode/a.m4s?upsig=private'}},null);return;}
    const range=ctx.BiliRange.parseRange(o.headers.Range);
    cb(null,{status:206,headers:{'Content-Range':`bytes ${range.start}-${range.end}/2000000`,'Content-Type':'video/mp4'}},new Uint8Array(range.length));}}};
  vm.runInNewContext(readFileSync('dist/lab/range.bundle.js','utf8'),context);
 });
 assert.equal(result.response.status,206);assert.equal(result.response.body.length,1048576);assert.equal(seen.length,8);
 const d=JSON.parse(stored).diagnostics;assert.equal(d.last.redirects,4);assert.equal(d.accelerated,1);
 assert.ok(!stored.includes('upsig'));assert.ok(!stored.includes('private'));
});
