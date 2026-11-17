"""Living Enamel cast. Rigid parts, shared face, stage-space public rigs."""
import math
from .engine import path, ellipse, rect, PALETTE

PALETTE.update(umber='#4a2c1a', bronze='#b9824f', moss='#657b48', sky='#609ab1')
EXPRESSIONS = {
 'smug': dict(eyelid=.46, mouth='smirk', brow_angles=(-12,5), brow_height=(-8,5)),
 'shocked': dict(eyelid=0., mouth='open', brow_angles=(-18,18), brow_height=(-42,-36)),
 'scheming': dict(eyelid=.72, mouth='smirk', brow_angles=(22,-19), brow_height=(9,3)),
 'pained': dict(eyelid=1., mouth='grimace', brow_angles=(-25,25), brow_height=(5,5)),
 'grin': dict(eyelid=.15, mouth='grin', brow_angles=(-9,8), brow_height=(-12,-8)),
 'triumphant': dict(eyelid=.22, mouth='grin', brow_angles=(-22,14), brow_height=(-26,-18)),
 'grim': dict(eyelid=.43, mouth='flat', brow_angles=(20,-20), brow_height=(8,8)),
 'terrified': dict(eyelid=0., mouth='grimace', brow_angles=(-30,30), brow_height=(-36,-36)),
 'defeated': dict(eyelid=.62, mouth='frown', brow_angles=(-23,23), brow_height=(9,9)),
}
DESIGNS = ('emperor','citizen_0','citizen_1','citizen_2','general','bulgar','rival_0','rival_1')

def blend_pose(a, b, amount):
    """Blend expression names or pose dictionaries; discrete values switch at .5."""
    a = EXPRESSIONS[a] if isinstance(a,str) else a
    b = EXPRESSIONS[b] if isinstance(b,str) else b
    def mix(x,y):
        if isinstance(x,bool) or isinstance(y,bool): return x if amount<.5 else y
        if isinstance(x,(int,float)) and isinstance(y,(int,float)): return x+(y-x)*amount
        if isinstance(x,(tuple,list)) and isinstance(y,(tuple,list)): return tuple(mix(i,j) for i,j in zip(x,y))
        return x if amount<.5 else y
    return {k:mix(a.get(k,b.get(k)),b.get(k,a.get(k))) for k in a.keys()|b.keys()}

def nose(p, state='present', at=(546,565), scale=.93, rotate=0):
    """Independent pear-shaped nose; at is its centre, transforms are rigid."""
    with p.transform(translate=at,scale=scale,rotate=rotate):
        shape=path([(-26,-70),(-21,-103,24,-99,30,-65),(34,-30,77,-8,65,27),(55,66,-40,71,-61,35),(-81,2,-39,-27,-26,-70)])
        if state=='gold': p.gold(shape,.85);p.wire(shape,4)
        elif state=='missing': p.cell(shape,'onyx',3)
        elif state=='present': p.cell(shape,'bronze',4)
        else: raise ValueError('nose state must be present, missing or gold')

def _mouth(p, mouth, simple):
    y=135
    if mouth in ('open','o'):
        p.cell(ellipse(0,y+16,40,44),'onyx',5)
        with p.clip(ellipse(0,y+16,40,44)): p.cell(ellipse(0,y+62,30,26),'oxblood',3)
    elif mouth in ('grin','grimace'):
        shape=path([(-87,y-13),(0,y+10,87,y-13),(62,y+80,-62,y+80,-87,y-13)]) if mouth=='grin' else rect(-72,y,144,45,17)
        p.cell(shape,'oxblood',4)
        with p.clip(shape):
            p.cell(rect(-80,y-9 if mouth=='grin' else y+6,160,29,9),'ivory',2)
            if mouth=='grimace' and not simple:
                for x in (-36,0,36): p.wire(path([(x,y+7),(x,y+34)],False),2)
    else:
        bend={'smile':40,'smirk':22,'flat':0,'frown':-30}[mouth]
        p.wire(path([(-67,y),(0,y+bend,72,y-12 if mouth=='smirk' else y)],False),6)
    # Waxed moustache rides the mouth, its tips follow the smile.
    if not simple:
        lift=12 if mouth in ('grin','smile','smirk') else 0
        for side in (-1,1):
            p.wire(path([(side*8,y-28),(side*45,y-49,side*72,y-13-lift),(side*91,y-7-lift,side*105,y-30-lift)],False),8)

