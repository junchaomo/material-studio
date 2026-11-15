import unittest
import numpy as np
from image_service.processing import encode,decode
from image_service.quilting import synthesize,_clean_brick_sample
class QuiltingTests(unittest.TestCase):
 def sample(self):
  rng=np.random.default_rng(123);rgb=rng.integers(90,170,(100,180,3),dtype=np.uint8);rgba=np.dstack([rgb,np.full((100,180),255,np.uint8)]);rgba[:5,:,3]=0
  return encode(rgba)
 def test_deterministic_and_bounded(self):
  data={'image':self.sample(),'kind':'重复纹理','category':'其他','seed':'fixed'};a=synthesize(data);b=synthesize(data)
  self.assertEqual(a['image'],b['image']);self.assertEqual(a['repairMask'],b['repairMask']);self.assertEqual(decode(a['image'],'RGB').shape,(512,512,3));self.assertLess(a['preparation']['repairFraction'],.6);self.assertEqual(a['preparation']['crop']['width'],a['preparation']['crop']['height'])
 def test_structured_material_uses_continuous_sample(self):
  a=synthesize({'image':self.sample(),'kind':'重复纹理','category':'砖材','seed':'fixed'});self.assertEqual(a['preparation']['method'],'continuous-structured-sample-v1')
 def test_directional_grass_keeps_continuous_stripes(self):
  rng=np.random.default_rng(42);x=np.arange(180)
  base=np.where((x//15%2)[None,:,None],np.array([70,110,50]),np.array([130,165,90]))
  rgb=np.clip(np.broadcast_to(base,(180,180,3))+rng.integers(-5,6,(180,180,3)),0,255).astype(np.uint8)
  result=synthesize({'image':encode(np.dstack([rgb,np.full((180,180),255,np.uint8)])),'kind':'重复纹理','category':'景观','seed':'grass'})
  self.assertEqual(result['preparation']['method'],'continuous-directional-sample-v1')
  out=decode(result['image'],'RGB').astype(float)
  # No independently shifted horizontal patch rows may be introduced.
  profile=out[:,:,1].mean(axis=0)
  self.assertGreater(np.corrcoef(profile,out[50,:,1])[0,1],.99)
  self.assertGreater(np.corrcoef(profile,out[420,:,1])[0,1],.99)
  mask=decode(result['repairMask'],'L');self.assertEqual(mask[256,256],0)
 def test_small_brick_uses_clean_part_outside_initial_square(self):
  rgba=np.full((150,68,4),255,np.uint8);rgba[:,:,:3]=[180,110,80]
  rgba[15:45,15:40,:3]=[230,225,220]
  crop={'left':5,'top':13,'width':57,'height':57}
  sample=rgba[13:70,5:62,:3]
  out,new,report=_clean_brick_sample(sample,crop,rgba)
  self.assertTrue(report['applied']);self.assertEqual(report['residueFractionAfter'],0)
  np.testing.assert_array_equal(out,rgba[new['top']:new['top']+new['height'],new['left']:new['left']+new['width'],:3])
 def test_clean_brick_and_pale_material_are_unchanged(self):
  for color in ([180,110,80],[200,200,195]):
   sample=np.zeros((57,57,3),np.uint8);sample[:]=color
   out,_,report=_clean_brick_sample(sample,{'left':0,'top':0,'width':57,'height':57})
   self.assertFalse(report['applied']);np.testing.assert_array_equal(out,sample)
 def test_empty_mask_rejected_before_ai(self):
  with self.assertRaises(ValueError):synthesize({'image':encode(np.zeros((50,50,4),np.uint8))})
if __name__=='__main__':unittest.main()
