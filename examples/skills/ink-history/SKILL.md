---
name: ink-history
description: Make original widescreen illustrated history-comedy videos with expressive white-faced characters, inked period sets, lively limited animation, comic explanation inserts and local voiceover. Includes a free local drawing, motion-check and production kit.
---

# Illustrated history comedy

Make a finished narrated MP4 at **1920×960, 60 fps**. Draw an original film in code: big white bean heads, confident dark contours, saturated colour, hard cel shadows, perspective period sets and narrator-led visual jokes. The supplied v2 kit is an editable drawing vocabulary, not a stock-scene template. A video with unchanged generic people standing on one repeated set does not meet this skill's aim. Motion is on by default and the finished video must stay alive; see [Keep it alive](#keep-it-alive).

Read [visual direction](references/visual-direction.md) before designing the film and [the code contract](references/kit-contract.md) when authoring it. The complete worked film is `kit/example/story.mjs`; read it to understand timing and staging, then write a different story, cast and sets.

Open [the original look sheet](assets/look-sheet.png) as an image before drawing. It shows the kit's intended head scale, shadow shapes, staging and insert treatment using original example art. Use it to calibrate craft, not as a cast or set to repeat. It is a working baseline, not a claim that the kit equals a professional reference artist.

## Optional Gemini narration

When `GEMINI_API_KEY` is present and neither the user nor Moco's narration preference chose another engine, use the kit's Gemini helper through `voice: {engine: 'gemini', name: 'Charon', style: 'dryly amused'}` in the story; omit `name` to use `MOCO_GEMINI_TTS_VOICE`, then Charon. Otherwise keep the current local voice, and uploaded narration (`prepare --voice`) always wins. Put delivery directions only in `voice.style`, never in `say`; `kit/gemini_tts.py` calls Google's Gemini Flash TTS with the user's billed key and never reads `GOOGLE_API_KEY`. Use `setup.py <film> --tts gemini` to skip local voice downloads; then the existing prepare command caches each clause at 24 kHz, trims/measures the actual audio and preserves the ordinary timing/review path. A missing key gives a clear fallback message: choose the existing local engine or an upload rather than guessing credentials. Never print the key or put it in story/config files.

## Story and voice

Use the user's subject, length and voice choice. If absent, default to an original historical fable of about 50 seconds and free local Kokoro speech. Ask only for essential missing choices; existing authorization to proceed is enough. Give the script and a short visual plan for approval only when the user requested approval or has not authorized making the film. Label a fictional tale briefly in the film and in delivery. Verify real historical claims before presenting them as fact.

Aim for roughly 2.7–3 words per second including reaction holds. Start with a contradiction, explain one mechanism, escalate it physically, end with a short reversal. Write clauses around the words that trigger a pose, a cut or a reveal. Do not fill the film with captions repeating the narration. Keep the cast and jokes original. Never trace or ship a reference's footage, artwork, script, voice, music, recurring hosts, logos or signature costumes.

Use an uploaded recording without changing its speed or pitch. Obtain its transcript if needed. The kit can estimate clause boundaries from silences, but you must listen/check and correct them; it does not recognize speech. Free TTS is a fallback, not a copy of a human narrator's performance. No paid model, media service or API is needed.

Optional expressive local voices: set `voice.engine` to `'zonos'` (Zyphra transformer: emotion, speaking rate and pitch conditioning) or `'dia'` (Nari Labs: `[S1]`/`[S2]` dialogue and `(laughs)`/`(sighs)` tags). Omit `engine` for the existing Kokoro voice; its example/default audio processing is unchanged. Install only the engine the user chooses. See [local voice options, licence pins and long-film consistency](references/local-voices.md) before using either expressive engine. Neither needs a paid model, media service, API key or subscription.

For a 12–18 minute film, audition a few clauses first. Reuse one fixed speaker reference/prompt and base seed throughout; do not generate a new voice per shot or chain each clause into the next. The kit caches a generated anchor if none is supplied. Prefer a clean, authorized 5–10 second reference and, for Dia, its exact tagged transcript. Keep clauses short enough for each engine's context, listen for missing/repeated words and speaker drift, then time pictures from `prepare`. The kit rejects silent/implausibly short output and tries two deterministic seed variants with the same anchor before failing. A seed/prompt improves consistency but cannot guarantee a perfect performance across hundreds of clauses.

Dia narration also receives an empty next-speaker ending tag by default to help it finish the last word; explicit ending tags are preserved. `voice.ending_hint: false` opts out. This affects model input while preserving creative narration text and cue names. Prefer complete utterances: very short Dia fragments can still sound unnatural.

