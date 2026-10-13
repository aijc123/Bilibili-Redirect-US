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
test('network-change entry always logs the applied epoch and preserves in-flight leases',()=>{
 let stored=JSON.stringify({epoch:2,hosts:{a:{bps:1}},leases:{pending:12345}}),logged,done;
 const ctx={Date,console:{log:s=>{logged=s;}},$persistentStore:{read:()=>stored,write:v=>{stored=v;return true;}},$done:v=>{done=v;},$request:{}};
 vm.runInNewContext(readFileSync('dist/lab/network-reset.bundle.js','utf8'),ctx);
 const state=JSON.parse(stored);assert.equal(state.epoch,3);assert.deepEqual(state.hosts,{});assert.equal(state.leases.pending,12345);
 assert.ok(logged.includes('网络epoch 2 → 3'));assert.equal(done.content,logged);
});
