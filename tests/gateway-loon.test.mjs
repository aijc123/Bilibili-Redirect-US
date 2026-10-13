import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const context={Date,console};
for(const path of ['vendor/btr-0302b345/range-core.js','src/loon/range-download.js','src/gateway/core.js'])vm.runInNewContext(readFileSync(path,'utf8'),context);
const gateway=context.BiliGateway,arg={Enabled:true,GatewayBase:'http://192.168.0.50:9190',GatewayToken:'fixture_key_12345678901234567890',Connections:32,MinChunkKiB:32};
const request={method:'GET',url:'https://upos-sz-mirrorakam.akamaized.net/upgcxcode/test.m4s?upsig=private-example&deadline=2999999999',headers:{Range:'bytes=0-1048575',Referer:'https://www.bilibili.com',Host:'upos-sz-mirrorakam.akamaized.net'}};
function fixture(healthy=true){let calls=0,saved='';const client={get(options,callback){calls++;assert.equal(options.node,'DIRECT');assert.equal(options['auto-cookie'],false);assert.equal(options['auto-redirect'],false);callback(null,{status:200},JSON.stringify({service:'aijc123-bili-range-gateway',ready:healthy}));}};
 return {client,store:{read:()=>saved,write:value=>{saved=value;return true;}},calls:()=>calls,saved:()=>saved};}
test('gateway config is opt-in and only accepts canonical private IPv4 plus a private token',()=>{
 assert.ok(gateway.config(arg));
 for(const base of ['http://example.com:9190','https://192.168.0.50:9190','http://192.168.0.50:9190/other','http://192.168.0.050:9190','http://8.8.8.8:9190','http://127.0.0.1:9190','http://172.32.0.1:9190','http://192.168.0.50:65536'])assert.equal(gateway.config({...arg,GatewayBase:base}),null);
 assert.equal(gateway.config({...arg,Enabled:false}),null);assert.equal(gateway.config({...arg,GatewayToken:'short'}),null);
});
test('rewrite preserves the complete signed source, finite range and returns DIRECT private target',async()=>{
 const f=fixture();const result=await gateway.rewrite({request,arg,...f});const url=new URL(result.url);
 assert.equal(url.searchParams.get('source'),request.url);assert.equal(url.searchParams.get('connections'),'32');assert.equal(url.searchParams.get('minChunkKiB'),'32');
 assert.equal(result.node,'DIRECT');assert.equal(result.headers.Host,'192.168.0.50:9190');assert.equal(result.headers.Range,request.headers.Range);
 assert.equal(result.headers['x-bili-gateway-token'],arg.GatewayToken);assert.ok(!f.saved().includes(arg.GatewayToken));assert.ok(!f.saved().includes('192.168.0.50'));assert.ok(!f.saved().includes('private-example'));
 await gateway.rewrite({request,arg,...f});assert.equal(f.calls(),1);
});
test('absent or busy gateway keeps the original request; changed key cannot reuse health cache',async()=>{
 const f=fixture(false);assert.equal(Object.keys(await gateway.rewrite({request,arg,...f})).length,0);
 const good=fixture();await gateway.rewrite({request,arg,...good});await gateway.rewrite({request,arg:{...arg,GatewayToken:arg.GatewayToken+'x'},...good});assert.equal(good.calls(),2);
});
test('credentials, conditionals, unbounded and foreign requests never query the gateway',async()=>{
 const f=fixture();for(const changed of [{method:'POST'},{url:'https://foreign.example/upgcxcode/a.m4s'},{headers:{Range:'bytes=0-'}},{headers:{Range:'bytes=0-9000000'}},
  {headers:{...request.headers,Cookie:'private'}},{headers:{...request.headers,Authorization:'private'}},{headers:{...request.headers,'If-Range':'private'}}])assert.equal(Object.keys(await gateway.rewrite({request:{...request,...changed},arg,...f})).length,0);
 assert.equal(f.calls(),0);assert.equal(gateway.eligible({...request,headers:{Range:'bytes=0-1'}}),true);
});
test('gateway plugin binds every consumed option and uses immutable matching bundle references',()=>{
 const plugin=readFileSync('dist/gateway/BiliBili.Range.Gateway.plugin','utf8');
 for(const name of ['Enabled','GatewayBase','GatewayToken','Connections','MinChunkKiB','AutoCDN','PreferredCDN'])assert.match(plugin,new RegExp('\\{'+name+'\\}'));
 assert.match(plugin,/Enabled = switch,false/);assert.match(plugin,/gateway-v0\.1\.1-experimental\/dist\/gateway\/rewrite.bundle.js/);
 const emitted=readFileSync('dist/gateway/rewrite.bundle.js','utf8');assert.match(emitted,/MIT License/);assert.ok(!emitted.includes('session.json'));
});
test('network changes clear cached gateway health without sending credentials or probing media',async()=>{
 const f=fixture();await gateway.rewrite({request,arg,...f});assert.equal(f.calls(),1);
 let done,logged;
 vm.runInNewContext(readFileSync('dist/gateway/network-reset.bundle.js','utf8'),{$persistentStore:f.store,
  $httpClient:{get(){throw Error('No network request allowed');}},console:{log:value=>{logged=value;}},$done:value=>{done=value;}});
 assert.ok(logged.includes('已清除'));assert.equal(done.content,logged);
 await gateway.rewrite({request,arg,...f});assert.equal(f.calls(),2);
});
