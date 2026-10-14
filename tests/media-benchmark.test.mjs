import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createFixture} from '../scripts/loopback-fixture.mjs';
const MiB=1024*1024,host='upos-sz-mirror08c.bilivideo.com';
const url='https://upos-hz-mirrorakam.akamaized.net/upgcxcode/private-media.m4s?upsig=private-signature';
const request={method:'GET',url,headers:{Range:`bytes=8192-${8192+MiB-1}`,'User-Agent':'unit-test'}};
const files=['vendor/btr-0302b345/range-core.js',...['range-download','loon-http','budget','measurements','media-benchmark'].map(n=>'src/loon/'+n+'.js')];
function setup(){
 const context={Date,Uint8Array,console};for(const file of files)vm.runInNewContext(readFileSync(file,'utf8'),context);
 const api=context.BiliRangeMediaBenchmark,map=new Map([[api.KEY,JSON.stringify({epoch:0})]]);
 const store={read:key=>map.get(key),write:(value,key)=>{value===null?map.delete(key):map.set(key,value);return true;}};
 const sample={phase:'ready',at:1000,until:121000,epoch:0,url,headers:request.headers,preferred:host};
 const entity=Uint8Array.from({length:2*MiB},(_,i)=>i%251),seen=[];
 const client={get(o,cb){seen.push(o);const range=context.BiliRange.parseRange(o.headers.Range);
  assert.equal(o.insecure,false);assert.equal(o['auto-cookie'],false);assert.equal(o['auto-redirect'],false);
  assert.equal(o['binary-mode'],true);assert.equal(o.headers['x-bili-range-internal'],'1');
  assert.ok(!Object.keys(o.headers).some(k=>/cookie|authorization/i.test(k)));
  setImmediate(()=>cb(null,{status:206,headers:{'Content-Range':`bytes ${range.start}-${range.end}/${entity.length}`}},entity.subarray(range.start,range.end+1)));
 }};
 return {context,api,map,store,sample,entity,seen,client};
}
test('ordinary playback never saves a signed address until the manual capture is armed',async()=>{
 const h=setup(),result={kind:'response',metrics:{host}};
 h.api.capture(h.store,request,result,0,0,1000);assert.equal(h.map.size,1);
 const text=await h.api.manual(h.store,{get(){assert.fail('arming must not fetch');}},()=>1000);
 assert.match(text,/已准备采样/);assert.ok(![...h.map.values()].join('').includes('private-signature'));
 h.api.capture(h.store,request,result,0,0,1100);
 const captured=JSON.parse(h.map.get(h.api.CAPTURE));assert.equal(captured.url,url);assert.equal(captured.phase,'ready');
 assert.equal(captured.until,121000);assert.equal(h.api.validSample(captured,{epoch:0},1200),true);
});
test('capture rejects authentication, old epochs, failures and expired addresses, then clears stale samples',()=>{
 const h=setup(),arm=()=>h.store.write(JSON.stringify({phase:'armed',until:121000,epoch:0}),h.api.CAPTURE);
 for(const [req,result,old,current] of [[{...request,headers:{...request.headers,Cookie:'secret'}},{kind:'response'},0,0],
  [request,{kind:'pass'},0,0],[request,{kind:'response'},1,0],
  [{...request,url:url+'&deadline=2'},{kind:'response'},0,0]]){
  arm();h.api.capture(h.store,req,result,old,current,1000);assert.equal(JSON.parse(h.map.get(h.api.CAPTURE)).phase,'armed');
 }
 arm();h.api.capture(h.store,request,{kind:'response'},0,1,1000);assert.equal(h.map.has(h.api.CAPTURE),false);
 arm();h.api.capture(h.store,request,{kind:'response'},0,0,122000);assert.equal(h.map.has(h.api.CAPTURE),false);
});
test('capture prefers larger observed ranges without extending the opt-in window or exceeding one MiB',()=>{
 const h=setup();h.store.write(JSON.stringify({phase:'armed',at:1000,until:121000,epoch:0}),h.api.CAPTURE);
 const result={kind:'response',metrics:{host}},req=bytes=>({...request,headers:{Range:`bytes=0-${bytes-1}`}});
 h.api.capture(h.store,req(256*1024),result,0,0,1100);
 h.api.capture(h.store,req(2*MiB),result,0,0,1200);
 const sample=JSON.parse(h.map.get(h.api.CAPTURE));assert.equal(sample.headers.Range,`bytes=0-${MiB-1}`);assert.equal(sample.until,121000);
 h.api.capture(h.store,req(256*1024),result,0,0,1300);
 assert.equal(JSON.parse(h.map.get(h.api.CAPTURE)).at,1200);
});
test('bounded plan uses one source and four CDN hosts with balanced existing range comparisons',()=>{
 const h=setup(),tasks=h.api.plan(h.sample,()=>0.9);assert.equal(tasks.length,20);
 for(const name of new Set(tasks.map(t=>t.host)))assert.deepEqual(Array.from(tasks.filter(t=>t.host===name),t=>t.connections),[8,1,1,8]);
 assert.equal(tasks[0].original,true);assert.equal(new Set(tasks.filter(t=>!t.original).map(t=>t.host)).size,4);
});
test('manual complete media run clears the raw sample, retains no media bytes or URL, and does not alter playback state',async()=>{
 const h=setup();h.store.write(JSON.stringify(h.sample),h.api.CAPTURE);const original=h.map.get(h.api.KEY);
 const summary=await h.api.manual(h.store,h.client,()=>1100);
 assert.match(summary,/20\/20/);assert.match(summary,/逐字节参考/);assert.match(summary,/成功2\/2/);
 assert.ok(!summary.includes('private-signature'));assert.ok(!summary.includes('private-media'));
 assert.equal(h.map.has(h.api.CAPTURE),false);assert.equal(h.map.has(h.api.LOCK),false);assert.equal(h.map.get(h.api.KEY),original);
 assert.equal(h.seen.length,90);assert.equal(h.seen.filter(o=>o.url===url).length,18);
 assert.ok(h.seen.every(o=>new URL(o.url).pathname+new URL(o.url).search===new URL(url).pathname+new URL(url).search));
});
test('same-length media corruption is rejected rather than counted as faster content',async()=>{
 const h=setup(),base=h.client.get;
 h.client.get=(o,cb)=>base(o,(e,r,b)=>{if(new URL(o.url).hostname===host){b=new Uint8Array(b);b[0]^=1;}cb(e,r,b);});
 const result=await h.api.run({sample:h.sample,store:h.store,client:h.client,now:()=>1100,random:()=>0.9});
 const failed=result.rows.filter(r=>r.host===host);assert.equal(failed.length,4);
 assert.ok(failed.every(r=>!r.ok&&r.bytes===0&&r.reason==='content-different'));
});
test('source failure still permits CDN comparison but cannot be advertised as original-source identity',async()=>{
 const h=setup(),base=h.client.get;let calls=0;
 h.client.get=(o,cb)=>{calls++;o.url===url?setImmediate(()=>cb('raw-private-error',null,null)):base(o,cb);};
 const result=await h.api.run({sample:h.sample,store:h.store,client:h.client,now:()=>1100,random:()=>0.9});
 assert.equal(calls,90);assert.equal(result.rows.length,20);assert.equal(result.stop,'complete');
 assert.equal(result.referenceOriginal,false);assert.equal(result.rows.filter(r=>r.ok).length,16);
 assert.equal(result.rows[0].reason,'transport');assert.ok(!h.api.report(result).includes('private-error'));
 assert.match(h.api.report(result),/仅CDN响应一致性/);
});
test('network changes, playback admission, expiry, and time budget prevent further media tasks',async()=>{
 for(const mode of ['network-changed','playback-active','time-budget','sample-expired']){
  const h=setup(),base=h.client.get;let clock=1100;
  if(mode==='sample-expired')h.sample.until=1150;
  h.client.get=(o,cb)=>base(o,(e,r,b)=>{
   if(mode==='network-changed')h.store.write(JSON.stringify({epoch:1}),h.api.KEY);
   if(mode==='playback-active')h.store.write(JSON.stringify({epoch:0,leases:{active:{expires:9000,jobs:8,bytes:MiB}}}),h.api.KEY);
   if(mode==='time-budget')clock=67000;
   if(mode==='sample-expired')clock=1200;
   cb(e,r,b);
  });
  const result=await h.api.run({sample:h.sample,store:h.store,client:h.client,now:()=>clock,random:()=>0.9});
  assert.equal(result.rows.length,1);assert.equal(result.stop,mode);
  if(['network-changed','playback-active'].includes(mode))assert.equal(result.rows[0].ok,false);
 }
});
test('live manual lock and ordinary playback never trigger overlapping benchmark HTTP requests',async()=>{
 const h=setup();h.store.write(JSON.stringify(h.sample),h.api.CAPTURE);
 h.store.write(JSON.stringify({until:9000,token:'active'}),h.api.LOCK);
 const forbidden={get(){assert.fail('unexpected benchmark GET');}};
 assert.match(await h.api.manual(h.store,forbidden,()=>1100),/正在运行/);
 h.store.write(null,h.api.LOCK);h.store.write(JSON.stringify({leases:{x:{expires:9000,jobs:8,bytes:MiB}}}),h.api.KEY);
 assert.match(await h.api.manual(h.store,forbidden,()=>1100),/先暂停/);assert.equal(h.map.has(h.api.CAPTURE),true);
});
test('published manual bundle executes over real loopback HTTP with byte-correct source/CDN comparisons',async()=>{
 const h=setup(),size=MiB,fixture=await createFixture({size,parseRange:h.context.BiliRange.parseRange,initialDelayMs:2,tickMs:1});
 try{
  const at=Date.now(),sample={...h.sample,at,until:at+120000,headers:{Range:`bytes=0-${size-1}`}};
  h.store.write(JSON.stringify(sample),h.api.CAPTURE);let doneCalls=0,summary,calls=0;
  const response=await new Promise(resolve=>vm.runInNewContext(readFileSync('dist/candidate/media-benchmark.bundle.js','utf8'),{
   Date,Uint8Array,console:{log:s=>{summary=s;}},$persistentStore:{
    read:key=>h.store.read(key.replace('aijc123.BiliRange.adaptive.v1',h.api.KEY)),
    write:(v,key)=>h.store.write(v,key.replace('aijc123.BiliRange.adaptive.v1',h.api.KEY))},
   $httpClient:{get(o,cb){calls++;fixture.fetchRange(o).then(r=>cb(null,{status:r.status,headers:r.headers},r.body),e=>cb(e.message,null,null));}},
   $done:r=>{doneCalls++;resolve(r);}
  }));
  assert.equal(doneCalls,1);assert.equal(calls,90);assert.equal(fixture.peak(),8);
  assert.equal((summary.match(/成功2\/2/g)||[]).length,10);assert.equal(response.content,summary);
  assert.ok(!summary.includes('private-signature'));assert.equal(h.map.has(h.api.CAPTURE),false);
 }finally{await fixture.close();}
});
test('published downloader captures only when armed and network reset clears the local sample',async()=>{
 const h=setup(),ns='aijc123.BiliRange.adaptive.v1',map=new Map();
 const store={read:k=>map.get(k),write:(v,k)=>{v===null?map.delete(k):map.set(k,v);return true;}};
 store.write(JSON.stringify({phase:'armed',at:1000,until:121000,epoch:0}),ns+'.mediaCapture');
 let done=0;
 await new Promise(resolve=>vm.runInNewContext(readFileSync('dist/candidate/range.bundle.js','utf8'),{
  Uint8Array,Date:{now:()=>1100},Math,console:{log(){}},$argument:{Enabled:true},$request:request,$persistentStore:store,$httpClient:h.client,
  $done:r=>{done++;assert.equal(r.response.status,206);resolve();}
 }));
 assert.equal(done,1);assert.equal(JSON.parse(map.get(ns+'.mediaCapture')).url,url);
 assert.ok(!map.get(ns).includes('private-signature'));
 vm.runInNewContext(readFileSync('dist/candidate/network-reset.bundle.js','utf8'),{
  Uint8Array,Date:{now:()=>1200},$argument:{Enabled:false},$persistentStore:store,console:{log(){}},$done(){}
 });
 assert.equal(map.has(ns+'.mediaCapture'),false);assert.equal(JSON.parse(map.get(ns)).epoch,1);
});
