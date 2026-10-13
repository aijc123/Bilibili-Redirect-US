/* Observe complete SIDX boxes already present in successful buffered responses.
 * Uses pinned BTR parser. No extra GET, response hook, or media URL persistence. */
(function(root){
  'use strict';
  function observe(state,request,result,context={}){
    try{
      if(result.kind!=='response'||!root.__BILI_SIDX__)return;
      const range=root.BiliRange.parseRange(root.BiliRange.headers(request.headers).range),body=result.response?.body;
      if(!range||range.start>65536||!(body instanceof Uint8Array))return;
      const sidx=root.__BILI_SIDX__.parseSidx(body.subarray(0,65536),range.start);
      if(!sidx||sidx.segments.length>2048)return;
      const segments=sidx.segments;
      if(segments.some(s=>!Number.isSafeInteger(s.length)||s.length<=0||!Number.isFinite(s.durationSeconds)||s.durationSeconds<=0))return;
      const bytes=segments.reduce((n,s)=>n+s.length,0),duration=segments.reduce((n,s)=>n+s.durationSeconds,0);
      const rates=segments.map(s=>s.length*8/s.durationSeconds/1e6),average=bytes*8/duration/1e6;
      if(!Number.isFinite(average)||average<=0||average>1000)return;
      const at=Number(result.metrics?.finishedAt)||Date.now(),content=root.BiliRangeMeasurements.identity(state,request);
      const type=root.BiliRange.headers(result.response.headers)['content-type']||'';
      const item={at,epoch:Number(context.epoch)||0,content,averageMbps:average,
        p90SegmentMbps:root.BiliRangeMeasurements.quantile(rates,0.9),maxSegmentMbps:Math.max(...rates),
        segments:segments.length,durationSeconds:duration,type:/^video\//i.test(type)?'video':/^audio\//i.test(type)?'audio':'unknown'};
      state.mediaInfos=(Array.isArray(state.mediaInfos)?state.mediaInfos:[]).filter(v=>v.content!==content&&at-v.at<15*60*1000).slice(-3);
      state.mediaInfos.push(item);
    }catch{} // Metadata observation must never cause a valid media response to fall back.
  }
  function report(state,at=Date.now()){
    const infos=(Array.isArray(state.mediaInfos)?state.mediaInfos:[]).filter(v=>v&&v.epoch===(Number(state.epoch)||0)&&at-v.at<15*60*1000&&
      /^[0-9a-f]{8}$/.test(v.content||'')&&['video','audio','unknown'].includes(v.type)&&
      [v.averageMbps,v.p90SegmentMbps,v.maxSegmentMbps,v.durationSeconds].every(n=>Number.isFinite(n)&&n>0)).slice(-4);
    if(!infos.length)return '码率需求：未知；合格既有响应尚未包含完整SIDX。小范围初始化通常放行，不额外取索引。';
    const speed=[1,1.25,1.5,2].includes(Number(state.playbackRate))?Number(state.playbackRate):1.5;
    return [`SIDX已见表示；诊断假设倍速 ${speed}（没有读取或改变 App 实际倍速）：`,
      ...infos.map(v=>`${v.content} / ${v.type}: 均值 ${v.averageMbps.toFixed(2)} Mbps，段p90 ${v.p90SegmentMbps.toFixed(2)} Mbps，均值×倍速 ${(v.averageMbps*speed).toFixed(2)} Mbps，索引段 ${v.segments}`),
      '仅已见表示的索引估计；当前表示未知，不含其他音视频表示、传输开销或缓冲余量，不能保证不卡顿。'].join('\n');
  }
  root.BiliRangeMedia={observe,report};
})(globalThis);
