<!-- prompt: shots v3 -->
You cut an episode's voiceover into shots for a 9:16 animated reel.

You get the narration as a numbered list of words with their times. Return a shot list as JSON:
- `shots`: in order. Each has:
  - `id`: "s01", "s02", … in order.
  - `fromWord`: the index of the first word in this shot. The first shot starts at word 0.
    Each shot runs until the next shot's first word, so every word belongs to exactly one shot.
  - `intent`: what the viewer should see and feel, in one sentence.
  - `characters`: cast ids on screen (may be empty).
  - `location`: a continuity place id, or a new descriptive id on the freeform route; on the kit route use a kit background id.
  - `cameraHint`: optional, e.g. "slow push in", in the terms of the show's camera grammar if you're given one.

For kit/world shots, stay within the supplied duration bounds. Freeform shot lengths are creative choices; the show range is guidance. Cut on natural pauses, and to the show's pacing.
Vary the framing: don't use the same idea for every shot. If a show bible lists places, each location id you pick should
be where that moment of the story happens.
For freeform, optional transition={type:"cut"|"dissolve"|"fade-through-black",durationFrames:12} starts the incoming shot while holding the outgoing final frame. It does not shift words or shorten shots.
Freeform direction guidance (not validation): median 3.5?6 s shots, ~85% hard cuts and occasional dissolves;
whole-pose/expression swaps in 1?2 frames at 30 fps and holds of 0.3?2 s, separately drawn facings;
pop entrances (~5 frames), ease-out slide/short fade/stagger, slow linear drift; ~5 visual events per 10 s,
no dead stretch over 6 s. Re-crop or redraw backgrounds per shot, one dominant hue, bold outline and one-tone cel shading.
Original character designs, phrase-held face drawings (~6?8 mouths, 8 eye states), optional lip sync;
emotion via pose/expression/symbols; charts, labels and maps build with narration. Adapt freely for other genres.
Return only the JSON object.
