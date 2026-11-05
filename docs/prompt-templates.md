# Prompt templates

In Templates, choose **Paste a prompt**, supply a name and your full instructions,
and choose portrait or landscape. Both use 1080p at 60 fps. An optional length
overrides duration references in the prompt; otherwise the show planner proposes
the prompt's duration for approval. Save, then enter the episode topic in Studio.
You can attach up to five PNG, JPEG or WebP style frames (under 3 MB each).
They are copied into the template, attached to planning/authoring on vision-capable
backends, and included in independent visual review. Changing their bytes changes
the prompt and scene reuse hashes. They guide style, not copied logos or characters.

Prompt templates select the authored-canvas pipeline automatically. They skip
kit casting, 3D world/model construction, and world review. Existing 3D templates
keep their original behavior. The local-only choice is stored with the template:
procedural canvas art, configured local narration and installed fonts replace
remote image/voice generation. Stock soundtrack acquisition and automatic
publishing are omitted. These are limitations, not claims of visual/audio parity.

The series plan and show bible are approved first. Production limitations appear
in the bible review. Next, the script gate shows each spoken line, its word count,
estimated seconds and picture. Narration cannot run until this gate is approved.
The later shot list uses measured word times while retaining the approved visual
plan. Source previews, independent visual review/repair, preview approval and
final export continue through the ordinary engine.
The desktop host requests local faster-whisper alignment for prompt-template narration.
It uses `.venv-learn` by default, or `MOCO_ALIGN_PYTHON` for another installed
runtime. Run `pnpm learn:setup` to install its Python dependencies and cache the
`small` Whisper model before an offline run. `MOCO_ALIGN_MODEL` can name an
already cached model or local model directory. Missing alignment stops the
canvas voice stage with setup guidance rather than silently estimating words.
The first authored shot is independently reviewed before the rest of the episode
is generated, so a broken shared character rig can be corrected early.

The complete creative prompt is included in every planning stage and artist
authoring call, and is also available as `templateBrief` in each artist brief.
Template content participates in prompt hashes and scene reuse keys. Prompts are
instructions to the application's available tools, not executable installation
scripts: asking for an unavailable model/tool does not install or purchase it.

Templates are saved atomically under the existing styles folder using
`moco-template.json` (including `creativePrompt` and `production`) and a readable
`moco-template.md`. They are listed alongside learned templates and can be
removed through the existing template controls when no series uses them. Explicit format settings avoid
guessing from example resolutions or negated instructions in long prompts.

The two supplied prompts are in `examples/templates/`. Run real application
benchmarks with:

```powershell
node --import tsx scripts/template-benchmark.ts roblox
node --import tsx scripts/template-benchmark.ts infographic
```

These use the authenticated Codex CLI, local Kokoro ONNX model and
faster-whisper runtime. Install `kokoro-onnx==0.6.1` and `soundfile==0.14.0`
in `.venv-learn` and place `kokoro-v1.0.onnx` and `voices-v1.0.bin` from
the upstream kokoro-onnx model-files-v1.0 release under `.models/kokoro`.
`MOCO_LOCAL_VOICE=chatterbox` uses the already installed Chatterbox model instead;
run neural voice jobs sequentially on memory-constrained machines.
Bundled OFL-licensed Lilita One and Montserrat are embedded in canvas artifacts,
loaded before the first frame, and work without network access.
The benchmarks save planning approvals, capability reports,
sources, temporal previews, reviews and renders in `artifacts/template-validation`.
Only this benchmark auto-approves gates. Set `MOCO_SERIES` to resume a saved
series. A failed quality review blocks final export; a drawn frame is not proof
that the requested visual style was achieved.
`MOCO_ART_FEEDBACK` records a visual revision in the existing series ledger and
reruns its art stage, preserving the script and measured speech. This is benchmark
input feedback, not a fixture or a manual scene-code patch.
`MOCO_REVIEW_ONLY=1` uses `engine.reviewEpisode` to review saved scenes without
re-authoring them. It refuses missing scenes or scenes built against stale
narration/cuts, preserves portrait frame proportions in the evidence sheets,
and samples intermediate motion. Prompt-template reviews batch three target
shots per request while retaining individual verdicts, action checks and repair
decisions. Export still requires a passing review bound to current artifact hashes.
Silent authored cues are sampled alongside word anchors. Short rewind cues get
consecutive frame evidence so a missing motion sample does not look like failed art.
For a precise repair, set `MOCO_SHOT` and `MOCO_SHOT_FEEDBACK`; the benchmark uses
the ordinary `regenerateShot` API and rechecks continuity before exporting.
Long evidence runs recycle the still-render browser, and movie encoding releases
that browser first to reduce memory pressure.

`scripts/validate-template-video.py final.mp4 inspection-folder` decodes 48 frames
into three contact sheets and reports dimensions, frame rate, audio and a freeze
metric. Inspect the sheets too: frame differences do not prove artistic similarity.
`scripts/normalize-template-video.py final.mp4 upload.mp4` makes an optional
two-pass loudness-normalized delivery copy, stream-copying the video unchanged.
It measures the encoded AAC copy and saves the loudness report beside it. This
benchmark postprocessing does not add a soundtrack or change app export settings.
