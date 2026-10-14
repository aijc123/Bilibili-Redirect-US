/* Execute an actual generated Loon artifact against a real local HTTP fixture.
 * System clock, actual callbacks, full-byte validation; never phone evidence. */
import vm from 'node:vm';
import assert from 'node:assert/strict';
export function createDriver({source,fixture,bytes,namespace='aijc123.BiliRange.preview.v1'}){
 let state='{}';
 return {state:()=>JSON.parse(state),set:value=>{state=JSON.stringify(value);},
  async run({afterStart}={}){
   const previous=(JSON.parse(state).measurements?.samples||[]).filter(s=>s.trial).at(-1);
   if(previous){const wait=previous.at+1550-Date.now();if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));}
   fixture.resetPeak();let finish,calls=0,active=0,peak=0,doneCalls=0;const started=Date.now();
   const completed=new Promise(resolve=>finish=resolve);
   const context={Uint8Array,Date,Math,console:{log(){}},$argument:{Enabled:true},
    $request:{method:'GET',url:'https://upos-hz-mirrorakam.akamaized.net/upgcxcode/fixture.m4s?upsig=local-fixture-only',headers:{Range:`bytes=0-${bytes-1}`}},
    $persistentStore:{read:key=>key===namespace?state:null,
     write:(value,key)=>{assert.equal(key,namespace);state=value;return true;}},
    $httpClient:{get(options,callback){calls++;active++;peak=Math.max(peak,active);
     fixture.fetchRange(options).then(response=>{active--;callback(null,{status:response.status,headers:response.headers},response.body);},
      error=>{active--;callback(error.message,null,null);});}},
    $done:result=>{doneCalls++;assert.equal(active,0,'done must wait for every HTTP callback');finish(result);}};
   vm.runInNewContext(source,context);afterStart?.(JSON.parse(state),value=>{state=JSON.stringify(value);});
   const result=await completed;assert.equal(doneCalls,1);assert.equal(result.response?.status,206);
   assert.deepEqual(Buffer.from(result.response.body),fixture.entity.subarray(0,bytes));
   const stored=JSON.parse(state),sample=stored.measurements.samples.at(-1);
   assert.equal(sample.mode,calls);assert.equal(peak,calls);assert.equal(Object.keys(stored.leases).length,0);
   assert.ok(!state.includes('local-fixture-only'));assert.ok(!state.includes('upgcxcode'));
   return {bytes,elapsedMs:Date.now()-started,actualJobs:calls,peakJobs:peak,choice:stored.adaptive.last.choice,
    reason:stored.adaptive.last.reason,trial:sample.trial||null};
  }};
}
