import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const vendorPath = 'vendor/btr-0302b345/';
const btrBytes = readFileSync(vendorPath + 'range-core.js');
const provenance = JSON.parse(readFileSync(vendorPath + 'provenance.json','utf8'));
if (createHash('sha256').update(btrBytes).digest('hex') !== provenance.sha256) throw new Error('Vendored BTR core integrity mismatch');
const license = readFileSync(vendorPath + 'LICENSE', 'utf8');
const btr = `/* BTR range-core.js, upstream commit ${provenance.commit}\n${license}\n*/\n` + btrBytes.toString('utf8');
const sidxBytes=readFileSync(vendorPath+'sidx.js'),sidxProvenance=JSON.parse(readFileSync(vendorPath+'sidx-provenance.json','utf8'));
if(createHash('sha256').update(sidxBytes).digest('hex')!==sidxProvenance.sha256)throw new Error('Vendored BTR SIDX integrity mismatch');
const sidx=`/* BTR sidx.js, unchanged ${sidxProvenance.commit}; MIT license above. */\n`+sidxBytes.toString('utf8');
const sourceRoot='src/loon/',manifest=JSON.parse(readFileSync(sourceRoot+'bundle.json','utf8'));
if(manifest.schema!==1)throw new Error('Unsupported Loon bundle manifest');
const cache=new Map([['btr',btr],['sidx',sidx]]);
function readModule(name){
 if(cache.has(name))return cache.get(name);
 if(typeof name!=='string'||!/^[a-z0-9-]+\.js$/.test(name))throw new Error('Invalid Loon module name');
 let text=readFileSync(sourceRoot+name,'utf8');
 if(name==='candidates.js')text=text.replace('__BILI_CDN_INVENTORY__',JSON.stringify(inventory));
 cache.set(name,text);return text;
}
const diagnostics=readModule(manifest.versionSource);
const inventory=JSON.parse(readFileSync('data/cdn-candidates.json','utf8'));
if(!Array.isArray(inventory.hosts)||inventory.hosts.length>16||inventory.hosts.some(h=>typeof h!=='string'||!/^(?:upos-sz-[a-z0-9-]+|cn-hk-eq-[a-z0-9-]+)\.bilivideo\.com$/.test(h)))throw new Error('Invalid CDN menu inventory');
const preferred='upos-sz-mirror08c.bilivideo.com';
if(!inventory.groups||['baseline','mainland','overseas'].some(key=>!Array.isArray(inventory.groups[key])||!inventory.groups[key].length||inventory.groups[key].some(h=>!inventory.hosts.includes(h))))throw new Error('Invalid CDN groups');
const candidateOptions=[preferred,...inventory.hosts.filter(h=>h!==preferred)].map(h=>JSON.stringify(h)).join(',');
const version=/const VERSION = '([^']+)'/.exec(diagnostics)[1];
const profileFlag=profile=>'globalThis.BiliRangeProfile='+JSON.stringify(profile)+';';
const advancedArguments=[
 'Connections = select,4,6,8,16,32,2,1,type=number,tag=并发上限（实际受块大小约束）',
 'MinChunkKiB = select,128,64,32,type=number,tag=最小分片 KiB',
 'GlobalJobs = select,16,24,32,8,type=number,tag=全局子请求预算',
 'TrialMode = select,"off","4vs8","4vs16","4vs32","8vs16","8vs32",tag=并发交替对照',
 'HTTPProtocol = select,"h1","h2",tag=HTTP 协议偏好',
 'PlaybackRate = select,1.5,1,1.25,2,type=number,tag=诊断假设倍速（不会改变播放）',
 'WarmDNS = switch,true,tag=切换网络后预热 DNS',
 'MaxMiB = select,4,2,8,type=number,tag=范围上限 MiB',
 'AutoCDN = switch,true,tag=根据本机传输选择 CDN',
 'PreferredCDN = select,'+candidateOptions+',tag=初始候选 CDN',
 'CDNGroup = select,"baseline","mainland","overseas","all",tag=备用组（保留首选）',
 'Debug = switch,false,tag=诊断日志'];
