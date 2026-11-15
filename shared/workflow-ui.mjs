export const workflowStages=['区域识别','查看选区','透视矫正','材质信息','纹理重建','保存入库'];
export function stageView(stage,hasSample,hasResult){if(stage<=2)return 'source';if(stage===3)return hasSample?'rectified':'source';return hasResult?'diffuse':hasSample?'rectified':'source';}
