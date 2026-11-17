# Free local narration voices

The story's `voice.engine` selects `kokoro` (default), `zonos` or `dia`. Setup installs only the selected engine; it never calls an inference API. Existing stories and the worked example retain Kokoro's name/speed/language defaults, trimming and gain. An uploaded recording (`film.py prepare ... --voice recording.wav`) bypasses all TTS engines.

## Install and resume

```powershell
# Use Python 3.10–3.12 for either expressive engine; Node 22+ is also required.
python <skill>/kit/setup.py <workspace>/film --tts zonos
python <skill>/kit/setup.py <workspace>/film --tts dia
python <skill>/kit/setup.py <workspace>/film --tts kokoro --models <cached-kokoro-folder>
python <skill>/kit/setup.py <workspace>/film --tts none
# --no-tts is the existing alias for --tts none.
```

Use the printed `.venv/Scripts/python.exe` on Windows (`.venv/bin/python` on macOS/Linux) for every `film.py` command. PowerShell needs `&` before a quoted executable. Each run adds/configures the chosen engine in that **same venv**, keeping other engines and creative files. `none` skips installation/download; it does not uninstall existing engines. Rerunning setup never overwrites existing kit sources either: when upgrading an older working copy, review/update its runtime/support files from the new kit or start a fresh working copy and bring your creative modules across.

`--tts` chooses what to install; `voice.engine` chooses what to speak. Setup preserves the worked example's Kokoro voice. After installing only Zonos or Dia in a fresh folder, set that engine in your story before `prepare`, or also install Kokoro to run the unchanged example.

For an expressive engine, setup refuses an older/custom `film.py` without engine dispatch before installing heavy dependencies. It preserves that file and points to the updated source to merge, preventing an old runtime from silently using Kokoro. Legacy Kokoro checksum records are carried into the per-engine manifest when the combined manifest is updated.

Setup checks the existing venv's Python too. If an earlier Kokoro environment uses Python 3.13/3.14, invoking setup with Python 3.11 does not convert that environment; keep it and use a fresh working copy, or back up/rename the old venv first. Setup never deletes or replaces it automatically.

Model downloads live under `MOCO_VOICE_CACHE` (default `~/.cache/moco-ink-history`); expressive models are separated by immutable weights revision. Direct public Hugging Face downloads resume in bounded `.parts` byte ranges, avoiding Windows symlink/long-path cache issues. `tts-models.json` locks file sizes and SHA-256 checksums, including configs, tokenizer files and codec weights. Setup validates all locked files before enabling an engine. Corruption fails explicitly; move the named corrupt file/parts aside and rerun. `voice-models.txt` combines the per-engine checksum records, so adding Dia does not erase Kokoro/Zonos provenance. `config.json` keeps local model/library paths and device selection; do not distribute it as a portable kit.

Downloads use persistent TLS connections with four bounded transfers by default. `MOCO_TTS_DOWNLOAD_JOBS=1..16` adjusts concurrency for a slow link; completed parts survive interruptions and setup changes. No Hugging Face token is needed and the downloader does not read `.netrc` credentials. A failed part cancels queued requests, retains completed parts and fails setup rather than enabling partial weights.

`--device auto` detects NVIDIA VRAM before installing torch: CUDA is selected only with at least 6 GB; smaller GPUs use CPU. `--device cpu` forces CPU; `--device cuda` requires sufficient VRAM and a working CUDA runtime. CUDA wheels are torch/torchaudio **2.6.0, CUDA 12.4** (no separate CUDA toolkit required). A 6 GB card can still run out of memory with long prompts/clauses or other apps using VRAM. There is no silent device switch after generation starts. CPU can take minutes per clause and is generally impractical for 12–18 minute narration. `precision: 'int8'` optionally quantizes the large linear layers dynamically on CPU to reduce memory/compute (audition for quality); default CPU is `float32`. CUDA defaults to `float16`; `bfloat16` is available only on hardware that supports it. `float16` CPU is rejected.

Windows uses prebuilt Python wheels; Zonos uses the pure PyTorch **transformer** backbone, with compilation disabled by default. No Mamba, FlashAttention, Triton, Gradio or build toolchain is installed. Zonos's source is installed editable from its checksummed upstream commit because its wheel package finder omits the backbone subpackage.

