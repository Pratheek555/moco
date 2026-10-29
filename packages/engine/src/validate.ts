import { BACKGROUNDS, CHARACTERS, PROPS, findProp } from '@moco/kit/catalog';
import {
  ActionSchema,
  CAMERA_MOVES,
  EXPRESSIONS,
  FX_TYPES,
  MUSIC_MOODS,
  POSES,
  SFX,
  ShotSchema,
  TIMES_OF_DAY,
  TRANSITIONS,
  WORDS_PER_SECOND,
  formatIssues,
  slugify,
  type Shot,
} from '@moco/spec';

// Two layers keep AI output renderable:
//  1. sanitize — deterministic, free fixes for the usual slips (synonyms, casing,
//     out-of-range numbers, unknown ids that are obviously something we have);
//  2. validate — zod schema + semantic checks; whatever's left goes back to the AI.

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

const SYNONYMS: Record<string, Record<string, string>> = {
  pose: { blessing: 'bless', abhaya: 'bless', pray: 'namaste', praying: 'namaste', greet: 'namaste', walking: 'walk', idle: 'stand', standing: 'stand', pointing: 'point', 'hand-raised': 'raise-hand', wave: 'raise-hand', 'open-arms': 'arms-open', thinking: 'think', fighting: 'fight', attack: 'fight', archer: 'draw-bow', 'aim-bow': 'draw-bow', 'play-flute': 'flute', 'hands-on-hips': 'confident', proud: 'confident', sitting: 'meditate', sit: 'meditate', crossed: 'arms-crossed', drive: 'reins', driving: 'reins', mourn: 'sad', grieve: 'sad' },
  expression: { happy: 'joy', laugh: 'joy', laughing: 'joy', calm: 'serene', peaceful: 'serene', fear: 'worried', afraid: 'worried', scared: 'worried', shocked: 'surprised', shock: 'surprised', rage: 'angry', furious: 'angry', resolute: 'determined', focused: 'determined', grief: 'sad', crying: 'sad', smiling: 'smile', gentle: 'smile' },
  camera: { 'zoom-in': 'push-in', 'zoom-out': 'pull-out', 'dolly-in': 'push-in', 'dolly-out': 'pull-out', pan: 'pan-right', tilt: 'tilt-up', still: 'static', none: 'static', float: 'drift', 'slow-zoom': 'push-in', 'ken-burns': 'drift', earthquake: 'shake' },
  transition: { crossfade: 'fade', dissolve: 'fade', 'fade-black': 'dip-black', 'fade-white': 'dip-white', 'fade-to-black': 'dip-black', 'white-flash': 'flash', 'whip-pan': 'whip', slide: 'slide-left', none: 'cut' },
  time: { morning: 'dawn', sunrise: 'dawn', noon: 'day', afternoon: 'day', daytime: 'day', evening: 'dusk', sunset: 'dusk', twilight: 'dusk', midnight: 'night' },
};

const ENUMS = {
  pose: new Set<string>(POSES),
  expression: new Set<string>(EXPRESSIONS),
  camera: new Set<string>(CAMERA_MOVES),
  transition: new Set<string>(TRANSITIONS),
  time: new Set<string>(TIMES_OF_DAY),
};

const normId = (s: string) => s.toLowerCase().trim().replace(/[\s_]+/g, '-');

function fixEnum(kind: keyof typeof ENUMS, value: unknown, fallback?: string): string | undefined {
  if (typeof value !== 'string') return fallback;
  const v = normId(value);
  if (ENUMS[kind].has(v)) return v;
  const syn = SYNONYMS[kind]?.[v];
  if (syn) return syn;
  return fallback ?? v;
}

/** Map an unknown id to the closest catalogue id if it's clearly the same thing ("lord-krishna" → "krishna"). */
function closest(id: string, ids: string[]): string | undefined {
  const v = normId(id);
  if (ids.includes(v)) return v;
  const contains = ids.find((k) => v.includes(k) || k.includes(v));
  if (contains) return contains;
  const strip = (s: string) => s.replace(/[aeiou-]/g, '');
  return ids.find((k) => strip(k) === strip(v));
}

