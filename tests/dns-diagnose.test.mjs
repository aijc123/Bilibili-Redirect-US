import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('src/accelerator/dns-diagnose.js','utf8'),ctx={Date,console};vm.runInNewContext(source,ctx);
const api=ctx.BiliRangeDNS;
test('DNS probe limits concurrency, queries only public CDN names and preserves resolver settings',async()=>{
 let active=0,peak=0,calls=0;const result=await api.run(async o=>{
  active++;peak=Math.max(peak,active);calls++;assert.ok(/^upos-sz-mirror[a-z0-9]+\.bilivideo\.com$/.test(o.domain));
  assert.equal(o.timeout,1500);assert.equal(o.type,undefined);assert.ok(['auto','doh'].includes(o.protocol));
  await new Promise(resolve=>setImmediate(resolve));active--;
  return {result:{fromCache:false,server:'192.168.0.1',answers:[{type:'A',value:'secret-address'},{type:'AAAA',value:'private-ip'}]}};
 });
 assert.equal(calls,24);assert.equal(peak,3);assert.equal(result.completed,24);assert.equal(result.skipped,0);
 const text=api.report(result)+JSON.stringify(result);for(const token of ['192.168.0.1','secret-address','private-ip'])assert.ok(!text.includes(token));
});
test('cached replies and resolver failures cannot look like uncached speed measurements',async()=>{
 let calls=0;const data=await api.run(async()=>++calls%2?{result:{fromCache:true,answers:[{type:'A'}]}}:{error:{code:'https://secret.example/token',message:'secret'}});
 assert.equal(data.rows.filter(r=>r.ok).length,12);assert.equal(data.rows.filter(r=>r.cached).length,12);
 assert.equal(data.rows.filter(r=>r.code==='QUERY_FAILED').length,12);assert.ok(!api.report(data).includes('secret'));
});
test('probe stops starting new queries when its wall-clock work allowance ends',async()=>{
 let time=0;const data=await api.run(async()=>{time+=5000;return {result:{answers:[{type:'A'}]}};},()=>time);
 assert.ok(data.completed<24);assert.equal(data.skipped,24-data.completed);
});
test('unsupported Loon runtime reports a useful manual result exactly once',()=>{
 let done=0,log;vm.runInNewContext(source,{Date,console:{log:s=>{log=s;}},$done(){done++;}});
 assert.equal(done,1);assert.ok(log.includes('Build 988+'));
});
test('manual entry waits for all DNS callbacks and never invokes HTTP or config mutation',async()=>{
 let finished=0,queries=0;const result=await new Promise(resolve=>vm.runInNewContext(source,{Date,console:{log(){}},
  $done:r=>{finished++;resolve(r);},$dns:{query(o,cb){queries++;setImmediate(()=>cb(null,{answers:[{type:'A'}],fromCache:true}));}},
  $httpClient:{get(){throw Error('Unexpected media GET');}},$config:{setRunningModel(){throw Error('Unexpected mutation');}}}));
 assert.equal(queries,24);assert.equal(finished,1);assert.ok(result.content.includes('不能据此自动切换'));
});
