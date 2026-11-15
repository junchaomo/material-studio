"""Source-driven reconstruction. No ROI reselection, rotation or generative inference."""
import hashlib
import cv2
import numpy as np
from scipy.ndimage import distance_transform_edt
from .processing import decode, encode
from .quilting import _cut


class SourceSynthesisUnavailable(ValueError):
    code = 'SOURCE_SYNTHESIS_UNAVAILABLE'

    def __init__(self):
        super().__init__('本机合成未完成：当前正视样本缺少可靠重复周期，无法保持比例生成正方形贴图。请使用方法二「AI 重新生成」，或返回透视矫正调整取样。')


def period(image, axis):
    # Compare translated full patches, not only projection peaks (brick stagger matters).
    gray=cv2.cvtColor(image,cv2.COLOR_RGB2GRAY).astype(np.float32)
    n=gray.shape[axis]
    if n<16 or gray.std()<2:return None
    gray=cv2.GaussianBlur(gray,(0,0),.7)
    variance=float(gray.var())+1e-6
    scores=[]
    for lag in range(4,n//2+1):
        a,b=(gray[lag:],gray[:-lag]) if axis==0 else (gray[:,lag:],gray[:,:-lag])
        scores.append(float(np.mean((a-b)**2)/variance))
    # First reliable local minimum preserves fundamental period, not a multiple.
    for i in range(1,len(scores)-1):
        if scores[i]<.18 and scores[i]<=scores[i-1] and scores[i]<=scores[i+1]:return i+4
    return None


def analyze(rgb, valid):
    g=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY).astype(np.float32)
    blur=cv2.GaussianBlur(g,(0,0),1.2)
    dx=cv2.Sobel(blur,-1,1,0);dy=cv2.Sobel(blur,-1,0,1)
    a,b,c=float(np.mean(dx*dx)),float(np.mean(dy*dy)),float(np.mean(dx*dy))
    strength=float(np.sqrt((a-b)**2+4*c*c)/(a+b+1e-9))
    direction=float(np.degrees(.5*np.arctan2(2*c,a-b))+90)
    lab=cv2.cvtColor(rgb,cv2.COLOR_RGB2LAB).astype(float)
    return {'width':int(rgb.shape[1]),'height':int(rgb.shape[0]),'validFraction':float(valid.mean()),'clarity':float(cv2.Laplacian(g,cv2.CV_32F).var()),'directionality':strength,'directionDegrees':direction,'periodX':period(rgb,1),'periodY':period(rgb,0),'meanLab':lab[valid].mean(axis=0).tolist(),'brightnessSpread':float(np.std(blur[valid]))}


