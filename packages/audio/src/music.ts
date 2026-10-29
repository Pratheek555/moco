import type { MusicMood } from '@moco/spec';
import { addDrum, addNoise, addTone, fadeEdges, hz, reverb, rng } from './dsp.ts';
import { encodeWav, stereo, type Stereo } from './wav.ts';

// Procedural, royalty-free music beds in an Indian classical idiom: a tanpura
// drone, bansuri phrases on a raga scale, temple bells and dhol/tabla patterns.

const SCALES = {
  bhupali: [0, 2, 4, 7, 9],
  yaman: [0, 2, 4, 6, 7, 9, 11],
  bhairav: [0, 1, 4, 5, 7, 8, 11],
  kafi: [0, 2, 3, 5, 7, 9, 10],
};

const TANPURA_HARMONICS = [1, 0.85, 0.62, 0.55, 0.42, 0.36, 0.3, 0.24, 0.19, 0.15, 0.12, 0.1, 0.08];

function tanpura(buf: Stereo, seconds: number, amp: number) {
  const cycle = 3.2;
  const pattern: [number, number][] = [
    [7 - 24, 0],
    [0 - 12, 0.8],
    [0 - 12, 1.6],
    [0 - 24, 2.4],
  ];
  for (let c = 0; c * cycle < seconds + cycle; c++) {
    for (const [semi, off] of pattern) {
      addTone(buf, c * cycle + off, 2.6, hz(semi), amp, { attack: 0.015, decay: 2.4, release: 0.6, harmonics: TANPURA_HARMONICS, vibrato: { rate: 0.3, depth: 0.0015 }, pan: ((c + off) % 2) - 0.5 });
    }
  }
}

function bell(buf: Stereo, at: number, freq: number, amp: number, pan = 0) {
  addTone(buf, at, 0.01, freq, amp, {
    attack: 0.002,
    release: 3.5,
    partials: [
      { ratio: 1, amp: 1, decay: 2.2 },
      { ratio: 2.0, amp: 0.5, decay: 1.6 },
      { ratio: 2.76, amp: 0.45, decay: 1.2 },
      { ratio: 4.07, amp: 0.25, decay: 0.8 },
      { ratio: 5.4, amp: 0.18, decay: 0.5 },
    ],
    pan,
  });
}

function flute(buf: Stereo, seconds: number, scale: number[], r: () => number, opts: { amp: number; durations: number[]; rest: [number, number]; start?: number; octave?: number }) {
  let t = opts.start ?? 1.5;
  let degree = 0;
  let prev: number | undefined;
  const octave = opts.octave ?? 0;
  while (t < seconds - 1.5) {
    const phraseLen = 3 + Math.floor(r() * 5);
    for (let i = 0; i < phraseLen && t < seconds - 1; i++) {
      const step = r() < 0.7 ? (r() < 0.5 ? -1 : 1) : r() < 0.5 ? -2 : 2;
      degree = Math.max(-2, Math.min(scale.length + 2, degree + step));
      if (i === phraseLen - 1) degree = [0, 2, scale.length][Math.floor(r() * 3)]!;
      const idx = ((degree % scale.length) + scale.length) % scale.length;
      const oct = Math.floor(degree / scale.length);
      const freq = hz(scale[idx]! + 12 * (oct + octave));
      const dur = opts.durations[Math.floor(r() * opts.durations.length)]!;
      addTone(buf, t, dur, freq, opts.amp, {
        attack: 0.07,
        release: 0.25,
        harmonics: [1, 0.22, 0.07, 0.03],
        vibrato: { rate: 5.2, depth: 0.007, delay: Math.min(0.35, dur * 0.5) },
        breath: 0.05,
        from: prev && Math.abs(Math.log2(prev / freq)) < 0.3 && r() < 0.5 ? prev : undefined,
        glideTime: 0.12,
        pan: 0.15,
        seed: Math.floor(t * 100),
      });
      prev = freq;
      t += dur;
    }
    t += opts.rest[0] + r() * (opts.rest[1] - opts.rest[0]);
  }
}

function pad(buf: Stereo, seconds: number, chords: number[][], amp: number, len = 6) {
  for (let c = 0; c * len < seconds + len; c++) {
    const chord = chords[c % chords.length]!;
    for (const semi of chord) {
      for (const det of [-0.003, 0.003]) {
        addTone(buf, c * len - 0.5, len + 0.5, hz(semi) * (1 + det), amp, { attack: 2.4, release: 2.6, harmonics: [1, 0.3, 0.12], vibrato: { rate: 0.2, depth: 0.002 }, pan: det > 0 ? 0.4 : -0.4 });
      }
    }
  }
}

