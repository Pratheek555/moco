# Authoring Living Enamel

The working kit is copied to `film/`, outside hidden skill folders. Run all production commands from `film/` with its `.venv` Python. It contains `gilt/` (renderer and rigs), `stories/pilot_sets.py` (optional scenery/props), `audio/` (local DSP), `assets/fonts/` and `film.py` (orchestration). Original pilot movies, machine environments, voice weights and caches are excluded.

## Narration and timings

Write the story card first, then `script.json` with unique scene IDs matching `Shot.id`. Choose `"profile": "feed"` or `"profile": "story"` explicitly, a .04s lead and .08s end hold. The old `example/feed-pyramid.json` demonstrates timing/loop mechanics; its fact-first line and replay filler are not the story-first writing standard. Its source links identify the casing claim; choreography is illustrative.

```json
{
  "profile": "feed",
  "lead": 0.04,
  "end_hold": 0.08,
  "scenes": [
    {"id": "hook", "clauses": [{"spoken": "The Great Pyramid was once white."}]}
  ]
}
```

This fragment shows the schema, not a complete film. `spoken` is synthesized; `text` is the display caption (defaults to `spoken`). Both explicit profiles select lead .04s, clause gap .08s, scene gap .12s and end hold .08s. `prepare --profile story` overrides the script's choice and stores `profile` in `work/timeline.json`; `--profile feed` chooses the short version. Legacy `--feed-short` / `"feed_short": true` retains feed defaults. Explicit timing fields override defaults; `pause_after` overrides a particular gap. Without any profile/flag/field, old long-form defaults remain .25/.16/.36/1.4s. Feed leads must be 0..0.1s, story leads 0..0.5s; all leads must be nonnegative. Keep the first sentence in its own clause.

After the card, generate the real voice before accepting timings. `prepare` makes `work/narration.wav` and `work/timeline.json`; cut words to fit the selected profile. Feed is 15–20s with an opening sentence about seven words / 2s; story is 45–65s at **2.9–3.4 words/s over the whole film**, including pauses (about 160–185 words at 55s), with its promise established by 5s. Reward early and add consequences after the opening answer, or end there. Do not time-stretch, change tempo or pad a short premise. `--speed` remains for deliberately chosen delivery on other work. George is a default, not a listening-verified superiority claim. Word times are syllable-weighted estimates unless replaced with externally aligned real-voice anchors; inspect and listen when possible.

The timeline is `{"profile":"story", "duration":..., "scenes":[{"id":..., "start":..., "end":..., "clauses":[{"text":..., "spoken":..., "start":..., "end":..., "words":[{"w":..., "start":..., "end":...}]}]}]}`. Times are absolute seconds. Scene ranges are contiguous. The loader retimes matching shots and reads the prepared profile unless `film.use_timeline=False`; for estimates set `Film(..., profile='story')`. Legacy timelines without `profile` or `spoken` still load; absent a profile, QA retains feed limits. Keep one film's timeline per `film/` folder.

### Story breathing beats

For story narration, name at most three people; use roles for the others. Write one idea per sentence in short, plain words. Cut the word count to leave at least two silent gaps of **≥.7s** in the narration: immediately after the turn sentence and before the final line. Let a pictured action, reaction or its sound effect carry each pause. These are gaps in speech, not in the entire soundtrack.

The existing Gemini pipeline synthesizes each `spoken` clause separately, trims its outer silence, resamples to 48 kHz, then places it in a zero-filled narration buffer. A clause's `pause_after` adds that many seconds before the next clause, overriding `clause_gap` or `scene_gap`. This also works across scene boundaries. Use separate sentence blocks and explicit `.8s` pauses; punctuation or a style request alone cannot guarantee a beat. Do not place the final pause on the final clause: its `pause_after` has no following speech, and `end_hold` controls the tail.

This fictional fragment shows the turn and ending mechanism, not a complete 45–65s film:

```json
{
  "profile": "story",
  "engine": "gemini",
  "scenes": [
    {"id": "turn", "clauses": [
      {"spoken": "The box held lead.", "pause_after": 0.8},
      {"spoken": "The guard shut it.", "pause_after": 0.8},
      {"spoken": "He kept the gold."}
    ]}
  ]
}
```

