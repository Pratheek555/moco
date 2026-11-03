<!-- template: cartoon-fact-shorts v1 -->
<!-- Learned by moco from 2 reference videos (https://www.youtube.com/watch?v=6mRR91AbxjQ, https://www.youtube.com/watch?v=HxriA2CXhsU): their technique, translated into what moco's
     planner, World and scene specs can express. See skill/SKILL.md for the full style guide. -->

# series
This series uses the "Cartoon Fact Shorts" template.
- Each episode explains ONE fact, process or true event as one unbroken chain of physical causes and effects, about 30 s long.
- Every episode needs: a threat or action already under way at the start, a concrete count (how many parts, people, seconds), at least three steps you can see as literal pictures, and one final physical outcome.
- Pick one of two shapes per episode and state it in the synopsis: a PROCESS (what happens to the viewer's own body or life, told in second person) or an EVENT (a true story with a twist, told in third person past tense).
- Good fits: a mechanism with parts you can show close up, something hidden inside an object or body, a disaster set off by a small, unrelated action. Bad fits: opinions, lists of trivia with no causal link, anything abstract with nothing to show.
- If the idea names one big topic, give each episode its own sub-process or its own event. Never split one chain across episodes.
- Stick to well-documented facts. Each synopsis names the count, the chain in one line and the final outcome.

# series_extend
Keep the "Cartoon Fact Shorts" formula: one fact, process or true event per episode, told as a single cause-and-effect chain with a concrete count, starting with the threat already under way and ending on the physical outcome. Alternate process and event episodes where the theme allows. Never reuse a mechanism, event or outcome already covered; pick a new part, a new body system or a new incident.

# bible
This series uses the "Cartoon Fact Shorts" template, which always builds its own world: return an empty `cast` unless one recurring hero (a person or object) appears in most shots. In that case, describe that single hero.
- The hero wears one simple outfit in one bright colour (the accent), or the key object carries the accent. Everything else is muted.
- `style.palette` for process stories (bright grade): cool sky #3f8fd8, pale horizon #bcdcf2, neutral surface #d6cec4, accent orange #ff6a13, warm glow #ffd23f. For dangerous events (dark grade): near-black #0d1014, slate #2a323b, flat storm grey #6b737a, the same single accent #ff6a13, glowing display white #e9eef2. Use one saturated accent only.
- `style.mood`: deadpan, documentary, clinical, urgent.
- `style.captionStyle`: small white bold rounded sans with a soft dark shadow, no box, no highlight words, 2–4 words per chunk, one case (sentence case or all lowercase) kept for the whole video.
- `style.grade`: the kit grade closest to clean and neutral with crisp highlights ("none" if nothing fits). Never warm vintage, grain or a stylised grade.

# world
House style for this series ("Cartoon Fact Shorts"). It overrides the general look advice where they differ.
- `look`: "film". Never toon. Glossy, physically real-looking materials from the library (metal, glass, stone, plaster, wood) with crisp highlights. Matte only where the real thing is matte.
- People: adult proportions, tall and slim, neutral faces with no smile, one simple outfit in a single bright colour (the accent) for the hero, muted greys and navies for everyone else. A person used only for scale or as the one affected appears once. Crowds are 2–3 recurring figures, plus one dense crowd for a scale wide if the story claims many people.
- Sets are uncluttered: one surface or one space per location, the subject on it and nothing else. No decorative props.
- Build these location types when the story needs them: (1) a surface-as-landscape set at macro scale for close-ups of a part; (2) a full-frame cross-section of the inside of the object or body, all warm (#c4643f, #e8a070, #ffd23f), for anything internal; (3) one dense wide (a city aerial or crowd) for scale; (4) a hinge set: the key object alone on pure black, a single overhead key light, no fill, no fog colour beyond black.
- Counts, times and scores live on a self-lit display built inside the scene (timer, counter, gauge): glowing digits (#e9eef2 or #ffd23f) on a dark panel, big enough to fill most of the frame from its mark.
- Bright process lighting: sky top #3f8fd8, horizon #bcdcf2, sun elevation 50–70 (top or front key), sunColour #fff6e8, sunStrength 3, fill 1.2–1.5, light fog in the horizon colour.
- Dark event lighting: interiors are an overhead lamp pool with darkness around it (fill 0.1–0.3, sky near #0d1014). Threat exteriors before the strike are flat overcast: sky #6b737a to #9aa1a6, sun hidden or strength under 1, fill 1.5, fog grey and dense (0.02–0.04). Fast debris or sparks may be glowing primitive particles.
- Marks: put the hero on the camera's centre line and leave the lower part of each view (the band at 70–85% of the frame height) plain and mid-to-dark so captions read. Add one macro mark per location at surface height looking slightly up at the part.

# script
This episode uses the "Cartoon Fact Shorts" formula: one deadpan narrator, one unbroken chain of causes, about 80–90 words in total.
- Line 1 (hook): one sentence of 11–14 words that names the threat or action as it happens, with a concrete count. Never a question, never 'did you know'.
- Process shape (3 sentences, about 14/40/26 words): hook; one long escalation chaining each step to the next; a 'Next,' sentence that finishes the process. Second person present: 'you' is the object of every action.
- Event shape (5 sentences, about 11/28/16/19/14 words): threat; a small unrelated action; what it caused; the strike; the payoff. Third person past tense.
- Make the second sentence the longest. Hold the answer to the hook until the last sentence.
- Start sentences with cause or time words (so, while, until, which, as, next, just then). Chain two results per sentence with -ing clauses. One blunt physical verb per step. 'But' only for the twist and the payoff.
- Plain facts only: no jokes, no opinion words, no moral, no summary, no call to action. End on the final physical action or outcome, and if you can, end on the same word that ended the hook so it loops.
- Delivery: `neutral` on every line, intensity 0.35–0.45. Raise to `tense` 0.6–0.7 only on the hook and the strike/impact line. Never warm or awed.
- pauseAfterMs: 300–400 after a sentence or clause, 0 inside a clause, one longer 550–600 before the payoff sentence, and 0 after the last line. Keep the lines dense so the voice fills about 88% of the runtime (about 196 wpm while speaking).

# shots
This episode uses the "Cartoon Fact Shorts" template.
- Cut about every 4 spoken words (about 1.9 s). Most shots run 2–6 words. Long explanation or result shots carry 10–14 words (3–4.8 s), at most two per episode.
- The first cut lands at about 1.7 s, on the word that names who or what is affected.
- Start each shot (fromWord) mid-sentence on a function word just before the noun it shows, so the picture is up before the noun is heard. Never start a shot on the first word of a sentence or clause.
- When a line lists or counts things, cut a burst of 4–6 one-word shots, one per item, keeping the scale and moving the subject. Give the decisive moment its own 1–1.6 s shot.
- One fact = one shot: a close-up of the part doing the thing, a cross-section location for anything internal, the display location for any number or time, a cut to the familiar object for any 'works like' comparison, and the hinge (black) location for the deciding object, held about 1.1 s.
- Change the shot scale at every cut (establishing/wide → medium → close, or a jump from extreme wide to macro). Never use the same scale twice in a row.
- cameraHint: push_in for about 60% of shots; use tracking, orbit or high_down/low_hero for the rest. Answer an earlier push-in with a later pull_back.
- The last shot returns to the first shot's location and framing with a pull_back.

# scene
House style ("Cartoon Fact Shorts"):
- The camera moves in every shot except at most one in seven (the hinge object or one explanation beat). One move on one axis per shot, never reversed. Default push_in, with a gentle cruise (about 20–25%/s). Long shots over 2 s can move faster. One-word inserts barely creep. Shake is always 0.
- Keep the subject on the centre vertical, upper-centre to centre. Macro shots use close or low_hero at surface height looking up.
- Actors and props hold dead still: no idle actions, no breathing, no drifting. Give at most one action per shot: a short burst of about 4 frames that starts 1–5 frames before the word that names it. Put any aftermath beat 6–13 frames after the word. A repeating action starts 10–12 frames before its verb.
- One whole-body gesture per episode, on the climax only (9–11 frames), then hold. Background and crowd figures never act.
- Expressions stay neutral for the whole episode: never change the face. Emotion is the held pose (slumped, upright, crouched).
- A number on a display changes about 10 frames after the narration names it.
- The final shot is a short pull_back that settles on the last word.
- Captions: 2–4 word chunks, punctuation and hyphens removed, no emphasis words. Each chunk appears within ±3 frames of its first word, and the current chunk holds through pauses and through bursts of quick shots.

# publish
House style ("Cartoon Fact Shorts"):
- Title: the fact stated flatly with its count, 4–9 words, no question, no clickbait words (e.g. 'The 3 muscles that stop you choking').
- Description: one deadpan line restating the chain's outcome, plus one line naming the real source or the date and place for true events. No call to action.
- Hashtags: 4–6, mixing topic tags with #facts #science #explained #didntknow #shorts (pick only those that fit).
