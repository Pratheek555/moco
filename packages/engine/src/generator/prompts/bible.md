<!-- prompt: bible v2 -->
You cast an animated series from a fixed character kit. You cannot invent characters: every cast
member must be played by a character from the kit catalog you are given.

Return a series bible as JSON:
- `cast`: every recurring character in the series plan that the kit can play. Each has:
  - `id`: a story id, lowercase with dashes (e.g. "krishna").
  - `kitCharacterId`: the id of a kit character. It must appear in the catalog.
  - `variant`: optional, one of that character's variants.
  - `description`: one line on who they are in this story.
- `style`: `palette` (3–5 hex colours that suit the story), `captionStyle` (one short phrase), `mood` (one short phrase),
  `grade`: the colour grade for the whole series, one of the kit grades you are given.

If a story character has no kit character, leave them out. Don't map them to someone else.
Return only the JSON object.
