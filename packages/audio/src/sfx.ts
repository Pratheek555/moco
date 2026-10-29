import type { SfxId } from '@moco/spec';
import { addDrum, addNoise, addTone, hz, reverb, rng } from './dsp.ts';
import { encodeWav, stereo } from './wav.ts';

/** Synthesised sound effects — deterministic, royalty-free, generated once and cached. */
export function renderSfx(id: SfxId): Buffer {
  switch (id) {
    case 'whoosh': {
      const buf = stereo(0.9);
      addNoise(buf, 0, 0.8, 0.7, { lowpass: (t) => 300 + Math.sin((t / 0.8) * Math.PI) * 3200, env: (t) => Math.sin((t / 0.8) * Math.PI) ** 2, highpass: 120, pan: -0.2 });
      return encodeWav(buf);
    }
    case 'bell': {
      const buf = stereo(4);
      addTone(buf, 0.01, 0.01, 660, 0.5, { attack: 0.002, release: 3.8, partials: [{ ratio: 1, amp: 1, decay: 2.6 }, { ratio: 2.0, amp: 0.6, decay: 1.8 }, { ratio: 2.76, amp: 0.5, decay: 1.3 }, { ratio: 4.07, amp: 0.3, decay: 0.8 }, { ratio: 5.4, amp: 0.25, decay: 0.5 }, { ratio: 6.8, amp: 0.1, decay: 0.3 }] });
      reverb(buf, 0.3);
      return encodeWav(buf);
    }
    case 'conch': {
      const buf = stereo(2.8);
      addTone(buf, 0.05, 1.9, 233, 0.4, { from: 220, glideTime: 0.6, attack: 0.35, release: 0.5, harmonics: [1, 0.7, 0.55, 0.42, 0.3, 0.22, 0.16, 0.1], vibrato: { rate: 5, depth: 0.006, delay: 0.5 }, breath: 0.12 });
      reverb(buf, 0.35);
      return encodeWav(buf);
    }
    case 'drum-hit': {
      const buf = stereo(1.6);
      addDrum(buf, 0.01, 1, { f0: 110, f1: 38, decay: 0.45, click: 0.7 });
      addNoise(buf, 0.01, 0.6, 0.25, { lowpass: () => 400, decay: 0.2 });
      reverb(buf, 0.25);
      return encodeWav(buf);
    }
    case 'thunder': {
      const buf = stereo(3.6);
      const r = rng(9);
      addNoise(buf, 0, 3.5, 0.9, { lowpass: (t) => 180 + 500 * Math.exp(-t * 2), env: (t) => (t < 0.05 ? t / 0.05 : Math.exp(-t * 0.9)) * (0.6 + 0.4 * Math.sin(t * 7 + r())) });
      addNoise(buf, 0, 0.3, 0.5, { lowpass: () => 3000, decay: 0.06 });
      return encodeWav(buf);
    }
    case 'sparkle': {
      const buf = stereo(1.8);
      const r = rng(4);
      for (let i = 0; i < 9; i++) addTone(buf, i * 0.07, 0.01, hz(24 + [0, 4, 7, 11, 12, 16, 19][i % 7]!), 0.18, { attack: 0.002, release: 0.9, partials: [{ ratio: 1, amp: 1, decay: 0.5 }, { ratio: 2.7, amp: 0.3, decay: 0.2 }], pan: r() * 1.6 - 0.8 });
      reverb(buf, 0.45);
      return encodeWav(buf);
    }
    case 'arrow': {
      const buf = stereo(1.1);
      addTone(buf, 0, 0.5, 900, 0.18, { from: 1700, glideTime: 0.5, attack: 0.02, release: 0.1 });
      addNoise(buf, 0, 0.55, 0.45, { lowpass: (t) => 2500 - t * 2500, env: (t) => Math.sin((t / 0.55) * Math.PI), highpass: 300 });
      addDrum(buf, 0.6, 0.45, { f0: 200, f1: 90, decay: 0.08, click: 0.9 });
      return encodeWav(buf);
    }
    case 'gong': {
      const buf = stereo(6);
      addTone(buf, 0.02, 0.01, 98, 0.6, { attack: 0.03, release: 5.5, partials: [{ ratio: 1, amp: 1, decay: 4 }, { ratio: 1.48, amp: 0.6, decay: 3.2 }, { ratio: 2.1, amp: 0.5, decay: 2.6 }, { ratio: 2.9, amp: 0.4, decay: 2 }, { ratio: 3.6, amp: 0.3, decay: 1.5 }, { ratio: 4.7, amp: 0.2, decay: 1 }], vibrato: { rate: 3, depth: 0.003 } });
      reverb(buf, 0.4, 0.88);
      return encodeWav(buf);
    }
    case 'riser': {
      const buf = stereo(2.4);
      addNoise(buf, 0, 2.2, 0.5, { lowpass: (t) => 200 + Math.pow(t / 2.2, 2) * 6000, env: (t) => Math.pow(t / 2.2, 1.6) });
      addTone(buf, 0, 2.2, 1100, 0.12, { from: 180, glideTime: 2.2, attack: 1.2, release: 0.05, harmonics: [1, 0.5, 0.3] });
      return encodeWav(buf);
    }
    case 'heartbeat': {
      const buf = stereo(3.2);
      for (let i = 0; i < 3; i++) {
        addDrum(buf, i * 0.95, 0.9, { f0: 75, f1: 40, decay: 0.12, click: 0.05 });
        addDrum(buf, i * 0.95 + 0.24, 0.65, { f0: 68, f1: 38, decay: 0.1, click: 0.05 });
      }
      return encodeWav(buf);
    }
  }
}
