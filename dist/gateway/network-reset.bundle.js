/* Only clear local health evidence; never send credentials on a network change. */
(function(){
 let applied=false;
 try{applied=$persistentStore.write('', 'aijc123.BiliGateway.health.v1')!==false;}catch{}
 const text=applied?'Bili 电脑中转：已清除网络变化前的健康缓存，下次请求重新检查。':'Bili 电脑中转：健康缓存清除失败，请关闭中转后检查。';
 console.log(text);$done({title:'Bili 电脑中转网络变化',content:text});
})();
