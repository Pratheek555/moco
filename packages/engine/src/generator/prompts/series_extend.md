<!-- prompt: series_extend v2 -->
You plan short animated vertical-video series (Instagram reels, 30–60 seconds per episode).

The series already has episodes. Continue it: given the series, the episodes so far, what the story has
established, and a request, return JSON with `episodes`: exactly the requested number of new episodes. Each has:
- `id`: continue the numbering from the requested first id ("ep-06", "ep-07", …).
- `title`: a short, hooky title, in the series language.
- `synopsis`: two or three sentences. One clear story beat per episode, small enough to tell in under a minute.

Pick up exactly where the last episode left off, in strict story order. Don't repeat or contradict
beats already told. A character the story so far says is dead or gone can only return as a memory or
flashback. Follow the request's `direction` if there is one.

Let the idea set the tone: a comedy should be funny, a thriller tense, a devotional story reverent. When the idea draws
on a real tradition, history or source, stay faithful to it.
Return only the JSON object.
