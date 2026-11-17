"""Offline test of voice.py's real clause/cache/timing path on a temporary kit."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


class GeminiVoiceIntegration(unittest.TestCase):
    def test_prepares_48khz_clauses_with_fake_audio_and_reuses_cache(self):
        self.check_preparation({'feed_short': True}, 'feed')

    def test_story_profile_uses_short_defaults_and_is_stored(self):
        self.check_preparation({'profile': 'story'}, 'story')

    def test_cli_profile_overrides_script_profile(self):
        self.check_preparation({'profile': 'feed'}, 'story', ['--profile', 'story'])

    def test_story_allows_half_second_lead(self):
        self.check_preparation({'profile': 'story', 'lead': .5}, 'story')

    def test_story_pause_after_inserts_real_silence_between_gemini_sentence_blocks(self):
        timeline, samples = self.check_preparation({'profile': 'story', 'scenes': [
            {'id': 'turn', 'clauses': [{'spoken': 'The box held lead.', 'pause_after': .8},
                                       {'spoken': 'The guard shut it.', 'pause_after': .8}]},
            {'id': 'ending', 'clauses': [{'spoken': 'He kept the gold.'}]}]}, 'story')
        clauses = [c for scene in timeline['scenes'] for c in scene['clauses']]
        for before, after in zip(clauses, clauses[1:]):
            self.assertAlmostEqual(after['start']-before['end'], .8, places=4)
            self.assertAlmostEqual(after['words'][0]['start']-before['words'][-1]['end'], .8, places=4)
            # Ignore edge rounding: the pause contains digital silence at 48 kHz.
            silence = samples[round(before['end']*48000)+2:round(after['start']*48000)-2]
            self.assertGreater(len(silence), .79*48000)
            self.assertEqual(float(abs(silence).max()), 0.)

    def check_preparation(self, profile_fields, expected_profile, cli_args=None):
        source = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); audio = root / 'audio'; audio.mkdir(); (root / 'work').mkdir()
            for name in ('voice.py', 'common.py', 'gemini_tts.py'):
                shutil.copyfile(source / 'audio' / name, audio / name)
            script = root / 'script.json'
            script_data = {'engine': 'gemini', 'style': 'wry',
                           'scenes': [{'id': 'one', 'clauses': [{'spoken': 'The king forgot.'}]}],
                           **profile_fields}
            script.write_text(json.dumps(script_data))
            harness = r'''
import json, sys, runpy, wave
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(sys.argv[1]) / 'audio'))
import gemini_tts
def fake(text, output, voice, style):
    with (root / 'requests.jsonl').open('a') as log:
        log.write(json.dumps([text, voice, style]) + '\n')
    samples = (.1*np.sin(np.arange(24000)*2*np.pi*220/24000)*32767).astype('<i2')
    with wave.open(str(output), 'wb') as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000); wav.writeframes(samples.tobytes())
gemini_tts.synthesize = fake
root = Path(sys.argv[1]); cli_args = json.loads(sys.argv[2])
sys.argv = ['voice.py', '--script', str(root / 'script.json')] + cli_args
runpy.run_path(str(root / 'audio' / 'voice.py'), run_name='__main__')
'''
            env = dict(os.environ, MOCO_GEMINI_TTS_VOICE='Charon')
            for name in ('GEMINI_API_KEY', 'GOOGLE_API_KEY'):
                env.pop(name, None)
            for _ in range(2):
                subprocess.run([sys.executable, '-B', '-c', harness, str(root), json.dumps(cli_args or [])], env=env, check=True, capture_output=True)
            requests = (root / 'requests.jsonl').read_text().splitlines()
            spoken = [c['spoken'] for s in script_data['scenes'] for c in s['clauses']]
            self.assertEqual(len(requests), len(spoken))
            self.assertEqual([json.loads(r) for r in requests], [[t, 'Charon', 'wry'] for t in spoken])
            import soundfile as sf
            samples, rate = sf.read(root / 'work/narration.wav')
            self.assertEqual(rate, 48000); self.assertGreater(len(samples), 0)
            timeline = json.loads((root / 'work/timeline.json').read_text())
            self.assertEqual(timeline['profile'], expected_profile)
            self.assertEqual(timeline['scenes'][0]['clauses'][0]['start'], script_data.get('lead', .04))
            self.assertAlmostEqual(timeline['duration']-timeline['scenes'][-1]['clauses'][-1]['end'], .08, places=3)
            self.assertGreater(timeline['scenes'][0]['clauses'][0]['end'], 0)
            self.assertIn('words', timeline['scenes'][0]['clauses'][0])
            self.assertNotIn('key', (root / 'work/voice_selection.json').read_text())
            # Changing the effective env voice must invalidate the per-clause cache.
            env['MOCO_GEMINI_TTS_VOICE'] = 'Kore'
            subprocess.run([sys.executable, '-B', '-c', harness, str(root), json.dumps(cli_args or [])], env=env, check=True, capture_output=True)
            self.assertEqual(len((root / 'requests.jsonl').read_text().splitlines()), 2*len(spoken))
            return timeline, samples


if __name__ == '__main__': unittest.main()
