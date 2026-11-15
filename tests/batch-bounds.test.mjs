import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {constrainMaskToBounds} from '../backend/local/batch-discovery.mjs';
test('batch sampling mask stays inside discovery bounds at native resolution',async()=>{
 const image='data:image/png;base64,'+(await sharp({create:{width:101,height:81,channels:3,background:'white'}}).png().toBuffer()).toString('base64');
 const output=await constrainMaskToBounds(image,{x:.2,y:.25,width:.4,height:.5});
 const {data,info}=await sharp(Buffer.from(output.split(',')[1],'base64')).greyscale().raw().toBuffer({resolveWithObject:true});
 assert.equal(info.width,101);assert.equal(info.height,81);
 for(let y=0;y<81;y++)for(let x=0;x<101;x++)assert.equal(data[y*101+x],x>=20&&x<=60&&y>=20&&y<=60?255:0);
 await assert.rejects(constrainMaskToBounds(image,{x:2,y:2,width:.1,height:.1}),/没有有效选区/);
});
