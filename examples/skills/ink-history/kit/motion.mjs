// motion.mjs — limited animation, the way this format moves.
//
// Drawings hold their design while independently seeded layers keep moving smoothly. Sharp authored
// events ride over that quiet life; no per-frame wiggle or line boil is added.
//   - pose swap ("duck and pop"): the figure dips and squashes for ~3 frames, the new drawing rises,
//     overshoots a little and settles. About 0.12-0.16 s in all. Use it on the word that changes the thought.
//   - mouth flaps: three or four mouth drawings chosen from the loudness of the voice, changing only
//     every 1/12 s. Listeners keep their mouths shut.
//   - snap zoom: the camera jumps in 15-35% in about 0.13 s, usually together with a pose swap.
//   - slow drift: between events the camera creeps (2-4% over a shot). It never stops dead.
//   - pops: labels, props and map pieces arrive by scaling up past full size and settling.
//   - hard cuts between shots. No cross-dissolves except inside explanation boards.
// All times are seconds from the start of the shot.
import { S, TAU, clamp, lerp, rad, sc, withStyle } from './ink.mjs';

// All automatic motion is a pure function of a shot-local clock and a stable identity. No frame
// history, random(), wall clock or persistent counters: range workers and still tools agree exactly.
export function seedOf(value) {
  const str = String(value); let n = 2166136261;
  for (let i = 0; i < str.length; i++) n = Math.imul(n ^ str.charCodeAt(i), 16777619);
  return n >>> 0;
}
export function unit(seed, salt = 0) {
  let n = (seedOf(seed) + Math.imul(salt + 1, 374761393)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export const motionTime = o => o?.still || o?.life === false || S.clock?.life === false ? 0 : (o?.t ?? S.clock?.t ?? 0);
export const lifeEnabled = o => !o?.still && o?.life !== false && S.clock?.life !== false && (!!S.clock || o?.t !== undefined);
export function elementMotion(type, identity, o = {}) {
  const clock = S.clock, n = clock ? (clock.counts[type] ?? 0) : 0;
  if (clock) clock.counts[type] = n + 1;
  return { seed: `${clock?.id ?? 'drawing'}:${type}:${o.id ?? `${o.seed ?? identity ?? ''}:${n}`}`, order: n, t: motionTime(o) };
}
const wave = (t, seed, axis, lo, hi) => {
  // Ease between independently chosen rests. Zero velocity during both plateaus, including at
  // segment boundaries; a held cutout is allowed to stop instead of swimming perpetually.
  const period=lerp(lo,hi,unit(seed,axis)), phase=unit(seed,axis+10)*period;
  const n=Math.floor((t+phase)/period), u=(t+phase)/period-n;
  const rest=k=>(k%2===0?1:-1)*(.65+unit(`${seed}:${axis}:${k}`,11)*.35);
  const from=rest(n-1),to=rest(n);
  return lerp(from,to,ease(span(u,.16,.70)));
};
// floatAt(t, seed, {kind, amount, size}): offsets in DELIVERY pixels and degrees; size is a visible
// layer height. Close-up heads use less translation/scale than full bodies. Text is always rigid.
export function floatAt(t, seed = 1, o = {}) {
  const kind = o.kind ?? 'figure', text = kind === 'text' || kind === 'document', bg = kind === 'background';
  const a = o.amount ?? 1, size = o.size ?? 600;
  if (kind === 'planted' || kind === 'wind') return {x:0,y:0,scale:1,rotate:wave(t,seed,3,4.5,7)*(kind==='planted'?.08:.3)*a};
  const big = clamp(650 / Math.max(650, size), 0.45, 1), small = clamp(size / 600, 0.5, 1);
  const lo = bg ? 5 : text ? 3.2 : 2.6, hi = bg ? 8 : text ? 4.5 : 3.8;
  return { x: wave(t, seed, 0, lo, hi) * (text ? 2 : bg ? 6 : 4 * small * big) * a,
    y: wave(t, seed, 1, lo, hi) * (text ? 2.6 : bg ? 6 : 8 * small * big) * a,
    scale: 1 + wave(t, seed, 2, lo, hi) * (text ? 0 : bg ? 0.004 : 0.015 * big) * a,
    rotate: wave(t, seed, 3, lo, hi) * (text ? 0 : bg ? 0 : 0.35 * big) * a };
}
export function applyFloat(c, t, seed, o = {}) {
  const k = Math.max(0.01, sc(c) / S.dpx), q = floatAt(t, seed, o), p = o.pivot ?? [960, 480];
  // Amplitudes are measured on screen, including inside scaled hands, board groups and close cameras.
  c.translate(q.x / k, q.y / k); c.translate(p[0], p[1]); c.rotate(rad(q.rotate));
  c.scale(q.scale, q.scale); c.translate(-p[0], -p[1]);
  if (o.driftX) c.translate(t * o.driftX / k, 0);
  return q;
}
// Small secondary impulse, exactly zero outside its .4s lifetime (no lingering numerical tail).
export function settle(t, at = 0, dur = 0.4) {
  const u = (t - at) / dur; if (u <= 0 || u >= 1) return 0;
  return Math.sin(u * TAU * 1.6) * Math.exp(-4 * u) * (1 - ease(u));
}
// living is the low-level ordered-layer hook. Static artwork (cached:true) is rasterised once by
// the stage, but its transform stays live; procedural loops replay only their inexpensive drawing.
export function living(c, fn, o = {}) {
  if (!lifeEnabled(o)) return o.still || o.life === false ? withStyle({clock:S.clock?{...S.clock,life:false}:null},()=>fn(c)) : fn(c);
  if (S.capture) return S.capture(c, fn, o);
  c.save();
  try {
    if (o.float === true) applyFloat(c, motionTime(o), o.seed ?? 1, o);
    return fn(c);
  } finally { c.restore(); }
}
// alive(drawFn, seed, options) -> a stage-compatible draw function. Wrap custom busts/ships/cards;
// or call alive(c, drawFn, seed, options) to draw an inline group. Explicit t overrides the stage.
export function alive(draw, seed = 1, o = {}, inlineOptions = {}) {
  if (typeof draw !== 'function') {
    const c = draw, fn = seed; return alive(fn, o, inlineOptions)(c, inlineOptions.t ?? S.clock?.t ?? 0, S.clock?.s);
  }
  return (c, t = S.clock?.t ?? 0, s = S.clock?.s) => {
    const m = elementMotion('group', seed, o), opts = { float:true, ...o, seed: m.seed, ...(S.clock ? {} : {t}) };
    if (!lifeEnabled(opts)) return living(c,cc=>draw(cc,t,s),opts);
    return living(c, cc => {
      const now = o.t ?? S.clock?.t ?? t;
      const when=atTime(o.at,0),age=now-when,sliding=o.enter==='rise'||o.enter==='slide';
      if(o.at!==undefined)declareEvent(o.id??'drawn group arrives',when);
      if(now<when)return;
      const u=span(now,when,when+(o.duration??(sliding?.55:.32)));
      const entrance=o.enter===false||sliding?1:pop(now,when,o.duration??.32);
      if (entrance <= 0) return;
      const p = o.pivot ?? [960, 480], kick = settle(age, 0.14);
      if (sliding) cc.translate(o.enter === 'slide' ? -100 * (1 - easeOut(u)) : 0, o.enter === 'rise' ? 80 * (1 - easeOut(u)) : 0);
      cc.translate(p[0], p[1] + kick * 4); cc.scale(entrance, entrance); cc.translate(-p[0], -p[1]);
      const old = S.rigid, tr = S.transient; S.rigid ||= o.rigid !== false; S.transient ||= Math.abs(entrance - 1) > 0.03 || (sliding && u < 1);
      try { return draw(cc, now, S.clock?.s ?? s); } finally { S.rigid = old; S.transient = tr; }
    }, opts);
  };
}
// Automatic reveals use shot time and draw order. Explicit at is absolute shot time; an enclosing
// popIn/sketch can suppress a second entrance via S.transient/S.rigid. No appearance-time state.
export function reveal(t, order = 0, o = {}) {
  if (!lifeEnabled(o) || o.enter === false || S.transient) return 1;
  const at = atTime(o.at, Math.min(order, 5) * (o.stagger ?? 0.7));
  if (t < at) return 0;
  const u = (t - at) / (o.duration ?? 5 / 60);
  return lerp(0.5, 1, back(u, 1.7));
}

// Idle gestures have anticipation, an eased accent and a gentle settle. Arm units are head radii;
// held hands keep their authored grip and move only with the body, so props never slip out of fingers.
export function idleAt(t, seed = 1, s = S.clock?.s) {
  const times=[];
  if(s?.cues?.length) {
    for(const [i,at] of s.cues.entries()) {
      const q=at+.08+unit(seed,i+110)*.3;
      if(!times.length||q-times.at(-1)>1.8) times.push(q);
    }
  } else {
    let at=.8+unit(seed,31)*1.8;
    for(let i=0;at<t+1&&i<200;i++) {times.push(at);at+=2.5+unit(seed,i+120)*4.5;}
  }
  // Long clauses get one considered adjustment, not an evenly repeating twitch.
  for(let i=times.length-1;i>=0;i--) {
    const next=times[i+1]??s?.dur??t+1;
    if(next-times[i]>4.8) times.splice(i+1,0,times[i]+2.6+unit(seed,i+130)*1.3);
  }
  const n=times.findLastIndex(q=>q<=t), at=times[n]??-99, duration=.78+unit(seed,n+140)*.4;
  const u=(t-at)/duration, variant=Math.floor(unit(seed,n+150)*3);
  let accent=0;
  if(u>=0&&u<.12)accent=-.1*ease(u/.12);
  else if(u<.36&&u>=.12)accent=lerp(-.1,1,back((u-.12)/.24,1.1));
  else if(u<.55&&u>=.36)accent=1;
  else if(u<1&&u>=.55)accent=1-ease((u-.55)/.45);
  accent*=.45+unit(seed,n+160)*.55;
  const breath=Math.sin(t*TAU/lerp(3.2,4.2,unit(seed,4))+unit(seed,14)*TAU);
  return {breath,tilt:breath*.18+accent*(variant===1?-1:1)*1.1,shift:wave(t,seed,6,4,8),
    accent,side:unit(seed,n+170)<.5?'L':'R',variant,eventAt:at};
}
export function eyeDart(t, seed = 1) {
  const p = lerp(1.5, 4, unit(seed, 35)), ph = unit(seed, 36) * p, n = Math.floor((t + ph) / p), u = (t + ph) / p - n;
  const a = unit(`${seed}:${n - 1}`, 37) * 2 - 1, b = unit(`${seed}:${n}`, 37) * 2 - 1;
  return lerp(a, b, ease(u / 0.05)) * 0.075;
}
export function defaultCamera(t, s, o = {}) {
  const seed=`${s.id}:camera`, reading=o.text??['map','board','insert','title'].includes(s.kind);
  const mode=unit(seed,0), angle=unit(seed,2)*TAU, speed=reading?lerp(3,9,unit(seed,1)):lerp(10,24,unit(seed,1));
  const start=1+unit(seed,3)*.012, rate=lerp(.003,reading?.009:.012,unit(seed,4));
  const pull=mode<.18, zoom=pull?Math.max(1,start-rate*t):start+rate*t;
  // Board margins are part of the composition: no gratuitous pan over the paper's tools.
  const pan=s.kind==='board'?0:speed*t;
  return {x:960+Math.cos(angle)*pan,y:480+Math.sin(angle)*pan*.25,zoom:s.kind==='board'?1+t*.002:zoom,tilt:0};
}

// Clause timings only: cue(1) is the second clause, consistent with s.cue(1). A string resolves
// a cueNames alias or the first clause containing that text; it is NOT forced word alignment.
export function cue(which=0, offset=0) { return s => (s?.cue(which)??0)+offset; }
export function atTime(value, fallback=0, s=S.clock?.s) {
  if(value===undefined)return fallback;
  if(typeof value==='number')return value;
  if(typeof value==='function')return value(s);
  if(value==='end')return s?.dur??fallback;
  if(typeof value==='string'&&s)return s.cue(value);
  throw new Error('Event time must be seconds, cue(index/text), or a function of the shot clock.');
}
export function declareEvent(name, at, o={}) {
  const when=atTime(at,0), key=`${name}:${when.toFixed(4)}`;
  S.clock?.declared?.set(key,{name,at:when,kind:o.kind??'content'});
  return when;
}
export function eventSchedule(count, o={}) {
  const s=S.clock?.s, start=atTime(o.at,0), end=atTime(o.until,s?.dur??Math.max(2,count*.7));
  if(o.times)return o.times.map(q=>atTime(q));
  const gap=o.stagger??Math.min(.9,Math.max(.45,(end-start-.8)/Math.max(1,count)));
  return Array.from({length:count},(_,i)=>start+i*gap);
}
// onCue(c, cue(1), draw, {enter:'drop'|'pop'|'draw'|'slide',bounds,pivot,until})
// The draw callback uses its ordinary coordinates; text stays rigid with its group.
export function onCue(c, when, draw, o={}) {
  const t=o.t??S.clock?.t??0, at=atTime(when), duration=o.duration??(o.enter==='draw'?.6:.4);
  declareEvent(o.id??o.name??'cue action',at,o);
  const end=o.until===undefined?Infinity:atTime(o.until), out=o.exitDuration??.3;
  if((S.clock||o.t!==undefined)&&(t<at||t>=end+out))return;
  const u=span(t,at,at+duration), v=Number.isFinite(end)?span(t,end,end+out):0, kind=o.enter??'pop';
  const bounds=o.bounds??[0,0,1920,960], p=o.pivot??[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2];
  c.save();
  try {
    const enabled=lifeEnabled(o);
    if(enabled) {
      if(kind==='draw') {const x=lerp(bounds[0],bounds[2],easeOut(u)); c.beginPath();c.rect(bounds[0]-12,bounds[1]-12,Math.max(0,x-bounds[0])+24,bounds[3]-bounds[1]+24);c.clip();}
      else if(kind==='drop')c.translate(0,-(o.height??150)*(1-easeOut(u))+settle(t,at+duration*.6)*8);
      else if(kind==='slide')c.translate(-(o.distance??130)*(1-easeOut(u)),0);
      else {const k=lerp(.5,1,back(u,1.7));c.translate(...p);c.scale(k,k);c.translate(-p[0],-p[1]);}
      if(v)c.translate(-ease(v)*(o.exitDistance??160),0);
    }
    return withStyle({rigid:true,transient:S.transient||(enabled&&(u<1||v>0))},()=>draw(c,t,S.clock?.s));
  } finally {c.restore();}
}
export function cueBeats(s, items, o={}) {
  return (c,t=S.clock?.t??0,clock=s??S.clock?.s)=>{
    const times=items.length<=(clock?.cues?.length??0)?clock.cues:eventSchedule(items.length,{at:clock?.cue(0)??0,until:clock?.dur??Math.max(2,items.length*.7)});
    for(const [i,item] of items.entries()) {
      const spec=Array.isArray(item)?{at:item[0],draw:item[1]}:item;
      onCue(c,atTime(spec.at??times[i],0,clock),cc=>spec.draw(cc,t,clock),{...o,...spec});
    }
  };
}

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
  const [t0, pose] = keys[i], next = keys[i + 1], rise = o.rise ?? 0.28, duck = o.duck ?? 0.09, depth = o.depth ?? 0.12;
  let sx = 1, sy = 1;
  if (next && t > next[0] - duck) { const u = (t - (next[0] - duck)) / duck; sy = 1 - depth * ease(u); sx = 1 + depth * 0.6 * ease(u); }       // dip before the swap
  else if (i > 0 && t < t0 + rise) { const u = (t - t0) / rise, b = back(u, 2.4); sy = lerp(1 - depth, 1, b); sx = lerp(1 + depth * 0.6, 1, b); }   // rise and overshoot
  const tail = i > 0 && S.clock?.life !== false && o.life !== false && !o.still ? settle(t, t0 + rise * 0.65, 0.4) : 0;
  return { ...pose, pop: [(sx + tail * 0.02) * (pose.pop?.[0] ?? 1), (sy - tail * 0.015) * (pose.pop?.[1] ?? 1)],
    head: { ...pose.head, tilt: (pose.head?.tilt ?? 0) + tail * 0.8 }, beat: i };
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
export function blink(t, seed = 1) {
  // Six-second cells contain one blink, offset enough to make gaps 2.8-6s. Unlike accumulated
  // schedules, this works in an arbitrary frame range. Some cells contain a quiet double blink.
  const p = 4.4, phase = unit(seed, 40) * p, v = t + phase, n = Math.floor(v / p), u = v - n * p;
  const at = lerp(0.8, 2.4, unit(`${seed}:${n}`, 41)), dur = lerp(0.12, 0.16, unit(`${seed}:${n}`, 42));
  return (u >= at && u < at + dur) || (unit(`${seed}:${n}`, 43) < 0.15 && u >= at + 0.26 && u < at + 0.26 + dur);
}

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
