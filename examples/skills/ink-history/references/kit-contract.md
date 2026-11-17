# Kit v2 code contract

Contents: story/clock; drawing and design hooks; poses and motion fields; scenery/props/inserts; motion, cues and lip sync; the motion gate; commands and review.

The film is authored as an ES module, **not JSON**. There is no fixed cast or pose schema to fill in. The drawing modules are plain editable JavaScript using `@napi-rs/canvas`. `film.py` handles local speech, exact clause timing, sound, review and encoded-file QA. Nothing calls a paid API. See `kit/LICENSE.txt` for code, font and downloaded dependency licenses.

## Story and clock

Make `film/story.mjs` beside the working kit and import `./index.mjs`:

```js
import {
  W, H, figure, design, cel, blob, poly, oval, curve, stroke, brush, paint, label,
  beats, talk, drift, snap, move, pop, hold, span, clamp, painted, cue, onCue, cueBeats, alive,
  wardrobe as w, scenery as sc, sets as st, props as pr, board as bd,
} from './index.mjs';

const clerk = design({
  name: 'clerk', build: { shoulder: .72, belly: .98, hip: .92 },
  top: { color: '#3266a0', hem: .83, sleeve: 'long', cuff: '#eee9d6' },
  bottom: { color: '#303344', shoes: '#302020' },
  hairFront: (c, h) => w.fringe(c, h, { color: '#b2642b' }),
  hat: (c, h) => w.flatCap(c, h, { color: '#9c4430' }),
  outfit: B => { w.collar(B); B.buttons(.25, .25, .65, 3); },
});

export default {
  title: 'A new original film', fps: 60,
  voice: { name: 'bm_george', speed: 1.1 }, music: { mood: 'sneaky' },
  light: [.7, -.6],
  shots: [{
    id: 'discovery', kind: 'scene',
    say: ['The clerk had a plan.', 'It was missing one small detail.'], hold: .3,
    set: c => { sc.plankRoom(c, { back: [250, 80, 1540, 650] }); pr.table(c, 1350, 920, .65); },
    camera: (t,s) => snap(drift(t,s.dur,{zoom:1,tilt:-2},{zoom:1.04,tilt:-2}), t,s.cue(1),{x:850,y:480,zoom:1.25}),
    draw(c,t,s) {
      figure(c,clerk,{x:800,y:500,anchor:'head',R:285,id:'clerk',
        ...beats(t, [
          [0,{eyes:'shut',brows:'up',mouth:'smirk',head:{turn:.4,tilt:-7},armR:{to:[1.2,-1.3],hand:'point',front:true}}],
          [s.cue(1),{eyes:{L:'wide',R:'half'},brows:'worried',mouth:'wavy',head:{turn:-.3,tilt:6},armR:{to:[.8,-.6],hand:'open',front:true}}],
        ])});
    },
    sfx:[{at:'cue2',type:'pop',gain:.5}],
  }],
};
```

That demonstrates one shot; it is not a whole film. Read `example/story.mjs` for a complete ten-shot film with hand-held props, white-line drawings, reaction close-ups and changing sets. Copy techniques, not its story or its four soldiers into every film.

Top-level options: `title`, `fps` (60 preferred, 30 supported), `voice:{engine,...}` (default engine `kokoro`, with `name,speed,lang`), `music:{mood,bpm}`, `light:[dx,dy]` pointing **toward** the source, `tint` (shadow colour), `key` (rim light), `form` (0..1, shadow extent), `backlit` (false/true or strength).

Local voice examples (install with `setup.py <film> --tts <engine>` first):

```js
voice: { engine: 'kokoro', name: 'bm_george', speed: 1.12, lang: 'en-gb' }
voice: { engine: 'zonos', seed: 217, reference: './narrator.wav',
  conditioning: { language: 'en-us', speaking_rate: 15, pitch_std: 70,
    emotion: [.5, .02, .02, .02, .15, .02, .07, .2] } }
voice: { engine: 'dia', seed: 217,
  audio_prompt: { path: './narrator.wav', transcript: '[S1] The exact words in that recording.' },
  generation: { temperature: 1.8, top_p: .9, top_k: 45 } }
```

