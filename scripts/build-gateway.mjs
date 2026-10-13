import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='vendor/btr-0302b345/',bytes=readFileSync(root+'range-core.js'),provenance=JSON.parse(readFileSync(root+'provenance.json','utf8'));
if(createHash('sha256').update(bytes).digest('hex')!==provenance.sha256)throw Error('BTR integrity mismatch');
// Preserve the published gateway's adapter until a deliberate gateway version update.
const adapterRoot='vendor/loon-range-0.1.12/',adapter=readFileSync(adapterRoot+'range-core.js'),adapterProvenance=JSON.parse(readFileSync(adapterRoot+'provenance.json','utf8'));
if(createHash('sha256').update(adapter).digest('hex')!==adapterProvenance.sha256)throw Error('Pinned gateway adapter integrity mismatch');
const common='/* BTR range-core.js, unchanged '+provenance.commit+'\n'+readFileSync(root+'LICENSE','utf8')+'\n*/\n'+bytes.toString('utf8')+'\n'+adapter.toString('utf8')+'\n'+readFileSync('src/gateway/core.js','utf8');
const out='dist/gateway',version='0.1.1-experimental',base='https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/gateway-v'+version+'/'+out+'/';
mkdirSync(out,{recursive:true});
writeFileSync(out+'/rewrite.bundle.js',common+'\n'+readFileSync('src/gateway/loon.js','utf8'));
writeFileSync(out+'/diagnose.bundle.js',common+'\n'+readFileSync('src/gateway/diagnose.js','utf8'));
writeFileSync(out+'/network-reset.bundle.js',readFileSync('src/gateway/network-reset.js','utf8'));
writeFileSync(out+'/BiliBili.Range.Gateway.plugin',`#!name = BiliBili 电脑中转原型 · aijc123
#!desc = 需要同 Wi-Fi 的电脑运行服务；默认关闭。未进行 iPhone 安装和播放验证。停用其他 B 站 CDN/Range 插件。
#!author = aijc123
#!homepage = https://github.com/aijc123/Bilibili-Redirect-US/blob/main/GATEWAY-EXPERIMENT.md
#!version = ${version}
#!loon_version = 3.5.1
#!system = iOS,iPadOS

[Argument]
Enabled = switch,false,tag=启用电脑中转
GatewayBase = input,"",type=string,tag=电脑内网地址,desc=例如 http://192.168.0.50:9190
GatewayToken = input,"",type=string,tag=电脑私钥,desc=从电脑本地 session.json 复制；勿公开分享
Connections = select,8,16,32,4,2,1,type=number,tag=每请求并发上限
MinChunkKiB = select,128,64,32,type=number,tag=最小分片 KiB
AutoCDN = switch,true,tag=电脑按实际传输选择 CDN
PreferredCDN = select,"upos-sz-mirror08c.bilivideo.com","upos-sz-mirrorhwo1.bilivideo.com","upos-sz-mirrorhw.bilivideo.com","upos-sz-mirrorali.bilivideo.com",tag=初始 CDN

[General]
force-http-engine-hosts = upos-sz-*.bilivideo.com:80, cn-hk-eq-*.bilivideo.com:80, upos-*-mirrorakam.akamaized.net:80

[Script]
http-request ^https?:\\/\\/(?:upos-(?:sz|hz|bstar1)-[a-z0-9-]+\\.bilivideo\\.com|cn-hk-eq-[a-z0-9-]+\\.bilivideo\\.com|upos-(?:sz|hz|bstar1)-mirrorakam\\.akamaized\\.net)(?::(?:80|443|4483))?\\/upgcxcode\\/ script-path=${base}rewrite.bundle.js, timeout=3, tag=Bili 电脑中转, argument=[{Enabled},{GatewayBase},{GatewayToken},{Connections},{MinChunkKiB},{AutoCDN},{PreferredCDN}]
generic script-path=${base}diagnose.bundle.js, timeout=3, tag=Bili 电脑中转诊断, argument=[{Enabled},{GatewayBase},{GatewayToken}]
network-changed script-path=${base}network-reset.bundle.js, timeout=3, tag=Bili 电脑中转网络变化

[MITM]
hostname = *.bilivideo.com, upos-*-mirrorakam.akamaized.net
`);
console.log('Built opt-in gateway prototype; standalone Lab unchanged.');
