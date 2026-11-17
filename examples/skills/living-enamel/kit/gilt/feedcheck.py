"""Short timing/pixel tripwires shared by sheets and encoded QA, not story review."""
import json
import math
import re
from pathlib import Path
import numpy as np
from . import ROOT
from .engine import Format


def select_profile(profile=None, timeline=None):
    """Explicit CLI choice, then stored choice, otherwise the legacy feed limits."""
    selected = profile if profile is not None else (timeline or {}).get('profile', 'feed')
    if selected not in {'feed', 'story'}:
        raise ValueError('Choose profile feed or story explicitly; duration never selects it.')
    return selected


def narration_words(timeline):
    """Stored spoken tokens, falling back to display text for legacy timelines."""
    clauses = [c for s in (timeline or {}).get('scenes', []) for c in s.get('clauses', [])]
    texts = [c.get('spoken', c.get('text', '')) for c in clauses]
    if not texts or any(not isinstance(t, str) or not t.strip() for t in texts):
        return None
    return sum(len(t.split()) for t in texts)


def narration_beats(timeline, duration):
    """Internal word-to-word silence, never opening lead or trailing hold.

    The timeline has no semantic turn marker. Require two breathing beats and
    one wholly within the encoded film's last eight seconds as a timing proxy.
    """
    result = dict(timings_available=False, min_gap_s=.7, final_window_s=8.,
                  gaps=[], qualifying_count=0, final_window_count=0, longest_gap_s=None,
                  source='timeline word bounds; estimated unless externally aligned')
    clauses = [c for s in (timeline or {}).get('scenes', []) for c in s.get('clauses', [])]
    if not clauses or any(not c.get('words') for c in clauses):
        return result
    words = [w for c in clauses for w in c['words']]
    try:
        spans = sorted((float(w['start']), float(w['end'])) for w in words)
    except (KeyError, TypeError, ValueError):
        return result
    if len(spans) < 2 or any(not (math.isfinite(a) and math.isfinite(b) and 0 <= a <= b <= duration)
                             for a, b in spans):
        return result
    gaps, cursor = [], spans[0][1]
    for start, end in spans[1:]:
        # Union overlapping anchors so a nested/duplicate word cannot invent silence.
        if start > cursor:
            gaps.append(dict(start=cursor, end=start, duration_s=round(start-cursor, 6)))
        cursor = max(cursor, end)
    qualifying = [g for g in gaps if g['duration_s'] >= result['min_gap_s']]
    result.update(timings_available=True, gaps=qualifying, qualifying_count=len(qualifying),
                  final_window_count=sum(g['start'] >= duration-result['final_window_s'] for g in qualifying),
                  longest_gap_s=max((g['duration_s'] for g in gaps), default=0.))
    return result


def story_files(film_dir):
    paths = {name: Path(film_dir) / name for name in ('story-card.md', 'publish.md')}
    present = {name: p.is_file() and bool(p.read_text(encoding='utf-8-sig').strip())
               for name, p in paths.items()}
    card = paths['story-card.md'].read_text(encoding='utf-8-sig') if present['story-card.md'] else ''
    modes = re.findall(r'^ending_mode:\s*(loop|punchline|consequence)\s*$', card, re.M)
    return present, modes[0] if len(modes) == 1 else None


def sentence_timing(timeline):
    clauses = sorted((c for s in (timeline or {}).get('scenes', [])
                      for c in s.get('clauses', [])), key=lambda c: c['start'])
    if not clauses:
        return dict(start=None, end=None, words=None, tail=None, source='missing timeline')
    first = clauses[0]
    # An external aligned timeline may omit spoken. Display substitutions must
    # not be used to claim that a shorter sentence was actually spoken.
    words = first.get('words', [])
    boundary = next((i for i, w in enumerate(words) if re.search(r'[.!?][\"\u201d\u2019\x27)]*$', w['w'])), None)
    same_text = first.get('spoken', first['text']).strip().casefold() == first['text'].strip().casefold()
    if boundary is not None and same_text:
        end, count = words[boundary]['end'], boundary+1
    else:
        # A clause without an internal sentence boundary is conservatively a
        # whole sentence; split the first sentence into its own voice clause.
        end = first['end']
        count = len(first.get('spoken', first['text']).split())
    return dict(start=first['start'], end=end, words=count,
                tail=timeline['duration']-max(c['end'] for c in clauses),
                source='timeline word/whole-clause bounds; estimated unless externally aligned')