Setup prefers an already installed `uv` for optional dependency installation and otherwise uses pip, always targeting the same working venv. The kit makes one recorded, checksummed compatibility edit to upstream Zonos: defer loading the very large Japanese dictionary until Japanese text is used. English does not download that dictionary. For Japanese narration, additionally run the working Python's `-m pip install -r <kit>/requirements-zonos-japanese.txt` (pins `SudachiDict-full==20241021`). The upstream source archive remains unmodified in the cache; the manifest records the edited `conditioning.py` separately.

Pinned torch 2.6 has no Intel macOS wheel; setup explains this and suggests Kokoro/uploaded speech or a supported machine. Apple Silicon uses CPU in this kit. Upstream Zonos declares Gradio and the full dictionary as package dependencies; this kit deliberately installs its pinned inference-only dependencies with the source package's dependency resolution disabled.

Zonos also needs the eSpeak NG shared library. Setup looks for `--espeak-library <path>`, `PHONEMIZER_ESPEAK_LIBRARY`, the system library search path and standard Windows/Homebrew locations, then the pinned `espeakng-loader` bundle (includes the Windows DLL/data). A supplied path must load as a native library, not just point at the `espeak-ng` executable. Install native eSpeak NG if needed: 64-bit eSpeak NG on Windows; `brew install espeak-ng` on macOS; `apt install espeak-ng libespeak-ng1` on Debian/Ubuntu. The resolved library is saved in config. FFmpeg/ffprobe are located/installed by normal kit setup. macOS/Apple Silicon uses CPU for these pins; MPS is not enabled. Linux can use CPU or CUDA. Only the current machine's Windows path is locally verified; do not claim the other platforms were tested here.

## Story options

Kokoro is unchanged: `{ engine: 'kokoro', name: 'bm_george', speed: 1.12, lang: 'en-gb' }`. All fields, including `engine`, may be omitted. Other engines deliberately do not reinterpret Kokoro's `speed`/`lang`/`name` options; unsupported options fail.

Zonos:

```js
voice: {
  engine: 'zonos', seed: 217,
  reference: './narrator.wav', // optional authorized speaker clip; story-relative
  conditioning: {
    language: 'en-us', speaking_rate: 15, pitch_std: 70,
    emotion: [.5, .02, .02, .02, .15, .02, .07, .2],
  },
  generation: { cfg_scale: 2, max_new_tokens: 1720,
    sampling_params: { min_p: .1 } },
}
```

`conditioning` is passed to pinned Zonos `make_cond_dict`: `language`, `emotion`, `speaking_rate`, `pitch_std`, `fmax`, `vqscore_8`, `ctc_loss`, `dnsmos_ovrl`, `speaker_noised`, `unconditional_keys`. Text, device and speaker embedding are managed by the kit. Emotion order: happiness, sadness, disgust, fear, surprise, anger, other, neutral (nonnegative values, nonzero sum). The upstream usual speaking-rate range is 10–30 (15 default), pitch standard deviation 20–45 for neutral or 60–150 for expressive speech. These condition the model; they are not postprocessing speed/pitch changes. The transformer ignores some hybrid-only quality conditioners. `generation` accepts `cfg_scale` (must differ from 1), `max_new_tokens`, `sampling_params` (upstream sampling dictionary), `progress_bar`, `disable_torch_compile` (keep true on Windows/CPU). The kit defaults to 1720 audio frames, about 20s, and fails on exhaustion rather than silently using a cut-off clause. Prefer clauses under 15s.

Audition pitch/sampling settings together with the actual reference. In Windows CPU int8 testing, `pitch_std: 65` with upstream `min_p: .1` repeatedly stopped immediately on some short example clauses. Neutral pitch or `min_p: .01` produced audio for the probe, but this did not establish narration quality. The runtime never changes these requested conditioning/sampling settings automatically. Dynamic int8 quantization is experimental and can introduce wording errors; use the default float32 as the CPU quality baseline.

Dia:

```js
voice: {
  engine: 'dia', seed: 217,
  audio_prompt: {
    path: './narrator.wav',
    transcript: '[S1] These are exactly the words in my reference recording.',
  },
  generation: { max_new_tokens: 1720, guidance_scale: 3,
    temperature: 1.8, top_p: .9, top_k: 45, do_sample: true },
}
// say: ['The king had a plan. (sighs) The treasury had other ideas.']
```

