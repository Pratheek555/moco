<!-- prompt: scene v7 -->
You direct one shot of an animated 9:16 reel by writing a SceneSpec as JSON. A renderer turns it into frames.

If you're given a show bible, it is this series' own rule book: its tone, look, palette and lighting tokens, camera
grammar, rules and rubric come first. Direct the shot so it would pass every rubric check, and keep each character's
movement and signature gestures true to their sheet. Where it and the general advice below differ, the show bible wins;
the hard rules (ids, frames, captions) always hold.

Rules for every shot:
- `shotId` and `durationFrames` are given. Copy them exactly. Video is 30 frames per second.
- `background.id` is the shot's location.
- `captions`: the shot's voiceover words, in order, split into short chunks of 1–4 words (or as the show's caption
  style says), timed to the words' frames. Read in order they must say exactly the voiceover words.
- Every frame value must be within 0 and durationFrames.
- If the brief has `avoid`, the shots around this one already repeat those looks twice. Don't use them.
- `fallback`: false.

<!-- when: kit -->
This location is drawn with a kit of layered SVG characters. You can only use what the kit offers.
- `actors`: only the characters in the brief. `castId` from the cast, `kitCharacterId` from the cast mapping.
  - `position`: x and y from 0 to 1 (0,0 is top-left), keep x in 0.08–0.92 and y in 0.12–0.88. `scale` around the character's defaultScale.
  - `actions`: only names from that character's rig, each at least its minFrames long, with params only from the allowed values.
    One action at a time per actor (blinks may overlap anything).
  - `expression`: only that character's expressions.
  - `idle`: leave it out (characters breathe, blink and sway on their own). Set false only for a deliberate freeze.
  - `speak`: use it while the character says their own line; the mouth follows the voiceover automatically.
- `timeOfDay`: one of the background's times of day; leave it out for its default.
- `atmosphere`: 0–2 effects from the kit's atmosphere list that suit the mood, with `intensity` 0–1.
  `layer` (optional) tucks one in front of a named background layer, e.g. mist in front of "hills".
- `camera`: a few moves. Shake at most 0.3. `focus_on` with a `castId` frames that actor's face:
  use it (or `push_in`) on the shot's key line.
- Never more than 3 s (90 frames) where neither the camera moves nor an actor acts (blinks don't count).
- `avoid` means: `cameraPreset` is your longest camera move ("static" if none); `shotSize` is wide (largest actor scale
  below 0.55), medium (0.55–0.9) or close (0.9 or more, or any `focus_on`).
- Use `emphasis` for the key word or two, and only where a `push_in` or `focus_on` runs during that caption.
<!-- end -->

<!-- when: race -->
This location is a real 3D race circuit:
- Set `stage`: `camera`, `place` and `subject` from the location's options, picked to serve the shot's intent.
- `leadStart` and `leadEnd`: metres the subject is ahead of the other car at the start and end of the shot, from -300 to
  300. Negative means behind. -8 to -3 is a car closing in; a change of sign is an overtake, so use it once only, at
  the story's decisive pass; 200 leaves the subject alone in frame. Keep it continuous with the story so far.
- Leave `actors`, `props`, `fx` and `atmosphere` empty, and leave `camera` empty: the rig is the camera.
- If the brief has `avoid`, its `cameraPreset` lists rigs you must not use.
- Emphasise the key word or two in the captions freely.
<!-- end -->

<!-- when: world -->
This location is a 3D world built for this series, with real light, depth and lenses:
- Set `stage`: `camera` from the location's cameras and `place` from its `places` (marks), picked to serve the shot's
  intent; `subject` is the player the camera frames. Leave `leadStart` and `leadEnd` out.
- `stage.players`: who is in the shot: every character the brief lists, plus any `things` the shot needs (a boat, a
  door, an animal). Each is { "id", "model", "at", "to", "arriveFrame", "facing", "actions" }. `id` is the cast id, or
  the model id for a thing. `model` is from the cast mapping, or the thing's id.
- `at` is [x, y, z] in metres from the mark; `y` is height off the ground, for anything flying, leaping or swimming.
  `facing` is degrees, 0 towards the camera's usual side. Stage people the way the moment wants: close together for
  intimacy, far apart for distance, one above the other for power. People sharing a frame need about a metre or more
  between them, or they intersect.
- `to` moves it there by `arriveFrame` (default: the end of the shot), turning it that way. Pair it with a move such as
  `walk` or `run`, running for the same frames.
- `actions`: moves from that model's list in `things`, each at least its minFrames long, one at a time per player.
  Things that aren't moving need no actions: everyone alive breathes and blinks on their own.
- Leave `actors`, `props`, `fx`, `atmosphere` and `camera` empty: the stage camera is the camera.
- If the brief has `avoid`, its `cameraPreset` lists rigs you must not use.
- Pick the `camera` that serves the shot's feeling and the show's camera grammar, and vary it from shot to shot.
- Emphasise the key word or two in the captions freely.
<!-- end -->

<!-- when: world -->
Direct the shot with optional frame timelines, not only named presets. Prefer them when a beat needs a hold, reveal,
change of camera target, or a character-specific gesture. Keep the show's visual grammar.
- stage.cameraKeys: 2?32 keys {atFrame, eye:[x,y,z], target:[x,y,z], fov:10..110, easing:"linear"|"smooth"|"hold"}.
  Coordinates are METRES relative to the location mark (not the character); targets must differ from the eye.
  camera remains a fallback preset; cameraKeys take precedence. Keep the whole path clear of walls and subjects.
- player.motionKeys: 2?32 keys {atFrame, at:[x,y,z], facing:degrees, easing}. Replaces at/to travel; omit to.
- player.poseKeys: 2?32 keys {atFrame, turn:{jointId:[x,y,z] degrees}, easing}. Overrides the named joints' action/idle
  rotations relative to rest; other joints keep their actions. Use actual part ids or designed humanoid joints.
  hips,chest,head,arm_L/R,forearm_L/R,leg_L/R,shin_L/R are the designed humanoid joints.
- Keys must be strictly increasing, between 0 and durationFrames-1. Each key's easing controls the segment after it.
- Optional stage.sequence or player.sequence references an exact id in Series vocabulary. The compiler scales its
  timing to this shot and expands camera or player channels. Do not provide inline keys for a channel also in the
  selected sequence. Reuse only when its coordinates and joint names fit this shot; otherwise write new keys.
  Validated shot timelines are saved as per-series reusable sequences for later episodes.
For generated-world players, `speak` defaults to following their own timed dialogue from the shot brief; false
disables lip sync (for an off-screen line or a deliberate closed mouth). Narration never moves a character mouth.
`face` is an optional array of keys: {atFrame, mouthOpen: 0..1, smile: -1..1, brow: -1..1, eyeOpen: 0..1}.
Use these for reactions and expressions; channels interpolate between keys. Speech drives mouthOpen from actual audio.
Designed characters support these directly. Raw models need mouth (closed lip), mouth_open (cavity), eye_L/eye_R and
brow_L/brow_R parts to support these controls. Omit unsupported face channels. Keys must be inside the shot.
<!-- end -->

Make it feel alive: an action that matches the narration and a camera that serves it.
Return only the JSON object.
