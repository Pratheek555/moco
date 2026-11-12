// motion.mjs — limited animation, the way this format moves.
//
// The picture is HELD most of the time. Life comes from a few sharp events, never from constant wiggle:
//   - pose swap ("duck and pop"): the figure dips and squashes for ~3 frames, the new drawing rises,
//     overshoots a little and settles. About 0.12-0.16 s in all. Use it on the word that changes the thought.
//   - mouth flaps: three or four mouth drawings chosen from the loudness of the voice, changing only
//     every 1/12 s. Listeners keep their mouths shut.
//   - snap zoom: the camera jumps in 15-35% in about 0.13 s, usually together with a pose swap.
//   - slow drift: between events the camera creeps (2-4% over a shot). It never stops dead.
//   - pops: labels, props and map pieces arrive by scaling up past full size and settling.
//   - hard cuts between shots. No cross-dissolves except inside explanation boards.
// All times are seconds from the start of the shot.
import { clamp, lerp } from './ink.mjs';

export const ease = t => { t = clamp(t); return t * t * (3 - 2 * t); };
export const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);
export const easeIn = t => Math.pow(clamp(t), 3);
export const back = (t, s = 1.9) => { t = clamp(t) - 1; return 1 + (s + 1) * t * t * t + s * t * t; };   // overshoot then settle
export const span = (t, a, b) => clamp((t - a) / Math.max(1e-6, b - a));                                    // 0..1 progress from a to b
export const between = (t, a, b) => t >= a && t < b;
export const hold = (t, step = 1 / 12) => Math.floor(t / step) * step;                                      // quantise time: animate "on twos"

// pop(t, at): 0 before `at`, then a quick overshoot to 1. Multiply a scale by it to make things arrive.
export const pop = (t, at = 0, dur = 0.22) => t < at ? 0 : back((t - at) / dur);
// slide(t, at, from, to): move a number with a quick ease and a small overshoot (props, arms, sliding figures).
export const slide = (t, at, from, to, dur = 0.26) => t < at ? from : lerp(from, to, back((t - at) / dur, 1.1));
// Linear camera or value move over a window, eased.
export const move = (t, a, b, from, to) => lerp(from, to, ease(span(t, a, b)));

// beats(t, keys): pose-to-pose acting. keys = [[time, pose], [time, pose], …] in time order.
// Returns the current pose merged with the squash/pop of the swap, ready to spread into figure():
//     figure(c, baker, { x: 700, y: 900, h: 620, ...beats(t, [[0, calm], [s.cue(1), furious]]) })
// Poses are whole drawings: nothing is tweened between them, exactly like swapping two cut-outs.
export function beats(t, keys, o = {}) {
  let i = 0; while (i < keys.length - 1 && t >= keys[i + 1][0]) i++;
  const [t0, pose] = keys[i], next = keys[i + 1], rise = o.rise ?? 0.14, duck = o.duck ?? 0.06, depth = o.depth ?? 0.16;
  let sx = 1, sy = 1;
  if (next && t > next[0] - duck) { const u = (t - (next[0] - duck)) / duck; sy = 1 - depth * ease(u); sx = 1 + depth * 0.6 * ease(u); }       // dip before the swap
  else if (i > 0 && t < t0 + rise) { const u = (t - t0) / rise, b = back(u, 2.4); sy = lerp(1 - depth, 1, b); sx = lerp(1 + depth * 0.6, 1, b); }   // rise and overshoot
  return { ...pose, pop: [sx * (pose.pop?.[0] ?? 1), sy * (pose.pop?.[1] ?? 1)], beat: i };
}
// Which beat is current (for switching props or labels with the pose).
export function beatIndex(t, times) { let i = 0; while (i < times.length - 1 && t >= times[i + 1]) i++; return i; }

// talk(s, t): mouth openness for a SPEAKING figure, stepped at 12 changes a second from the voice loudness.
// Returns 0, ~0.4, ~0.7 or 1; figure() draws the open mouth when it is above 0.14.
export function talk(s, t, o = {}) {
  const v = s.voiceAt(hold(t, o.step ?? 1 / 12));
  return v < 0.16 ? 0 : v < 0.42 ? 0.4 : v < 0.72 ? 0.7 : 1;
}
// blink(t, seed): true for about a tenth of a second every few seconds, differently for each seed.
export function blink(t, seed = 1) { const period = 2.6 + (seed * 0.917 % 1) * 2.1, ph = (t + seed * 1.37) % period; return ph < 0.1; }

// Camera helpers. A camera is {x, y, zoom, tilt}: the scene point at the centre of the frame, the
// magnification, and a roll in degrees. Keep zoom >= 1 unless the set was painted with spare margin.
export function drift(t, dur, from, to) {                 // slow creep across the whole shot
  const u = dur > 0 ? clamp(t / dur) : 0, g = k => lerp(from[k] ?? (k === 'zoom' ? 1 : k === 'tilt' ? 0 : k === 'x' ? 960 : 480), to[k] ?? from[k] ?? (k === 'zoom' ? 1 : k === 'tilt' ? 0 : k === 'x' ? 960 : 480), u);
  return { x: g('x'), y: g('y'), zoom: g('zoom'), tilt: g('tilt') };
}
// snap(cam, t, at, target): from time `at`, jump quickly to another framing (the snap zoom).
export function snap(cam, t, at, target, dur = 0.13) {
  if (t < at) return cam; const u = easeOut((t - at) / dur);
  return { x: lerp(cam.x, target.x ?? cam.x, u), y: lerp(cam.y, target.y ?? cam.y, u), zoom: lerp(cam.zoom, target.zoom ?? cam.zoom, u), tilt: lerp(cam.tilt ?? 0, target.tilt ?? cam.tilt ?? 0, u) };
}
// shake(cam, t, at): a short decaying jolt for impacts and slams.
export function shake(cam, t, at, amp = 14, dur = 0.3) {
  if (t < at || t > at + dur) return cam; const u = (t - at) / dur, k = (1 - u) * amp;
  return { ...cam, x: cam.x + Math.sin(u * 46) * k, y: cam.y + Math.cos(u * 39) * k * 0.7 };
}
