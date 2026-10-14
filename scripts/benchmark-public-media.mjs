/* Fresh public sample, desktop route only. No cookies, private playback URL,
 * access-control bypass, persistent signed URL or claim about iPhone speed. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import vm from 'node:vm';
const bvid='BV1pz421z7pq',MiB=1024*1024;
let stage='metadata';
async function json(url){
 const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://www.bilibili.com/'},signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('http-'+response.status);
 const data=await response.json();if(data.code!==0)throw Error('api-'+data.code);return data.data;
}
try{
 const info=await json('https://api.bilibili.com/x/web-interface/view?bvid='+bvid),page=info.pages?.[1];
 if(!page?.cid)throw Error('sample-unavailable');
 stage='public-playurl';
 const video=await json('https://api.bilibili.com/x/player/playurl?bvid='+bvid+'&cid='+page.cid+'&qn=80&fnval=4048&fourk=1');
 const streams=video.dash?.video||[];
 const track=streams.filter(v=>typeof (v.baseUrl||v.base_url)==='string').sort((a,b)=>(b.bandwidth||0)-(a.bandwidth||0))[0];
 if(!track)throw Error('dash-unavailable');
 const raw=readFileSync('dist/candidate/media-benchmark.bundle.js','utf8').replace(/\r\n/g,'\n');
 const entry=readFileSync('src/loon/media-benchmark-entry.js','utf8').replace(/\r\n/g,'\n');
 if(!raw.endsWith(entry))throw Error('entry-mismatch');
 const context={Uint8Array,Date,console:{log(){}}};vm.runInNewContext(raw.slice(0,-entry.length),context);
 const api=context.BiliRangeMediaBenchmark,at=Date.now();
 const sample={phase:'ready',at,until:at+120000,epoch:0,url:track.baseUrl||track.base_url,
  headers:{Range:`bytes=0-${MiB-1}`,'user-agent':'Mozilla/5.0',referer:'https://www.bilibili.com/'},preferred:'upos-sz-mirror08c.bilivideo.com'};
 if(!api.validSample(sample,{epoch:0},at))throw Error('unsupported-public-source');
 stage='media';
 const agents={http:new http.Agent({keepAlive:false,maxSockets:8}),https:new https.Agent({keepAlive:false,maxSockets:8})};
 const client={get(options,callback){
  const target=new URL(options.url),transport=target.protocol==='https:'?https:http;
  const limit=context.BiliRange.parseRange(options.headers.Range).length;
  let complete=false;const done=(...args)=>{if(!complete){complete=true;callback(...args);}};
  const request=transport.get(target,{headers:options.headers,agent:agents[target.protocol.slice(0,-1)],rejectUnauthorized:true},response=>{
   const chunks=[];let length=0;
   response.on('data',part=>{length+=part.length;if(length>limit+16384){request.destroy(Error('oversized'));return;}chunks.push(part);});
   response.on('aborted',()=>done('transport',null,null));response.on('error',()=>done('transport',null,null));
   response.on('end',()=>done(null,{status:response.statusCode,headers:response.headers},new Uint8Array(Buffer.concat(chunks))));
  });
  const timer=setTimeout(()=>request.destroy(Error('transport')),options.timeout);
  request.on('close',()=>clearTimeout(timer));request.on('error',()=>done('transport',null,null));
 }};
 const memory=new Map([[api.KEY,'{}']]),store={read:key=>memory.get(key),write:(v,key)=>{v===null?memory.delete(key):memory.set(key,v);return true;}};
 let data;try{data=await api.run({sample,store,client});}finally{agents.http.destroy();agents.https.destroy();}
 const result={scope:'Real public Bilibili media Range downloads on the desktop route. NOT iPhone or native App evidence.',
  generatedAt:new Date().toISOString(),version:JSON.parse(readFileSync('src/loon/adaptive.json','utf8')).version,
  artifactSHA256:createHash('sha256').update(raw).digest('hex'),environment:{node:process.version,platform:process.platform,transport:'HTTP/1.1, fresh request sockets, certificate validation'},
  sample:{bvid,page:2,returnedQuality:video.quality,trackId:track.id,codec:track.codecs,declaredBandwidth:track.bandwidth},...data};
 writeFileSync('benchmarks/public-media-desktop.json',JSON.stringify(result,null,2)+'\n');
 console.log(api.report(data));console.log('Saved public metadata and aggregate rows only; no media URL, signature or IP.');
}catch(error){
 const reason=/^(?:http-\d+|api--?\d+|sample-unavailable|dash-unavailable|entry-mismatch|unsupported-public-source)$/.test(error.message)?error.message:'request-failed';
 const result={scope:'desktop public sample attempt; no iPhone measurement',generatedAt:new Date().toISOString(),stage,reason,mediaBenchmarkAvailable:false};
 writeFileSync('benchmarks/public-media-desktop-attempt.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));process.exitCode=1;
}
