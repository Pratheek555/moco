// render.mjs — the picture side of the kit, as a command line. film.py drives it; you can also call it
// directly while drawing (no voice needed: without a timeline it times shots from their word counts).
//
//   node render.mjs describe <story.mjs>                    what film.py needs to make the voice (JSON on stdout)
//   node render.mjs frame  <story.mjs> <work> <shot> <t>    one full-size frame -> work/frames/<shot>-<t>.png
//   node render.mjs stills <story.mjs> <work> [shot …]      stills + contact sheet + audit.json (the picture gates)
//   node render.mjs clip   <story.mjs> <work> <shot> [fps]  one shot as a silent mp4 -> work/clips/<shot>.mp4
//   node render.mjs strip  <story.mjs> <work> <shot> [from] [to]   12 fps filmstrip of a shot -> work/strips/<shot>.jpg
//   node render.mjs video  <story.mjs> <work> [--jobs n]    the whole film, silent -> work/picture.mp4
// <shot> is a shot id or a 1-based number. <t> is seconds from the start of the shot (or `cue1`, `end`, `50%`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCanvas, W, H, initFont, FONT } from './ink.mjs';
import { loadStory, describe, speechSpec, draftTimeline, context, drawFrame, imageStats, frameDiff, audit } from './stage.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const config = () => { try { return JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8').replace(/^\uFEFF/, '')); } catch { return {}; } };
const FFMPEG = () => process.env.FFMPEG || config().ffmpeg || 'ffmpeg';

function timelineFor(story, work, forceDraft = false) {
  const file = path.join(work, 'timeline.json');
  if (!forceDraft && fs.existsSync(file)) {
    const tl = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (JSON.stringify(tl.speech) === JSON.stringify(speechSpec(story)) && tl.shots.length === story.shots.length && tl.shots.every((m, i) => m.id === story.shots[i].id)) return tl;
    console.error('NOTE: timeline.json does not match the current narration, voice or pauses. Using draft timing; run `film.py prepare` again before the final review.');
  }
  return draftTimeline(story);
}
function shotIndex(story, key) {
  const i = story.shots.findIndex(s => s.id === key); if (i >= 0) return i;
  const n = Number(key); if (Number.isInteger(n) && n >= 1 && n <= story.shots.length) return n - 1;
  throw new Error(`No shot "${key}". Shots: ${story.shots.map((s, k) => `${k + 1}:${s.id}`).join(', ')}`);
}
function timeArg(arg, s) {
  if (arg === undefined) return s.dur / 2;
  if (/^cue\d+$/.test(arg)) return s.cue(Number(arg.slice(3)) - 1) + 0.25;
  if (arg === 'end') return Math.max(0, s.dur - 0.05);
  if (arg.endsWith('%')) return s.dur * parseFloat(arg) / 100;
  return parseFloat(arg);
}
const fmt = t => t.toFixed(2).replace('.', '_');

// ------------------------------------------------------------------ stills, contact sheet, audit
const SMALL = 0.25;                                   // analysis frames are drawn at a quarter of full size
function analyseShot(story, tl, i, small, sc) {
  const shot = story.shots[i], s = context(story, tl, i), samples = [], motion = [];
  let prev = null;
  for (let t = 0.05; t < s.dur; t += 0.5) {
    const info = drawFrame(sc, story, tl, i, Math.min(t, s.dur - 0.02), SMALL);
    const data = sc.getImageData(0, 0, small.width, small.height).data;
    if (prev) motion.push(frameDiff(prev, data));
    prev = new Uint8ClampedArray(data);
    samples.push({ t, faces: info.faces, labels: info.labels });
  }
  return { s, samples, motion };
}
const setIds = new Map();
const setId = shot => { const k = shot.setKey ?? shot.set ?? 'none'; if (!setIds.has(k)) setIds.set(k, setIds.size + 1); return setIds.get(k); };

