import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import cv2
import numpy as np
from image_service.processing import select_texture_roi, rectify, encode, decode

class TextureROITests(unittest.TestCase):
    def scene(self):
        image=np.full((240,360,3),[150,95,65],np.uint8)
        mask=np.zeros((240,360),np.uint8);mask[15:225,15:345]=255
        plane=np.float32([[15,15],[344,15],[344,224],[15,224]])
        return image,mask,plane
    def raster(self,points,shape):
        polygon=np.zeros(shape,np.uint8);cv2.fillConvexPoly(polygon,np.rint(points).astype(np.int32),255);return polygon>0
    def test_contains_no_holes_or_border(self):
        image,mask,plane=self.scene();mask[50:100,80:130]=0
        points,meta=select_texture_roi(image,mask,plane)
        self.assertIsNotNone(points);region=self.raster(points,mask.shape)
        self.assertTrue(np.all(mask[region]>0));self.assertGreater(np.count_nonzero(region),1000)
        self.assertEqual(meta['planarity'],'requires-review')
    def test_avoids_broad_occlusion_and_highlight(self):
        image,mask,plane=self.scene();image[20:160,20:135]=[5,5,5];image[150:220,210:340]=255
        points,meta=select_texture_roi(image,mask,plane)
        self.assertIsNotNone(points);region=self.raster(points,mask.shape)
        self.assertFalse(np.any(region[20:160,20:135]));self.assertFalse(np.any(region[150:220,210:340]))
    def test_stable_and_keeps_source_pixels(self):
        image,mask,plane=self.scene()
        first,meta=select_texture_roi(image,mask,plane);second,_=select_texture_roi(image,mask,plane)
        np.testing.assert_array_equal(first,second)
        data={'image':encode(image),'mask':encode(mask),'estimateOnly':True}
        estimated=rectify(data);self.assertEqual(estimated['geometry']['roi']['status'],'proposed')
        data.pop('estimateOnly');data['quad']=estimated['geometry']['quad']
        result=decode(rectify(data)['image'],'RGBA')
        self.assertTrue(np.all(result[:,:,3]==255));self.assertLess(np.abs(result[:,:,:3].astype(float)-[150,95,65]).max(),2)
    def test_no_candidate_does_not_claim_success(self):
        image,mask,plane=self.scene();mask[:]=0;mask[100:102,100:200]=255
        points,meta=select_texture_roi(image,mask,plane)
        self.assertIsNone(points);self.assertEqual(meta['status'],'unavailable')

if __name__=='__main__':unittest.main()

