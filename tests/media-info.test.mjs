import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const ctx={Uint8Array,Date,console};
for(const p of ['vendor/btr-0302b345/range-core.js','vendor/btr-0302b345/sidx.js','src/accelerator/range-core.js','src/accelerator/measurements.js','src/accelerator/media-info.js'])vm.runInNewContext(readFileSync(p,'utf8'),ctx);
const api=ctx.BiliRangeMedia;
const request={url:'https://upos-sz-mirror08c.bilivideo.com/upgcxcode/private-video.m4s?upsig=secret',headers:{Range:'bytes=0-262143'}};
function body(duration=2000){
 const bytes=new Uint8Array(262144),view=new DataView(bytes.buffer);
 view.setUint32(0,16);bytes.set([102,116,121,112],4);
 const at=16;view.setUint32(at,80);bytes.set([115,105,100,120],at+4);view.setUint32(at+16,1000);view.setUint16(at+30,4);
 for(let i=0;i<4;i++){view.setUint32(at+32+i*12,500000);view.setUint32(at+36+i*12,duration);}
 return bytes;
}
const response=bytes=>({kind:'response',response:{body:bytes,headers:{'Content-Type':'video/mp4'}},metrics:{finishedAt:2000}});
test('SIDX is exactly pinned upstream bytes and observation delegates to BTR',()=>{
 const bytes=readFileSync('vendor/btr-0302b345/sidx.js');assert.equal(createHash('sha256').update(bytes).digest('hex'),'8ef4d1a4801bf71bfb388dc683c8bf22edad9b78acc8837c3fe2e2ee9e987306');
 const original=ctx.__BILI_SIDX__;let called=0;ctx.__BILI_SIDX__={...original,parseSidx:(...args)=>{called++;return original.parseSidx(...args);}};
 api.observe({},request,response(body()));assert.equal(called,1);ctx.__BILI_SIDX__=original;
});
test('index byte sizes and durations yield a representation estimate without recording media addresses',()=>{
 const state={epoch:1,playbackRate:1.5},bytes=body(),before=bytes.slice();api.observe(state,request,response(bytes),{epoch:1});
 assert.equal(state.mediaInfos.length,1);assert.equal(state.mediaInfos[0].averageMbps,2);assert.equal(state.mediaInfos[0].p90SegmentMbps,2);
 assert.equal(state.mediaInfos[0].durationSeconds,8);assert.equal(state.mediaInfos[0].type,'video');assert.deepEqual(bytes,before);
 const text=JSON.stringify(state)+api.report(state,3000);for(const token of ['private-video','upgcxcode','upsig','secret'])assert.ok(!text.includes(token));
 assert.ok(text.includes('3.00 Mbps'));assert.ok(text.includes('不能保证不卡顿'));
});
test('missing, truncated or zero-duration index never causes an observer exception or fabricated bitrate',()=>{
 for(const bytes of [new Uint8Array(262144),body().subarray(0,45),body(0)]){
  const state={};assert.doesNotThrow(()=>api.observe(state,request,response(bytes)));assert.equal(state.mediaInfos,undefined);
  assert.ok(api.report(state,3000).includes('未知'));
 }
});
test('old network metadata does not describe current demand, and storage is bounded',()=>{
 const state={epoch:1};for(let i=0;i<8;i++)api.observe(state,{...request,url:request.url.replace('private-video',`representation-${i}`)},response(body()),{epoch:1});
 assert.equal(state.mediaInfos.length,4);state.epoch=2;assert.ok(api.report(state,3000).includes('未知'));
});
test('only an existing bounded initial response is inspected; late file ranges are ignored',()=>{
 const state={};api.observe(state,{...request,headers:{Range:'bytes=1048576-1310719'}},response(body()));assert.equal(state.mediaInfos,undefined);
 api.observe(state,request,{kind:'pass'});assert.equal(state.mediaInfos,undefined);
});
