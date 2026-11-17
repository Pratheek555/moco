"""Portable narration, sound-event collection, mix and encoded-video verification."""
from pathlib import Path
import argparse, hashlib, json, os, re, subprocess, sys
ROOT = Path(__file__).resolve().parent
WORK = ROOT / 'work'
WORK.mkdir(exist_ok=True)

def config():
    path = ROOT / 'config.json'
    return json.loads(path.read_text(encoding='utf-8-sig')) if path.exists() else {}

def run_audio(name, *args):
    subprocess.run([sys.executable, str(ROOT / 'audio' / name), *map(str, args)], cwd=ROOT, check=True)

def events(story):
    from gilt.__main__ import load
    from gilt import Painter, Format
    from gilt.engine import Context
    film = load(str(Path(story).resolve())).film
    found = []
    for source in film.events:
        event = dict(source, time=float(source.get('time', source.get('t'))))
        event.pop('t', None)
        found.append(event)
    for shot in film.shots:
        # Sound declarations are unconditional; collect once without shading pixels.
        painter = Painter(Format('portrait', .1), shot.start)
        shot.draw(painter, 0., Context(shot, painter.format))
        for e in painter.events:
            event = dict(e, time=float(e['time']) + shot.start)
            if event not in found: found.append(event)
    found.sort(key=lambda e: e['time'])
    if any(not 0 <= e['time'] <= film.duration for e in found):
        raise ValueError('Sound event lies outside the film.')
    if any(e.get('kind') == 'ambience' and (e['duration'] <= 0 or e['time']+e['duration'] > film.duration+.001) for e in found):
        raise ValueError('Ambience range lies outside the film.')
    (WORK / 'sfx_events.json').write_text(json.dumps(found, indent=2), encoding='utf-8')
    scenes = [dict(id=s.id, start=s.start, end=s.end) for s in film.shots]
    (WORK / 'sound-shots.json').write_text(json.dumps(scenes, indent=2), encoding='utf-8')
    print(f'{sum(e.get("kind") != "ambience" for e in found)} one-shots; '
          f'{sum(e.get("kind") == "ambience" for e in found)} ambience ranges; film duration {film.duration:.3f}s')
    sound_coverage(scenes, found)

