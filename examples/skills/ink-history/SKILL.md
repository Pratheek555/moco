---
name: ink-history
description: Make original widescreen illustrated history-comedy videos with expressive white-faced characters, inked period sets, limited animation, comic explanation inserts and local voiceover. Includes a free local drawing and production kit.
---

# Illustrated history comedy

Make a finished narrated MP4 at **1920×960, 60 fps**. Draw an original film in code: big white bean heads, confident dark contours, saturated colour, hard cel shadows, perspective period sets and narrator-led visual jokes. The supplied v2 kit is an editable drawing vocabulary, not a stock-scene template. A video with unchanged generic people standing on one repeated set does not meet this skill's aim.

Read [visual direction](references/visual-direction.md) before designing the film and [the code contract](references/kit-contract.md) when authoring it. The complete worked film is `kit/example/story.mjs`; read it to understand timing and staging, then write a different story, cast and sets.

Open [the original look sheet](assets/look-sheet.png) as an image before drawing. It shows the kit's intended head scale, shadow shapes, staging and insert treatment using original example art. Use it to calibrate craft, not as a cast or set to repeat. It is a working baseline, not a claim that the kit equals a professional reference artist.

## Story and voice

Use the user's subject, length and voice choice. If absent, default to an original historical fable of about 50 seconds and free local Kokoro speech. Ask only for essential missing choices; existing authorization to proceed is enough. Give the script and a short visual plan for approval only when the user requested approval or has not authorized making the film. Label a fictional tale briefly in the film and in delivery. Verify real historical claims before presenting them as fact.

Aim for roughly 2.7–3 words per second including reaction holds. Start with a contradiction, explain one mechanism, escalate it physically, end with a short reversal. Write clauses around the words that trigger a pose, a cut or a reveal. Do not fill the film with captions repeating the narration. Keep the cast and jokes original. Never trace or ship a reference's footage, artwork, script, voice, music, recurring hosts, logos or signature costumes.

Use an uploaded recording without changing its speed or pitch. Obtain its transcript if needed. The kit can estimate clause boundaries from silences, but you must listen/check and correct them; it does not recognize speech. Free TTS is a fallback, not a copy of a human narrator's performance. No paid model, media service or API is needed.

## Working copy

Locate this skill's actual directory. In moco it is under `.agents/skills/ink-history/` or `.claude/skills/ink-history/`. Import the **entire folder**, including `kit` and `references`.

Run `python <skill>/kit/setup.py <workspace>/film` (`python3` may be needed on macOS/Linux). It requires Python 3.10+ and Node 22+, installs Canvas and a Python venv, finds or installs FFmpeg/ffprobe and caches the free local Kokoro model. `--no-tts` skips the model for uploaded speech; `--models <folder>` reuses a model download. Setup prints the exact venv Python; use it directly in every later command. In PowerShell a quoted executable needs `&` before it. Setup can resume and preserves existing creative files. It never copies another machine's config or environment.

Keep the imported skill intact. Write your new `film/story.mjs`, plus any custom drawing modules, in the working copy; import `./index.mjs`. Put a short `film/PLAN.md` beside it with narration, shot/action, camera, expression changes and sound. Design at least three distinct original silhouettes for a crowd story. Mix large overlapping two-shots, tight reactions, full figures, a furnished interior, a perspective exterior and a story-specific explanation insert. A short film need not exhaust that list, but avoid one composition repeated in different colours.

## Draw, inspect, revise

The drawing is your work. Start with `design()` and per-shot `figure()` poses, then add new shapes through the head/garment hooks and the path functions. Change the combinations of eyes, brows, mouth, gaze, head turn, body lean and hand placement whenever the thought changes. Make missing sets and props by drawing them, rather than substituting an unrelated built-in prop or inventing an unsupported keyword. See the contract for coordinates and worked extensions.

