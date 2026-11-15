import test from 'node:test';
import assert from 'node:assert/strict';
import {reconstructionImages} from '../backend/server/reconstruction-images.mjs';
import {reconstructionPrompt} from '../backend/server/qwen-image.mjs';
test('direct generation sends only rectified sample without mask or synthesized base',()=>{
 const input={directGeneration:true,referenceMode:'rectified-only',image:'rectified',contextImage:'scene',repairMask:'mask',referenceImage:'base',category:'砖材',part:'墙面',kind:'重复纹理',seamless:true};
 assert.deepEqual(reconstructionImages(input),['rectified']);
 const prompt=reconstructionPrompt(input);assert.match(prompt,/重新生成整张/);assert.match(prompt,/不是局部修正/);assert.match(prompt,/白色污痕/);
});
