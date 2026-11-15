import {reconstructionImages} from './reconstruction-images.mjs';
import sharp from './image-sharp.mjs';
import {ApiError} from './ai.mjs';
import {reconstructionPrompt} from './qwen-image.mjs';
import {secureModelFetch} from './model-config.mjs';
// 豆包（火山方舟）图像编辑接口。国外服务商（fal 等）已下线，仅保留国内通道。
export async function reconstructAdditional(input,config,fetcher=config.fetcher||secureModelFetch){
 if(config.protocol!=='volcengine')throw new ApiError('所选服务不支持纹理重建。');
 const url=config.baseURL+'/images/generations',headers={'Content-Type':'application/json',Authorization:'Bearer '+config.key};
 const body={model:config.model,prompt:reconstructionPrompt(input),image:input.controlledRepair?reconstructionImages(input):input.image,response_format:'b64_json',size:'2048x2048',watermark:false,stream:false,sequential_image_generation:'disabled'};
 let r;try{r=await fetcher(url,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(600000)});}catch(error){if(['AbortError','TimeoutError'].includes(error?.name))throw new ApiError('AI 生图等待超时，任务可能已在服务商完成。请先检查服务商请求记录，避免重复生成。',504,'provider_timeout');throw error;}const d=await r.json().catch(()=>null);
 if(!r.ok)throw new ApiError('纹理服务请求失败（HTTP '+r.status+'），请检查权限或额度；不要连续重试。',502,'provider_error');
 const image=d?.data?.[0]?.b64_json?'data:image/png;base64,'+d.data[0].b64_json:null;
 if(typeof image!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))throw new ApiError('服务未返回内联图片；为避免重复计费，请勿立即再次生成。',502,'invalid_output');
 const bytes=Buffer.from(image.split(',')[1],'base64');const meta=await sharp(bytes).metadata();if(!meta.width||!meta.height)throw new ApiError('返回的图片无法解码。',502,'invalid_output');
 if(meta.format!=='png')image='data:image/png;base64,'+(await sharp(bytes).png().toBuffer()).toString('base64');
 return {image,model:config.model,requestId:d.id||r.headers.get('x-request-id')||null,width:meta.width,height:meta.height};
}
