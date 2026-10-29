import type { Episode, Series, Shot } from '@moco/spec';
import { DIRECTING_RULES, SHOT_FORMAT, castDoc, exampleShotJson, kitDoc, vocabDoc } from './catalog-doc.ts';

export const LANGUAGES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi (write narration in Devanagari script)',
  hinglish: 'Hinglish (Hindi in Roman script, mixed with English)',
  ta: 'Tamil (Tamil script)',
  te: 'Telugu (Telugu script)',
  mr: 'Marathi (Devanagari script)',
  bn: 'Bengali (Bengali script)',
  gu: 'Gujarati (Gujarati script)',
  kn: 'Kannada (Kannada script)',
  ml: 'Malayalam (Malayalam script)',
};

export const languageName = (code: string) => LANGUAGES[code] ?? code;

export const SYSTEM_PROMPT = `You are the head writer and animation director of a studio that makes short, vertical animated reels (Instagram Reels / YouTube Shorts) about Indian mythology, devotion and history. Your scripts are vivid, respectful of the source traditions, emotionally gripping, and paced for viewers who swipe away in two seconds.
You write for a fixed animation engine. You never write prose answers — you reply with a single JSON value exactly in the requested shape, with no markdown fences and no commentary.`;

export interface PlanInput {
  idea: string;
  episodes: number;
  seconds: number;
  language: string;
  style: string;
}

export function planPrompt(input: PlanInput) {
  return `Plan an animated reel series from this idea:
"""${input.idea.trim()}"""

Requirements:
- ${input.episodes} episode${input.episodes === 1 ? '' : 's'}, each a self-contained reel of about ${input.seconds} seconds, that together tell one arc. Each episode must hook in the first line and end with a reason to watch the next.
- Narration language: ${languageName(input.language)}. Titles may stay in English if that suits the audience.
- Visual and storytelling style: ${input.style}.
- Cast only characters from this catalogue (use the id as "character"; give each a story name and role). Reuse generic ones (king, soldier, sage) for side characters and name them in "name":
${castDoc()}

Reply with JSON:
{
  "title": "series title",
  "logline": "one-sentence pitch",
  "setting": "where and when, visual palette",
  "tone": "how it should feel",
  "music": "devotional | epic | mystic | calm | suspense | playful",
  "captions": "bold | boxed | clean | gold",
  "cast": [{ "character": "catalogue id", "name": "name in the story", "role": "who they are in this series" }],
  "episodes": [{ "number": 1, "title": "...", "hook": "the opening line that stops the scroll", "summary": "2–3 sentences", "beats": ["4–7 short story beats, in order"] }],
  "notes": "continuity facts every episode must respect (names, relationships, objects, promises)"
}`;
}

function seriesBible(series: Series) {
  const cast = series.cast.map((c) => `  - ${c.name} → character "${c.character}"${c.role ? ` — ${c.role}` : ''}`).join('\n');
  const sofar = series.memory.storySoFar.length
    ? series.memory.storySoFar.map((s, i) => `  Episode ${i + 1}: ${s}`).join('\n')
    : '  (this is the first episode)';
  return `SERIES: ${series.title}
Logline: ${series.logline}
Setting: ${series.setting}
Tone: ${series.tone}
Style: ${series.style}
Cast:
${cast || '  (choose from the catalogue)'}
Continuity notes: ${series.memory.notes || '(none yet)'}
Story so far:
${sofar}`;
}

export function writeEpisodePrompt(series: Series, number: number) {
  const outline = series.episodes.find((e) => e.number === number);
  const target = series.secondsPerEpisode;
  const shots = Math.max(5, Math.min(14, Math.round(target / 4.5)));
  return `${seriesBible(series)}

WRITE EPISODE ${number}${outline ? `: "${outline.title}"` : ''}
Hook: ${outline?.hook ?? ''}
Summary: ${outline?.summary ?? ''}
Beats:
${(outline?.beats ?? []).map((b) => `  - ${b}`).join('\n') || '  (develop from the summary)'}

Target: about ${target} seconds total in roughly ${shots} shots. Narration language: ${languageName(series.language)}.

${kitDoc()}

${vocabDoc()}

${SHOT_FORMAT}

${DIRECTING_RULES}

EXAMPLE SHOT (the quality bar — Krishna counselling Arjuna on the chariot):
${exampleShotJson()}

Reply with JSON:
{
  "title": "episode title",
  "hook": "opening line",
  "summary": "2 sentences of what happens, for series memory",
  "music": "devotional | epic | mystic | calm | suspense | playful | none",
  "notes": "new continuity facts introduced in this episode (or empty)",
  "shots": [ ...shots in order... ]
}`;
}

export function repairPrompt(rawJson: string, issues: string[], what: 'episode' | 'shot') {
  return `This ${what} JSON doesn't fit the animation engine. Fix every problem below and return the complete corrected ${what} JSON (same shape, nothing else). Keep everything that was fine.

PROBLEMS:
${issues.map((i) => `- ${i}`).join('\n')}

${kitDoc()}

${vocabDoc()}

${SHOT_FORMAT}

JSON TO FIX:
${rawJson}`;
}

export function reviseShotPrompt(series: Series, episode: Episode, shot: Shot, instruction: string) {
  const index = episode.shots.findIndex((s) => s.id === shot.id);
  const neighbours = [episode.shots[index - 1], episode.shots[index + 1]]
    .filter(Boolean)
    .map((s) => `  - ${s!.id}: ${s!.narration}`)
    .join('\n');
  const { voice: _voice, ...editable } = shot;
  return `${seriesBible(series)}

EPISODE ${episode.number}: ${episode.title}
Neighbouring shots:
${neighbours || '  (none)'}

CURRENT SHOT ${index + 1} of ${episode.shots.length}:
${JSON.stringify(editable)}

DIRECTOR'S NOTE: ${instruction.trim()}

${kitDoc()}

${vocabDoc()}

${SHOT_FORMAT}

${DIRECTING_RULES}

Rewrite this one shot to follow the director's note. Keep its "id". Reply with the shot JSON only.`;
}

export function fixRenderErrorPrompt(shot: Shot, error: string) {
  const { voice: _voice, ...editable } = shot;
  return `Rendering this shot crashed the animation engine with:
${error.slice(0, 1500)}

Return a corrected version of the shot (same id) that avoids the problem — simplify if needed. Reply with the shot JSON only.

${kitDoc()}

${SHOT_FORMAT}

SHOT:
${JSON.stringify(editable)}`;
}
