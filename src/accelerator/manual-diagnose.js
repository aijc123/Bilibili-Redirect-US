/* Standalone manual entry: never inspects $request or starts media downloads. */
(function () {
  'use strict';
  let state = {}, readError = false;
  try {
    const raw = $persistentStore.read('aijc123.BiliRange.v1');
    state = JSON.parse(raw || '{}');
    if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
  } catch { readError = true; }
  let summary;
  try { summary = globalThis.BiliRangeDiagnostics.report(state); }
  catch { summary = '诊断统计格式异常，请将此提示发回聊天。'; }
  if (readError) summary += '\n本次无法读取本地统计，请将此提示发回聊天。';
  console.log(summary);
  if (typeof $notification !== 'undefined' && typeof $notification.post === 'function') {
    try { $notification.post('Bili Range 诊断', '点通知复制，或分享当前日志截图', summary, { clipboard: summary }); } catch {}
  }
  $done({ title: 'Bili Range 诊断', content: summary });
})();
