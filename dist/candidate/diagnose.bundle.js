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
  function isTargetHost(value){return typeof value==='string'&&/^(?:upos-sz-[a-z0-9-]+|cn-hk-eq-[a-z0-9-]+)\.bilivideo\.com$/.test(value);}
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
      const cooldownMs = integrity ? 60000 : statusFailure ? 1500 : Math.min(10000, 1500 * 2 ** (failures - 1));
      (state.hosts ||= {})[target] = { ...old, failures, at: now(), blockedUntil: now() + cooldownMs, lastError: reason };
      const finishedAt=now();
      return { kind: 'pass', reason, metrics: { host: target, elapsedMs: finishedAt - at, cooldownMs,connections:parts.length,startedAt:at,finishedAt,requestedALPN,minChunkKiB,...(integrityField?{integrityField}:{}),...(error.redirectField?{redirectField:error.redirectField}:{}),...(error.redirectFamily?{redirectFamily:error.redirectFamily}:{}) } };
    }
  }
  root.BiliRange = { accelerate, eligible, headers, parseRange, parseURL, contentRange, split, chooseHost, isTargetHost,DEFAULT_HOSTS, INTERNAL };
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
      if(!Number.isSafeInteger(s.rangeBytes)||s.rangeBytes<=0||![1,2,4,6,8,16,32].includes(s.requestedMode))continue;
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
  const TRIAL_MODES=Object.freeze({'4vs8':Object.freeze([4,8]),'4vs16':Object.freeze([4,16]),'4vs32':Object.freeze([4,32]),
    '8vs16':Object.freeze([8,16]),'8vs32':Object.freeze([8,32]),'16vs32':Object.freeze([16,32])});
  function sanitizeTrial(trial){
    if(!trial||typeof trial.block!=='string'||trial.block.length>80)return null;
    const match=/^\d+\|[0-9a-f]{8}\|((?:[48]vs(?:8|16|32))|16vs32)\|\d+$/.exec(trial.block),arms=match&&TRIAL_MODES[match[1]];
    if(!arms||![0,1,2,3].includes(trial.slot)||!['A','B'].includes(trial.arm)||trial.baseline!==arms[0]||trial.candidate!==arms[1])return null;
    return {block:trial.block,slot:trial.slot,arm:trial.arm,baseline:trial.baseline,candidate:trial.candidate};
  }
  root.BiliRangeMeasurements={record,identity,analyze,report,quantile,unionMs,rangeBucket,TRIAL_MODES,sanitizeTrial};
})(globalThis);

/* Optional balanced existing-traffic comparison. No replay or background media GET.
 * Blocks alternate ABBA/BAAB at random; not a fully controlled player experiment. */
