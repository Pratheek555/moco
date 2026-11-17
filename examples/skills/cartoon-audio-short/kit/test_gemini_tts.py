"""Offline contract tests; python -m unittest discover -s <helper-folder> -p test_gemini_tts.py."""
import base64
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import wave

import gemini_tts as tts


def wav_bytes():
    output = io.BytesIO()
    with wave.open(output, 'wb') as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000)
        wav.writeframes(b'\x80\x01\x80\xff' * 2400)
    return output.getvalue()


def reply(data=None, mime='audio/wav'):
    return {'steps': [{'type': 'model_output', 'content': [
        {'type': 'audio', 'mime_type': mime, 'data': base64.b64encode(wav_bytes() if data is None else data).decode()}
    ]}]}


class GeminiContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.output = Path(self.temp.name) / 'clause.wav'
        self.env = patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key-123', 'GOOGLE_API_KEY': 'test-ignored-key', 'MOCO_GEMINI_TTS_VOICE': 'Kore'})
        self.env.start()

    def tearDown(self):
        self.env.stop(); self.temp.cleanup()

    def test_request_style_voice_header_and_valid_wav(self):
        def fake(request, timeout):
            self.assertEqual(timeout, 30)
            self.assertEqual(request.get_header('X-goog-api-key'), 'test-key-123')
            self.assertNotIn('test-key', request.full_url)
            body = json.loads(request.data)
            self.assertEqual(body['model'], 'gemini-3.8-flash-tts')
            self.assertEqual(body['input'][0]['content'][0], {
                'type': 'text', 'text': 'The king forgot.', 'annotations': [{'type': 'speech_metadata', 'style': 'dryly amused'}]})
            self.assertEqual(body['generation_config']['speech_config'], [{'voice': 'Kore'}])
            self.assertFalse(body['store'])
            self.assertNotIn('test-key', request.data.decode())
            self.assertNotIn('test-ignored-key', str(request.headers))
            return io.BytesIO(json.dumps(reply()).encode())
        tts.synthesize('The king forgot.', self.output, style='dryly amused', opener=fake)
        self.assertEqual(self.output.read_bytes(), wav_bytes())
        self.assertFalse(self.output.with_name('clause.wav.tmp.wav').exists())

    def test_voice_precedence(self):
        self.assertEqual(tts.selected_voice('Puck'), 'Puck')
        self.assertEqual(tts.selected_voice(), 'Kore')
        os.environ.pop('MOCO_GEMINI_TTS_VOICE')
        self.assertEqual(tts.selected_voice(), 'Charon')
        with self.assertRaises(tts.NarrationError): tts.selected_voice('Unknown')

    def test_missing_key_does_not_use_google_key_or_make_a_request(self):
        os.environ.pop('GEMINI_API_KEY')
        with self.assertRaisesRegex(tts.MissingKey, 'existing local voice'):
            tts.synthesize('Hello', self.output, opener=lambda *a, **k: self.fail('Network attempted'))
        self.assertFalse(self.output.exists())

    def test_pcm_is_wrapped_once_and_wav_detected_by_bytes(self):
        data = b'\x80\x01\x80\xff' * 2400
        result = tts.audio_wav(reply(data, 'audio/L16;rate=24000;channels=1'))
        with wave.open(io.BytesIO(result), 'rb') as wav:
            self.assertEqual(wav.getframerate(), 24000); self.assertEqual(wav.readframes(wav.getnframes()), data)
        self.assertEqual(tts.audio_wav(reply(wav_bytes(), 'audio/l16')), wav_bytes())

    def test_bad_audio_is_not_written(self):
        for response in ({}, reply(b'bad', 'audio/wav'), reply(b'', 'audio/l16'), reply(b'1234', 'audio/l16;rate=8000'), {'steps': None}):
            with self.assertRaises(tts.NarrationError): tts.audio_wav(response)
        with self.assertRaises(tts.NarrationError):
            tts.synthesize('Hello', self.output, opener=lambda *a, **k: io.BytesIO(b'invalid'))
        self.assertFalse(self.output.exists())

    def test_transient_status_retried_once(self):
        attempts = []
        def fake(request, timeout):
            attempts.append(request)
            if len(attempts) == 1:
                raise urllib.error.HTTPError(request.full_url, 503, 'test-key-123', {}, io.BytesIO(b'test-key-123'))
            return io.BytesIO(json.dumps(reply()).encode())
        waits = []
        tts.synthesize('Hello', self.output, opener=fake, sleep=waits.append)
        self.assertEqual(len(attempts), 2); self.assertEqual(waits, [1])

    def test_auth_error_is_safe_and_not_retried(self):
        attempts = []
        def fake(request, timeout):
            attempts.append(request)
            raise urllib.error.HTTPError(request.full_url, 403, 'test-key-123', {}, io.BytesIO(b'test-key-123'))
        with self.assertRaises(tts.NarrationError) as caught:
            tts.synthesize('Hello', self.output, opener=fake)
        self.assertNotIn('test-key', str(caught.exception)); self.assertEqual(len(attempts), 1)
        self.assertTrue(caught.exception.__suppress_context__)

    def test_network_timeout_is_bounded_and_safe(self):
        attempts = []
        def fake(*a, **k):
            attempts.append(1); raise urllib.error.URLError('test-key-123')
        with self.assertRaises(tts.NarrationError) as caught:
            tts.synthesize('Hello', self.output, opener=fake, sleep=lambda _: None)
        self.assertEqual(len(attempts), 2); self.assertNotIn('test-key', str(caught.exception))

    def test_no_redirect_can_forward_a_key(self):
        self.assertIsNone(tts._NoRedirect().redirect_request(None, None, 302, 'redirect', {}, 'https://example.com'))


if __name__ == '__main__':
    unittest.main()
