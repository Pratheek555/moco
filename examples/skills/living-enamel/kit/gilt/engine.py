"""Stage geometry and paired albedo/material painter. All public coordinates are stage units."""
from dataclasses import dataclass, field
from contextlib import contextmanager
import math, json
from functools import lru_cache
from collections import OrderedDict
import numpy as np
import skia
from . import ROOT
PALETTE = dict(lapis='#1b3a9c',midnight='#0d1433',turquoise='#1aa6a6',jade='#1f8a4c',oxblood='#8e1b22',coral='#e4572e',saffron='#f2b632',ivory='#f3ead2',sand='#d9b382',amethyst='#6b3fa0',onyx='#15121a',pearl='#f7f3ee',gold='#ba7828')
PALETTE.update(umber='#4a2c1a',bronze='#b9824f',crimson='#b3202a',sky='#6fb7e0',moss='#5d7f3a',stone='#b8b2a4')

def colour(c):
    h=PALETTE.get(c,c).lstrip('#'); return skia.Color(int(h[:2],16),int(h[2:4],16),int(h[4:6],16))
def path(points, close=True):
    p=skia.Path(); p.moveTo(*points[0])
    for v in points[1:]:
        if len(v)==2:p.lineTo(*v)
        elif len(v)==4:p.quadTo(*v)
        elif len(v)==6:p.cubicTo(*v)
    if close:p.close()
    return p
def ellipse(x,y,rx,ry=None):return skia.Path.Oval(skia.Rect.MakeLTRB(x-rx,y-(ry or rx),x+rx,y+(ry or rx)))
def rect(x,y,w,h,r=0):
    p=skia.Path();p.addRoundRect(skia.Rect.MakeXYWH(x,y,w,h),r,r);return p
def tick(t, duration=5/30):
    u=max(0.,t)/duration
    if u>=2:return 1.
    return 1-math.exp(-6*u)*math.cos(7*u)
@dataclass
class Format:
    name:str='portrait'
    scale:float=1.
    @property
    def rect(self):return (0,-300,1080,1620) if self.name=='portrait' else (-420,0,1500,1080)
    @property
    def size(self):return tuple(round(v*self.scale) for v in ((1080,1920) if self.name=='portrait' else (1920,1080)))
    @property
    def caption_rect(self):return (54,920,950,1210) if self.name=='portrait' else (-200,920,1280,1030)
    def stage_to_pixel(self,x,y):return ((x-self.rect[0])*self.scale,(y-self.rect[1])*self.scale)
@dataclass
class Camera:
    centre:tuple=(540,540)
    zoom:float=1.
    roll:float=0.

# Vector pictures cache paired, unlit geometry rather than full-size frame buffers.
# Each render worker has its own bounded cache. Lighting still changes every frame.
_SCENERY = OrderedDict()

