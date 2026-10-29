import { SAMPLE_RATE as SR, type Stereo } from './wav.ts';

export const TAU = Math.PI * 2;

export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hz = (semitonesFromSa: number, sa = 277.18) => sa * Math.pow(2, semitonesFromSa / 12);

export interface ToneOpts {
  attack?: number;
  release?: number;
  /** Exponential decay time constant (s); 0 = sustain until release. */
  decay?: number;
  /** Relative amplitudes of harmonics 1, 2, 3… */
  harmonics?: number[];
  /** Inharmonic partial ratios (overrides harmonics). */
  partials?: { ratio: number; amp: number; decay?: number }[];
  vibrato?: { rate: number; depth: number; delay?: number };
  /** Glide from this frequency over `glideTime`. */
  from?: number;
  glideTime?: number;
  pan?: number;
  /** Mix of filtered breath noise (0..1). */
  breath?: number;
  seed?: number;
}

/** Add one additive-synth note into the buffer. */
export function addTone(buf: Stereo, start: number, dur: number, freq: number, amp: number, o: ToneOpts = {}) {
  const attack = o.attack ?? 0.01;
  const release = o.release ?? 0.1;
  const s0 = Math.max(0, Math.floor(start * SR));
  const total = Math.floor((dur + release) * SR);
  const s1 = Math.min(buf.L.length, s0 + total);
  const pan = o.pan ?? 0;
  const gl = Math.cos(((pan + 1) / 2) * (Math.PI / 2));
  const gr = Math.sin(((pan + 1) / 2) * (Math.PI / 2));
  const parts = o.partials ?? (o.harmonics ?? [1]).map((a, i) => ({ ratio: i + 1, amp: a, decay: undefined as number | undefined }));
  const phases = new Float64Array(parts.length);
  const noise = rng(o.seed ?? 7);
  let lp = 0;
  for (let s = s0; s < s1; s++) {
    const t = (s - s0) / SR;
    let env = t < attack ? t / attack : 1;
    if (o.decay) env *= Math.exp(-(t - Math.min(t, attack)) / o.decay);
    if (t > dur) env *= Math.max(0, 1 - (t - dur) / release);
    if (env <= 1e-5 && t > attack) continue;
    let f = freq;
    if (o.from !== undefined) {
      const g = Math.min(1, t / (o.glideTime ?? 0.15));
      f = o.from + (freq - o.from) * (1 - Math.pow(1 - g, 2));
    }
    if (o.vibrato && t > (o.vibrato.delay ?? 0)) f *= 1 + Math.sin(TAU * o.vibrato.rate * t) * o.vibrato.depth;
    let v = 0;
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p]!;
      phases[p] = (phases[p]! + (f * part.ratio) / SR) % 1;
      let pa = part.amp;
      if (part.decay) pa *= Math.exp(-t / part.decay);
      v += Math.sin(TAU * phases[p]!) * pa;
    }
    if (o.breath) {
      lp += 0.08 * ((noise() * 2 - 1) - lp);
      v += lp * o.breath * 3;
    }
    v *= env * amp;
    buf.L[s]! += v * gl;
    buf.R[s]! += v * gr;
  }
}

/** Filtered noise burst — whooshes, snares, breath, rain. */
export function addNoise(buf: Stereo, start: number, dur: number, amp: number, o: { lowpass?: (t: number) => number; highpass?: number; attack?: number; decay?: number; pan?: number; seed?: number; env?: (t: number) => number } = {}) {
  const s0 = Math.max(0, Math.floor(start * SR));
  const s1 = Math.min(buf.L.length, s0 + Math.floor(dur * SR));
  const r = rng(o.seed ?? 3);
  let lp = 0;
  let hpPrev = 0;
  let hpOut = 0;
  const pan = o.pan ?? 0;
  const gl = Math.cos(((pan + 1) / 2) * (Math.PI / 2));
  const gr = Math.sin(((pan + 1) / 2) * (Math.PI / 2));
  for (let s = s0; s < s1; s++) {
    const t = (s - s0) / SR;
    const x = r() * 2 - 1;
    const cutoff = o.lowpass ? o.lowpass(t) : 8000;
    const a = 1 - Math.exp((-TAU * cutoff) / SR);
    lp += a * (x - lp);
    let y = lp;
    if (o.highpass) {
      const rc = 1 / (TAU * o.highpass);
      const k = rc / (rc + 1 / SR);
      hpOut = k * (hpOut + y - hpPrev);
      hpPrev = y;
      y = hpOut;
    }
    let env = o.env ? o.env(t) : 1;
    if (o.attack && t < o.attack) env *= t / o.attack;
    if (o.decay) env *= Math.exp(-t / o.decay);
    const v = y * env * amp;
    buf.L[s]! += v * gl;
    buf.R[s]! += v * gr;
  }
}