Run `<py> film.py prepare script.json --engine gemini`, then inspect `work/timeline.json` and the moving draft. Put the second pause within the final 8s. QA uses stored word timings to require at least two internal gaps ≥.7s, one starting in the film's last 8s; it excludes opening lead and trailing hold. Missing word anchors fail this check. The kit has no semantic turn marker, so confirm that the beats actually follow the turn and precede the final line. Estimated anchors do not authenticate recorded silence; replace them with aligned timings when available. Preserve uploaded narration rather than resynthesizing it.

## Scene source and feed helpers

Use `example/feed-pyramid.py` with its matching JSON as the feed template. It demonstrates the large half-white pyramid acting on frame 0, a bright Giza terrace, distinct clause framings and a returning pose/light. Its 18s fallback timing is **estimated**, suitable for layout review only. Prepare the actual voice before production. Older bust/court examples remain usable for material tests, landscape or a different brief.

```python
from gilt import Film, Shot, Hook, loop_return
from stories import world as W

def opening_picture(p, phase, ctx):
    p.time = phase                       # Return the material light too.
    W.sky(p, phase, ctx.format, mode='bright', birds=False)
    # Draw the researched place/floor, then the large subject acting at phase 0.
    # Support negative phase so the final approach stays in motion.

def replay(p, t, ctx):
    phase = loop_return(ctx.shot.start+t, ctx.shot.end,
                        span=ctx.shot.end-ctx.shot.start)
    if phase is not None:
        opening_picture(p, phase, ctx)
    # Declare this shot's own sounds and ambience unconditionally.

# On the complete Film, alongside its normal shots:
# film = Film(shots, hook=Hook(('THE GREAT', 'PYRAMID', 'WAS WHITE')))
```

`Hook` uses 2–3 lines / 3–6 words, uppercases them, and defaults to 128px measured H cap height, 864px width, 10px dark outline, screen top 178px and a 2s life. Every line fits horizontally without losing cap height. It validates the outline-inclusive safe bounds: x=54..950, y=154..1536 at 1080x1920. It returns during the last .3s by default (`return_span`), suppressing duplicate automatic captions whenever active. Adjust `top`, `cap_height` (>=110), `width`, `fill`, `outline`, `hold` (1.8..2.2s) or `return_span` for clearance, then inspect. Coordinates are full-size **screen pixels**, scaled with the output, independent of stage/camera/light. Landscape ignores `Film.hook`.

For a story consequence or punchline, set `Hook(..., return_span=0)` and omit `loop_return`: end on the outcome. Use the replay helper only for a chosen `loop` whose last line changes the opening's meaning. The card's `ending_mode` controls the story QA loop requirement, not the drawing; author both consistently.

`loop_return(absolute_time, duration, span=.4, fps=30)` returns `None` before the closing window; inside it returns opening-local time from negative values to exactly zero on the **last encoded frame**. Render the opening geometry, ambient motion and light with that phase; do not clamp it to a still zero pose throughout the window. Match all scene state, not just the central prop. The hook returns independently above the picture. This helper cannot write a grammatical last/first sentence or guarantee an audible seam.

`draw(p,t,ctx)` receives local shot time. `ctx.cue(n)` is the zero-based clause start relative to this shot; `ctx.pose(t,n,a,b)` ticks a scalar from a to b at that cue. Clause and word start/end times stored on `ctx.clauses` remain absolute. For an exact estimated word cue, subtract `ctx.shot.start` from the chosen word's start. A camera callable also receives local shot time. Draw the ground first and foreground props/text last.

`tick(elapsed)` is zero before an event, then a fast damped overshoot (~five frames at 30fps) and settle. Preserve overshoot for rigid transforms; clamp it for enamel fills/reveals. Use independent riveted parts, meaningful gestures and prop interactions. Default travelling glints/pendulum movement are ambient life. They do not establish narrative action.

## Stage, formats and typography

For shared staging, keep essential action in the square 1080 core. Portrait sees `(0,-300,1080,1620)` at 1080x1920; landscape sees `(-420,0,1500,1080)` at 1920x1080. `Format(name,.5)` halves output pixel dimensions while keeping stage coordinates. Landscape extends sides and crops vertical margins; account for both intentionally. Use `ctx.format.name` for separate layouts when a shared scene leaves subjects small or the usable frame mostly ornamental. Grounds fill the union. Keep essential portrait action clear of the default caption clearance, stage y=920..1210, and avoid the rightmost 130 stage units below y=700. Important labels should sit inside both crops when sharing a layout; inspect only the formats requested.

