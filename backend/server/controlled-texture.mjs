import sharp from './image-sharp.mjs';
export async function composeControlledTexture(baseImage,generatedImage,maskImage,{diagnostics=false}={}){
 const unpack=image=>Buffer.from(image.split(',')[1],'base64');
 const base=await sharp(unpack(baseImage)).removeAlpha().raw().toBuffer({resolveWithObject:true});const {width,height,channels}=base.info;
 const generated=await sharp(unpack(generatedImage)).resize(width,height,{fit:'fill'}).removeAlpha().raw().toBuffer();
 const mask=await sharp(unpack(maskImage)).resize(width,height,{kernel:'nearest'}).removeAlpha().greyscale().raw().toBuffer();
 const unsafe=Buffer.alloc(width*height);const block=32,stride=16;
 for(let y=0;y<height;y+=stride)for(let x=0;x<width;x+=stride){let n=0,diff=0,a=0,b=0,aa=0,bb=0,selected=false;const right=Math.min(width,x+block),bottom=Math.min(height,y+block);
  for(let yy=y;yy<bottom;yy++)for(let xx=x;xx<right;xx++){const i=yy*width+xx;selected ||=mask[i]>0;const av=(base.data[i*channels]+base.data[i*channels+1]+base.data[i*channels+2])/3,bv=(generated[i*channels]+generated[i*channels+1]+generated[i*channels+2])/3;a+=av;b+=bv;aa+=av*av;bb+=bv*bv;for(let c=0;c<channels;c++)diff+=(base.data[i*channels+c]-generated[i*channels+c])**2;n++;}
  if(!selected)continue;const sa=Math.sqrt(Math.max(0,aa/n-(a/n)**2)),sb=Math.sqrt(Math.max(0,bb/n-(b/n)**2)),rmse=Math.sqrt(diff/(n*channels));
  if(rmse>Math.max(12,Math.min(24,sa*.8))||Math.abs(a-b)/n>12||sb>Math.max(sa*1.6,sa+8))for(let yy=y;yy<bottom;yy++)unsafe.fill(255,yy*width+x,yy*width+right);
 }
 // Expand and feather rejected regions; never leave sharp tile-shaped acceptance boundaries.
 const veto=await sharp(unsafe,{raw:{width,height,channels:1}}).dilate(5).blur(2).greyscale().raw().toBuffer();
 const out=Buffer.from(base.data);let requested=0,accepted=0;
 for(let i=0;i<mask.length;i++){if(!mask[i])continue;requested++;const weight=mask[i]/255*(1-veto[i]/255)*.65;if(weight>.01)accepted++;for(let c=0;c<channels;c++)out[i*channels+c]=Math.round(base.data[i*channels+c]*(1-weight)+generated[i*channels+c]*weight);}
 const image='data:image/png;base64,'+(await sharp(out,{raw:{width,height,channels}}).png().toBuffer()).toString('base64');
 const report={requestedPixels:requested,acceptedPixels:accepted,rejectedFraction:requested?1-accepted/requested:0,usedBaseFallback:accepted===0,warnings:requested&&accepted/requested<.5?['AI补全与原样本偏差较大，不合格区域已自动保留算法合成底图。']:[]};
 return diagnostics?{image,report}:image;
}

// Full-surface redraw: assess broad appearance separately from new fine detail.
// A failed check flags the returned AI image; it never silently replaces it.
export async function assessReferenceRedraw(baseImage,generatedImage){
 const unpack=image=>Buffer.from(image.split(',')[1],'base64');
 const sample=async image=>sharp(unpack(image)).resize(32,32,{fit:'fill'}).removeAlpha().blur(1).raw().toBuffer();
 const [a,b]=await Promise.all([sample(baseImage),sample(generatedImage)]);
 const count=a.length/3,ma=[0,0,0],mb=[0,0,0];let error=0,aa=0,bb=0,ab=0;
 for(let i=0;i<count;i++)for(let c=0;c<3;c++){ma[c]+=a[i*3+c]/count;mb[c]+=b[i*3+c]/count;}
 for(let i=0;i<count;i++){let av=0,bv=0;for(let c=0;c<3;c++){error+=(a[i*3+c]-b[i*3+c])**2;av+=a[i*3+c]-ma[c];bv+=b[i*3+c]-mb[c];}aa+=av*av;bb+=bv*bv;ab+=av*bv;}
 const colorShift=Math.sqrt(ma.reduce((sum,v,c)=>sum+(v-mb[c])**2,0)/3),structureRMSE=Math.sqrt(error/a.length),correlation=aa>count*9&&bb>count*9?ab/Math.sqrt(aa*bb):null;
 const rejected=colorShift>35||structureRMSE>40||(correlation!==null&&correlation<.55);
 return {image:generatedImage,report:{mode:'reference-redraw',usedBaseFallback:false,rejected,colorShift,structureRMSE,correlation,warnings:rejected?['AI重绘的颜色或整体结构偏差较大；当前展示AI实际结果，请对比检查。']:['当前展示AI整张重绘结果，请检查颜色、纹理尺度与接缝。']}};
}
