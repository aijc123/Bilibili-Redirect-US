import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const ctx={Uint8Array,Date,console};
for(const path of ['vendor/btr-0302b345/range-core.js','src/accelerator/range-core.js','src/accelerator/budget.js'])vm.runInNewContext(readFileSync(path,'utf8'),ctx);
const budget=ctx.BiliRangeBudget;
const MiB=1024*1024;
test('four 1MiB requests can use 32 total jobs without making 32 tiny pieces each',()=>{
 let leases={};
 for(let i=0;i<4;i++){
  const a=budget.admit({leases,now:1000,bytes:MiB,wanted:8,globalJobs:32,id:String(i)});
  assert.equal(a.ok,true);assert.equal(a.count,8);assert.equal(a.jobs,(i+1)*8);leases=a.leases;
 }
 const a=budget.admit({leases,now:1000,bytes:MiB,wanted:8,globalJobs:32,id:'5'});
 assert.equal(a.ok,false);assert.equal(a.reason,'budget-requests');
});
test('jobs and buffered bytes are separate admission constraints',()=>{
 const first=budget.admit({leases:{},now:1000,bytes:MiB,wanted:8,globalJobs:8,id:'a'});
 assert.equal(budget.admit({leases:first.leases,now:1000,bytes:MiB,wanted:8,globalJobs:8,id:'b'}).reason,'budget-jobs');
 const big=budget.admit({leases:{},now:1000,bytes:4*MiB,wanted:4,id:'a'});
 assert.equal(budget.admit({leases:big.leases,now:1000,bytes:MiB,wanted:4,id:'b'}).reason,'budget-bytes');
});
test('remaining jobs reduce a batch rather than exceed the shared budget',()=>{
 const first=budget.admit({leases:{},now:1000,bytes:MiB,wanted:6,globalJobs:8,id:'a'});
 const second=budget.admit({leases:first.leases,now:1000,bytes:MiB,wanted:6,globalJobs:8,id:'b'});
 assert.equal(second.ok,true);assert.equal(second.count,2);assert.equal(second.jobs,8);
});
test('expired leases are cleared and old numeric leases are conservative',()=>{
 const a=budget.active({expired:900,old:1500,bad:{expires:999999},valid:{expires:1900,jobs:8,bytes:MiB}},1000);
 assert.deepEqual(Object.keys(a),['old','valid']);assert.equal(a.old.jobs,4);
});
for(const [length,configured,effective] of [[MiB,32,8],[2*MiB,32,16],[4*MiB,32,32],[MiB,16,8],[MiB,6,6]])
 test(`byte equality: configured ${configured}, ${length/MiB}MiB, effective ${effective}`,async()=>{
  const source=Uint8Array.from({length},(_,i)=>(i*37+19)%251),seen=[];
  const result=await ctx.BiliRange.accelerate({request:{method:'GET',url:'https://upos-sz-mirror08c.bilivideo.com/upgcxcode/test.m4s',headers:{Range:`bytes=0-${length-1}`}},
   options:{connections:configured,maxBytes:4*MiB},fetchRange:async o=>{seen.push(o.part);return {status:206,headers:{'Content-Range':`bytes ${o.part.start}-${o.part.end}/${length+MiB}`,'Content-Type':'video/mp4'},body:source.slice(o.part.start,o.part.end+1)};}});
  assert.equal(result.kind,'response');assert.equal(seen.length,effective);assert.equal(result.metrics.configuredConnections,configured);
  assert.ok(seen.every(p=>p.end-p.start+1>=128*1024));assert.deepEqual(result.response.body,source);
 });
test('end-to-end shared storage admission permits four requests then releases all leases',async()=>{
 let stored='{}';const callbacks=[],completed=[],bundle=readFileSync('dist/lab/range.bundle.js','utf8');
 const launch=()=>new Promise(resolve=>vm.runInNewContext(bundle,{Uint8Array,Date,console,$argument:{Connections:32,GlobalJobs:32,AutoCDN:false},
  $request:{method:'GET',url:'https://upos-sz-mirror08c.bilivideo.com/upgcxcode/test.m4s',headers:{Range:'bytes=0-1048575'}},
  $persistentStore:{read:()=>stored,write:v=>{stored=v;return true;}},$done:resolve,
  $httpClient:{get(o,cb){callbacks.push(()=>{const r=ctx.BiliRange.parseRange(o.headers.Range);cb(null,{status:206,headers:{'Content-Range':`bytes ${r.start}-${r.end}/2097152`}},new Uint8Array(r.length));});}}}));
 for(let i=0;i<5;i++)completed.push(launch());
 await Promise.resolve();await Promise.resolve();
 assert.equal(callbacks.length,32);assert.equal(Object.keys(JSON.parse(stored).leases).length,4);
 for(const callback of callbacks)callback();
 const results=await Promise.all(completed);assert.equal(results.filter(r=>r.response).length,4);
 assert.equal(Object.keys(JSON.parse(stored).leases).length,0);
 assert.equal(JSON.parse(stored).diagnostics.reasons['budget-requests'],1);
});
