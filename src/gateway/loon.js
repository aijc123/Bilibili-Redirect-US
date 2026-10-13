(function(){
 const arg=typeof $argument==='object'&&$argument?$argument:{};
 globalThis.BiliGateway.rewrite({request:$request,arg,client:$httpClient,store:$persistentStore}).then(result=>$done(result)).catch(()=>$done({}));
})();
