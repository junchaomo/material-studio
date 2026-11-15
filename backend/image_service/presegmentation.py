"""CPU SLIC proposals. Appearance similarity is evidence, never material identity."""
import hashlib
from collections import OrderedDict
import cv2
import numpy as np
from .processing import decode, encode
_CACHE=OrderedDict()

def slic_features(image):
    h,w=image.shape[:2]
    lab=cv2.cvtColor(image,cv2.COLOR_RGB2LAB).astype(np.float32)
    target=min(3000,max(16,h*w//32));step=max(4,int(round(np.sqrt(h*w/target))))
    centers=np.array([[*lab[y,x],x,y] for y in range(step//2,h,step) for x in range(step//2,w,step)],np.float32)
    yy,xx=np.mgrid[:h,:w];labels=np.zeros((h,w),np.int32)
    # SLIC's local Lab + spatial k-means avoids allocating K full-image distances.
    for _ in range(7):
        distances=np.full((h,w),np.inf,np.float32)
        for k,c in enumerate(centers):
            x,y=int(c[3]),int(c[4]);l,r=max(0,x-step),min(w,x+step+1);t,b=max(0,y-step),min(h,y+step+1)
            d=((lab[t:b,l:r]-c[:3])**2).sum(axis=2)+(12/step)**2*((xx[t:b,l:r]-c[3])**2+(yy[t:b,l:r]-c[4])**2)
            take=d<distances[t:b,l:r];distances[t:b,l:r][take]=d[take];labels[t:b,l:r][take]=k
        flat=labels.ravel();counts=np.maximum(1,np.bincount(flat,minlength=len(centers)))
        for j,values in enumerate([lab[:,:,0],lab[:,:,1],lab[:,:,2],xx,yy]):centers[:,j]=np.bincount(flat,weights=values.ravel(),minlength=len(centers))/counts
    ids,flat=np.unique(labels.ravel(),return_inverse=True);labels=flat.reshape(h,w).astype(np.int32);n=len(ids);counts=np.bincount(flat,minlength=n)
    def means(values):return np.bincount(flat,weights=values.ravel(),minlength=n)/counts
    color=np.stack([means(lab[:,:,i]) for i in range(3)],axis=1)
    spread=np.stack([np.sqrt(np.maximum(0,means(lab[:,:,i]**2)-color[:,i]**2)) for i in range(3)],axis=1)
    gray=cv2.cvtColor(image,cv2.COLOR_RGB2GRAY).astype(np.float32)/255
    lbp=np.zeros((h,w),np.uint8)
    padded=np.pad(gray,1,mode='edge')
    for bit,(dy,dx) in enumerate([(-1,-1),(-1,0),(-1,1),(0,1),(1,1),(1,0),(1,-1),(0,-1)]):lbp|=((padded[1+dy:1+dy+h,1+dx:1+dx+w]>=gray).astype(np.uint8)<<bit)
    hist=np.stack([means((lbp//16==i).astype(float)) for i in range(16)],axis=1)
    gabor=[]
    for wavelength in (4,8):
        for angle in (0,np.pi/4,np.pi/2,3*np.pi/4):
            kernel=cv2.getGaborKernel((13,13),2.5,angle,wavelength,.6,0,ktype=cv2.CV_32F);kernel-=kernel.mean();kernel/=max(np.abs(kernel).sum(),1e-6)
            gabor.append(means(np.abs(cv2.filter2D(gray,cv2.CV_32F,kernel))))
    texture=np.stack(gabor,axis=1)
    return labels,color,spread,hist,texture

def directional_support(image, sx, sy, sensitivity):
    """Constrain strongly directional surfaces using neighborhood texture evidence.

    Only activates when the click neighborhood has a clear direction. This
    separates a striped surface from touching grass of the same color without
    imposing a rectangular shape or a sports-field-specific rule.
    """
    gray=cv2.cvtColor(image,cv2.COLOR_RGB2GRAY).astype(np.float32)/255
    responses=[]
    for angle in np.arange(8)*np.pi/8:
        scales=[]
        for wavelength in (3,4,6,8,12):
            kernel=cv2.getGaborKernel((21,21),max(2,wavelength*.5),angle,wavelength,.5,0,ktype=cv2.CV_32F)
            kernel-=kernel.mean();kernel/=max(np.abs(kernel).sum(),1e-6)
            scales.append(cv2.boxFilter(np.abs(cv2.filter2D(gray,-1,kernel)),-1,(15,15)))
        responses.append(np.max(scales,axis=0))
    energy=np.stack(responses,axis=-1)
    local=energy[max(0,sy-5):sy+6,max(0,sx-5):sx+6]
    reference=np.median(local,axis=(0,1));direction=int(reference.argmax())
    concentration=float(reference[direction]/max(reference.sum(),1e-6))
    contrast=float(reference[direction]/max(np.median(reference),1e-6))
    if concentration<.30 or contrast<2.5:
        return np.ones(gray.shape,bool),False
    fraction=energy[:,:,direction]/np.maximum(energy.sum(axis=2),1e-6)
    # Tolerance affects texture boundaries too, rather than just broad Lab gates.
    minimum=concentration*(.82-.45*sensitivity)
    support=(fraction>minimum)&(energy[:,:,direction]>reference[direction]*(.12-.06*sensitivity))
    support=cv2.morphologyEx(support.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((21,21),np.uint8)).astype(bool)
    return support,True

def presegment(data):
    source=decode(data['image'],'RGB');oh,ow=source.shape[:2]
    point=data['point'];px,py=float(point['x']),float(point['y'])
    if not (0<=px<=1 and 0<=py<=1):raise ValueError('Invalid selection')
    scale=min(1,960/max(ow,oh));image=cv2.resize(source,(max(8,round(ow*scale)),max(8,round(oh*scale))),interpolation=cv2.INTER_AREA)
    h,w=image.shape[:2];key=hashlib.sha256(image.tobytes()).hexdigest()
    if key not in _CACHE:
        _CACHE[key]=slic_features(image)
        while len(_CACHE)>2:_CACHE.popitem(last=False)
    labels,color,spread,hist,texture=_CACHE[key];seed=int(labels[min(h-1,int(py*h)),min(w-1,int(px*w))])
    sensitivity=float(np.clip(data.get('sensitivity',.5),.1,.9));radius=float(np.clip(data.get('radius',.35),.05,1))
    # A single tiny superpixel can land on one mowing stripe or an edge.
    # Build a bounded local appearance reference, anchored to seed chroma;
    # never update the reference while growing (prevents color drift).
    sy,sx=min(h-1,int(py*h)),min(w-1,int(px*w))
    patch_radius=max(5,round(max(w,h)*.018))
    local_ids=np.unique(labels[max(0,sy-patch_radius):min(h,sy+patch_radius+1),max(0,sx-patch_radius):min(w,sx+patch_radius+1)])
    local_ids=local_ids[np.linalg.norm(color[local_ids,1:]-color[seed,1:],axis=1)<10+12*sensitivity]
    if not len(local_ids):local_ids=np.array([seed])
    reference_color=np.median(color[local_ids],axis=0)
    reference_hist=hist[local_ids].mean(axis=0);reference_hist/=max(reference_hist.sum(),1e-6)
    reference_texture=np.median(texture[local_ids],axis=0)
    color_distance=np.linalg.norm((color-reference_color)/np.array([3.,1,1]),axis=1)
    distribution=np.linalg.norm(spread-np.median(spread[local_ids],axis=0),axis=1)
    lbp_distance=np.sqrt(np.maximum(0,1-np.sqrt(hist*reference_hist).sum(axis=1)))
    gabor_distance=np.linalg.norm(texture-reference_texture,axis=1)/(np.linalg.norm(reference_texture)+.03)
    allowed=(color_distance<12+24*sensitivity)&(distribution<20+24*sensitivity)&(lbp_distance<.45+.35*sensitivity)&(gabor_distance<1.+2*sensitivity)
    allowed[seed]=True
    yy,xx=np.mgrid[:h,:w];near=((xx-px*w)**2+(yy-py*h)**2)<(radius*max(w,h))**2
    pixel_lab=cv2.cvtColor(image,cv2.COLOR_RGB2LAB).astype(float)
    chroma=np.linalg.norm(pixel_lab[:,:,1:]-reference_color[1:],axis=2)
    compatible=chroma<12+16*sensitivity
    hsv=cv2.cvtColor(image,cv2.COLOR_RGB2HSV);seed_hue=float(hsv[sy,sx,0]);seed_sat=float(hsv[sy,sx,1])
    barrier=np.zeros((h,w),bool)
    if seed_sat>40:
        hue_diff=np.abs(hsv[:,:,0].astype(float)-seed_hue);hue_diff=np.minimum(hue_diff,180-hue_diff)
        barrier=(hsv[:,:,1]>40)&(hue_diff>10+12*sensitivity)
        compatible &= (hue_diff<10+12*sensitivity)&(hsv[:,:,1]>max(20,seed_sat*.3))
    texture_support,directional_constraint=directional_support(image,sx,sy,sensitivity)
    candidate=(allowed[labels]&compatible&near&texture_support).astype(np.uint8)
    # Bridge only very thin line/stripe interruptions, not arbitrary gaps.
    candidate=cv2.morphologyEx(candidate,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
    candidate[~near|barrier|~texture_support]=0
    candidate[sy,sx]=1
    _,connected=cv2.connectedComponents(candidate,8);selected=connected[min(h-1,int(py*h)),min(w-1,int(px*w))]
    mask=np.where(connected==selected,255,0).astype(np.uint8)
    count=int(np.count_nonzero(mask))
    if count<16 or count>=w*h*.95:raise ValueError('Candidate region ambiguous')
    mask=cv2.resize(mask,(ow,oh),interpolation=cv2.INTER_NEAREST)
    ys,xs=np.where(mask>0);left,top,right,bottom=int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())
    pad=max(2,round(max(right-left,bottom-top)*.03));x0,y0=max(0,left-pad),max(0,top-pad);x1,y1=min(ow,right+pad+1),min(oh,bottom+pad+1)
    # Keep the seed and search box as region hints. The box may expand.
    hints={'points':[{'x':px,'y':py,'label':1}],'box':{'x':x0/ow,'y':y0/oh,'width':(x1-x0)/ow,'height':(y1-y0)/oh}}
    return {'image':encode(mask),'presegmentation':{'method':'SLIC-Lab-LBP-Gabor','algorithmVersion':'local-appearance-v3','directionalConstraint':directional_constraint,'localReferenceCount':int(len(local_ids)),'superpixels':int(labels.max()+1),'features':['Lab mean','Lab spread','LBP histogram','Gabor 4 directions / 2 frequencies'],'workingSize':[w,h],'sourceSize':[ow,oh],'sensitivity':sensitivity,'radius':radius,'hints':hints,'reviewRequired':True,'warning':'候选仅按外观相似度和连通范围生成，可能包含门窗或遗漏遮挡区域；请检查后确认，或手动精修选区。'},'boundary':{'x':left/ow,'y':top/oh,'width':(right-left+1)/ow,'height':(bottom-top+1)/oh}}

