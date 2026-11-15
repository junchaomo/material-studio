export function finalMaskConfirmed(candidate){
 const meta=candidate?.sources?.[0]||{};
 return !!candidate?.mask_asset_id&&meta.maskConfirmation?.assetId===candidate.mask_asset_id;
}
export function materialInfoConfirmed(candidate,notes){
 const meta=candidate?.sources?.[0]||{},info=meta.infoConfirmation;
 return finalMaskConfirmed(candidate)&&!!info&&['name','category','kind','part','description'].every(k=>info[k]===candidate[k])&&info.maskAssetId===candidate.mask_asset_id&&info.rectifiedAssetId===meta.rectifiedAssetId&&(notes===undefined||notes===info.notes);
}
export function materialGenerationState(candidate,{busy=false,running=false,notes=''}={}){
 const meta=candidate?.sources?.[0]||{};
 if(busy)return {ready:false,reason:'正在保存或提交，请稍候。'};
 if(running)return {ready:false,reason:'当前步骤仍在处理，请等待完成。'};
 if(!finalMaskConfirmed(candidate))return {ready:false,reason:'请先确认最终 Mask。'};
 if(!meta.rectifiedAssetId||!['frontal','rectified'].includes(meta.geometry?.status))return {ready:false,reason:'请等待透视处理完成。'};
 if(!materialInfoConfirmed(candidate,notes))return {ready:false,reason:'请核对并点击“确认材质信息”；修改名称、分类、描述或备注后需重新确认。'};
 return {ready:true,manual:meta.featureSource==='manual-confirmed',reason:meta.featureSource==='manual-confirmed'?'本次使用人工确认的材质属性。':''};
}
