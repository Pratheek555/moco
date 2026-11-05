<!-- template: cartoon-3d-short v1 -->
<!-- Adapted for moco from the cartoon-3d-short skill (github.com/mromidev/claude-animated-shorts): the story formula and
     look targets, translated into what moco's planner, World and scene specs can express. -->

# series
This series uses the "Cartoon 3D story short" template.
- Each episode is one surprising TRUE story with a physical cause and effect that can be shown, not just told
  (marching soldiers shake a bridge apart; a tank bursts and a wave of syrup floods a street).
- Each episode also needs one simple everyday analogy that explains why it happened (a kid pumping a swing).
- If the idea names one story, split it across episodes as setup, the event and its aftermath. If it names a theme,
  give every episode its own story from that theme.
- Stick to well-documented facts. Put the year and place in each synopsis.
- The premise is playful and curious, never mocking the people who were hurt.

# series_extend
Keep the "Cartoon 3D story short" formula: one true, visual cause-and-effect story per episode, each with an everyday
analogy that explains it. Don't repeat a story already told.

# show
This series uses the "Cartoon 3D story short" template. Build the show bible around its formula:
- `tone`: deadpan, curious storybook narration over absurd true events; playful, never mocking the people who were hurt.
- `format.targetSeconds` 40–55, `format.shotSeconds` about 1.5–5: quick, readable cuts with the snap on its own short shot.
- `look`: flat, simple cartoon figures (bean heads, stick limbs, dot eyes) in a painted storybook world; saturated
  storybook colours (sky blue, brick, cream, ochre, terracotta), never lemon yellow or lavender; matte, like paint.
- `rubric` should include: the absurd fact is visible in the frame, the cause and effect reads without the caption, and
  every hold creeps.

# bible
This series uses the "Cartoon 3D story short" template, which always builds its own world: return an empty `cast`.
- `style.palette`: saturated storybook colours, e.g. sky blue #3e7fd2, brick #a5523f, cream #efe2c4, ochre #d39a3a,
  terracotta #c4643f. Never lemon yellow or lavender.
- `style.mood`: deadpan, curious, storybook.
- `style.captionStyle`: short and punchy.
- `style.grade`: the kit grade closest to a clean, bright, saturated look ("none" if nothing fits).

# world
House style for this series ("Cartoon 3D story short"). It overrides the general look advice above where they differ.

Characters are flat, simple cartoon figures, not detailed film characters:
- Bean-shaped heads: a `sphere` a little taller than wide (height/width about 0.94), narrower at the chin. Adults are
  about 3.5 head-heights tall with legs about 1.4 head-heights.
- Thin stick limbs: `cylinder`/`capsule` about 0.055 of the head width thick, ending in small dot hands (a sphere).
- Simple faces: two dark dot eyes set about a quarter of the head width apart (white + small dark pupil, both with
  `blinks: true`), a small mouth `tube`. No blush, no eye highlights, no nose bigger than a dot.
- Plain, bold clothing colours with `rough` near 1 (matte, like paint), period-correct hats and uniforms where the story
  needs them. Dark plum (#241726) for hair, shoes and belts so the figures read as drawn.
- Crowds (soldiers, townsfolk) are one small model reused: give it 10–20 parts.

The world is a painted storybook town or landscape:
- Houses in muted brick, cream, ochre and terracotta, 7–10 m tall, with a plinth, a cornice, window sills, a door step and
  a chimney with a pot. Use `bricks`, `planks` and `windows` patterns with a `colour2` a little darker than `colour`.
- Stone is warm grey or beige; wood is ochre; iron is dark and desaturated.
- Day sky: top #3e7fd2, middle #7fa8de, horizon #b8d0ec. Sun azimuth 60–90, elevation 40–50, sunColour #fff3dc,
  sunStrength 3–4, fill 1.2–1.6. Fog the horizon colour, density 0.004–0.008.
- Golden hour (for the ending or an evening scene): top #ffc47c, horizon #8a6f8a, sun low (elevation 6–12) and in front of
  the camera's usual side (azimuth 150–210) so figures are backlit, sunColour #ffb36b, fog peach and light.
- At least one location per series is the day version; use golden hour for at most one location.
- Every location has a foreground, a middle and a background: a street with houses on both sides, a river with a bridge,
  a square with a church. Scatter trees and houses far out so the horizon is never empty.
- Marks: put the best view behind each mark. Leave room in front of marks: nothing within 2 m of where a camera stands.

# script
This episode uses the "Cartoon 3D story short" formula. Follow this beat order, one or two lines each:
1. Hook: the absurd fact in one line ("Seventy-four soldiers knocked down an iron bridge just by walking across it.").
2. Setting: the year, the place and why people were proud of it.
3. Action: escalation over three or four beats, each a little bigger than the last.
4. Snap: the moment it breaks.
5. Deadpan double line: "Luckily, … / Unluckily, …".
6. Explanation: one physics or science idea, through an everyday analogy.
7. Consequence: the rule, law or habit it created.
8. Callback twist: an ending that calls back to the hook.

Rules:
- One steady narrator tone: mostly `neutral` with low intensity (0.3–0.5). Deadpan carries the comedy; raise intensity
  only at the snap.
- Every joke is a real, researched fact. Never invent details.
- Never describe what the viewer can already see; say what the picture can't (why, how much, what it meant).
- Short pauses (120–220 ms) on most lines; 400–600 ms right after the snap and after the "Unluckily" line.

# shots
This episode uses the "Cartoon 3D story short" template:
- Shot 1 lands the hook on a strong, readable image of the event itself.
- Cut hard on big jumps in place or time; otherwise prefer shots that glide (push_in, pull_back, tracking, orbit).
- Open each new location on an establishing or wide camera, then go medium and close for reactions.
- The snap gets its own short shot; the analogy gets its own location if it doesn't happen in the story's world.
- Every visual reaction lands on or just before the word it illustrates: start shots on the punch word, not after it.

# scene
House style ("Cartoon 3D story short"):
- Vary the camera rig shot to shot. Use low_hero for the proud setting, high_down for the moment things go wrong, close
  for the deadpan reaction, pull_back for the aftermath.
- Every hold creeps: never let a shot sit still. Actors act on the punch words.
- Captions: 1–3 words per chunk, emphasise the number or the absurd word in each line.

# artist
This legacy template uses the 3D world pipeline. Preserve its storybook palette and character continuity if authoring a supplementary canvas insert.

# publish
House style ("Cartoon 3D story short"): the title states the absurd fact as a question or a hook ("How 74 soldiers broke
a bridge by walking"). The description gives the year, the place and the real source of the story in one line.
