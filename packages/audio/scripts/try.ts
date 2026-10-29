// Smoke test: node packages/audio/scripts/try.ts <outDir>
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderMusic, renderSfx, synthesize } from '../src/index.ts';

const out = path.resolve(process.argv[2] ?? 'audio-test');
await mkdir(out, { recursive: true });
const r = await synthesize('system', { text: 'Krishna smiled and said: do your duty, Arjuna.' });
await writeFile(path.join(out, `vo${r.ext}`), r.audio);
console.log('voice', r.provider, r.duration.toFixed(2) + 's', r.words.length, 'words');
const fb = await synthesize('openai', { text: 'Fallback test.' });
console.log('openai without key →', fb.provider, '|', fb.fallbackReason);
for (const mood of ['devotional', 'epic', 'mystic', 'calm', 'suspense', 'playful'] as const) {
  const t = Date.now();
  await writeFile(path.join(out, `music-${mood}.wav`), renderMusic(mood, 12, 1));
  console.log('music', mood, Date.now() - t, 'ms');
}
for (const id of ['whoosh', 'bell', 'conch', 'drum-hit', 'thunder', 'sparkle', 'arrow', 'gong', 'riser', 'heartbeat'] as const) {
  await writeFile(path.join(out, `sfx-${id}.wav`), renderSfx(id));
}
console.log('sfx ok');
