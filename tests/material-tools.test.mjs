import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {validateModel} from '../backend/server/model-config.mjs';
import {qualityMetrics,blendEdges,csvManifest} from '../shared/texture-tools.mjs';

test('quality metric detects seam discontinuity and auxiliary repair reduces it',()=>{
 const data=new Uint8ClampedArray(32*32*4);for(let y=0;y<32;y++)for(let x=0;x<32;x++){const i=(y*32+x)*4;data[i]=data[i+1]=data[i+2]=x*8;data[i+3]=255;}
 const before=qualityMetrics(data,32,32);blendEdges(data,32,32);assert.ok(qualityMetrics(data,32,32).edgeDifference<before.edgeDifference);assert.equal(data[3],255);
});
test('CSV exports usage, scale, version and audit state while preventing formula injection',()=>{
 const csv=csvManifest([{id:'version',code:'MAT-1',name:'=danger()',category:'砖材',part:'外墙',confirmed:true,physical_width_m:2,physical_height_m:1}]);assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes("'=danger()"));assert.ok(csv.includes('textures/version_Diffuse.png'));assert.ok(csv.includes('已确认'));
});