Paths are relative to the story module. Zonos `reference` and Dia `audio_prompt` are optional: without one, `prepare` generates one fixed anchor under `work/voice-anchors/` and reuses it for all clauses and resumes. `anchor_text` changes that generated anchor's script. Dia prepends `[S1]` to untagged clauses and passes speaker/nonverbal tags through; a consistent `[S2]` needs a supplied prompt covering both speakers. Unknown top-level voice options fail clearly instead of being silently ignored. See [local voices](local-voices.md) for all options, context limits, licences and platform setup.

Dia narration adds an empty opposite-speaker ending tag by default, following upstream's advice to improve the end of the utterance. It preserves an explicit ending tag and leaves creative `say` text/cue names unchanged. `voice.ending_hint: false` disables this framing. The flag and framing source hash affect only Dia's clause cache.

`voice.clause_ending_hints: { 'shot-id:0': false }` overrides the hint for one zero-based clause. Use it to audition a short fragment that receives an unwanted long performance; only the affected clause regenerates. The speaker anchor and the other clause caches stay fixed. Unknown clause keys and non-boolean values fail clearly.

Zonos/Dia `voice.clause_seeds: { 'shot-id:0': 218 }` selects a fixed seed for one retake, preserving the base-seed anchor and other caches. Seeds must be integers in `0..2^32-1`; unknown clause keys fail. Timelines keep the map and performance records keep the actual generation seeds.

Each clause cache key includes engine, options, seed, pinned model identity, reference audio contents and processing code. Timelines keep engine/seed/prompt metadata; `voice-performance.json` records cold/cached clause times and actual generation seeds. Expressive engines reject silent/implausibly short clips, retry with base seed +1/+2 and the same anchor, then fail explicitly rather than time a film against missing speech. This is not a transcription check. All synthesized voice clips become 24 kHz mono before the existing trim, cue clock and envelope; new engines also match the mixer's active voice RMS with peak headroom. Kokoro keeps its previous gain and trim. Final mixing/−16 LUFS normalization and motion gates remain authoritative. Uploaded recordings still use `cut_upload` without TTS or speed/pitch changes.

Each shot has `id` (unique safe filename), `kind` (`scene`, `board`, `map`, `insert`, `title`), `say` (array of clauses), optional `lead`, `gap` (.1), `pause` (.22), `hold` (extra final pause), and:

- `set(c,s)`: painted once/cached, in scene coordinates. Keep it independent of time. Shared painter/key means a shared place; do not give every identical set a new identity to evade variety checks.
- `camera(t,s)` returns `{x,y,zoom,tilt}`. `x,y` is the scene point at screen centre. Omit it for a seeded default drift; `camera:false` holds the frame. A camera guard (on unless `cameraGuard:false`) raises zoom and clamps the pan so the view stays inside the *painted* extent of the set; `setBounds:[x0,y0,x1,y1]` overrides that extent. On board, map, insert and title shots (or any shot with `textMotion:true`) the camera, even an authored one, is integrated from `t=0` and speed-limited to about 22 px/s, 1.8 %/s zoom and 0.3°/s roll; `textMotion:false` allows a deliberate fast emphasis.
- `draw(c,t,s)`: dynamic people, props and effects. Draw far to near, controlling overlap explicitly.
- `overlay(c,t,s)`: optional fixed screen-space labels/effects after the camera.
- Motion options on a shot or the story: `life:false`/`still:true` (no automatic motion), `speaker` (lip-sync opt-in, below), `subject:'id'` (which principal floats and may accent), `groups:[{at,draw,...onCue options}]` (timed groups, below), `events:[{name,at}]` (declared events), `cueNames:{alias:clauseIndex}`, `graphic:false` (no stage rise/slide/exit on `insert`/`title`).
- Shot lighting overrides the top-level lighting. `wide:true` declares a deliberately distant scene. `stills:[.3,'cue2','end']` can select diagnostic frames.
- `sfx:[{at,type,gain,pan,dur}]`; `at` is local seconds or a **one-based** string such as `'cue2+0.15'`. `musicStop:true` removes the bed for a punchline.

`s` supplies `dur`, `start`, `index`, `id`, `kind`, `fps`, `clauses`, `cues`/`ends`, **zero-based** `cue(i)` (clause start), `end(i)` (clause end), `voiceAt(t)` (0..1). `s.cue('text')` returns the first clause containing that text (case-insensitive) or a `cueNames` alias, and throws when nothing matches. Cues are **clause-level timings from the voice timeline, not forced word alignments**: to land on a word, split the narration into clauses at that word. `t` is always local shot seconds. Place action on cues, not guessed absolute times; TTS changes the duration. Do not confuse `s.cue(1)` (second clause) with SFX `'cue1'` (first clause).

