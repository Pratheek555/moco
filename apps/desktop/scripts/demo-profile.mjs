// Builds a throwaway Moco profile with realistic projects, a long conversation and media.
// Used by screenshots.mjs for visual QA. Never touches the real profile or Documents/moco.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { WorkspaceStore } from "../../../packages/agent/src/storage.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc(buffer) { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
/** A soft two-colour picture with a horizon, so covers and previews look like frames rather than test cards. */
export function picture(width, height, [r1, g1, b1], [r2, g2, b2]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const t = y / height, sun = Math.max(0, 1 - Math.hypot(x - width * 0.68, y - height * 0.42) / (height * 0.22));
      const ground = y > height * 0.72 ? 0.55 : 1;
      const mix = (a, b) => Math.min(255, Math.round((a + (b - a) * t) * ground + sun * 90));
      raw[row + 1 + x * 3] = mix(r1, r2); raw[row + 2 + x * 3] = mix(g1, g2); raw[row + 3 + x * 3] = mix(b1, b2);
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function video(file, size, seconds) {
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `gradients=s=${size}:d=${seconds}:speed=0.02:c0=0x1b2a4a:c1=0xc98b4a`, "-f", "lavfi", "-i", `sine=frequency=220:duration=${seconds}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file], { stdio: "inherit" });
    return true;
  } catch { return false; }
}
function audio(file, seconds) {
  try { execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds}`, file], { stdio: "inherit" }); return true; }
  catch { return false; }
}

const question = {
  type: "question", id: "q-voice", questions: [
    { question: "Which narration voice should I use?", header: "Voice", multiSelect: false, options: [
      { label: "Warm storyteller", description: "Measured and low, like a documentary narrator" },
      { label: "Urgent reporter", description: "Faster, with more tension in the delivery" },
      { label: "I'll upload my own voiceover", description: "Attach an audio file and I will time the scenes to it" },
    ] },
    { question: "What should the ending do?", header: "Ending", multiSelect: true, options: [
      { label: "Ask a question", description: "Invite comments" },
      { label: "Tease the next video" },
      { label: "End on the final image", description: "No call to action" },
    ] },
  ],
};