const CHAR_IDS = CHARACTERS.map((c) => c.id);
const ALIASES: Record<string, string> = { narrator: 'sage', rishi: 'sage', vyasa: 'sage', narada: 'sage', guru: 'sage', dhritarashtra: 'king', dasharatha: 'king', drupada: 'king', yudhishthira: 'arjuna', bhima: 'duryodhana', kunti: 'draupadi', radha: 'sita', ganga: 'sita', warrior: 'soldier', guard: 'soldier', baby: 'bal-krishna', 'little-krishna': 'bal-krishna', 'young-krishna': 'bal-krishna' };
const BG_IDS = BACKGROUNDS.map((b) => b.id);
const BG_ALIASES: Record<string, string> = { battlefield: 'kurukshetra', war: 'kurukshetra', court: 'palace', hastinapur: 'palace', ayodhya: 'palace', throne: 'palace', jungle: 'forest', ashram: 'forest', ganga: 'river', ghat: 'river', yamuna: 'vrindavan', village: 'vrindavan', gokul: 'vrindavan', himalaya: 'kailash', mountain: 'kailash', space: 'cosmos', universe: 'cosmos', heaven: 'cosmos', sky: 'cosmos', shrine: 'temple', plain: 'studio', black: 'studio' };
const PROP_IDS = PROPS.map((p) => p.id);
const HELD_IDS = PROPS.filter((p) => p.kind === 'held').map((p) => p.id);

