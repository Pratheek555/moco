import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { voicePython } from "../packages/audio/src/chatterbox.ts";
const id = process.argv[2] ?? "english";
if (id !== "english" && id !== "multilingual") throw new Error("Choose english or multilingual");
const result = spawnSync(voicePython(), [fileURLToPath(new URL("../packages/audio/python/download_model.py", import.meta.url)), id,
  fileURLToPath(new URL(`../artifacts/voice-models/${id}`, import.meta.url))], { stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
