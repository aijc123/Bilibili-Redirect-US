import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const ctx={Uint8Array,Date,console};
for(const path of ['vendor/btr-0302b345/range-core.js','src/accelerator/range-core.js','src/accelerator/measurements.js','src/accelerator/trials.js','src/accelerator/diagnostics.js'])vm.runInNewContext(readFileSync(path,'utf8'),ctx);
const api=ctx.BiliRangeTrials,measure=ctx.BiliRangeMeasurements;
const request={method:'GET',url:'https://upos-sz-mirror08c.bilivideo.com/upgcxcode/private-path.m4s?upsig=secret',headers:{Range:'bytes=0-1048575'}};
const sample=(state,slot,elapsed,ok=true,inflight=0)=>{
 const plan=api.plan(state,request,'4vs8',1000+slot*2000,()=>0.9);state.trials=plan.next;
 const from=1000+slot*2000;
 measure.record(state,request,{kind:ok?'response':'pass',reason:ok?undefined:'transport',metrics:{host:'upos-sz-mirror08c.bilivideo.com',bytes:1048576,elapsedMs:elapsed,startedAt:from,finishedAt:from+elapsed,connections:plan.connections}}, {epoch:state.epoch||0,inflight,trial:plan.trial});
 return plan;
};
test('balanced blocks alternate ABBA and BAAB without downloading extra media',()=>{
 for(const [random,expected] of [[()=>0.9,[4,8,8,4]],[()=>0.1,[8,4,4,8]]]){
  const state={},modes=[];for(let i=0;i<4;i++){const p=api.plan(state,request,'4vs8',1000+i,random);modes.push(p.connections);state.trials=p.next;}
  assert.deepEqual(modes,expected);assert.ok(!JSON.stringify(state).includes('private-path'));assert.ok(!JSON.stringify(state).includes('secret'));
 }
 assert.equal(api.plan({},request,'off'),null);
});
test('8-based modes preserve exact pair labels and reject inconsistent or inherited mode keys',()=>{
 for(const [mode,expected] of [['8vs16',[8,16,16,8]],['8vs32',[8,32,32,8]]]){
  const state={},actual=[];for(let i=0;i<4;i++){const p=api.plan(state,request,mode,1000+i,()=>0.9);state.trials=p.next;actual.push(p.connections);assert.equal(measure.sanitizeTrial(p.trial).baseline,8);}
  assert.deepEqual(actual,expected);
 }
 assert.equal(measure.sanitizeTrial({block:'0|12345678|4vs8|0',arm:'A',slot:0,baseline:8,candidate:32}),null);
 assert.equal(api.plan({},request,'toString'),null);
});
test('constant linear time drift cancels in a balanced clean block',()=>{
 const state={};for(let i=0;i<4;i++)sample(state,i,500+i*100);
 const a=measure.analyze(state,10000).trials;
 assert.equal(a.groups.length,1);assert.equal(a.groups[0].cleanBlocks,1);
 // Median rates, unlike median durations, do not exactly cancel a nonlinear reciprocal.
 assert.ok(Math.abs(a.groups[0].ratio-1)<0.06);assert.equal(a.groups[0].interval,null);
});
test('matched blocks report gain with reproducible bounded resampling uncertainty',()=>{
 const state={};for(let i=0;i<24;i++)sample(state,i,[1000,500,500,1000][i%4]);
 const a=measure.analyze(state,50000).trials.groups[0];assert.equal(a.cleanBlocks,6);assert.equal(a.ratio,2);
 assert.deepEqual(Array.from(a.interval),[2,2]);assert.equal(a.failureB,0);
});
test('different load, byte count or missing slot invalidates a block',()=>{
 const state={};for(let i=0;i<4;i++)sample(state,i,1000,true,i===2?1:0);
 const a=measure.analyze(state,10000).trials;assert.equal(a.groups.length,0);assert.equal(a.mismatched,1);
 const missing={};for(let i=0;i<3;i++)sample(missing,i,1000);assert.equal(measure.analyze(missing,10000).trials.incomplete,1);
});
test('failure blocks keep both-arm error rates and do not count as clean speed comparisons',()=>{
 const state={};for(let i=0;i<4;i++)sample(state,i,[1000,4000,3000,2000][i],i!==1);
 const g=measure.analyze(state,10000).trials.groups[0];assert.equal(g.blocks,1);assert.equal(g.cleanBlocks,0);assert.equal(g.failureB,0.5);assert.equal(g.ratio,null);
 assert.equal(g.p90MsA,1900);assert.ok(g.p90MsB>3000);assert.ok(measure.report(state,10000).includes('含失败'));
});
test('same effective parallelism is labelled equivalent and cannot prove configured32 faster',()=>{
 const state={};for(let i=0;i<4;i++)sample(state,i,1000);
 for(const s of state.measurements.samples)s.mode=4;
 const g=measure.analyze(state,10000).trials.groups[0];assert.equal(g.equivalent,true);
 assert.ok(measure.report(state,10000).includes('实际并发相同'));
});
test('untrusted extra trial fields and labels cannot enter local storage',()=>{
 const state={};measure.record(state,request,{kind:'response',metrics:{host:'upos-sz-mirror08c.bilivideo.com',bytes:1048576,elapsedMs:500,connections:4,finishedAt:1000}},
 {trial:{block:'secret-url',slot:0,arm:'A',baseline:4,candidate:8,path:'private-path'}});
 assert.ok(!JSON.stringify(state).includes('secret'));assert.ok(!JSON.stringify(state).includes('private-path'));
});
test('published adapter compares existing requests on fixed preferred CDN without replay',async()=>{
 let stored='{}';const counts=[];const mockMath=Object.create(Math);mockMath.random=()=>0.9;
 for(let i=0;i<4;i++){
  let count=0;
  const result=await new Promise(resolve=>vm.runInNewContext(readFileSync('dist/lab/range.bundle.js','utf8'),{Uint8Array,Date,Math:mockMath,console,
   $request:request,$argument:{TrialMode:'4vs8',Connections:32,AutoCDN:true,PreferredCDN:'upos-sz-mirrorali.bilivideo.com'},
   $persistentStore:{read:()=>stored,write:v=>{stored=v;return true;}},$done:resolve,
   $httpClient:{get(o,cb){count++;assert.ok(o.url.startsWith('https://upos-sz-mirrorali.bilivideo.com/'));const r=ctx.BiliRange.parseRange(o.headers.Range);
    cb(null,{status:206,headers:{'Content-Range':`bytes ${r.start}-${r.end}/2097152`}},new Uint8Array(r.length));}}}));
  assert.equal(result.response.status,206);counts.push(count);
 }
 assert.deepEqual(counts,[4,8,8,4]);assert.equal(JSON.parse(stored).measurements.samples.length,4);
 assert.equal(Object.values(JSON.parse(stored).trials.groups)[0].counter,4);
 assert.ok(!stored.includes('private-path'));assert.ok(!stored.includes('upsig'));
});
test('published 8vs32 adapter actually runs 8/32/32/8 jobs on matched 1MiB with a32KiB floor',async()=>{
 let stored='{}';const counts=[];const mockMath=Object.create(Math);mockMath.random=()=>0.9;
 for(let i=0;i<4;i++){
  let count=0;
  const result=await new Promise(resolve=>vm.runInNewContext(readFileSync('dist/lab/range.bundle.js','utf8'),{Uint8Array,Date,Math:mockMath,console,
   $request:request,$argument:{TrialMode:'8vs32',Connections:4,MinChunkKiB:32,GlobalJobs:32,AutoCDN:true,PreferredCDN:'upos-sz-mirror08c.bilivideo.com'},
   $persistentStore:{read:()=>stored,write:v=>{stored=v;return true;}},$done:resolve,
   $httpClient:{get(o,cb){count++;const r=ctx.BiliRange.parseRange(o.headers.Range);cb(null,{status:206,headers:{'Content-Range':`bytes ${r.start}-${r.end}/2097152`}},new Uint8Array(r.length));}}}));
  assert.equal(result.response.status,206);counts.push(count);
 }
 assert.deepEqual(counts,[8,32,32,8]);const state=JSON.parse(stored),groups=measure.analyze(state).trials.groups;
 assert.equal(groups.length,1);assert.equal(groups[0].baseline,8);assert.equal(groups[0].candidate,32);assert.equal(groups[0].actualA,8);assert.equal(groups[0].actualB,32);
 assert.equal(state.measurements.samples.length,4);assert.ok(!stored.includes('private-path'));assert.ok(!stored.includes('upsig'));
});
