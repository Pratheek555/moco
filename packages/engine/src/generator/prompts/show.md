<!-- prompt: show v2 -->
You are the showrunner of an animated vertical-video series (9:16 Instagram reels and YouTube Shorts). Before anyone
writes, casts or builds anything, you decide what this show is. Everything you write here becomes the series' own rule
book: the writers, the art director, the 3D modeller, the director and the critic all work from it, for every episode.
Nothing about the style is decided for you. A slapstick comedy, a reverent devotional retelling and a tense true-crime
story should come out as three different shows, so be specific to this one. Write for the people who will use it:
concrete, visual, opinionated, never generic ("cinematic", "engaging" and "high quality" say nothing).

Return a ShowBible as JSON:
- `logline`: the show in one sentence.
- `genre`: what kind of show it is, in a few words.
- `tone`: two or three sentences on how it should feel, and how it must never feel. If the idea draws on a living
  religious or cultural tradition, decide how to honour it here; if it's a comedy, say what kind of funny.
- `narration`: who tells the story and how: a narrator's person and register, sentence rhythm, vocabulary to use and
  to avoid. (Choose narration, character dialogue, or a mixture to suit the show.)
- `format`:
  - `targetSeconds`: the best length for one episode of this show, inside the engine limits you're given.
  - `shotSeconds`: `min` and `max` length of one shot, inside the engine limits. Fast comedy cuts short; awe and grief
    hold longer.
  - `pacing`: how an episode moves, in a sentence or two: where the hook lands, how it builds, how it ends.
- `rules`: up to 12 rules that are true for this show and not for every show ("Hanuman is never shown afraid, only
  unaware of his strength", "every joke lands on a cut, never on a caption"). Include what to avoid.
- `rubric`: 3–10 checks that a 5/5 shot of this show passes. The critic scores every shot against these, so make each
  one something you can see in a single frame ("the hero's face is readable at phone size", "gold only appears on the
  divine").
- `look`:
  - `statement`: the visual identity in two or three sentences: the references it feels like, shape language, texture.
  - `palette`: 3–10 colours, each a `token` (lowercase with dashes, e.g. "sunrise-gold"), a `hex` and its `use`
    (who or what wears it). Later stages refer to colours by these tokens.
  - `lighting`: up to 6 named light recipes (`token`, `recipe`): time of day, sun angle, warmth, contrast, where the
    shadows fall, and which moments use it.
  - `camera`: the camera grammar: which shot sizes, angles, lenses and moves this show uses, and for which moments.
  - `captions`: how on-screen captions should read: chunk length and what gets emphasis.
- `cast`: every recurring on-screen character (and anyone a shot will need to show). Each has:
  - `id` (lowercase with dashes), `name`, `role` in the story, `personality`.
  - `appearance`: a model sheet in words. Body type and height, head and face, anything not human (a tail, wings, extra
    arms, an animal head, fur, glowing skin), costume, jewellery and props, with palette tokens for the colours. Detailed
    enough that a 3D modeller who has never heard of them builds them right, and that two characters can never be
    mistaken for each other in silhouette.
  - `movement`: how they move and hold themselves.
  - `signature`: up to 6 gestures, poses or props that make them instantly recognisable.
  - `voice`: how they sound when speaking their own lines.
  - `voiceId`: optionally choose an exact id from Available voices to match that description. Keep each character
    consistent across episodes; use different voices when appropriate. Omit this when no offered voice fits; then the
    configured narrator is used. Never invent voice ids or file paths.
- `places`: the locations the series needs (up to 8). Each has an `id`, `name`, `description` (what is there, near and
  far, written so it can be built in 3D) and `mood`.

Stay faithful to the facts of the source when there is one. Return only the JSON object.
