"use client";
import {createDeletionFlow} from '../../shared/deletion-flow.mjs';
import {createContext,useCallback,useContext,useEffect,useId,useRef,useState} from 'react';
type Removal={subject:string;description:string;mode?:'recycle'|'remove'|'permanent';onDelete:()=>Promise<void>};
const Context=createContext<((request:Removal)=>void)|null>(null);
export function useDeletion(){const request=useContext(Context);if(!request)throw Error('删除操作必须使用统一删除中心。');return request;}
export default function DeletionCenter({children}:{children:React.ReactNode}){
 const [state,setState]=useState<{request:Removal|null;busy:boolean;error:string}>({request:null,busy:false,error:''}),[typed,setTyped]=useState('');
 const [flow]=useState(()=>createDeletionFlow(setState));
 const {request,busy,error}=state;
 const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null),returnFocus=useRef<HTMLElement|null>(null),title=useId(),detail=useId();
 const open=useCallback((value:Removal)=>{if(flow.state.request)return;returnFocus.current=document.activeElement as HTMLElement;setTyped('');flow.open(value);},[flow]);
 function close(){flow.cancel();}
 useEffect(()=>{if(request){if(!dialog.current?.open)dialog.current?.showModal();cancel.current?.focus();}else{dialog.current?.close();returnFocus.current?.focus();}},[request]);
 const label=request?.mode==='recycle'?'移入回收站':request?.mode==='permanent'?'永久删除':'删除记录';
 async function confirm(){await flow.confirm(typed);}
 return <Context.Provider value={open}>{children}<dialog className="deletion-dialog" ref={dialog} aria-labelledby={title} aria-describedby={detail} onCancel={e=>{e.preventDefault();close();}}><h2 id={title}>{label}</h2><strong className="deletion-subject">{request?.subject}</strong><p id={detail}>{request?.description}</p>{request?.mode==='permanent'&&<label>请输入完整名称确认永久删除<input value={typed} disabled={busy} onChange={e=>setTyped(e.target.value)}/></label>}{error&&<p className="deletion-error" role="alert">{error}</p>}<footer><button ref={cancel} className="btn" disabled={busy} onClick={close}>取消</button><button className="btn danger" disabled={busy||(request?.mode==='permanent'&&typed!==request.subject)} onClick={confirm}>{busy?'正在处理…':label}</button></footer></dialog></Context.Provider>;
}
