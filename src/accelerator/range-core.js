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
      if (settled.some(r => !r.ok)) throw new Error('transport');
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
      stats[target] = { at: now(), bps: old?.bps ? old.bps * 0.3 + bps * 0.7 : bps, blockedUntil: 0 };
      const first = headers(results[0].headers);
      const responseHeaders = { 'Content-Type': type || 'application/octet-stream',
        'Content-Range': `bytes ${range.start}-${range.end}/${total}`, 'Content-Length': String(body.byteLength),
        'Accept-Ranges': 'bytes', 'Cache-Control': first['cache-control'] || 'no-store' };
      if (etag) responseHeaders.ETag = etag;
      if (modified) responseHeaders['Last-Modified'] = modified;
      return { kind: 'response', response: { status: 206, headers: responseHeaders, body },
        metrics: { host: target, bytes: range.length, elapsedMs: elapsed, connections: parts.length, bps } };
    } catch (error) {
      (state.hosts ||= {})[target] = { ...(state.hosts?.[target] || {}), at: now(), blockedUntil: now() + 60000 };
      return { kind: 'pass', reason: error.message || 'failed', metrics: { host: target, elapsedMs: now() - at } };
    }
  }
  root.BiliRange = { accelerate, headers, parseRange, parseURL, contentRange, split, chooseHost, DEFAULT_HOSTS, INTERNAL };
})(globalThis);
