import { mockProvider } from '@moco/ai';
import { DEMO_EPISODE, EpisodeSchema, episodeSeconds } from '@moco/spec';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { createEngine, createStore, sanitizeShot, checkShot } from '../src/index.ts';

const dirs: string[] = [];
after(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

async function setup(replies: string[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'moco-test-'));
  dirs.push(root);
  const store = createStore(root);
  const prompts: string[] = [];
  const ai = mockProvider((req) => {
    prompts.push(req.prompt);
    const next = replies.shift();
    if (next === undefined) throw new Error('mock ran out of replies');
    return next;
  });
  return { store, engine: createEngine({ store, ai: () => ai }), prompts };
}

const PLAN = JSON.stringify({
  title: 'Hanuman’s Leap',
  logline: 'The monkey god crosses the ocean to find Sita.',
  setting: 'Kishkindha cliffs, the ocean, Lanka',
  tone: 'heroic',
  music: 'epic',
  captions: 'bold',
  cast: [
    { character: 'hanuman', name: 'Hanuman', role: 'hero' },
    { character: 'rama', name: 'Rama', role: 'prince' },
    { character: 'ravana', name: 'Ravana', role: 'not in kit — must be dropped' },
  ],
  episodes: [
    { number: 1, title: 'The Doubt', hook: 'Who can cross a hundred yojanas?', summary: 'The vanaras despair at the ocean.', beats: ['ocean', 'despair', 'Jambavan reminds Hanuman'] },
    { number: 2, title: 'The Leap', hook: 'He grew as tall as a mountain.', summary: 'Hanuman leaps.', beats: ['grow', 'leap'] },
  ],
  notes: 'Hanuman carries Rama’s ring.',
});

test('plans a series and filters cast to the kit', async () => {
  const { engine, store } = await setup([`Here is the plan:\n\`\`\`json\n${PLAN}\n\`\`\``]);
  const series = await engine.planSeries({ idea: 'Hanuman leaps to Lanka', episodes: 2, seconds: 30, language: 'en', style: 'epic' });
  assert.equal(series.episodes.length, 2);
  assert.deepEqual(series.cast.map((c) => c.character), ['hanuman', 'rama']);
  assert.equal(series.music, 'epic');
  const list = await store.listSeries();
  assert.equal(list[0]?.title, 'Hanuman’s Leap');
});

test('writes an episode, sanitising synonyms and auto-fixing invalid shots', async () => {
  const brokenEpisode = JSON.stringify({
    title: 'The Doubt',
    hook: 'Who can cross the ocean?',
    summary: 'The vanaras despair; Hanuman remembers his power.',
    music: 'Epic',
    shots: [
      {
        id: 'Ocean Wide',
        duration: 4,
        narration: 'The ocean stretched to the edge of the world.',
        background: { id: 'Ganga', time: 'evening' },
        camera: { move: 'zoom-in' },
        actors: [{ id: 'hanuman', character: 'Lord Hanuman', pose: 'praying', expression: 'calm' }],
        fx: [{ type: 'god-rays' }],
        transition: 'crossfade',
      },
      {
        id: 'monster',
        duration: 3,
        narration: 'Then a shadow rose.',
        background: { id: 'river', time: 'night' },
        actors: [{ id: 'm', character: 'dragon-demon', pose: 'fight' }],
        fx: [{ type: 'aura', target: 'nobody' }],
      },
    ],
  });
  const fixedShot = JSON.stringify({
    shots: [
      {
        id: 'monster',
        duration: 3,
        narration: 'Then a shadow rose.',
        background: { id: 'river', time: 'night' },
        actors: [{ id: 'hanuman', character: 'hanuman', pose: 'fight', expression: 'determined' }],
        fx: [{ type: 'aura', target: 'hanuman' }],
      },
    ],
  });
  const { engine, prompts } = await setup([PLAN, brokenEpisode, fixedShot]);
  const series = await engine.planSeries({ idea: 'x', episodes: 2, seconds: 30, language: 'en', style: 'epic' });
  const progress: string[] = [];
  const ep = await engine.writeEpisode(series.id, 1, (p) => p.stage && progress.push(p.stage));
  assert.equal(ep.shots.length, 2);
  const [a, b] = ep.shots;
  assert.equal(a!.id, 'ocean-wide');
  assert.equal(a!.background.id, 'river');
  assert.equal(a!.background.time, 'dusk');
  assert.equal(a!.camera.move, 'push-in');
  assert.equal(a!.actors[0]!.character, 'hanuman');
  assert.equal(a!.actors[0]!.pose, 'namaste');
  assert.equal(a!.fx[0]!.type, 'light-rays');
  assert.equal(a!.transition, 'fade');
  assert.equal(b!.actors[0]!.character, 'hanuman');
  assert.ok(progress.some((s) => s.startsWith('Fixing 1 shot')), 'ran the auto-fix loop');
  assert.match(prompts[2]!, /unknown character "dragon-demon"/);
  assert.equal(ep.music.mood, 'epic');
  const reread = await engine.store.getSeries(series.id);
  assert.equal(reread.episodes[0]!.status, 'scripted');
  assert.equal(reread.memory.storySoFar[0], 'The vanaras despair; Hanuman remembers his power.');
});

