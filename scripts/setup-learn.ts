// Installs the learn pipeline's Python tools into .venv-learn: yt-dlp (downloads), OpenCV + numpy (frame measurement)
// and faster-whisper (word timings). ffmpeg and ffprobe must be on PATH.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const python = fileURLToPath(new URL(process.platform === "win32" ? "../.venv-learn/Scripts/python.exe" : "../.venv-learn/bin/python", import.meta.url));
const packages = ["yt-dlp[default]==2026.10.26", "faster-whisper==1.2.1", "opencv-python-headless==5.0.0.93", "numpy==2.4.6"];
for (const args of [["venv", ".venv-learn", "--python", "3.11", "--allow-existing"], ["pip", "install", "--python", python, ...packages]]) {
  const result = spawnSync("uv", args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const check = spawnSync(python, ["-I", fileURLToPath(new URL("../packages/learn/python/measure.py", import.meta.url)), "selftest"], { stdio: "inherit", windowsHide: true });
if (check.status !== 0) process.exit(check.status ?? 1);
console.log('Learn tools installed. Run: pnpm learn --name "Style name" <youtube-url> [more…]');
