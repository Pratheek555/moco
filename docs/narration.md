# Voice narration

## ElevenLabs with your own API key

In Settings → Voice & narration, select **ElevenLabs · your API key**, paste an ElevenLabs API key with **Text to Speech** and **Voices** read permissions, and click **Load my voices**. Choose an account voice, or paste its voice ID, then **Save changes**. **Hear it** previews the saved configuration. Previews and episode narration send script text to ElevenLabs over HTTPS and use your account's credits; an internet connection is required. System speech remains the default.

Saved keys are encrypted with the OS credential protection through Electron `safeStorage`. Moco refuses to save a key if secure storage is unavailable (including Linux's `basic_text` fallback). The key is never returned by Settings, written to project artifacts or audio caches, or included in provider error messages. Leave the key field blank to retain a saved key, enter a new one to replace it, or choose **Remove key and use system speech**, then save, to delete it. Copying settings to another machine or OS user may require entering the key again.

The backend uses **Eleven Multilingual v2**, supporting English, Hindi, Tamil and its other documented languages. Unsupported story languages are marked unavailable in the composer. Narration speed is 0.7–1.2×. No local voice model, Python runtime or speech aligner is needed for ElevenLabs, including Canvas productions. The timestamp endpoint returns original-text character timings; Moco groups these into script words and adds each line's directed pause. Audio is requested as 22.05 kHz signed 16-bit PCM and saved as WAV. Missing or invalid provider timings produce an error rather than estimated caption boundaries. Emotion directions are not translated into ElevenLabs performance controls; the selected voice, text, surrounding context and speed guide delivery.

The approved narrator ID is retained for each series. New show bibles can assign character voices from the account's available list; keep those voices accessible for later episodes. For an existing illustrated series, the Next episode card offers **Episode narrator → Use narrator from Settings**. This explicitly saves the selected narrator with that episode's script review, leaves earlier episodes and the series bible untouched, and carries the choice forward when later episodes inherit their narrator. Character voice assignments stay the same and must remain available on the selected backend. Without this explicit choice, a series approved with another backend requires that backend to be selected before narration; Moco never silently substitutes a voice. Completed ElevenLabs takes are cached in `.voice-cache` beside the episode audio. Retries reuse matching takes, including when only a pause changes. Editing speech, adjacent context, language, voice or speed regenerates affected takes. Failed requests are not automatically retried because they may have consumed credits.

`pnpm --filter @moco/desktop test:elevenlabs` checks Settings, real encrypted storage, account voice selection, preview playback and key removal with stubbed provider responses. Unit tests cover measured word timings, character voices, cancellation, paid-request failure recovery and credential redaction. These checks use no real API key or credits; a live account audition is still needed to assess voice quality.

API references: [speech with timestamps](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps), [account voice search](https://elevenlabs.io/docs/api-reference/voices/search), [supported models and languages](https://elevenlabs.io/docs/overview/models).

## Local narration

The desktop defaults to system speech, including for existing settings without a backend choice. Chatterbox is an optional download: English and multilingual (including Hindi) models are offered separately. Downloading a model never selects it automatically. Neural failures are shown as errors; they never silently substitute the OS voice.

Scripts can mix narration and character dialogue. New show bibles can assign each character a voice from the configured backend's available list. In Chatterbox Settings, **Character voices** accepts unique lowercase names (for example `warm-guide`) and paths to clean reference recordings. Save these before creating the show bible; its cast review displays the chosen voice ids. Keep those ids and recordings available for later episodes. Without a character assignment, dialogue uses the configured narrator voice.

Speaker changes retain the script order, directed pauses and caption timings. Generated characters lip-sync only to their own lines; narration leaves their mouths at rest. Word timings remain estimates within measured audio clips, so this is amplitude-based mouth animation rather than phoneme-level alignment. Existing audio without speaker metadata retains its previous behaviour.

## Desktop model downloads

Open Settings → Voice & narration → Optional voice models. Each card shows its approximate size, a Download button, progress, Cancel, retryable errors and installed status. During a model transfer the shadcn Progress component shows actual MB downloaded, total MB and MB left for the entire model. Totals come from the pinned repository's file metadata; cached files and resumed bytes are included. Runtime installation and size lookup use indeterminate progress until byte totals are known. MB uses decimal units (1 MB = 1,000,000 bytes); runtime/dependency downloads are a separate preparation phase, not included in the model byte totals. The model for your default story language must be installed before you can select Chatterbox. After downloading, choose Chatterbox in Voice engine and save. Other series languages require their corresponding model too; missing models produce an explicit Settings error.

Downloads require [uv](https://docs.astral.sh/uv/getting-started/installation/) on PATH. If it is missing, the app shows an actionable error and a link to install it. Only after Download is clicked does Moco install an isolated Python 3.11 voice runtime with `chatterbox-tts==0.1.7` and fetch the selected weights. Allow about 3 GB per model plus several GB for the shared runtime. Cancelled/incomplete downloads can be retried; they are not marked ready.

The runtime also pins `setuptools==80.9.0`: Perth imports `pkg_resources`, which is absent in a bare uv environment and removed from newer setuptools. Without it Perth silently exposes `PerthImplicitWatermarker = None` and Chatterbox crashes during initialization. Installation now checks that the real watermarker can be constructed before marking the runtime ready. No watermark bypass is used.

Runtime and models live under `<userData>/voice/`, outside the application bundle. The package includes only the small worker scripts. Downloads pin the model revision; an atomic completion marker records file sizes, which are checked before the model is offered. Synthesis loads local files with Hugging Face/Transformers offline mode enabled. Startup, preview, and video generation never download model weights.

## Development CLI

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then from the repository root:

```
pnpm voice:setup
pnpm voice:download english
pnpm voice:demo
pnpm dev
```

The CLI setup creates an isolated Python 3.11 environment in `.venv-voice` and installs `chatterbox-tts==0.1.7`. The separate, explicit download command writes model weights into `artifacts/voice-models/english` (or `multilingual` when requested). This development environment is separate from the desktop's user-data installation. The local Chatterbox backend never sends your script or voice recording to a synthesis service.

Both preview and production use the same backend, processing device and downloaded model directories. In Settings → Voice & narration, Chatterbox's **Narration processing** selector offers **Automatic**, **CPU**, and **GPU**. Automatic preserves the existing conservative policy: CUDA GPUs below 6 GB use CPU. Explicit GPU bypasses that cutoff and uses available CUDA or Apple MPS; unavailable GPU support and insufficient GPU memory produce an error instead of silently switching to CPU. CUDA requires a GPU-enabled PyTorch build in the voice runtime. The saved choice applies to both Hear it and episode narration; system speech continues to use the OS voice. Existing settings default to Automatic. CPU synthesis can be substantially slower than playback. The development CLI additionally accepts `MOCO_VOICE_PYTHON`, `MOCO_VOICE_REFERENCE`, and `MOCO_VOICE_MODEL_DIR` overrides.

`pnpm voice:demo` writes `artifacts/voice-demo/vo.wav` and its script/timing manifest. This is an original dramatic narration sample, not a historical quotation. Audition the hook, the transition into loss, the warmth of reassurance, and the final resolve. A successful synthesis or a loudness measurement is not a listening quality verdict.

## Direct the performance

Script lines now support:

```json
{
  "id": "l01",
  "text": "He had the power to win. So why did he lower his bow?",
  "beat": "Arjuna hesitates",
  "speaker": "narrator",
  "delivery": { "emotion": "tense", "intensity": 0.65, "pauseAfterMs": 650 }
}
```

Available emotions: `neutral`, `warm`, `tense`, `awed`, `grieving`, `resolute`. Old scripts remain valid. Directions stay outside the spoken text and captions. The writing prompt asks for connected, speakable thoughts, restraint, and an emotional arc. Each line's measured audio plus its deliberate silence determines the timeline. Timings within a line remain proportional estimates, **not forced alignment**.

Chatterbox's native control is exaggeration/CFG, not a categorical emotion instruction. The emotion/intensity mapping adjusts that control conservatively; it does **not** guarantee sadness or warmth. Clean performance references are the strongest available control. Use 6–10 seconds of a narrator recording with minimal music, reverb or noise. Keep one narrator identity across the episode. The library also supports `emotionReferences` in `chatterboxAudio()` for matching performances by the same narrator. Those per-emotion references are not exposed in the desktop picker yet.

The worker loads a model once for the episode, uses reproducible seeds, trims excess edge silence while retaining 60 ms, and levels each line toward −16 LUFS with gain capped at 12 dB and a sample-peak ceiling around −1 dBFS. This is gain leveling, not a brickwall compressor or true-peak mastering. Speed changes use pitch-preserving time stretch; keep them close to 1 for natural delivery. Do not compress the entire performance into a duration target: revise the wording and pauses instead.

Rendered lines are cached in `.voice-cache` beside the episode audio, keyed by text, performance, speed, seed, language and reference content. Each completed take is committed atomically before the next line starts, so a timeout, cancellation or later failure preserves completed work. Retry speaks only missing or damaged takes, keeping the original line seeds and order. Editing a pause reuses the original take; editing a line or reference regenerates affected speech. The worker is not started when every take is cached.

There is no fixed 30-minute limit for a whole episode. A 30-minute watchdog starts when the model worker launches and resets after each saved line; model loading or a single line making no progress for that long still stops the worker and its process tree. Production activity reports saved lines, including takes reused from the cache. This permits slow CPU narration to finish without hiding a stalled model, but does not make CPU synthesis faster.

Local Canvas narration checks the recording with local faster-whisper before cutting shots. It transcribes without a script prompt, then compares the recognized words with the script and maps their measured timestamps to line IDs. Passing the script opening as preceding speech caused the recognizer to skip recorded opening lines in a real take. Missing-line and transcript-similarity checks remain enabled; estimated word timings are not substituted when recognition fails. ElevenLabs Canvas narration uses its validated provider timestamps instead.

## Practical limits

The local model is a meaningful step beyond SAPI, but a human audition is still required to approve pronunciation, prosody, unwanted breaths, repetitions and emotional credibility. To improve a weak take, first rewrite the phrase as something a narrator would actually say, then try a better matched reference. More exaggeration is not always better.

Models, Python and neural dependencies are not bundled in the desktop application. The optional installer requires uv. The existing application's engine packaging limitations described in `engine-host.ts` still apply; this change ships voice worker scripts, not a complete repair of the packaged engine. No music bed, sidechain ducking, forced aligner or emotion classifier is introduced by this change.

Validation includes TypeScript, a desktop production build, installer/default tests, downloader byte-accounting tests, and an isolated Electron UI check using fixtures. After the runtime dependency repair, `pnpm --filter @moco/desktop test:voice-audio` clicked the real Hear it button, generated 5.84 seconds of Hindi narration using the already installed multilingual model, observed the media `playing` event, and fetched the WAV through the app's asset protocol. The sample is saved as `artifacts/voice-settings/hindi-preview.wav`. The test uses an isolated profile pointing to existing model files, not fixture weights. This verifies synthesis and playback; emotional quality still requires listening. The earlier broad test run hit the existing pipeline test's 5-second timeout under load; its full rerun passed with two workers.

Upstream implementation and tuning: [Chatterbox](https://github.com/resemble-ai/chatterbox), [English synthesis API](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts.py).
