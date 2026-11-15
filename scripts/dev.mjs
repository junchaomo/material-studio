import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {backendEnv,frontendEnv} from './service-env.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),children=[];
function run(args,cwd,env=process.env){const child=spawn(process.execPath,args,{cwd,env,stdio:'inherit',windowsHide:true});children.push(child);child.on('error',()=>{console.error('服务进程无法启动。');stop(1);});child.on('exit',code=>{if(code&&code!==0){console.error('服务启动失败。');stop(code);}});return child;}
function stop(code=0){for(const child of children)child.kill();process.exitCode=code;}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
const build=run(['backend/build.mjs'],root);
build.on('exit',async code=>{if(code)return;const localEnv=await backendEnv();Object.assign(localEnv,{APP_MODE:'local',LOCAL_DATA_DIR:fileURLToPath(new URL('../local-data/',import.meta.url)),LOCAL_STORAGE_MODE:'true',HOST:'127.0.0.1',PORT:'4191',CPU_HOST:'127.0.0.1',CPU_PORT:'4192',CPU_SERVICE_URL:'http://127.0.0.1:4192',BACKEND_PUBLIC_URL:'http://127.0.0.1:4191',BACKGROUND_WORKER:'false'});localEnv.QMX_CLOUD_WORKER_TOKEN||=randomBytes(32).toString('hex');if(localEnv.APP_MODE==='local')for(const key of Object.keys(localEnv))if(key.startsWith('SUPABASE_'))delete localEnv[key];run(['dist/backend/main.js'],fileURLToPath(new URL('../backend/',import.meta.url)),localEnv);run(['node_modules/next/dist/bin/next','dev','frontend','--hostname','127.0.0.1','--port','4173'],root,{...frontendEnv(),API_BASE_URL:'http://127.0.0.1:4191'});run(['scripts/start-cpu.mjs'],root,localEnv);});
console.log('独立服务：前端 4173，后端 4191，Python 图像处理 4192。');
