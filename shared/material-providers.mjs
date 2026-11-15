// 模型配置的分组顺序：仅国内通道。OpenAI 兼容协议用于 DeepSeek、智谱、硅基流动等国内服务商。
export const materialProviders=[['dashscope','阿里百炼'],['volcengine','豆包 · 火山引擎'],['openai','兼容接口 · 国内厂商']];
export function materialProvider(model){
 if(model.protocol==='dashscope')return 'dashscope';
 if(model.protocol==='volcengine')return 'volcengine';
 if(model.protocol==='openai')return 'openai';
 return null;
}
