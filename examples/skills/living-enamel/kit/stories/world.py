"""Composable Living Enamel places. See references/worlds.md before choosing a style.

All coordinates are stage units. Draw back to front; depth controls camera response,
not occlusion. Defaults leave a quiet subject field, with floors through y=1900.
Styles are drawing vocabularies, not historical claims. Research the actual place.
Static geometry is cached as paired unlit vector pictures; ambient life is separate.
"""
import math
from gilt import path, rect, ellipse
from .pilot_sets import multi, arch, dome, crenel

BOUNDS = (-900, -700, 2900, 2700)


def lines(p, segments, width=2):
    if segments:p.wire(multi(segments), width)


def _check(value, choices):
    if value not in choices:raise ValueError(f'{value!r}: choose {", ".join(choices)}')


def archway(x, bottom, w, h, profile='cusped'):
    """Opening path, reusable for a new facade. x is centre; bottom is sill."""
    _check(profile, ('cusped', 'round', 'pointed'))
    if profile == 'round':return arch(x-w/2, bottom, w, h)
    top=bottom-h; spring=top+h*.32
    if profile == 'pointed':
        return path([(x-w/2,bottom),(x-w/2,spring),
                     (x-w/2,top+h*.13,x-w*.14,top+h*.14,x,top),
                     (x+w*.14,top+h*.14,x+w/2,top+h*.13,x+w/2,spring),(x+w/2,bottom)])
    # Nine shallow lobes, with a pointed central crown. Intentionally broad
    # enough to read as a cusped arch at phone size, not a fine scallop texture.
    pts=[(x-w/2,bottom),(x-w/2,spring)]
    for i in range(9):
        a=math.pi+math.pi*i/9;b=math.pi+math.pi*(i+1)/9
        mid=(a+b)/2
        pts.append((x+math.cos(mid)*w*.55, spring+math.sin(mid)*h*.4,
                    x+math.cos(b)*w/2,spring+math.sin(b)*h*.32))
    pts += [(x+w/2,bottom)]
    return path(pts)


def sky(p,t,fmt,mode='day',horizon=570,depth=.08,birds=True):
    _check(mode,('day','dusk','night','bright'))
    if mode=='bright':
        p.no_vignette=True;p.bright_palette=True
    colours={'day':('#354d61','#627985','#a9a388'),
             'dusk':('#292c47','#79505a','#b68163'),
             'night':('#111e33','#24344c','#adb9b1'),
             'bright':('#079cf8','#72daff','#fff4bd')}
    a,b,sun=colours[mode]
    def static(q):
        q.cell(rect(*BOUNDS),a,0 if mode=='bright' else 1)
        q.cell(path([(-900,horizon-380),(200,horizon-510,930,horizon-190,2000,horizon-430),
                     (2000,2000),(-900,2000)]),b,0 if mode=='bright' else 1.4)
        if mode!='bright':q.cell(ellipse(870,-100,77),sun,2)
        if mode=='night':
            for i in range(26):
                x=-520+(i*317)%2200;y=-440+(i*173)%650
                q.gold(ellipse(x,y,2+(i%2)),.4)
    with p.layer(depth):
        p.cached(('world.sky',mode,horizon),static)
        for i in range(4):
            x=-500+i*680+24*math.sin(t*.11+i)
            y=70+(i%2)*180
            p.cell(path([(x-170,y),(x-120,y-45,x-72,y-43,x-42,y-22),
                         (x-14,y-100,x+104,y-94,x+125,y-36),
                         (x+180,y-55,x+237,y-25,x+250,y),(x-170,y)]),b,0 if mode=='bright' else 1.6)
        if birds:
            for i in range(4):
                x=170+i*64+45*math.sin(t*.12);y=250+i%2*24
                wing=8+6*math.sin(t*2.2+i)
                lines(p,[[(x-18,y-wing),(x,y),(x+18,y-wing)]],2)
    return {'horizon':horizon}


