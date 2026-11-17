"""Voice-first offline mix: BS.1770 K-weighted 100/400ms balance, not peak matching.

Every bus is measured in stereo and mono fold-down; LUFS/true peak use FFmpeg.
This is a measurable balance contract, not a listening or intelligibility claim.
"""
import argparse
import hashlib
import os
import re
import subprocess
from common import *

TARGET_I, PCM_TP = -14., -2.
MUSIC_SPEECH, FX_SPEECH, BACKGROUND_SPEECH = 18., 12., 10.
MUSIC_GAP, FX_GAP = 12., 6.
OPENING_GUARD_DB = 6.         # calibrated: unprompted ASR restores "History's"
HOP, WINDOWS, ACTIVITY_RANGE = 480, (10, 40), 35.
K_FILTER = ('biquad=b0=1.53512485958697:b1=-2.69169618940638:b2=1.19839281085285:'
            'a0=1:a1=-1.69065929318241:a2=0.73248077421585,'
            'biquad=b0=1:b1=-2:b2=1:a0=1:a1=-1.99004745483398:a2=0.99007225036621')


def ff(args, data=None):
    cfg = read_json(ROOT/'config.json') if (ROOT/'config.json').exists() else {}
    proc = subprocess.run([cfg.get('ffmpeg', 'ffmpeg'), '-hide_banner', '-nostdin',
                           '-threads', '1', *map(str, args)], input=data, capture_output=True)
    if proc.returncode: raise RuntimeError(proc.stderr.decode(errors='replace'))
    return proc


def measure(path, target=-14., tp=-2.):
    log = ff(['-i', path, '-af', f'loudnorm=I={target}:TP={tp}:LRA=7:print_format=json',
              '-f', 'null', '-']).stderr.decode()
    return json.loads(re.findall(r'\{[^{}]*"input_i"[^{}]*\}', log, re.S)[-1])


def stereo(x):
    if x.ndim == 1: return np.repeat(x[:, None], 2, axis=1)
    if x.ndim == 2 and x.shape[1] in (1, 2):
        return np.repeat(x, 2, axis=1) if x.shape[1] == 1 else x
    raise ValueError('Use mono or stereo stems.')


def load(path):
    x, rate = sf.read(path)
    if rate != SR or not len(x) or not np.isfinite(x).all():
        raise ValueError(f'Expected finite, nonempty {SR} Hz audio: {path}')
    return stereo(x)


def floating(path, x):
    # Preserve headroom into processing; PCM intermediates would clip at +/-1.
    sf.write(path, x, SR, subtype='FLOAT')


def db(power): return 10*np.log10(np.maximum(power, 1e-30))


def k_blocks(x, mono=False):
    if mono: x = np.mean(x, axis=1, keepdims=True)
    channels = x.shape[1]
    raw = ff(['-f', 'f64le', '-ar', SR, '-ac', channels, '-i', 'pipe:0',
              '-af', K_FILTER, '-f', 'f64le', 'pipe:1'], np.asarray(x, dtype='<f8').tobytes()).stdout
    y = np.frombuffer(raw, dtype='<f8').reshape(-1, channels)
    energy = np.sum(y*y, axis=1)
    starts = np.arange(0, len(y), HOP)
    return np.add.reduceat(energy, starts)/np.minimum(HOP, len(y)-starts)


def windows(blocks, width):
    sums = np.r_[0., np.cumsum(blocks)]
    ends = np.minimum(np.arange(len(blocks))+width, len(blocks))
    return (sums[ends]-sums[:-1])/(ends-np.arange(len(blocks)))


def spread_min(gain, past, future):
    result = gain.copy()
    for shift in range(-past, future+1):
        result = np.minimum(result, gain[np.clip(np.arange(len(gain))+shift, 0, len(gain)-1)])
    return result


def sample_gain(block_gain, length):
    # Interpolation never rises above either neighbouring ceiling.
    safe = np.minimum(block_gain, np.r_[block_gain[1:], block_gain[-1]])
    return np.interp(np.arange(length)/HOP, np.arange(len(safe)), safe)


