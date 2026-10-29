import { BACKGROUNDS, CHARACTERS, PROPS } from '@moco/kit/catalog';
import { KRISHNA_CHARIOT_SHOT, VOCAB_DOCS } from '@moco/spec';

// Renders the kit + spec vocabulary as compact reference text for prompts.

const list = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `  ${k} — ${v}`)
    .join('\n');

export function castDoc() {
  return CHARACTERS.map((c) => `  ${c.id} — ${c.name}: ${c.description}${c.holds.length ? ` (holds ${c.holds.join(', ')})` : ''}`).join('\n');
}

export function kitDoc() {
  const placed = PROPS.filter((p) => p.kind === 'placed');
  const held = PROPS.filter((p) => p.kind === 'held');
  return [
    'CHARACTERS (actor.character):',
    castDoc(),
    '',
    'BACKGROUNDS (background.id) — ground line in brackets:',
    BACKGROUNDS.map((b) => `  ${b.id} [${b.ground}] — ${b.description}`).join('\n'),
    '',
    'PLACED PROPS (props[].prop):',
    placed.map((p) => `  ${p.id} — ${p.description}${p.vehicle ? ' [vehicle: actors can ride it]' : ''}${p.animates ? ' [animates with moving:true]' : ''}`).join('\n'),
    '',
    'HELD PROPS (actor.holdRight / holdLeft, or "none" to empty a hand):',
    held.map((p) => `  ${p.id} — ${p.description}`).join('\n'),
  ].join('\n');
}

export function vocabDoc() {
  return [
    'POSES:',
    list(VOCAB_DOCS.poses),
    '',
    'EXPRESSIONS:',
    list(VOCAB_DOCS.expressions),
    '',
    'CAMERA MOVES (camera.move; intensity 0..1):',
    list(VOCAB_DOCS.camera),
    '',
    'TRANSITIONS (how a shot begins):',
    list(VOCAB_DOCS.transitions),
    '',
    'FX (fx[].type; all accept "at" and optional "duration" seconds):',
    list(VOCAB_DOCS.fx),
    '',
    'SFX (sfx[].id):',
    list(VOCAB_DOCS.sfx),
    '',
    'MUSIC MOODS:',
    list(VOCAB_DOCS.music),
  ].join('\n');
}

export const SHOT_FORMAT = `SHOT FORMAT (JSON). Positions are fractions of the 1080×1920 vertical frame: x 0 = left edge, 1 = right edge; y is the feet line, 1 = bottom edge. Times are seconds from the start of the shot.
{
  "id": "kebab-case, unique in the episode",
  "duration": 4.5,                       // 2.5–8 s; narration must fit at ~2.6 words per second
  "narration": "spoken during this shot",
  "speaker": "actor id",                 // optional — whose lips move; omit for an off-screen narrator
  "caption": "optional shorter on-screen text",
  "background": { "id": "background id", "time": "dawn | day | dusk | night" },
  "camera": { "move": "camera move", "intensity": 0.5, "focus": { "x": 0.5, "y": 0.4 } },
  "actors": [{
    "id": "short id", "character": "character id",
    "x": 0.5, "y": 0.86, "scale": 1,     // omit y to stand on the background's ground line
    "facing": "right | left",
    "pose": "pose", "expression": "expression",
    "holdRight": "held prop | none", "holdLeft": "held prop | none",
    "ride": "id of a vehicle prop in this shot",   // then x is the spot on the vehicle, -1 (back) … 1 (front)
    "actions": [ ... ]
  }],
  "props": [{ "id": "short id", "prop": "placed prop id", "x": 0.3, "y": 0.92, "scale": 0.75, "facing": "right", "moving": false, "actions": [ ... ] }],
  "fx": [{ "type": "fx type", ... }],
  "sfx": [{ "id": "sfx id", "at": 0.3 }],
  "overlay": { "kind": "title | chapter | quote | lower-third", "text": "...", "subtitle": "...", "at": 0, "duration": 3 },
  "transition": "transition"
}
ACTIONS:
  { "type": "pose", "at": 1.2, "pose": "bless", "duration": 0.45 }
  { "type": "expression", "at": 1.2, "expression": "smile" }
  { "type": "move", "at": 0, "duration": 2, "x": 0.6, "y": 0.9, "scale": 1.2, "ease": "smooth | linear | spring" }
  { "type": "enter", "at": 0, "from": "left | right | bottom | top | fade | pop", "duration": 0.6 }
  { "type": "exit", "at": 3.5, "to": "left | right | bottom | top | fade | pop", "duration": 0.6 }
  { "type": "look", "at": 0.5, "direction": "camera | left | right | up | down" }
  { "type": "turn", "at": 2, "facing": "left | right" }
  { "type": "nod", "at": 2.4 }
  { "type": "speak", "at": 0, "duration": 2 }     // extra lip movement; the speaker's is automatic
Props only take move / enter / exit actions.
FX FIELDS: particles {variant, intensity} · light-rays {color, intensity} · aura {target: actor id, color, intensity} · divine-light {x, color, intensity} · flash {color, at, duration} · shockwave {x, y, color, at, duration} · lightning {intensity} · fire {x, y, scale} · fog {intensity, color} · speed-lines {intensity} · tint {variant: warm | cool | sepia | gold | night | blood, intensity} · vignette {intensity} · grain {intensity}`;

export const DIRECTING_RULES = `DIRECTING RULES
- Vertical 9:16 for Instagram Reels. Keep faces in the upper-middle; captions sit at ~66% height, so don't put a face there.
- The first shot is the hook: it must stop the scroll in under 2 seconds — a striking image, an overlay of kind "title" with the episode title, and a gripping first line.
- One idea per shot. Change something every 2–3 seconds: a pose or expression change, a camera move, an entrance.
- Framing: full body = scale 0.9–1.1 on the ground line; two people = x 0.3 and 0.7, facing each other; close-up for emotion = scale 1.6–1.9 with y 1.1–1.2; epic wide = scale 0.55–0.75.
- At most 3 actors per shot. Use the same actor id for the same character across shots.
- Vary camera moves. Transitions: mostly cut or fade; dip-white for divine moments, dip-black for time passing, flash for impact.
- Use fx with purpose (≤ 3 per shot): aura for divinity, particles for atmosphere, tint/vignette for mood. Add sfx on key beats.
- Narration is short and punchy, written for the ear. Keep it under duration × 2.6 words.
- End on a cliffhanger, a reflection, or a teaser for the next episode.
- Use only ids from the catalogue. Never invent characters, props, backgrounds, poses or effects.`;

export const exampleShotJson = () => JSON.stringify(KRISHNA_CHARIOT_SHOT);