async function stills(story, work, only) {
  const tl = timelineFor(story, work), dir = path.join(work, 'stills');
  fs.mkdirSync(dir, { recursive: true });
  if (!only.length) for (const f of fs.readdirSync(dir)) if (/\.(jpg|png)$/.test(f)) fs.unlinkSync(path.join(dir, f));
  const cv = createCanvas(W, H), c = cv.getContext('2d');
  const small = createCanvas(W * SMALL, H * SMALL), sc = small.getContext('2d');
  const rows = [], wanted = only.map(k => shotIndex(story, k));
  for (let i = 0; i < story.shots.length; i++) {
    const shot = story.shots[i];
    const { s, samples, motion } = analyseShot(story, tl, i, small, sc);
    const times = (shot.stills ?? [Math.min(0.3, s.dur * 0.1), s.dur * 0.5, Math.max(0, s.dur - 0.2)]).map(t => typeof t === 'string' ? timeArg(t, s) : t);
    let stats = null; const files = [], thumbs = [];
    for (const [j, t] of times.entries()) {
      if (wanted.length && !wanted.includes(i) && j !== Math.floor(times.length / 2)) { files.push(null); thumbs.push(null); continue; }
      drawFrame(c, story, tl, i, t, 1);
      if (j === Math.floor(times.length / 2)) stats = imageStats(c, W, H);
      const name = `${String(i + 1).padStart(2, '0')}-${shot.id}-${j + 1}.jpg`;
      if (!wanted.length || wanted.includes(i)) fs.writeFileSync(path.join(dir, name), cv.toBuffer('image/jpeg', 90));
      files.push(name);
      const th = createCanvas(600, 300), tc = th.getContext('2d'); tc.imageSmoothingQuality = 'high'; tc.drawImage(cv, 0, 0, 600, 300); thumbs.push(th);
    }
    rows.push({ index: i + 1, id: shot.id, kind: shot.kind, wide: !!shot.wide, dur: +s.dur.toFixed(2), start: +s.start.toFixed(2), say: shot.say.join(' '), setKey: setId(shot), samples, motion, stats, files, thumbs, times });
    process.stderr.write(`shot ${i + 1}/${story.shots.length} ${shot.id}\n`);
  }
  const result = audit(story, rows);
  const report = {
    draftTiming: !!tl.draft, duration: +tl.duration.toFixed(2), film: result.film,
    shots: rows.map(r => ({ index: r.index, id: r.id, kind: r.kind, start: r.start, dur: r.dur, framing: r.framing, headPx: r.headPx, set: r.setKey, longestStill: r.longestStill, stats: r.stats, issues: r.issues })),
  };
  report.passed = !report.film.length && report.shots.every(q => !q.issues.length);
  fs.writeFileSync(path.join(work, 'audit.json'), JSON.stringify(report, null, 2));
  if (!wanted.length) contactSheet(work, rows, tl);
  for (const q of report.shots) for (const msg of q.issues) console.log(`[${q.index} ${q.id}] ${msg}`);
  for (const msg of report.film) console.log(`[film] ${msg}`);
  console.log(report.passed ? `Picture gates passed. ${rows.length} shots, ${tl.duration.toFixed(1)}s${tl.draft ? ' (draft timing)' : ''}.` : 'Picture gates FAILED: fix the points above (audit.json) and run stills again.');
  console.log(`Contact sheet: ${path.join(work, 'contact-sheet.jpg')}`);
  return report;
}
function contactSheet(work, rows, tl) {
  initFont();
  const tw = 600, th = 300, pad = 10, head = 46, cols = 3, perPage = 8;
  const pages = Math.ceil(rows.length / perPage);
  for (let p = 0; p < pages; p++) {
    const part = rows.slice(p * perPage, (p + 1) * perPage);
    const cv = createCanvas(cols * (tw + pad) + pad, part.length * (th + head + pad) + pad), c = cv.getContext('2d');
    c.fillStyle = '#f4efe6'; c.fillRect(0, 0, cv.width, cv.height);
    part.forEach((r, k) => {
      const y = pad + k * (th + head + pad);
      c.fillStyle = r.issues.length ? '#b3261e' : '#1a0e10'; c.font = `26px ${FONT}, sans-serif`; c.textBaseline = 'middle';
      const note = `${r.index}. ${r.id}   ${r.kind}   ${r.dur.toFixed(1)}s   ${r.framing === 'none' ? '' : r.framing + ' (head ' + r.headPx + 'px)'}${r.issues.length ? '   ' + r.issues.length + ' ISSUE' + (r.issues.length > 1 ? 'S' : '') : ''}`;
      c.fillText(note, pad, y + head / 2, cv.width - 2 * pad);
      r.thumbs.forEach((img, j) => {
        if (!img) return;
        c.drawImage(img, pad + j * (tw + pad), y + head, tw, th);
        c.fillStyle = '#00000099'; c.fillRect(pad + j * (tw + pad), y + head + th - 26, 74, 26); c.fillStyle = '#fff'; c.font = '18px sans-serif'; c.fillText(`${r.times[j].toFixed(1)}s`, pad + j * (tw + pad) + 8, y + head + th - 13);
      });
    });
    const name = pages === 1 ? 'contact-sheet.jpg' : `contact-sheet-${p + 1}.jpg`;
    fs.writeFileSync(path.join(work, name), cv.toBuffer('image/jpeg', 88));
  }
  if (pages > 1) fs.copyFileSync(path.join(work, 'contact-sheet-1.jpg'), path.join(work, 'contact-sheet.jpg'));
}
// ------------------------------------------------------------------ video
function encoder(out, fps, extra = []) {
  const child = spawn(FFMPEG(), ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', 'pipe:0', '-an',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', ...extra, out], { stdio: ['pipe', 'inherit', 'inherit'] });
  let error = null; child.on('error', e => { error = e; }); child.stdin.on('error', e => { error = e; });
  return { write: async buf => { if (error) throw error; if (!child.stdin.write(buf)) await once(child.stdin, 'drain'); }, close: async () => { child.stdin.end(); const [code] = await once(child, 'exit'); if (code !== 0) throw new Error(`ffmpeg exited with ${code}`); } };
}
async function renderRange(story, tl, out, fps, f0, f1, quiet) {
  const cv = createCanvas(W, H), c = cv.getContext('2d'), enc = encoder(out, fps);
  let i = 0; const t0 = Date.now();
  for (let f = f0; f < f1; f++) {
    const time = f / fps; while (i < tl.shots.length - 1 && time >= tl.shots[i].end) i++;
    while (i > 0 && time < tl.shots[i].start) i--;
    drawFrame(c, story, tl, i, Math.max(0, time - tl.shots[i].start), 1);
    await enc.write(cv.data());
    if (!quiet && (f - f0) % 150 === 0) process.stderr.write(`frame ${f - f0}/${f1 - f0}  ${(((Date.now() - t0) / 1000) / Math.max(1, f - f0) * 1000).toFixed(0)} ms/frame\n`);
  }
  await enc.close();
}
async function video(story, storyFile, work, jobs) {
  const tl = timelineFor(story, work), fps = story.fps ?? 30, frames = Math.ceil(tl.duration * fps), out = path.join(work, 'picture.mp4');
  if (tl.draft) console.error('NOTE: rendering with draft timing (no voice timeline).');
  if (jobs <= 1 || frames < 240) { await renderRange(story, tl, out, fps, 0, frames, false); console.log(`Rendered ${frames} frames at ${fps} fps -> ${out}`); return; }
  // split into equal parts, one process each, then join without re-encoding
  const parts = Array.from({ length: jobs }, (_, k) => [Math.round(frames * k / jobs), Math.round(frames * (k + 1) / jobs)]);
  const dir = path.join(work, 'parts'); fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  await Promise.all(parts.map(([a, b], k) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'range', storyFile, work, String(a), String(b), path.join(dir, `part-${k}.mp4`)], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`render worker ${k} exited with ${code}`)));
  })));
  const list = path.join(dir, 'list.txt'); fs.writeFileSync(list, parts.map((_, k) => `file 'part-${k}.mp4'`).join('\n'));
  const r = spawnSync(FFMPEG(), ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('joining the rendered parts failed');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`Rendered ${frames} frames at ${fps} fps in ${((Date.now() - t0) / 1000).toFixed(0)}s with ${jobs} workers -> ${out}`);
}

