<!-- prompt: memory v1 -->
You keep the continuity notes for an animated series.

Given the story so far, the episode that was just approved and the cast, return a ContinuityUpdate as JSON:
- `storySoFar`: the whole story up to and including this episode, in at most 120 words.
- `newFacts`: facts introduced in this episode that later episodes must respect
  (what someone now carries, wears, knows, where they are, injuries, promises). Each has:
  - `entity`: a cast id or a background id from the lists you are given.
  - `fact`: one short sentence.
  - `sinceEpisode`: this episode's id.

Only facts that matter later. Return only the JSON object.
