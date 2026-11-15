import unittest
import numpy as np
import cv2
from image_service.processing import rectify, postprocess, enhance, encode, decode

class CPUProcessingTests(unittest.TestCase):
    def input(self, mask):
        image=np.zeros((120,180,3),np.uint8);image[:]=[140,110,90];image[mask>=128]=[230,180,130]
        return {'image':encode(image),'mask':encode(mask)}
    def test_estimate_pauses_before_warp_even_with_reliable_edges(self):
        mask=np.zeros((120,180),np.uint8);cv2.fillPoly(mask,[np.array([[40,10],[130,25],[160,105],[20,100]])],255)
        data=self.input(mask);data['estimateOnly']=True
        result=rectify(data)
        self.assertEqual(result['geometry']['status'],'needs-review')
        self.assertEqual(result['geometry']['phase'],'corners-review')
        self.assertEqual(len(result['geometry']['quad']),4)
        self.assertGreaterEqual(result['geometry']['edgeSupport'],2)
        data.pop('estimateOnly');data['quad']=result['geometry']['quad']
        self.assertEqual(rectify(data)['geometry']['status'],'rectified')
    def test_estimate_has_reviewable_fallback_without_image_edges(self):
        mask=np.zeros((120,180),np.uint8);cv2.circle(mask,(90,60),35,255,-1)
        data=self.input(mask);data['image']=encode(np.full((120,180,3),130,np.uint8));data['estimateOnly']=True
        result=rectify(data)
        self.assertEqual(result['geometry']['confidence'],'low')
        self.assertEqual(result['geometry']['status'],'needs-review')
        self.assertEqual(len(result['geometry']['quad']),4)
    def test_front_and_hole(self):
        mask=np.zeros((120,180),np.uint8);mask[20:100,30:150]=255;mask[40:65,70:95]=0
        r=rectify(self.input(mask));self.assertEqual(r['geometry']['status'],'frontal')
        self.assertTrue(np.any(decode(r['image'],'RGBA')[:,:,3]==0))
    def test_trapezoid(self):
        mask=np.zeros((120,180),np.uint8);cv2.fillPoly(mask,[np.array([[40,10],[130,25],[160,105],[20,100]])],255)
        r=rectify(self.input(mask));self.assertEqual(r['geometry']['status'],'rectified');self.assertEqual(len(r['geometry']['quad']),4)
    def test_ragged_mask_recovers_dominant_plane_with_image_evidence(self):
        mask=np.zeros((120,180),np.uint8)
        cv2.fillPoly(mask,[np.array([[40,10],[130,25],[160,105],[20,100]])],255)
        mask[25:33,44:52]=0
        mask[80:88,150:158]=255
        result=rectify(self.input(mask))
        self.assertEqual(result['geometry']['status'],'rectified')
        self.assertEqual(result['geometry']['method'],'opencv-homography')
    def test_uncertain_requires_explicit_original(self):
        mask=np.zeros((120,180),np.uint8);cv2.circle(mask,(90,60),35,255,-1)
        data=self.input(mask);self.assertEqual(rectify(data)['geometry']['status'],'needs-review')
        data['keepOriginal']=True;self.assertEqual(rectify(data)['geometry']['status'],'kept-original')
    def test_disjoint_does_not_invent_combined_plane(self):
        mask=np.zeros((120,180),np.uint8);mask[10:30,10:30]=255;mask[80:110,130:170]=255
        r=rectify(self.input(mask));self.assertLess(r['geometry']['coverage'],1.01)
    def test_rgb_seams_and_resolution(self):
        data=np.zeros((32,32,3),np.uint8);data[:,:16]=20;data[:,16:]=200
        r=postprocess({'image':encode(data),'resolution':1024,'seamless':True});out=decode(r['image'],'RGB')
        self.assertEqual(out.shape,(1024,1024,3));self.assertTrue(np.array_equal(out[:,0],out[:,-1]));self.assertTrue(r['postprocess']['reviewRequired'])
    def test_empty_mask_rejected(self):
        with self.assertRaises(ValueError):rectify(self.input(np.zeros((120,180),np.uint8)))
    def test_faithful_enhancement_preserves_source_stripes_and_excludes_mask_holes(self):
        pixels=np.zeros((90,140,4),np.uint8);pixels[:,:,:3]=[30,150,80];pixels[:,:,3]=255
        pixels[:,::2,:3]=[90,180,100];pixels[:8,:,3]=0;pixels[30:45,60:75,3]=0
        result=enhance({'image':encode(pixels),'resolution':1024,'seamless':False})
        crop=result['postprocess']['sourceCrop'];x,y,w=crop['x'],crop['y'],crop['width']
        self.assertTrue(np.all(pixels[y:y+w,x:x+w,3]==255))
        self.assertFalse(result['postprocess']['generative'])
        self.assertFalse(result['postprocess']['edgeBlend'])
        output=decode(result['image'],'RGB');self.assertEqual(output.shape,(1024,1024,3))
        self.assertGreater(output[:,:,1].mean(),output[:,:,0].mean())
    def test_seven_by_nine_mask_has_actionable_failure(self):
        mask=np.zeros((120,180),np.uint8);mask[40:49,70:77]=255
        with self.assertRaisesRegex(ValueError,'Mask too small or empty'):rectify(self.input(mask))
    def test_mask_quad_without_image_evidence_pauses(self):
        mask=np.zeros((120,180),np.uint8);mask[20:100,30:150]=255
        data=self.input(mask);data['image']=encode(np.full((120,180,3),130,np.uint8))
        self.assertEqual(rectify(data)['geometry']['status'],'needs-review')

if __name__=='__main__':unittest.main()

class NativeResolutionTests(unittest.TestCase):
    def test_local_rectification_preserves_large_plane_dimensions(self):
        import os
        from unittest.mock import patch
        image=np.full((900,3400,3),160,np.uint8)
        mask=np.zeros((900,3400),np.uint8)
        mask[100:801,100:3301]=255
        points=[(100,100),(3300,100),(3300,800),(100,800)]
        data={'image':encode(image),'mask':encode(mask),'quad':[{'x':x/3399,'y':y/899} for x,y in points]}
        with patch.dict(os.environ,{'LOCAL_STORAGE_MODE':'true'}):
            result=rectify(data)
            output=decode(result['image'],'RGBA')
        self.assertEqual(output.shape[:2],(700,3200))