For an unwanted long performance on one fragment, use `voice.clause_ending_hints: { 'shot-id:0': false }` (zero-based clause index), then run `prepare` and preflight again. The fixed speaker anchor and other clause caches are reused.

For a targeted Zonos/Dia retake, `voice.clause_seeds: { 'shot-id:0': 218 }` changes that clause's fixed seed while retaining the base-seed anchor and other clips. Audition retakes for missing words, added dialogue and inconsistent delivery.

## Working copy

Locate this skill's actual directory. In moco it is under `.agents/skills/ink-history/` or `.claude/skills/ink-history/`. Import the **entire folder**, including `kit` and `references`.

Run `python <skill>/kit/setup.py <workspace>/film` (`python3` may be needed on macOS/Linux). It requires Python 3.10+ and Node 22+, installs Canvas and a Python venv, finds or installs FFmpeg/ffprobe and caches the free local Kokoro model. Choose `--tts kokoro|zonos|dia|none`; `--no-tts` remains an alias for `none`, and `--models <folder>` reuses the two Kokoro downloads. Zonos/Dia need Python **3.10–3.12** and install their pinned torch dependencies only when selected, in the same venv. Rerun setup to add another engine; the story selects among installed engines. `--device auto` selects CUDA only with at least 6 GB VRAM, otherwise CPU with a clear speed warning; `--device cpu|cuda` overrides the selection. Windows uses prebuilt wheels and a bundled/located eSpeak NG DLL for Zonos; macOS/Linux instructions are in the voice reference. CPU is usually impractical for a full long film. Setup prints the exact venv Python; use it directly in every later command. In PowerShell a quoted executable needs `&` before it. Setup can resume and preserves existing creative files and previously configured engines. It never copies another machine's config or environment.

Keep the imported skill intact. Write your new `film/story.mjs`, plus any custom drawing modules, in the working copy; import `./index.mjs`. Put a short `film/PLAN.md` beside it with narration, shot/action, camera, expression changes and sound. Design at least three distinct original silhouettes for a crowd story. Mix large overlapping two-shots, tight reactions, full figures, a furnished interior, a perspective exterior and a story-specific explanation insert. A short film need not exhaust that list, but avoid one composition repeated in different colours.

## Draw

The drawing is your work. Start with `design()` and per-shot `figure()` poses, then add new shapes through the head/garment hooks and the path functions. Change the combinations of eyes, brows, mouth, gaze, head turn, body lean and hand placement whenever the thought changes. Make missing sets and props by drawing them, rather than substituting an unrelated built-in prop or inventing an unsupported keyword. See the contract for coordinates and worked extensions.

Check that each visual claim is actually drawn: if narration says a wardrobe is carried, show a recognizable wardrobe held and displaced; if an object becomes a coat rack, draw coats hanging on it. A new label, nearby prop or sound effect cannot stand in for the action. Reusing one `action()` helper across shots produces repeated acting even when the words differ. Share design/geometry helpers, but author each shot's before-and-after pose and visible mechanism separately. Distinguish hats/hair by silhouette, not just the height or colour of one shared hat path.

The setting needs a perspective space, a motivated light source, a large diagonal shadow, a cropped foreground element and objects belonging to this story. Use `scenery` as a base and furnish/repaint it. Give scenes different angles and depth; don't leave all architecture parallel to the screen. White faces must have a mauve shadow crescent and cast shadows from hair/hats. Use purposeful asymmetry in clothes, hands, props and framing. No sepia wash, paper-grain overlay, stick limbs or tiny centred actors.

Finish visible surfaces: a large coat needs tailoring and a few gesture-aligned folds/angular shadow planes, rather than an empty coloured torso. A paper insert needs a convincing edge, fold/curl, seal or impression and cast shadow, rather than a rectangular caption card. A tight reaction is worth a custom mouth/eyelid drawing and hand gesture. Choose the details that support this shot's story; adding more generic props does not replace drawing its focal subject well.

## Keep it alive

A held drawing is normal in this format; a held *shot* is not. The kit gives every shot a quiet base of life and expects you to put authored events on top of it. All automatic motion is a pure function of shot time and a stable identity (no `random()`, wall clock or frame history), so stills, clips, parallel workers and the final render agree.

**What you get with no code.**