Automatic portrait captions now use heavy sans-serif at **92px measured H cap height**, with a 10px dark outline, in phrase-local pairs/triples. Wide groups stack into two lines; only an unusually long single word condenses horizontally, preserving cap height. Their complete bounds stay within x=54..950 and above screen y=1510 (bottom-20% boundary 1536). `Format.caption_rect` reserves stage x=54..950, y=920..1210 for up to two lines; inspect actual glyph bounds and keep important action clear. `p.hide_captions=True` suppresses them for a shot-specific authored alternative. The hook already suppresses them during its opening and replay life.

Those are the retained feed defaults. With the prepared `story` profile (or `Film(profile='story')` for estimates), burned-in captions instead use bold white 64px measured H caps (3.33% of 1920px), a 7px dark outline and 1–4 words at a time, centred around screen y=1344 (70% of height). Active words stay white; captions follow stored speech anchors. Both profiles scale with the output and stay outside the camera/light transform. Inspect glyph height and speech sync, not just font size.

Hook and phone captions composite **after** material lighting and glints, outside shot-camera transforms. Existing `p.text`/`p.plaque` stay Cinzel and retain their material/camera treatment; landscape still has no automatic captions, and explicitly requested landscape captions keep the old drawing path. Use title/date plaques only when the landscape/long-form brief or a later useful label warrants them, never to open a feed Short.

Phone type uses installed Impact, Arial Black, Arial Bold, DejaVu Sans Bold or Liberation Sans Bold, in that order by platform availability. No proprietary font is bundled. It fails with an installation message if no heavy face is available; it never silently substitutes Cinzel. The bundled Cinzel and its OFL remain for other typography.

Give every narration clause a new large action or clearly different framing. A pendulum, smoke plume or moving light inside one long-held view can pass a motion tripwire while reading as a still picture. Check neighbouring half-second images and the moving draft at 270px wide. Preserve saturated enamel and quieter place cues; restrict ordinary scenes to about 5–6 enamels plus gold.

## Painter API

