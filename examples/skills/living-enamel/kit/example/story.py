"""Complete small material example; use a new story for production requests."""
from gilt import Film, Shot, Camera, estimate_clauses, tick
from gilt.cast import bust
from stories import world as W

def draw(p, t, ctx):
    # Fictional throne hall: columns, watching courtiers and a carpet locate
    # even this close composition. The cracking figure remains dominant.
    W.court(p,t,ctx.format,style='round',floor_y=720)
    W.throne(p,540,1000,w=700,h=1120,style='round',depth=.7)
    W.crowd(p,t,ctx.format,positions=[(100,870,190),(970,870,190)],dress='victorian')
    duration = ctx.shot.end-ctx.shot.start
    change = min(1., (t + 1.) / (duration + 1.))  # Fracture and slipping continue through both thoughts.
    flinch = tick(t - ctx.cue(1))
    bust(p, 'shocked' if flinch > .1 else 'smug',
         scale=1.12 if ctx.format.name == 'portrait' else 1.,
         at=(540, 420 if ctx.format.name == 'portrait' else 500),
         head_tilt=-28*change, crown_offset=(230*change, 200*change),
         crown_tilt=65*change, halo_tilt=16*flinch, cracks=change)
    p.border()
    p.ambience(0, 'hall', duration, .3)
    for at in (1.1, duration*.30, duration*.46, duration*.63, duration*.79):
        p.sound(at, 'crack', .35)  # Successive growth of the visible fracture.
    p.sound(.1, 'cloth', .2)
    p.sound(ctx.cue(1), 'cloth', .3)  # The bust flinches; the crown never lands.
    p.sound(duration*.82, 'creak', .2)  # The slipping crown strains its joint.

film = Film([Shot('material', 0, 7, draw,
    estimate_clauses('The king was cracking under his own crown. | All that gold could not hold him together.', 0, 7),
    camera=lambda t: Camera(zoom=1 + .002 * t))])
