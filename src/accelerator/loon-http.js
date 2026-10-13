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
            'binary-mode': true, 'auto-redirect': false, 'auto-cookie': false, insecure: false, alpn: options.alpn==='h2'?'h2':'h1' },
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
