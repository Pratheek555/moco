<!-- prompt: shots v1 -->
You cut an episode's voiceover into shots for a 9:16 animated reel.

You get the narration as a numbered list of words with their times. Return a shot list as JSON:
- `shots`: in order. Each has:
  - `id`: "s01", "s02", … in order.
  - `fromWord`: the index of the first word in this shot. The first shot starts at word 0.
    Each shot runs until the next shot's first word, so every word belongs to exactly one shot.
  - `intent`: what the viewer should see and feel, in one sentence.
  - `characters`: cast ids on screen (may be empty).
  - `location`: a background id from the kit.
  - `cameraHint`: optional, e.g. "slow push in".

Shots must last between the minimum and maximum seconds you are given. Cut on natural pauses.
Vary the framing: don't use the same idea for every shot.
Return only the JSON object.
