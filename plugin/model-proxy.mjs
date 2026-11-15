#!/usr/bin/env node
// 企业内部中枢 · 材质插件内置模型代理。
//
// 作用：把中枢已经配置好的模型，以本机回环的 OpenAI 兼容端点暴露给材质工作台。
// 材质应用只知道「127.0.0.1:<port>/v1 + 一次性令牌」，中枢的真实密钥始终留在这个进程里，
// 既不会写进材质应用的数据库，也不会出现在它的界面上。
//
// 用法：
//   node model-proxy.mjs --config <proxy.json> [--descriptor <hub-models.json>]
//
// proxy.json：
// {
//   "listen": { "host": "127.0.0.1", "port": 4198 },
//   "token": "<调用方令牌>",
//   "upstream": { "baseURL": "https://dashscope.aliyuncs.com/compatible-mode/v1", "apiKey": "<中枢密钥>" },
//   "models": [ { "id": "qwen3.8-max", "kind": "recognition", "display": "企业内部中枢 · 企业模型" } ]
// }
//
// 只实现材质应用真正会用的两个面：GET /v1/models 与 POST /v1/chat/completions。
// 其他路径一律 404，避免被当成通用网关使用。
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {timingSafeEqual} from 'node:crypto';

const args=process.argv.slice(2);
const value=flag=>{const i=args.indexOf(flag);return i>=0?args[i+1]:undefined;};
const configPath=value('--config'),descriptorPath=value('--descriptor');
if(!configPath)throw Error('缺少 --config');

const config=JSON.parse(readFileSync(configPath,'utf8'));
const host=config.listen?.host||'127.0.0.1';
if(!['127.0.0.1','::1'].includes(host))throw Error('模型代理只能监听本机回环地址。');
const port=Number(config.listen?.port||4198);
const token=String(config.token||'');
if(token.length<16)throw Error('调用方令牌过短。');
const upstream=new URL(String(config.upstream?.baseURL||''));
if(!['https:','http:'].includes(upstream.protocol))throw Error('中枢上游接口地址无效。');
const apiKey=String(config.upstream?.apiKey||'');
if(!apiKey)throw Error('缺少中枢上游密钥。');
const models=Array.isArray(config.models)?config.models.map(m=>({id:String(m.id||'').trim(),kind:String(m.kind||''),display:String(m.display||m.id)})):[];
if(!models.length)throw Error('中枢模型清单为空。');
if(models.some(m=>!m.id))throw Error('中枢模型 ID 为空。');
const allowed=new Map(models.map(m=>[m.id,m]));

function same(a,b){
 const left=Buffer.from(a),right=Buffer.from(b);
 return left.length===right.length&&timingSafeEqual(left,right);
}
function send(res,status,body){
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
 res.end(JSON.stringify(body));
}
function authorized(req){
 const raw=req.headers.authorization||'';
 if(!raw.startsWith('Bearer '))return false;
 return same(raw.slice(7).trim(),token);
}
function loopback(req){
 return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
}
function readBody(req,limit=32000000){
 return new Promise((resolve,reject)=>{
  const parts=[];let size=0;
  req.on('data',chunk=>{size+=chunk.length;if(size>limit){req.destroy();reject(Object.assign(Error('请求体过大。'),{status:413}));return;}parts.push(chunk);});
  req.on('error',reject);
  req.on('end',()=>{try{resolve(parts.length?JSON.parse(Buffer.concat(parts).toString('utf8')):{});}catch{reject(Object.assign(Error('请求体不是合法 JSON。'),{status:400}));}});
 });
}

const server=createServer(async (req,res)=>{
 if(!loopback(req))return send(res,403,{error:{message:'模型代理只接受本机调用。'}});
 if(!authorized(req))return send(res,401,{error:{message:'模型代理令牌无效。'}});
 const url=new URL(req.url,'http://'+host+':'+port);
 if(req.method==='GET'&&url.pathname==='/v1/models')return send(res,200,{object:'list',data:models.map(m=>({id:m.id,object:'model',owned_by:'jg-hub'}))});
 if(req.method!=='POST'||url.pathname!=='/v1/chat/completions')return send(res,404,{error:{message:'模型代理只提供 /v1/models 与 /v1/chat/completions。'}});
 let body;
 try{body=await readBody(req);}catch(error){return send(res,error.status||400,{error:{message:error.message}});}
 if(!allowed.has(String(body.model||''))){
  // 防止材质应用把请求指向中枢没登记过的模型，造成用量不可归集。
  return send(res,403,{error:{message:'该模型未在企业内部中枢登记。'}});
 }
 const target=upstream.href.replace(/\/$/,'')+'/chat/completions';
 let response;
 try{
  response=await fetch(target,{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+apiKey},body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});
 }catch(error){
  return send(res,502,{error:{message:'中枢模型请求失败：'+(error?.message||'网络错误')}});
 }
 const text=await response.text();
 res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/json; charset=utf-8','cache-control':'no-store'});
 res.end(text);
});

server.listen(port,host,()=>{
 console.log(`[jg-hub-model-proxy] listening http://${host}:${port}/v1 · models: ${models.map(m=>m.id).join(', ')}`);
 if(descriptorPath){
  const descriptor={version:1,source:'jg-hub',proxy:{baseURL:`http://${host}:${port}/v1`,token},models:models.map(m=>({kind:m.kind,name:m.display,model:m.id}))};
  mkdirSync(dirname(descriptorPath),{recursive:true});
  writeFileSync(descriptorPath,JSON.stringify(descriptor,null,2)+'\n','utf8');
  console.log(`[jg-hub-model-proxy] descriptor written: ${descriptorPath}`);
 }
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
