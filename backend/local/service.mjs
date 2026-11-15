import {createBatchDiscovery} from './batch-discovery.mjs';
import {deleteModelConfiguration} from './deletion.mjs';
import {composeControlledTexture,assessReferenceRedraw} from '../server/controlled-texture.mjs';
import {validateLocalReconstruction} from './reconstruction-validation.mjs';
import {createFolder,updateProjectOrganization} from './project-organization.mjs';
import {emptyRecycleBin,clearMaterialTasks} from './deletion.mjs';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import sharp from '../server/image-sharp.mjs';
import {LocalStore,newId,localOwner,localWorkspace} from './store.mjs';
import {projectCreateInput,projectUpdateInput,uploadInput} from '../../shared/domain.ts';
import {selectionInput} from '../../shared/material-selection.ts';
import {quadInput} from '../../shared/platform.ts';
import {finalMaskConfirmed,materialInfoConfirmed,materialGenerationState} from '../../shared/material-generation-state.mjs';
import {zipArchive} from '../../shared/material-package.mjs';
import {validateModel,secureModelFetch} from '../server/model-config.mjs';
import {readHubDescriptor,syncHubModels,pruneHubModels,isHubModel,hubFetcher} from './hub-models.mjs';
import {recognizeLocalMaterial} from '../server/local-material.mjs';

