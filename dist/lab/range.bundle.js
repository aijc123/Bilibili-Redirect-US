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
  function split(range, count) {
    return btr.splitRange(range.start, range.end, count, 128 * 1024);
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
    const allocated = Number.isSafeInteger(options.allocatedConnections) ? Math.max(1,options.allocatedConnections) : count;
    const parts = split(range, Math.min(count, allocated, Math.floor(range.length / (128 * 1024))));
    const url = u.protocol + '://' + target + u.path + u.query;
    const safeHeaders = { 'Accept-Encoding': 'identity', [INTERNAL]: '1' };
    for (const name of ['user-agent', 'referer', 'accept']) if (h[name]) safeHeaders[name] = h[name];
    const timeout = Math.max(500, Math.min(5000, Number(options.timeout) || 2500));
    let results;
    try {
      // Wait for every callback even on failure: Loon has no documented cancellation API.
      const pending = parts.map(part => Promise.resolve().then(() => fetchRange({ url,
        headers: { ...safeHeaders, Range: `bytes=${part.start}-${part.end}` }, timeout, part }))
        .then(result => ({ ok: true, result }), error => ({ ok: false, error })));
      const settled = await Promise.all(pending);
      const failed = settled.find(r => !r.ok);
      if (failed) throw new Error(['redirect-untrusted', 'redirect-limit'].includes(failed.error?.message) ? failed.error.message : 'transport');
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
        else if (total !== cr.total || etag !== rh.etag || modified !== rh['last-modified'] || type !== rh['content-type']) throw new Error('entity-mismatch');
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
        metrics: { host: target, bytes: range.length, elapsedMs: elapsed, connections: parts.length,configuredConnections:count,bps,
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
      return { kind: 'pass', reason, metrics: { host: target, elapsedMs: finishedAt - at, cooldownMs,connections:parts.length,startedAt:at,finishedAt } };
    }
  }
  root.BiliRange = { accelerate, eligible, headers, parseRange, parseURL, contentRange, split, chooseHost, DEFAULT_HOSTS, INTERNAL };
})(globalThis);

