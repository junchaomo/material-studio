import {spawn} from 'node:child_process';
const url='http://127.0.0.1:4193/';
try{const r=await fetch(url,{signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error();await r.body?.cancel();if(process.platform==='win32')spawn('powershell.exe',['-NoProfile','-Command',"Start-Process 'http://127.0.0.1:4193/'"],{windowsHide:true,stdio:'ignore'});else console.log(url);}catch{console.error('请先运行 npm run dev 或双击“启动前后端.cmd”，管理中心将随本地服务启动。');process.exitCode=1;}
