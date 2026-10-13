// Real loopback HTTP with deliberate fixture limits. Never a CDN/iPhone benchmark.
import http from 'node:http';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const context={Uint8Array,Date};
for(const p of ['vendor/btr-0302b345/range-core.js','src/accelerator/range-core.js'])vm.runInNewContext(readFileSync(p,'utf8'),context);
const core=context.BiliRange,size=4*1024*1024,entity=Buffer.alloc(size);
for(let i=0;i<size;i++)entity[i]=i%251;
const jobs=new Map();let sequence=0,cursor=0,peak=0,sharedPieces=4;
const server=http.createServer((req,res)=>{
 const range=core.parseRange(req.headers.range);if(!range){res.writeHead(400);res.end();return;}
 const id=++sequence;const job={id,res,range,offset:range.start,ready:Date.now()+120};jobs.set(id,job);peak=Math.max(peak,jobs.size);
 res.writeHead(206,{'Content-Range':`bytes ${range.start}-${range.end}/${size}`,'Content-Type':'video/mp4',ETag:'"bounded-fixture"'});
 res.on('close',()=>jobs.delete(id));
});
// Each job gets at most 16 KiB per tick. A shared token limit caps aggregate bytes.
const timer=setInterval(()=>{
 const ready=[...jobs.values()].filter(j=>Date.now()>=j.ready);if(!ready.length)return;
 let tokens=sharedPieces;
 for(let i=0;i<ready.length&&tokens>0;i++){
  const job=ready[(cursor+i)%ready.length],end=Math.min(job.offset+16384,job.range.end+1);
  job.res.write(entity.subarray(job.offset,end));job.offset=end;tokens--;
  if(job.offset>job.range.end){jobs.delete(job.id);job.res.end();}
 }
 cursor=(cursor+sharedPieces)%Math.max(1,ready.length);
},16);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const fetchRange=o=>new Promise((resolve,reject)=>{
 const req=http.get({host:'127.0.0.1',port,headers:o.headers,path:'/upgcxcode/fixture.m4s',agent:false},res=>{
  const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:new Uint8Array(Buffer.concat(chunks))}));
 });req.setTimeout(5000,()=>req.destroy(Error('fixture-timeout')));req.on('error',reject);
});
const measurements=[];
try{
 for(const profile of ['single-job-limit','shared-link-limit']){
  sharedPieces=profile==='shared-link-limit'?4:32;
  // Alternate order across rounds to expose drift rather than always warm from 1 to32.
  for(let round=0;round<3;round++)for(const connections of round%2?[32,16,8,4,2,1]:[1,2,4,8,16,32]){
   peak=0;const started=Date.now();
   const result=await core.accelerate({request:{method:'GET',url:'https://upos-sz-mirror08c.bilivideo.com/upgcxcode/fixture.m4s',headers:{Range:`bytes=0-${size-1}`}},options:{connections,maxBytes:size,timeout:5000},fetchRange});
   assert.equal(result.kind,'response');assert.deepEqual(Buffer.from(result.response.body),entity);
   measurements.push({profile,round:round+1,configured:connections,effective:result.metrics.connections,peakHTTPJobs:peak,elapsedMs:Date.now()-started,Mbps:result.metrics.bps*8/1e6});
  }
 }
 const output={scope:'Synthetic loopback fixture only. Not Loon, ISP, overseas CDN, or a predicted phone speedup.',
  bytes:size,parameters:{tickMs:16,perJobBytesPerTick:16384,initialDelayMs:120,sharedLinkBytesPerTick:65536},
  purpose:'Verify real 8/16/32 HTTP jobs, byte equality, and a concurrency plateau when a shared bottleneck is present.',measurements};
 mkdirSync('benchmarks',{recursive:true});writeFileSync('benchmarks/concurrency-fixture.json',JSON.stringify(output,null,2)+'\n');
 for(const profile of ['single-job-limit','shared-link-limit']){
  const row={profile};for(const n of [1,2,4,8,16,32])row[n]=measurements.filter(v=>v.profile===profile&&v.configured===n).map(v=>v.elapsedMs).sort((a,b)=>a-b)[1];
  console.log(JSON.stringify({medianMs:row}));
 }
}finally{clearInterval(timer);for(const job of jobs.values())job.res.destroy();await new Promise(resolve=>server.close(resolve));}