- Principal figures breathe, shift weight, tilt the head, blink on their own schedule, dart their eyes and make an occasional free-hand accent timed near clause cues. Accents skip held or aimed hands, seated/leaning/attached poses and protected expressions (deadpan, wavy, shocked "o", tongue, teeth and similar).
- **Feet stay planted.** A figure whose feet are on screen keeps its soles fixed; only the lean, head and breath move. For an authored jump or airborne pose, set `grounded:false`. Only the shot's subject (the largest principal figure, or `subject:'id'` on the shot) floats, by a few pixels with rests, and only when it is a bust or cropped figure. Give principals an `id`.
- Places add their own loops: drifting clouds, swaying trees/grass/cloth, water shimmer, flickering lamps, candles and fire, twinkling stars, a few birds, dust or leaves. A street crowd is opt-in (`crowd:true`).
- Props and labels arrive with a short pop and settle. Text stays rigid after a ≤5-frame pop; it never wobbles, rotates or scales continuously.
- Cameras get a seeded gentle pan/push/pull and are kept inside the painted set. Board, map, insert and title cameras are speed-limited (about 22 px/s, 1.8 %/s zoom, 0.3°/s roll) so text stays readable. Insert and title shots rise or slide in and out at their edges.
- `beats()` pose swaps keep the dip-and-pop, plus a tiny settle.
- **Lip sync is opt-in.** The narrator is off screen, so figures do not mouth narration. Authored eyes, brows and mouths are never overwritten (see the contract for `speaker`, `speaking` and protected mouths).

**What still needs your choreography.** Defaults make a picture breathe; they cannot make it *do* what the narration says. They will not redraw a map, sign a charter, carry a bucket or make a listener react. Give each of these an authored event on a clause cue, using the cue as a starting point and not as word alignment (a cue is a clause start):

- Scenes: swap the drawing on the thought (`beats` at `s.cue(n)`), act on a prop, or react.
- Maps, boards, documents, text cards: reveal, write, drop, route or erase items on cues with `cue()`, `onCue()`, `cueBeats()`, `shot.groups`, `bd.region/cast/sign/marker/place/route`, `bd.sketch({at,until})` and `pr.document/paper/stamp/coins/arrow`.
- Custom artwork drawn from raw `cel`/`blob` calls (busts, ships, documents, routes) is just a picture. It receives the stage-level entrance and, if wrapped in `alive()`, a small group float. Its parts act only if you split them into parts and give each its own `at`. The defaults alone do not rescue an older story full of such inserts; expect it to fail the gate until it gets cue-driven events.

```js
import { figure, beats, cue, onCue, cueBeats, alive, props as pr, board as bd } from './index.mjs';

// Map shot: things arrive on clause starts. Cues are clause timings, not forced word alignments.
{ id: 'split', kind: 'map', say: ['Two cousins.', 'One crown.', 'Neither would yield.'],
  set: c => { bd.sea(c); bd.land(c, LAND); },
  draw(c) {
    bd.region(c, NORTH, { fill: '#c33', at: cue(1) });
    bd.cast(c, king, 700, 520, 260, { at: cue(1, .3), id: 'north king', eyes: 'glare' });
    bd.place(c, 'NORTH', 760, 700, { at: cue(1, .5), pin: true });
    bd.route(c, [[700, 520], [1000, 460], [1250, 520]], { at: cue(2) });
  } }
// Insert shot draw(c): rows write on, then a seal and a stamp land.
pr.document(c, 960, 500, 2.2, { title: 'CHARTER', rows: ['TRADE', 'IN ALL', 'THINGS'], at: cue(0), sealAt: cue(2) });
pr.stamp(c, 800, 700, 1, { text: 'MONOPOLY', at: cue(2, .2) });
// Any other item: draw: cueBeats(null, [[cue(0), cc => drawA(cc)], [cue(1), cc => drawB(cc)]])
```

**Opt-outs.** `life:false` (or `still:true`) on a story, shot, design, pose, place, prop, label or `painted()` call stops *automatic* motion in that scope; authored beats, cues and cameras still run. `camera:false` holds the camera while the content lives. Figures also take `idle`, `gesture`, `eyeDarts`, `autoBlink` and `float:false`; places take `ambient:false`. Use these where you have authored the motion yourself. A fully frozen stretch longer than 0.5 s fails the gate however it was produced.

**Motion preflight (required before `render`).** Rendering at 1920×960×60 is slow; check motion first with the fast silent draft (960 px, 12 fps, camera-compensated, the same gate as the final):

```text
<py> film.py motion story.mjs --out work                 # whole film
<py> film.py motion story.mjs --out work --shot well     # or --start 10 --end 20, --jobs 4
```

It needs no voice model, stills or review. Run `prepare` first so cues match the real voice; without it timing is estimated from word counts. It writes `work/motion-preflight/motion-report.json` and `motion-timeline.png`, listing failing windows (worst first) with shot names and timecodes. Run it before writing `review.json`, because fixes change the source and invalidate the review. The final `film.py render` then measures the *encoded* file with the same constants (`work/motion-report.json`, `qa.json`); that result is the authority, so a preflight pass is a prediction, not a pass.