- `path(points,close=True)`: first pair moves, later pairs line, four values quadratic control/end, six cubic control/control/end. `ellipse(cx,cy,rx,ry=None)` and `rect(x,y,w,h,r=0)` return paths.
- `p.ground('scroll'|'gold'|'night', enamel='turquoise')`; `p.border()` draws the beaded format rim. `p.frame()` adds heavier margins; ensure it does not cover scenery.
- `p.cell(path,enamel,wire_w=5,reveal=1,fill=1,fill_origin=None)` paints a gold socket, glossy enamel and raised gold contour. Fill/reveal are 0..1.
- `p.wire(path,w=5,reveal=1)` draws gold wire; `p.gold(path,height=.65,texture='smooth'|'hammered')` draws plate.
- `p.cabochon(x,y,r,enamel,ry=None)` draws a domed gem; `p.rivet(x,y,r=7)` a mechanical joint; `p.beads(path,spacing=15,r=3)` repeated gold beads.
- `p.text(text,x,y,size=32,anchor='center'|'left'|'right',highlight=False)` uses baseline y; `p.plaque(text,x,y,enamel='onyx',size=32,width=None)` uses centre y.
- `p.pattern(path,kind='diamond'|'stripes'|'scales',spacing=52)` clips internal wire ornament.
- `p.crack(seed,path,progress=1,origin=None)` reveals deterministic graphic cracks. `p.shatter(draw_fn,bounds,seed,t,pieces=14,gravity=900)` separates clipped flat shards; it is not a physically thick fracture simulation.
- `with p.transform(translate=(dx,dy),rotate=degrees,pivot=(x,y),scale=1): ...` nests rigid transforms. `with p.clip(path): ...` clips both material surfaces.
- `p.sound(local_time,name,gain=1)` schedules a one-shot at the start of the pictured action. Choose a base name below; the mixer rotates its variants automatically. All names are lowercase letters. `film.py events` saves absolute `time` events; the mixer accepts both `time` and legacy `t`.
  - `tink`: small glass/gem contact; a cabochon, gold-wire joint or tiny object landing.
  - `clink`: single coin contact; one coin landing, a crown touching metal or a small rivet engaging.
  - `pour`: a short handful of coin contacts; coins spilling or a small shower of gold. This is not liquid; use `water` for that.
  - `crack`: rock fracture with a glass layer; a fissure opening in stone, a crown or an enamel face.
  - `whoosh`: short air movement; a flying prop, spear entry or fast transition.
  - `stamp`: wood impact and metal-latch contact; a seal stamping, decree landing or rigid mechanism closing.
  - `shatter`: glass breaking and falling fragments; an enamel object or crown separating into shards.
  - `spark`: tiny metal/glass contact cluster; a small tool contact or engraving tip. A designed accent, not an electrical recording. Decorative glints alone do not need foley.
  - `blade`: knife being drawn; a sword unsheathing or blade arriving near a figure.
  - `impact`: rock/wood strike with a damped resonant body; a heavy reveal, wall strike or cage landing.
  - `paper`: recorded paper handling; a map unfolding, scroll unrolling or document opening.
  - `draw`: a short pencil stroke; a route segment drawing, signature or name struck through. Use one per distinct visible stroke segment, not timer-driven repeats under narration.
  - `water`: short water splash; a ship entering water, wave-front action or water pouring. One-shot, not an ocean ambience loop.
  - `wind`: short air gust; flags moving or blowing sand. One-shot, not a continuous wind bed.
  - `bell`: recorded bell strike; a clock, warning or ceremonial beat.
  - `march`: four footfalls about .32 s apart (roughly 1.2 s total); use when this phrase matches a walking column. For separately timed contacts use `footstep`. Do not leave the rest of a long walk silent, or loop a march under stationary figures.
  - `footstep`: one recorded foot contact; time each call to a pictured step. Three independent takes.
  - `door`: recorded door opening/movement, two opening takes. Do not rotate these over an unrelated slam; use `stamp` for a rigid closure accent.
  - `cloth`: recorded cloth handling for a sleeve, garment, sail or hand moving against fabric. Three takes.
  - `creak`: recorded creaking contact for moving timber, a chest lid or a rocking ship's structure. Three takes; not a recording of an actual historical ship.
  - `hammer`: a single strike cropped from recorded metal hammering, three takes. Declare each pictured tool contact, not a loop while a smith stands still.
  - `grind`: ~1.8s hand-tool scrape phrases for visible wheel/contact work, three takes. These are stylized contact foley, not recordings of a nineteenth-century diamond wheel. Use the `workshop` bed across continuing work; accents follow actual contact changes.
  - `crowd`: three different performed speaking/shouting excerpts for a visibly reacting crowd. Not an emotion or language guarantee; do not put cheering/protest over passive visitors just because a crowd is present.
  - `cannon`: cannon-fire-labelled source, two edits; the second is a bandlimited 6% slower variant of the same take. Match a visible firing event, never a general history emphasis.
  - `hooves`: three excerpts of prop-performed horse-trot foley (jacket, bottle and hands per its author). Use for pictured hoof contacts/travel, not a claim of an animal field recording.
  Original names have three variants except `water`, `wind`, `bell` (two). New names have three except `door`, `cannon` (two). There are 25 one-shot names / 70 files. Exports are `work/sfx/<name>.wav`, `<name>-2.wav`, `<name>-3.wav`; use base names and let the mixer rotate them. Assets and per-file licence/hash provenance live in `assets/sfx/`; setup and `prepare` export them offline. For an existing narration, run `audio/sfx.py` alone without regenerating voice/timeline. Sound was measured and not listened to; the vocabulary describes source labels and intended use, not an audition.
