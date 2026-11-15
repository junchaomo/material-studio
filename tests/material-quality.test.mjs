import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sampleQuad,normalizeInventory} from '../backend/server/inventory.mjs';
const rect=(x,y,w,h)=>({top_left:{x,y},top_right:{x:x+w,y},bottom_right:{x:x+w,y:y+h},bottom_left:{x,y:y+h}});
test('small clean patches remain valid; crossed, degenerate and out-of-bounds patches do not',()=>{
 assert.equal(sampleQuad(rect(.5,.2,.01,.01)).length,4);
 for(const r of [rect(0,0,0,.1),rect(.99,.2,.1,.1),{...rect(0,0,.1,.1),bottom_left:{x:.2,y:0}}])assert.throws(()=>sampleQuad(r));
});
test('mixed-material warnings override a claimed pure sample without removing the material need',()=>{
 const m={name:'红砖',category:'砖材',kind:'重复纹理',description:'红色外墙',confidence:.9,sampleSuitable:true,region:rect(.1,.1,.1,.1),risks:['选区包含窗户与混合材质']};
 const result=normalizeInventory({materials:[m]},{part:'外墙与门窗'});
 assert.equal(result.length,1);assert.equal(result[0].quad,null);assert.equal(result[0].sampleSuitable,false);
});
