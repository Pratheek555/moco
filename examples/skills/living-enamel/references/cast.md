# Cast — LIVING ENAMEL

All rigs use only the public Painter API. Import from `gilt.cast`. Coordinates are stage units; rotations are clockwise degrees. No rig draws its own ground or border. All original `bust` arguments remain accepted in their original order. Geometry has changed: migrate old nose flight origins to the coordinates below.

## Opening staging

For a feed opening, use one dominant acting face or key prop rather than a pair of small full-body figures. Enlarge and reposition the bust with `scale` and `at`, or transform the artwork and its interacting props together; default rig sizes are not a guarantee of readable framing in either crop. Check the face, gesture and prop at phone size, with clear separation from the surroundings and room for captions. Keep quieter place cues around the close subject: columns, court textiles, workshop shelves or a landscape should still locate them.

For supporting people, `stories.world.person` / `crowd` provide small riveted
silhouettes with wrapped headcloth/robe, Victorian coat/bonnet, or dhoti starting
points, and independent restrained shifts. They are scenery, not substitutes for
the protagonist's acting. Research dress at the actual date and draw your own
when these options are wrong; the Byzantine emperor/citizen rigs are not universal
historical costumes. Match feet, seat and held props to their contact plane when
using `p.layer(depth)`. See [worlds](worlds.md).

