'use client';
import {useState} from 'react';
import {useProjectImageState} from './use-project-image.ts';
export default function MaterialResultPreview({url,label}:{url:string;label:string}){
 const {image,error,retry}=useProjectImageState(url),[native,setNative]=useState(false);
 return <div className="material-result-preview"><div className="material-result-controls"><button onClick={()=>setNative(false)} aria-pressed={!native}>适应画布</button><button onClick={()=>setNative(true)} aria-pressed={native}>100%</button></div><div className={'material-result-stage '+(native?'native':'fit')}>
 {image?<img src={image.src} alt={label}/>:<div className="canvas-empty">{error?'结果图片加载失败':'正在加载结果…'}{error&&<button className="btn" onClick={retry}>重新加载图片</button>}</div>}
 </div></div>;
}
