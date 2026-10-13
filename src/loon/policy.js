/* Automatic Loon policy, Apache-2.0, aijc123. Reuses BTR range splitting;
 * conservative size/load/error scheduling, not BTR's streaming controller. */
(function(root){
  'use strict';
  function resolve(state,request,arg={},profile='automatic',at=Date.now()){
    if(profile==='advanced')return {profile,reason:'manual',globalJobs:Number(arg.GlobalJobs)||16,
      trialMode:arg.TrialMode,debug:arg.Debug===true,playbackRate:[1,1.25,1.5,2].includes(Number(arg.PlaybackRate))?Number(arg.PlaybackRate):1.5,
      options:{enabled:arg.Enabled!==false,auto:arg.AutoCDN!==false,alpn:arg.HTTPProtocol==='h2'?'h2':'h1',
        minChunkKiB:[32,64,128].includes(Number(arg.MinChunkKiB))?Number(arg.MinChunkKiB):128,
        connections:[1,2,4,6,8,16,32].includes(Number(arg.Connections))?Number(arg.Connections):4,
        maxBytes:Math.min(8,Number(arg.MaxMiB)||4)*1024*1024,timeout:2500,
        hosts:root.BiliRangeCandidates.pool(arg.PreferredCDN,arg.CDNGroup)}};
    const hosts=root.BiliRangeCandidates.pool('upos-sz-mirror08c.bilivideo.com','all');
    const selected=root.BiliRange.chooseHost(state,hosts,at),leases=root.BiliRangeBudget.active(state.leases,at);
    const recent=(Array.isArray(state.measurements?.samples)?state.measurements.samples:[]).filter(s=>
      s&&s.epoch===(Number(state.epoch)||0)&&s.host===selected&&Number.isFinite(s.at)&&s.at<=at&&at-s.at<60000);
    const networkErrors=recent.filter(s=>s.ok===false&&s.reason==='transport').length;
    const pressure=Object.keys(leases).length>=2,network=recent.length>=4&&networkErrors/recent.length>=0.25;
    return {profile:'automatic',reason:pressure?'load':network?'network-errors':'baseline',globalJobs:32,trialMode:'off',debug:false,playbackRate:1,
      options:{enabled:arg.Enabled!==false,auto:true,alpn:'h1',minChunkKiB:128,connections:pressure||network?4:8,
        maxBytes:4*1024*1024,timeout:2500,hosts}};
  }
  root.BiliRangePolicy={resolve};
})(globalThis);
