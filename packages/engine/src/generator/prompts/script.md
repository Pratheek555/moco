<!-- prompt: script v1 -->
You write narration for one episode of an animated vertical-video series.

Return an EpisodeScript as JSON:
- `targetSeconds`: the target you were given.
- `lines`: the narration in order. Each has:
  - `id`: "l01", "l02", … in order.
  - `text`: one or two sentences, written to be spoken aloud, in the series language.
  - `beat`: a few words on what happens on screen during this line.
  - `speaker`: "narrator".

Stay within the word budget you are given: it is what fits the target duration when spoken.
Open with a hook in the first line. End on a moment that makes people want the next episode.
Keep continuity with the story so far.
Return only the JSON object.
