import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {prepareTextureReference,textureDeviation} from '../backend/server/texture-reference.mjs';

test('square reference excludes edge trim and transparent holes',async()=>{
 const w=200,h=100,data=Buffer.alloc(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,edge=x<6||x>w-7||y<6||y>h-7;data[i]=edge?240:120;data[i+1]=edge?0:130;data[i+2]=edge?0:140;data[i+3]=x<20&&y>40&&y<60?0:255;}
 const input=await sharp(data,{raw:{width:w,height:h,channels:4}}).png().toBuffer();
 const result=await prepareTextureReference(input,'重复纹理');const {data:out,info}=await sharp(Buffer.from(result.image.split(',')[1],'base64')).raw().toBuffer({resolveWithObject:true});
 assert.equal(info.width,1024);assert.equal(info.height,1024);assert.equal(info.channels,3);
 for(let i=0;i<out.length;i+=3){assert.equal(out[i],120);assert.equal(out[i+1],130);assert.equal(out[i+2],140);}
});
test('gradient keeps endpoint ordering without repeating',async()=>{
 const w=160,h=80,data=Buffer.alloc(w*h*3);for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.fill(40+x,(y*w+x)*3,(y*w+x)*3+3);
 const input=await sharp(data,{raw:{width:w,height:h,channels:3}}).png().toBuffer();const r=await prepareTextureReference(input,'纯色渐变');const out=await sharp(Buffer.from(r.image.split(',')[1],'base64')).raw().toBuffer();
 for(let x=1;x<1024;x++)assert.ok(out[(512*1024+x)*3]>=out[(512*1024+x-1)*3]);
 assert.ok(out[(512*1024+1023)*3]-out[512*1024*3]>120);
});
test('empty evidence fails before paid reconstruction and deviations require review',async()=>{
 const blank=await sharp({create:{width:100,height:100,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();await assert.rejects(prepareTextureReference(blank,'重复纹理'),/有效纹理不足/);
 const a=await sharp({create:{width:100,height:100,channels:3,background:'#bbbbbb'}}).png().toBuffer(),b=await sharp({create:{width:100,height:100,channels:3,background:'#444444'}}).png().toBuffer();
 assert.equal((await textureDeviation(a,a)).requiresReview,false);assert.equal((await textureDeviation(a,b)).requiresReview,true);
});

test('brick reference uses one continuous square without repeating a cropped band',async()=>{
 const w=240,h=80,data=Buffer.alloc(w*h*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.fill(30+y*2,(y*w+x)*3,(y*w+x)*3+3);
 const input=await sharp(data,{raw:{width:w,height:h,channels:3}}).png().toBuffer();
 const r=await prepareTextureReference(input,'重复纹理','砖材');
 assert.equal(r.preparation.method,'continuous-brick-square-v2');
 const {data:out,info}=await sharp(Buffer.from(r.image.split(',')[1],'base64')).raw().toBuffer({resolveWithObject:true});
 assert.equal(info.width,1024);assert.equal(info.height,1024);
 for(let y=1;y<1024;y++)assert.ok(out[(y*1024+512)*3]>=out[((y-1)*1024+512)*3]);
});

test('red court replaced with green grass is rejected but modest color corrections are allowed',async()=>{
 const png=color=>sharp({create:{width:80,height:80,channels:3,background:color}}).png().toBuffer();
 const red=await png('#d89187'),green=await png('#628451'),near=await png('#d28e81');
 assert.equal((await textureDeviation(red,green)).rejected,true);
 assert.equal((await textureDeviation(red,near)).rejected,false);
 assert.equal((await textureDeviation(red,red)).rejected,false);
});

test('reference sampling uses native pixels after locating the valid area on an analysis copy',async()=>{
 const w=1800,h=1200,pixels=Buffer.alloc(w*h*3);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*3,v=x%4<2?40:220;pixels[i]=pixels[i+1]=pixels[i+2]=v;}
 const input=await sharp(pixels,{raw:{width:w,height:h,channels:3}}).png().toBuffer();
 const result=await prepareTextureReference(input,'重复纹理','砖材');assert.equal(result.preparation.sourceWidth,w);assert.equal(result.preparation.sourceHeight,h);assert.ok(result.preparation.crop.width>768);assert.deepEqual(result.preparation.analysisSize,[768,512]);
 const crop=result.preparation.crop,side=Math.min(crop.width,crop.height);const expected=await sharp(input).extract({left:crop.left+Math.floor((crop.width-side)/2),top:crop.top+Math.floor((crop.height-side)/2),width:side,height:side}).resize(1024,1024).removeAlpha().raw().toBuffer();
 const actual=await sharp(Buffer.from(result.image.split(',')[1],'base64')).removeAlpha().raw().toBuffer();assert.deepEqual(actual,expected);
});
