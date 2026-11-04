"""Inspect 32 evenly spaced frames from an encoded artist benchmark, in two sheets."""
import json
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(sys.argv[1])
video = root / 'episodes/ep-01/renders' / (sys.argv[2] if len(sys.argv) > 2 else 'final.mp4')
probe = json.loads(subprocess.check_output([
    'ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(video)
]))
duration = float(probe['format']['duration'])
out = root / 'encoded-review'
out.mkdir(exist_ok=True)
(out / 'media.json').write_text(json.dumps(probe, indent=2), encoding='utf-8')
for page in range(2):
    sheet = Image.new('RGB', (1440, 908), '#eee8de')
    draw = ImageDraw.Draw(sheet)
    for cell in range(16):
        seconds = duration * (page * 16 + cell + .5) / 32
        frame = out / f'frame-{page*16+cell:02d}.png'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(seconds), '-i', str(video),
                        '-frames:v', '1', str(frame)], check=True)
        with Image.open(frame) as image:
            image.thumbnail((360, 203))
            x, y = cell % 4 * 360, cell // 4 * 227
            sheet.paste(image, (x, y))
            draw.text((x+8, y+207), f'{seconds:.2f} s', fill='#2b2d42')
    path = out / f'contact-{page+1}.png'
    sheet.save(path)
    print(path)