/** The long conversation. `at` offsets are seconds from the start. */
function conversation(workspace) {
  const reply = "m1", plan = "m2", done = "m3", second = "m4";
  return [
    [0, { type: "user", text: "Make a 60 second vertical Short about the fall of Constantinople in 1453. Open on the great chain across the Golden Horn.", files: [] }],
    [1, { type: "session", sessionId: "demo-session", skills: ["ink-history"] }],
    [2, { type: "thinking", messageId: "t1", text: "The user wants a vertical Short. I should read the skill first, then propose a beat sheet before drawing anything." }],
    [3, { type: "tool_call", id: "a1", name: "Skill", input: { skill: "ink-history" } }],
    [4, { type: "tool_result", id: "a1", content: "Launching skill: ink-history", isError: false }],
    [5, { type: "tool_call", id: "a2", name: "Read", input: { file_path: path.join(workspace, ".agents/skills/ink-history/SKILL.md") } }],
    [6, { type: "tool_result", id: "a2", content: "---\nname: ink-history\n---\n# Ink history\n…", isError: false }],
    [7, { type: "tool_call", id: "a3", name: "Read", input: { file_path: path.join(workspace, ".agents/skills/ink-history/references/kit-contract.md") } }],
    [8, { type: "tool_result", id: "a3", content: "# Kit contract\n…", isError: false }],
    [9, { type: "tool_call", id: "a4", name: "WebSearch", input: { query: "Golden Horn chain 1453 Mehmed II ships overland" } }],
    [14, { type: "tool_result", id: "a4", content: "Results for Golden Horn chain 1453 …", isError: false }],
    [15, { type: "text", messageId: reply, text: "Here is the plan for **The Chain and the Ships**, a 60 second Short.\n\n## Beat sheet\n\n1. **The chain** (0–8s). A great iron chain closes the Golden Horn. No ship can pass.\n2. **The problem** (8–20s). Mehmed II, 21 years old, has the largest cannon in the world and no way into the harbour.\n3. **The trick** (20–42s). He drags 70 ships *overland*, on greased logs, in a single night.\n4. **The fall** (42–60s). 29 May 1453. The walls that stood for a thousand years are breached.\n\n| Scene | Length | Shot |\n|---|---|---|\n| Chain | 8s | Low angle across the water |\n| Cannon | 12s | Slow push in |\n| Ships on land | 22s | Wide, torchlight |\n| Breach | 18s | Dust, then silence |\n\n> Sources: Kritovoulos, *History of Mehmed the Conqueror*; Runciman, *The Fall of Constantinople 1453*.\n\nI'll draw the storyboard first so you can check the look before I render." }],
    [16, { type: "tasks", tasks: [
      { id: "1", subject: "Write the script and beat sheet", status: "completed" },
      { id: "2", subject: "Draw the storyboard", status: "in_progress" },
      { id: "3", subject: "Record narration", status: "pending" },
      { id: "4", subject: "Render the first cut", status: "pending" },
      { id: "5", subject: "Review timing against the voiceover", status: "pending" },
    ] }],
    [17, { type: "tool_call", id: "b1", name: "Write", input: { file_path: path.join(workspace, "story.mjs"), content: "export const scenes = [/* … */];" } }],
    [19, { type: "tool_result", id: "b1", content: "File created successfully", isError: false }],
    [20, { type: "tool_call", id: "b2", name: "Bash", input: { command: "node .claude/skills/ink-history/kit/render.mjs story.mjs --board", description: "Render the storyboard" } }],
    [95, { type: "tool_result", id: "b2", content: Array.from({ length: 40 }, (_, i) => `scene ${String(i % 4 + 1).padStart(2, "0")} frame ${i * 12} ok`).join("\n"), isError: false }],
    [96, { type: "tool_call", id: "b3", name: "Bash", input: { command: "python kit/film.py --check" } }],
    [99, { type: "tool_result", id: "b3", content: "Traceback (most recent call last):\n  File \"kit/film.py\", line 12\nModuleNotFoundError: No module named 'numpy'", isError: true }],
    [100, { type: "tool_call", id: "b4", name: "Bash", input: { command: "python -m pip install -r kit/requirements.txt" } }],
    [140, { type: "tool_result", id: "b4", content: "Successfully installed numpy-2.3.1 pillow-11.3.0", isError: false }],
    [141, { type: "tool_call", id: "b5", name: "Edit", input: { file_path: path.join(workspace, "story.mjs"), old_string: "a", new_string: "b" } }],
    [142, { type: "tool_result", id: "b5", content: "Updated", isError: false }],
    [143, { type: "tool_call", id: "b6", name: "mcp__moco__SendUserFile", input: { path: "outbox/storyboard.png", label: "Storyboard" } }],
    [143, { type: "file", path: "outbox/storyboard.png", label: "Storyboard" }],
    [144, { type: "tool_result", id: "b6", content: "Sent", isError: false }],
    [145, { type: "text", messageId: plan, text: "The storyboard is ready. Four scenes, drawn in the ink style. Tell me if any frame should change before I render." }],
    [146, { type: "turn_end", status: "completed" }],
    [600, { type: "user", text: "Love it. Make the ships scene darker, more torchlight. Then render.", files: ["uploads/3f9a2c1b-reference-torchlight.png"] }],
    [602, { type: "thinking", messageId: "t2", text: "Darken scene three and raise the torch glow. Then a full render." }],
    [603, { type: "tool_call", id: "c1", name: "Edit", input: { file_path: path.join(workspace, "story.mjs"), old_string: "a", new_string: "b" } }],
    [604, { type: "tool_result", id: "c1", content: "Updated", isError: false }],
    [605, { type: "tool_call", id: "c2", name: "Bash", input: { command: "node .claude/skills/ink-history/kit/render.mjs story.mjs --out outbox/constantinople-first-cut.mp4" } }],
    [606, { type: "activity", id: "c2", description: "Rendering 1,440 frames", status: "running", kind: "tool" }],
    [905, { type: "tool_result", id: "c2", content: "Rendered 1440 frames in 298.4s\nWrote outbox/constantinople-first-cut.mp4", isError: false }],
    [906, { type: "tasks", tasks: [
      { id: "1", subject: "Write the script and beat sheet", status: "completed" },
      { id: "2", subject: "Draw the storyboard", status: "completed" },
      { id: "3", subject: "Record narration", status: "in_progress" },
      { id: "4", subject: "Render the first cut", status: "completed" },
      { id: "5", subject: "Review timing against the voiceover", status: "pending" },
    ] }],
    [907, { type: "file", path: "outbox/constantinople-first-cut.mp4", label: "First cut, without narration" }],
    [908, { type: "text", messageId: done, text: "Here is the first cut with the darker torchlit scene. It runs **58 seconds**.\n\nTwo things to decide before I record the narration:" }],
    [909, question],
    [910, { type: "text", messageId: second, text: "" }],
  ];
}

