"""Local Kokoro narration with explicit pauses and estimated caption word timings."""
import os
os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('OMP_NUM_THREADS', '4')
import argparse, hashlib, re
from common import *
from gemini_tts import synthesize, selected_voice, MODEL

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--script', default=str(ROOT / 'example/script.json'))
parser.add_argument('--voice')
parser.add_argument('--engine', choices=['kokoro', 'gemini'])
parser.add_argument('--gemini-voice')
parser.add_argument('--style', help='Delivery direction, not spoken text')
parser.add_argument('--speed', type=float)
parser.add_argument('--feed-short', action='store_true', help='Use feed lead/gap/tail defaults; cut words to fit the measured voice, never stretch it')
parser.add_argument('--profile', choices=['feed', 'story'], help='Explicit Short profile stored with the prepared narration')
args = parser.parse_args()
source = read_json(args.script)
profile = args.profile or source.get('profile')
if profile is not None and profile not in {'feed', 'story'}:
    raise ValueError('Choose profile feed or story.')
feed_short = args.feed_short or source.get('feed_short', False) or profile in {'feed', 'story'}
if profile is None and feed_short: profile = 'feed'
script = source['scenes']
if not script or len({s['id'] for s in script}) != len(script):
    raise ValueError('Use at least one scene and unique scene IDs.')
engine = args.engine or source.get('engine', 'kokoro')
if engine not in {'kokoro', 'gemini'}: raise SystemExit('Choose kokoro or gemini narration.')
voice = args.voice or source.get('voice', 'bm_george')
gemini_voice = selected_voice(args.gemini_voice or source.get('gemini_voice')) if engine == 'gemini' else None
style = args.style if args.style is not None else source.get('style', '')
speed = args.speed if args.speed is not None else float(source.get('speed', 1.05))
if not .6 <= speed <= 1.6: raise ValueError('Speech speed must be .6..1.6.')
cfg = read_json(ROOT / 'config.json') if (ROOT / 'config.json').exists() else {}
model = Path(cfg.get('voiceCache', os.environ.get('MOCO_VOICE_CACHE', str(Path.home() / '.cache/moco-ink-history'))))
k = None
if engine == 'kokoro':
    from kokoro_onnx import Kokoro
    k = Kokoro(str(model / 'kokoro-v1.0.onnx'), str(model / 'voices-v1.0.bin'))
cache = WORK / 'voice_cache'
cache.mkdir(exist_ok=True)

def synth(text):
    identity = [text, voice, speed, 'living-enamel-trim-v1'] if engine == 'kokoro' else [text, MODEL, gemini_voice, style, 'living-enamel-gemini-trim-v1', hashlib.sha256(Path(__file__).with_name('gemini_tts.py').read_bytes()).hexdigest()]
    key = hashlib.sha256(json.dumps(identity).encode()).hexdigest()
    filename = cache / (key + '.wav')
    if filename.exists(): return sf.read(filename)[0]
    if engine == 'gemini':
        raw = filename.with_suffix('.raw.wav')
        try:
            synthesize(text, raw, gemini_voice, style)
            x, rate = sf.read(raw)
        finally:
            raw.unlink(missing_ok=True)
    else:
        x, rate = k.create(text, voice=voice, speed=speed, lang=source.get('lang', 'en-gb'))
    x = np.asarray(x)
    hop = max(1, round(rate * .01))
    env = np.array([np.sqrt(np.mean(x[i:i+hop] ** 2)) for i in range(0, len(x), hop)])
    active = np.flatnonzero(env > max(.002, env.max() * .018))
    if not len(active): raise ValueError('Silent synthesis: ' + text)
    x = x[max(0, active[0] * hop - round(.025 * rate)):min(len(x), active[-1] * hop + hop + round(.045 * rate))]
    x = np.interp(np.arange(round(len(x) * SR / rate)) * rate / SR, np.arange(len(x)), x)
    fade = min(240, len(x) // 2)
    x[:fade] *= np.linspace(0, 1, fade)
    x[-fade:] *= np.linspace(1, 0, fade)
    write(filename, x)
    return x

scenes, clips = [], []
cursor = float(source.get('lead', .04 if feed_short else .25))
max_lead = .5 if profile == 'story' else .1
if cursor < 0 or (feed_short and cursor > max_lead):
    raise ValueError(f'lead must be nonnegative; a {profile} Short starts narration within {max_lead}s.')
for si, original in enumerate(script):
    if not original.get('clauses'): raise ValueError('Scene has no clauses: ' + original['id'])
    scene = {'id': original['id'], 'start': 0., 'end': 0., 'clauses': []}
    for ci, clause in enumerate(original['clauses']):
        spoken = clause['spoken'].strip()
        text = clause.get('text', spoken).strip()
        if not spoken or not text: raise ValueError('Narration and caption text must be nonempty.')
        x = synth(spoken)
        end = cursor + len(x) / SR
        tokens = text.upper().split()
        weights = np.array([max(1, len(re.findall(r'[AEIOUY]+', w))) + (.4 if w[-1:] in ',;:' else .12) for w in tokens])
        bounds = cursor + np.r_[0, np.cumsum(weights) / weights.sum()] * (end - cursor)
        words = [{'w': word, 'start': round(float(bounds[i]), 4), 'end': round(float(bounds[i+1]), 4)} for i, word in enumerate(tokens)]
        scene['clauses'].append({'text': text, 'spoken': spoken, 'start': round(cursor, 4), 'end': round(end, 4), 'words': words})
        clips.append((cursor, x))
        pause = clause.get('pause_after', source.get('scene_gap', .12 if feed_short else .36) if ci == len(original['clauses']) - 1 else source.get('clause_gap', .08 if feed_short else .16))
        if float(pause) < 0: raise ValueError('Pauses must be nonnegative.')
        cursor = end + float(pause)
    scenes.append(scene)
duration = clips[-1][0] + len(clips[-1][1]) / SR + float(source.get('end_hold', .08 if feed_short else 1.4))
if duration <= clips[-1][0] + len(clips[-1][1]) / SR: raise ValueError('end_hold must be positive.')
out = np.zeros(round(duration * SR))
duration = len(out) / SR
for i, scene in enumerate(scenes):
    scene['start'] = scenes[i-1]['end'] if i else 0.
    scene['end'] = round((scene['clauses'][-1]['end'] + scenes[i+1]['clauses'][0]['start']) / 2, 4) if i+1 < len(scenes) else duration
for at, clip in clips: add(out, clip, at)
write(WORK / 'narration.wav', unit(out, .72))
timeline = {'duration': duration, 'scenes': scenes}
if profile is not None: timeline['profile'] = profile
save_json(WORK / 'timeline.json', timeline)
save_json(WORK / 'voice_selection.json', {'engine': engine, 'voice': gemini_voice if engine == 'gemini' else voice, 'speed': None if engine == 'gemini' else speed, 'duration': duration, 'word_timing': 'Estimated from display token weights, not forced alignment.'})
print(json.dumps({'engine': engine, 'voice': gemini_voice if engine == 'gemini' else voice, 'speed': None if engine == 'gemini' else speed, 'duration': duration}), flush=True)
