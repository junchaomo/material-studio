"""Deterministic source-patch quilting and minimum-error overlap cuts."""
import hashlib
import cv2
import numpy as np
from .processing import decode, encode

def _square(rgba):
    h,w=rgba.shape[:2];scale=min(1.,512/max(w,h))
    valid=cv2.resize((rgba[:,:,3]>=250).astype(np.uint8),(max(1,round(w*scale)),max(1,round(h*scale))),interpolation=cv2.INTER_NEAREST)
    margin=max(2,round(min(valid.shape)*.06));valid[:margin]=0;valid[-margin:]=0;valid[:,:margin]=0;valid[:,-margin:]=0
    valid=cv2.erode(valid,np.ones((3,3),np.uint8))
    rows,cols=valid.shape;previous=np.zeros(cols+1,np.int32);best=(0,0,0)
    for y in range(rows):
        current=np.zeros(cols+1,np.int32)
        for x in range(cols):
            if valid[y,x]:
                current[x+1]=1+min(previous[x],previous[x+1],current[x])
                if current[x+1]>best[0]:best=(int(current[x+1]),x,y)
        previous=current
    side,x,y=best
    if side<24:raise ValueError('Mask too small or empty')
    left=int(np.ceil((x-side+1)/scale));top=int(np.ceil((y-side+1)/scale));native_side=int(np.floor(side/scale))-1
    crop=rgba[top:top+native_side,left:left+native_side]
    if not crop.size or np.any(crop[:,:,3]<250):raise ValueError('Mask too small or empty')
    return crop[:,:,:3],{'left':left,'top':top,'width':native_side,'height':native_side}

def _clean_brick_sample(sample, crop, rgba=None):
    """Search the entire valid rectified sample, preserving native pixels.

    Relative pale-residue detection includes small samples. Never treats dark
    mortar as residue and never fills a crop with pixels outside the mask.
    """
    if rgba is None:
        rgba=np.dstack([sample,np.full(sample.shape[:2],255,np.uint8)])
        origin=(crop['left'],crop['top'])
    else: origin=(0,0)
    rgb=rgba[:,:,:3].astype(np.float32);valid=rgba[:,:,3]>=250
    if valid.sum()<576:return sample,crop,{'applied':False}
    warmth=rgb[:,:,0]-rgb[:,:,2];light=rgb.mean(axis=2)
    warm=float(np.median(warmth[valid]));mid=float(np.median(light[valid]))
    if warm<25:return sample,crop,{'applied':False}
    pale=(warmth<warm*.7)&(light>mid+10)&valid
    # Count residues without opening: a small source can have one-pixel lettering.
    safety=cv2.erode(valid.astype(np.uint8),np.ones((3,3),np.uint8),borderType=cv2.BORDER_CONSTANT,borderValue=0)
    h,w=valid.shape
    bad=cv2.integral((1-safety).astype(np.uint8));stain=cv2.integral(pale.astype(np.uint8))
    def area(table,x,y,n):return float(table[y+n,x+n]-table[y,x+n]-table[y+n,x]+table[y,x])
    base=crop['width'];best=None
    for n in sorted(set(max(24,int(base*f)) for f in (1.,.85,.7)),reverse=True):
        if n>min(h,w):continue
        for y in np.unique(np.linspace(0,h-n,min(41,h-n+1)).astype(int)):
            for x in np.unique(np.linspace(0,w-n,min(41,w-n+1)).astype(int)):
                if area(bad,x,y,n)>0:continue
                residue=area(stain,x,y,n)/(n*n)
                score=residue+.005*(1-(n/base)**2)
                if best is None or score<best[0]:best=(score,int(x),int(y),n,residue)
    if best is None:return sample,crop,{'applied':False}
    _,x,y,n,residue=best
    sx=crop['left']-origin[0];sy=crop['top']-origin[1]
    before=area(stain,sx,sy,base)/(base*base)
    if before<.001 or residue>before*.5:return sample,crop,{'applied':False,'residueFractionBefore':before,'residueFractionAfter':before}
    return rgba[y:y+n,x:x+n,:3].copy(),{'left':x+origin[0],'top':y+origin[1],'width':n,'height':n},{'applied':True,'method':'full-valid-clean-brick-patch-v2','residueFractionBefore':before,'residueFractionAfter':residue}


def _cut(error):
    h,w=error.shape;cost=error.copy();parent=np.zeros((h,w),np.int32)
    for y in range(1,h):
        for x in range(w):
            start=max(0,x-1);offset=int(np.argmin(cost[y-1,start:min(w,x+2)]));parent[y,x]=start+offset;cost[y,x]+=cost[y-1,start+offset]
    seam=np.zeros(h,np.int32);seam[-1]=int(np.argmin(cost[-1]))
    for y in range(h-1,0,-1):seam[y-1]=parent[y,seam[y]]
    return seam

