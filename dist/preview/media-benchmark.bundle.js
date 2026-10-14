/* BTR range-core.js, upstream commit 0302b345cdfe367ac599b52dc6874e3f7967e220
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
  function isTargetHost(value){return typeof value==='string'&&/^(?:(?:upos-(?:sz|hz|bstar1)-[a-z0-9-]+|cn-hk-eq-[a-z0-9-]+)\.bilivideo\.com|upos-(?:sz|hz|bstar1)-mirrorakam\.akamaized\.net)$/.test(value);}
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
    // Retain a recently proven node before exploring unknown/stale candidates.
    // Loon cannot hide a cold probe behind streaming/hedging or cancel losers.
    const proven=valid.filter(h=>Number(stats[h]?.bps)>0&&!(stats[h]?.failures>0)&&stats[h]?.at&&now-stats[h].at<10*60*1000);
    if(proven.length)return proven.reduce((best,h)=>stats[h].bps>stats[best].bps*1.2?h:best,proven[0]);
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
    if(options.deferReason==='transport-rest')return skip('transport-rest');
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
    const pool = (options.hosts || DEFAULT_HOSTS).filter(isTargetHost).slice(0, 16);
    const target = options.auto === false ? pool[0] : chooseHost(state, pool, at);
    if (!target) return {kind:'pass',reason:'cooldown'};
    const count = [1, 2, 3, 4, 5, 6, 7, 8, 16, 32].includes(Number(options.connections)) ? Number(options.connections) : 4;
    const minChunkKiB=[32,64,128].includes(Number(options.minChunkKiB))?Number(options.minChunkKiB):128;
    const allocated = Number.isSafeInteger(options.allocatedConnections) ? Math.max(1,options.allocatedConnections) : count;
    const parts = split(range, Math.min(count, allocated, Math.floor(range.length / (minChunkKiB * 1024))),minChunkKiB*1024);
    const url = target === u.host ? request.url : u.protocol + '://' + target + u.path + u.query;
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
        {...(['malformed','source','host','credentials','downgrade','port','path-wrapper','path'].includes(failed.error?.redirectField)?{redirectField:failed.error.redirectField}:{}),
          ...(['bili-akamai','bili-mcdn','bili-other','external'].includes(failed.error?.redirectFamily)?{redirectFamily:failed.error.redirectFamily}:{})});
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
      const cooldownMs = integrity || statusFailure ? 1500 : Math.min(10000, 1500 * 2 ** (failures - 1));
      (state.hosts ||= {})[target] = { ...old, failures, at: now(), blockedUntil: now() + cooldownMs, lastError: reason };
      const finishedAt=now();
      return { kind: 'pass', reason, metrics: { host: target, elapsedMs: finishedAt - at, cooldownMs,connections:parts.length,startedAt:at,finishedAt,requestedALPN,minChunkKiB,...(integrityField?{integrityField}:{}),...(error.redirectField?{redirectField:error.redirectField}:{}),...(error.redirectFamily?{redirectFamily:error.redirectFamily}:{}) } };
    }
  }
  root.BiliRange = { accelerate, eligible, headers, parseRange, parseURL, contentRange, split, chooseHost, isTargetHost,DEFAULT_HOSTS, INTERNAL };
})(globalThis);

/* Loon HTTP adapter with a bounded, validated redirect chain. */
(function (root) {
  'use strict';
  function inspectRedirect(from, location) {
    if (typeof location !== 'string' || !location || /[\s\\]/.test(location)) return {reason:'malformed'};
    const base = /^(https?):\/\/([^/?#]+)(\/upgcxcode\/[^?#]+)(\?[^#]*)?$/i.exec(from);
    if (!base) return {reason:'source'};
    let next = location;
    if (next.startsWith('//')) next = base[1] + ':' + next;
    else if (next.startsWith('/')) next = base[1] + '://' + base[2] + next;
    else if (next.startsWith('?')) next = base[1] + '://' + base[2] + base[3] + next;
    const parsed = /^(https?):\/\/([^/?#]+)(\/[^?#]*)(\?[^#]*)?$/i.exec(next);
    if(!parsed)return {reason:'malformed'};
    if(parsed[2].includes('@'))return {reason:'credentials'};
    const authority=/^([a-z0-9-]+\.bilivideo\.com)(?::(\d+))?$/i.exec(parsed[2]);
    if(!authority){
      const name=parsed[2].toLowerCase().replace(/:\d+$/,'');
      const family=/^upos-(?:sz|hz|bstar1)-mirrorakam\.akamaized\.net$/.test(name)?'bili-akamai':
        /^[a-z0-9-]+\.mcdn\.bilivideo\.cn$/.test(name)?'bili-mcdn':
        /^(?:[a-z0-9-]+\.)+bilivideo\.com$/.test(name)?'bili-other':'external';
      return {reason:'host',family};
    }
    if(base[1].toLowerCase()==='https'&&parsed[1].toLowerCase()!=='https')return {reason:'downgrade'};
    if(authority[2]&&!['80','443'].includes(authority[2]))return {reason:'port'};
    if(parsed[3]!==base[3])return {reason:parsed[3].replace(/^\/v1\/resource/,'')===base[3]?'path-wrapper':'path'};
    return {url:next};
  }
  const redirectURL=(from,location)=>inspectRedirect(from,location).url||null;
  function makeFetch(client, now = Date.now) {
    return async options => {
      const started = now();
      let url = options.url, redirects = 0;
      while (true) {
        const remaining = options.timeout - (now() - started);
        if (remaining < 100) throw new Error('transport');
        const result = await new Promise((resolve, reject) => {
          client.get({ url, headers: options.headers, timeout: remaining,
            'binary-mode': true, 'auto-redirect': false, 'auto-cookie': false, insecure: false, alpn: options.alpn==='h2'?'h2':'h1' },
          (error, response, data) => error || !response ? reject(new Error('transport')) :
            resolve({ status: Number(response.status), headers: response.headers, body: data }));
        });
        if (![301, 302, 303, 307, 308].includes(result.status)) return { ...result, redirects, elapsedMs:Math.max(1,now()-started) };
        const location = root.BiliRange.headers(result.headers).location;
        const inspected=inspectRedirect(url,location),next=inspected.url;
        if (!next) throw Object.assign(new Error('redirect-untrusted'),{redirectField:inspected.reason,...(inspected.family?{redirectFamily:inspected.family}:{})});
        if (redirects >= 2 || next === url) throw new Error('redirect-limit');
        url = next; redirects++;
      }
    };
  }
  root.BiliRangeHTTP = { redirectURL, inspectRedirect, makeFetch };
})(globalThis);

/* Best-effort admission across Loon script contexts. The store has no atomic CAS.
 * Counts HTTP jobs, not guaranteed physical TCP sockets (HTTP/2 may multiplex). */
(function(root){
  'use strict';
  const integer=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Math.floor(Number(value)))):fallback;
  function active(raw,now){
    const out={};
    for(const [id,value] of Object.entries(raw||{})){
      // Accept old numeric leases conservatively during an update.
      const v=typeof value==='number'?{expires:value,jobs:4,bytes:4*1024*1024}:value;
      if(v&&Number.isFinite(v.expires)&&v.expires>now&&v.expires<=now+10000)
        out[id]={expires:v.expires,jobs:integer(v.jobs,32,1,32),bytes:integer(v.bytes,8*1024*1024,1,8*1024*1024)};
    }
    return out;
  }
  function admit({leases,now,bytes,wanted,globalJobs=16,maxRequests=4,maxBufferedBytes=4*1024*1024,id}){
    const live=active(leases,now),values=Object.values(live);
    const jobs=values.reduce((n,v)=>n+v.jobs,0),buffered=values.reduce((n,v)=>n+v.bytes,0);
    const limit=integer(globalJobs,16,4,32),requests=integer(maxRequests,4,1,4);
    const memory=integer(maxBufferedBytes,4*1024*1024,1024*1024,8*1024*1024);
    const count=Math.min(integer(wanted,4,1,32),limit-jobs);
    let reason;
    if(values.length>=requests)reason='budget-requests';
    else if(buffered+bytes>memory)reason='budget-bytes';
    else if(count<Math.min(2,wanted))reason='budget-jobs';
    if(reason)return {ok:false,reason,leases:live,jobs,buffered};
    live[id]={expires:now+8000,jobs:count,bytes};
    return {ok:true,leases:live,count,inflight:values.length,jobs:jobs+count,buffered:buffered+bytes};
  }
  root.BiliRangeBudget={active,admit};
})(globalThis);

/* Bounded local observational measurements. No raw URL, token, cookie or Wi-Fi name. */
(function (root) {
  'use strict';
  const MAX_SAMPLES = 120, RETAIN_MS = 15 * 60 * 1000;
  const median = values => quantile(values, 0.5);
  function quantile(values, p) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a,b)=>a-b), pos=(sorted.length-1)*p;
    const lo=Math.floor(pos), hi=Math.ceil(pos);
    return sorted[lo]+(sorted[hi]-sorted[lo])*(pos-lo);
  }
  function hash(text, salt) {
    let value=2166136261;
    const input=String(salt)+String(text);
    for(let i=0;i<input.length;i++)value=Math.imul(value^input.charCodeAt(i),16777619)>>>0;
    return value.toString(16).padStart(8,'0');
  }
  function rangeBucket(bytes) {
    return bytes<256*1024?'small':bytes<768*1024?'256-768KiB':bytes<=1280*1024?'near-1MiB':bytes<=2*1024*1024?'1.25-2MiB':'over-2MiB';
  }
  function identity(state,request,includeQuery=false){
    const u=root.BiliRange.parseURL(request.url);if(!u)return null;
    const m=state.measurements ||= {salt:Math.random().toString(36).slice(2),samples:[]};
    return hash(u.path+(includeQuery?u.query:''),m.salt);
  }
  function record(state, request, result, context={}) {
    const at=Number(result.metrics?.finishedAt)||Date.now();
    const m=state.measurements ||= {salt:Math.random().toString(36).slice(2),samples:[]};
    m.samples=(Array.isArray(m.samples)?m.samples:[]).filter(s=>at-s.at<RETAIN_MS && at>=s.at);
    const u=root.BiliRange.parseURL(request.url);
    const range=root.BiliRange.parseRange(root.BiliRange.headers(request.headers).range);
    if(!u||!range||range.length<256*1024||!result.metrics) return;
    const r=result.metrics;
    const sample={at,from:Number(r.startedAt)||at-Math.max(1,Number(r.elapsedMs)||1),
      ok:result.kind==='response',reason:result.kind==='response'?'ok':
        (root.BiliRangeDiagnostics?.allowedReasons?.includes(result.reason)||/^status-\d{3}$/.test(result.reason||'')?result.reason:'other-failure'),
      bytes:result.kind==='response'?Number(r.bytes)||0:0,elapsedMs:Math.max(1,Number(r.elapsedMs)||1),
      requestedALPN:r.requestedALPN==='h2'?'h2':'h1',
      minChunkKiB:[32,64,128].includes(Number(r.minChunkKiB))?Number(r.minChunkKiB):128,
      mode:Number(r.connections)||Number(context.connections)||0,requestedMode:Number(r.configuredConnections)||Number(context.connections)||Number(r.connections)||0,host:String(r.host||''),
      epoch:Number(context.epoch)||0,content:identity(state,request),bucket:rangeBucket(range.length),rangeBytes:range.length,
      inflight:Number(context.inflight)||0,redirects:Number(r.redirects)||0,
      maxPieceMs:Number(r.maxPieceMs)||0,minPieceMs:Number(r.minPieceMs)||0};
    // Restrict the only stored hostname field. Invalid metrics cannot introduce other text.
    if(!root.BiliRange.isTargetHost(sample.host))return;
    if(['total','etag','last-modified','content-type'].includes(r.integrityField))sample.integrityField=r.integrityField;
    if(['malformed','source','host','credentials','downgrade','port','path-wrapper','path'].includes(r.redirectField))sample.redirectField=r.redirectField;
    if(['bili-akamai','bili-mcdn','bili-other','external'].includes(r.redirectFamily))sample.redirectFamily=r.redirectFamily;
    const trial=sanitizeTrial(context.trial);if(trial)sample.trial=trial;
    m.samples.push(sample);m.samples=m.samples.slice(-MAX_SAMPLES);
  }
  function unionMs(intervals) {
    if(!intervals.length)return 0;
    const sorted=intervals.map(i=>[i[0],i[1]]).sort((a,b)=>a[0]-b[0]);
    let from=sorted[0][0],to=sorted[0][1],total=0;
    for(const interval of sorted.slice(1)) {
      if(interval[0]<=to)to=Math.max(to,interval[1]);
      else {total+=Math.max(0,to-from);[from,to]=interval;}
    }
    return total+Math.max(0,to-from);
  }
  function peak(intervals) {
    const events=[];
    for(const [a,b] of intervals){events.push([a,1],[b,-1]);}
    events.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    let active=0,max=0;for(const [,delta] of events){active+=delta;max=Math.max(max,active);}return max;
  }
  function summarize(samples) {
    const ok=samples.filter(s=>s.ok),rates=ok.map(s=>s.bytes*8/s.elapsedMs/1000),latencies=ok.map(s=>s.elapsedMs);
    const spreads=ok.filter(s=>Number.isFinite(s.minPieceMs)&&Number.isFinite(s.maxPieceMs)&&s.minPieceMs>0&&s.maxPieceMs>=s.minPieceMs).map(s=>s.maxPieceMs-s.minPieceMs);
    return {n:samples.length,success:ok.length,failed:samples.length-ok.length,
      failureRate:samples.length?(samples.length-ok.length)/samples.length:0,
      p50Mbps:median(rates),p10Mbps:quantile(rates,0.1),p50Ms:median(latencies),p90Ms:quantile(latencies,0.9),
      p90AttemptMs:quantile(samples.map(s=>s.elapsedMs),0.9),pieceSpreadN:spreads.length,p50PieceSpreadMs:median(spreads),p90PieceSpreadMs:quantile(spreads,0.9),
      bytes:ok.reduce((n,s)=>n+s.bytes,0),noise:ok.length<8?'样本不足':rates.length&&quantile(rates,0.9)/Math.max(0.001,quantile(rates,0.1))>2?'波动较大':'仍有缓存与时间噪音'};
  }
  function analyze(state, at=Date.now()) {
    const valid=s=>s&&typeof s==='object'&&root.BiliRange.isTargetHost(s.host)&&/^[0-9a-f]{8}$/.test(s.content||'')&&
      ['small','256-768KiB','near-1MiB','1.25-2MiB','over-2MiB'].includes(s.bucket)&&
      [s.at,s.from,s.bytes,s.elapsedMs,s.mode,s.epoch,s.inflight].every(Number.isFinite);
    const samples=(Array.isArray(state.measurements?.samples)?state.measurements.samples:[]).filter(s=>valid(s)&&at-s.at<RETAIN_MS&&at>=s.at).slice(-MAX_SAMPLES);
    const recent=samples.filter(s=>s.epoch===(Number(state.epoch)||0)&&at-s.at<=30000),delivered=recent.filter(s=>s.ok);
    const intervals=recent.map(s=>[s.from,s.at]);
    const bytes=delivered.reduce((n,s)=>n+s.bytes,0);
    // Include failed attempt time: excluding it would inflate apparent delivery.
    const elapsed=recent.length?Math.max(1000,Math.max(...recent.map(s=>s.at))-Math.min(...recent.map(s=>s.from))):0;
    const occupied=unionMs(intervals);
    const groups={};
    for(const s of samples){const key=[s.epoch,s.content,s.host,s.bucket,s.inflight,s.requestedALPN==='h2'?'h2':'h1',[32,64,128].includes(s.minChunkKiB)?s.minChunkKiB:128,s.mode].join('|');(groups[key] ||= []).push(s);}
    const comparisons={};
    for(const s of samples){
      if(!Number.isSafeInteger(s.rangeBytes)||s.rangeBytes<=0||![1,2,3,4,5,6,7,8,16,32].includes(s.requestedMode))continue;
      const key=[s.epoch,s.content,s.host,s.rangeBytes,s.inflight,s.requestedALPN==='h2'?'h2':'h1',[32,64,128].includes(s.minChunkKiB)?s.minChunkKiB:128].join('|');
      ((comparisons[key] ||= {})[s.requestedMode+':'+s.mode] ||= []).push(s);
    }
    const contrasts=[];
    for(const [key,modes] of Object.entries(comparisons)) {
      const keys=Object.keys(modes).sort((a,b)=>Number(a.split(':')[0])-Number(b.split(':')[0]));
      for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++) {
        const [settingA,actualA]=keys[i].split(':').map(Number),[settingB,actualB]=keys[j].split(':').map(Number);
        // Natural request-size caps and budget reductions are not changes of settings.
        if(settingA===settingB||actualA===actualB)continue;
        const a=summarize(modes[keys[i]]),b=summarize(modes[keys[j]]);
        if(!a.success||!b.success)continue;
        contrasts.push({group:key,baseline:actualA,candidate:actualB,baselineSetting:settingA,candidateSetting:settingB,baselineN:a.n,candidateN:b.n,
          medianRatio:b.p50Mbps/a.p50Mbps,baselineP90Ms:a.p90Ms,candidateP90Ms:b.p90Ms,
          adequate:a.success>=8&&b.success>=8,causal:false,warning:'不同字节范围/缓存状态仍可能混杂；不是因果提速倍数'});
      }
    }
    const failureReasons={};for(const s of recent.filter(s=>!s.ok)){
      const reason=root.BiliRangeDiagnostics?.allowedReasons?.includes(s.reason)||/^status-\d{3}$/.test(s.reason||'')?s.reason:'other-failure';failureReasons[reason]=(failureReasons[reason]||0)+1;
    }
    return {trials:root.BiliRangeTrials?root.BiliRangeTrials.analyze(samples):null,window:{n:recent.length,success:delivered.length,failed:recent.length-delivered.length,failureReasons,bytes,spanMs:elapsed,occupiedMs:occupied,
      deliveryMbps:elapsed?bytes*8/elapsed/1000:null,activeMbps:occupied?bytes*8/occupied/1000:null,
      peakCompletedOverlap:peak(intervals),scope:'完成接管尝试的成功字节 / 含失败的时间区间；不含原请求放行流量，不能直接推断播放器缓冲'},
      groups:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,summarize(v)])),contrasts:contrasts.slice(-12),samples:samples.length};
  }
  function report(state,at=Date.now()) {
    const a=analyze(state,at),w=a.window,fmt=n=>n===null?'未知':Number(n).toFixed(2);
    const lines=[`客观采样：保留 ${a.samples} 条 / 最近30秒 ${w.n} 条`,
      `窗口交付率 ${fmt(w.deliveryMbps)} Mbps；尝试活跃区间交付率 ${fmt(w.activeMbps)} Mbps；完成尝试重叠峰值 ${w.peakCompletedOverlap}`,
      `最近尝试成功 ${w.success} / 失败 ${w.failed}；失败类别 ${JSON.stringify(w.failureReasons)}（只含已完成接管尝试）`,
      '分层条件：网络epoch / 临时表示组 / CDN / 请求大小 / 在途负载 / 请求ALPN / 分片下限KiB / 实际并发',
      'ALPN表示请求偏好；API未报告实际协商协议，也不提供实际TCP连接数。',
      '下列为每请求分布，含连接/重定向/返回等待，API不提供真实TTFB或播放器卡顿计数：'];
    for(const [key,v] of Object.entries(a.groups).slice(-12))lines.push(`${key}: n=${v.n}, 错误=${(v.failureRate*100).toFixed(1)}%, p50=${fmt(v.p50Mbps)} Mbps, p10=${fmt(v.p10Mbps)} Mbps, 成功p90=${fmt(v.p90Ms)} ms, 尝试p90=${fmt(v.p90AttemptMs)} ms（含失败）, ${v.noise}`+
      (v.pieceSpreadN?`；片耗时差p50/p90=${fmt(v.p50PieceSpreadMs)}/${fmt(v.p90PieceSpreadMs)} ms，n=${v.pieceSpreadN}`:''));
    for(const c of a.contrasts)lines.push(`观察对照 设置${c.baselineSetting}→${c.candidateSetting} / 分片${c.baseline}→${c.candidate}: 中位比=${c.medianRatio.toFixed(2)}, n=${c.baselineN}/${c.candidateN}, ${c.adequate?'样本达到最低门槛':'样本不足'}；不是因果倍数`);
    if(!a.contrasts.length)lines.push('暂无相同精确字节数且设置确实不同的对照；自然分成6/8片不能当作调高并发收益，旧样本缺精确长度时不比较。');
    if(a.trials){
      lines.push(`交替块对照：未完成块 ${a.trials.incomplete}，条件不一致块 ${a.trials.mismatched}`);
      for(const g of a.trials.groups.slice(-6))lines.push(`设置 ${g.baseline}→${g.candidate} / 实际 ${g.actualA}→${g.actualB}路，块 ${g.cleanBlocks}/${g.blocks}，错误 ${(g.failureA*100).toFixed(1)}%/${(g.failureB*100).toFixed(1)}%，尝试耗时p90 ${fmt(g.p90MsA)}/${fmt(g.p90MsB)} ms（含失败），比值 ${fmt(g.ratio)}，经验区间 ${g.interval?g.interval.map(fmt).join('～'):'样本不足'}${g.equivalent?'；实际并发相同，不能验证高路数效果':''}`);
      if(a.trials.groups.length)lines.push('块重采样范围不是保证；仍有缓存、负载及样本依赖，不代表卡顿下降倍数。');
    }
    lines.push(w.scope);return lines.join('\n');
  }
  const TRIAL_MODES=Object.freeze({'1vs2':Object.freeze([1,2]),'2vs3':Object.freeze([2,3]),'2vs4':Object.freeze([2,4]),'3vs5':Object.freeze([3,5]),'3vs6':Object.freeze([3,6]),'4vs7':Object.freeze([4,7]),'4vs8':Object.freeze([4,8]),'4vs16':Object.freeze([4,16]),'4vs32':Object.freeze([4,32]),
    '8vs16':Object.freeze([8,16]),'8vs32':Object.freeze([8,32]),'16vs32':Object.freeze([16,32])});
  function sanitizeTrial(trial){
    if(!trial||typeof trial.block!=='string'||trial.block.length>80)return null;
    const match=/^\d+\|[0-9a-f]{8}\|((?:1vs2|2vs[34]|3vs[56]|4vs[78]|[48]vs(?:8|16|32)|16vs32))\|\d+$/.exec(trial.block),arms=match&&TRIAL_MODES[match[1]];
    if(!arms||![0,1,2,3].includes(trial.slot)||!['A','B'].includes(trial.arm)||trial.baseline!==arms[0]||trial.candidate!==arms[1])return null;
    return {block:trial.block,slot:trial.slot,arm:trial.arm,baseline:trial.baseline,candidate:trial.candidate};
  }
  root.BiliRangeMeasurements={record,identity,analyze,report,quantile,unionMs,rangeBucket,TRIAL_MODES,sanitizeTrial};
})(globalThis);

