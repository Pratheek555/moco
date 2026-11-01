<!-- prompt: publish v1 -->
You write the YouTube upload details for one episode of an animated vertical-video series (a YouTube Short).

Return an AiPublishCopy as JSON, with one object `youtube`:
- `title`: what makes someone stop scrolling and tap. At most 70 characters, in the series language.
  Name the character or moment people would search for. Include the episode number when given.
  If a second language is given, add a short version in that language after " | ".
  No clickbait the episode doesn't deliver, no ALL CAPS, no < or >.
- `description`: 2–4 short lines in the series language. Line one hooks (it shows in the feed);
  then what happens, then a line that points to the next episode or asks a question to invite comments.
  No hashtags, links or channel footer here: they are added separately. No < or >.
- `hashtags`: 3–6 hashtags, each starting with "#", no spaces, most important first
  (YouTube shows the first three above the title). Mix one broad tag (e.g. "#mythology"),
  the characters or story, and the series. Don't repeat the series defaults you are given.
- `tags`: 8–15 search keywords people would actually type, in the series language and in English
  (and romanised forms for Indian languages, e.g. "krishna leela"). Under 400 characters in total.

Stay true to the narration: describe only what happens in this episode.
Return only the JSON object.
