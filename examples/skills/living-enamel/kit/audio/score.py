"""Original seeded D-Dorian celesta score following arbitrary scene timelines."""
from common import *
tl = read_json(WORK / 'timeline.json')
n = round(tl['duration'] * SR)
rng = np.random.default_rng(722)
dry = np.zeros((n, 2))
beat = .6
last = tl['scenes'][-1]
tail = last['clauses'][-1]['end']
choke = tail
if (WORK / 'sfx_events.json').exists():
    shatters = [float(e.get('time', e.get('t'))) for e in read_json(WORK / 'sfx_events.json') if e['name'] == 'shatter']
    if shatters: choke = min(shatters)
motif = [0, 7, 10, 14, 9, 7, 2, 5]
for i, when in enumerate(np.arange(.12, choke, beat)):
    scene = next((s for s in tl['scenes'] if s['start'] <= when < s['end']), last)
    dense = any(c['start'] <= when <= c['end'] for c in scene['clauses'])
    if dense and i % 3 != 0: continue
    freq = 293.6648 * 2 ** (motif[(i + i // 8) % len(motif)] / 12)
    note = tone(freq) * (.055 if dense else .085)
    pan = .35 * np.sin(i * 1.7)
    add(dry, np.column_stack([note * np.sqrt((1-pan)/2), note * np.sqrt((1+pan)/2)]), when)
t = np.arange(n) / SR
pad = np.sin(2*np.pi*73.416*t) + .32*np.sin(2*np.pi*110*t + .3*np.sin(t*.4)) + .18*np.sin(2*np.pi*146.9*t)
pad *= .018 * (1 + .15*np.sin(t*.7)) * np.minimum(1, t/1.3) * np.clip((choke-t), 0, 1)
dry += pad[:, None] * np.array([1, .94])
for when in np.arange(0, choke, beat/2):
    tt = np.arange(round(.024*SR)) / SR
    noise = np.convolve(rng.normal(size=len(tt)), np.ones(9)/9, mode='same')
    tick = noise * np.exp(-tt/.003) * (1-np.exp(-tt/.0005)) * .014
    add(dry, np.column_stack([tick, tick*.8]), when)
wet = np.zeros_like(dry)
for delay, gain in [(.047, .13), (.083, .10), (.137, .08), (.211, .055), (.337, .035), (.503, .02)]:
    offset = round(delay * SR)
    if offset < n: wet[offset:] += dry[:-offset, ::-1] * gain
music = (dry + wet) * np.clip((choke-t)/.08, 0, 1)[:, None]
for when, freq, gain in [(tail+.12, 587.33, .09), (tail+.45, 880, .075), (tail+.78, 1174.66, .065)]:
    note = tone(freq, 1.1) * gain
    add(music, np.column_stack([note*.8, note]), when)
fade = min(2400, n)
music[-fade:] *= np.linspace(1, 0, fade)[:, None]
write(WORK / 'music.wav', music)
print('music', len(music)/SR)
