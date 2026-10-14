/* Real HTTP policy regression model, not a phone/CDN performance benchmark. */
import http from 'node:http';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const size=1024*1024,origin='upos-hz-mirrorakam.akamaized.net',entity=Buffer.alloc(size);
for(let i=0;i<size;i++)entity[i]=i%251;
const baseline=execFileSync('git',['show','range-v0.1.18-experimental:dist/candidate/range.bundle.js'],{encoding:'utf8'});
const candidate=readFileSync('dist/candidate/range.bundle.js','utf8'),sources={baseline,candidate},rows=[];
let active=0,peak=0;
const server=http.createServer((req,res)=>{
 const match=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range||'');assert.ok(match);
 const start=Number(match[1]),end=Number(match[2]);assert.ok(start>=0&&end<size);
 const isOriginal=req.headers['x-fixture-host']===origin;active++;peak=Math.max(peak,active);
 const timer=setTimeout(()=>{res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${size}`,ETag:'"same-content"'});res.end(entity.subarray(start,end+1));},isOriginal?120:800);
 res.on('close',()=>{clearTimeout(timer);active--;});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port,states={baseline:'{}',candidate:'{}'};
try{
 for(const mode of ['baseline','candidate','candidate','baseline','baseline','candidate']){
  const started=Date.now(),hosts=[],sockets=new Set();let finish;
  const completed=new Promise(resolve=>finish=resolve);
  vm.runInNewContext(sources[mode],{Uint8Array,Date,Math,console:{log(){}},$argument:{Enabled:true},
   $request:{method:'GET',url:`https://${origin}/upgcxcode/fixture.m4s`,headers:{Range:`bytes=0-${size-1}`}},
   $persistentStore:{read:key=>key==='aijc123.BiliRange.adaptive.v1'?states[mode]:null,
    write:(value,key)=>{assert.equal(key,'aijc123.BiliRange.adaptive.v1');states[mode]=value;return true;}},
   $httpClient:{get(options,callback){
    const host=new URL(options.url).hostname;hosts.push(host);assert.equal(options.insecure,false);
    const request=http.get({host:'127.0.0.1',port,agent:false,headers:{Range:options.headers.Range,'x-fixture-host':host}},response=>{
     const chunks=[];response.on('data',part=>chunks.push(part));response.on('end',()=>callback(null,{status:response.statusCode,headers:response.headers},new Uint8Array(Buffer.concat(chunks))));
     response.on('error',()=>callback('transport',null,null));
    });request.on('socket',socket=>sockets.add(socket));request.on('error',()=>callback('transport',null,null));
   }},$done:finish});
  const result=await completed;assert.equal(result.response.status,206);assert.deepEqual(Buffer.from(result.response.body),entity);
  assert.equal(new Set(hosts).size,1);assert.equal(hosts.length,8);
  rows.push({mode,selectedHost:hosts[0],bytes:size,httpJobs:hosts.length,sockets:sockets.size,elapsedMs:Date.now()-started});
 }
 const result={scope:'SYNTHETIC real-loopback HTTP routing regression only; not Bilibili, iPhone, TLS-to-CDN or playback evidence.',
  generatedAt:new Date().toISOString(),version:JSON.parse(readFileSync('src/loon/adaptive.json','utf8')).version,
  parameters:{originDelayMs:120,forcedCDNDelayMs:800,bytes:size,requests:6},peakJobs:peak,
  artifacts:Object.fromEntries(Object.entries(sources).map(([name,source])=>[name,createHash('sha256').update(source.replace(/\r\n/g,'\n')).digest('hex')])),rows};
 assert.ok(rows.filter(r=>r.mode==='candidate').every(r=>r.selectedHost===origin));
 assert.ok(rows.filter(r=>r.mode==='baseline').every(r=>r.selectedHost!==origin));
 writeFileSync('benchmarks/routing-fixture.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({scope:result.scope,rows,peakJobs:peak}));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