class Painter:
    def __init__(self,fmt,time=0,camera=None):
        self.camera=camera or Camera();self.rays_from=None;self.format=fmt;self.time=time;self.stars=[];self.events=[]; self.light_angle=None; self.sheen=None
        self.screen_overlays=[];self.hide_captions=False;self.no_vignette=False;self.bright_palette=False
        self.surfaces=[skia.Surface(*fmt.size),skia.Surface(*fmt.size)]
        self.cs=[s.getCanvas() for s in self.surfaces]
        for c in self.cs:
            c.clear(skia.ColorBLACK);c.scale(fmt.scale,fmt.scale);c.translate(-fmt.rect[0],-fmt.rect[1])
            if camera:
                c.translate(540,540);c.rotate(camera.roll);c.scale(camera.zoom,camera.zoom);c.translate(-camera.centre[0],-camera.centre[1])
        self._view_matrix = np.array(self.cs[0].getTotalMatrix().get9()).reshape(3,3)
        self.font=skia.Typeface.MakeFromFile(str(ROOT/'assets/fonts/Cinzel.ttf')) or skia.Typeface('Georgia')
        coords=skia.FontArguments.VariationPosition.Coordinates([skia.FontArguments.VariationPosition.Coordinate(int.from_bytes(b'wght','big'),900)])
        args=skia.FontArguments().setVariationDesignPosition(skia.FontArguments.VariationPosition(coords))
        self.font=self.font.makeClone(args) or self.font
    def _paint(self,c,stroke=0):
        p=skia.Paint(AntiAlias=True,Color=c)
        if stroke:p.setStyle(skia.Paint.kStroke_Style);p.setStrokeWidth(stroke);p.setStrokeCap(skia.Paint.kRound_Cap);p.setStrokeJoin(skia.Paint.kRound_Join)
        return p
    def _draw(self,p,col,h=.1,metal=0,flag=0,stroke=0):
        self.cs[0].drawPath(p,self._paint(colour(col),stroke))
        self.cs[1].drawPath(p,self._paint(skia.Color(round(h*255),round(metal*255),round(flag*255)),stroke))
    @contextmanager
    def layer(self, depth=1.):
        """Camera response: 0 sky, .25 far, .6 middle, 1 actors, >1 near.

        Absolute depth, including inside another layer. Local artwork transforms
        survive; put a layer outside its clips (a clip is fixed when entered).
        Draw order, value and detail still establish which objects are in front.
        """
        if not 0 <= depth <= 2:raise ValueError('layer depth must be in 0..2')
        cam=self.camera;z=1+(cam.zoom-1)*depth
        if z<=0:raise ValueError('layer camera zoom must be positive')
        inverse=np.linalg.inv(self._view_matrix)
        previous=self._view_matrix
        for c in self.cs:
            local=inverse @ np.array(c.getTotalMatrix().get9()).reshape(3,3)
            c.save();c.resetMatrix();c.scale(self.format.scale,self.format.scale)
            c.translate(-self.format.rect[0],-self.format.rect[1])
            c.translate(540,540);c.rotate(cam.roll*depth);c.scale(z,z)
            c.translate(-540-(cam.centre[0]-540)*depth,-540-(cam.centre[1]-540)*depth)
            view=np.array(c.getTotalMatrix().get9()).reshape(3,3)
            c.concat(skia.Matrix(local))
        self._view_matrix=view
        try:yield self
        finally:
            self._view_matrix=previous
            for c in self.cs:c.restore()
    def cached(self, key, draw):
        """Replay static geometry. Key must include ALL geometry/style arguments.

        draw(p) must use only static drawing, no time, layers, sound or glints.
        Transforms/clips outside this call apply on replay. Change the key when
        changing drawing code in a persistent process. No shaded pixels cached.
        """
        key=(self.format.name,key)
        if key not in _SCENERY:
            recorders=[skia.PictureRecorder(),skia.PictureRecorder()]
            original=self.cs
            self.cs=[r.beginRecording(skia.Rect.MakeLTRB(-2400,-2200,3500,3300)) for r in recorders]
            try:draw(self)
            finally:self.cs=original
            _SCENERY[key]=tuple(r.finishRecordingAsPicture() for r in recorders)
            while len(_SCENERY)>32:_SCENERY.popitem(last=False)
        _SCENERY.move_to_end(key)
        for c,picture in zip(self.cs,_SCENERY[key]):c.drawPicture(picture)
    @contextmanager
    def transform(self,translate=(0,0),rotate=0,pivot=(0,0),scale=1):
        for c in self.cs:
            c.save();c.translate(*translate);c.translate(*pivot);c.rotate(rotate);c.scale(*(scale if isinstance(scale,tuple) else (scale,scale)));c.translate(-pivot[0],-pivot[1])
        try:yield self
        finally:
            for c in self.cs:c.restore()
    @contextmanager
    def clip(self,p):
        for c in self.cs:c.save();c.clipPath(p,doAntiAlias=True)
        try:yield self
        finally:
            for c in self.cs:c.restore()
    def wire(self,p,w=5,reveal=1):
        if reveal<=0 or w<=0:return
        if reveal<1:
            m=skia.PathMeasure(p,False,1); q=skia.Path();m.getSegment(0,m.getLength()*reveal,q,True);p=q
            pt=m.getPosTan(m.getLength()*reveal)[0];self.glint(pt.x(),pt.y(),12,1)
        self._draw(p,'gold',.85,1,stroke=w)
    def gold(self,p,height=.65,texture='smooth'):
        self._draw(p,'gold',height,1,.6 if texture=='hammered' else .2)
    def cell(self,p,enamel,wire_w=5,reveal=1,fill=1,fill_origin=None):
        self._draw(p,'gold',.15,1,.1)
        if fill>0:
            b=p.getBounds();cx,cy=fill_origin or (b.centerX(),b.centerY())
            if fill<1:
                radius=max(math.hypot(cx-x,cy-y) for x in (b.left(),b.right()) for y in (b.top(),b.bottom()))*fill
                angles=np.linspace(0,math.tau,97)
                pts=[(cx+radius*(1+.025*math.sin(a*5)+.018*math.cos(a*7))*math.cos(a),cy+radius*(1+.025*math.sin(a*5)+.018*math.cos(a*7))*math.sin(a)) for a in angles]
                with self.clip(p):self._draw(path(pts),enamel,.12)
            else:self._draw(p,enamel,.12)
        self.wire(p,wire_w,reveal)
    def cabochon(self,cx,cy,r,enamel,ry=None):
        ry=ry or r;p=ellipse(cx,cy,r,ry);self.cell(p,enamel,3.5)
        # Smooth dome encoded directly into R; gold bezel remains outside it.
        with self.clip(ellipse(cx,cy,r-2,ry-2)):
            paint=self._paint(skia.ColorBLACK)
            paint.setShader(skia.GradientShader.MakeRadial((cx,cy),r,[skia.Color(235,0,0),skia.Color(170,0,0),skia.Color(35,0,0)],[0,.65,1]))
            self.cs[1].save();self.cs[1].translate(cx,cy);self.cs[1].scale(1,ry/r);self.cs[1].translate(-cx,-cy);self.cs[1].drawPath(ellipse(cx,cy,r),paint);self.cs[1].restore()
    def rivet(self,x,y,r=7):self.gold(ellipse(x,y,r),.85);self.cabochon(x,y,r*.45,'gold')
    def beads(self,p,spacing=15,r=3):
        m=skia.PathMeasure(p,False,1)
        for d in np.arange(0,m.getLength(),spacing):
            pt=m.getPosTan(float(d))[0];self.gold(ellipse(pt.x(),pt.y(),r),.85)
    def text(self,s,x,y,size=32,anchor='center',highlight=False):
        f=skia.Font(self.font,size);f.setEmbolden(True);f.setEdging(skia.Font.Edging.kAntiAlias)
        width=f.measureText(s.upper());x-=width*(.5 if anchor=='center' else 1 if anchor=='right' else 0)
        p=skia.Path()
        for glyph,pos in zip(f.textToGlyphs(s.upper()),f.getPos(f.textToGlyphs(s.upper()))):
            q=f.getPath(glyph)
            if q:p.addPath(q,x+pos.x(),y+pos.y())
        self._draw(p,'umber',.3,0,.78,stroke=2)
        self._draw(p,'pearl' if highlight else '#ffe4a0',.7,0,.9)
    def plaque(self,s,x,y,enamel='onyx',size=32,width=None):
        w=width or max(150,skia.Font(self.font,size).measureText(s.upper())+58)
        height=max(66,size*1.25)
        self.cell(rect(x-w/2,y-height/2,w,height,15),enamel,5);self.text(s,x,y+size*.36,size)
    def ground(self,kind='scroll',enamel='turquoise',rays_from=None):
        self.rays_from=rays_from
        # Cache paired unlit ground layers in stage coordinates. Draw under the camera
        # matrix so even a moving camera reuses geometry without swimming.
        for c,img in zip(self.cs,_ground_images(kind,enamel)):
            c.drawImage(img,-700,-600)
        if kind=='night':
            rng=np.random.default_rng(91)
            for x,y,r in zip(rng.uniform(-420,1500,520),rng.uniform(-300,1620,520),rng.uniform(.7,2.5,520)):
                val=max(0,math.cos(self.time*.72+x*4+y))**24
                if val>.25:self.glint(x,y,5,val)
    def frame(self,style='jewelled'):
        """Ornamental margins; portrait top centre remains a plaque slot."""
        self.border()
        portrait=self.format.name=='portrait'
        for band in (0,1):
            with self.transform(rotate=0 if portrait else 90,pivot=(540,540)):
                y=(-190 if band==0 else 1460) if portrait else (-270 if band==0 else 1350)
                self.cell(rect(55,y-63,970,126,12),'midnight',4)
                for yy in (y-48,y+48):
                    self.wire(path([(60,yy),(1020,yy)],False),3)
                    self.beads(path([(65,yy),(1015,yy)],False),18,3)
                for x in range(100,1020,88):
                    if portrait and band==0 and 360<x<720:continue
                    self.cell(path([(x-31,y),(x,y-33),(x+31,y),(x,y+33)]),'lapis' if x%3 else 'crimson',3)
                    self.cabochon(x,y,8,'turquoise');self.cabochon(x+42,y,4,'pearl')
    def border(self):
        x,y,x1,y1=self.format.rect;p=rect(x+28,y+28,x1-x-56,y1-y-56,16)
        self.wire(p,2);self.beads(p,13,2.7)
        self.wire(rect(x+43,y+43,x1-x-86,y1-y-86,12),1.3)
    def pattern(self,p,kind='diamond',spacing=52):
        b=p.getBounds()
        with self.clip(p):
            for yy in np.arange(b.top()-b.width(),b.bottom()+b.width(),spacing):
                if kind=='diamond':
                    self.wire(path([(b.left(),yy),(b.right(),yy+b.width())],False),3)
                    self.wire(path([(b.left(),yy),(b.right(),yy-b.width())],False),3)
                elif kind=='stripes':self.wire(path([(b.left(),yy),(b.right(),yy)],False),3)
                else:
                    for xx in np.arange(b.left(),b.right()+spacing,spacing):self.wire(path([(xx,yy),(xx+spacing/2,yy+spacing*.7,xx+spacing,yy)],False),3)
            if kind=='diamond':
                for yy in np.arange(b.top(),b.bottom(),spacing):
                    for xx in np.arange(b.left(),b.right(),spacing):self.cabochon(xx,yy,5,'coral')
    def crack(self,seed,region,progress=1,origin=None):
        b=region.getBounds();origin=origin or (b.centerX(),b.centerY())
        rng=np.random.default_rng(seed);length=math.hypot(b.width(),b.height())*.65
        chains=[];tips=[]
        for i in range(7):
            angle=i*math.tau/7+rng.uniform(-.2,.2);pts=[origin]
            for j in range(1,10):
                a=angle+rng.uniform(-.16,.16);r=length*j/9
                pts.append((origin[0]+math.cos(a)*r,origin[1]+math.sin(a)*r))
            chains.append((pts,0,1));tips.append(pts[5])
            for j in (3,6):
                x,y=pts[j];a=angle+rng.choice([-1,1])*.9
                branch=[(x,y)]+[(x+math.cos(a)*length*k/22+rng.uniform(-5,5),y+math.sin(a)*length*k/22) for k in range(1,5)]
                chains.append((branch,j/10,.35))
        for i in range(7):chains.append(([tips[i],tips[(i+1)%7]],.62,.38))
        with self.clip(region):
            for pts,start,span in chains:
                u=max(0,min(1,(progress-start)/span))
                if not u:continue
                q=path(pts,False);m=skia.PathMeasure(q,False,1);cut=skia.Path();m.getSegment(0,m.getLength()*u,cut,True)
                with self.transform(translate=(.8,-.6)):self._draw(cut,'#888780',.12,0,.78,stroke=1.1)
                self._draw(cut,'#292337',.08,0,.78,stroke=.85)
    def shatter(self,draw_fn,bounds,seed,t,pieces=14,gravity=900):
        """draw_fn(p): deterministic clipped Voronoi shards, t in seconds."""
        if t<=0:draw_fn(self);return
        x,y,w,h=bounds;rng=np.random.default_rng(seed)
        sites=rng.uniform((x,y),(x+w,y+h),(pieces,2))
        for i,site in enumerate(sites):
            poly=[(x,y),(x+w,y),(x+w,y+h),(x,y+h)]
            for j,other in enumerate(sites):
                if i==j:continue
                n=other-site;d=(other@other-site@site)/2;clipped=[]
                for a,b in zip(poly,poly[1:]+poly[:1]):
                    da=np.dot(a,n)-d;db=np.dot(b,n)-d
                    if da<=0:clipped.append(a)
                    if (da<0)!=(db<0):clipped.append(tuple(np.array(a)+(np.array(b)-a)*da/(da-db)))
                poly=clipped
                if not poly:break
            vx,vy=rng.uniform(-180,180),rng.uniform(-180,-40);spin=rng.uniform(-140,140)
            with self.transform(translate=(vx*t,vy*t+.5*gravity*t*t),rotate=spin*t,pivot=tuple(site)):
                if poly:
                    with self.clip(path(poly)):draw_fn(self)
    def sound(self,time,name,gain=1):
        if name not in ('tink','clink','pour','crack','whoosh','stamp','shatter','spark',
                        'blade','impact','paper','draw','water','wind','bell','march',
                        'footstep','door','cloth','hammer','grind','creak','crowd','cannon','hooves'):raise ValueError(name)
        self.events.append(dict(time=time,name=name,gain=gain))
    def ambience(self,time,name,duration,gain=.5,fade=.25):
        """Declare a local-time bed range; use the shot span for a whole place.

        Like sound(), declare unconditionally on every draw call. The mixer
        loops/crossfades the recording, fades range edges and protects speech.
        """
        if name not in ('sea','desert','hall','market','workshop','fire','rain','battle'):raise ValueError(name)
        if not np.isfinite([time,duration,gain,fade]).all() or duration<=0 or fade<0:
            raise ValueError('Ambience needs finite time/gain, positive duration and nonnegative fade.')
        self.events.append(dict(kind='ambience',time=time,name=name,duration=duration,gain=gain,fade=fade))
    def glint(self,x,y,size=20,intensity=1):
        pt=self.cs[0].getTotalMatrix().mapXY(x,y);self.stars.append((pt.x(),pt.y(),size*self.format.scale,intensity))
    def arrays(self):return [np.asarray(s.makeImageSnapshot().toarray(colorType=skia.ColorType.kRGBA_8888_ColorType))[:,:,:3] for s in self.surfaces]