- `p.ambience(local_time,name,duration,gain=.5,fade=.25)` declares a continuous bed range, in seconds. Use `p.ambience(0, 'sea', ctx.shot.end-ctx.shot.start)` for a whole shot or `p.ambience(ctx.cue(1), 'workshop', contact_duration, .4)` for part of it. Declare unconditionally on every drawing call, beside `p.sound()`. `events` converts the start to absolute time and retains duration; full renders retain it too. Film-level events may use `{"kind":"ambience","time":0,"name":"sea","duration":4,"gain":0.5,"fade":0.25}`.
  - `sea`: ocean-wave recording; four-second source. Use for a sea, harbour or ship scene.
  - `desert`: wind-pack texture for exposed sand or wind; no claim the source was recorded in a desert.
  - `hall`: designed interior crowd texture from three overlapping, low-passed performed-voice excerpts. Not a literal hall recording. Audition for recognizable words and suitability before publication when possible.
  - `market`: designed crowd/cloth/footfall texture; not an actual market field recording.
  - `workshop`: continuous recorded hand-tool scrapes for an active workbench; no electric drill layer. Appropriate only while work is happening.
  - `fire`: continuous wood-burning fireplace recording crop.
  - `rain`: rain recording crop. The source is explicitly not loopable; the mixer's overlap joins are required.
  - `battle`: designed performed crowd and filtered cannon layer for a distant battle in the pictured world. Do not use it under a peaceful crowd or a period before cannon.
  These eight beds export to `work/ambience/<name>.wav`. The mixer overlap-adds repeats with 250ms complementary joins (capped at a quarter of the source length). Each range fades at both edges; adjacent ranges extend half their fade across the shared boundary for a crossfade, clipped to film bounds. `fade=0` intentionally makes a hard range cut, while loop joins still crossfade. Beds begin at a conservative 22 LU below the voice reference before gain/ducking, and join the effects bus inside its existing 12 LU speech margin and the 10 LU combined-background margin. Overlapping beds never get a separate loudness budget. Gain uses the same clamped 0..1 convention as one-shots. Source beds are not silently downloaded at render time.

  Plan sound in both directions: every visible action gets matching foley, and every pictured place gets its ambience; no cue should match nothing on screen. A continuous texture can accompany a continuous action; a tiny opening accent cannot stand in for the rest of a long wheel or crossing. Repeat contacts with variants when the action repeats, not from an unrelated timer. Keep the hook's first words clear and put strong accents at phrase ends when the action permits. The mixer protects speech automatically; deleting nearly all foley is not a substitute for measured balance.
- `p.glint(x,y,size=20,intensity=1)` adds a star. `p.light_angle` optionally overrides orbital light; `p.sheen` is an optional stage-position highlight sweep.

All drawing is a pure function of time and stable seeds; no random frame noise or wall clock. Fills overwrite the materials below them, so draw back to front. Scene code uses Painter and geometry, leaving material-channel and shader internals alone.

## Production and checks

Use the main skill's command sequence. `sheet`/`still` never replace authoritative sound events. Draft `clip` likewise leaves the full-film event file intact. A complete `render` refreshes declarations; export `events` and rebuild `mix` after any narration or cue changes. `events` writes shot boundaries and prints/writes per-shot one-shot counts, ambience names and range coverage to `work/coverage-report.json`. Empty shots and missing/partial beds warn immediately. `film.py mix` synthesizes a seeded original celesta score, levels the narrator first, and limits music and summed effects (including all ambience) by measured loudness with advance speech ducking and opening-word protection. It targets -14 LUFS / at most -2 dBTP PCM, keeps the voice contribution within .5 LU of the master and writes `work/balance-report.json`; encoded AAC must remain at or below -0.8 dBTP. See [Keep the voice in front](../SKILL.md#keep-the-voice-in-front) for gain limits, cue placement and the explicit balance override. QA checks current mix inputs including ambience and compares encoded audio to that mix.

`-m gilt still story.py --format landscape --t 2 --out work/detail.png` makes a full-resolution still. `sheet` accepts `--n`, `--start`, `--end`, `--opening` and `--strict-feed`; video commands accept `--jobs`, `--scale` and `--audio`. Full-resolution CPU rendering is expensive; inspect samples/drafts before final exports. Parallel workers use lossless RGB intermediates and one final H.264 encode.

For the feed opening and replay pair:

```text
<py> -m gilt sheet story.py --format portrait --scale .5 --opening --strict-feed --out work/opening-sheet.jpg
<py> -m gilt still story.py --format portrait --t 0 --out work/frame-0.png
<py> film.py qa --story story.py out/film-portrait.mp4
```

`--opening` samples 0, .6, 1.2, 1.8, 2.4 and 3s, plus last and first frames. Portrait writes `.feed.json` alongside the existing `.world.json`; every shot still receives the world audit. It warns by default; `--strict-feed` fails unwaived feed checks. Authoring fallback clause timings are estimates, labelled as such. Inspect the sheet and a short motion draft; encoded QA remains required. Include `--audio work/mix.wav` on clips after mixing when playback/listening is available.