def _head(p, expression='smug', nose_state='present', eye_look=(0,0), eyelid=None,
          brow_angles=None, brow_height=None, mouth=None, simple=False, beard=True,
          skin='ivory', cracks=0, back=False):
    pose=EXPRESSIONS[expression]
    lid=pose['eyelid'] if eyelid is None else eyelid
    ba=pose['brow_angles'] if brow_angles is None else brow_angles
    bh=pose['brow_height'] if brow_height is None else brow_height
    mo=mouth or pose['mouth']
    face=path([(-260,-105),(-260,-233,-175,-250,-70,-250),(90,-250,260,-248,260,-100),(265,130,242,223,147,239),(50,260,-140,255,-209,215),(-265,173,-260,20,-260,-105)])
    for x in (-263,263): p.cell(ellipse(x,7,32,47),skin,4)
    p.cell(face,'umber' if back else skin,5)
    if back:return
    if beard:
        p.cell(path([(-247,76),(-216,122,-204,144,-168,137),(-131,127,-110,187,0,194),(110,185,158,119,191,137),(220,139,239,104,247,76),(255,204,205,248,116,252),(-110,270,-247,243,-247,76)]),'umber',4)
        if not simple:
            for x in range(-180,181,45):p.wire(path([(x-19,210),(x,244,x+19,212)],False),3)
    # Hair cap with a scalloped fringe, so the head is not bald when the crown comes off.
    with p.clip(face):
        p.cell(path([(-290,-290),(290,-290),(290,-178),(205,-150,135,-182),(68,-154,0,-184),(-68,-154,-135,-182),(-205,-150,-290,-178)]),'umber',4)
    p.wire(face,5)
    for x in (-230,230):
        p.cell(ellipse(x,-157,35,76),'umber',4)
        if not simple:
            for j in range(3 if x<0 else 2):p.wire(path([(x-13,-201+j*37),(x+25,-214+j*37,x+21,-181+j*37),(x-10,-165+j*37,x-9,-187+j*37)],False),3)
    for i,x in enumerate((-123,123)):
        ex=x+max(-15,min(15,eye_look[0]));ey=18+max(-10,min(10,eye_look[1]))
        if simple:
            p.cell(ellipse(ex,ey,43,49),'onyx',3)
        else:p.cabochon(ex,ey,57,'onyx',65)
        ll=lid[i] if isinstance(lid,(tuple,list)) else lid
        if simple and ll < .99: ll=min(ll,.38)
        if ll>0:
            with p.clip(ellipse(ex,ey,58 if not simple else 44,66 if not simple else 50)):
                top=ey-(66 if not simple else 50);hh=(132 if not simple else 100)*min(1,max(0,ll))
                p.gold(rect(ex-65,top-2,130,hh+2),.65)
                p.wire(path([(ex-62,top+hh),(ex+62,top+hh)],False),5)
        if ll >= .99:
            p.wire(path([(ex-32,ey+10),(ex,ey-4),(ex+32,ey+10)],False),5)
        elif simple:
            p.cell(ellipse(ex-10,ey+11,6),'pearl',0)
        by=-82+bh[i]
        with p.transform(rotate=ba[i],pivot=(x,by)):p.wire(path([(x-54,by),(x,by-15,x+54,by)],False),11)
    for x in (-190,190):p.cell(ellipse(x,105,27,14),'coral',2)
    _mouth(p,mo,simple)
    nose(p,nose_state,at=(6,65),scale=.93)
    if cracks:p.crack(52,face,cracks)

def _halo(p, offset=(0,0), tilt=0, simple=False):
    with p.transform(translate=offset,rotate=tilt):
        p.gold(ellipse(0,-15,345,365),.35,'hammered')
        p.cell(ellipse(0,-15,329,349),'lapis',4)
        p.gold(ellipse(0,-15,311,331),.35,'hammered')
        if not simple:
            for i in range(40):
                a=i*math.tau/40
                p.rivet(337*math.cos(a),-15+357*math.sin(a),4)
        # Asymmetric status ornament makes halo rotation readable.
        p.cell(path([(0,-365),(19,-338),(0,-311),(-19,-338)]),'amethyst',3)

