import {ApiError} from './ai.mjs';

// Never include raw exception messages, URLs, headers or request bodies in diagnostics.
const descriptions={
 ENOTFOUND:'接口域名无法解析',EAI_AGAIN:'接口域名解析暂时失败',
 ECONNREFUSED:'接口拒绝连接',ECONNRESET:'连接被中断',EPIPE:'连接在发送时中断',
 ETIMEDOUT:'连接超时',UND_ERR_CONNECT_TIMEOUT:'建立连接超时',
 UND_ERR_HEADERS_TIMEOUT:'等待响应超时',UND_ERR_BODY_TIMEOUT:'读取响应超时',
 CERT_HAS_EXPIRED:'接口证书已过期',UNABLE_TO_VERIFY_LEAF_SIGNATURE:'接口证书校验失败',
 DEPTH_ZERO_SELF_SIGNED_CERT:'接口证书不受信任',ERR_TLS_CERT_ALTNAME_INVALID:'接口证书域名不匹配',
 UND_ERR_SOCKET:'服务连接已关闭',ERR_INVALID_URL:'接口地址无效',ABORTED:'请求超时或被取消'
};
export function networkDiagnostic(error){
 const queue=[error],seen=new Set();
 while(queue.length){const e=queue.shift();if(!e||typeof e!=='object'||seen.has(e))continue;seen.add(e);
  if(Object.hasOwn(descriptions,e.code))return {code:e.code,reason:descriptions[e.code]};
  if(e.cause)queue.push(e.cause);if(Array.isArray(e.errors))queue.push(...e.errors);
 }
 const code=['TimeoutError','AbortError'].includes(error?.name)?'ABORTED':'NETWORK_ERROR';
 return {code,reason:descriptions[code]||'连接未完成'};
}
export function providerConnectionError(error,provider){
 const d=networkDiagnostic(error);
 return new ApiError(`处理服务连接${provider}失败：${d.reason}（${d.code}）。请联系管理员检查服务端连接；不要连续重试，本次请求可能已计费。`,502,'network_error');
}
