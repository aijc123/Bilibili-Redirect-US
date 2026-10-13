import test from 'node:test';
import assert from 'node:assert/strict';
import {collect} from '../scripts/cdn-health.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const hosts=['upos-sz-mirrorhwo1.bilivideo.com','upos-sz-mirror08c.bilivideo.com','upos-sz-mirror08h.bilivideo.com'];
test('candidate health cannot publish addresses, raw errors or a fabricated media speed',async()=>{
 const data=await collect(hosts,{dns:async()=>({ok:true,A:1,AAAA:0,elapsedMs:12,ip:'192.168.0.1'}),
  tls:async()=>({ok:true,tlsMs:100,elapsedMs:120,status:403,location:'private-url'}),context:'https://secret.example'});
 const text=JSON.stringify(data);for(const value of ['192.168.0.1','private-url','secret.example'])assert.ok(!text.includes(value));
 assert.equal(data.mediaBenchmarkAvailable,false);assert.equal(data.changesPlaybackDefault,false);
 assert.ok(data.rows.every(r=>r.mediaMbps===null&&r.mediaUsable==='unknown'&&r.tls.status===403));
});
test('health runner rejects arbitrary or oversized candidate input before network calls',async()=>{
 let called=0;for(const invalid of [['evil.example'],['upos-sz-mirror08c.bilivideo.com@evil.example'],Array(13).fill(hosts[0])])
  await assert.rejects(()=>collect(invalid,{dns:()=>{called++;}}),/invalid-candidate/);
 assert.equal(called,0);
});
test('DNS failure prevents a pointless HTTPS request; at most2 hosts probe concurrently',async()=>{
 let active=0,peak=0,tlsCalls=0;
 const data=await collect(hosts,{dns:async host=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;return {ok:host!==hosts[0],A:1};},
  tls:async()=>{tlsCalls++;throw Object.assign(Error('secret'),{code:'ECONNRESET'});}});
 assert.equal(peak,2);assert.equal(tlsCalls,2);assert.equal(data.rows.find(r=>r.host===hosts[0]).tls.code,'DNS_UNAVAILABLE');
 assert.ok(!JSON.stringify(data).includes('secret'));
});
test('expanded CDN menu is consumed by the published Loon business logic, including signed path preservation',async()=>{
 const inventory=JSON.parse(readFileSync('data/cdn-candidates.json','utf8')),plugin=readFileSync('dist/lab/BiliBili.Range.Lab.plugin','utf8');
 const baseURL='https://upos-hz-mirrorakam.akamaized.net/upgcxcode/test-media.m4s?upsig=example';
 for(const host of inventory.hosts){
  assert.ok(plugin.includes(JSON.stringify(host)));let stored='{}',calls=0;
  const result=await new Promise(resolve=>vm.runInNewContext(readFileSync('dist/lab/range.bundle.js','utf8'),{Uint8Array,Date,console,
   $argument:{AutoCDN:false,Connections:4,PreferredCDN:host},$request:{method:'GET',url:baseURL,headers:{Range:'bytes=0-1048575'}},
   $persistentStore:{read:()=>stored,write:value=>{stored=value;return true;}},$done:resolve,
   $httpClient:{get(options,callback){calls++;assert.equal(options.url,baseURL.replace('upos-hz-mirrorakam.akamaized.net',host));
    const match=/bytes=(\d+)-(\d+)/.exec(options.headers.Range),start=Number(match[1]),end=Number(match[2]);
    callback(null,{status:206,headers:{'Content-Range':`bytes ${start}-${end}/2097152`}},new Uint8Array(end-start+1));}}}));
  assert.equal(calls,4);assert.equal(result.response.body.length,1048576);assert.ok(!stored.includes('upsig'));
 }
});
