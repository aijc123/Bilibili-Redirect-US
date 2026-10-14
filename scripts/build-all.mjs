/* Current supported Loon channels, without installing upstream build tools. */
import {spawnSync} from 'node:child_process';
for(const script of ['build-range','build-adaptive','build-next','build-gateway']){
 const result=spawnSync(process.execPath,['scripts/'+script+'.mjs'],{stdio:'inherit'});
 if(result.error||result.status!==0){if(result.error)console.error(result.error.message);process.exit(result.status||1);}
}