## Drawing and original designs

Scene units are delivery pixels (1920×960). `cel(c,path,{fill,depth,shrink,rim,line,inner})` fills, shades and outlines an organic path. `depth` shifts the lit copy; `shrink` controls the crescent. `inner(cc)` is clipped inside the form. `blob([[x,y,corner],...])` is a closed curved shape; a third value `1` makes a sharp corner. `poly(points,closed=true)` makes straight edges. `curve(points)` is an open spline; `stroke(c,path,width,color)` inks it; `brush(c,points,widths,color)` tapers a brushstroke. `paint` adds unoutlined flat interior colour. `oval(x,y,rx,ry,rotationRadians)` and `circle(x,y,r)` make basic forms. These helpers also honor board/shadow modes; raw Canvas fills do not.

Compound paths with holes may need `rule:'evenodd'` in `cel` so the opening survives clipping, shading and shadow/line-mode fills (the hood helper demonstrates this). A face can be registered correctly and still be hidden under a filled hat: gates measure geometry, so inspect actual eyes and mouths through every headwear shape in colour.

`figure(c, design, pose)` draws and returns `{head,R,handL,handR,footL,footR,neck,...}` anchors in scene coordinates. Designs are made with `design({...})`. Defaults: white skin, bean head, soft torso. Useful design fields:

- `build:{shoulder,belly,hip,torso,leg,arm,limb,legW,neck}` in head-radius units. Defaults are `.88,1.26,1.18,3.6,1.25,2.9,.45,.8,.7`. Vary these meaningfully for different people.
- `top:{color,hem,sleeve:'short'|'long'|'none',sleeveColor,trim,cuff,skirt,flare,skirtColor}`; `hem` fraction down torso, >=1 covers it. `bottom:{color,shoes}`, `glove` optional. `skinShade` overrides shadow tint; keep default skin white.
- `hairBack(c,h)`, `under(c,h)`, `face(c,h)`, `hairFront(c,h)`, `hat(c,h)` draw head layers in that order around the features. Head hook origin is skull centre, radius **1**, so paths use fractions of 1, not hundreds of pixels. `h` includes `R,lw,turn,nod,eyeL,eyeR,mouth,pose`. Use `line:h.lw` for the scene ink weight: the core compensates nested scaling.
- `outfit(B)` adds garments. `B.pt(u,v)` maps across the torso (`u=-1..1`) and downward (`v=0..1`) to scene pixels; `B.panel([[u,v],...],colour,options)`, `B.band(v0,v1,colour)`, `B.seam(points,width)`, `B.buttons(u,v0,v1,n,r,colour)` keep shading/clipping consistent. Button radius `r` is in **head radii** (usually `.05` to `.09`), not pixels; passing `5` creates a disc five times the head radius and is rejected. `B.c`, `B.R`, `B.lw` are available for free drawing.

Example of an original asymmetrical hat: write a function `(c,h)=>cel(c,blob([[-1,-.65,1],[-.5,-1.6],[.7,-1.45],[1.1,-.5,1],[.1,-.65]]),{fill:'#8e3134',depth:.12,rim:h.lw,line:h.lw})` and add folds/patches with `stroke/paint`. Pair it with a separate hair silhouette and costume panel. Do not merely attach a name to an unchanged helmet.

Poses:

