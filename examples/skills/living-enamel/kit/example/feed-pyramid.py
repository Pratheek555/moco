"""18s feed layout study. Timings below are ESTIMATES, not generated narration.

Copy with feed-pyramid.json as story.py / script.json, prepare the real voice,
then cut words and restage against work/timeline.json. No audience result claimed.
Casing claim: National Museums Scotland, 'The pyramid casing stone'; Smarthistory,
'The Great Pyramids of Giza' (links in the matching script's sources).
Construction/removal choreography is illustrative, not an observed event.
"""
from gilt import Film, Shot, Hook, loop_return, estimate_clauses, rect, path, ellipse
from stories import world as W


def clamp(x):
    return max(0., min(1., x))


FACE = path([(16,1100),(540,385),(1064,1100)])


def place(p, t, c):
    W.sky(p,t,c.format,mode='bright',birds=False)
    p.cell(path([(-900,1040),(50,940),(540,975),(1080,920),(2000,1000),
                 (2000,2000),(-900,2000)]),'#f1cb80',2)
    W.floor(p,c.format,horizon=1100,vanish=(540,810),colour='#e2b774')
    # Low plateau ledge and continuous terrace locate the close subject at Giza.
    p.cell(rect(-900,1270,2900,120),'#d6aa64',2)
    for x in (-120,220,880,1190):
        p.cell(rect(x,1170,190,65),'#edce90',2)


def pyramid(p, white=.5):
    p.cell(FACE,'#bd8750',6)
    with p.clip(FACE):
        for y in range(365,1100,62):
            p.wire(path([(-30,y),(1120,y)],False),2)
            for x in range(-80+(y//62%2)*85,1200,170):
                p.wire(path([(x,y),(x,y+62)],False),2)
        # A broad reveal changes the famous subject itself from frame zero.
        with p.clip(rect(1080*(1-white),300,1200,830)):
            p.cell(FACE,'#fffdf1',6)
            for y in range(350,1100,150):
                p.wire(path([(-30,y),(1120,y)],False),1.5)


def opening_picture(p, t, c):
    p.time=t  # Return the travelling light along with geometry and clouds.
    place(p,t,c)
    pyramid(p,clamp(.5+.12*t))
    # Large angled casing block slides along the continuous working terrace.
    x=125+80*t
    p.cell(path([(x,1085),(x+170,1085),(x+130,897),(x+55,922)]),'#fffdf1',5)
    p.cell(path([(x+170,1085),(x+205,1055),(x+164,882),(x+130,897)]),'#d4e4e8',4)


def hook(p,t,c):
    opening_picture(p,t,c)
    p.ambience(0,'desert',c.shot.end-c.shot.start,.3)
    p.sound(0,'grind',.4)


def casing(p,t,c):
    # New thought: close masonry, a sizeable block travelling into its course.
    place(p,t,c)
    with p.transform(scale=1.45,pivot=(540,1000)):
        pyramid(p,1)
        x=140+100*t
        # An illustrative casing panel crosses a high course, clear of captions.
        p.cell(rect(x,650,290,225),'#fffdf1',5)
    p.ambience(0,'desert',c.shot.end-c.shot.start,.3)
    for at in (0,1.1,2.2):p.sound(at,'grind',.35)


def lost(p,t,c):
    place(p,t,c)
    # Editorial time passage, not one catastrophic stripping event.
    pyramid(p,1-clamp(t/max(.1,c.shot.end-c.shot.start)))
    p.ambience(0,'desert',c.shot.end-c.shot.start,.3)
    for at in (0,.8,1.6,2.4,3.2):p.sound(at,'wind',.2)


def base(p,t,c):
    place(p,t,c)
    with p.transform(scale=1.7,pivot=(540,1090),translate=(-110-35*t,0)):
        pyramid(p,0)
        for x in (330,520,710):p.cell(rect(x,1020,175,80),'#fffdf1',4)
    # An illustrative visitor's large sleeve/hand traces a surviving stone.
    x=270+110*t
    p.cell(path([(x-150,1150),(x,1005),(x+46,1050),(x-80,1220)]),'turquoise',4)
    p.cell(ellipse(x+30,1020,52,25),'sand',3)
    p.ambience(0,'desert',c.shot.end-c.shot.start,.3)
    for at in (0,1.2,2.4):p.sound(at,'cloth',.3)


def replay(p,t,c):
    absolute=c.shot.start+t
    phase=loop_return(absolute,c.shot.end,span=c.shot.end-c.shot.start)
    opening_picture(p,phase if phase is not None else -t,c)
    p.ambience(0,'desert',c.shot.end-c.shot.start,.3)
    for at in (0,1.1,2.2):p.sound(at,'grind',.35)


def clause(text,start,end):
    return estimate_clauses(text,start,end-start)


film=Film([
    Shot('hook',0,2.1,hook,clause('The Great Pyramid was once white.',.04,1.8)),
    Shot('casing',2.1,6,casing,clause('Smooth limestone covered its rough stone core.',2.12,5.8)),
    Shot('lost',6,10,lost,clause('This outer layer disappeared over many years.',6.12,9.7)),
    Shot('base',10,14,base,clause('Some original casing still survives at the base.',10.1,13.8)),
    Shot('replay',14,18,replay,clause('Picture that ancient skyline, and remember:',14.1,17.92)),
],hook=Hook(('THE GREAT','PYRAMID','WAS WHITE')))
