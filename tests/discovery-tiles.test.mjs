import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {tileRects,splitDiscoveryTiles,mapRegion,mergeRegions} from '../backend/server/discovery-tiles.mjs';
const png=async(width,height)=>'data:image/png;base64,'+(await sharp({create:{width,height,channels:3,background:'#b17452'}}).png().toBuffer()).toString('base64');
test('tileRects covers the whole image with overlap and never leaves the frame',()=>{
 const rects=tileRects(2);
 assert.equal(rects.length,4);
 for(const r of rects){assert.ok(r.x>=0&&r.y>=0);assert.ok(r.x+r.width<=1.000001&&r.y+r.height<=1.000001);assert.ok(r.width>.5&&r.height>.5);}
 assert.deepEqual([rects[0].x,rects[0].y],[0,0]);
 assert.ok(Math.abs(rects[3].x+rects[3].width-1)<1e-9);assert.ok(Math.abs(rects[3].y+rects[3].height-1)<1e-9);
});
test('splitDiscoveryTiles returns real crops for a large image and falls back for a small one',async()=>{
 const image=await png(1024,1024),tiles=await splitDiscoveryTiles(image,{grid:2});
 assert.equal(tiles.length,4);
 for(const tile of tiles){assert.ok(tile.image.startsWith('data:image/jpeg;base64,'));const meta=await sharp(Buffer.from(tile.image.split(',')[1],'base64')).metadata();assert.ok(meta.width>=540&&meta.width<=560);assert.ok(tile.image.length<9_500_000);}
 assert.ok(Math.abs(tiles[3].rect.x+tiles[3].rect.width-1)<0.01);
 const small=await png(300,300),single=await splitDiscoveryTiles(small,{grid:2});
 assert.equal(single.length,1);assert.equal(single[0].image,small);assert.deepEqual(single[0].rect,{x:0,y:0,width:1,height:1});
});
test('mapRegion moves tile-local fractions into whole-image coordinates',()=>{
 const mapped=mapRegion({name:'砖墙',point:{x:.2,y:.2},bounds:{x:0,y:0,width:.5,height:.5},confidence:.9},{x:.5,y:.5,width:.5,height:.5});
 assert.deepEqual(mapped.point,{x:.6,y:.6});
 assert.deepEqual(mapped.bounds,{x:.5,y:.5,width:.25,height:.25});
 assert.equal(mapped.name,'砖墙');
});
test('mergeRegions drops the same surface found in overlapping tiles and keeps the confident reading',()=>{
 const kept=mergeRegions([
  {name:'灰屋顶',point:{x:.52,y:.52},bounds:{x:.4,y:.4,width:.2,height:.2},confidence:.65},
  {name:'灰色屋面',point:{x:.53,y:.53},bounds:{x:.41,y:.41,width:.2,height:.2},confidence:.9},
  {name:'红砖',point:{x:.1,y:.1},bounds:{x:.02,y:.02,width:.2,height:.2},confidence:.8}
 ]);
 assert.equal(kept.length,2);assert.equal(kept[0].name,'灰色屋面');assert.equal(kept[0].confidence,.9);assert.equal(kept[1].name,'红砖');
});
