/* Separate research channel. Reuse the 19 builder/controller with checked hooks;
 * rebuilding this file must never replace the phone-tested 19 subscription. */
import {readFileSync} from 'node:fs';
import {buildAdaptive,once} from './build-adaptive.mjs';
import {readModule} from './build-range.mjs';
const config={...JSON.parse(readFileSync('src/loon/adaptive.json','utf8')),
 ...JSON.parse(readFileSync('src/loon/next.json','utf8'))};
const extraModes="'1vs2':Object.freeze([1,2]),'2vs3':Object.freeze([2,3]),'2vs4':Object.freeze([2,4]),'3vs5':Object.freeze([3,5]),'3vs6':Object.freeze([3,6]),'4vs7':Object.freeze([4,7]),";
const modePattern='(?:1vs2|2vs[34]|3vs[56]|4vs[78]|[48]vs(?:8|16|32)|16vs32)';
function replaceCount(text,from,to,count){
 if(text.split(from).length!==count+1)throw new Error('Next integration count mismatch: '+from);
 return text.replaceAll(from,to);
}
function transform(name,text){
 if(name==='range-download.js'){
  text=once(text,'[1, 2, 4, 6, 8, 16, 32]','[1, 2, 3, 4, 5, 6, 7, 8, 16, 32]');
  text=once(text,"if (options.enabled === false) return skip('disabled');","if (options.enabled === false) return skip('disabled');\n    if(options.deferReason==='transport-rest')return skip('transport-rest');");
 }
 if(name==='diagnostics.js'){
  text=replaceCount(text,'[1,2,4,6,8,16,32]','[1,2,3,4,5,6,7,8,16,32]',2);
  text=once(text,"transport: '子请求网络错误'","'transport-rest':'网络错误密集，暂放行原请求', transport: '子请求网络错误'");
 }
 if(name==='loon.js'){
  text=once(text,
   'if(globalThis.BiliRangeMedia)globalThis.BiliRangeMedia.observe(state,$request,result,{epoch});',
   'if(globalThis.BiliRangeMedia&&Number(latest.epoch||0)===Number(epoch))globalThis.BiliRangeMedia.observe(state,$request,result,{epoch});');
  text=once(text,'globalThis.BiliRangeAdaptive.configure(state,$request,policy);',
   'globalThis.BiliRangeAdaptive.configure(state,$request,policy);\n  globalThis.BiliRangeReliability.configure(state,$request,policy);');
  text=once(text,'globalThis.BiliRangeRecovery.observe(state,$request,result,{epoch},latest);',
   'globalThis.BiliRangeRecovery.observe(state,$request,result,{epoch},latest);\n    globalThis.BiliRangeReliability.observe(state,$request,policy,epoch,latest);');
 }
 if(name==='network-reset.js')text=once(text,'state.trials={groups:{}};state.trialSafety={};',
  'state.trials={groups:{}};state.trialSafety={};state.protection={};');
 if(name==='media-benchmark-entry.js')text=once(text,'console.log(summary);',
  "summary='版本 "+config.version+"\\n'+summary;\n    console.log(summary);");
 if(name==='measurements.js'){
  text=once(text,"Object.freeze({'4vs8'","Object.freeze({"+extraModes+"'4vs8'");
  text=once(text,'((?:[48]vs(?:8|16|32))|16vs32)','('+modePattern+')');
  text=once(text,'[1,2,4,6,8,16,32]','[1,2,3,4,5,6,7,8,16,32]');
 }
 if(name==='trials.js'){
  text=once(text,'(?:4vs(?:8|16|32)|8vs(?:16|32)|16vs32)',modePattern);
  text=once(text,'const identity=root.BiliRangeMeasurements.identity(state,request,true);','const identity=root.BiliRangeSmall.signature(state,request);');
 }
 if(name==='adaptive.js'){
  text=once(text,'const M=()=>root.BiliRangeMeasurements,T=()=>root.BiliRangeTrials;','const S=root.BiliRangeSmall;\n  const M=()=>root.BiliRangeMeasurements,T=()=>root.BiliRangeTrials;');
  text=replaceCount(text,'[4,8,16,32].includes','S.choices.includes',4);
  text=replaceCount(text,"['4vs8','8vs16','16vs32'].includes","S.modes.includes",2);
  text=once(text,'const identity=M().identity(state,request,true);','const identity=S.signature(state,request);');
  text=once(text,'signature:M().identity(state,request,true)','signature:S.signature(state,request)');
  text=once(text,'sample.adaptiveSignature=M().identity(state,request,true);','sample.adaptiveSignature=S.signature(state,request);');
  text=once(text,"choice:8,reason:'warmup'","choice:S.baseline(bytes),reason:'warmup'");
  text=once(text,"if(bytes<1024*1024){ctx.reason='size-cap';return;}","const stages=S.ladder(bytes),cold=S.baseline(bytes);\n    if(!stages.length)return;");
  text=once(text,"let choice=8,stage='4vs8',lastEvidence;","let choice=cold,stage=stages[0][0],lastEvidence;");
  text=once(text,"of [['4vs8',1024*1024],['8vs16',2*1024*1024],['16vs32',4*1024*1024]]","of stages");
  text=once(text,"ctx.reason='regression';ctx.choice=8;policy.options.connections=8;return;","ctx.reason='regression';ctx.choice=cold;policy.options.connections=cold;return;");
  text=once(text,"stage!=='4vs8'","stage!==stages[0][0]");
  text=once(text,"const early=evidence(samples,s.token,epoch,stage).g;",`const early=evidence(samples,s.token,epoch,stage).g;
    // The cold/default upper arm is already supported by ordinary traffic. If
    // a complete clean block makes the exploratory lower arm very slow, stop
    // exposing playback to it instead of insisting on all twenty probes.
    if(stage===stages[0][0]&&early?.cleanBlocks>=1&&early.blocks===early.cleanBlocks&&
      early.ratio>=2.5&&early.p90MsA>Math.max(1500,early.p90MsB*2)){
      ctx.reason='probe-loss';return;
    }`);
  text=once(text,"choice:ctx.reason==='probe-loss'?ctx.choice:8","choice:ctx.reason==='probe-loss'?ctx.choice:S.baseline(ctx.bytes)");
  text=once(text,"regression:'变慢后恢复8路'","regression:'变慢后恢复按大小默认'");
  text=once(text,"baseline:'原8路策略'","baseline:'按请求大小默认策略'");
 }
 return text;
}
buildAdaptive({config,out:'dist/preview',namespace:'aijc123.BiliRange.preview.v1',
 plugin:'BiliBili.Range.Preview.plugin',title:'BiliBili Range 自动实验候选 · aijc123',
 transform,extra:[readModule('small-ranges.js'),readModule('reliability.js')]});