/* Loon HTTP adapter with a bounded, validated redirect chain. */
(function (root) {
  'use strict';
  function redirectURL(from, location) {
    if (typeof location !== 'string' || !location || /[\s\\]/.test(location)) return null;
    const base = /^(https?):\/\/([^/?#]+)(\/upgcxcode\/[^?#]+)(\?[^#]*)?$/i.exec(from);
    if (!base) return null;
    let next = location;
    if (next.startsWith('//')) next = base[1] + ':' + next;
    else if (next.startsWith('/')) next = base[1] + '://' + base[2] + next;
    else if (next.startsWith('?')) next = base[1] + '://' + base[2] + base[3] + next;
    const parsed = /^(https?):\/\/([a-z0-9-]+\.bilivideo\.com)(?::(80|443))?(\/upgcxcode\/[^?#]+)(\?[^#]*)?$/i.exec(next);
    if (!parsed || parsed[4] !== base[3] || (base[1].toLowerCase() === 'https' && parsed[1].toLowerCase() !== 'https')) return null;
    return next;
  }
  function makeFetch(client, now = Date.now) {
    return async options => {
      const started = now();
      let url = options.url, redirects = 0;
      while (true) {
        const remaining = options.timeout - (now() - started);
        if (remaining < 100) throw new Error('transport');
        const result = await new Promise((resolve, reject) => {
          client.get({ url, headers: options.headers, timeout: remaining,
            'binary-mode': true, 'auto-redirect': false, 'auto-cookie': false, insecure: false, alpn: 'h1' },
          (error, response, data) => error || !response ? reject(new Error('transport')) :
            resolve({ status: Number(response.status), headers: response.headers, body: data }));
        });
        if (![301, 302, 303, 307, 308].includes(result.status)) return { ...result, redirects, elapsedMs:Math.max(1,now()-started) };
        const location = root.BiliRange.headers(result.headers).location;
        const next = redirectURL(url, location);
        if (!next) throw new Error('redirect-untrusted');
        if (redirects >= 2 || next === url) throw new Error('redirect-limit');
        url = next; redirects++;
      }
    };
  }
  root.BiliRangeHTTP = { redirectURL, makeFetch };
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
  function identity(state,request){
    const u=root.BiliRange.parseURL(request.url);if(!u)return null;
    const m=state.measurements ||= {salt:Math.random().toString(36).slice(2),samples:[]};
    return hash(u.path,m.salt);
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
      mode:Number(r.connections)||Number(context.connections)||0,requestedMode:Number(r.configuredConnections)||Number(context.connections)||0,host:String(r.host||''),
      epoch:Number(context.epoch)||0,content:identity(state,request),bucket:rangeBucket(range.length),rangeBytes:range.length,
      inflight:Number(context.inflight)||0,redirects:Number(r.redirects)||0,
      maxPieceMs:Number(r.maxPieceMs)||0,minPieceMs:Number(r.minPieceMs)||0};
    // Restrict the only stored hostname field. Invalid metrics cannot introduce other text.
    if(!/^upos-sz-mirror[a-z0-9-]+\.bilivideo\.com$/.test(sample.host))return;
    const trial=context.trial;
    if(trial&&/^\d+\|[0-9a-f]{8}\|4vs(?:8|16|32)\|\d+$/.test(trial.block||'')&&
      [0,1,2,3].includes(trial.slot)&&['A','B'].includes(trial.arm)&&trial.baseline===4&&[8,16,32].includes(trial.candidate))
      sample.trial={block:trial.block,slot:trial.slot,arm:trial.arm,baseline:4,candidate:trial.candidate};
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
    return {n:samples.length,success:ok.length,failed:samples.length-ok.length,
      failureRate:samples.length?(samples.length-ok.length)/samples.length:0,
      p50Mbps:median(rates),p10Mbps:quantile(rates,0.1),p50Ms:median(latencies),p90Ms:quantile(latencies,0.9),
      bytes:ok.reduce((n,s)=>n+s.bytes,0),noise:ok.length<8?'样本不足':rates.length&&quantile(rates,0.9)/Math.max(0.001,quantile(rates,0.1))>2?'波动较大':'仍有缓存与时间噪音'};
  }
  function analyze(state, at=Date.now()) {
    const valid=s=>s&&typeof s==='object'&&/^upos-sz-mirror[a-z0-9-]+\.bilivideo\.com$/.test(s.host||'')&&/^[0-9a-f]{8}$/.test(s.content||'')&&
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
    for(const s of samples){const key=[s.epoch,s.content,s.host,s.bucket,s.inflight,s.mode].join('|');(groups[key] ||= []).push(s);}
    const comparisons={};
    for(const s of samples){const key=[s.epoch,s.content,s.host,s.bucket,s.inflight].join('|');((comparisons[key] ||= {})[s.mode] ||= []).push(s);}
    const contrasts=[];
    for(const [key,modes] of Object.entries(comparisons)) {
      const keys=Object.keys(modes).map(Number).sort((a,b)=>a-b);
      for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++) {
        const a=summarize(modes[keys[i]]),b=summarize(modes[keys[j]]);
        if(!a.success||!b.success)continue;
        contrasts.push({group:key,baseline:keys[i],candidate:keys[j],baselineN:a.n,candidateN:b.n,
          medianRatio:b.p50Mbps/a.p50Mbps,baselineP90Ms:a.p90Ms,candidateP90Ms:b.p90Ms,
          adequate:a.success>=8&&b.success>=8,causal:false,warning:'不同字节范围/缓存状态仍可能混杂；不是因果提速倍数'});
      }
    }
    return {trials:root.BiliRangeTrials?root.BiliRangeTrials.analyze(samples):null,window:{n:recent.length,bytes,spanMs:elapsed,occupiedMs:occupied,
      deliveryMbps:elapsed?bytes*8/elapsed/1000:null,activeMbps:occupied?bytes*8/occupied/1000:null,
      peakCompletedOverlap:peak(intervals),scope:'完成接管尝试的成功字节 / 含失败的时间区间；不含原请求放行流量，不能直接推断播放器缓冲'},
      groups:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,summarize(v)])),contrasts:contrasts.slice(-12),samples:samples.length};
  }
  function report(state,at=Date.now()) {
    const a=analyze(state,at),w=a.window,fmt=n=>n===null?'未知':Number(n).toFixed(2);
    const lines=[`客观采样：保留 ${a.samples} 条 / 最近30秒 ${w.n} 条`,
      `窗口交付率 ${fmt(w.deliveryMbps)} Mbps；尝试活跃区间交付率 ${fmt(w.activeMbps)} Mbps；完成尝试重叠峰值 ${w.peakCompletedOverlap}`,
      '分层条件：网络epoch / 临时表示组 / CDN / 请求大小 / 在途负载 / 实际并发',
      '下列为每请求分布，含连接/重定向/返回等待，API不提供真实TTFB或播放器卡顿计数：'];
    for(const [key,v] of Object.entries(a.groups).slice(-12))lines.push(`${key}: n=${v.n}, 错误=${(v.failureRate*100).toFixed(1)}%, p50=${fmt(v.p50Mbps)} Mbps, p10=${fmt(v.p10Mbps)} Mbps, p90=${fmt(v.p90Ms)} ms, ${v.noise}`);
    for(const c of a.contrasts)lines.push(`观察对照 ${c.baseline}→${c.candidate}路: 中位比=${c.medianRatio.toFixed(2)}, n=${c.baselineN}/${c.candidateN}, ${c.adequate?'样本达到最低门槛':'样本不足'}；不是因果倍数`);
    if(!a.contrasts.length)lines.push('暂无同层不同并发对照；累计字节/累计请求耗时不能替代此对照。');
    if(a.trials){
      lines.push(`交替块对照：未完成块 ${a.trials.incomplete}，条件不一致块 ${a.trials.mismatched}`);
      for(const g of a.trials.groups.slice(-6))lines.push(`设置 ${g.baseline}→${g.candidate} / 实际 ${g.actualA}→${g.actualB}路，块 ${g.cleanBlocks}/${g.blocks}，错误 ${(g.failureA*100).toFixed(1)}%/${(g.failureB*100).toFixed(1)}%，比值 ${fmt(g.ratio)}，经验区间 ${g.interval?g.interval.map(fmt).join('～'):'样本不足'}${g.equivalent?'；实际并发相同，不能验证高路数效果':''}`);
      if(a.trials.groups.length)lines.push('块重采样范围不是保证；仍有缓存、负载及样本依赖，不代表卡顿下降倍数。');
    }
    lines.push(w.scope);return lines.join('\n');
  }
  root.BiliRangeMeasurements={record,identity,analyze,report,quantile,unionMs,rangeBucket};
})(globalThis);

