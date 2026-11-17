# Living Enamel sets and world pieces

Code: `stories/pilot_sets.py` in the working kit. The original pilot test artifacts are not bundled.
For new places, start with `from stories import world as W` and read
[Build a place](worlds.md). It supplies layered sky/light, landscapes/water,
regional skylines/walls, markets/ports, court/workshop/exhibition/tent interiors,
floors and restrained supporting crowds. Compose these and custom drawing from
historical references; a style name is not evidence of an accurate reconstruction.
The pilot functions below remain available unchanged, including coins and cages.
Large pilot set functions follow `name(p, t, fmt, **params) -> dict of anchors`; props and smaller helpers have the signatures listed below. `p` is a gilt Painter, `t` is local
seconds (used only for ambient life: flags, waves, flicker, chariots, rotating sun rays), `fmt` is a `gilt.Format`.

```python
from stories import pilot_sets as S
```

## Conventions

- **Pure functions.** Same arguments, same pixels (checked: byte-identical albedo/material surfaces on repeat calls,
  both formats, extreme parameter values). Variety comes from an integer hash, never from random numbers.
- **Union area.** Scenery is drawn across the whole union (x -420..1500, y -300..1620), so backgrounds cover both crops; this does not establish good framing in either.
  `fmt` is used to skip off-screen detail and, for the map, to place the border band on the format edge.
  Essential things sit inside the 1080 core. Keep portrait action clear of the default two-line caption clearance y=920..1210, keep that field quiet behind the text, and continue floors/land/water through the bottom (y > 1210). Do not leave it as an empty ornamental ground.
- **Ground.** City, walls, aqueduct, hippodrome and names_scroll take `ground=True` and draw their own ground first
  (turquoise scroll, night, night, oxblood scroll, oxblood scroll). Pass `ground=False` if you drew it yourself. The map covers
  everything with land and sea and has no ground. `spears` draws no ground: call it after the bust.
- **Progress parameters** are 0..1 floats and are clamped (except `cage drop` and `spears advance`, which may
  overshoot, so you can feed them `ctx.pose(...)` / `tick()`). `names_scroll` `struck` and `unroll` are counts.
- **Anchors** are stage coordinates. Figure anchors are the *feet centre* (y = floor line). Heights are the figure
  height the set was drawn for.
- **No words.** Sets draw no text at all; plaques are the choreographer's (plaque anchors are returned). An anchor is an available position, not a request to add an opening title or date.
- Palette per set stays at 5-6 enamels plus gold (map adds one custom hex, `#6e8a2c` "moss", as the brief asked).
- Cost on this machine, after warm-up, per frame at full size: draw 0.2-0.5 s (hippodrome 0.7-1.0 s), plus about 1 s of
  engine shading.

## Opening staging

The default anchors and figure heights below support wide explanatory scenes, not ready-made feed openings. Start with a close view of the consequential interaction, such as a coin leaving a hand or a cage descending over its captive, and reveal the larger set once the stake is clear. Enlarge the artwork with its interacting props, keeping captions outside that transform, and check each requested format. Do not retain a wide layout just because the set fills the frame; the important action can still be tiny.

