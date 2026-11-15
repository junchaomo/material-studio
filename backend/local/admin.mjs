import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const same=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export function adminRequestAllowed(req){return ['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&req.headers.host==='127.0.0.1:4193'&&(!req.headers.origin||req.headers.origin==='http://127.0.0.1:4193')&&(!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']));}
export function createLocalAdminServer(service){
 const session=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
 return createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  if(!adminRequestAllowed(req))return json(403,{error:'管理中心仅允许本机直接访问。'});
  try{
   if(req.url==='/'&&req.method==='GET'){const html=await readFile(new URL('./admin.html',import.meta.url),'utf8');res.setHeader('Set-Cookie','qmx_local_admin='+session+'; HttpOnly; SameSite=Strict; Path=/');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html.replaceAll('__CSRF__',csrf));return;}
   const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('qmx_local_admin='))?.slice(16);
   if(!same(cookie,session))return json(401,{error:'请从本机管理中心首页重新进入。'});
   if(req.url==='/api/overview'&&req.method==='GET'){
    const projects=service.store.all('projects'),materials=service.store.all('materials'),tasks=service.store.all('tasks'),month=new Date().toISOString().slice(0,7),usage=service.store.all('usage');
    return json(200,{projects:projects.filter(p=>p.status!=='deleted').length,recycled:projects.filter(p=>p.status==='deleted').length,materials:materials.filter(m=>m.confirmed).length,tasks:tasks.length,storage:'SQLite / 本机文件',access:'仅限 127.0.0.1',month,usage:['discovery','recognition','reconstruction'].map(kind=>({kind,used:usage.filter(u=>u.kind===kind&&u.month===month).length,limit:100})),recentTasks:tasks.sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||'')).slice(0,20).map(t=>({kind:t.kind,status:t.status,created_at:t.created_at})),models:(await (await service.handleAdmin(new Request('http://127.0.0.1:4191/api/local/models',{headers:{Authorization:'Bearer '+service.token}}))).json()).models});
   }
   if(req.url!=='/api/models'||!['GET','POST'].includes(req.method))return json(404,{error:'页面不存在。'});
   if(req.method==='POST'&&(req.headers.origin!=='http://127.0.0.1:4193'||!same(req.headers['x-admin-csrf'],csrf)))return json(403,{error:'管理操作校验失败，请刷新页面。'});
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536)return json(413,{error:'配置内容过大。'});chunks.push(chunk);}
   const r=await service.handleAdmin(new Request('http://127.0.0.1:4191/api/local/models',{method:req.method,headers:{Authorization:'Bearer '+service.token,'Content-Type':'application/json'},...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}));json(r.status,await r.json());
  }catch{json(500,{error:'管理请求未完成，请检查本机服务。'});}
 });
}
