import {randomBytes,createCipheriv,createDecipheriv,publicEncrypt,privateDecrypt,constants} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import https from 'node:https';
import {ApiError} from './ai.mjs';
// 国内模型：百炼（阿里）、火山方舟（豆包）与 OpenAI 兼容接口（可接 DeepSeek、智谱、硅基流动等国内服务商）。
export const protocols=['dashscope','openai','volcengine'];
export function endpoint(value){
 if(typeof value!=='string'||value.length>1000)throw new ApiError('接口地址过长或无效。');
 let u;try{u=new URL(value);}catch{throw new ApiError('请输入有效的 HTTPS 接口地址。');}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.port||isIP(u.hostname)||!u.hostname.includes('.')||! /^[a-z0-9.-]+$/i.test(u.hostname)||/\.(local|localhost|internal|test|invalid)$/i.test(u.hostname))throw new ApiError('接口必须是公网 HTTPS 域名，不能包含账号、查询参数或自定义端口。');
 return u.href.replace(/\/$/,'');
}
export function validateModel(input){
 if(!input||!['render','recognition','reconstruction','prompt','discovery'].includes(input.kind)||!protocols.includes(input.protocol))throw new ApiError('请选择模型用途和受支持的接口协议。');
 if(input.kind==='prompt'&&input.protocol!=='openai')throw new ApiError('提示词优化请选择 OpenAI 兼容协议，可接入 DeepSeek 或第三方语言模型。');
 if(input.protocol==='volcengine'&&!['recognition','reconstruction','discovery'].includes(input.kind))throw new ApiError('火山引擎协议仅用于材质识别和纹理重建。');
 if(input.kind==='discovery'&&!['dashscope','volcengine'].includes(input.protocol))throw new ApiError('区域发现需使用支持图片输入与 JSON 输出的视觉模型。');
 const name=String(input.name||'').trim(),model=String(input.model||'').trim(),baseURL=endpoint(input.baseURL);
 if(!name||name.length>80||!model||model.length>160||/[\r\n]/.test(model))throw new ApiError('请填写配置名称和模型 ID。');
 if(input.protocol==='dashscope'&&!/^(https:\/\/)(dashscope(?:-intl|-us)?\.aliyuncs\.com|[a-z0-9-]+\.(?:cn-beijing|cn-hongkong|ap-southeast-1|ap-northeast-1)\.maas\.aliyuncs\.com)(\/|$)/.test(baseURL))throw new ApiError('千问原生协议必须使用百炼官方域名。');
 if(input.protocol==='dashscope'&&(['recognition','discovery'].includes(input.kind)?!baseURL.endsWith('/compatible-mode/v1'):new URL(baseURL).pathname!=='/'))throw new ApiError('百炼识别地址须以 /compatible-mode/v1 结尾；重建地址须为域名根地址。');
 if(input.protocol==='volcengine'&&baseURL!=='https://ark.cn-beijing.volces.com/api/v3')throw new ApiError('豆包请使用火山方舟北京官方接口 https://ark.cn-beijing.volces.com/api/v3。');
 const key=typeof input.apiKey==='string'?input.apiKey.trim():'';
 if(key.length>4096||/[\r\n]/.test(key))throw new ApiError('密钥格式无效。');
 if(input.id&&!/^[0-9a-f-]{36}$/i.test(input.id))throw new ApiError('配置编号无效。');
 return {id:input.id||null,name,kind:input.kind,protocol:input.protocol,baseURL,model,key};
}
export function sealSecret(secret,publicKey){
 const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const ciphertext=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
 return JSON.stringify({v:1,key:publicEncrypt({key:publicKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:ciphertext.toString('base64')});
}
export function openSecret(value,privateKey){
 try{const e=JSON.parse(value);if(e.v!==1)throw Error();const key=privateDecrypt({key:typeof privateKey==='string'?privateKey.replace(/\\n/g,'\n'):privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(e.key,'base64'));const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'));decipher.setAuthTag(Buffer.from(e.tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(e.data,'base64')),decipher.final()]).toString('utf8');}catch{throw new ApiError('模型密钥无法解密，请联系管理员检查服务器配置。',503,'config_error');}
}
export function publicAddress(address){
 if(address.includes(':'))return /^[23][0-9a-f]{3}:/i.test(address)&&!/^2001:(?:db8|0):/i.test(address);
 const p=address.split('.').map(Number);return p.length===4&&p.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&![0,10,127].includes(p[0])&&p[0]<224&&!(p[0]===169&&p[1]===254)&&!(p[0]===172&&p[1]>=16&&p[1]<=31)&&!(p[0]===192&&(p[1]===168||p[1]===0||p[1]===88&&p[2]===99))&&!(p[0]===198&&(p[1]===18||p[1]===19||p[1]===51&&p[2]===100))&&!(p[0]===203&&p[1]===0&&p[2]===113)&&!(p[0]===100&&p[1]>=64&&p[1]<=127);
}
export async function checkEndpoint(value,resolver=lookup){const u=new URL(endpoint(value));const ips=await resolver(u.hostname,{all:true});if(!ips.length||ips.some(x=>!publicAddress(x.address)))throw new ApiError('接口域名解析到非公网地址，已阻止调用。',400,'invalid_endpoint');return u;}
// Pin the checked DNS address to the actual TLS connection; never follow redirects.
export async function secureModelFetch(url,init){
 const u=new URL(url);await checkEndpoint(u.origin);const ips=await lookup(u.hostname,{all:true});if(!ips.length||ips.some(x=>!publicAddress(x.address)))throw new ApiError('接口地址不允许访问。',400,'invalid_endpoint');
 const serialized=new Request(url,init),bytes=Buffer.from(await serialized.arrayBuffer());
 return new Promise((resolve,reject)=>{const req=https.request(u,{method:'POST',headers:Object.fromEntries(serialized.headers),signal:init.signal,lookup:(_host,options,cb)=>options.all?cb(null,[ips[0]]):cb(null,ips[0].address,ips[0].family)},res=>{const chunks=[];let size=0;res.on('data',part=>{size+=part.length;if(process.env.LOCAL_STORAGE_MODE!=='true'&&size>32000000){res.destroy();reject(new ApiError('模型返回内容过大。',502,'invalid_output'));}else chunks.push(part);});res.on('error',reject);res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});req.on('error',reject);req.end(bytes);});
}
export async function modelConfiguration(auth,kind,{env=process.env,fetcher=fetch}={}){
 const r=await fetcher(auth.config.url+'/rest/v1/rpc/get_ai_model_config',{method:'POST',headers:{apikey:auth.config.key,Authorization:auth.bearer,'Content-Type':'application/json'},body:JSON.stringify({request_kind:kind}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new ApiError('模型配置读取失败，请稍后重试。',503,'config_error');
 const data=await r.json();
 if(!data)return {protocol:'dashscope',name:'阿里云百炼 · 千问',model:kind==='recognition'?(env.QWEN_VISION_MODEL||'qwen3.8-max'):(env.QWEN_IMAGE_MODEL||'qwen-image-2.0-pro'),baseURL:env.DASHSCOPE_BASE_URL,key:env.DASHSCOPE_API_KEY,legacy:true};
 if(data.disabled)throw new ApiError('管理员已暂停此项 AI 服务。',503,'disabled');
 const valid=validateModel(data);return {...valid,key:openSecret(data.secret,env.AI_MODEL_PRIVATE_KEY)};
}