def _crown(p, offset=(0,0), tilt=0, pendulum=None, simple=False, dent=False):
    with p.transform(translate=offset,rotate=tilt,pivot=(0,-235)):
        shape=path([(-257,-225),(-272,-335),(-191,-298),(-146,-375),(-63,-300),(0,-390),(68,-302),(149,-372 if not dent else -288),(196,-298),(270,-335),(255,-225)])
        p.gold(shape,.65,'hammered');p.wire(shape,5)
        p.cell(rect(-255,-268,510,55,10),'oxblood',5)
        for x in (-196,-98,0,98,196):p.cabochon(x,-240,17,'amethyst' if x==0 else 'lapis',21)
        if not simple:
            for x in (-146,0,149):p.cabochon(x,-312,11,'pearl',16)
            swing=math.sin(p.time*4)*6 if pendulum is None else pendulum
            for x,s in ((-263,1),(263,-1)):
                with p.transform(rotate=swing*s,pivot=(x,-225)):
                    p.wire(path([(x,-225),(x,-20)],False),3)
                    for y in range(-202,-20,30):p.cabochon(x,y,8,'pearl',11)
                    p.cabochon(x,-8,12,'pearl',17)

def _mitten(p,x,y,scale=1,rotate=0):
    with p.transform(translate=(x,y),scale=scale,rotate=rotate):
        p.cell(path([(-24,36),(-42,2,-33,-33,-10,-40),(14,-58,40,-34,34,-5),(66,-31,70,5,40,25),(20,47,-8,45,-24,36)]),'sand',4)

def bust(p,expression='smug',nose_state='present',eye_look=(0,0),eyelid=None,brow_angles=None,mouth=None,head_tilt=0,halo_tilt=0,halo_offset=(0,0),crown_offset=(0,0),robe_fill=1,cracks=0,pendulum=None,scale=1,at=(540,540),brow_height=None,halo_hidden=False,crown_hidden=False,crown_tilt=0,hands=None,robe_trim_fill=None):
    """Bust at core anchor; scale 1 spans y=110..1080, head width 520."""
    with p.transform(translate=(at[0]-540*scale,at[1]-540*scale),scale=scale):
        with p.transform(translate=(540,500)):
            if not halo_hidden:_halo(p,halo_offset,halo_tilt)
        robe=path([(348,711),(190,728,134,961,125,1080),(955,1080),(938,913,883,750,732,711),(540,797,348,711)])
        p.cell(robe,'amethyst',6,fill=robe_fill,fill_origin=(540,1080))
        for x,s in ((280,-1),(800,1)):
            p.wire(path([(x,780),(x+s*55,922),(x+s*60,1035)],False),5)
            p.rivet(x,800,15);p.rivet(x+s*43,954,11)
            p.wire(path([(x-44,1009),(x+44,1009)],False),7)
        loros=path([(446,760),(627,760),(666,1080),(411,1080)])
        p.cell(loros,'oxblood',6)
        if robe_trim_fill is not None:p.cell(loros,'saffron',6,fill=robe_trim_fill,fill_origin=(540,1080))
        p.pattern(loros,'diamond',58)
        p.cell(path([(332,700),(540,774,748,700),(729,788),(540,851,352,788)]),'lapis',6)
        for x in range(379,720,46):p.cabochon(x,778+21*(1-abs(x-540)/180),10,'pearl')
        with p.transform(translate=(540,500),rotate=head_tilt,pivot=(0,200)):
            _head(p,expression,nose_state,eye_look,eyelid,brow_angles,brow_height,mouth,cracks=cracks)
            if not crown_hidden:_crown(p,crown_offset,crown_tilt,pendulum)
        if hands:
            positions={'cheeks':((312,644,-22),(766,644,22)), 'nose':((620,616,-55),), 'raised':((205,550,-20),(875,550,20))}
            for x,y,a in positions[hands] if isinstance(hands,str) else hands:
                p.cell(rect(x-32,y+22,64,max(105,900-y),28),'amethyst',4);p.rivet(x,y+74,9);_mitten(p,x,y,1.25,a)
        if cracks:p.crack(19,robe,cracks)

