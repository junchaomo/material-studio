import unittest
import cv2
import numpy as np
from image_service.presegmentation import presegment,slic_features
from image_service.processing import encode,decode
class PreselectionTests(unittest.TestCase):
 def test_same_color_distant_surface_not_merged(self):
  im=np.full((220,320,3),[40,60,180],np.uint8);im[30:180,20:110]=[180,100,70];im[30:180,210:300]=[180,100,70]
  r=presegment({'image':encode(im),'point':{'x':.2,'y':.4},'radius':1})
  mask=decode(r['image'],'L');self.assertEqual(mask[80,60],255);self.assertEqual(mask[80,250],0)
  self.assertGreater(np.count_nonzero(mask[45:160,35:95]),5000)
  self.assertTrue(r['presegmentation']['reviewRequired'])
 def test_hole_different_color_is_excluded(self):
  im=np.full((220,320,3),[210,170,130],np.uint8);im[60:120,100:160]=[30,30,30]
  r=presegment({'image':encode(im),'point':{'x':.2,'y':.4},'radius':1})
  mask=decode(r['image'],'L');self.assertEqual(mask[85,125],0);self.assertEqual(mask[85,60],255)
 def test_texture_features_distinguish_same_mean_stripes(self):
  im=np.full((160,240,3),130,np.uint8)
  im[:,:120]=np.where((np.arange(120)%8<4)[None,:,None],60,200)
  labels,color,spread,hist,gabor=slic_features(im)
  left=labels[80,55];right=labels[80,185]
  self.assertGreater(np.linalg.norm(gabor[left]-gabor[right]),.01)
  self.assertEqual(hist.shape[1],16);self.assertEqual(gabor.shape[1],8)
 def test_hints_keep_original_click_and_valid_box(self):
  im=np.full((160,240,3),20,np.uint8);im[30:130,40:180]=180
  r=presegment({'image':encode(im),'point':{'x':.4,'y':.5}})
  hints=r['presegmentation']['hints'];self.assertEqual(hints['points'],[{'x':.4,'y':.5,'label':1}])
  b=hints['box'];self.assertLessEqual(b['x']+b['width'],1);self.assertLessEqual(b['y']+b['height'],1)
if __name__=='__main__':unittest.main()

class StripedFieldTests(unittest.TestCase):
 def test_light_and_dark_stripes_connect_but_red_track_stays_out(self):
  im=np.full((200,300,3),[180,65,65],np.uint8)
  for x in range(45,255):im[40:160,x]=[75,110,55] if (x//9)%2 else [125,155,90]
  im[99:101,45:255]=[235,235,235]
  result=presegment({'image':encode(im),'point':{'x':.5,'y':.4},'radius':.8,'sensitivity':.5});mask=decode(result['image'],'L')
  self.assertGreater(np.count_nonzero(mask[45:155,50:250])/22000,.85)
  self.assertEqual(mask[15,150],0);self.assertEqual(mask[100,15],0)
 def test_search_radius_still_bounds_output(self):
  im=np.full((180,280,3),[45,65,150],np.uint8);im[30:150,25:250]=[120,160,80]
  mask=decode(presegment({'image':encode(im),'point':{'x':.5,'y':.5},'radius':.1,'sensitivity':.5})['image'],'L')
  self.assertEqual(mask[90,35],0);self.assertEqual(mask[90,140],255)

class DirectionalBoundaryTests(unittest.TestCase):
 def test_touching_same_color_grass_does_not_join_striped_surface(self):
  im=np.full((220,340,3),[100,140,70],np.uint8)
  for x in range(60,280):im[45:175,x]=[75,110,55] if (x//7)%2 else [125,155,90]
  masks=[]
  for tolerance in (.2,.5):
   result=presegment({'image':encode(im),'point':{'x':.5,'y':.5},'radius':1,'sensitivity':tolerance})
   mask=decode(result['image'],'L');masks.append(mask)
   self.assertTrue(result['presegmentation']['directionalConstraint'])
   self.assertGreater(np.count_nonzero(mask[55:165,70:270])/22000,.85)
   self.assertEqual(mask[20,170],0);self.assertEqual(mask[110,20],0)
  self.assertLessEqual(np.count_nonzero(masks[0]),np.count_nonzero(masks[1]))
 def test_uniform_surface_does_not_enable_directional_constraint(self):
  im=np.full((180,260,3),[50,70,180],np.uint8);im[20:160,30:230]=[100,140,70]
  result=presegment({'image':encode(im),'point':{'x':.5,'y':.5},'radius':1,'sensitivity':.2})
  self.assertFalse(result['presegmentation']['directionalConstraint'])
