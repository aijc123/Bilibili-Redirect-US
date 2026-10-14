/* One dependency-free verification entry point for Windows and GitHub Linux. */
import {spawnSync} from 'node:child_process';
function run(command,args,env={}){
 const result=spawnSync(command,args,{stdio:'inherit',env:{...process.env,...env}});
 if(result.error||result.status!==0){if(result.error)console.error(result.error.message);process.exit(result.status||1);}
}
run(process.execPath,['scripts/check-docs.mjs']);
run(process.execPath,['scripts/build-all.mjs']);
const suites=['adaptive','recovery','media-benchmark','automatic','range','loon-http','budget','measurements','trials','dns-diagnose','media-info','cdn-health','us-bundle','gateway','gateway-loon','pinned-capability'];
run(process.execPath,['--test',...suites.map(name=>'tests/'+name+'.test.mjs')],{BILI_RANGE_CHANNEL:'candidate'});
run(process.execPath,['--test',...['adaptive','recovery','media-benchmark','next'].map(name=>'tests/'+name+'.test.mjs')],{BILI_RANGE_CHANNEL:'next'});
if(process.argv.includes('--check-generated'))run('git',['diff','--exit-code','--','dist/lab','dist/candidate','dist/preview','dist/gateway']);
