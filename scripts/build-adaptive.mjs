/* Reuse the normal builder and adapter; add explicit checked candidate hooks.
 * Main/tagged 0.1.14 artifacts must remain byte-identical. */
import {readFileSync,writeFileSync} from 'node:fs';
import {buildProfiles,readModule} from './build-range.mjs';
const config=JSON.parse(readFileSync('src/loon/adaptive.json','utf8'));
const adaptive=readModule('adaptive.js').replace('__BILI_ADAPTIVE_CONFIG__',JSON.stringify(config));
function once(text,from,to){
 if(text.split(from).length!==2)throw new Error('Candidate integration anchor missing/ambiguous: '+from);
 return text.replace(from,to);
}
function read(name){
 let text=readModule(name);
 if(name==='diagnostics.js')text=once(text,"const VERSION = '0.1.14-experimental';","const VERSION = '"+config.version+"';");
 if(name==='range-download.js'){
  text=once(text,'(?:upos-sz-[a-z0-9-]+|cn-hk-eq-[a-z0-9-]+)\\.bilivideo\\.com$',
   '(?:(?:upos-(?:sz|hz|bstar1)-[a-z0-9-]+|cn-hk-eq-[a-z0-9-]+)\\.bilivideo\\.com|upos-(?:sz|hz|bstar1)-mirrorakam\\.akamaized\\.net)$');
  text=once(text,"const url = u.protocol + '://' + target + u.path + u.query;",
   "const url = target === u.host ? request.url : u.protocol + '://' + target + u.path + u.query;");
  text=once(text,'const cooldownMs = integrity ? 60000 : statusFailure ? 1500',
   'const cooldownMs = integrity || statusFailure ? 1500');
 }
 if(name==='policy.js')text=once(text,"const hosts=root.BiliRangeCandidates.pool('upos-sz-mirror08c.bilivideo.com','all');",
  "const hosts=globalThis.BiliRangeRecovery.pool(state,request,root.BiliRangeCandidates.pool('upos-sz-mirror08c.bilivideo.com','all'),at);");
 // Extend the shared balanced comparator for the last adjacent rung, candidate only.
 if(name==='measurements.js'){
  text=once(text,"'8vs32':Object.freeze([8,32])","'8vs32':Object.freeze([8,32]),'16vs32':Object.freeze([16,32])");
  text=once(text,'([48]vs(?:8|16|32))','((?:[48]vs(?:8|16|32))|16vs32)');
 }
 if(name==='trials.js'){
  text=once(text,'(?:4vs(?:8|16|32)|8vs(?:16|32))','(?:4vs(?:8|16|32)|8vs(?:16|32)|16vs32)');
  text=once(text,"s.minChunkKiB:128].join('|')","s.minChunkKiB:128,s.adaptiveScheme||'unknown',s.adaptiveEntity||'unknown'].join('|')");
 }
 if(name==='loon.js'){
  text=once(text,'const options=policy.options;','globalThis.BiliRangeAdaptive.configure(state,$request,policy);\n  const options=policy.options;');
  text=once(text,'globalThis.BiliRangeTrials.plan(state,$request,policy.trialMode)','globalThis.BiliRangeAdaptive.plan(state,$request,policy.trialMode,undefined,undefined,policy.options.hosts)');
  text=once(text,'state.epoch = latest.epoch || 0;',`state.epoch = latest.epoch || 0;
    globalThis.BiliRangeAdaptive.observe(state,$request,result,{policy,epoch,inflight,trial:trialPlan?.trial},latest);
    globalThis.BiliRangeRecovery.observe(state,$request,result,{epoch},latest);
    globalThis.BiliRangeMediaBenchmark.capture($persistentStore,$request,result,epoch,state.epoch);`);
  text=read('media-benchmark.js')+'\n'+text;
 }
 if(name==='network-reset.js'){
  text=once(text,'const count=Object.keys(state.hosts||{}).length,epoch=Number(state.epoch)||0;',
   `const count=Object.keys(state.hosts||{}).length,epoch=Number(state.epoch)||0;
  const previousRoute=state.recovery?.last;
  const knownSources=previousRoute&&previousRoute.epoch===epoch&&Number.isFinite(previousRoute.at)&&previousRoute.at<=Date.now()&&Date.now()-previousRoute.at<120000?
    [...new Set([previousRoute.source,previousRoute.selected].filter(globalThis.BiliRange.isTargetHost))]:[];`);
  text=once(text,'state.hosts={};state.epoch=epoch+1;','state.hosts={};state.epoch=epoch+1;state.adaptive={schema:1,entries:{}};state.recovery={schema:1,entries:{}};state.trials={groups:{}};state.trialSafety={};try{$persistentStore.write(null,KEY+".mediaCapture");}catch{}');
  text=once(text,'const hosts=globalThis.BiliRangeCandidates.pool(arg.PreferredCDN,arg.CDNGroup).slice(0,4);',
   'const hosts=[...new Set([...knownSources,...globalThis.BiliRangeCandidates.pool(arg.PreferredCDN,arg.CDNGroup)])].slice(0,4);');
 }
 return text;
}
const namespace='aijc123.BiliRange.adaptive.v1',out='dist/candidate';
buildProfiles({out,releaseVersion:config.version,namespace,read,extra:[adaptive,read('recovery.js')],
 profiles:[{mode:'automatic',suffix:'',plugin:'BiliBili.Range.Adaptive.plugin',title:'BiliBili Range 自动调优候选 · aijc123'}]});
const mediaModules=['btr','range-download.js','loon-http.js','budget.js','measurements.js','media-benchmark.js','media-benchmark-entry.js'];
writeFileSync(out+'/media-benchmark.bundle.js',mediaModules.map(read).join('\n').replaceAll('aijc123.BiliRange.v1',namespace));
const pluginPath=out+'/BiliBili.Range.Adaptive.plugin';
writeFileSync(pluginPath,once(readFileSync(pluginPath,'utf8'),'\n[MITM]',
 'generic script-path=https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/range-v'+config.version+'/'+out+'/media-benchmark.bundle.js, timeout=90, tag=Bili 媒体测速\n\n[MITM]'));
console.log('Built isolated adaptive candidate; published automatic version preserved.');
