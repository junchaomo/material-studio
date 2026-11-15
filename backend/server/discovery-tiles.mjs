import sharp from './image-sharp.mjs';
// Split a wide scene into overlapping tiles so the discovery model enumerates每块内的材质，
// instead of settling on one scene-level checklist. Overlap keeps a material that crosses a
// seam whole inside at least one tile.
export const DISCOVERY_OVERLAP=.08;
export function tileRects(grid=2,overlap=DISCOVERY_OVERLAP){
 const step=1/grid,pad=step*overlap,rects=[];
 for(let row=0;row<grid;row++)for(let col=0;col<grid;col++){
  const x=Math.max(0,col*step-pad),y=Math.max(0,row*step-pad),right=Math.min(1,(col+1)*step+pad),bottom=Math.min(1,(row+1)*step+pad);
  rects.push({x,y,width:right-x,height:bottom-y});
 }
 return rects;
}
export async function splitDiscoveryTiles(image,{grid=2,overlap=DISCOVERY_OVERLAP,minSide=240,maxSide=1600}={}){
 const bytes=Buffer.from(String(image).split(',')[1]||'','base64'),meta=await sharp(bytes).metadata();
 if(!meta.width||!meta.height)throw Error('来源图片无法解码。');
 if(grid<=1||Math.min(meta.width,meta.height)<minSide*grid)return [{image,rect:{x:0,y:0,width:1,height:1}}];
 const tiles=[];
 for(const rect of tileRects(grid,overlap)){
  const left=Math.round(rect.x*meta.width),top=Math.round(rect.y*meta.height);
  const width=Math.min(Math.max(1,Math.round(rect.width*meta.width)),meta.width-left),height=Math.min(Math.max(1,Math.round(rect.height*meta.height)),meta.height-top);
  // 发现只需要粗定位，分块按长边缩到 maxSide，避免每块几 MB 的原始分辨率上行。
  const buffer=await sharp(bytes).extract({left,top,width,height}).resize(maxSide,maxSide,{fit:'inside',withoutEnlargement:true}).jpeg({quality:90,chromaSubsampling:'4:4:4'}).toBuffer();
  tiles.push({image:'data:image/jpeg;base64,'+buffer.toString('base64'),rect:{x:left/meta.width,y:top/meta.height,width:width/meta.width,height:height/meta.height}});
 }
 return tiles;
}
// Tile-local fractions back to whole-image fractions; the parser only accepts
// points strictly inside bounds, so the mapped box keeps its own extent.
export function mapRegion(region,rect){
 const clamp=value=>Math.min(1,Math.max(0,value));
 const x=clamp(rect.x+region.point.x*rect.width),y=clamp(rect.y+region.point.y*rect.height);
 const left=clamp(rect.x+region.bounds.x*rect.width),top=clamp(rect.y+region.bounds.y*rect.height);
 const right=clamp(rect.x+(region.bounds.x+region.bounds.width)*rect.width),bottom=clamp(rect.y+(region.bounds.y+region.bounds.height)*rect.height);
 return {...region,point:{x,y},bounds:{x:left,y:top,width:Math.max(1e-6,right-left),height:Math.max(1e-6,bottom-top)}};
}
function overlap(a,b){const x=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)),y=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));const union=a.width*a.height+b.width*b.height-x*y;return union>0?x*y/union:0;}
export function mergeRegions(regions){
 const kept=[];
 for(const region of regions){
  const duplicate=kept.find(v=>Math.hypot(v.point.x-region.point.x,v.point.y-region.point.y)<.045||overlap(v.bounds,region.bounds)>.6);
  if(!duplicate){kept.push(region);continue;}
  // A later, more confident reading of the same surface replaces the earlier one.
  if(region.confidence>duplicate.confidence)Object.assign(duplicate,region);
 }
 return kept;
}
