"""CPU height-field material lighting. No temporal state or stochastic frame noise."""
import cv2, numpy as np, math
import numexpr as ne
ne.set_num_threads(1)
from functools import lru_cache
cv2.setNumThreads(1)
@lru_cache(2)
def pixel_grid(h,w,scale,x0,y0):
    y,x=np.mgrid[:h,:w].astype(np.float32)
    return x/scale+x0-540,y/scale+y0-540

@lru_cache(2)
def texture(h,w,scale,x0,y0,cx=540,cy=540,zoom=1,roll=0):
    x,y=pixel_grid(h,w,scale,x0,y0)
    a=math.radians(roll);ca,sa=math.cos(a),math.sin(a)
    x,y=(x*ca+y*sa)/zoom+cx,(-x*sa+y*ca)/zoom+cy
    cloud=(np.sin(x*.026+np.sin(y*.019))*np.cos(y*.031)+np.sin(x*.008+y*.013))*.5
    # Fine, isotropic, even tool marks rather than broad diagonal foil streaks.
    hammer=(np.sin(x*1.71+np.sin(y*.91))*np.cos(y*1.43+np.sin(x*.73)))
    brush=np.sin(x*2.9)*np.sin(y*3.1)
    return x,y,cloud,hammer,brush
@lru_cache(1)
def matcap():
    y,x=np.mgrid[-1:1:complex(256),-1:1:complex(256)].astype(np.float32)
    z=np.sqrt(np.maximum(0,1-x*x-y*y));rim=np.clip(z,0,1)
    # Environment reflection: dark studio horizon flanked by warm panels and a narrow white strip.
    base=np.array([.34,.13,.025],np.float32)[None,None,:]+rim[:,:,None]*np.array([.53,.34,.11],np.float32)
    band=np.exp(-((y+.12)/.105)**2);base*=1-.86*band[:,:,None]
    panel=np.exp(-((y+.49)/.17)**2)*(.35+.65*np.exp(-((x+.27)/.6)**2))
    base+=panel[:,:,None]*np.array([.8,.69,.4],np.float32)
    sharp=np.exp(-((y+.62)/.038)**2)*np.exp(-((x+.2)/.62)**4)
    base+=sharp[:,:,None]*np.array([1.3,1.3,1.1],np.float32)
    base+=np.exp(-((y-.55)/.08)**2)[:,:,None]*np.array([.4,.23,.06],np.float32)
    return base