def landscape(p,t,fmt,kind='hills',horizon=580,depth=.25):
    """Land reaches below both crops; add water() for a river or sea in front."""
    _check(kind,('hills','desert','plain'))
    colours={'hills':('#354b4d','#293f3c','#314641'),
             'desert':('#87705c','#695447','#705548'),
             'plain':('#4c6055','#374e42','#3d5141')}
    a,b,c=colours[kind]
    def static(q):
        for j,(col,y) in enumerate(((a,horizon-220),(b,horizon),(c,horizon+280))):
            pts=[(-900,2000),(-900,y)]
            for x in range(-900,2101,300):
                yy=y+math.sin(x*.004+j*2)*(100 if kind=='hills' else 50)
                pts.append((x+120,yy-55,x+300,yy))
            pts.append((2100,2000));q.cell(path(pts),col,2)
        # Broad near contours establish land, rather than an ornamental ground.
        for i in range(5):
            y=horizon+430+i*185
            lines(q,[[(-900,y),(0,y-70,900,y+110,2000,y-25)]],1.8)
        if kind=='plain':
            for x in (-350,150,1000,1400):
                lines(q,[[(x,1000),(x-24,925)],[(x,1000),(x+12,907)]],2)
    with p.layer(depth):p.cached(('world.land',kind,horizon),static)
    return {'ground':(540,horizon+380)}


def water(p,t,fmt,kind='river',horizon=790,depth=.65):
    _check(kind,('river','sea'))
    def shape():
        if kind=='sea':return rect(-900,horizon,2900,2000-horizon)
        return path([(720,horizon),(960,horizon),(270,1180,1190,1430,1500,2000),
                     (70,2000),(450,1400,-120,1170,720,horizon)])
    with p.layer(depth):
        p.cached(('world.water',kind,horizon),lambda q:q.cell(shape(),'#203f50',3))
        with p.clip(shape()):
            for j in range(12):
                y=horizon+50+j*j*8
                for i in range(5):
                    x=-650+i*620+32*math.sin(t*.8+j)
                    lines(p,[[(x,y),(x+80,y-13,x+155,y+13,x+240,y)]],2)
    return {'bank':(450,horizon+350)}


def floor(p,fmt,kind='stone',horizon=700,vanish=(540,400),colour=None,depth=1.):
    _check(kind,('stone','boards','earth'))
    tone=colour or {'stone':'#394a4a','boards':'#4a3832','earth':'#705547'}[kind]
    def static(q):
        q.cell(rect(-900,horizon,2900,2000-horizon),tone,2)
        if kind=='earth':
            # Trampled approach to a gate: broad wheel ruts and compressed
            # ground ridges give the near plane scale, not random ornament.
            for side in (-1,1):
                lines(q,[[(vanish[0]+side*42,horizon),
                          (vanish[0]+side*75,horizon+250,
                           vanish[0]+side*180,horizon+780,
                           vanish[0]+side*300,2000)]],3)
            for y in (horizon+170,horizon+390,horizon+680,horizon+1060):
                lines(q,[[(-900,y),(0,y-35,1100,y+40,2000,y-15)]],2)
            for i in range(22):
                x=-600+(i*479)%2500;y=horizon+80+(i*137)%1000
                q.cell(ellipse(x,y,18+i%5*6,6),'#655043',1.5)
            return
        segs=[]
        for x in range(-1800,3001,220 if kind=='stone' else 140):
            u=(horizon-vanish[1])/(2000-vanish[1])
            segs.append([(vanish[0]+(x-vanish[0])*u,horizon),(x,2000)])
        for i,y in enumerate((horizon+45,horizon+115,horizon+220,horizon+365,horizon+560,horizon+820,horizon+1160)):
            if kind=='stone':segs.append([(-900,y),(2000,y)])
            else:
                for x in range(-800+(i%2)*170,2000,440):segs.append([(x,y),(x+140,y)])
        lines(q,segs,2)
    with p.layer(depth):p.cached(('world.floor',kind,horizon,vanish,tone),static)
    return {'floor':(540,horizon+250)}


