# Moco

A local Electron animation studio for turning Indian mythology, devotional, and history stories into vertical reels. The interface takes inspiration from [Vibrant Design](https://vibrant.design/): quiet surfaces, tactile buttons, restrained color, and gentle generation animations.

## Run

Requires Node.js 22.18 or newer and npm.

```sh
npm ci
npm run dev
```

For a production build:

```sh
npm run build
npm start
```

Create an installer for the current platform with `npm run dist`. On Windows the installer and unpacked application are written to `apps/desktop/release/`. Packaging includes the Remotion bundle and a platform-specific headless browser, so installed apps can render offline. The initial packaging command needs internet access to obtain the browser and Electron if they are not already cached.

## Use the studio

1. Open the included **Song of God** demo. It works without an AI connection.
2. In **Settings → AI connection**, select an installed, signed-in Claude Code or Codex CLI, or enter an Anthropic/OpenAI API key. Save and test the connection.
3. Describe a story in **Studio**, choose its language, style, duration, and episode count, then create the series. You can plan first or write the episodes immediately.
4. Open an episode to preview it, edit narration and scene settings, or direct a scene revision with AI. Save changes before leaving; navigation protects unsaved work.
5. Generate **Voice & music**, then **Export MP4**. Follow progress, errors, and logs in **Render queue**. Finished videos are available in the episode's **Exports** tab and in its project folder.

The creative kit includes 15 rigged SVG characters, 9 backgrounds, held and placed props, camera moves, effects, and synthesized sound effects. Output is 9:16 H.264 MP4 with AAC audio. Standard and high quality use 1080 × 1920; draft uses 540 × 960. System narration uses Windows SAPI, macOS `say`, or Linux `espeak-ng`; OpenAI and ElevenLabs voices are optional. Available languages and quality depend on the installed or selected voice.

Claude Code and Codex use the user's existing local CLI sign-in. API providers require their own keys and can incur provider charges. No account or remote service is needed to edit, preview, or render the demo. API keys stay on this machine and use OS encryption when available.

Projects are stored under `Documents/Moco` by default, as `series.json`, episode specs, audio, and rendered files. Switch the library folder in Workspace settings. Switching folders leaves existing projects where they are. Deleting a series removes its entire folder after confirmation.

**Shortcuts:** Ctrl/Cmd+K opens workspace search; Ctrl/Cmd+N opens a new series; Ctrl/Cmd+Enter submits the story composer. Light, dark, and system appearances are supported.

## Verify

```sh
npm run typecheck
npm test
npm run build
npm run test:desktop
```

The desktop integration test launches the real Electron app in a temporary profile. It checks the UI, editing, disk persistence, character previews, command search, theme switching, system speech/music, local media serving, actual MP4 export, and persistence after restart. Screenshots and its result are written to `artifacts/desktop/`. It does not call a paid AI provider or modify the normal project library. Set `MOCO_TEST_EXECUTABLE` to a packaged executable to run the same test against that build.

`npm run studio` opens the Remotion development studio. `npm run render:demo` renders the example episode after a build.

## Workspace

| Folder | Responsibility |
|---|---|
| `apps/desktop` | Electron main process, sandboxed preload bridge, React studio, settings, and background queue |
| `packages/spec` | Zod scene and episode contract, vocabulary, timelines, and examples |
| `packages/ai` | Claude Code, Codex, Anthropic, and OpenAI adapters |
| `packages/engine` | Series planning, scene generation, validation/repair, audio orchestration, story memory, project storage |
| `packages/renderer` | Remotion scene interpreter, camera, captions, transitions, and export compositions |
| `packages/kit` | Parametric SVG character rigs, props, and layered backgrounds |
| `packages/audio` | OS/API speech, timing, WAV utilities, synthesized music, and sound effects |

The AI produces validated JSON scene specs, not executable code. Renders run in a separate utility process. Asset access is confined to project/cache roots and mirrored over loopback HTTP for the render browser. Background jobs are session-local; projects and exported files persist.
