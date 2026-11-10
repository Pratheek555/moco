# @moco/audio

Voiceover (TTS, incl. Hindi and regional languages), music beds, SFX, and word-level timing so captions and actions line up with speech.

- `systemAudio({ voice, rate })` speaks with the voices that ship with the OS: `say` on macOS, SAPI on Windows, the user's installed espeak-ng on Linux (we never ship espeak-ng: it is GPL-3). Free and offline. The OS voices give no word timings, so each line's words are spread over that line's measured length.
- `placeholderAudio()` writes a silent WAV as long as the narration would take, with even word timings. Tests use it.
- `chatterboxAudio()` (`@moco/audio/chatterbox`) uses an explicitly installed local neural model. See [narration setup](../../docs/narration.md).
- `elevenLabsAudio({ apiKey, voiceId, rate })` (`@moco/audio/elevenlabs`) uses the user's ElevenLabs account and credits. It requests Multilingual v2 speech with original-text character timestamps and 22.05 kHz PCM, produces `vo.wav`, preserves per-line pauses and character voices, and returns measured word timings. Completed takes are cached atomically beside the audio; retries reuse matching takes. Credentials are excluded from the cache and provider errors. `elevenLabsVoices(apiKey)` lists the account's available voices, including all result pages. The desktop encrypts saved keys with Electron `safeStorage` and passes the decrypted key only to its narration backend.
