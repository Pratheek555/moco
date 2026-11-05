"""Make a delivery copy of an actual Moco render, preserving every video frame.

Two-pass -14 LUFS / -1.5 dBTP narration normalization; no added sounds.
Usage: python scripts/normalize-template-video.py final.mp4 upload.mp4
"""
import json
import re
import subprocess
import sys
from pathlib import Path

source, output = map(Path, sys.argv[1:3])
if source.resolve() == output.resolve():
    raise ValueError("Keep the original Moco render; choose a different output path")
output.parent.mkdir(parents=True, exist_ok=True)
base = ["ffmpeg", "-hide_banner", "-nostats", "-i", str(source)]
# Leave headroom for AAC intersample overshoot; verify the encoded copy below.
analysis = subprocess.run(base + ["-vn", "-af", "loudnorm=I=-14:TP=-2.2:LRA=11:print_format=json", "-f", "null", "-"], capture_output=True, text=True, check=True)
measured = json.loads(re.findall(r'\{[^{}]+"input_i"[^{}]+\}', analysis.stderr)[-1])
settings = "loudnorm=I=-14:TP=-2.2:LRA=11:linear=true:print_format=json:" + ":".join([
    f"measured_I={measured['input_i']}", f"measured_TP={measured['input_tp']}",
    f"measured_LRA={measured['input_lra']}", f"measured_thresh={measured['input_thresh']}",
    f"offset={measured['target_offset']}",
])
encoded = subprocess.run(base + ["-y", "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", "-af", settings, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", str(output)], capture_output=True, text=True, check=True)
verification = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(output), "-vn", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], capture_output=True, text=True, check=True)
actual = json.loads(re.findall(r'\{[^{}]+"input_i"[^{}]+\}', verification.stderr)[-1])
if float(actual["input_tp"]) > -1.5 or abs(float(actual["input_i"]) + 14) > 0.7:
    raise ValueError(f"Encoded loudness outside delivery tolerance: {actual}")
report = {"source": str(source.resolve()), "output": str(output.resolve()), "video": "stream copied without changing frames", "before": measured, "after": actual}
output.with_suffix(".loudness.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