/** Creates the profile. Resolves the ids the screenshot run needs. */
export async function buildDemoProfile(data, projects, { empty = false } = {}) {
  const store = new WorkspaceStore(data, projects);
  if (empty) return { store };
  const skill = await store.importSkill(path.join(root, "examples/skills/ink-history"));
  const short = await store.importSkill(path.join(root, "examples/skills/cartoon-audio-short"));
  const names = [
    ["The Chain and the Ships", "codex", skill, [[27, 42, 74], [201, 139, 74]]],
    ["Rajendra Chola crosses the sea", "codex", skill, [[18, 60, 70], [220, 170, 90]]],
    ["Byron's bear", "codex", short, [[60, 40, 70], [230, 150, 120]]],
    ["How the Koh-i-Noor left India", "codex", skill, [[30, 30, 40], [150, 160, 200]]],
    ["Why Rome built roads that still stand after two thousand years of traffic", "codex", skill, undefined],
  ];
  const created = [];
  for (const [name, provider, chosen, colours] of [...names].reverse()) {
    const project = await store.createProject(name, chosen.id, provider);
    if (colours) await writeFile(path.join(project.workspace, "outbox", "cover.png"), picture(640, 360, ...colours));
    created.unshift(project);
  }
  const main = created[0];
  const w = main.workspace;
  await writeFile(path.join(w, "outbox", "storyboard.png"), picture(1280, 720, [27, 42, 74], [201, 139, 74]));
  await writeFile(path.join(w, "uploads", "3f9a2c1b-reference-torchlight.png"), picture(600, 400, [20, 14, 10], [240, 150, 60]));
  await mkdir(path.join(w, "frames"), { recursive: true });
  for (let i = 1; i <= 6; i++) await writeFile(path.join(w, "frames", `scene-${String(i).padStart(2, "0")}.png`), picture(360, 640, [20 + i * 8, 40, 70], [200, 120 + i * 10, 70]));
  await writeFile(path.join(w, "story.mjs"), "export const title = 'The Chain and the Ships';\nexport const scenes = [\n  { id: 'chain', seconds: 8 },\n  { id: 'cannon', seconds: 12 },\n  { id: 'ships', seconds: 22 },\n  { id: 'breach', seconds: 18 },\n];\n");
  await writeFile(path.join(w, "script.md"), "# The Chain and the Ships\n\nIn 1453 a chain of iron closed the Golden Horn.\n\nNo ship could pass. So Mehmed took his ships over the hills.\n");
  await writeFile(path.join(w, "outbox", "captions.srt"), "1\n00:00:00,000 --> 00:00:04,000\nIn 1453 a chain of iron closed the Golden Horn.\n\n2\n00:00:04,000 --> 00:00:08,000\nNo ship could pass.\n");
  const hasVideo = video(path.join(w, "outbox", "constantinople-first-cut.mp4"), "720x1280", 6);
  const hasAudio = audio(path.join(w, "outbox", "narration-draft.wav"), 5);
  const start = Date.now() - 1000 * 60 * 60 * 26;
  const lines = conversation(w).filter(([, event]) => hasVideo || event.type !== "file" || !event.path.endsWith(".mp4"))
    .map(([offset, event]) => JSON.stringify({ id: randomUUID(), at: new Date(start + offset * 1000).toISOString(), event }));
  await writeFile(path.join(data, "projects", main.id, "conversation.jsonl"), lines.join("\n") + "\n", "utf8");
  // A short second conversation that ended in an error.
  const failed = created[3];
  for (const event of [
    { type: "user", text: "Start a new video about the Koh-i-Noor.", files: [] },
    { type: "text", messageId: "x", text: "I'll start with the diamond's journey from Golconda." },
    { type: "error", message: "Codex is not connected. Run codex login in a terminal and sign in with ChatGPT, then retry." },
    { type: "turn_end", status: "error" },
  ]) await store.record(failed.id, event);
  return { store, main, created, hasVideo, hasAudio };
}
