"""film.py - voice, timing, sound, the review gate, the final render and its checks.

  python film.py prepare <story.mjs> --out <work> [--voice upload.wav [--timings clause-times.json]]
  python film.py stills  <story.mjs> --out <work> [shot ...]
  python film.py render  <story.mjs> --out <work> --name <slug>.mp4
  python film.py qa      <story.mjs> --out <work> --name <slug>.mp4

prepare  speaks every clause of the story with the free local voice (or cuts up an uploaded recording),
         and writes timeline.json: when each shot and each clause starts and stops.
stills   draws three stills per shot, a contact sheet and audit.json (the picture gates).
render   refuses to run until the gates pass and review.json records what you saw on the contact sheet;
         then renders every frame, mixes voice + music + effects, and checks the finished file.
"""
from pathlib import Path
import argparse, hashlib, json, math, os, re, shutil, subprocess, sys

import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
SR = 24000          # voice sample rate
MIX = 48000         # mix sample rate
for stream in (sys.stdout, sys.stderr):
    try: stream.reconfigure(encoding='utf-8', errors='replace')
    except Exception: pass


def config():
    f = ROOT / 'config.json'
    return json.loads(f.read_text(encoding='utf-8-sig')) if f.exists() else {}


def tool(name):
    return config().get(name) or shutil.which(name) or name


def run(args, **kw):
    args = [str(a) for a in args]
    if args[0] in ('ffmpeg', 'ffprobe', 'node'):
        args[0] = tool(args[0])
    if Path(args[0]).stem == 'node' and config().get('ffmpeg'):
        kw.setdefault('env', dict(os.environ, FFMPEG=config()['ffmpeg']))
    return subprocess.run(args, check=True, **kw)


def rms(x):
    x = np.asarray(x, dtype=np.float64)
    return float(np.sqrt(np.mean(x * x) + 1e-12)) if len(x) else 0.0


def db(x):
    return 20 * math.log10(max(x, 1e-9))


def describe(story_file):
    out = run(['node', ROOT / 'render.mjs', 'describe', story_file], capture_output=True, text=True, encoding='utf8').stdout
    return json.loads(out)


def speech_spec(desc):
    return [desc['voice'], [[s['id'], s['say'], s['lead'], s['gap'], s['pause'], s['hold']] for s in desc['shots']]]


def read_audio(file, rate=SR):
    raw = run(['ffmpeg', '-v', 'error', '-i', file, '-f', 'f32le', '-ar', rate, '-ac', '1', 'pipe:1'], capture_output=True).stdout
    return np.frombuffer(raw, dtype='<f4').astype(np.float32).copy()


