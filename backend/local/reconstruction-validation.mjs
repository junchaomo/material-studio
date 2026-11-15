export function validateLocalReconstruction(candidate,parameters){
 if(parameters.textureMode==='ai'&&!['重复纹理','纯色渐变'].includes(candidate.kind))throw Object.assign(Error('当前纹理类型为专用图案。请返回材质信息核对：普通斑驳或屋面肌理请选择有纹理；文字或标志请使用原样保真增强。'),{status:400});
}
