import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const bundle=readFileSync('dist/lab/range.bundle.js','utf8'),diagnose=readFileSync('dist/lab/diagnose.bundle.js','utf8');
const host='upos-sz-mirror08c.bilivideo.com',MiB=1024*1024;
const request={method:'GET',url:'https://upos-hz-mirrorakam.akamaized.net/upgcxcode/example.m4s?upsig=private',headers:{Range:'bytes=0-1048575'}};
const quiet={log(){}};
function run({state={},arg={},req=request,clock=100000,get}={}){
 let stored=JSON.stringify(state),calls=0,context;
 const completed=new Promise(resolve=>{
  context={Uint8Array,Date:{now:()=>clock},console:quiet,$argument:arg,$request:req,
   $persistentStore:{read:()=>stored,write:v=>{stored=v;return true;}},$done:resolve,
   $httpClient:{get(o,cb){calls++;if(get){get(o,cb);return;}
    const [,a,b]=/bytes=(\d+)-(\d+)/.exec(o.headers.Range),start=Number(a),end=Number(b);
    cb(null,{status:206,headers:{'Content-Range':`bytes ${start}-${end}/2097152`,'Content-Type':'video/mp4'}},
     Uint8Array.from({length:end-start+1},(_,i)=>(start+i)%251));}}};
  vm.runInNewContext(bundle,context);
 });
 return {completed,state:()=>JSON.parse(stored),calls:()=>calls,context:()=>context};
}
test('one-switch plugin ignores obsolete experiment settings and preserves exact signed bytes',async()=>{
 const plugin=readFileSync('dist/lab/BiliBili.Range.Lab.plugin','utf8'),args=plugin.split('[Argument]')[1].split('[General]')[0].trim().split('\n');
 assert.equal(args.length,1);assert.ok(args[0].startsWith('Enabled = switch'));
 assert.ok(plugin.includes('argument=[{Enabled}]'));assert.ok(!plugin.includes('{Connections}'));
 const r=run({arg:{Connections:32,MinChunkKiB:32,TrialMode:'8vs32',AutoCDN:false,PreferredCDN:'evil.example',CDNGroup:'overseas'},
  get(o,cb){assert.equal(o.url,request.url.replace('upos-hz-mirrorakam.akamaized.net',host));
   const [,a,b]=/bytes=(\d+)-(\d+)/.exec(o.headers.Range),start=Number(a),end=Number(b);
   assert.equal(end-start+1,128*1024);cb(null,{status:206,headers:{'Content-Range':`bytes ${start}-${end}/2097152`}},Uint8Array.from({length:end-start+1},(_,i)=>(start+i)%251));}});
 const result=await r.completed;assert.equal(r.calls(),8);assert.deepEqual(result.response.body,Uint8Array.from({length:MiB},(_,i)=>i%251));
 const saved=r.state();assert.equal(saved.diagnostics.writer.profile,'automatic');assert.equal(saved.measurements.samples[0].trial,undefined);
 assert.equal(saved.measurements.samples[0].requestedMode,8);assert.ok(!JSON.stringify(saved).includes('upsig'));
});
test('automatic candidate fallback can reach the final Hong Kong host without a menu choice',async()=>{
 const hosts=JSON.parse(readFileSync('data/cdn-candidates.json','utf8')).hosts,state={hosts:{}};
 for(const name of hosts.slice(0,-1))state.hosts[name]={blockedUntil:110000};
 const r=run({state});const result=await r.completed;assert.equal(result.response.status,206);
 assert.equal(r.state().diagnostics.last.host,'cn-hk-eq-01-03.bilivideo.com');assert.equal(r.calls(),8);
});
test('automatic switch disables downloads while retaining a marked, privacy-safe pass event',async()=>{
 const r=run({arg:{Enabled:false}});const result=await r.completed;
 assert.equal(result.response,undefined);assert.equal(r.calls(),0);assert.equal(r.state().diagnostics.reasons.disabled,1);
 assert.equal(r.state().diagnostics.writer.version,'0.1.14-experimental');
});
test('automatic scheduler shrinks under live load and releases only its own lease',async()=>{
 const state={leases:{a:{expires:108000,jobs:8,bytes:MiB},b:{expires:108000,jobs:8,bytes:MiB}}};
 const r=run({state});assert.equal((await r.completed).response.status,206);assert.equal(r.calls(),4);
 assert.equal(Object.keys(r.state().leases).length,2);assert.equal(r.state().diagnostics.writer.reason,'load');
});
test('only recent same-network transport failures trigger conservative automatic shrinkage',async()=>{
 const r=run();await r.completed;const policy=r.context().BiliRangePolicy;
 const samples=Array.from({length:4},(_,i)=>({at:99000,epoch:2,host,ok:i>0,reason:i===0?'transport':undefined}));
 const state={epoch:2,hosts:{[host]:{at:99000,bps:1000000}},measurements:{samples}};
 assert.equal(policy.resolve(state,request,{},'automatic',100000).options.connections,4);
 assert.equal(policy.resolve(state,request,{},'automatic',160001).options.connections,8);
 state.measurements.samples[0].reason='entity-mismatch';assert.equal(policy.resolve(state,request,{},'automatic',100000).options.connections,8);
 state.measurements.samples[0].reason='transport';state.measurements.samples[0].epoch=1;
 assert.equal(policy.resolve(state,request,{},'automatic',100000).options.connections,8);
});
test('small requests remain pass-through and diagnosis does not manufacture speed or stalls',async()=>{
 const r=run({req:{...request,headers:{Range:'bytes=0-200000'}}});await r.completed;assert.equal(r.calls(),0);
 let output;vm.runInNewContext(diagnose,{Uint8Array,Date:{now:()=>100000},console:quiet,
  $persistentStore:{read:key=>key.endsWith('diagnoseBaseline')?null:JSON.stringify(r.state()),write:()=>true},$done:o=>{output=o.content;}});
 assert.ok(output.includes('实际')||output.includes('已标记请求脚本'));assert.ok(output.includes('当前速度未知'));
 assert.ok(output.includes('范围小于 256 KiB 1'));assert.ok(output.includes('不等于下载失败'));assert.ok(!output.includes('private'));
});
test('short diagnosis distinguishes stale writer version and bounded events without displaying old low-bitrate SIDX as current',async()=>{
 const r=run();await r.completed;const d=r.context().BiliRangeDiagnostics,state=r.state();
 state.diagnostics.writer.version='0.1.13-experimental';state.diagnostics.writer.count--;
 state.diagnostics.last.finishedAt=1;state.diagnostics.last.host='https://private.example';
 state.diagnostics.events.push({at:100000,epoch:0,kind:'pass',reason:'https://secret.example'});
 state.mediaInfos={private:'https://signed.example/?secret=x'};
 const report=d.summary(state,200000);assert.ok(report.includes('0.1.14-experimental'));assert.ok(report.includes('0.1.13-experimental'));
 assert.ok(report.includes('未标记版本'));assert.ok(report.includes('当前速度未知'));
 for(const secret of ['private.example','secret.example','signed.example'])assert.ok(!report.includes(secret));
 for(let i=0;i<200;i++)d.record(state.diagnostics,request,{kind:'pass',reason:'small-range'},{epoch:0});
 assert.equal(state.diagnostics.events.length,120);assert.ok(state.diagnostics.events.every(e=>Object.keys(e).length===4));
});
test('automatic network warmup ignores stale developer choices and remains bounded and DNS-only',async()=>{
 let stored='{}';const domains=[];
 await new Promise(resolve=>vm.runInNewContext(readFileSync('dist/lab/network-reset.bundle.js','utf8'),{Date,console:quiet,
  $argument:{Enabled:true,WarmDNS:false,PreferredCDN:'evil.example',CDNGroup:'overseas'},
  $persistentStore:{read:()=>stored,write:v=>{stored=v;return true;}},$done:resolve,
  $httpClient:{get(){throw Error('Unexpected media probe');}},$dns:{query(o,cb){domains.push(o.domain);cb(null,{answers:[{type:'A',value:'private-ip'}]});}}}));
 assert.equal(domains.length,4);assert.equal(domains[0],host);assert.ok(!domains.some(h=>h.includes('evil')));
 assert.ok(!stored.includes('private-ip'));
});
