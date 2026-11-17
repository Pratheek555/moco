"""Optional Gemini narration. Standard library only; no key in arguments, URLs or diagnostics.

Google's speech-generation guide (2026-11-16) uses the Interactions REST API.
Unary output is WAV; raw little-endian PCM is also accepted defensively.
"""
import argparse
import base64
import binascii
import io
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.request
import wave

MODEL = 'gemini-3.8-flash-tts'
DEFAULT_VOICE = 'Charon'
VOICES = (
    'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
    'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
    'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
)
ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'
MAX_RESPONSE = 32 * 1024 * 1024


class NarrationError(ValueError):
    """Safe to display: never contains Google's raw response or request details."""


class MissingKey(NarrationError):
    pass


def selected_voice(voice=None):
    choice = voice or os.environ.get('MOCO_GEMINI_TTS_VOICE') or DEFAULT_VOICE
    if choice not in VOICES:
        raise NarrationError('Choose one of the 30 Gemini prebuilt voices.')
    return choice


def request_body(text, voice=None, style=''):
    if not isinstance(text, str) or not text.strip():
        raise NarrationError('Gemini narration needs nonempty spoken text.')
    if not isinstance(style, str):
        raise NarrationError('Gemini style must be text.')
    part = {'type': 'text', 'text': text}
    if style:
        part['annotations'] = [{'type': 'speech_metadata', 'style': style}]
    return {
        'model': MODEL, 'store': False,
        'input': [{'type': 'user_input', 'content': [part]}],
        'response_format': {'type': 'audio', 'mime_type': 'audio/wav', 'sample_rate': 24000},
        'generation_config': {'speech_config': [{'voice': selected_voice(voice)}]},
    }


def audio_wav(response):
    """Read REST steps[].content[]; never mistake directions/text for audio."""
    try:
        blocks = [part for step in response.get('steps', []) if step.get('type') == 'model_output'
                  for part in step.get('content', []) if part.get('type') == 'audio']
        if not blocks:
            raise NarrationError('Google returned no narration audio.')
        part = blocks[-1]
        data = base64.b64decode(part['data'], validate=True)
        mime = part.get('mime_type', '').lower()
        if data[:4] == b'RIFF' and data[8:12] == b'WAVE':
            with wave.open(io.BytesIO(data), 'rb') as wav:
                if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() != 24000 or wav.getnframes() == 0:
                    raise NarrationError('Google returned an unsupported WAV format; expected 24 kHz mono PCM16.')
                if len(wav.readframes(wav.getnframes())) != wav.getnframes() * 2:
                    raise NarrationError('Google returned truncated WAV audio.')
            return data
        if mime.split(';')[0].strip() not in ('audio/l16', 'audio/pcm') or not data or len(data) % 2:
            raise NarrationError('Google returned an unsupported or empty audio format.')
        rate = re.search(r'(?:rate|samplerate)=(\d+)', mime)
        channels = re.search(r'channels=(\d+)', mime)
        if (rate and int(rate[1]) != 24000) or (channels and int(channels[1]) != 1):
            raise NarrationError('Expected 24 kHz mono PCM audio.')
        output = io.BytesIO()
        with wave.open(output, 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000); wav.writeframes(data)
        return output.getvalue()
    except NarrationError:
        raise
    except (KeyError, TypeError, AttributeError, ValueError, binascii.Error, wave.Error, EOFError):
        raise NarrationError('Google returned malformed narration audio.') from None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _open(request, timeout):
    return urllib.request.build_opener(_NoRedirect()).open(request, timeout=timeout)


def synthesize(text, output, voice=None, style='', *, opener=None, sleep=time.sleep):
    # Deliberately do not use GOOGLE_API_KEY or an SDK's credential autodetection.
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    if not key:
        raise MissingKey('GEMINI_API_KEY is absent. Use the skill\'s existing local voice or uploaded narration.')
    if len(key) > 256 or any(ord(c) < 33 or ord(c) > 126 for c in key):
        raise NarrationError('GEMINI_API_KEY is malformed. Enter it again in Moco settings.')
    body = json.dumps(request_body(text, voice, style)).encode('utf-8')
    request = urllib.request.Request(ENDPOINT, data=body, headers={
        'Content-Type': 'application/json', 'x-goog-api-key': key,
        'Api-Revision': '2026-05-20',
    }, method='POST')
    for attempt in range(2):
        try:
            with (opener or _open)(request, timeout=30) as response:
                data = response.read(MAX_RESPONSE + 1)
            if len(data) > MAX_RESPONSE:
                raise NarrationError('Google returned too much audio. Split the narration into shorter clauses.')
            try:
                parsed = json.loads(data)
            except (ValueError, UnicodeError):
                raise NarrationError('Google returned an unexpected narration response.') from None
            audio = audio_wav(parsed)
            break
        except urllib.error.HTTPError as error:
            status = error.code
            error.close()
            if status in (400, 401, 403):
                raise NarrationError('Google rejected the narration request. Check the key, API access, text and voice settings.') from None
            transient = status == 429 or 500 <= status <= 599
            if not transient or attempt == 1:
                raise NarrationError('Google could not generate narration. Check quota/model access and try again later.') from None
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt == 1:
                raise NarrationError('Could not reach Google for narration. Check the connection and try again.') from None
        if attempt == 0:
            sleep(1)
    output = Path(output)
    temp = output.with_name(output.name + '.tmp.wav')
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        temp.write_bytes(audio); temp.replace(output)
    except OSError:
        raise NarrationError('Could not write the narration WAV at the requested path.') from None
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', help='Destination WAV')
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--text', help='Only the words to speak')
    inputs.add_argument('--text-file', help='UTF-8 spoken transcript')
    parser.add_argument('--voice', choices=VOICES)
    parser.add_argument('--style', default='', help='Delivery direction, never spoken text')
    args = parser.parse_args()
    try:
        text = args.text if args.text is not None else Path(args.text_file).read_text(encoding='utf-8-sig')
        synthesize(text, args.output, args.voice, args.style)
    except (NarrationError, OSError, UnicodeError) as error:
        message = str(error) if isinstance(error, NarrationError) else 'Could not read the narration transcript.'
        parser.exit(2, message + '\n')


if __name__ == '__main__':
    main()
