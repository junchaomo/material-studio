export const outputSizes=[1024,2048,4096];
export function qualityMetrics(data,width,height){
 let gap=0,variance=0,sum=0,n=0;
 for(let y=0;y<height;y++)for(let c=0;c<3;c++)gap+=Math.abs(data[(y*width)*4+c]-data[(y*width+width-1)*4+c]);
 for(let x=0;x<width;x++)for(let c=0;c<3;c++)gap+=Math.abs(data[x*4+c]-data[((height-1)*width+x)*4+c]);
 for(let i=0;i<data.length;i+=Math.max(4,Math.floor(data.length/40000/4)*4)){sum+=data[i];variance+=data[i]*data[i];n++;}
 return {edgeDifference:+(gap/((width+height)*3)).toFixed(2),contrast:+Math.sqrt(Math.max(0,variance/n-(sum/n)**2)).toFixed(2),width,height,notice:'数值仅辅助检查；视觉一致性、无关对象和物理尺寸须人工确认。'};
}
export function blendEdges(data,width,height,strength=.5){
 const src=new Uint8ClampedArray(data),band=Math.max(1,Math.round(Math.min(width,height)*.08));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const dx=Math.min(x,width-1-x),dy=Math.min(y,height-1-y),wx=dx<band?(1-dx/band)*strength:0,wy=dy<band?(1-dy/band)*strength:0;
  for(let c=0;c<3;c++){const i=(y*width+x)*4+c,opX=(y*width+width-1-x)*4+c,opY=((height-1-y)*width+x)*4+c;data[i]=(src[i]+src[opX]*wx+src[opY]*wy)/(1+wx+wy);}
 }return data;
}
export function csvManifest(materials){
 const cell=value=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
 return '\ufeff'+[['编号','名称','分类','应用部位','宽度(米)','高度(米)','版本ID','父版本','审核状态','纹理文件'],...materials.map(m=>[m.code,m.name,m.category,m.part,m.physical_width_m,m.physical_height_m,m.id,m.parent_version_id||'',m.confirmed?'已确认':'待审核','textures/'+m.id+'_Diffuse.png'])].map(row=>row.map(cell).join(',')).join('\r\n');
}