@dataclass
class Shot:
    id:str
    start:float
    end:float
    draw:object
    clauses:list=field(default_factory=list)
    camera:object=None
    world_exception:str=''
@dataclass
class Film:
    shots:list
    events:list=field(default_factory=list)
    use_timeline:bool=True
    hook:object=None
    profile:str='feed'
    @property
    def duration(self):return max(s.end for s in self.shots)
class Context:
    def __init__(self,shot,fmt,timeline=None):
        self.shot=shot;self.format=fmt;self.clauses=shot.clauses
        if timeline:
            found=next((s for s in timeline.get('scenes',[]) if s['id']==shot.id),None)
            if found:self.clauses=found['clauses']
    def cue(self,n):return self.clauses[n]['start']-self.shot.start if n<len(self.clauses) else n*(self.shot.end-self.shot.start)/max(1,len(self.clauses))
    def pose(self,t,n,a,b):return a+(b-a)*tick(t-self.cue(n)) if t>=self.cue(n) else a


def estimate_clauses(text,start=0,duration=7):
    """Build deterministic word/cue estimates when narration is not available."""
    clauses=[c.strip() for c in text.split('|') if c.strip()]
    words=[c.split() for c in clauses];total=sum(map(len,words));cursor=start;out=[]
    for phrase,ws in zip(clauses,words):
        begin=cursor;timed=[]
        for word in ws:
            end=cursor+duration/max(1,total);timed.append(dict(w=word,start=cursor,end=end));cursor=end
        out.append(dict(text=phrase,start=begin,end=cursor,words=timed))
    return out


