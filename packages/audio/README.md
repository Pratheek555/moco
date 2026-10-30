# @moco/audio

Voiceover (TTS, incl. Hindi and regional languages), music beds, SFX, and word-level timing so captions and actions line up with speech.

- `systemAudio({ voice, rate })` speaks with the voices that ship with the OS: `say` on macOS, SAPI on Windows, the user's installed espeak-ng on Linux (we never ship espeak-ng: it is GPL-3). Free and offline. The OS voices give no word timings, so each line's words are spread over that line's measured length.
- `placeholderAudio()` writes a silent WAV as long as the narration would take, with even word timings. Tests use it.
- The neural TTS choice (Hindi quality, licences) is still open: `docs/reference.md` R5. A real engine replaces these by implementing the same `tts()` / `align()` / `visemes()` shape.
