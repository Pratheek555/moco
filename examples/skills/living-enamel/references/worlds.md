# Build a place in Living Enamel

Code: `stories/world.py`, imported as `from stories import world as W`.
These pieces are a vocabulary for a set designer, not a historical scene generator.
The [pilot sets](sets.md) remain compatible, including their props and anchors.

## Decide what belongs here

A shot should answer where, when and who else is present without needing its date
plaque. Before drawing historical scenery, find an architectural source, a period
image of people/dress and a source for the working objects that carry the action.
Prefer collections, conservation records and contemporary prints over an image
search's unidentified palace. Keep the links with the shot source and note what is
inferred. A surviving building may have later restorations; a later painting may
romanticize the court. Neither establishes the exact arrangement at an event.

Choose a few large distinguishing cues: Lahore's cusped marble bays and court
textiles, a Sahelian city's battered earthen walls and timber projections, a
Victorian hall's repeating iron/glass bays, a South Indian town's tapering stepped
gopuram. Do not combine these merely because they look ancient. The supplied
silhouettes are starting points. Draw your own roof, gateway, dress or machine when
the actual place differs; changing a palette cannot repair the wrong architecture.
Keep a fictional place explicitly fictional.

## Compose from the far layer forward

1. Put sky/light or the back wall behind the action. Far layers use broad cells and thin contours; a feed hook uses a bright,
   saturated sky, while other work keeps deep jewel-coloured scenery. Save the
   strongest subject contrast and thickest wire for the subject. Preserve saturated enamel in the place too. Depth is a
   value, scale and detail decision before it is a camera trick.
2. Add the middle distance: skyline, arcade, counters, quay or workshop cupboards.
   Return anchors are available feet/prop positions, not mandatory compositions.
3. Draw a continuous floor/land plane and a few supporting people where the story
   warrants them. Guards imply authority, visitors imply public access; an empty
   private room can instead show tools, a second stool or evidence of work.
4. Stage the important actor/prop at phone-readable size. Keep location cues at
   the sides or above a close face. A close shot still belongs to a room.
5. Add restrained near scenery, such as a cropped jamb, table edge or spectator.
   Continue scenery behind the two-line caption clearance y=920..1210 and
   down to portrait y=1620.
   Captions need a quiet field, not a blank lower third. Inspect landscape too
   when requested; the union background does not guarantee either composition.

```python
from gilt import Camera
from stories import world as W

def draw(p,t,c):
    a = W.court(p,t,c.format,style='sikh',floor_y=790)
    W.throne(p,*a['throne'],w=430,h=390,style='sikh')
    W.crowd(p,t,c.format,positions=[(120,875,190),(950,875,190)],
            dress='punjab',role='guard',depth=1.)
    # Draw the researched protagonist and their acted prop here.
    # Keep their action above the caption band, without shrinking the room.
    p.border()
    p.ambience(0, 'hall', c.shot.end-c.shot.start, .3)
    # Declare matching p.sound() cues for the protagonist's authored actions.

# On the Shot: camera=lambda t: Camera(centre=(540+8*t,540),zoom=1+.004*t)
# Still give the scene its consequential acting. Parallax is ambient support.
```

For an exterior, use `sky`, `landscape`, `skyline`, `wall`, then `floor`
or `water`, `market` and people. For a port use `sky`, `skyline`, `port`;
for an interior start with `court`, `workshop`, `exhibition` or `tent`.
Do not put an opaque interior after scenery you meant to see through it.
Interior helpers already supply their floor. Add the actual working props yourself.

## Pieces and parameters

Stage units throughout. Helpers return anchor dictionaries where useful; they
never write place labels. `p,t,fmt` are the first three arguments unless noted.
Defaults cover both formats with generous overscan; extreme camera moves still
need a coverage check. All time animation is deterministic, with no frame noise.

| Piece | Choices and useful parameters | Built-in life / anchors |
|---|---|---|
| `sky` | `mode='day'` / dusk / night / bright, `horizon=570, depth=.08, birds=True` | drifting clouds, flapping birds; horizon |
| `landscape` | `kind='hills'` / desert / plain, `horizon=580, depth=.25` | ground anchor; contours continue through the foot of frame |
| `water` | `kind='river'` / sea, `horizon=790, depth=.65` | moving wave strokes, bank anchor |
| `floor(p,fmt,...)` | `kind='stone'` / boards / earth, `horizon=700, vanish=(540,400), colour=None, depth=1.` | perspective seams, floor anchor |
| `carpet(p,fmt,...)` | `top=780, bottom=1900, centre=540, width=650, depth=1., colour='#522d38'` | broad runner with quiet centre |
| `court` | `style='sikh'` / mughal / round, `floor_y=760, depth=.45, lamps=True` | oil flames, floor + carpet; throne/attendant/floor anchors |
| `throne(p,x,y,...)` | `w=430,h=470,style='sikh'` / round, `depth=1.` | portable octagonal bowl or tall arched seat; no actor |
| `exhibition` | `floor_y=760,depth=.38` | iron/glass hall, side exhibits, board floor; display/visitor anchors |
| `workshop` | `floor_y=820,depth=.4,smoking=False` | sash window, shelves, tools, floor; bench/worker anchors. Machine is authored by the shot |
| `tent` | `floor_y=790,colour='#5a4146',depth=.4` | fabric panels, floor, carpet, fluttering pennant; seat anchor |
| `skyline` | `style='sahel'` / punjab / south_india, `base=710,depth=.28` | regional silhouettes; street anchor |
| `wall` | `style='punjab'` / sahel / south_india, `base=810,height=280,depth=.5` | towers, gateway, flag; gate anchor |
| `market` | `positions=(-120,190,1000,1320),base=930,depth=.7` | cloth awnings, baskets, pennants; vendor anchors |
| `port` | `base=820,depth=.65` | water, quay, moored sail boats, floor; quay anchor. Not a universal ship design |
| `crowd` | `positions=[(x,feet_y[,height]),...], dress='punjab',h=180,depth=.65,role='attendant'` | restrained independent head/body/arm shifts |
| `person(p,t,x,y,...)` | `h=180,dress='punjab',role='attendant',variant=0,depth=.65` | dress: punjab / victorian / sahel / south_india. Punjab guard adds spear |
| `lamp(p,t,x,y,...)` | `scale=1,depth=.7` | oil flame |
| `pennant(p,t,x,y,...)` | `w=85,h=170,colour='#6c3d3b',depth=.55` | fluttering cloth |
| `smoke(p,t,x,y,...)` | `scale=1,depth=.6` | rising wisps; only use with a real smoke source |

