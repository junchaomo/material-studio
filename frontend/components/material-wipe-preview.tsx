'use client';
import {useState} from 'react';
import {useProjectImageState} from './use-project-image.ts';

export default function MaterialWipePreview({sampleUrl,resultUrl}:{sampleUrl:string;resultUrl:string}){
 const sample=useProjectImageState(sampleUrl),result=useProjectImageState(resultUrl);
 const [position,setPosition]=useState(50);
 const ready=!!sample.image&&!!result.image;
 return <div className="material-wipe">
  <div className="material-wipe-heading"><span>正视样本</span><span>Diffuse 重绘</span></div>
  <div className="material-wipe-stage">
   {ready?<>
    <img className="material-wipe-image" src={result.image!.src} alt="Diffuse 重绘结果" draggable={false}/>
    <div className="material-wipe-layer" style={{clipPath:`inset(0 ${100-position}% 0 0)`}}><img className="material-wipe-image" src={sample.image!.src} alt="正视样本" draggable={false}/></div>
    <div className="material-wipe-divider" style={{left:`${position}%`}}><span>↔</span></div>
    <input className="material-wipe-slider" type="range" aria-label="卷帘对比位置" min={0} max={100} value={position} onChange={e=>setPosition(Number(e.target.value))}/>
   </>:<div className="canvas-empty">{sample.error||result.error?<>图片加载失败<button onClick={()=>{sample.retry();result.retry();}}>重新加载</button></>:'正在加载对比图片…'}</div>}
  </div>
  <p>左右拖动分隔线查看；也可用方向键调整。两图等比放大、居中裁切铺满画布，仅影响预览；不代表逐像素对齐。</p>
 </div>;
}