English only. Untagged clauses receive `voice.speaker` (`'S1'` default, or `'S2'`). Explicit `[S1]`/`[S2]` and nonverbal tags are preserved, not read as stage directions by the kit. Use tags sparingly: `(laughs)`, `(clears throat)`, `(sighs)`, `(gasps)`, `(coughs)`, `(chuckle)`, `(groans)` and the other tags listed by upstream can produce artifacts. Speaker tags within a dialogue must alternate. A prompt with a single `[S1]` speaker anchors a narrator; a stable second speaker requires a supplied prompt/transcript covering both speakers. The kit merges adjacent identical prompt/clause speaker markers, encodes the fixed prompt and prepends its exact transcript for each generation, then decodes **only new audio**. The prompt must not be heard again in each clause.

For narration, `prepare` adds the upstream-recommended empty next-speaker tag to each Dia clause by default: `[S2]` after `[S1]` speech, or `[S1]` after `[S2]` speech. It also applies to automatic anchor generation. This helps the model finish the last word before stopping; short test clauses otherwise lost word endings. An explicit trailing speaker tag is preserved. This requests an empty ending-quality hint and leaves the story's `say` text/cue names unchanged. Actual `[S2]` speech still needs a two-speaker prompt. Set `voice.ending_hint: false` for explicit control; the choice and text-framing code are included in the Dia cache identity and timeline metadata. Automatic anchor keys include that policy too. This framing step does not invalidate Kokoro/Zonos caches.

Dia `generation` accepts exactly `max_new_tokens`, `guidance_scale`, `temperature`, `top_p`, `top_k`, `do_sample`. Its text encoder has a 1024-token context (UTF-8 bytes plus tags), and the decoder has 3072 frames (about 35s) **including the prompt**. The kit checks these limits and fails on exhausted generation. Use a clean 5–10s prompt (3–10s allowed); do not feed a full previous shot as an ever-growing prompt. Upstream advises roughly 5–20s of generated speech per request; very short isolated clauses may sound unnatural. Audition the actual clause boundaries, especially for comedy.

The reference's codec tokens are reused within a prepare run, but Dia still processes the acoustic prompt with each new clause. Short fragments therefore have substantial CPU overhead. Use complete utterances where the picture's cue structure permits, keeping the prompt plus output within the context limits above.

If a short continuation fragment gets an unwanted long pause/ad-lib with the ending tag, override just that clause: `clause_ending_hints: { 'armies:2': false }` inside `voice` uses the shot ID and **zero-based** clause index. Each resolved hint choice affects only that clause's cache; other clips and the fixed speaker anchor are reused. `voice-performance.json` records each clause's actual choice. This is a manual performance control, not a way to bypass motion or picture gates; run `prepare` and preflight again after changing it.

Both expressive engines also accept `clause_seeds: { 'bucket:1': 218 }` for a targeted retake. The base seed still creates/identifies the fixed speaker anchor; the selected clause uses its override (and the usual +1/+2 retry variants if rejected). Other clause caches are reused. These controls help audition stochastic errors; they do not guarantee faithful words or eliminate Dia's weakness on very short fragments.

Both expressive engines accept a base `seed` (default 217, reset after lazy loading for every clause), `precision`, and `anchor_text` (script for automatic anchor generation). Without a supplied reference, the kit generates one voice anchor once, stores its untrimmed full audio and exact transcript under `work/voice-anchors/`, and reuses it for all clauses, cache hits, resumes and out-of-order regeneration. It does not chain new output into the next prompt. Listen to that anchor before a long film. To change the generated speaker, change `seed` or `anchor_text`; to preserve it between films, pass the saved WAV as the explicit reference/prompt with its saved transcript. A reference can guide identity but is not a guarantee of perfect speaker stability. Listen for drift/repetition; changing a clause's wording regenerates that clause, while changing global voice options invalidates all clause caches.

Generative engines can occasionally stop immediately and return a tiny audio blip. The kit rejects silent, invalid or implausibly short output (under 0.12s or twelve spoken words per second), retries at most twice with base seed +1/+2 and the **same** speaker anchor, and fails `prepare` if none passes. Successful retry seeds are recorded beside the cached WAV and in `voice-performance.json`. This duration check does not transcribe speech or establish that every word was pronounced; listen to the audition and finished narration. A motion preflight alone cannot detect missing words.

