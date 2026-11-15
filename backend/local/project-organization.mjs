export function createFolder(store,{name}){
 if(typeof name!=='string'||!name.trim()||name.trim().length>100)throw Error('文件夹名称须为1到100个字符。');
 const title=name.trim();if(store.all('folders').some(f=>f.name===title))throw Error('已存在同名文件夹。');
 return store.put('folders',{id:crypto.randomUUID(),name:title,created_at:new Date().toISOString()});
}
export function updateProjectOrganization(store,id,{name,folderId}){
 const project=store.get('projects',id);if(!project)throw Error('项目不存在。');
 if(project.status==='deleted')throw Error('请先恢复项目，再编辑。');
 if(name!==undefined&&(typeof name!=='string'||!name.trim()||name.trim().length>100))throw Error('项目名称须为1到100个字符。');
 if(folderId!==undefined&&folderId!==null&&(typeof folderId!=='string'||!store.get('folders',folderId)))throw Error('目标文件夹不存在。');
 return store.put('projects',{...project,...(name!==undefined?{name:name.trim()}:{}),...(folderId!==undefined?{folder_id:folderId}:{})});
}
