// Opt-in subscription check: pnpm agent:check --live. No rendering or research.
import { claudeProvider, codexProvider } from "@moco/agent";
import { WorkspaceStore } from "@moco/agent/storage";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const provider = process.argv.includes("--codex") ? codexProvider() : claudeProvider();
const status = await provider.status();
console.log(JSON.stringify(status));
if (!status.ok) process.exitCode = 1;
else if (process.argv.includes("--live")) {
  const temp = await mkdtemp(path.join(tmpdir(), "moco-live-"));
  const store = new WorkspaceStore(path.join(temp, "data"), path.join(temp, "projects"));
  const example = fileURLToPath(new URL("../examples/skills/cartoon-audio-short/SKILL.md", import.meta.url));
  const skill = await store.importSkill(example);
  const project = await store.createProject("Short intake check", skill.id, provider.id);
  let discovered = false, reply = false;
  let finish!: () => void;
  const received = new Promise<void>(resolve => { finish = resolve; });
  const timer = setTimeout(finish, 90_000);
  let session;
  try {
    session = await provider.start({ cwd: project.workspace, skill: skill.name, onEvent(event) {
      if (event.type === "session") { discovered = event.skills.includes(skill.name); console.log("Session:", event.sessionId, "skills:", event.skills.join(", ")); }
      if (event.type === "tool_call") { console.log("Tool:", event.name); if (event.name === "Skill" && JSON.stringify(event.input).includes(skill.name)) discovered = true; }
      if (event.type === "text") { reply = true; process.stdout.write(event.text); }
      if (event.type === "question") { reply = true; console.log("\nQuestion:", JSON.stringify(event.questions)); finish(); }
      if (event.type === "turn_end") finish();
      if (event.type === "error") { console.error(event.message); finish(); }
    } });
    session.send("Start the chosen skill. Only do its intake: ask the first question and wait. Do not research, generate files, or render anything.");
    await received;
    if (!discovered || !reply) throw new Error(`Live check incomplete: skill discovered=${discovered}, reply/question=${reply}`);
    console.log("\nPASS: native skill discovered and first reply/question received.");
  } finally { clearTimeout(timer); await session?.stop(); await rm(temp, { recursive: true, force: true }); }
}
