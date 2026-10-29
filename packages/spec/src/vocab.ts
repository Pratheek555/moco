// The shared vocabulary. Everything here is something the AI may write in a
// spec, so every value needs a one-line meaning in VOCAB_DOCS (used in prompts).

export const POSES = [
  'stand',
  'raise-hand',
  'bless',
  'point',
  'namaste',
  'arms-open',
  'think',
  'sad',
  'fight',
  'draw-bow',
  'flute',
  'reins',
  'arms-crossed',
  'confident',
  'meditate',
  'walk',
] as const;
export type Pose = (typeof POSES)[number];

export const EXPRESSIONS = [
  'neutral',
  'smile',
  'joy',
  'sad',
  'angry',
  'surprised',
  'serene',
  'worried',
  'determined',
] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export const CAMERA_MOVES = [
  'static',
  'push-in',
  'pull-out',
  'pan-left',
  'pan-right',
  'tilt-up',
  'tilt-down',
  'drift',
  'crash-zoom',
  'handheld',
  'shake',
] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];

export const TRANSITIONS = [
  'cut',
  'fade',
  'dip-black',
  'dip-white',
  'flash',
  'zoom',
  'slide-left',
  'slide-up',
  'whip',
] as const;
export type Transition = (typeof TRANSITIONS)[number];

export const TIMES_OF_DAY = ['dawn', 'day', 'dusk', 'night'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export const PARTICLE_VARIANTS = [
  'dust',
  'embers',
  'petals',
  'sparkles',
  'snow',
  'rain',
  'fireflies',
  'leaves',
] as const;
export type ParticleVariant = (typeof PARTICLE_VARIANTS)[number];

export const TINTS = ['warm', 'cool', 'sepia', 'gold', 'night', 'blood'] as const;
export type Tint = (typeof TINTS)[number];

export const FX_TYPES = [
  'particles',
  'light-rays',
  'aura',
  'divine-light',
  'flash',
  'shockwave',
  'lightning',
  'fire',
  'fog',
  'speed-lines',
  'tint',
  'vignette',
  'grain',
] as const;
export type FxType = (typeof FX_TYPES)[number];

export const CAPTION_STYLES = ['bold', 'boxed', 'clean', 'gold', 'none'] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

export const CAPTION_POSITIONS = ['top', 'center', 'bottom'] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];

export const SFX = [
  'whoosh',
  'bell',
  'conch',
  'drum-hit',
  'thunder',
  'sparkle',
  'arrow',
  'gong',
  'riser',
  'heartbeat',
] as const;
export type SfxId = (typeof SFX)[number];

export const MUSIC_MOODS = ['devotional', 'epic', 'mystic', 'calm', 'suspense', 'playful', 'none'] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];

export const OVERLAY_KINDS = ['title', 'chapter', 'quote', 'lower-third'] as const;
export type OverlayKind = (typeof OVERLAY_KINDS)[number];

export const ENTER_FROM = ['left', 'right', 'bottom', 'top', 'fade', 'pop'] as const;
export type EnterFrom = (typeof ENTER_FROM)[number];

export const LOOK_DIRECTIONS = ['camera', 'left', 'right', 'up', 'down'] as const;
export type LookDirection = (typeof LOOK_DIRECTIONS)[number];

export const EASES = ['smooth', 'linear', 'spring'] as const;
export type Ease = (typeof EASES)[number];