The gate measures content motion after removing global camera motion; raw frame difference cannot separate a held drawing under a camera move from acting. Fail rules (constants; not story options):

- stale time (frozen or camera-only drift) ≤ 10 % of the film; acting ≥ 50 %
- longest stale run ≤ 2.0 s; longest fully frozen run ≤ 0.5 s
- ≥ 2.3 content events per 10 s; no gap between events > 5.0 s (cuts and film edges included); every shot ≥ 3 s has an event
- warning only: a shot ≥ 3 s that is > 40 % stale

**Fix the source and re-run.** Do not lower thresholds, pass `--motion-*` overrides, exempt a hold, label a shot something else, or declare events (`declareEvent`, `shot.events`) that the picture does not perform; declarations only quiet an audit warning. Do not buy a pass with extra float, mouth flapping or blinks: the gate cannot judge meaning. For every failing or suspicious window, and for the hardest cases (inserts, maps, boards, document and bust close-ups, dialogue and reaction holds, wide shots), open `node render.mjs strip story.mjs work <shot-id> <from> <to>` and check that what the narration says visibly *happens* at the cue.

## Check, review, render

Production commands (use the Python printed by setup):

```text
<py> film.py prepare story.mjs --out work
<py> film.py stills story.mjs --out work
<py> film.py motion story.mjs --out work
node render.mjs frame story.mjs work <shot-id> cue2 end
node render.mjs strip story.mjs work <shot-id> 0 2
node render.mjs clip story.mjs work <shot-id>
```

For uploaded speech: `prepare ... --voice <recording> [--timings work/clause-times.json]`. Keep the original recording unchanged. After a narration, voice or pause change, run `prepare` again; unchanged TTS clauses are cached. Drawing-only revisions reuse the voice timeline.

**Open and visually inspect every contact-sheet page**, not just the first one. Open full-size stills for text, hands, overlapping faces and the weakest background. Inspect action extremes and at least one short clip/filmstrip: pose swaps should dip and pop in about .12–.2 seconds, not glide like a puppet; feet must not slide; an opted-in speaker's mouth steps between drawings at about 12 Hz, listeners never lip-sync, and authored expressions survive. A slow camera drift supports the acting, and cannot replace it.

Fix all `audit.json` issues at the source. Do not lower thresholds, fake measurements, hide important actors with `extraFigure`, or label a character scene an insert to bypass gates. `wide:true` is for intentional vistas, not a cure for undersized faces. Treat the gates as a floor: they cannot judge style, story logic, meaningful movement, anatomical tangles or set craftsmanship. `audit.json` warnings about a map, board or insert with no declared timed events deserve the same fix as a motion failure.

Only after looking, write `work/review.json`:

```json
{"inspected":true,"sheetSignature":"<contents of work/stills-signature.txt>","observations":"Specific things you actually saw; identify the weakest shot, its framing/acting/set, and changes made. State any remaining limitation."}
```

Run `stills` and inspect again after drawing changes. The review must refer to the current sheet. Then:

```text
<py> film.py render story.mjs --out work --name film.mp4
<py> film.py qa story.mjs --out work --name film.mp4
```

Rendering mixes original synthesized music/effects with narration, normalizes to −16 LUFS and checks the encoded file for audio, size/rate, black/frozen/empty frames, framing, readable text and the motion gate above. Inspect `work/final-sheet.jpg` (frames extracted from the actual MP4) and listen to the mix before delivery. Also extract short strips from the **encoded MP4** covering quiet shot endings, document/diagram holds and complete text entrance/hold/exit trajectories. Confirm visible content changes within 2 s and keep important text clear long enough to read: interpolation shimmer or an accelerating camera can fool a pixel detector even when the numbers pass. Voice must remain clear above music; effects punctuate actions, not every word. Repair the cause of a failed check (for a motion failure, the held window or missing event in the source) and re-render. A technically passing file is not proof of a visual match.

## Delivery

Hand the finished MP4 and contact sheet to the user through the host's file-delivery tool when available (no provider-specific name is required by this skill). Otherwise give file paths. In moco copy final deliverables into `outbox/` if useful and use its file hand-off; keep the source, review and QA in the project. Report duration, voice source, fiction/fact status, the motion-gate result from the encoded file (not the draft preflight) and any craft limitations honestly. Do not call it a frame-for-frame or same-hand match unless actual side-by-side pictures justify that claim.

Keep the reusable skill clean: source, assets and instructions only. Do not import or redistribute dependencies, venvs, config paths, voice caches, reference media, production outputs or review records as part of the skill.
