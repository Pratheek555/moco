# moco

Idea → animated 9:16 reels, rendered locally, powered by the user's own Claude/ChatGPT.

## Layout

| Folder | Harness part | What lives here |
|---|---|---|
| `apps/desktop` | — | Electron app: studio, series review, episode page, kit, settings. Thin shell over `engine`, which runs in its own process (`src/main/engine-host.ts`). |
| `packages/spec` | contract | Scene/episode JSON schema (zod). The single contract between AI, engine and renderer. |
| `packages/ai` | — | AI backend: the user's Claude Code (`claude -p`), tools disabled. No API keys. |
| `packages/engine` | 1, 3, 4, 7 | Planner, scene generator, validate/render/auto-fix loop, series memory. |
| `packages/renderer` | 6 | Remotion project: interprets a spec into frames — camera, captions, fx, export. |
| `packages/kit` | 2 | Character kit: layered SVG characters, props, backgrounds. Shipped as packs. |
| `packages/audio` | 5 | Voiceover with the OS voices, word timing, lip sync from loudness. Music and SFX to come. |
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

## Run it

```
pnpm install
pnpm dev            # the desktop app (needs Claude Code installed and signed in)
pnpm test           # unit tests
pnpm typecheck      # packages + desktop
pnpm --filter @moco/desktop build && pnpm test:desktop   # end to end: idea → reviews → final MP4 (real Claude calls)
```
