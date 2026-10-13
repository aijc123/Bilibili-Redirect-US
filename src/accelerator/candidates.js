/* aijc123 Loon candidate adapter. Regional host facts from BTR cdn-resolver.js;
 * BTR's streaming races/cancellation are not emulated by this callback runtime. */
(function(root){
  'use strict';
  const inventory=__BILI_CDN_INVENTORY__;
  const groups=Object.freeze(Object.fromEntries(Object.entries({...inventory.groups,all:inventory.hosts})
    .map(([key,hosts])=>[key,Object.freeze(hosts.slice())])));
  function pool(preferred,group='baseline'){
    const selected=root.BiliRange.isTargetHost(preferred)?preferred:'upos-sz-mirror08c.bilivideo.com';
    const hosts=Object.prototype.hasOwnProperty.call(groups,group)?groups[group]:groups.baseline;
    return [selected,...hosts.filter(host=>host!==selected)].slice(0,16);
  }
  root.BiliRangeCandidates={pool,groups};
})(globalThis);