/* Optional balanced existing-traffic comparison. No replay or background media GET.
 * Blocks alternate ABBA/BAAB at random; not a fully controlled player experiment. */
(function(root){
  'use strict';
  const MODES={'4vs8':[4,8],'4vs16':[4,16],'4vs32':[4,32]};
  function plan(state,request,mode,at=Date.now(),random=Math.random){
    const arms=MODES[mode];if(!arms)return null;
    const identity=root.BiliRangeMeasurements.identity(state,request);if(!identity)return null;
    const key=[Number(state.epoch)||0,identity,mode].join('|');
    const groups=Object.fromEntries(Object.entries(state.trials?.groups||{}).filter(([,v])=>v&&at-v.at<15*60*1000).slice(-3));
    const previous=groups[key];
    const counter=previous&&Number.isSafeInteger(previous.counter)&&previous.counter>=0?previous.counter:0,slot=counter%4,block=Math.floor(counter/4);
    const reverse=slot===0?random()<0.5:previous.reverse;
    const arm=(reverse?[1,0,0,1]:[0,1,1,0])[slot];
    groups[key]={at,counter:counter+1,reverse};
    return {connections:arms[arm],trial:{block:key+'|'+block,slot,arm:arm?'B':'A',baseline:arms[0],candidate:arms[1]},next:{groups}};
  }
  function empiricalInterval(logRatios){
    if(logRatios.length<5)return null;
    let seed=0x1a2b3c4d;const estimates=[];
    for(let i=0;i<600;i++){
      let total=0;
      for(let j=0;j<logRatios.length;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;total+=logRatios[seed%logRatios.length];}
      estimates.push(Math.exp(total/logRatios.length));
    }
    return [root.BiliRangeMeasurements.quantile(estimates,0.025),root.BiliRangeMeasurements.quantile(estimates,0.975)];
  }
  function analyze(samples){
    const blocks={};
    for(const s of samples){
      if(!s.trial||!/^\d+\|[0-9a-f]{8}\|4vs(?:8|16|32)\|\d+$/.test(s.trial.block||'')||
        !['A','B'].includes(s.trial.arm)||![0,1,2,3].includes(s.trial.slot)||s.trial.baseline!==4||![8,16,32].includes(s.trial.candidate))continue;
      (blocks[s.trial.block] ||= []).push(s);
    }
    let incomplete=0,mismatched=0;const groups={};
    for(const block of Object.values(blocks)){
      if(block.length!==4||new Set(block.map(s=>s.trial.slot)).size!==4){incomplete++;continue;}
      const A=block.filter(s=>s.trial.arm==='A'),B=block.filter(s=>s.trial.arm==='B');
      const condition=s=>[s.epoch,s.content,s.host,s.rangeBytes,s.inflight].join('|');
      if(A.length!==2||B.length!==2||new Set(block.map(condition)).size!==1||
        new Set(block.map(s=>s.trial.candidate)).size!==1||
        new Set(A.map(s=>s.mode)).size!==1||new Set(B.map(s=>s.mode)).size!==1){mismatched++;continue;}
      const key=condition(A[0])+'|'+A[0].mode+'|'+B[0].mode+'|'+A[0].trial.candidate;
      const g=groups[key] ||= {baseline:A[0].trial.baseline,candidate:B[0].trial.candidate,actualA:A[0].mode,actualB:B[0].mode,blocks:0,cleanBlocks:0,failedA:0,failedB:0,logRatios:[]};
      g.blocks++;g.failedA+=A.filter(s=>!s.ok).length;g.failedB+=B.filter(s=>!s.ok).length;
      if(block.every(s=>s.ok)){
        const median=values=>root.BiliRangeMeasurements.quantile(values,0.5);
        const ratio=median(B.map(s=>s.bytes/s.elapsedMs))/median(A.map(s=>s.bytes/s.elapsedMs));
        if(Number.isFinite(ratio)&&ratio>0){g.cleanBlocks++;g.logRatios.push(Math.log(ratio));}
      }
    }
    return {incomplete,mismatched,groups:Object.entries(groups).map(([key,g])=>({key,baseline:g.baseline,candidate:g.candidate,
      actualA:g.actualA,actualB:g.actualB,blocks:g.blocks,cleanBlocks:g.cleanBlocks,
      failureA:g.failedA/(2*g.blocks),failureB:g.failedB/(2*g.blocks),
      ratio:g.logRatios.length?Math.exp(g.logRatios.reduce((n,v)=>n+v,0)/g.logRatios.length):null,
      interval:empiricalInterval(g.logRatios),equivalent:g.actualA===g.actualB,
      caveat:'原有流量交替；不是完整播放实验；缓存、负载和依赖仍可混杂。区间是块重采样经验范围。'}))};
  }
  root.BiliRangeTrials={plan,analyze,empiricalInterval};
})(globalThis);