def _shade(p,rgb,data,offset=0):
    a=rgb.astype(np.float32)/255;d=data.astype(np.float32)/255
    h=d[:,:,0];metal=d[:,:,1];flag=d[:,:,2];s=p.format.scale
    x,y,cloud,hammer,brush=texture(*h.shape,s,p.format.rect[0],p.format.rect[1]+offset/s,*p.camera.centre,p.camera.zoom,p.camera.roll)
    rounded=cv2.GaussianBlur(h,(0,0),max(.55,1.35*s));wide=cv2.GaussianBlur(h*metal,(0,0),max(1,8*s))
    plate=(flag>.4)&(metal>.5)
    distance=cv2.distanceTransform((metal<.3).astype(np.uint8),cv2.DIST_L2,5)
    distance=cv2.GaussianBlur(distance,(0,0),max(1,4*s))
    dome=.19*(1-np.exp(-distance/max(1,20*s)))*(1-metal)
    total=rounded+wide*.18+dome+hammer*.0008*plate+cloud*.003*(1-metal)
    nx=-cv2.Sobel(total,cv2.CV_32F,1,0,ksize=3)*(2.1/max(s,.2));ny=-cv2.Sobel(total,cv2.CV_32F,0,1,ksize=3)*(2.1/max(s,.2))
    inv=ne.evaluate('1/sqrt(nx*nx+ny*ny+1)');nx*=inv;ny*=inv;nz=inv
    angle=p.light_angle if p.light_angle is not None else p.time*math.tau/9+.4
    ca,sa=math.cos(angle),math.sin(angle);u=nx*ca-ny*sa;v=nx*sa+ny*ca
    # Flat plate picks up uneven reflected light, not a uniform yellow fill.
    u=u+plate*np.float32(.12)*np.sin(x*.009+y*.003);v=v+plate*(np.float32(.25)*np.sin(y*.005+x*.002)-.32)
    gold=cv2.remap(matcap(),np.clip((u+1)*127.5,0,255).astype(np.float32),np.clip((v+1)*127.5,0,255).astype(np.float32),cv2.INTER_LINEAR)
    gold*=1+(brush*.035+cloud*.045)[:,:,None]
    groundplate=((h<.25)&plate).astype(np.float32)[:,:,None]
    # A broad reflected softbox travels over the satin field independently of the raised wire.
    axis=(x-540)*ca+(y-460)*sa
    softbox=np.exp(-((axis-240*math.sin(angle*.7))/340)**2)
    shoulder=np.exp(-((axis+470)/230)**2)
    field=np.array([.87,.565,.16],np.float32)+(hammer*.014+cloud*.014)[:,:,None]
    field=field+softbox[:,:,None]*np.array([.48,.43,.28],np.float32)-shoulder[:,:,None]*np.array([.12,.085,.025],np.float32)
    gold=gold*(1-groundplate)+groundplate*field
    if p.rays_from is not None:
        theta=np.arctan2(y-p.rays_from[1],x-p.rays_from[0])
        engraving=np.power(.5+.5*np.cos(theta*320),18)*(.025+.065*softbox)
        fan=np.power(.5+.5*np.cos(theta-angle),14)*.15
        gold+=(engraving+fan)[:,:,None]*groundplate
    contact=cv2.GaussianBlur(np.maximum(h-.25,0),(0,0),max(1,5*s))
    gold*=1-np.clip(contact*.65,0,.3)[:,:,None]*groundplate
    ao=np.clip(wide-h*.15,0,.7)
    enamel=a*(.90+cloud*.025-ao*.7)[:,:,None]
    if getattr(p,'bright_palette',False):enamel*=1.18
    # Soft directional shadow under wire and broad off-axis glass reflection.
    shift=np.float32([[1,0,3*s*ca],[0,1,3*s*sa]])
    shadow=cv2.warpAffine(wide,shift,(h.shape[1],h.shape[0]))
    enamel*=np.clip(1-shadow*.37,.6,1)[:,:,None]
    nd=np.clip(nx*(-.28*ca)+ny*(-.28*sa)+nz*.96,0,1)
    glass=np.power(nd,28)*.025
    glass+=np.exp(-((x*.42+y*.22-180-math.sin(angle)*480+nx*150+ny*90)/65)**2)*.28
    enamel+=glass[:,:,None]*np.array([.72,.85,1.0],np.float32)
    # Dome specular, compact highlight over onyx and jewels.
    spec=np.power(nd,100)*1.8*np.clip((h-.14)*5,0,1)*(1-metal)
    enamel+=spec[:,:,None]
    # Sparse subpixel glass pinholes, anchored to the stage.
    bubbles=(np.sin(x*1.17+np.sin(y*.7))>.9995)&(np.cos(y*1.31)>.997)
    enamel*=1-bubbles[:,:,None]*np.float32(.15)
    m3=metal[:,:,None]
    out=ne.evaluate('enamel*(1-m3)+gold*m3')
    if p.sheen is not None:
        band=np.exp(-((x+y*.42-p.sheen)/65)**2)*.38;out+=band[:,:,None]*(.35+nz[:,:,None]*.65)
    bright=np.maximum(out-.92,0);out+=cv2.GaussianBlur(bright,(0,0),max(1,5*s))*.32
    vign=1-.14*((np.linspace(-1,1,h.shape[1],dtype=np.float32)[None,:])**2+(np.linspace(-1,1,p.format.size[1],dtype=np.float32)[offset:offset+h.shape[0],None])**2)
    if getattr(p,'no_vignette',False):vign=np.ones_like(vign)
    v3=vign[:,:,None]
    tone=np.float32(.24)
    out=ne.evaluate('out*v3/(1+out*tone)')
    # Type faces have a dedicated even finish; the darker edge is also unlit.
    typeface=(flag>.76)&(flag<.94)&(metal<.2)
    out=np.where(typeface[:,:,None],a,out)
    out=np.clip(out*255,0,255).astype(np.uint8)
    return out

def shade(p):
    rgb,data=p.arrays()
    out=_shade(p,rgb,data)
    for px,py,r,intensity in p.stars:
        pts=np.array([(px,py-r),(px+r*.18,py-r*.18),(px+r,py),(px+r*.18,py+r*.18),(px,py+r),(px-r*.18,py+r*.18),(px-r,py),(px-r*.18,py-r*.18)],np.int32)
        x0=max(0,int(pts[:,0].min())-2);x1=min(out.shape[1],int(pts[:,0].max())+3)
        y0=max(0,int(pts[:,1].min())-2);y1=min(out.shape[0],int(pts[:,1].max())+3)
        if x1>x0 and y1>y0:
            roi=out[y0:y1,x0:x1];overlay=roi.copy()
            cv2.fillPoly(overlay,[pts-np.array([x0,y0],np.int32)],(255,250,218),cv2.LINE_AA)
            cv2.addWeighted(overlay,min(1,intensity),roi,1-min(1,intensity),0,dst=roi)
    return out
