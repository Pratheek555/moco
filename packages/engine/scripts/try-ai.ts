// Live check of the AI path: node packages/engine/scripts/try-ai.ts <claude-cli|codex-cli> <projectsDir>
import { createProvider } from '@moco/ai';
import { episodeSeconds } from '@moco/spec';
import { createEngine, createStore } from '../src/index.ts';

const provider = (process.argv[2] ?? 'claude-cli') as 'claude-cli' | 'codex-cli';
const store = createStore(process.argv[3] ?? 'projects-test');
const engine = createEngine({ store, ai: () => createProvider({ provider }) });
const log = (p: { stage?: string; log?: string; level?: string }) => {
  if (p.stage) console.log('·', p.stage);
  if (p.log) console.log(`  [${p.level ?? 'info'}] ${p.log}`);
};
let t = Date.now();
const series = await engine.planSeries({ idea: 'Why Ganesha has an elephant head — a short devotional retelling', episodes: 1, seconds: 25, language: 'en', style: 'warm devotional storybook' }, log);
console.log(`PLAN ${((Date.now() - t) / 1000).toFixed(1)}s →`, series.title, '|', series.cast.map((c) => `${c.name}=${c.character}`).join(', '));
t = Date.now();
const ep = await engine.writeEpisode(series.id, 1, log);
console.log(`EPISODE ${((Date.now() - t) / 1000).toFixed(1)}s →`, ep.title, `| ${ep.shots.length} shots, ${episodeSeconds(ep).toFixed(1)}s`);
for (const s of ep.shots) console.log(`  - ${s.id} [${s.background.id}/${s.background.time}, ${s.camera.move}] ${s.actors.map((a) => `${a.character}:${a.pose}`).join(' ')} fx:${s.fx.map((f) => f.type).join(',')} — ${s.narration}`);
console.log('SERIES_ID', series.id);
