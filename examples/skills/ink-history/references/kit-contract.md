# Kit v2 code contract

Contents: story/clock; drawing and design hooks; motion/camera; scenery/props/inserts; commands and review.

The film is authored as an ES module, **not JSON**. There is no fixed cast or pose schema to fill in. The drawing modules are plain editable JavaScript using `@napi-rs/canvas`. `film.py` handles local speech, exact clause timing, sound, review and encoded-file QA. Nothing calls a paid API. See `kit/LICENSE.txt` for code, font and downloaded dependency licenses.

## Story and clock

Make `film/story.mjs` beside the working kit and import `./index.mjs`:

```js
import {
  W, H, figure, design, cel, blob, poly, oval, curve, stroke, brush, paint, label,
  beats, talk, blink, drift, snap, move, pop, hold, span, clamp, painted,
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
      figure(c,clerk,{x:800,y:500,anchor:'head',R:285,id:'clerk',blink:blink(t,2),
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

Top-level options: `title`, `fps` (60 preferred, 30 supported), `voice:{name,speed,lang}`, `music:{mood,bpm}`, `light:[dx,dy]` pointing **toward** the source, `tint` (shadow colour), `key` (rim light), `form` (0..1, shadow extent), `backlit` (false/true or strength).

Each shot has `id` (unique safe filename), `kind` (`scene`, `board`, `map`, `insert`, `title`), `say` (array of clauses), optional `lead`, `gap` (.1), `pause` (.22), `hold` (extra final pause), and:

- `set(c,s)`: painted once/cached, in scene coordinates. Keep it independent of time. Shared painter/key means a shared place; do not give every identical set a new identity to evade variety checks.
- `camera(t,s)` returns `{x,y,zoom,tilt}`. `x,y` is the scene point at screen centre. Zoom >=1 normally; the set has only 200 units of spare border.
- `draw(c,t,s)`: dynamic people, props and effects. Draw far to near, controlling overlap explicitly.
- `overlay(c,t,s)`: optional fixed screen-space labels/effects after the camera.
- Shot lighting overrides the top-level lighting. `wide:true` declares a deliberately distant scene. `stills:[.3,'cue2','end']` can select diagnostic frames.
- `sfx:[{at,type,gain,pan,dur}]`; `at` is local seconds or a **one-based** string such as `'cue2+0.15'`. `musicStop:true` removes the bed for a punchline.

`s` supplies `dur`, `start`, `index`, `id`, `fps`, **zero-based** `cue(i)` (clause start), `end(i)` (clause end), `voiceAt(t)` (0..1). `t` is always local shot seconds. Place action on cues, not guessed absolute times; TTS changes the duration. Do not confuse `s.cue(1)` (second clause) with SFX `'cue1'` (first clause).

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
- `mouth`: `none,smile,beam,frown,flat,smirk,wavy,puff,cat,o,gasp,open,shout,laugh,teeth,pout,tongue,lips` or `{shape,w,open,dx,dy,mute}`. `talk:talk(s,t)` animates only the speaking person; omit on listeners. `blink:blink(t,seed)` occasionally closes the eyes.
- `extra(c,h)` draws this shot's extra face detail (sweat, tear, new cheek shape). Exported `EYES` and `MOUTHS` dictionaries accept custom functions; see `figure.mjs` for callback geometry. Use distinctive combinations and asymmetry, not the same three preset faces all film.
- `armL/armR:{to:[dx,dy],hand,rot,bend,front,over,hold}`. `to` is an offset from shoulder in **head radii**. `at:[x,y]` instead targets a scene point. `hand` is `mitt,open,fist,point,flat,thumb,grip,none`; `front:true` draws in front of torso; `over:true` draws over head. `hold(cc,info)` is translated to the wrist (not rotated); paint the object relative to (0,0), with optional rotation of your own. Attach the object here so it follows the hand.
- `legs:{stance,L:{to:[dx,dy]},R:{to:[dx,dy]}}` offsets feet in head radii. Running needs distinct limb drawings as well as translation.
- `id` tracks a principal person. `extraFigure:true` is only for genuinely secondary background extras; it removes that face from principal framing/expression gates. `shadow:false` can disable an inappropriate floor shadow.

Wardrobe helpers live in `wardrobe.mjs`: short/swept/curly/long hair, fringe/sideSweep/bun/baldRing; topHat/bowler/flatCap/kepi/helmet/fez/crown/strawHat/hood; moustache/beard/glasses/monocle; sweat/tears/vein/blush; and lapels, collar, shirtFront, tie, bowTie, belt, sash, apron, epaulettes, medals, straps, patches. Read the function's header for its options. Draw new silhouettes and tailoring through hooks when these do not fit.

## Places, objects and explanation art

`scenery` offers `heavens,hills,street,wallSide,ramparts,nightField,plankRoom,hall,burst,gloom,tabletop`, plus `town,cypress,gate,well`. Whole-place options include `time:'day'|'dusk'|'dawn'|'night'|'grey'`, seed and palette. `street` takes `vp:[x,y]`, `water`, colours and foreground controls. `plankRoom` takes `back:[x0,y0,x1,y1]`, wood/floor, lamp and picture hooks. Read/copy a function to construct a new place with the low-level `sets` quads, walls, planks, windows, brickwork, trees, boxes, curtains and lights. `sets.quad(tl,tr,br,bl)` returns `path,at(u,v),cell(...)` for perspective decoration.

Match figure lighting to the place: dusk often `light:[-.8,-.5]`, `form:.6`; broad bright day can use `form:.3`; night can use `tint:'#6a6a9a'` and `st.grade(c,'#9a98dc')` after drawing, then warm lamp glows. `backlit:true` makes a larger shadow mass and narrow rim; it is for actual backlight, not a default wash. `painted(c,'unique-layer-key',fn)` caches a static foreground piece painted from `draw`, e.g. a wall behind which a person stands. Its contents are not registered by gates: keep important labels/people in normal draw calls.

`props` offers `paper,scroll,sign,flag,bucket,barrel,crate,sack,coins,spear,sword,table,candle`, plus comic `bubble,burst,puff,sparkle,speedLines,arrow,popIn`. These are functions, not JSON type strings. Signatures/options are at the top of `props.mjs`. Most take `(c,x,y,scale,options)`; exceptions such as `bubble(c,x,y,options)` are documented there. A missing ladder, machine or carriage must be drawn with paths (or a new helper). Use a substantial, angled object insert; do not pass off a barrel as a clock.

`bd.boardSet(c,{title,...})` paints the desktop/paper. In `draw`, use `bd.sketch(c,cc=>{figure(cc,...);customObject(cc);},{alpha,width:11})` to convert regular kit calls to white line art with hidden-line removal. Cross-fade two separate sketch groups or swap full drawings. Use original cast silhouettes and physical action; avoid boxes and stock icons. Sketch tilt defaults to match the paper (2.4°).

For a map: `bd.sea(c)`, `bd.coast(points,{seed,rough})` creates an original path, `bd.land(c,path)` paints neutral land, `bd.region(c,path,{fill,border})` colours a region, `bd.mapFace(c,x,y,scale,{mood})` adds a face. `bd.place` labels it. A true geographic map needs researched outlines; rough invented regions are for a declared fictional schematic.

`label(c,text,x,y,{size,fill,sw,rotate,align,shadow})` draws fat outlined display lettering. `scrawl` is unoutlined uneven lettering. Both register text for gates. Do not set `decor:true` for meaningful writing; it disables its checks. Keep informational text in dynamic draw/overlay for accurate measurement. `pr.popIn(c,t,at,x,y,()=>label(...))` handles entry overshoot and transient text measurements.

## Motion and production

`beats(t,[[time,pose],...])` returns the current full pose plus duck/pop squash; spread it into `figure`. Poses swap, they do not interpolate; include all needed overrides per pose. `talk(s,t)` samples loudness at 12 Hz. `hold(t,step)` quantizes limb drawings. `move(t,a,b,from,to)` eases a translation. `drift(t,dur,from,to)` returns a camera; `snap(camera,t,at,target,duration=.13)` and `shake(camera,t,at,amplitude,duration)` add a timed accent. `pop(t,at,dur)` is an overshooting scale, so **it can exceed 1**. Clamp only when a property such as opacity must be 0..1.

An absolute `snap` target stays at that target after the snap; the drift passed as the first argument no longer moves it. For a longer reaction hold, pass a slowly changing `drift(...)` camera object as the target, and give the character a follow-up gaze/blink/gesture. Inspect the post-snap hold too: a correct anticipation can still end in an unintended frozen picture.

Sound types: `pop,ding,bell,boing,whoosh,slide-up,slide-down,thud,stamp,drum,paper,sting,fanfare,crowd`. Music moods: `jaunty,sneaky,march,wistful,none`. Keep effects selective and timed to contact. Use `film.py sound` to rebuild `work/mix.wav` without rerendering pictures.

Use `prepare` → `stills` → actual inspection/revision → `review.json` → `render`. The entrypoint lists commands. `node render.mjs frame/strip/clip` use shot-local time; frame accepts `cue1`, `end`, `50%`. `--draft` uses rough word-count timing for design before speech. Final work must use measured timing. `node render.mjs video ... --jobs 4` can render picture-only with fewer processes if memory is tight; normal `film.py render` uses at most six workers.

`audit.json` measures principal face scale/safety, text size/bounds, motion, contrast, saturation, expression and framing/set variety. `stills` writes a source/timing fingerprint; put its literal value in `review.json.sheetSignature` after viewing the sheet. Changes invalidate the review. Narration/voice/pause changes invalidate the voice timeline too. Do not edit audit/review data to pretend an inspection or bypass a drawing defect.

Uploaded voice uses silence/word-count estimates written to `clause-times.json` and `waveform.png`. Correct the list if needed: each clause start in seconds, then final clause end, all increasing. Re-run `prepare --voice <file> --timings <list>`. The recording is never sped up, pitched or cut to fit guessed shot lengths.

`render` refuses unresolved gates, draft/stale timing and stale review; mixes/normalizes audio, encodes H.264/AAC, then runs `qa`. `qa.json`, `ffmpeg-qa.log`, `final-frames` and `final-sheet.jpg` describe/read back the actual MP4. Final checks catch wrong duration/dimensions/rate, missing audio, loudness/peaks, black/frozen/empty frames. They do not judge comedy, quality of motion, all occlusions or background craftsmanship. Open the encoded-frame sheet and listen/watch before handing it over.
