"""Offline Kokoro ONNX inference; all model paths are local, never downloads."""
import json
import sys
from pathlib import Path
import soundfile as sf
import numpy as np
from kokoro_onnx import Kokoro

request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
root = Path(request["modelDir"])
engine = Kokoro(str(root / "kokoro-v1.0.onnx"), str(root / "voices-v1.0.bin"))
for line_index, line in enumerate(request["lines"]):
    voice = line.get("voiceId") or request["voice"]
    if voice == "default":
        voice = request["voice"]
    samples, rate = engine.create(line["text"], voice=voice, speed=1.07 if line.get("compact") else 1.0, lang="en-us")
    if line.get("compact"):
        hop = max(1, int(rate * 0.01))
        count = len(samples) // hop
        rms = np.sqrt(np.mean(samples[:count*hop].reshape(count,hop)**2, axis=1))
        active = np.flatnonzero(rms > 0.005)
        if len(active):
            start = max(0, int(active[0]*hop-rate*0.06))
            end = min(len(samples), int((active[-1]+1)*hop+rate*0.15))
            silence = rms < 0.005
            pieces, cursor, index = [], start, 0
            while index < count:
                if not silence[index]:
                    index += 1
                    continue
                stop = index
                while stop < count and silence[stop]:
                    stop += 1
                a, b = max(start,index*hop), min(end,stop*hop)
                if b-a > rate*0.24:
                    keep = int(rate*0.08)
                    pieces.append(samples[cursor:a+keep])
                    cursor = b-keep
                index = stop
            pieces.append(samples[cursor:end])
            samples = np.concatenate(pieces)
    sf.write(str(Path(request["outDir"]) / f"kokoro-{line_index}.wav"), samples, rate, subtype="PCM_16")