Each cache key covers engine, all options, seed, pinned model fingerprint, device/precision, reference WAV **bytes**, prompt transcript and processing code. Changing a file at the same reference path invalidates the old clause cache. Clips are written atomically. `prepare` never fetches an implicit model/codec: all model loads are offline from setup's pinned local directories. Cached clauses require no model load. All synthesized audio is resampled to 24 kHz mono, then trimmed with the existing onset/tail/fade rule; expressive output is matched to active RMS .12 with peak <=.95, while Kokoro retains its exact previous gain. The existing sound mix and final two-pass −16 LUFS normalization remain unchanged.

`timeline.json.voice` records engine, options, base seed/retry policy, device/precision, model fingerprint and anchor hash/path/transcript. `voice-performance.json` records total prepare speech time and audio/runtime/cache status and actual generation seed per clause. Voice changes invalidate the measured timeline/review as before. After changing voices, run `prepare`, then `stills`/`motion` and inspect the new timings; a slower performance can make a previously good shot hold too long. Never loosen the motion gate to accommodate it.

## Exact licence and provenance pins

Verified primary sources on 2026-11-12. Both primary engines' code and weights are Apache-2.0, permitting commercial use such as YouTube narration. Auxiliary dependencies retain their own licences; this does not make every dependency Apache-2.0.

| Component | Pinned source/revision | Licence evidence |
| --- | --- | --- |
| Zonos inference code | [`bc40d98e1e1ab54fc65c483be127a90e3c7c0645`](https://github.com/Zyphra/Zonos/tree/bc40d98e1e1ab54fc65c483be127a90e3c7c0645) | [Apache-2.0 LICENSE](https://github.com/Zyphra/Zonos/blob/bc40d98e1e1ab54fc65c483be127a90e3c7c0645/LICENSE) |
| Zonos transformer weights | `Zyphra/Zonos-v0.1-transformer`, `9d8331fc49cb5ba8aad2bb56cafd809c66598f4e` | [Apache-2.0 model card](https://huggingface.co/Zyphra/Zonos-v0.1-transformer/blob/9d8331fc49cb5ba8aad2bb56cafd809c66598f4e/README.md) |
| Zonos speaker encoder/LDA weights | `Zyphra/Zonos-v0.1-speaker-embedding`, `9fe3dbdc3c703a8cf7141b2d0f550f6d55f67260` | [Apache-2.0 model card](https://huggingface.co/Zyphra/Zonos-v0.1-speaker-embedding/blob/9fe3dbdc3c703a8cf7141b2d0f550f6d55f67260/README.md) |
| Dia inference implementation used by this kit | Hugging Face `transformers==4.53.3`, official Dia implementation (also used for DAC) | [Apache-2.0 source](https://github.com/huggingface/transformers/tree/v4.53.3/src/transformers/models/dia), [LICENSE](https://github.com/huggingface/transformers/blob/v4.53.3/LICENSE) |
| Nari Labs Dia weights | `nari-labs/Dia-1.6B-0626`, `ef2795fcc29c5abe6ffc91fd33808588b49bbc66` | [Apache-2.0 model card and official Transformers usage](https://huggingface.co/nari-labs/Dia-1.6B-0626/blob/ef2795fcc29c5abe6ffc91fd33808588b49bbc66/README.md) |
| Shared DAC codec weights | `descript/dac_44khz`, `c1bc521685adf9cfe247bc39a5ca58917eda1ac4` | [Upstream explicitly releases weights under MIT](https://github.com/descriptinc/descript-audio-codec#weights); the HF card itself omits licence metadata |

Torch/torchaudio 2.6.0 use BSD-style licences; phonemizer/eSpeak NG use GPL-3.0; the Zonos Japanese dictionaries have their own redistribution notices. These free local dependencies do not require a paid service or license the narration as GPL. Retain upstream notices if redistributing tooling/weights. Nari's model card also asks users to avoid unauthorized identity imitation, deceptive content and malicious use; supply original narration or authorized reference clips. No reference narrator's recording is bundled with the kit.