import {reconstructQwen,downloadQwenCandidate} from '../server/qwen-image.mjs';
import {reconstructAdditional} from '../server/multi-material.mjs';
import {reconstructCompatible} from '../server/compatible-model.mjs';
import {imageProviderFetch} from '../server/image-transport.mjs';
import {prepareTextureReference,textureDeviation} from '../server/texture-reference.mjs';
import {localMaterialEvidence} from '../worker/material-evidence.mjs';
const now=()=>new Date().toISOString(),json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const uid=value=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw fail('编号无效。');return value;};
const category=['石材','金属','木材','涂料','砖材','铺装','景观','玻璃','标识','其他'];
const kinds=['重复纹理','纯色渐变','专用图案'];
function evidence(c,p={}){return createHash('sha256').update(JSON.stringify([c.source_asset_id,c.mask_asset_id,c.name,c.category,c.kind,c.part,c.description,c.quad,c.sources[0]?.rectifiedAssetId,p.resolution,p.seamless,p.textureMode,p.textureMode==='ai'?'clean-reference-redraw-v5':null,...(['traditional','local_refine','image_edit'].includes(p.textureMode)?[p.restoration,p.fidelity,p.materialType,p.baseVersionId,p.refineMaskId,p.referenceImageId,p.instruction]:[])])).digest('hex');}
export function localRequestAllowed(req){return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(req.headers.host||'')&&(!req.headers.origin||/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(req.headers.origin));}
export function createLocalService({directory,env=process.env,cpu=null,providers={}}){
 const store=new LocalStore(directory),token=randomBytes(32).toString('hex');let working=false,closed=false;
 // 中枢托管：插件启动前写入描述文件时才接管模型来源，否则清理上一次残留并回落到单机模型。
 const hubDescriptor=readHubDescriptor({env});if(hubDescriptor)syncHubModels(store,hubDescriptor);else pruneHubModels(store);
 const receiptDir=path.join(store.directory,'receipts');
 const processor=cpu||async function(input){const endpoint=new URL('/api/material_processing',env.CPU_SERVICE_URL||'http://127.0.0.1:4192');if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))throw fail('本地模式的图像处理必须运行在本机。',503);const r=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+env.QMX_CLOUD_WORKER_TOKEN,'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(120000),redirect:'error'});const result=await r.json();if(r.status===401)throw fail('本地图像服务连接校验失败，请重新启动本地工作台。',503);if(!r.ok)throw Object.assign(fail(typeof result.detail==='string'?result.detail:'图像处理未完成，请检查图片和 Mask。',422),{code:r.headers.get('x-processing-error')||undefined});return result;};
 const project=id=>{const p=store.get('projects',uid(id));if(!p)throw fail('项目不存在。',404);return p;};
 const asset=id=>{const a=store.get('assets',uid(id));if(!a||a.status!=='ready')throw fail('图片不存在或尚未保存完整。',404);return a;};
 const signed=a=>({...a,url:'/api/local/files/'+a.id});
 const dataImage=async id=>'data:image/png;base64,'+(await readFile(store.file(asset(id).id))).toString('base64');
 async function saveImage(projectId,input,name,kind='material',assetId=newId()){
  project(projectId);const bytes=typeof input==='string'?Buffer.from(input.split(',')[1]||'','base64'):Buffer.from(input);
  const image=sharp(bytes,{limitInputPixels:false}).rotate(),meta=await image.metadata();if(!['png','jpeg','webp'].includes(meta.format))throw fail('图片格式无效。');
  const normalized=await image.png().toBuffer(),dimensions=await sharp(normalized,{limitInputPixels:false}).metadata();const dest=store.file(assetId),temp=dest+'.tmp';await writeFile(temp,normalized);await rename(temp,dest);
  return store.put('assets',{id:assetId,project_id:projectId,workspace_id:localWorkspace,name:String(name).slice(0,200),kind,mime_type:'image/png',width:dimensions.width,height:dimensions.height,storage_key:assetId+'.png',status:'ready',created_at:now()});
 }
 function preferences(){const p=store.get('settings','user-preferences')||{id:'user-preferences',recognitionMethod:'color',models:{}};p.recognitionMethod='color';p.models=Object.fromEntries(Object.entries(p.models||{}).filter(([k])=>['recognition','reconstruction','discovery'].includes(k)));const m=store.get('models',p.models?.recognition);if(!m||(m.protocol!=='dashscope'&&!isHubModel(m))||m.disabled)p.models={...p.models,recognition:store.all('models').find(m=>(m.protocol==='dashscope'||isHubModel(m))&&m.kind==='recognition'&&!m.disabled&&m.secret)?.id||''};
  // 中枢托管优先：只要中枢给了可用模型，识别与发现就固定走中枢，本机配置只兜底重绘。
  if(hubDescriptor){
   for(const kind of ['recognition','discovery']){
    const hubModel=store.all('models').find(m=>isHubModel(m)&&m.kind===kind&&!m.disabled&&m.secret);
    if(hubModel)p.models={...p.models,[kind]:hubModel.id};
   }
  }
  return p;}
 function catalog(){return store.all('models').filter(m=>['discovery','recognition','reconstruction'].includes(m.kind)&&(m.kind!=='recognition'||m.protocol==='dashscope'||isHubModel(m))).map(m=>({id:m.id,name:m.name,kind:m.kind,model:m.model,protocol:m.protocol,baseURL:m.baseURL,source:m.source||'local',parameters:[],ready:!!m.secret&&!m.disabled,disabled:!!m.disabled}));}
 function localCatalog(){return catalog().filter(m=>m.source!=='jg-hub');}
 function hubStatus(){return {managed:!!hubDescriptor,models:store.all('models').filter(m=>m.source==='jg-hub').map(m=>({id:m.id,kind:m.kind,name:m.name,model:m.model}))};}
 function configuration(modelId,kind){if(!['recognition','reconstruction','discovery'].includes(kind))throw fail('不支持此模型用途。');const m=store.get('models',modelId);if(!m||m.kind!==kind||((kind==='recognition')&&m.protocol!=='dashscope'&&!isHubModel(m))||m.disabled||!m.secret)throw fail('请先在“本机管理中心”中保存并选择对应模型。');return {...m,key:store.decrypt(m.secret),fetcher:isHubModel(m)?hubFetcher(m):(kind==='reconstruction'&&m.protocol==='dashscope'?imageProviderFetch:secureModelFetch)};}
 if(!store.all('models').length&&env.DASHSCOPE_API_KEY){for(const kind of ['recognition','reconstruction']){const raw={name:kind==='recognition'?'百炼材质识别（本机环境）':'百炼纹理重绘（本机环境）',kind,protocol:'dashscope',baseURL:kind==='recognition'?(env.DASHSCOPE_VISION_BASE_URL||'https://dashscope.aliyuncs.com/compatible-mode/v1'):(env.DASHSCOPE_IMAGE_BASE_URL||'https://dashscope.aliyuncs.com'),model:kind==='recognition'?(env.QWEN_VISION_MODEL||'qwen3.8-max'):(env.QWEN_IMAGE_MODEL||'qwen-image-2.0-pro')};try{const m=validateModel(raw);store.put('models',{...m,id:newId(),secret:store.encrypt(env.DASHSCOPE_API_KEY),updated_at:now()});}catch{}}
 }
 // A restart never blindly repeats a possibly paid POST.

 for(const t of store.all('tasks').filter(t=>['queued','processing'].includes(t.status)&&t.kind==='segmentation'))store.put('tasks',{...t,status:'failed',stage:'旧任务已停用',error_message:'区域识别已统一使用颜色和纹理识别，请重新开始识别。',updated_at:now()});
 for(const m of store.all('models').filter(m=>m.kind==='segmentation')){
  for(const t of store.all('tasks').filter(t=>['queued','processing'].includes(t.status)&&(t.parameters?.modelId===m.id||Object.values(t.parameters?.models||{}).includes(m.id))))store.put('tasks',{...t,status:'failed',stage:'旧配置已停用',error_message:'区域识别配置已更新，请重新开始识别。',updated_at:now()});
  deleteModelConfiguration(store,m.id);
 }
 for(const t of store.all('tasks').filter(t=>t.status==='processing'))store.put('tasks',{...t,status:'failed',stage:'服务重启，请检查回执',error_message:'处理被中断；如请求已到达模型可能已计费。显式重试会优先恢复已保存结果。',updated_at:now()});
 function invalidate(c){const m=c.sources[0];delete m.maskConfirmation;delete m.infoConfirmation;delete m.rectifiedAssetId;delete m.geometry;c.quad=null;}
 function getCandidate(p){const c=store.get('candidates',uid(p.candidateId));if(!c||c.project_id!==p.projectId)throw fail('材质任务不存在。',404);if(c.revision!==p.revision)throw fail('任务已更新，请刷新后重新操作。',409);return c;}
 function currentJobs(c){return store.all('tasks',c.project_id).filter(t=>t.parameters.candidate?.id===c.id&&['queued','processing'].includes(t.status));}
 function queue(c,kind,p){if(!['presegmentation','rectification','recognition','reconstruction'].includes(kind))throw fail('不支持此任务类型。');
  const taskId=uid(p.requestId),existing=store.get('tasks',taskId);if(existing)return existing;
  if(currentJobs(c).length)throw fail('此材质仍有任务正在处理。',409);
  if(!['presegmentation','rectification'].includes(kind)&&!(kind==='reconstruction'&&['faithful','traditional'].includes(p.textureMode)))configuration(p.modelId,kind);
  c.revision++;store.put('candidates',c);const model=p.modelId?store.get('models',p.modelId):null;
  const t=store.put('tasks',{id:taskId,project_id:c.project_id,group_id:c.group_id,source_asset_id:c.source_asset_id,kind,region_index:null,status:'queued',stage:'等待本地处理',parameters:{...p,candidate:structuredClone(c),evidenceHash:evidence(c,p),modelUpdatedAt:model?.updated_at},created_at:now(),updated_at:now()});schedule();return t;
 }
 function reserve(t){store.transaction(()=>{if(store.get('usage',t.id))return;const month=now().slice(0,7),used=store.all('usage').filter(e=>e.kind===t.kind&&e.month===month).length;if(used>=100)throw fail('本机该类 AI 本月已达到 100 次上限。',429);store.put('usage',{id:t.id,kind:t.kind,month,created_at:now()});t.usage_event_id=t.id;store.put('tasks',t);});}
 // 分块调用各自计一次用量，但不写入伪造的任务行（任务仍只有批次本身一条）。
 function reserveUsage(t,id){store.transaction(()=>{if(store.get('usage',id))return;const month=now().slice(0,7),used=store.all('usage').filter(e=>e.kind===t.kind&&e.month===month).length;if(used>=100)throw fail('本机该类 AI 本月已达到 100 次上限。',429);store.put('usage',{id,kind:t.kind,month,created_at:now()});});}
 const receiptKey=value=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-t[0-9]{1,2})?$/i.test(value))throw fail('回执编号无效。');return value;};
 async function recorded(t,invoke,recoveryOptions,options={}){
  const original=receiptKey((t.parameters.recoverTaskId||t.id)+(options.receiptKey||'')),file=path.join(receiptDir,original+'.json');
  try{const saved=JSON.parse(await readFile(file,'utf8'));if(saved.evidenceHash!==t.parameters.evidenceHash)throw fail('已保存回执与当前输入不一致。',409);if(saved.image)saved.result.image='data:image/png;base64,'+(await readFile(path.join(receiptDir,original+'.png'))).toString('base64');return saved.result;}catch(e){if(e.code!=='ENOENT')throw e;}
  let pending;
  try{pending=JSON.parse(await readFile(path.join(receiptDir,original+'.provider.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(pending&&pending.evidenceHash!==t.parameters.evidenceHash)throw fail('已保存回执与当前输入不一致。',409);
  if(pending&&!recoveryOptions)throw fail('存在待恢复图片，请使用原模型配置恢复。',409);
  if(!pending&&store.get('receipts',original)?.status==='started')throw fail('上次模型请求结果未确认，已阻止自动重复调用。',409);
  if(!pending)options.receiptKey?reserveUsage(t,original):reserve(t);store.put('receipts',{id:original,status:'started',created_at:now(),evidenceHash:t.parameters.evidenceHash});
  const saveReceipt=async payload=>{await mkdir(receiptDir,{recursive:true});const dest=path.join(receiptDir,original+'.provider.json');await writeFile(dest+'.tmp',JSON.stringify({...payload,evidenceHash:t.parameters.evidenceHash}),{mode:0o600});await rename(dest+'.tmp',dest);return original;};
  const result=pending?await downloadQwenCandidate(pending.body,{...recoveryOptions,model:pending.model}):await invoke(saveReceipt);await mkdir(receiptDir,{recursive:true});const saved={result:{...result},evidenceHash:t.parameters.evidenceHash,image:!!result.image};
  if(result.image){await writeFile(path.join(receiptDir,original+'.png'),Buffer.from(result.image.split(',')[1],'base64'));delete saved.result.image;}
  const ownFile=path.join(receiptDir,original+'.json');await writeFile(ownFile+'.tmp',JSON.stringify(saved),{mode:0o600});await rename(ownFile+'.tmp',ownFile);store.put('receipts',{id:original,status:'completed',evidenceHash:t.parameters.evidenceHash,created_at:now()});return result;
 }
 async function execute(t){
  t.status='processing';t.stage='本地处理中';store.put('tasks',t);
  try{
   if(t.kind==='discovery'){await batch.run(t);return;}
   const c=store.get('candidates',t.parameters.candidate.id),p=t.parameters,m=c.sources[0];if(evidence(c,p)!==p.evidenceHash)throw fail('材质证据已改变，请重新提交。',409);
   const source=await dataImage(c.source_asset_id);let result;
   if(t.kind==='presegmentation'){
    result=await processor({operation:'presegment',image:source,point:m.selection.point,sensitivity:p.sensitivity,radius:p.radius});const a=await saveImage(c.project_id,result.image,c.name+' · 候选 Mask','mask');m.presegmentation={...result.presegmentation,assetId:a.id};m.boundary=result.boundary;result={assetId:a.id,presegmentation:result.presegmentation};
   }else if(t.kind==='rectification'){
    result=await processor({operation:'rectify',image:source,mask:await dataImage(c.mask_asset_id),estimateOnly:!p.quad,...(p.quad?{quad:p.quad}:{})});if(p.quad&&m.geometry?.roi){result.geometry.roi={...m.geometry.roi,status:p.automatic?'batch-selected':'user-confirmed',manuallyAdjusted:JSON.stringify(p.quad)!==JSON.stringify(m.geometry.quad)};}const a=await saveImage(c.project_id,result.image,c.name+' · 正视样本','rectified');m.geometry=result.geometry;c.quad=result.geometry.quad;m.maskConfirmation={assetId:c.mask_asset_id};m.rectifiedAssetId=a.id;delete m.infoConfirmation;result={assetId:a.id,geometry:result.geometry};
   }else if(t.kind==='recognition'){
    const config=configuration(p.modelId,t.kind);if(config.updated_at!==p.modelUpdatedAt)throw fail('模型配置已改变，请重新提交。',409);
     const local=await sharp(await readFile(store.file(asset(m.rectifiedAssetId).id))).flatten({background:'#808080'}).jpeg({quality:95}).toBuffer();const evidenceImages=await localMaterialEvidence(source,await readFile(store.file(asset(c.mask_asset_id).id)),{includeContext:config.protocol==='dashscope'});
     result=await recorded(t,()=> (providers.recognize||recognizeLocalMaterial)([evidenceImages.originalImage,evidenceImages.maskImage,'data:image/jpeg;base64,'+local.toString('base64'),...(evidenceImages.contextImage?[evidenceImages.contextImage]:[])],config));for(const field of ['name','category','kind','part','description','risks','confidence'])if(result.material[field]!==undefined)c[field]=result.material[field];m.features=result.material.features;m.featureSource='ai';delete m.infoConfirmation;
   }else if(t.kind==='reconstruction'){
    validateLocalReconstruction(c,p);const sample=await dataImage(m.rectifiedAssetId);let preparation,qualityReference=sample,repairReport;
    if(p.textureMode==='traditional'){
     result=await processor({operation:'reconstruct_source',image:sample,kind:c.kind,category:c.category,seed:p.evidenceHash,resolution:p.resolution,seamless:p.seamless,restoration:p.restoration,fidelity:p.fidelity,materialType:p.materialType});preparation=result.preparation;
    }else if(p.textureMode==='direct_ai'){
     const config=configuration(p.modelId,t.kind);if(config.updated_at!==p.modelUpdatedAt)throw fail('模型配置已改变，请重新提交。',409);
     const input={image:sample,directGeneration:true,referenceMode:'rectified-only',category:c.category,part:c.part,kind:c.kind,description:c.description,seamless:p.seamless};
     const raw=await recorded(t,saveReceipt=>(providers.reconstruct||(config.protocol==='dashscope'?reconstructQwen:config.protocol==='volcengine'?reconstructAdditional:reconstructCompatible))(input,{...config,saveReceipt},config.fetcher),config.protocol==='dashscope'?config:undefined);
     result=await processor({operation:'postprocess',image:raw.image,resolution:p.resolution,seamless:false});
     Object.assign(result,{model:raw.model,requestId:raw.requestId,ai_inferred:true,sr_applied:false,chosen_algorithm:'direct-ai-from-rectified',quality_report:{calibrated:false,warnings:['基于正视样本进行整图 AI 生成，细节包含推断，请检查颜色、排列与平铺。']}});
     preparation={pipeline:'direct-ai-from-rectified-v1'};
    }else if(p.textureMode==='image_edit'){
     const base=store.get('materials',p.baseVersionId);if(!base||base.candidate_id!==c.id||base.project_id!==c.project_id)throw fail('修改来源不属于当前材质。');
     const baseImage=await dataImage(base.asset_id),config=configuration(p.modelId,t.kind);if(config.updated_at!==p.modelUpdatedAt)throw fail('模型配置已改变，请重新提交。',409);
     const input={image:baseImage,imageEdit:true,instruction:p.instruction,referenceMode:'rectified-only',category:c.category,part:c.part,kind:c.kind,seamless:false};
     const raw=await recorded(t,saveReceipt=>(providers.reconstruct||(config.protocol==='dashscope'?reconstructQwen:config.protocol==='volcengine'?reconstructAdditional:reconstructCompatible))(input,{...config,saveReceipt},config.fetcher),config.protocol==='dashscope'?config:undefined);
     result=await processor({operation:'postprocess',image:raw.image,resolution:p.resolution,seamless:false});qualityReference=baseImage;
     Object.assign(result,{model:raw.model,requestId:raw.requestId,ai_inferred:true,chosen_algorithm:'text-image-edit',quality_report:{calibrated:false,warnings:['根据文字修改当前贴图，请检查结果后确认入库。']}});preparation={pipeline:'text-image-edit-v1',baseVersionId:base.id};
    }else if(p.textureMode==='local_refine'){
     const base=store.get('materials',p.baseVersionId);if(!base||base.candidate_id!==c.id)throw fail('精修来源版本不存在。');
     const baseImage=await dataImage(base.asset_id),maskImage=await dataImage(p.refineMaskId);const config=configuration(p.modelId,t.kind);if(config.updated_at!==p.modelUpdatedAt)throw fail('模型配置已改变，请重新提交。',409);
     const input={image:baseImage,localRefine:true,instruction:p.instruction,controlledRepair:true,repairMask:maskImage,referenceImage:p.referenceImageId?await dataImage(p.referenceImageId):sample,preparedSquare:true,referenceMode:'rectified-only',category:c.category,part:c.part,kind:c.kind,description:c.description,seamless:false};
     const raw=await recorded(t,saveReceipt=>(providers.reconstruct||(config.protocol==='dashscope'?reconstructQwen:config.protocol==='volcengine'?reconstructAdditional:reconstructCompatible))(input,{...config,saveReceipt},config.fetcher),config.protocol==='dashscope'?config:undefined);
     const composed=await composeControlledTexture(baseImage,raw.image,maskImage,{diagnostics:true});qualityReference=baseImage;repairReport=composed.report;
     const rawAsset=await saveImage(c.project_id,raw.image,c.name+' · AI局部候选（未合成）','material');
     result={image:composed.image,model:raw.model,requestId:raw.requestId,ai_inferred:!composed.report.usedBaseFallback,rawCandidateId:rawAsset.id,chosen_algorithm:'masked-local-refinement',sr_applied:false,warnings:composed.report.warnings,quality_report:{...composed.report,calibrated:false,maskOutsideProtected:true}};
     preparation={pipeline:'source-driven-local-refine-v1',baseVersionId:base.id,maskId:p.refineMaskId,referenceImageId:p.referenceImageId||null};
    }else if(p.textureMode==='faithful')result=await processor({operation:'enhance',image:sample,resolution:p.resolution,seamless:false});
    else{
     const config=configuration(p.modelId,t.kind);if(config.updated_at!==p.modelUpdatedAt)throw fail('模型配置已改变，请重新提交。',409);
     let prepared;if(c.kind==='纯色渐变'){const gradient=await prepareTextureReference(Buffer.from(sample.split(',')[1],'base64'),c.kind,c.category);const edges=await processor({operation:'synthesize',image:gradient.image,kind:c.kind,category:c.category,seed:p.evidenceHash});prepared={...edges,image:gradient.image,referenceImage:gradient.image,preparation:{...gradient.preparation,method:'gradient-preserving-controlled-v1'}};}else prepared=await processor({operation:'synthesize',image:sample,kind:c.kind,category:c.category,seed:p.evidenceHash});if(!prepared.image||!prepared.repairMask||!prepared.referenceImage)throw fail('纹理合成未返回完整修复依据，未调用模型。',422);qualityReference=prepared.image;preparation={...prepared.preparation,pipeline:'clean-reference-redraw-v5',baseHash:createHash('sha256').update(prepared.image).digest('hex'),repairMaskHash:createHash('sha256').update(prepared.repairMask).digest('hex')};
     const input={image:prepared.image,sampleNativeWidth:prepared.preparation?.crop?.width,sampleNativeHeight:prepared.preparation?.crop?.height,controlledRepair:true,repairMask:prepared.repairMask,referenceImage:prepared.referenceImage,preparedSquare:true,referenceMode:'rectified-only',category:c.category,part:c.part,description:c.name+'；'+c.description,kind:c.kind,seamless:p.seamless&&c.kind==='重复纹理',geometryStatus:m.geometry.status};
     const raw=await recorded(t,saveReceipt=> (providers.reconstruct||(config.protocol==='dashscope'?reconstructQwen:config.protocol==='volcengine'?reconstructAdditional:reconstructCompatible))(input,{...config,saveReceipt},config.fetcher),config.protocol==='dashscope'?config:undefined);
     const composed=await assessReferenceRedraw(prepared.image,raw.image);repairReport=composed.report;result=await processor({operation:'postprocess',image:composed.image,resolution:p.resolution,seamless:p.seamless&&c.kind==='重复纹理'});result.model=raw.model;result.requestId=raw.requestId;
    }
    const a=await saveImage(c.project_id,result.image,c.name+' · Diffuse','material');if(a.width!==p.resolution||a.height!==p.resolution)throw fail('输出不是要求的正方形贴图。',422);
    const fidelity=['ai','direct_ai','local_refine','image_edit'].includes(p.textureMode)?await textureDeviation(Buffer.from(qualityReference.split(',')[1],'base64'),await readFile(store.file(a.id))):{colorShift:0,warnings:[]};
    if(result.warnings){fidelity.warnings.push(...result.warnings);fidelity.requiresReview=!!fidelity.warnings.length;}
    if(repairReport){fidelity.rejected=!!fidelity.rejected||!!repairReport.rejected;fidelity.warnings.push(...repairReport.warnings);fidelity.requiresReview=!!fidelity.warnings.length;}
    const previewImage=result.preview||'data:image/png;base64,'+(await sharp(await readFile(store.file(a.id))).resize(256,256).png().toBuffer()).toString('base64');
    const tile=await sharp(Buffer.from(previewImage.split(',')[1],'base64')).metadata();
    const preview=tile.width===768?await saveImage(c.project_id,previewImage,c.name+' · 3×3预览','material'):await saveImage(c.project_id,'data:image/png;base64,'+(await sharp({create:{width:768,height:768,channels:3,background:'#ffffff'}}).composite(Array.from({length:9},(_,i)=>({input:Buffer.from(previewImage.split(',')[1],'base64'),left:(i%3)*256,top:Math.floor(i/3)*256}))).png().toBuffer()).toString('base64'),c.name+' · 3×3预览','material');
    const provenance={sourceAssetId:c.source_asset_id,rectifiedAssetId:m.rectifiedAssetId,maskAssetId:c.mask_asset_id,geometry:m.geometry,sourceHash:createHash('sha256').update(sample).digest('hex')};
    const version=store.put('materials',{id:newId(),project_id:c.project_id,candidate_id:c.id,task_id:t.id,asset_id:a.id,code:'MAT-'+String(store.all('materials',c.project_id).length+1).padStart(3,'0'),name:c.name,category:c.category,part:c.part,color:'',sources:structuredClone(c.sources),parameters:{resolution:p.resolution,seamless:p.textureMode==='traditional'?!!result.quality_report?.seams?.applied:['faithful','local_refine','direct_ai','image_edit'].includes(p.textureMode)?false:p.seamless,seamlessRequested:!!p.seamless,textureMode:p.textureMode,restoration:p.restoration,fidelity:p.fidelity,materialType:p.materialType,ai_inferred:!!result.ai_inferred,sr_applied:!!result.sr_applied,chosen_algorithm:result.chosen_algorithm,quality_report:result.quality_report,preview_3x3_id:preview.id,source_provenance:provenance,baseVersionId:p.baseVersionId,rawCandidateId:result.rawCandidateId,evidenceHash:p.evidenceHash,pipeline:preparation?.pipeline||'faithful',preparation,modelId:p.modelId,modelUpdatedAt:p.modelUpdatedAt},confirmed:false,physical_width_m:null,physical_height_m:null,created_at:now()});result={texture_png_id:a.id,preview_3x3_id:preview.id,quality_report:result.quality_report,chosen_algorithm:result.chosen_algorithm,sr_applied:!!result.sr_applied,ai_inferred:!!result.ai_inferred,source_provenance:provenance,warnings:result.warnings,rawCandidateId:result.rawCandidateId,assetId:a.id,version_id:version.id,versionId:version.id,fidelity,preparation,repairReport,requestId:result.requestId,method:p.textureMode};
   }else throw fail('不支持的本地任务。');
   c.revision++;store.transaction(()=>{store.put('candidates',c);store.put('tasks',{...t,status:'completed',stage:'完成，等待用户确认下一步',result,updated_at:now()});});
  }catch(e){store.put('tasks',{...t,status:'failed',stage:'未完成',error_code:e.code,error_message:(e.message||'处理失败')+(store.get('usage',t.id)?' 本次模型请求可能已计费，重试须主动确认。':''),updated_at:now()});}
 }
 async function drain(){if(working||closed)return;working=true;try{for(;;){const t=store.all('tasks').reverse().find(t=>t.status==='queued');if(!t||closed)break;await execute(t);}}finally{working=false;if(closed)store.close();}}
 function schedule(){setImmediate(()=>drain().catch(e=>console.error('Local task failure',{name:e.name})));}
 function responseCandidate(c){return json({candidate:c});}
 const batch=createBatchDiscovery({store,project,asset,configuration,preferences,dataImage,saveImage,processor,recorded,queue,execute,schedule,providers});
 async function handle(request,admin=false){
  try{
   const url=new URL(request.url),route=url.pathname,post=request.method==='POST';
   if(route==='/api/config')return json({configured:true,local:true,token,userId:localOwner,workspaceId:localWorkspace});
   if(route==='/api/health')return json({ok:true,architecture:'separated',mode:'local',database:'sqlite'});
   if(route==='/api/community/featured')return json({available:false,cases:[]});
   if(/^\/api\/local\/files\/[^/]+$/.test(route)&&request.method==='GET'){const a=asset(route.split('/').at(-1));return new Response(await readFile(store.file(a.id)),{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','Cross-Origin-Resource-Policy':'same-origin'}});}
   const supplied=Buffer.from(request.headers.get('authorization')||''),expected=Buffer.from('Bearer '+token);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return json({error:'请从本机工作台进入。'},401);
   if(route.startsWith('/api/local/upload/')){
    if(!post)return json({error:'请使用 POST。'},405);const a=store.get('assets',uid(route.split('/').at(-1)));if(!a||a.status!=='pending'||a.uploadToken!==request.headers.get('x-upload-token')||Date.now()>a.uploadExpires)throw fail('上传凭证无效或已过期。',403);const bytes=Buffer.from(await request.arrayBuffer());if(bytes.length!==a.expectedSize)throw fail('上传内容不完整，文件大小不符。',413);const ready=await saveImage(a.project_id,bytes,a.name,a.kind,a.id);return json({asset:signed(ready)});
   }
   const p=post?await request.json():{};
   if(route==='/api/materials/discover'&&post)return json(batch.start(p),202);
   if(route==='/api/materials/discovery/cancel'&&post)return json(batch.cancel(p));
   if(route==='/api/local/preferences'){
    if(!post)return json({preferences:preferences(),models:catalog(),hub:hubStatus()});
    if(!['color'].includes(p.recognitionMethod))throw fail('请选择识别方式。');
    const selected={};for(const kind of ['recognition','reconstruction','discovery']){const id=p.models?.[kind]||'';if(id){const model=store.get('models',uid(id));if(!model||model.kind!==kind||(kind==='recognition'&&model.protocol!=='dashscope'&&!isHubModel(model))||model.disabled)throw fail('所选模型不可用，请重新选择。');}selected[kind]=id;}
    if(hubDescriptor)for(const kind of ['recognition','discovery']){const hubModel=preferences().models[kind];if(hubModel)selected[kind]=hubModel;}
    return json({preferences:store.put('settings',{id:'user-preferences',recognitionMethod:p.recognitionMethod,models:selected})});
   }
   if(route==='/api/local/models'){
    if(post&&!admin)throw fail('模型配置仅允许在本机管理中心修改。',403);
    if(!post)return json({models:localCatalog(),hub:hubStatus()});
    if(p.action==='delete'){const target=store.get('models',uid(p.id));if(isHubModel(target))throw fail('中枢托管模型由企业内部中枢维护，请在中枢里调整。',403);deleteModelConfiguration(store,uid(p.id));return json({models:localCatalog()});}
    if(p.id&&store.all('tasks').some(t=>['queued','processing'].includes(t.status)&&(t.parameters?.modelId===p.id||Object.values(t.parameters?.models||{}).includes(p.id))))throw fail('模型正在被任务使用，请等待任务结束后修改。',409);
    if(p.id&&isHubModel(store.get('models',uid(p.id))))throw fail('中枢托管模型由企业内部中枢维护，请在中枢里调整。',403);
    if(p.action==='disable'){const m=store.get('models',uid(p.id));if(!m)throw fail('模型不存在。',404);m.disabled=!!p.disabled;m.updated_at=now();store.put('models',m);return json({models:localCatalog()});}
    if(!['recognition','reconstruction','discovery'].includes(p.kind))throw fail('请选择材质模型用途。');
    if(p.kind==='recognition'&&p.protocol!=='dashscope')throw fail('材质识别仅支持阿里百炼。');
    const valid=validateModel(p),old=p.id?store.get('models',uid(p.id)):null;if(p.id&&!old)throw fail('模型配置不存在。',404);if(!valid.key&&!old?.secret)throw fail('请填写模型密钥。');store.put('models',{...valid,key:undefined,id:valid.id||newId(),secret:valid.key?store.encrypt(valid.key):old.secret,disabled:false,updated_at:now()});return json({models:catalog()});
   }
   if(route==='/api/platform'&&!post){const projectId=url.searchParams.get('projectId');if(projectId)project(projectId);return json({preferences:preferences(),models:catalog(),processor:{mode:'local',online:true},tasks:store.all('tasks',projectId||undefined),candidates:store.all('candidates',projectId||undefined),materials:store.all('materials',projectId||undefined),revision:store.version});}
   if(route==='/api/v1/recycle-bin/empty'&&post){if(!Array.isArray(p.projectIds)||p.projectIds.some(id=>typeof id!=='string'))throw fail('请选择回收站项目。');return json(emptyRecycleBin(store,p.projectIds));}
   if(route==='/api/v1/folders'){return post?json({folder:createFolder(store,p)},201):json({folders:store.all('folders')});}
   const organizeRoute=route.match(/^\/api\/v1\/projects\/([^/]+)\/organize$/);
   if(organizeRoute&&post)return json({project:updateProjectOrganization(store,uid(organizeRoute[1]),p)});
   if(route==='/api/v1/projects'){
    if(post){const data=projectCreateInput.parse(p);if(data.purpose!=='extract')throw fail('单机模式目前聚焦材质提取，请创建材质项目。');const value={...data,id:newId(),workspace_id:localWorkspace,status:'active',created_at:now()};store.put('projects',value);return json({project:value},201);}
    return json({projects:store.all('projects').map(p=>{const a=store.all('assets',p.id).find(a=>a.kind==='source'&&a.status==='ready');return {...p,coverUrl:a?'/api/local/files/'+a.id:null};})});
   }
   const projectRoute=route.match(/^\/api\/v1\/projects\/([^/]+)(?:\/(assets|versions|jobs))?$/);
   if(projectRoute){const value=project(projectRoute[1]),kind=projectRoute[2];if(!kind&&post){const data=projectUpdateInput.parse(p);if(store.all('tasks',value.id).some(t=>['queued','processing'].includes(t.status)))throw fail('项目有任务在运行，请完成后再修改。',409);return json({project:store.put('projects',{...value,...data})});}if(kind==='assets')return json({assets:store.all('assets',value.id).filter(a=>a.status==='ready'&&a.kind!=='receipt').map(signed)});if(kind==='versions')return json({versions:[]});if(kind==='jobs')return json({jobs:[]});return json({project:value});}
   if(route==='/api/v1/uploads'&&post){const input=uploadInput.parse(p);project(input.projectId);const a=store.put('assets',{id:newId(),project_id:input.projectId,workspace_id:localWorkspace,name:input.name,kind:input.kind,status:'pending',expectedSize:input.size,uploadToken:randomBytes(24).toString('hex'),uploadExpires:Date.now()+600000,created_at:now()});return json({assetId:a.id,path:a.id,token:a.uploadToken});}
   const complete=route.match(/^\/api\/v1\/uploads\/([^/]+)\/complete$/);if(complete&&post)return json({asset:signed(asset(complete[1]))});
   if(route==='/api/materials/export'&&post){project(p.projectId);const versions=store.all('materials',p.projectId).filter(m=>m.confirmed);if(!versions.length)throw fail('请先确认至少一份材质入库。');const files=await Promise.all(versions.map(async m=>({name:'textures/'+m.code+'_'+m.id+'_Diffuse.png',data:new Uint8Array(await readFile(store.file(asset(m.asset_id).id)))})));files.push({name:'materials.json',data:JSON.stringify(versions,null,2)});return new Response(zipArchive(files),{headers:{'Content-Type':'application/zip'}});}
   if(route==='/api/materials/create'&&post){project(p.projectId);if(asset(p.sourceAssetId).project_id!==p.projectId)throw fail('来源图片不属于当前项目。');const previous=store.get('settings','request-'+uid(p.requestId));if(previous){const saved=store.get('candidates',previous.candidateId);if(saved.project_id!==p.projectId||saved.source_asset_id!==p.sourceAssetId||JSON.stringify(saved.sources[0].selection)!==JSON.stringify(p.selection))throw fail('重复请求编号与原始选区不一致。',409);return json(saved);}const selection=selectionInput.parse(p.selection);if(selection.type!=='point')throw fail('请点选目标材质。');const c={id:newId(),project_id:p.projectId,source_asset_id:p.sourceAssetId,group_id:newId(),name:'待局部识别材质',category:'其他',kind:'重复纹理',part:'',description:'',quad:null,sources:[{region:0,quad:null,selection,resolution:p.resolution||1024,seamless:p.seamless!==false,recognitionModelId:preferences().models.recognition||p.recognitionModelId,reconstructionModelId:preferences().models.reconstruction||p.reconstructionModelId}],risks:[],confidence:0,confirmed:false,dismissed:false,revision:1};store.transaction(()=>{store.put('candidates',c);store.put('settings',{id:'request-'+p.requestId,candidateId:c.id});});return json(c,201);}
   if(route==='/api/platform'&&post&&p.action==='retry'){
    if(store.get('tasks',p.taskId)?.kind==='discovery')throw fail('请从一键识别入口发起新的批次。',409);
    const t=store.get('tasks',uid(p.taskId));if(!t||t.project_id!==p.projectId||t.status!=='failed')throw fail('只能重试失败任务。');if(store.get('usage',t.id)&&p.acknowledgeCost!==true)throw fail('请确认可能的模型费用。');const c=store.get('candidates',t.parameters.candidate.id);if(t.kind==='reconstruction'&&t.parameters.textureMode==='ai')throw fail('旧整图重绘任务已停用，请使用当前纹理重建。',409);if(t.kind==='reconstruction')validateLocalReconstruction(c,t.parameters);if(evidence(c,t.parameters)!==t.parameters.evidenceHash)throw fail('输入已改变，请重新提交对应步骤。',409);queue(c,t.kind,{...t.parameters,requestId:newId(),recoverTaskId:store.get('receipts',t.id)?.status==='completed'?t.id:(t.parameters.recoverTaskId||t.id)});return json({accepted:true},202);
   }
   if(route==='/api/platform'&&post&&['confirm_material','edit_material'].includes(p.action)){
    const v=store.get('materials',uid(p.versionId));if(!v||v.project_id!==p.projectId)throw fail('材质版本不存在。',404);const t=store.get('tasks',v.task_id);if(p.action==='confirm_material'){if(p.qualityReviewed!==true||t?.result?.fidelity?.rejected===true||Number(t?.result?.fidelity?.colorShift)>45)throw fail('请先检查颜色、纹理一致性与接缝；已判定偏离原材质的版本不能入库。');v.confirmed=true;store.put('materials',v);return json(v);}const a=asset(p.assetId);if(a.project_id!==p.projectId||a.kind!=='material'||a.width!==a.height)throw fail('编辑结果不是当前项目的正方形贴图。');const value={...v,id:newId(),asset_id:a.id,confirmed:false,parameters:{...v.parameters,edits:p.edits},created_at:now()};store.put('materials',value);return json(value);
   }
   if(route==='/api/materials/clear'&&post){project(p.projectId);if(asset(p.sourceAssetId).project_id!==p.projectId)throw fail('图片不属于当前项目。');return json(clearMaterialTasks(store,p.projectId,p.sourceAssetId,p.candidates));}
   if((route.startsWith('/api/materials/')||route==='/api/platform')&&post){
    if(route==='/api/materials/segment'||p.action==='segment')throw fail('此识别接口已移除。',410);project(p.projectId);const existing=p.requestId?store.get('tasks',uid(p.requestId)):null;if(existing){if(existing.project_id!==p.projectId)throw fail('任务不属于此项目。',403);return responseCandidate(store.get('candidates',existing.parameters.candidate.id));}
    const c=getCandidate(p),m=c.sources[0],action=route==='/api/platform'?p.action:route.split('/').at(-1);if(currentJobs(c).length||['queued','processing'].includes(store.get('tasks',m.batchId)?.status))throw fail('请等待当前材质任务完成。',409);
    if(action==='candidate'){if(typeof p.name!=='string'||!p.name.trim()||p.name.length>80||!category.includes(p.category)||!kinds.includes(p.kind)||typeof p.part!=='string'||p.part.length>200||typeof p.description!=='string'||p.description.length>2000)throw fail('请核对材质字段。');if(p.quad)quadInput.parse(p.quad);if(JSON.stringify(p.quad)!==JSON.stringify(c.quad)){delete m.rectifiedAssetId;delete m.geometry;delete m.infoConfirmation;}if(p.notes!==undefined){if(typeof p.notes!=='string'||p.notes.length>2000)throw fail('补充说明格式无效。');m.userNotes=p.notes;}Object.assign(c,{name:p.name.trim(),category:p.category,kind:p.kind,part:p.part,description:p.description,quad:p.quad,confirmed:false,dismissed:!!p.dismissed});c.revision++;store.put('candidates',c);return json(c);}
    if(action==='mask'){const a=asset(p.assetId);if(a.project_id!==p.projectId||a.kind!=='mask'||a.width!==asset(c.source_asset_id).width||a.height!==asset(c.source_asset_id).height)throw fail('Mask 需与原图同尺寸。');c.mask_asset_id=a.id;invalidate(c);}
    else if(action==='accept_presegment'){if(!m.presegmentation?.assetId)throw fail('请先生成候选 Mask。');c.mask_asset_id=asset(m.presegmentation.assetId).id;invalidate(c);if(p.confirmFinal===true)m.maskConfirmation={assetId:c.mask_asset_id};}
    else if(action==='confirm_info'){if(!finalMaskConfirmed(c)||!m.rectifiedAssetId||!c.name.trim()||c.name.includes('待局部识别')||!c.description.trim())throw fail('请先完成 Mask、透视和材质信息。');m.userNotes=String(p.notes||'').slice(0,2000);m.featureSource=m.features?'ai-confirmed':'manual-confirmed';m.infoConfirmation={...Object.fromEntries(['name','category','kind','part','description'].map(k=>[k,c[k]])),maskAssetId:c.mask_asset_id,rectifiedAssetId:m.rectifiedAssetId,notes:m.userNotes};}
    else if(['presegment','rectify','recognize','reconstruct'].includes(action)){
     let kind={presegment:'presegmentation',rectify:'rectification',recognize:'recognition',reconstruct:'reconstruction'}[action];
     if(['rectify','recognize','reconstruct'].includes(action)&&!c.mask_asset_id)throw fail('请先采用或保存 Mask。');
     if(['recognize','reconstruct'].includes(action)&&(!finalMaskConfirmed(c)||!m.rectifiedAssetId))throw fail('请先确认 Mask 并完成透视处理。');
     if(action==='rectify'&&p.quad)quadInput.parse(p.quad);
     if(action==='reconstruct'){validateLocalReconstruction(c,p);const g=materialGenerationState(c,{notes:m.userNotes||''});if(!g.ready)throw fail(g.reason);if(!['frontal','rectified'].includes(m.geometry?.status))throw fail('请先确认四角并完成正视矫正。');if(!Number.isSafeInteger(p.resolution)||p.resolution<1)throw fail('输出分辨率请填写大于 0 的整数，例如 1024。');if(!['traditional','local_refine','faithful','direct_ai','image_edit'].includes(p.textureMode))throw fail('当前纹理处理方式已更新，请刷新页面后重新提交。');}
     if(action==='reconstruct'){
      if(!['auto_conservative','off','enhance'].includes(p.restoration||'auto_conservative')||!['strict','moderate'].includes(p.fidelity||'strict')||!['auto','uniform','random','directional','periodic','complex'].includes(p.materialType||'auto'))throw fail('纹理合成设置无效。');
      if(p.textureMode==='image_edit'){
       if(typeof p.instruction!=='string'||!p.instruction.trim()||p.instruction.length>4000)throw fail('请输入有效修改内容（最多 4000 字）。');
       const base=store.get('materials',uid(p.baseVersionId));if(!base||base.project_id!==c.project_id||base.candidate_id!==c.id)throw fail('修改来源不属于当前材质。');p.resolution=asset(base.asset_id).width;
      }
      if(p.textureMode==='local_refine'){
       if(p.instruction!==undefined&&(typeof p.instruction!=='string'||p.instruction.length>4000))throw fail('修改要求格式无效或超过 4000 字。');
       const base=store.get('materials',uid(p.baseVersionId));if(!base||base.project_id!==c.project_id||base.candidate_id!==c.id)throw fail('精修来源不属于当前材质。');
       const mask=asset(uid(p.refineMaskId));if(mask.project_id!==c.project_id||mask.kind!=='mask')throw fail('请选择当前项目的局部修复选区。');
       const original=asset(base.asset_id);if(mask.width!==original.width||mask.height!==original.height)throw fail('修复选区尺寸必须与贴图一致。');
       const pixels=await sharp(await readFile(store.file(mask.id))).removeAlpha().greyscale().raw().toBuffer();const count=pixels.reduce((n,v)=>n+(v>=128?1:0),0);if(count<1||count>pixels.length*.5)throw fail('请只标记局部缺陷，精修范围不能超过贴图的一半。');
       if(p.referenceImageId&&asset(uid(p.referenceImageId)).project_id!==c.project_id)throw fail('参考图不属于当前项目。');
       p.resolution=original.width;
      }
     }
     let modelId=preferences().models[kind]||(action==='recognize'?m.recognitionModelId:m.reconstructionModelId);
     if(kind==='recognition'&&store.get('models',modelId)?.protocol!=='dashscope')modelId=undefined;if(!modelId)modelId=store.all('models').find(m=>m.kind===kind&&!m.disabled&&(kind!=='recognition'||m.protocol==='dashscope'))?.id;queue(c,kind,{...p,modelId,sensitivity:Math.min(.9,Math.max(.1,Number(p.sensitivity)||.5)),radius:Math.min(1,Math.max(.05,Number(p.radius)||.35))});return responseCandidate(c);
    }else throw fail('单机材质工作台不支持此操作。',404);
    c.revision++;store.put('candidates',c);return route==='/api/platform'?json(c):responseCandidate(c);
   }
   return json({error:'此功能不属于单机材质工作台。'},404);
  }catch(e){return json({error:e.name==='ZodError'?'参数格式无效，请检查后重试。':e.status?e.message:(e.message||'本地操作失败。')},e.name==='ZodError'?400:e.status||500);}
 }
 schedule();return {handle,handleAdmin:request=>handle(request,true),store,token,drain,close:()=>{closed=true;if(!working)store.close();}};
}
