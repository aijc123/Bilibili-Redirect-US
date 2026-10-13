import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const vendorPath = 'vendor/btr-0302b345/';
const btrBytes = readFileSync(vendorPath + 'range-core.js');
const provenance = JSON.parse(readFileSync(vendorPath + 'provenance.json','utf8'));
if (createHash('sha256').update(btrBytes).digest('hex') !== provenance.sha256) throw new Error('Vendored BTR core integrity mismatch');
const license = readFileSync(vendorPath + 'LICENSE', 'utf8');
const btr = `/* BTR range-core.js, upstream commit ${provenance.commit}\n${license}\n*/\n` + btrBytes.toString('utf8');
const sidxBytes=readFileSync(vendorPath+'sidx.js'),sidxProvenance=JSON.parse(readFileSync(vendorPath+'sidx-provenance.json','utf8'));
if(createHash('sha256').update(sidxBytes).digest('hex')!==sidxProvenance.sha256)throw new Error('Vendored BTR SIDX integrity mismatch');
const sidx=`/* BTR sidx.js, unchanged ${sidxProvenance.commit}; MIT license above. */\n`+sidxBytes.toString('utf8');
const core = readFileSync('src/accelerator/range-core.js', 'utf8');
const adapter = readFileSync('src/accelerator/loon.js', 'utf8');
const diagnostics = readFileSync('src/accelerator/diagnostics.js', 'utf8');
const http = readFileSync('src/accelerator/loon-http.js','utf8');
const measurements = readFileSync('src/accelerator/measurements.js','utf8');
const budget=readFileSync('src/accelerator/budget.js','utf8');
const trials=readFileSync('src/accelerator/trials.js','utf8');
const media=readFileSync('src/accelerator/media-info.js','utf8');
const inventory=JSON.parse(readFileSync('data/cdn-candidates.json','utf8'));
if(!Array.isArray(inventory.hosts)||inventory.hosts.length>12||inventory.hosts.some(h=>!/^upos-sz-mirror[a-z0-9-]+\.bilivideo\.com$/.test(h)))throw new Error('Invalid CDN menu inventory');
const candidateOptions=inventory.hosts.map(h=>JSON.stringify(h)).join(',');
const out = 'dist/lab';
mkdirSync(out,{recursive:true});
const isolate = text => text.replaceAll('aijc123.BiliRange.v1','aijc123.BiliRange.lab.v1');
writeFileSync(out + '/range.bundle.js', isolate(btr + '\n' + sidx + '\n' + core + '\n' + http + '\n' + budget + '\n' + measurements + '\n' + trials + '\n' + media + '\n' + diagnostics + '\n' + adapter));
writeFileSync(out + '/diagnose.bundle.js', isolate(measurements+'\n'+trials+'\n'+media+'\n'+diagnostics + '\n' + readFileSync('src/accelerator/manual-diagnose.js','utf8')));
writeFileSync(out + '/network-reset.bundle.js',isolate(readFileSync('src/accelerator/network-reset.js','utf8')));
writeFileSync(out + '/dns-diagnose.bundle.js',readFileSync('src/accelerator/dns-diagnose.js','utf8'));
const version = /const VERSION = '([^']+)'/.exec(diagnostics)[1];
const base = `https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/range-v${version}/dist/lab/`;
writeFileSync(out + '/BiliBili.Range.Lab.plugin', `#!name = BiliBili Range 研发版 · aijc123
#!desc = 有限 Range 并发下载与本机传输选 CDN；实验功能，需真机验证。请停用其他 B 站 CDN 复写插件。
#!author = aijc123
#!homepage = https://github.com/aijc123/Bilibili-Redirect-US
#!version = ${version}
#!loon_version = 3.5.1
#!system = iOS,iPadOS

[Argument]
Enabled = switch,true,tag=启用实验下载
Connections = select,4,6,8,16,32,2,1,type=number,tag=并发上限（实际受块大小约束）
MinChunkKiB = select,128,64,32,type=number,tag=最小分片 KiB（小片仅作对照试验）
GlobalJobs = select,16,24,32,8,type=number,tag=全局子请求预算（尽力协调）
TrialMode = select,"off","4vs8","4vs16","4vs32",tag=并发交替对照（固定首选 CDN）
HTTPProtocol = select,"h1","h2",tag=HTTP 协议偏好（实际协商未知）
PlaybackRate = select,1.5,1,1.25,2,type=number,tag=诊断假设倍速（不会改变播放）
WarmDNS = switch,true,tag=切换网络后预热候选 DNS
MaxMiB = select,4,2,8,type=number,tag=接管范围上限 MiB
AutoCDN = switch,true,tag=根据本机传输选择 CDN
PreferredCDN = select,${candidateOptions},tag=初始候选 CDN
Debug = switch,false,tag=诊断日志

[General]
force-http-engine-hosts = upos-sz-*.bilivideo.com:80, cn-hk-eq-*.bilivideo.com:80, upos-*-mirrorakam.akamaized.net:80

[Script]
http-request ^https?:\\/\\/(?:[a-z0-9-]+\\.bilivideo\\.com|[a-z0-9-]+\\.mcdn\\.bilivideo\\.cn|upos-(?:sz|hz|bstar1)-mirrorakam\\.akamaized\\.net)(?::(?:80|443|4480|4483|8000|8082|9102))?\\/(?:upgcxcode|v1\\/resource\\/upgcxcode)\\/ script-path=${base}range.bundle.js, timeout=8, tag=Bili Range 下载, argument=[{Enabled},{Connections},{MinChunkKiB},{GlobalJobs},{TrialMode},{HTTPProtocol},{PlaybackRate},{MaxMiB},{AutoCDN},{PreferredCDN},{Debug}]
generic script-path=${base}diagnose.bundle.js, tag=Bili Range 诊断
generic script-path=${base}dns-diagnose.bundle.js, timeout=20, tag=Bili DNS 诊断
network-changed script-path=${base}network-reset.bundle.js, timeout=20, tag=Bili Range 网络变化, argument=[{Enabled},{WarmDNS},{PreferredCDN}]

[MITM]
hostname = *.bilivideo.com, *.mcdn.bilivideo.cn, upos-*-mirrorakam.akamaized.net
`);
console.log('Built lab version; phone-tested 0.1.3 and 0.1.4 subscriptions are unchanged.');
