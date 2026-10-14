import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const script=readFileSync('src/research/pinned-capability.js','utf8');
function api(){const context={Uint8Array};vm.runInNewContext(script,context);return context.BiliPinnedCapability;}
function options(mode='supported'){
 const seen=[],body=new Uint8Array([1,2,3]);
 return {seen,dns:{query(o,cb){assert.equal(o.domain,'www.example.com');cb(null,{answers:[{type:'A',value:'93.184.215.14'}]});}},
  client:{get(o,cb){seen.push(o);assert.equal(o.insecure,false);assert.equal(o['auto-cookie'],false);assert.equal(o['auto-redirect'],false);
   const badIP=o.node.includes('192.0.2.1'),badHost=o.url.includes('badssl');
   if((badIP&&!mode.startsWith('ignored'))||(badHost&&!mode.startsWith('certificate-bypass')))cb('test failure',null,null);
   else cb(null,{status:mode.endsWith('-redirect')&&(badIP||badHost)?302:200},body);}}};
}
test('capability probe cannot call an ignored node binding or accepted wrong certificate supported',async()=>{
 for(const [mode,available,reason] of [['supported',true,'controls-passed'],['ignored',false,'node-binding-not-demonstrated'],
  ['certificate-bypass',false,'certificate-negative-control-failed'],['ignored-redirect',false,'node-binding-not-demonstrated'],
  ['certificate-bypass-redirect',false,'certificate-negative-control-failed']]){
  const h=options(mode),result=await api().run(h);assert.equal(result.available,available);assert.equal(result.reason,reason);
  const text=JSON.stringify(result)+api().report(result);assert.ok(!text.includes('93.184'));assert.ok(!text.includes('192.0.2.1'));
 }
});
test('capability probe rejects local, documentation and malformed DNS targets before HTTP',async()=>{
 for(const value of ['127.0.0.1','10.0.0.1','169.254.1.2','192.168.1.1','198.18.0.1','192.0.2.3','256.1.1.1','012.0.0.1']){
  const a=api();assert.equal(a.publicIPv4(value),false);
  const h=options();h.dns.query=(o,cb)=>cb(null,{answers:[{type:'A',value}]});
  assert.equal((await a.run(h)).available,false);assert.equal(h.seen.length,0);
 }
});
test('the direct-session prototype establishes only its public HTTPS control sessions',()=>{
 const source=readFileSync('src/research/direct-session.js','utf8');
 for(const [host,tls,port,expected] of [['www.example.com',false,443,true],['wrong.host.badssl.com',false,443,true],
  ['upos-hz-mirrorakam.akamaized.net',false,443,false],['www.example.com',true,443,false],['www.example.com',false,80,false]]){
  let established=0;const context={$session:{conHost:host,conPort:port,proxy:{isTLS:tls}},$tunnel:{established(){established++;}}};
  vm.runInNewContext(source,context);assert.equal(context.tunnelDidConnected(),expected);assert.equal(established,expected?1:0);
 }
});
