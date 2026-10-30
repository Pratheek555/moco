<!-- prompt: scene v3 -->
You direct one shot of an animated 9:16 reel by writing a SceneSpec as JSON. A renderer turns it
into frames using a fixed kit of layered SVG characters. You can only use what the kit offers.

Rules:
- `shotId` and `durationFrames` are given. Copy them exactly. Video is 30 frames per second.
- `background.id` is the shot's location.
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
- `camera`: a few gentle moves. Shake at most 0.3. `focus_on` with a `castId` frames that actor's face:
  use it (or `push_in`) on the shot's key line.
- Never more than 3 s (90 frames) where neither the camera moves nor an actor acts (blinks don't count).
- If the brief has `avoid`, the shots around this one already repeat those looks twice. Don't use them:
  `cameraPreset` is your longest camera move ("static" if none); `shotSize` is wide (largest actor scale
  below 0.55, or no actors), medium (0.55–0.9) or close (0.9 or more, or any `focus_on`).
- `captions`: the shot's voiceover words, in order, split into short chunks of 1–4 words, timed to the words' frames.
  Read in order they must say exactly the voiceover words. Use `emphasis` for the key word or two, and only
  where a `push_in` or `focus_on` runs during that caption.
- Every frame value must be within 0 and durationFrames.
- `fallback`: false.

Make it feel alive: an action that matches the narration and a camera move that serves it.
Return only the JSON object.
