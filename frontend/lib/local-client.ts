export type MaterialClient={auth:{getSession:()=>Promise<{data:{session:{access_token:string}}}>};storage:{from:(bucket:string)=>{uploadToSignedUrl:(id:string,token:string,file:File)=>Promise<{data?:unknown;error:Error|null}>}}};
// Local capability and upload client. No external database or authentication service.
export function localClient(token:string):MaterialClient{
 return {auth:{getSession:async()=>({data:{session:{access_token:token}},error:null})},storage:{from:()=>({uploadToSignedUrl:async(id:string,uploadToken:string,file:File)=>{
 try{
  const r=await fetch(new URL('/api/local/upload/'+encodeURIComponent(id),window.location.protocol+'//'+window.location.hostname+':4191'),{method:'POST',headers:{Authorization:'Bearer '+token,'X-Upload-Token':uploadToken,'Content-Type':file.type},body:file});
  const data=await r.json().catch(()=>null);
  if(!r.ok)return {data:null,error:Error(data?.error||(r.status===413?'本地服务拒绝了上传请求。':'本机上传未完成（HTTP '+r.status+'），请重试。'))};
  if(!data?.asset)return {data:null,error:Error('上传服务没有返回保存结果，请刷新项目素材后检查。')};
  return {data,error:null};
 }catch(e){return {data:null,error:Error('本机上传连接中断，请确认本地服务正在运行后重试。')};}
}})}} as MaterialClient;
}

