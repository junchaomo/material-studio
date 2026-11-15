import sharp from './image-sharp.mjs';

// A valid interior rectangle excludes transparent holes. It is a conservative
// geometric cleanup, not a semantic detector of all architectural trim.
export async function prepareTextureReference(bytes,kind,category){
 const native=await sharp(bytes).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const {data,info}=await sharp(native.data,{raw:{width:native.info.width,height:native.info.height,channels:4}}).resize({width:768,height:768,fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const w=info.width,h=info.height,margin=Math.max(2,Math.ceil(Math.min(w,h)*.08));
 const heights=new Int32Array(w);let best=null,bestArea=0;
 for(let y=0;y<h;y++){
  for(let x=0;x<w;x++)heights[x]=x>=margin&&x<w-margin&&y>=margin&&y<h-margin&&data[(y*w+x)*4+3]>=250?heights[x]+1:0;
  const stack=[];
  for(let x=0;x<=w;x++){
   let start=x;const height=x===w?0:heights[x];
   while(stack.length&&stack.at(-1).height>height){const p=stack.pop();start=p.start;const width=x-p.start,area=width*p.height;if(area>bestArea){bestArea=area;best={left:p.start,top:y-p.height+1,width,height:p.height};}}
   if(height&&(!stack.length||stack.at(-1).height<height))stack.push({start,height});
  }
 }
 if(!best||Math.min(best.width,best.height)<24||bestArea<w*h*.08)throw Error('正视样本内部的有效纹理不足，请先修正 Mask 或选择更清晰的区域。');
 const left=Math.ceil(best.left*native.info.width/w),top=Math.ceil(best.top*native.info.height/h);
 const right=Math.floor((best.left+best.width)*native.info.width/w),bottom=Math.floor((best.top+best.height)*native.info.height/h);
 const nativeCrop={left,top,width:right-left,height:bottom-top};
 const clean=await sharp(native.data,{raw:{width:native.info.width,height:native.info.height,channels:4}}).extract(nativeCrop).removeAlpha().png().toBuffer();
 best=nativeCrop;
 let square,method='clean-square-v1';
 if(kind==='纯色渐变'){
  // Preserve both endpoints and their relative positions, never tile a gradient.
  square=await sharp(clean).resize(1024,1024,{fit:'fill'}).png().toBuffer();
 }else if(category==='砖材'){
  // A continuous square avoids introducing broken courses at arbitrary tile joins.
  const side=Math.min(best.width,best.height);
  square=await sharp(clean).extract({left:Math.floor((best.width-side)/2),top:Math.floor((best.height-side)/2),width:side,height:side}).resize(1024,1024).removeAlpha().png().toBuffer();
  method='continuous-brick-square-v2';
 }else{
  // Extend at native sample scale rather than stretching a rectangular texture.
  const side=Math.max(best.width,best.height),layers=[];
  for(let y=0;y<side;y+=best.height)for(let x=0;x<side;x+=best.width){const width=Math.min(best.width,side-x),height=Math.min(best.height,side-y);layers.push({input:await sharp(clean).extract({left:0,top:0,width,height}).toBuffer(),left:x,top:y});}
  const tiled=await sharp({create:{width:side,height:side,channels:3,background:'#fff'}}).composite(layers).png().toBuffer();
  square=await sharp(tiled).resize(1024,1024).removeAlpha().png().toBuffer();
 }
 return {image:'data:image/png;base64,'+square.toString('base64'),preparation:{method,kind,crop:best,sourceWidth:native.info.width,sourceHeight:native.info.height,analysisSize:[w,h],warning:'边缘收缩不能保证排除所有构件；AI 补全细节需与原样本核对。'}};
}

export async function textureDeviation(reference,generated){
 async function stats(bytes){const {data,info}=await sharp(bytes).resize(128,128,{fit:'fill'}).removeAlpha().raw().toBuffer({resolveWithObject:true});const mean=[0,0,0];let sum=0,sq=0,edge=0;for(let i=0;i<data.length;i+=info.channels){const l=(data[i]+data[i+1]+data[i+2])/3;sum+=l;sq+=l*l;for(let c=0;c<3;c++)mean[c]+=data[i+c];if(i>=info.channels)edge+=Math.abs(l-(data[i-info.channels]+data[i-info.channels+1]+data[i-info.channels+2])/3);}const n=info.width*info.height;return {mean:mean.map(x=>x/n),contrast:Math.sqrt(Math.max(0,sq/n-(sum/n)**2)),edge:edge/n};}
 const a=await stats(reference),b=await stats(generated);const colorShift=Math.sqrt(a.mean.reduce((s,x,i)=>s+(x-b.mean[i])**2,0)/3),contrastRatio=(b.contrast+1)/(a.contrast+1),detailRatio=(b.edge+1)/(a.edge+1);
 const warnings=[];if(colorShift>18)warnings.push('颜色与正视样本差异较大');if(contrastRatio<.55&&a.contrast>5)warnings.push('原有斑驳或明暗层次明显减弱，请检查纹理形态');if(detailRatio<.5&&a.edge>3)warnings.push('原样本的纹理细节明显丢失');if(contrastRatio>1.6)warnings.push('明暗对比增强较多');if(detailRatio>1.8)warnings.push('新增纹理细节较多，请检查是否偏离原材质');
 return {colorShift,contrastRatio,detailRatio,warnings,requiresReview:!!warnings.length,rejected:colorShift>45};
}
