/* BTR range-core.js, unchanged 0302b345cdfe367ac599b52dc6874e3f7967e220
MIT License

Copyright (c) 2026 Bilibili-thread-ripper contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
(function installRangeCore(root) {
  "use strict";

  const MEDIA_SUFFIX_RE = /\.(?:m4s|mp4|flv)$/i;
  const MEDIA_HOST_RE = /(?:^|\.)(?:bilivideo\.(?:com|cn|net)|akamaized\.net|szbdyd\.com|hdslb\.com|xycdn\.com|mountaintoys\.cn|nexusedgeio\.com|ahdohpiechei\.com)$/i;

  function parseByteRange(value) {
    if (typeof value !== "string") return null;
    const match = /^(\d+)-(\d+)$/.exec(value.trim());
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
    return { start, end, length: end - start + 1 };
  }

  function parseRangeHeader(value) {
    if (typeof value !== "string") return null;
    const match = /^bytes=(\d+)-(\d+)$/i.exec(value.trim());
    return match ? parseByteRange(`${match[1]}-${match[2]}`) : null;
  }

  function parseContentRange(value) {
    if (typeof value !== "string") return null;
    const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim());
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2]);
    const total = match[3] === "*" ? null : Number(match[3]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
    if (total !== null && (!Number.isSafeInteger(total) || total <= end)) return null;
    return { start, end, total, length: end - start + 1 };
  }

  function splitRange(start, end, concurrency, minChunkBytes = 128 * 1024) {
    const length = end - start + 1;
    const limit = Math.max(1, Math.min(512, Math.trunc(concurrency) || 1));
    const minimum = Math.max(32 * 1024, Math.trunc(minChunkBytes) || 128 * 1024);
    const count = Math.max(1, Math.min(limit, Math.ceil(length / minimum)));
    const base = Math.floor(length / count);
    const remainder = length % count;
    const pieces = [];
    let cursor = start;
    for (let index = 0; index < count; index += 1) {
      const size = base + (index < remainder ? 1 : 0);
      pieces.push({ index, start: cursor, end: cursor + size - 1, length: size });
      cursor += size;
    }
    return pieces;
  }

  function concatChunks(chunks, expectedLength) {
    const output = new Uint8Array(expectedLength);
    let offset = 0;
    for (const chunk of chunks) {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      if (offset + bytes.byteLength > expectedLength) throw new RangeError("子区间超出目标长度");
      output.set(bytes, offset);
      offset += bytes.byteLength;
    }
    if (offset !== expectedLength) throw new RangeError(`子区间长度不符：${offset}/${expectedLength}`);
    return output;
  }

  function isBilibiliMediaUrl(value) {
    try {
      const url = new URL(value, root.location?.href);
      return url.protocol === "https:" && MEDIA_SUFFIX_RE.test(url.pathname) && MEDIA_HOST_RE.test(url.hostname);
    } catch (_error) {
      return false;
    }
  }

  // A server added by hand in the custom CDN mode. Only its host name is kept, and only for
  // the Bilibili video servers isBilibiliMediaUrl accepts: the signed download addresses
  // must never be sent to anyone else.
  function normalizeCdnHost(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!text || text.length > 253) return "";
    let host = "";
    try { host = new URL(/^[a-z][a-z\d+.-]*:\/\//.test(text) ? text : `https://${text}`).hostname; }
    catch (_error) { return ""; }
    return /^[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+$/.test(host) && MEDIA_HOST_RE.test(host) ? host : "";
  }

  function normalizeSettings(input) {
    const source = input && typeof input === "object" ? input : {};
    const allowed = [4, 8, 16, 32, 64, 128];
    const requested = Math.trunc(Number(source.concurrency));
    return {
      enabled: source.enabled !== false,
      theme: ["light", "dark"].includes(source.theme) ? source.theme : "auto",
      // The live module on live.bilibili.com; the master switch above still rules. Off unless
      // switched on: a viewer who never chose keeps Bilibili's own live player.
      liveEnabled: source.liveEnabled === true,
      // 剧集加速: episode pages (/bangumi/play/ep… and ss…: anime, films, documentaries, …),
      // sped up in the compatibility mode only.
      episodeEnabled: source.episodeEnabled !== false,
      // "full" replaces Bilibili's playback core; "compat" leaves it in charge and only
      // downloads its media requests.
      takeover: source.takeover === "compat" ? "compat" : "full",
      mode: ["overseas", "custom"].includes(source.mode) ? source.mode : "mainland",
      customHosts: (Array.isArray(source.customHosts) ? source.customHosts : [])
        .map(normalizeCdnHost)
        .filter((host, index, all) => host && all.indexOf(host) === index)
        .slice(0, 32),
      // The round button in the page corner that opens the settings panel, and where the
      // viewer dragged it: which side, and how far down as a share of the window height.
      floatingButton: source.floatingButton !== false,
      // Where the viewer dragged it, as shares of the window (0 = flush left, 1 = flush
      // right); null when it was never moved.
      floatingButtonLeft: source.floatingButtonLeft != null && Number(source.floatingButtonLeft) >= 0 && Number(source.floatingButtonLeft) <= 1 ? Number(source.floatingButtonLeft) : null,
      floatingButtonTop: source.floatingButtonTop != null && Number(source.floatingButtonTop) >= 0 && Number(source.floatingButtonTop) <= 1 ? Number(source.floatingButtonTop) : null,
      debugNotices: source.debugNotices === true,
      errorNotices: source.errorNotices === true,
      debugCategories: Object.fromEntries(["takeover", "playback", "download", "buffer", "settings", "other"].map(key => [key, source.debugCategories?.[key] !== false])),
      concurrency: allowed.includes(requested) ? requested : 8,
      // 自动线程数: the downloader picks the thread count itself, between 8 and 64, and
      // `concurrency` above is only what the viewer set by hand. Off unless asked for.
      autoConcurrency: source.autoConcurrency === true,
      minChunkBytes: 64 * 1024,
      firstByteTimeoutMs: 5500,
      stallTimeoutMs: 4000,
      attemptTimeoutMs: 15000,
      hedgeDelayMs: 900,
      bufferAheadSeconds: 45
    };
  }

  root.__BILI_RANGE_CORE__ = Object.freeze({
    concatChunks,
    isBilibiliMediaUrl,
    normalizeCdnHost,
    normalizeSettings,
    parseByteRange,
    parseContentRange,
    parseRangeHeader,
    splitRange
  });
})(globalThis);

/* Loon transport/policy adapter, Apache-2.0. Byte-range primitives reuse the
 * unmodified MIT-licensed BTR core in vendor/btr-0302b345. Not a streaming player. */
