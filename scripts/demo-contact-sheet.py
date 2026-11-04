"""Create a review sheet from the exact eight frames checked for each saved demo shot."""
import json
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(sys.argv[1] if len(sys.argv) > 1 else "artifacts/authored-pharmacy")
shots = root / "episodes/ep-01/shots"
sheet = Image.new("RGB", (1440, 6 * 294), "#f5f0e7")
draw = ImageDraw.Draw(sheet)
n = 0
for shot in sorted(shots.iterdir()):
    spec = json.loads((shot / "spec.json").read_text(encoding="utf-8"))["data"]
    for i in range(8):
        frame = math.floor((spec["durationFrames"] - 1) * i / 7 + 0.5)
        image = Image.open(shot / f"stills/{frame}.png").convert("RGB")
        image.thumbnail((360, 264))
        x, y = n % 4 * 360, n // 4 * 294
        sheet.paste(image, (x, y))
        draw.text((x + 8, y + 267), f"{shot.name} / frame {frame}", fill="#2b2d42")
        n += 1
out = root / "contact-sheet.png"
sheet.save(out)
print(out)