- `{x,y,h}` anchors at the feet. `h` is approximate height; `R` can specify head radius directly. `{x,y,anchor:'head',R}` anchors at skull centre (best for close-ups). `flip`, `lean` (degrees), `bend`, `sway`, `crouch`, `pop:[sx,sy]` affect the body.
- `head:{turn:-1..1,tilt:degrees,nod:-1..1,dx,dy}`. Look direction `look:[x,y]` and feature spacing `eyeGap` alter the face.
- `eyes`: `dot,bean,tall,big,shut,happy,line,squeeze,wide,half,glare,star,heart,cross,spiral,shiny`. Or `{L:spec,R:spec}`; a spec can be `{shape,size,tilt,look,dx,dy,lashes}`. `brows`: `flat,angry,stern,sad,worried,up,soft` or `{tilt,lift,curve,len,w}`; left/right specs work here too.
- `mouth`: `none,smile,beam,frown,flat,smirk,wavy,puff,cat,o,gasp,open,shout,laugh,teeth,pout,tongue,lips` or `{shape,w,open,dx,dy,mute}`. `talk:talk(s,t)` opens the mouth of a *speaking* person and is subject to the lip-sync rules below; omit it on listeners. Blinks are automatic for every principal; `blink:` is ignored unless `autoBlink:false` is also set.
- `extra(c,h)` draws this shot's extra face detail (sweat, tear, new cheek shape). Exported `EYES` and `MOUTHS` dictionaries accept custom functions; see `figure.mjs` for callback geometry. Use distinctive combinations and asymmetry, not the same three preset faces all film.
- `armL/armR:{to:[dx,dy],hand,rot,bend,front,over,hold}`. `to` is an offset from shoulder in **head radii**. `at:[x,y]` instead targets a scene point. `hand` is `mitt,open,fist,point,flat,thumb,grip,none`; `front:true` draws in front of torso; `over:true` draws over head. `hold(cc,info)` is translated to the wrist (not rotated); paint the object relative to (0,0), with optional rotation of your own. Attach the object here so it follows the hand.
- `legs:{stance,L:{to:[dx,dy]},R:{to:[dx,dy]}}` offsets feet in head radii. Running needs distinct limb drawings as well as translation.
- Motion fields (all optional): `life:false`/`still:true`, `idle:false` (breath, head and weight), `gesture:false` (free-hand accent), `eyeDarts:false`, `autoBlink:false`, `float:false`, `speaking`, `grounded:true|false` (override planted detection), `seated`/`leaning`/`attached:true` (contact poses: no accents, no float). The same `life`, `still` and `speaking` can sit on a `design()`.
- `id` tracks a principal person and seeds that person's motion, so give every principal one and keep it stable. `extraFigure:true` is only for genuinely secondary background extras; it removes that face from principal framing/expression gates. `shadow:false` can disable an inappropriate floor shadow.

Wardrobe helpers live in `wardrobe.mjs`: short/swept/curly/long hair, fringe/sideSweep/bun/baldRing; topHat/bowler/flatCap/kepi/helmet/fez/crown/strawHat/hood; moustache/beard/glasses/monocle; sweat/tears/vein/blush; and lapels, collar, shirtFront, tie, bowTie, belt, sash, apron, epaulettes, medals, straps, patches. Read the function's header for its options. Draw new silhouettes and tailoring through hooks when these do not fit.

## Places, objects and explanation art

`scenery` offers `heavens,hills,street,wallSide,ramparts,nightField,plankRoom,hall,burst,gloom,tabletop`, plus `town,cypress,gate,well`. Whole-place options include `time:'day'|'dusk'|'dawn'|'night'|'grey'`, seed and palette. `street` takes `vp:[x,y]`, `water`, colours and foreground controls. `plankRoom` takes `back:[x0,y0,x1,y1]`, wood/floor, lamp and picture hooks. Read/copy a function to construct a new place with the low-level `sets` quads, walls, planks, windows, brickwork, trees, boxes, curtains and lights. `sets.quad(tl,tr,br,bl)` returns `path,at(u,v),cell(...)` for perspective decoration.

Match figure lighting to the place: dusk often `light:[-.8,-.5]`, `form:.6`; broad bright day can use `form:.3`; night can use `tint:'#6a6a9a'` and `st.grade(c,'#9a98dc')` after drawing, then warm lamp glows. `backlit:true` makes a larger shadow mass and narrow rim; it is for actual backlight, not a default wash. `painted(c,'unique-layer-key',fn)` caches a static foreground piece painted from `draw`, e.g. a wall behind which a person stands. Its contents are not registered by gates: keep important labels/people in normal draw calls.