`archway(x,bottom,w,h,profile='cusped')` also accepts round/pointed and returns a
path for custom facades. `lines(p,segments,width=2)` batches wires. Pair these with
the public Painter cells/paths to extend a place instead of pasting a pilot city
into a different continent. The crowd is deliberately simplified; use a custom
rig for anyone who must act or be recognized. See [cast](cast.md).

## Bright feed sky

For a vertical feed hook, `W.sky(p,t,fmt,mode='bright',birds=False)` supplies a simple saturated blue sky with broad pale cloud shapes and no ornamental sun/bezel. It sets `p.no_vignette=True` and `p.bright_palette=True` for that frame: the material shader retains wire, domes and travelling light while lifting enamel and removing dark edges. Day/dusk/night keep their existing palettes and finish. These flags are per Painter, not persistent global exposure changes.

```python
W.sky(p, t, ctx.format, mode='bright', birds=False)
# Add the researched skyline/terrain, then a continuous floor and large subject.
W.floor(p, ctx.format, horizon=1100, colour='#e2b774')
```

This sky is a base, not a complete world or a world-check waiver. Build the actual location around the close subject, as in `example/feed-pyramid.py`. Keep caption clearance quiet but inhabited and continuous through the foot of the frame. Do not add a dark rim or `p.border()` at a feed hook. Other pieces may need authored bright colours to belong to this light; bright sky behind a dark interior does not automatically make the whole setting bright.

## Parallax and caching

`with p.layer(depth): ...` changes the strength of the shot camera: 0 is fixed
sky, .25 distant scenery, .6 middle distance, 1 the ordinary actor plane, values
up to 2 nearer scenery. These are compositional choices, not physical distances.
Depth interpolates camera pan, zoom and roll from identity. With a still camera
there is no parallax. Existing unlayered drawings keep their original camera.
Layer depth is absolute even inside another layer; transforms survive nesting.
Put the layer outside a clip, because a clip is fixed when entered.

Keep objects that touch at the same depth: a figure's feet, floor contact, chair
and props should not slide apart. You can override helper depths to make a
shared contact plane. Far arcades can respond less than a near floor, but check
their join under the actual move. Use restrained moves; overscan is finite.

`p.cached(('my-facade',width,roof_colour), draw_static)` records two unlit Skia
vector pictures, then replays them under the current camera and shader light.
Include every geometry/style argument in the key. No time-dependent shapes,
glints, layers or sound inside the callback. Use only static Painter drawing;
draw flags, flames, people and water afterwards. The bounded 32-entry cache is
per worker; no full-frame world buffers accumulate and no new dependency is used.
This saves Python drawing/geometry work, not the full-frame CPU shader.

## Read the bare-stage warning

Normal `gilt sheet` prints shot warnings, marks sheet labels and writes a sibling
`.world.json`. It checks **every shot**, even on an opening-only sheet. Run a
dedicated check with:

```text
<py> -m gilt world-check story.py --format portrait --out work/world.json
<py> -m gilt world-check story.py --format portrait --strict --out work/world.json
```

The warning uses quarter-scale **unlit albedo**, so lighting does not count as
scenery. It samples each shot at 20%, 50% and 80%, excludes the rim/caption field,
and measures the dominant enamel far from drawn boundaries. It also discounts
fine ornament/stars when looking for broad fields, using a 16-stage-unit closing
radius followed by 32-unit clearance. It warns when the raw flat share reaches
48% overall or 70% below portrait y=1240, or the ornament-discounted field reaches
48% overall or 55% of the upper 36.5% of the frame. The lower check uses raw
edges so real floor seams still count. Read the thresholds and per-sample
measurements in the JSON. Thresholds are repair signals, not aesthetic
targets: adding wire scribbles to pass is not world building.

By default this warns, preserving existing films. `--strict` fails on unwaived
warnings. An intentional exception belongs on that particular shot:

```python
Shot('route',0,3,draw_map,world_exception='Map: diagram of transfer, not a room')
Shot('facet',3,4,draw_macro,world_exception='Extreme close-up: facet fills the lens')
```

Exceptions retain the raw warning and the reason; they do not manufacture a
passing measurement. A real open desert/sea may also deserve one. A camera
cutaway or establishing view is not automatically an exception.
The check cannot recognize a court, regional accuracy, appropriate people,
depth, phone readability or meaningful movement. Dense ornament, textures or
several large abstract colour blocks can pass; three samples can miss an empty
interval. Inspect full-size stills and 270-pixel views even when it says OK.