def measure(duration, timeline, first, last, hook=None, waiver=None, *, profile=None, film_dir=None):
    """Unselected portrait output retains feed limits, regardless of duration.

    A long-form/other-work exception records a reason without hiding raw fails.
    Landscape callers skip this profile. Images are decoded RGB or rendered RGB.
    """
    if waiver is not None and not waiver.strip():
        raise ValueError('Feed exception needs a nonempty reason.')
    profile = select_profile(profile, timeline)
    timing = sentence_timing(timeline)
    checks = dict(end_hold_at_most_0_15s=timing['tail'] is not None and -.034 <= timing['tail'] <= .15)
    metrics = dict(duration_s=duration, first_sentence=timing)
    loop_required = True
    if profile == 'feed':
        checks.update(narration_starts_by_0_1s=timing['start'] is not None and 0 <= timing['start'] <= .1,
                      duration_15_20s=15 <= duration <= 20,
                      first_sentence_by_2s=timing['end'] is not None and timing['end'] <= 2.1,
                      first_sentence_at_most_7_words=timing['words'] is not None and timing['words'] <= 7)
    else:
        present, ending = story_files(film_dir if film_dir is not None else ROOT)
        count = narration_words(timeline)
        wps = count / duration if count is not None and duration > 0 else None
        beats = narration_beats(timeline, duration)
        checks.update(narration_starts_by_0_5s=timing['start'] is not None and 0 <= timing['start'] <= .5,
                      duration_45_65s=45 <= duration <= 65,
                      first_sentence_by_5_5s=timing['end'] is not None and timing['end'] <= 5.5,
                      narration_2_9_3_4_words_per_second=wps is not None and 2.9 <= wps <= 3.4,
                      narration_at_least_2_gaps_0_7s=beats['timings_available'] and beats['qualifying_count'] >= 2,
                      narration_gap_0_7s_in_last_8s=beats['timings_available'] and beats['final_window_count'] >= 1,
                      story_card_nonempty=present['story-card.md'], publish_nonempty=present['publish.md'],
                      ending_mode_declared=ending is not None)
        metrics.update(narration_words=count, words_per_second=wps, ending_mode=ending,
                       narration_beats=beats,
                       word_count_source='stored timeline spoken; display text for legacy clauses')
        loop_required = ending == 'loop'
    metrics['loop_required'] = loop_required
    decoded = first is not None and last is not None and first.shape == last.shape
    checks['boundary_frames_available'] = decoded
    checks['hook_on_frame_0'] = False
    checks['bright_frame_0_background'] = False
    if loop_required:
        checks['last_picture_matches_first'] = False
    if decoded:
        h, w = first.shape[:2]
        overlay = hook.rgba(Format('portrait', w/1080)) if hook else None
        if overlay is not None and hook.active(0, duration):
            mask = overlay[:, :, 3] >= 250
            error = abs(first.astype(float)-overlay[:, :, :3].astype(float)).mean(axis=2)
            mean = float(error[mask].mean()) if mask.any() else 255.
            share = float((error[mask] <= 40).mean()) if mask.any() else 0.
            metrics['hook_pixel_match'] = dict(mean_error_255=mean, fraction_within_40=share)
            checks['hook_on_frame_0'] = mean <= 18 and share >= .9
        # Top sky + narrow side fields, excluding known hook pixels. This is a
        # background proxy, not segmentation: inspect the actual location too.
        mask = np.zeros((h, w), bool)
        mask[:round(h*.08)] = True
        mask[:round(h*.65), :round(w*.05)] = True
        mask[:round(h*.65), round(w*.9):] = True
        if overlay is not None:
            mask &= overlay[:, :, 3] == 0
        luma = first.astype(float) @ np.array([.2126, .7152, .0722])
        median, dark = float(np.median(luma[mask])), float((luma[mask] < 40).mean())
        metrics['background_proxy'] = dict(median_luma_255=median, dark_fraction=dark)
        checks['bright_frame_0_background'] = median >= 90 and dark <= .15
        if loop_required:
            error = abs(first.astype(float)-last.astype(float))
            mean, p95 = float(error.mean()), float(np.percentile(error, 95))
            metrics['loop_pixels'] = dict(mean_error_255=mean, p95_error_255=p95)
            checks['last_picture_matches_first'] = mean <= 6 and p95 <= 24
    return dict(profile=profile, raw_checks=checks, metrics=metrics,
                passed=all(checks.values()), accepted=all(checks.values()) or bool(waiver),
                waived=bool(waiver), reason=waiver,
                limits='Pixel templates verify the kit Hook, not arbitrary custom text/OCR. '
                       'Brightness samples sky/margins, not semantic background. Timing is from '
                       'the current timeline, not a fresh ASR pass or measured voice onset. '
                       'Breathing beats use internal word gaps (no lead/tail); missing word '
                       'anchors fail. Two gaps with one starting in the last 8s are a proxy, '
                       'not proof of a pause after the turn or before the final line. '
                       'WPS uses stored '
                       'narration and the supplied duration (encoded duration in encoded QA). '
                       'Markdown checks verify nonempty files and a declared ending mode, not '
                       'sourcing, packaging completeness or story quality. These checks cannot '
                       'prove subject recognition, payoff timing, grammatical/audio replay, '
                       'meaningful acting, readability or audience retention; inspect and listen.')