`props` offers `paper,scroll,sign,flag,bucket,barrel,crate,sack,coins,spear,sword,table,candle,fire,ship,quill,seal,ledger,stamp,document`, plus comic `bubble,burst,puff,sparkle,speedLines,arrow,popIn`. Almost all take `at` (arrival time or `cue(n,offset)`), `out`, `enter:false`, `id`, `life:false`/`still:true`; held props (inside `arm.hold`) never enter or float separately. `paper`/`document`/`ledger`/`scroll` take `title`, `rows:['REAL','LETTERING']` (or `lines:n` of ruled scribble), `seal`, `sealAt`, `lineAt`, `lineGap`, `write` (rows write on in `insert`/`board`/`map` shots; `write:true` forces it in a scene, `false` disables), `quill:false`, `hand:false`. `stamp(c,x,y,s,{text,at})` drops an ink stamp (a seal without `text`); `coins` accrue one by one in info shots (`n`, `at`, `stagger`); `arrow(c,a,b,{at,duration,travel:false,enter:false})` grows and then carries a travelling dash. These are functions, not JSON type strings. Signatures/options are at the top of `props.mjs`. Most take `(c,x,y,scale,options)`; exceptions such as `bubble(c,x,y,options)` are documented there. A missing ladder, machine or carriage must be drawn with paths (or a new helper). Use a substantial, angled object insert; do not pass off a barrel as a clock.

`bd.boardSet(c,{title,...})` paints the desktop/paper. In `draw`, use `bd.sketch(c,cc=>{figure(cc,...);customObject(cc);},{at:cue(1),until:cue(2),width:11})` to convert regular kit calls to white line art with hidden-line removal. `at` wipes the whole drawing on left to right with a pencil in a small hand; `until` wipes it off with the eraser; `duration`, `eraseDuration`, `bounds`, `tools:false` and `hand:false` tune that (without `at`, sketches stagger in 0.7 s apart in draw order). An explicit `alpha` with no `at` is a plain cross-fade control with no entrance. `boardSet` only paints the resting pencil and eraser. Keep the figures inside as separate, physically acting drawings; do not trace every line like chalk. Use original cast silhouettes and physical action; avoid boxes and stock icons. Sketch tilt defaults to match the paper (2.4°).

For a map: `bd.sea(c)`, `bd.coast(points,{seed,rough})` creates an original path, `bd.land(c,path)` paints neutral land, `bd.region(c,path,{fill,border})` colours a region, `bd.mapFace(c,x,y,scale,{mood})` adds a face. `bd.place` labels it. Make a map act on cues: `bd.region(c,path,{fill,border,at:cue(1)})` grows a territory; `bd.mapFace(c,x,y,scale,{mood})` blinks and reacts; `bd.place(c,text,x,y,{at,pin:true})` pops (pin pulses); `bd.route(c,points,{at,duration,speed,token:(c,x,y,angle)=>...})` draws a route then carries a token; `bd.cast(c,design,x,y,h,{at,id,...pose})`, `bd.sign(c,text,x,y,{at})` (map sign, unlike `pr.sign`), `bd.marker(c,x,y,{at,text})` and `bd.drop(c,draw,{at})` land with a rebound. A true geographic map needs researched outlines; rough invented regions are for a declared fictional schematic.

`label(c,text,x,y,{size,fill,sw,rotate,align,shadow,at,until,enter:'slide',id})` draws fat outlined display lettering; `at` times its pop-in, `until` its exit. `scrawl` is unoutlined uneven lettering. Both register text for gates. Do not set `decor:true` for meaningful writing; it disables its checks. Keep informational text in dynamic draw/overlay for accurate measurement. `pr.popIn(c,t,at,x,y,()=>label(...))` handles entry overshoot and transient text measurements.

## Motion and production

`beats(t,[[time,pose],...])` returns the current full pose plus duck/pop squash; spread it into `figure`. Poses swap, they do not interpolate; include all needed overrides per pose. `talk(s,t)` samples loudness at 12 Hz. `hold(t,step)` quantizes limb drawings. `move(t,a,b,from,to)` eases a translation. `drift(t,dur,from,to)` returns a camera; `snap(camera,t,at,target,duration=.13)` and `shake(camera,t,at,amplitude,duration)` add a timed accent. `pop(t,at,dur)` is an overshooting scale, so **it can exceed 1**. Clamp only when a property such as opacity must be 0..1.

An absolute `snap` target stays at that target after the snap; the drift passed as the first argument no longer moves it. For a longer reaction hold, pass a slowly changing `drift(...)` camera object as the target, and give the character a follow-up gaze or gesture (blinks and darts already run automatically). Inspect the post-snap hold too: a correct anticipation can still end in an unintended frozen picture.

### Default life: pure f(t), stable seeds

Automatic motion reads the shot clock (`t`, local seconds) and a seed built from the shot id, helper kind and the element's `id` (otherwise its draw slot). Never seed from time or a moving position and never use `Math.random`, `Date` or accumulated state in `draw`; stills, range workers and the final render must produce identical frames. Keep draw order stable or give conditionally drawn siblings an `id`. A `set` or `painted()` callback is rasterised once, so it must not depend on time: put anything timed in `draw`, `alive()`, `groups` or `living()`.

