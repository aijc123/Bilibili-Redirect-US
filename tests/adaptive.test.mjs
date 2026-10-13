import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const bundle=readFileSync('dist/candidate/range.bundle.js','utf8');
const version=JSON.parse(readFileSync('src/loon/adaptive.json','utf8')).version;
const host='upos-sz-mirror08c.bilivideo.com',MiB=1024*1024;
const req=bytes=>({method:'GET',url:'https://upos-hz-mirrorakam.akamaized.net/upgcxcode/private-representation.m4s?upsig=private-token',headers:{Range:`bytes=0-${bytes-1}`}});
function harness({bytes=MiB,initial={}}={}){
 let stored=JSON.stringify(initial),clock=100000,context;
 const entity=Uint8Array.from({length:bytes},(_,i)=>i%251);
 return {state:()=>JSON.parse(stored),context:()=>context,set:s=>{stored=JSON.stringify(s);},
  async run({elapsed=()=>500,fail=false,request=req(bytes),afterStart,arg={Enabled:true},gap=2000,responseHeaders={},status=206,noAt=false}={}){
   clock+=gap;const start=clock,tasks=[];let doneCalls=0;
   let finish;const completed=new Promise(r=>finish=r),math=Object.create(Math);math.random=()=>0.9;
   context={Uint8Array,Date:{now:()=>clock},Math:math,console:{log(){}},$argument:arg,$request:request,
    $persistentStore:{read:()=>stored,write:v=>{stored=v;return true;}},$done:o=>{doneCalls++;finish(o);},
    $httpClient:{get(o,cb){tasks.push({o,cb});}}};
   vm.runInNewContext((noAt?'Array.prototype.at=undefined;\n':'')+bundle,context);await new Promise(r=>setImmediate(r));
   afterStart?.(JSON.parse(stored),v=>{stored=JSON.stringify(v);},start);
   clock=start+elapsed(tasks.length);
   for(const {o,cb} of tasks){
    assert.match(o.url,/^https?:\/\/(?:upos-sz-[a-z0-9-]+|cn-hk-eq-[a-z0-9-]+)\.bilivideo\.com\//);
    assert.equal(new URL(o.url).pathname+new URL(o.url).search,new URL(request.url).pathname+new URL(request.url).search);
    const [,a,b]=/bytes=(\d+)-(\d+)/.exec(o.headers.Range),from=Number(a),to=Number(b);
    if(fail){cb('network failure',null,null);continue;}
    cb(null,{status,headers:{'Content-Range':`bytes ${from}-${to}/${8*MiB}`,...responseHeaders}},
     entity.subarray(from,to+1));
   }
   const result=await completed;assert.equal(doneCalls,1);
   if(result.response)assert.deepEqual(result.response.body,entity);
   return {count:tasks.length,result,state:JSON.parse(stored),clock};
  }};
}
async function warm(h,elapsed){for(let i=0;i<8;i++)assert.equal((await h.run({elapsed})).count,8);}

test('candidate retains one switch, pinned own scripts, independent state and unchanged cold start',async()=>{
 const p=readFileSync('dist/candidate/BiliBili.Range.Adaptive.plugin','utf8');
 assert.equal(p.split('[Argument]')[1].split('[General]')[0].trim().split('\n').length,1);
 assert.ok(p.includes('range-v'+version+'/dist/candidate/'));
 assert.ok(bundle.includes('aijc123.BiliRange.adaptive.v1'));assert.ok(!bundle.includes('aijc123.BiliRange.lab.v1'));
 const h=harness();await warm(h,()=>500);
 assert.equal(h.state().trials,undefined);assert.ok(!JSON.stringify(h.state()).includes('private-token'));
 assert.ok(!JSON.stringify(h.state()).includes('private-representation'));
});

test('real generated candidate runs five balanced exact-byte blocks then reduces plateau to4',async()=>{
 const h=harness();await warm(h,()=>500);const counts=[];
 for(let i=0;i<20;i++)counts.push((await h.run()).count);
 assert.deepEqual(counts,Array.from({length:5},()=>[4,8,8,4]).flat());
 const next=await h.run();assert.equal(next.count,4);assert.equal(next.state.adaptive.last.reason,'learned');
 assert.equal(next.state.measurements.samples.at(-1).trial,undefined);
 assert.ok(h.context().BiliRangeDiagnostics.summary(h.state(),next.clock).includes('同条件观察选择'));
});

test('gain threshold and tail guard allow16 then32 only on an actual4MiB request',async()=>{
 const h=harness({bytes:4*MiB}),time=n=>Math.round(1000/Math.sqrt(n/4));await warm(h,time);
 for(let i=0;i<60;i++)await h.run({elapsed:time});
 const n=await h.run({elapsed:time});assert.equal(n.count,32);assert.equal(n.state.adaptive.last.choice,32);
 const modes=new Set(n.state.measurements.samples.filter(s=>s.trial).map(s=>s.trial.baseline+':'+s.trial.candidate));
 assert.deepEqual([...modes].sort(),['16:32','4:8','8:16']);
 assert.ok(n.state.measurements.samples.every(s=>s.minChunkKiB===128));
});

test('1MiB improvement never manufactures16/32 pieces or promotes a size-capped comparison',async()=>{
 const h=harness(),time=n=>n===4?800:500;await warm(h,time);
 for(let i=0;i<20;i++)await h.run({elapsed:time});
 for(let i=0;i<4;i++)assert.equal((await h.run({elapsed:time})).count,8);
 const samples=h.state().measurements.samples;assert.ok(samples.every(s=>s.mode<=8));
 assert.ok(samples.filter(s=>s.trial).every(s=>s.trial.candidate===8));
});

test('transport failures stop comparison; old-network samples cannot teach the new epoch',async()=>{
 const h=harness();await warm(h,()=>500);await h.run({fail:true});
 const n=await h.run();assert.equal(n.state.measurements.samples.at(-1).trial,undefined);
 const s=h.state();s.epoch=1;h.set(s);const fresh=await h.run();
 assert.equal(fresh.count,8);assert.equal(fresh.state.adaptive.last.reason,'warmup');
 assert.ok(Object.keys(fresh.state.adaptive.entries).every(k=>k.startsWith('1|')));
});

test('later network reset survives an old callback without learning or restoring old state',async()=>{
 const h=harness();await warm(h,()=>500);
 const r=await h.run({afterStart(s,save){s.epoch=1;s.hosts={};s.adaptive={schema:1,entries:{}};save(s);}});
 assert.equal(r.state.epoch,1);assert.equal(r.state.adaptive.last,undefined);
 assert.equal(Object.keys(r.state.adaptive.entries).length,0);assert.equal(Object.keys(r.state.hosts).length,0);
});

test('live competing lease invalidates probe evidence even if its callback has not finished',async()=>{
 const h=harness();await warm(h,()=>500);
 const r=await h.run({afterStart(s,save,start){s.leases.other={expires:start+7000,jobs:8,bytes:MiB};save(s);}});
 const sample=r.state.measurements.samples.at(-1);assert.ok(sample.trial);assert.equal(sample.inflight,1);
 assert.equal(r.state.leases.other.jobs,8);
});

test('admission-truncated arms cannot establish a concurrency preference',async()=>{
 const h=harness();await warm(h,()=>500);
 for(let i=0;i<20;i++)await h.run();
 const s=h.state();for(const x of s.measurements.samples)if(x.trial)x.mode=x.trial.arm==='A'?2:4;
 h.set(s);const n=await h.run();assert.equal(n.count,8);assert.equal(n.state.adaptive.last.reason,'inconclusive');
});

test('completed8 versus16 that adds delay is rested before exhausting all20 probes',async()=>{
 const h=harness({bytes:2*MiB}),time=n=>n===4?800:n===8?500:1000;await warm(h,time);
 for(let i=0;i<24;i++)await h.run({elapsed:time});
 const n=await h.run({elapsed:time});assert.equal(n.count,8);assert.equal(n.state.adaptive.last.reason,'probe-loss');
 const rest=await h.run({elapsed:time});assert.equal(rest.count,8);assert.equal(rest.state.adaptive.last.reason,'rest');
});

test('old small requests and disabled acceleration never create probe traffic',async()=>{
 const h=harness({bytes:100000});const r=await h.run();assert.equal(r.count,0);assert.equal(r.result.response,undefined);
 assert.equal(r.state.trials,undefined);
 const disabled=harness();const off=await disabled.run({arg:{Enabled:false}});assert.equal(off.count,0);assert.equal(off.state.trials,undefined);
});

test('a learned lower preference regressing for four complete requests restores8 and rests',async()=>{
 const h=harness();await warm(h,()=>500);for(let i=0;i<20;i++)await h.run();
 assert.equal((await h.run()).count,4);
 for(let i=0;i<4;i++)assert.equal((await h.run({elapsed:()=>2000})).count,4);
 const reset=await h.run();assert.equal(reset.count,8);assert.equal(reset.state.adaptive.last.reason,'regression');
 const rest=await h.run();assert.equal(rest.count,8);assert.equal(rest.state.adaptive.last.reason,'rest');
});

test('probes are spaced; ambiguous completed blocks cannot imply a gain',async()=>{
 const h=harness();await warm(h,()=>500);await h.run();
 const r=await h.run({gap:0});assert.equal(r.count,8);assert.equal(r.state.adaptive.last.reason,'probe-spacing');
 const api=h.context().BiliRangeAdaptive,m=h.context().BiliRangeMeasurements;
 const state=h.state(),scope=api.scope(state,req(MiB),host,MiB),samples=[];
 for(let block=0;block<5;block++)for(let slot=0;slot<4;slot++){
  const arm=[0,1,1,0][slot],elapsed=arm?(block===0?3000:400):500;
  samples.push({epoch:0,content:m.identity(state,req(MiB)),host,rangeBytes:MiB,inflight:0,requestedALPN:'h1',minChunkKiB:128,
   at:10000+block*10000+slot*1000+elapsed,from:10000+block*10000+slot*1000,elapsedMs:elapsed,bytes:MiB,ok:true,mode:arm?8:4,
   trial:{block:`0|${scope.token}|4vs8|${block}`,slot,arm:arm?'B':'A',baseline:4,candidate:8}});
 }
 assert.equal(api.evidence(samples,scope.token,0,'4vs8').choice,null);
});

test('exhausted old comparison counter expires instead of suppressing learning forever',async()=>{
 const h=harness();await warm(h,()=>500);for(let i=0;i<20;i++)await h.run();
 const s=h.state();for(const v of Object.values(s.trials.groups))v.at=-900000;
 s.measurements.samples=s.measurements.samples.filter(x=>!x.trial);h.set(s);
 const retry=await h.run();assert.equal(retry.count,4);assert.equal(retry.state.adaptive.last.reason,'compare');
});

test('changed scheme, signature or observed entity cannot inherit the former preference',async()=>{
 const h=harness();await warm(h,()=>500);for(let i=0;i<20;i++)await h.run();
 const selected=await h.run();assert.equal(selected.count,4);const learned=h.state();
 const http=await h.run({request:{...req(MiB),url:req(MiB).url.replace('https:','http:')}});
 assert.equal(http.count,8);assert.equal(http.state.adaptive.last.reason,'warmup');
 h.set(learned);const signature=await h.run({request:{...req(MiB),url:req(MiB).url.replace('private-token','new-private-token')}});
 assert.equal(signature.count,8);assert.equal(signature.state.adaptive.last.reason,'warmup');
 h.set(learned);await h.run({responseHeaders:{ETag:'private-validator'}});
 const entity=await h.run({responseHeaders:{ETag:'private-validator'}});
 assert.equal(entity.count,8);assert.equal(entity.state.adaptive.last.reason,'warmup');
 assert.ok(!JSON.stringify(entity.state).includes('private-validator'));
});

test('recent same-node server429 holds4 without learning, then expires',async()=>{
 const h=harness();await warm(h,()=>500);const refused=await h.run({status:429});
 assert.equal(refused.result.response,undefined);assert.equal(refused.state.measurements.samples.at(-1).reason,'status-429');
 const s=h.state();s.hosts={[host]:{at:refused.clock,bps:2000000,failures:0,blockedUntil:0}};h.set(s);
 const held=await h.run();assert.equal(held.count,4);assert.equal(held.state.adaptive.last.reason,'pushback');
 assert.equal(held.state.measurements.samples.at(-1).trial,undefined);
 const expired=await h.run({gap:181000});assert.equal(expired.count,8);assert.equal(expired.state.adaptive.last.reason,'warmup');
});

test('candidate full download does not require Array.at in an older JavaScript runtime',async()=>{
 const h=harness();const result=await h.run({noAt:true});assert.equal(result.count,8);assert.equal(result.result.response.status,206);
});

test('a solo learned16 preference is not reused for a competing live request',async()=>{
 const h=harness({bytes:2*MiB}),time=n=>n===4?800:n===8?500:300;
 await warm(h,time);for(let i=0;i<40;i++)await h.run({elapsed:time});
 const selected=await h.run({elapsed:time});assert.equal(selected.count,16);
 const s=h.state();s.leases.other={expires:selected.clock+7000,jobs:2,bytes:256*1024};h.set(s);
 const busy=await h.run({elapsed:time});assert.equal(busy.count,8);
 assert.equal(busy.state.adaptive.last.reason,'busy');assert.equal(busy.state.measurements.samples.at(-1).trial,undefined);
 assert.equal(busy.state.leases.other.jobs,2);
 const restored=busy.state;delete restored.leases.other;h.set(restored);
 const quiet=await h.run({elapsed:time});assert.equal(quiet.count,16);assert.equal(quiet.state.adaptive.last.reason,'learned');
});
