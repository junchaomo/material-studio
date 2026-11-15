import sys, unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from image_service.source_reconstruction import reconstruct,period,SourceSynthesisUnavailable
from image_service.processing import encode,decode

class SourceReconstructionTests(unittest.TestCase):
 def run_image(self,img,**kw):
  return reconstruct(dict(image=encode(img),resolution=128,restoration='off',seed='fixed',seamless=True,**kw))
 def test_full_source_extent_and_rgb(self):
  img=np.full((160,160,3),90,np.uint8);img[:,80:]=110
  r=self.run_image(img,materialType='complex')
  self.assertFalse(r['preparation']['roiReselected']);self.assertEqual(r['preparation']['sourceWidth'],160)
  out=decode(r['image'],'RGB');self.assertEqual(out.shape,(128,128,3));self.assertLess(out[20,20,0],out[20,100,0])
  self.assertEqual(decode(r['preview'],'RGB').shape,(768,768,3));self.assertFalse(r['ai_inferred'])
 def test_deterministic_random_quilting(self):
  img=np.random.default_rng(12).integers(60,150,(64,64,3),dtype=np.uint8)
  a=self.run_image(img,materialType='random');b=self.run_image(img,materialType='random')
  self.assertEqual(a['image'],b['image']);self.assertEqual(a['chosen_algorithm'],'minimum-error-quilting')
 def test_no_fake_period_for_missing_evidence(self):
  img=np.full((40,60,3),120,np.uint8)
  with self.assertRaises(SourceSynthesisUnavailable) as caught:self.run_image(img,materialType='periodic')
  self.assertEqual(caught.exception.code,'SOURCE_SYNTHESIS_UNAVAILABLE')
  self.assertIn('AI 重新生成',str(caught.exception))
 def test_api_preserves_synthesis_failure_reason(self):
  import asyncio,json,os
  from unittest.mock import patch
  from fastapi import HTTPException
  from starlette.requests import Request
  from api.material_processing import process
  body=json.dumps(dict(operation='reconstruct_source',image=encode(np.full((40,60,3),120,np.uint8)),resolution=128,materialType='periodic')).encode()
  async def receive():return {'type':'http.request','body':body,'more_body':False}
  request=Request({'type':'http','method':'POST','path':'/api/material_processing','headers':[(b'authorization',b'Bearer test-worker')]},receive)
  with patch.dict(os.environ,{'QMX_CLOUD_WORKER_TOKEN':'test-worker','LOCAL_STORAGE_MODE':'true'}):
   with self.assertRaises(HTTPException) as caught:asyncio.run(process(request))
  self.assertEqual(caught.exception.status_code,422)
  self.assertEqual(caught.exception.headers['X-Processing-Error'],'SOURCE_SYNTHESIS_UNAVAILABLE')
  self.assertIn('AI 重新生成',caught.exception.detail)
 def test_stripes_keep_phase(self):
  unit=np.full((80,20,3),100,np.uint8);unit[:,10:]=160
  img=np.tile(unit,(1,8,1));r=self.run_image(img,materialType='directional');out=decode(r['image'],'RGB')
  self.assertEqual(period(img,1),20);self.assertTrue(np.array_equal(out[0],out[64]));self.assertTrue(np.array_equal(out[64],out[-1]))
 def test_bad_mask_rejected(self):
  img=np.zeros((80,80,4),np.uint8);img[:10,:,3]=255
  with self.assertRaises(ValueError):self.run_image(img)
 def test_low_resolution_flagged(self):
  r=self.run_image(np.full((40,50,3),120,np.uint8),materialType='uniform')
  self.assertTrue(any('50×40' in x for x in r['warnings']));self.assertFalse(r['sr_applied']);self.assertFalse(r['quality_report']['calibrated'])

if __name__=='__main__':unittest.main()