- **Figures:** breath, weight shift, head tilt, blinks (0.12-0.16 s, a few seconds apart), eye darts and a free-hand accent about once per clause (at least 1.8 s apart, shortly after a cue onset, never evenly spaced). Accents are skipped for held or aimed hands, contact poses and protected expressions. A figure is *planted* when its feet land on screen (within about half a head radius): its soles stay fixed and only lean, head and breath move. Only the shot's subject floats (a few pixels, with rests) and only if it is a bust, cropped figure or otherwise not planted. Flags: see the pose fields above.
- **Places and props:** `scenery`, `sets` and `props` add loops suited to the place (clouds, foliage, grass, cloth, water, lamps, candles, fire, stars, a few birds/dust/leaves; street `crowd:true` is opt-in, `ambient:false` removes the added air). Props and labels arrive with a short pop and settle, documents rise, and text stays rigid afterwards (a pop of at most 5 frames, then no wobble, rotation or scale; headings of 56 px or more pop at the start of the shot, smaller detail labels stagger 0.7 s in draw order). Furniture and held props do not float. `painted(c,key,fn,{float:true})` adds a small layer float; the default is none.
- **Camera:** a seeded gentle pan/push/pull per shot, bounded by the painted set (and by the reading limits above for text shots). `insert` and `title` shots rise or slide in and out at their edges.
- **Groups:** `alive(drawFn,seed,{at,enter:false|'rise'|'slide',pivot,float:false,kind:'text'})` returns a `(c,t,s)` draw function (use `alive(c,drawFn,seed,opts)` inline) that enters and floats a custom bust, ship or card as one group. Use `onCue(...,{until:...})` for a timed exit. It is a convenience for raw artwork, not a substitute for animating its parts.
- Low-level exports for extensions: `seedOf, unit, motionTime, lifeEnabled, elementMotion, floatAt, applyFloat, living, reveal, settle, idleAt, eyeDart, defaultCamera` plus the easing set `ease, easeOut, easeIn, back, slide, between`.

Opt-outs: `life:false` or `still:true` removes automatic motion for that story, shot, design, pose, place, prop, label or `painted()`; authored `beats`, cues, cameras and pops still run. `camera:false` holds the camera. Use them only where your own animation already carries the shot: a fully frozen stretch over 0.5 s fails the motion gate however it was produced.

### Cue-driven events

Meaningful motion is authored on clause cues. `cue(which,offset)` returns a function of the shot clock (`which` is a clause index, cue name or text), and the `at`/`until`/`out`/`sealAt` options below accept seconds, `cue(...)`, `'end'` or `s => seconds`.

```js
onCue(c, cue(1, .1), cc => drawCoat(cc), { enter: 'drop', id: 'coat lands', pivot: [900, 500], until: cue(2) });
draw: cueBeats(null, [[cue(0), cc => drawA(cc)], { at: cue(1), draw: cc => drawB(cc), enter: 'slide' }]),
groups: [{ at: cue(2), enter: 'pop', draw: (c, t, s) => pr.burst(c, 960, 480, 120) }],
```

- `onCue(c, when, draw, {enter:'pop'|'drop'|'slide'|'draw', duration, height, distance, bounds, pivot, until, exitDuration, id})` draws nothing before `when`, enters with that style (`'draw'` wipes through `bounds`), optionally exits at `until`, and keeps text rigid inside.
- `cueBeats(s, items, opts)` returns a draw function; each item is `[at, draw]` or `{at, draw, ...onCue options}`. With no `at`, item `i` uses clause `i`'s start (or an even schedule when there are more items than clauses). Pass `null` for `s` in a shot's `draw`.
- `shot.groups` takes the same entries and the stage draws them after `draw`. `eventSchedule(n,{at,until,stagger,times})` gives staggered times.
- `declareEvent(name,at)` and `shot.events` record an event for the *audit* (which warns when a map, board or insert over 3 s declares none). They do not move pixels and the motion gate ignores them: an event counts only if the picture performs it. Helpers such as `onCue`, `bd.*` with `at`, `pr.document`, `pr.stamp` and `pr.coins` declare theirs.

### Lip sync is opt-in

