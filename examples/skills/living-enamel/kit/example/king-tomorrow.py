import math
from gilt import Film, Shot, tick, ellipse, rect, path
from gilt.cast import bust
from stories import pilot_sets as S
from stories import world as W

def clock(p,x,y,r,angle=0,face='ivory', reaction=0):
    p.cell(ellipse(x,y,r), 'onyx',wire_w=9)
    p.cell(ellipse(x,y,r*.87),face,wire_w=7)
    for i in range(12):
        a=math.pi*2*i/12-math.pi/2
        p.cabochon(x+math.cos(a)*r*.72,y+math.sin(a)*r*.72,7,'oxblood')
    for a,l,w in [(angle-math.pi/2,.55,10),(angle/12-math.pi/2,.35,13)]:
        p.wire(path([(x,y),(x+math.cos(a)*r*l,y+math.sin(a)*r*l)],False),w)
    # A broad mechanical hand makes Time's response readable on a phone.
    with p.transform(rotate=math.degrees(angle),pivot=(x,y)):
        p.cell(path([(x-17,y+22),(x-22,y-r*.52),(x,y-r*.72),
                     (x+22,y-r*.52),(x+17,y+22)]),'oxblood',4)
    p.rivet(x,y,13)
    if reaction > .1:
        p.cabochon(x-r*.36,y-r*.25,19,'onyx')
        p.cabochon(x+r*.36,y-r*.25,19,'onyx')
        p.wire(path([(x-r*.23,y+r*.35),(x,y+r*(.35+.14*reaction),x+r*.23,y+r*.35)],False),8)

def bg(p,t,c):
    p.ambience(0,'hall',c.shot.end-c.shot.start,.3)
    # Contact phrases accompany the visibly advancing clock joint throughout
    # each shot. These are not ticks under a stationary clock hand.
    for i in range(math.ceil(c.shot.end-c.shot.start)):
        p.sound(i,'creak',.18)
    # Original fable, not a claim about an actual historical court. Repeat the
    # hall cues across cuts; change the subject, not an abstract fill.
    W.court(p,t,c.format,style='round',floor_y=760)
    W.crowd(p,t,c.format,positions=[(-120,850,220),(110,860,160),
                                   (980,860,160),(1210,850,220)],dress='victorian')
    # A treasury counter carries coins and paper; floor and runner continue
    # below the captions instead of ending in a floating blue strip.
    with p.layer(.95):
        p.cell(rect(-420,940,1920,85,8),'#655747',wire_w=4)
        p.cell(rect(-420,1025,1920,78,4),'#3b4447',wire_w=3)
        for x in (-260,140,940,1340):
            p.cell(rect(x,1103,34,540,5),'#56605b',wire_w=3)

def king_art(p,t,c):
    wide=c.format.name=='landscape'
    offer=min(1.,(t+.25)/(c.shot.end-c.shot.start))  # Risk, then possession: one continuous offer.
    u=tick(t-c.cue(1))
    bust(p,'scheming' if u<.3 else 'triumphant',scale=.65 if wide else .6,at=(80 if wide else 300,350),head_tilt=-7*u,hands='raised' if u>.3 else None,halo_hidden=True)
    clock(p,1060 if wide else 800,275,190 if wide else 170,angle=t*.3)
    S.coin(p,260+500*offer if wide else 370+300*offer,(720 if wide else 800)-160*offer,290 if wide else 240,spin=.08*offer)
    p.sound(.08,'cloth',.25)
    p.sound(c.cue(1),'cloth',.3)
    p.sound(c.shot.end-c.shot.start-.25,'clink',.45)