def carpet(p,fmt,top=780,bottom=1900,centre=540,width=650,depth=1.,colour='#522d38'):
    def static(q):
        w=width/2
        shape=path([(centre-w*.52,top),(centre+w*.52,top),(centre+w*1.55,bottom),(centre-w*1.55,bottom)])
        q.cell(shape,colour,3)
        with q.clip(shape):
            # Wide borders, quiet centre under captions. No tiny busy lattice.
            for s in (-1,1):
                lines(q,[[(centre+s*w*.43,top),(centre+s*w*1.39,bottom)],
                         [(centre+s*w*.34,top),(centre+s*w*1.22,bottom)]],2.5)
            for y in range(top+90,bottom,175):
                u=(y-top)/max(1,bottom-top);x=w*(.43+.96*u)
                for s in (-1,1):
                    q.cell(path([(centre+s*x,y-18),(centre+s*x+15,y),
                                 (centre+s*x,y+18),(centre+s*x-15,y)]),'#81705b',1.5)
    with p.layer(depth):p.cached(('world.carpet',top,bottom,centre,width,colour),static)


def lamp(p,t,x,y,scale=1,depth=.7):
    """Oil flame in a bowl; use only where appropriate, not electric fixtures."""
    with p.layer(depth),p.transform(translate=(x,y),scale=scale):
        p.cell(path([(-40,0),(-25,22),(25,22),(40,0)]),'#8b6944',2)
        p.cell(path([(-11,-1),(-22,-25,-7,-35,3,-64-4*math.sin(t*3)),
                     (4,-35,26,-22,12,-1)]),'#b9985e',2)


def pennant(p,t,x,y,w=85,h=170,colour='#6c3d3b',depth=.55):
    with p.layer(depth):
        lines(p,[[(x,y-20),(x,y+h+70)]],3)
        a=math.sin(t*1.8+x*.01)*9
        p.cell(path([(x,y),(x+w*.55,y-12+a,x+w,y+a),
                     (x+w-10,y+h*.55+a),(x+w,y+h+a),(x+w*.45,y+h-12,x,y+h)]),colour,2)


def smoke(p,t,x,y,scale=1,depth=.6):
    with p.layer(depth),p.transform(translate=(x,y),scale=scale):
        for i in range(3):
            phase=(t*.15+i/3)%1
            dx=15*math.sin(phase*4+i)
            # Deterministic moving wisps, not stochastic frame noise.
            lines(p,[[(dx,-phase*170),(dx-25,-phase*170-25,dx+24,-phase*170-48,dx,-phase*170-65)]],2)


def person(p,t,x,y,h=180,dress='punjab',role='attendant',variant=0,depth=.65):
    """Supporting silhouettes, NOT protagonist rigs or universal period dress.

    punjab: wrapped turban/long jama; victorian: coat/top hat or full skirt/bonnet;
    sahel: wrapped headcloth/long robe; south_india: dhoti/headcloth.
    Override or draw your own when these silhouettes do not fit the evidence.
    """
    _check(dress,('punjab','victorian','sahel','south_india'))
    bob=1.4*math.sin(t*1.2+variant*1.7+x*.01)
    lean=1.3*math.sin(t*.7+variant)
    robe=('#415650','#5c4549','#56546a')[variant%3]
    skin='#94745b'
    with p.layer(depth),p.transform(translate=(x,y+bob),scale=h/220,rotate=lean,pivot=(0,0)):
        p.cell(ellipse(0,3,43,7),'#253330',1)
        p.cell(path([(-22,-136),(-40,-117),(-47,-9),(47,-9),(39,-117),(22,-136)]),robe,2.5)
        p.cell(ellipse(0,-164,26,34),skin,2)
        if dress in ('punjab','sahel','south_india'):
            p.cell(path([(-32,-171),(-34,-211,30,-211,33,-175),(5,-180,-13,-173,-32,-171)]),
                   '#969182' if dress!='sahel' else '#4c5964',2)
            lines(p,[[(-25,-190),(0,-180,25,-199)]],1.7)
            if dress=='punjab':
                p.cell(path([(-20,-129),(-9,-132),(31,-10),(20,-10)]),'#726b57',1.5)
                if role=='guard':
                    lines(p,[[(54,-10),(54,-211)]],3)
                    p.cell(path([(54,-232),(46,-210),(61,-210)]),'#82928d',2)
            elif dress=='south_india':
                p.cell(path([(-39,-72),(39,-72),(46,-12),(-43,-12)]),'#aaa08a',2)
                lines(p,[[(-20,-68),(0,-12),(12,-67)]],1.5)
        elif variant%3!=1:
            p.cell(rect(-28,-218,56,40,3),'#292e34',2);p.cell(rect(-39,-184,78,8,2),'#292e34',2)
            lines(p,[[(-19,-127),(0,-95),(17,-129)]],2)
        else:
            p.cell(path([(-45,-12),(-29,-86),(30,-86),(58,-12)]),robe,2)
            p.cell(path([(-31,-150),(-44,-207,40,-208,32,-150),(18,-157),(22,-183,-18,-187,-18,-152)]),'#8f9086',2)
        # A riveted arm shifts independently of the head.
        with p.transform(rotate=4*math.sin(t*.9+variant),pivot=(28,-114)):
            p.cell(rect(24,-117,14,68,6),robe,2);p.rivet(30,-110,4)
            p.cell(ellipse(31,-46,8,10),skin,1.5)
        p.cell(ellipse(-8,-163,3,4),'onyx',1)
        p.cell(ellipse(9,-163,3,4),'onyx',1)


