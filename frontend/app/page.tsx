import Link from 'next/link';
import {ArrowUpRight,Scan,Layers,Move,Grid2X2,FolderOpen,ArrowRight} from 'lucide-react';

export default function Home(){
 return <main className="material-home">
  <nav aria-label="主导航"><Link href="/" className="brand"><span>AI</span><div>AI材质提取<small>MATERIAL STUDIO</small></div></Link><div><Link href="#workflow">使用流程</Link><Link className="btn primary" href="/app/extract">进入工作台 <ArrowUpRight size={16}/></Link></div></nav>
  <section className="material-home-hero"><div><span className="material-home-kicker">从一张图，到一份可用的材质</span><h1>发现画面里的材质，<br/><em>留下真实的质感。</em></h1><p>上传建筑、景观或室内效果图，定位材质区域、修正透视，重建正方形 Diffuse 贴图，并把成果整理到项目材质库。</p><div className="material-home-actions"><Link className="btn primary" href="/app/extract">开始提取材质 <ArrowRight size={18}/></Link><Link className="btn" href="#workflow">了解操作流程</Link></div><small>本机保存 · 无需登录 · AI 操作由你主动触发</small></div>
   <div className="material-home-preview" aria-label="材质提取流程示意"><div className="material-preview-top"><span>材质工作台</span><span>流程示意</span></div><div className="material-preview-canvas"><div className="material-preview-sample"><div className="material-preview-selection"><i/><i/><i/><i/></div></div><ArrowRight size={24}/><div className="material-preview-tile"/></div><div className="material-preview-labels"><span>原图区域取样</span><span>正方形 Diffuse 贴图</span></div><div className="material-preview-bottom"><span><Scan size={14}/> 区域识别</span><span><Move size={14}/> 透视矫正</span><span><Grid2X2 size={14}/> 平铺检查</span></div></div>
  </section>
  <section className="material-home-benefits" aria-label="产品能力">{[[Scan,'定位与精修','点选材质区域，查看候选 Mask，手动调整边界。'],[Move,'正视与重建','确认平面四角，以正视样本和材质信息重建贴图。'],[FolderOpen,'保存与管理','检查颜色和接缝，保留版本，按项目整理材质成果。']].map(([Icon,title,copy])=>{const I=Icon as typeof Layers;return <article key={String(title)}><I size={22}/><h2>{String(title)}</h2><p>{String(copy)}</p></article>;})}</section>
  <section id="workflow" className="material-home-workflow"><div><span className="material-home-kicker">操作流程</span><h2>每一步都由你确认。</h2><p>先选对区域，再检查几何与质感，最后保存成果。</p></div><ol>{[['新建项目，上传原图','保留原始图片，选择需要提取的材质。'],['确认 Mask 与平面四角','检查区域边界，调整四角后进行透视矫正。'],['重建、检查与保存','确认材质信息，重建纹理，检查平铺后保存入库。']].map(([title,copy],i)=><li key={title}><b>0{i+1}</b><div><h3>{title}</h3><p>{copy}</p></div></li>)}</ol></section>
  <section className="material-home-cta"><div><h2>从你的第一张原图开始。</h2><p>进入工作台，新建项目即可开始取样。</p></div><Link className="btn primary" href="/app/extract">进入材质工作台 <ArrowUpRight size={18}/></Link></section>
  <footer><span>AI材质提取</span><span>本地材质创作与管理</span></footer>
 </main>;
}
