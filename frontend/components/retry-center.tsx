"use client";
import {createContext,useContext,useEffect,useId,useRef,useState,useCallback} from 'react';
import {RotateCcw,TriangleAlert} from 'lucide-react';
import {createRetryFlow} from '../../shared/retry-flow.mjs';
type RetryRequest={subject:string;mayCharge?:boolean;onRetry:()=>Promise<void>};
const Context=createContext<((request:RetryRequest)=>void)|null>(null);
export function useRetry(){const value=useContext(Context);if(!value)throw Error('重试操作必须使用统一重试中心。');return value;}
export default function RetryCenter({children}:{children:React.ReactNode}){
 const [state,setState]=useState<{request:RetryRequest|null;busy:boolean;error:string}>({request:null,busy:false,error:''});const [flow]=useState(()=>createRetryFlow(setState));const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null),previous=useRef<HTMLElement|null>(null),title=useId(),detail=useId();const {request,busy,error}=state;
 const open=useCallback((value:RetryRequest)=>{if(flow.state.request)return;previous.current=document.activeElement as HTMLElement;flow.open(value);},[flow]);
 useEffect(()=>{if(request){if(!dialog.current?.open)dialog.current?.showModal();cancel.current?.focus();}else{dialog.current?.close();previous.current?.focus();}},[request]);
 return <Context.Provider value={open}>{children}<dialog className="retry-dialog" ref={dialog} aria-labelledby={title} aria-describedby={detail} onCancel={e=>{e.preventDefault();flow.cancel();}}><div className="retry-icon"><RotateCcw size={23}/></div><h2 id={title}>重新尝试这一步？</h2><p className="retry-subject">{request?.subject}</p><p id={detail}>仅重新提交当前失败的任务，不会自动执行其他步骤。</p>{request?.mayCharge&&<div className="retry-cost"><TriangleAlert size={17}/><p>上次请求可能已经计费。再次调用模型可能消耗额度，请确认后继续。</p></div>}{error&&<p className="retry-error" role="alert">{error}</p>}<footer><button className="btn" ref={cancel} disabled={busy} onClick={()=>flow.cancel()}>暂不重试</button><button className="btn primary" disabled={busy} onClick={()=>void flow.confirm()}>{busy?'正在提交…':'确认重试'}</button></footer></dialog></Context.Provider>;
}