def crowd(p,t,fmt,positions=None,dress='punjab',h=180,depth=.65,role='attendant'):
    if positions is None:positions=[(-160,810),(80,850),(940,850),(1220,810)]
    for i,pos in enumerate(positions):
        x,y=pos[:2];height=pos[2] if len(pos)>2 else h
        person(p,t,x,y,height,dress,role,i,depth)
    return {'people':positions}


def court(p,t,fmt,style='sikh',floor_y=760,depth=.45,lamps=True):
    """Arcaded hall + floor + carpet. Add throne(), crowd(), actors separately."""
    _check(style,('sikh','mughal','round'))
    wall,column,opening,profile={
        'sikh':('#344a4b','#929486','#1f343b','cusped'),
        'mughal':('#634b49','#997762','#283e43','cusped'),
        'round':('#353f52','#788084','#212e41','round')}[style]
    def static(q):
        q.cell(rect(*BOUNDS),wall,1)
        # Repeated distant bays continue beyond both crops; centre deliberately
        # unpatterned behind the face, decorated spandrels stay above it.
        for x in (-460,540,1540):
            outer=archway(x,floor_y,910,1140,profile)
            q.cell(outer,column,3)
            q.cell(archway(x,floor_y,798,1035,profile),opening,2.2)
            for s in (-1,1):
                xx=x+s*440
                q.cell(rect(xx-23,-210,46,floor_y+210,11),column,2.5)
                q.cell(rect(xx-43,floor_y-33,86,33,5),column,2)
                q.cell(rect(xx-42,-217,84,30,4),column,2)
            # Low blind panels read as wainscot even in a close view.
            for xx in (x-310,x+225):
                q.cell(rect(xx,floor_y-275,85,213,7),wall,1.5)
                lines(q,[[(xx+14,floor_y-85),(xx+43,floor_y-200),(xx+72,floor_y-85)]],1.4)
        q.cell(rect(-900,-400,2900,85),wall,2)
        for x in range(-780,2000,145):
            q.cell(path([(x,-370),(x+30,-395),(x+60,-370),(x+30,-347)]),column,1.6)
        if style=='sikh':
            # A shawl valance, distinct from the Mughal red-stone vocabulary.
            q.cell(path([(-900,-285),(2000,-285),(2000,-185),
                         (1200,-130,850,-200,540,-165),(200,-150,-300,-220,-900,-160)]),'#613b43',3)
            lines(q,[[(-900,-237),(0,-172,1000,-231,2000,-217)]],3)
    with p.layer(depth):p.cached(('world.court',style,floor_y),static)
    floor(p,fmt,'stone',floor_y,colour='#3e5050')
    carpet(p,fmt,top=floor_y+25,width=720,colour='#59313b')
    if lamps:
        for x in (87,993):lamp(p,t,x,floor_y-370,.8,depth)
    return {'throne':(540,floor_y+105),'attendants':[(135,floor_y+85),(945,floor_y+85)],
            'floor':(540,floor_y+220)}


