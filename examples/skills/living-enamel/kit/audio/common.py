"""Shared deterministic DSP and paths. All writes stay in audio/ and work/."""
from pathlib import Path
import json
import numpy as np
import soundfile as sf
ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work"
WORK.mkdir(exist_ok=True)
SR = 48000
def read_json(p): return json.loads(Path(p).read_text(encoding="utf-8-sig"))
def save_json(p, data): Path(p).write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
def write(p, x):
    assert np.isfinite(x).all(), p
    sf.write(str(p), x, SR, subtype="PCM_24")
def unit(x, peak=.5):
    return x * (peak / max(float(np.max(np.abs(x))), 1e-9))
def add(dst, src, t, gain=1):
    i = max(0, round(t*SR)); n = min(len(src),len(dst)-i)
    if n > 0: dst[i:i+n] += src[:n]*gain
def tone(freq, dur=1.7):
    t = np.arange(round(dur*SR))/SR
    x = sum(a*np.sin(2*np.pi*freq*r*t)*np.exp(-t/d)
            for r,a,d in [(1,1,.65),(2.003,.28,.40),(3.98,.10,.23),(5.43,.035,.13)])
    x += .12*np.sin(2*np.pi*freq*1.0018*t)*np.exp(-t/.8)
    return x*(1-np.exp(-t/.002))*np.minimum(1,(dur-t)/.03)
