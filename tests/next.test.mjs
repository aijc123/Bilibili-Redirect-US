import test from 'node:test';
import assert from 'node:assert/strict';
import {next,namespace} from './helpers/channel.mjs';
import {harness,req,MiB,warm,host} from './helpers/adaptive-harness.mjs';
assert.equal(next,true,'run this suite with BILI_RANGE_CHANNEL=next');
async function ready(h,cap,time=()=>500){for(let i=0;i<8;i++)assert.equal((await h.run({elapsed:time})).count,cap);}
for(const cap of [2,3,4,5,6,7]){
 test(`sub-MiB exact ranges compare achievable ${Math.ceil(cap/2)}/${cap} tasks, then keep the smaller plateau`,async()=>{
  const bytes=cap===6?897932:cap*128*1024+17,low=Math.ceil(cap/2),h=harness({bytes});
  await ready(h,cap);const counts=[];
  for(let i=0;i<20;i++)counts.push((await h.run()).count);
  assert.deepEqual(counts,Array.from({length:5},()=>[low,cap,cap,low]).flat());
  const chosen=await h.run();assert.equal(chosen.count,low);assert.equal(chosen.state.adaptive.last.choice,low);
  assert.equal(chosen.state.adaptive.last.reason,'learned');
  assert.ok(chosen.state.measurements.samples.every(s=>s.minChunkKiB===128));
  assert.ok(chosen.state.measurements.samples.filter(s=>s.trial).every(s=>s.mode===(s.trial.arm==='A'?low:cap)));
  const small=await h.run({request:req(128*1024)});assert.deepEqual(small.state.adaptive.last,chosen.state.adaptive.last);
  assert.ok(!JSON.stringify(chosen.state).includes('private-token'));
 });
}
test('a six-task gain on 897932 bytes never triggers a size-capped 8/16 comparison',async()=>{
 const h=harness({bytes:897932}),time=n=>n===3?900:500;
 await ready(h,6,time);for(let i=0;i<20;i++)await h.run({elapsed:time});
 for(let i=0;i<5;i++)assert.equal((await h.run({elapsed:time})).count,6);
 const s=h.state();assert.equal(s.adaptive.last.choice,6);assert.equal(s.adaptive.last.reason,'learned');
 assert.ok(s.measurements.samples.filter(x=>x.trial).every(x=>x.trial.candidate===6));
});
test('changing the original explicit port cannot inherit the former endpoint preference',async()=>{
 const h=harness();await warm(h,()=>500);for(let i=0;i<20;i++)await h.run();
 assert.equal((await h.run()).count,4);
 const request={...req(MiB),url:req(MiB).url.replace('.net/','.net:4483/')};
 const other=await h.run({request});assert.equal(other.count,8);assert.equal(other.state.adaptive.last.reason,'warmup');
 assert.ok(!JSON.stringify(other.state).includes(':4483'));
});
test('a failed small-range block pauses only its signed endpoint and keeps every callback accounted for',async()=>{
 const h=harness({bytes:897932});await ready(h,6);const refused=await h.run({status:403});
 assert.equal(refused.count,3);assert.equal(refused.result.response,undefined);
 const s=h.state();assert.equal(Object.keys(s.trialSafety).length,1);assert.equal(Object.keys(s.leases).length,0);
 const t=h.context().BiliRangeTrials,request=req(897932),other={...request,url:request.url.replace('.net/','.net:4483/')};
 s.hosts={};assert.equal(t.permission(s,request,'3vs6',host,refused.clock+2000).allowed,false);
 assert.equal(t.permission(s,other,'3vs6',host,refused.clock+2000).allowed,true);
 assert.ok(!JSON.stringify(s).includes('private-token'));
});
test('a learned small-range choice returns to the size cap after a repeated latency regression',async()=>{
 const h=harness({bytes:897932});await ready(h,6);for(let i=0;i<20;i++)await h.run();
 assert.equal((await h.run()).count,3);
 for(let i=0;i<4;i++)assert.equal((await h.run({elapsed:()=>2000})).count,3);
 const reset=await h.run();assert.equal(reset.count,6);assert.equal(reset.state.adaptive.last.reason,'regression');
 const rest=await h.run();assert.equal(rest.count,6);assert.equal(rest.state.adaptive.last.reason,'rest');
});
test('new small-range trial labels are admitted only for the declared pairs',async()=>{
 const h=harness({bytes:897932});await h.run();const m=h.context().BiliRangeMeasurements;
 const label=(mode,a,b)=>({block:'0|abcdef01|'+mode+'|0',slot:0,arm:'A',baseline:a,candidate:b});
 assert.ok(m.sanitizeTrial(label('3vs6',3,6)));assert.ok(m.sanitizeTrial(label('1vs2',1,2)));
 assert.equal(m.sanitizeTrial(label('1vs32',1,32)),null);assert.equal(m.sanitizeTrial(label('3vs6',3,32)),null);
 assert.ok(namespace.includes('.preview.'));
});
test('a grossly slow exploratory lower arm stops after one clean block and rests on the default upper arm',async()=>{
 const h=harness({bytes:897932}),time=n=>n===3?2200:500;
 await ready(h,6,time);for(let i=0;i<4;i++)await h.run({elapsed:time});
 const stop=await h.run({elapsed:time});assert.equal(stop.count,6);assert.equal(stop.state.adaptive.last.reason,'probe-loss');
 const rest=await h.run({elapsed:time});assert.equal(rest.count,6);assert.equal(rest.state.adaptive.last.reason,'rest');
 assert.equal(rest.state.measurements.samples.filter(s=>s.trial).length,4);
});
test('an old-network initial response cannot replace a newer network SIDX estimate',async()=>{
 const bytes=new Uint8Array(MiB),view=new DataView(bytes.buffer);
 view.setUint32(0,16);bytes.set([102,116,121,112],4);
 const at=16;view.setUint32(at,80);bytes.set([115,105,100,120],at+4);view.setUint32(at+16,1000);view.setUint16(at+30,4);
 for(let i=0;i<4;i++){view.setUint32(at+32+i*12,500000);view.setUint32(at+36+i*12,2000);}
 const h=harness({entityData:bytes});let current;
 const result=await h.run({afterStart(s,save){
  const content=h.context().BiliRangeMeasurements.identity(s,req(MiB));
  current={epoch:1,content,at:102050,averageMbps:9,p90SegmentMbps:10,maxSegmentMbps:11,segments:4,durationSeconds:8,type:'video'};
  s.epoch=1;s.mediaInfos=[current];save(s);
 }});
 assert.equal(result.result.response.status,206);assert.deepEqual(result.state.mediaInfos,[current]);
});
async function burst(h){for(let i=0;i<3;i++)await h.run({fail:true,gap:3000});}
test('three same-media transport failures stop takeover without another HTTP request or extending the pause',async()=>{
 const h=harness();await burst(h);const start=h.state().measurements.samples.at(-1).at;
 for(let i=0;i<3;i++){
  const rested=await h.run();assert.equal(rested.count,0);assert.equal(rested.result.response,undefined);
  assert.equal(rested.state.protection.last.until,start+15000);
  assert.ok(rested.state.diagnostics.reasons['transport-rest']>=1);
  assert.equal(Object.keys(rested.state.leases).length,0);
 }
 assert.ok(!JSON.stringify(h.state()).includes('private-token'));
});
test('after transport rest two solo unsplit successes leave protection while ordinary error shrink remains',async()=>{
 const h=harness();await burst(h);const first=await h.run({gap:16000});assert.equal(first.count,1);
 assert.equal(first.state.protection.last.phase,'probe');
 const second=await h.run();assert.equal(second.count,1);assert.equal(second.state.protection.last.phase,'normal');
 const normal=await h.run();assert.ok(normal.count>=4);assert.equal(normal.state.protection.last.phase,'normal');
});
test('busy recovery checks defer without stealing another request lease',async()=>{
 const h=harness();await burst(h);const s=h.state();
 s.leases.other={expires:s.measurements.samples.at(-1).at+23000,jobs:4,bytes:MiB};h.set(s);
 const waiting=await h.run({gap:16000});assert.equal(waiting.count,0);
 assert.equal(waiting.state.leases.other.jobs,4);assert.equal(waiting.state.protection.last.phase,'probe');
});
test('transport rest cannot cross a representation, protocol, network epoch or stale evidence',async()=>{
 const h=harness();await burst(h);const stopped=h.state();
 for(const request of [{...req(MiB),url:req(MiB).url.replace('private-representation','another-representation')},
  {...req(MiB),url:req(MiB).url.replace('https:','http:')}]){
  h.set(stopped);const other=await h.run({request});assert.ok(other.count>0);assert.notEqual(other.state.protection.last.phase,'rest');
 }
 h.set({...stopped,epoch:1});const network=await h.run();assert.ok(network.count>0);assert.notEqual(network.state.protection.last.phase,'rest');
 h.set(stopped);const expired=await h.run({gap:61000});assert.ok(expired.count>0);assert.equal(expired.state.protection.last.phase,'normal');
});
test('one isolated transport failure never starts the burst circuit',async()=>{
 const h=harness();await h.run({fail:true});const good=await h.run();assert.ok(good.count>0);
 assert.equal(good.state.protection.last.phase,'normal');
});
test('old in-flight or overlapping single responses cannot count as two independent recovery checks',async()=>{
 const h=harness();await burst(h);const original=h.state(),api=h.context().BiliRangeReliability;
 const last=original.measurements.samples.at(-1),at=last.at;
 for(const intervals of [[[at-200,at+200],[at-100,at+300]],[[at+100,at+500],[at+200,at+600]]]){
  const s=structuredClone(original);
  s.measurements.samples.push(...intervals.map(([from,end])=>({...last,at:end,from,ok:true,reason:'ok',mode:1,bytes:MiB,inflight:0})));
  assert.equal(api.condition(s,req(MiB),at+1000).phase,'rest');
 }
 const s=structuredClone(original);
 s.measurements.samples.push(...[[at+100,at+500],[at+600,at+900]].map(([from,end])=>({...last,at:end,from,ok:true,reason:'ok',mode:1,bytes:MiB,inflight:0})));
 assert.equal(api.condition(s,req(MiB),at+1000).phase,'normal');
});