Passing `t` to a set supplies ambient motion, not necessarily story progress. For an opening, drive the relevant progress or position from local time so the action is already under way on frame one; reserve later clause cues for subsequent beats. Flags, waves, flicker and a bobbing ship at a fixed route position do not establish a crossing or conflict. Night sets can work if the acting subject separates clearly from the ground at phone size. Follow [Hold the opening](../SKILL.md#hold-the-opening) and its separate opening-sheet and motion checks.

## 1. `city(p, t, fmt, crack=0., flags=1., ground=True)`  (s3, turquoise scroll)

Constantinople: gold sun-mandorla with ivory petals behind a great lapis dome with two half-domes, buttress towers,
chapels continuing off both sides, a tall palace pavilion at right of centre with a lapis alcove, a broad balcony slab,
a battlemented sea wall with six towers and a gold-doored gate, cypresses, birds, flags, an ivory quay street, and below
it (portrait) a harbour with a Greek-key band, ships and dolphins.

| param | meaning |
|---|---|
| `crack` | 0..1, a dark fissure (with branches and fine craquelure) runs up the balcony from the foundation. |
| `flags` | 0..1 amplitude of the ambient flags. |
| `ground` | draw the turquoise scroll first. |

Anchors: `balcony=(795, 505)` feet centre for the 300-unit emperor; `balcony_h=300`; `general=(655, 505)` and
`general_h=200` on the same terrace, left of him; `cage_size=(140, 250)`; `citizens` = six feet centres
`(165..915 step 150, 1030)` and `citizen_h=170`; `plaque=(390, 92)` for "CONSTANTINOPLE"; `crack_top=(800, 410)`;
`palace_alcove=(795, 330)`.

The palace parapet is behind the figures (no front rail). Coins should be popped from `citizens` heads (y about 860)
toward `balcony`.

### `coin(p, x, y, r, spin=0.)`
Raised gold coin. Front shows a crowned emperor head and shoulders, back shows a cross. `spin` is in **turns**:
the width is `|cos(2*pi*spin)|` (minimum 9 %), so 0 = front, .25 = edge-on, .5 = cross face. Feed `spin=k*t` for a flip.
Returns `{pos, r}`. The engine's hammered plate brightens and darkens with screen position, so a flying coin shimmers.

### `cage(p, x, y, w, h, drop=1.)`
Gold wire cage (rings, bars, domed top, ring handle, oxblood gems on the base ring) with feet at `(x, y)`. `drop` 0 = hanging
`h+320` above its landing place, 1 = landed. It is not clamped: `ctx.pose(t, 3, 0, 1)` overshoots to about 1.08 and
the cage sinks a few units and settles, which reads as the clank. Drawn entirely in front of the figure (it is transparent).

This later-shot fragment demonstrates narration-cued changes in the wide city view. Its small coin and delayed cage drop are not an opening composition.

```python
a = S.city(p, t, ctx.format, crack=ctx.pose(t, 3, 0, 1))
S.cage(p, *a['general'], *a['cage_size'], drop=ctx.pose(t, 1, 0, 1))
S.coin(p, 400, 700 - 300 * u, 24, spin=3 * t)
```

## 2. `black_sea_map(p, t, fmt, route_out=0., route_back=0., ship=None, ship_route='out', crown_x=None, army=0.)`  (s4, s5)

Lapis Black Sea with Azov and the Kerch strait as one cell, built from real longitude/latitude coastlines
(slightly stretched north-south, about 1.05x). Lands are separate cells: jade (Bulgar lands, west), sand
(Byzantine: Thrace, Anatolia and the Crimean peninsula), moss (steppe, Caucasus). Crimea hangs from the north
coast through a narrow isthmus, Cherson is its south-west tip, Constantinople is on the Bosporus at lower left
with Marmara and the Dardanelles, the Danube, Dnieper, Dniester, Don and Anatolian rivers are lapis ribbons,
mountains and town icons dress the lands, portolan rhumb lines fan across the sea, and a compass rose and a
graduated ivory-and-oxblood border band follow the format edge.

| param | meaning |
|---|---|
| `route_out` | 0..1, dashed gold route wire-draws Constantinople -> Cherson across the sea (ivory beaded dashes with gold edges, spark at the tip). |
| `route_back` | 0..1, route wire-draws Cherson -> north over Crimea's isthmus -> the north coast -> Danube and Bulgar lands -> south along the west coast -> Constantinople (an all-land route, so the army can march it). |
| `ship` | None = no ship. 0..1 = position along the route chosen by `ship_route` (`'out'` default, or `'back'`); the ship bobs and mirrors itself with its heading. |
| `crown_x` | None = no crown icon. 0 = crown medallion above the city. 0..1 = a big gold X slams in (shrinks from 2.5x to 1x in the first 30 %). |
| `army` | 0..1, a row of 8 jade-helmet spear markers (40 units apart) emerges from Cherson and marches the return route; at 1 the column head is at the city. |

Anchors: `city=(232, 800)` pearl cabochon centre; `cherson=(526, 486)` saffron cabochon; `bulgar` (about (140, 602),
Bulgar land); `plaque_cherson=(650, 590)`; `plaque_year=(760, 700)`; `compass`; `ship_pos`; `army_head`;
`crown`; `route_out_pts`, `route_back_pts` (polylines, e.g. to fly the tiny nose off the city marker).

For a map-led opening, frame the moving ship or column closely enough that its travel reads without labels, with its route already in progress; widen later to explain geography. The full map's small markers and decorative border are context, not the hook. Vary `ship` or `army` to produce travel; advancing `t` alone only animates ambient details. The following is a later explanatory shot, so it waits for clause cues and adds a place label after the hook, rather than demonstrating an opening.

```python
a = S.black_sea_map(p, t, ctx.format, crown_x=ctx.pose(t, 0, 0, 1), route_out=ctx.pose(t, 2, 0, 1), ship=ctx.pose(t, 2, 0, 1))
if t > ctx.cue(2) + 1: p.plaque('CHERSON', *a['plaque_cherson'])
```

## 3. `walls(p, t, fmt, bonk=0., ground=True)`  (s6 first half, night)

Triple Theodosian walls filling the frame: tall sand inner wall with big towers and flags, ivory middle wall,
sand outer wall with torches (flickering flames) and a gold-doored gate; oxblood brick bands; a moon cabochon
with rays and a bead halo; lapis night clouds; a jade ground strip; a moat below with the moon's reflection.

| param | meaning |
|---|---|
| `bonk` | 0..1, gold starburst with a pearl and two fissures at the impact point on the gate (glint in the first half). |

Anchors: `ground_line=(540, 1000)` feet y for the 200-unit figure; `impact=(540, 868)`; `sit=(700, 1000)`;
`moon=(700, 128)`; `gate=(540, 1000)`.

## 4. `aqueduct(p, t, fmt, traveller=0., ground=True)`  (s6 second half, night)

Two tiers of tall stone arches with running-bond stonework and voussoir rings; on top an onyx pipe (114 high) with slim gold flanges, sand
coping above it, ivory string courses; behind it a lapis hill with cypresses (left), the amethyst-and-lapis city
of domes (right), night clouds, the moon; through the arches a lapis hillside with village lights; below
ground, a cross-section of oxblood, sand and amethyst strata with pebbles.

| param | meaning |
|---|---|
| `traveller` | 0..1, a gold-plate nose with a pearl highlight and two eye glints inch left -> right inside the dark pipe, bobbing (y +-3, tilt +-2 deg). Only these are lit. |

Anchors: `pipe_entry=(70, 480)`, `pipe_exit=(1010, 480)`, `pipe_h=108`, `nose` (current position).

## 5. `hippodrome(p, t, fmt, speed=.1, ground=True)`  (s8 first half, oxblood scroll)

Concentric stands of sand and ivory tiers (twelve rings, radial aisles) carrying about 1,200 gem-cabochon spectators in portrait (fewer where the niche hides them) (Blues in lapis on the
left half, Greens in jade on the right, with saffron, coral, amethyst and oxblood accents); a sand racetrack oval; the
spina island with obelisk, serpent column, statue column, seven lap eggs, a lapis water channel with waves and
two turning posts; two chariots (blue and green team, two horses each) that loop the track, one passing behind
the spina objects and the other in front, and both vanishing behind the imperial niche on the near side;
in the foreground the imperial box: lapis lattice niche, ivory columns, oxblood valance, platform, and a facade of arches.

| param | meaning |
|---|---|
| `speed` | laps per second of the chariots (default .1 = a lap in 10 s); chariot position is a pure function of `t`. |

Anchors: `box_floor=(540, 902)`; `prone=[(395, 880), (685, 880)]` centres of two lying figures about 170 long and 44
thick; `necks=[(470, 862), (610, 862)]`; `emperor_feet=(540, 858)` (feet of the 380-unit figure, standing on the
prone figures; head top at about y 478, in front of the niche arch); `spina`, `track_centre`.

## 6. `names_scroll(p, t, fmt, unroll=0., struck=0., ground=True)`  (s8 second half)

Ivory sheet (700 x 862) between two gold rollers whose ratchet lines turn with the scroll, mounted on a lapis lattice
panel hung from cords, with a gold ring above, a hanging seal and tassels below, and (landscape) two gold floor
lamps with flickering flames. Each line is an invented gold-wire "name" (three words, eight squiggle glyph shapes, a
gem bullet and tally ticks at the right). Names are deterministic by line index: line `n` is always the same.

| param | meaning |
|---|---|
| `unroll` | scroll travel in **lines** (float). 0 shows lines 0..14; each +1 moves every line up by 56 units under the top roller and a new name arrives from below; unlimited. |
| `struck` | lines struck through, counted from line 0 (float). The fractional part is the strike currently wire-drawing: `struck=6.4` = six done, the seventh 40 % drawn. Strikes are bold 8.5-unit gold wires with a spark at the tip. `struck=14` with `unroll=0` strikes 14 visible lines. |

Anchors: `sheet=(190, 104, 890, 966)`, `line_h=56`, `lines=[(index, y, struck_fraction)]` for every visible line (to
time strikes against what is on screen), `top_roller_y=80`, `bottom_roller_y=990`.

```python
S.names_scroll(p, t, ctx.format, unroll=0.0 + 3 * t, struck=max(0, 12 * (t - ctx.cue(2))))
```

## 7. `spears(p, t, fmt, advance=1., aim=(540, 470), final=330)`  (s9)

Thirteen spears fan in from the left, top and right, 20 degrees apart, each pointing at `aim`. Pearl enamel leaf blade with a gold rim and midrib, gold
socket, oxblood pennon that flutters with `t`, lapis shaft with a diagonal gold ribbing and gold bands, running off the
frame. Blades are pearl and shafts lapis so they read against the gold ground.

| param | meaning |
|---|---|
| `advance` | 0 = every tip just outside the visible frame **of this format** (nothing shows); 1 = tips ring `aim` at distance `final` (+-34 variation), outside the bust halo. Values above 1 overshoot. |
| `aim`, `final` | convergence point and stand-off distance. |

Returns `aim` and `tips`. Call after drawing the bust. In portrait the side spears are mostly cropped away (only blades
show); the top spears carry the shot.

## Smaller shared helpers (public, reusable)

`cloud`, `cypress`, `flag`, `fissure(p, pts, progress, w)` (a dark hairline crack as a thin onyx slit, wire-draws along `pts`),
`compass(p, x, y, r, t)`, `stonework`, `lattice`, `scales`, `waves`, `arch`, `dome`, `crenel`, `spline`, `spline_pts`,
`multi` (many sub-paths in one path, much cheaper than many wire calls).

## Depth, life and the world check

Old pilot drawings use the ordinary camera plane by default. Wrap a whole set in
`with p.layer(.4):` to give it a distant camera response, or compose the new world
pieces at separate depths. Depth is absolute; helpers' own depths override an outer
layer. Keep actors and their contact surfaces together. Static custom architecture
can use `p.cached(key,draw_static)`; flags, waves and figures stay outside the cache.
See [worlds](worlds.md#parallax-and-caching) for the contracts and limits.

Normal `gilt sheet` marks bare-stage warnings and writes a sibling `.world.json`,
sampling every shot. A pilot set or ornament can pass without suiting the story.
Inspect where/when/who at full and phone size. A map can use a reasoned per-shot
`world_exception`; it remains listed as a waiver if the measurement warns.

## Limits and composition notes

These sets originated in the Justinian pilot and need composition for a new story. The map is hand-placed illustrative geography; hippodrome horses are schematic; spinning coins can turn dark; portrait crops show mostly the spear blades. Use a deliberate close view when a small gate, pipe traveller or army marker carries the story. Check the actual scene in both formats rather than relying on old pilot review.

`aqueduct(..., draw_traveller=False)` suppresses its built-in nose/eye group, allowing a new character or prop in the pipe. The default is `True`.
