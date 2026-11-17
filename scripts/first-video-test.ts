// Disposable headless UI: uses exactly the desktop ProjectService and storage.
import { claudeProvider } from '../packages/agent/src/claude.ts';
import { WorkspaceStore } from '../packages/agent/src/storage.ts';
import { ProjectService } from '../apps/desktop/src/main/service.ts';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
const control = path.resolve('scripts/first-video-control');
mkdirSync(control, { recursive: true });
const log = path.join(control, 'events.jsonl');
const store = new WorkspaceStore(path.join(process.env.APPDATA!, 'Moco'), path.join(homedir(), 'Documents', 'moco'));
const service = new ProjectService(store, claudeProvider(), update => {
  appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), ...update }) + '\n');
  if ('record' in update && update.record) {
    const e = update.record.event;
    if (e.type === 'text') process.stdout.write(e.text);
    else if (e.type !== 'thinking') console.log('\nEVENT', JSON.stringify(e).slice(0, 1600));
  }
});
const meta = path.join(control, 'project.json');
let project;
if (existsSync(meta)) project = JSON.parse(readFileSync(meta, 'utf8'));
else {
  const skill = await service.call('importSkill', [path.resolve('examples/skills/cartoon-audio-short/SKILL.md')]);
  project = await service.call('create', ['First test short', skill.id, 'claude-code']);
  writeFileSync(meta, JSON.stringify(project, null, 2));
}
console.log('PROJECT', JSON.stringify(project));
writeFileSync(path.join(control, 'ready'), project.id);
let busy = false;
setInterval(async () => {
  const file = path.join(control, 'command.json');
  if (busy || !existsSync(file)) return;
  busy = true;
  const command = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  renameSync(file, path.join(control, 'last-command.json'));
  try {
    let result;
    if (command.method === 'send') result = await service.call('send', [project.id, command.text, command.files ?? []]);
    else if (command.method === 'answer') result = await service.call('answer', [project.id, command.id, command.answers]);
    else if (command.method === 'attach') result = await service.call('attach', [project.id, command.paths]);
    else if (command.method === 'files') result = await service.call('files', [project.id]);
    else if (command.method === 'shutdown') { await service.call('shutdown', []); process.exit(0); }
    else result = await service.call('project', [project.id]);
    writeFileSync(path.join(control, 'result.json'), JSON.stringify(result ?? null, null, 2));
  } catch (error) { console.error(error); writeFileSync(path.join(control, 'result.json'), JSON.stringify({ error: String(error) })); }
  busy = false;
}, 500);
