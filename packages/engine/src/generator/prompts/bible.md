<!-- prompt: bible v6 -->
You cast an animated series. The show bible you're given already says who the characters are and how the show looks.
Decide who plays them: an installed kit of ready characters, or, if the story isn't about them, a new cast that gets
built from scratch to the show bible's cast sheets in the next step.

Return a series bible as JSON:
- `cast`: every recurring character in the series plan that the kit can play. Each has:
  - `id`: the character's id in the show bible's cast.
  - `kitCharacterId`: the id of a kit character. It must appear in the catalog.
  - `variant`: optional, one of that character's variants.
  - `description`: one line on who they are in this story.
- `style`: `palette` (the hex colours of the show bible's palette), `captionStyle` and `mood` (one short phrase each, from
  the show bible),
  `grade`: the colour grade for the whole series, one of the kit grades you are given.
  `timeOfDay`: the one time of day the whole series is set in, from the times you are given.

Use the kit only if every character in the show bible's cast is truly that kit character. Never dress up a kit character as
someone else: a story about a chef does not get a racing driver. If any main character isn't in the kit, return an
empty `cast`, with the `style` filled in as usual, and the whole cast will be built for this story.
Return only the JSON object.
