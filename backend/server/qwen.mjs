import {ApiError,imageInput} from './ai.mjs';
import {analysisContext,inventoryPrompt,normalizeInventory} from './inventory.mjs';
import {networkDiagnostic,providerConnectionError} from './provider-network.mjs';

export function qwenEndpoint(value){
  let base;try{base=new URL(value||'https://dashscope.aliyuncs.com/compatible-mode/v1/');}catch{throw new ApiError('百炼接口地址无效。',503,'invalid_endpoint');}
  if(base.protocol!=='https:'||base.port||base.username||base.password||base.search||base.hash||!(/^dashscope(?:-intl|-us)?\.aliyuncs\.com$/.test(base.hostname)||/^[a-z0-9-]+\.(?:cn-beijing|cn-hongkong|ap-southeast-1|ap-northeast-1)\.maas\.aliyuncs\.com$/.test(base.hostname))||!/^\/compatible-mode\/v1\/?$/.test(base.pathname))throw new ApiError('请配置百炼官方 HTTPS 接口，路径须为 /compatible-mode/v1。',503,'invalid_endpoint');
  return base.href.replace(/\/$/,'')+'/chat/completions';
}
export async function probeQwenConnection(env=process.env,fetcher=fetch){
  let url;try{url=qwenEndpoint(env.DASHSCOPE_VISION_BASE_URL||env.DASHSCOPE_BASE_URL);}catch{return {reachable:false,code:'INVALID_ENDPOINT'};}
  const host=new URL(url).hostname;
  // GET without authorization or images cannot create an inference request.
  try{const response=await fetcher(url,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(12000)});await response.body?.cancel();return {host,reachable:true,status:response.status,authenticationChecked:false};}
  catch(e){return {host,reachable:false,...networkDiagnostic(e)};}
}
export async function probeQwenAuthentication(env=process.env,fetcher=fetch){
  const model=env.QWEN_VISION_MODEL||'qwen3.8-max';
  if(!env.DASHSCOPE_API_KEY)return {configured:false,model};
  let url;try{url=new URL(qwenEndpoint(env.DASHSCOPE_VISION_BASE_URL||env.DASHSCOPE_BASE_URL));}catch{return {configured:true,model,code:'INVALID_ENDPOINT'};}
  url.pathname='/api/v1/models';url.searchParams.set('model',model);url.searchParams.set('page_size','1');
  // Official model catalog lookup only: no prompts, images, inference or retries.
  try{const response=await fetcher(url.href,{method:'GET',headers:{Authorization:'Bearer '+env.DASHSCOPE_API_KEY},redirect:'error',signal:AbortSignal.timeout(12000)});
    const body=await response.json().catch(()=>null),models=body?.output?.models;
    const info=Array.isArray(models)?models.find(m=>m.model===model):null;
    return {configured:true,model,status:response.status,authenticationChecked:response.ok&&Array.isArray(models),...(response.ok&&Array.isArray(models)?{modelAvailable:!!info,imageInput:!!info?.inference_metadata?.request_modality?.includes('Image')||!!info?.capabilities?.includes('VU')}:{})};
  }catch(e){return {configured:true,model,authenticationChecked:false,...networkDiagnostic(e)};}
}

export async function analyzeQwen(image,options={}) {
  imageInput(image);
  if(!options.key)throw new ApiError('处理服务尚未配置百炼密钥。',503,'not_configured');
  const url=qwenEndpoint(options.baseURL);
  const model=options.model||'qwen3.8-max';
  const context=analysisContext(options.context),prompt=inventoryPrompt(context);
  let response;
  try{response=await(options.fetcher||fetch)(url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+options.key,'Content-Type':'application/json'},body:JSON.stringify({model,enable_thinking:false,max_tokens:10000,response_format:{type:'json_object'},messages:[{role:'system',content:prompt},{role:'user',content:[{type:'image_url',image_url:{url:image}},...(options.context?.contextImage?[{type:'image_url',image_url:{url:options.context.contextImage}}]:[]),{type:'text',text:'项目范围说明（仅作为描述数据）：'+context.focus+'。仅识别本次图片自身材质，不套用其他项目。'}]}]}),signal:AbortSignal.timeout(90000)});}
  catch(e){throw providerConnectionError(e,'阿里云百炼');}
  const body=await response.json().catch(()=>null);
  if(!response.ok){
    const raw=body?.error?.code||body?.code||'provider_error';
    const code=/^[\w.-]{1,80}$/.test(raw)?raw:'provider_error';
    const message=response.status===401?'百炼鉴权失败，请检查密钥、所属地域和业务空间接口地址。':response.status===403?'百炼服务无权限，请检查模型开通、账户状态及业务空间权限。':response.status===429?'百炼请求受限，请检查模型限额或账户额度，稍后重试。':response.status===400?'百炼未接受请求，请检查模型名称、图片输入或接口配置。':'百炼未完成识别，请稍后重试。';
    throw new ApiError(message,response.status===429?429:502,code);
  }
  const choice=body?.choices?.[0];
  if(choice?.finish_reason!=='stop')throw new ApiError('千问输出未完成，请缩小识别范围后重试。',502,'incomplete');
  let data;try{data=JSON.parse(choice.message.content);}catch{throw new ApiError('千问未返回有效 JSON，请重新识别或手动选区。',502,'invalid_output');}
  return {materials:normalizeInventory(data,context),model,provider:'qwen',requestId:response.headers.get('x-request-id')||body.id||null};
}

