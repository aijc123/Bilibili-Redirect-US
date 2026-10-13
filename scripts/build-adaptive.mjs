/* Reuse the normal builder and adapter; add explicit checked candidate hooks.
 * Main/tagged 0.1.14 artifacts must remain byte-identical. */
import {readFileSync} from 'node:fs';
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
  text=once(text,'globalThis.BiliRangeTrials.plan(state,$request,policy.trialMode)','globalThis.BiliRangeAdaptive.plan(state,$request,policy.trialMode)');
  text=once(text,'state.epoch = latest.epoch || 0;',`state.epoch = latest.epoch || 0;
    globalThis.BiliRangeAdaptive.observe(state,$request,result,{policy,epoch,inflight,trial:trialPlan?.trial},latest);`);
 }
 if(name==='network-reset.js')text=once(text,'state.hosts={};state.epoch=epoch+1;','state.hosts={};state.epoch=epoch+1;state.adaptive={schema:1,entries:{}};state.trials={groups:{}};state.trialSafety={};');
 return text;
}
buildProfiles({out:'dist/candidate',releaseVersion:config.version,namespace:'aijc123.BiliRange.adaptive.v1',read,extra:[adaptive],
 profiles:[{mode:'automatic',suffix:'',plugin:'BiliBili.Range.Adaptive.plugin',title:'BiliBili Range 自动调优候选 · aijc123'}]});
console.log('Built isolated adaptive candidate; published automatic version preserved.');
