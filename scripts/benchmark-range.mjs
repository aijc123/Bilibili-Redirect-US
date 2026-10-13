// Real HTTP transport, synthetic per-connection bottleneck; NOT an iPhone/CDN benchmark.
import http from 'node:http';
import vm from 'node:vm';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const ctx={Uint8Array,Date};
vm.runInNewContext(readFileSync('vendor/btr-0302b345/range-core.js','utf8'),ctx);
vm.runInNewContext(readFileSync('src/accelerator/range-core.js','utf8'),ctx);
const core=ctx.BiliRange, size=2*1024*1024;
const bytes=Buffer.alloc(size);for(let i=0;i<size;i++)bytes[i]=i%251;
let active=0,peak=0;
const server=http.createServer((req,res)=>{
 const range=core.parseRange(req.headers.range);
 if(!range){res.writeHead(400);res.end();return;}
 active++;peak=Math.max(peak,active);res.on('close',()=>active--);
 res.writeHead(206,{'Content-Range':`bytes ${range.start}-${range.end}/${size}`,'Content-Type':'video/mp4',ETag:'"fixture"'});
 let offset=range.start;
 const interval=setInterval(()=>{if(offset>range.end){clearInterval(interval);res.end();return;}
  const end=Math.min(offset+16384,range.end+1);res.write(bytes.subarray(offset,end));offset=end;
 },16);
 res.on('close',()=>clearInterval(interval));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
const fetchRange=o=>new Promise((resolve,reject)=>{
 const req=http.get({host:'127.0.0.1',port,path:'/upgcxcode/fixture.m4s',headers:o.headers,agent:false},res=>{
  const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:new Uint8Array(Buffer.concat(chunks))}));
 });req.setTimeout(5000,()=>req.destroy(Error('timeout')));req.on('error',reject);
});
const results=[];
try {
 for(let round=0;round<3;round++)for(const connections of [1,2,4]){
  peak=0;const start=Date.now();let body;
  if(connections===1)body=(await fetchRange({headers:{Range:`bytes=0-${size-1}`}})).body;
  else {const r=await core.accelerate({request:{method:'GET',url:'https://upos-sz-mirroraliov.bilivideo.com/upgcxcode/fixture.m4s',headers:{Range:`bytes=0-${size-1}`}},options:{connections,timeout:5000},fetchRange});
   assert.equal(r.kind,'response');body=r.response.body;}
  assert.deepEqual(Buffer.from(body),bytes);
  const elapsedMs=Date.now()-start;results.push({round:round+1,connections,elapsedMs,peakHTTPRequests:peak,Mbps:size*8/elapsedMs/1000});
 }
 const median=n=>results.filter(r=>r.connections===n).map(r=>r.elapsedMs).sort((a,b)=>a-b)[1];
 const summary={scope:'Loopback HTTP synthetic 1 MiB/s per-connection fixture, no real Loon or CDN measurements',bytes:size,results,
  medianMs:{single:median(1),two:median(2),four:median(4)},speedup:{two:median(1)/median(2),four:median(1)/median(4)}};
 assert.ok(summary.speedup.two>1.5);assert.ok(summary.speedup.four>2.5);
 mkdirSync('benchmarks',{recursive:true});writeFileSync('benchmarks/range-fixture.json',JSON.stringify(summary,null,2)+'\n');
 console.log(JSON.stringify(summary,null,2));
}finally {await new Promise(r=>server.close(r));}