def _directionality(sample):
    # Suppress fine grain before measuring global orientation. Periodic stripes
    # and aligned grain must not be shuffled like isotropic noise.
    size=min(512,sample.shape[0])
    analysis=cv2.resize(sample,(size,size),interpolation=cv2.INTER_AREA)
    gray=cv2.cvtColor(analysis,cv2.COLOR_RGB2GRAY).astype(np.float32)/255
    gray=cv2.GaussianBlur(gray,(0,0),2)
    gx=cv2.Sobel(gray,-1,1,0);gy=cv2.Sobel(gray,-1,0,1)
    a=float(np.mean(gx*gx));b=float(np.mean(gy*gy));cross=float(np.mean(gx*gy))
    return float(np.sqrt((a-b)**2+4*cross*cross)/(a+b+1e-9)) if a+b>1e-5 else 0.

def synthesize(data):
    rgba=decode(data['image'],'RGBA');sample,crop=_square(rgba);side=512
    cleaning={'applied':False}
    if data.get('category')=='砖材':sample,crop,cleaning=_clean_brick_sample(sample,crop,rgba)
    source=sample.copy()
    # Only stationary, non-directional surfaces use patch quilting. Structured
    # materials retain one continuous sample so brick courses/grain cannot drift.
    directionality=_directionality(sample)
    quilt=directionality<.55 and data.get('kind')=='重复纹理' and data.get('category') not in ('砖材','木材','金属','玻璃')
    repair=np.zeros((side,side),np.uint8)
    if quilt:
        if max(source.shape[:2])>512:source=cv2.resize(source,(512,512),interpolation=cv2.INTER_AREA)
        patch=min(128,max(16,source.shape[0]//2));overlap=max(8,patch//5);step=patch-overlap
        canvas=np.zeros((side,side,3),np.uint8);seed=int.from_bytes(hashlib.sha256(str(data.get('seed','0')).encode()).digest()[:4],'little');rng=np.random.default_rng(seed)
        for y in range(0,side,step):
            for x in range(0,side,step):
                ph,pw=min(patch,side-y),min(patch,side-x);ox,oy=min(overlap,pw),min(overlap,ph);best=None;score=float('inf')
                for _ in range(24):
                    sy=int(rng.integers(0,source.shape[0]-ph+1));sx=int(rng.integers(0,source.shape[1]-pw+1));candidate=source[sy:sy+ph,sx:sx+pw];error=0.
                    if x:error+=np.mean((canvas[y:y+ph,x:x+ox].astype(float)-candidate[:,:ox])**2)
                    if y:error+=np.mean((canvas[y:y+oy,x:x+pw].astype(float)-candidate[:oy])**2)
                    if error<score:score=error;best=candidate.copy()
                old=canvas[y:y+ph,x:x+pw];keep=np.zeros((ph,pw),bool)
                if x:
                    seam=_cut(np.mean((old[:,:ox].astype(float)-best[:,:ox])**2,axis=2))
                    for row,c in enumerate(seam):keep[row,:c]=True;repair[y+row,x+max(0,c-2):x+min(pw,c+3)]=255
                if y:
                    seam=_cut(np.mean((old[:oy].astype(float)-best[:oy])**2,axis=2).T)
                    for col,r in enumerate(seam):keep[:r,col]=True;repair[y+max(0,r-2):y+min(ph,r+3),x+col]=255
                old[:]=np.where(keep[:,:,None],old,best)
        method='minimum-error-quilting-v1'
    else:
        canvas=cv2.resize(source,(side,side),interpolation=cv2.INTER_CUBIC);method='continuous-directional-sample-v1' if directionality>=.55 else 'continuous-structured-sample-v1'
    # Edges are the only additional repair region; the interior is protected.
    band=8;repair[:band]=255;repair[-band:]=255;repair[:,:band]=255;repair[:,-band:]=255
    repair=cv2.GaussianBlur(repair,(5,5),0)
    return {'image':encode(canvas),'repairMask':encode(repair),'referenceImage':encode(sample),'preparation':{'method':method,'cleanSampleSelection':cleaning,'directionality':directionality,'crop':crop,'sourceWidth':rgba.shape[1],'sourceHeight':rgba.shape[0],'seed':str(data.get('seed','0')),'repairFraction':float(np.count_nonzero(repair)/repair.size),'warning':'连续样本或图块合成作为参考；AI清理附着物并优化整张纹理，原图缺失的真实细节无法精确恢复。'}}
