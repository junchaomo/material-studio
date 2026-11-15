import sharp from '../server/image-sharp.mjs';
export async function localMaterialEvidence(full,maskBytes,{includeContext=false}={}){
 const original=Buffer.from(full.split(',')[1],'base64'),meta=await sharp(original).metadata();
 const mask=await sharp(maskBytes).resize(meta.width,meta.height,{fit:'fill',kernel:'nearest'}).removeAlpha().greyscale().raw().toBuffer();
 let minX=meta.width,minY=meta.height,maxX=-1,maxY=-1;
 for(let i=0;i<mask.length;i++)if(mask[i]>=128){const x=i%meta.width,y=Math.floor(i/meta.width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
 if(maxX<minX||maxY<minY)throw Error('当前材质 Mask 为空。');
 const box={left:minX,top:minY,width:maxX-minX+1,height:maxY-minY+1};
 const crop=await sharp(original).extract(box).png().toBuffer(),maskCrop=await sharp(mask,{raw:{width:meta.width,height:meta.height,channels:1}}).extract(box).png().toBuffer();
 const result={originalImage:'data:image/png;base64,'+crop.toString('base64'),maskImage:'data:image/png;base64,'+maskCrop.toString('base64')};
 if(includeContext){
  const outline=Buffer.from(`<svg width="${meta.width}" height="${meta.height}"><rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" fill="none" stroke="#ff3030" stroke-width="${Math.max(2,Math.round(meta.width/700))}"/></svg>`);
  const context=await sharp(original).composite([{input:outline}]).png().toBuffer();
  result.contextImage='data:image/png;base64,'+context.toString('base64');
 }
 return result;
}
