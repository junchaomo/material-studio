import sharp from './image-sharp.mjs';
// Transport adaptation only. Stored originals and extraction samples are never overwritten.
export async function prepareVisionImage(data,{limit=9_500_000}={}){
 if(typeof data!=='string'||!data.startsWith('data:image/')||data.length<=limit)return data;
 const bytes=Buffer.from(data.split(',')[1],'base64'),meta=await sharp(bytes).metadata();
 let width=meta.width,height=meta.height;
 for(let step=0;step<12;step++){
  for(const quality of [95,88,80]){const image=sharp(bytes).flatten({background:'#808080'});if(width!==meta.width||height!==meta.height)image.resize(width,height,{fit:'inside'});const output='data:image/jpeg;base64,'+(await image.jpeg({quality,chromaSubsampling:'4:4:4'}).toBuffer()).toString('base64');if(output.length<=limit)return output;}
  width=Math.max(1,Math.floor(width*.75));height=Math.max(1,Math.floor(height*.75));
 }
 throw Error('无法准备符合模型接口规格的识别副本，未调用模型。');
}
