"""Feed defaults: pixels, measured caps, timing and recorded exceptions.

Run in a working copy: python -B -m unittest discover -s tests -v
No voice model, network, GPU or film-project mutation.
"""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
from gilt import Camera, Film, Format, Hook, Painter, Shot, estimate_clauses, loop_return, rect
from gilt.__main__ import frame
from gilt.feed import SAFE, cap_font, caption_groups, captions, composite, heavy_face, line_tile
from gilt.feedcheck import encoded, measure, sentence_timing
from stories import world as W


def timeline(duration=18, start=.04, end=1.8, text='The pyramid was once white.'):
    return dict(duration=duration,scenes=[dict(id='hook',clauses=[
        dict(text=text,start=start,end=end,
             words=estimate_clauses(text,start,end-start)[0]['words']),
        dict(text='and remember:',start=15,end=duration-.08,words=[])])])


class Feed(unittest.TestCase):
    def setUp(self):
        self.hook=Hook(('THE GREAT','PYRAMID','WAS WHITE'))
        self.fmt=Format('portrait',.25)
        self.sky=np.full((480,270,3),(7,156,248),np.uint8)
        self.first=composite(self.sky,self.hook.overlays(),self.fmt)

    def report(self,**kwargs):
        args=dict(duration=18,timeline=timeline(),first=self.first,last=self.first,hook=self.hook)
        args.update(kwargs)
        return measure(**args)

    def test_hook_caps_and_safe_bounds_include_outline(self):
        font=cap_font(128);box=font.getbbox('H')
        self.assertLessEqual(abs(box[3]-box[1]-128),1)
        for tile,x,y in self.hook.overlays():
            self.assertGreaterEqual(x,SAFE[0]);self.assertGreaterEqual(y,SAFE[1])
            self.assertLessEqual(x+tile.width,SAFE[2]);self.assertLessEqual(y+tile.height,SAFE[3])
        self.assertGreaterEqual(self.hook.width/1080,.79)

    def test_hook_validation_and_lifetime(self):
        for lines in [('ONE',),('TOO','SHORT'),('ONE TWO THREE FOUR','FIVE SIX SEVEN')]:
            with self.assertRaises(ValueError):Hook(lines)
        with self.assertRaises(ValueError):Hook(('THREE WORD','CLAIM'),cap_height=90)
        with self.assertRaises(ValueError):Hook(('THREE WORD','CLAIM'),top=10)
        self.assertTrue(self.hook.active(0,18));self.assertTrue(self.hook.active(1.99,18))
        self.assertFalse(self.hook.active(2,18));self.assertFalse(self.hook.active(9,18))
        self.assertTrue(self.hook.active(18-1/30,18))

    def test_long_hook_line_preserves_cap_height(self):
        short=line_tile('WHITE',128,'#fff34c',10,864,True)
        long=line_tile('WHITE WHITE WHITE',128,'#fff34c',10,864,True)
        self.assertEqual(short.height,long.height)
        self.assertEqual(long.width,864)

    def test_missing_heavy_font_is_actionable(self):
        heavy_face.cache_clear()
        try:
            with patch('gilt.feed.ImageFont.truetype',side_effect=OSError()):
                with self.assertRaisesRegex(RuntimeError,'Install Impact'):heavy_face()
        finally:heavy_face.cache_clear()

    def test_hook_is_top_layer_outside_camera_lighting_and_glints(self):
        def draw(p,t,c):
            p.cell(rect(-2000,-2000,5000,5000),'midnight')
            p.glint(540,0,800)
        shots=[Shot('hook',0,18,draw,camera=lambda t:Camera((300,800),1.8,19))]
        film=Film(shots,use_timeline=False,hook=self.hook)
        rgb=frame(film,self.fmt,0)
        overlay=self.hook.rgba(self.fmt);opaque=overlay[:,:,3]==255
        np.testing.assert_array_equal(rgb[opaque],overlay[:,:,:3][opaque])
        self.assertTrue(measure(18,timeline(),rgb,rgb,self.hook)['raw_checks']['hook_on_frame_0'])

    def test_phone_captions_preserve_size_and_safe_area_at_every_word(self):
        text='KEEPERS PUT THE PENNIES ON THE PENDULUM TO ADJUST ITS TIMEKEEPING.'
        clauses=estimate_clauses(text,2.2,8)
        shot=Shot('keeper',2,11,lambda *args:None,clauses)
        from gilt.engine import Context
        for word in clauses[0]['words']:
            p=Painter(self.fmt);ctx=Context(shot,self.fmt)
            captions(p,ctx,(word['start']+word['end'])/2)
            self.assertTrue(p.screen_overlays)
            for tile,x,y in p.screen_overlays:
                self.assertGreaterEqual(x,SAFE[0]);self.assertGreaterEqual(y,SAFE[1])
                self.assertLessEqual(x+tile.width,SAFE[2]);self.assertLessEqual(y+tile.height,SAFE[3])
        box=cap_font().getbbox('H');self.assertTrue(91<=box[3]-box[1]<=93)
        for a,b in caption_groups(tuple(text.split())):self.assertIn(b-a,(2,3))

    def test_hook_suppresses_duplicate_captions_and_returns(self):
        def draw(p,t,c):W.sky(p,t,c.format,mode='bright',birds=False)
        clauses=estimate_clauses('The Great Pyramid was once white.',0,18)
        film=Film([Shot('hook',0,18,draw,clauses)],use_timeline=False,hook=self.hook)
        for at in (0.,1.,18-1/30):
            np.testing.assert_array_equal(frame(film,self.fmt,at,True),frame(film,self.fmt,at,False))
        self.assertFalse(np.array_equal(frame(film,self.fmt,3,True),frame(film,self.fmt,3,False)))

    def test_new_clause_caption_takes_priority_over_previous_gap_hold(self):
        from gilt.engine import Context
        clauses=estimate_clauses('OLD WORDS',0,1)+estimate_clauses('NEW WORDS',1.04,1)
        p=Painter(self.fmt)
        ctx=Context(Shot('two',0,3,lambda *a:None,clauses),self.fmt)
        with patch('gilt.feed.line_tile',wraps=line_tile) as draw:
            captions(p,ctx,1.05)
            self.assertEqual(draw.call_args.args[0],'NEW WORDS')

    def test_loop_return_targets_last_encoded_frame_without_hold(self):
        self.assertIsNone(loop_return(2,18))
        self.assertAlmostEqual(loop_return(18-1/30,18),0)
        self.assertAlmostEqual(loop_return(18-2/30,18),-1/30)
        with self.assertRaises(ValueError):loop_return(0,18,span=0)

    def test_bright_sky_has_no_vignette_and_is_not_gold(self):
        p=Painter(self.fmt);W.sky(p,0,self.fmt,mode='bright',birds=False)
        self.assertTrue(p.no_vignette);self.assertTrue(p.bright_palette)
        rgb=frame(Film([Shot('sky',0,18,lambda p,t,c:W.sky(p,t,c.format,mode='bright',birds=False))],use_timeline=False),self.fmt,0,False)
        self.assertTrue(self.report(first=rgb,last=rgb)['raw_checks']['bright_frame_0_background'])
        self.assertGreater(int(p.arrays()[0][0,0,2]),int(p.arrays()[0][0,0,0]))

    def test_zero_width_wire_keeps_enamel_fill(self):
        p=Painter(Format('portrait',.1));p.cell(rect(-900,-700,2900,2700),'#079cf8',0)
        np.testing.assert_array_equal(p.arrays()[0][20,20],[7,156,248])

    def test_feed_checks_accept_matching_bright_hook_and_short_voice(self):
        report=self.report()
        self.assertTrue(report['passed'],report)
        self.assertFalse(report['waived'])

    def test_duration_boundaries_do_not_silently_exclude_long_portrait(self):
        for duration in (15,20):self.assertTrue(self.report(duration=duration)['raw_checks']['duration_15_20s'])
        for duration in (14.9,20.1,90):self.assertFalse(self.report(duration=duration)['raw_checks']['duration_15_20s'])

    def test_slow_or_late_first_sentence_fails(self):
        for tl,key in [(timeline(start=.2),'narration_starts_by_0_1s'),
                       (timeline(end=2.3),'first_sentence_by_2s'),
                       (timeline(text='This is a long first sentence with too many words.'),'first_sentence_at_most_7_words')]:
            self.assertFalse(self.report(timeline=tl)['raw_checks'][key])

    def test_absent_timeline_fails_instead_of_inventing_speech_timing(self):
        self.assertFalse(self.report(timeline=None)['raw_checks']['first_sentence_by_2s'])

    def test_hook_declaration_alone_does_not_pass_encoded_pixels(self):
        self.assertFalse(self.report(first=self.sky)['raw_checks']['hook_on_frame_0'])
        self.assertFalse(self.report(hook=None)['raw_checks']['hook_on_frame_0'])

    def test_dark_opening_and_different_last_frame_fail(self):
        dark=composite(np.zeros_like(self.sky),self.hook.overlays(),self.fmt)
        self.assertFalse(self.report(first=dark)['raw_checks']['bright_frame_0_background'])
        self.assertFalse(self.report(last=np.zeros_like(self.first))['raw_checks']['last_picture_matches_first'])

    def test_end_tail_and_missing_decodes_fail(self):
        tl=timeline();tl['scenes'][0]['clauses'][-1]['end']=17.6
        self.assertFalse(self.report(timeline=tl)['raw_checks']['end_hold_at_most_0_15s'])
        self.assertFalse(self.report(last=None)['raw_checks']['boundary_frames_available'])

    def test_waiver_keeps_raw_failures_and_requires_reason(self):
        report=self.report(duration=90,waiver='Portrait lecture, long-form brief')
        self.assertFalse(report['passed']);self.assertTrue(report['accepted'])
        self.assertFalse(report['raw_checks']['duration_15_20s'])
        self.assertEqual(report['reason'],'Portrait lecture, long-form brief')
        with self.assertRaises(ValueError):self.report(waiver=' ')

    def test_legacy_film_positional_api_and_landscape_still_run(self):
        def draw(p,t,c):p.cell(rect(-900,-700,2900,2700),'jade')
        legacy=Film([Shot('old',0,35,draw)],[],False)
        self.assertIsNone(legacy.hook)
        self.assertEqual(frame(legacy,Format('landscape',.1),0).shape,(108,192,3))

    def test_example_first_and_last_match_and_opening_actually_changes(self):
        path=Path(__file__).resolve().parents[1]/'example/feed-pyramid.py'
        spec=importlib.util.spec_from_file_location('feed_example',path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        a=frame(module.film,self.fmt,0);b=frame(module.film,self.fmt,18-1/30)
        np.testing.assert_array_equal(a,b)
        self.assertGreater(abs(a.astype(float)-frame(module.film,self.fmt,.6)).mean(),1)

    def test_encoded_boundary_decode_and_template_survive_h264(self):
        import shutil,subprocess
        ffmpeg=shutil.which('ffmpeg')
        if not ffmpeg:self.skipTest('FFmpeg unavailable')
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'boundary.mp4'
            subprocess.run([ffmpeg,'-v','error','-y','-f','rawvideo','-pixel_format','rgb24',
                '-video_size','270x480','-framerate','30','-i','-','-c:v','libx264',
                '-threads','2','-pix_fmt','yuv420p',str(file)],input=self.first.tobytes()*4,check=True)
            report,first,last=encoded(file,18,timeline(),self.hook)
            self.assertTrue(report['passed'],report)
            self.assertEqual(first.shape,last.shape)

    def test_changing_two_line_captions_do_not_count_as_picture_motion(self):
        import shutil,subprocess
        from film import picture_change
        from gilt.engine import Context
        ffmpeg=shutil.which('ffmpeg')
        if not ffmpeg:self.skipTest('FFmpeg unavailable')
        images=[]
        for text in ('SMOOTH LIMESTONE','UNUSUAL CONSTRUCTION'):
            p=Painter(self.fmt)
            ctx=Context(Shot('still',0,2,lambda *a:None,estimate_clauses(text,0,2)),self.fmt)
            captions(p,ctx,.1)
            self.assertEqual(len(p.screen_overlays),2)
            images.append(composite(self.sky,p.screen_overlays,self.fmt))
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/'captions-only.mp4'
            subprocess.run([ffmpeg,'-v','error','-y','-f','rawvideo','-pixel_format','rgb24',
                '-video_size','270x480','-framerate','30','-i','-','-c:v','libx264',
                '-threads','2','-pix_fmt','yuv420p',str(file)],
                input=b''.join(images[(i//9)%2].tobytes() for i in range(39)),check=True)
            opening,_,_=picture_change(file,30,1.3)
            self.assertFalse(opening['passed'])
            self.assertFalse(any(s['qualifies'] for s in opening['samples']))


if __name__=='__main__':unittest.main()
