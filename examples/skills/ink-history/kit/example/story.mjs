// story.mjs — "The War of the Bucket", the worked example of the ink-history kit.
//
// Read it once from top to bottom: CAST (who), then SHOTS (where, what happens, on which word).
// It is here to show how a film is put together, not to be edited into yours: a new film gets a new
// story, a new cast and new places. Facts used: Bologna and Modena fought at Zappolino in November 1325;
// about 32,000 Bolognese were routed by about 7,000 Modenese; around 2,000 men died; the Modenese chased
// them to the gates of Bologna and took a bucket from a well as a trophy; Modena still keeps it.
import {
  W, H, figure, design, cel, blob, poly, curve, oval, stroke, label, alpha, clamp, glow, tube,
  beats, talk, blink, pop, move, hold, drift, snap, shake, span, painted, cue, onCue, cueBeats, settle,
  wardrobe as w, sets as st, scenery as sc, props as pr, board as bd,
} from '../index.mjs';

// ------------------------------------------------------------------ cast
// One helper for the uniform, then each person is that helper plus the two or three things that make
// them recognisable in silhouette. Colour carries the sides: Bologna red, Modena gold.
const RED = '#c8202c', CREAM = '#f3ecd8', GOLD = '#f2c230', BLUE = '#2f4aa0', STEEL = '#8f959c', MAIL = '#79808a';
const kettle = (c, h) => w.helmet(c, h, { color: STEEL, strap: '#6a4a30', dy: -0.04 });
const plume = (c, h, col) => cel(c, blob([[0.0, -1.42, 1], [0.34, -1.98], [0.95, -2.02], [1.36, -1.6], [0.92, -1.68], [0.62, -1.4]]), { fill: col, depth: 0.12, rim: h.lw, line: h.lw * 0.9 });
const soldier = (name, tunic, trim, more = {}) => design({
  name,
  top: { color: tunic, hem: 0.8, trim, sleeve: 'short' },
  bottom: { color: '#343343', shoes: '#3a2a26' },
  hat: kettle,
  outfit: B => w.belt(B, 0.55, '#4a3024'),
  ...more,
});
const bolognese = soldier('bolognese', RED, CREAM);
const captain = soldier('captain', RED, CREAM, {
  build: { shoulder: 1.05, belly: 1.5, hip: 1.36 }, brows: 'stern',
  hat: (c, h) => { kettle(c, h); plume(c, h, CREAM); },
  face: (c, h) => w.moustache(c, h, { style: 'imperial', color: '#3b2a26' }),
});
const modenese = soldier('modenese', GOLD, BLUE);
const runt = soldier('runt', GOLD, BLUE, {
  build: { torso: 3.0, leg: 1.05, belly: 1.12, shoulder: 0.8 },
  hairFront: (c, h) => w.sideSweep(c, h, { color: '#8a4a2a', side: -1 }),
});
// two tiny walk-ons for the map
const pope = design({ name: 'pope', top: { color: '#f4f1e8', hem: 1, sleeve: 'long' }, bottom: { color: '#f4f1e8', shoes: '#b8262c' },
  hat: (c, h) => cel(c, blob([[-0.72, -0.62, 1], [-0.62, -1.3], [0, -2.0, 1], [0.62, -1.3], [0.72, -0.62, 1], [0, -0.5]]), { fill: '#f4f1e8', depth: 0.1, rim: h.lw, line: h.lw, inner: cc => stroke(cc, poly([[0, -2], [0, -0.5]], false), h.lw * 0.9, '#d9b648') }),
  outfit: B => w.sash(B, '#d9b648') });
const emperor = design({ name: 'emperor', top: { color: '#6a2c8a', hem: 1, sleeve: 'long', cuff: '#f4f1e8' }, bottom: { color: '#6a2c8a', shoes: '#2a2022' },
  hat: (c, h) => w.crown(c, h), face: (c, h) => w.beard(c, h, { color: '#5a4030' }), outfit: B => w.collar(B, '#f4f1e8', { deep: 0.1 }) });

