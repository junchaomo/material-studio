"use client";
import {useId} from 'react';
type Props={kind:'tolerance'|'radius';value:number;onChange:(value:number)=>void;disabled?:boolean};
export default function RecognitionRange({kind,value,onChange,disabled=false}:Props){
 const id=useId(),percent=Math.round(value*100),tolerance=kind==='tolerance';
 const title=tolerance?'颜色与纹理容差':'查找范围';
 const level=tolerance?(percent<=30?'严格匹配':percent<=60?'适度匹配':'宽松匹配'):(percent<=25?'局部查找':percent<=55?'邻近查找':'大范围查找');
 const description=tolerance?(percent<=30?'优先选取与点击位置非常相近的颜色和纹理，适合颜色均匀、边界清楚的表面。':percent<=60?'允许一定色差和纹理变化，适合多数材质，可从默认 50% 开始。':'可纳入较大的色差、斑驳和纹理变化，也更容易选入其他材质。'):`以点击位置为中心，搜索半径约为原图长边的 ${percent}%；实际范围会受图片边界限制，最终只保留邻近的连通区域。`;
 const presets=tolerance?[[20,'严格'],[50,'适中'],[80,'宽松']] as const:[[15,'局部'],[35,'邻近'],[75,'大范围']] as const;
 return <div className="recognition-range"><div className="recognition-range-heading"><label htmlFor={id}>{title}</label><output htmlFor={id}>{percent}%</output></div><input id={id} type="range" min={tolerance?.1:.05} max={tolerance?.9:1} step={.05} value={value} disabled={disabled} aria-valuetext={`${percent}%，${level}`} aria-describedby={id+'-detail'} onChange={e=>onChange(Number(e.target.value))}/><div className="recognition-range-scale"><span>{tolerance?'10% · 更严格':'5% · 更小'}</span><span>{tolerance?'90% · 更宽松':'100% · 更大'}</span></div><p id={id+'-detail'}><strong>{level}</strong>{description}</p><div className="recognition-range-presets" aria-label={title+'快捷档位'}>{presets.map(([n,label])=><button key={n} type="button" disabled={disabled} aria-pressed={percent===n} onClick={()=>onChange(n/100)}>{n}% · {label}</button>)}</div><small>{tolerance?'选区遗漏较多时适当调大；混入其他材质时适当调小。百分比表示容差参数，不是识别准确率。':'只需要一小块样本时调小；目标材质跨较大区域时调大。百分比不代表最终选区面积。'}</small></div>;
}