def figure(p,design,x,y,h,**pose):
    """Full rig; x/y are foot midpoint, h nominal standing height. See CAST.md."""
    variant=pose.get('variant',0)
    if '_' in design:design,v=design.rsplit('_',1);variant=int(v)
    if design not in ('emperor','citizen','general','bulgar','rival'):raise ValueError(design)
    if h<=0: raise ValueError('h must be positive')
    simple=h<260
    colour={'emperor':'amethyst','citizen':('sand','coral','moss')[variant%3],'general':'bronze','bulgar':'jade','rival':('oxblood','sand')[variant%2]}[design]
    prone=pose.get('prone',False);sit=pose.get('sit',False)
    seated=160 if sit else 0
    off=pose.get('offset',(0,0));hop=pose.get('hop',0)
    # Prone anchor is the centre of the horizontal silhouette at ground level.
    with p.transform(translate=(x+off[0],y+off[1]-hop),scale=h/1000):
      with p.transform(translate=(-500*pose.get('prone_direction',1),-100) if prone else (0,0),rotate=(90*pose.get('prone_direction',1) if prone else pose.get('body_lean',0)),pivot=(0,0)):
        with p.transform(translate=(0,-1000)):
            if design=='emperor' and pose.get('halo',False):
                with p.transform(translate=(0,265),scale=.65):_halo(p,pose.get('halo_offset',(0,0)),pose.get('halo_tilt',0),simple)
            for fx in (-105,105):p.gold(ellipse(fx*pose.get('stance',1),965 if not sit else 955,74,35),.65)
            body=path([(-135,407),(-204,516,-230,760,-252,938),(252,938),(229,706,196,493,135,407)]) if not sit else path([(-135,567),(-204,650,-315,786,-300,915),(300,915),(290,740,198,660,135,567)])
            p.cell(body,colour,5)
            if not simple and design in ('citizen','general','bulgar'):p.pattern(body,'scales' if design=='general' else 'stripes' if design=='citizen' else 'diamond',72 if design=='general' else 100)
            if design=='emperor':
                panel=path([(-58,438+seated),(58,438+seated),(90,932),(-90,932)])
                p.cell(panel,'oxblood',4)
                if not simple:p.pattern(panel,'diamond',70)
            if sit:
                for xx in (-150,150):p.cell(ellipse(xx,854,110,55),colour,4);p.rivet(xx,854,10)
            for side,key in ((-1,'left'),(1,'right')):
                shoulder=pose.get(key+'_shoulder',side*-45 if sit else side*-8);elbow=pose.get(key+'_elbow',side*-65 if sit else side*-12)
                with p.transform(translate=(side*165,468+seated),rotate=shoulder):
                    p.cell(rect(-44,0,88,208,40),colour,5);p.rivet(0,0,19)
                    with p.transform(translate=(0,196),rotate=elbow):
                        p.cell(rect(-39,0,78,182,32),colour,4);p.rivet(0,0,16)
                        _mitten(p,0,196,.95)
                        if pose.get('spear',design in ('general','bulgar')) and side==1:
                            with p.transform(translate=(0,195),rotate=pose.get('spear_angle',0)):
                                p.wire(path([(0,130),(0,-640)],False),9)
                                p.gold(path([(0,-730),(-25,-631),(0,-652),(25,-631)]),.7)
            p.cell(ellipse(0,434+seated,146,46),'lapis' if design=='emperor' else 'sand',5)
            if not simple:
                for xx in (-95,0,95):p.cabochon(xx,437+seated,12,'pearl')
            with p.transform(translate=(0,265+seated),rotate=pose.get('head_tilt',0),scale=.65):
                args={k:pose[k] for k in ('expression','nose_state','eye_look','eyelid','brow_angles','brow_height','mouth','cracks') if k in pose}
                args.setdefault('expression','smug' if design=='emperor' else 'defeated' if design=='citizen' else 'grim')
                _head(p,**args,simple=simple,beard=design in ('emperor','bulgar','rival'),skin='sand' if design=='bulgar' else 'ivory',back=prone=='front')
                if design in ('emperor','rival') and not pose.get('crown_hidden',False):_crown(p,pose.get('crown_offset',(0,0)),pose.get('crown_tilt',-17 if design=='rival' else 0),pose.get('pendulum'),simple,design=='rival')
                elif design=='general':
                    p.cell(path([(-266,-160),(-260,-380,258,-380,266,-160),(0,-206,-266,-160)]),'bronze',5)
                    p.cell(path([(-70,-320),(-145,-484,166,-507,125,-302),(40,-357,-70,-320)]),'oxblood',5)
                    p.gold(rect(-20,-350,40,190,15),.7)
                elif design=='bulgar':
                    p.cell(path([(-268,-175),(-160,-320,0,-438),(170,-319,268,-175)]),'bronze',5)
                    p.cell(rect(-270,-230,540,72,27),'umber',5)
                    if not simple:
                        for xx in range(-240,241,48):p.wire(path([(xx,-213),(xx+18,-184),(xx+30,-207)],False),3)
                elif design=='citizen':
                    caps=[path([(-265,-180),(-301,-354,161,-393,240,-238),(280,-181),(-265,-180)]),path([(-262,-180),(-210,-304,-40,-343),(40,-446,230,-333,262,-180)]),path([(-270,-177),(-280,-286,270,-286,270,-177)])]
                    p.cell(caps[variant%3],('sky','sand','coral')[variant%3],5)
                    p.wire(path([(-260,-181),(0,-209,260,-181)],False),9)