def quilt(source, side, seed, directional=False):
    rng=np.random.default_rng(seed);h,w=source.shape[:2]
    patch=min(128,max(8,min(h,w)//2));overlap=max(2,round(patch*.25));step=patch-overlap
    out=np.zeros((side,side,3),np.uint8)
    for y in range(0,side,step):
        for x in range(0,side,step):
            ph,pw=min(patch,side-y),min(patch,side-x);oy,ox=min(overlap,ph),min(overlap,pw)
            best=None;score=float('inf')
            for _ in range(24):
                sy=int(rng.integers(0,h-ph+1));sx=int(rng.integers(0,w-pw+1))
                if directional:sy=y%max(1,h-ph+1) # fixed row phase, no rotations
                candidate=source[sy:sy+ph,sx:sx+pw];err=0
                old=out[y:y+ph,x:x+pw]
                if x:err+=np.mean((old[:,:ox].astype(float)-candidate[:,:ox])**2)
                if y:err+=np.mean((old[:oy].astype(float)-candidate[:oy])**2)
                if err<score:score=err;best=candidate.copy()
            keep=np.zeros((ph,pw),bool)
            if x:
                cut=_cut(np.mean((old[:,:ox].astype(float)-best[:,:ox])**2,axis=2))
                for row,k in enumerate(cut):keep[row,:k]=True
            if y:
                cut=_cut(np.mean((old[:oy].astype(float)-best[:oy])**2,axis=2).T)
                for col,k in enumerate(cut):keep[:k,col]=True
            old[:]=np.where(keep[:,:,None],old,best)
    return out


def wrap_cut(rgb):
    # Minimum-error opposite-edge overlap. No broad edge blur.
    h,w=rgb.shape[:2];band=max(2,min(h,w)//12)
    err=np.mean((rgb[:,:band].astype(float)-rgb[:,-band:].astype(float))**2,axis=2)
    seam=_cut(err);out=rgb[:,:w-band].copy()
    for y,k in enumerate(seam):out[y,:k]=rgb[y,w-band:w-band+k]
    top=out[:band];bottom=out[-band:]
    seam=_cut(np.mean((top.astype(float)-bottom.astype(float))**2,axis=2).T)
    result=out[:h-band].copy()
    for x,k in enumerate(seam):result[:k,x]=out[h-band:h-band+k,x]
    return result


def reconstruct(data):
    rgba=decode(data['image'],'RGBA');h,w=rgba.shape[:2];valid=rgba[:,:,3]>=250
    if min(h,w)<8 or valid.mean()<.8:raise ValueError('Insufficient valid rectified sample')
    rgb=rgba[:,:,:3].copy();warnings=[]
    if not valid.all():
        # Fill only invalid pixels; retain full sample extent and native geometry.
        nearest=distance_transform_edt(~valid,return_distances=False,return_indices=True)
        rgb[~valid]=rgb[nearest[0][~valid],nearest[1][~valid]]
        warnings.append('样本透明缺口已用邻近有效像素填充，请检查边缘。')
    analysis=analyze(rgb,valid)
    source=rgb.copy();restoration=data.get('restoration','auto_conservative');fidelity=data.get('fidelity','strict')
    if restoration=='enhance' or (restoration=='auto_conservative' and 2<analysis['clarity']<35):
        blur=cv2.GaussianBlur(source,(0,0),.8)
        # Bounded unsharp correction; native pixels are never declared recovered detail.
        delta=np.clip((source.astype(float)-blur)*.25,-4,4)
        source=np.clip(source.astype(float)+delta,0,255).astype(np.uint8)
    kind=data.get('materialType','auto');px,py=analysis['periodX'],analysis['periodY']
    if kind=='auto':
        if data.get('kind')=='专用图案' or data.get('category')=='玻璃':kind='complex'
        elif data.get('kind')=='纯色渐变':kind='complex'
        elif px and py:kind='periodic'
        elif analysis['directionality']>.55:kind='directional'
        elif np.std(source.astype(float),axis=(0,1)).mean()<5:kind='uniform'
        elif data.get('category')=='砖材':kind='complex'
        else:kind='random'
    native=min(h,w)
    if native<128:warnings.append(f'原始样本仅 {w}×{h} 像素；放大不代表恢复真实细节，建议补充清晰参考。')
    if kind=='periodic' and not (px and py):
        kind='complex';warnings.append('未找到可靠的双向周期，保留完整样本，不强行拼接砖缝。')
    # Conservative repair of clear pale deposits only in moderate mode, using
    # same-phase donors from reliable periodic units. Mortar and natural variation stay.
    repaired=0
    if fidelity=='moderate' and data.get('category')=='砖材' and px and py:
        warmth=source[:,:,0].astype(float)-source[:,:,2];light=source.mean(axis=2)
        suspects=(warmth<np.median(warmth)*.65)&(light>np.median(light)+18)
        original=source.copy()
        for y,x in np.argwhere(suspects):
            donors=original[y%py::py,x%px::px];safe=~suspects[y%py::py,x%px::px]
            if safe.sum()>=3:source[y,x]=np.median(donors[safe],axis=0);repaired+=1
    side=int(data.get('resolution',1024))
    if side<1:raise ValueError('Invalid resolution')
    seed=int.from_bytes(hashlib.sha256(str(data.get('seed','0')).encode()).digest()[:4],'little')
    # Work at source feature density and resize once at the output boundary.
    work=max(32,min(768,max(h,w)));seamless=bool(data.get('seamless')) and kind!='complex'
    if kind=='periodic':
        tile=source[:py,:px];nx=max(1,round(w/px));ny=max(1,round(h/py))
        # Match physical x/y pixel scale in the square canvas using whole cycles.
        nx=max(1,round(max(h,w)/px));ny=max(1,round(max(h,w)/py))
        out=np.tile(tile,(ny,nx,1));method='autocorrelation-periodic-unit'
    elif kind=='directional':
        if px:
            out=np.tile(source[:,:px],(1,max(1,round(max(h,w)/px)),1))
        elif py:
            out=np.tile(source[:py],(max(1,round(max(h,w)/py)),1,1))
        else:
            # Preserve continuous grain. Reflect extension does not rotate the sample.
            length=max(h,w);out=cv2.copyMakeBorder(source,0,length-h,0,length-w,cv2.BORDER_REFLECT_101)
        method='direction-preserving-extension'
        if seamless:out=wrap_cut(out)
    elif kind=='uniform':
        rng=np.random.default_rng(seed);mean=source.mean(axis=(0,1));sigma=np.minimum(source.std(axis=(0,1)),2)
        out=np.clip(mean+rng.normal(size=(work,work,3))*sigma,0,255).astype(np.uint8);method='bounded-color-statistics'
        if seamless:out=wrap_cut(out)
    elif kind=='random':
        out=quilt(source,work,seed);method='minimum-error-quilting'
        if seamless:out=wrap_cut(out)
    else:
        # Do not fabricate square coverage by stretching edge pixels.
        if h!=w:raise SourceSynthesisUnavailable()
        out=source.copy();method='preserve-complete-sample'
        if data.get('seamless'):warnings.append('复杂图案或周期证据不足，未强制无缝化。')
    out=cv2.resize(out,(side,side),interpolation=cv2.INTER_AREA if max(out.shape[:2])>side else cv2.INTER_CUBIC)
    lab=cv2.cvtColor(out,cv2.COLOR_RGB2LAB).astype(float)
    edge=float((np.abs(out[:,0].astype(float)-out[:,-1]).mean()+np.abs(out[0].astype(float)-out[-1]).mean())/2)
    report={'color':{'labMeanDistance':float(np.linalg.norm(lab.mean(axis=(0,1))-np.array(analysis['meanLab'])))},'structure':{'type':kind,'periodX':px,'periodY':py,'directionDegrees':analysis['directionDegrees']},'clarity':{'nativeLaplacianVariance':analysis['clarity'],'nativeWidth':w,'nativeHeight':h,'restoration':restoration},'seams':{'applied':seamless,'edgeDifference':edge},'content':{'generative':False,'manualReviewRequired':True},'calibrated':False,'warnings':warnings}
    thumb=cv2.resize(out,(256,256),interpolation=cv2.INTER_AREA)
    return {'image':encode(out),'preview':encode(np.tile(thumb,(3,3,1))),'quality_report':report,'warnings':warnings,'chosen_algorithm':method,'sr_applied':False,'ai_inferred':False,'preparation':{'pipeline':'source-driven-v1','method':method,'analysis':analysis,'restoration':restoration,'fidelity':fidelity,'repairedPixels':repaired,'roiReselected':False,'sourceWidth':w,'sourceHeight':h,'seamless':seamless}}

