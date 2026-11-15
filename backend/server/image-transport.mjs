import https from 'node:https';
import {Readable} from 'node:stream';
// Dedicated official-provider transport. One request, IPv4, no automatic retry.
export const imageConnectionOptions=Object.freeze({connectTimeout:45000,headersTimeout:240000,bodyTimeout:240000,family:4});
const agent=new https.Agent({keepAlive:true,maxSockets:4,maxFreeSockets:2,family:4});
export function imageProviderFetch(url,init={}){
 return new Promise((resolve,reject)=>{
  const target=new URL(url);if(target.protocol!=='https:'){reject(Error('HTTPS required'));return;}
  let connectTimer,headerTimer;
  const headers=new Headers(init.headers);if(init.body!==undefined&&!headers.has('content-length'))headers.set('content-length',String(Buffer.byteLength(init.body)));
  const failure=code=>Object.assign(new Error('Image provider connection failed'),{code});
  const req=https.request(target,{method:init.method||'GET',headers:Object.fromEntries(headers),agent,family:4,signal:init.signal},res=>{
   clearTimeout(connectTimer);clearTimeout(headerTimer);
   const headers=new Headers();for(const [key,value] of Object.entries(res.headers))if(value!==undefined)for(const item of Array.isArray(value)?value:[value])headers.append(key,String(item));
   // Preserve aborts and streaming size checks in the existing download handler.
   resolve(new Response(Readable.toWeb(res),{status:res.statusCode,headers}));
  });
  req.on('socket',socket=>{if(!socket.connecting)return;connectTimer=setTimeout(()=>req.destroy(failure('UND_ERR_CONNECT_TIMEOUT')),imageConnectionOptions.connectTimeout);socket.once('secureConnect',()=>clearTimeout(connectTimer));});
  headerTimer=setTimeout(()=>req.destroy(failure('UND_ERR_HEADERS_TIMEOUT')),imageConnectionOptions.headersTimeout);
  req.setTimeout(imageConnectionOptions.bodyTimeout,()=>req.destroy(failure('UND_ERR_BODY_TIMEOUT')));
  req.on('error',error=>{clearTimeout(connectTimer);clearTimeout(headerTimer);reject(error);});
  if(init.body!==undefined)req.write(init.body);req.end();
 });
}