export function composeMusic(mood: MusicMood, seconds: number, seed = 1): Stereo {
  const total = seconds + 1.5;
  const buf = stereo(total);
  const r = rng(seed * 7919 + mood.length);
  switch (mood) {
    case 'devotional': {
      tanpura(buf, total, 0.05);
      flute(buf, total, SCALES.yaman, r, { amp: 0.11, durations: [0.5, 0.75, 1, 1.5, 2], rest: [0.6, 1.4] });
      for (let t = 2.5; t < total - 2; t += 5 + r() * 3) bell(buf, t, hz(12 + [0, 7][Math.floor(r() * 2)]!) * 2, 0.04, r() - 0.5);
      reverb(buf, 0.35);
      break;
    }
    case 'calm': {
      tanpura(buf, total, 0.035);
      pad(buf, total, [[-12, -5], [-12, -8]], 0.02, 8);
      flute(buf, total, SCALES.bhupali, r, { amp: 0.09, durations: [1, 1.5, 2, 2.5], rest: [1.2, 2.4], start: 2.5 });
      reverb(buf, 0.4);
      break;
    }
    case 'mystic': {
      pad(buf, total, [[-12, -8, -5], [-11, -7, -5], [-12, -8, -1]], 0.022, 6);
      for (let t = 1; t < total - 2; t += 1.2 + r() * 2.2) {
        const semi = SCALES.bhairav[Math.floor(r() * SCALES.bhairav.length)]!;
        bell(buf, t, hz(semi + 12), 0.045, r() * 1.6 - 0.8);
      }
      addNoise(buf, 0, total, 0.012, { lowpass: (t) => 600 + Math.sin(t * 0.4) * 400, seed: 11 });
      reverb(buf, 0.5, 0.88);
      break;
    }
    case 'epic': {
      const beat = 60 / 92;
      addTone(buf, 0, total, hz(-24), 0.06, { attack: 2, release: 1, harmonics: [1, 0.5, 0.33, 0.25, 0.2, 0.16, 0.12] });
      addTone(buf, 0, total, hz(-17), 0.035, { attack: 3, release: 1, harmonics: [1, 0.45, 0.3, 0.2] });
      const pattern = [1, 0, 0, 0.5, 0, 0, 1, 0, 0.8, 0, 0.6, 0, 1, 0, 0.5, 0.5];
      for (let step = 0; step * (beat / 4) < total - 1; step++) {
        const v = pattern[step % 16]!;
        const t = step * (beat / 4) + 0.6;
        if (v) addDrum(buf, t, 0.5 * v, { f0: 140, f1: 52, decay: 0.32, click: 0.4, pan: -0.1 });
        if (step % 4 === 2) addDrum(buf, t, 0.12, { f0: 330, f1: 260, decay: 0.09, click: 0.6, pan: 0.3 });
        if (step % 64 === 60) for (let k = 0; k < 4; k++) addDrum(buf, t + k * (beat / 4), 0.3 + k * 0.08, { f0: 180 - k * 10, f1: 70, decay: 0.2 });
      }
      for (let t = 4 * beat * 4; t < total - 3; t += 8 * beat * 4) {
        for (const semi of [-12, -5, 0]) addTone(buf, t, beat * 6, hz(semi), 0.035, { attack: 1.4, release: 1.2, harmonics: [1, 0.6, 0.45, 0.3, 0.22, 0.15], vibrato: { rate: 4.5, depth: 0.004, delay: 0.8 } });
      }
      reverb(buf, 0.22);
      break;
    }
    case 'suspense': {
      addTone(buf, 0, total, hz(-24), 0.05, { attack: 2, release: 1, harmonics: [1, 0.2] });
      addTone(buf, 0, total, hz(-24) * 1.03, 0.04, { attack: 3, release: 1, harmonics: [1, 0.2] });
      addTone(buf, 1, total - 1, hz(24 + 1), 0.012, { attack: 4, release: 1, vibrato: { rate: 6, depth: 0.01 } });
      for (let t = 0.8; t < total - 1; t += 60 / 68) {
        addDrum(buf, t, 0.32, { f0: 70, f1: 38, decay: 0.16, click: 0.1 });
        addDrum(buf, t + 0.22, 0.22, { f0: 64, f1: 36, decay: 0.14, click: 0.1 });
      }
      for (let t = 6; t < total - 3; t += 8) addNoise(buf, t, 2.2, 0.08, { lowpass: (x) => 300 + x * 2200, env: (x) => Math.pow(x / 2.2, 2), seed: Math.floor(t) });
      reverb(buf, 0.3);
      break;
    }
    case 'playful': {
      tanpura(buf, total, 0.03);
      const beat = 60 / 112;
      const bols = ['dha', 'dhin', 'dhin', 'dha', 'dha', 'dhin', 'dhin', 'dha', 'dha', 'tin', 'tin', 'ta', 'ta', 'dhin', 'dhin', 'dha'];
      for (let step = 0; step * (beat / 2) < total - 1; step++) {
        const t = step * (beat / 2) + 0.4;
        const bol = bols[step % 16]!;
        const ring = (f: number, a: number) => addTone(buf, t, 0.02, f, a, { attack: 0.002, release: 0.4, partials: [{ ratio: 1, amp: 1, decay: 0.16 }, { ratio: 2.01, amp: 0.4, decay: 0.1 }, { ratio: 3.02, amp: 0.2, decay: 0.06 }], pan: 0.25 });
        if (bol.startsWith('dh')) addDrum(buf, t, 0.22, { f0: 120, f1: 75, decay: 0.2, click: 0.2, pan: -0.2 });
        if (bol === 'dha' || bol === 'ta') ring(hz(12), 0.05);
        if (bol === 'dhin' || bol === 'tin') ring(hz(19), 0.035);
      }
      flute(buf, total, SCALES.bhupali, r, { amp: 0.1, durations: [0.27, 0.27, 0.54, 0.8], rest: [0.3, 0.9], octave: 1 });
      reverb(buf, 0.2);
      break;
    }
    default:
      break;
  }
  fadeEdges(buf, 0.4, 1.4);
  return buf;
}

export function renderMusic(mood: MusicMood, seconds: number, seed = 1): Buffer {
  return encodeWav(composeMusic(mood, seconds, seed), 0.8);
}
