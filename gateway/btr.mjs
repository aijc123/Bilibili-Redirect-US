// Load fixed MIT BTR primitives once. No fake player-buffer observations.
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const vendor=new URL('../vendor/btr-0302b345/',import.meta.url);
const context={Uint8Array,URL,Date,performance,DOMException,console};
const provenance=JSON.parse(readFileSync(new URL('gateway-provenance.json',vendor),'utf8'));
const rangeProvenance=JSON.parse(readFileSync(new URL('provenance.json',vendor),'utf8'));
function fixed(name,hash){const bytes=readFileSync(new URL(name,vendor));if(createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('BTR integrity mismatch');return bytes.toString('utf8');}
vm.runInNewContext(fixed('range-core.js',rangeProvenance.sha256),context);
vm.runInNewContext(fixed('cdn-resolver.js',provenance.files['cdn-resolver.js']),context);
// The redirect gate is shared with the tested Loon adapter, not another implementation.
vm.runInNewContext(readFileSync(new URL('../src/accelerator/range-core.js',import.meta.url),'utf8'),context);
vm.runInNewContext(readFileSync(new URL('../src/accelerator/loon-http.js',import.meta.url),'utf8'),context);
const idm=fixed('idm-downloader.js',provenance.files['idm-downloader.js']);
const end=idm.indexOf('  // 自动线程数.');if(end<0)throw Error('Reviewed Semaphore boundary missing');
vm.runInNewContext(idm.slice(0,end)+'\nroot.__BILI_GATEWAY_PRIMITIVES__={Semaphore};\n})(globalThis);',context);
export const range=context.__BILI_RANGE_CORE__;
export const cdn=context.__BILI_CDN_RESOLVER_FACTORY__;
export const Semaphore=context.__BILI_GATEWAY_PRIMITIVES__.Semaphore;
export const inspectRedirect=context.BiliRangeHTTP.inspectRedirect;
