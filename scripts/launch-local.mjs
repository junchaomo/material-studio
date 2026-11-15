import {spawn,spawnSync} from 'node:child_process';
import {createConnection} from 'node:net';
import {openSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {backendEnv,frontendEnv} from './service-env.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const live=port=>new Promise(resolve=>{const s=createConnection({host:'127.0.0.1',port});s.setTimeout(600);s.on('connect',()=>{s.destroy();resolve(true)});s.on('error',()=>resolve(false));s.on('timeout',()=>{s.destroy();resolve(false)});});
mkdirSync(root+'local-data',{recursive:true});
function run(name,args,cwd,env){const out=openSync(root+'local-data/launcher-'+name+'.log','a');const p=spawn(process.execPath,args,{cwd,env,detached:true,windowsHide:true,stdio:['ignore',out,out]});p.on('error',e=>console.error(e.message));p.unref();}
const env=await backendEnv();Object.assign(env,{APP_MODE:'local',LOCAL_STORAGE_MODE:'true',LOCAL_DATA_DIR:root+'local-data',HOST:'127.0.0.1',PORT:'4191',CPU_HOST:'127.0.0.1',CPU_PORT:'4192',CPU_SERVICE_URL:'http://127.0.0.1:4192',BACKEND_PUBLIC_URL:'http://127.0.0.1:4191',BACKGROUND_WORKER:'false'});
for(const k of Object.keys(env))if(k.startsWith('SUPABASE_'))delete env[k];
if(!await live(4191)){console.log('正在启动后台…');const b=spawnSync(process.execPath,['backend/build.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});if(b.status!==0)process.exit(1);run('backend',['dist/backend/main.js'],root+'backend',env);}
if(!await live(4192))run('cpu',['scripts/start-cpu.mjs'],root,env);
if(!await live(4173))run('frontend',['node_modules/next/dist/bin/next','dev','frontend','--hostname','127.0.0.1','--port','4173'],root,{...frontendEnv(),API_BASE_URL:'http://127.0.0.1:4191'});
console.log('正在等待工作台就绪…');
let ready=false;for(let i=0;i<90;i++){if(await live(4173)&&await live(4191)&&await live(4192)){ready=true;break}await new Promise(r=>setTimeout(r,1000));}
if(!ready){console.error('服务未能全部启动，请查看 local-data/launcher-*.log。');process.exit(1)}
try{const r=await fetch('http://127.0.0.1:4173/',{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('HTTP '+r.status);}catch(e){console.error('页面尚未就绪：'+e.message);process.exit(1)}
spawn('explorer.exe',['http://127.0.0.1:4173/'],{detached:true,stdio:'ignore',windowsHide:true}).unref();
console.log('工作台已打开，服务在后台运行。');
