# Blender rendering

Moco can generate, check, repair and render native 3D animation with **Blender 4.5 LTS**.
The existing engine still owns story planning, review gates, narration, measured-word shot timing,
visual review, progress events, render reports, caching, publishing details and thumbnails.
Blender EEVEE or Workbench draws the scene; FFmpeg encodes H.264, stitches the shots and adds AAC narration.
Everything renders locally. The configured subscription AI writes scene data.

## Install and use

```powershell
pnpm blender:setup
pnpm dev
```

Setup downloads the pinned portable Blender 4.5.15 archive from Blender's official release server,
checks its SHA-256 against the official checksum file, and extracts it without admin rights or PATH
changes. Windows x64 and Linux x64 are supported by the installer. On macOS, install Blender 4.5 LTS
manually. FFmpeg must be on PATH, or set `MOCO_FFMPEG_PATH` to its executable.

In **Settings → Rendering**, choose **Blender · native 3D animation**, check the installation, and save.
Create a standard animation in Studio. The usual story, script, first-shot and preview reviews remain.
The selected renderer is saved in `series.json`; changing settings affects new projects. Custom illustration
templates continue to use Canvas. Existing Remotion projects continue to render with Remotion.

Discovery order: saved executable path, `MOCO_BLENDER_PATH`, Moco's portable installation, the default
system installation, then `blender` on PATH. Windows portable files live at
`%LOCALAPPDATA%/Moco/tools/blender`; Linux uses `~/.local/share/moco/tools/blender`.
Only Blender 4.5's API is supported; Blender 5 requires a separately verified bridge.

## Finish a real episode from the command line

```powershell
pnpm blender:demo
pnpm blender:demo "Your film idea" "C:/Users/you/Documents/Moco"
# Resume the exact saved project after an interruption:
$env:MOCO_SERIES = "a-tiny-teal-robot-called-pip"
pnpm blender:demo
```

This runs `createEngine` with the real configured Codex CLI, OS speech and the real Blender renderer.
It automatically approves the review gates **for this demo command** and fails if any stage fails.
The default demo targets 16–22 seconds. Regular desktop projects retain normal duration and review behavior.
`MOCO_REPLAN_BIBLE=1` reruns the show plan when resuming (for example, to widen an infeasible shot-length range).
Output is `projects/<series>/episodes/ep-01/renders/final.mp4`, with a preview, thumbnail, narration,
shot stills, scene specs and production metadata alongside it.

The generic live runner also supports `MOCO_RENDER_BACKEND=blender`.

## Contract and editable outputs

`SceneSpec.blender` is a versioned, bounded data schema: primitive meshes, outlined paths, registered
image planes, text, parent hierarchies, materials, lights, a tracking camera, and transform keyframes.
Native Blender coordinates are
metres with **Z up**, Euler XYZ angles in degrees, and shot-local frames starting at zero.
Cube/sphere/cylinder/cone/plane geometry has unit dimensions before scaling. Parents use local transforms.
Perspective cameras use a 36mm vertical sensor; orthographic cameras support an animated `orthoScale`.
Object keys animate absolute local values. Camera keys support smooth, linear and hold easing; hold keys
allow deliberate hard cuts. `animationStep` can hold artwork for one to four frames while keeping the
exported frame count and frame rate exact.

There is no model-authored Python execution, arbitrary file loading, expression evaluation, driver
execution, network access, imported model path, or arbitrary image path in the scene contract.
Image objects name an application-registered asset id and SHA-256. Trusted callers provide the registry,
or the renderer resolves `assets/blender/manifest.json` inside an explicitly allowed project root.
Changing the image requires rebuilding the scene's content hash. Image planes and the bundled OFL
Bangers/Patrick Hand fonts are packed into editable `.blend` files.
The app-owned Python bridge runs Blender with factory settings and auto-execution disabled.
Semantic validation rejects missing materials/parents, cycles, duplicate ids, invalid camera targets,
out-of-range keyframes and missing story cast before launching a render.

Each rendered shot keeps an editable `scene.blend` and a `shot.mp4` in
`renders/.blender-cache/<content hash>/`. Cache keys include scene data, format, quality, samples,
the bridge source and the detected executable stamp. Each renderer instance snapshots its bridge source so development edits cannot change
an in-flight render without changing its cache stamp. Lossless frames are removed after successful
encoding. Interrupted shots can be rerun; completed shots are reused. Preview is half size with up to
8 samples, final uses the selected count (32 by default). Processes have timeouts, cancellation and
bounded logs. A missing installation is an infrastructure error; failed Blender scene generation
stops the stage visibly instead of substituting a 2D fallback.

For flat cutout work, `renderStyle: "illustration"` uses unlit artwork and Standard color management;
`rasterizer: "workbench"` supports fast textured illustration exports. Paths can have fills, smooth
curves and beveled outlines. Semantic validation checks referenced image ids, materials, path geometry
and required orthographic scale before Blender starts.

Current scope: declarative stylized 3D and cutout illustration, transform animation, lighting, camera
moves, burned-in captions, narration and thumbnails. Imported meshes, arbitrary Python, physics/cloth simulation, music mixing,
mixed Blender/Remotion cuts and Blender-specific artwork editing are not exposed. For soundtrack mixing,
provide a premixed voiceover track. Thumbnail position, color and layout use the selected design.

## Verify

```powershell
pnpm typecheck
pnpm test
$env:MOCO_BLENDER_TESTS = "1"
pnpm exec vitest run packages/renderer/test/blender.test.ts --maxWorkers=1
pnpm --filter @moco/desktop build
pnpm --filter @moco/desktop test:blender
```

The opt-in render test launches installed Blender, checks distinct temporal PNGs, exports two shots with
audio, probes the final frame count/dimensions, and confirms a rerender reuses the saved `.blend` files.
`ffprobe` is required for verification (`MOCO_FFPROBE_PATH` can override its path).
The desktop check uses a disposable profile and validates renderer settings, persistence and preload IPC.
The engine test verifies a new Blender project's saved backend. `MOCO_BLENDER_SERIES` and `MOCO_BLENDER_PROJECTS` optionally point it
at a finished demo to verify playback through Moco's asset protocol.
For a widescreen production, set `MOCO_BLENDER_WIDTH` and `MOCO_BLENDER_HEIGHT` to its expected dimensions.

## Verified production — 2026-11-09

The Windows demo **Pip and the Last Golden Seed**, episode **A Little Light**, completed every Moco
stage using the real Codex CLI, system narration and Blender 4.5.15. Its four-shot final MP4 is
1080 × 1920 at 30 fps: 526 frames, 17.533 seconds, H.264 video and AAC audio, with burned-in captions.
The project is `projects/a-tiny-teal-robot-called-pip`; editable `.blend` scenes, preview, thumbnail
and publishing copy are saved alongside the production.

Validation: 396 tests passed in the full suite (18 skipped); all 5 opt-in Blender lifecycle/render
checks passed; typecheck and desktop build passed. FFmpeg decoded the entire final without errors.
The Electron test played it through both Moco's asset protocol and the episode page, with no page
errors. Both render freshness checks passed, and resuming the completed demo reused its saved output.

Official references: [downloads and checksums](https://download.blender.org/release/Blender4.5/),
[Blender 4.5 Python API](https://docs.blender.org/api/4.5/),
[render settings](https://docs.blender.org/api/4.5/bpy.types.RenderSettings.html).
