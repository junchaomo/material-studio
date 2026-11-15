import {renameSync,unlinkSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
export function emptyRecycleBin(store,ids){
 if(!Array.isArray(ids)||ids.length===0)return {deleted:0};
 const projects=[...new Set(ids)].map(id=>store.get('projects',id));
 if(projects.some(p=>!p||p.status!=='deleted'))throw Error('回收站内容已变化，请刷新后重试。');
 if(projects.some(p=>store.all('tasks',p.id).some(t=>['queued','processing'].includes(t.status))))throw Error('回收站中有运行任务，请等待完成后再清空。');
 const staged=[];
 try{
  for(const p of projects)for(const a of store.all('assets',p.id)){const original=store.file(a.id);if(existsSync(original)){const temporary=original+'.delete-'+randomUUID();renameSync(original,temporary);staged.push({original,temporary});}}
  store.transaction(()=>{for(const p of projects){for(const table of ['assets','candidates','tasks','materials','receipts'])for(const row of store.all(table,p.id))store.remove(table,row.id);store.remove('projects',p.id);}});
 }catch(e){for(const f of staged.reverse())renameSync(f.temporary,f.original);throw e;}
 let cleanupPending=0;for(const f of staged)try{unlinkSync(f.temporary);}catch{cleanupPending++;}
 return {deleted:projects.length,cleanupPending};
}

export function deleteModelConfiguration(store,id){
 const model=store.get('models',id);if(!model)throw Error('模型配置不存在，请刷新。');
 if(store.all('tasks').some(t=>['queued','processing'].includes(t.status)&&(t.parameters?.modelId===id||Object.values(t.parameters?.models||{}).includes(id))))throw Error('该模型有任务正在运行，请完成后再删除。');
 store.transaction(()=>{const preferences=store.get('settings','user-preferences');if(preferences){preferences.models={...preferences.models};for(const kind of Object.keys(preferences.models))if(preferences.models[kind]===id)delete preferences.models[kind];store.put('settings',preferences);}store.remove('models',id);});
 return {deleted:true};
}

export function clearMaterialTasks(store,projectId,sourceId,expected){
 const rows=store.all('candidates',projectId).filter(c=>c.source_asset_id===sourceId&&!c.dismissed);
 const conflict=message=>Object.assign(Error(message),{status:409});
 if(store.all('tasks',projectId).some(t=>['queued','processing'].includes(t.status)&&(t.source_asset_id===sourceId||rows.some(c=>t.parameters?.candidate?.id===c.id))))throw conflict('当前图片仍有任务正在处理，请等待完成后清空。');
 if(!Array.isArray(expected)||expected.length!==rows.length||rows.some(c=>!expected.some(e=>e.id===c.id&&e.revision===c.revision)))throw conflict('材质任务已变化，请刷新后重新确认。');
 store.transaction(()=>{for(const c of rows)store.put('candidates',{...c,dismissed:true,revision:c.revision+1});});
 return {cleared:rows.length};
}