def throne(p,x,y,w=430,h=470,style='sikh',depth=1.):
    _check(style,('sikh','round'))
    def static(q):
        # Portable octagonal bowl form for Sikh court, not a European high back.
        if style=='sikh':
            q.gold(path([(x-w*.5,y-h*.40),(x-w*.35,y-h*.55),(x+w*.35,y-h*.55),
                         (x+w*.5,y-h*.40),(x+w*.43,y-h*.08),(x-w*.43,y-h*.08)]),.45,'hammered')
            q.cell(ellipse(x,y-h*.40,w*.43,h*.13),'#6e4244',3)
            for xx in (-.42,-.28,.28,.42):
                q.gold(rect(x+w*xx-9,y-h*.13,18,h*.13,5),.55)
            for s in (-1,1):q.wire(ellipse(x+s*w*.51,y-h*.2,24,13),4)
            lines(q,[[(x-w*.39,y-h*.3),(x-w*.25,y-h*.17),(x,y-h*.22),
                      (x+w*.25,y-h*.17),(x+w*.39,y-h*.3)]],3)
        else:
            q.cell(archway(x,y,w,h,'round'),'#40314f',5)
            q.cell(rect(x-w*.6,y-100,w*1.2,100,12),'#614352',5)
        q.cell(rect(x-w*.68,y+3,w*1.36,33,4),'#687372',3)
    with p.layer(depth):p.cached(('world.throne',x,y,w,h,style),static)


def exhibition(p,t,fmt,floor_y=760,depth=.38):
    """Victorian iron-and-glass hall. The actual display belongs to the shot."""
    def static(q):
        q.cell(rect(*BOUNDS),'#526671',1)
        # A deep central aisle: nested frames and convergent galleries.
        for j,s in enumerate((1.75,1.25,.88,.60,.39)):
            left=540-630*s;right=540+630*s;top=450-650*s;bottom=floor_y
            q.cell(rect(left,top,right-left,bottom-top),'#485c64' if j%2 else '#617780',2)
            # Barrel transept roof: broad arcs and glass divisions.
            lines(q,[[(left,bottom),(left,top+140),
                      (left,top-70, right,top-70, right,top+140),(right,bottom)],
                     [(left,top+230),(right,top+230)],[(left,top+380),(right,top+380)]],5 if j<2 else 2.5)
            for k in range(1,8):
                x=left+(right-left)*k/8
                lines(q,[[(x,top+70),(x,bottom)]],1.5)
        for side in (-1,1):
            for j,x in enumerate((90,350,740)):
                xx=540+side*x
                q.cell(rect(xx-11,-380,22,floor_y+380),'#32464e',2)
                q.cell(rect(xx-24,floor_y-33,48,33,3),'#32464e',2)
            lines(q,[[(540+side*170,600),(540+side*1450,150)],
                     [(540+side*170,638),(540+side*1450,450)]],5)
        # Exhibits on side counters; recognisable occupation at the edges.
        for x in (-340,70,940,1350):
            q.cell(rect(x-80,floor_y-145,160,145,5),'#504755',3)
            q.cell(rect(x-92,floor_y-157,184,17,3),'#8b8980',2)
            q.cell(ellipse(x,floor_y-203,38,46),'#647d7d',2)
            q.cell(rect(x-16,floor_y-270,32,34,6),'#647d7d',1.5)
    with p.layer(depth):p.cached(('world.exhibition',floor_y),static)
    floor(p,fmt,'boards',floor_y,colour='#504742')
    return {'display':(540,floor_y+100),'visitors':[(180,floor_y+120),(900,floor_y+120)]}


