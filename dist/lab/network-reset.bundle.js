/* Observable, isolated network epoch reset. No media downloads or notifications. */
(function () {
  'use strict';
  const KEY='aijc123.BiliRange.lab.v1';
  let state={};
  try{state=JSON.parse($persistentStore.read(KEY)||'{}');}catch{}
  if(!state||typeof state!=='object'||Array.isArray(state))state={};
  const count=Object.keys(state.hosts||{}).length,epoch=Number(state.epoch)||0;
  state.hosts={};state.epoch=epoch+1;state.lastNetworkReset={at:Date.now(),clearedHosts:count,epoch:state.epoch};
  // Keep in-flight leases so a network reset cannot silently double the socket budget.
  const saved=$persistentStore.write(JSON.stringify(state),KEY);
  const message=saved===false?'Bili Range 网络变化未完成：本地写入失败\n未保存新的网络轮次或清除评分，请重试。':
    `Bili Range 网络变化处理完成\n网络epoch ${epoch} → ${state.epoch}\n清除 CDN 评分 ${count} 项\n在途租约保留，旧请求不会复活旧评分\n写入：已提交`;
  console.log(message);$done({title:'Bili Range 网络变化',content:message});
})();
