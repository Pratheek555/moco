# Benchmark and golden scenes

| file | what |
|---|---|
| `baseline-krishna-chariot.json` | The original engine golden scene (Phase 0 baseline): Krishna on the chariot, push-in, dust fx, no premium looks. |
| `premium-krishna-dawn.json` | The premium golden scene (Phase 7): idle motion, `raise_hand` then `bless`, a spoken key line with lip sync v0, parallax Kurukshetra at dawn with dust and light rays, a pan, then a push-in on the key line, vignette, grain, the `warm_epic` grade, and captions. The engine's prompt example (`engine/src/generator/examples/krishna-chariot.json`) is this file minus `visemes`, `grade` and `finish`; `engine/test/golden.test.ts` keeps the two in sync. `renderer/test/golden.test.ts` renders it for the golden stills and the determinism check. |
| `svg-rig-only.json`, `rive-*.json` | Props for the Rive spike compositions (`spikes/rive/index.tsx`), see `docs/adr/rive-vs-svg-rig.md`. |

**How the premium scene's `visemes` were made.** The key line "Do your duty, without fear." was recorded with macOS `say -o line.wav --data-format=LEI16@16000`. It ran through `amplitudeVisemes` from `@moco/audio`, with one word range covering the speech (0–1.69 s). The keys were then shifted to start at frame 190, inside the `speak` action (186–246). The recording isn't committed; only the resulting keys are in the JSON. Once a TTS is chosen, the engine fills this track from the real voiceover.
