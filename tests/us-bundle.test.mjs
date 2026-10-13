import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const bundle=readFileSync('dist/request.bundle.js','utf8');
const hosts=['upos-sz-mirrorhwo1.bilivideo.com','upos-sz-mirror08c.bilivideo.com'];
for(const target of hosts)for(const [key,source] of [
 ['OverseaVideo','upos-sz-mirroraliov.bilivideo.com'],
 ['OverseaVideo','upos-hz-mirrorakam.akamaized.net'],
 ['OverseaVideo','cn-hk-eq-01-01.bilivideo.com'],
 ['BStar','upos-sz-mirrorcosbstar1.bilivideo.com'],
 ['PCDN','example.com:4480']]) {
 test(`${key}: ${source} -> ${target}`,async()=>{
 const suffix='/upgcxcode/53/71/video.m4s?deadline=1999999999&upsig=abc123&uparams=deadline';
 const result=await new Promise((resolve,reject)=>{
  const ctx={$loon:{},$script:{startTime:Date.now()},$argument:`Storage=Argument&Host.${key}=${target}&LogLevel=OFF`,
   $request:{url:'https://'+source+suffix,method:'GET',headers:{Host:source}},
   $persistentStore:{read:()=>null,write:()=>true},$done:resolve,
   console:{log(){},warn(){},error:reject},setTimeout,clearTimeout};
  vm.runInNewContext(bundle,ctx,{timeout:3000});
 });
 const url=new URL(result.url);
 assert.equal(url.hostname,target);
 assert.equal(url.pathname,'/upgcxcode/53/71/video.m4s');
 assert.equal(url.search,'?deadline=1999999999&upsig=abc123&uparams=deadline');
 assert.equal(result.headers.Host,target);
 });
}
test('Loon selects pass both hosts to the runtime',()=>{
 const plugin=readFileSync('dist/BiliBili.Redirect.plugin','utf8');
 for(const key of ['OverseaVideo','BStar','PCDN']) {
  const line=plugin.split('\n').find(l=>l.startsWith(`Host.${key} = select,`));
  for(const host of hosts)assert.ok(line.includes(`"${host}"`));
  assert.ok(plugin.includes(`{Host.${key}}`));
 }
 assert.ok(!plugin.includes('releases/download/v0.2.24/'));
});
