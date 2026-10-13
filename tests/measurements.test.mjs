import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context={Uint8Array,Date,console};
for(const p of ['vendor/btr-0302b345/range-core.js','src/accelerator/range-core.js','src/accelerator/measurements.js','src/accelerator/diagnostics.js'])vm.runInNewContext(readFileSync(p,'utf8'),context);
const api=context.BiliRangeMeasurements;
const req={method:'GET',url:'https://upos-sz-mirroraliov.bilivideo.com/upgcxcode/private-video.m4s?upsig=secret',headers:{Range:'bytes=0-1048575'}};
const result=(from,at,mode=4)=>({kind:'response',metrics:{host:'upos-sz-mirror08c.bilivideo.com',bytes:1048576,startedAt:from,finishedAt:at,elapsedMs:at-from,connections:mode}});
test('overlapping transfers use a wall interval, not the sum of request latencies',()=>{
 const state={};api.record(state,req,result(1000,2000));api.record(state,req,result(1500,2500));
 const a=api.analyze(state,2500);assert.equal(a.window.occupiedMs,1500);assert.equal(a.window.spanMs,1500);
 assert.equal(a.window.peakCompletedOverlap,2);assert.equal(a.window.deliveryMbps,2097152*8/1500/1000);
 assert.notEqual(a.window.deliveryMbps,2097152*8/2000/1000);
});
test('mode comparisons are stratified and explicitly observational',()=>{
 const state={epoch:2};for(let i=0;i<20;i++){
  api.record(state,req,result(10000+i*2000,11000+i*2000,i%2?8:4),{epoch:2,inflight:0});
 }
 const a=api.analyze(state,51000);assert.equal(a.contrasts.length,1);assert.equal(a.contrasts[0].adequate,true);
 assert.equal(a.contrasts[0].causal,false);assert.equal(a.contrasts[0].medianRatio,1);
 api.record(state,{...req,url:req.url.replace('private-video','other-video')},result(52000,52600,8),{epoch:2,inflight:0});
 assert.equal(api.analyze(state,52600).contrasts.length,1);
});
test('same configured32 naturally becoming6 or8 pieces never becomes a concurrency-change comparison',()=>{
 for(const differentSize of [true,false]){
  const state={};for(let i=0;i<20;i++){
   const bytes=differentSize&&i%2?786432:1048576,mode=i%2?6:8;
   api.record(state,{...req,headers:{Range:`bytes=0-${bytes-1}`}}, {kind:'response',metrics:{...result(10000+i*2000,11000+i*2000,mode).metrics,bytes,configuredConnections:32}}, {inflight:0});
  }
  assert.equal(api.analyze(state,51000).contrasts.length,0);
 }
});
test('different configured settings with same byte count report configured and actual counts separately',()=>{
 const state={};for(let i=0;i<20;i++)api.record(state,req,{kind:'response',metrics:{...result(10000+i*2000,11000+i*2000,i%2?8:4).metrics,configuredConnections:i%2?32:4}}, {inflight:0});
 const c=api.analyze(state,51000).contrasts[0];assert.equal(c.baselineSetting,4);assert.equal(c.candidateSetting,32);assert.equal(c.candidate,8);
});
test('a network epoch change does not mix old samples into the live window',()=>{
 const state={epoch:1};api.record(state,req,result(1000,2000),{epoch:1});state.epoch=2;
 api.record(state,req,result(2200,3000),{epoch:2});const a=api.analyze(state,3000);
 assert.equal(a.window.bytes,1048576);assert.equal(Object.keys(a.groups).length,2);
});
test('persistent sampling never stores the source path, signature or arbitrary reason',()=>{
 const state={};api.record(state,req,result(1000,2000));
 api.record(state,req,{kind:'pass',reason:'https://evil.example/?token=secret',metrics:{...result(2100,3000).metrics} });
 const text=JSON.stringify(state);for(const secret of ['private-video','upsig','secret','evil.example','upgcxcode'])assert.ok(!text.includes(secret),secret);
 assert.ok(text.includes('other-failure'));
});
test('sample storage is bounded and expired observations are removed',()=>{
 const state={};for(let i=0;i<300;i++)api.record(state,req,result(1000+i*1000,1500+i*1000));
 assert.equal(state.measurements.samples.length,120);assert.equal(api.analyze(state,2000000).samples,0);
});
test('p10 throughput and p90 latency reveal tails without hiding failures',()=>{
 const state={};for(let i=0;i<10;i++)api.record(state,req,result(1000+i*2000,1500+i*2000+(i===9?1000:0)),{inflight:0});
 api.record(state,req,{kind:'pass',reason:'transport',metrics:{...result(22000,24500).metrics}}, {inflight:0});
 const stats=Object.values(api.analyze(state,25000).groups)[0];assert.equal(stats.n,11);assert.equal(stats.failed,1);assert.ok(stats.p10Mbps<stats.p50Mbps);assert.ok(stats.p90Ms>=stats.p50Ms);
});
test('invalid persisted labels cannot leak into a report',()=>{
 const state={measurements:{samples:[{host:'https://secret.example',content:'token',bucket:'url',at:1000}]}};
 assert.equal(api.analyze(state,2000).samples,0);assert.ok(!api.report(state,2000).includes('secret'));
});
test('failed attempt time lowers cohort delivery instead of disappearing from the denominator',()=>{
 const state={};api.record(state,req,result(1000,2000));
 api.record(state,req,{kind:'pass',reason:'transport',metrics:{...result(2000,4500).metrics}});
 const window=api.analyze(state,4500).window;assert.equal(window.spanMs,3500);assert.equal(window.occupiedMs,3500);
 assert.equal(window.deliveryMbps,1048576*8/3500/1000);
 const failed={};api.record(failed,req,{kind:'pass',reason:'transport',metrics:{...result(1000,3500).metrics}});
 assert.equal(api.analyze(failed,3500).window.deliveryMbps,0);
});
test('ordinary strata separate success tails from all-attempt tails and retain measured piece spreads',()=>{
 const state={};api.record(state,req,{...result(1000,2000),metrics:{...result(1000,2000).metrics,minPieceMs:100,maxPieceMs:800}});
 api.record(state,req,{kind:'pass',reason:'transport',metrics:{...result(3000,7000).metrics}});
 const analyzed=api.analyze(state,7000),stats=Object.values(analyzed.groups)[0];
 assert.equal(stats.p90Ms,1000);assert.equal(stats.p90AttemptMs,3700);assert.equal(stats.pieceSpreadN,1);assert.equal(stats.p50PieceSpreadMs,700);
 assert.equal(analyzed.window.failed,1);assert.equal(analyzed.window.failureReasons.transport,1);assert.ok(api.report(state,7000).includes('含失败'));
});
test('manual diagnostic snapshots compare aggregate increments without copying arbitrary state or reason text',()=>{
 const d=context.BiliRangeDiagnostics;
 const previous=d.snapshot({epoch:2,diagnostics:{accelerated:100,passed:20,reasons:{'small-range':15,transport:5}},privateURL:'https://private.example'},1000);
 const current=d.snapshot({epoch:2,diagnostics:{accelerated:137,passed:30,reasons:{'small-range':24,transport:6,'https://secret.example':99}}},3000);
 const report=d.deltaReport(current,previous);assert.ok(report.includes('新增接管 37 / 放行 10'));assert.ok(report.includes('范围小于 256 KiB: 9'));assert.ok(report.includes('子请求网络错误: 1'));
 assert.ok(!JSON.stringify(current).includes('secret'));assert.ok(!JSON.stringify(previous).includes('private'));assert.ok(report.includes('不是测速'));
});
test('epoch, version, clock or counter resets cannot create an invalid manual increment comparison',()=>{
 const d=context.BiliRangeDiagnostics,current=d.snapshot({epoch:2,diagnostics:{accelerated:10,passed:5}},2000),previous=d.snapshot({epoch:2,diagnostics:{accelerated:5,passed:2}},1000);
 for(const altered of [{...previous,epoch:1},{...previous,version:'old'},{...previous,at:3000},{...previous,accelerated:100},{...previous,passed:-1}]){
  const report=d.deltaReport(current,altered);assert.ok(report.includes('起点'));assert.ok(!report.includes('新增接管'));
 }
});
test('network-change entry always logs the applied epoch and preserves in-flight leases',()=>{
 let stored=JSON.stringify({epoch:2,hosts:{a:{bps:1}},leases:{pending:12345}}),logged,done;
 const ctx={Date,console:{log:s=>{logged=s;}},$persistentStore:{read:()=>stored,write:v=>{stored=v;return true;}},$done:v=>{done=v;},$request:{}};
 vm.runInNewContext(readFileSync('dist/lab/network-reset.bundle.js','utf8'),ctx);
 const state=JSON.parse(stored);assert.equal(state.epoch,3);assert.deepEqual(state.hosts,{});assert.equal(state.leases.pending,12345);
 assert.ok(logged.includes('网络epoch 2 → 3'));assert.equal(done.content,logged);
});
test('network-change write failure explicitly reports that reset did not complete',()=>{
 let logged,done;vm.runInNewContext(readFileSync('dist/lab/network-reset.bundle.js','utf8'),{Date,console:{log:s=>{logged=s;}},
  $persistentStore:{read:()=>'{"epoch":2}',write:()=>false},$done:v=>{done=v;}});
 assert.ok(logged.includes('未完成'));assert.ok(!logged.includes('处理完成'));assert.equal(done.content,logged);
});
test('network-change warming is bounded to2 DNS queries and never downloads video or stores resolver details',async()=>{
 let stored='{}',active=0,peak=0,doneCount=0;const domains=[];
 const result=await new Promise(resolve=>vm.runInNewContext(readFileSync('dist/lab/network-reset.bundle.js','utf8'),{Date,console:{log(){}},
  $argument:{Enabled:true,WarmDNS:true,PreferredCDN:'upos-sz-mirror08h.bilivideo.com'},
  $persistentStore:{read:()=>stored,write:v=>{stored=v;return true;}},$done:v=>{doneCount++;resolve(v);},
  $httpClient:{get(){throw Error('Unexpected video GET');}},$dns:{query(o,cb){domains.push(o.domain);active++;peak=Math.max(peak,active);
   assert.equal(o.timeout,1500);setImmediate(()=>{active--;cb(null,{fromCache:false,server:'192.168.0.1',answers:[{type:'A',value:'private-ip'}]});});}}}));
 assert.equal(domains.length,4);assert.equal(domains[0],'upos-sz-mirror08h.bilivideo.com');assert.equal(peak,2);assert.equal(doneCount,1);
 assert.equal(JSON.parse(stored).lastNetworkReset.warm.success,4);assert.ok(result.content.includes('DNS预热 4/4'));
 assert.ok(!stored.includes('192.168.0.1'));assert.ok(!stored.includes('private-ip'));
});
test('old warm callbacks cannot replace a newer network epoch reset',async()=>{
 let stored='{}';const callbacks=[];
 const result=new Promise(resolve=>vm.runInNewContext(readFileSync('dist/lab/network-reset.bundle.js','utf8'),{Date,console:{log(){}},
  $argument:{WarmDNS:true},$persistentStore:{read:()=>stored,write:v=>{stored=v;return true;}},$done:resolve,
  $dns:{query(o,cb){callbacks.push(cb);}}}));
 stored=JSON.stringify({...JSON.parse(stored),epoch:2,lastNetworkReset:{epoch:2,at:3000}});
 for(let i=0;i<4;i++){callbacks[i](null,{answers:[{type:'A'}]});await Promise.resolve();await Promise.resolve();}
 await result;assert.equal(JSON.parse(stored).lastNetworkReset.warm,undefined);assert.equal(JSON.parse(stored).epoch,2);
});
test('network-change script handles a null JSON argument and keeps a successful synchronous reset',()=>{
 let done=0;vm.runInNewContext(readFileSync('dist/lab/network-reset.bundle.js','utf8'),{Date,console:{log(){}},$argument:'null',
  $persistentStore:{read:()=>'{}',write:()=>true},$done(){done++;}});assert.equal(done,1);
});
