import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {createLocalService,localRequestAllowed} from './local/service.mjs';
import {createLocalAdminServer} from './local/admin.mjs';

process.env.LOCAL_STORAGE_MODE='true';
export function createApiServer({allowedOrigins=(process.env.FRONTEND_ORIGINS||'http://127.0.0.1:4173,http://localhost:4173').split(',').map(x=>x.trim()).filter(Boolean)}={}){
 const local=createLocalService({directory:process.env.LOCAL_DATA_DIR||path.resolve(process.cwd(),'../local-data')});
 const isLoopbackOrigin=(value:string)=>{try{const url=new URL(value);return url.protocol==='http:'&&['127.0.0.1','localhost','[::1]','::1'].includes(url.hostname)}catch{return false}};
 const server=createServer(async(req:IncomingMessage,res:ServerResponse)=>{
  if(local&&!localRequestAllowed(req)){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'单机工作台只允许本机访问。'}));return;}
  const origin=req.headers.origin;
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  // AS Runtime 用随机回环端口托管应用，Origin 不是固定的 4173；单机模式只放行回环 http 来源，
  // 公网来源仍需显式列入 FRONTEND_ORIGINS。请求仍受 localRequestAllowed 与 Bearer token 双重约束。
  if(origin&&!allowedOrigins.includes(origin)&&!isLoopbackOrigin(origin)){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'来源站点未获允许。'}));return;}
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Expose-Headers','Content-Disposition');}
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,Idempotency-Key,X-Upload-Token','Access-Control-Max-Age':'600'});res.end();return;}
  try{
   if(!req.url?.startsWith('/'))throw Object.assign(Error('请求地址无效。'),{status:400});
   const chunks:Buffer[]=[];let size=0;
   for await(const chunk of req){size+=chunk.length;chunks.push(Buffer.from(chunk));}
   const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
   const url=new URL(req.url,process.env.BACKEND_PUBLIC_URL||'http://127.0.0.1:4191');
   const input=new Request(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method||'GET')?{body:Buffer.concat(chunks)}:{})});
   const result=await local.handle(input);
   result.headers.forEach((value:string,key:string)=>{if(!['access-control-allow-origin','vary'].includes(key.toLowerCase()))res.setHeader(key,value);});res.statusCode=result.status;

   if(!result.body){res.end();return;}
   Readable.fromWeb(result.body as any).on('error',()=>res.destroy()).pipe(res);
  }catch(error){const e=error as Error&{status?:number};if(!res.headersSent){res.writeHead(e.status||502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.status?e.message:'服务暂不可用，请稍后重试。'}));}else res.destroy();}
 });
 server.once('close',()=>local?.close());return Object.assign(server,{localService:local});
}
export function start(){
 const port=Number(process.env.PORT||4191),host=process.env.HOST||'127.0.0.1';if(!['127.0.0.1','localhost','::1'].includes(host))throw Error('单机模式只能绑定回环地址。');const server=createApiServer();
 server.requestTimeout=0;server.headersTimeout=10000;
 const admin=server.localService?createLocalAdminServer(server.localService):null;
 if(admin){admin.listen(4193,'127.0.0.1',()=>console.log('本机管理中心：http://127.0.0.1:4193'));server.once('close',()=>admin.close());}
 server.listen(port,host,()=>console.log(`独立后端：http://${host}:${port}`));
 const stop=()=>{server.close();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)start();
