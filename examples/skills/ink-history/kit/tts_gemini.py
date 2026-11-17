"""Gemini adapter for film.py's existing per-clause timing/cache contract."""
from pathlib import Path
import hashlib

import soundfile as sf

from gemini_tts import MODEL, selected_voice, synthesize
from tts import SR, digest, finish, mono


class GeminiVoice:
    def __init__(self, voice, cfg, story_dir, out, ffmpeg, trim):
        self.voice = dict(voice)
        if set(self.voice) - {'engine', 'name', 'style'}:
            raise ValueError('Gemini voice accepts only engine/name/style; put delivery direction in style.')
        self.engine = 'gemini'; self.name = selected_voice(voice.get('name'))
        self.style = voice.get('style', '')
        if not isinstance(self.style, str): raise ValueError('Gemini style must be text.')
        self.ffmpeg = ffmpeg; self.trim = trim
        self.seed = None; self.last_clip_seed = None
        self.identity = dict(engine='gemini', model=MODEL, name=self.name, style=self.style,
                             pipeline=hashlib.sha256(Path(__file__).read_bytes() + Path(__file__).with_name('gemini_tts.py').read_bytes()).hexdigest())

    def ensure_anchor(self):
        pass  # Prebuilt voice identity; no local speaker anchor or model download.

    def clip(self, text, cache):
        file = Path(cache) / f'gemini-{digest([self.identity, text])[:24]}.wav'
        if file.exists():
            audio, rate = sf.read(file, dtype='float32')
            if rate != SR or audio.ndim != 1: raise ValueError('Invalid cached Gemini voice format.')
            return mono(audio), True
        raw = file.with_suffix('.raw.wav')
        try:
            synthesize(text, raw, self.name, self.style)
            audio, rate = sf.read(raw, dtype='float32')
            audio = finish(audio, rate, self.ffmpeg, self.trim, normalize=True)
        finally:
            raw.unlink(missing_ok=True)
        temp = file.with_suffix('.tmp.wav'); sf.write(temp, audio, SR, subtype='FLOAT'); temp.replace(file)
        return audio, False

    def info(self):
        return dict(engine='gemini', local=False, model=MODEL, voice=self.name, style=self.style)
