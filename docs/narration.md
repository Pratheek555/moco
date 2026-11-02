# Expressive local narration

The desktop defaults to system speech, including for existing settings without a backend choice. Chatterbox is an optional download: English and multilingual (including Hindi) models are offered separately. Downloading a model never selects it automatically. Neural failures are shown as errors; they never silently substitute the OS voice.

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

The CLI setup creates an isolated Python 3.11 environment in `.venv-voice` and installs `chatterbox-tts==0.1.7`. The separate, explicit download command writes model weights into `artifacts/voice-models/english` (or `multilingual` when requested). This development environment is separate from the desktop's user-data installation. Nothing sends your script or voice recording to a synthesis service.

Both preview and production use the same backend and downloaded model directories. On GPUs below 6 GB the automatic device choice is CPU, preserving memory for the renderer. CPU synthesis can be substantially slower than playback. The development CLI additionally accepts `MOCO_VOICE_PYTHON`, `MOCO_VOICE_REFERENCE`, and `MOCO_VOICE_MODEL_DIR` overrides.

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

Rendered lines are cached in `.voice-cache` beside the episode audio, keyed by text, performance, speed, seed, language and reference content. Editing a pause reuses the original take; editing a line or reference regenerates affected speech. The worker is not started when every take is cached.

## Practical limits

The local model is a meaningful step beyond SAPI, but a human audition is still required to approve pronunciation, prosody, unwanted breaths, repetitions and emotional credibility. To improve a weak take, first rewrite the phrase as something a narrator would actually say, then try a better matched reference. More exaggeration is not always better.

Models, Python and neural dependencies are not bundled in the desktop application. The optional installer requires uv. The existing application's engine packaging limitations described in `engine-host.ts` still apply; this change ships voice worker scripts, not a complete repair of the packaged engine. No music bed, sidechain ducking, forced aligner or emotion classifier is introduced by this change.

Validation includes TypeScript, a desktop production build, installer/default tests, downloader byte-accounting tests, and an isolated Electron UI check using fixtures. After the runtime dependency repair, `pnpm --filter @moco/desktop test:voice-audio` clicked the real Hear it button, generated 5.84 seconds of Hindi narration using the already installed multilingual model, observed the media `playing` event, and fetched the WAV through the app's asset protocol. The sample is saved as `artifacts/voice-settings/hindi-preview.wav`. The test uses an isolated profile pointing to existing model files, not fixture weights. This verifies synthesis and playback; emotional quality still requires listening. The earlier broad test run hit the existing pipeline test's 5-second timeout under load; its full rerun passed with two workers.

Upstream implementation and tuning: [Chatterbox](https://github.com/resemble-ai/chatterbox), [English synthesis API](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts.py).
