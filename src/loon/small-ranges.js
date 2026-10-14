/* Candidate-only sizing and endpoint identities. Reuses BTR's unchanged splitter.
 * The completion-only controller still compares ordinary traffic, not replays. */
(function(root){
 'use strict';
 const modes=['1vs2','2vs3','2vs4','3vs5','3vs6','4vs7','4vs8','8vs16','16vs32'];
 const choices=[1,2,3,4,5,6,7,8,16,32];
 function baseline(bytes){return bytes<1024*1024?Math.min(8,Math.floor(bytes/(128*1024))):8;}
 function ladder(bytes){
  if(!Number.isSafeInteger(bytes)||bytes<256*1024||bytes>4*1024*1024)return [];
  if(bytes<1024*1024){const high=baseline(bytes);return [[Math.ceil(high/2)+'vs'+high,256*1024]];}
  return [['4vs8',1024*1024],['8vs16',2*1024*1024],['16vs32',4*1024*1024]];
 }
 function signature(state,request){
  const u=root.BiliRange.parseURL(request?.url);if(!u)return null;
  // Authority (including an explicit port) changes the transport endpoint. The
  // temporary alias is hashed locally and never issued as a network request.
  return root.BiliRangeMeasurements.identity(state,{url:'https://'+u.host+'/upgcxcode/endpoint-'+
   encodeURIComponent(u.authority.toLowerCase())+u.path+u.query},true);
 }
 root.BiliRangeSmall={baseline,ladder,signature,modes,choices};
})(globalThis);