// ------------------------------------------------------------------ places and map pieces used by more than one shot
function wellYard(c) {                                  // a town wall seen square-on, a gate, a well
  sc.wallSide(c, { ground: 660, gate: { x: 1520, scale: 0.92 }, stone: '#b49a78' });
  sc.well(c, 600, 830, 1.05);
}
function trophyHall(c, o = {}) {                        // Modena's town hall, with a plinth and a rope
  if (o.wooden) sc.plankRoom(c, { back: [280, 60, 1560, 640], wood: '#b48a4e', lamp: { x: 540, y: 110 }, dim: 0.28,
    picture: (cc, x, y, ww, hh) => { cc.fillStyle = '#acb7af'; cc.fillRect(x, y, ww, hh); cel(cc, blob([[x + 50, y + 20], [x + 260, y + 50], [x + 210, y + 185], [x + 80, y + 160]]), { fill: '#c5a46b', flat: true, line: 3 }); } });
  else sc.hall(c, { time: 'day', banner: [GOLD, BLUE], windows: 3, windowX: 300, windowGap: 560, ...o });
  st.box(c, { x: 850, y: 650, w: 220, h: 210 }, [960, 250], 0.1, { fill: '#c2bab0' });
  for (const x of [690, 1230]) { cel(c, tube([[x, 870], [x, 705]], 22, 18), { fill: '#d9b648', depth: 0.25, line: 6 }); cel(c, oval(x, 700, 20, 20), { fill: '#f2d268', depth: 0.2, line: 6 }); }
  stroke(c, curve([[690, 716], [960, 800], [1230, 716]]), 15); stroke(c, curve([[690, 716], [960, 800], [1230, 716]]), 8, '#b8262c');
}
const LAND = bd.coast([[-260, -260], [W + 260, -260], [W + 260, 300], [1600, 360], [1540, 560], [1760, 760], [W + 260, 900], [W + 260, H + 260], [1320, H + 260], [1180, 800], [920, 650], [650, 610], [430, 700], [180, 660], [-260, 760]], { seed: 6, rough: 0.12 });
const MODENA = bd.coast([[560, 300], [830, 250], [985, 330], [955, 525], [820, 600], [590, 545]], { seed: 5, rough: 0.14 });
const BOLOGNA = bd.coast([[975, 325], [1230, 275], [1430, 385], [1390, 565], [1110, 640], [945, 520]], { seed: 8, rough: 0.14 });
const runLegs = (t, rate = 7) => Math.floor(t * rate) % 2 ? { L: { to: [-0.7, -0.45] }, R: { to: [0.75, 0] } } : { L: { to: [0.55, 0] }, R: { to: [-0.5, -0.5] } };
const running = t => {const q=Math.sin(t*Math.PI*3.6),v=Math.cos(t*Math.PI*3.6);return {L:{to:[q*.65,-Math.max(0,v)*.5]},R:{to:[-q*.65,-Math.max(0,-v)*.5]}};};

// A hand follows a short, authored task, then rests. Keys are [cue time, x, y];
// unlike an idle loop this has a beginning, a destination and a reason to stop.
function handPath(t, keys) {
  let i = 0; while (i < keys.length - 2 && t >= keys[i + 1][0]) i++;
  const [a, x, y] = keys[i], [b, xx, yy] = keys[i + 1];
  return [move(t, a, b, x, xx), move(t, a, b, y, yy)];
}

// Carrying a trophy needs real steps. Each shoe stays at its last world-space
// landing during stance; only the lifted shoe travels to the next landing.
// Sampling the known path at landing times keeps cold/range renders identical.
function carrySteps(t, xAt, at, end, R) {
  const period = (end - at) / 3, legs = {};
  for (const [key, side, offset] of [['L', -1, 0], ['R', 1, .5]]) {
    const phase = (t - at) / period + offset, cycle = Math.floor(phase), u = phase - cycle;
    const strike = at + (cycle - offset) * period;
    const landing = when => xAt(when) + side * .62 * R;
    const swing = clamp((u - .5) * 2);
    const x = u < .5 ? landing(strike) : move(t, strike + period / 2, strike + period, landing(strike), landing(strike + period));
    legs[key] = { to: [(x - xAt(t)) / R - side * .62, -Math.sin(swing * Math.PI) * .4] };
  }
  return legs;
}

// The map's colours travel to their patrons once: a schematic allegiance,
// not a marching army or a marker that endlessly circles the same route.
function allegiance(c, t, at, duration, points, color) {
  const u = clamp((t - at) / duration); if (u <= 0) return;
  const segment = Math.min(points.length - 2, Math.floor(u * (points.length - 1)));
  const v = u * (points.length - 1) - segment;
  const a = points[segment], b = points[segment + 1];
  const end = [a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v];
  stroke(c, poly([...points.slice(0, segment + 1), end], false), 10, color);
  cel(c, oval(...end, 23, 23), { fill: color, line: 5 });
  cel(c, oval(...end, 8, 8), { fill: CREAM, line: 0 });
}