def picture_change(file, fps, duration, scenes=None, sample_until=None):
    """Measure local displacement/state change, not narrative meaning, in encoded frames."""
    import cv2
    import numpy as np
    from PIL import Image, ImageDraw
    cv2.setNumThreads(1)

    def prepare(frame):
        h, w = frame.shape[:2]
        frame = cv2.resize(frame, (round(w*480/max(w, h)), round(h*480/max(w, h))), interpolation=cv2.INTER_AREA)
        h, w = frame.shape[:2]
        mask = np.zeros((h, w), np.uint8)
        mask[round(.04*h):round((.90 if h > w else .84)*h), round(.05*w):round(.95*w)] = 255
        # Include the new two-line phone band and legacy camera-caption clearance.
        if h > w: mask[round(.64*h):round(.84*h)] = 0
        # Also exclude caption-like oxblood plaques displaced by a shot camera.
        # Require pale type as well as a wide red rectangle to spare red subjects.
        b, g, r = cv2.split(frame.astype(np.float32))
        red = ((r > g*1.5) & (r > b*1.3) & (r-g > 30)).astype(np.uint8)
        red = cv2.morphologyEx(red, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        contours, _ = cv2.findContours(red, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            x, y, cw, ch = cv2.boundingRect(contour)
            if cw > w*.22 and cw > 2.5*ch and h*.015 < ch < h*.16 and y > h*.30:
                roi = frame[y:y+ch, x:x+cw].astype(np.int16)
                letters = (np.max(abs(roi-np.array([238, 243, 247])), axis=2) < 24) | (np.max(abs(roi-np.array([160, 228, 255])), axis=2) < 24)
                if letters.mean() > .06:
                    # Keep tracking windows clear too, not just their centres.
                    mask[max(0, y-24):min(h, y+ch+24), max(0, x-24):min(w, x+cw+24)] = 0
        # Normalized RGB suppresses changes in light intensity; retain colour edges.
        def chroma(size):
            im = cv2.GaussianBlur(frame, (size, size), 0).astype(np.float32)
            return im / np.maximum(im.sum(axis=2, keepdims=True), 30) * 255
        return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), np.round(chroma(3)).astype(np.uint8), chroma(5), mask

    def compare(a, b):
        grey, colour, state, mask_a = a
        _, colour_b, state_b, mask_b = b
        h, w = grey.shape
        mask = cv2.bitwise_and(mask_a, mask_b)
        # Mask the tracking pyramid's pixels as well as corner centres: changing
        # words otherwise pull nearby background tracks outside the caption box.
        colour, colour_b = colour.copy(), colour_b.copy()
        colour[mask == 0] = 85
        colour_b[mask == 0] = 85
        matrix = np.eye(2, 3, dtype=np.float32)
        support = np.zeros((h, w), np.uint8)
        points = cv2.goodFeaturesToTrack(grey, 1000, .02, 5, mask=mask, blockSize=5)
        moving_count, registered = 0, False
        if points is not None:
            dest, status, error = cv2.calcOpticalFlowPyrLK(colour, colour_b, points, None, winSize=(15, 15), maxLevel=3)
            if dest is not None:
                back, status_b, _ = cv2.calcOpticalFlowPyrLK(colour_b, colour, dest, None, winSize=(15, 15), maxLevel=3)
                if back is not None:
                    good = (status.ravel() > 0) & (status_b.ravel() > 0) & (np.linalg.norm(points-back, axis=2).ravel() < .5) & (error.ravel() < 15)
                    q = dest.reshape(-1, 2)
                    good &= (q[:, 0] >= 0) & (q[:, 0] < w) & (q[:, 1] >= 0) & (q[:, 1] < h)
                    good &= mask[np.clip(q[:, 1].astype(int), 0, h-1), np.clip(q[:, 0].astype(int), 0, w-1)] > 0
                    if good.sum() >= 12:
                        fit, inliers = cv2.estimateAffinePartial2D(points[good], dest[good], method=cv2.RANSAC, ransacReprojThreshold=.5, maxIters=1000)
                        if fit is not None and np.isfinite(fit).all() and inliers.sum() >= good.sum()*.5:
                            matrix, registered = fit, True
                    predicted = cv2.transform(points, matrix)
                    moving = good & (np.linalg.norm(dest-predicted, axis=2).ravel() > 1.5)
                    moving_count = int(moving.sum())
                    # Union of small feature neighbourhoods: support, not object area.
                    for point in points[moving].reshape(-1, 2):
                        cv2.circle(support, tuple(np.round(point).astype(int)), 6, 1, -1)
        # Compare colour state in camera-registered coordinates too. This catches
        # enamel fills/reveals which have too few persistent corners to track.
        aligned = cv2.warpAffine(state_b, matrix, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)
        aligned_mask = cv2.warpAffine(mask_b, matrix, (w, h), flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP)
        mask &= aligned_mask
        support &= mask > 0
        change = ((np.linalg.norm(state-aligned, axis=2) > 20) & (mask > 0)).astype(np.uint8)
        change = cv2.morphologyEx(change, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        def largest(binary):
            n, _, stats, _ = cv2.connectedComponentsWithStats(binary)
            return float(stats[1:, cv2.CC_STAT_AREA].max())*100/(w*h) if n > 1 else 0.
        area, cluster, changed = float(support.sum())*100/(w*h), largest(support), largest(change)
        return dict(tracked_support_pct=round(area, 3), largest_track_cluster_pct=round(cluster, 3),
                    largest_colour_change_pct=round(changed, 3), moving_tracks=moving_count, camera_registered=registered,
                    qualifies=bool((area >= .6 and cluster >= .15) or changed >= 3.))

    capture = cv2.VideoCapture(str(file))
    count = capture.get(cv2.CAP_PROP_FRAME_COUNT)
    end = max(0., min(duration-1/fps, (count-1)/fps) if count > 0 else duration-1/fps)
    if sample_until is not None: end = min(end, sample_until)
    times = [i/10 for i in range(int(end*10+1e-6)+1)]
    indices = [round(t*fps) for t in times]
    strip_indices = [round(min(3., end)*i/5*fps) for i in range(6)]
    wanted = set(indices + strip_indices)
    frames, prepared, samples = {}, {}, []
    positions = {index: i for i, index in enumerate(indices)}
    scenes = scenes or [dict(id='unlabelled film', start=0., end=duration)]
    def scene_at(t):
        return next((s['id'] for s in scenes if s['start'] <= t < s['end']), None)
    retrieved = 0
    try:
        for index in range(max(wanted)+1):
            if not capture.grab(): break
            if index in wanted:
                ok, frame = capture.retrieve()
                if ok:
                    h, w = frame.shape[:2]
                    frame = cv2.resize(frame, (round(w*480/max(w, h)), round(h*480/max(w, h))), interpolation=cv2.INTER_AREA)
                    if index in strip_indices: frames[index] = frame
                    if index in positions:
                        retrieved += 1
                        i = positions[index]
                        prepared[i] = prepare(frame)
                        reference = max(0, i-3)
                        # Never use a cut between authored shots as evidence of acting.
                        if i and reference in prepared and scene_at(indices[reference]/fps) == scene_at(index/fps):
                            samples.append(dict(time_s=round(index/fps, 4), reference_s=round(indices[reference]/fps, 4),
                                                shot=scene_at(index/fps), **compare(prepared[reference], prepared[i])))
                        prepared.pop(i-4, None)
    finally: capture.release()
    full_decoded = retrieved == len(indices)
    motion = movement_report(samples, scenes, duration, full_decoded)
    samples = [s for s in samples if s['time_s'] <= 3.]
    decoded = full_decoded and all(i in frames for i in strip_indices) and end >= 1.
    first = next((s['time_s'] for s in samples if s['qualifies']), None)
    # Require consecutive observations, not a single anomalous glint or decode.
    confirmed = next((b['time_s'] for a, b in zip(samples, samples[1:]) if a['qualifies'] and b['qualifies'] and b['time_s']-a['time_s'] <= .11), None)
    def peaks(until):
        return {key: max((s[key] for s in samples if s['time_s'] <= until), default=0.) for key in ('tracked_support_pct', 'largest_track_cluster_pct', 'largest_colour_change_pct')}
    passed = decoded and confirmed is not None and confirmed <= 1.
    result = dict(method='local_picture_change_v1', passed=passed, samples_decoded=decoded,
                  sampled_until_s=round(min(end, 3.), 4), sample_interval_s=.1, comparison_window_s=.3, analysis_long_edge_px=480,
                  thresholds=dict(confirm_by_s=1., consecutive_samples=2, residual_displacement_px=1.5,
                                  track_support_radius_px=6, tracked_support_pct=.6, largest_track_cluster_pct=.15,
                                  normalized_rgb_distance=20, largest_colour_change_pct=3.),
                  peak_0_1s=peaks(1.), peak_0_2s=peaks(2.), first_threshold_crossing_s=first,
                  first_confirmed_change_s=confirmed, samples=samples)
    if not passed:
        when = f'First confirmed change was at {confirmed:.2f}s.' if confirmed is not None else f'No confirmed change was found in the sampled {min(end, 3.):.2f}s.'
        result['message'] = ('Opening has no sustained sizeable local picture change by 1.00s. ' + when +
                             ' Start a visible subject movement or large state change on frame one; enlarge it if needed. '
                             'For an intentional still opening, use --allow-still-opening.')
    thumbw = 270
    first_frame = next(iter(frames.values()), None)
    thumbh = round(thumbw*first_frame.shape[0]/first_frame.shape[1]) if first_frame is not None else 480
    strip = Image.new('RGB', (6*thumbw, thumbh+28), (16, 16, 23))
    painter = ImageDraw.Draw(strip)
    for i, index in enumerate(strip_indices):
        if index not in frames: continue
        image = Image.fromarray(cv2.cvtColor(frames[index], cv2.COLOR_BGR2RGB))
        image.thumbnail((thumbw, thumbh))
        strip.paste(image, (i*thumbw, 0))
        painter.text((i*thumbw+10, thumbh+5), f'{index/fps:.2f} s', fill='#ecd299')
    return result, strip, motion


def opening_picture(file, fps, duration):
    # Compatibility for tools importing the earlier opening-only API.
    opening, strip, _ = picture_change(file, fps, duration, sample_until=3.)
    return opening, strip


def movement_report(samples, scenes, duration, decoded, max_hold=2.):
    """Consecutive local changes buy viewing time, a cut or one glint does not."""
    shots, holds, review_holds, bursts = [], [], [], []
    for scene in scenes:
        start, end = max(0., float(scene['start'])), min(duration, float(scene['end']))
        local = [s for s in samples if s['shot'] == scene['id'] and start <= s['reference_s'] < s['time_s'] < end]
        active = []
        for a, b in zip(local, local[1:]):
            if a['qualifies'] and b['qualifies'] and b['time_s']-a['time_s'] <= .11:
                interval = dict(shot=scene['id'], start_s=a['reference_s'], end_s=b['time_s'])
                if active and interval['start_s'] <= active[-1]['end_s']+.11:
                    active[-1]['end_s'] = interval['end_s']
                else: active.append(interval)
        cursor, gaps = start, []
        for action in active + [dict(start_s=end, end_s=end)]:
            if action['start_s'] > cursor:
                gap = dict(shot=scene['id'], start_s=round(cursor, 4), end_s=round(action['start_s'], 4),
                           duration_s=round(action['start_s']-cursor, 4))
                gaps.append(gap)
                if action['start_s']-cursor > max_hold+1e-6: holds.append(gap)
                elif action['start_s']-cursor >= 1.: review_holds.append(gap)
            cursor = max(cursor, action['end_s'])
        bursts.extend(active)
        shots.append(dict(shot=scene['id'], start_s=start, end_s=end,
                          confirmed_motion=bool(active), longest_hold_s=max((g['duration_s'] for g in gaps), default=0.),
                          motion_ranges=active))
    return dict(method='local_picture_change_whole_film_v1', passed=decoded and not holds,
                samples_decoded=decoded, max_hold_s=max_hold, sample_interval_s=.1, comparison_window_s=.3,
                analysis_long_edge_px=480, thresholds=dict(consecutive_samples=2, residual_displacement_px=1.5,
                    track_support_radius_px=6, tracked_support_pct=.6, largest_track_cluster_pct=.15,
                    normalized_rgb_distance=20, largest_colour_change_pct=3.),
                shots=shots, holds=holds, review_holds=review_holds, motion_ranges=bursts, samples=samples)


def sound_coverage(scenes, events, motion=None, output=None):
    """Expose absent declarations; proximity does not prove the right sound."""
    import soundfile as sf
    sounds, beds, warnings, errors = [], [], [], []
    variants, counts = {}, {}
    for event in events:
        start = float(event.get('time', event.get('t', 0)))
        if event.get('kind') == 'ambience':
            if float(event.get('gain', 1)) > 0:
                beds.append(dict(name=event['name'], start_s=start, end_s=start+float(event['duration'])))
        else:
            name = event['name']
            if name not in variants:
                base = WORK / 'sfx' / (name+'.wav')
                variants[name] = [base] + sorted((p for p in base.parent.glob(f'{name}-*.wav')
                    if re.fullmatch(re.escape(name)+r'-(?:[2-9]|[1-9][0-9]+)\.wav', p.name)),
                    key=lambda p: int(p.stem.split('-')[-1]))
            ordinal = counts.get(name, 0)
            path = variants[name][ordinal % len(variants[name])]
            counts[name] = ordinal+1
            if float(event.get('gain', 1)) <= 0: continue
            duration = sf.info(str(path)).duration if path.exists() else 0.
            sounds.append(dict(name=event['name'], start_s=start, end_s=start+duration))
    def uncovered(start, end, intervals):
        cursor, gaps = start, []
        for a, b in sorted(intervals):
            if b <= cursor or a >= end: continue
            if a > cursor: gaps.append((cursor, min(a, end)))
            cursor = max(cursor, b)
        if cursor < end: gaps.append((cursor, end))
        return gaps
    shots, silent_motion, unaccented = [], [], []
    for scene in scenes:
        a, b = float(scene['start']), float(scene['end'])
        cues = [s for s in sounds if s['start_s'] < b and s['end_s'] >= a]
        ambience = [s for s in beds if s['start_s'] < b and s['end_s'] > a]
        bed_gaps = uncovered(a, b, [(s['start_s'], s['end_s']) for s in ambience])
        active = [s for s in (motion or {}).get('motion_ranges', []) if s['shot'] == scene['id']]
        starts = sum(a <= s['start_s'] < b for s in cues)
        row = dict(shot=scene['id'], start_s=a, end_s=b, one_shot_count=starts,
                   overlapping_one_shot_count=len(cues),
                   ambience_beds=sorted({s['name'] for s in ambience}),
                   ambience_coverage_pct=round(100*(1-sum(y-x for x,y in bed_gaps)/max(b-a, 1e-9)), 1),
                   confirmed_motion=bool(active) if motion is not None else None)
        shots.append(row)
        if not cues and not ambience:
            message = f"{scene['id']} ({a:.2f}-{b:.2f}s): no sound declarations at nonzero gain."
            (errors if active else warnings).append(message)
        elif not cues:
            warnings.append(f"{scene['id']}: ambience only; check the visible actions for matching foley.")
        if bed_gaps:
            warnings.append(f"{scene['id']}: missing ambience for {sum(y-x for x,y in bed_gaps):.2f}s; declare the place or explain an intentional silence.")
        # Use durations, not just cue counts. A wheel can be covered by one
        # correctly ranged texture; an isolated clink cannot voice a whole walk.
        near = [(s['start_s']-.35, s['end_s']+.35) for s in sounds]
        for action in active:
            for x,y in uncovered(action['start_s'], action['end_s'], near):
                if y-x < .3: continue
                item = dict(shot=scene['id'], start_s=round(x, 3), end_s=round(y, 3), duration_s=round(y-x, 3))
                unaccented.append(item)
                for lo,hi in uncovered(x,y,[(s['start_s'],s['end_s']) for s in beds]):
                    if hi-lo >= .3:
                        silent_motion.append(dict(shot=scene['id'], start_s=round(lo,3), end_s=round(hi,3)))
    if unaccented: warnings.append(f'{len(unaccented)} motion ranges lack nearby one-shots; inspect unaccented_motion in this report (ambience alone cannot prove action coverage).')
    if silent_motion: warnings.append(f'{len(silent_motion)} motion ranges have neither nearby foley nor a bed; inspect silent_motion.')
    report = dict(version=1, stage='encoded movement' if motion is not None else 'declarations only',
                  passed=not errors, shots=shots, warnings=warnings, errors=errors,
                  silent_motion=silent_motion, unaccented_motion=unaccented,
                  proximity_s=.35, minimum_reported_gap_s=.3,
                  limits='Counts and temporal proximity cannot prove audible, appropriate or synchronized foley. '
                         'Music and narration are not action/place sound. Muted declarations do not count. '
                         'Local picture change cannot distinguish acting from moving scenery.')
    (output or WORK / 'coverage-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    for row in shots:
        print(f"Sound {row['shot']} {row['start_s']:.2f}-{row['end_s']:.2f}s: "
              f"{row['one_shot_count']} one-shots; ambience {', '.join(row['ambience_beds']) or 'NONE'} "
              f"({row['ambience_coverage_pct']:.0f}% range coverage)")
    for label, messages in [('WARNING', warnings), ('FAIL', errors)]:
        for message in messages: print(f'{label}: {message}')
    return report


def audio_balance(file, ffmpeg):
    """Check provenance and compare decoded audio, rather than trusting a sidecar."""
    import numpy as np
    def digest(path):
        with Path(path).open('rb') as stream:
            return hashlib.file_digest(stream, 'sha256').hexdigest()
    checks, result = {}, {}
    path = WORK / 'balance-report.json'
    checks['balance_report_present'] = path.exists()
    if not path.exists(): return checks, result
    result['mix_balance'] = json.loads(path.read_text(encoding='utf-8-sig'))
    balance = result['mix_balance']
    checks['voice_first_balance'] = balance.get('passed', False) or balance.get('waived', False)
    mix = WORK / 'mix.wav'
    checks['balance_matches_current_mix'] = mix.exists() and digest(mix) == balance.get('mix_sha256')
    inputs = balance.get('input_sha256', {})
    checks['mix_inputs_unchanged'] = bool(inputs) and all((WORK / p).exists() and digest(WORK / p) == h for p, h in inputs.items())
    # Detect newly added variants as well as changed or removed source files.
    checks['mix_inputs_unchanged'] &= {str(p.relative_to(WORK)) for folder in ('sfx', 'ambience') for p in (WORK / folder).glob('*.wav')} == {p for p in inputs if p.startswith(('sfx/', 'sfx\\', 'ambience/', 'ambience\\'))}
    if not checks['balance_matches_current_mix']: return checks, result
    def decode(path):
        data = subprocess.check_output([ffmpeg, '-v', 'error', '-nostdin', '-i', str(path),
            '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'])
        return np.frombuffer(data, dtype='<f4').astype(float)
    actual, expected = decode(file), decode(mix)
    if not len(actual) or not len(expected):
        checks['encoded_audio_matches_current_mix'] = False
        result['audio_match'] = {'error': 'Empty decoded audio.'}
        return checks, result
    best = float('inf')
    # AAC timestamps normally align exactly; permit up to 32 ms codec delay.
    for lag in range(-256, 257):
        a, b = actual[max(0, lag):], expected[max(0, -lag):]
        n = min(len(a), len(b))
        if not n: continue
        # Subsample only the delay search; evaluate its winner at full rate.
        error = np.mean((a[:n:8]-b[:n:8])**2) / max(np.mean(b[:n:8]**2), 1e-20)
        if error < best: best, best_lag = error, lag
    a, b = actual[max(0, best_lag):], expected[max(0, -best_lag):]
    n = min(len(a), len(b))
    error = float(np.sqrt(np.mean((a[:n]-b[:n])**2) / max(np.mean(b[:n]**2), 1e-20)))
    checks['encoded_audio_matches_current_mix'] = error <= .1 and abs(len(actual)-len(expected)) <= 1200
    result['audio_match'] = dict(relative_rms_error=error, max_relative_rms_error=.1, lag_ms=best_lag/8,
        method='8kHz mono waveform comparison, including level; permits lossy AAC, not an identity proof')
    return checks, result


def qa(files, allow_still_opening=False, allow_still_shots=None, story=None, allow_feed_exception=None, profile=None):
    import cv2
    from PIL import Image, ImageDraw
    cfg = config()
    if allow_feed_exception is not None and not allow_feed_exception.strip():
        raise ValueError('Feed exception needs a nonempty reason.')
    story = Path(story) if story else ROOT / 'story.py'
    hook = None
    if story.exists():
        from gilt.__main__ import load
        hook = load(str(story.resolve())).film.hook
    ffprobe, ffmpeg = cfg.get('ffprobe', 'ffprobe'), cfg.get('ffmpeg', 'ffmpeg')
    timeline = json.loads((WORK / 'timeline.json').read_text(encoding='utf-8-sig')) if (WORK / 'timeline.json').exists() else None
    from gilt.feedcheck import select_profile
    profile = select_profile(profile, timeline)
    expected = timeline['duration'] if timeline else None
    scenes = json.loads((WORK / 'sound-shots.json').read_text(encoding='utf-8')) if (WORK / 'sound-shots.json').exists() else (timeline['scenes'] if timeline else None)
    waivers = {}
    for value in allow_still_shots or []:
        shot, sep, reason = value.partition('=')
        if not sep or not shot.strip() or not reason.strip(): raise ValueError('Use --allow-still-shot SHOT=REASON with a nonempty reason.')
        if shot not in {s['id'] for s in scenes or []}: raise ValueError(f'Unknown still-shot waiver: {shot}')
        waivers[shot] = reason.strip()
    failed = False
    for filename in files:
        file = Path(filename).resolve()
        probe = json.loads(subprocess.check_output([ffprobe, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(file)], text=True))
        video = next((s for s in probe['streams'] if s['codec_type'] == 'video'), None)
        audio = next((s for s in probe['streams'] if s['codec_type'] == 'audio'), None)
        checks, report = {}, {'file': str(file)}
        checks['video_present'] = video is not None
        checks['audio_present'] = audio is not None
        duration = float(probe['format']['duration'])
        if video:
            width, height = video['width'], video['height']
            num, den = map(int, video['avg_frame_rate'].split('/'))
            report.update(width=width, height=height, duration=duration, fps=num/den)
            checks['fps_30'] = abs(num/den - 30) < .01
            checks['format_ratio'] = min(abs(width/height - 9/16), abs(width/height - 16/9)) < .002
            checks['expected_duration'] = expected is None or abs(duration-expected) < .12
            vd = float(video.get('duration', duration))
            if height > width:
                from gilt.feedcheck import encoded, write
                feed, first, last = encoded(file, duration, timeline, hook, allow_feed_exception,
                                            profile=profile, film_dir=ROOT)
                feed['stage'] = 'encoded file; current timeline narration, word gaps and Hook template'
                write(feed, file.with_suffix('.feed.json'))
                report['feed'] = feed
                checks.update({'feed_'+name: value or feed['waived'] for name, value in feed['raw_checks'].items()})
                if first is not None and last is not None:
                    for name, rgb in [('frame-0',first),('last-frame',last)]:
                        Image.fromarray(rgb).save(file.with_suffix('.'+name+'.png'))
                    join = Image.new('RGB',(540,480))
                    for i, rgb in enumerate((last,first)):
                        image = Image.fromarray(rgb);image.thumbnail((270,480));join.paste(image,(270*i,0))
                    join.save(file.with_suffix('.loop.jpg'))
            opening, strip, motion = picture_change(file, num/den, vd, scenes)
            opening['allow_still_opening'] = allow_still_opening
            opening['waived'] = allow_still_opening and not opening['passed']
            checks['opening_samples_decoded'] = opening['samples_decoded']
            checks['opening_local_picture_change_by_1s'] = opening['passed'] or allow_still_opening
            opening_path = file.with_suffix('.opening.jpg')
            strip.save(opening_path)
            report.update(opening=opening, opening_strip=str(opening_path))
            for hold in motion['holds']:
                hold['waived'] = hold['shot'] in waivers
                if hold['waived']: hold['reason'] = waivers[hold['shot']]
                print(f"{'WAIVED' if hold['waived'] else 'FAIL'}: {hold['shot']} "
                      f"{hold['start_s']:.2f}-{hold['end_s']:.2f}s: "
                      f"{hold['duration_s']:.2f}s without sizeable local picture change (limit {motion['max_hold_s']:.1f}s).")
            for hold in motion['review_holds']:
                print(f"WARNING: {hold['shot']} {hold['start_s']:.2f}-{hold['end_s']:.2f}s: "
                      'review this 1-2s settle against the narration; it is below the failure limit.')
            motion['waivers'] = waivers
            motion['waived'] = bool(motion['holds']) and all(h['waived'] for h in motion['holds'])
            checks['whole_film_motion_samples_decoded'] = motion['samples_decoded']
            checks['no_long_unacted_hold'] = motion['samples_decoded'] and all(h['waived'] for h in motion['holds'])
            report['movement'] = motion
            file.with_suffix('.motion.json').write_text(json.dumps(motion, indent=2), encoding='utf-8')
            checks['sound_events_present'] = (WORK / 'sfx_events.json').exists()
            if checks['sound_events_present']:
                coverage = sound_coverage(scenes or [dict(id='unlabelled film', start=0., end=vd)],
                    json.loads((WORK / 'sfx_events.json').read_text(encoding='utf-8-sig')), motion)
                file.with_suffix('.coverage.json').write_text(json.dumps(coverage, indent=2), encoding='utf-8')
                report['sound_coverage'] = coverage
                checks['moving_shots_have_sound'] = coverage['passed']
        if audio and video:
            vd, ad = float(video.get('duration', duration)), float(audio.get('duration', duration))
            checks['audio_video_sync_length'] = abs(vd-ad) < .15
        if audio:
            balance_checks, balance_result = audio_balance(file, ffmpeg)
            checks.update(balance_checks)
            report.update(balance_result)
        process = subprocess.run([ffmpeg, '-hide_banner', '-nostdin', '-threads', '2', '-filter_threads', '1', '-i', str(file), '-vf', 'blackdetect=d=0.4:pix_th=0.04,freezedetect=n=-60dB:d=0.4', '-af', 'loudnorm=I=-14:TP=-2:LRA=7:print_format=json', '-f', 'null', '-'], capture_output=True, text=True)
        checks['full_decode'] = process.returncode == 0
        checks['no_black_stretch_0_4s'] = 'black_start:' not in process.stderr
        checks['no_freeze_0_4s'] = 'freeze_start:' not in process.stderr
        measures = re.findall(r'\{[^{}]*"input_i"[^{}]*\}', process.stderr, re.S)
        if measures:
            loudness = json.loads(measures[-1])
            report['loudness'] = loudness
            checks['loudness_within_0_5_LU_of_minus14'] = abs(float(loudness['input_i'])+14) <= .5
            # AAC can overshoot a PCM master; inspect the encoded peak itself.
            checks['true_peak_below_minus_0_8'] = float(loudness['input_tp']) <= -.8
        else:
            checks['loudness_measured'] = False
        capture = cv2.VideoCapture(str(file))
        thumbw, cols, count = 270, 4, 12
        thumbh = round(thumbw * height / width) if video else 480
        sheet = Image.new('RGB', (cols*thumbw, 3*(thumbh+28)), (16, 16, 23))
        painter = ImageDraw.Draw(sheet)
        sampled = 0
        for i in range(count):
            at = (max(0, duration-.1)) * i / (count-1)
            capture.set(cv2.CAP_PROP_POS_MSEC, at*1000)
            ok, frame = capture.read()
            if not ok: continue
            image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            image.thumbnail((thumbw, thumbh))
            x, y = (i % cols)*thumbw, (i // cols)*(thumbh+28)
            sheet.paste(image, (x, y))
            painter.text((x+10, y+thumbh+5), f'{at:.2f} s', fill='#ecd299')
            sampled += 1
        capture.release()
        checks['all_contact_samples_decoded'] = sampled == count
        sheet_path = file.with_suffix('.contact.jpg')
        sheet.save(sheet_path)
        report.update(checks=checks, passed=all(checks.values()), contact_sheet=str(sheet_path), limits='Technical encode checks and whole-film local picture change do not establish meaningful acting, readability, factual accuracy or listening review. Motion measurement excludes margins, the portrait caption band (64-84% of height), the bottom 16% of landscape, and detected caption-like red plaques. It can miss small/low-contrast/fast-repetitive action, pure camera travel or action in masked areas. Lighting and uniform camera drift are discounted; within-shot cuts, large colour changes or moving scenery can pass. Shot boundaries need current events/timeline metadata. Sound proximity is not proof of event matching or audibility. Inspect the sheets and motion itself.')
        file.with_suffix('.qa.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report, indent=2))
        failed |= not report['passed']
    if failed: raise SystemExit('Encoded video QA failed. Inspect the reports and repair the source.')

def main():
    cfg = config()
    extra = [str(Path(cfg[k]).parent) for k in ('ffmpeg', 'ffprobe') if cfg.get(k)]
    os.environ['PATH'] = os.pathsep.join(extra + [os.environ.get('PATH', '')])
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    prep = sub.add_parser('prepare'); prep.add_argument('script'); prep.add_argument('--voice'); prep.add_argument('--speed', type=float)
    prep.add_argument('--engine', choices=['kokoro', 'gemini']); prep.add_argument('--gemini-voice'); prep.add_argument('--style')
    prep.add_argument('--feed-short', action='store_true', help='Use .04s lead, short gaps and .08s tail unless scripted; measured voice sets the edit')
    prep.add_argument('--profile', choices=['feed', 'story'], help='Store an explicit Short profile; both use short lead/gap/tail defaults')
    ev = sub.add_parser('events'); ev.add_argument('story')
    mix = sub.add_parser('mix')
    mix.add_argument('--allow-balance-override', metavar='REASON', help='Record a deliberate balance exception; encoded loudness/peak QA still applies.')
    verify = sub.add_parser('qa'); verify.add_argument('files', nargs='+')
    verify.add_argument('--story', help='Source containing the Hook template (default: story.py); hook presence is checked against encoded pixels')
    verify.add_argument('--profile', choices=['feed', 'story'], help='Short profile: explicit flag, then prepared timeline, otherwise feed; story requires 2.9-3.4 words/s and two >=0.7s word gaps, one in the last 8s; never inferred from duration')
    verify.add_argument('--allow-feed-exception', metavar='REASON', help='Record why portrait work is not a feed Short; retain raw feed failures and all other QA')
    verify.add_argument('--allow-still-opening', action='store_true', help='Accept a deliberately still opening; record the waiver and keep all other QA checks.')
    verify.add_argument('--allow-still-shot', action='append', default=[], metavar='SHOT=REASON', help='Waive long holds in this named shot with a recorded reason; repeat for another shot. Does not waive opening, decode, freeze, sound or balance checks.')
    args = parser.parse_args()
    if args.command == 'prepare':
        options = ['--script', Path(args.script).resolve()]
        if args.voice: options += ['--voice', args.voice]
        if args.engine: options += ['--engine', args.engine]
        if args.gemini_voice: options += ['--gemini-voice', args.gemini_voice]
        if args.style is not None: options += ['--style', args.style]
        if args.speed is not None: options += ['--speed', args.speed]
        if args.feed_short: options += ['--feed-short']
        if args.profile: options += ['--profile', args.profile]
        run_audio('voice.py', *options)
        run_audio('sfx.py')
    elif args.command == 'events': events(args.story)
    elif args.command == 'mix':
        if args.allow_balance_override is not None and not args.allow_balance_override.strip():
            parser.error('Supply a nonempty reason for the balance override.')
        run_audio('score.py')
        run_audio('mix.py', *(['--allow-balance-override', args.allow_balance_override] if args.allow_balance_override else []))
    else: qa(args.files, allow_still_opening=args.allow_still_opening, allow_still_shots=args.allow_still_shot,
             story=args.story, allow_feed_exception=args.allow_feed_exception, profile=args.profile)

if __name__ == '__main__': main()
