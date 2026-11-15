import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createLocalService,localRequestAllowed} from '../backend/local/service.mjs';
const uuid=()=>crypto.randomUUID();
async function fixture(t,{providers={},cpuFailure=false,reconstructionError=null,batchGeometry=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'qmx-local-'));const png=await sharp({create:{width:96,height:64,channels:3,background:'#b17452'}}).png().toBuffer();let failOutput=cpuFailure;
 const mask=await sharp({create:{width:96,height:64,channels:3,background:'#fff'}}).png().toBuffer();
 const quad=[{x:.05,y:.05},{x:.95,y:.05},{x:.95,y:.95},{x:.05,y:.95}];
 const cpu=async p=>{if(p.operation==='reconstruct_source'&&reconstructionError)throw reconstructionError;if(p.operation==='synthesize')return {image:'data:image/png;base64,'+png.toString('base64'),repairMask:'data:image/png;base64,'+mask.toString('base64'),referenceImage:'data:image/png;base64,'+png.toString('base64'),preparation:{method:'fixture-quilting'}};if(p.operation==='presegment')return {image:'data:image/png;base64,'+mask.toString('base64'),presegmentation:{method:'SLIC-Lab-LBP-Gabor',superpixels:100},boundary:{x:0,y:0,width:1,height:1}};if(p.operation==='rectify')return {image:'data:image/png;base64,'+png.toString('base64'),geometry:{status:p.estimateOnly?'needs-review':'rectified',quad,...(batchGeometry?{confidence:'supported',roi:{status:'proposed',areaFraction:.8,appearanceCost:0}}:{})}};if(failOutput){failOutput=false;throw Error('fixture: output save failed');}return {image:'data:image/png;base64,'+(await sharp(png).resize(p.resolution,p.resolution).png().toBuffer()).toString('base64')};};
 let service=createLocalService({directory,cpu,providers,env:{}});
 t.after(async()=>{service.close();if(!path.basename(directory).startsWith('qmx-local-'))throw Error('Invalid test directory');await rm(directory,{recursive:true,force:true});});
 const call=async(route,body,extra={})=>{const r=await (route==='/api/local/models'&&body!==undefined?service.handleAdmin:service.handle)(new Request('http://127.0.0.1:4191'+route,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+service.token,'content-type':'application/json',...extra.headers},body:body===undefined?undefined:body instanceof Buffer?body:JSON.stringify(body)}));if(r.status>=400)throw Object.assign(Error((await r.json()).error),{status:r.status});return r;};
 const data=async(...args)=>(await call(...args)).json();
 const p=(await data('/api/v1/projects',{name:'离线项目',purpose:'extract'})).project;
 const ticket=await data('/api/v1/uploads',{projectId:p.id,name:'source.png',mime:'image/png',size:png.length,kind:'source'});await call('/api/local/upload/'+ticket.path,png,{headers:{'x-upload-token':ticket.token}});const a=(await data('/api/v1/uploads/'+ticket.assetId+'/complete',{})).asset;
 const candidate=await data('/api/materials/create',{projectId:p.id,sourceAssetId:a.id,requestId:uuid(),selection:{type:'point',point:{x:.5,y:.5}},resolution:1024});
 const current=()=>service.store.get('candidates',candidate.id);
 const advance=async(action,extra={})=>data('/api/materials/'+action,{projectId:p.id,candidateId:candidate.id,revision:current().revision,requestId:uuid(),...extra});
 async function settle(){for(let i=0;i<300;i++){await service.drain();if(!service.store.all('tasks').some(t=>['processing','queued'].includes(t.status)))return;await new Promise(r=>setTimeout(r,10));}throw Error('Task timed out');}
 async function prepared(){await advance('presegment');await settle();await advance('accept_presegment',{confirmFinal:true});assert.equal(current().sources[0].maskConfirmation.assetId,current().mask_asset_id);await advance('rectify');await settle();assert.equal(current().sources[0].geometry.status,'needs-review');await advance('rectify',{quad});await settle();const c=current();await data('/api/platform',{action:'candidate',projectId:p.id,candidateId:c.id,revision:c.revision,name:'红砖',category:'砖材',kind:'重复纹理',part:'墙面',description:'红棕色细颗粒，水平错缝',quad:c.quad});await advance('confirm_info',{notes:'真实本机证据'});}
 return {directory,p,a,call,data,advance,current,settle,prepared,png,get service(){return service;},restart(){service.close();service=createLocalService({directory,cpu,providers,env:{}});}};
}
async function refineParams(f){
 const image=await sharp(f.png).resize(1024,1024).png().toBuffer();
 const mask=await sharp({create:{width:1024,height:1024,channels:3,background:'#000'}}).composite([{input:await sharp({create:{width:128,height:128,channels:3,background:'#fff'}}).png().toBuffer(),left:200,top:200}]).png().toBuffer();
 async function upload(buffer,kind){const ticket=await f.data('/api/v1/uploads',{projectId:f.p.id,name:kind+'.png',mime:'image/png',size:buffer.length,kind});await f.call('/api/local/upload/'+ticket.path,buffer,{headers:{'x-upload-token':ticket.token}});return (await f.data('/api/v1/uploads/'+ticket.assetId+'/complete',{})).asset;}
 const base=await upload(image,'material'),m=await upload(mask,'mask');const id=uuid();f.service.store.put('materials',{id,project_id:f.p.id,candidate_id:f.current().id,asset_id:base.id,confirmed:false,created_at:new Date().toISOString()});return {textureMode:'local_refine',resolution:1024,baseVersionId:id,refineMaskId:m.id,seamless:false};
}

