# moco

Idea → animated 9:16 reels, rendered locally, powered by the user's own Claude/ChatGPT.

## Layout

| Folder | Harness part | What lives here |
|---|---|---|
| `apps/desktop` | — | Desktop app (UI, project manager, render queue). Thin shell over `engine`. |
| `packages/spec` | contract | Scene/episode JSON schema (zod). The single contract between AI, engine and renderer. |
| `packages/ai` | — | Provider adapters: Claude Code CLI, Codex CLI, API-key fallback. |
| `packages/engine` | 1, 3, 4, 7 | Planner, scene generator, validate/render/auto-fix loop, series memory. |
| `packages/renderer` | 6 | Remotion project: interprets a spec into frames — camera, captions, fx, export. |
| `packages/kit` | 2 | Character kit: layered SVG characters, props, backgrounds. Shipped as packs. |
| `packages/audio` | 5 | Voiceover (TTS), music, SFX, word-level timing for captions. |
| `docs` | — | Product notes, decisions, spec docs. |
| `projects` | — | User output (series, episodes, renders). Git-ignored. |

## Flow

```
idea ─▶ engine/planner ─▶ episodes + shot list
          │
          ▼
     engine/generator ──(ai)──▶ scene spec JSON ─▶ spec (validate)
          ▲                                         │
          └──────── errors fed back ◀───────────────┤
                                                    ▼
          audio (VO, timing) ─────────────▶ renderer + kit ─▶ MP4
```
