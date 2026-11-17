"""Dia's recommended empty next-speaker marker lets the last word finish.

Text-only framing stays separate from the shared audio adapter, so changing a
Dia utterance hint does not invalidate Kokoro or Zonos audio caches.
"""
import re


def ending_hint(text):
    """Accept validated speaker-tagged text; preserve an explicit ending tag."""
    text = text.strip()
    if re.search(r'\[S[12]\]$', text): return text
    tags = re.findall(r'\[S[12]\]', text)
    if not tags: raise ValueError('Dia ending hints require speaker-tagged text.')
    return text + (' [S2]' if tags[-1] == '[S1]' else ' [S1]')


def configure(voice, enabled):
    """Configure a newly created voice before its anchor or any clause is used."""
    from tts import file_hash
    voice.identity.update(diaEndingHint=enabled, diaTextProcessor=file_hash(__file__))
    if not voice.voice.get('audio_prompt'):
        # Automatic anchors need the same ending treatment and their own key.
        voice.identity.pop('anchor', None); voice.identity.pop('anchorText', None)
        voice._anchor_spec()
    if enabled:
        original = voice._dia_text
        voice._dia_text = lambda text: ending_hint(original(text.strip()))
