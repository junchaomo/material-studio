import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {localMaterialEvidence} from '../backend/worker/material-evidence.mjs';
import {reconstructionImages} from '../backend/server/reconstruction-images.mjs';
import {reconstructionPrompt} from '../backend/server/qwen-image.mjs';
test('reconstruction receives original local crop, rectified sample and corresponding final Mask',async()=>{
 const source=await sharp({create:{width:30,height:20,channels:3,background:'#888'}}).png().toBuffer(),pixels=Buffer.alloc(600);
 for(let y=5;y<10;y++)for(let x=10;x<20;x++)pixels[y*30+x]=255;
 const mask=await sharp(pixels,{raw:{width:30,height:20,channels:1}}).png().toBuffer();
 const local=await localMaterialEvidence('data:image/png;base64,'+source.toString('base64'),mask);
 const meta=await sharp(Buffer.from(local.originalImage.split(',')[1],'base64')).metadata();assert.equal(meta.width,10);assert.equal(meta.height,5);
 const input={contextImage:local.originalImage,image:'corrected',maskImage:local.maskImage,description:'灰色颗粒屋面',kind:'重复纹理'};
 assert.deepEqual(reconstructionImages(input),[local.originalImage,'corrected',local.maskImage]);assert.match(reconstructionPrompt(input),/图3.*黑白 Mask/);
 assert.deepEqual(reconstructionImages({contextImage:'legacy',image:'sample'}),['legacy','sample']);
});
test('AI fidelity redraw uses only the rectified sample and locks texture structure in its prompt',()=>{
 const input={referenceMode:'rectified-only',image:'rectified',contextImage:'perspective-source',maskImage:'source-mask',description:'浅灰细颗粒屋面',kind:'重复纹理'};
 assert.deepEqual(reconstructionImages(input),['rectified']);
 const prompt=reconstructionPrompt(input);
 assert.match(prompt,/唯一输入图.*正视矫正/);
 assert.match(prompt,/颗粒的相对尺度/);
 assert.match(prompt,/不把整张长方形样本强行拉伸/);
 assert.doesNotMatch(prompt,/图3是图1/);
});

test('authorized context keeps full dimensions, marks target and leaves source and local pixels intact',async()=>{
 const source=await sharp({create:{width:100,height:60,channels:3,background:'#8899aa'}}).png().toBuffer(),saved=Buffer.from(source),pixels=Buffer.alloc(6000);for(let y=20;y<40;y++)for(let x=30;x<70;x++)pixels[y*100+x]=255;
 const mask=await sharp(pixels,{raw:{width:100,height:60,channels:1}}).png().toBuffer(),full='data:image/png;base64,'+source.toString('base64');
 const plain=await localMaterialEvidence(full,mask);assert.equal(plain.contextImage,undefined);
 const evidence=await localMaterialEvidence(full,mask,{includeContext:true}),context=Buffer.from(evidence.contextImage.split(',')[1],'base64');assert.deepEqual(source,saved);const meta=await sharp(context).metadata();assert.equal(meta.width,100);assert.equal(meta.height,60);
 const rgb=await sharp(context).removeAlpha().raw().toBuffer();const marked=(20*100+30)*3;assert.ok(rgb[marked]>rgb[marked+1]);assert.deepEqual([...rgb.subarray(0,3)],[136,153,170]);
 const crop=await sharp(Buffer.from(evidence.originalImage.split(',')[1],'base64')).removeAlpha().raw().toBuffer();assert.deepEqual([...crop.subarray(0,3)],[136,153,170]);
});