Expression names select poses; they do not schedule a performance. Start the consequential gesture or prop action already under way at local time zero, then use narration cues for its reactions and later beats. The pearl-chain pendulum, glints and a static surprised face do not replace that action. See the [authoring opening example](authoring.md#scene-source) and the skill's [opening checks](../SKILL.md#hold-the-opening).

## Public functions

### `bust(p, expression='smug', ..., scale=1, at=(540,540))`

The anchor maps the old core point (540,540) to `at`; scaling happens around that anchor. Default face is roughly 520 wide, crown top y=110, robe bottom y=1080. Face centre is (540,500). The lower robe intentionally reaches the landscape crop. Portrait uses the same core; these untransformed defaults leave its caption band clear, but enlarged or moved rigs need a fresh clearance check.

| Parameter | Default | Meaning |
|---|---|---|
| `p` | required | Painter |
| `expression` | `'smug'` | Named face preset below |
| `nose_state` | `'present'` | `present`, `missing`, `gold` |
| `eye_look` | `(0,0)` | Eye translation in face-local units, clamped to ±15 x / ±10 y |
| `eyelid` | `None` | Preset override, 0 open / 1 shut; scalar or left/right pair |
| `brow_angles` | `None` | Pair of eyebrow rotations; overrides preset |
| `mouth` | `None` | Preset override: `smile`, `smirk`, `flat`, `frown`, `open` (alias `o`), `grin`, `grimace` |
| `head_tilt` | `0` | Rotates the head and crown about the lower face; halo stays independent |
| `halo_tilt` | `0` | Halo rotation; the asymmetric top lozenge makes rotation visible |
| `halo_offset` | `(0,0)` | Halo translation in bust-local units |
| `crown_offset` | `(0,0)` | Crown translation in head-local units; pendilia travel with it |
| `robe_fill` | `1` | Enamel pour fraction, passed to Painter |
| `cracks` | `0` | Crack progress on face and robe |
| `pendulum` | `None` | Pearl-chain swing angle; None uses `sin(p.time*4)*6` |
| `scale` | `1` | Whole bust scale |
| `at` | `(540,540)` | Core anchor position |
| `brow_height` | `None` | Left/right vertical offsets, negative raises brow |
| `halo_hidden` | `False` | Suppress halo |
| `crown_hidden` | `False` | Suppress crown and pendilia |
| `crown_tilt` | `0` | Crown rotation relative to head |
| `hands` | `None` | `cheeks`, `nose`, `raised`, or iterable of `(x,y,rotation)` in unscaled bust coordinates |

Hands are optional foreground mittens with sleeve cuffs and rivets. Custom hand coordinates can be interpolated for a rising hand. The `nose` gesture touches the nose with the mitten edge, without a pointing finger.

### `nose(p, state='present', at=(546,565), scale=.93, rotate=0)`

Draws only the detachable pear-shaped nose (or its matching dark socket). `p` is Painter; `state` is present/missing/gold; `at` locates the local origin; `scale` sizes the original approximately 140×160 shape; `rotate` spins about the local origin. Defaults match an untilted, default bust exactly. Missing is a single onyx cell with a thin rim, with no inner ring.

For transformed busts apply the same outer anchor transform and head transform before drawing the piece. The head-local nose origin is `(6,65)` at scale `.93`. This is the same geometry used by the full figure. The standalone helper deliberately draws no star: choreographers can place `p.glint` at the landing point.

### `blend_pose(a, b, amount)`

`a` and `b` are expression names or dictionaries. Returns a new dictionary: numeric values and tuples interpolate; strings and booleans swap at amount .5. Values present at only one endpoint remain constant. Amount is not clamped, so `tick()` overshoot is preserved for mechanical transforms; lids clamp at draw time. The helper does not schedule motion or mutate the presets.

### `figure(p, design, x, y, h, **pose)`

`x,y` are the midpoint between the feet; `h` is positive nominal standing height. Body rotations use that foot anchor. Prone rigs instead use `x,y` as their horizontal ground anchor. Head and crown occupy about 42% of standing height. Small rigs retain shoes, sleeves, rivets and hands at h=180, but that does not make their acting legible at phone size. Use such figures for supporting crowds or later wide shots; bring the opening's important face or prop closer.

| Pose key | Default | Meaning |
|---|---|---|
| `variant` | `0` | Citizen 0..2 or rival 0..1; suffix in design overrides it |
| `expression` | role dependent | Emperor smug, citizens defeated, others grim |
| `nose_state`, `eye_look`, `eyelid`, `brow_angles`, `brow_height`, `mouth`, `cracks` | same as bust | Shared face controls; cracks affect face only |
| `left_shoulder`, `right_shoulder` | 8, -8 standing | Rotation from downward arm; 145/-145 raises both arms |
| `left_elbow`, `right_elbow` | 12, -12 standing | Rotation relative to upper sleeve |
| `body_lean` | `0` | Whole figure rotation about feet |
| `head_tilt` | `0` | Head rotation independent of torso |
| `prone` | `False` | `True` or `'back'` for face up; `'front'` for hair back visible |
| `prone_direction` | `1` | 1 puts head right; -1 puts head left |
| `sit` | `False` | Lower head/shoulders by .16h, spread knees, bell hem and folded arms |
| `hop` | `0` | Upward translation in stage units |
| `offset` | `(0,0)` | Additional stage translation |
| `stance` | `1` | Shoe separation multiplier; 2.6 straddles the two prone rivals |
| `halo` | `False` | Show emperor halo |
| `halo_offset`, `halo_tilt` | `(0,0)`, 0 | Halo-local transforms |
| `crown_hidden`, `crown_offset`, `crown_tilt`, `pendulum` | False, (0,0), 0, None | Crown controls; rivals default to -17 degrees with a dented peak |
| `spear` | True for general/Bulgar | Right-hand spear on/off |
| `spear_angle` | `0` | Spear rotation relative to forearm; 180 reverses tip |

Seated defaults are shoulders 45/-45, elbows 65/-65; explicit angles override them. Prone takes precedence over body lean. Below h=260, eyes become plain onyx dots with one pearl glint; partial shutters cap at .38 for readability, while full blinks still close. Curl wires, beard scallops, crown pendilia, collar gems and dense garment ornament are omitted. The simplification threshold uses supplied h, so pass the intended stage size instead of shrinking a large figure with an external transform.

## Named designs and expressions

`DESIGNS` exports `emperor`, `citizen_0`, `citizen_1`, `citizen_2`, `general`, `bulgar`, `rival_0`, `rival_1`. Unsuffixed `citizen` and `rival` accept `variant`.

- Emperor: amethyst bell robe, oxblood diamond loros, imperial crown, curled temples and scalloped beard; optional halo.
- Citizen 0: sand striped robe, sky slouch cap. Citizen 1: coral stripes, sand pointed soft cap. Citizen 2: moss stripes, coral low cap.
- General: bronze scale armour, rounded helmet with oxblood crest and central gold ridge; spear.
- Bulgar: jade tunic, pointed bronze helmet with dark fur band, sand face and beard; spear.
- Rivals 0/1: plain oxblood/sand robes, dented crowns askew. Neither wears amethyst.

`EXPRESSIONS` exports dictionaries for `smug`, `shocked`, `scheming`, `pained`, `grin`, `triumphant`, `grim`, `terrified`, `defeated`. Smug has asymmetric brows and smirk; shocked is wide-eyed with an O mouth; scheming narrows lids and pitches brows inward; pained closes shutters with squeeze marks; grin/triumphant show ivory teeth; grim is flat-mouthed; terrified has raised brows and clenched teeth; defeated lowers lids with a frown. Bodies and hands are explicitly posed by the shot, not by these face presets.

Importing cast registers umber #4a2c1a, bronze #b9824f, moss #657b48 and sky #609ab1 in the engine's hex-string palette.

## Choreography examples

These are independent pose and cue fragments for later beats, not a sequence or a complete opening. The timed nose flight and citizen reaction deliberately wait for their cues; use the immediate action in the authoring example as the model for a feed opening.

```python
from gilt import tick
from gilt.cast import bust, nose, figure, blend_pose

# A five-frame mechanical expression tick; crown and halo can move separately.
bust(p, **blend_pose('smug', 'shocked', tick(t-1)),
     nose_state='missing' if t >= 1 else 'present',
     halo_tilt=18*tick(t-1), hands='cheeks' if t >= 1 else None)
if 1 <= t < 1.8:
    u=(t-1)/.8
    nose(p, at=(546+850*u,565-300*u), rotate=540*u)

# It did not work: brows, eyes, empty socket occupy the core.
bust(p, 'scheming', nose_state='missing', scale=2.75,
     at=(523,600), halo_hidden=True, crown_hidden=True)

figure(p, 'emperor', 540, 960, 420, expression='triumphant',
       nose_state='gold', left_shoulder=145, right_shoulder=-145)
figure(p, 'general', 540, 960, 420, right_shoulder=-65,
       right_elbow=-25, spear_angle=180)
figure(p, 'citizen', 300, 960, 180, variant=1,
       **blend_pose('defeated','grim',tick(t-2)))
```

## Rig limits and extensions

Grin and triumphant share a mouth and need body acting to distinguish them. Rivals share a crown silhouette and primarily differ by robe colour. Broad foreheads need eye darts and head ticks to avoid static reactions. Hands are symbolic mittens; prone figures are rotated automata, not side-view anatomy. Inspect the current scene's motion and framing.

`bust(..., robe_trim_fill=None)` optionally re-pours the loros panel in saffron from its lower edge. `None` preserves the original oxblood panel.
