import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {artifact,namespace} from './helpers/channel.mjs';
const source=artifact('range.bundle.js'),MiB=1024*1024;
const preferred='upos-sz-mirror08c.bilivideo.com',alternate='upos-sz-mirrorbos.bilivideo.com';
const inventory=JSON.parse(readFileSync('data/cdn-candidates.json','utf8')).hosts;
function harness(){
 let clock=100000,stored={hosts:Object.fromEntries(inventory.filter(h=>h!==preferred).map(h=>[h,{at:clock,blockedUntil:clock+20000}]))},context;
 const entity=Uint8Array.from({length:MiB},(_,i)=>i%251);
 return {get:()=>structuredClone(stored),set:value=>{stored=structuredClone(value);},api:()=>context.BiliRangeRecovery,context:()=>context,
  async run({name='bad-media',kind='redirect',gap=2000,afterStart,sourceHost=preferred,sourceURL}={}){
   clock+=gap;const started=clock,tasks=[];let finish;
   const completed=new Promise(resolve=>finish=resolve);
   context={Uint8Array,Date:{now:()=>clock},Math,console:{log(){}},$argument:{Enabled:true},
    $request:{method:'GET',url:sourceURL||`https://${sourceHost}/upgcxcode/${name}.m4s?upsig=private-token`,headers:{Range:`bytes=0-${MiB-1}`}},
    $persistentStore:{read:k=>k===namespace?JSON.stringify(stored):null,
     write:(v,k)=>{assert.equal(k,namespace);stored=JSON.parse(v);return true;}},
    $httpClient:{get(o,callback){tasks.push({o,callback});}},$done:finish};
   vm.runInNewContext(source,context);await new Promise(r=>setImmediate(r));
   afterStart?.(stored);clock=started+100;
   for(const {o,callback} of tasks){
    const target=new URL(o.url).hostname,[,from,to]=/bytes=(\d+)-(\d+)/.exec(o.headers.Range);
    if(name==='bad-media'&&target===preferred&&kind==='redirect')callback(null,{status:302,headers:{Location:'https://outside.example/denied'}},new Uint8Array());
    else if(kind==='transport')callback('private network error',null,null);
    else callback(null,{status:206,headers:{'Content-Range':`bytes ${from}-${to}/${MiB}`}},entity.subarray(Number(from),Number(to)+1));
   }
   const result=await completed;
   if(result.response)assert.deepEqual(result.response.body,entity);
   return {result,hosts:tasks.map(t=>new URL(t.o.url).hostname),urls:tasks.map(t=>t.o.url),state:structuredClone(stored),clock};
  }};
}
test('another representation success cannot make a known-refused media/node pair repeat its failed takeover',async()=>{
 const h=harness();const refused=await h.run();assert.equal(refused.state.diagnostics.reasons['redirect-untrusted'],1);
 const other=await h.run({name:'good-media',kind:'ok'});assert.ok(other.result.response);assert.ok(other.hosts.every(h=>h===preferred));
 const state=h.get();state.hosts[alternate]={at:other.clock,bps:1000000,failures:0,blockedUntil:0};h.set(state);
 const recovered=await h.run();assert.ok(recovered.hosts.length>0);
 assert.ok(recovered.hosts.every(h=>h===alternate),'known rejected pair must use the proven alternate, even after another media request resets the global host score');
 assert.equal(recovered.result.response?.status,206);
 assert.equal(recovered.state.diagnostics.reasons['redirect-untrusted'],1);
});
test('a proven forced-CDN score cannot erase the official Akamai source from routing or measurements',async()=>{
 const h=harness(),state=h.get();state.hosts[preferred]={at:100000,bps:90000000,failures:0,blockedUntil:0};h.set(state);
 const origin='upos-hz-mirrorakam.akamaized.net',result=await h.run({name:'good-media',kind:'ok',sourceHost:origin});
 assert.equal(result.result.response?.status,206);assert.ok(result.hosts.every(h=>h===origin));
 assert.equal(result.state.measurements.samples.at(-1).host,origin);
 assert.equal(result.state.recovery.last.source,origin);assert.equal(result.state.recovery.last.selected,origin);
 assert.match(h.api().report(result.state,result.clock),/保留官方原地址/);
 assert.ok(!JSON.stringify(result.state).includes('private-token'));
});
test('original media URL keeps its signed query and explicit permitted port',async()=>{
 const h=harness(),original='https://upos-hz-mirrorakam.akamaized.net:4483/upgcxcode/good-media.m4s?upsig=private-token';
 const result=await h.run({name:'good-media',kind:'ok',sourceURL:original,afterStart(){}});
 assert.ok(result.urls.length>0);assert.ok(result.urls.every(url=>url===original));
 assert.ok(result.hosts.every(h=>h==='upos-hz-mirrorakam.akamaized.net'));
 assert.equal(result.result.response.status,206);
});
test('failure memory cannot be inherited by another signed address or protocol',async()=>{
 for(const original of [`https://${preferred}/upgcxcode/bad-media.m4s?upsig=another-token`,
  `https://${preferred}:4483/upgcxcode/bad-media.m4s?upsig=private-token`,
  `http://${preferred}/upgcxcode/bad-media.m4s?upsig=private-token`]){
  const h=harness();await h.run();
  const changed=await h.run({kind:'ok',sourceURL:original});
  assert.equal(changed.result.response?.status,206);assert.ok(changed.urls.every(url=>url===original));
 }
});
test('a single transient network error can recover, while repeated pair failures have a bounded rest',async()=>{
 const h=harness();await h.run({kind:'transport'});
 const once=Object.values(h.get().recovery.entries)[0];assert.equal(once.failures,1);assert.equal(once.until,once.at);
 await h.run({kind:'transport'});const repeated=Object.values(h.get().recovery.entries)[0];
 assert.equal(repeated.failures,2);assert.equal(repeated.until-repeated.at,12000);
 const held=await h.run({kind:'ok',gap:4000});assert.equal(held.hosts.length,0);assert.equal(held.result.response,undefined);
 const recovered=await h.run({kind:'ok',gap:13000});assert.equal(recovered.result.response?.status,206);
 assert.equal(Object.keys(recovered.state.recovery.entries).length,0);
});
test('an old-network callback cannot restore a negative pair or route choice after reset',async()=>{
 const h=harness();const result=await h.run({afterStart(state){state.epoch=1;state.recovery={schema:1,entries:{}};}});
 assert.equal(result.state.epoch,1);assert.equal(Object.keys(result.state.recovery.entries).length,0);
 assert.equal(result.state.recovery.last,undefined);assert.ok(!result.state.hosts[preferred]);
});
test('negative evidence is bounded, expires, and cannot echo arbitrary text or untrusted hostnames',async()=>{
 const h=harness();const result=await h.run(),api=h.api();
 const value=Object.values(result.state.recovery.entries)[0],entries={};
 for(let i=0;i<40;i++)entries[`0|${i.toString(16).padStart(8,'0')}|https|${preferred}`]={...value};
 entries['0|abcdef01|https|private.example']={...value};
 entries[`0|abcdef01|https|${preferred}`]={...value,reason:'raw-private-error',private:'raw-signed-url'};
 const state={epoch:0,recovery:{entries}},clean=api.entries(state,result.clock);
 assert.equal(Object.keys(clean).length,16);assert.ok(!JSON.stringify(clean).includes('private'));
 assert.equal(Object.keys(api.entries(state,result.clock+120000)).length,0);
 assert.equal(Object.keys(api.entries({...state,epoch:1},result.clock)).length,0);
});
test('origin load refusals retain origin routing so the adaptive pushback policy can shrink instead of hostname hopping',async()=>{
 const h=harness();const good=await h.run({kind:'ok'}),context=h.context();
 const state=good.state;state.hosts[preferred].blockedUntil=good.clock+1500;
 state.measurements.samples.push({epoch:0,host:preferred,ok:false,reason:'status-429',at:good.clock});
 const request={method:'GET',url:`https://${preferred}/upgcxcode/bad-media.m4s?upsig=private-token`,headers:{Range:`bytes=0-${MiB-1}`}};
 const pool=context.BiliRangeRecovery.pool(state,request,[preferred,alternate],good.clock+500);
 assert.deepEqual(Array.from(pool),[preferred]);
});
test('network change DNS warming includes the actual recent source without retaining stale media-pair evidence',async()=>{
 const h=harness(),origin='upos-hz-mirrorakam.akamaized.net',good=await h.run({kind:'ok',name:'good-media',sourceHost:origin}),domains=[];
 const store=h.context().$persistentStore;
 await new Promise(resolve=>vm.runInNewContext(artifact('network-reset.bundle.js'),{
  Uint8Array,Date:{now:()=>good.clock+100},$argument:{Enabled:true},$persistentStore:store,console:{log(){}},
  $dns:{query(options,callback){domains.push(options.domain);setImmediate(()=>callback(null,{answers:[{type:'A'}]}));}},$done:resolve
 }));
 assert.equal(domains.length,4);assert.equal(domains[0],origin);assert.equal(new Set(domains).size,4);
 assert.equal(h.get().epoch,1);assert.equal(Object.keys(h.get().recovery.entries).length,0);assert.equal(h.get().recovery.last,undefined);
});
