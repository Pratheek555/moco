import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const python = fileURLToPath(new URL(process.platform === "win32" ? "../.venv-voice/Scripts/python.exe" : "../.venv-voice/bin/python", import.meta.url));
for (const args of [["venv", ".venv-voice", "--python", "3.11", "--allow-existing"], ["pip", "install", "--python", python, "chatterbox-tts==0.1.7", "setuptools==80.9.0"]]) {
  const result = spawnSync("uv", args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("Voice runtime installed. Run pnpm voice:download english to download weights, then pnpm voice:demo to audition.");