Portrait `film.py qa` selects `--profile feed|story`, then the prepared timeline's `profile`, then legacy feed; duration never selects it. Feed checks 15–20s total, lead <=.1s, first sentence <=2.1s (about 2s) and <=7 words, tail <=.15s; hook pixels on encoded frame 0 against the source `Hook`; a bright-background proxy (top 8% plus thin upper side fields, excluding type, median luma >=90/255 and dark fraction <=15%); and last/first pixels (mean error <=6/255 and 95th percentile <=24). Story replaces duration with 45–65s, lead with <=.5s and first-sentence end with <=5.5s, drops the word cap, and requires **2.9–3.4 narration words/s** over the encoded duration. It also requires **at least two internal word gaps ≥.7s**, with **one starting within the final 8s** (the turn/final-line proxy described above). `metrics.narration_beats` reports qualifying gap bounds, counts and the longest internal gap; missing or invalid word anchors fail. It requires nonempty `story-card.md` / `publish.md` in `film/` and a recognised plain `ending_mode` line in the card. Endpoint similarity is checked only for `loop`; other checks, including first-second movement, remain. WPS counts stored `spoken` (legacy `text` fallback), not captions, over encoded seconds. The first sentence uses timeline word bounds when display/spoken text agree, otherwise conservative whole-clause bounds. Missing timeline or Hook evidence fails. `--story` defaults to `story.py`.

QA writes `.feed.json` stating the profile, decoded `.frame-0.png`, `.last-frame.png` and a 270px-per-image `.loop.jpg` (boundary pair even for non-loops), alongside other encoded reports. Presence/timing checks cannot judge story quality, verify claim sources, recognise a subject, prove a payoff, authenticate voice timing, read arbitrary custom text, judge grammar or establish an imperceptible audio seam. Review pictures and, for loops, last-line/first-line audio.

Story commands, from a prepared working `film/` folder:

```text
<py> film.py qa --profile story --story story.py out/film-portrait.mp4
<py> -m gilt.feedcheck out/film-portrait.mp4 --profile story --story story.py --out work/story-profile.json
```

The second command is profile + first-second movement only, never voice generation; it reads stored narration, probes encoded duration and checks the two Markdown files. It does not replace full audio, decode, whole-film movement and coverage QA. `--out` writes the report; copy inputs to a scratch working kit to check an existing film without writing in its folder.

Landscape skips the feed profile. For a portrait lecture or another explicit non-feed brief, pass `--allow-feed-exception "Portrait lecture: requested long-form pacing"` on both the opening sheet and `film.py qa`. It records the reason and **all raw checks**, distinguishes accepted/waived from passed, and leaves motion, world, sound, audio/balance, duration provenance and decode checks intact. Blank reasons are rejected. Existing scripts still render; adapt a feed script rather than waiving weak work.

QA reports encoded duration/rate/ratio, audio presence/sync length, decode success, loudness, true peak and black/frozen stretches >=.4s. Opening change still requires two consecutive qualifying samples by 1s. Whole-film sampling compares .3s windows every .1s at a 480px long edge, excluding caption regions/margins (portrait 64–84% of height, including two-line captions) and subtracting uniform camera motion. Qualify with tracked support >=.6% plus a connected support cluster >=.15%, or a connected normalized-colour change >=3% (RGB distance >20). Tracks need >1.5px residual displacement, with a 6px neighbourhood. Authored shot cuts reset comparisons. Two consecutive observations establish a motion range; a gap >2s fails with shot/time in `.motion.json`, and 1–2s settles warn for review. These numbers are calibrated tripwires, not a motion score or a pacing recipe. A six-frame `.opening.jpg` accompanies whole-film contacts.

QA updates coverage from the encoded motion ranges: a moving shot with no nonzero sound declarations fails. Missing ambience, beds without action foley, and moving ranges not covered by a one-shot's duration +/- .35s warn (gaps >=.3s), with separate `silent_motion` and `unaccented_motion` ranges in `.coverage.json` / `work/coverage-report.json`. A bed can cover the place without voicing a particular action. Counts/proximity cannot prove matching sound, audible level or synchronization; music/narration do not count as foley. Small, slow, thin, fast periodic or masked actions can be missed, and moving scenery or within-shot cuts can pass. Pure camera travel can need visual judgment because registration subtracts it.

`qa --allow-still-opening <files>` records an opening waiver; `qa --allow-still-shot "shot_id=reason" <files>` records a deliberate long-hold waiver for that shot, repeatable. Failed raw measurements remain visible; other checks still apply. Inspect every scene and warning even when checks pass. State plainly when sound was measured and not listened to, without describing its perceived sound.