@lru_cache(8)
def _ground_images(kind,enamel):
    surfaces=[skia.Surface(2600,2500),skia.Surface(2600,2500)]
    # A lightweight painter only for building the cached unlit ground.
    p=object.__new__(Painter);p.cs=[s.getCanvas() for s in surfaces]
    for c in p.cs:c.translate(700,600)
    region=rect(-700,-600,2600,2500)
    if kind=='gold':p.gold(region,.18,'hammered')
    else:p._draw(region,'midnight' if kind=='night' else enamel,.12,0,1 if kind=='night' else 0)
    rng=np.random.default_rng(91)
    if kind=='scroll':
        placed=[]
        for y in range(-560,1900,56):
            for x in range(-660,1900,56):
                cx=x+rng.uniform(-10,10);cy=y+rng.uniform(-10,10)
                radius=rng.uniform(16,34)
                if any((cx-px)**2+(cy-py)**2 < ((radius+pr)*.92)**2 for px,py,pr in placed[-120:]):radius=17
                placed.append((cx,cy,radius))
                rotation=rng.uniform(0,math.tau);hand=rng.choice([-1,1])
                pts=[]
                for a in np.linspace(0,math.pi*rng.uniform(1.5,2.9),38):
                    r=radius*max(.08,1-a/12);aa=rotation+hand*a
                    pts.append((cx+r*math.cos(aa),cy+r*math.sin(aa)))
                if rng.random()<.35:
                    # Smooth opposing terminal curl, connected tangentially.
                    end=pts[-1];pts += [(end[0]+radius*.5*math.sin(a)*math.cos(rotation)-radius*.25*a*math.sin(rotation),end[1]+radius*.5*math.sin(a)*math.sin(rotation)+radius*.25*a*math.cos(rotation)) for a in np.linspace(0,math.pi*2,25)]
                p.wire(path(pts,False),2.3)
    if kind=='night':
        for x,y,r in zip(rng.uniform(-420,1500,520),rng.uniform(-300,1620,520),rng.uniform(.7,2.5,520)):p.gold(ellipse(x,y,r),.5)
    return tuple(s.makeImageSnapshot() for s in surfaces)
