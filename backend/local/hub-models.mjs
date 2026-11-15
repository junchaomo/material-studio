import {readFileSync,existsSync} from 'node:fs';
// 企业内部中枢托管模型。
// 中枢插件（thin shell）在启动材质工作台之前写入一份描述文件，材质应用只感知
// 「本机回环代理地址 + 一次性令牌 + 可用模型清单」，永远拿不到中枢真实密钥。
// 描述文件不存在或不合规时返回 null，调用方回落到单机模型的原有逻辑。
export const hubEnvKey='MATERIAL_STUDIO_HUB_MODELS';
export const hubSource='jg-hub';
export const hubKinds=['recognition','discovery'];
const loopback=new Set(['127.0.0.1','localhost','[::1]','::1']);

function text(value,limit,label){
 if(typeof value!=='string')throw Error(label+'格式无效。');
 const v=value.trim();
 if(!v||v.length>limit||/[\r\n]/.test(v))throw Error(label+'格式无效。');
 return v;
}

export function proxyEndpoint(value){
 if(typeof value!=='string'||value.length>200)throw Error('中枢模型代理地址无效。');
 let url;try{url=new URL(value);}catch{throw Error('中枢模型代理地址无效。');}
 if(!['http:','https:'].includes(url.protocol)||!loopback.has(url.hostname))throw Error('中枢模型代理必须位于本机回环地址。');
 if(url.username||url.password||url.search||url.hash)throw Error('中枢模型代理地址不能包含账号或查询参数。');
 return url.href.replace(/\/$/,'');
}

export function parseHubDescriptor(input){
 const source=typeof input?.source==='string'?input.source.trim():'';
 if(input?.version!==1||source!==hubSource)throw Error('中枢模型描述文件版本或来源无效。');
 const baseURL=proxyEndpoint(input.proxy?.baseURL),token=text(input.proxy?.token,4096,'中枢模型令牌');
 if(!Array.isArray(input.models)||!input.models.length||input.models.length>12)throw Error('中枢模型清单为空。');
 const models=[];
 for(const raw of input.models){
  const kind=String(raw?.kind||'');
  if(!hubKinds.includes(kind))throw Error('中枢模型用途仅支持材质识别与区域发现。');
  const name=text(raw?.name,80,'中枢模型名称'),model=text(raw?.model,160,'中枢模型 ID');
  if(models.some(m=>m.kind===kind&&m.model===model))continue;
  models.push({kind,name,model});
 }
 if(!models.some(m=>m.kind==='recognition'))throw Error('中枢模型清单缺少材质识别模型。');
 return {baseURL,token,models};
}

export function readHubDescriptor({env=process.env,read=readFileSync}={}){
 const file=env[hubEnvKey];
 if(typeof file!=='string'||!file.trim()||!existsSync(file))return null;
 try{return parseHubDescriptor(JSON.parse(read(file,'utf8')));}catch{return null;}
}

export function hubModelId(model){return 'hub-'+model.kind+'-'+model.model.replace(/[^a-z0-9]+/gi,'-').toLowerCase().slice(0,48);}

export function hubRows(descriptor,{now=()=>new Date().toISOString()}={}){
 return descriptor.models.map(m=>({id:hubModelId(m),name:m.name,kind:m.kind,protocol:'openai',baseURL:descriptor.baseURL,model:m.model,disabled:false,source:hubSource,updated_at:now()}));
}

// 中枢托管模型的写入口径：只在启动时同步，不经过任何 HTTP 编辑接口。
export function syncHubModels(store,descriptor,{now=()=>new Date().toISOString()}={}){
 if(!descriptor)return 0;
 const rows=hubRows(descriptor,{now}),secret=store.encrypt(descriptor.token),keep=new Set(rows.map(r=>r.id)),changed=[];
 for(const row of rows){
  const old=store.get('models',row.id);
  keep.add(row.id);
  const same=!!old&&old.baseURL===row.baseURL&&old.model===row.model&&old.secret===secret;
  store.put('models',{...row,secret,updated_at:same&&old.updated_at?old.updated_at:row.updated_at});
  changed.push(row.id);
 }
 for(const stale of store.all('models').filter(m=>m.source===hubSource&&!keep.has(m.id)))store.remove('models',stale.id);
 return {synced:changed,secretChanged:changed.filter(id=>store.get('models',id)?.updated_at===now())};
}

export function pruneHubModels(store){
 let removed=0;
 for(const m of store.all('models').filter(m=>m.source===hubSource)){store.remove('models',m.id);removed++;}
 return removed;
}

export function isHubModel(model){return !!model&&model.source===hubSource;}

// 中枢托管模型的取数只允许打向描述文件里登记的本地代理，不做公网 DNS 固定。
export function hubFetcher(model,{fetchImpl=fetch}={}){
 return async function(url,init){
  const target=new URL(url);
  if(!loopback.has(target.hostname))throw new Error('中枢模型代理必须位于本机回环地址。');
  if(!target.href.startsWith(model.baseURL+'/'))throw new Error('中枢模型请求越出了代理地址。');
  return fetchImpl(target,init);
 };
}
