/* Run the published candidate adapter on real local HTTP. Not phone evidence. */
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createFixture} from './loopback-fixture.mjs';
const source=readFileSync('dist/candidate/range.bundle.js','utf8'),size=1024*1024;
const primitive={Uint8Array};vm.runInNewContext(readFileSync('vendor/btr-0302b345/range-core.js','utf8'),primitive);
const fixture=await createFixture({size,parseRange:primitive.__BILI_RANGE_CORE__.parseRangeHeader});
const modes=[];
try{
 for(const [profile,tokens] of [['single-job-limit',32],['shared-link-limit',4]]){
  fixture.setTokens(tokens);let stored='{}';const rows=[];
  for(let i=0;i<30;i++){
   // Honor the actual candidate spacing. No fake clock or altered thresholds.
   const s=JSON.parse(stored),last=(s.measurements?.samples||[]).filter(x=>x.trial).at(-1);
   if(last){const wait=last.at+1550-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));}
   fixture.resetPeak();let calls=0,finish;
   const completed=new Promise(r=>finish=r),started=Date.now();
   const ctx={Uint8Array,Date,console:{log(){}},$argument:{Enabled:true},
    $request:{method:'GET',url:'https://upos-hz-mirrorakam.akamaized.net/upgcxcode/fixture.m4s',headers:{Range:`bytes=0-${size-1}`}},
    $persistentStore:{read:()=>stored,write:v=>{stored=v;return true;}},$done:finish,
    $httpClient:{get(options,cb){calls++;fixture.fetchRange(options).then(r=>cb(null,{status:r.status,headers:r.headers},r.body),e=>cb(e.message,null,null));}}};
   vm.runInNewContext(source,ctx);const result=await completed;
   assert.equal(result.response?.status,206);assert.deepEqual(Buffer.from(result.response.body),fixture.entity);
   const state=JSON.parse(stored),sample=state.measurements.samples.at(-1);
   assert.equal(sample.mode,calls);assert.equal(fixture.peak(),calls);
   rows.push({request:i+1,bytes:size,elapsedMs:Date.now()-started,actualJobs:calls,
    reason:state.adaptive.last.reason,trial:sample.trial?.arm||null});
   if(i%10===9)console.log(`${profile}: ${i+1} complete byte-checked requests; ${calls} actual jobs`);
  }
  const final=JSON.parse(stored);modes.push({profile,chosen:final.adaptive.last.choice,reason:final.adaptive.last.reason,rows});
 }
 const result={scope:'Real loopback HTTP candidate evaluation only. NOT Bilibili, iPhone or playback evidence.',
  generatedAt:new Date().toISOString(),version:JSON.parse(readFileSync('src/loon/adaptive.json','utf8')).version,bytes:size,
  artifactSHA256:createHash('sha256').update(source.replace(/\r\n/g,'\n')).digest('hex'),
  environment:{node:process.version,platform:process.platform},parameters:{tickMs:16,perJobBytesPerTick:16384,initialDelayMs:120,sharedLinkBytesPerTick:65536},modes};
 mkdirSync('benchmarks',{recursive:true});writeFileSync('benchmarks/adaptive-fixture.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(modes.map(({profile,chosen,reason})=>({profile,chosen,reason}))));
}finally{await fixture.close();}
