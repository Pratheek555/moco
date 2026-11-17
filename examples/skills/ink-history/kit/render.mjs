// render.mjs — the picture side of the kit, as a command line. film.py drives it; you can also call it
// directly while drawing (no voice needed: without a timeline it times shots from their word counts).
//
//   node render.mjs describe <story.mjs>                    what film.py needs to make the voice (JSON on stdout)
//   node render.mjs frame  <story.mjs> <work> <shot> <t>    one full-size frame -> work/frames/<shot>-<t>.png
//   node render.mjs stills <story.mjs> <work> [shot …]      stills + contact sheet + audit.json (the picture gates)
//   node render.mjs clip   <story.mjs> <work> <shot> [fps]  one shot as a silent mp4 -> work/clips/<shot>.mp4
//   node render.mjs strip  <story.mjs> <work> <shot> [from] [to]   12 fps filmstrip of a shot -> work/strips/<shot>.jpg
//   node render.mjs video  <story.mjs> <work> [--jobs n]    the whole film, silent -> work/picture.mp4
//   node render.mjs draft  <story.mjs> <work> [--shot id] [--start sec --end sec] [--width 960 --fps 12 --jobs 6]
//     silent motion-draft.mp4 + motion-draft.json; keeps authored timing, needs no audio/review
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
// 960px preserves thin ink/antialiasing under the 480px motion analyser. Drawing
// directly at 480px undercounted stale time by ~7pp; 960px differed <1pp in
// both old/new example comparisons. 12Hz matches liveness; final QA still rules.
const DRAFT_WIDTH = 960, DRAFT_FPS = 12;

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
function encoder(out, fps, extra = [], width = W, height = H, draft = false) {
  const child = spawn(FFMPEG(), ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0', '-an',
    '-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'medium', ...(draft ? ['-threads', '1'] : []), '-crf', '17', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', ...extra, out], { stdio: ['pipe', 'inherit', 'inherit'] });
  let error = null; child.on('error', e => { error = e; }); child.stdin.on('error', e => { error = e; });
  return { write: async buf => { if (error) throw error; if (!child.stdin.write(buf)) await once(child.stdin, 'drain'); }, close: async () => { child.stdin.end(); const [code] = await once(child, 'exit'); if (code !== 0) throw new Error(`ffmpeg exited with ${code}`); } };
}
function draftSampleTime(story, tl, f, fps) {
  const sourceFps = story.fps ?? 30;
  return Math.min(Math.ceil(tl.duration * sourceFps) - 1, Math.ceil((f + 0.5) * sourceFps / fps - 1e-8) - 1) / sourceFps;
}
async function renderRange(story, tl, out, fps, f0, f1, quiet, width = W, draft = false) {
  const height = Math.round(H * width / W / 2) * 2;
  const cv = createCanvas(width, height), c = cv.getContext('2d'), enc = encoder(out, fps, [], width, height, draft);
  let i = 0; const t0 = Date.now();
  for (let f = f0; f < f1; f++) {
    // Match ffmpeg fps=12:round=near's *selected source frame*, not merely
    // output PTS. At 60fps its first sample is frame 2 (33ms), then 7, 12...
    // This matters for stepped mouths/pose swaps and avoids phase bias in QA.
    // Event QA verifies five-frame/60Hz transient pops at all five phases:
    // never average source frames here, or a one-sample event can disappear.
    const time = draft ? draftSampleTime(story, tl, f, fps) : f / fps;
    while (i < tl.shots.length - 1 && time >= tl.shots[i].end) i++;
    while (i > 0 && time < tl.shots[i].start) i--;
    drawFrame(c, story, tl, i, Math.max(0, time - tl.shots[i].start), width / W);
    await enc.write(cv.data());
    if (!quiet && (f - f0) % 150 === 0) process.stderr.write(`frame ${f - f0}/${f1 - f0}  ${(((Date.now() - t0) / 1000) / Math.max(1, f - f0) * 1000).toFixed(0)} ms/frame\n`);
  }
  await enc.close();
}
async function draft(story, storyFile, work, flags) {
  const tl = timelineFor(story, work), fps = Number(flags.fps ?? DRAFT_FPS), width = Number(flags.width ?? DRAFT_WIDTH);
  const jobs = Number(flags.jobs ?? Math.max(1, Math.min(6, os.cpus().length - 2)));
  if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error('Draft --fps must be between 1 and 60.');
  if (!Number.isInteger(width) || width < 480 || width > W || width % 4) throw new Error(`Draft --width must be a multiple of 4 between 480 and ${W}.`);
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 32) throw new Error('--jobs must be an integer between 1 and 32.');
  let start = flags.start === undefined ? 0 : Number(flags.start), end = flags.end === undefined ? tl.duration : Number(flags.end);
  if (!Number.isFinite(start + end) || start < 0 || end > tl.duration + 1e-6 || end <= start) throw new Error(`Draft range needs 0 <= --start < --end <= ${tl.duration}.`);
  if (flags.shot !== undefined) {
    const i = shotIndex(story, String(flags.shot));
    start = Math.max(start, tl.shots[i].start); end = Math.min(end, tl.shots[i].end);
  }
  const f0 = Math.ceil(start * fps - 1e-8), f1 = Math.ceil(end * fps - 1e-8), frames = f1 - f0;
  if (frames < 1) throw new Error('Selected draft range contains no frames.');
  const out = path.join(work, 'motion-draft.mp4'), meta = path.join(work, 'motion-draft.json');
  // Remove stale metadata first; a failed worker must not look like a new draft.
  fs.rmSync(meta, { force: true });
  const started = Date.now();
  // Dynamic shot-sized jobs avoid rebuilding an expensive set in two adjacent
  // workers. Split only unusually long shots to keep cores busy. This relies
  // solely on timeline bounds, never on drawing or cache implementation details.
  const boundaries = [f0];
  for (const s of tl.shots.slice(1)) {
    let f = Math.max(f0, Math.min(f1, Math.floor(s.start * fps)));
    while (f > f0 && draftSampleTime(story, tl, f - 1, fps) >= s.start) f--;
    while (f < f1 && draftSampleTime(story, tl, f, fps) < s.start) f++;
    if (f > boundaries.at(-1) && f < f1) boundaries.push(f);
  }
  boundaries.push(f1);
  const target = Math.max(12, Math.ceil(frames / jobs)), parts = [];
  for (let i = 1; i < boundaries.length; i++) {
    const a = boundaries[i - 1], b = boundaries[i], n = b - a > target * 1.5 ? Math.ceil((b - a) / target) : 1;
    for (let k = 0; k < n; k++) parts.push([a + Math.round((b - a) * k / n), a + Math.round((b - a) * (k + 1) / n)]);
  }
  const count = Math.min(jobs, parts.length);
  if (count === 1) await renderRange(story, tl, out, fps, f0, f1, true, width, true);
  else {
    const dir = fs.mkdtempSync(path.join(work, 'motion-parts-'));
    try {
      let next = 0;
      const piece = (a, b, k) => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'draft-range', storyFile, work, String(a), String(b), path.join(dir, `part-${k}.mp4`), '--fps', String(fps), '--width', String(width)], { stdio: ['ignore', 'inherit', 'inherit'] });
        child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`draft worker ${k} exited with ${code}`)));
      });
      const results = await Promise.allSettled(Array.from({ length: count }, async () => {
        while (next < parts.length) { const k = next++; await piece(...parts[k], k); }
      }));
      const failed = results.find(r => r.status === 'rejected'); if (failed) throw failed.reason;
      const list = path.join(dir, 'list.txt'); fs.writeFileSync(list, parts.map((_, k) => `file 'part-${k}.mp4'`).join('\n'));
      const r = spawnSync(FFMPEG(), ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], { stdio: 'inherit' });
      if (r.status !== 0) throw new Error('joining draft parts failed');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  const offset = f0 / fps, duration = frames / fps;
  const shots = tl.shots.map((s, i) => ({ ...s, index: i + 1, name: story.shots[i].name ?? s.id,
    kind: story.shots[i].kind, start: Math.max(0, s.start - offset), end: Math.min(duration, s.end - offset) }))
    .filter(s => s.end > s.start);
  // Rounding the final frame can extend the encode by <1/fps; attribute that
  // final display interval to its actual shot, as the authoritative encode does.
  if (shots.length) shots.at(-1).end = duration;
  const report = { picture: out, fps, width, height: Math.round(H * width / W / 2) * 2, frames, duration,
    workers: count, parts: count === 1 ? 1 : parts.length,
    sourceStart: offset, sourceEnd: f1 / fps, requestedStart: start, requestedEnd: end,
    draftTiming: !!tl.draft, elapsedSeconds: (Date.now() - started) / 1000, shots };
  fs.writeFileSync(meta, JSON.stringify(report, null, 2));
  console.log(`DRAFT picture only: ${width}px, ${fps}fps, ${duration.toFixed(3)}s in ${report.elapsedSeconds.toFixed(2)}s -> ${out}${tl.draft ? ' (estimated timing; prepare before final)' : ''}`);
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
  if (mode === 'draft') { await draft(story, storyFile, work, flags); return; }
  const tl = timelineFor(story, work, !!flags.draft);
  if (mode === 'draft-range') { await renderRange(story, tl, more[2], Number(flags.fps), Number(more[0]), Number(more[1]), true, Number(flags.width), true); return; }
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
