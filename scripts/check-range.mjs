/* One dependency-free verification entry point for Windows and GitHub Linux. */
import {spawnSync} from 'node:child_process';
function run(command,args){
 const result=spawnSync(command,args,{stdio:'inherit'});
 if(result.error||result.status!==0){if(result.error)console.error(result.error.message);process.exit(result.status||1);}
}
run(process.execPath,['scripts/check-docs.mjs']);
for(const build of ['scripts/build-range.mjs','scripts/build-gateway.mjs'])run(process.execPath,[build]);
const suites=['automatic','range','loon-http','budget','measurements','trials','dns-diagnose','media-info','cdn-health','us-bundle','gateway','gateway-loon'];
run(process.execPath,['--test',...suites.map(name=>'tests/'+name+'.test.mjs')]);
if(process.argv.includes('--check-generated'))run('git',['diff','--exit-code','--','dist/lab','dist/gateway']);