/* Aggregate request shapes only. No path, query, range offset, token or cookie values. */
(function (root) {
  'use strict';
  const VERSION = '0.1.6-experimental';
  const names = {
    internal: '内部请求', 'not-media-get': '暂不支持的媒体请求',
    'conditional-or-auth': '带条件或认证请求头', disabled: '实验下载已关闭',
    'unbounded-or-multiple-range': '开放或多段范围', 'no-range': '没有 Range',
    'small-range': '范围小于 256 KiB', 'large-range': '范围超过上限',
    'expired-or-expiring': '签名过期或即将过期', cooldown: '候选暂时冷却',
    busy: '已达到接管预算', transport: '子请求网络错误', 'entity-mismatch': '分块实体不一致',
    'budget-requests':'在途接管请求已满', 'budget-jobs':'全局子请求预算已满', 'budget-bytes':'缓冲字节预算已满',
    'redirect-untrusted': '重定向目标未通过校验', 'redirect-limit': '重定向循环或超过上限',
    'range-mismatch': '返回范围不符', 'length-mismatch': '返回长度不符',
    'encoded-body':'返回内容仍被编码', 'content-range':'返回总长度缺失或无效', 'content-length':'声明长度与实际不符', 'non-media':'返回非媒体内容',
  };
  function shape(request) {
    const h = root.BiliRange.headers(request.headers);
    const raw = h.range || '', parsed = root.BiliRange.parseRange(raw);
    let range = raw ? 'invalid' : 'absent';
    if (/^bytes=\d+-$/i.test(raw)) range = 'open-ended';
    else if (/^bytes=-\d+$/i.test(raw)) range = 'suffix';
    else if (raw.includes(',')) range = 'multiple';
    else if (parsed) range = parsed.length < 256 * 1024 ? 'under-256KiB' :
      parsed.length <= 2 * 1024 * 1024 ? '256KiB-2MiB' : parsed.length <= 4 * 1024 * 1024 ? '2-4MiB' :
      parsed.length <= 8 * 1024 * 1024 ? '4-8MiB' : 'over-8MiB';
    // Classify the authority only; never retain arbitrary host text.
    const authority = /^https?:\/\/([^/?#]+)/i.exec(request.url || '')?.[1]?.toLowerCase() || '';
    const source = authority.includes('.mcdn.bilivideo.cn') ? 'MCDN' :
      authority.endsWith('.akamaized.net') || authority.includes('.akamaized.net:') ? 'Akamai' :
      authority.startsWith('upos-') ? 'UPOS' : authority.startsWith('cn-hk-eq-') ? 'HK' : 'other';
    return { range, source };
  }
  function record(d, request, result) {
    d ||= {};
    d.accelerated ||= 0; d.passed ||= 0; d.reasons ||= {}; d.shapes ||= {}; d.sources ||= {};
    const s = shape(request);
    d.shapes[s.range] = (d.shapes[s.range] || 0) + 1;
    d.sources[s.source] = (d.sources[s.source] || 0) + 1;
    if (result.kind === 'response') {
      d.accelerated++; d.last = result.metrics;
      const mode = String(result.metrics.connections), stats = (d.modes ||= {});
      const m = stats[mode] ||= { requests: 0, bytes: 0, elapsedMs: 0 };
      m.requests++; m.bytes += result.metrics.bytes; m.elapsedMs += result.metrics.elapsedMs;
    } else { d.passed++; d.reasons[result.reason] = (d.reasons[result.reason] || 0) + 1; }
    return d;
  }
  function report(state) {
    const d = state.diagnostics || {}, reasons = Object.entries(d.reasons || {}).map(([k,v]) => `${names[k] || k}: ${v}`);
    return `版本 ${VERSION}\n接管 ${d.accelerated || 0} 次 / 放行 ${d.passed || 0} 次\n` +
      (reasons.join('\n') || '暂无请求') + '\n范围分布：' + JSON.stringify(d.shapes || {}) +
      '\n来源分类：' + JSON.stringify(d.sources || {}) + '\n最近传输：' + JSON.stringify(d.last || {}) +
      '\n并发记录：' + JSON.stringify(d.modes || {}) + '\n提示：不同视频的记录不能直接作为提速倍数。' +
      (root.BiliRangeMeasurements?'\n\n'+root.BiliRangeMeasurements.report(state):'')+
      '\n最近网络重置：'+JSON.stringify(state.lastNetworkReset||{});
  }
  root.BiliRangeDiagnostics = { VERSION, shape, record, report, allowedReasons:Object.keys(names) };
})(globalThis);

/* Loon adapter. Stores aggregates only; never stores or uploads media URLs. */
(function () {
  'use strict';
  const KEY = 'aijc123.BiliRange.lab.v1', core = globalThis.BiliRange, diagnostics = globalThis.BiliRangeDiagnostics;
  let state;
  try { state = JSON.parse($persistentStore.read(KEY) || '{}'); } catch { state = {}; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
  let arg = typeof $argument === 'object' && $argument ? $argument : {};
  if (typeof $argument === 'string') { try { arg = JSON.parse($argument); } catch { if ($argument === 'Action=reset') arg = { Action: 'reset' }; } }
  const epoch = state.epoch || 0;
  const save = () => $persistentStore.write(JSON.stringify(state), KEY);
  if (arg.Action === 'reset' || typeof $request === 'undefined' || !$request || typeof $request.url !== 'string' || !$request.url) {
    if (arg.Action === 'reset') { state.hosts = {}; state.epoch = epoch + 1; save(); $done({}); return; }
    const scores = Object.entries(state.hosts || {}).map(([h, v]) => `${h}: ${(Number(v.bps || 0) * 8 / 1e6).toFixed(1)} Mbps`);
    const summary = diagnostics.report(state) + '\n' + scores.join('\n');
    console.log(summary);
    if (typeof $notification !== 'undefined' && typeof $notification.post === 'function') {
      try { $notification.post('Bili Range 诊断', '点此通知复制摘要，然后粘贴到聊天', summary, { clipboard: summary }); } catch {}
    }
    $done({ title: 'Bili Range 实验版', content: summary }); return;
  }
  let finished = false;
  const done = result => { if (!finished) { finished = true; $done(result); } };
  const fetchRange = options => globalThis.BiliRangeHTTP.makeFetch($httpClient)(options);
  const options = { enabled: arg.Enabled !== false, auto: arg.AutoCDN !== false,
    connections: [1,2,4,6,8,16,32].includes(Number(arg.Connections)) ? Number(arg.Connections) : 4, maxBytes: Math.min(8,Number(arg.MaxMiB) || 4) * 1024 * 1024,
    timeout: 2500, hosts: arg.PreferredCDN ? [arg.PreferredCDN, ...core.DEFAULT_HOSTS.filter(h => h !== arg.PreferredCDN)] : core.DEFAULT_HOSTS };
  const plan=core.eligible($request,options);
  const parsed=plan.range;
  const trialPlan=plan.kind==='eligible'&&globalThis.BiliRangeTrials?globalThis.BiliRangeTrials.plan(state,$request,arg.TrialMode):null;
  if(trialPlan){options.connections=trialPlan.connections;options.auto=false;}
  const leases = globalThis.BiliRangeBudget.active(state.leases,Date.now());
  let inflight=Object.keys(leases).length;
  let lease;
  if (plan.kind==='eligible') {
    // Best-effort cross-context budget. Storage exposes no atomic compare-and-swap.
    const id=Date.now().toString(36) + Math.random().toString(36).slice(2);
    const admission=globalThis.BiliRangeBudget.admit({leases,now:Date.now(),bytes:parsed.length,
      wanted:core.split(parsed,options.connections).length,globalJobs:Number(arg.GlobalJobs)||16,
      maxBufferedBytes:Math.max(4*1024*1024,options.maxBytes),id});
    if (!admission.ok) {
      state.leases=admission.leases;
      state.diagnostics = diagnostics.record(state.diagnostics, $request, {kind:'pass',reason:admission.reason});
      save(); done({}); return;
    }
    lease=id;inflight=admission.inflight;options.allocatedConnections=admission.count;
    if(trialPlan)state.trials=trialPlan.next;
    state.leases=admission.leases;
    if(save()===false){console.log('Bili Range 预算状态写入失败，放行原请求。');done({});return;}
  }
  core.accelerate({ request: $request, options, fetchRange, state }).then(result => {
    if (result.reason === 'internal') { done({}); return; }
    // Merge aggregate counters with the latest storage; separate script contexts may finish together.
    let latest;
    try { latest = JSON.parse($persistentStore.read(KEY) || '{}'); } catch { latest = {}; }
    if (!latest || typeof latest !== 'object' || Array.isArray(latest)) latest = {};
    state.diagnostics = diagnostics.record(latest.diagnostics, $request, result);
    if(globalThis.BiliRangeMeasurements){
      state.measurements=latest.measurements;
      globalThis.BiliRangeMeasurements.record(state,$request,result,{epoch,connections:options.connections,inflight,trial:trialPlan?.trial});
    }
    state.lastNetworkReset=latest.lastNetworkReset;
    state.trials=latest.trials;
    state.epoch = latest.epoch || 0;
    state.leases = latest.leases || {};
    if (lease) delete state.leases[lease];
    if (result.metrics?.host && state.epoch === epoch) state.hosts = { ...(latest.hosts || {}), [result.metrics.host]: state.hosts[result.metrics.host] };
    else state.hosts = latest.hosts || {};
    save();
    if (arg.Debug === true) console.log(JSON.stringify({ kind: result.kind, reason: result.reason, metrics: result.metrics }));
    done(result.kind === 'response' ? { response: result.response } : {});
  }).catch(() => {
    // A local processing exception must not hold the admission budget until expiry.
    try {const latest=JSON.parse($persistentStore.read(KEY)||'{}');if(lease&&latest?.leases){delete latest.leases[lease];$persistentStore.write(JSON.stringify(latest),KEY);}}catch{}
    done({});
  });
})();
