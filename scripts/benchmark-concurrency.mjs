// Real loopback HTTP with deliberate fixture limits. Never a CDN/iPhone benchmark.
import {createFixture} from './loopback-fixture.mjs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const context={Uint8Array,Date};
for(const p of ['vendor/btr-0302b345/range-core.js','src/loon/range-download.js'])vm.runInNewContext(readFileSync(p,'utf8'),context);
const small=process.argv.includes('--small'),minChunkKiB=small?32:128;
const core=context.BiliRange,size=(small?1:4)*1024*1024;
const fixture=await createFixture({size,parseRange:core.parseRange}),{entity,fetchRange}=fixture;
const measurements=[];
try{
 for(const profile of ['single-job-limit','shared-link-limit']){
  fixture.setTokens(profile==='shared-link-limit'?4:32);
  // Alternate order across rounds to expose drift rather than always warm from 1 to32.
  for(let round=0;round<3;round++)for(const connections of round%2?[32,16,8,4,2,1]:[1,2,4,8,16,32]){
   fixture.resetPeak();const started=Date.now();
   const result=await core.accelerate({request:{method:'GET',url:'https://upos-sz-mirror08c.bilivideo.com/upgcxcode/fixture.m4s',headers:{Range:`bytes=0-${size-1}`}},options:{connections,maxBytes:size,timeout:5000,minChunkKiB},fetchRange});
   assert.equal(result.kind,'response');assert.deepEqual(Buffer.from(result.response.body),entity);
   const elapsedMs=Date.now()-started;
   measurements.push({profile,round:round+1,configured:connections,effective:result.metrics.connections,peakHTTPJobs:fixture.peak(),elapsedMs,Mbps:size*8/elapsedMs/1000});
  }
 }
 const output={scope:'Synthetic loopback fixture only. Not Loon, ISP, overseas CDN, or a predicted phone speedup.',
  generatedAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform},
  bytes:size,parameters:{tickMs:16,perJobBytesPerTick:16384,initialDelayMs:120,sharedLinkBytesPerTick:65536,minChunkKiB},
  purpose:'Verify real 8/16/32 HTTP jobs, byte equality, and a concurrency plateau when a shared bottleneck is present.',measurements};
 mkdirSync('benchmarks',{recursive:true});writeFileSync(small?'benchmarks/small-chunk-fixture.json':'benchmarks/concurrency-fixture.json',JSON.stringify(output,null,2)+'\n');
 for(const profile of ['single-job-limit','shared-link-limit']){
  const row={profile};for(const n of [1,2,4,8,16,32])row[n]=measurements.filter(v=>v.profile===profile&&v.configured===n).map(v=>v.elapsedMs).sort((a,b)=>a-b)[1];
  console.log(JSON.stringify({medianMs:row}));
 }
}finally{await fixture.close();}
