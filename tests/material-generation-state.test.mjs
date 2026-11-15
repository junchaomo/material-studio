import test from 'node:test';
import assert from 'node:assert/strict';
import {materialGenerationState,finalMaskConfirmed,materialInfoConfirmed} from '../shared/material-generation-state.mjs';
const data={name:'浅灰屋面',category:'铺装',kind:'重复纹理',part:'屋顶',description:'灰白色颗粒',mask_asset_id:'mask',sources:[{rectifiedAssetId:'rectified',geometry:{status:'rectified'},maskConfirmation:{assetId:'mask'},features:{baseColor:'灰白'}}]};
const confirmed=()=>({...data,sources:[{...data.sources[0],infoConfirmation:{...Object.fromEntries(['name','category','kind','part','description'].map(k=>[k,data[k]])),maskAssetId:'mask',rectifiedAssetId:'rectified',notes:''}}]});
test('saving text or AI features never implicitly confirms material information',()=>{assert.equal(materialGenerationState(data).ready,false);assert.match(materialGenerationState(data).reason,/确认材质信息/);});
test('only confirmed current Mask, geometry and information enable an explicit reconstruction',()=>{assert.equal(materialGenerationState(confirmed()).ready,true);assert.equal(materialGenerationState(confirmed(),{busy:true}).ready,false);assert.equal(materialGenerationState(confirmed(),{running:true}).ready,false);});
test('editing any confirmed field or note invalidates consent; replacing Mask or geometry also invalidates consent',()=>{
 for(const key of ['name','category','kind','part','description'])assert.equal(materialInfoConfirmed({...confirmed(),[key]:'edited'}),false);
 assert.equal(materialInfoConfirmed(confirmed(),'new notes'),false);
 const c=confirmed();c.mask_asset_id='new-mask';assert.equal(finalMaskConfirmed(c),false);assert.equal(materialGenerationState(c).ready,false);
 const g=confirmed();g.sources[0].rectifiedAssetId='new-geometry';assert.equal(materialGenerationState(g).ready,false);
});
