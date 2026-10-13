/* Verify local links after documentation moves; no network or third-party packages. */
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const markdown=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?markdown(dir+'/'+e.name):e.name.endsWith('.md')?[dir+'/'+e.name]:[]);
const files=[...readdirSync('.').filter(f=>f.endsWith('.md')), ...markdown('docs')],errors=[];
let checked=0;
for(const file of files){
 const text=readFileSync(file,'utf8');
 for(const match of text.matchAll(/\]\(([^)]+)\)/g)){
  const target=match[1];if(/^(?:https?:|#)/.test(target))continue;
  const local=target.split('#')[0];if(!local)continue;checked++;
  if(!existsSync(resolve(dirname(file),local)))errors.push(file+': '+target);
 }
 for(const match of text.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)){
  if(/^https?:/.test(match[1]))continue;checked++;
  if(!existsSync(resolve(dirname(file),match[1])))errors.push(file+': image '+match[1]);
 }
}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
else console.log(`Documentation: ${files.length} files, ${checked} local links/images valid.`);