/** A drum: pitch-dropping sine plus a click. */
export function addDrum(buf: Stereo, start: number, amp: number, o: { f0?: number; f1?: number; decay?: number; click?: number; pan?: number } = {}) {
  const f0 = o.f0 ?? 120;
  const f1 = o.f1 ?? 45;
  const decay = o.decay ?? 0.35;
  const s0 = Math.floor(start * SR);
  const n = Math.floor(decay * 6 * SR);
  let phase = 0;
  const r = rng(Math.floor(start * 1000) + 1);
  const pan = o.pan ?? 0;
  const gl = Math.cos(((pan + 1) / 2) * (Math.PI / 2));
  const gr = Math.sin(((pan + 1) / 2) * (Math.PI / 2));
  for (let i = 0; i < n && s0 + i < buf.L.length; i++) {
    if (s0 + i < 0) continue;
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t / 0.05);
    phase += f / SR;
    let v = Math.sin(TAU * phase) * Math.exp(-t / decay);
    if (t < 0.012) v += (r() * 2 - 1) * (o.click ?? 0.5) * (1 - t / 0.012);
    v *= amp;
    buf.L[s0 + i]! += v * gl;
    buf.R[s0 + i]! += v * gr;
  }
}

/** Small stereo Schroeder reverb, mixed in place. */
export function reverb(buf: Stereo, mix = 0.3, room = 0.84, damp = 0.3) {
  const process = (input: Float32Array, spread: number) => {
    const combs = [1116, 1188, 1277, 1356, 1422, 1491].map((d) => ({ buf: new Float32Array(d + spread), i: 0, store: 0 }));
    const aps = [556, 441, 341].map((d) => ({ buf: new Float32Array(d + spread), i: 0 }));
    const out = new Float32Array(input.length);
    for (let s = 0; s < input.length; s++) {
      const x = input[s]! * 0.015;
      let y = 0;
      for (const c of combs) {
        const v = c.buf[c.i]!;
        c.store = v * (1 - damp) + c.store * damp;
        c.buf[c.i] = x + c.store * room;
        c.i = (c.i + 1) % c.buf.length;
        y += v;
      }
      for (const a of aps) {
        const v = a.buf[a.i]!;
        a.buf[a.i] = y + v * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        y = v - y;
      }
      out[s] = y;
    }
    return out;
  };
  const wl = process(buf.L, 0);
  const wr = process(buf.R, 23);
  for (let s = 0; s < buf.L.length; s++) {
    buf.L[s] = buf.L[s]! * (1 - mix * 0.5) + wl[s]! * mix * 3;
    buf.R[s] = buf.R[s]! * (1 - mix * 0.5) + wr[s]! * mix * 3;
  }
}

export function fadeEdges(buf: Stereo, fadeIn = 0.5, fadeOut = 1.5) {
  const n = buf.L.length;
  const fi = Math.floor(fadeIn * SR);
  const fo = Math.floor(fadeOut * SR);
  for (let s = 0; s < n; s++) {
    let g = 1;
    if (s < fi) g = s / fi;
    if (s > n - fo) g = Math.min(g, (n - s) / fo);
    buf.L[s]! *= g;
    buf.R[s]! *= g;
  }
}