def ceiling(x, voice, reference, speech_margin, gap_margin, speech):
    """Limit the summed bus, not individual event peaks; anticipate every phrase.

    Apply each window's limit to every sample it covers. Re-measure afterwards:
    gain modulation changes K-filter state, so detector math alone is not proof.
    """
    count = (len(x)+HOP-1)//HOP
    gains = np.ones(count)
    for mono in (False, True):
        vb, xb = k_blocks(voice, mono), k_blocks(x, mono)
        ref = reference-(3.0103 if mono else 0.)
        ref_power = 10**((ref+.691)/10)
        for width in WINDOWS:
            vp, xp = windows(vb, width), windows(xb, width)
            active = vp > ref_power*10**(-ACTIVITY_RANGE/10)
            allowance = np.full(count, ref_power*10**(-(gap_margin+.5)/10))
            allowance[speech] = ref_power*10**(-(speech_margin+.5)/10)
            allowance[active] = np.minimum(allowance[active], vp[active]*10**(-(speech_margin+.5)/10))
            limits = np.minimum(1., np.sqrt(allowance/np.maximum(xp, 1e-30)))
            for offset in range(min(width, count)):
                gains[offset:] = np.minimum(gains[offset:], limits[:count-offset])
    gains = spread_min(gains, 20, 8)  # 80ms anticipation, 200ms hold/release
    smooth = np.convolve(np.pad(gains, (3, 3), mode='edge'), np.ones(7)/7, mode='valid')
    gains = np.minimum(gains, smooth)
    return x*sample_gain(gains, len(x))[:, None], float(db(max(gains.min(), 1e-15)**2))


def balance(voice, background, reference, records=()):
    result = {}
    for mono in (False, True):
        vb, bb = k_blocks(voice, mono), k_blocks(background, mono)
        ref = reference-(3.0103 if mono else 0.)
        active_blocks = vb > 10**((ref+.691-ACTIVITY_RANGE)/10)
        overall = float(db(vb[active_blocks].sum()/max(bb[active_blocks].sum(), 1e-30)))
        worst = None
        for width in WINDOWS:
            vp, bp = windows(vb, width), windows(bb, width)
            candidates = np.flatnonzero(vp > 10**((ref+.691-ACTIVITY_RANGE)/10))
            if not len(candidates): raise ValueError('No measurable speech in narration.')
            margins = db(vp/np.maximum(bp, 1e-30))
            index = int(candidates[np.argmin(margins[candidates])])
            item = dict(margin_lu=float(margins[index]), start_s=index*.01,
                        end_s=min(len(voice)/SR, (index+width)*.01), window_ms=width*10)
            if worst is None or item['margin_lu'] < worst['margin_lu']: worst = item
        worst['events'] = [r for r in records if r.get('gain', 1) > 0
                           and r['time_s'] < worst['end_s'] and r['end_s'] > worst['start_s']]
        result['mono' if mono else 'stereo'] = dict(overall_margin_lu=overall, worst=worst)
    return result


def phrase_mask(tl, voice, reference):
    count = (len(voice)+HOP-1)//HOP
    speech = np.zeros(count, bool)
    for scene in tl['scenes']:
        for clause in scene['clauses']:
            a = max(0, int(float(clause['start'])*100)-8)
            b = min(count, int(np.ceil(float(clause['end'])*100))+20)
            speech[a:b] = True
    activity = k_blocks(voice) > 10**((reference+.691-ACTIVITY_RANGE)/10)
    return speech | (spread_min((~activity).astype(float), 20, 8) == 0)


def opening_guard(tl, length):
    """Extra clearance for the first word, never a project-specific bed mute."""
    first = min((c for s in tl['scenes'] for c in s['clauses']), key=lambda c: c['start'])
    # Caption estimates can end early. Extend by the same 80ms phrase lookahead.
    # Without word timings protect the whole first clause, rather than guess.
    end = float(first['words'][0]['end'] if first.get('words') else first['end'])+.08
    u = np.clip((np.arange(length)/SR-end)/.2, 0, 1)
    u = u*u*(3-2*u)
    low = 10**(-OPENING_GUARD_DB/20)
    return low+(1-low)*u, dict(reduction_db=OPENING_GUARD_DB, hold_until_s=end, release_s=.2,
                               muted=False, timing='first timeline word; first clause if words absent')


