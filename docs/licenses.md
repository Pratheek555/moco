# Licences

Every dependency and binary moco ships or uses at build time. Add a row **before** adding the dependency.
No GPL/AGPL code in the shipped app without the product owner's approval.

| Package / binary | Version | Licence | Ships in app? | Notes |
|---|---|---|---|---|
| zod | 4.x | MIT | yes | spec schemas |
| react, react-dom | 19.3.1 | MIT | yes | kit components, renderer |
| remotion, @remotion/bundler, @remotion/renderer | 4.0.539 | Remotion License (custom) | yes | **Open question R4**: free for ≤3-person orgs; automators $0.01/render, $100/mo minimum. `renderMedia()` accepts a licence key option. |
| @remotion/cli | 4.0.539 | Remotion License (custom) | no (dev only) | `remotion benchmark`, `remotion gpu`, Studio |
| Chrome Headless Shell | (downloaded by Remotion) | BSD-3-Clause (Chromium) + third-party notices | yes | downloaded on first render |
| FFmpeg (inside @remotion/compositor-*) | bundled by Remotion | LGPL/GPL depending on build — **unverified** (R6) | yes | H.264 patents not covered (R6) |
| typescript | 5.x | Apache-2.0 | no | |
| vitest | 3.x | MIT | no | |
| tsx | 4.x | MIT | no | scripts |
| @types/node, @types/react | — | MIT | no | |
| Rhubarb Lip Sync (evaluated, **not added**) | 1.14.0 | MIT; bundled deps Boost, BSD-2/3, MIT, WTFPL (no GPL), from its LICENSE.md | no | Phase 3 spike only, run from the scratchpad. See docs/adr/lip-sync.md |
| @remotion/rive | 4.0.539 | Remotion License (custom), same terms as remotion | no (renderer devDependency, Phase 5 spike) | isolated spike composition `packages/renderer/spikes/rive`; not in the production bundle |
| @rive-app/canvas-advanced | 2.31.5 | MIT (npm metadata; rive-app/rive-wasm repo LICENSE is MIT; rive-app/rive-runtime is MIT) | no (renderer devDependency, spike only) | used directly by the frame-exact spike player; its `rive.wasm` (1.4 MB) is copied into `spikes/rive/public/` by `pnpm --filter @moco/renderer spike:rive` and git-ignored, never committed |
| centaur.riv sample | rive-wasm@master `wasm/examples/centaur_game/centaur.riv` | MIT, by the repository LICENSE (no separate asset licence in the repo) | no (spike fixture, 46 KB) | Rive's demo character; used only to measure determinism and cost |
| electron | 45.1.0 | MIT (Chromium BSD-3 + third-party notices inside) | yes | desktop shell (apps/desktop, from main) |
| electron-vite, vite, @vitejs/plugin-react | 6.0.0, 8.3.5, 6.1.2 | MIT | no (build) | desktop build |
| electron-builder | 26.18.0 | MIT | no (build) | installers; packaging not tested yet. `electron-winstaller` install script disabled in pnpm-workspace.yaml |
| tailwindcss, @tailwindcss/vite | 4.3.3 | MIT | no (build; CSS output ships) | desktop styles |
| zustand | 5.0.16 | MIT | yes | desktop UI state |
| lucide-react | 1.64.0 | ISC | yes | desktop icons |
| @fontsource-variable/inter | 5.3.0 | OFL-1.1 | yes | desktop UI font |
| @playwright/test | 1.64.1 | Apache-2.0 | no (test) | desktop end-to-end smoke test |
| macOS `say`, Windows SAPI (System.Speech) | OS | part of the OS | no (called on the user's machine) | `systemAudio()` voiceover |
| espeak-ng (Linux) | user-installed | **GPL-3.0** | **no, never shipped** | `systemAudio()` calls the user's own install as a separate process; bundling it would need the owner's approval |
