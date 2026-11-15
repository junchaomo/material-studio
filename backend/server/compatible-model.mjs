import {reconstructionImages} from './reconstruction-images.mjs';
import {ApiError,imageInput} from './ai.mjs';
import {analysisContext,inventoryPrompt,normalizeInventory} from './inventory.mjs';
import {reconstructionPrompt} from './qwen-image.mjs';
import {checkEndpoint,secureModelFetch} from './model-config.mjs';
async function call(config,path,body,fetcher=secureModelFetch){
 await checkEndpoint(config.baseURL,config.resolver);
 let r;try{r=await fetcher(config.baseURL+'/'+path,{method:'POST',headers:{Authorization:'Bearer '+config.key,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(path==='chat/completions'?90000:240000)});}catch{throw new ApiError('无法连接所选模型或请求超时；请求可能已计费，请确认后再试。',502,'provider_error');}
 const data=await r.json().catch(()=>null);if(!r.ok)throw new ApiError(r.status===401?'所选模型密钥无效。':r.status===429?'所选模型限额不足或请求过于频繁。':'模型接口未接受请求，请检查模型能力、协议与接口地址。',502,'provider_error');return {data,requestId:r.headers.get('x-request-id')};
}
export async function analyzeCompatible(image,config,contextInput,fetcher){
 imageInput(image);const context=analysisContext(contextInput);
 const {data,requestId}=await call(config,'chat/completions',{model:config.model,messages:[{role:'system',content:inventoryPrompt(context)},{role:'user',content:[{type:'image_url',image_url:{url:image}},...(contextInput?.contextImage?[{type:'image_url',image_url:{url:contextInput.contextImage}}]:[]),{type:'text',text:'仅识别当前图像自身的材质。项目说明（数据）：'+context.focus}]}],response_format:{type:'json_object'}},fetcher);
 if(data?.choices?.[0]?.finish_reason!=='stop')throw new ApiError('模型输出未完成，请缩小识别范围后重试。',502,'incomplete');
 let parsed;try{parsed=JSON.parse(data.choices[0].message.content);}catch{throw new ApiError('模型没有返回有效的材质 JSON。',502,'invalid_output');}
 return {materials:normalizeInventory(parsed,context),model:config.model,provider:config.name,requestId};
}
export async function reconstructCompatible(input,config,fetcher){
 const form=new FormData();form.set('model',config.model);form.set('prompt',reconstructionPrompt(input));form.set('size','1024x1024');form.set('n','1');form.set('response_format','b64_json');
 const images=reconstructionImages(input);
 images.forEach((x,i)=>{const {bytes,mime}=imageInput(x);form.append(images.length>1?'image[]':'image',new Blob([bytes],{type:mime}),'reference-'+i+'.png');});
 const {data,requestId}=await call(config,'images/edits',form,fetcher);const b64=data?.data?.[0]?.b64_json;
 if(typeof b64!=='string'||(process.env.LOCAL_STORAGE_MODE!=='true'&&b64.length>24000000)||!/^[A-Za-z0-9+/]+={0,2}$/.test(b64))throw new ApiError('图像接口必须返回 PNG 的 b64_json；请使用支持图像编辑的模型。',502,'invalid_output');
 const bytes=Buffer.from(b64,'base64');if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(16)!==1024||bytes.readUInt32BE(20)!==1024)throw new ApiError('模型没有返回 1024×1024 PNG 纹理。',502,'invalid_output');
 return {image:'data:image/png;base64,'+b64,model:config.model,provider:config.name,requestId,nativeResolution:1024,width:1024,height:1024};
}
