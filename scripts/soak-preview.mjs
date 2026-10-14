/* Long real HTTP lifecycle exercise. Network epochs are simulated locally;
 * this does not exercise iOS, real Wi-Fi changes, DNS, TLS or a video player. */
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createFixture} from './loopback-fixture.mjs';
const source=readFileSync('dist/preview/range.bundle.js','utf8');
const reset=readFileSync('dist/preview/network-reset.bundle.js','utf8');
const seconds=Number(process.argv[2]||1200);assert.ok(Number.isFinite(seconds)&&seconds>=30&&seconds<=3600);
const primitive={};vm.runInNewContext(readFileSync('vendor/btr-0302b345/range-core.js','utf8'),primitive);
let phase=0,stored='{}',maxStateBytes=0,networkResets=0,requests=0,subrequests=0,globalActive=0,globalPeak=0,passes=0,verified=0;
const rows=[],windows=[],namespace='aijc123.BiliRange.preview.v1',started=Date.now();
const store={read:key=>key===namespace?stored:null,write:(value,key)=>{assert.equal(key,namespace);stored=value;return true;}};
const fixture=await createFixture({size:1024*1024,parseRange:primitive.__BILI_RANGE_CORE__.parseRangeHeader,
 responseForRequest:({id})=>phase===2&&id%23===0?{disconnect:true}:phase===4&&id%19===0?{etag:'"other-entity"'}:
  id%31===0?{delayMs:400}:{}});
async function run(bytes,label){
 let finish,active=0,doneCalls=0,jobs=0,ownLeases=[];const began=Date.now();
 const completed=new Promise(resolve=>finish=resolve),before=new Set(Object.keys(JSON.parse(stored).leases||{}));
 const request={method:'GET',url:'https://upos-hz-mirrorakam.akamaized.net/upgcxcode/'+label+'.m4s?upsig=local-soak-only',headers:{Range:`bytes=0-${bytes-1}`}};
 const context={Uint8Array,Date,Math,console:{log(){}},$argument:{Enabled:true},$request:request,$persistentStore:store,
  $httpClient:{get(options,callback){active++;globalActive++;jobs++;subrequests++;globalPeak=Math.max(globalPeak,globalActive);
   fixture.fetchRange(options).then(r=>{active--;globalActive--;callback(null,{status:r.status,headers:r.headers},r.body);},
    e=>{active--;globalActive--;callback(e.message,null,null);});}},
  $done:result=>{doneCalls++;assert.equal(active,0);finish(result);}};
 vm.runInNewContext(source,context);ownLeases=Object.keys(JSON.parse(stored).leases||{}).filter(id=>!before.has(id));
 const result=await completed;requests++;assert.equal(doneCalls,1);
 const state=JSON.parse(stored);for(const id of ownLeases)assert.equal(state.leases?.[id],undefined);
 if(result.response){verified++;assert.equal(result.response.status,206);assert.deepEqual(Buffer.from(result.response.body),fixture.entity.subarray(0,bytes));}
 else passes++;
 assert.ok((state.measurements?.samples||[]).length<=120);assert.ok((state.diagnostics?.events||[]).length<=120);
 assert.ok(Object.keys(state.recovery?.entries||{}).length<=16);assert.ok(Object.keys(state.adaptive?.entries||{}).length<=8);
 assert.ok(!stored.includes('local-soak-only'));assert.ok(!stored.includes('upgcxcode'));
 maxStateBytes=Math.max(maxStateBytes,Buffer.byteLength(stored));assert.ok(maxStateBytes<512*1024);
 rows.push({atMs:Date.now()-started,phase,bytes,elapsedMs:Date.now()-began,jobs,epoch:state.epoch||0,
  delivered:Boolean(result.response),protection:state.protection?.last?.phase||null});
}
function save(complete){writeFileSync('benchmarks/preview-soak.json',JSON.stringify({
 scope:'Real local HTTP soak; simulated network epochs. NOT iPhone, Bilibili, DNS, TLS, native playback or no-stall evidence.',
 startedAt:new Date(started).toISOString(),updatedAt:new Date().toISOString(),complete,requestedSeconds:seconds,elapsedMs:Date.now()-started,
 version:JSON.parse(readFileSync('src/loon/next.json','utf8')).version,
 artifactSHA256:createHash('sha256').update(source.replace(/\r\n/g,'\n')).digest('hex'),
 parameters:{phaseSeconds:120,phases:['solo','competing','transport-fault','network-epoch-change','entity-fault'],
  disconnectEveryNthJob:23,changedEntityEveryNthJob:19,slowEveryNthJob:31,extraSlowMs:400},
 requests,subrequests,verified,passes,networkResets,globalPeak,maxStateBytes,windows,rows},null,2)+'\n');}
let batch=0,lastWindow=started;
try{
 while(Date.now()-started<seconds*1000){
  phase=Math.floor((Date.now()-started)/120000)%5;batch++;
  const start=Date.now(),jobs=[run(batch%2?897932:1048576,'soak-a')];
  if(phase===1||phase===3)jobs.push(run(1048576,'soak-b'));
  if(phase===3){
   await new Promise(resolve=>setTimeout(resolve,40));
   await new Promise(resolve=>vm.runInNewContext(reset,{Uint8Array,Date,console:{log(){}},$argument:{Enabled:true},$persistentStore:store,$done:resolve}));
   networkResets++;
  }
  await Promise.all(jobs);assert.equal(globalActive,0);assert.equal(Object.keys(JSON.parse(stored).leases||{}).length,0);
  if(Date.now()-lastWindow>=30000){
   global.gc?.();windows.push({atMs:Date.now()-started,requests,verified,passes,phase,rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed});
   save(false);console.log(`soak ${Math.round((Date.now()-started)/1000)}/${seconds}s; verified ${verified}; passes ${passes}; peak ${globalPeak}; epoch changes ${networkResets}`);lastWindow=Date.now();
  }
  const wait=1000-(Date.now()-start);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
 }
 save(true);console.log('Soak complete; every successful full response byte-checked; no callback or own lease left pending.');
}finally{await fixture.close();}
