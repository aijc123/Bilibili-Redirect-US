import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const vendorPath = 'vendor/btr-0302b345/';
const btrBytes = readFileSync(vendorPath + 'range-core.js');
const provenance = JSON.parse(readFileSync(vendorPath + 'provenance.json','utf8'));
if (createHash('sha256').update(btrBytes).digest('hex') !== provenance.sha256) throw new Error('Vendored BTR core integrity mismatch');
const license = readFileSync(vendorPath + 'LICENSE', 'utf8');
const btr = `/* BTR range-core.js, upstream commit ${provenance.commit}\n${license}\n*/\n` + btrBytes.toString('utf8');
const core = readFileSync('src/accelerator/range-core.js', 'utf8');
const adapter = readFileSync('src/accelerator/loon.js', 'utf8');
const diagnostics = readFileSync('src/accelerator/diagnostics.js', 'utf8');
writeFileSync('dist/range.bundle.js', btr + '\n' + core + '\n' + diagnostics + '\n' + adapter);
const base = 'https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/main/dist/';
writeFileSync('dist/BiliBili.Range.Experimental.plugin', `#!name = BiliBili Range 实验版 · aijc123
#!desc = 有限 Range 并发下载与本机传输选 CDN；实验功能，需真机验证。请停用其他 B 站 CDN 复写插件。
#!author = aijc123
#!homepage = https://github.com/aijc123/Bilibili-Redirect-US
#!version = 0.1.2-experimental
#!loon_version = 3.5.1
#!system = iOS,iPadOS

[Argument]
Enabled = switch,true,tag=启用实验下载
Connections = select,2,4,1,type=number,tag=每请求并发上限（1 为对照）
MaxMiB = select,4,2,8,type=number,tag=接管范围上限 MiB
AutoCDN = switch,true,tag=根据本机传输选择 CDN
PreferredCDN = select,"upos-sz-mirrorhwo1.bilivideo.com","upos-sz-mirror08c.bilivideo.com","upos-sz-mirrorhw.bilivideo.com","upos-sz-mirrorali.bilivideo.com",tag=初始候选 CDN
Debug = switch,false,tag=诊断日志

[General]
force-http-engine-hosts = upos-sz-*.bilivideo.com:80, cn-hk-eq-*.bilivideo.com:80, upos-*-mirrorakam.akamaized.net:80

[Script]
http-request ^https?:\\/\\/(?:[a-z0-9-]+\\.bilivideo\\.com|[a-z0-9-]+\\.mcdn\\.bilivideo\\.cn|upos-(?:sz|hz|bstar1)-mirrorakam\\.akamaized\\.net)(?::(?:80|443|4480|4483|8000|8082|9102))?\\/(?:upgcxcode|v1\\/resource\\/upgcxcode)\\/ script-path=${base}range.bundle.js, timeout=8, tag=Bili Range 下载, argument=[{Enabled},{Connections},{MaxMiB},{AutoCDN},{PreferredCDN},{Debug}]
generic script-path=${base}range.bundle.js, tag=Bili Range 诊断
network-changed script-path=${base}range.bundle.js, argument="Action=reset", tag=Bili Range 网络变化

[MITM]
hostname = *.bilivideo.com, *.mcdn.bilivideo.cn, upos-*-mirrorakam.akamaized.net
`);
console.log('Built bounded-range experimental plugin.');
