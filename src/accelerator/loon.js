/* Loon adapter. Stores aggregates only; never stores or uploads media URLs. */
(function () {
  'use strict';
  const KEY = 'aijc123.BiliRange.v1', core = globalThis.BiliRange;
  let state;
  try { state = JSON.parse($persistentStore.read(KEY) || '{}'); } catch { state = {}; }
  let arg = typeof $argument === 'object' && $argument ? $argument : {};
  if (typeof $argument === 'string') { try { arg = JSON.parse($argument); } catch { if ($argument === 'Action=reset') arg = { Action: 'reset' }; } }
  const epoch = state.epoch || 0;
  const save = () => $persistentStore.write(JSON.stringify(state), KEY);
  if (typeof $request === 'undefined') {
    if (arg.Action === 'reset') { state.hosts = {}; state.epoch = epoch + 1; save(); $done({}); return; }
    const d = state.diagnostics || {};
    const scores = Object.entries(state.hosts || {}).map(([h, v]) => `${h}: ${(Number(v.bps || 0) * 8 / 1e6).toFixed(1)} Mbps`);
    $done({ title: 'Bili Range 实验版', content: `接管 ${d.accelerated || 0} 次 / 放行 ${d.passed || 0} 次\n` +
      JSON.stringify(d.reasons || {}) + '\n最近传输：' + JSON.stringify(d.last || {}) + '\n' + scores.join('\n') }); return;
  }
  let finished = false;
  const done = result => { if (!finished) { finished = true; $done(result); } };
  const fetchRange = options => new Promise((resolve, reject) => {
    $httpClient.get({ url: options.url, headers: options.headers, timeout: options.timeout,
      'binary-mode': true, 'auto-redirect': false, 'auto-cookie': false, insecure: false, alpn: 'h1' },
    (error, response, data) => error || !response ? reject(new Error('transport')) : resolve({ status: response.status, headers: response.headers, body: data }));
  });
  const options = { enabled: arg.Enabled !== false, auto: arg.AutoCDN !== false,
    connections: Number(arg.Connections) || 2, maxBytes: (Number(arg.MaxMiB) || 4) * 1024 * 1024,
    timeout: 2500, hosts: arg.PreferredCDN ? [arg.PreferredCDN, ...core.DEFAULT_HOSTS.filter(h => h !== arg.PreferredCDN)] : core.DEFAULT_HOSTS };
  const parsed = core.parseRange(core.headers($request.headers).range);
  const leases = Object.fromEntries(Object.entries(state.leases || {}).filter(([,expiry]) => expiry > Date.now()));
  let lease;
  if (options.enabled && core.parseURL($request.url) && parsed && parsed.length >= 256 * 1024 && parsed.length <= options.maxBytes && !core.headers($request.headers)[core.INTERNAL]) {
    // Best-effort cross-context budget. Storage exposes no atomic compare-and-swap.
    if (Object.keys(leases).length >= 2) {
      const d = state.diagnostics ||= { accelerated: 0, passed: 0, reasons: {} };
      d.passed++; d.reasons['busy'] = (d.reasons['busy'] || 0) + 1;
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
    const d = latest.diagnostics || { accelerated: 0, passed: 0, reasons: {} };
    if (result.kind === 'response') { d.accelerated++; d.last = result.metrics; }
    else { d.passed++; d.reasons[result.reason] = (d.reasons[result.reason] || 0) + 1; }
    state.diagnostics = d;
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
