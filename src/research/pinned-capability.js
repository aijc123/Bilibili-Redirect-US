/* Apache-2.0, aijc123. Opt-in public-page capability test, not a media test.
 * Never reads playback URLs, store, cookies, account data or current policies. */
(function(root){
 'use strict';
 const script='https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/range-v0.1.20-experimental/src/research/direct-session.js';
 function publicIPv4(value){
  if(typeof value!=='string'||!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value))return false;
  if(value.split('.').some(part=>String(Number(part))!==part))return false;
  const [a,b,c,d]=value.split('.').map(Number);if([a,b,c,d].some(v=>v>255))return false;
  return a>0&&a<224&&![10,127].includes(a)&&!(a===100&&b>=64&&b<=127)&&
   !(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||b===0||b===2))&&
   !(a===198&&(b===18||b===19||b===51&&c===100))&&!(a===203&&b===0&&c===113);
 }
 const descriptor=ip=>'BiliCapability = custom,'+ip+',443,script-path='+script;
 function fetch(client,url,node){
  return new Promise(resolve=>{
   try{client.get({url,node,timeout:2500,'binary-mode':true,'auto-redirect':false,'auto-cookie':false,insecure:false},
    (error,response,data)=>resolve({ok:!error&&response?.status===200,status:Number(response?.status)||0,
     body:data instanceof Uint8Array?data:null}));}catch{resolve({ok:false,status:0,body:null});}
  });
 }
 async function run({dns,client}){
  if(typeof dns?.query!=='function')return {available:false,reason:'dns-api-unavailable'};
  const answer=await new Promise(resolve=>{try{dns.query({domain:'www.example.com',timeout:2000},(error,value)=>resolve(error?null:value));}catch{resolve(null);}});
  const ip=answer?.answers?.find(r=>r.type==='A'&&publicIPv4(r.value))?.value;
  if(!ip)return {available:false,reason:'no-public-ipv4'};
  const baseline=await fetch(client,'https://www.example.com/','DIRECT');
  if(!baseline.ok||!baseline.body)return {available:false,reason:'public-baseline-failed'};
  const pinned=await fetch(client,'https://www.example.com/',descriptor(ip));
  if(!pinned.ok||!pinned.body||pinned.body.length!==baseline.body.length||!pinned.body.every((v,i)=>v===baseline.body[i]))
   return {available:false,reason:'custom-node-or-response-unverified'};
  // An unreachable documentation address must not silently fall back to DIRECT.
  const unreachable=await fetch(client,'https://www.example.com/',descriptor('192.0.2.1'));
  if(unreachable.status>0)return {available:false,reason:'node-binding-not-demonstrated'};
  const negative=await fetch(client,'https://wrong.host.badssl.com/',descriptor(ip));
  if(negative.status>0)return {available:false,reason:'certificate-negative-control-failed'};
  return {available:true,reason:'controls-passed'};
 }
 function report(result){
  return 'Bili 固定IP能力验证（实验）\n'+(result.available?
   '公开网页与路由/证书失败对照已通过；这是能力线索，不是SNI抓包证明或媒体吞吐成绩。':
   '尚未证明此运行环境支持安全固定IP：'+result.reason)+
   '\n没有读取媒体地址或账号、没有修改配置；只访问公开网页。还没有按各DNS返回IP下载视频，不自动切换DNS。';
 }
 root.BiliPinnedCapability={run,report,publicIPv4};
 if(typeof $httpClient!=='undefined'&&typeof $done==='function'){
  const dns=typeof $dns==='undefined'?null:$dns;
  run({dns,client:$httpClient}).then(value=>{const summary=report(value);console.log(summary);$done({title:'Bili 固定IP能力验证',content:summary});})
   .catch(()=>{$done({title:'Bili 固定IP能力验证',content:'验证未完成；没有修改配置，不能声称已固定IP或测过媒体吞吐。'});});
 }
})(globalThis);