export default {
  title: 'The War of the Bucket',
  fps: 60,
  speaker: false, // The narrator is off screen. Only the actual shouted dialogue below opts in.
  voice: { name: 'bm_george', speed: 1.1 },
  music: { mood: 'jaunty' },
  light: [0.7, -0.6],                                    // the light comes from the upper right all through, unless a shot says otherwise
  shots: [
    // 1 ── exterior, full figure. Starts as a close-up of the object, snaps out to the place on the date.
    { id: 'well', say: ['This is a bucket.', 'In thirteen twenty-five,', 'about two thousand men died near it.'], pause: 0.5,
      set: wellYard,
      camera: (t, s) => snap(drift(t, s.cue(1), { x: 610, y: 610, zoom: 2.5, tilt: -3 }, { x: 618, y: 604, zoom: 2.64, tilt: -3 }), t, s.cue(1) - 0.05, drift(t, s.dur, { x: 960, y: 500, zoom: 1.04 }, { x: 980, y: 492, zoom: 1.1 }), 0.16),
      draw: (c, t, s) => {
        pr.bucket(c, 702, 678, 0.9);
        if (t < s.cue(1)) pr.sparkle(c, 772, 566, 22 + 9 * Math.sin(hold(t) * 9));
        figure(c, bolognese, { x: 1190, y: 890, h: 560, id: 'guard', blink: blink(t, 3),
          armR: { to: [1.35, 0.3], hand: 'grip', front: true, hold: cc => pr.spear(cc, 0, 316, 0.9) },
          ...beats(t, [
            [0, { eyes: 'half', mouth: 'flat', head: { turn: -0.3, tilt: 4 } }],
            [s.cue(1)+.45,{eyes:'half',mouth:'flat',look:[-.65,.1],head:{turn:-.55,tilt:6}}],
            [s.cue(1)+1.35,{eyes:'half',mouth:'flat',head:{turn:-.3,tilt:2},lean:-2}],
            [s.cue(2) + 0.25, { eyes: 'wide', look: [-1, 0.3], brows: 'worried', mouth: 'wavy', head: { turn: -0.55, tilt: -7 }, lean: 5, extra: (cc, h) => w.sweat(cc, h) }],
            [s.cue(2)+.95,{eyes:'wide',look:[-1,.3],brows:'worried',mouth:'wavy',head:{turn:-.55,tilt:-7},lean:5,armL:{to:[-1.1,-.1],hand:'open',front:true},extra:(cc,h)=>w.sweat(cc,h)}],
            [s.cue(2)+1.9,{eyes:'wide',look:[-1,.3],brows:'worried',mouth:'wavy',head:{turn:-.55,tilt:-5},lean:3,extra:(cc,h)=>w.sweat(cc,h)}],
          ]), idle: false,
          // Peek at the well, indicate the insignificant object, then recoil on
          // "two thousand". Only the arm travels; the guard's shoes stay planted.
          armL: { to: handPath(t, [
            [s.cue(1), -.8, 2.4], [s.cue(1) + 1.1, .45, -.95],
            [s.cue(2) + .1, -2.5, -.25], [s.cue(2) + 1.15, -.1, -1.1],
            [s.dur - .05, -1.35, .9],
          ]), hand: t < s.cue(2) ? 'point' : 'open', front: true } });
      },
      overlay: (c, t, s) => pr.popIn(c, t, s.cue(1) + 0.15, 420, 120, () => label(c, 'BOLOGNA, 1325', 420, 120, { size: 76, rotate: -3 })),
      sfx: [{ at: 0.15, type: 'ding', gain: 0.7 }, { at: 'cue2', type: 'whoosh' }, { at: 'cue2+0.15', type: 'pop' }, { at: 'cue3+0.25', type: 'sting', gain: 0.8 }] },

    // 2 ── map. The countries are characters: they pop in, get owners, grow faces and shove.
    { id: 'map', kind: 'map', say: ['Northern Italy.', 'Bologna, loyal to the Pope.', 'Modena, loyal to the Emperor.', 'Neighbours, and therefore enemies.'],
      set: c => { bd.sea(c); bd.land(c, LAND); },
      camera: (t, s) => shake(drift(t, s.dur, { x: 960, y: 480, zoom: 1.0 }, { x: 975, y: 452, zoom: 1.12 }), t, s.cue(3) + 0.1, 12, 0.35),
      graphic:false,
      draw:(c,t,s)=>{
        const fight=t>=s.cue(3), kick=settle(t,s.cue(3),.6)*18;
        onCue(c,cue(1),cc=>{cc.translate(-kick,0);bd.region(cc,BOLOGNA,{fill:RED,border:'#6a0f16',enter:false});bd.mapFace(cc,1190,440,1.15,{mood:fight?'angry':'happy',flip:true});},{id:'Bologna joins the Pope',enter:'pop',duration:.6,pivot:[1180,450]});
        onCue(c,cue(2),cc=>{cc.translate(kick,0);bd.region(cc,MODENA,{fill:GOLD,border:'#8a5a12',enter:false});bd.mapFace(cc,770,410,1.15,{mood:fight?'angry':'smug'});},{id:'Modena joins the Emperor',enter:'pop',duration:.6,pivot:[770,430]});
        bd.cast(c,pope,1420,300,250,{id:'Pope lands',at:cue(1,.45),eyes:'happy',mouth:'smile',armR:{to:[1.2,-1.2],hand:'open'}});
        bd.cast(c,emperor,560,290,250,{id:'Emperor lands',at:cue(2,.45),eyes:'glare',mouth:'flat',armL:{to:[-1.2,-1.2],hand:'fist'}});
        allegiance(c,t,s.cue(1),s.cue(2)-s.cue(1),[[1250,335],[1320,270],[1430,275]],RED);
        allegiance(c,t,s.cue(2),s.cue(3)-s.cue(2),[[710,320],[635,245],[550,270]],GOLD);
        label(c,'NORTHERN ITALY',960,150,{size:84,rotate:-2,at:cue(0,.1),until:cue(1),enter:'slide'});
        bd.place(c,'BOLOGNA',1200,650,{size:60,at:cue(1,.8),pin:true,dy:0});
        bd.place(c,'MODENA',760,650,{size:60,at:cue(2,.8),pin:true,dy:0});
        bd.route(c,[[850,350],[1000,310],[1150,345]],{at:cue(3),duration:.45,speed:100,width:8,tokenColor:RED,radius:12});
        onCue(c,cue(3,.35),cc=>pr.burst(cc,968,420,80,{points:9}),{id:'neighbours clash',enter:'drop',height:110,pivot:[968,420],until:s.dur-.3});
        bd.sign(c,'ENEMIES',970,845,{at:cue(3,1),w:580,h:120,size:78,fill:'#e8d2a2',height:220});
      },
      overlay: c => label(c, 'SCHEMATIC', 170, 910, { size: 44 }),
      sfx: [{ at: 0.12, type: 'pop' }, { at: 'cue2', type: 'pop' }, { at: 'cue2+0.5', type: 'ding', gain: 0.5 }, { at: 'cue3', type: 'pop' }, { at: 'cue3+0.5', type: 'ding', gain: 0.5 }, { at: 'cue4+0.1', type: 'thud' }, { at: 'cue4+0.5', type: 'boing', gain: 0.6 }] },

    // 3 ── two-character close-up: one huge cropped head in front, a small one behind, a low sun.
    { id: 'armies', say: ['Bologna had thirty-two thousand soldiers.', 'Modena had seven thousand,', 'and a bad attitude.'], light: [-0.8, -0.5], form: 0.62,
      set: c => sc.street(c, { time: 'dusk', vp: [1220, 610], sun: [1000, 320], water: true, seed: 18 }),
      camera: (t, s) => snap(drift(t, s.dur, { x: 940, y: 480, zoom: 1.0, tilt: -2 }, { x: 965, y: 480, zoom: 1.05, tilt: -2 }), t, s.cue(2), { x: 1330, y: 560, zoom: 1.5, tilt: 3 }),
      draw: (c, t, s) => {
        figure(c, runt, { x: 1500, y: 610, anchor: 'head', R: 205, id: 'runt', blink: blink(t, 2),
          ...beats(t, [
            [0, { eyes: 'bean', eyeGap: 1.4, mouth: 'puff', head: { turn: -0.35, tilt: 5, nod: 0.1 } }],
            [s.cue(1), { eyes: 'dot', brows: 'worried', mouth: 'smile', head: { turn: -0.3, tilt: -5 }, armR: { to: [1.1, -1.5], hand: 'open', front: true } }],
            [s.cue(2), { eyes: 'glare', brows: 'angry', mouth: 'teeth', head: { turn: -0.4, tilt: 8 }, lean: -4, armR: { to: [0.9, -1.7], hand: 'fist', front: true } }],
          ]), idle: false,
          // The little soldier presents his count, then slowly draws the fist
          // back into a challenge as the camera comes in on "bad attitude".
          armR: { to: handPath(t, [[0, .8, 1.7], [s.cue(1), 1.1, -1.5],
            [s.cue(2), .9, -1.7], [s.dur - .1, 1, -.75]]),
            hand: t < s.cue(2) ? 'open' : 'fist', front: true } });
        figure(c, captain, { x: 600, y: 480, anchor: 'head', R: 340, lean: -5, id: 'captain',
          ...beats(t, [
            [0, { eyes: 'shut', brows: 'up', mouth: 'smirk', head: { turn: 0.5, tilt: -9 } }],
            [1.45,{eyes:'shut',brows:'up',mouth:'smirk',head:{turn:.5,tilt:-5},armR:{to:[1.6,-.8],hand:'open',front:true}}],
            [s.cue(1), { eyes: 'half', mouth: 'flat', head: { turn: 0.6, tilt: -2 } }],
            [s.cue(1)+1.05,{eyes:'half',mouth:'flat',head:{turn:.62,tilt:2},lean:-7}],
            [s.cue(2) + 0.3, { eyes: 'wide', look: [1, 0.4], brows: 'up', mouth: 'o', head: { turn: 0.62, tilt: 6 } }],
          ]), idle: false,
          // Keep the wrist above the shoulder and between the heads throughout:
          // a boastful palm rises to the count, then lowers in disappointment.
          // Crossing below the elbow's bend plane would flip its silhouette.
          armR: { at: handPath(t, [[0, 1060, 760], [1.45, 1060, 540],
            [s.cue(1), 1080, 690], [s.cue(2), 1060, 760], [s.dur, 1040, 790]]),
            hand: 'open', front: true } });
        if (t < s.cue(2)) pr.popIn(c, t, 0.85, 1040, 190, () => label(c, '32,000', 1040, 190, { size: 120, fill: '#ff5a4a', rotate: -5 }));
        if (t < s.cue(2)) pr.popIn(c, t, s.cue(1) + 0.4, 1590, 330, () => label(c, '7,000', 1590, 330, { size: 82, fill: GOLD, rotate: 5 }));
      },
      sfx: [{ at: 0.85, type: 'pop' }, { at: 'cue2+0.4', type: 'pop', gain: 0.7 }, { at: 'cue3', type: 'whoosh' }, { at: 'cue3+0.1', type: 'drum' }] },

    // 4 ── blueprint board: HOW it happened, acted by the same cast in white line. Three drawings, cross-faded.
    { id: 'zappolino', kind: 'board', say: ['At Zappolino they met.', 'The big army took one look at the small army,', 'and ran away.'], pause: 0.5,
      set: c => bd.boardSet(c, { title: 'ZAPPOLINO, NOVEMBER 1325' }),
      draw: (c, t, s) => {
        // Each panel is a timed piece of ink, not a whole board held under a camera.
        if (t<s.cue(1)+.24) bd.sketch(c, cc => {
          for(let i=3;i>=0;i--) onCue(cc,.1+(3-i)*.22,c2=>figure(c2,i?bolognese:captain,{x:300+i*150,y:800-(i%2)*16,h:480-i*16,shadow:false,extraFigure:i>0,eyes:i?'dot':'shut',mouth:i?'flat':'smirk',armR:i?undefined:{to:[1.2,-1.7],hand:'fist',front:true}}),{id:`Bologna rank ${i}`,enter:'draw',duration:.42,bounds:[180+i*150,230,420+i*150,850]});
          onCue(cc,1,c2=>figure(c2,modenese,{x:1600,y:800,h:350,flip:true,shadow:false,extraFigure:true,eyes:'dot',mouth:'wavy'}),{id:'small army first man',enter:'draw',duration:.4,bounds:[1450,400,1750,850]});
          onCue(cc,1.3,c2=>figure(c2,runt,{x:1440,y:800,h:330,flip:true,shadow:false,eyes:'glare',brows:'angry',mouth:'frown'}),{id:'small army second man',enter:'draw',duration:.4,bounds:[1290,420,1590,850]});
          label(cc,'VS',1120,560,{size:130,at:1.1});
        }, {id:'armies meet',at:cue(0,.05),until:cue(1),bounds:[130,200,1750,850],duration:.3,tools:false});
        if (t<s.cue(2)+.24) bd.sketch(c, cc => {
          figure(cc, bolognese, { x: 700, y: 500, anchor: 'head', R: 235, shadow: false, eyes: 'wide', look: [1, 0.3], brows: 'worried', mouth: 'wavy', head: { turn: 0.5, tilt: -6 }, extra: (c2, h) => w.sweat(c2, h) });
          stroke(cc, poly([[1150, 806], [1720, 806]], false), 11);
          figure(cc, runt, { x: 1420, y: 800, h: 300, flip: true, shadow: false, eyes: 'glare', brows: 'angry', mouth: 'teeth', armR: { to: [1.2, -1.8], hand: 'fist' } });
          pr.arrow(cc,[1190,610],[880,550],{at:cue(1,.9),w:16,head:34,fill:'#ffffff',travel:false});
        }, {id:'the commander takes a look',at:cue(1),until:cue(2),bounds:[370,150,1730,830],duration:.55});
        if (t>=s.cue(2)) bd.sketch(c, cc => {
          const run = move(t, s.cue(2), s.dur, 0, -230), bob = Math.floor(t * 7) % 2 * 14;
          for (let i = 2; i >= 0; i--) {
            const x = 780 - i * 230 + run;
            pr.speedLines(cc, x + 150, 560 + i * 20, { dir: 0, n: 3, len: 150 });
            figure(cc, i === 1 ? captain : bolognese, { x, y: 800 - (i % 2 ? bob : 14 - bob), h: 400, shadow: false, extraFigure: i !== 1, lean: -16, eyes: i === 1 ? 'squeeze' : 'wide', mouth: 'shout', head: { turn: -0.6, tilt: -8 }, armL: { to: [-1.6, -1.5], hand: 'open' }, armR: { to: [1.3, -1.9], hand: 'open' }, legs: runLegs(t + i * 0.07) });
          }
          figure(cc, runt, { x: 1500 + run * 1.3, y: 800 - bob, h: 320, shadow: false, lean: -14, eyes: 'glare', brows: 'angry', mouth: 'shout', head: { turn: -0.6 }, armL: { to: [-1.5, -1.0], hand: 'grip', front: true, hold: c2 => pr.spear(c2, 0, 0, 0.55, { rot: -72 }) }, legs: runLegs(t) });
          pr.puff(cc, 1640 + run * 1.3, 770, 46, { age: 0.2 });
        }, {id:'the army flees',at:cue(2),bounds:[-30,230,1760,900],duration:.4});
      },
      sfx: [{ at: 0.1, type: 'paper' }, { at: 'cue2', type: 'pop' }, { at: 'cue3', type: 'slide-up' }, { at: 'cue3+0.2', type: 'whoosh', gain: 0.8 }] },

    // 5 ── exterior, full figures in motion. The wall is a painted piece so that the cast can run in front of it.
    { id: 'chase', say: ['The Modenese chased them all the way home,', 'right up to the city gates.'],
      set: c => { sc.ramparts(c, { time: 'dusk', top: 250, ground: 790, towerX: 180, floorColor: '#6a6048' }); sc.gate(c, 1640, 790, 0.9, { open: true }); },
      camera: (t, s) => drift(t, s.dur, { x: 880, y: 540, zoom: 1.14 }, { x: 1060, y: 540, zoom: 1.14 }),
      draw: (c, t, s) => {
        const runAt=.65,age=Math.max(0,t-runAt),go=t>=runAt,run=move(t,runAt,s.dur,0,430),bob=k=>go?(1+Math.cos(age*Math.PI*3.6+k))*4:0;
        [[1120, bolognese, 'wide'], [900, captain, 'squeeze'], [690, bolognese, 'cross']].forEach(([x0, who, eyes], i) => {
          if(go)pr.puff(c,x0+run-150,880,40,{age:(age*1.6+i*.3)%1,seed:i+2});
          figure(c, who, { x: x0 + run, y: 895 - bob(i), h: 470, id: who.name + i,life:go,idle:false,lean:go?15:0, eyes, brows: 'worried', mouth: i === 1 ? 'shout' : 'gasp', head: { turn: 0.6, tilt: 8 }, armL:go?{to:[-1.4,-1.7],hand:'open'}:undefined,armR:go?{to:[1.5,-1.5],hand:'open'}:undefined,legs:go?running(age+i*.06):undefined });
        });
        figure(c, runt, { x: 230 + run * 1.22, y: 895 - bob(1), h: 400, id: 'runt', lean: 13, eyes: 'glare', brows: 'angry', mouth: 'shout', head: { turn: 0.55 },
          armR: { to: [1.5, -0.9], hand: 'grip', front: true, hold: cc => pr.spear(cc, 0, 0, 0.6, { rot: 68 }) }, armL: { to: [-1.0, 0.6], hand: 'fist' },life:go,idle:false,legs:go?running(age):undefined });
        if(go)pr.speedLines(c,110+run*1.22,640,{dir:180,n:4,len:220});
        // The destination lands on the words "city gates", while the chase continues beneath it.
        onCue(c,cue(1),cc=>pr.sign(cc,1530,300,1,{text:'BOLOGNA',w:570,h:135,size:82,post:false,enter:false}),{id:'Bologna city gates',enter:'drop',height:240,duration:.35,pivot:[1530,230]});
      },
      sfx: [{ at: 0, type: 'crowd', dur: 3.2, gain: 0.7 }, { at: 0.2, type: 'slide-down', gain: 0.6 }, { at: 'cue2', type: 'whoosh', gain: 0.7 }] },

    // 6 ── reaction close-up. Nothing on screen but a face and what it has just seen.
    { id: 'souvenir', say: ['And there, beside a well,', 'they found a souvenir.'],
      set: c => sc.burst(c, { x: 960, y: 430, color: '#f2a51e' }),
      camera: (t, s) => snap(drift(t, s.dur, { zoom: 1.0, tilt: 2 }, { zoom: 1.06, tilt: 2 }), t, s.cue(1) + 0.1, { x: 960, y: 450, zoom: 1.3, tilt: -3 }),
      draw: (c, t, s) => {
        const lit = clamp(pop(t, s.cue(1) + 0.1, 0.18));
        if (lit < 1) { c.fillStyle = alpha('#14121f', 0.88 * (1 - lit)); c.fillRect(-300, -300, W + 600, H + 600); }     // the rays stay dark until he sees it
        figure(c, runt, { x: 960, y: 500, anchor: 'head', R: 300, id: 'runt', blink: blink(t, 5),
          ...beats(t, [
            [0, { eyes: 'dot', mouth: 'flat', head: { turn: 0.5, tilt: 3 } }],
            [0.85, { eyes: 'wide', look: [-1, 0.5], mouth: 'o', head: { turn: -0.55, tilt: 8, nod: 0.25 } }],
            [s.cue(1) + 0.1, { eyes: 'star', brows: 'up', mouth: 'beam', head: { turn: -0.1, tilt: -5 }, armL: { to: [-0.9, -0.2], hand: 'open', front: true }, armR: { to: [0.9, -0.2], hand: 'open', front: true } }],
          ]), idle: false,
          // The discovered trophy deserves a real reach: look, reach, present.
          armL: { to: handPath(t, [[.25, -.7, 1.8], [.85, -1.1, -1.3],
            [s.cue(1) + .1, -1.4, -.4], [s.dur - .1, -.9, -.2]]), hand: 'open', front: true } });
        [[400, 250, 46], [1520, 210, 58], [1600, 640, 36], [330, 650, 30]].forEach(([x, y, r], i) => pr.popIn(c, t, s.cue(1) + 0.2 + i * 0.07, x, y, () => pr.sparkle(c, x, y, r)));
      },
      sfx: [{ at: 0.85, type: 'pop', gain: 0.6 }, { at: 'cue2+0.1', type: 'fanfare', gain: 0.8 }, { at: 'cue2+0.3', type: 'ding', gain: 0.6 }] },

    // 7 ── object insert, and the punchline: the music stops, the label lands, hold.
    { id: 'bucket', kind: 'insert', musicStop: true, say: ['One oak bucket.', 'Slightly used.'], hold: 0.5,
      set:c=>{sc.gloom(c,{color:'#3a3040',glowColor:'#f2c230',y:560});cel(c,oval(960,880,980,170),{fill:'#9c958c',depth:.05,rim:8,line:9});st.rays(c,960,-260,{n:5,from:68,to:112,len:1400,alpha:.3});},
      camera:(t,s)=>drift(t,s.dur,{zoom:1,y:480},{zoom:1.06,y:468}),
      draw:(c,t,s)=>{
        // Inspect the real rope handle: lift the pail clear of its base, turn it
        // to show the worn hoops, and lower it. Hand and rope share one transform.
        const lift = move(t,.55,s.cue(1)+.25,0,60) - move(t,s.cue(1)+.55,s.dur-.05,0,60);
        const turn = move(t,.8,s.cue(1)+.45,0,-9) + move(t,s.cue(1)+.45,s.dur-.05,0,9);
        c.save(); c.translate(960,820-lift); c.rotate(turn*Math.PI/180);
        pr.bucket(c,0,0,3,{enter:false,life:false});
        // The wrist comes from above; its pinch is at the top of the rope.
        cel(c,tube([[35,-900],[20,-772],[0,-714]],38,27),{fill:CREAM,depth:.1,line:6});
        cel(c,blob([[-34,-730],[9,-737],[39,-714],[28,-691],[-8,-698],[-30,-709]]),{fill:'#ffffff',depth:.12,line:7});
        stroke(c,curve([[24,-712],[4,-722],[-10,-712]]),5);
        c.restore();
        label(c,'ONE OAK\nBUCKET',470,300,{size:104,rotate:-6,at:cue(0,.15),enter:'slide'});
        onCue(c,cue(0,.25),cc=>{
          pr.paper(cc,1500,560,1,{w:460,h:260,rows:['CONDITION:'],rowSize:42,write:true,lineAt:cue(0,.65),at:cue(0,.25),seal:false,hand:true,out:Infinity});
          pr.stamp(cc,1500,595,1,{text:'SLIGHTLY\nUSED',size:54,w:400,h:130,ink:'#1a0e10',at:cue(1,.1)});
        },{id:'museum condition card',enter:'slide',pivot:[1500,560]});
      },
      sfx: [{ at: 0.25, type: 'pop' }, { at: 'cue2+0.1', type: 'stamp' }] },

    // 8 ── period interior, two full figures, a prop changing hands.
    { id: 'display', say: ['They carried it home', 'and put it on display.'],
      set: trophyHall,
      camera: (t, s) => snap(drift(t, s.dur, { x: 1010, y: 520, zoom: 1.12 }, { x: 990, y: 515, zoom: 1.16 }), t, s.cue(1), { x: 960, y: 560, zoom: 1.34 }, 0.15),
      draw: (c, t, s) => {
        const placed=t>=s.cue(1), stepAt=.65, stepEnd=s.cue(1)-.28;
        const xAt=now=>1340+move(now,stepAt,stepEnd,300,0);
        const walking=t>=stepAt&&t<stepEnd+(stepEnd-stepAt)/6;
        if (placed) { glow(c, 960, 560, 330, '#fff0b0', 0.5); pr.popIn(c, t, s.cue(1), 960, 650, () => pr.bucket(c, 960, 650, 1.15)); }
        figure(c, modenese, { x: 560, y: 895, h: 560, id: 'guard',
          ...beats(t, [
            [0, { eyes: 'dot', mouth: 'o', head: { turn: 0.5, tilt: 4 }, look: [1, 0] }],
            [s.cue(1) + 0.1, { eyes: 'shut', brows: 'up', mouth: 'smile', head: { turn: 0.35, tilt: -4 }, armR: { to: [0.1, -1.9], hand: 'flat', over: true, rot: 150 } }],
          ]) });
        figure(c, runt, { x: xAt(t), y: 895, h: 480, id: 'runt', idle: false,
          ...beats(t, [
            [0, { eyes: 'happy', mouth: 'beam', head: { turn: -0.5, tilt: -4 }, armL: { to: [-0.6, -2.5], hand: 'open', over: true, hold: cc => pr.bucket(cc, 40, -30, 1.0) }, armR: { to: [0.7, -2.5], hand: 'open', over: true } }],
            [s.cue(1), { eyes: 'heart', mouth: 'smile', head: { turn: -0.55, tilt: 6 }, lean: -7, armL: { at: [1130, 640], hand: 'open', front: true }, armR: { at: [1150, 700], hand: 'open', front: true } }],
          ]), legs: walking ? carrySteps(t,xAt,stepAt,stepEnd,480/(3+1.05+.7+1)) : undefined });
        if (placed) [[840, 500, 34], [1085, 470, 44], [990, 420, 26]].forEach(([x, y, r], i) => pr.popIn(c, t, s.cue(1) + 0.15 + i * 0.08, x, y, () => pr.sparkle(c, x, y, r)));
      },
      sfx: [{ at: 'cue2', type: 'thud', gain: 0.7 }, { at: 'cue2+0.15', type: 'ding' }] },

    // 9 ── crowd, at night. A night shot is a normal shot plus a blue-violet grade over everything; lights are drawn after it.
    { id: 'no', say: ['Bologna asked for it back.', 'Modena said no.'], hold: 0.4, light: [-0.6, -0.7], tint: '#6a6a9a',
      set: c => sc.heavens(c, { time: 'night', stars: true, disc: 44, sun: [330, 150], horizon: 900, clouds: 3 }),
      camera: (t, s) => snap(drift(t, s.dur, { x: 960, y: 520, zoom: 1.06 }, { x: 960, y: 510, zoom: 1.1 }), t, s.cue(1) - 0.06, { x: 1200, y: 300, zoom: 1.8, tilt: -4 }, 0.18),
      draw: (c, t, s) => {
        const said = t >= s.cue(1);
        figure(c, runt, { x: 1190, y: 800, h: 540, id: 'runt', speaking:said,
          ...beats(t, [
            [0, { eyes: 'half', mouth: 'flat', head: { turn: -0.4, nod: 0.5 }, armR: { to: [1.2, -0.6], hand: 'grip', front: true, hold: cc => pr.bucket(cc, 0, 110, 0.8) } }],
            [s.cue(1), { eyes: 'shut', brows: 'up', mouth: 'tongue', head: { turn: -0.3, tilt: -8, nod: 0.3 }, armR: { to: [1.2, -1.9], hand: 'grip', front: true, hold: cc => pr.bucket(cc, 0, 110, 0.8) } }],
            [s.cue(1)+.95,{eyes:'shut',brows:'up',mouth:'tongue',head:{turn:-.4,tilt:-10,nod:.3},lean:-3,armR:{to:[1,-2.15],hand:'grip',front:true,hold:cc=>pr.bucket(cc,0,110,.8)}}],
          ]) });
        painted(c, 'modena-wall', cc => sc.ramparts(cc, { sky: false, time: 'night', top: 440, ground: 1010, tower: false, stone: '#9a8f86' }));
        const bob = k => (Math.floor(t * 5 + k * 0.37) % 2) * 14;
        [[230, bolognese, 0.86], [520, bolognese, 0.92], [1650, bolognese, 0.88], [1400, bolognese, 0.8], [840, captain, 1]].forEach(([x, who, k], i) =>
          figure(c, who, { x, y: 1130 - (said ? 0 : bob(i)), h: 560 * k, id: who.name + i, extraFigure: who !== captain, shadow: false, speaking:!said&&who===captain,
            eyes: said ? 'wide' : 'glare', brows: said ? 'up' : 'angry', mouth: said ? 'o' : 'shout', head: { turn: 0.35, nod: -0.55, tilt: (i % 2 ? 6 : -6) },
            armR: said ? undefined : { to: [0.9, -2.2], hand: 'fist', over: true }, armL: said || i % 2 ? undefined : { to: [-0.9, -2.1], hand: 'fist', over: true } }));
        st.grade(c, '#9a98dc');
        for (const x of [110, 700, 1560]) glow(c, x, 900, 300, '#ffb648', 0.55);
        if (!said) pr.popIn(c, t, 0.3, 520, 250, () => pr.bubble(c, 520, 250, { text: 'GIVE IT\nBACK!', w: 430, h: 260, size: 66, tail: [120, 200] }));
        pr.popIn(c, t, s.cue(1) + 0.25, 1560, 170, () => pr.bubble(c, 1560, 170, { text: 'NO.', w: 250, h: 170, size: 78, tail: [-190, 110] }));
      },
      sfx: [{ at: 0, type: 'crowd', dur: 2.2 }, { at: 0.3, type: 'pop' }, { at: 'cue2-0.06', type: 'whoosh' }, { at: 'cue2+0.25', type: 'boing' }] },

    // 10 ── closing two-shot: the same room from closer, a different hour, one last gag.
    { id: 'today', say: ['Seven hundred years later, Modena still has the bucket.', 'Bologna has never quite let it go.'], hold: 0.9,
      set: c => trophyHall(c, { wooden: true }), light: [-0.7, -0.6],
      camera: (t, s) => shake(drift(t, s.dur, { x: 985, y: 560, zoom: 1.5, tilt: -2 }, { x: 975, y: 556, zoom: 1.58, tilt: -2 }), t, s.cue(1) + 1.15, 16, 0.3),
      draw: (c, t, s) => {
        const reach = s.cue(1) + 0.5, slap = s.cue(1) + 1.15;
        pr.bucket(c, 960, 650, 1.15);
        figure(c, runt, { x: 640, y: 560, anchor: 'head', R: 150, id: 'runt', blink: blink(t, 4),
          ...beats(t, [
            [0, { eyes: 'shut', brows: 'up', mouth: 'smirk', head: { turn: 0.4, tilt: -6 } }],
            [1.0,{eyes:'half',brows:'up',mouth:'smirk',head:{turn:.5,tilt:-3},armR:{at:[875,610+Math.sin((t-1)*8)*18],hand:'flat',front:true,hold:cc=>cel(cc,blob([[-42,-28],[45,-32],[40,28],[-38,38]]),{fill:CREAM,depth:.08,line:5})}}],
            [2.65,{eyes:'shut',brows:'up',mouth:'smirk',head:{turn:.4,tilt:-6}}],
            [reach, { eyes: 'half', mouth: 'flat', head: { turn: 0.55, tilt: 2 }, look: [1, 0] }],
            [slap, { eyes: 'glare', brows: 'angry', mouth: 'frown', head: { turn: 0.55, tilt: 8 }, armR: { at: [1100, 610], hand: 'flat', front: true } }],
          ]) });
        figure(c, captain, { x: 1430, y: 520, anchor: 'head', R: 215, id: 'captain',
          ...beats(t, [
            [0, { eyes: 'shiny', brows: 'sad', mouth: 'wavy', head: { turn: -0.6, tilt: 6, nod: 0.15 } }],
            [reach, { eyes: 'wide', look: [-1, 0.6], brows: 'worried', mouth: 'pout', head: { turn: -0.65, tilt: 10, nod: 0.3 }, armL: { at: [1110, 640], hand: 'open', front: true } }],
            [slap, { eyes: 'squeeze', brows: 'sad', mouth: 'shout', head: { turn: -0.4, tilt: -8 }, armL: { to: [-0.7, -1.2], hand: 'open', front: true }, extra: (cc, h) => w.tears(cc, h) }],
          ]) });
        pr.popIn(c, t, slap, 1110, 620, () => { if (t < slap + 0.45) pr.burst(c, 1110, 620, 90); });
      },
      overlay: (c, t, s) => { if (t < s.cue(1)) pr.popIn(c, t, 0.2, 470, 110, () => label(c, '700 YEARS LATER', 470, 110, { size: 72, rotate: -3 })); },
      sfx: [{ at: 0.2, type: 'pop' }, { at: 'cue2+0.5', type: 'slide-up', gain: 0.5 }, { at: 'cue2+1.15', type: 'drum' }, { at: 'cue2+1.2', type: 'thud', gain: 0.8 }] },
  ],
};
