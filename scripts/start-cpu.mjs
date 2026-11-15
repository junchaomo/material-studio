import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {backendEnv} from './service-env.mjs';
const cwd=fileURLToPath(new URL('../backend/',import.meta.url));
const executable=fileURLToPath(new URL(process.platform==='win32'?'../backend/.venv/Scripts/python.exe':'../backend/.venv/bin/python',import.meta.url));
const child=spawn(existsSync(executable)?executable:'python',['-m','uvicorn','api.material_processing:app','--host',process.env.CPU_HOST||'127.0.0.1','--port',process.env.CPU_PORT||'4192'],{cwd,env:await backendEnv(),stdio:'inherit',windowsHide:true});
child.on('error',()=>{console.error('图像服务启动失败，请安装 backend/requirements.txt。');process.exitCode=1;});child.on('exit',code=>process.exitCode=code||0);process.on('SIGINT',()=>child.kill());process.on('SIGTERM',()=>child.kill());
