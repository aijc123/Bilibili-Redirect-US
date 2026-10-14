/* Manual only. Never logs the local signed media sample or raw network errors. */
(function(){
  'use strict';
  const finish=summary=>{
    console.log(summary);
    if(typeof $notification!=='undefined'&&typeof $notification.post==='function')try{$notification.post('Bili 媒体测速','点通知复制摘要',summary,{clipboard:summary});}catch{}
    $done({title:'Bili 媒体测速',content:summary});
  };
  globalThis.BiliRangeMediaBenchmark.manual($persistentStore,$httpClient).then(finish)
    .catch(()=>finish('Bili 媒体测速失败；未更改DNS或播放配置。请重新运行准备采样。'));
})();