const clampNum = (v: unknown, lo: number, hi: number, dflt?: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : typeof v === 'string' && v.trim() && !Number.isNaN(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : dflt);

/** Deterministic clean-up of one raw shot object. Mutates and returns it. */
export function sanitizeShot(raw: unknown, index: number, used: Set<string>): Json {
  const shot: Json = isObj(raw) ? raw : {};
  let id = typeof shot.id === 'string' && shot.id.trim() ? slugify(shot.id, 40) : `shot-${index + 1}`;
  while (used.has(id)) id = `${id}-${index + 1}`;
  used.add(id);
  shot.id = id;
  shot.duration = clampNum(shot.duration, 1, 20, 4);
  if (typeof shot.narration !== 'string') shot.narration = shot.narration == null ? '' : String(shot.narration);
  if (typeof shot.caption !== 'string') delete shot.caption;

  const bg = isObj(shot.background) ? shot.background : { id: typeof shot.background === 'string' ? shot.background : 'studio' };
  const bgId = typeof bg.id === 'string' ? normId(bg.id) : 'studio';
  bg.id = BG_IDS.includes(bgId) ? bgId : (BG_ALIASES[bgId] ?? closest(bgId, BG_IDS) ?? bgId);
  bg.time = fixEnum('time', bg.time, 'day');
  shot.background = bg;

  const cam = isObj(shot.camera) ? shot.camera : { move: typeof shot.camera === 'string' ? shot.camera : 'static' };
  cam.move = fixEnum('camera', cam.move, 'static');
  cam.intensity = clampNum(cam.intensity, 0, 1, 0.5);
  if (cam.focus && !isObj(cam.focus)) delete cam.focus;
  shot.camera = cam;

  shot.transition = fixEnum('transition', shot.transition, 'cut');

  const actorIds = new Set<string>();
  const actors = Array.isArray(shot.actors) ? shot.actors.filter(isObj) : [];
  shot.actors = actors.slice(0, 6).map((a, i) => {
    const char = typeof a.character === 'string' ? normId(a.character) : typeof a.id === 'string' ? normId(a.id) : 'sage';
    a.character = CHAR_IDS.includes(char) ? char : (ALIASES[char] ?? closest(char, CHAR_IDS) ?? char);
    let aid = typeof a.id === 'string' && a.id.trim() ? slugify(a.id, 40) : String(a.character);
    while (actorIds.has(aid)) aid = `${aid}-${i + 1}`;
    actorIds.add(aid);
    a.id = aid;
    a.x = clampNum(a.x, -1, 2, 0.5);
    if (a.y !== undefined) a.y = clampNum(a.y, -1, 2, undefined);
    if (a.y === undefined) delete a.y;
    a.scale = clampNum(a.scale, 0.1, 4, 1);
    a.facing = a.facing === 'left' ? 'left' : 'right';
    a.pose = fixEnum('pose', a.pose, 'stand');
    a.expression = fixEnum('expression', a.expression, 'neutral');
    for (const hand of ['holdRight', 'holdLeft'] as const) {
      if (a[hand] === undefined || a[hand] === null || a[hand] === '') delete a[hand];
      else if (typeof a[hand] === 'string') {
        const h = normId(a[hand] as string);
        a[hand] = h === 'none' ? 'none' : (closest(h, HELD_IDS) ?? h);
      }
    }
    const actions = Array.isArray(a.actions) ? a.actions.filter(isObj) : [];
    a.actions = actions
      .map((act) => {
        act.at = clampNum(act.at, 0, 60, 0);
        if (typeof act.type === 'string') act.type = normId(act.type);
        if (act.type === 'pose') act.pose = fixEnum('pose', act.pose, 'stand');
        if (act.type === 'expression') act.expression = fixEnum('expression', act.expression, 'neutral');
        if (act.type === 'pose' && act.duration !== undefined) act.duration = clampNum(act.duration, 0, 3, 0.45);
        if ((act.type === 'move' || act.type === 'speak') && act.duration !== undefined) act.duration = clampNum(act.duration, 0.1, 30, 1);
        if (act.type === 'look' && typeof act.direction === 'string') act.direction = normId(act.direction);
        return act;
      })
      .slice(0, 24);
    return a;
  });

  const props = Array.isArray(shot.props) ? shot.props.filter(isObj) : [];
  const propIds = new Set<string>();
  shot.props = props.slice(0, 10).map((p, i) => {
    const kind = typeof p.prop === 'string' ? normId(p.prop) : typeof p.id === 'string' ? normId(p.id) : 'banner';
    p.prop = PROP_IDS.includes(kind) ? kind : (closest(kind, PROP_IDS) ?? kind);
    let pid = typeof p.id === 'string' && p.id.trim() ? slugify(p.id, 40) : String(p.prop);
    while (propIds.has(pid) || actorIds.has(pid)) pid = `${pid}-${i + 1}`;
    propIds.add(pid);
    p.id = pid;
    p.x = clampNum(p.x, -1, 2, 0.5);
    if (p.y !== undefined) p.y = clampNum(p.y, -1, 2, undefined);
    if (p.y === undefined) delete p.y;
    p.scale = clampNum(p.scale, 0.1, 4, 1);
    p.facing = p.facing === 'left' ? 'left' : 'right';
    p.moving = p.moving === true;
    p.actions = (Array.isArray(p.actions) ? p.actions.filter(isObj) : []).filter((act) => ['move', 'enter', 'exit'].includes(String(act.type)));
    return p;
  });

  // Riders whose vehicle id is a prop *type* rather than its instance id.
  for (const a of shot.actors as Json[]) {
    if (typeof a.ride !== 'string') continue;
    if (propIds.has(a.ride)) continue;
    const match = (shot.props as Json[]).find((p) => p.prop === a.ride);
    if (match) a.ride = match.id;
  }

  const fxTypes = new Set<string>(FX_TYPES);
  shot.fx = (Array.isArray(shot.fx) ? shot.fx.filter(isObj) : [])
    .map((f) => {
      if (typeof f.type === 'string') f.type = normId(f.type);
      if (f.type === 'god-rays' || f.type === 'rays') f.type = 'light-rays';
      if (f.type === 'glow' || f.type === 'halo') f.type = 'aura';
      if (typeof f.target === 'string' && !actorIds.has(f.target)) {
        const byChar = (shot.actors as Json[]).find((a) => a.character === normId(f.target as string));
        if (byChar) f.target = byChar.id;
      }
      return f;
    })
    .filter((f) => fxTypes.has(String(f.type)))
    .slice(0, 10);

  const sfx = new Set<string>(SFX);
  shot.sfx = (Array.isArray(shot.sfx) ? shot.sfx : [])
    .map((s) => (typeof s === 'string' ? { id: s } : s))
    .filter(isObj)
    .map((s) => ({ ...s, id: typeof s.id === 'string' ? normId(s.id) : s.id }))
    .filter((s) => sfx.has(String(s.id)))
    .slice(0, 8);

  if (shot.overlay !== undefined && !isObj(shot.overlay)) delete shot.overlay;
  if (typeof shot.speaker === 'string' && !actorIds.has(shot.speaker)) {
    const byChar = (shot.actors as Json[]).find((a) => a.character === normId(shot.speaker as string));
    if (byChar) shot.speaker = byChar.id;
    else delete shot.speaker;
  }
  return shot;
}

export function sanitizeMusic(v: unknown) {
  const m = typeof v === 'string' ? normId(v) : '';
  return (MUSIC_MOODS as readonly string[]).includes(m) ? m : 'devotional';
}

/** Checks zod can't express: catalogue ids, references between actors/props/fx, timing. */
export function semanticIssues(shot: Shot, path: string): string[] {
  const issues: string[] = [];
  if (!BG_IDS.includes(shot.background.id)) issues.push(`${path}.background.id: unknown background "${shot.background.id}" — use one of ${BG_IDS.join(', ')}`);
  const actorIds = new Set(shot.actors.map((a) => a.id));
  const propIds = new Map(shot.props.map((p) => [p.id, p]));
  shot.actors.forEach((a, i) => {
    const p = `${path}.actors[${i}]`;
    if (!CHAR_IDS.includes(a.character)) issues.push(`${p}.character: unknown character "${a.character}" — use one of ${CHAR_IDS.join(', ')}`);
    for (const hand of ['holdRight', 'holdLeft'] as const) {
      const h = a[hand];
      if (h && h !== 'none' && !HELD_IDS.includes(h)) issues.push(`${p}.${hand}: "${h}" is not a held prop — use one of ${HELD_IDS.join(', ')} or "none"`);
    }
    if (a.ride) {
      const vehicle = propIds.get(a.ride);
      if (!vehicle) issues.push(`${p}.ride: no prop with id "${a.ride}" in this shot`);
      else if (!findProp(vehicle.prop)?.vehicle) issues.push(`${p}.ride: "${vehicle.prop}" is not a vehicle`);
    }
    a.actions.forEach((act, k) => {
      if (act.at > shot.duration + 0.5) issues.push(`${p}.actions[${k}].at: ${act.at}s is after the shot ends (${shot.duration}s)`);
    });
  });
  shot.props.forEach((pr, i) => {
    if (!PROP_IDS.includes(pr.prop)) issues.push(`${path}.props[${i}].prop: unknown prop "${pr.prop}" — use one of ${PROP_IDS.join(', ')}`);
    else if (findProp(pr.prop)?.kind === 'held') issues.push(`${path}.props[${i}].prop: "${pr.prop}" is a held prop — give it to an actor with holdRight/holdLeft instead`);
  });
  shot.fx.forEach((f, i) => {
    if (f.type === 'aura' && !actorIds.has(f.target)) issues.push(`${path}.fx[${i}].target: no actor with id "${f.target}" in this shot`);
  });
  if (shot.speaker && !actorIds.has(shot.speaker)) issues.push(`${path}.speaker: no actor with id "${shot.speaker}" in this shot`);
  const words = shot.narration.split(/\s+/).filter(Boolean).length;
  if (words > shot.duration * WORDS_PER_SECOND * 1.6 + 3) issues.push(`${path}.narration: ${words} words is too long for ${shot.duration}s — shorten it or raise duration`);
  return issues;
}

export interface ShotCheck {
  shot?: Shot;
  issues: string[];
}

export function checkShot(raw: unknown, path: string): ShotCheck {
  const parsed = ShotSchema.safeParse(raw);
  if (!parsed.success) return { issues: formatIssues(parsed.error).map((l) => `${path}.${l}`) };
  return { shot: parsed.data, issues: semanticIssues(parsed.data, path) };
}

/** Last resort: strip whatever is still invalid so the episode always renders. */
export function stripInvalid(shot: Json): { shot: Json; removed: string[] } {
  const removed: string[] = [];
  if (Array.isArray(shot.actors)) {
    shot.actors = (shot.actors as Json[]).filter((a) => {
      const ok = CHAR_IDS.includes(String(a.character));
      if (!ok) removed.push(`actor ${a.id} (${a.character})`);
      return ok;
    });
    for (const a of shot.actors as Json[]) {
      for (const hand of ['holdRight', 'holdLeft']) if (a[hand] && a[hand] !== 'none' && !HELD_IDS.includes(String(a[hand]))) delete a[hand];
      if (Array.isArray(a.actions)) a.actions = (a.actions as Json[]).filter((act) => ActionSchema.safeParse(act).success);
      if (typeof a.ride === 'string' && !(shot.props as Json[] | undefined)?.some((p) => p.id === a.ride)) delete a.ride;
    }
  }
  if (Array.isArray(shot.props)) {
    shot.props = (shot.props as Json[]).filter((p) => {
      const ok = PROP_IDS.includes(String(p.prop)) && findProp(String(p.prop))?.kind === 'placed';
      if (!ok) removed.push(`prop ${p.id} (${p.prop})`);
      return ok;
    });
  }
  const actorIds = new Set(((shot.actors as Json[]) ?? []).map((a) => a.id));
  if (Array.isArray(shot.fx)) shot.fx = (shot.fx as Json[]).filter((f) => f.type !== 'aura' || actorIds.has(f.target));
  if (isObj(shot.background) && !BG_IDS.includes(String(shot.background.id))) {
    removed.push(`background ${shot.background.id}`);
    shot.background.id = 'studio';
  }
  if (typeof shot.speaker === 'string' && !actorIds.has(shot.speaker)) delete shot.speaker;
  return { shot, removed };
}