(function(root){
  'use strict';
  const MODES=root.BiliRangeMeasurements.TRIAL_MODES;
  const SAFETY_TTL=10*60*1000;
  function safetyKey(state,request,mode,host){
    if(!Array.isArray(MODES[mode])||!root.BiliRange.isTargetHost(host))return null;
    const identity=root.BiliRangeMeasurements.identity(state,request,true);return identity?[Number(state.epoch)||0,identity,mode,host].join('|'):null;
  }
  function safetyEntries(state,at=Date.now()){
    return Object.fromEntries(Object.entries(state.trialSafety||{}).filter(([key,value])=>
      /^\d+\|[0-9a-f]{8}\|(?:4vs(?:8|16|32)|8vs(?:16|32)|16vs32)\|[^|]+$/.test(key)&&root.BiliRange.isTargetHost(key.split('|')[3])&&
      key.startsWith((Number(state.epoch)||0)+'|')&&value&&Number.isFinite(value.at)&&value.at<=at&&at-value.at<SAFETY_TTL&&
      (root.BiliRangeDiagnostics?.allowedReasons?.includes(value.reason)||/^status-\d{3}$/.test(value.reason||''))).slice(-8));
  }
  function permission(state,request,mode,host,at=Date.now()){
    const key=safetyKey(state,request,mode,host);if(!key)return {allowed:false,recovery:false};
    const entries=safetyEntries(state,at),pause=entries[key],cooling=Number(state.hosts?.[host]?.blockedUntil)>at;
    const excludePreferred=Boolean(pause&&pause.reason!=='transport');
    return {allowed:!pause&&!cooling,recovery:Boolean(pause||cooling),baseline:MODES[mode][0],excludePreferred};
  }
  function recordSafety(state,request,result,{mode,trial,epoch}={},at=Date.now()){
    if(!trial||result.kind==='response'||!result.metrics?.host||Number(state.epoch||0)!==Number(epoch||0))return;
    const key=safetyKey(state,request,mode,result.metrics.host);if(!key)return;
    const reason=root.BiliRangeDiagnostics?.allowedReasons?.includes(result.reason)||/^status-\d{3}$/.test(result.reason||'')?result.reason:'transport';
    state.trialSafety={...safetyEntries(state,at),[key]:{at,reason}};
    state.trialSafety=Object.fromEntries(Object.entries(state.trialSafety).slice(-8));
    // Resume with a new balanced block; never splice the paused partial block.
    const groupKey=trial.block.slice(0,trial.block.lastIndexOf('|')),group=state.trials?.groups?.[groupKey];
    if(group&&Number.isSafeInteger(group.counter))group.counter=Math.ceil(group.counter/4)*4;
  }
  function safetyReport(state,at=Date.now()){
    const entries=Object.entries(safetyEntries(state,at));if(!entries.length)return '';
    return '对照安全暂停：'+entries.map(([key,value])=>key.split('|')[3]+' / '+value.reason).join('，')+
      '\n当前节点/签名地址/对照组合失败后暂停10分钟；期间使用4/8路与128 KiB普通自动选CDN恢复，不纳入并发对照。更换节点、地址签名、另一对照模式或网络轮次可重新检查。';
  }
  function plan(state,request,mode,at=Date.now(),random=Math.random){
    const arms=MODES[mode];if(!Array.isArray(arms))return null;
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
      if(!root.BiliRangeMeasurements.sanitizeTrial(s.trial))continue;
      (blocks[s.trial.block] ||= []).push(s);
    }
    let incomplete=0,mismatched=0;const groups={};
    for(const block of Object.values(blocks)){
      if(block.length!==4||new Set(block.map(s=>s.trial.slot)).size!==4){incomplete++;continue;}
      const A=block.filter(s=>s.trial.arm==='A'),B=block.filter(s=>s.trial.arm==='B');
      const condition=s=>[s.epoch,s.content,s.host,s.rangeBytes,s.inflight,s.requestedALPN==='h2'?'h2':'h1',[32,64,128].includes(s.minChunkKiB)?s.minChunkKiB:128,s.adaptiveScheme||'unknown',s.adaptiveEntity||'unknown'].join('|');
      if(A.length!==2||B.length!==2||new Set(block.map(condition)).size!==1||
        new Set(block.map(s=>s.trial.baseline+':'+s.trial.candidate)).size!==1||
        new Set(A.map(s=>s.mode)).size!==1||new Set(B.map(s=>s.mode)).size!==1){mismatched++;continue;}
      const key=condition(A[0])+'|'+A[0].mode+'|'+B[0].mode+'|'+A[0].trial.baseline+'|'+A[0].trial.candidate;
      const g=groups[key] ||= {baseline:A[0].trial.baseline,candidate:B[0].trial.candidate,actualA:A[0].mode,actualB:B[0].mode,blocks:0,cleanBlocks:0,failedA:0,failedB:0,logRatios:[],latencyA:[],latencyB:[]};
      g.blocks++;g.failedA+=A.filter(s=>!s.ok).length;g.failedB+=B.filter(s=>!s.ok).length;
      g.latencyA.push(...A.map(s=>s.elapsedMs).filter(n=>Number.isFinite(n)&&n>0));g.latencyB.push(...B.map(s=>s.elapsedMs).filter(n=>Number.isFinite(n)&&n>0));
      if(block.every(s=>s.ok)){
        const median=values=>root.BiliRangeMeasurements.quantile(values,0.5);
        const ratio=median(B.map(s=>s.bytes/s.elapsedMs))/median(A.map(s=>s.bytes/s.elapsedMs));
        if(Number.isFinite(ratio)&&ratio>0){g.cleanBlocks++;g.logRatios.push(Math.log(ratio));}
      }
    }
    return {incomplete,mismatched,groups:Object.entries(groups).map(([key,g])=>({key,baseline:g.baseline,candidate:g.candidate,
      actualA:g.actualA,actualB:g.actualB,blocks:g.blocks,cleanBlocks:g.cleanBlocks,
      failureA:g.failedA/(2*g.blocks),failureB:g.failedB/(2*g.blocks),
      p90MsA:root.BiliRangeMeasurements.quantile(g.latencyA,0.9),p90MsB:root.BiliRangeMeasurements.quantile(g.latencyB,0.9),
      ratio:g.logRatios.length?Math.exp(g.logRatios.reduce((n,v)=>n+v,0)/g.logRatios.length):null,
      interval:empiricalInterval(g.logRatios),equivalent:g.actualA===g.actualB,
      caveat:'原有流量交替；不是完整播放实验；缓存、负载和依赖仍可混杂。区间是块重采样经验范围。'}))};
  }
  root.BiliRangeTrials={plan,analyze,empiricalInterval,permission,recordSafety,safetyReport};
})(globalThis);

/* Observe complete SIDX boxes already present in successful buffered responses.
 * Uses pinned BTR parser. No extra GET, response hook, or media URL persistence. */
