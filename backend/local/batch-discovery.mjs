import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import {discoverMaterialRegions,parseDiscoveredRegions} from '../server/material-discovery.mjs';
import {splitDiscoveryTiles,mapRegion,mergeRegions} from '../server/discovery-tiles.mjs';
const active=t=>t&&['queued','processing'].includes(t.status);
const now=()=>new Date().toISOString();
export async function constrainMaskToBounds(image,b){
 if(!b||![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.width<=0||b.height<=0)throw Error('目标范围无效。');
 const {data,info}=await sharp(Buffer.from(image.split(',')[1],'base64'),{limitInputPixels:false}).flatten({background:'#000'}).greyscale().raw().toBuffer({resolveWithObject:true});
 const left=Math.max(0,Math.ceil(b.x*(info.width-1))),top=Math.max(0,Math.ceil(b.y*(info.height-1))),right=Math.min(info.width-1,Math.floor((b.x+b.width)*(info.width-1))),bottom=Math.min(info.height-1,Math.floor((b.y+b.height)*(info.height-1)));
 let count=0;for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const i=y*info.width+x;if(x<left||x>right||y<top||y>bottom)data[i]=0;else if(data[i]>=128)count++;}
 if(!count)throw Error('目标范围内没有有效选区，请调整识别位置。');
 return 'data:image/png;base64,'+(await sharp(data,{raw:{width:info.width,height:info.height,channels:1}}).png().toBuffer()).toString('base64');
}
export function createBatchDiscovery({store,project,asset,configuration,preferences,dataImage,saveImage,processor,recorded,queue,execute,schedule,providers}){
 const update=(id,patch)=>store.put('tasks',{...store.get('tasks',id),...patch,updated_at:now()});
 function start(p){
  project(p.projectId);const source=asset(p.sourceAssetId);if(source.project_id!==p.projectId)throw Error('来源图片不属于当前项目。');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.requestId||''))throw Error('请求编号无效。');
  const previous=store.get('tasks',p.requestId);if(previous){if(previous.kind!=='discovery'||previous.project_id!==p.projectId||previous.source_asset_id!==p.sourceAssetId)throw Error('重复请求编号不匹配。');return previous;}
  if(p.acknowledgeCost!==true)throw Error('请先确认批量调用及图片发送范围。');
  if(store.all('tasks',p.projectId).some(active))throw Error('请等待当前项目任务完成。');
  const discoveryTiles=Math.min(3,Math.max(1,Math.trunc(Number(p.discoveryTiles)||1)));
  const pref=preferences(),models={},modelVersions={};
  for(const kind of ['discovery','recognition','reconstruction']){
   const id=pref.models[kind];if(!id)throw Error('请在模型配置里指定“'+({discovery:'材质区域发现',recognition:'材质信息识别',reconstruction:'纹理重建'}[kind])+'”。');
   const config=configuration(id,kind);models[kind]=id;modelVersions[kind]=config.updated_at;
   // 分块发现会按块逐一调用模型，每次调用各计一次用量，因此按块数预留余量。
   const needed=kind==='discovery'?discoveryTiles*discoveryTiles:1;
   const used=store.all('usage').filter(u=>u.kind===kind&&u.month===now().slice(0,7)).length;
   if(used+needed>100)throw Error('本月 '+kind+' 剩余用量不足本次 '+needed+' 次调用，请降低分块数或等待下月。');
  }
  const parameters={models,modelVersions,recognitionMethod:'color',discoveryTiles,resolution:1024,seamless:true,evidenceHash:createHash('sha256').update(JSON.stringify({source:p.sourceAssetId,models,modelVersions})).digest('hex')};
  const t=store.put('tasks',{id:p.requestId,project_id:p.projectId,source_asset_id:p.sourceAssetId,kind:'discovery',status:'queued',stage:'等待发现材质',parameters,result:{items:[]},created_at:now(),updated_at:now()});schedule();return t;
 }
 function cancel(p){const t=store.get('tasks',p.taskId);if(!t||t.kind!=='discovery'||t.project_id!==p.projectId)throw Error('批量任务不存在。');if(active(t))update(t.id,{cancelRequested:true,stage:'将在当前步骤结束后停止'});return store.get('tasks',t.id);}
 const cancelled=id=>store.get('tasks',id)?.cancelRequested;
 function checkModels(t){for(const [kind,id] of Object.entries(t.parameters.models))if(['discovery','recognition','reconstruction'].includes(kind)&&configuration(id,kind).updated_at!==t.parameters.modelVersions[kind])throw Error('模型配置已变化，请检查后重新发起。');}
 async function run(t){
  if(cancelled(t.id)){update(t.id,{status:'cancelled',stage:'已停止'});return;}
  checkModels(t);
  const source=await dataImage(t.source_asset_id);
  const grid=Math.min(3,Math.max(1,Math.trunc(Number(t.parameters.discoveryTiles)||1)));
  const tiles=await splitDiscoveryTiles(source,{grid}),found=[],failures=[];
  for(const [index,tile] of tiles.entries()){
   if(cancelled(t.id))break;
   checkModels(t);
   update(t.id,{stage:tiles.length>1?'正在发现材质区域 '+(index+1)+'/'+tiles.length:'正在发现材质区域'});
   try{
    const result=await recorded(t,()=> (providers.discover||discoverMaterialRegions)(tile.image,configuration(t.parameters.models.discovery,'discovery')),undefined,{receiptKey:'-t'+(index+1)});
    for(const region of parseDiscoveredRegions(result).regions)found.push(mapRegion(region,tile.rect));
   }catch(e){if(e.cancelled)throw e;failures.push({tile:index+1,reason:e.message});}
  }
  if(cancelled(t.id)){update(t.id,{status:'cancelled',stage:'已停止'});return;}
  const merged=mergeRegions(found);
  if(!merged.length)throw Error(failures.length?'各分块均未发现可靠材质：'+failures.map(f=>'第'+f.tile+'块 '+f.reason).join('；'):'未发现可靠材质区域，可手动点选');
  const items=merged.map(r=>({...r,status:'pending',stage:'待处理'}));
  const progress=()=>update(t.id,{stage:'批量处理材质',result:{items}});
  progress();
  const acceptedMasks=[];
  for(const item of items){
   if(cancelled(t.id))break;
   const c={id:randomUUID(),project_id:t.project_id,source_asset_id:t.source_asset_id,group_id:randomUUID(),name:item.name,category:'其他',kind:'重复纹理',part:'',description:'',quad:null,sources:[{region:0,selection:{type:'point',point:item.point},resolution:1024,seamless:true,batchId:t.id,discoveryBounds:item.bounds}],risks:[],confidence:0,confirmed:false,dismissed:false,revision:1};
   item.candidateId=c.id;store.put('candidates',c);
   const save=c=>{c.revision++;store.put('candidates',c);};
   const step=async(kind,params={})=>{
    if(cancelled(t.id))throw Object.assign(Error('已停止后续处理'),{cancelled:true});checkModels(t);
    item.stage=({rectification:'透视矫正',recognition:'材质信息识别',reconstruction:'纹理重建'})[kind];progress();
    const child=queue(store.get('candidates',c.id),kind,{...params,requestId:randomUUID(),batchId:t.id,modelId:t.parameters.models[kind]});await execute(child);
    const result=store.get('tasks',child.id);if(result.status!=='completed')throw Error(result.error_message||'当前步骤未完成');return store.get('candidates',c.id);
   };
   try{
    item.status='processing';item.stage='寻找有效选区';progress();let current=c,options=[];
    {
     item.diagnostics=[];
     for(const sensitivity of [.2,.5,.8]){
      if(cancelled(t.id))throw Object.assign(Error('已停止后续处理'),{cancelled:true});
      try{const option=await processor({operation:'presegment',image:source,point:item.point,sensitivity,radius:.35});option.image=await constrainMaskToBounds(option.image,item.bounds);options.push(option);}
      catch(e){item.diagnostics.push({stage:'区域识别',sensitivity,reason:e.message});}
     }
     if(!options.length)throw Error('各档选区尝试均未成功：'+item.diagnostics.map(d=>d.reason).join('；'));
    }
    let best=null;
    for(const option of options){
     if(cancelled(t.id))throw Object.assign(Error('已停止后续处理'),{cancelled:true});
     let estimate;
     try{estimate=await processor({operation:'rectify',image:source,mask:option.image,estimateOnly:true});}
     catch(e){(item.diagnostics??=[]).push({stage:'自动取样',reason:e.message});continue;}
     const g=estimate.geometry,roi=g?.roi;
     if(g?.confidence!=='supported'||roi?.status!=='proposed'||!Array.isArray(g.quad)||g.quad.length!==4){(item.diagnostics??=[]).push({stage:'自动取样',reason:g?.reason||'几何依据不足',confidence:g?.confidence,roiStatus:roi?.status});continue;}
     const b=item.bounds;if(g.quad.some(p=>p.x<b.x||p.y<b.y||p.x>b.x+b.width||p.y>b.y+b.height)){(item.diagnostics??=[]).push({stage:'自动取样',reason:'取样四角超出发现模型提供的目标范围'});continue;}
     const score=(roi.areaFraction||0)/(1+Math.max(0,roi.appearanceCost||0));if(!best||score>best.score)best={...option,geometry:g,score};
    }
    if(!best){if(options[0]?.image&&!current.mask_asset_id){const fallback=await saveImage(t.project_id,options[0].image,item.name+' · 待检查选区','mask');current=store.get('candidates',c.id);current.mask_asset_id=fallback.id;save(current);}throw Error('未找到透视依据可靠且位于目标范围内的取样区，请手动确认选区与四角。');}
    const raw=await sharp(Buffer.from(best.image.split(',')[1],'base64')).resize(128,128,{fit:'fill',kernel:'nearest'}).flatten({background:'#000'}).greyscale().raw().toBuffer();
    if(acceptedMasks.some(other=>{let union=0,intersection=0;for(let i=0;i<raw.length;i++){const a=raw[i]>127,b=other[i]>127;union+=a||b?1:0;intersection+=a&&b?1:0;}return union&&intersection/union>.8;}))throw Error('选区与本批次已有材质重复，已跳过后续调用。');
    acceptedMasks.push(raw);
    const mask=await saveImage(t.project_id,best.image,item.name+' · 自动选区','mask');current=store.get('candidates',c.id);current.mask_asset_id=mask.id;current.sources[0].geometry=best.geometry;current.sources[0].maskConfirmation={assetId:mask.id,source:'batch'};save(current);
    current=await step('rectification',{quad:best.geometry.quad,automatic:true});
    current=await step('recognition');
    if(!current.description?.trim()||!current.part?.trim()||!Number.isFinite(current.confidence)||current.confidence<.6)throw Error('材质信息依据不足，请检查后手动确认。');
    const m=current.sources[0];m.featureSource='ai-confirmed';m.infoConfirmation={...Object.fromEntries(['name','category','kind','part','description'].map(k=>[k,current[k]])),maskAssetId:current.mask_asset_id,rectifiedAssetId:m.rectifiedAssetId,notes:m.userNotes||'',source:'batch'};save(current);
    await step('reconstruction',{textureMode:'direct_ai',resolution:1024,seamless:true});item.status='completed';item.stage='已生成，待检查入库';
   }catch(e){item.status=e.cancelled?'cancelled':'needs-review';item.stage=e.message;}
   progress();
  }
  for(const item of items)if(item.status==='pending'){item.status='cancelled';item.stage='未开始，已停止';}
  update(t.id,{status:cancelled(t.id)?'cancelled':'completed',stage:cancelled(t.id)?'已停止，保留已完成结果':items.length?'批量处理结束，请检查结果':'未发现可靠材质区域，可手动点选',result:{items}});
 }
 return {start,cancel,run};
}