test('SQLite local workflow persists actual files, revisions, approvals and exported materials without Supabase',async t=>{
 const f=await fixture(t);await f.prepared();await f.advance('reconstruct',{textureMode:'faithful',resolution:1024,seamless:false});await f.settle();let versions=f.service.store.all('materials');assert.equal(versions.length,1);const v=versions[0];assert.equal(v.confirmed,false);await f.data('/api/platform',{action:'confirm_material',projectId:f.p.id,versionId:v.id,qualityReviewed:true});
 const output=f.service.store.get('assets',v.asset_id),meta=await sharp(await readFile(f.service.store.file(output.id))).metadata();assert.equal(meta.width,1024);assert.equal(meta.height,1024);const zip=await f.call('/api/materials/export',{projectId:f.p.id});assert.equal(zip.headers.get('content-type'),'application/zip');assert.deepEqual([...new Uint8Array(await zip.arrayBuffer()).subarray(0,2)],[80,75]);
 f.restart();assert.equal((await f.data('/api/v1/projects')).projects[0].id,f.p.id);assert.equal(f.service.store.all('materials')[0].confirmed,true);assert.equal(f.service.store.all('usage').length,0);
});
test('local model keys remain encrypted and a recovered AI result is not submitted to the provider twice',async t=>{
 let calls=0;const image='data:image/png;base64,'+(await sharp({create:{width:1024,height:1024,channels:3,background:'#b17452'}}).png().toBuffer()).toString('base64');
 const f=await fixture(t,{providers:{reconstruct:async()=>{calls++;return {image,model:'fixture-image',requestId:'fixture-request'};}}});await f.prepared();
 const saved=await f.data('/api/local/models',{name:'测试模型',kind:'reconstruction',protocol:'dashscope',baseURL:'https://dashscope.aliyuncs.com',model:'fixture-image',apiKey:'fixture-not-a-real-secret'});assert.equal(JSON.stringify(saved).includes('fixture-not-a-real-secret'),false);const model=saved.models[0];assert.equal(f.service.store.get('models',model.id).secret.includes('fixture-not-a-real-secret'),false);
 const c=f.current();c.sources[0].reconstructionModelId=model.id;f.service.store.put('candidates',c);await f.advance('reconstruct',await refineParams(f));await f.settle();const failed=f.service.store.all('tasks').find(t=>t.kind==='reconstruction');assert.equal(failed.status,'completed');failed.status='failed';f.service.store.put('tasks',failed);assert.equal(calls,1);
 await f.data('/api/platform',{action:'retry',projectId:f.p.id,taskId:failed.id,acknowledgeCost:true});await f.settle();assert.equal(calls,1);assert.equal(f.service.store.all('materials').length,3);assert.equal(f.service.store.all('usage').length,1);f.restart();assert.equal(f.service.store.decrypt(f.service.store.get('models',model.id).secret),'fixture-not-a-real-secret');
});
test('local endpoints reject foreign projects, invalid tokens, traversal and stale revisions',async t=>{
 const f=await fixture(t);assert.throws(()=>createLocalService({directory:f.directory,env:{}}),/另一个后台/);const r=await f.service.handle(new Request('http://localhost/api/v1/projects'));assert.equal(r.status,401);
 await assert.rejects(f.data('/api/v1/uploads',{projectId:uuid(),name:'x.png',mime:'image/png',size:20,kind:'source'}),/项目不存在/);
 await assert.rejects(f.data('/api/materials/presegment',{projectId:f.p.id,candidateId:f.current().id,revision:999,requestId:uuid()}),/任务已更新/);
 const media=await f.service.handle(new Request('http://localhost/api/local/files/not-an-id'));assert.equal(media.status,400);
 const req={socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:4191',origin:'http://127.0.0.1:4173'}};assert.equal(localRequestAllowed(req),true);assert.equal(localRequestAllowed({...req,socket:{remoteAddress:'10.0.0.1'}}),false);assert.equal(localRequestAllowed({...req,headers:{...req.headers,host:'evil.example:4191'}}),false);
});

test('AI monthly limit rejects work before invoking a provider',async t=>{
 let calls=0;const f=await fixture(t,{providers:{reconstruct:async()=>{calls++;throw Error('must not call');}}});await f.prepared();const config=await f.data('/api/local/models',{name:'额度验证',kind:'reconstruction',protocol:'dashscope',baseURL:'https://dashscope.aliyuncs.com',model:'fixture-image',apiKey:'fixture-key'});const c=f.current();c.sources[0].reconstructionModelId=config.models[0].id;f.service.store.put('candidates',c);for(let i=0;i<100;i++)f.service.store.put('usage',{id:uuid(),kind:'reconstruction',month:new Date().toISOString().slice(0,7)});await f.advance('reconstruct',await refineParams(f));await f.settle();assert.equal(calls,0);assert.match(f.service.store.all('tasks').find(t=>t.kind==='reconstruction').error_message,/100/);
});

test('untrusted recognition output cannot replace project, candidate or asset identity',async t=>{
 const f=await fixture(t,{providers:{recognize:async(images)=>{assert.equal(images.length,4);return ({material:{id:uuid(),project_id:uuid(),sources:[],name:'识别砖材',category:'砖材',kind:'重复纹理',part:'墙面',description:'水平砖缝',features:{surface:'细颗粒'},risks:[],confidence:.8}});}}});await f.prepared();const config=await f.data('/api/local/models',{name:'识别验证',kind:'recognition',protocol:'dashscope',baseURL:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'fixture-vision',apiKey:'fixture-key'});const c=f.current(),assetId=c.sources[0].rectifiedAssetId;c.sources[0].recognitionModelId=config.models[0].id;f.service.store.put('candidates',c);await f.advance('recognize');await f.settle();const updated=f.current();assert.equal(updated.id,c.id);assert.equal(updated.project_id,f.p.id);assert.equal(updated.sources[0].rectifiedAssetId,assetId);assert.equal(updated.name,'识别砖材');assert.equal(updated.sources[0].infoConfirmation,undefined);
});

test('workbench session cannot modify model configuration',async t=>{const f=await fixture(t);const r=await f.service.handle(new Request('http://127.0.0.1:4191/api/local/models',{method:'POST',headers:{Authorization:'Bearer '+f.service.token,'Content-Type':'application/json'},body:'{}'}));assert.equal(r.status,403);});

test('removed segmentation endpoint rejects requests',async t=>{const f=await fixture(t);await assert.rejects(f.advance('segment'));assert.equal((await f.data('/api/local/preferences')).preferences.recognitionMethod,'color');});
test('local output accepts positive custom dimensions',async t=>{const f=await fixture(t);await f.prepared();await f.advance('reconstruct',{textureMode:'faithful',resolution:512,seamless:false});await f.settle();assert.equal(f.service.store.all('materials').length,1);});

test('recycling a project retains source files, masks and material versions and permits restoration',async t=>{
 const f=await fixture(t);await f.prepared();await f.advance('reconstruct',{textureMode:'faithful',resolution:512,seamless:false});await f.settle();const before=f.service.store.all('assets',f.p.id).map(a=>a.id),versions=f.service.store.all('materials',f.p.id);
 await f.data('/api/v1/projects/'+f.p.id,{name:f.p.name,status:'deleted'});assert.equal(f.service.store.get('projects',f.p.id).status,'deleted');assert.deepEqual(f.service.store.all('assets',f.p.id).map(a=>a.id),before);assert.deepEqual(f.service.store.all('materials',f.p.id),versions);for(const id of before)assert.ok((await readFile(f.service.store.file(id))).length);
 await f.data('/api/v1/projects/'+f.p.id,{name:f.p.name,status:'active'});assert.equal(f.service.store.get('projects',f.p.id).status,'active');
});

test('special patterns fail before reconstruction quota or provider invocation',async t=>{
 let calls=0;const f=await fixture(t,{providers:{reconstruct:async()=>{calls++;throw Error('must not run');}}});await f.prepared();const c=f.current();await f.data('/api/platform',{action:'candidate',projectId:f.p.id,candidateId:c.id,revision:c.revision,name:c.name,category:c.category,kind:'专用图案',part:c.part,description:c.description,quad:c.quad});const before=f.service.store.all('usage').length;await assert.rejects(f.advance('reconstruct',{textureMode:'ai',resolution:1024}),/专用图案/);assert.equal(calls,0);assert.equal(f.service.store.all('usage').length,before);
});

test('retry of a legacy special-pattern task is rejected without queuing or charging',async t=>{
 const f=await fixture(t);await f.prepared();const c=f.current();c.kind='专用图案';f.service.store.put('candidates',c);const id=uuid();f.service.store.put('tasks',{id,project_id:f.p.id,status:'failed',kind:'reconstruction',parameters:{candidate:{id:c.id},textureMode:'ai'}});const count=f.service.store.all('tasks').length,usage=f.service.store.all('usage').length;await assert.rejects(f.data('/api/platform',{action:'retry',projectId:f.p.id,taskId:id,acknowledgeCost:true}),/旧整图重绘/);assert.equal(f.service.store.all('tasks').length,count);assert.equal(f.service.store.all('usage').length,usage);
});

test('candidate notes persist with edits and invalidate old information confirmation',async t=>{
 const f=await fixture(t);await f.prepared();const c=f.current();
 const updated=await f.data('/api/platform',{action:'candidate',projectId:f.p.id,candidateId:c.id,revision:c.revision,name:c.name,category:c.category,kind:c.kind,part:c.part,description:c.description,quad:c.quad,notes:'新备注'});
 assert.equal(updated.sources[0].userNotes,'新备注');
 await assert.rejects(f.advance('reconstruct',{textureMode:'faithful',resolution:512}),/确认材质信息/);
 f.restart();assert.equal(f.current().sources[0].userNotes,'新备注');
});
test('provider receipt survives failed download and retry does not regenerate or charge',async t=>{
 let calls=0;
 const f=await fixture(t,{providers:{reconstruct:async(input,config)=>{calls++;await config.saveReceipt({body:{output:{choices:[{message:{content:[{image:'https://example.com/blocked.png'}]}}]}},model:'fixture-image'});throw Error('download interrupted');}}});await f.prepared();
 const saved=await f.data('/api/local/models',{name:'receipt test',kind:'reconstruction',protocol:'dashscope',baseURL:'https://dashscope.aliyuncs.com',model:'fixture-image',apiKey:'test-key'});
 const c=f.current();c.sources[0].reconstructionModelId=saved.models[0].id;f.service.store.put('candidates',c);
 await f.advance('reconstruct',await refineParams(f));await f.settle();const failed=f.service.store.all('tasks').find(t=>t.kind==='reconstruction');
 assert.ok(JSON.parse(await readFile(path.join(f.directory,'receipts',failed.id+'.provider.json'),'utf8')).body);
 f.restart();await f.data('/api/platform',{action:'retry',projectId:f.p.id,taskId:failed.id,acknowledgeCost:true});await f.settle();
 assert.equal(calls,1);assert.equal(f.service.store.all('usage').length,1);assert.match(f.service.store.all('tasks')[0].error_message,/下载地址未通过校验/);
});

test('traditional reconstruction works without a model and does not reserve AI usage',async t=>{const f=await fixture(t);await f.prepared();await f.advance('reconstruct',{textureMode:'traditional',resolution:256,seamless:true,restoration:'off',fidelity:'strict',materialType:'auto'});await f.settle();const v=f.service.store.all('materials')[0];assert.ok(v);assert.equal(v.parameters.ai_inferred,false);assert.ok(v.parameters.source_provenance.rectifiedAssetId||v.parameters.source_provenance.rectified_asset_id||v.parameters.source_provenance);assert.equal(f.service.store.all('usage').length,0);});

test('direct AI reconstruction runs independently of synthesis and preserves a separate reviewable version',async t=>{
 let calls=0,seen;const image='data:image/png;base64,'+(await sharp({create:{width:256,height:256,channels:3,background:'#b17452'}}).png().toBuffer()).toString('base64');
 const f=await fixture(t,{providers:{reconstruct:async input=>{calls++;seen=input;return {image,model:'fixture-image',requestId:'direct-fixture'};}}});await f.prepared();
 const saved=await f.data('/api/local/models',{name:'直接生成测试',kind:'reconstruction',protocol:'dashscope',baseURL:'https://dashscope.aliyuncs.com',model:'fixture-image',apiKey:'fixture-not-real'});
 const c=f.current();c.sources[0].reconstructionModelId=saved.models[0].id;f.service.store.put('candidates',c);
 await f.advance('reconstruct',{textureMode:'direct_ai',resolution:256,seamless:true});await f.settle();
 assert.equal(calls,1);assert.equal(seen.directGeneration,true);assert.equal(seen.referenceMode,'rectified-only');assert.equal(seen.repairMask,undefined);assert.equal(seen.controlledRepair,undefined);
 const v=f.service.store.all('materials')[0];assert.ok(v,JSON.stringify(f.service.store.all('tasks')));assert.equal(v.parameters.textureMode,'direct_ai');assert.equal(v.parameters.ai_inferred,true);assert.equal(v.confirmed,false);assert.equal(v.parameters.seamless,false);assert.equal(f.service.store.all('usage').length,1);
});

 test('text edit uses current version without a mask and keeps original version',async t=>{
 let seen,calls=0;const image='data:image/png;base64,'+(await sharp({create:{width:1024,height:1024,channels:3,background:'#b17452'}}).png().toBuffer()).toString('base64');
 const f=await fixture(t,{providers:{reconstruct:async input=>{seen=input;calls++;return {image,model:'fixture-image'};}}});await f.prepared();
 const saved=await f.data('/api/local/models',{name:'text test',kind:'reconstruction',protocol:'dashscope',baseURL:'https://dashscope.aliyuncs.com',model:'fixture-image',apiKey:'fixture'});const c=f.current();c.sources[0].reconstructionModelId=saved.models[0].id;f.service.store.put('candidates',c);
 const base=await refineParams(f);const before=f.service.store.all('materials').length;
 await assert.rejects(f.advance('reconstruct',{textureMode:'image_edit',baseVersionId:base.baseVersionId,resolution:1024,instruction:''}),/修改内容/);
 await f.advance('reconstruct',{textureMode:'image_edit',baseVersionId:base.baseVersionId,resolution:1024,instruction:'去除白色污痕'});await f.settle();
 assert.equal(calls,1);assert.equal(seen.imageEdit,true);assert.equal(seen.instruction,'去除白色污痕');assert.equal(seen.repairMask,undefined);assert.equal(f.service.store.all('materials').length,before+1);assert.ok(f.service.store.get('materials',base.baseVersionId));assert.equal(f.service.store.all('usage').length,1);
 });


test('unsupported local synthesis preserves actionable reason without AI usage or a fake result',async t=>{
 const f=await fixture(t,{reconstructionError:Object.assign(Error('样本缺少可靠周期，请使用 AI 重新生成'),{code:'SOURCE_SYNTHESIS_UNAVAILABLE'})});
 await f.prepared();await f.advance('reconstruct',{textureMode:'traditional',resolution:1024,seamless:true});await f.settle();
 const task=f.service.store.all('tasks').find(t=>t.kind==='reconstruction');
 assert.equal(task.status,'failed');assert.equal(task.error_code,'SOURCE_SYNTHESIS_UNAVAILABLE');
 assert.match(task.error_message,/AI 重新生成/);assert.equal(f.service.store.all('usage').length,0);assert.equal(f.service.store.all('materials').length,0);
});

async function configureBatch(f){
 const ids={};for(const kind of ['discovery','recognition','reconstruction']){const d=await f.data('/api/local/models',{name:'batch '+kind,kind,protocol:'dashscope',baseURL:kind==='reconstruction'?'https://dashscope.aliyuncs.com':'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'fixture-'+kind,apiKey:'fixture-key'});ids[kind]=d.models.find(m=>m.kind===kind).id;}
 await f.data('/api/local/preferences',{recognitionMethod:'color',models:ids});return ids;
}
const discovered={regions:[{name:'砖墙',point:{x:.5,y:.5},bounds:{x:0,y:0,width:1,height:1},confidence:.9}]};
test('batch runs the full workflow once and keeps generated materials unconfirmed',async t=>{
 let discoveries=0,recognitions=0,generations=0;
 const image='data:image/png;base64,'+(await sharp({create:{width:1024,height:1024,channels:3,background:'#b17452'}}).png().toBuffer()).toString('base64');
 const f=await fixture(t,{batchGeometry:true,providers:{discover:async()=>{discoveries++;return discovered;},recognize:async()=>{recognitions++;return {material:{name:'砖墙',category:'砖材',kind:'重复纹理',part:'外墙',description:'红色砖材',confidence:.9,risks:[]}};},reconstruct:async()=>{generations++;return {image,model:'fixture'};}}});
 await configureBatch(f);const params={projectId:f.p.id,sourceAssetId:f.a.id,requestId:uuid(),acknowledgeCost:true};await f.data('/api/materials/discover',params);await f.settle();
 const batch=f.service.store.get('tasks',params.requestId);assert.equal(batch.status,'completed');assert.equal(batch.result.items[0].status,'completed',JSON.stringify(batch.result));
 assert.equal(f.service.store.all('materials').length,1);assert.equal(f.service.store.all('materials')[0].confirmed,false);
 await f.data('/api/materials/discover',params);await f.settle();assert.deepEqual([discoveries,recognitions,generations],[1,1,1]);
});
test('tiled discovery splits the source image, calls the model per tile and maps findings back',async t=>{
 let tiles=0;
 const image='data:image/png;base64,'+(await sharp({create:{width:64,height:64,channels:3,background:'#b17452'}}).png().toBuffer()).toString('base64');
 const f=await fixture(t,{batchGeometry:true,providers:{discover:async(uri)=>{tiles++;const meta=await sharp(Buffer.from(uri.split(',')[1],'base64')).metadata();assert.ok(meta.width<=1600&&meta.height<=1600);return {regions:[{name:'材质'+tiles,point:{x:.5,y:.5},bounds:{x:.35,y:.35,width:.3,height:.3},confidence:.9}]};},recognize:async()=>({material:{name:'砖墙',category:'砖材',kind:'重复纹理',part:'外墙',description:'红色砖材',confidence:.9,risks:[]}}),reconstruct:async()=>({image,model:'fixture'})}});
 const big=await sharp({create:{width:1024,height:1024,channels:3,background:'#b17452'}}).png().toBuffer();
 const ticket=await f.data('/api/v1/uploads',{projectId:f.p.id,name:'birdseye.png',mime:'image/png',size:big.length,kind:'source'});await f.call('/api/local/upload/'+ticket.path,big,{headers:{'x-upload-token':ticket.token}});const asset=(await f.data('/api/v1/uploads/'+ticket.assetId+'/complete',{})).asset;
 await configureBatch(f);const id=uuid();await f.data('/api/materials/discover',{projectId:f.p.id,sourceAssetId:asset.id,requestId:id,acknowledgeCost:true,discoveryTiles:2});await f.settle();
 const batch=f.service.store.get('tasks',id);assert.equal(tiles,4,JSON.stringify(batch.error_message));assert.equal(batch.parameters.discoveryTiles,2);
 const centres=batch.result.items.map(i=>[i.point.x.toFixed(2),i.point.y.toFixed(2)]);
 assert.deepEqual(centres,[['0.27','0.27'],['0.73','0.27'],['0.27','0.73'],['0.73','0.73']]);
 assert.equal(f.service.store.all('usage').filter(u=>u.kind==='discovery').length,4);
 assert.equal(new Set(f.service.store.all('receipts').map(r=>r.id).filter(v=>v.startsWith(id+'-t')).map(v=>v.slice(-2))).size,4);
 assert.equal(batch.result.items.length,4);assert.deepEqual(batch.result.items.map(i=>i.name),['材质1','材质2','材质3','材质4']);
});
test('batch preserves a candidate mask when no reliable perspective ROI exists',async t=>{
 const f=await fixture(t,{providers:{discover:async()=>discovered,recognize:async()=>{throw Error('must not call');}}});await configureBatch(f);
 const id=uuid();await f.data('/api/materials/discover',{projectId:f.p.id,sourceAssetId:f.a.id,requestId:id,acknowledgeCost:true});await f.settle();const item=f.service.store.get('tasks',id).result.items[0];assert.equal(item.status,'needs-review');assert.ok(f.service.store.get('candidates',item.candidateId).mask_asset_id);assert.equal(f.service.store.all('usage').length,1);
});
test('stopping a batch during discovery prevents all subsequent model calls',async t=>{
 let release,started;const ready=new Promise(r=>started=r),wait=new Promise(r=>release=r);
 const f=await fixture(t,{providers:{discover:async()=>{started();await wait;return discovered;}}});const ids=await configureBatch(f);const id=uuid();await f.data('/api/materials/discover',{projectId:f.p.id,sourceAssetId:f.a.id,requestId:id,acknowledgeCost:true});const drain=f.service.drain();await ready;
 await assert.rejects(f.data('/api/local/models',{action:'disable',id:ids.discovery,disabled:true}),/正在被任务使用/);
 await f.data('/api/materials/discovery/cancel',{projectId:f.p.id,taskId:id});release();await drain;await f.settle();assert.equal(f.service.store.get('tasks',id).status,'cancelled');assert.equal(f.service.store.all('usage').length,1);assert.equal(f.service.store.all('materials').length,0);
});

test('bulk clear endpoint dismisses only matching tasks and preserves source assets',async t=>{
 const f=await fixture(t);
 const c=f.current();
 const body={projectId:f.p.id,sourceAssetId:f.a.id,candidates:[{id:c.id,revision:c.revision}]};
 await assert.rejects(f.data('/api/materials/clear',{...body,candidates:[{id:c.id,revision:-1}]}),e=>e.status===409);
 assert.equal(Boolean(f.current().dismissed),false);
 const result=await f.data('/api/materials/clear',body);
 assert.equal(result.cleared,1);
 assert.equal(f.current().dismissed,true);
 assert.ok(f.service.store.get('assets',f.a.id));
 assert.ok((await readFile(f.service.store.file(f.a.id))).length);
});