def workshop(p,t,fmt,floor_y=820,depth=.4,smoking=False):
    """19th-century bench room; window, cupboards, tools, continuous board floor.

    Machine and worker are shot-specific; no generic wheel masquerading as a
    horizontal diamond-polishing lap. smoking=False: sparks are not smoke.
    """
    def static(q):
        q.cell(rect(*BOUNDS),'#423e3d',1)
        # Plaster above wainscot, with the sash at left behind the worker.
        q.cell(rect(-900,580,2900,floor_y-580),'#333b3c',2)
        for x in range(-800,2100,125):q.cell(rect(x,603,99,floor_y-625,4),'#3e4341',1.4)
        q.cell(rect(50,-220,390,650,8),'#857b67',4)
        q.cell(rect(72,-195,346,602,4),'#728a8a',3)
        for x in (160,245,330):lines(q,[[(x,-190),(x,404)]],3)
        for y in (0,202):lines(q,[[(76,y),(413,y)]],4)
        q.cell(rect(30,426,430,34,4),'#797763',3)
        # Brick neighbouring roofs visible through the window.
        with q.clip(rect(77,175,334,226)):
            q.cell(path([(50,404),(50,312),(180,251),(290,320),(440,263),(440,404)]),'#4c5e61',1.4)
        q.cell(rect(655,-140,440,670,8),'#343334',3)
        for y in (-100,75,250,425):
            q.cell(rect(680,y+115,390,17,3),'#74614f',2)
            for i in range(5):
                xx=711+i*77
                q.cell(rect(xx-21,y+50-(i%2)*23,42,64+(i%2)*23,6),'#63716a' if i%2 else '#7b7160',2)
                q.cell(rect(xx-18,y+43-(i%2)*23,36,9,2),'#373a37',1.5)
        # Pegs, tongs and file silhouettes. Static tools stay off the main action.
        for x in (-190,-70,1180,1300):
            q.rivet(x,220,7)
            lines(q,[[(x,230),(x-16,340)],[(x,230),(x+16,340)]],5)
        q.cell(rect(-900,-315,2900,31),'#292f32',3)
        lines(q,[[(-180,-300),(-180,floor_y)],[(1220,-300),(1220,floor_y)]],5)
    with p.layer(depth):p.cached(('world.workshop',floor_y),static)
    floor(p,fmt,'boards',floor_y,colour='#4b3d33')
    if smoking:smoke(p,t,1250,440,.8,depth)
    return {'bench':(540,floor_y-130),'worker':(340,floor_y+50),'floor':(540,floor_y+180)}


def tent(p,t,fmt,floor_y=790,colour='#5a4146',depth=.4):
    def static(q):
        q.cell(rect(*BOUNDS),colour,1)
        for x in range(-900,2100,240):
            q.cell(path([(540,-510),(x,floor_y),(x+130,floor_y)]),'#4a3d45',1.6)
        q.cell(path([(540,-300),(210,floor_y),(870,floor_y)]),'#263e44',3)
        for x in (190,890):q.cell(rect(x-10,-420,20,floor_y+420,6),'#776650',3)
    with p.layer(depth):p.cached(('world.tent',floor_y,colour),static)
    floor(p,fmt,'earth',floor_y)
    carpet(p,fmt,top=floor_y,width=850,colour='#57454b')
    pennant(p,t,890,-150,65,140,depth=depth)
    return {'seat':(540,floor_y+100)}