(function(root){
  'use strict';
  function observe(state,request,result,context={}){
    try{
      if(result.kind!=='response'||!root.__BILI_SIDX__)return;
      const range=root.BiliRange.parseRange(root.BiliRange.headers(request.headers).range),body=result.response?.body;
      if(!range||range.start>65536||!(body instanceof Uint8Array))return;
      const sidx=root.__BILI_SIDX__.parseSidx(body.subarray(0,65536),range.start);
      if(!sidx||sidx.segments.length>2048)return;
      const segments=sidx.segments;
      if(segments.some(s=>!Number.isSafeInteger(s.length)||s.length<=0||!Number.isFinite(s.durationSeconds)||s.durationSeconds<=0))return;
      const bytes=segments.reduce((n,s)=>n+s.length,0),duration=segments.reduce((n,s)=>n+s.durationSeconds,0);
      const rates=segments.map(s=>s.length*8/s.durationSeconds/1e6),average=bytes*8/duration/1e6;
      if(!Number.isFinite(average)||average<=0||average>1000)return;
      const at=Number(result.metrics?.finishedAt)||Date.now(),content=root.BiliRangeMeasurements.identity(state,request);
      const type=root.BiliRange.headers(result.response.headers)['content-type']||'';
      const item={at,epoch:Number(context.epoch)||0,content,averageMbps:average,
        p90SegmentMbps:root.BiliRangeMeasurements.quantile(rates,0.9),maxSegmentMbps:Math.max(...rates),
        segments:segments.length,durationSeconds:duration,type:/^video\//i.test(type)?'video':/^audio\//i.test(type)?'audio':'unknown'};
      state.mediaInfos=(Array.isArray(state.mediaInfos)?state.mediaInfos:[]).filter(v=>v.content!==content&&at-v.at<15*60*1000).slice(-3);
      state.mediaInfos.push(item);
    }catch{} // Metadata observation must never cause a valid media response to fall back.
  }
  function report(state,at=Date.now()){
    const infos=(Array.isArray(state.mediaInfos)?state.mediaInfos:[]).filter(v=>v&&v.epoch===(Number(state.epoch)||0)&&at-v.at<15*60*1000&&
      /^[0-9a-f]{8}$/.test(v.content||'')&&['video','audio','unknown'].includes(v.type)&&
      [v.averageMbps,v.p90SegmentMbps,v.maxSegmentMbps,v.durationSeconds].every(n=>Number.isFinite(n)&&n>0)).slice(-4);
    if(!infos.length)return '码率需求：未知；合格既有响应尚未包含完整SIDX。小范围初始化通常放行，不额外取索引。';
    const speed=[1,1.25,1.5,2].includes(Number(state.playbackRate))?Number(state.playbackRate):1.5;
    return [`SIDX已见表示；诊断假设倍速 ${speed}（没有读取或改变 App 实际倍速）：`,
      ...infos.map(v=>`${v.content} / ${v.type}: 均值 ${v.averageMbps.toFixed(2)} Mbps，段p90 ${v.p90SegmentMbps.toFixed(2)} Mbps，均值×倍速 ${(v.averageMbps*speed).toFixed(2)} Mbps，索引段 ${v.segments}`),
      '仅已见表示的索引估计；当前表示未知，不含其他音视频表示、传输开销或缓冲余量，不能保证不卡顿。'].join('\n');
  }
  root.BiliRangeMedia={observe,report};
})(globalThis);

/* Aggregate request shapes only. No path, query, range offset, token or cookie values. */
(function (root) {
  'use strict';
  const VERSION = '0.1.15-experimental';
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
  function record(d, request, result,context={}) {
    d ||= {};
    d.accelerated ||= 0; d.passed ||= 0; d.reasons ||= {}; d.shapes ||= {}; d.sources ||= {};
    const s = shape(request);
    if(['bili-akamai','bili-mcdn','bili-other','external'].includes(result.metrics?.redirectFamily)){
      const families=d.redirectFamilies ||= {},family=result.metrics.redirectFamily;families[family]=(families[family]||0)+1;
    }
    if(['total','etag','last-modified','content-type'].includes(result.metrics?.integrityField)){
      const fields=d.integrityFields ||= {},field=result.metrics.integrityField;fields[field]=(fields[field]||0)+1;
    }
    if(['malformed','source','host','credentials','downgrade','port','path-wrapper','path'].includes(result.metrics?.redirectField)){
      const fields=d.redirectFields ||= {},field=result.metrics.redirectField;fields[field]=(fields[field]||0)+1;
    }
    d.shapes[s.range] = (d.shapes[s.range] || 0) + 1;
    d.sources[s.source] = (d.sources[s.source] || 0) + 1;
    if (result.kind === 'response') {
      d.accelerated++; d.last = result.metrics;
      const mode = String(result.metrics.connections), stats = (d.modes ||= {});
      const m = stats[mode] ||= { requests: 0, bytes: 0, elapsedMs: 0 };
      m.requests++; m.bytes += result.metrics.bytes; m.elapsedMs += result.metrics.elapsedMs;
    } else { d.passed++; d.reasons[result.reason] = (d.reasons[result.reason] || 0) + 1; }
    const at=Date.now(),epoch=Number.isSafeInteger(context.epoch)?context.epoch:0,p=context.policy;
    const reason=Object.prototype.hasOwnProperty.call(names,result.reason)||/^status-\d{3}$/.test(result.reason||'')?result.reason:'other';
    d.events=(Array.isArray(d.events)?d.events:[]).filter(e=>e&&Number.isFinite(e.at)&&e.at<=at&&at-e.at<15*60*1000&&
      ['response','pass'].includes(e.kind)&&(Object.prototype.hasOwnProperty.call(names,e.reason)||/^status-\d{3}$/.test(e.reason||'')||['other','ok'].includes(e.reason)))
      .map(e=>({at:e.at,epoch:Number.isSafeInteger(e.epoch)?e.epoch:0,kind:e.kind,reason:e.reason})).slice(-119);
    d.events.push({at,epoch,kind:result.kind==='response'?'response':'pass',reason:result.kind==='response'?'ok':reason});
    if(p&&['automatic','advanced'].includes(p.profile))d.writer={version:VERSION,at,epoch,profile:p.profile,
      connections:[1,2,4,6,8,16,32].includes(p.options?.connections)?p.options.connections:0,
      minChunkKiB:[32,64,128].includes(p.options?.minChunkKiB)?p.options.minChunkKiB:128,
      reason:['baseline','load','network-errors','manual'].includes(p.reason)?p.reason:'baseline',
      count:d.accelerated+d.passed};
    return d;
  }
  function summary(state,at=Date.now()){
    const d=state.diagnostics||{},writer=d.writer,w=root.BiliRangeMeasurements?.analyze(state,at).window;
    const age=time=>Number.isFinite(time)&&time<=at?Math.round((at-time)/1000)+'秒前':'未知';
    const lines=[`Bili Range 自动诊断 ${VERSION}`,`累计接管 ${count(d.accelerated)} 次 / 放行 ${count(d.passed)} 次（包含升级前记录）`];
    if(writer&&/^0\.1\.\d+-experimental$/.test(writer.version||'')&&['automatic','advanced'].includes(writer.profile)){
      lines.push(`最近已标记请求脚本：${writer.version} / ${writer.profile==='automatic'?'自动':'对照工具'} / ${age(writer.at)}`);
      lines.push(`调度：上限${[1,2,4,6,8,16,32].includes(writer.connections)?writer.connections:'未知'}路，${[32,64,128].includes(writer.minChunkKiB)?writer.minChunkKiB:128} KiB下限；${({baseline:'常规',load:'在途负载收缩','network-errors':'近期网络错误收缩',manual:'手动对照'})[writer.reason]||'未知'}`);
      if(writer.count!==count(d.accelerated)+count(d.passed))lines.push('此后存在未标记版本的计数写入；可能有旧脚本或并行写入，版本标记不证明没有插件冲突。');
    }else lines.push('尚未收到带版本标记的新请求；诊断脚本更新不等于下载脚本已经生效。');
    const events=(Array.isArray(d.events)?d.events:[]).filter(e=>e&&e.epoch===(Number(state.epoch)||0)&&Number.isFinite(e.at)&&e.at<=at&&at-e.at<=30000),reasons={};
    for(const e of events)if(e.kind==='pass'&&(Object.prototype.hasOwnProperty.call(names,e.reason)||/^status-\d{3}$/.test(e.reason||'')))reasons[e.reason]=(reasons[e.reason]||0)+1;
    lines.push(`最近30秒事件记录：${events.length}条（最多保留120条）；放行原因：${Object.entries(reasons).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k,v])=>(names[k]||k)+' '+v).join('，')||'暂无'}`);
    if(w?.n){
      lines.push(`完成接管尝试：成功${w.success} / 失败${w.failed}；交付率 ${w.deliveryMbps===null?'未知':w.deliveryMbps.toFixed(2)} Mbps（仅接管流量）`);
      if(w.failed)lines.push('失败类别：'+Object.entries(w.failureReasons).map(([k,v])=>(names[k]||k)+' '+v).join('，'));
      if(w.n<8)lines.push('近期样本不足，不能判断提速或卡顿改善。');
    }else lines.push('最近30秒没有完成的接管尝试，当前速度未知；可能已缓冲、停止播放或主要是直接放行的小请求。');
    const last=d.last||{};
    if(root.BiliRange.isTargetHost(last.host)&&Number.isFinite(last.bytes)&&Number.isFinite(last.elapsedMs))
      lines.push(`最近成功：${last.host}；${Math.round(last.bytes/1024)} KiB / ${last.elapsedMs} ms；实际分片${[1,2,3,4,5,6,7,8,16,32].includes(last.connections)?last.connections:'未知'}；${age(last.finishedAt)}`);
    lines.push('小请求直接放行是正常策略，不等于下载失败。无法读取App实际清晰度、倍速、缓冲和卡顿次数；旧SIDX不能代表当前播放。',
      '反馈方法：保持同视频和清晰度，播放30–60秒后立即运行诊断；注明清晰度、倍速及是首开慢还是播放中卡顿。');
    return lines.join('\n');
  }
  function report(state) {
    const d = state.diagnostics || {}, reasons = Object.entries(d.reasons || {}).map(([k,v]) => `${names[k] || k}: ${v}`);
    return `版本 ${VERSION}\n接管 ${d.accelerated || 0} 次 / 放行 ${d.passed || 0} 次\n` +
      (reasons.join('\n') || '暂无请求') + '\n范围分布：' + JSON.stringify(d.shapes || {}) +
      '\n来源分类：' + JSON.stringify(d.sources || {}) + '\n最近传输：' + JSON.stringify(d.last || {}) +
      '\n并发记录：' + JSON.stringify(d.modes || {}) + '\n提示：不同视频的记录不能直接作为提速倍数。' +
      '\n实体校验拒绝字段：'+JSON.stringify(d.integrityFields||{})+
      '\n重定向拒绝类别：'+JSON.stringify(d.redirectFields||{})+
      '\n重定向拒绝域族：'+JSON.stringify(d.redirectFamilies||{})+'（固定分类，不保存Location；旧记录未知）'+
      (root.BiliRangeMeasurements?'\n\n'+root.BiliRangeMeasurements.report(state):'')+
      (root.BiliRangeMedia?'\n\n'+root.BiliRangeMedia.report(state):'')+
      (root.BiliRangeTrials?.safetyReport(state)?'\n\n'+root.BiliRangeTrials.safetyReport(state):'')+
      '\n最近网络重置：'+JSON.stringify(state.lastNetworkReset||{});
  }
  const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
  function snapshot(state,at=Date.now()){
    const d=state.diagnostics||{},reasons={};
    for(const [key,value] of Object.entries(d.reasons||{}))if(Object.prototype.hasOwnProperty.call(names,key)||/^status-\d{3}$/.test(key))reasons[key]=count(value);
    return {version:VERSION,epoch:count(state.epoch),at,accelerated:count(d.accelerated),passed:count(d.passed),reasons};
  }
  function deltaReport(current,previous){
    if(!previous||previous.version!==VERSION||previous.epoch!==current.epoch||!Number.isFinite(previous.at)||previous.at>=current.at||current.at-previous.at>24*60*60*1000||
      !Number.isSafeInteger(previous.accelerated)||!Number.isSafeInteger(previous.passed)||previous.accelerated<0||previous.passed<0||
      current.accelerated<previous.accelerated||current.passed<previous.passed)return '本次建立手动诊断对照起点；下次显示同版本、同网络轮次的新增计数。';
    const reasons=[];
    for(const [key,value] of Object.entries(current.reasons)){
      const before=count(previous.reasons?.[key]);if(value<before)return '累计计数已重置；本次重新建立手动诊断对照起点。';
      if(value>before)reasons.push((names[key]||key)+': '+(value-before));
    }
    return `自上次手动诊断 ${Math.round((current.at-previous.at)/1000)} 秒：新增接管 ${current.accelerated-previous.accelerated} / 放行 ${current.passed-previous.passed}\n新增原因：${reasons.join('，')||'无'}\n计数差不是测速，也不含播放器卡顿计数。`;
  }
  root.BiliRangeDiagnostics = { VERSION, shape, record, report,summary,snapshot,deltaReport,allowedReasons:Object.keys(names) };
})(globalThis);

/* Loon completion-only adaptive candidate, Apache-2.0, aijc123.
 * BTR inspired: judge gains, back off refusals, rest before another trial.
 * Reuses BiliRangeTrials' ABBA planner, matching and block resampling directly.
 * Does not invent BTR buffer/stall/progress signals or issue extra media GETs. */
(function(root){
  'use strict';
  const C={"version":"0.1.15-experimental","warmSamples":8,"cleanBlocks":5,"maxProbeRequests":20,"sampleTTL":600000,"warmTTL":120000,"blockMaxMs":60000,"probeGapMs":1500,"pauseMs":180000,"gainMargin":1.15,"plateauMargin":1.1,"maxTailRegression":1.05};
  const M=()=>root.BiliRangeMeasurements,T=()=>root.BiliRangeTrials;
  const last=values=>values?.[values.length-1];
  const median=values=>M().quantile(values,0.5);
  const goodTime=(value,at,ttl)=>Number.isFinite(value)&&value<=at&&at-value<ttl;
  function entries(state,at){
    return Object.fromEntries(Object.entries(state.adaptive?.entries||{}).filter(([key,v])=>
      /^\d+\|[a-f0-9]{8}\|[^|]+\|\d+$/.test(key)&&key.startsWith((Number(state.epoch)||0)+'|')&&
      root.BiliRange.isTargetHost(key.split('|')[2])&&v&&goodTime(v.at,at,C.sampleTTL))
      .slice(-8).map(([key,v])=>[key,{at:v.at,choice:[4,8,16,32].includes(v.choice)?v.choice:8,
        baselineMs:Number.isFinite(v.baselineMs)&&v.baselineMs>0?v.baselineMs:0,
        pausedUntil:goodTime(v.pausedUntil-C.pauseMs,at,C.pauseMs)?v.pausedUntil:0}]));
  }
  function scope(state,request,host,bytes,entity){
    const identity=M().identity(state,request,true);
    if(!identity)return null;
    const scheme=root.BiliRange.parseURL(request.url)?.protocol;
    if(!entity)entity=last((Array.isArray(state.measurements?.samples)?state.measurements.samples:[]).filter(x=>x&&x.ok&&x.epoch===(Number(state.epoch)||0)&&x.host===host&&
      x.rangeBytes===bytes&&x.adaptiveScheme===scheme&&x.adaptiveSignature===identity&&/^[a-f0-9]{8}$/.test(x.adaptiveEntity||'')))?.adaptiveEntity||'00000000';
    // Alias only for the existing trial planner's group key; never sent to HTTP.
    const alias={...request,url:'https://'+host+'/upgcxcode/adaptive-'+identity+'-'+scheme+'-'+bytes+'-'+entity+'.m4s'};
    const token=M().identity(state,alias);
    return {key:[Number(state.epoch)||0,token,host,bytes].join('|'),alias,token};
  }
  function samplesFor(state,condition,host,bytes,at){
    return (Array.isArray(state.measurements?.samples)?state.measurements.samples:[]).filter(s=>
      s&&s.epoch===(Number(state.epoch)||0)&&s.content===condition.content&&s.host===host&&s.rangeBytes===bytes&&
      s.adaptiveScheme===condition.scheme&&s.adaptiveSignature===condition.signature&&
      s.inflight===0&&s.requestedALPN==='h1'&&s.minChunkKiB===128&&goodTime(s.at,at,C.sampleTTL)&&
      Number.isFinite(s.from)&&s.from<=s.at&&Number.isFinite(s.elapsedMs)&&s.elapsedMs>0);
  }
  function evidence(samples,token,epoch,mode){
    const prefix=epoch+'|'+token+'|'+mode+'|';
    const scoped=samples.filter(s=>s.trial?.block?.startsWith(prefix));
    // A block stretched over a pause/seek cannot be a local speed comparison.
    const times={};for(const s of scoped)(times[s.trial.block] ||= []).push(s);
    const close=scoped.filter(s=>{
      const group=times[s.trial.block];return Math.max(...group.map(v=>v.at))-Math.min(...group.map(v=>v.from))<=C.blockMaxMs;
    });
    const g=T().analyze(close).groups.find(g=>!g.equivalent);
    if(!g||g.actualA!==g.baseline||g.actualB!==g.candidate||g.cleanBlocks<C.cleanBlocks||g.blocks!==g.cleanBlocks||!g.interval||g.failureA||g.failureB)return {choice:null,g};
    if(g.interval[0]>=C.gainMargin&&g.p90MsB<=g.p90MsA*C.maxTailRegression)return {choice:g.candidate,g};
    if(g.interval[1]<=C.plateauMargin&&g.p90MsA<=g.p90MsB*C.plateauMargin)return {choice:g.baseline,g};
    return {choice:null,g};
  }
  function configure(state,request,policy,at=Date.now()){
    if(policy.profile!=='automatic'||policy.options.enabled===false)return;
    const eligible=root.BiliRange.eligible(request,policy.options,at);
    if(eligible.kind!=='eligible')return;
    const host=root.BiliRange.chooseHost(state,policy.options.hosts,at);
    if(!host)return;
    const bytes=eligible.range.length,condition={content:M().identity(state,request),signature:M().identity(state,request,true),scheme:eligible.u.protocol};
    const allSamples=samplesFor(state,condition,host,bytes,at),epoch=Number(state.epoch)||0;
    const entity=last(allSamples.filter(x=>x.ok&&/^[a-f0-9]{8}$/.test(x.adaptiveEntity||'')))?.adaptiveEntity||'00000000';
    const samples=allSamples.filter(x=>!x.ok||x.adaptiveEntity===entity),s=scope(state,request,host,bytes,entity);
    if(!s)return;
    const ctx={key:s.key,token:s.token,host,bytes,epoch,choice:8,reason:'warmup',baselineMs:0};
    policy.adaptive=ctx;
    const previous=entries(state,at)[s.key];
    const allRecent=(Array.isArray(state.measurements?.samples)?state.measurements.samples:[]).filter(x=>
      x&&x.epoch===epoch&&x.host===host&&goodTime(x.at,at,C.pauseMs));
    // Server pushback is a load signal, not proof a signed object is unavailable.
    if(allRecent.some(x=>!x.ok&&['status-412','status-429'].includes(x.reason))){
      policy.options.connections=4;ctx.choice=4;ctx.reason='pushback';return;
    }
    if(policy.reason!=='baseline'){ctx.reason=policy.reason;ctx.choice=policy.options.connections;return;}
    if(previous?.pausedUntil>at){ctx.reason='rest';ctx.choice=previous.choice;policy.options.connections=previous.choice;return;}
    // Keep cold start unchanged, and don't compare naturally size-capped arms.
    if(bytes<1024*1024){ctx.reason='size-cap';return;}
    const normal=samples.filter(x=>!x.trial&&x.ok&&x.bytes===bytes&&goodTime(x.at,at,C.warmTTL));
    const progressing=samples.filter(x=>x.ok&&x.bytes===bytes&&x.trial?.block?.startsWith(epoch+'|'+s.token+'|')&&goodTime(x.at,at,C.warmTTL));
    if(normal.length<C.warmSamples&&progressing.length<C.maxProbeRequests){ctx.reason='warmup';return;}
    if(samples.some(x=>!x.ok&&goodTime(x.at,at,60000))){ctx.reason='recent-failure';return;}
    let choice=8,stage='4vs8',lastEvidence;
    for(const [mode,minimum] of [['4vs8',1024*1024],['8vs16',2*1024*1024],['16vs32',4*1024*1024]]){
      if(bytes<minimum)break;
      stage=mode;const e=evidence(samples,s.token,epoch,mode);
      if(e.choice===null)break;
      choice=e.choice;lastEvidence=e.g;
      if(choice===e.g.baseline)break;
      stage=null;
    }
    ctx.choice=choice;ctx.reason=lastEvidence?'learned':'baseline';
    ctx.baselineMs=lastEvidence?(choice===lastEvidence.baseline?lastEvidence.p90MsA:lastEvidence.p90MsB):0;
    policy.options.connections=choice;
    // Regression after selection invalidates the preference; no App stalls inferred.
    if(previous?.choice===choice&&previous.baselineMs>0){
      const latest=normal.filter(x=>x.at>previous.at&&x.requestedMode===choice).slice(-4);
      if(latest.length===4&&median(latest.map(x=>x.elapsedMs))>previous.baselineMs*1.5){
        ctx.reason='regression';ctx.choice=8;policy.options.connections=8;return;
      }
    }
    if(!stage||lastEvidence?.baseline===choice)return;
    const early=evidence(samples,s.token,epoch,stage).g;
    if(stage!=='4vs8'&&early?.cleanBlocks>=1&&early.blocks===early.cleanBlocks&&early.ratio<=0.75){
      ctx.reason='probe-loss';return;
    }
    if(samples.some(x=>x.trial&&goodTime(x.at,at,C.probeGapMs))){ctx.reason='probe-spacing';return;}
    // Existing completed requests only, idle admission, bounded exploration.
    if(Object.keys(root.BiliRangeBudget.active(state.leases,at)).length){ctx.reason='busy';return;}
    const groupKey=epoch+'|'+s.token+'|'+stage;
    const group=state.trials?.groups?.[groupKey];
    const counter=group&&goodTime(group.at,at,15*60*1000)?group.counter:0;
    if(Number.isSafeInteger(counter)&&counter>=C.maxProbeRequests){ctx.reason='inconclusive';return;}
    if(!T().permission(state,request,stage,host,at).allowed){ctx.reason='rest';return;}
    policy.options.hosts=[host,...policy.options.hosts.filter(h=>h!==host)];
    policy.trialMode=stage;ctx.mode=stage;ctx.reason='compare';
  }
  function plan(state,request,mode,at=Date.now(),random=Math.random){
    const bytes=root.BiliRange.parseRange(root.BiliRange.headers(request.headers).range)?.length;
    const host=root.BiliRange.chooseHost(state,root.BiliRangeCandidates.pool('upos-sz-mirror08c.bilivideo.com','all'),at);
    const s=host&&scope(state,request,host,bytes);
    return s?T().plan(state,s.alias,mode,at,random):null;
  }
  function observe(state,request,result,context,latest,at=Date.now()){
    state.adaptive={schema:1,entries:entries(latest,at)};
    const ctx=context.policy?.adaptive;
    if(!ctx||Number(state.epoch||0)!==Number(context.epoch||0))return;
    const sample=last(state.measurements?.samples);
    if(sample&&result.metrics&&sample.at===result.metrics.finishedAt){
      sample.adaptiveScheme=root.BiliRange.parseURL(request.url)?.protocol;
      sample.adaptiveSignature=M().identity(state,request,true);
      if(result.kind==='response'){
        const headers=root.BiliRange.headers(result.response.headers);
        const tag=[headers.etag||'',headers['last-modified']||'',headers['content-type']||'',root.BiliRange.contentRange(headers['content-range']).total];
        sample.adaptiveEntity=M().identity(state,{url:'https://'+ctx.host+'/upgcxcode/entity-'+encodeURIComponent(JSON.stringify(tag))});
      }
    }
    const old=state.adaptive.entries[ctx.key];
    if(['regression','pushback','probe-loss'].includes(ctx.reason)){
      state.adaptive.entries[ctx.key]={at,choice:ctx.reason==='probe-loss'?ctx.choice:8,baselineMs:0,pausedUntil:at+C.pauseMs};
    }else if(ctx.reason==='learned'&&(!old||old.choice!==ctx.choice)){
      state.adaptive.entries[ctx.key]={at,choice:ctx.choice,baselineMs:ctx.baselineMs,pausedUntil:0};
    }
    // Reuse the exact-byte/load matcher, additionally reject completed overlaps.
    if(context.trial){
      const r=result.metrics,others=latest.measurements?.samples||[];
      const overlap=Object.keys(root.BiliRangeBudget.active(latest.leases,at)).length>1||r&&others.some(x=>x&&x.epoch===ctx.epoch&&
        !(x.trial?.block===context.trial.block&&x.trial?.slot===context.trial.slot)&&
        x.at>r.startedAt&&x.from<r.finishedAt);
      if(overlap&&state.measurements?.samples?.length){
        const sample=last(state.measurements.samples);
        if(sample.trial?.block===context.trial.block){sample.inflight=1;}
      }
    }
    state.adaptive.entries=Object.fromEntries(Object.entries(state.adaptive.entries).slice(-8));
    const reasons=['warmup','size-cap','baseline','learned','pushback','rest','load','network-errors','recent-failure','regression','busy','inconclusive','compare','probe-loss','probe-spacing'];
    state.adaptive.last={at,epoch:ctx.epoch,choice:[4,8,16,32].includes(ctx.choice)?ctx.choice:8,
      reason:reasons.includes(ctx.reason)?ctx.reason:'baseline',mode:['4vs8','8vs16','16vs32'].includes(ctx.mode)?ctx.mode:null};
  }
  function report(state,at=Date.now()){
    const last=state.adaptive?.last;
    if(!last||last.epoch!==(Number(state.epoch)||0)||!goodTime(last.at,at,120000))return '并发调优：暂无当前网络的新结果；冷启动保持原8路策略。';
    const labels={warmup:'积累普通请求', 'size-cap':'请求较小，不试高并发',baseline:'原8路策略',learned:'同条件观察选择',pushback:'服务端拒绝负载，暂用4路',
      rest:'调优冷却',load:'负载收缩','network-errors':'网络错误收缩','recent-failure':'近期失败，暂停比较',regression:'变慢后恢复8路',busy:'在途负载，不比较',
      inconclusive:'比较预算用完，证据不足，保留原策略',compare:'原有请求交替比较','probe-loss':'比较明显变慢，恢复已有策略并冷却','probe-spacing':'比较间隔，使用已有策略'};
    return `并发调优：${labels[last.reason]||'未知'}；偏好${[4,8,16,32].includes(last.choice)?last.choice:'未知'}路${last.mode?' / '+last.mode:''}。观察收益不是卡顿或因果提速证明。`;
  }
  function safeConfigure(state,request,policy,...args){
    const original={...policy,options:{...policy.options,hosts:policy.options.hosts?.slice()}};
    try{configure(state,request,policy,...args);}catch{Object.assign(policy,original);delete policy.adaptive;}
  }
  root.BiliRangeAdaptive={configure:safeConfigure,plan,observe,report,evidence,scope,config:C};
  const diag=root.BiliRangeDiagnostics;
  if(diag)for(const name of ['summary','report']){const original=diag[name];diag[name]=(state,...args)=>original(state,...args)+'\n'+report(state,...args);}
})(globalThis);

globalThis.BiliRangeProfile="automatic";
/* Standalone manual entry: never inspects $request or starts media downloads. */
(function () {
  'use strict';
  let state = {}, readError = false;
  try {
    const raw = $persistentStore.read('aijc123.BiliRange.adaptive.v1');
    state = JSON.parse(raw || '{}');
    if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
  } catch { readError = true; }
  let summary;
  try { summary = globalThis.BiliRangeProfile==='automatic'?globalThis.BiliRangeDiagnostics.summary(state):globalThis.BiliRangeDiagnostics.report(state); }
  catch { summary = '诊断统计格式异常，请将此提示发回聊天。'; }
  if (readError) summary += '\n本次无法读取本地统计，请将此提示发回聊天。';
  if(!readError){
    const key='aijc123.BiliRange.adaptive.v1.diagnoseBaseline';let previous;
    try{previous=JSON.parse($persistentStore.read(key)||'null');}catch{}
    const current=globalThis.BiliRangeDiagnostics.snapshot(state);
    summary+='\n\n'+globalThis.BiliRangeDiagnostics.deltaReport(current,previous);
    try{if($persistentStore.write(JSON.stringify(current),key)===false)summary+='\n本次对照起点保存失败；下次可能仍使用旧起点。';}catch{summary+='\n本次对照起点保存失败；下次可能仍使用旧起点。';}
  }
  console.log(summary);
  if (typeof $notification !== 'undefined' && typeof $notification.post === 'function') {
    try { $notification.post('Bili Range 诊断', '点通知复制，或分享当前日志截图', summary, { clipboard: summary }); } catch {}
  }
  $done({ title: 'Bili Range 诊断', content: summary });
})();
