// 供国内模型适配器共用的错误类型与图片入参校验（百炼 / 火山方舟 / OpenAI 兼容接口）。
export class ApiError extends Error {
  constructor(message, status = 400, code = 'invalid_request') { super(message); this.status = status; this.code = code; }
}
export function imageInput(value) {
  if (typeof value !== 'string') throw new ApiError('缺少有效的图片数据。', 400);
  if (process.env.LOCAL_STORAGE_MODE!=='true'&&value.length > 5600000) throw new ApiError('图片过大，请缩小后重试。', 413);
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new ApiError('仅接受 PNG / JPEG 图片数据。');
  const bytes = Buffer.from(match[2], 'base64');
  const valid = match[1] === 'png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid || bytes.length < 24) throw new ApiError('图片内容与格式不符。');
  return { data: value, bytes, mime: 'image/' + match[1] };
}