def skyline(p,t,fmt,style='sahel',base=710,depth=.28):
    """Regional silhouettes to extend, not interchangeable 'ancient city' stamps."""
    _check(style,('sahel','punjab','south_india'))
    def static(q):
        for i,x in enumerate(range(-680,1860,220)):
            h=210+(i*83)%170;w=180
            if style=='sahel':
                q.cell(path([(x,base),(x+20,base-h),(x+w-20,base-h),(x+w,base)]),'#806651',2)
                if i%3==0:
                    q.cell(path([(x+30,base-h),(x+55,base-h-130),(x+78,base-h-162),
                                 (x+103,base-h-130),(x+130,base-h)]),'#8c7359',2)
                for y in range(base-h+30,base-40,65):
                    lines(q,[[(x+5,y),(x-13,y+3)],[(x+w-5,y),(x+w+13,y+3)]],3)
            elif style=='punjab':
                q.cell(rect(x,base-h,w,h),'#566566',2)
                q.cell(dome(x+w/2,base-h,w*.48,h*.30),'#6a7772',2)
                for xx in (x+17,x+w-17):
                    q.cell(rect(xx-9,base-h-80,18,82),'#6a7772',2)
            else:
                # Stepped, tapering gopuram with storeys rather than domes.
                q.cell(rect(x,base-135,w,135),'#677775',2)
                for j in range(5):
                    q.cell(rect(x+8+j*12,base-155-j*52,w-16-j*24,51,4),'#737c71',2)
                    for xx in (x+35+j*10,x+w-35-j*10):
                        q.cell(ellipse(xx,base-132-j*52,7,12),'#435556',1)
                lines(q,[[(x+w/2,base-420),(x+w/2,base-390)]],4)
            for xx in (x+38,x+w-65):q.cell(archway(xx,base-35,30,69,'pointed'),'#344244',1.4)
    with p.layer(depth):p.cached(('world.skyline',style,base),static)
    return {'street':(540,base+130)}


def wall(p,t,fmt,style='punjab',base=810,height=280,depth=.5):
    _check(style,('punjab','sahel','south_india'))
    tone={'punjab':'#705953','sahel':'#8c7359','south_india':'#64716b'}[style]
    def static(q):
        q.cell(crenel(-900,2000,base-height,base,43,35,30),tone,2.5)
        for x in (-200,380,1100,1700):
            q.cell(crenel(x-95,x+95,base-height-140,base,28,26,20),tone,3)
        gate=archway(650,base,190,235,'pointed' if style!='south_india' else 'round')
        q.cell(gate,'#293c3d',3)
        lines(q,[[(-900,base-75),(2000,base-75)],[(-900,base-150),(2000,base-150)]],1.4)
    with p.layer(depth):p.cached(('world.wall',style,base,height),static)
    pennant(p,t,380,base-height-250,65,90,depth=depth)
    return {'gate':(650,base)}


def market(p,t,fmt,positions=(-120,190,1000,1320),base=930,depth=.7):
    """Cloth awnings, baskets and stalls. Choose vendors/dress separately."""
    def static(q):
        for i,x in enumerate(positions):
            q.cell(rect(x-100,base-100,200,100,5),'#5c5447',2)
            for s in (-1,1):q.cell(rect(x+s*103-5,base-325,10,325),'#746a53',2)
            for j in range(4):
                q.cell(path([(x-120+j*60,base-330),(x-60+j*60,base-330),
                             (x-45+j*60,base-237),(x-120+j*60,base-237)]),
                       '#6e4144' if j%2 else '#9b8c6b',2)
            for dx in (-56,12,60):
                q.cell(ellipse(x+dx,base-108,23,13),'#88714a',2)
                for k in (-1,0,1):q.cell(ellipse(x+dx+k*9,base-125,8),'#9f8550',1)
    with p.layer(depth):p.cached(('world.market',tuple(positions),base),static)
    for x in positions:pennant(p,t,x+103,base-330,30,55,depth=depth)
    return {'vendors':[(x,base+20) for x in positions]}


def port(p,t,fmt,base=820,depth=.65):
    """Quay and moored late-sail-era boats; author the actual vessel for its date."""
    water(p,t,fmt,'sea',base-150,depth*.6)
    def static(q):
        q.cell(path([(-900,base),(2000,base),(2000,2000),(-900,2000)]),'#53615e',3)
        for x in range(-800,2000,180):q.cell(rect(x,base-15,100,28,4),'#7b7d6b',2)
    with p.layer(depth):p.cached(('world.quay',base),static)
    for i,x in enumerate((-100,1050,1600)):
        with p.layer(depth*.7),p.transform(translate=(x,base-60+4*math.sin(t+i))):
            p.cell(path([(-130,0),(130,0),(90,50),(-90,50)]),'#634944',3)
            lines(p,[[(0,0),(0,-235)]],4)
            p.cell(path([(-8,-223),(-115,-37),(-8,-37)]),'#949585',2)
    floor(p,fmt,'stone',base+70,depth=depth)
    return {'quay':(540,base+90)}