def voice_stem():
    voice = load(WORK/'narration.wav')
    # Keep narration centred and mono-compatible even if a local engine returns
    # stereo. All speech reference offsets below assume this centred anchor.
    voice = np.repeat(np.mean(voice, axis=1, keepdims=True), 2, axis=1)
    peak = float(np.max(np.abs(voice)))
    if peak < 1e-15: raise ValueError('Narration is silent; prepare a usable voice stem.')
    # Condition only the analysis/input level so very quiet local engines do
    # not fall below BS.1770's absolute gate. This is not peak-based balance.
    preamp = .5/peak
    floating(WORK/'voice-input.wav', voice*preamp)
    initial = measure(WORK/'voice-input.wav')
    level = float(initial['input_i'])
    if not np.isfinite(level): raise ValueError('Narration is silent; prepare a usable voice stem.')
    initial['analysis_preamp_db'] = float(20*np.log10(preamp))
    for key in ('input_i', 'input_tp', 'input_thresh'):
        initial[key] = f"{float(initial[key])-initial['analysis_preamp_db']:.2f}"
    # Level BEFORE gentle compression so different engines hit the same threshold.
    # No gate or opening fade that could remove the first consonant.
    filters = (f'volume={-18-level:.6f}dB,highpass=f=65,'
               'acompressor=threshold=0.125:ratio=2:attack=8:release=120:makeup=1')
    ff(['-y', '-i', WORK/'voice-input.wav', '-af', filters, '-c:a', 'pcm_f32le', WORK/'voice-shaped.wav'])
    first = measure(WORK/'voice-shaped.wav', -14.2, -2.5)
    if not np.isfinite(float(first['input_i'])):
        raise ValueError('No usable voice energy after the narration high-pass; check the source.')
    base = 'loudnorm=I=-14.2:TP=-2.5:LRA=7'
    params = ':'.join(f'{key}={first[value]}' for key, value in (
        ('measured_I','input_i'), ('measured_TP','input_tp'), ('measured_LRA','input_lra'),
        ('measured_thresh','input_thresh'), ('offset','target_offset')))
    ff(['-y', '-i', WORK/'voice-shaped.wav', '-af', base+':'+params+':linear=true',
        '-ar', SR, '-c:a', 'pcm_f32le', WORK/'voice-leveled.wav'])
    return load(WORK/'voice-leveled.wav'), initial


