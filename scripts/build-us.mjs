import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const base='https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/main/dist/';
const hosts=['upos-sz-mirrorhwo1.bilivideo.com','upos-sz-mirror08c.bilivideo.com'];
const keys=['Host.OverseaVideo','Host.BStar','Host.PCDN'];
const input=p=>readFileSync(`vendor/upstream-v0.2.24/${p}`,'utf8');
mkdirSync('dist',{recursive:true});
let plugin=input('BiliBili.Redirect.plugin');
plugin=plugin.replace(/^#!name = .*$/m,'#!name = 📺 BiliBili: Redirect US (aijc123)')
 .replace(/^#!homepage = .*$/m,'#!homepage = https://github.com/aijc123/Bilibili-Redirect-US')
 .replace(/^#!version = .*$/m,'#!version = 0.2.24-us.1')
 .replace(/^#!date = .*$/m,'#!date = 2026-10-13')
 .replace('[Argument]','#!loon_version = 3.5.1\n# Modified from Biliverse/Redirect v0.2.24 under Apache-2.0.\n\n[Argument]')
 .replaceAll('https://github.com/Biliverse/Redirect/releases/download/v0.2.24/',base);
for(const key of keys) plugin=plugin.replace(`${key} = select,`,`${key} = select,${hosts.map(h=>JSON.stringify(h)).join(',')},`);
const config=JSON.parse(input('BiliBili.Redirect.boxjs.json'));
function patch(obj) {
 if(!obj||typeof obj!=='object')return;
 if(keys.includes(obj.id)||keys.includes(obj.key)||keys.some(k=>String(obj.id).endsWith('.'+k))) {
  if(Array.isArray(obj.items))obj.items.unshift(...hosts.map(h=>({key:h,label:h})));
  if('val' in obj)obj.val=hosts[0];
 }
 for(const value of Object.values(obj))if(typeof value==='object')patch(value);
}
patch(config);
writeFileSync('dist/BiliBili.Redirect.plugin',plugin);
writeFileSync('dist/BiliBili.Redirect.boxjs.json',JSON.stringify(config,null,2)+'\n');
writeFileSync('dist/request.bundle.js',input('request.bundle.js'));
console.log('Generated Loon subscription and vendored runtime.');
