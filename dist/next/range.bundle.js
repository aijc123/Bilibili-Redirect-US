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
  async function accelerate({ request, options = {}, fetchRange, state = {}, now = Date.now }) {
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
    const at = now();
    const deadline = /(?:[?&])deadline=(\d+)(?:&|$)/.exec(u.query);
    if (deadline && Number(deadline[1]) * 1000 < at + 15000) return skip('expired-or-expiring');
    const pool = (options.hosts || DEFAULT_HOSTS).filter(host => /^upos-sz-mirror[a-z0-9-]+\.bilivideo\.com$/.test(host)).slice(0, 8);
    const target = options.auto === false ? pool[0] : chooseHost(state, pool, at);
    if (!target) return skip('cooldown');
    const count = [1, 2, 4].includes(Number(options.connections)) ? Number(options.connections) : 2;
    const parts = split(range, Math.min(count, Math.floor(range.length / (128 * 1024))));
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
      const elapsed = Math.max(1, now() - at), bps = range.length * 1000 / elapsed;
      const stats = (state.hosts ||= {}), old = stats[target];
      stats[target] = { at: now(), bps: old?.bps ? old.bps * 0.3 + bps * 0.7 : bps, blockedUntil: 0, failures: 0 };
      const first = headers(results[0].headers);
      const responseHeaders = { 'Content-Type': type || 'application/octet-stream',
        'Content-Range': `bytes ${range.start}-${range.end}/${total}`, 'Content-Length': String(body.byteLength),
        'Accept-Ranges': 'bytes', 'Cache-Control': first['cache-control'] || 'no-store' };
      if (etag) responseHeaders.ETag = etag;
      if (modified) responseHeaders['Last-Modified'] = modified;
      return { kind: 'response', response: { status: 206, headers: responseHeaders, body },
        metrics: { host: target, bytes: range.length, elapsedMs: elapsed, connections: parts.length, bps,
          redirects: results.reduce((n, r) => n + (r.redirects || 0), 0) } };
    } catch (error) {
      const old = state.hosts?.[target] || {}, failures = Math.min(5, (old.failures || 0) + 1);
      const reason = error.message || 'failed';
      // One refused signed address is not proof the whole host is down. Keep a short
      // retry delay for content/status failures; back off transient network failures.
      const integrity = ['entity-mismatch','range-mismatch','length-mismatch','encoded-body','content-range','content-length','non-media'].includes(reason);
      const statusFailure = /^status-/.test(reason) || reason.startsWith('redirect-');
      const cooldownMs = integrity ? 60000 : statusFailure ? 1500 : Math.min(10000, 1500 * 2 ** (failures - 1));
      (state.hosts ||= {})[target] = { ...old, failures, at: now(), blockedUntil: now() + cooldownMs, lastError: reason };
      return { kind: 'pass', reason, metrics: { host: target, elapsedMs: now() - at, cooldownMs } };
    }
  }
  root.BiliRange = { accelerate, headers, parseRange, parseURL, contentRange, split, chooseHost, DEFAULT_HOSTS, INTERNAL };
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
        if (![301, 302, 303, 307, 308].includes(result.status)) return { ...result, redirects };
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

/* Aggregate request shapes only. No path, query, range offset, token or cookie values. */
(function (root) {
  'use strict';
  const VERSION = '0.1.4-experimental';
  const names = {
    internal: '内部请求', 'not-media-get': '暂不支持的媒体请求',
    'conditional-or-auth': '带条件或认证请求头', disabled: '实验下载已关闭',
    'unbounded-or-multiple-range': '开放或多段范围', 'no-range': '没有 Range',
    'small-range': '范围小于 256 KiB', 'large-range': '范围超过上限',
    'expired-or-expiring': '签名过期或即将过期', cooldown: '候选暂时冷却',
    busy: '已达到接管预算', transport: '子请求网络错误', 'entity-mismatch': '分块实体不一致',
    'redirect-untrusted': '重定向目标未通过校验', 'redirect-limit': '重定向循环或超过上限',
    'range-mismatch': '返回范围不符', 'length-mismatch': '返回长度不符',
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
      '\n并发记录：' + JSON.stringify(d.modes || {}) + '\n提示：不同视频的记录不能直接作为提速倍数。';
  }
  root.BiliRangeDiagnostics = { VERSION, shape, record, report };
})(globalThis);

/* Loon adapter. Stores aggregates only; never stores or uploads media URLs. */
(function () {
  'use strict';
  const KEY = 'aijc123.BiliRange.next.v1', core = globalThis.BiliRange, diagnostics = globalThis.BiliRangeDiagnostics;
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
    connections: Number(arg.Connections) || 2, maxBytes: (Number(arg.MaxMiB) || 4) * 1024 * 1024,
    timeout: 2500, hosts: arg.PreferredCDN ? [arg.PreferredCDN, ...core.DEFAULT_HOSTS.filter(h => h !== arg.PreferredCDN)] : core.DEFAULT_HOSTS };
  const parsed = core.parseRange(core.headers($request.headers).range);
  const leases = Object.fromEntries(Object.entries(state.leases || {}).filter(([,expiry]) => expiry > Date.now()));
  let lease;
  if (options.enabled && core.parseURL($request.url) && parsed && parsed.length >= 256 * 1024 && parsed.length <= options.maxBytes && !core.headers($request.headers)[core.INTERNAL]) {
    // Best-effort cross-context budget. Storage exposes no atomic compare-and-swap.
    if (Object.keys(leases).length >= 2) {
      state.diagnostics = diagnostics.record(state.diagnostics, $request, {kind:'pass',reason:'busy'});
      save(); done({}); return;
    }
    lease = Date.now().toString(36) + Math.random().toString(36).slice(2);
    leases[lease] = Date.now() + 8000; state.leases = leases; save();
  }
  core.accelerate({ request: $request, options, fetchRange, state }).then(result => {
    if (result.reason === 'internal') { done({}); return; }
    // Merge aggregate counters with the latest storage; separate script contexts may finish together.
    let latest;
    try { latest = JSON.parse($persistentStore.read(KEY) || '{}'); } catch { latest = {}; }
    if (!latest || typeof latest !== 'object' || Array.isArray(latest)) latest = {};
    state.diagnostics = diagnostics.record(latest.diagnostics, $request, result);
    state.epoch = latest.epoch || 0;
    state.leases = latest.leases || {};
    if (lease) delete state.leases[lease];
    if (result.metrics?.host && state.epoch === epoch) state.hosts = { ...(latest.hosts || {}), [result.metrics.host]: state.hosts[result.metrics.host] };
    else state.hosts = latest.hosts || {};
    save();
    if (arg.Debug === true) console.log(JSON.stringify({ kind: result.kind, reason: result.reason, metrics: result.metrics }));
    done(result.kind === 'response' ? { response: result.response } : {});
  }).catch(() => done({}));
})();