Check that each visual claim is actually drawn: if narration says a wardrobe is carried, show a recognizable wardrobe held and displaced; if an object becomes a coat rack, draw coats hanging on it. A new label, nearby prop or sound effect cannot stand in for the action. Reusing one `action()` helper across shots produces repeated acting even when the words differ. Share design/geometry helpers, but author each shot's before-and-after pose and visible mechanism separately. Distinguish hats/hair by silhouette, not just the height or colour of one shared hat path.

The setting needs a perspective space, a motivated light source, a large diagonal shadow, a cropped foreground element and objects belonging to this story. Use `scenery` as a base and furnish/repaint it. Give scenes different angles and depth; don't leave all architecture parallel to the screen. White faces must have a mauve shadow crescent and cast shadows from hair/hats. Use purposeful asymmetry in clothes, hands, props and framing. No sepia wash, paper-grain overlay, stick limbs or tiny centred actors.

Finish visible surfaces: a large coat needs tailoring and a few gesture-aligned folds/angular shadow planes, rather than an empty coloured torso. A paper insert needs a convincing edge, fold/curl, seal or impression and cast shadow, rather than a rectangular caption card. A tight reaction is worth a custom mouth/eyelid drawing and hand gesture. Choose the details that support this shot's story; adding more generic props does not replace drawing its focal subject well.

Production commands (use the Python printed by setup):

```text
<py> film.py prepare story.mjs --out work
<py> film.py stills story.mjs --out work
node render.mjs frame story.mjs work <shot-id> cue2 end
node render.mjs strip story.mjs work <shot-id> 0 2
node render.mjs clip story.mjs work <shot-id>
```

For uploaded speech: `prepare ... --voice <recording> [--timings work/clause-times.json]`. Keep the original recording unchanged. After a narration, voice or pause change, run `prepare` again; unchanged TTS clauses are cached. Drawing-only revisions reuse the voice timeline.

**Open and visually inspect every contact-sheet page**, not just the first one. Open full-size stills for text, hands, overlapping faces and the weakest background. Inspect action extremes and at least one short clip/filmstrip: pose swaps should dip and pop in about .12–.2 seconds, not glide like a puppet; mouths step between drawings at about 12 Hz; listeners do not lip-sync. A slow camera drift supports the acting, and cannot replace it.

Fix all `audit.json` issues at the source. Do not lower thresholds, fake measurements, hide important actors with `extraFigure`, or label a character scene an insert to bypass gates. `wide:true` is for intentional vistas, not a cure for undersized faces. Treat the gates as a floor: they cannot judge style, story logic, meaningful movement, anatomical tangles or set craftsmanship.

Only after looking, write `work/review.json`:

```json
{"inspected":true,"sheetSignature":"<contents of work/stills-signature.txt>","observations":"Specific things you actually saw; identify the weakest shot, its framing/acting/set, and changes made. State any remaining limitation."}
```

Run `stills` and inspect again after drawing changes. The review must refer to the current sheet. Then:

```text
<py> film.py render story.mjs --out work --name film.mp4
<py> film.py qa story.mjs --out work --name film.mp4
```

Rendering mixes original synthesized music/effects with narration, normalizes to −16 LUFS and checks the encoded file for audio, size/rate, black/frozen/empty frames, framing and readable text. Inspect `work/final-sheet.jpg` (frames extracted from the actual MP4) and listen to the mix before delivery. Voice must remain clear above music; effects punctuate actions, not every word. Repair the cause of a failed check and re-render. A technically passing file is not proof of a visual match.

## Delivery

Hand the finished MP4 and contact sheet to the user through the host's file-delivery tool when available (no provider-specific name is required by this skill). Otherwise give file paths. In moco copy final deliverables into `outbox/` if useful and use its file hand-off; keep the source, review and QA in the project. Report duration, voice source, fiction/fact status and any craft limitations honestly. Do not call it a frame-for-frame or same-hand match unless actual side-by-side pictures justify that claim.

Keep the reusable skill clean: source, assets and instructions only. Do not import or redistribute dependencies, venvs, config paths, voice caches, reference media, production outputs or review records as part of the skill.
