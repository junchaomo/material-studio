import hmac
import os
import json
import base64
import urllib.request
import urllib.error
from urllib.parse import quote
from io import BytesIO
from PIL import Image
from fastapi import FastAPI, Request, HTTPException
from image_service.processing import rectify, postprocess, enhance
from image_service.presegmentation import presegment
from image_service.quilting import synthesize
from image_service.source_reconstruction import reconstruct, SourceSynthesisUnavailable
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

@app.post('/api/material_processing')
async def process(request: Request):
    token = os.environ.get('QMX_CLOUD_WORKER_TOKEN', '')
    if not token or not hmac.compare_digest(request.headers.get('authorization',''), 'Bearer '+token):
        raise HTTPException(401, 'Worker required')
    body = await request.body()
    if os.environ.get('LOCAL_STORAGE_MODE') != 'true' and len(body) > 4400000:
        raise HTTPException(413, 'Processing input too large')
    data = json.loads(body)
    try:
        if data.get('operation') == 'probe': return {'cpu':True,'opencv':True,'pillow':True,'inference':False}
        if data.get('operation') == 'presegment': result=presegment(data)
        elif data.get('operation') == 'rectify': result=rectify(data)
        elif data.get('operation') == 'postprocess': result=postprocess(data)
        elif data.get('operation') == 'enhance': result=enhance(data)
        elif data.get('operation') == 'synthesize': result=synthesize(data)
        elif data.get('operation') == 'reconstruct_source': result=reconstruct(data)
        else: raise ValueError('Unknown operation')
        return result
    except SourceSynthesisUnavailable as error:
        raise HTTPException(422, str(error), headers={'X-Processing-Error': error.code}) from error
    except (ValueError, KeyError) as error:
        reasons={'Insufficient valid rectified sample':'正视样本有效区域不足，请返回透视矫正检查选区。','Processing image too large':'图像超过当前处理环境的像素限制。', 'Candidate region ambiguous':'候选区域过小或接近整图，请调整相似度或范围后重试。','Mask too small or empty':'Mask 区域过小或为空，无法提取可靠纹理。请查看 Mask 并精修扩大到目标材质面。', 'Invalid planar corners':'平面四角无效，请调整四角或保留原始样本。','Corners do not overlap selected material':'四角未覆盖目标材质，请检查 Mask 与平面四角。'}
        reasons['Invalid resolution'] = '输出分辨率无效，请填写大于 0 的整数。'
        raise HTTPException(422, reasons.get(str(error), '图像或 Mask 无法处理，请检查输入。'))
