/* True local HTTP matrix, not iPhone/CDN bandwidth or no-stall proof. */
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createFixture} from './loopback-fixture.mjs';
import {createDriver} from './loon-fixture-driver.mjs';
const source=readFileSync('dist/preview/range.bundle.js','utf8'),primitive={};
vm.runInNewContext(readFileSync('vendor/btr-0302b345/range-core.js','utf8'),primitive);
const large=process.argv.includes('--large');
const sizes=large?[4*1024*1024]:[262161,393233,524305,655377,897932,917521,1048576],results=[];
const output=large?'benchmarks/large-range-matrix.json':'benchmarks/small-range-matrix.json';
const startedAt=new Date().toISOString();
for(const bytes of sizes){
 const cap=large?32:Math.min(8,Math.floor(bytes/(128*1024))),low=large?4:Math.ceil(cap/2);
 for(const profile of ['per-task-quota','shared-link-quota']){
  const fixture=await createFixture({size:bytes,parseRange:primitive.__BILI_RANGE_CORE__.parseRangeHeader});
  fixture.setTokens(profile==='per-task-quota'?32:low);
  try{
   const driver=createDriver({source,fixture,bytes}),rows=[];
   const count=large&&profile==='per-task-quota'?72:32;
   for(let i=0;i<count;i++){
    const row=await driver.run();assert.ok(row.actualJobs<=cap);rows.push(row);
    if(i%8===7)console.log(`${bytes}B / ${profile}: ${i+1}/${count}; actual ${row.actualJobs}; ${row.reason}`);
   }
   results.push({bytes,profile,perTickTokens:profile==='per-task-quota'?32:low,
    chosen:rows.at(-1).choice,reason:rows.at(-1).reason,rows});
  }finally{await fixture.close();}
  writeFileSync(output,JSON.stringify({
   scope:'Real loopback HTTP only. NOT iPhone, Bilibili, DNS, TLS or playback evidence.',
   startedAt,updatedAt:new Date().toISOString(),complete:results.length===sizes.length*2,
   version:JSON.parse(readFileSync('src/loon/next.json','utf8')).version,
   artifactSHA256:createHash('sha256').update(source.replace(/\r\n/g,'\n')).digest('hex'),
   environment:{node:process.version,platform:process.platform},
   parameters:{initialDelayMs:120,tickMs:16,perTaskBytesPerTick:16384,requestsPerCondition:large?{perTaskQuota:72,sharedLinkQuota:32}:32,minimumTrialSpacingMs:1550},
   results},null,2)+'\n');
 }
}
console.log('Completed '+results.length+' conditions, every complete range verified byte-for-byte.');