// ------------------------------------------------------------------ main
async function main() {
  const args = process.argv.slice(2), flags = {}, rest = [];
  for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) { flags[args[i].slice(2)] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true; } else rest.push(args[i]); }
  const [mode, storyArg, workArg, ...more] = rest;
  if (!mode || !storyArg) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 11).join('\n')); return; }
  const storyFile = path.resolve(storyArg), story = await loadStory(storyFile);
  if (mode === 'describe') { process.stdout.write(JSON.stringify(describe(story))); return; }
  const work = path.resolve(workArg ?? path.join(path.dirname(storyFile), 'work')); fs.mkdirSync(work, { recursive: true });
  if (mode === 'stills') { await stills(story, work, more); return; }
  if (mode === 'video') { await video(story, storyFile, work, Number(flags.jobs ?? Math.max(1, Math.min(6, os.cpus().length - 2)))); return; }
  const tl = timelineFor(story, work, !!flags.draft);
  if (mode === 'range') { await renderRange(story, tl, more[2], story.fps ?? 30, Number(more[0]), Number(more[1]), true); return; }
  const i = shotIndex(story, more[0]), s = context(story, tl, i);
  if (mode === 'frame') {
    const cv = createCanvas(W, H), c = cv.getContext('2d'), dir = path.join(work, 'frames'); fs.mkdirSync(dir, { recursive: true });
    for (const a of (more.length > 1 ? more.slice(1) : [undefined])) { const t = timeArg(a, s); drawFrame(c, story, tl, i, t, 1); const file = path.join(dir, `${story.shots[i].id}-${fmt(t)}.png`); fs.writeFileSync(file, cv.toBuffer('image/png')); console.log(file); }
    return;
  }
  if (mode === 'clip') {
    const fps = Number(more[1] ?? story.fps ?? 30), dir = path.join(work, 'clips'); fs.mkdirSync(dir, { recursive: true });
    const m = tl.shots[i], file = path.join(dir, `${story.shots[i].id}.mp4`);
    const cv = createCanvas(W, H), c = cv.getContext('2d'), enc = encoder(file, fps);
    for (let f = 0; f < Math.ceil((m.end - m.start) * fps); f++) { drawFrame(c, story, tl, i, f / fps, 1); await enc.write(cv.data()); }
    await enc.close(); console.log(file); return;
  }
  if (mode === 'strip') {
    const from = more[1] !== undefined ? timeArg(more[1], s) : 0, to = more[2] !== undefined ? timeArg(more[2], s) : s.dur, step = 1 / 12, n = Math.min(48, Math.max(1, Math.round((to - from) / step)));
    const tw = 384, th = 192, cols = 6, cv = createCanvas(cols * tw, Math.ceil(n / cols) * th), c = cv.getContext('2d'), small = createCanvas(tw, th), sc = small.getContext('2d');
    for (let k = 0; k < n; k++) { drawFrame(sc, story, tl, i, from + k * step, tw / W); c.drawImage(small, (k % cols) * tw, Math.floor(k / cols) * th); }
    const dir = path.join(work, 'strips'); fs.mkdirSync(dir, { recursive: true }); const file = path.join(dir, `${story.shots[i].id}.jpg`);
    fs.writeFileSync(file, cv.toBuffer('image/jpeg', 88)); console.log(file); return;
  }
  throw new Error(`Unknown mode "${mode}".`);
}
await main();