(function (root) {
  'use strict';
  const btr = root.__BILI_RANGE_CORE__;
  if (!btr) throw new Error('BTR range core must load before the Loon adapter');
  const DEFAULT_HOSTS = ['upos-sz-mirrorhwo1.bilivideo.com', 'upos-sz-mirror08c.bilivideo.com',
    'upos-sz-mirrorhw.bilivideo.com', 'upos-sz-mirrorali.bilivideo.com'];
  const INTERNAL = 'x-bili-range-internal';
  function headers(h) {
    const out = {};
    for (const k of Object.keys(h || {})) out[k.toLowerCase()] = String(h[k]);
    return out;
  }
  function parseURL(value) {
    const m = /^(https?):\/\/([^/?#]+)(\/upgcxcode\/[^?#]+)(\?[^#]*)?$/i.exec(value || '');
    if (!m) return null;
    const host = m[2].toLowerCase();
    if (!/^(?:upos-(?:sz|hz|bstar1)-[a-z0-9-]+\.bilivideo\.com|cn-hk-eq-[a-z0-9-]+\.bilivideo\.com|upos-(?:sz|hz|bstar1)-mirrorakam\.akamaized\.net)(?::(?:80|443|4483))?$/.test(host)) return null;
    return { protocol: m[1].toLowerCase(), authority: m[2], host: host.split(':')[0], path: m[3], query: m[4] || '' };
  }
  function parseRange(value) {
    const range = btr.parseRangeHeader(value);
    return range && Number.isSafeInteger(range.length) ? range : null;
  }
  function contentRange(value) {
    const range = btr.parseContentRange(value);
    // BTR also permits unknown totals; buffered Loon responses require a known total.
    if (!range || range.total === null) throw new Error('content-range');
    return range;
  }
  function split(range, count, minBytes = 128 * 1024) {
    const floor=[32,64,128].map(n=>n*1024).includes(minBytes)?minBytes:128*1024;
    return btr.splitRange(range.start, range.end, count, floor);
  }
  function chooseHost(state, candidates, now) {
    // Re-evaluate after network changes or a short lifetime. Real transfers are samples.
    const stats = state.hosts || {};
    const valid = candidates.filter(h => !(stats[h]?.blockedUntil > now));
    if (!valid.length) return null;
    const fresh = valid.filter(h => !stats[h]?.at || now - stats[h].at > 10 * 60 * 1000);
    if (fresh.length) return fresh[0];
    return valid.reduce((best, h) => (stats[h].bps || 0) > (stats[best].bps || 0) * 1.2 ? h : best, valid[0]);
  }
  function eligible(request, options = {}, at = Date.now()) {
    const h = headers(request.headers), u = parseURL(request.url);
    const skip = reason => ({ kind: 'pass', reason });
    if (h[INTERNAL]) return skip('internal');
    if (request.method !== 'GET' || !u) return skip('not-media-get');
    if (h.cookie || h.authorization || Object.keys(h).some(k => k.startsWith('if-'))) return skip('conditional-or-auth');
    if (options.enabled === false) return skip('disabled');
    const range = parseRange(h.range);
    if (!range) return skip(h.range ? 'unbounded-or-multiple-range' : 'no-range');
    const maxBytes = Math.min(8 * 1024 * 1024, Number(options.maxBytes) || 4 * 1024 * 1024);
    if (range.length < 256 * 1024) return skip('small-range');
    if (range.length > maxBytes) return skip('large-range');
    const deadline = /(?:[?&])deadline=(\d+)(?:&|$)/.exec(u.query);
    if (deadline && Number(deadline[1]) * 1000 < at + 15000) return skip('expired-or-expiring');
    return {kind:'eligible',h,u,range,at};
  }
  async function accelerate({ request, options = {}, fetchRange, state = {}, now = Date.now }) {
    const planned=eligible(request,options,now());
    if(planned.kind!=='eligible')return planned;
    const {h,u,range,at}=planned;
    const pool = (options.hosts || DEFAULT_HOSTS).filter(host => /^upos-sz-mirror[a-z0-9-]+\.bilivideo\.com$/.test(host)).slice(0, 8);
    const target = options.auto === false ? pool[0] : chooseHost(state, pool, at);
    if (!target) return {kind:'pass',reason:'cooldown'};
    const count = [1, 2, 4, 6, 8, 16, 32].includes(Number(options.connections)) ? Number(options.connections) : 4;
    const minChunkKiB=[32,64,128].includes(Number(options.minChunkKiB))?Number(options.minChunkKiB):128;
    const allocated = Number.isSafeInteger(options.allocatedConnections) ? Math.max(1,options.allocatedConnections) : count;
    const parts = split(range, Math.min(count, allocated, Math.floor(range.length / (minChunkKiB * 1024))),minChunkKiB*1024);
    const url = u.protocol + '://' + target + u.path + u.query;
    const safeHeaders = { 'Accept-Encoding': 'identity', [INTERNAL]: '1' };
    for (const name of ['user-agent', 'referer', 'accept']) if (h[name]) safeHeaders[name] = h[name];
    const timeout = Math.max(500, Math.min(5000, Number(options.timeout) || 2500));
    const requestedALPN=options.alpn==='h2'?'h2':'h1';
    let results,integrityField;
    try {
      // Wait for every callback even on failure: Loon has no documented cancellation API.
      const pending = parts.map(part => Promise.resolve().then(() => fetchRange({ url,
        headers: { ...safeHeaders, Range: `bytes=${part.start}-${part.end}` }, timeout, part,alpn:requestedALPN }))
        .then(result => ({ ok: true, result }), error => ({ ok: false, error })));
      const settled = await Promise.all(pending);
      const failed = settled.find(r => !r.ok);
      if (failed) throw Object.assign(new Error(['redirect-untrusted', 'redirect-limit'].includes(failed.error?.message) ? failed.error.message : 'transport'),
        ['malformed','source','host','credentials','downgrade','port','path-wrapper','path'].includes(failed.error?.redirectField)?{redirectField:failed.error.redirectField}:{});
      results = settled.map(r => r.result);
      let total, etag, modified, type;
      for (let i = 0; i < results.length; i++) {
        const response = results[i], rh = headers(response.headers), part = parts[i];
        if (Number(response.status) !== 206) throw new Error('status-' + response.status);
        const cr = contentRange(rh['content-range']);
        if (cr.start !== part.start || cr.end !== part.end) throw new Error('range-mismatch');
        if (!(response.body instanceof Uint8Array) || response.body.byteLength !== part.end - part.start + 1) throw new Error('length-mismatch');
        if (rh['content-encoding'] && rh['content-encoding'] !== 'identity') throw new Error('encoded-body');
        if (rh['content-length'] && Number(rh['content-length']) !== response.body.byteLength) throw new Error('content-length');
        if (/^(?:text\/|application\/(?:json|xml))/i.test(rh['content-type'] || '')) throw new Error('non-media');
        if (i === 0) { total = cr.total; etag = rh.etag; modified = rh['last-modified']; type = rh['content-type']; }
        else {
          integrityField=total!==cr.total?'total':etag!==rh.etag?'etag':modified!==rh['last-modified']?'last-modified':type!==rh['content-type']?'content-type':undefined;
          if(integrityField)throw new Error('entity-mismatch');
        }
      }
      const body = btr.concatChunks(results.map(result => result.body), range.length);
      const finishedAt=now(), elapsed = Math.max(1, finishedAt - at), bps = range.length * 1000 / elapsed;
      const pieceTimes=results.map(r=>Number(r.elapsedMs)||0).filter(n=>n>0);
      const stats = (state.hosts ||= {}), old = stats[target];
      stats[target] = { at: now(), bps: old?.bps ? old.bps * 0.3 + bps * 0.7 : bps, blockedUntil: 0, failures: 0 };
      const first = headers(results[0].headers);
      const responseHeaders = { 'Content-Type': type || 'application/octet-stream',
        'Content-Range': `bytes ${range.start}-${range.end}/${total}`, 'Content-Length': String(body.byteLength),
        'Accept-Ranges': 'bytes', 'Cache-Control': first['cache-control'] || 'no-store' };
      if (etag) responseHeaders.ETag = etag;
      if (modified) responseHeaders['Last-Modified'] = modified;
      return { kind: 'response', response: { status: 206, headers: responseHeaders, body },
        metrics: { host: target, bytes: range.length, elapsedMs: elapsed, connections: parts.length,configuredConnections:count,bps,requestedALPN,minChunkKiB,
          redirects: results.reduce((n, r) => n + (r.redirects || 0), 0),startedAt:at,finishedAt,
          minPieceMs:pieceTimes.length?Math.min(...pieceTimes):0,maxPieceMs:pieceTimes.length?Math.max(...pieceTimes):0 } };
    } catch (error) {
      const old = state.hosts?.[target] || {}, failures = Math.min(5, (old.failures || 0) + 1);
      const reason = error.message || 'failed';
      // One refused signed address is not proof the whole host is down. Keep a short
      // retry delay for content/status failures; back off transient network failures.
      const integrity = ['entity-mismatch','range-mismatch','length-mismatch','encoded-body','content-range','content-length','non-media'].includes(reason);
      const statusFailure = /^status-/.test(reason) || reason.startsWith('redirect-');
      const cooldownMs = integrity ? 60000 : statusFailure ? 1500 : Math.min(10000, 1500 * 2 ** (failures - 1));
      (state.hosts ||= {})[target] = { ...old, failures, at: now(), blockedUntil: now() + cooldownMs, lastError: reason };
      const finishedAt=now();
      return { kind: 'pass', reason, metrics: { host: target, elapsedMs: finishedAt - at, cooldownMs,connections:parts.length,startedAt:at,finishedAt,requestedALPN,minChunkKiB,...(integrityField?{integrityField}:{}),...(error.redirectField?{redirectField:error.redirectField}:{}) } };
    }
  }
  root.BiliRange = { accelerate, eligible, headers, parseRange, parseURL, contentRange, split, chooseHost, DEFAULT_HOSTS, INTERNAL };
})(globalThis);

/* Optional private-LAN rewrite adapter, Apache-2.0, aijc123. */
(function(root){
 'use strict';
 const core=root.BiliRange,KEY='aijc123.BiliGateway.health.v1';
 function config(arg){
  if(!arg||typeof arg!=='object'||arg.Enabled!==true)return null;
  const match=/^http:\/\/((?:\d{1,3}\.){3}\d{1,3}):(\d{1,5})\/?$/.exec(arg.GatewayBase||'');
  if(!match||!/^[A-Za-z0-9_-]{24,128}$/.test(arg.GatewayToken||''))return null;
  const ip=match[1].split('.').map(Number),port=Number(match[2]);
  if(ip.some((v,i)=>v>255||String(v)!==match[1].split('.')[i])||port<1||port>65535)return null;
  if(!(ip[0]===10||ip[0]===172&&ip[1]>=16&&ip[1]<=31||ip[0]===192&&ip[1]===168))return null;
  if(ip[3]===0||ip[3]===255)return null;
  return {base:'http://'+match[1]+':'+port,authority:match[1]+':'+port,token:arg.GatewayToken,
   connections:[1,2,4,8,16,32].includes(Number(arg.Connections))?Number(arg.Connections):8,
   floor:[32,64,128].includes(Number(arg.MinChunkKiB))?Number(arg.MinChunkKiB):128,
   cdn:/^upos-sz-mirror[a-z0-9-]+\.bilivideo\.com$/.test(arg.PreferredCDN||'')?arg.PreferredCDN:'upos-sz-mirror08c.bilivideo.com',auto:arg.AutoCDN!==false};
 }
 function eligible(request){
  if(!request||request.method!=='GET'||typeof request.url!=='string'||request.url.length>8192||/[\s\\]/.test(request.url))return false;
  const u=core.parseURL(request.url),h=core.headers(request.headers),r=core.parseRange(h.range);
  if(!u||!r||r.length>8*1024*1024||h.cookie||h.authorization||h[core.INTERNAL]||Object.keys(h).some(k=>k.startsWith('if-')))return false;
  const deadline=/(?:[?&])deadline=(\d+)(?:&|$)/.exec(u.query);
  return !(deadline&&Number(deadline[1])*1000<Date.now()+15000);
 }
 function fingerprint(c){let hash=2166136261;for(const char of c.base+'|'+c.token)hash=Math.imul(hash^char.charCodeAt(0),16777619);return (hash>>>0).toString(16);}
 function probe(client,c,path){return new Promise(resolve=>{
  try{client.get({url:c.base+path,headers:{'x-bili-gateway-token':c.token},node:'DIRECT',timeout:500,
   'auto-cookie':false,'auto-redirect':false,insecure:false},(error,response,body)=>{
    if(error||Number(response?.status)!==200||typeof body!=='string'||body.length>8192){resolve(null);return;}
    try{resolve(JSON.parse(body));}catch{resolve(null);}
   });}catch{resolve(null);}
 });}
 async function rewrite({request,arg,client,store}){
  const c=config(arg);if(!c||!eligible(request))return {};
  const id=fingerprint(c);let cached;
  try{cached=JSON.parse(store?.read(KEY)||'null');}catch{}
  if(!(cached?.id===id&&cached.at<=Date.now()&&Date.now()-cached.at<5000)){
   const health=await probe(client,c,'/health');
   if(health?.service!=='aijc123-bili-range-gateway'||health.ready!==true)return {};
   try{store?.write(JSON.stringify({id,at:Date.now()}),KEY);}catch{}
  }
  const old=core.headers(request.headers),headers={'Host':c.authority,'Range':old.range,'Accept-Encoding':'identity','x-bili-gateway-token':c.token};
  for(const name of ['user-agent','referer','accept'])if(old[name])headers[name]=old[name];
  return {url:c.base+'/range?source='+encodeURIComponent(request.url)+'&cdn='+c.cdn+'&connections='+c.connections+'&minChunkKiB='+c.floor+'&autoCDN='+c.auto,
   headers,node:'DIRECT'};
 }
 root.BiliGateway={config,eligible,rewrite,probe};
})(globalThis);

(function(){
 const arg=typeof $argument==='object'&&$argument?$argument:{};
 globalThis.BiliGateway.rewrite({request:$request,arg,client:$httpClient,store:$persistentStore}).then(result=>$done(result)).catch(()=>$done({}));
})();