def loop_texture(x, length, crossfade=.25):
    """Overlap-add recorded textures with complementary joins, never hard tile."""
    overlap = min(round(crossfade*SR), len(x)//4)
    if overlap < 2: raise ValueError('Ambience source is too short to crossfade.')
    step = len(x)-overlap
    result = np.zeros((length, 2))
    ramp = np.linspace(0., 1., overlap)
    # The first source's end and the next source's start sum to unity in overlap.
    for at in range(0, length, step):
        n = min(len(x), length-at)
        chunk = x[:n].copy()
        if at: chunk[:min(overlap, n)] *= ramp[:min(overlap, n), None]
        if n == len(x): chunk[-overlap:] *= (1-ramp)[:, None]
        result[at:at+n] += chunk
    return result


def effects(voice_reference, length, events):
    fx = np.zeros((length, 2))
    cache, counts, records, clamped = {}, {}, [], []
    for index, event in enumerate(events):
        name = event.get('name', '')
        at = float(event.get('time', event.get('t', -1)))
        requested = float(event.get('gain', 1))
        if not re.fullmatch(r'[a-z]+', name) or not np.isfinite(at) or not 0 <= at <= length/SR:
            raise ValueError(f'Invalid effect #{index}: {event}')
        if not np.isfinite(requested): raise ValueError(f'Nonfinite gain at {at:.3f}s ({name}).')
        gain = float(np.clip(requested, 0, 1))
        if gain != requested:
            clamped.append(dict(event_index=index, time_s=at, name=name, requested=requested, applied=gain))
        kind = event.get('kind', 'effect')
        if kind not in ('effect', 'ambience'): raise ValueError(f'Unknown sound kind: {kind}')
        key = (kind, name)
        if key not in cache:
            base = WORK/('ambience' if kind == 'ambience' else 'sfx')/f'{name}.wav'
            variants = [base]+sorted((p for p in base.parent.glob(f'{name}-*.wav')
                if re.fullmatch(re.escape(name)+r'-(?:[2-9]|[1-9][0-9]+)\.wav', p.name)),
                key=lambda p: int(p.stem.split('-')[-1]))
            cache[key] = []
            for path in variants:
                x = load(path)
                # Strongest 100ms K-energy, not peak or silence-padded file LUFS.
                power = float(windows(k_blocks(x), 10).max())
                if power < 1e-20: raise ValueError(f'Silent effect: {path}')
                level = -.691+float(db(power))
                # Beds start 22 LU below the voice reference; the summed effects
                # and background ceilings below still protect every consonant.
                margin = 22. if kind == 'ambience' else FX_GAP
                cache[key].append((path.name, x*10**((voice_reference-margin-level)/20), level))
        ordinal = counts.get(key, 0)
        variant, x, original_level = cache[key][ordinal % len(cache[key])]
        counts[key] = ordinal+1
        extra = {}
        if kind == 'ambience':
            duration, fade = float(event['duration']), float(event.get('fade', .25))
            if not np.isfinite([duration, fade]).all() or duration <= 0 or fade < 0 or at+duration > length/SR+.001:
                raise ValueError(f'Invalid ambience range #{index}: {event}')
            fade = min(fade, duration/2)
            # Adjacent declared ranges overlap across their boundary, making a
            # crossfade instead of a dip to digital silence at every shot cut.
            lo, hi = max(0., at-fade/2), min(length/SR, at+duration+fade/2)
            n = round(hi*SR)-round(lo*SR)
            bed = loop_texture(x, n)
            nf = min(round(fade*SR), n//2)
            if nf:
                ramp = np.linspace(0., 1., nf)
                bed[:nf] *= ramp[:, None]; bed[-nf:] *= ramp[::-1, None]
            add(fx, bed, lo, gain)
            extra = dict(kind=kind, declared_start_s=at, declared_end_s=at+duration,
                         duration_s=duration, fade_s=fade, loop_crossfade_s=.25)
            at, event_end = lo, hi
        else:
            add(fx, x, at, gain)
            event_end = min(length/SR, at+len(x)/SR)
        records.append(dict(event_index=index, name=name, variant=variant, time_s=at,
                            end_s=event_end, gain=gain,
                            source_max_100ms_lkfs=original_level, **extra))
    return fx, records, clamped


def peak_limit(voice, music, fx):
    """Shared gain preserves the measurable contribution of every master stem."""
    total = voice+music+fx
    peak = np.max(np.abs(total), axis=1)
    peaks = np.maximum.reduceat(peak, np.arange(0, len(total), HOP))
    gain = np.minimum(1., 10**((PCM_TP-.3)/20)/np.maximum(peaks, 1e-30))
    gain = spread_min(gain, 8, 2)  # 20ms lookahead / 80ms hold
    smooth = np.convolve(np.pad(gain, (2, 2), mode='edge'), np.ones(5)/5, mode='valid')
    envelope = sample_gain(np.minimum(gain, smooth), len(total))[:, None]
    return voice*envelope, music*envelope, fx*envelope


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as file:
        for chunk in iter(lambda: file.read(1024*1024), b''): digest.update(chunk)
    return digest.hexdigest()


def build(override=None):
    report = dict(version='voice-first-v2-ambience', passed=False, override_reason=override,
                  measured_not_listened=True, errors=[], clamped_gains=[])
    try:
        tl = read_json(WORK/'timeline.json')
        if not (WORK/'sfx_events.json').exists():
            raise ValueError('Export actual scene sound cues first: python film.py events story.py')
        events = read_json(WORK/'sfx_events.json')
        voice, original = voice_stem()
        reference = float(measure(WORK/'voice-leveled.wav')['input_i'])
        music = load(WORK/'music.wav')
        if len(music) != len(voice): raise ValueError('Music and narration lengths differ; rebuild the score.')
        fx, records, clamped = effects(reference, len(voice), events)
        report.update(clamped_gains=clamped, events=records)
        speech = phrase_mask(tl, voice, reference)
        music_level = -.691+float(db(windows(k_blocks(music), 40).max()))
        music *= min(1e6, 10**((reference-MUSIC_GAP-music_level)/20))
        music, music_reduction = ceiling(music, voice, reference, MUSIC_SPEECH, MUSIC_GAP, speech)
        fx, fx_reduction = ceiling(fx, voice, reference, FX_SPEECH, FX_GAP, speech)
        background = music+fx
        limited, bus_reduction = ceiling(background, voice, reference, BACKGROUND_SPEECH, 5., speech)
        denom = np.sum(background*background, axis=1)
        bus_gain = np.divide(np.sum(limited*background, axis=1), denom,
                             out=np.ones(len(voice)), where=denom>1e-30)
        music *= bus_gain[:, None]; fx *= bus_gain[:, None]
        opening_gain, opening = opening_guard(tl, len(voice))
        music *= opening_gain[:, None]; fx *= opening_gain[:, None]
        report['opening_guard'] = opening
        # Master with explicitly retained shared gains, never an untraceable
        # nonlinear whole-mix loudnorm that spends the voice's loudness budget.
        for attempt in range(8):
            voice, music, fx = peak_limit(voice, music, fx)
            floating(WORK/'master-candidate.wav', voice+music+fx)
            measured = measure(WORK/'master-candidate.wav')
            adjustment = TARGET_I-float(measured['input_i'])
            if abs(adjustment) <= .05: break
            gain = 10**(adjustment/20)
            voice *= gain; music *= gain; fx *= gain
        # If the iteration limit was reached, the last upward adjustment must
        # still go through the limiter before measuring/writing PCM.
        voice, music, fx = peak_limit(voice, music, fx)
        # Measure the actual post-master buses independently. Quiet consonants,
        # filtering and mastering can invalidate the original detector ceiling.
        for attempt in range(4):
            floating(WORK/'voice-in-master.wav', voice)
            final_voice = measure(WORK/'voice-in-master.wav')
            reference = float(final_voice['input_i'])
            b = balance(voice, music+fx, reference, records)
            mb, fb = balance(voice, music, reference), balance(voice, fx, reference)
            deficits = [BACKGROUND_SPEECH-min(v['worst']['margin_lu'] for v in b.values()),
                        MUSIC_SPEECH-min(v['worst']['margin_lu'] for v in mb.values()),
                        FX_SPEECH-min(v['worst']['margin_lu'] for v in fb.values())]
            if max(deficits) <= 0 or attempt == 3: break
            gain = 10**(-(max(deficits)+.3)/20)
            music *= gain; fx *= gain
        write(WORK/'mix-candidate.wav', voice+music+fx)
        final = measure(WORK/'mix-candidate.wav')
        # Match the renderer's default stereo AAC rate (128 kb/s).
        ff(['-y', '-i', WORK/'mix-candidate.wav', '-c:a', 'aac', '-b:a', '128k', WORK/'mix-aac-check.m4a'])
        encoded = measure(WORK/'mix-aac-check.m4a')
        worst_mode, worst = min(b.items(), key=lambda kv: kv[1]['worst']['margin_lu'])
        moment = worst['worst']
        causes = ', '.join(f"{e['name']}#{e['event_index']}@{e['time_s']:.3f}s" for e in moment['events']) or 'music bed'
        where = f"{moment['start_s']:.2f}-{moment['end_s']:.2f}s ({worst_mode}; {causes})"
        for label, measured_balance, required in [('combined background', b, BACKGROUND_SPEECH),
                ('music', mb, MUSIC_SPEECH), ('effects', fb, FX_SPEECH)]:
            mode, values = min(measured_balance.items(), key=lambda kv: kv[1]['worst']['margin_lu'])
            bad = values['worst']
            if bad['margin_lu'] < required-.05:
                causes = [f"{e['name']}#{e['event_index']}@{e['time_s']:.3f}s" for e in records
                          if e['time_s'] < bad['end_s'] and e['end_s'] > bad['start_s']]
                report['errors'].append(f"{label} margin {bad['margin_lu']:.2f} < {required} LU at "
                    f"{bad['start_s']:.2f}-{bad['end_s']:.2f}s ({mode}; {', '.join(causes) or 'music bed'}).")
        peak_time = float(np.argmax(np.max(np.abs(voice+music+fx), axis=1))/SR)
        if abs(float(final['input_i'])-TARGET_I) > .3:
            report['errors'].append(f'Master is {final["input_i"]} LUFS; target -14 +/-0.3. Largest sample peak at {peak_time:.3f}s.')
        if abs(float(final_voice['input_i'])-float(final['input_i'])) > .5:
            report['errors'].append(f'Voice does not account for master loudness (voice {final_voice["input_i"]}, mix {final["input_i"]} LUFS); inspect {where}.')
        if float(final['input_tp']) > PCM_TP or float(encoded['input_tp']) > -.8:
            report['errors'].append(f'True peak failed (PCM {final["input_tp"]}, AAC {encoded["input_tp"]} dBTP); largest sample peak at {peak_time:.3f}s.')
        report.update(targets=dict(master_lufs=TARGET_I, pcm_dbtp=PCM_TP, aac_dbtp=-.8,
            music_speech_lu=MUSIC_SPEECH, effects_speech_lu=FX_SPEECH, combined_speech_lu=BACKGROUND_SPEECH,
            music_gap_lu=MUSIC_GAP, effects_gap_lu=FX_GAP, gain_range=[0, 1]),
            method=dict(weighting='BS.1770 K', windows_ms=[100, 400], hop_ms=10,
                activity_floor_lu_below_voice=ACTIVITY_RANGE, modes=['stereo', 'mono fold-down'],
                preroll_ms=80, hold_ms=200, safety_lu=.5),
            original_voice=original, voice_in_master=final_voice, final=final, aac_check=encoded,
            largest_sample_peak_s=peak_time,
            background_under_speech=b, music_under_speech=mb, effects_under_speech=fb,
            maximum_bus_reduction_db=dict(music=music_reduction, effects=fx_reduction, combined=bus_reduction))
        report['passed'] = not report['errors']
        report['waived'] = bool(override and report['errors'])
        if report['passed'] or override:
            os.replace(WORK/'mix-candidate.wav', WORK/'mix.wav')
            write(WORK/'voice-in-master.wav', voice)
            write(WORK/'music-in-master.wav', music)
            write(WORK/'effects-in-master.wav', fx)
            report['mix_sha256'] = sha256(WORK/'mix.wav')
            report['input_sha256'] = {str(p.relative_to(WORK)): sha256(p) for p in
                [WORK/'narration.wav', WORK/'music.wav', WORK/'timeline.json', WORK/'sfx_events.json',
                 *sorted((WORK/'sfx').glob('*.wav')), *sorted((WORK/'ambience').glob('*.wav')),
                 *([WORK/'sound-shots.json'] if (WORK/'sound-shots.json').exists() else [])]}
            save_json(WORK/'loudness.json', dict(final=final, voice=final_voice, aac_check=encoded))
    except (ValueError, RuntimeError, OSError, KeyError, TypeError, IndexError) as error:
        report['passed'] = False
        report['waived'] = False
        report['errors'].append(str(error))
    save_json(WORK/'balance-report.json', report)
    if not report['passed'] and not report.get('waived'):
        raise SystemExit('Mix rejected: '+' '.join(report['errors'])+
                         ' See work/balance-report.json. For a deliberate exception: film.py mix --allow-balance-override "reason"')
    print(json.dumps({k: report[k] for k in ('passed','override_reason','errors','clamped_gains')}, indent=2))
    print('Voice', report['voice_in_master']['input_i'], 'LUFS; master', report['final']['input_i'],
          'LUFS; worst background margin', f"{moment['margin_lu']:.2f}", 'LU at', where)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-balance-override', metavar='REASON')
    args = parser.parse_args()
    if args.allow_balance_override is not None and not args.allow_balance_override.strip():
        parser.error('Supply a nonempty reason for the balance override.')
    build(args.allow_balance_override)
