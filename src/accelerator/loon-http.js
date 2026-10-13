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