def offer_art(p,t,c):
    u=tick(t-c.cue(1))
    insist=max(0,t-c.cue(1))
    nod=12*math.sin(insist*3)*min(1,insist*3)
    bust(p,'scheming' if u<.2 else 'triumphant',scale=.58,at=(350,600),head_tilt=7*u+nod,halo_hidden=True)
    clock(p,740,390,225,angle=t*.25,reaction=max(0,min(1,u)))
    for i in range(4):
        v=tick(t-c.cue(0)-i*.85)
        S.coin(p,460+i*85,840-(80+40*i)*v,55,spin=0)
    # The entire treasury arrives throughout its thought, not in a half-second
    # burst followed by a finished coin stack and an unacted tail.
    spacing=max(.25,(c.shot.end-c.shot.start-c.cue(1)-.3)/8)
    for i in range(8):
        at=c.cue(1)+.18+i*spacing
        fall=max(0,min(1,(t-at+.38)/.38))
        if t>=at-.38:
            S.coin(p,650+(i%3)*85,830-(i//3)*100-300*(1-fall)**2,65,spin=.08*(1-fall))
        p.sound(at,'clink',.35)
    p.sound(c.cue(0),'clink',.7)
    for i in range(1,4): p.sound(c.cue(0)+i*.85,'clink',.35)
    p.sound(c.cue(1),'cloth',.3)

def deal_art(p,t,c):
    u=tick(t-c.cue(0)); v=tick(t-c.cue(1))
    bust(p,'triumphant' if v<.2 else 'shocked',scale=.62,at=(350,600),head_tilt=-8*v,halo_hidden=True,hands='raised')
    clock(p,740,410,220,angle=t*.4,reaction=max(0,min(1,u)))
    p.cell(rect(550,690-70*u,410,130,20),'ivory',wire_w=8)
    p.text('TOMORROW',755,770-70*u,size=43)
    transfer=max(0,min(1,(t-c.cue(0))/(c.cue(1)-c.cue(0))))
    if transfer<.95: S.coin(p,530+240*transfer,650-240*transfer,65*(1-.5*transfer),spin=0)
    p.sound(c.cue(0),'paper',.5)  # The written deal rises into view.
    p.sound(c.cue(1),'cloth',.3)
    p.sound(c.cue(1),'clink',.35)

def payoff_art(p,t,c):
    u=tick(t-c.cue(0)); v=tick(t-c.cue(1))
    # The king keeps protesting while Time feeds the delayed refund back to
    # him. A completed plaque plus a sweeping clock hand left a six-second hold.
    protest=max(0,t-c.cue(1))
    shake=14*math.sin(protest*3)*min(1,protest*3)
    bust(p,'shocked' if v<.2 else 'pained',scale=.64,at=(350,600),head_tilt=-8*u+12*v+shake,halo_hidden=True,hands='cheeks')
    clock(p,740,410,220,angle=t*.35)
    if t>c.cue(0)+1.1: p.plaque('TODAY',785,720,'lapis',size=55,width=390)
    refund=max(0,min(1,(t-c.cue(1))/max(.5,c.shot.end-c.shot.start-c.cue(1))))
    if refund>0:
        with p.transform(translate=(780-250*refund,650+205*refund),scale=.35+.65*refund):
            p.cell(rect(-420,-70,840,140,16),'ivory',6)
            p.text('REFUND: TOMORROW',0,20,size=53)
    p.sound(c.cue(0)+1.1,'stamp',.45)  # TODAY plaque appears.
    p.sound(c.cue(1),'paper',.4)
    p.sound(c.cue(1)+(c.shot.end-c.shot.start-c.cue(1))*.55,'paper',.3)
    for i in range(math.ceil(max(0,c.shot.end-c.shot.start-c.cue(1))/1.0472)):
        p.sound(c.cue(1)+i*1.0472,'cloth',.2)  # The protest's garment contact.
    p.sound(c.cue(0),'cloth',.3); p.sound(c.cue(1),'cloth',.3)

def compose(p,t,c,art):
    bg(p,t,c)
    if c.format.name=='portrait':
        with p.transform(translate=(0,-70),scale=1.0,pivot=(540,540)):
            art(p,t,c)
    else:
        with p.transform(translate=(0,-20),scale=1.20,pivot=(540,540)):
            art(p,t,c)
    p.border()

def king(p,t,c):
    bg(p,t,c)
    king_art(p,t,c)
    p.border()
def offer(p,t,c): compose(p,t,c,offer_art)
def deal(p,t,c): compose(p,t,c,deal_art)
def payoff(p,t,c): compose(p,t,c,payoff_art)

film=Film([Shot('king',0,7,king),Shot('offer',7,14,offer),Shot('deal',14,21,deal),Shot('payoff',21,30,payoff)])

