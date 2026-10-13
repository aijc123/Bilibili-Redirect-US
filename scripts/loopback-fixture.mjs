/* Shared, deliberately throttled real HTTP fixture. No external media requests. */
import http from 'node:http';
export async function createFixture({size=4*1024*1024,parseRange,initialDelayMs=120,tickMs=16}={}){
 const entity=Buffer.alloc(size);for(let i=0;i<size;i++)entity[i]=i%251;
 const jobs=new Map();let sequence=0,cursor=0,peak=0,sharedPieces=32;
 const server=http.createServer((req,res)=>{
  const range=parseRange(req.headers.range);
  if(!range||range.start<0||range.end>=size){res.writeHead(400);res.end();return;}
  const id=++sequence,job={id,res,range,offset:range.start,ready:Date.now()+initialDelayMs};
  jobs.set(id,job);peak=Math.max(peak,jobs.size);
  res.writeHead(206,{'Content-Range':`bytes ${range.start}-${range.end}/${size}`,'Content-Type':'video/mp4',ETag:'"bounded-fixture"'});
  res.on('close',()=>jobs.delete(id));
 });
 const timer=setInterval(()=>{
  const ready=[...jobs.values()].filter(j=>Date.now()>=j.ready);if(!ready.length)return;
  let tokens=sharedPieces;
  for(let i=0;i<ready.length&&tokens>0;i++){
   const job=ready[(cursor+i)%ready.length],end=Math.min(job.offset+16384,job.range.end+1);
   job.res.write(entity.subarray(job.offset,end));job.offset=end;tokens--;
   if(job.offset>job.range.end){jobs.delete(job.id);job.res.end();}
  }
  cursor=(cursor+sharedPieces)%Math.max(1,ready.length);
 },tickMs);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 const fetchRange=o=>new Promise((resolve,reject)=>{
  const req=http.get({host:'127.0.0.1',port,headers:o.headers,path:'/upgcxcode/fixture.m4s',agent:false},res=>{
   const chunks=[];res.on('data',b=>chunks.push(b));
   res.on('error',reject);res.on('aborted',()=>reject(Error('fixture-aborted')));
   res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:new Uint8Array(Buffer.concat(chunks))}));
  });req.setTimeout(5000,()=>req.destroy(Error('fixture-timeout')));req.on('error',reject);
 });
 return {entity,size,fetchRange,peak:()=>peak,resetPeak:()=>{peak=0;},setTokens:n=>{sharedPieces=n;},
  close:async()=>{clearInterval(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
