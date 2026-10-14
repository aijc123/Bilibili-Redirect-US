import assert from 'node:assert/strict';
import vm from 'node:vm';
import {artifact} from './channel.mjs';
const bundle=artifact('range.bundle.js');
export const host='upos-hz-mirrorakam.akamaized.net',MiB=1024*1024;
export const req=bytes=>({method:'GET',url:'https://upos-hz-mirrorakam.akamaized.net/upgcxcode/private-representation.m4s?upsig=private-token',headers:{Range:`bytes=0-${bytes-1}`}});
export function harness({bytes=MiB,initial={},entityData}={}){
 let stored=JSON.stringify(initial),clock=100000,context;
 const entity=entityData||Uint8Array.from({length:bytes},(_,i)=>i%251);
 return {state:()=>JSON.parse(stored),context:()=>context,set:s=>{stored=JSON.stringify(s);},
  async run({elapsed=()=>500,fail=false,request=req(bytes),afterStart,arg={Enabled:true},gap=2000,responseHeaders={},status=206,noAt=false}={}){
   clock+=gap;const start=clock,tasks=[];let doneCalls=0;
   let finish;const completed=new Promise(r=>finish=r),math=Object.create(Math);math.random=()=>0.9;
   context={Uint8Array,Date:{now:()=>clock},Math:math,console:{log(){}},$argument:arg,$request:request,
    $persistentStore:{read:()=>stored,write:v=>{stored=v;return true;}},$done:o=>{doneCalls++;finish(o);},
    $httpClient:{get(o,cb){tasks.push({o,cb});}}};
   vm.runInNewContext((noAt?'Array.prototype.at=undefined;\n':'')+bundle,context);await new Promise(r=>setImmediate(r));
   afterStart?.(JSON.parse(stored),v=>{stored=JSON.stringify(v);},start);
   clock=start+elapsed(tasks.length);
   for(const {o,cb} of tasks){
    assert.match(o.url,/^https?:\/\/(?:(?:upos-sz-[a-z0-9-]+|cn-hk-eq-[a-z0-9-]+)\.bilivideo\.com|upos-hz-mirrorakam\.akamaized\.net)(?::4483)?\//);
    assert.equal(new URL(o.url).pathname+new URL(o.url).search,new URL(request.url).pathname+new URL(request.url).search);
    const [,a,b]=/bytes=(\d+)-(\d+)/.exec(o.headers.Range),from=Number(a),to=Number(b);
    if(fail){cb('network failure',null,null);continue;}
    cb(null,{status,headers:{'Content-Range':`bytes ${from}-${to}/${8*MiB}`,...responseHeaders}},
     entity.subarray(from,to+1));
   }
   const result=await completed;assert.equal(doneCalls,1);
   if(result.response)assert.deepEqual(result.response.body,entity);
   return {count:tasks.length,result,state:JSON.parse(stored),clock};
  }};
}
export async function warm(h,elapsed){for(let i=0;i<8;i++)assert.equal((await h.run({elapsed})).count,8);}