No figure mouths the narration by default; the narrator is off screen. Opt in only for real dialogue or a character who is the narrator:

- `speaker:'<figure id or design name>'` on a shot or the story (the shot wins), `speaker:'subject'` for the shot's main figure (largest principal head, or `subject:'id'`), or `speaking:true|false` on a pose or design. An explicit `talk:talk(s,t)` also opens that figure's mouth. Automatic talk is 0.7 of the 12 Hz four-level voice measure.
- Talking modulates the authored mouth and keeps its family: `open`, `laugh` and `shout` open wider; line mouths (`smile`, `smirk`, `frown`, `cat`...) squash and stretch. Protected expressions stay as drawn: `none`, `flat`, `wavy`, `o`, `gasp`, `puff`, `pout`, `tongue`, `teeth`, any pose with `extra`, and `shiny`, `star`, `heart` or `squeeze` eyes. Override deliberately with `talkOverride:true`, `mouth:{shape,speak:true}` or `talkShape:'open'`; `mouth:{mute:true}` or `'none'` never talks.

### The motion gate (`film.py motion`, then `render`/`qa`)

`film.py motion story.mjs --out work [--shot id | --start s --end s] [--jobs n]` draws a silent 960 px / 12 fps draft and runs the same gate as the final encode, with no voice model, stills or review (`prepare` first for real cue times; otherwise word-count timing is used and printed). Reports: `work/motion-preflight/motion-report.json` and `motion-timeline.png`; the final encode writes `work/motion-report.json`, `motion-timeline.png` and `qa.json`, and that file is the authority. Content motion is measured after removing global camera motion (translation, zoom, roll), not as raw frame difference. Constants, not story options: stale (frozen + camera-only drift) at most 10 %, acting at least 50 %, stale run at most 2.0 s, frozen run at most 0.5 s, at least 2.3 events per 10 s, event gap at most 5.0 s across cuts and edges, and at least one event in every shot of 3 s or more (a shot of 3 s or more that is over 40 % stale only warns). Fix the source and re-run; `--motion-*` overrides, exemptions, declared-but-unperformed events and extra float, blinks or mouth flaps to fill the score are not fixes. The pixel measure cannot judge meaning, so open the `strip` of every flagged and every hardest-case shot.

### Sound, commands and review

Sound types: `pop,ding,bell,boing,whoosh,slide-up,slide-down,thud,stamp,drum,paper,sting,fanfare,crowd`. Music moods: `jaunty,sneaky,march,wistful,none`. Keep effects selective and timed to contact. Use `film.py sound` to rebuild `work/mix.wav` without rerendering pictures.

Use `prepare` → `stills` → `motion` → actual inspection/revision → `review.json` → `render`. The entrypoint lists commands. `node render.mjs frame/strip/clip` use shot-local time; frame accepts `cue1`, `end`, `50%`. `--draft` uses rough word-count timing for design before speech. Final work must use measured timing. `node render.mjs draft ...` is the motion preflight's silent renderer (use `film.py motion`). `node render.mjs video ... --jobs 4` can render picture-only with fewer processes if memory is tight; normal `film.py render` uses at most six workers.

`audit.json` measures principal face scale/safety, text size/bounds, long unchanging stretches, contrast, saturation, expression and framing/set variety. `stills` writes a source/timing fingerprint; put its literal value in `review.json.sheetSignature` after viewing the sheet. Changes invalidate the review. Narration/voice/pause changes invalidate the voice timeline too. Do not edit audit/review data to pretend an inspection or bypass a drawing defect.

Uploaded voice uses silence/word-count estimates written to `clause-times.json` and `waveform.png`. Correct the list if needed: each clause start in seconds, then final clause end, all increasing. Re-run `prepare --voice <file> --timings <list>`. The recording is never sped up, pitched or cut to fit guessed shot lengths.

`render` refuses unresolved gates, draft/stale timing and stale review; mixes/normalizes audio, encodes H.264/AAC, then runs `qa`. `qa.json`, `ffmpeg-qa.log`, `final-frames` and `final-sheet.jpg` describe/read back the actual MP4. Final checks catch wrong duration/dimensions/rate, missing audio, loudness/peaks, black/frozen/empty frames and the motion gate above. They do not judge comedy, whether a movement means anything, all occlusions or background craftsmanship. Open the encoded-frame sheet and listen/watch before handing it over.