/** One-line meanings, injected into AI prompts so the model knows the vocabulary. */
export const VOCAB_DOCS = {
  poses: {
    stand: 'relaxed standing',
    'raise-hand': 'right hand raised high — greeting, calling out, making a point',
    bless: 'right palm raised at shoulder, facing viewer (abhaya mudra) — blessing, reassurance',
    point: 'right arm pointing outward — showing, accusing, commanding',
    namaste: 'palms joined at chest — prayer, respect, greeting',
    'arms-open': 'both arms spread wide — revelation, divine form, welcome',
    think: 'hand at chin — pondering, doubt',
    sad: 'slumped, head bowed — grief, defeat',
    fight: 'weapon raised overhead, other arm guarding — battle',
    'draw-bow': 'archer stance, bow arm extended, string pulled back',
    flute: 'playing a flute held to the right',
    reins: 'both hands forward holding reins — driving a chariot',
    'arms-crossed': 'arms folded — stubborn, waiting, proud',
    confident: 'hands on hips — pride, authority',
    meditate: 'seated cross-legged, hands on knees',
    walk: 'walking in place (combine with a move action to travel)',
  } satisfies Record<Pose, string>,
  expressions: {
    neutral: 'calm resting face',
    smile: 'gentle smile',
    joy: 'big happy smile',
    sad: 'downturned, sorrowful',
    angry: 'furrowed brows, frown',
    surprised: 'eyes wide, mouth open',
    serene: 'eyes closed, peaceful smile',
    worried: 'raised inner brows, tense mouth',
    determined: 'focused eyes, firm mouth',
  } satisfies Record<Expression, string>,
  camera: {
    static: 'locked-off frame',
    'push-in': 'slow zoom toward the focus point — intimacy, emphasis',
    'pull-out': 'slow zoom out — reveal, scale',
    'pan-left': 'camera glides left with parallax',
    'pan-right': 'camera glides right with parallax',
    'tilt-up': 'camera rises — awe, revealing height',
    'tilt-down': 'camera lowers — grounding, sorrow',
    drift: 'gentle floating motion — dreamy, calm',
    'crash-zoom': 'fast punch-in at the start — shock, impact',
    handheld: 'subtle organic sway — tension, realism',
    shake: 'violent shake — impact, battle, earthquake',
  } satisfies Record<CameraMove, string>,
  transitions: {
    cut: 'hard cut',
    fade: 'cross-fade from previous shot',
    'dip-black': 'fade through black — time passes',
    'dip-white': 'fade through white — divine, memory',
    flash: 'white flash — impact, revelation',
    zoom: 'zoom-blur through — energy',
    'slide-left': 'new shot pushes in from the right',
    'slide-up': 'new shot pushes up from below',
    whip: 'fast whip pan — action',
  } satisfies Record<Transition, string>,
  fx: {
    particles: 'ambient particles; variant: dust | embers | petals | sparkles | snow | rain | fireflies | leaves',
    'light-rays': 'god rays from the top of frame',
    aura: 'glowing halo behind an actor (target = actor id) — divinity',
    'divine-light': 'beam of light from above onto x position',
    flash: 'brief full-screen flash at `at`',
    shockwave: 'expanding energy ring at (x, y) at `at`',
    lightning: 'lightning strikes with flashes',
    fire: 'flames at (x, y), e.g. yagna fire, burning city',
    fog: 'drifting mist',
    'speed-lines': 'radial motion lines — speed, charge',
    tint: 'colour grade; variant: warm | cool | sepia | gold | night | blood',
    vignette: 'dark edges, focus to centre',
    grain: 'film grain texture',
  } satisfies Record<FxType, string>,
  sfx: {
    whoosh: 'fast air movement — entrances, transitions',
    bell: 'temple bell ring',
    conch: 'conch shell (shankh) blast — battle start, divine announcement',
    'drum-hit': 'deep war drum hit — impact, emphasis',
    thunder: 'thunder rumble',
    sparkle: 'magical shimmer — divine moments',
    arrow: 'arrow release and flight',
    gong: 'large gong — chapter start, gravity',
    riser: 'tension swell into the next beat',
    heartbeat: 'slow heartbeats — fear, suspense',
  } satisfies Record<SfxId, string>,
  music: {
    devotional: 'tanpura drone with a bansuri melody',
    epic: 'war drums and a deep drone — battles, power',
    mystic: 'ethereal pads and bells — cosmic, divine',
    calm: 'soft drone and gentle flute — peaceful, reflective',
    suspense: 'low pulses — tension, mystery',
    playful: 'light percussion and lively flute — childhood, mischief',
    none: 'no music',
  } satisfies Record<MusicMood, string>,
} as const;
