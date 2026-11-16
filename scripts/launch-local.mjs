import {spawn,spawnSync} from 'node:child_process';
import {createConnection} from 'node:net';
import {existsSync,openSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {backendEnv,frontendEnv} from './service-env.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const live=port=>new Promise(resolve=>{const s=createConnection({host:'127.0.0.1',port});s.setTimeout(600);s.on('connect',()=>{s.destroy();resolve(true)});s.on('error',()=>resolve(false));s.on('timeout',()=>{s.destroy();resolve(false)});});
const stateRoot=join(root,'local-data');
mkdirSync(stateRoot,{recursive:true});
// AS 中枢按账号注入 AS_DATA_DIR，代理把它转成 LOCAL_DATA_DIR。工作台是固定 4191/4173 的单实例，
// 切换账号时必须先回收上一账号的服务，再用新目录启动，不能把两个账号的 SQLite 混在一个进程里。
const dataDir=(process.env.LOCAL_DATA_DIR||stateRoot).trim();
mkdirSync(dataDir,{recursive:true});
const stateFile=join(stateRoot,'launcher-state.json');
function readState(){try{return JSON.parse(readFileSync(stateFile,'utf8'))}catch{return null}}
function pidAlive(pid){try{process.kill(Number(pid),0);return true}catch{return false}}
function killPort(port){
  const out=spawnSync('netstat',['-ano'],{encoding:'utf8',windowsHide:true}).stdout||'';
  for(const line of out.split(/\r?\n/)){
    if(!line.includes(`:${port}`)||!line.toUpperCase().includes('LISTENING'))continue;
    const pid=Number(line.trim().split(/\s+/).at(-1));if(!pid||pid===process.pid)continue;
    try{spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'})}catch{}
  }
}
function stopPrevious(){const state=readState();if(!state||state.dataDir===dataDir)return;for(const pid of state.pids||[]){if(pidAlive(pid)){try{spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'})}catch{}}}}
async function workbenchDataDir(){try{const secret=existsSync(join(stateRoot,'gate-internal'))?readFileSync(join(stateRoot,'gate-internal'),'utf8').trim():'';const r=await fetch('http://127.0.0.1:4191/api/config',{headers:secret?{'x-as-gate':secret}:{},signal:AbortSignal.timeout(3000),redirect:'error'});return String((await r.json()).dataDir||'')}catch{return ''}}
stopPrevious();
const pids=[];
function run(name,args,cwd,env){const out=openSync(join(stateRoot,`launcher-${name}.log`),'a');const p=spawn(process.execPath,args,{cwd,env,detached:true,windowsHide:true,stdio:['ignore',out,out]});p.on('error',e=>console.error(e.message));p.unref();if(p.pid)pids.push(p.pid);return p}
function saveState(){const tmp=join(stateRoot,'launcher-state.json.tmp');writeFileSync(tmp,JSON.stringify({dataDir,pids,updatedAt:new Date().toISOString()}),'utf8');writeFileSync(stateFile,readFileSync(tmp))}
const gateFile=join(stateRoot,'gate-internal');
const gateInternal=process.env.AS_GATE_INTERNAL||(existsSync(gateFile)?readFileSync(gateFile,'utf8').trim():'')||randomBytes(24).toString('hex');
writeFileSync(gateFile,gateInternal,'utf8');
const env=await backendEnv();Object.assign(env,{APP_MODE:'local',LOCAL_STORAGE_MODE:'true',LOCAL_DATA_DIR:dataDir,HOST:'127.0.0.1',PORT:'4191',CPU_HOST:'127.0.0.1',CPU_PORT:'4192',CPU_SERVICE_URL:'http://127.0.0.1:4192',BACKEND_PUBLIC_URL:'http://127.0.0.1:4191',BACKGROUND_WORKER:'false',AS_GATE_INTERNAL:gateInternal,AS_PORT:process.env.AS_PORT||''});
for(const k of Object.keys(env))if(k.startsWith('SUPABASE_'))delete env[k];
// 旧工作台可能没有 launcher-state（首次升级），用后端自己报的 dataDir 判断是否要按新账号重建。
if(await live(4191)&&(await workbenchDataDir())!==dataDir){killPort(4191);killPort(4173);killPort(4192);for(let i=0;i<20;i++){if(!await live(4191)&&!await live(4173)&&!await live(4192))break;await new Promise(r=>setTimeout(r,500))}}
if(!await live(4191)){console.log('正在启动后台…');const b=spawnSync(process.execPath,['backend/build.mjs'],{cwd:root,stdio:'inherit',windowsHide:true});if(b.status!==0)process.exit(1);run('backend',['dist/backend/main.js'],root+'backend',env);}
if(!await live(4192))run('cpu',['scripts/start-cpu.mjs'],root,env);
if(!await live(4173)){
  const frontendBuild=root+'frontend/.next/BUILD_ID';
  if(!existsSync(frontendBuild)){
    console.log('正在构建前端生产包…');
    const b=spawnSync(process.execPath,['node_modules/next/dist/bin/next','build','frontend'],{cwd:root,env:{...frontendEnv(),API_BASE_URL:'http://127.0.0.1:4191'},stdio:'inherit',windowsHide:true});
    if(b.status!==0)process.exit(1);
  }
  run('frontend',['node_modules/next/dist/bin/next','start','frontend','--hostname','127.0.0.1','--port','4173'],root,{...frontendEnv(),API_BASE_URL:'http://127.0.0.1:4191',AS_GATE_INTERNAL:gateInternal,AS_PORT:process.env.AS_PORT||''});
}
saveState();
console.log('正在等待工作台就绪…');
let ready=false;for(let i=0;i<90;i++){if(await live(4173)&&await live(4191)&&await live(4192)){ready=true;break}await new Promise(r=>setTimeout(r,1000));}
if(!ready){console.error('服务未能全部启动，请查看 local-data/launcher-*.log。');process.exit(1)}
try{const r=await fetch('http://127.0.0.1:4173/',{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('HTTP '+r.status);}catch(e){console.error('页面尚未就绪：'+e.message);process.exit(1)}
if(!process.env.JG_SUPPRESS_OPEN)spawn('explorer.exe',['http://127.0.0.1:4173/'],{detached:true,stdio:'ignore',windowsHide:true}).unref();
console.log('工作台已打开，服务在后台运行。');
