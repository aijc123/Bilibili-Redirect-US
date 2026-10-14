/* Apache-2.0, aijc123. API names from Loon's official Custom-node example.
 * Public-page capability experiment only. No proxy handshake, no outer TLS,
 * no media hosts and no session logging. Inner HTTPS remains the client's job. */
function tunnelDidConnected(){
 const allowed=['www.example.com','wrong.host.badssl.com'];
 if(!$session||$session.proxy?.isTLS!==false||Number($session.conPort)!==443||
   !allowed.includes(String($session.conHost).toLowerCase()))return false;
 $tunnel.established($session);return true;
}
function tunnelTLSFinished(){return true;}
function tunnelDidRead(data){return data;}
function tunnelDidWrite(){return true;}
function tunnelDidClose(){return true;}