const requestPattern='^https?:\\/\\/(?:[a-z0-9-]+\\.bilivideo\\.com|[a-z0-9-]+\\.mcdn\\.bilivideo\\.cn|upos-(?:sz|hz|bstar1)-mirrorakam\\.akamaized\\.net)(?::(?:80|443|4480|4483|8000|8082|9102))?\\/(?:upgcxcode|v1\\/resource\\/upgcxcode)\\/';
const argumentsFor=keys=>'argument=['+keys.map(k=>'{'+k+'}').join(',')+']';
export function buildProfiles({profiles=manifest.profiles,out='dist/lab',releaseVersion=version,
 namespace='aijc123.BiliRange.lab.v1',read=readModule,extra=[]}={}){
 const version=releaseVersion,base='https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/range-v'+version+'/'+out+'/';
 mkdirSync(out,{recursive:true});
 const isolate=text=>text.replaceAll('aijc123.BiliRange.v1',namespace);
 const modules=[...manifest.download.map(read),...extra],diagnosticModules=[...manifest.diagnostics.map(read),...extra],networkModules=manifest.network.map(read);
 for(const p of profiles){
 const automatic=p.mode==='automatic',flag=profileFlag(p.mode),range='range'+p.suffix+'.bundle.js',diagnose='diagnose'+p.suffix+'.bundle.js',network='network-reset'+p.suffix+'.bundle.js';
 writeFileSync(out+'/'+range,isolate([...modules,flag,read(manifest.entries.download)].join('\n')));
 writeFileSync(out+'/'+diagnose,isolate([...diagnosticModules,flag,read(manifest.entries.diagnostics)].join('\n')));
 writeFileSync(out+'/'+network,isolate([...networkModules,flag,read(manifest.entries.network)].join('\n')));
 const requestKeys=automatic?['Enabled']:['Enabled',...advancedArguments.map(line=>line.split(' = ')[0])];
 const networkKeys=automatic?['Enabled']:['Enabled','WarmDNS','PreferredCDN','CDNGroup'];
 const lines=['#!name = '+p.title,
  '#!desc = 自动选择节点与有限 Range 并发；实验功能，效果待真机验证。只启用一份 B 站 CDN/Range 插件。',
  '#!author = aijc123','#!homepage = https://github.com/aijc123/Bilibili-Redirect-US','#!version = '+version,
  '#!loon_version = 3.5.1','#!system = iOS,iPadOS','','[Argument]','Enabled = switch,true,tag=启用加速',
  ...(automatic?[]:advancedArguments),'','[General]',
  'force-http-engine-hosts = upos-sz-*.bilivideo.com:80, cn-hk-eq-*.bilivideo.com:80, upos-*-mirrorakam.akamaized.net:80',
  '','[Script]','http-request '+requestPattern+' script-path='+base+range+', timeout=8, tag=Bili Range 下载, '+argumentsFor(requestKeys),
  'generic script-path='+base+diagnose+', tag=Bili Range 诊断',
  ...(automatic?['generic script-path='+base+'diagnose-advanced.bundle.js, tag=Bili Range 详细诊断']:[]),
  'generic script-path='+base+'dns-diagnose.bundle.js, timeout=20, tag=Bili DNS 诊断',
  'network-changed script-path='+base+network+', timeout=20, tag=Bili Range 网络变化, '+argumentsFor(networkKeys),
  '','[MITM]','hostname = *.bilivideo.com, *.mcdn.bilivideo.cn, upos-*-mirrorakam.akamaized.net',''];
 writeFileSync(out+'/'+p.plugin,lines.join('\n'));
 }
 // The automatic profile exposes full diagnosis without exposing developer options.
 if(!profiles.some(p=>p.suffix==='-advanced'))writeFileSync(out+'/diagnose-advanced.bundle.js',isolate([...diagnosticModules,profileFlag('advanced'),read(manifest.entries.diagnostics)].join('\n')));
 writeFileSync(out+'/dns-diagnose.bundle.js',read(manifest.entries.dns));
}
export {readModule};
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 buildProfiles();
 console.log('Built one-switch automatic subscription and separate comparison tool; frozen releases unchanged.');
}
