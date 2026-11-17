"""Offline audio/voice contracts. Run with the working venv: python -m unittest discover -s <kit> -p test_tts.py"""
from pathlib import Path
import hashlib, importlib.util, json, shutil, sys, tempfile, types, unittest
from unittest.mock import patch

import numpy as np
import soundfile as sf

import film
from tts import LocalVoice, finish


class VoiceContract(unittest.TestCase):
    def test_gemini_dispatch_caches_clauses_and_tracks_effective_env_voice_without_a_local_model(self):
        from tts_gemini import GeminiVoice
        desc = dict(voice=dict(engine='gemini', style='dryly amused'),
                    shots=[dict(id='a', say=['One.', 'Two.'], lead=0, gap=.1, pause=0, hold=0)])
        calls = []
        def fake(text, output, voice, style):
            calls.append((text, voice, style)); sf.write(output, self.signal, 24000, subtype='PCM_16')
        with patch.dict('os.environ', MOCO_GEMINI_TTS_VOICE='Charon'), patch('tts_gemini.synthesize', side_effect=fake), patch.object(film, 'config', return_value={}):
            audio, shots, info = film.speak(desc, self.root, self.root)
            self.assertEqual(info['engine'], 'gemini'); self.assertEqual(info['voice'], 'Charon')
            self.assertGreater(len(audio), 0); self.assertEqual(len(shots[0]['cues']), 2)
            film.speak(desc, self.root, self.root)
            self.assertEqual(len(calls), 2)
            perf = json.loads((self.root / 'voice-performance.json').read_text())
            self.assertTrue(all(c['cached'] for c in perf['clauses']))
            with patch.dict('os.environ', MOCO_GEMINI_TTS_VOICE='Kore'):
                film.speak(desc, self.root, self.root)
            self.assertEqual(len(calls), 4)
            self.assertEqual(calls[-1], ('Two.', 'Kore', 'dryly amused'))
            v = GeminiVoice(dict(engine='gemini', name='Puck'), {}, self.root, self.root, self.ffmpeg, film.trim)
            self.assertEqual(v.name, 'Puck')
        self.assertNotIn('test-key', (self.root / 'voice-performance.json').read_text())

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.cache = self.root / 'cache'; self.cache.mkdir()
        self.ffmpeg = shutil.which('ffmpeg')
        self.cfg = {'voiceCache': str(self.root), 'voiceEngines': {
            e: {'device': 'cpu', 'fingerprint': 'test-weights'} for e in ('zonos', 'dia')}}
        self.signal = (.1 * np.sin(np.arange(24000 * 5) * 2 * np.pi * 220 / 24000)).astype(np.float32)
        self.prompt = self.root / 'speaker.wav'; sf.write(self.prompt, self.signal, 24000, subtype='FLOAT')

    def tearDown(self): self.temp.cleanup()

    def voice(self, options):
        return LocalVoice(options, self.cfg, self.root, self.root, self.ffmpeg, film.trim)

    def test_default_kokoro_audio_and_metadata_are_unchanged(self):
        fake = types.SimpleNamespace(Kokoro=lambda *a: types.SimpleNamespace(create=lambda *a, **kw: (self.signal.copy(), 24000)))
        with patch.dict(sys.modules, kokoro_onnx=fake):
            v = self.voice({}); clip, cached = v.clip('A sensible tax on buckets.', self.cache)
        np.testing.assert_array_equal(clip, film.trim(self.signal))
        self.assertFalse(cached)
        self.assertEqual(v.info(), dict(engine='kokoro-onnx (local, free)', voice='bm_george', speed=1.12, lang='en-gb'))

    def test_engine_options_and_reference_bytes_invalidate_cache(self):
        def render(options):
            v = self.voice(options); v.ensure_anchor()
            with patch.object(v, '_generate', return_value=(self.signal.copy(), 24000)) as generator:
                _, cached = v.clip('The treasury was now a bucket.', self.cache)
                self.assertEqual(generator.call_count, 0 if cached else 1)
            return cached
        spec = dict(engine='zonos', reference='speaker.wav')
        self.assertFalse(render(spec)); self.assertTrue(render(spec))
        self.assertFalse(render(dict(spec, seed=218)))
        sf.write(self.prompt, self.signal * .5, 24000, subtype='FLOAT')
        self.assertFalse(render(spec))
        dia = dict(engine='dia', audio_prompt=dict(path='speaker.wav', transcript='[S1] Some old paperwork.'))
        self.assertFalse(render(dia))

    def test_fixed_anchor_does_not_chain_previous_clauses(self):
        v = self.voice(dict(engine='zonos'))
        with patch.object(v, '_generate', return_value=(self.signal.copy(), 24000)) as generate:
            v.ensure_anchor(); original = v.identity['anchorSha256']
            v.clip('First clause.', self.cache); v.clip('Second clause.', self.cache)
            self.assertEqual(v.identity['anchorSha256'], original)
            # A resumed instance reads the same anchor, even if no clause is cached.
            resumed = self.voice(dict(engine='zonos')); resumed.ensure_anchor()
            self.assertEqual(generate.call_count, 3)
            self.assertEqual(resumed.identity['anchorSha256'], original)

    def test_short_generative_blip_retries_with_fixed_anchor_and_records_seed(self):
        v = self.voice(dict(engine='zonos', reference='speaker.wav')); v.ensure_anchor()
        anchor = v.identity['anchorSha256']
        with patch.object(v, '_generate', side_effect=[(self.signal[:240].copy(), 24000), (self.signal.copy(), 24000)]) as generate:
            audio, cached = v.clip('Modena said no.', self.cache)
        self.assertFalse(cached); self.assertGreater(len(audio), 240)
        self.assertEqual([call.kwargs['seed_offset'] for call in generate.call_args_list], [0,1])
        self.assertEqual(v.last_clip_seed, 218); self.assertEqual(v.identity['anchorSha256'], anchor)
        with patch.object(v, '_generate', side_effect=AssertionError('Validated retry must be cached')):
            _, cached = v.clip('Modena said no.', self.cache)
        self.assertTrue(cached); self.assertEqual(v.last_clip_seed, 218)

    def test_exhausted_blip_retries_do_not_write_a_speech_cache(self):
        v = self.voice(dict(engine='zonos', reference='speaker.wav')); v.ensure_anchor()
        with patch.object(v, '_generate', return_value=(self.signal[:240].copy(), 24000)):
            with self.assertRaisesRegex(ValueError, 'All 3 deterministic attempts failed'):
                v.clip('Modena said no.', self.cache)
        self.assertFalse(list(self.cache.glob('*.wav')))

    def test_expressive_audio_is_24khz_mono_with_headroom(self):
        if not self.ffmpeg: self.skipTest('Native ffmpeg required')
        signal = np.repeat(self.signal, 2) * 4
        stereo = np.column_stack([signal, signal])
        audio = finish(stereo, 48000, self.ffmpeg, film.trim, normalize=True)
        self.assertEqual(audio.ndim, 1)
        self.assertAlmostEqual(len(audio) / 24000, 5, places=2)
        self.assertLessEqual(float(np.max(np.abs(audio))), .951)
        self.assertGreater(float(np.sqrt(np.mean(audio ** 2))), .09)

    def test_dia_tags_are_passed_through_and_second_voice_needs_prompt(self):
        v = self.voice(dict(engine='dia'))
        self.assertEqual(v._dia_text('The king lost the receipt. (laughs)'), '[S1] The king lost the receipt. (laughs)')
        self.assertEqual(v._dia_text('[S1] The king lost the receipt. [S2]'), '[S1] The king lost the receipt. [S2]')
        with self.assertRaisesRegex(ValueError, 'second Dia speaker'): v._dia_text('[S2] Oh dear.')
        with self.assertRaisesRegex(ValueError, 'alternate'): v._dia_text('[S1] One. [S1] Two.')
        with self.assertRaisesRegex(ValueError, 'transcript'): self.voice(dict(engine='dia', audio_prompt={'path': 'speaker.wav'}))
        with self.assertRaisesRegex(ValueError, 'Unsupported'): self.voice(dict(engine='zonos', speed=1.1))

    def test_dia_ending_hint_finishes_the_current_speaker_and_preserves_explicit_tags(self):
        from tts_dia import ending_hint
        self.assertEqual(ending_hint('[S1] Modena had seven thousand.'), '[S1] Modena had seven thousand. [S2]')
        self.assertEqual(ending_hint('[S1] One. [S2] Two.'), '[S1] One. [S2] Two. [S1]')
        self.assertEqual(ending_hint(' [S1] One. [S2] '), '[S1] One. [S2]')

    def test_story_dia_ending_hint_defaults_on_and_can_be_disabled_without_changing_creative_text(self):
        if not self.ffmpeg: self.skipTest('Native ffmpeg required')
        options = dict(engine='dia', audio_prompt=dict(path='speaker.wav', transcript='[S1] Some old paperwork.'))
        desc = dict(voice=options, shots=[dict(id='a', say=['Modena had seven thousand.'])])
        for enabled in (True, False):
            desc['voice'] = dict(options, **({} if enabled else dict(ending_hint=False)))
            framed = []
            def generate(instance, text, **kwargs):
                framed.append(instance._dia_text(text))
                return self.signal.copy(), 24000
            with patch.object(film, 'config', return_value=self.cfg), patch.object(LocalVoice, '_generate', generate):
                _, _, info = film.speak(desc, self.root, self.root)
            self.assertEqual(framed, ['[S1] Modena had seven thousand. [S2]' if enabled else '[S1] Modena had seven thousand.'])
            self.assertEqual(info['endingHint'], enabled)
            self.assertEqual(info['options']['ending_hint'], enabled)
            self.assertEqual(len(info['textProcessorSha256']), 64)
            self.assertEqual(desc['shots'][0]['say'], ['Modena had seven thousand.'])
        desc['voice'] = dict(options, ending_hint=None)
        with patch.object(film, 'config', return_value=self.cfg), self.assertRaisesRegex(SystemExit, 'must be true or false'):
            film.speak(desc, self.root, self.root)

    def test_automatic_dia_anchor_keys_and_text_include_ending_policy(self):
        from tts_dia import configure
        plain = self.voice(dict(engine='dia')); configure(plain, False)
        hinted = self.voice(dict(engine='dia')); configure(hinted, True)
        resumed = self.voice(dict(engine='dia')); configure(resumed, True)
        self.assertNotEqual(plain.anchor, hinted.anchor)
        self.assertEqual(hinted.anchor, resumed.anchor)
        self.assertTrue(hinted._dia_text(hinted.anchor_text).endswith('[S2]'))

    def test_dia_clause_hint_override_reuses_the_other_clause_caches(self):
        if not self.ffmpeg: self.skipTest('Native ffmpeg required')
        options = dict(engine='dia', audio_prompt=dict(path='speaker.wav', transcript='[S1] Some old paperwork.'))
        desc = dict(voice=dict(options, clause_ending_hints={'a:1': False}),
                    shots=[dict(id='a', say=['First clause.', 'Second clause.', 'Third clause.'])])
        framed = []
        def generate(instance, text, **kwargs):
            framed.append(instance._dia_text(text)); return self.signal.copy(), 24000
        with patch.object(film, 'config', return_value=self.cfg), patch.object(LocalVoice, '_generate', generate):
            film.speak(desc, self.root, self.root)
            self.assertEqual(framed, ['[S1] First clause. [S2]', '[S1] Second clause.', '[S1] Third clause. [S2]'])
            framed.clear(); desc['voice'] = dict(options, clause_ending_hints={'a:1': True})
            _, _, info = film.speak(desc, self.root, self.root)
        self.assertEqual(framed, ['[S1] Second clause. [S2]'])
        perf = json.loads((self.root / 'voice-performance.json').read_text())
        self.assertEqual([c['cached'] for c in perf['clauses']], [True, False, True])
        self.assertEqual(info['clauseEndingHints'], {'a:1': True})
        desc['voice'] = dict(options, clause_ending_hints={'missing:0': False})
        with patch.object(film, 'config', return_value=self.cfg), self.assertRaisesRegex(SystemExit, 'Unknown Dia clause'):
            film.speak(desc, self.root, self.root)

    def test_clause_seed_retake_keeps_other_caches_and_the_speaker_anchor(self):
        options = dict(engine='zonos', seed=217, reference='speaker.wav')
        desc = dict(voice=dict(options, clause_seeds={'a:1': 218}),
                    shots=[dict(id='a', say=['First clause.', 'Second clause.', 'Third clause.'])])
        seeds = []
        def generate(instance, text, **kwargs):
            seeds.append(instance.seed); return self.signal.copy(), 24000
        with patch.object(film, 'config', return_value=self.cfg), patch.object(LocalVoice, '_generate', generate):
            _, _, first = film.speak(desc, self.root, self.root)
            self.assertEqual(seeds, [217,218,217]); seeds.clear()
            desc['voice'] = dict(options, clause_seeds={'a:1': 219})
            _, _, second = film.speak(desc, self.root, self.root)
        self.assertEqual(seeds, [219]); self.assertEqual(first['anchorSha256'], second['anchorSha256'])
        self.assertEqual(second['seed'], 217); self.assertEqual(second['clauseSeeds'], {'a:1': 219})
        perf = json.loads((self.root / 'voice-performance.json').read_text())
        self.assertEqual([c['cached'] for c in perf['clauses']], [True,False,True])
        self.assertEqual([c['seed'] for c in perf['clauses']], [217,219,217])

    def test_upload_keeps_waveform_speed_pitch_and_explicit_timing(self):
        if not self.ffmpeg: self.skipTest('Native ffmpeg required')
        timings = self.root / 'times.json'; timings.write_text('[0,2,5]')
        desc = dict(shots=[dict(id='a', say=['One.', 'Two.'])])
        with patch.object(film, 'config', return_value={'ffmpeg': self.ffmpeg}):
            audio, shots, info = film.cut_upload(desc, self.prompt, timings, self.root)
        np.testing.assert_array_equal(audio, self.signal)
        self.assertEqual(shots[0]['cues'], [0,2]); self.assertEqual(shots[0]['end'], 5)
        self.assertEqual(info['engine'], 'uploaded recording')

    def test_resuming_setup_preserves_creative_files_and_adds_support_files(self):
        spec = importlib.util.spec_from_file_location('kit_setup', Path(__file__).with_name('setup.py'))
        setup = importlib.util.module_from_spec(spec); spec.loader.exec_module(setup)
        story = self.root / 'example' / 'story.mjs'; story.parent.mkdir(); story.write_text('// creative edit')
        setup.copy_sources(Path(__file__).parent, self.root)
        self.assertEqual(story.read_text(), '// creative edit')
        for name in ('tts.py', 'tts_dia.py', 'tts_setup.py', 'requirements-zonos.txt', 'requirements-expressive.txt', 'tts-models.json', 'liveness.py'):
            self.assertTrue((self.root / name).is_file(), name)

    def test_model_download_resumes_parts_and_checks_hash_before_enabling(self):
        from tts_setup import fetch_model
        data = b'locked-model-contents'
        spec = dict(repo='test/model', revision='fixed', files={'model.bin':
                    dict(size=len(data), sha256=hashlib.sha256(data).hexdigest())})
        parts = self.root / 'model.bin.parts'; parts.mkdir(); (parts / '0').write_bytes(data)
        with patch.dict(sys.modules, requests=types.SimpleNamespace(Session=lambda: self.fail('A complete saved part must be reused'))):
            path = fetch_model(spec, 'model.bin', self.root)
        self.assertEqual(path.read_bytes(), data); self.assertFalse(parts.exists())
        path.unlink(); parts.mkdir(); (parts / '0').write_bytes(b'x' * len(data))
        with self.assertRaisesRegex(SystemExit, 'checksum mismatch'):
            fetch_model(spec, 'model.bin', self.root)
        self.assertFalse(path.exists()); self.assertTrue((parts / '0').exists())

    def test_resume_adopts_older_large_download_parts(self):
        from tts_setup import fetch_model
        data = b'a' * (4 * 1024 * 1024 + 19)
        spec = dict(repo='test/model', revision='fixed', files={'large.bin':
                    dict(size=len(data), sha256=hashlib.sha256(data).hexdigest())})
        parts = self.root / 'large.bin.parts'; parts.mkdir(); (parts / '0').write_bytes(data)
        with patch.dict(sys.modules, requests=types.SimpleNamespace(Session=lambda: self.fail('Old parts must be adopted without network'))):
            path = fetch_model(spec, 'large.bin', self.root)
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), spec['files']['large.bin']['sha256'])


if __name__ == '__main__': unittest.main()
