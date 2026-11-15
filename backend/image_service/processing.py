"""CPU-only geometry. A rough selection is never treated as a plane's four corners."""
import base64
import io
import os
import cv2
import numpy as np
from PIL import Image, ImageFilter

# Local originals are user-selected files; preserve their native resolution.
if os.environ.get("LOCAL_STORAGE_MODE") == "true":
    Image.MAX_IMAGE_PIXELS = None

def decode(value, mode):
    raw = base64.b64decode(value.split(',', 1)[-1], validate=True)
    im = Image.open(io.BytesIO(raw))
    if os.environ.get("LOCAL_STORAGE_MODE") != "true" and im.width * im.height > 20000000:
        raise ValueError('Processing image too large')
    return np.asarray(im.convert(mode))

def encode(array):
    out = io.BytesIO()
    Image.fromarray(array).save(out, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(out.getvalue()).decode()

def ordered(points):
    points = np.asarray(points, np.float32)
    center = points.mean(axis=0)
    points = points[np.argsort(np.arctan2(points[:, 1]-center[1], points[:, 0]-center[0]))]
    points = np.roll(points, -np.argmin(points.sum(axis=1)), axis=0)
    return points

def estimate_plane(image, contour):
    """Mask locates a plane; source image edges refine its four boundary lines.
    Always returns a hypothesis for user review, never authorizes a homography.
    """
    h,w=image.shape[:2]
    hull=cv2.convexHull(contour)
    corners=None
    for fraction in (.015,.025,.035,.045,.06):
        candidate=cv2.approxPolyDP(hull,fraction*cv2.arcLength(hull,True),True)
        if len(candidate)==4 and cv2.isContourConvex(candidate):
            corners=ordered(candidate.reshape(-1,2));break
    fallback=corners is None
    if fallback: corners=ordered(cv2.boxPoints(cv2.minAreaRect(contour)))
    x,y,cw,ch=cv2.boundingRect(contour)
    edges=cv2.Canny(cv2.cvtColor(image,cv2.COLOR_RGB2GRAY),40,120)
    roi=np.zeros((h,w),np.uint8)
    cv2.drawContours(roi,[hull],-1,255,max(5,round(min(cw,ch)*.12)))
    lines=cv2.HoughLinesP(cv2.bitwise_and(edges,roi),1,np.pi/180,threshold=12,minLineLength=max(8,min(cw,ch)//5),maxLineGap=12)
    fitted=[];support=0
    for i in range(4):
        a,b=corners[i],corners[(i+1)%4];v=b-a;length=np.linalg.norm(v);axis=v/max(length,1)
        hits=[]
        for line in ([] if lines is None else lines[:,0]):
            c,d=line[:2].astype(float),line[2:].astype(float);direction=d-c;n=np.linalg.norm(direction)
            if n<1:continue
            mid=(c+d)/2;offset=mid-a;distance=abs(float(axis[0]*offset[1]-axis[1]*offset[0]));projection=np.dot(mid-a,axis)
            if abs(np.dot(axis,direction/n))>.98 and distance<max(4,min(cw,ch)*.06) and -5<projection<length+5:hits.extend([c,d])
        if hits:
            vx,vy,px,py=cv2.fitLine(np.asarray(hits,np.float32),cv2.DIST_L2,0,.01,.01).flatten();fitted.append((np.array([px,py]),np.array([vx,vy])));support+=1
        else:fitted.append((a,axis))
    refined=[]
    for i in range(4):
        a,u=fitted[(i-1)%4];b,v=fitted[i];matrix=np.column_stack((u,-v))
        if abs(np.linalg.det(matrix))<.02:refined=[];break
        q=a+np.linalg.solve(matrix,b-a)[0]*u
        if np.linalg.norm(q-corners[i])>max(cw,ch)*.15:refined=[];break
        refined.append(q)
    if len(refined)==4 and cv2.isContourConvex(np.asarray(refined,np.float32)):corners=ordered(refined)
    corners[:,0]=np.clip(corners[:,0],0,w-1);corners[:,1]=np.clip(corners[:,1],0,h-1)
    return corners,support,fallback

def select_texture_roi(image, mask, plane):
    """Rank interior patches in a provisional plane; never certify planarity.
    Analysis is reduced, but returned corners and final sampling use original pixels.
    """
    h,w=mask.shape
    lengths=np.linalg.norm(np.roll(plane,-1,axis=0)-plane,axis=1)
    aw=max(16,round(max(lengths[0],lengths[2])))
    ah=max(16,round(max(lengths[1],lengths[3])))
    scale=min(1.,512/max(aw,ah));aw=max(16,round(aw*scale));ah=max(16,round(ah*scale))
    target=np.float32([[0,0],[aw-1,0],[aw-1,ah-1],[0,ah-1]])
    transform=cv2.getPerspectiveTransform(plane.astype(np.float32),target)
    pixels=cv2.warpPerspective(image,transform,(aw,ah))
    valid=cv2.warpPerspective(mask,transform,(aw,ah),flags=cv2.INTER_NEAREST)
    margin=max(2,round(min(aw,ah)*.025))
    safe=cv2.erode(valid,np.ones((2*margin+1,2*margin+1),np.uint8),borderType=cv2.BORDER_CONSTANT,borderValue=0)>0
    if np.count_nonzero(safe)<64:return None,{'status':'unavailable','reason':'选区内部缺少足够的安全取样面积，请调整选区或手动四角。'}
    lab=cv2.cvtColor(pixels,cv2.COLOR_RGB2LAB).astype(np.float32)
    gray=cv2.cvtColor(pixels,cv2.COLOR_RGB2GRAY).astype(np.float32)
    smooth=cv2.GaussianBlur(lab,(0,0),max(1,min(aw,ah)/90))
    center=np.median(smooth[safe],axis=0)
    spread=np.maximum(np.median(np.abs(smooth[safe]-center),axis=0)*1.4826,[12,5,5])
    anomaly=np.sqrt(np.mean(((smooth-center)/spread)**2,axis=2))
    # Broad illumination/color discontinuities, not individual brick joints/grains.
    gx=cv2.Sobel(gray,cv2.CV_32F,1,0);gy=cv2.Sobel(gray,cv2.CV_32F,0,1)
    energy=cv2.GaussianBlur(gx*gx+gy*gy,(0,0),3)
    reference=max(1,float(np.median(energy[safe])))
    disturbance=(anomaly>3.5)|((gray<12)|(gray>247))
    bad=cv2.integral((~safe|disturbance).astype(np.float32))
    cost=cv2.integral((np.minimum(anomaly,5)+.15*np.abs(np.log((energy+1)/(reference+1)))).astype(np.float32))
    def total(ii,x,y,rw,rh):return float(ii[y+rh,x+rw]-ii[y,x+rw]-ii[y+rh,x]+ii[y,x])
    candidates=[]
    # Multi-scale patches prefer usable area, while penalizing inconsistent appearance.
    for fraction in (.9,.75,.6,.45,.3,.2):
        for aspect in (.7,1.,1.4):
            rw=max(8,min(aw-1,round(aw*fraction*aspect**.5)))
            rh=max(8,min(ah-1,round(ah*fraction/aspect**.5)))
            if rw>=aw or rh>=ah:continue
            xs=sorted(set(list(range(0,aw-rw,max(2,rw//7)))+[aw-rw-1]))
            ys=sorted(set(list(range(0,ah-rh,max(2,rh//7)))+[ah-rh-1]))
            for y in ys:
                for x in xs:
                    area=rw*rh
                    if total(bad,x,y,rw,rh)>0:continue
                    quality=total(cost,x,y,rw,rh)/area
                    score=(area/(aw*ah))**.55/(1+quality)
                    candidates.append((score,x,y,rw,rh,quality))
    for _,x,y,rw,rh,quality in sorted(candidates,reverse=True):
        corners=np.float32([[[x,y],[x+rw-1,y],[x+rw-1,y+rh-1],[x,y+rh-1]]])
        points=ordered(cv2.perspectiveTransform(corners,np.linalg.inv(transform))[0])
        # Exact native-resolution containment check prevents missed small holes after reduction.
        bx,by,bw,bh=cv2.boundingRect(points)
        if bx<0 or by<0 or bx+bw>w or by+bh>h:continue
        polygon=np.zeros((bh,bw),np.uint8)
        cv2.fillConvexPoly(polygon,np.rint(points-[bx,by]).astype(np.int32),255)
        if np.any((polygon>0)&(mask[by:by+bh,bx:bx+bw]<128)):
            continue
        return points,{'status':'proposed','method':'mask-interior-quality-search','analysisSize':[aw,ah],
            'areaFraction':float(cv2.contourArea(points)/max(1,np.count_nonzero(mask))),
            'appearanceCost':float(quality),'safetyMarginAnalysisPixels':margin,
            'planarity':'requires-review','reason':'已优先选择选区内部颜色和纹理连续、远离边界的局部区域。请核对是否属于同一平面。'}
    return None,{'status':'unavailable','reason':'未找到边界完整且干扰较少的局部区域，请手动调整取样四角。'}



def rectify(data):
    image = decode(data['image'], 'RGB')
    h, w = image.shape[:2]
    mask = decode(data['mask'], 'L')
    mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)
    mask = np.where(mask >= 128, 255, 0).astype(np.uint8)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours or np.count_nonzero(mask) < 64:
        raise ValueError('Mask too small or empty')
    contour = max(contours, key=cv2.contourArea)
    x, y, cw, ch = cv2.boundingRect(contour)
    if data.get('estimateOnly'):
        points,support,fallback=estimate_plane(image,contour)
        roi_points,roi_info=select_texture_roi(image,mask,points)
        if roi_points is not None:points=roi_points
        return {'image':encode(np.dstack([image,mask])[y:y+ch,x:x+cw]),'geometry':{'status':'needs-review','phase':'corners-review','method':'interior-texture-roi-estimate','roi':roi_info,'reason':roi_info['reason']+(' 边缘线索可供参考。' if support>=2 and not fallback else ' 几何线索不足，请重点检查平面方向与四角。'),'confidence':'supported' if support>=2 and not fallback else 'low','edgeSupport':support,'sourceSize':[w,h],'quad':[{'x':float(p[0]/(w-1)),'y':float(p[1]/(h-1))} for p in points]}}
    quad = data.get('quad')
    manual = quad is not None
    if manual:
        points = np.array([[p['x']*(w-1), p['y']*(h-1)] for p in quad], np.float32)
    else:
        approx = cv2.approxPolyDP(contour, .025*cv2.arcLength(contour, True), True)
        points = approx.reshape(-1, 2).astype(np.float32)
        # Ragged mask boundaries and small islands are not plane corners. Fit a
        # dominant convex boundary, then still require independent image edges.
        if len(points) != 4:
            hull = cv2.convexHull(contour)
            for fraction in (.015, .025, .035, .045):
                candidate = cv2.approxPolyDP(hull, fraction*cv2.arcLength(hull, True), True)
                area = cv2.contourArea(candidate)
                if len(candidate) == 4 and area > 64 and cv2.contourArea(contour)/area >= .85:
                    points = candidate.reshape(-1, 2).astype(np.float32)
                    break
    reliable = len(points) == 4 and cv2.isContourConvex(points.astype(np.int32)) and cv2.contourArea(points) > 64
    if reliable:
        points = ordered(points)
        edges = np.roll(points, -1, axis=0)-points
        lengths = np.linalg.norm(edges, axis=1)
        reliable = lengths.min() > 4 and lengths.max()/lengths.min() < 20
    support = 0
    if reliable and not manual:
        # Mask corners are hypotheses; require matching image-edge evidence in both axes.
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        lines = cv2.HoughLinesP(cv2.Canny(gray,40,120),1,np.pi/180,threshold=15,minLineLength=max(8,min(cw,ch)//4),maxLineGap=8)
        axes = set()
        for i in range(4):
            edge = edges[i]/lengths[i]
            for line in ([] if lines is None else lines[:,0]):
                a,b = line[:2].astype(float),line[2:].astype(float)
                v=b-a; norm=np.linalg.norm(v)
                if norm < 1: continue
                offset=(a+b)/2-points[i]
                distance=abs(float(edge[0]*offset[1]-edge[1]*offset[0]))
                projection=float(np.dot((a+b)/2-points[i],edge))
                if abs(float(np.dot(edge,v/norm)))>.985 and distance<max(3,min(cw,ch)*.025) and -5<projection<lengths[i]+5:
                    axes.add(i%2);support+=1;break
        reliable = len(axes)==2
    rgba = np.dstack([image, mask])
    if not reliable:
        if manual:
            raise ValueError('Invalid planar corners')
        crop = rgba[y:y+ch, x:x+cw]
        return {'image': encode(crop), 'geometry': {'status':'kept-original' if data.get('keepOriginal') else 'needs-review', 'reason':'Mask 与原图边缘线不足以可靠确认单个平面四角。请辅助调整或明确保留原图。', 'quad':None, 'method':'masked-crop', 'sourceSize':[w,h], 'edgeSupport':support}}
    adjacent = [abs(float(np.dot(edges[i], edges[(i+1)%4])/(lengths[i]*lengths[(i+1)%4]))) for i in range(4)]
    frontal = max(adjacent) < .06 and abs(lengths[0]-lengths[2])/max(lengths[0],lengths[2]) < .06 and abs(lengths[1]-lengths[3])/max(lengths[1],lengths[3]) < .06
    ow = max(8, round(max(lengths[0], lengths[2])))
    if os.environ.get("LOCAL_STORAGE_MODE") != "true": ow = min(1800, ow)
    oh = max(8, round(max(lengths[1], lengths[3])))
    if os.environ.get("LOCAL_STORAGE_MODE") != "true": oh = min(1800, oh)
    matrix = cv2.getPerspectiveTransform(points, np.float32([[0,0],[ow-1,0],[ow-1,oh-1],[0,oh-1]]))
    output = cv2.warpPerspective(rgba, matrix, (ow, oh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    coverage = float(np.count_nonzero(output[:,:,3] >= 128)/(ow*oh))
    if coverage < .2:
        raise ValueError('Corners do not overlap selected material')
    return {'image':encode(output),'geometry':{'status':'frontal' if frontal else 'rectified','method':'opencv-homography','manual':manual,'coverage':coverage,'edgeSupport':support,'sourceSize':[w,h],'quad':[{'x':float(p[0]/(w-1)),'y':float(p[1]/(h-1))} for p in points]}}

def postprocess(data):
    image = Image.fromarray(decode(data['image'], 'RGB'))
    size = int(data['resolution'])
    if size < 1 or (os.environ.get("LOCAL_STORAGE_MODE") != "true" and size not in (1024, 2048, 4096)):
        raise ValueError('Invalid resolution')
    image = image.resize((size,size), Image.Resampling.LANCZOS)
    pixels = np.asarray(image).copy()
    # Blend opposite edges symmetrically, never claim this guarantees visual seamlessness.
    if data.get('seamless'):
        band = max(4,size//64)
        for k in range(band):
            a = .5*(1-k/band)
            left, right = pixels[:,k].astype(float), pixels[:,-1-k].astype(float)
            pixels[:,k],pixels[:,-1-k] = (left*(1-a)+right*a).astype('uint8'),(right*(1-a)+left*a).astype('uint8')
            top,bottom = pixels[k].astype(float),pixels[-1-k].astype(float)
            pixels[k],pixels[-1-k] = (top*(1-a)+bottom*a).astype('uint8'),(bottom*(1-a)+top*a).astype('uint8')
    edge_difference=float((np.abs(pixels[:,0].astype(float)-pixels[:,-1]).mean()+np.abs(pixels[0].astype(float)-pixels[-1]).mean())/2)
    detail=float(cv2.Laplacian(cv2.cvtColor(pixels,cv2.COLOR_RGB2GRAY),cv2.CV_64F).var())
    return {'image':encode(pixels),'postprocess':{'rgb':True,'resolution':size,'edgeBlend':bool(data.get('seamless')),'edgeDifference':edge_difference,'detailVariance':detail,'reviewRequired':True,'warnings':['纹理细节较少，请核对材质是否本为纯色'] if detail<4 else []}}

def enhance(data):
    """Deterministic source-preserving enhancement, without generative inference."""
    rgba=decode(data['image'],'RGBA')
    valid=np.where(rgba[:,:,3]>=250,255,0).astype(np.uint8)
    # Largest fully valid axis-aligned square excludes transparent Mask borders.
    padded=cv2.copyMakeBorder(valid,1,1,1,1,cv2.BORDER_CONSTANT,value=0)
    distance=cv2.distanceTransform(padded,cv2.DIST_C,3)[1:-1,1:-1]
    _,radius,_,center=cv2.minMaxLoc(distance)
    half=int(radius)-1
    if half<4: raise ValueError('Mask too small or empty')
    x,y=center;left,top=x-half,y-half;side=2*half+1
    crop=rgba[top:top+side,left:left+side,:3]
    size=int(data['resolution'])
    if size < 1 or (os.environ.get("LOCAL_STORAGE_MODE") != "true" and size not in (1024,2048,4096)):raise ValueError('Invalid resolution')
    image=Image.fromarray(crop).resize((size,size),Image.Resampling.LANCZOS)
    image=image.filter(ImageFilter.UnsharpMask(radius=1,percent=65,threshold=3))
    result=postprocess({'image':encode(np.asarray(image)),'resolution':size,'seamless':bool(data.get('seamless'))})
    result['postprocess'].update({'mode':'faithful','generative':False,'sourceCrop':{'x':left,'y':top,'width':side,'height':side},'sourceSize':[rgba.shape[1],rgba.shape[0]],'warnings':['仅使用正视样本内的有效正方形区域；放大及轻度锐化不能恢复原图缺失的细节。']})
    return result