test('memory: episode 2 prompt carries the story so far', async () => {
  const ep1 = JSON.stringify({ title: 'One', summary: 'Hanuman learns of his forgotten strength.', shots: [{ id: 'a', duration: 3, narration: 'Hi', background: { id: 'studio' } }] });
  const ep2 = JSON.stringify({ title: 'Two', summary: 'He leaps.', shots: [{ id: 'b', duration: 3, narration: 'Go', background: { id: 'studio' } }] });
  const { engine, prompts } = await setup([PLAN, ep1, ep2]);
  const series = await engine.planSeries({ idea: 'x', episodes: 2, seconds: 30, language: 'en', style: 'epic' });
  await engine.writeEpisode(series.id, 1);
  await engine.writeEpisode(series.id, 2);
  assert.match(prompts[2]!, /Episode 1: Hanuman learns of his forgotten strength\./);
  assert.match(prompts[2]!, /Hanuman carries Rama’s ring\./);
});

test('strips what the AI still gets wrong instead of failing the episode', async () => {
  const bad = JSON.stringify({ title: 'X', summary: 's', shots: [{ id: 'a', duration: 3, narration: 'n', background: { id: 'studio' }, actors: [{ id: 'x', character: 'godzilla' }, { id: 'k', character: 'krishna' }] }] });
  const stillBad = JSON.stringify({ shots: [{ id: 'a', duration: 3, narration: 'n', background: { id: 'studio' }, actors: [{ id: 'x', character: 'godzilla' }, { id: 'k', character: 'krishna' }] }] });
  const { engine } = await setup([PLAN, bad, stillBad, stillBad]);
  const series = await engine.planSeries({ idea: 'x', episodes: 2, seconds: 30, language: 'en', style: 'epic' });
  const ep = await engine.writeEpisode(series.id, 1);
  assert.deepEqual(ep.shots[0]!.actors.map((a) => a.character), ['krishna']);
});

test('the demo episode is valid and voices + scores with the system voice', { skip: process.platform !== 'win32' && 'needs Windows SAPI' }, async () => {
  const { engine, store } = await setup([]);
  const series = await engine.createDemo();
  const ep = await store.getEpisode(series.id, 1);
  assert.ok(ep && EpisodeSchema.safeParse(ep).success);
  const { episode } = await engine.voiceEpisode(series.id, 1, { provider: 'system' });
  assert.ok(episode.shots.every((s) => s.voice && s.voice.duration > 0.5 && s.voice.words.length > 0));
  assert.ok(episode.music.src?.endsWith('.wav'));
  assert.ok(episodeSeconds(episode) >= episodeSeconds(EpisodeSchema.parse(DEMO_EPISODE)) - 0.01);
  const sfx = await engine.ensureSfx();
  assert.equal(Object.keys(sfx).length, 10);
});

test('sanitizeShot + checkShot accept the golden example unchanged', () => {
  const shot = structuredClone(DEMO_EPISODE.shots[2]!);
  const clean = sanitizeShot(shot, 0, new Set());
  const res = checkShot(clean, 'shot');
  assert.deepEqual(res.issues, []);
});
