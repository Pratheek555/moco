// Headless desktop UI for the authorized ink-history subscription test.
// It uses the real ProjectService, persistent app storage, folder import and Codex provider.
// Commands are queued as command.json in the control folder printed on startup.
import { codexProvider } from '../packages/agent/src/codex.ts';
import { WorkspaceStore } from '../packages/agent/src/storage.ts';
import { ProjectService } from '../apps/desktop/src/main/service.ts';
import type { Project } from '../packages/agent/src/types.ts';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const control = path.resolve(process.env.MOCO_INK_CONTROL ?? path.join(homedir(), 'Documents', 'moco-reference-study', 'codex-control'));
mkdirSync(control, { recursive: true });
const log = path.join(control, 'events.jsonl');
const store = new WorkspaceStore(path.join(process.env.APPDATA!, 'Moco'), path.join(homedir(), 'Documents', 'moco'));
const service = new ProjectService(store, codexProvider(), update => {
  appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), ...update }) + '\n');
  if ('record' in update && update.record) {
    const e = update.record.event;
    if (e.type === 'text') process.stdout.write(e.text);
    else if (e.type === 'question' || e.type === 'file' || e.type === 'error' || e.type === 'turn_end' || e.type === 'session') console.log('\nEVENT', JSON.stringify(e));
  }
});
const meta = path.join(control, 'project.json');
let project: Project;
if (existsSync(meta)) project = JSON.parse(readFileSync(meta, 'utf8')) as Project;
else {
  const status = await service.call('status', ['codex']);
  if (!status.ok) throw new Error(status.reason);
  // Folder import matters: importing a lone SKILL.md would omit the kit.
  const skill = await service.call('importSkill', [path.resolve('examples/skills/ink-history')]);
  project = await service.call('create', [process.env.MOCO_INK_PROJECT_NAME ?? 'The Town That Tried to Tax the Rain', skill.id, 'codex']);
  writeFileSync(meta, JSON.stringify(project, null, 2));
}
console.log('PROJECT', JSON.stringify(project));
writeFileSync(path.join(control, 'ready'), project.id);
let busy = false;
const timer = setInterval(async () => {
  const file = path.join(control, 'command.json');
  if (busy || !existsSync(file)) return;
  busy = true;
  try {
    const command = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as { method: string; text?: string; files?: string[]; id?: string; answers?: Record<string,string>; paths?: string[] };
    renameSync(file, path.join(control, 'last-command.json'));
    let result: unknown;
    if (command.method === 'send') result = await service.call('send', [project.id, command.text ?? '', command.files ?? []]);
    else if (command.method === 'answer') result = await service.call('answer', [project.id, command.id ?? '', command.answers ?? {}]);
    else if (command.method === 'attach') result = await service.call('attach', [project.id, command.paths ?? []]);
    else if (command.method === 'files') result = await service.call('files', [project.id]);
    else if (command.method === 'shutdown') {
      clearInterval(timer); await service.call('shutdown', []);
      writeFileSync(path.join(control, 'stopped'), new Date().toISOString());
      process.exit(0);
    } else result = await service.call('project', [project.id]);
    writeFileSync(path.join(control, 'result.json'), JSON.stringify(result ?? null, null, 2));
  } catch (error) {
    console.error(error); writeFileSync(path.join(control, 'result.json'), JSON.stringify({ error: String(error) }));
  } finally { busy = false; }
}, 400);
process.on('SIGINT', () => { clearInterval(timer); void service.call('shutdown', []).finally(() => process.exit(0)); });
