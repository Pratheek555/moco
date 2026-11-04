import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chatterboxAudio } from "@moco/audio/chatterbox";
const ud = join(process.env.APPDATA!, "Moco");
const script = JSON.parse(readFileSync(process.argv[2]!, "utf8")).data;
const lines = script.lines.slice(0, 2).map((l: { id: string; text: string; delivery?: unknown; speaker: string }) => ({ id: l.id, text: l.text, delivery: l.delivery, speaker: l.speaker }));
const audio = chatterboxAudio({ python: join(ud, "voice/runtime/Scripts/python.exe"), worker: join(process.cwd(), "packages/audio/python/narrate.py"), modelDir: join(ud, "voice/models/english"), expressiveness: 0.65 });
const out = await audio.tts(lines, { voiceId: "narrator", backend: "chatterbox" }, "en", process.argv[3]!);
console.log("OK", out.durationSeconds, out.file);
