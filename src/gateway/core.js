/* Optional private-LAN rewrite adapter, Apache-2.0, aijc123. */
(function(root){
 'use strict';
 const core=root.BiliRange,KEY='aijc123.BiliGateway.health.v1';
 function config(arg){
  if(!arg||typeof arg!=='object'||arg.Enabled!==true)return null;
  const match=/^http:\/\/((?:\d{1,3}\.){3}\d{1,3}):(\d{1,5})\/?$/.exec(arg.GatewayBase||'');
  if(!match||!/^[A-Za-z0-9_-]{24,128}$/.test(arg.GatewayToken||''))return null;
  const ip=match[1].split('.').map(Number),port=Number(match[2]);
  if(ip.some((v,i)=>v>255||String(v)!==match[1].split('.')[i])||port<1||port>65535)return null;
  if(!(ip[0]===10||ip[0]===172&&ip[1]>=16&&ip[1]<=31||ip[0]===192&&ip[1]===168))return null;
  if(ip[3]===0||ip[3]===255)return null;
  return {base:'http://'+match[1]+':'+port,authority:match[1]+':'+port,token:arg.GatewayToken,
   connections:[1,2,4,8,16,32].includes(Number(arg.Connections))?Number(arg.Connections):8,
   floor:[32,64,128].includes(Number(arg.MinChunkKiB))?Number(arg.MinChunkKiB):128,
   cdn:/^upos-sz-mirror[a-z0-9-]+\.bilivideo\.com$/.test(arg.PreferredCDN||'')?arg.PreferredCDN:'upos-sz-mirror08c.bilivideo.com',auto:arg.AutoCDN!==false};
 }
 function eligible(request){
  if(!request||request.method!=='GET'||typeof request.url!=='string'||request.url.length>8192||/[\s\\]/.test(request.url))return false;
  const u=core.parseURL(request.url),h=core.headers(request.headers),r=core.parseRange(h.range);
  if(!u||!r||r.length>8*1024*1024||h.cookie||h.authorization||h[core.INTERNAL]||Object.keys(h).some(k=>k.startsWith('if-')))return false;
  const deadline=/(?:[?&])deadline=(\d+)(?:&|$)/.exec(u.query);
  return !(deadline&&Number(deadline[1])*1000<Date.now()+15000);
 }
 function fingerprint(c){let hash=2166136261;for(const char of c.base+'|'+c.token)hash=Math.imul(hash^char.charCodeAt(0),16777619);return (hash>>>0).toString(16);}
 function probe(client,c,path){return new Promise(resolve=>{
  try{client.get({url:c.base+path,headers:{'x-bili-gateway-token':c.token},node:'DIRECT',timeout:500,
   'auto-cookie':false,'auto-redirect':false,insecure:false},(error,response,body)=>{
    if(error||Number(response?.status)!==200||typeof body!=='string'||body.length>8192){resolve(null);return;}
    try{resolve(JSON.parse(body));}catch{resolve(null);}
   });}catch{resolve(null);}
 });}
 async function rewrite({request,arg,client,store}){
  const c=config(arg);if(!c||!eligible(request))return {};
  const id=fingerprint(c);let cached;
  try{cached=JSON.parse(store?.read(KEY)||'null');}catch{}
  if(!(cached?.id===id&&cached.at<=Date.now()&&Date.now()-cached.at<5000)){
   const health=await probe(client,c,'/health');
   if(health?.service!=='aijc123-bili-range-gateway'||health.ready!==true)return {};
   try{store?.write(JSON.stringify({id,at:Date.now()}),KEY);}catch{}
  }
  const old=core.headers(request.headers),headers={'Host':c.authority,'Range':old.range,'Accept-Encoding':'identity','x-bili-gateway-token':c.token};
  for(const name of ['user-agent','referer','accept'])if(old[name])headers[name]=old[name];
  return {url:c.base+'/range?source='+encodeURIComponent(request.url)+'&cdn='+c.cdn+'&connections='+c.connections+'&minChunkKiB='+c.floor+'&autoCDN='+c.auto,
   headers,node:'DIRECT'};
 }
 root.BiliGateway={config,eligible,rewrite,probe};
})(globalThis);
