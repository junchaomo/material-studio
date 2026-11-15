"use client";
import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
const LocalWorkspace=dynamic(()=>import('./local-workspace.tsx'));
export default function WorkspaceEntry(){const [config,setConfig]=useState<{local?:boolean;token?:string}|null>(null),[error,setError]=useState('');useEffect(()=>{const controller=new AbortController();fetch('/api/config',{signal:controller.signal}).then(r=>{if(!r.ok)throw Error('后台配置读取失败。');return r.json();}).then(setConfig).catch(e=>{if(e.name!=='AbortError')setError('无法连接本机后台，请启动前后端后刷新。');});return()=>controller.abort();},[]);if(!config)return <main className="canvas-empty" role="status">{error||'正在打开工作台…'}</main>;return config.local&&config.token?<LocalWorkspace token={config.token}/>:<main className="canvas-empty" role="alert">本机后台未就绪，请重新启动本地服务。</main>;}
