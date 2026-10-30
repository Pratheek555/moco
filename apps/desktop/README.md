# @moco/desktop

The Electron app. UI from main's desktop (Studio, My series, Creative kit, Activity, Settings), wired onto `@moco/engine`.

- **Main process** (`src/main/index.ts`): window, settings, the `moco-asset://` scheme for videos and stills, and the IPC handlers in `src/shared/api.ts`. It forwards engine calls over a MessagePort.
- **Engine host** (`src/main/engine-host.ts`): a utility process running the engine with Claude Code, Remotion and the OS voices. Rendering and AI calls never block the UI. It runs from source (Electron's Node strips the types), so the engine's prompt files and the kit assets stay where the packages expect them.
- **UI** (`src/renderer`): React. The engine stops at each review gate (plan, bible, script, sample shot, preview); the series page shows what was made with Approve / Ask for changes.

```
pnpm dev                        # from the repo root
pnpm --filter @moco/desktop build && pnpm test:desktop   # end-to-end smoke test with real Claude + rendering
```

Not done yet: packaged builds (`pnpm dist`). The engine host must ship outside `app.asar`/`node_modules` for Node to strip its types, and the Remotion bundle must be prebuilt and passed as `remotion.serveUrl`.