def encoded(file, duration, timeline, hook=None, waiver=None, *, profile=None, film_dir=None):
    import cv2
    cv2.setNumThreads(1)
    capture = cv2.VideoCapture(str(file))
    first, last = None, None
    try:
        # Sequential decode avoids seek-to-tail keyframe/rounding ambiguity.
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            if first is None:
                first = rgb
            last = rgb
    finally:
        capture.release()
    return measure(duration, timeline, first, last, hook, waiver,
                   profile=profile, film_dir=film_dir), first, last


def write(report, path):
    path.write_text(json.dumps(report, indent=2), encoding='utf-8')
    waived = report['waived'] or report.get('opening', {}).get('waived', False)
    state = 'FAIL' if not report['accepted'] else 'WAIVED' if waived else 'OK'
    failed = ', '.join(k for k, v in report['raw_checks'].items() if not v)
    print(f'{report["profile"].upper()} {state}: {failed or "all measured checks"}' +
          (f' | {report["reason"]}' if report['waived'] else ''))


def main():
    """Check an existing portrait encode without preparing voice or modifying source."""
    import argparse
    import subprocess
    from film import config, picture_change
    from gilt.__main__ import load
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file', type=Path)
    parser.add_argument('--profile', choices=['feed', 'story'])
    parser.add_argument('--story', type=Path, default=ROOT / 'story.py')
    parser.add_argument('--out', type=Path, help='JSON report (default: beside the video)')
    parser.add_argument('--allow-feed-exception', metavar='REASON')
    parser.add_argument('--allow-still-opening', action='store_true')
    args = parser.parse_args()
    if args.allow_feed_exception is not None and not args.allow_feed_exception.strip():
        parser.error('Feed exception needs a nonempty reason.')
    probe = subprocess.run([config().get('ffprobe', 'ffprobe'), '-v', 'error',
                            '-show_streams', '-show_format', '-of', 'json', str(args.file)],
                           check=True, capture_output=True, text=True)
    info = json.loads(probe.stdout)
    video = next(s for s in info['streams'] if s['codec_type'] == 'video')
    if video['height'] <= video['width']:
        parser.error('Short profiles check portrait encodes; landscape uses film.py qa.')
    duration = float(info['format']['duration'])
    num, den = map(float, video['r_frame_rate'].split('/'))
    path = ROOT / 'work' / 'timeline.json'
    timeline = json.loads(path.read_text(encoding='utf-8-sig')) if path.exists() else None
    hook = load(str(args.story.resolve())).film.hook if args.story.exists() else None
    report, _, _ = encoded(args.file, duration, timeline, hook, args.allow_feed_exception,
                           profile=args.profile, film_dir=ROOT)
    scenes = (timeline or {}).get('scenes', [])
    scenes = scenes if scenes and all('start' in s and 'end' in s for s in scenes) else None
    opening, _, _ = picture_change(args.file, num/den, float(video.get('duration', duration)),
                                   scenes=scenes, sample_until=3.)
    opening['waived'] = args.allow_still_opening and not opening['passed']
    report['opening'] = opening
    report['raw_checks']['opening_picture_change_by_1s'] = opening['passed']
    report['passed'] = report['passed'] and opening['passed']
    # A feed exception still cannot waive the independent movement requirement.
    report['accepted'] = report['accepted'] and (opening['passed'] or opening['waived'])
    report['stage'] = 'encoded profile + first-second movement only; full film.py qa still required'
    write(report, args.out or args.file.with_suffix('.feed.json'))
    raise SystemExit(0 if report['accepted'] else 1)


if __name__ == '__main__':
    main()
