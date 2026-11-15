'use client';
import {useEffect,useRef,useState} from 'react';
import {ImagePlus,Link2} from 'lucide-react';
import type {Asset,Project} from '../../shared/types.ts';
import {imagePreview} from '../lib/image-preview.ts';

type Props={projects:Project[];projectId?:string;assets:Asset[];loading:boolean;busy:boolean;api:(path:string)=>Promise<any>;onUpload:(files:FileList|null)=>Promise<void>;onSelect:(asset:Asset)=>void;onImport:(asset:Asset)=>Promise<void>;onRefresh:()=>Promise<void>};
export default function MaterialSourcePicker({projects,projectId,assets,loading,busy,api,onUpload,onSelect,onImport,onRefresh}:Props){
 const input=useRef<HTMLInputElement>(null),request=useRef(0);
 const [showPlatform,setShowPlatform]=useState(false),[selectedProject,setSelectedProject]=useState(''),[images,setImages]=useState<Asset[]>([]),[fetching,setFetching]=useState(false),[importing,setImporting]=useState(false),[error,setError]=useState('');
 useEffect(()=>()=>{request.current++;},[]);
 async function chooseProject(id:string){
  const ticket=++request.current;setSelectedProject(id);setImages([]);setError('');setFetching(!!id);if(!id)return;
  try{const result=await api('projects/'+id+'/assets');if(request.current===ticket)setImages(result.assets.filter((a:Asset)=>['source','material'].includes(a.kind)&&a.status==='ready'));}
  catch(e){if(request.current===ticket)setError((e as Error).message);}finally{if(request.current===ticket)setFetching(false);}
 }
 async function select(asset:Asset){setImporting(true);setError('');try{await onImport(asset);}catch(e){setError((e as Error).message);}finally{setImporting(false);}}
 const disabled=busy||importing||loading,current=assets.filter(a=>['source','generated'].includes(a.kind));
 return <section className="material-source-picker" aria-label="选择材质提取来源"><div className="eyebrow">MATERIAL SOURCE · 第一步</div><h1>先选择一张效果图</h1><p>上传你的效果图，或选择已有项目的图片。确认来源后，再点选需要提取的材质。</p>
 {loading?<p role="status">正在读取项目素材…</p>:<><div className="source-options"><button className="source-option" disabled={disabled} onClick={()=>input.current?.click()}><ImagePlus size={28}/><strong>{busy?'正在上传…':'上传效果图'}</strong><span>从电脑选择 JPG、PNG 或 WebP</span></button><button className="source-option" disabled={disabled} onClick={()=>setShowPlatform(true)}><Link2 size={28}/><strong>从项目图库导入</strong><span>从已有项目的原图和材质成果中选择</span></button></div><input ref={input} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={async e=>{const files=e.target.files;try{await onUpload(files);}finally{if(input.current)input.current.value='';}}}/>
 {current.length>0&&<><h2>本项目已有图片</h2><div className="source-image-grid">{current.map(a=><button disabled={disabled} key={a.id} onClick={()=>onSelect(a)}><img src={imagePreview(a.url,384)} alt={a.name} loading="lazy"/><span>{a.name}</span></button>)}</div></>}
 {showPlatform&&<section className="platform-source-list"><h2>选择项目图片</h2><label>来源项目<select value={selectedProject} disabled={disabled} onChange={e=>chooseProject(e.target.value)}><option value="">请选择来源项目</option>{projects.filter(p=>p.status!=='deleted').map(p=><option key={p.id} value={p.id}>{p.name}{p.id===projectId?'（当前项目）':''}</option>)}</select></label>{fetching?<p role="status">正在读取项目图片…</p>:selectedProject&&!images.length?<p>这个项目没有可导入的图片，请选择其他项目或上传图片。</p>:<div className="source-image-grid">{images.map(a=><button key={a.id} disabled={disabled} onClick={()=>select(a)}><img src={imagePreview(a.url,384)} alt={a.name} loading="lazy"/><span>{a.name}</span><small>选择并用于材质提取</small></button>)}</div>}{importing&&<p role="status">正在将所选效果图保存至本项目，请稍候…</p>}<small>跨项目选择会保存独立副本，原项目图片保持不变，不调用 AI。</small></section>}
 </>}{error&&<p role="alert">{error}</p>}<button className="btn small" disabled={disabled} onClick={()=>onRefresh().catch(e=>setError(e.message))}>刷新项目素材</button><p className="panel-hint">尚未开始识别，不消耗 AI 用量。</p></section>;
}
