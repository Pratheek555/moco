"""Offline Short profile checks: timing, stored narration, endings and evidence files."""
from pathlib import Path
import json
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from gilt import Film, Format, Hook, Painter, Shot, estimate_clauses
from gilt.engine import Context
from gilt.__main__ import frame
from gilt.feed import cap_font, captions, composite, line_tile
from gilt.feedcheck import measure, narration_beats, narration_words, select_profile


def story_timeline(duration=55, count=175, first_end=3.8):
    first = 'A keeper puts another heavy coin onto the moving clock pendulum.'
    clauses = estimate_clauses(first, .04, first_end-.04)
    remaining = count-len(first.split())
    counts = (remaining//3, remaining//3, remaining-2*(remaining//3))
    for n, start, end in zip(counts, (first_end+.08, 20.8, duration-4),
                             (20, duration-4.8, duration-.08)):
        clauses += estimate_clauses(' '.join(['word'] * n)+'.', start, end-start)
    for clause in clauses:
        clause['spoken'] = clause['text']
    return dict(profile='story', duration=duration,
                scenes=[dict(id='keeper', start=0, end=duration, clauses=clauses)])


class StoryProfile(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.card = self.root / 'story-card.md'
        self.card.write_text('ending_mode: consequence\nWhy: a visible result.', encoding='utf-8')
        (self.root / 'publish.md').write_text('Draft packaging; final encode hash pending.', encoding='utf-8')
        self.fmt = Format('portrait', .25)
        self.hook = Hook(('HE MOVES', 'THE CLOCK'), return_span=0)
        sky = np.full((480, 270, 3), (7, 156, 248), np.uint8)
        self.first = composite(sky, self.hook.overlays(), self.fmt)

    def report(self, **kwargs):
        args = dict(duration=55, timeline=story_timeline(), first=self.first,
                    last=np.zeros_like(self.first), hook=self.hook, film_dir=self.root)
        args.update(kwargs)
        return measure(**args)

    def test_profile_selection_is_explicit_not_duration_driven(self):
        self.assertEqual(select_profile(None, {'duration': 60}), 'feed')
        self.assertEqual(select_profile(None, {'profile': 'story'}), 'story')
        self.assertEqual(select_profile('feed', {'profile': 'story'}), 'feed')
        with self.assertRaises(ValueError): select_profile('long')
        with self.assertRaises(ValueError): select_profile(None, {'profile': 'typo'})

    def test_story_passes_with_consequence_and_different_end_picture(self):
        report = self.report()
        self.assertTrue(report['passed'], report)
        self.assertEqual(report['profile'], 'story')
        self.assertNotIn('last_picture_matches_first', report['raw_checks'])
        self.assertNotIn('first_sentence_at_most_7_words', report['raw_checks'])
        self.assertFalse(report['metrics']['loop_required'])
        self.assertIn('not', report['limits'])

    def test_feed_retains_duration_sentence_and_loop_limits(self):
        checks = self.report(profile='feed')['raw_checks']
        for key in ('duration_15_20s', 'first_sentence_by_2s',
                    'first_sentence_at_most_7_words', 'last_picture_matches_first'):
            self.assertFalse(checks[key], key)
        self.assertNotIn('story_card_nonempty', checks)
        self.assertNotIn('narration_2_9_3_4_words_per_second', checks)
        self.assertNotIn('narration_at_least_2_gaps_0_7s', checks)
        self.assertNotIn('narration_gap_0_7s_in_last_8s', checks)
        self.assertNotIn('narration_starts_by_0_5s', checks)

    def test_story_duration_boundaries(self):
        for seconds in (45, 65):
            self.assertTrue(self.report(duration=seconds)['raw_checks']['duration_45_65s'])
        for seconds in (44.99, 65.01, 18):
            self.assertFalse(self.report(duration=seconds)['raw_checks']['duration_45_65s'])

    def test_story_opening_has_time_limit_without_word_cap(self):
        for end, passed in ((5.5, True), (5.51, False)):
            report = self.report(timeline=story_timeline(first_end=end))
            self.assertEqual(report['raw_checks']['first_sentence_by_5_5s'], passed)
            self.assertGreater(report['metrics']['first_sentence']['words'], 7)

    def test_lead_tail_hook_and_brightness_requirements_remain(self):
        tl = story_timeline()
        tl['scenes'][0]['clauses'][0]['start'] = .51
        tl['scenes'][0]['clauses'][-1]['end'] = 54.7
        checks = self.report(timeline=tl, hook=None)['raw_checks']
        for key in ('narration_starts_by_0_5s', 'end_hold_at_most_0_15s', 'hook_on_frame_0'):
            self.assertFalse(checks[key])
        checks = self.report(first=np.zeros_like(self.first))['raw_checks']
        self.assertFalse(checks['bright_frame_0_background'])
        self.assertFalse(self.report(last=None)['raw_checks']['boundary_frames_available'])

    def test_story_loop_keeps_endpoint_check(self):
        self.card.write_text('ending_mode: loop\nReason: adds meaning.', encoding='utf-8')
        self.assertFalse(self.report()['raw_checks']['last_picture_matches_first'])
        self.assertTrue(self.report(last=self.first)['passed'])
        self.card.write_text('ending_mode: punchline', encoding='utf-8')
        self.assertTrue(self.report()['passed'])

    def test_missing_empty_or_unrecognised_card_does_not_pass(self):
        for text in ('', '  \n', '# A card without its mode', 'ending_mode: next_episode',
                     'ending_mode: loop\nending_mode: consequence'):
            self.card.write_text(text, encoding='utf-8')
            report = self.report()
            self.assertFalse(report['passed'])
            self.assertFalse(report['raw_checks']['ending_mode_declared'])
        self.card.unlink()
        self.assertFalse(self.report()['raw_checks']['story_card_nonempty'])

    def test_publish_file_must_exist_and_contain_non_whitespace(self):
        path = self.root / 'publish.md'
        path.write_text(' \n\t', encoding='utf-8')
        self.assertFalse(self.report()['raw_checks']['publish_nonempty'])
        path.unlink()
        self.assertFalse(self.report()['raw_checks']['publish_nonempty'])

    def test_wps_uses_spoken_tokens_and_encoded_duration_not_display_or_timeline_length(self):
        tl = story_timeline(count=170)
        for clause in tl['scenes'][0]['clauses']:
            clause['text'] = 'short display'
        tl['duration'] = 500
        report = self.report(timeline=tl, duration=50)
        self.assertEqual(report['metrics']['narration_words'], 170)
        self.assertEqual(report['metrics']['words_per_second'], 3.4)
        self.assertTrue(report['raw_checks']['narration_2_9_3_4_words_per_second'])
        for count, passed in ((144, False), (145, True), (170, True), (171, False), (185, False)):
            checks = self.report(duration=50, timeline=story_timeline(count=count))['raw_checks']
            self.assertEqual(checks['narration_2_9_3_4_words_per_second'], passed)

    def test_legacy_text_fallback_and_absent_narration(self):
        tl = story_timeline()
        for clause in tl['scenes'][0]['clauses']: clause.pop('spoken')
        self.assertEqual(narration_words(tl), 175)
        self.assertIsNone(narration_words(None))
        tl['scenes'][0]['clauses'][1]['spoken'] = ''
        self.assertIsNone(narration_words(tl))
        self.assertFalse(self.report(timeline=None, profile='story')['raw_checks']['narration_2_9_3_4_words_per_second'])

    def test_story_lead_boundary_does_not_relax_feed(self):
        for start, passed in ((0, True), (.1, True), (.5, True), (.5001, False), (-.01, False)):
            tl = story_timeline()
            tl['scenes'][0]['clauses'][0]['start'] = start
            self.assertEqual(self.report(timeline=tl)['raw_checks']['narration_starts_by_0_5s'], passed)
            self.assertEqual(self.report(timeline=tl, profile='feed')['raw_checks']['narration_starts_by_0_1s'],
                             0 <= start <= .1)

    def beat_report(self, spans, **kwargs):
        # All anchors in one clause: its outer bounds cannot demonstrate gaps.
        words = [dict(w='WORD', start=a, end=b) for a, b in spans]
        tl = dict(profile='story', duration=55, scenes=[dict(id='one', clauses=[
            dict(text='Words.', spoken='Words.', start=.04, end=54.92, words=words)])])
        return self.report(timeline=tl, **kwargs)

    def test_two_word_gaps_with_one_late_beat_pass_even_inside_a_clause(self):
        report = self.beat_report([(.04, 9), (9.7, 47), (47.7, 54.92)])
        self.assertTrue(report['raw_checks']['narration_at_least_2_gaps_0_7s'])
        self.assertTrue(report['raw_checks']['narration_gap_0_7s_in_last_8s'])
        beats = report['metrics']['narration_beats']
        self.assertEqual(beats['qualifying_count'], 2)
        self.assertEqual(beats['final_window_count'], 1)
        self.assertEqual(beats['gaps'], [dict(start=9, end=9.7, duration_s=.7),
                                         dict(start=47, end=47.7, duration_s=.7)])

    def test_one_gap_fails_count_even_when_it_is_late(self):
        checks = self.beat_report([(.04, 47), (47.8, 54.92)])['raw_checks']
        self.assertFalse(checks['narration_at_least_2_gaps_0_7s'])
        self.assertTrue(checks['narration_gap_0_7s_in_last_8s'])

    def test_gap_threshold_and_final_window_boundaries(self):
        for gap, passed in ((.6999, False), (.7, True), (.7001, True)):
            checks = self.beat_report([(.04, 9), (9+gap, 47), (47+gap, 54.92)])['raw_checks']
            self.assertEqual(checks['narration_at_least_2_gaps_0_7s'], passed)
            self.assertEqual(checks['narration_gap_0_7s_in_last_8s'], passed)
        for start, passed in ((46.9999, False), (47, True), (48, True)):
            checks = self.beat_report([(.04, 9), (9.8, start), (start+.8, 54.92)])['raw_checks']
            self.assertTrue(checks['narration_at_least_2_gaps_0_7s'])
            self.assertEqual(checks['narration_gap_0_7s_in_last_8s'], passed)
        # Encoded seconds define the final window, not timeline.duration.
        checks = self.beat_report([(.04, 9), (9.8, 47), (47.8, 54.92)], duration=60)['raw_checks']
        self.assertFalse(checks['narration_gap_0_7s_in_last_8s'])

    def test_lead_and_tail_silence_do_not_count_as_beats(self):
        report = self.beat_report([(1, 20), (20, 54)])
        beats = report['metrics']['narration_beats']
        self.assertEqual(beats['qualifying_count'], 0)
        self.assertEqual(beats['longest_gap_s'], 0)
        self.assertFalse(report['raw_checks']['narration_at_least_2_gaps_0_7s'])
        self.assertFalse(report['raw_checks']['narration_gap_0_7s_in_last_8s'])

    def test_unordered_or_overlapping_word_bounds_do_not_invent_gaps(self):
        report = self.beat_report([(47.8, 54.92), (5, 7), (.04, 20), (3, 4), (20.8, 47)])
        beats = report['metrics']['narration_beats']
        self.assertEqual(beats['qualifying_count'], 2)
        self.assertEqual([(g['start'], g['end']) for g in beats['gaps']], [(20, 20.8), (47, 47.8)])

    def test_missing_or_invalid_word_anchors_fail_beats_instead_of_using_clause_gaps(self):
        for words in ([], [{'w': 'WORD'}], [{'start': 'bad', 'end': 1}],
                      [{'start': 0, 'end': float('nan')}], [{'start': -.1, 'end': 1}],
                      [{'start': 0, 'end': 56}], [{'start': 3, 'end': 2}]):
            tl = story_timeline()
            tl['scenes'][0]['clauses'][1]['words'] = words
            report = self.report(timeline=tl)
            self.assertFalse(report['metrics']['narration_beats']['timings_available'])
            self.assertFalse(report['raw_checks']['narration_at_least_2_gaps_0_7s'])
            self.assertFalse(report['raw_checks']['narration_gap_0_7s_in_last_8s'])
        self.assertFalse(narration_beats(None, 55)['timings_available'])

    def test_waiver_keeps_story_failures_visible(self):
        (self.root / 'publish.md').unlink()
        report = self.report(duration=18, waiver='Requested pacing experiment')
        self.assertFalse(report['passed'])
        self.assertTrue(report['accepted'])
        self.assertTrue(report['waived'])
        self.assertFalse(report['raw_checks']['duration_45_65s'])
        self.assertFalse(report['raw_checks']['publish_nonempty'])
        with self.assertRaises(ValueError): self.report(waiver=' ')

    def test_story_captions_are_white_speech_timed_and_correct_glyph_height(self):
        clauses = estimate_clauses('The keeper moves the coin onto the clock.', 0, 4)
        ctx = Context(Shot('keeper', 0, 4, lambda *a: None, clauses), self.fmt)
        glyph = cap_font(64).getbbox('H')
        self.assertTrue(.03 <= (glyph[3]-glyph[1])/1920 <= .035)
        for word in clauses[0]['words']:
            p = Painter(self.fmt)
            with patch('gilt.feed.line_tile', wraps=line_tile) as draw:
                captions(p, ctx, (word['start']+word['end'])/2, profile='story')
            tokens = sum(len(call.args[0].split()) for call in draw.call_args_list)
            self.assertTrue(1 <= tokens <= 4)
            for call in draw.call_args_list:
                self.assertEqual(call.args[1:3], (64, '#ffffff'))
                self.assertIsNone(call.kwargs['highlight'])
            top = min(y for tile, x, y in p.screen_overlays)
            bottom = max(y+tile.height for tile, x, y in p.screen_overlays)
            self.assertAlmostEqual((top+bottom)/2, 1920*.7, delta=1)
        p = Painter(self.fmt)
        captions(p, ctx, -.1, profile='story')
        self.assertFalse(p.screen_overlays)

    def test_renderer_routes_film_profile_to_captions(self):
        film = Film([Shot('keeper', 0, 55, lambda *a: None)], use_timeline=False, profile='story')
        with patch('gilt.__main__.phone_captions') as draw:
            frame(film, self.fmt, 5)
            self.assertEqual(draw.call_args.kwargs['profile'], 'story')

    def test_loaded_timeline_profile_reaches_renderer_film(self):
        from gilt.__main__ import load
        (self.root / 'work').mkdir()
        (self.root / 'work/timeline.json').write_text(json.dumps(story_timeline()), encoding='utf-8')
        story = self.root / 'story.py'
        story.write_text("from gilt import Film, Shot\nfilm=Film([Shot('keeper',0,18,lambda *a:None)])\n")
        with patch('gilt.__main__.ROOT', self.root):
            film = load(str(story)).film
        self.assertEqual(film.profile, 'story')
        self.assertEqual(film.duration, 55)

    def test_profile_cli_feed_exception_cannot_waive_opening_motion(self):
        from gilt.feedcheck import main
        info = dict(format={'duration': '55'}, streams=[dict(codec_type='video',
                    width=270, height=480, r_frame_rate='30/1')])
        for still_waiver, expected_status in ((False, 1), (True, 0)):
            output = self.root / 'report.json'
            args = ['feedcheck', 'fake.mp4', '--profile', 'story', '--story', 'missing.py',
                    '--out', str(output), '--allow-feed-exception', 'Deliberate experiment']
            if still_waiver: args.append('--allow-still-opening')
            report = self.report(duration=18, waiver='Deliberate experiment')
            with patch('sys.argv', args), patch('gilt.feedcheck.ROOT', self.root), \
                 patch('subprocess.run', return_value=SimpleNamespace(stdout=json.dumps(info))), \
                 patch('gilt.feedcheck.encoded', return_value=(report, None, None)), \
                 patch('film.picture_change', return_value=({'passed': False}, None, None)):
                with self.assertRaises(SystemExit) as status: main()
            self.assertEqual(status.exception.code, expected_status)
            written = json.loads(output.read_text())
            self.assertFalse(written['raw_checks']['opening_picture_change_by_1s'])
            self.assertEqual(written['opening']['waived'], still_waiver)


if __name__ == '__main__': unittest.main()
