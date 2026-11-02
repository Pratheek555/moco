import { chatterboxAudio } from "../packages/audio/src/chatterbox.ts";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import type { Line } from "../packages/audio/src/index.ts";
const lines: Line[] = [
  { id: "l01", text: "He had the power to win. So why did he lower his bow?", delivery: { emotion: "tense", intensity: 0.65, pauseAfterMs: 650 } },
  { id: "l02", text: "Across the battlefield, Arjuna saw the faces of the people who had raised him.", delivery: { emotion: "grieving", intensity: 0.45, pauseAfterMs: 550 } },
  { id: "l03", text: "His hands trembled. For the first time, victory felt like losing everything.", delivery: { emotion: "grieving", intensity: 0.65, pauseAfterMs: 750 } },
  { id: "l04", text: "Krishna did not ask him to stop feeling. He asked him to see clearly.", delivery: { emotion: "warm", intensity: 0.45, pauseAfterMs: 400 } },
  { id: "l05", text: "Courage begins when you face what frightens you, and choose to act anyway.", delivery: { emotion: "resolute", intensity: 0.65, pauseAfterMs: 300 } },
];
const dir = join(process.cwd(), "artifacts", "voice-demo");
const result = await chatterboxAudio({ reference: process.env.MOCO_VOICE_REFERENCE,
  modelDir: process.env.MOCO_VOICE_MODEL_DIR ?? join(process.cwd(), "artifacts/voice-models/english") }).tts(lines, { voiceId: "narrator", backend: "chatterbox" }, "en", dir);
await writeFile(join(dir, "performance.json"), JSON.stringify({ lines, ...result, timing: "estimated, not forced alignment" }, null, 2));
console.log(JSON.stringify(result, null, 2));