# ---------------------------------------------------------------------------- voice and timing
def trim(a, pad_in=0.02, pad_out=0.07):
    """Cut the silence the synthesiser leaves around a clause so that cues land on the first syllable."""
    level = np.abs(a)
    loud = np.where(level > max(0.012, float(level.max()) * 0.04))[0]
    if not len(loud):
        return a
    i0 = max(0, loud[0] - int(pad_in * SR)); i1 = min(len(a), loud[-1] + int(pad_out * SR))
    out = a[i0:i1].copy()
    fade = min(len(out) // 2, int(0.008 * SR))
    if fade:
        out[:fade] *= np.linspace(0, 1, fade); out[-fade:] *= np.linspace(1, 0, fade)
    return out


def speak(desc, out):
    cfg = config(); voice = desc.get('voice') or {}
    name = voice.get('name', 'bm_george'); speed = float(voice.get('speed', 1.12)); lang = voice.get('lang', 'en-gb' if name.startswith('b') else 'en-us')
    cache = out / 'voice-cache'; cache.mkdir(exist_ok=True)
    engine = None; clips = {}
    clauses = [(i, k, text) for i, sh in enumerate(desc['shots']) for k, text in enumerate(sh['say'])]
    for n, (i, k, text) in enumerate(clauses):
        key = hashlib.sha256(json.dumps([text, name, speed, lang]).encode()).hexdigest()[:24]
        f = cache / f'{key}.wav'
        if f.exists():
            a, rate = sf.read(f, dtype='float32')
        else:
            if engine is None:
                if 'voiceCache' not in cfg:
                    raise SystemExit('No voice model configured. Run setup.py (without --no-tts), or pass --voice with a recording.')
                from kokoro_onnx import Kokoro
                engine = Kokoro(str(Path(cfg['voiceCache']) / 'kokoro-v1.0.onnx'), str(Path(cfg['voiceCache']) / 'voices-v1.0.bin'))
            print(f'voice {n + 1}/{len(clauses)}: {text[:60]}', flush=True)
            a, rate = engine.create(text, voice=name, speed=speed, lang=lang)
            if rate != SR:
                raise SystemExit(f'Unexpected voice sample rate {rate}.')
            a = trim(np.asarray(a, dtype=np.float32)); sf.write(f, a, SR, subtype='FLOAT')
        clips[(i, k)] = a
    t = 0.0; shots = []; parts = []
    def silence(sec):
        nonlocal t
        n = int(round(max(0.0, sec) * SR)); parts.append(np.zeros(n, dtype=np.float32)); t += n / SR
    for i, sh in enumerate(desc['shots']):
        start = t; cues = []; ends = []
        silence(sh.get('lead', 0))
        for k, _ in enumerate(sh['say']):
            if k: silence(sh.get('gap', 0.1))
            a = clips[(i, k)]; cues.append(t - start); parts.append(a); t += len(a) / SR; ends.append(t - start)
        silence(sh.get('pause', 0.22) + sh.get('hold', 0))
        if t - start < 0.6: silence(0.6 - (t - start))
        shots.append({'id': sh['id'], 'start': start, 'end': t, 'cues': cues, 'ends': ends})
    return np.concatenate(parts), shots, {'engine': 'kokoro-onnx (local, free)', 'voice': name, 'speed': speed, 'lang': lang}


def cut_upload(desc, voice_file, timings, out):
    """Picture follows the recording. Clause boundaries are found at silences near where the word counts
    predict them; this is an estimate, so it is written out for correction (--timings)."""
    audio = read_audio(voice_file, SR); duration = len(audio) / SR
    if not len(audio) or rms(audio) < 0.0001:
        raise SystemExit('The uploaded recording is empty or silent; supply an audible voiceover.')
    clauses = [(i, k, sh['say'][k]) for i, sh in enumerate(desc['shots']) for k in range(len(sh['say']))]
    if not clauses:
        raise SystemExit('The story has no narration to align with the recording.')
    words = np.array([max(1, len(re.findall(r"[\w']+", c[2]))) for c in clauses], dtype=float)
    if timings:
        points = json.loads(Path(timings).read_text(encoding='utf-8-sig'))
        if len(points) != len(clauses) + 1 or points[0] < 0 or any(b <= a for a, b in zip(points, points[1:])) or points[-1] > duration + 0.2:
            raise SystemExit(f'--timings must be an increasing JSON list of {len(clauses) + 1} numbers: the start of each clause in seconds, then the end of the last one.')
        source = 'explicit'
    else:
        hop = 240; energy = np.array([rms(audio[i:i + hop]) for i in range(0, len(audio), hop)])
        quiet = energy < max(0.004, float(energy.max()) * 0.035)
        loud = np.where(~quiet)[0]
        first = max(0.0, loud[0] * hop / SR - 0.03) if len(loud) else 0.0
        last = min(duration, (loud[-1] + 1) * hop / SR + 0.08) if len(loud) else duration
        silent_t = np.where(quiet)[0] * hop / SR
        ideal = first + np.cumsum(words) / words.sum() * (last - first)
        points = [first]
        for target in ideal[:-1]:
            cand = silent_t[(silent_t > points[-1] + 0.4) & (np.abs(silent_t - target) < 1.2)]
            points.append(float(cand[np.argmin(np.abs(cand - target))]) if len(cand) else max(points[-1] + 0.4, float(target)))
        points.append(last); source = 'silence-estimate'
        (out / 'TIMING-REVIEW.txt').write_text('Uploaded voice: clause boundaries were ESTIMATED from silences and word counts, not from the words themselves.\nLook at waveform.png (red = shot starts, grey = clause starts), compare with clause-times.json, correct the numbers and run:\n  film.py prepare <story> --out <work> --voice <file> --timings <work>/clause-times.json\n', encoding='utf8')
    (out / 'clause-times.json').write_text(json.dumps([round(p, 3) for p in points], indent=1), encoding='utf8')
    shots = []; n = 0
    for i, sh in enumerate(desc['shots']):
        count = len(sh['say'])
        if count == 0:
            raise SystemExit(f'Shot "{sh["id"]}" has no narration. With an uploaded voice every shot needs the words it covers (the picture follows the recording).')
        start = points[n] if i else 0.0; end = points[n + count] if i < len(desc['shots']) - 1 else duration
        shots.append({'id': sh['id'], 'start': start, 'end': end, 'cues': [points[n + k] - start for k in range(count)], 'ends': [min(points[n + k + 1], end) - start for k in range(count)]})
        n += count
    return audio, shots, {'engine': 'uploaded recording', 'source': str(Path(voice_file).resolve()), 'timing': source}


def waveform(audio, shots, out):
    w, h = 1800, 300; duration = len(audio) / SR
    im = Image.new('RGB', (w, h), '#f4efe6'); d = ImageDraw.Draw(im)
    step = max(1, len(audio) // w)
    for x in range(w):
        seg = audio[x * step:(x + 1) * step]
        v = min(h / 2 - 12, float(np.max(np.abs(seg))) * h * 0.55) if len(seg) else 0
        d.line((x, h / 2 - v, x, h / 2 + v), fill='#39566a')
    for i, s in enumerate(shots):
        for c in s['cues'][1:]:
            x = (s['start'] + c) / duration * w; d.line((x, 30, x, h - 30), fill='#9a9a9a')
        x = s['start'] / duration * w; d.line((x, 0, x, h), fill='#b3261e', width=2); d.text((x + 4, 6), f"{i + 1} {s['id']}"[:14], fill='#1a0e10')
    im.save(out / 'waveform.png')


def prepare(story_file, out, voice=None, timings=None):
    out.mkdir(parents=True, exist_ok=True)
    desc = describe(story_file)
    if voice:
        audio, shots, info = cut_upload(desc, voice, timings, out)
    else:
        audio, shots, info = speak(desc, out)
    duration = len(audio) / SR
    if shots: shots[-1]['end'] = duration
    sf.write(out / 'voice.wav', audio, SR)
    hop = SR // 60
    env = np.array([rms(audio[i:i + hop]) for i in range(0, len(audio), hop)])
    ref = float(np.quantile(env[env > 0.004], 0.85)) if np.any(env > 0.004) else 0.1
    env = np.clip(env / ref, 0, 1)
    timeline = {'duration': duration, 'fps': desc['fps'], 'speech': speech_spec(desc), 'envRate': 60, 'voice': info, 'shots': shots, 'envelope': [round(float(v), 3) for v in env]}
    (out / 'timeline.json').write_text(json.dumps(timeline), encoding='utf8')
    (out / 'script.txt').write_text('\n\n'.join(f"[{s['id']}] " + ' / '.join(s['say']) for s in desc['shots']), encoding='utf8')
    waveform(audio, shots, out)
    words = sum(s['words'] for s in desc['shots'])
    print(f'Timeline ready: {duration:.1f}s, {len(shots)} shots, {words} words ({words / max(duration, 1e-6):.2f} words/s).')
    for s in shots:
        print(f"  {s['id']:<16} {s['start']:6.2f} - {s['end']:6.2f}  ({s['end'] - s['start']:.2f}s)  cues " + ', '.join(f'{c:.2f}' for c in s['cues']))
    longest = max(shots, key=lambda s: s['end'] - s['start'])
    if longest['end'] - longest['start'] > 10:
        print(f"NOTE: shot {longest['id']} runs {longest['end'] - longest['start']:.1f}s; shots over 10s fail the picture gate. Split its narration.")


# ---------------------------------------------------------------------------- sound
def tone(freq, n, decay=6.0, harmonics=(1, 0.5, 0.25, 0.12), damp=1.6):
    """A plucked note: every higher harmonic dies faster, which is what makes it sound struck not beeped."""
    t = np.arange(n) / MIX; out = np.zeros(n)
    for k, amp in enumerate(harmonics, start=1):
        out += amp * np.sin(2 * np.pi * freq * k * t) * np.exp(-t * decay * (1 + damp * (k - 1)))
    return out * np.minimum(t / 0.004, 1)


def band_noise(n, rng, lo=0.0, hi=1.0):
    """White noise limited to a band given as fractions of the spectrum (0..1 of Nyquist)."""
    spec = np.fft.rfft(rng.normal(0, 1, n)); f = np.linspace(0, 1, len(spec))
    spec *= (f >= lo) & (f <= hi)
    return np.fft.irfft(spec, n)


NOTE = lambda semis: 220.0 * 2 ** (semis / 12)          # semitones above A3
MOODS = {
    #            bpm  chords (root semitone, minor?)                 swing
    'jaunty': (112, [(3, 0), (0, 1), (8, 0), (10, 0)], 0.16),       # C  Am  F  G
    'sneaky': (92, [(0, 1), (0, 1), (5, 1), (7, 0)], 0.22),         # Am Am Dm E
    'march': (104, [(5, 0), (5, 0), (10, 0), (0, 0)], 0.0),         # D  D  G  A
    'wistful': (84, [(0, 1), (8, 0), (3, 0), (10, 0)], 0.1),        # Am F  C  G
}


def music_bed(duration, spec, rng):
    mood = spec.get('mood', 'jaunty')
    if mood in ('none', None, False):
        return np.zeros((int(duration * MIX) + 1, 2))
    bpm, chords, swing = MOODS.get(mood, MOODS['jaunty']); bpm = spec.get('bpm', bpm)
    beat = 60.0 / bpm; n = int(duration * MIX) + 1; out = np.zeros((n, 2))
    def add(sig, start, pan=0.0, gain=1.0):
        i = int(start * MIX)
        if i >= n or i < 0: return
        sig = sig[:n - i] * gain; out[i:i + len(sig), 0] += sig * math.sqrt((1 - pan) / 2); out[i:i + len(sig), 1] += sig * math.sqrt((1 + pan) / 2)
    bars = int(math.ceil(duration / (beat * 4)))
    motif = [0, 2, 1, 2, 0, 2, 1, 3]                         # which chord tone the plucked line plays on each eighth
    for bar in range(bars):
        root, minor = chords[bar % len(chords)]; third = 3 if minor else 4
        triad = [root, root + third, root + 7, root + 12]
        for b in range(4):
            t0 = (bar * 4 + b) * beat
            # bass on 1 and 3 (root, then fifth); a soft off-beat chord stab on 2 and 4
            if b % 2 == 0:
                add(tone(NOTE(root - 24 + (7 if b == 2 else 0)), int(MIX * beat * 1.4), 4.5, (1, 0.6, 0.2), 1.2), t0, -0.1, 0.9)
            else:
                for j, s in enumerate(triad[:3]):
                    add(tone(NOTE(s - 12), int(MIX * 0.3), 13, (1, 0.4, 0.15)), t0 + j * 0.008, 0.25, 0.28)
                add(band_noise(int(MIX * 0.05), rng, 0.25, 0.6) * np.exp(-np.arange(int(MIX * 0.05)) / MIX * 70), t0, -0.3, 0.16)   # brush tick
            # the plucked line: eighth notes, lightly swung, resting every fourth bar so it never nags
            if bar % 4 != 3 and mood != 'march':
                for e in range(2):
                    step = motif[(b * 2 + e) % 8]; vel = 0.5 if e == 0 else 0.34
                    if rng.random() < 0.18: continue
                    add(tone(NOTE(triad[step]), int(MIX * 0.42), 8.5, (1, 0.5, 0.3, 0.1)), t0 + e * beat * (0.5 + swing), 0.35 if e else -0.2, vel * 0.5)
            if mood == 'march':                                # snare-ish taps: 1 . 2-and 3 . 4-and
                for e, g in ((0, 0.5), (0.5, 0.25)) if b % 2 else ((0, 0.42),):
                    k = int(MIX * 0.09); add(band_noise(k, rng, 0.12, 0.5) * np.exp(-np.arange(k) / MIX * 46), t0 + e * beat, 0.1, g)
    fade = int(MIX * 0.8); out[:fade] *= np.linspace(0, 1, fade)[:, None]; out[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return out


def effect(kind, rng, dur=None):
    """Small synthesised comic sounds. Returns a mono array at MIX rate."""
    def env(n, attack, decay):
        t = np.arange(n) / MIX; return np.minimum(t / max(attack, 1e-4), 1) * np.exp(-t * decay)
    def sweep(f0, f1, n, curve=1.0):
        u = (np.arange(n) / max(1, n - 1)) ** curve; return np.sin(2 * np.pi * np.cumsum(f0 + (f1 - f0) * u) / MIX)
    if kind == 'pop':
        n = int(MIX * 0.09); return sweep(380, 980, n, 0.6) * env(n, 0.002, 34)
    if kind == 'whoosh':
        n = int(MIX * (dur or 0.32)); u = np.arange(n) / n; return band_noise(n, rng, 0.02, 0.22) * np.sin(np.pi * u) ** 2 * 0.9
    if kind == 'thud':
        n = int(MIX * 0.3); return (sweep(120, 46, n, 0.5) * env(n, 0.002, 16) + band_noise(n, rng, 0, 0.08) * env(n, 0.001, 60) * 0.5)
    if kind == 'stamp':
        n = int(MIX * 0.22); return (sweep(160, 60, n, 0.4) * env(n, 0.001, 24) + band_noise(n, rng, 0.05, 0.3) * env(n, 0.001, 90) * 0.6)
    if kind == 'ding':
        n = int(MIX * 1.0); t = np.arange(n) / MIX; return (np.sin(2 * np.pi * 1318.5 * t) + 0.5 * np.sin(2 * np.pi * 1975.5 * t) + 0.25 * np.sin(2 * np.pi * 2637 * t)) * env(n, 0.002, 5)
    if kind == 'tick':
        n = int(MIX * 0.05); return band_noise(n, rng, 0.2, 0.7) * env(n, 0.0005, 120)
    if kind == 'paper':
        n = int(MIX * 0.3); t = np.arange(n) / MIX; return band_noise(n, rng, 0.15, 0.6) * np.abs(np.sin(t * 46)) * env(n, 0.01, 9) * 0.7
    if kind == 'boing':
        n = int(MIX * 0.55); t = np.arange(n) / MIX; f = 150 + 130 * np.exp(-t * 5) * np.sin(2 * np.pi * 9 * t) + 60 * np.exp(-t * 3)
        return np.sin(2 * np.pi * np.cumsum(f) / MIX) * env(n, 0.003, 5.5)
    if kind in ('slide-up', 'slide-down'):
        n = int(MIX * (dur or 0.42)); a, b = (420, 1250) if kind == 'slide-up' else (1250, 380)
        return (sweep(a, b, n, 0.8) + 0.2 * sweep(a * 2, b * 2, n, 0.8)) * np.sin(np.pi * np.arange(n) / n) ** 0.6 * 0.8
    if kind == 'sting':                                         # two low notes: "dun-dun"
        n = int(MIX * 1.1); a = tone(110, n, 3.2, (1, 0.7, 0.5, 0.3), 0.6); b = tone(103.8, n, 3.2, (1, 0.7, 0.5, 0.3), 0.6); out = np.zeros(n + int(MIX * 0.28)); out[:n] += a; out[int(MIX * 0.28):] += b; return out * 0.8
    if kind == 'fanfare':                                       # three rising notes on a buzzy reed
        notes = [392, 523.25, 659.25]; step = int(MIX * 0.16); out = np.zeros(step * 2 + int(MIX * 0.6))
        for i, f in enumerate(notes):
            n = int(MIX * (0.6 if i == 2 else 0.18)); t = np.arange(n) / MIX
            sig = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 7)) * np.minimum(t / 0.012, 1) * np.exp(-t * (2.2 if i == 2 else 5)); out[i * step:i * step + n] += sig * 0.5
        return out
    if kind == 'drum':
        n = int(MIX * 0.2); return band_noise(n, rng, 0.1, 0.55) * env(n, 0.001, 30) + sweep(220, 150, n) * env(n, 0.001, 40) * 0.6
    if kind == 'clang':
        n = int(MIX * 0.7); t = np.arange(n) / MIX; return sum(np.sin(2 * np.pi * f * t) * a for f, a in ((523, 1), (1187, 0.7), (1733, 0.5), (2411, 0.35), (3190, 0.2))) * env(n, 0.001, 7) * 0.5
    if kind == 'splash':
        n = int(MIX * 0.6); return band_noise(n, rng, 0.05, 0.5) * env(n, 0.01, 7)
    if kind == 'crowd':                                         # a murmur under a crowd shot
        n = int(MIX * (dur or 2.0)); u = np.arange(n) / n; wob = 0.6 + 0.4 * np.sin(2 * np.pi * (3.1 * u * (dur or 2.0)) + rng.random() * 6)
        return band_noise(n, rng, 0.01, 0.09) * wob * np.sin(np.pi * u) ** 0.5 * 0.8
    if kind == 'wind':
        n = int(MIX * (dur or 2.0)); u = np.arange(n) / n; return band_noise(n, rng, 0.005, 0.06) * (0.6 + 0.4 * np.sin(2 * np.pi * u * 1.3)) * np.sin(np.pi * u) ** 0.5
    raise SystemExit(f'Unknown sound effect "{kind}". Known: pop whoosh thud stamp ding tick paper boing slide-up slide-down sting fanfare drum clang splash crowd wind.')


def cue_time(shot_tl, at):
    """`at` is seconds from the shot start, or 'cue2', 'end1', 'end', optionally with an offset: 'cue2+0.3'."""
    if isinstance(at, (int, float)):
        return float(at)
    m = re.fullmatch(r'\s*(cue|end)(\d*)\s*([+-]\s*[\d.]+)?\s*', str(at))
    if not m:
        raise SystemExit(f'Cannot read sfx time "{at}". Use seconds, or cue1 / end1 / end with an optional +0.2.')
    kind, num, off = m.groups(); off = float(off.replace(' ', '')) if off else 0.0
    dur = shot_tl['end'] - shot_tl['start']
    if kind == 'end' and not num: return dur + off
    table = shot_tl['cues'] if kind == 'cue' else shot_tl['ends']; i = int(num or 1) - 1
    return (table[i] if 0 <= i < len(table) else dur) + off


def sounds(desc, timeline, out):
    n = int(round(timeline['duration'] * MIX)); rng = np.random.default_rng(217)
    voice = read_audio(out / 'voice.wav', MIX); voice = np.pad(voice, (0, max(0, n - len(voice))))[:n]
    music = music_bed(timeline['duration'], desc.get('music') or {}, rng)[:n]
    if len(music) < n: music = np.pad(music, ((0, n - len(music)), (0, 0)))
    sfx = np.zeros((n, 2)); cues = []
    for sh, tl in zip(desc['shots'], timeline['shots']):
        for cue in sh.get('sfx') or []:
            kind = cue.get('type', 'pop'); when = tl['start'] + cue_time(tl, cue.get('at', 0))
            sig = effect(kind, rng, cue.get('dur')); peak = float(np.max(np.abs(sig))) or 1.0
            sig = sig / peak * float(cue.get('gain', 1.0)); pan = float(cue.get('pan', 0.0)); i = int(when * MIX)
            if 0 <= i < n:
                sig = sig[:n - i]; sfx[i:i + len(sig), 0] += sig * math.sqrt((1 - pan) / 2); sfx[i:i + len(sig), 1] += sig * math.sqrt((1 + pan) / 2)
                cues.append({'shot': sh['id'], 'type': kind, 'time': round(when, 3)})
        if sh.get('musicStop'):                                 # the music cuts dead for a punchline and comes back on the next shot
            a = int(tl['start'] * MIX); b = int(tl['end'] * MIX); fade = min(MIX // 12, max(1, b - a))
            music[a:a + fade] *= np.linspace(1, 0, fade)[:, None]; music[a + fade:b] = 0
            back = min(MIX // 4, n - b)
            if back > 0: music[b:b + back] *= np.linspace(0, 1, back)[:, None]
    active = np.abs(voice) > 0.02; vr = rms(voice[active]) if active.any() else max(rms(voice), 1e-4)
    vgain = 0.12 / vr; v = np.column_stack([voice, voice]) * vgain
    spec = desc.get('music') or {}
    music_db = float(spec.get('level', -21)); sfx_db = -9.0     # music sits about 21 dB under the voice; an effect peaks about 9 dB under the voice peak
    if rms(music) > 1e-7: music *= (0.12 * 10 ** (music_db / 20)) / rms(music)
    vpeak = float(np.max(np.abs(v))) or 1.0
    if np.max(np.abs(sfx)) > 0: sfx *= vpeak * 10 ** (sfx_db / 20)
    # duck the music a little further while the narrator is actually speaking
    hop = MIX // 50; speaking = np.array([rms(voice[i:i + hop]) > 0.02 * (vr / 0.12 if vr else 1) for i in range(0, n, hop)], dtype=float)
    duck = np.repeat(np.convolve(speaking, np.ones(12) / 12, mode='same'), hop)[:n]; duck = np.pad(duck, (0, n - len(duck)))
    music *= (1 - 0.3 * duck)[:, None]
    mix = v + music + sfx
    peak = float(np.max(np.abs(mix))); mix *= min(1.0, 0.92 / max(peak, 1e-9))
    sf.write(out / 'mix.wav', mix, MIX)
    stats = {'musicBelowVoiceDb': round(db(rms(music[active])) - db(rms(v[active])), 1) if active.any() and rms(music) > 1e-7 else None,
             'sfxPeakBelowVoicePeakDb': round(db(float(np.max(np.abs(sfx)))) - db(vpeak), 1) if np.max(np.abs(sfx)) > 0 else None,
             'mixPeakDbfs': round(db(float(np.max(np.abs(mix)))), 1), 'effects': cues, 'music': spec.get('mood', 'jaunty')}
    (out / 'audio-mix.json').write_text(json.dumps(stats, indent=1), encoding='utf8')
    return stats


# ---------------------------------------------------------------------------- gates
def signature(story_file, out):
    """Everything that decides what the pictures look like: story and drawing code plus the shot timing."""
    h = hashlib.sha256(); folder = story_file.parent
    files = {story_file, *ROOT.glob('*.mjs')}
    files.update(f for f in (ROOT / 'assets').rglob('*') if f.suffix.lower() in {'.png', '.jpg', '.jpeg', '.svg', '.ttf', '.otf'})
    for directory, subdirs, names in os.walk(folder):
        subdirs[:] = [d for d in subdirs if d not in {'node_modules', '.venv', '__pycache__', '.git'} and not d.startswith('.') and (Path(directory) / d).resolve() != out.resolve()]
        files.update(Path(directory) / n for n in names if Path(n).suffix.lower() in {'.mjs', '.png', '.jpg', '.jpeg', '.svg', '.ttf', '.otf'})
    for f in sorted(files):
        if f.is_file(): h.update(f.name.encode()); h.update(f.read_bytes())
    tl = json.loads((out / 'timeline.json').read_text(encoding='utf-8-sig'))
    h.update(json.dumps([[s['id'], round(s['start'], 3), round(s['end'], 3), [round(c, 3) for c in s['cues']]] for s in tl['shots']]).encode())
    return h.hexdigest()


def stills(story_file, out, only):
    if not (out / 'timeline.json').exists():
        print('No timeline yet: these stills use DRAFT timing from word counts. Run `prepare` before the final review.')
    r = subprocess.run([tool('node'), str(ROOT / 'render.mjs'), 'stills', str(story_file), str(out), *only])
    if r.returncode: raise SystemExit(r.returncode)
    if (out / 'timeline.json').exists() and not only:
        (out / 'stills-signature.txt').write_text(signature(story_file, out))


def finish(out, name):
    """Two-pass loudness normalisation of the mix, then join it to the picture."""
    first = run(['ffmpeg', '-hide_banner', '-i', out / 'mix.wav', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True).stderr
    m = json.loads(re.findall(r'\{[^{}]+\}', first)[-1])
    flt = f"loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true"
    file = out / name
    run(['ffmpeg', '-v', 'error', '-y', '-i', out / 'picture.mp4', '-i', out / 'mix.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', flt, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-shortest', file])
    return file


def qa(story_file, out, file):
    issues = []
    p = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], capture_output=True, text=True).stdout)
    v = next((s for s in p['streams'] if s['codec_type'] == 'video'), None); a = next((s for s in p['streams'] if s['codec_type'] == 'audio'), None)
    timeline = json.loads((out / 'timeline.json').read_text(encoding='utf-8-sig')); dur = float(p['format']['duration'])
    if not v: issues.append('No video stream.')
    elif [v['width'], v['height']] != [1920, 960]: issues.append(f"Picture is {v['width']}x{v['height']}, expected 1920x960.")
    if v:
        num, den = map(float, v['avg_frame_rate'].split('/'))
        expected = describe(story_file)['fps']
        if abs(num / den - expected) > 0.02: issues.append(f'Frame rate is {num / den:.3f}; expected {expected}.')
    if not a: issues.append('No audio stream.')
    if abs(dur - timeline['duration']) > 0.15: issues.append(f"File runs {dur:.2f}s but the timeline is {timeline['duration']:.2f}s.")
    audit = json.loads((out / 'audit.json').read_text(encoding='utf-8-sig')) if (out / 'audit.json').exists() else None
    if not audit or not audit.get('passed'): issues.append('The picture gates (audit.json) have unresolved issues.')
    rep = run(['ffmpeg', '-hide_banner', '-i', file, '-vf', 'blackdetect=d=0.2:pix_th=0.08,freezedetect=n=-52dB:d=2.5', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True).stderr
    freeze_starts = [float(q) for q in re.findall(r'freeze_start: ([\d.]+)', rep)]
    freeze_ends = [float(q) for q in re.findall(r'freeze_end: ([\d.]+)', rep)]
    freezes = [(start, next((end for end in freeze_ends if end > start), dur)) for start in freeze_starts]
    blacks = re.findall(r'black_start:([\d.]+)', rep)
    if freezes: issues.append('Frozen picture at ' + ', '.join(f'{s:.1f}-{e:.1f}s' for s, e in freezes) + '. Nothing at all moves there, not even the camera: give the shot a camera drift and an action.')
    if blacks: issues.append(f'Black picture at {", ".join(blacks)}s.')
    loud = json.loads(re.findall(r'\{[^{}]+\}', rep)[-1])
    if not -18 <= float(loud['input_i']) <= -14: issues.append(f"Loudness {loud['input_i']} LUFS is outside -18..-14.")
    if float(loud['input_tp']) > -0.9: issues.append(f"True peak {loud['input_tp']} dBTP is above -0.9.")
    stems = json.loads((out / 'audio-mix.json').read_text(encoding='utf-8-sig')) if (out / 'audio-mix.json').exists() else {}
    if stems.get('musicBelowVoiceDb') is not None and stems['musicBelowVoiceDb'] > -14: issues.append('Music is less than 14 dB under the voice; narration must stay clearly on top.')
    # frames taken back out of the finished file: one per shot, for a last look at what was really encoded
    frames = out / 'final-frames'; shutil.rmtree(frames, ignore_errors=True); frames.mkdir()
    thumbs = []
    for i, s in enumerate(timeline['shots']):
        t = (s['start'] + s['end']) / 2; f = frames / f"{i + 1:02d}-{s['id']}.jpg"
        run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.3f}', '-i', file, '-frames:v', '1', '-q:v', '3', f])
        if f.exists():
            im = Image.open(f).convert('RGB'); arr = np.asarray(im.resize((320, 160)), dtype=float)
            if arr.std() < 9: issues.append(f'{f.name}: almost empty frame in the finished file.')
            thumbs.append((s['id'], im.resize((480, 240))))
        else:
            issues.append(f"Could not read a frame at {t:.1f}s from the finished file.")
    if thumbs:
        cols = 4; rows = math.ceil(len(thumbs) / cols); sheet = Image.new('RGB', (cols * 480, rows * 264), '#f4efe6'); d = ImageDraw.Draw(sheet)
        try: font = ImageFont.truetype(str(ROOT / 'assets' / 'LilitaOne-Regular.ttf'), 18)
        except Exception: font = None
        for i, (sid, im) in enumerate(thumbs):
            x, y = (i % cols) * 480, (i // cols) * 264; sheet.paste(im, (x, y)); d.text((x + 6, y + 242), f'{i + 1}. {sid}', fill='#1a0e10', font=font)
        sheet.save(out / 'final-sheet.jpg', quality=88)
    result = {'passed': not issues, 'issues': issues, 'file': str(file), 'duration': round(dur, 2), 'width': v and v['width'], 'height': v and v['height'], 'fps': v and v['avg_frame_rate'],
              'videoCodec': v and v['codec_name'], 'audioCodec': a and a['codec_name'], 'loudnessLufs': float(loud['input_i']), 'truePeakDb': float(loud['input_tp']), 'audio': stems,
              'voice': timeline.get('voice'), 'finalSheet': str(out / 'final-sheet.jpg'),
              'note': 'These checks cannot judge drawing or comedy. Look at final-sheet.jpg (frames taken from the finished file) before handing over.'}
    (out / 'qa.json').write_text(json.dumps(result, indent=1), encoding='utf8'); (out / 'ffmpeg-qa.log').write_text(rep, encoding='utf8')
    print(json.dumps({k: result[k] for k in ('passed', 'issues', 'duration', 'width', 'height', 'fps', 'loudnessLufs', 'truePeakDb', 'finalSheet')}, indent=1))
    return result


def render(story_file, out, name):
    if not (out / 'timeline.json').exists(): raise SystemExit('Run `prepare` first: there is no voice timeline.')
    desc = describe(story_file); timeline = json.loads((out / 'timeline.json').read_text(encoding='utf-8-sig'))
    if timeline.get('speech') != speech_spec(desc):
        raise SystemExit('Narration, voice or pauses changed. Run `prepare`, then `stills` and review the new sheet.')
    sig = out / 'stills-signature.txt'
    if not sig.exists() or sig.read_text() != signature(story_file, out):
        raise SystemExit('The story, the drawing code or the timing changed since the last contact sheet. Run `stills` again and look at the new sheet before rendering.')
    audit = json.loads((out / 'audit.json').read_text(encoding='utf-8-sig'))
    if not audit.get('passed') or audit.get('draftTiming'):
        raise SystemExit('The picture gates have unresolved issues (see audit.json). Fix the drawing; do not edit the gates.')
    review = out / 'review.json'
    if not review.exists():
        raise SystemExit('Look at contact-sheet.jpg, then write review.json: {"inspected": true, "observations": "...what you actually saw, the weakest shot, what you fixed..."}')
    rv = json.loads(review.read_text(encoding='utf-8-sig'))
    if rv.get('sheetSignature') != sig.read_text():
        raise SystemExit('Review is not attached to this contact sheet. Inspect it and put stills-signature.txt into review.json as sheetSignature.')
    if not rv.get('inspected') or len(str(rv.get('observations', ''))) < 80:
        raise SystemExit('review.json must say inspected:true and describe what you saw in at least a few sentences.')
    r = subprocess.run([tool('node'), str(ROOT / 'render.mjs'), 'video', str(story_file), str(out)], env=dict(os.environ, FFMPEG=tool('ffmpeg')))
    if r.returncode: raise SystemExit(r.returncode)
    sounds(desc, timeline, out)
    return finish(out, name)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('stage', choices=['prepare', 'stills', 'render', 'qa', 'sound'])
    p.add_argument('story'); p.add_argument('shots', nargs='*', help='stills only: limit to these shot ids or numbers')
    p.add_argument('--out', default=None); p.add_argument('--voice'); p.add_argument('--timings'); p.add_argument('--name', default='film.mp4')
    a = p.parse_args()
    story_file = Path(a.story).resolve()
    if not story_file.exists(): raise SystemExit(f'No story file at {story_file}')
    out = Path(a.out).resolve() if a.out else story_file.parent / 'work'; out.mkdir(parents=True, exist_ok=True)
    if a.stage == 'prepare': prepare(story_file, out, a.voice, a.timings); return
    if a.stage == 'stills': stills(story_file, out, a.shots); return
    if a.stage == 'sound':                                      # rebuild only the mix (to audition music or effects)
        print(json.dumps(sounds(describe(story_file), json.loads((out / 'timeline.json').read_text(encoding='utf-8-sig')), out), indent=1)); return
    file = render(story_file, out, a.name) if a.stage == 'render' else out / a.name
    result = qa(story_file, out, file)
    if not result['passed']: raise SystemExit('The finished file needs attention (qa.json). Fix the cause and render again; do not loosen a check.')


if __name__ == '__main__':
    main()
