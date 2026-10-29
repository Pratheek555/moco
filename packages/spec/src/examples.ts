import type { EpisodeInput, ShotInput } from './schema.ts';

// Hand-built reference scenes. They set the quality bar, seed the demo
// project, and are shown to the AI as examples of good specs.

/** The first-step scene from the brief: Krishna on a chariot — blink, raise hand, caption. */
export const KRISHNA_CHARIOT_SHOT: ShotInput = {
  id: 'krishna-counsel',
  duration: 7,
  narration: 'Krishna smiled and said: do your duty, Arjuna, and let go of the fruits of your actions.',
  speaker: 'krishna',
  background: { id: 'kurukshetra', time: 'dusk' },
  camera: { move: 'push-in', intensity: 0.45, focus: { x: 0.42, y: 0.4 } },
  props: [{ id: 'chariot', prop: 'chariot', x: 0.3, y: 0.92, scale: 0.78, moving: false }],
  actors: [
    {
      id: 'krishna',
      character: 'krishna',
      ride: 'chariot',
      x: 0.45,
      pose: 'reins',
      expression: 'smile',
      actions: [
        { type: 'look', at: 0.4, direction: 'camera' },
        { type: 'pose', at: 1.4, pose: 'bless', duration: 0.6 },
        { type: 'nod', at: 4.2 },
      ],
    },
    { id: 'arjuna', character: 'arjuna', ride: 'chariot', x: -0.55, pose: 'sad', expression: 'worried', actions: [{ type: 'look', at: 0.5, direction: 'right' }] },
  ],
  fx: [
    { type: 'aura', target: 'krishna', at: 1.4, color: '#ffd36b', intensity: 0.75 },
    { type: 'light-rays', intensity: 0.45 },
    { type: 'particles', variant: 'dust', intensity: 0.4 },
    { type: 'vignette', intensity: 0.45 },
  ],
  sfx: [{ id: 'sparkle', at: 1.4, volume: 0.8 }],
  transition: 'fade',
};

const shots: ShotInput[] = [
  {
    id: 'armies',
    duration: 4.5,
    narration: 'Two great armies stood face to face on the field of Kurukshetra.',
    background: { id: 'kurukshetra', time: 'dusk' },
    camera: { move: 'pull-out', intensity: 0.5 },
    props: [
      { id: 'chariot', prop: 'chariot', x: 0.22, y: 0.93, scale: 0.7, moving: true, actions: [{ type: 'move', at: 0, duration: 4.5, x: 0.34, ease: 'linear' }] },
      { id: 'banner', prop: 'banner', x: 0.93, y: 0.9, scale: 0.9 },
    ],
    actors: [
      { id: 'krishna', character: 'krishna', ride: 'chariot', x: 0.45, pose: 'reins', expression: 'determined' },
      { id: 'arjuna', character: 'arjuna', ride: 'chariot', x: -0.5, pose: 'stand', expression: 'determined' },
    ],
    fx: [
      { type: 'particles', variant: 'dust', intensity: 0.6 },
      { type: 'tint', variant: 'warm', intensity: 0.35 },
      { type: 'vignette', intensity: 0.5 },
    ],
    sfx: [
      { id: 'conch', at: 0.2, volume: 0.9 },
      { id: 'drum-hit', at: 2.6 },
    ],
    overlay: { kind: 'title', text: 'The Song of God', subtitle: 'Mahabharat · Episode 1', at: 0.4, duration: 3.6 },
  },
  {
    id: 'arjuna-doubt',
    duration: 4.5,
    narration: 'But Arjuna lowered his bow. How could he fight his own family?',
    speaker: 'arjuna',
    background: { id: 'kurukshetra', time: 'dusk' },
    camera: { move: 'push-in', intensity: 0.6, focus: { x: 0.5, y: 0.35 } },
    actors: [
      {
        id: 'arjuna',
        character: 'arjuna',
        x: 0.5,
        y: 1.16,
        scale: 1.75,
        pose: 'stand',
        expression: 'worried',
        actions: [
          { type: 'pose', at: 1.2, pose: 'sad', duration: 0.8 },
          { type: 'expression', at: 1.2, expression: 'sad' },
          { type: 'look', at: 1.4, direction: 'down' },
        ],
      },
    ],
    fx: [
      { type: 'tint', variant: 'cool', intensity: 0.45 },
      { type: 'particles', variant: 'embers', intensity: 0.35 },
      { type: 'vignette', intensity: 0.6 },
    ],
    sfx: [{ id: 'heartbeat', at: 0.5, volume: 0.8 }],
    transition: 'dip-black',
  },
  KRISHNA_CHARIOT_SHOT,
  {
    id: 'vishwaroop',
    duration: 4.5,
    narration: 'Then he revealed his cosmic form — the whole universe within him.',
    background: { id: 'cosmos', time: 'night' },
    camera: { move: 'crash-zoom', intensity: 0.5, focus: { x: 0.5, y: 0.45 } },
    actors: [{ id: 'krishna', character: 'krishna', x: 0.5, y: 0.86, scale: 1.25, pose: 'arms-open', expression: 'serene', holdRight: 'chakra' }],
    fx: [
      { type: 'aura', target: 'krishna', color: '#ffd36b', intensity: 1 },
      { type: 'shockwave', x: 0.5, y: 0.42, at: 0.15, duration: 1.4 },
      { type: 'particles', variant: 'sparkles', intensity: 0.8 },
      { type: 'divine-light', x: 0.5, intensity: 0.6 },
    ],
    sfx: [
      { id: 'gong', at: 0 },
      { id: 'riser', at: 1.5, volume: 0.6 },
    ],
    transition: 'flash',
  },
  {
    id: 'arjuna-bows',
    duration: 5,
    narration: 'Arjuna bowed. His doubt was gone. He was ready.',
    background: { id: 'kurukshetra', time: 'dawn' },
    camera: { move: 'tilt-up', intensity: 0.4 },
    actors: [
      { id: 'arjuna', character: 'arjuna', x: 0.38, scale: 1.05, pose: 'namaste', expression: 'serene', actions: [{ type: 'pose', at: 2.6, pose: 'draw-bow', duration: 0.7 }, { type: 'expression', at: 2.6, expression: 'determined' }] },
      { id: 'krishna', character: 'krishna', x: 0.74, scale: 1.05, facing: 'left', pose: 'bless', expression: 'smile' },
    ],
    fx: [
      { type: 'light-rays', intensity: 0.55, color: '#ffe2b0' },
      { type: 'particles', variant: 'petals', intensity: 0.5 },
    ],
    sfx: [{ id: 'arrow', at: 3.4 }],
    overlay: { kind: 'quote', text: 'कर्मण्येवाधिकारस्ते', subtitle: 'Your right is to the work alone — Gita 2.47', at: 0.6, duration: 4 },
    transition: 'dip-white',
  },
];

export const DEMO_EPISODE: EpisodeInput = {
  id: 'demo-gita',
  number: 1,
  title: 'The Song of God',
  hook: 'On the eve of the great war, the greatest warrior refuses to fight.',
  summary: 'At Kurukshetra, Arjuna loses heart before battle. Krishna, his charioteer, counsels him on duty and reveals his cosmic form; Arjuna rises, resolved.',
  language: 'en',
  shots,
  music: { mood: 'devotional', volume: 0.3 },
  captions: { style: 'bold', position: 'bottom', highlight: '#ffd60a' },
  brand: { handle: '@moco.reels', watermark: true, progressBar: true },
};
