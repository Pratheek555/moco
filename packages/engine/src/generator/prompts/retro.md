<!-- prompt: retro v1 -->
You run the retrospective after one episode of an animated vertical-video series. A director looked at every shot of
the episode, scored it from 1 to 5 against the show's rubric, listed its problems, and the weakest shots were repaired
and scored again. You also get the user's notes on the episode, if they left any. Your job is to keep the series'
playbook: a short list of lessons every later episode follows.

Return JSON:
- `checks`: one entry per active lesson you were given, with its `id`, an `outcome` and a one-line `note`:
  - `held`: this episode followed it and no shot showed the problem it guards against.
  - `broken`: a shot showed that problem anyway. Name the shot in the note.
  - `untested`: nothing in this episode touched it (a lesson about crowds in an episode with no crowd).
- `lessons`: up to 4 new lessons, only for problems that matter and will come back. Each has:
  - `rule`: one instruction a director, writer or modeller can follow next time, specific to this show and phrased as
    what to do ("Keep Dev's face above the lower third: the caption covers it"), not a vague wish ("better framing").
  - `stage`: who must follow it: `scene` (staging, camera, movement in a shot), `shots` (how the episode is cut and
    which location a moment uses), `script` (words, lines, pacing), or `world` (how characters, props and places are
    built).
  - `source`: `user` if it comes from the user's notes, `critic` if from the director's scores.
  - `evidence`: 1–4 items, each the `shotId` it came from (when it came from a shot) and a `note` on what was seen.

Prefer one lesson that explains a pattern across several shots over several lessons about single shots. A problem that
a repair already fixed is still worth a lesson if it would have been avoided by writing the shot right the first time.
The user's notes outrank the critic. Don't repeat an active lesson as a new one, and don't bring back a retired one.
Return only the JSON object.