/* Opt-in, local media test. Reuses the BTR-backed validated Range downloader.
 * The one captured signed address stays local; reports contain no URL or IP. */
(function(root){
  'use strict';
  const KEY='aijc123.BiliRange.preview.v1',CAPTURE=KEY+'.mediaCapture',LOCK=KEY+'.mediaBenchmarkLock';
  const MiB=1024*1024,TTL=120000;
  const read=(store,key)=>{try{return JSON.parse(store.read(key)||'null');}catch{return null;}};
  const save=(store,key,value)=>store.write(value===null?null:JSON.stringify(value),key)!==false;
  const epoch=state=>Number(state?.epoch)||0;
  const live=(value,at)=>value&&Number.isFinite(value.until)&&value.until>at;
  function capture(store,request,result,requestEpoch,currentEpoch,at=Date.now()){
    try{
      const value=read(store,CAPTURE);
      if(!value||!['armed','ready'].includes(value.phase))return;
      if(!live(value,at)||value.epoch!==currentEpoch){save(store,CAPTURE,null);return;}
      if(requestEpoch!==currentEpoch||result.kind!=='response')return;
      const plan=root.BiliRange.eligible(request,{maxBytes:4*MiB},at);
      if(plan.kind!=='eligible'||request.url.length>16384)return;
      const deadline=/(?:[?&])deadline=(\d+)(?:&|$)/.exec(plan.u.query);
      const until=Math.min(value.until,deadline?Number(deadline[1])*1000-80000:value.until);
      if(until<=at)return;
      const headers={Range:`bytes=${plan.range.start}-${Math.min(plan.range.end,plan.range.start+MiB-1)}`};
      if(value.phase==='ready'){
        const previous=root.BiliRange.parseRange(root.BiliRange.headers(value.headers).range);
        if(previous&&previous.length>=Math.min(plan.range.length,MiB))return;
      }
      for(const name of ['user-agent','referer','accept'])if(plan.h[name])headers[name]=plan.h[name].slice(0,512);
      save(store,CAPTURE,{phase:'ready',at,until,epoch:currentEpoch,url:request.url,headers,
        preferred:root.BiliRange.isTargetHost(result.metrics?.host)?result.metrics.host:null});
    }catch{} // A benchmark failure must never prevent ordinary playback.
  }
  function validSample(sample,state,at){
    if(sample?.phase!=='ready'||!live(sample,at)||!Number.isFinite(sample.at)||sample.at>at||at-sample.at>=TTL||
      sample.epoch!==epoch(state)||typeof sample.url!=='string'||sample.url.length>16384)return false;
    const plan=root.BiliRange.eligible({method:'GET',url:sample.url,headers:sample.headers},{maxBytes:MiB},at);
    return plan.kind==='eligible';
  }
  function plan(sample,random=Math.random){
    const source=root.BiliRange.parseURL(sample.url).host;
    const pool=[sample.preferred,'upos-sz-mirror08c.bilivideo.com','upos-sz-mirrorbos.bilivideo.com',
      'upos-sz-mirrorcos.bilivideo.com','upos-sz-mirrorhwo1.bilivideo.com'];
    const hosts=[...new Set(pool.filter(h=>root.BiliRange.isTargetHost(h)&&h!==source))].slice(0,4);
    const targets=[{host:source,original:true},...hosts.map(host=>({host,original:false}))];
    const tasks=[];
    const arms=targets.map(()=>random()<0.5?[1,8,8,1]:[8,1,1,8]);
    for(let slot=0;slot<4;slot++)for(let offset=0;offset<targets.length;offset++){
      // Keep the source first so its validated bytes are the content reference.
      const index=slot===0?offset:(offset+slot)%targets.length;
      tasks.push({...targets[index],connections:arms[index][slot],slot});
    }
    return tasks;
  }
  const sameBytes=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
  async function run({sample,store,client,now=Date.now,random=Math.random,progress=()=>{}}){
    const started=now(),initial=read(store,KEY)||{};
    if(!validSample(sample,initial,started))return {rows:[],stop:'sample-expired',elapsedMs:0};
    const request={method:'GET',url:sample.url,headers:sample.headers},tasks=plan(sample,random),rows=[];
    const fetch=root.BiliRangeHTTP.makeFetch(client,now);let reference,referenceTotal,referenceHost,referenceOriginal,stop='complete';
    for(const task of tasks){
      const state=read(store,KEY)||{},at=now();
      if(epoch(state)!==sample.epoch){stop='network-changed';break;}
      if(Object.keys(root.BiliRangeBudget.active(state.leases,at)).length){stop='playback-active';break;}
      if(at-started>=65000){stop='time-budget';break;}
      if(!validSample(sample,state,at)){stop='sample-expired';break;}
      const range=root.BiliRange.parseRange(root.BiliRange.headers(sample.headers).range);
      const lease='media-'+at.toString(36)+Math.random().toString(36).slice(2),hadLeases=Object.prototype.hasOwnProperty.call(state,'leases');
      const admission=root.BiliRangeBudget.admit({leases:state.leases,now:at,bytes:range.length,
        wanted:root.BiliRange.split(range,task.connections).length,globalJobs:32,id:lease});
      if(!admission.ok){stop='playback-active';break;}
      state.leases=admission.leases;
      if(!save(store,KEY,state)){stop='store-failed';break;}
      const placeholder='upos-sz-mirror08c.bilivideo.com';
      let result;
      try{result=await root.BiliRange.accelerate({request,state:{},now,options:{enabled:true,auto:false,
        hosts:[task.original?placeholder:task.host],connections:task.connections,minChunkKiB:128,maxBytes:MiB,timeout:2500,alpn:'h1'},
        // Source mode fetches the actual captured URL; the core still validates
        // every part and concatenation. Its temporary host score is never saved.
        fetchRange:options=>fetch(task.original?{...options,url:sample.url}:options)});
      }finally{
        const latest=read(store,KEY)||{};
        if(latest.leases?.[lease]){
          delete latest.leases[lease];
          if(!hadLeases&&!Object.keys(latest.leases).length)delete latest.leases;
          save(store,KEY,latest);
        }
      }
      let ok=result.kind==='response',reason=ok?'ok':result.reason;
      const completedState=read(store,KEY)||{};
      if(epoch(completedState)!==sample.epoch){ok=false;reason='network-changed';stop=reason;}
      else if(Object.keys(root.BiliRangeBudget.active(completedState.leases,now())).length){ok=false;reason='playback-active';stop=reason;}
      if(ok){
        const total=root.BiliRange.contentRange(root.BiliRange.headers(result.response.headers)['content-range']).total;
        if(!reference){reference=result.response.body;referenceTotal=total;referenceHost=task.host;referenceOriginal=task.original;}
        else if(total!==referenceTotal||!sameBytes(reference,result.response.body)){ok=false;reason='content-different';}
      }
      const allowed=['transport','redirect-untrusted','redirect-limit','entity-mismatch','range-mismatch','length-mismatch',
        'content-range','content-length','encoded-body','non-media','content-different','expired-or-expiring','network-changed','playback-active'];
      reason=ok?'ok':allowed.includes(reason)||/^status-\d{3}$/.test(reason||'')?reason:'failed';
      const metrics=result.metrics||{},elapsedMs=Math.max(1,now()-at);
      rows.push({host:task.host,original:task.original,configured:task.connections,actual:Number(metrics.connections)||0,
        bytes:ok?result.response.body.length:0,elapsedMs,ok,reason,slot:task.slot});
      progress(rows.length,tasks.length);
      if(stop!=='complete')break;
    }
    return {rows,planned:tasks.length,elapsedMs:now()-started,stop,at:now(),referenceHost,referenceOriginal,
      rangeBytes:root.BiliRange.parseRange(root.BiliRange.headers(sample.headers).range).length};
  }
  function report(data){
    const end={complete:'完成', 'network-changed':'网络变化，已停止', 'playback-active':'检测到播放接管，已停止',
      'time-budget':'达到时间预算', 'sample-expired':'样本已过期', 'store-failed':'预算保存失败，未继续下载'};
    const rows=data.rows||[],lines=[`Bili 媒体测速：${rows.length}/${data.planned||0} 次范围下载，${end[data.stop]||'已停止'}，${data.elapsedMs} ms`,
      `同一媒体、相同字节范围 ${data.rangeBytes||0} B；原地址及最多4个CDN，h1偏好，128 KiB分片下限。`,
      `逐字节参考：${data.referenceHost||'未取得有效响应'}（${data.referenceOriginal?'原地址':'仅CDN响应一致性；不是已验证的原地址基线'}）。媒体类型未确认，采样窗口优先保留最大已见范围。`,
      '请求完成耗时含DNS/连接/重定向/返回等待；不读取播放器缓冲，不修改DNS或自动选择。'];
    for(const host of [...new Set(rows.map(r=>r.host))])for(const configured of [1,8]){
      const group=rows.filter(r=>r.host===host&&r.configured===configured),good=group.filter(r=>r.ok);
      const middle=values=>root.BiliRangeMeasurements.quantile(values,0.5);
      const rate=good.length?middle(good.map(r=>r.bytes*8/r.elapsedMs/1000)).toFixed(2):'未知';
      const errors={};for(const r of group.filter(r=>!r.ok))errors[r.reason]=(errors[r.reason]||0)+1;
      lines.push(`${group[0]?.original?'原地址':'CDN'} ${host} / 配置${configured}路（实际${[...new Set(group.map(r=>r.actual))].join('/')||'未测'}）：成功${good.length}/${group.length}，中位${rate} Mbps，尝试耗时${group.length?middle(group.map(r=>r.elapsedMs)).toFixed(0):'未知'} ms，失败${JSON.stringify(errors)}`);
    }
    lines.push('每档最多2次，含缓存与时间噪音；原地址也是脚本下载，不等于原生App基线，不能证明无卡顿。',
      '这是当前路由的真实媒体Range测试；没有固定Cloudflare/Google返回IP，不能据此宣称某个DNS的视频吞吐更快。',
      '计划有效范围总量最多20 MiB；服务器忽略Range、重定向等异常可能增加实际流量。报告不包含媒体地址、签名或IP。');
    return lines.join('\n');
  }
  async function manual(store,client,now=Date.now){
    const at=now(),lock=read(store,LOCK),state=read(store,KEY)||{},sample=read(store,CAPTURE);
    if(live(lock,at))return 'Bili 媒体测速正在运行，请勿重复启动。';
    if(!validSample(sample,state,at)){
      if(sample?.phase==='armed'&&live(sample,at)&&sample.epoch===epoch(state))return '尚未采到合格媒体请求。请回B站播放或拖动进度产生新下载，5–10秒后暂停，再次运行「Bili 媒体测速」。';
      const ok=save(store,CAPTURE,{phase:'armed',at,until:at+TTL,epoch:epoch(state)});
      return ok?'已准备采样：回B站播放5–10秒，然后暂停，回Loon再次运行「Bili 媒体测速」。仅手动启用后临时保存一条本机媒体地址，2分钟过期，下次脚本操作清理；测速会下载最多20次范围，不上传地址、不改配置。':'采样准备失败：本地存储写入失败。';
    }
    if(Object.keys(root.BiliRangeBudget.active(state.leases,at)).length)return '请先暂停B站视频，等待5秒再运行 Bili 媒体测速。';
    const token=at.toString(36)+Math.random().toString(36).slice(2);
    if(!save(store,LOCK,{until:at+90000,token}))return '测速未开始：本地运行锁写入失败。';
    try{
      if(!save(store,CAPTURE,null))return '测速未开始：临时媒体地址清理失败。';
      return report(await run({sample,store,client,now,progress:(done,total)=>console.log(`Bili 媒体测速进度：${done}/${total}`)}));
    }finally{if(read(store,LOCK)?.token===token)save(store,LOCK,null);}
  }
  root.BiliRangeMediaBenchmark={capture,validSample,plan,run,report,manual,KEY,CAPTURE,LOCK};
})(globalThis);

/* Manual only. Never logs the local signed media sample or raw network errors. */
(function(){
  'use strict';
  const finish=summary=>{
    summary='版本 0.1.20-experimental\n'+summary;
    console.log(summary);
    if(typeof $notification!=='undefined'&&typeof $notification.post==='function')try{$notification.post('Bili 媒体测速','点通知复制摘要',summary,{clipboard:summary});}catch{}
    $done({title:'Bili 媒体测速',content:summary});
  };
  globalThis.BiliRangeMediaBenchmark.manual($persistentStore,$httpClient).then(finish)
    .catch(()=>finish('Bili 媒体测速失败；未更改DNS或播放配置。请重新运行准备采样。'));
})();
