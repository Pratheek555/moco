"""Independent output inspection: decoded frames, contact sheets, format/audio.
Usage: python scripts/validate-template-video.py path/to/video.mp4 output/folder
Metrics do not establish artistic similarity; inspect the contact sheets too.
"""
import json
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np

video, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video)]))
stream = next(s for s in probe["streams"] if s["codec_type"] == "video")
duration = float(probe["format"]["duration"])
width, height = stream["width"], stream["height"]
times = np.linspace(0, max(0, duration - 0.1), 48)
cell_w, cell_h = (240, 450) if height > width else (400, 250)
for group in range(3):
    sheet = Image.new("RGB", (cell_w * 4, cell_h * 4), "#e9e4dc")
    draw = ImageDraw.Draw(sheet)
    for index, seconds in enumerate(times[group*16:(group+1)*16]):
        frame = out / f"frame-{group*16+index:02d}.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(seconds), "-i", str(video), "-frames:v", "1", "-vf", f"scale={cell_w}:-1", str(frame)], check=True)
        image = Image.open(frame).convert("RGB")
        image.thumbnail((cell_w, cell_h - 24))
        x, y = index % 4 * cell_w, index // 4 * cell_h
        sheet.paste(image, (x, y))
        draw.text((x+8, y+cell_h-20), f"{seconds:.2f}s", fill="#28394d")
    sheet.save(out / f"contact-sheet-{group+1}.jpg", quality=92)
# Decode at 4 fps to expose long identical stretches without loading full-size video.
raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(video), "-vf", "fps=4,scale=96:96", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
frames = np.frombuffer(raw, dtype=np.uint8).reshape((-1,96,96,3)).astype(np.float32)
diffs = np.abs(np.diff(frames,axis=0)).mean(axis=(1,2,3))
longest = run = 0
for value in diffs:
    run = run + 1 if value < 0.1 else 0
    longest = max(longest, run)
audio = [s for s in probe["streams"] if s["codec_type"] == "audio"]
# Decode every frame at reduced size too. A single outlier surrounded by nearly
# identical frames can be a dropped draw, even when the 4 fps scan looks healthy.
decoder = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(video), "-vf", "scale=96:54", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
previous = before_previous = None
previous_diff = 0
frame_index, dark_frames, flashes = 0, [], []
fps_num, fps_den = map(int, stream["avg_frame_rate"].split("/"))
fps = fps_num / fps_den
while True:
    data = decoder.stdout.read(96*54*3)
    if not data:
        break
    if len(data) != 96*54*3:
        raise ValueError("Truncated decoded frame")
    current = np.frombuffer(data, dtype=np.uint8).astype(np.int16)
    if current.mean() < 1:
        dark_frames.append(frame_index)
    difference = float(np.abs(current-previous).mean()) if previous is not None else 0
    if before_previous is not None and previous_diff > 18 and difference > 18 and np.abs(current-before_previous).mean() < 4:
        flashes.append(round((frame_index-1)/fps, 4))
    before_previous, previous, previous_diff = previous, current, difference
    frame_index += 1
if decoder.wait() != 0:
    raise ValueError("Full-frame decode failed")
report = {"file":str(video.resolve()), "durationSeconds":duration, "width":width, "height":height, "fps":stream["avg_frame_rate"], "audioStreams":len(audio), "maxNearIdenticalSecondsAt4fps":longest/4, "decodedFrameCount":frame_index, "blackFrameIndices":dark_frames, "singleFrameFlashCandidatesSeconds":flashes, "contactSheets":[f"contact-sheet-{n}.jpg" for n in range(1,4)], "warning":"Frame metrics detect freezes and possible glitches, not purposeful acting or style parity. Inspect sheets and listen to audio; intentional flashes may be flagged."}
(out/"inspection.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
print(json.dumps(report,indent=2))
