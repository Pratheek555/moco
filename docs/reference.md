> **Decisions taken on the `feat/engine` branch (30 Oct 2026)** — these override the text below where they differ:
> - **Package manager:** pnpm workspaces (§14.7).
> - **AI backend:** the user's Claude Code session only (`claude-cli`). **No API-key backends** (overrides R1's "make the API-key backend first-class", §6.2 `anthropic-api`/`openai-api`, E5's `anthropic-api`). Codex not implemented.
> - **Spec JSON, not Remotion code** (§4.1) and **VO before shot specs** (§4.3): confirmed; `CLAUDE.md` updated.
> - **Ledger:** JSON file (`ledger.json`) for v0 (§14.6).
> - **TTS deferred** (R5): `@moco/audio` ships `placeholderAudio` (silent WAV, even word timings) so the pipeline runs end to end. Replace it once a TTS engine is chosen; the engine only depends on the `AudioPort` shape (§8).
> - **No test UI:** Pratheek builds `apps/desktop`. The backend side of it is `apps/desktop/src/engine-host.ts` (utilityProcess entry) + `@moco/engine/client` (typed client for the UI).
> - **Verified:** `--safe-mode` + `--system-prompt-file` + `--json-schema` + `--tools ""` on Claude Code 2.1.312 — the model sees only `StructuredOutput` (§6.2 [VERIFY] resolved). Remotion 4.0.539 stills + H.264 episode render with audio work from Node (§7.2). Running Remotion inside a `utilityProcess` is still unverified.
>
> **Implementation status vs §13:**
> - E0 ✅ pnpm, TS strict, Vitest, CI (`.github/workflows/ci.yml`); dependency rule enforced by `packages/engine/test/boundaries.test.ts` instead of dependency-cruiser.
> - E1 ✅ golden Krishna chariot spec; kit with rigged Krishna + Arjuna, chariot, Kurukshetra (4 parallax layers), dust; `catalog.json` generated from the component registry. Art is programmer-drawn: a placeholder for the kit artist.
> - E2 ✅ store, envelopes, atomic writes, history, tamper check, stage machine, gates, staleness, events, crash recovery.
> - E3 ✅ generator, L0–L3 loop, feedback, fallback, attempts; plus L2 slideshow checks (missing cast, nothing moving). Repeated-camera-across-shots check not done.
> - E4 ✅ planner, bible (kit ids only), script fitting + VO send-back, shot list on word boundaries, memory; **sample-before-batch** as a `sample` gate on the first episode.
> - E5 ✅ for `claude-cli` (version + auth check, isolation, structured output, rate-limit error). Mid-call rate-limit detection via `stream-json` `api_retry` not done (we read the final JSON result). TTS spike deferred.
> - E6 ✅ Remotion `RenderPort` (L3 stills with spec-path errors, episode render with VO, preview/final quality). Music/SFX mixing not done (no assets yet).
> - E7 (backend parts) ✅ engine host protocol + client, render cache, per-shot spec reuse (partial regeneration), prompt versions recorded in artifact inputs, spec-version guard. Electron packaging of Remotion (§7.2) is for the desktop build.

# moco — Engine & Backbone Reference

> **For:** Claude Code (and humans) building **moco**: idea → animated 9:16 reels, rendered locally, powered by the user's own Claude/ChatGPT.
> **Scope:** the backbone — `packages/engine` first, plus the contracts it needs from `spec`, `ai`, `audio`, `kit`, `renderer` and `apps/desktop`.
> **Repo baseline:** `Pratheek555/moco` @ `b85e7b6` ("basic structure", 29 Oct 2026) — empty package skeletons with READMEs.
> **Verified:** 30 Oct 2026 against official docs and source. Items marked **[VERIFY]** could not be confirmed from a primary source; check them before relying on them.
> **Lineage:** patterns adapted from a code-level read of OpenMontage (`calesthio/OpenMontage` @ `195eab2`), re-fitted to moco's architecture.

---

## 0. How Claude Code should use this file

1. Read §1–§3 before writing code. §2 lists risks that can change the product, not just the code.
2. Build in the order of §13 (engine first, against fakes). Don't start real AI backends or the real renderer before E1–E3 pass.
3. Every **MUST / MUST NOT** is enforced in code (validation, errors), never only in prompts.
4. Code blocks are **sketches**: right shape and names; confirm exact library signatures from §16 sources when implementing.
5. Keep this file and the code in sync in the same PR. If you change a package boundary, update §3.
6. Package READMEs in the repo are the product owner's intent. Where this file proposes a change to them (e.g. §4.3 ordering), it says so explicitly.

---

## 1. moco in one page

### 1.1 Product (from `CLAUDE.md` / `README.md`)
- One-time-purchase **desktop app** (Electron) that turns an idea ("a Mahabharat series") into animated Instagram reels (9:16, 30–60 s).
- Uses the **customer's own Claude or ChatGPT** — no paid video APIs, no running costs for moco.
- The AI plans episodes/shots and writes **scene specs** that a **deterministic Remotion renderer** turns into frames using a **pre-built SVG character kit**.
- Render/validation errors go back to the AI automatically.
- MVP market: Indian mythology / devotional / history pages; faceless channel operators. Hindi and regional languages matter.

### 1.2 Repo layout (existing) and who owns what
| Folder | Harness part | Owner of… |
|---|---|---|
| `packages/spec` | contract | Zod schemas for every artifact the AI writes and the renderer reads. Only thing shared by `engine` and `renderer`. |
| `packages/engine` | 1, 3, 4, 7 | **The backbone.** Planner, generator, validate/render/auto-fix loop, memory — plus project store, pipeline, gates, jobs, events (this document). |
| `packages/ai` | — | Backends: Claude Code CLI, Codex CLI, API keys. One interface. |
| `packages/audio` | 5 | TTS, music, SFX, word-level timing. |
| `packages/kit` | 2 | Layered SVG characters, props, backgrounds + a machine-readable **catalog**. |
| `packages/renderer` | 6 | Remotion project: spec → frames → MP4. No AI. |
| `apps/desktop` | — | Electron shell over `engine`. |
| `projects/` | — | User output (git-ignored). |

### 1.3 The core principle
> **Creative judgment comes from the AI. Rules that must hold are enforced by the engine in code.**
In moco this is easier than in OpenMontage: the **engine is the orchestrator** and the AI is a function the engine calls (`ai.generate(...)`) with **tools disabled**. The AI never touches files, never approves anything, never runs commands. Everything it produces is data that the engine validates.

---

## 2. Risks found during verification (read first)

| # | Risk | Evidence (verified) | What to do |
|---|---|---|---|
| R1 | **Using the customer's Claude subscription from a third-party product may not be allowed.** | Anthropic Agent SDK docs: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods… instead." | Treat the subscription backend as **at-risk**. Make the **API-key backend first-class** (§6). Seek written clarification/approval from Anthropic before shipping a subscription-based Claude path. Not legal advice. |
| R2 | **`claude -p` may stop using subscription login by default.** | Claude Code headless docs: `--bare` "is the recommended mode for scripted and SDK calls, and will become the default for `-p` in a future release"; "In bare mode, Claude Code never reads OAuth credentials or the system keychain." | Pin and detect the Claude Code version; check `claude auth status` (`authMethod`) before runs; have a tested fallback. Don't build the product's only path on non-bare `-p`. |
| R3 | **OpenAI now has an official path for using a ChatGPT plan in other apps — but paid apps must apply.** | "Sign in with ChatGPT" plan usage announced at OpenAI DevDay (29 Sep 2026); OAuth + PKCE, loopback redirect, Responses API; Plus/Pro; per third-party summaries, open-source/local tools self-register while **paid or hosted apps must apply via OpenAI's interest form** and commercial use is a limited trial **[VERIFY on openai.com — policy page didn't load during verification]**. | Apply early. Design `ai` so an `openai-plan` OAuth backend can replace shelling out to `codex exec`. |
| R4 | **Remotion licensing vs. a one-time-purchase product.** | Remotion licence FAQ: free only for organisations of **≤ 3 people**; otherwise a Company License. Video editors / prompt-to-video / automated pipelines fall under **"Automators": $0.01 per render, $100/month minimum**; must report renders (telemetry or monthly verifiable report). Users may not upload their own Remotion code. Licence excludes codec patents (e.g. H.264). | Get a written answer from Remotion (hi@remotion.dev) on desktop distribution where customers render locally. A recurring per-render fee conflicts with "no running costs". Keeping the AI output as **spec JSON, not Remotion code** (§4.1) avoids the "users bring their own code" issue. Plan B: HyperFrames (Apache-2.0, HTML/GSAP). |
| R5 | **Hindi/regional TTS locally.** | Kokoro v1.0 has 4 Hindi voices (`hf_alpha`, `hf_beta`, `hm_omega`, `hm_psi`); `kokoro-js` (Apache-2.0) runs in Node, but Hindi support in **`kokoro-js` specifically is not confirmed** **[VERIFY]**. Other Indian languages aren't covered by Kokoro. Piper is now GPL-3.0 (`OHF-Voice/piper1-gpl`). | Spike TTS early (E5 in §13). Keep TTS behind an interface; allow a BYO-key cloud TTS option. |
| R6 | **Codec patents.** | Remotion FAQ: licence doesn't include third-party patents such as H.264/AVC. | Legal check on shipping an H.264 encoder in a paid desktop app. |

These don't block engine work — the engine is backend-agnostic by design — but they shape the `ai`, `renderer` and `audio` contracts below.

---

## 3. Architecture

### 3.1 Package dependency rules (enforce with lint, e.g. `dependency-cruiser`)
```
apps/desktop ──► engine (public API only)
engine ──► spec, ai, audio, kit (catalog data only), renderer (via RenderPort interface)
renderer ──► spec, kit (components)
audio ──► spec (timing types)
ai ──► (nothing internal; returns raw text/JSON + usage)
spec ──► zod only
kit ──► react (components) + exports catalog.json
```
- `engine` MUST NOT import Remotion. It talks to `renderer` only through `RenderPort` (§7) so it can be tested with a fake renderer and so rendering can run in another process.
- `renderer` MUST NOT import `engine` or `ai`.
- `spec` is the only shared contract (as the README says).

### 3.2 Process model (desktop)
```
Electron main ─┬─ BrowserWindow (UI, React)
               │     ▲ ipc (contextBridge/invoke)
               ├─ engine host: utilityProcess.fork(engineEntry)   ← engine runs here (headless lib)
               │     ├─ spawns AI CLIs (claude / codex) as child processes, tools disabled, temp cwd
               │     ├─ spawns whisper.cpp / TTS
               │     └─ calls RenderPort
               └─ render host (Remotion renderMedia)                ← Remotion docs show main process; see §7.3
```
- Engine is a **library** with a thin host; the same engine runs from a CLI (`pnpm moco …`) for tests and CI.
- `utilityProcess.fork(modulePath, args, { serviceName, stdio: ["ignore","pipe","pipe"] })` — stdin must be `ignore`. Main ↔ engine via `MessageChannelMain` ports.

### 3.3 Trust model (simpler than a BYO-agent harness)
- The AI is invoked with **no tools** (§6.3) in an empty temp working directory. It can only return text/JSON.
- Approvals (gates) come only from the desktop UI via the engine API. The AI has no channel to call engine APIs.
- The engine is the **single writer** of `projects/`. Desktop never writes project files directly; it calls engine commands.

---

## 4. The engine (`packages/engine`) — build this first

### 4.1 Key design decision: AI writes **spec JSON**, not Remotion code
`CLAUDE.md` says "The AI writes animation code (Remotion/React)"; `README.md` and `packages/spec/README.md` say the AI writes **scene spec JSON** that the renderer interprets. **Use spec JSON.** Reasons:
- Validation is exact (schema + catalog checks) instead of compile-and-hope.
- The renderer stays deterministic and testable; quality lives in the kit.
- Smaller, cheaper prompts; easier auto-fix messages.
- Avoids Remotion's "users bring their own code" restriction (R4).
- Escape hatch later: a constrained `customFx` field with a whitelisted mini-DSL, never raw JSX.
Action: update `CLAUDE.md` to say "AI writes scene specs validated by `@moco/spec`".

### 4.2 Module layout
```
packages/engine/src/
  index.ts                 # createEngine(config) → Engine (public API, §4.11)
  config.ts                # paths, limits, backend choice, concurrency
  store/
    workspace.ts           # projects/<series>/… layout, create/open, locks
    artifacts.ts           # save/read with validation, atomic write, history
    hash.ts                # canonical JSON + sha256
    ledger.ts              # SQLite (or JSON) index: revisions, hashes, jobs, approvals, usage
  pipeline/
    stages.ts              # stage definitions (series + episode level)
    machine.ts             # status transitions, next-step resolution
    gates.ts               # approval records bound to contentHash
    staleness.ts           # input-hash tracking, invalidation
  planner/
    series.ts              # idea → series plan (episodes)
    bible.ts               # cast (kit ids), style, voice choices
    episode.ts             # episode → script/beats fitted to 30–60 s
    shots.ts               # beats + VO timings → shot list
  generator/
    context.ts             # select relevant kit catalog slice, memory, examples
    prompts/               # versioned prompt templates (*.md) — part of the product
    generate.ts            # shot → scene spec via ai
  loop/
    validate.ts            # L1 schema, L2 semantic (catalog, timing, bounds)
    renderCheck.ts         # L3 via RenderPort.check
    feedback.ts            # errors → compact fix instructions
    loop.ts                # generate → validate → check → retry/fallback
  memory/
    continuity.ts          # facts, costumes, injuries, locations per episode
    summarize.ts           # story-so-far after each approved episode
  audio/
    voiceover.ts           # calls @moco/audio, stores timings
  jobs/
    queue.ts               # persistent job queue with concurrency limits
    recovery.ts            # resume after crash
  events/
    bus.ts                 # typed events → desktop; events.jsonl
  usage/
    meter.ts               # AI calls, tokens/cost estimates, rate-limit state
  errors.ts                # typed errors with human + AI fix text
```

### 4.3 Pipeline (stages and gates)
Two levels: **series** (once) and **episode** (per episode).

| Level | Stage | Produces (spec artifact) | Gate (user approves in UI) | Notes |
|---|---|---|---|---|
| series | `series_plan` | `SeriesPlan` (episode list, arc, tone) | Yes | From the idea. |
| series | `bible` | `SeriesBible` (cast → kit character ids, style, palette, narrator voice, language) | Yes | Locks consistency inputs (harness 2 & 7). |
| episode | `script` | `EpisodeScript` (narration lines + beats, target 30–60 s) | Yes | Word budget by language (§4.6). |
| episode | `voiceover` | `VoiceoverTrack` (audio files + **word timings**) | No (preview in UI) | **Proposed change to README flow:** VO is generated *before* shot specs so timing is real (harness 5). |
| episode | `shot_list` | `ShotList` (shots with start/end from VO timings, intent, characters, location) | Optional (default off) | Planner fits shots to measured VO. |
| episode | `scenes` | `SceneSpec` per shot | No (loop validates) | Generator + auto-fix loop, in parallel with a concurrency limit. |
| episode | `preview` | low-quality render + stills | **Yes** | User can request per-shot changes here. |
| episode | `final` | `RenderReport` + `renders/<ep>.mp4` (music, SFX, captions, export) | No | Assembler (harness 6). |
| episode | `memory_update` | `ContinuityUpdate` merged into series memory | No | Runs after preview approval. |

Statuses: `pending → running → awaiting_approval → approved` (gated) or `pending → running → done`; any → `failed`; any done/approved → `stale` when an input changes.

### 4.4 Project store (`projects/`)
Matches `projects/README.md` ("one folder per series → episodes → scene specs, audio, renders"):
```
projects/<series-slug>/
  series.json                  # marker: id, title, language, createdAt, engineVersion, specVersion
  artifacts/
    series_plan.json  bible.json  memory.json
  history/                     # every superseded revision: <artifact>.r<N>.json
  episodes/<ep-01>/
    artifacts/
      script.json  voiceover.json  shot_list.json  render_report.json
    shots/<shot-01>/
      spec.json                # current SceneSpec
      attempts/                # every AI attempt + validation errors (debugging + prompt tuning)
      stills/                  # preview frames
    audio/  vo.wav  music.wav  sfx/
    renders/  preview.mp4  final.mp4
  events.jsonl
  ledger.sqlite                # or ledger.json for v0
```
Rules (MUST):
- **Atomic writes** (temp → fsync → rename) for every JSON.
- **History:** a save never overwrites without copying the old revision into `history/` (or `shots/<id>/attempts/`).
- **Envelope:** every artifact = `{ meta, data }` (§5.1); `meta.contentHash` computed by the engine.
- **Tamper check:** hashes in the ledger; if a file changed outside the engine, mark it `modified_externally` and ask the user (restore or accept as a human revision).

### 4.5 Staleness and partial re-generation
- Each artifact records its inputs `{artifact, revision, contentHash}`. If an input changes, dependants become `stale`.
- Shot-level granularity: editing line 3 of the script invalidates VO (re-generate only that line's audio if the TTS backend supports it, else the whole VO), then only shots whose time ranges overlap changed words.
- Every SceneSpec has a hash → render cache: unchanged shots aren't re-rendered.

### 4.6 Planner
- Series: idea + language + episode count → `SeriesPlan`.
- Bible: picks cast from **kit catalog** ids only (no invented characters); unknown character → planner must map to an existing kit character or flag "missing asset" to the user.
- Script fitting: target words = duration × speaking rate. Start with configurable rates per language (e.g. English ~150 wpm; set Hindi from the TTS spike, not a guess). After VO, compare measured duration to target; if outside ±10%, **send back** to `script` with a precise instruction ("cut 12 words from beat 3"). Cap: 2 send-backs, then ask the user.
- Shot list: shots ≥ minimum hold (e.g. 1.5 s) and ≤ max (e.g. 6 s) unless intent says otherwise; every narration word belongs to exactly one shot; shot boundaries snap to word boundaries.

### 4.7 Generator
Per shot, build a prompt from:
1. System template (`prompts/scene.md`, versioned): role, rules, output format.
2. JSON Schema of `SceneSpec` (from `z.toJSONSchema`) — passed to the backend's structured-output flag (§6.2).
3. **Catalog slice:** only the characters in this shot, their poses/expressions/actions, relevant props/backgrounds (keep prompts small).
4. Shot brief: intent, duration, VO words with timings, camera hint, location.
5. Memory: bible style + continuity facts relevant to these characters/locations.
6. 2–3 **golden examples** (hand-built specs, starting with the Krishna chariot scene from `CLAUDE.md` "First step").
7. On retry: the previous attempt + compact error list (§4.8).

### 4.8 Validate → render-check → auto-fix loop (harness 4)
```
attempt = 0
loop:
  raw = ai.generate(prompt, schema)           # structured output
  L0 parse JSON (should already be valid with structured output; still check)
  L1 spec schema (zod)                        → errors?
  L2 semantic checks                          → errors?
       - ids exist in kit catalog and in bible cast
       - actions/poses/expressions valid for that character rig
       - all timings within [0, shot.duration]; no overlapping exclusive actions per actor
       - caption words/timings match VO words for this shot
       - positions/scale inside safe area for 1080×1920
       - camera moves within allowed ranges
  L3 render check (RenderPort.check)          → runtime errors? (render a few stills)
  if no errors: save spec → done
  attempt += 1
  if attempt == maxAttempts (default 3): fallback
  prompt = original + previous output + top-N errors (path, problem, allowed values)
fallback:
  deterministic "safe shot" template (background + narrator caption + subtle camera) marked `fallback: true`,
  surfaced in UI as "needs attention"; user can retry with feedback.
```
- Error messages are **for the model**: JSON path, what's wrong, the allowed values (truncated list), one-line fix. Example: `actors[0].actions[1].name: "jump" is not in Krishna's rig. Allowed: blink, raise_hand, point, turn_head, smile. Pick one.`
- Store every attempt + errors under `shots/<id>/attempts/` — this is the dataset for improving prompts and the kit.
- Later (L4): visual QA — sample frames and ask the AI to grade against a rubric (requires an image-capable backend; with tools disabled, pass images via API backend or a Read tool restricted to a temp folder **[VERIFY per backend]**).

### 4.9 Memory (harness 7)
- `SeriesBible` (approved, stable): cast, character descriptions → kit variants, style, palette, voice.
- `SeriesMemory` (grows): story-so-far summary (≤ N words), continuity facts (`{entity, fact, sinceEpisode}`), recurring locations, running jokes/motifs.
- After each approved preview, the engine asks the AI for a `ContinuityUpdate` (schema-validated) and merges it; conflicts with the bible are rejected.
- Generator includes only relevant memory entries (by characters/locations in the shot).

### 4.10 Jobs, concurrency, usage
- Everything slow is a **job**: AI calls, TTS, transcription, render checks, renders. Jobs are persisted (`queued/running/succeeded/failed/cancelled`) so the app can restart mid-episode.
- Concurrency limits per resource: `ai` (default 2 — subscription rate limits), `tts` (1), `render` (1, CPU-heavy).
- **Usage meter** instead of a dollar budget: count AI calls per episode, capture usage/cost estimates the CLIs report (Claude `--output-format json` includes `total_cost_usd`, a client-side estimate; Codex `--json` emits `turn.completed` events **[VERIFY usage fields]**), detect rate limits (Claude stream emits `system/api_retry` with `error: "rate_limit"`), back off, and show "your AI plan limit was reached — resume later" instead of failing.
- Hard caps: max AI calls per episode (config), max attempts per shot, max send-backs.
- Cancellation: AbortSignal → kill child process (SIGINT first so Claude ends the turn cleanly; SIGTERM exits with 143 and records no result).

### 4.11 Engine public API (what `apps/desktop` calls)
```ts
export interface Engine {
  // series
  createSeries(input: { idea: string; language: string; episodes?: number }): Promise<SeriesId>;
  runStage(ref: StageRef): Promise<JobId>;                 // runs next/selected stage
  approve(ref: StageRef, contentHash: string): Promise<void>; // only from UI
  reject(ref: StageRef, feedback: string): Promise<void>;     // feedback goes into the next prompt
  status(seriesId: SeriesId): Promise<SeriesStatus>;       // stages, stale flags, jobs, usage
  // shots
  regenerateShot(ref: ShotRef, feedback?: string): Promise<JobId>;
  // render
  renderPreview(ref: EpisodeRef): Promise<JobId>;
  renderFinal(ref: EpisodeRef): Promise<JobId>;
  // control
  cancel(job: JobId): Promise<void>;
  on(event: EngineEventType, cb: (e: EngineEvent) => void): Unsubscribe;
  // history
  history(ref: ArtifactRef): Promise<RevisionInfo[]>;
  restore(ref: ArtifactRef, revision: number): Promise<void>;
}
```
Events: `stage.started|awaiting_approval|approved|failed`, `artifact.saved|stale|modified_externally`, `shot.attempt` (with error count), `shot.fallback`, `job.progress`, `usage.updated`, `usage.rate_limited`, `render.progress`.

### 4.12 Rules the engine enforces (MUST)
1. No artifact is saved unless it passes schema + semantic validation.
2. Gated stages advance only via `approve()` with the current `contentHash`.
3. The AI is always invoked with tools disabled and in a temp cwd; its output is data only.
4. Bible-locked choices (cast, style, voice, language) can't be changed by a downstream stage; only a new approved bible revision can.
5. Never silently substitute: fallback shots and backend switches are recorded and shown in the UI.
6. Every slow operation is a resumable job; nothing paid/quotaed is retried without a cap.

---

## 5. Spec contract (`packages/spec`) — what the engine needs

### 5.1 Envelope
```ts
import * as z from "zod";

export const Meta = z.object({
  kind: z.string(),                    // "SceneSpec", "EpisodeScript", ...
  specVersion: z.string(),             // semver of @moco/spec
  revision: z.number().int().nonnegative(),
  createdAt: z.string(),
  producedBy: z.enum(["ai", "human", "engine"]),
  backend: z.string().optional(),      // "claude-cli" | "codex-cli" | "anthropic-api" | ...
  inputs: z.array(z.object({ kind: z.string(), revision: z.number(), contentHash: z.string() })),
  contentHash: z.string(),
});
export const Envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ meta: Meta, data });
```

### 5.2 Artifacts (minimal sketches — finalise with the renderer/kit owners)
```ts
export const SeriesPlan = z.object({
  title: z.string(), language: z.string(), premise: z.string(),
  episodes: z.array(z.object({ id: z.string(), title: z.string(), synopsis: z.string() })).min(1),
});

export const SeriesBible = z.object({
  cast: z.array(z.object({
    id: z.string(),                    // story id, e.g. "krishna"
    kitCharacterId: z.string(),        // MUST exist in kit catalog
    variant: z.string().optional(),    // costume/age variant in kit
    description: z.string(),
  })),
  style: z.object({ palette: z.array(z.string()), captionStyle: z.string(), mood: z.string() }),
  narrator: z.object({ voiceId: z.string(), backend: z.string(), language: z.string() }),
});

export const EpisodeScript = z.object({
  targetSeconds: z.number().min(15).max(90),
  lines: z.array(z.object({ id: z.string(), text: z.string(), beat: z.string(), speaker: z.string().default("narrator") })).min(1),
});

export const VoiceoverTrack = z.object({
  file: z.string(), durationSeconds: z.number(),
  words: z.array(z.object({ text: z.string(), start: z.number(), end: z.number(), lineId: z.string() })),
});

export const ShotList = z.object({
  shots: z.array(z.object({
    id: z.string(), start: z.number(), end: z.number(),
    lineIds: z.array(z.string()), intent: z.string(),
    characters: z.array(z.string()),   // bible cast ids
    location: z.string(),              // kit background id
    cameraHint: z.string().optional(),
  })).min(1),
});

export const SceneSpec = z.object({          // as built, specVersion 0.2.0 (packages/spec/src/index.ts)
  shotId: z.string(),
  durationFrames: z.number().int().positive(),   // 30 fps
  background: z.object({ id: z.string(), parallax: z.boolean().default(true) }),
  actors: z.array(z.object({
    castId: z.string(),
    kitCharacterId: z.string(),
    variant: z.string().optional(),      // engine-filled from the bible
    position: z.object({ x: z.number(), y: z.number(), scale: z.number() }),  // normalized 0..1 frame coords
    facing: z.enum(["left", "right"]),
    actions: z.array(z.object({
      name: z.string(),                  // MUST exist in the character's rig (catalog)
      startFrame: z.number().int().nonnegative(),
      endFrame: z.number().int().positive(),
      params: z.record(z.string(), z.unknown()).optional(),
    })),
    expression: z.array(z.object({ name: z.string(), atFrame: z.number().int() })).default([]),
    idle: z.boolean().default(true),     // breathing, blinks, sway, follow-through; false = hold still
  })),
  props: z.array(z.object({ id: z.string(), position: z.object({ x: z.number(), y: z.number(), scale: z.number() }) })).default([]),
  camera: z.array(z.object({
    move: z.enum(["static", "push_in", "pull_out", "pan_left", "pan_right", "shake", "focus_on"]),
    startFrame: z.number().int(), endFrame: z.number().int(), amount: z.number().min(0).max(1),
    castId: z.string().optional(),       // focus_on: frame this actor's face above the caption area
  })).default([]),
  captions: z.array(z.object({ text: z.string(), startFrame: z.number().int(), endFrame: z.number().int(), emphasis: z.boolean().default(false) })),
  fx: z.array(z.object({ id: z.string(), startFrame: z.number().int(), endFrame: z.number().int() })).default([]),
  fallback: z.boolean().default(false),
  timeOfDay: z.string().optional(),      // one of the background's times of day (catalog); default its first
  atmosphere: z.array(z.object({ id: z.string(), intensity: z.number().min(0).max(1).default(1), layer: z.string().optional() })).default([]),
  // Engine-filled, never written by the AI (AiSceneSpec omits them):
  visemes: z.array(z.object({ frame: z.number().int(), viseme: z.string() })).default([]),  // lip-sync track, shot frames
  grade: z.string().default("none"),     // series colour grade from the bible
  finish: z.object({ vignette: z.boolean().default(true), grain: z.boolean().default(true) }).default({ vignette: true, grain: true }),
});
export const AiSceneSpec = SceneSpec.omit({ visemes: true, grade: true, finish: true });  // what the AI is asked for
```
`SeriesBible.style` also gained `grade` (default `"none"`, checked against the kit's grades).

**0.1.0 → 0.2.0 migration.** Every new field has a default, so the migration is "parse with the new schema". The store checks the tamper hash on the raw stored data *before* parsing (so old files still verify), then parsing fills the defaults (`packages/engine/test/store.test.ts`).

Episode assembly (`EpisodeSpec`) = ordered SceneSpecs + audio tracks (VO, music, SFX cues) + export settings (1080×1920 @ 30 fps).

### 5.3 Schema rules
- `@moco/spec` exports: Zod schemas, TS types, and **JSON Schema** via `z.toJSONSchema(schema)` (Zod 4; default target draft-2020-12; `target: "draft-07"` available).
- Keep **AI-facing** schemas simple: enums, plain objects, no deep unions. Structured-output implementations may restrict JSON Schema features (e.g. strict modes often require `additionalProperties: false` and all fields required) **[VERIFY per backend]**. Validate the full Zod schema in the engine afterwards anyway.
- Semantic rules that depend on the kit (valid action names) live in the engine's L2 validator, fed by `kit/catalog.json` — not hard-coded enums in `spec`, so new kit packs don't need a spec release. As built, this covers action, viseme, background-layer, atmosphere, time-of-day and grade names: `spec` holds plain strings, and the catalog lists the valid values.
- L2 also enforces cinematography rules (`packages/engine/src/loop/validate.ts`):
  - No more than 3 s where neither the camera moves nor an actor acts.
  - Emphasised captions need a `push_in` or `focus_on` during them.
  - No 3 consecutive shots with the same camera preset (the longest move) or shot size (from the largest actor's scale; `focus_on` = close).
  - The last rule is checked after the parallel scenes stage. The engine regenerates the shot that completes the run and passes it an `avoid` list; if that fails, it keeps the old spec.
- `specVersion` semver; breaking changes need a migration in `spec/src/migrations/` and engine support for opening old projects.

---

## 6. AI contract (`packages/ai`) — what the engine needs

### 6.1 Interface (extends the README's `complete(prompt) -> text`)
```ts
export interface AiRequest {
  system: string;                 // full system prompt (replace defaults, see 6.3)
  prompt: string;
  jsonSchema?: object;            // structured output
  maxTurns?: number;              // default 1–2 (no tools → one turn is enough)
  model?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  images?: string[];              // later: visual QA (backend-dependent)
}
export interface AiResult {
  text: string;
  json?: unknown;                 // structured output if requested and produced
  usage?: { inputTokens?: number; outputTokens?: number; costUsdEstimate?: number };
  backend: string; model?: string; sessionId?: string;
  rateLimited?: boolean;
}
export interface AiBackend {
  id: "claude-cli" | "codex-cli" | "anthropic-api" | "openai-api" | "openai-plan";
  available(): Promise<{ ok: boolean; reason?: string; authMethod?: string }>;
  generate(req: AiRequest): Promise<AiResult>;
}
```
Errors are typed: `AuthError`, `RateLimitError` (with retry-after), `SchemaRefusal` (no structured output returned), `TimeoutError`, `BackendError`.

### 6.2 Backends — verified flags
**`claude-cli`** (Claude Code, `claude -p`):
- `--output-format json` → result object with `result`, `session_id`, `total_cost_usd` (client-side estimate) and, with `--json-schema '<schema>'`, the data in **`structured_output`** (absent if the model declined — check before use).
- `--tools ""` disables all built-in tools; `--disallowedTools "mcp__*"` removes MCP tools; `--strict-mcp-config` (with no `--mcp-config`) loads none.
- `--system-prompt-file <path>` replaces the default (coding) system prompt — recommended for non-coding pipelines per Claude Code docs.
- `--max-turns N`, `--model <alias|id>`, `--fallback-model a,b`, `--no-session-persistence`, `--permission-prompts none`, `--max-budget-usd` (API usage cap, client estimate).
- Isolation from the user's own Claude config: `--safe-mode` disables CLAUDE.md, skills, plugins, hooks, MCP servers, auto memory **while keeping authentication** (unlike `--bare`, which skips OAuth). `--setting-sources` selects `user,project,local`. Run in an **empty temp cwd** (a non-bare `-p` session runs a folder's `.claude/settings.json` hooks and `.mcp.json` servers without a trust prompt).
- Auth check: `claude auth status` → JSON with `authMethod` (`none`, `claude.ai`, `oauth_token`, `api_key`, `api_key_helper`, `third_party`); exit 0 if logged in.
- Stop cleanly: SIGINT (ends turn) before SIGTERM (exit 143, no result recorded).
- See R1/R2 before shipping subscription use.

Sketch:
```ts
const args = [
  "-p", "--output-format", "json",
  "--json-schema", JSON.stringify(schema),
  "--system-prompt-file", systemFile,
  "--tools", "", "--disallowedTools", "mcp__*", "--strict-mcp-config",
  "--safe-mode", "--no-session-persistence", "--permission-prompts", "none",
  "--max-turns", "2",
];
// spawn("claude", args, { cwd: emptyTempDir, stdio: ["pipe","pipe","pipe"] }) ; write prompt to stdin (≤ 10 MB)
```
**[VERIFY]** the exact combination (`--safe-mode` with `-p` and `--system-prompt-file`) on the pinned Claude Code version in an integration test.

**`codex-cli`** (`codex exec`):
- `--json` (JSONL events: `thread.started`, `turn.completed`, `error`…), `--output-schema <file>`, `-o/--output-last-message <path>`, `--sandbox` (default read-only; `workspace-write`, `danger-full-access`), `--skip-git-repo-check`, `--ephemeral` (no session files), `--ignore-user-config` (skip `$CODEX_HOME/config.toml`), `--ignore-rules`.
- Auth: reuses saved CLI login (ChatGPT) by default; `CODEX_API_KEY` for API-key runs (set per invocation).
- Run in an empty temp dir with `--sandbox read-only`. Working-dir flag (`-C/--cd`) and model flag not confirmed on the docs page **[VERIFY]**.
- Codex can't disable command execution entirely the way `--tools ""` does; read-only sandbox + empty cwd + a system prompt that forbids tool use is the mitigation **[VERIFY]**.

**`anthropic-api` / `openai-api`**: direct API with the user's own keys (stored by Electron main with `safeStorage` **async** API — sync API deprecated in Electron 45, removal planned for 46; on Linux check `getSelectedStorageBackend()` ≠ `basic_text`).

**`openai-plan`** (later): "Sign in with ChatGPT" OAuth (PKCE, loopback `127.0.0.1` redirect, Responses API with the access token; per third-party docs `store: false`, `stream: true`, and some params like `temperature` unsupported) — **requires OpenAI approval for paid apps** (R3) **[VERIFY all details against OpenAI's official docs]**.

### 6.3 Isolation rules (MUST)
- Empty temp working directory per call; deleted afterwards.
- No tools, no MCP, no user/project customisations loaded.
- Prompt via stdin or a temp file; never interpolate user text into shell strings (use `spawn` with an args array).
- Never pass API keys on the command line; use env for the child process only.

---

## 7. Renderer contract (`packages/renderer`) — what the engine needs

### 7.1 `RenderPort` (engine-side interface)
```ts
export interface RenderPort {
  check(spec: SceneSpec, opts: { frames: number[] }): Promise<{ ok: true; stills: string[] } | { ok: false; errors: RenderError[] }>;
  renderShot(spec: SceneSpec, out: string, q: "preview" | "final", signal?: AbortSignal): Promise<{ path: string }>;
  renderEpisode(ep: EpisodeSpec, out: string, q: "preview" | "final", onProgress?: (p: number) => void, signal?: AbortSignal): Promise<{ path: string; durationSeconds: number }>;
}
export interface RenderError { shotId: string; frame?: number; message: string; path?: string /* JSON path in spec if known */ }
```
- `check` renders a few stills (`renderStill`) to catch runtime errors and give the UI thumbnails. Map exceptions back to spec paths where possible (kit components should throw typed errors like `UnknownAction(characterId, action)`).
- A `FakeRenderPort` is required for engine tests (deterministic errors for given inputs).

### 7.2 Remotion specifics (verified)
- Programmatic APIs: `@remotion/bundler` `bundle()`, `@remotion/renderer` `selectComposition()`, `renderMedia()`, `renderStill()`, `ensureBrowser()`.
- **Electron:** don't `bundle()` at runtime in packaged apps — prebuild during packaging and load the directory; `ensureBrowser()` may download Chrome Headless Shell on first render (pre-download at packaging + `browserExecutable`, or download with progress UI); compositor binaries must **not** load from inside `app.asar` (`binariesDirectory` → `app.asar.unpacked`); Linux needs separate gnu/musl builds; macOS universal needs both compositor arches.
- Remotion's Electron guide runs `selectComposition`/`renderMedia` in the main process and exposes render via preload/IPC. Running it from a `utilityProcess` instead is not covered by the guide **[VERIFY with a spike]**.
- Licensing: see R4.

### 7.3 Determinism
- Same spec + same kit version → same frames. Record `rendererVersion` and `kitVersion` in `RenderReport`.
- Render cache keyed by `sha256(specHash, kitVersion, rendererVersion, quality)`.
- Everything moving is a pure function of the frame: the rig (`kit/src/rig.ts`, seeded FNV hash rather than Remotion's `random()` so the kit has no Remotion dependency), atmosphere (Remotion `random(seed)`), and grain (one of 3 baked images, chosen by frame).
- Verified (`packages/renderer/test/golden.test.ts`, opt-in with `MOCO_RENDER_TESTS=1`): all 300 frames of the premium golden scene are byte-identical whether rendered on 1 tab or 8. Golden stills (frames 0, 30, 90, 150 and 240) are compared by a 512-bit dHash over the whole frame and over the character region, with tolerance 8 bits; the measurements behind that number are in the test header.

### 7.4 Scene layers and the premium look (as built)
Draw order in `src/remotion/Scene.tsx`:
1. Background layers, back to front. With parallax, each layer moves by its depth (0 = far, 1 = near). An `atmosphere[].layer` entry is drawn just in front of the named layer.
2. Back-placed atmosphere.
3. The world: props and actors, under the nearest layer's camera transform.
4. Fx, then front-placed atmosphere.
5. Time-of-day tint, then the grade (`mix-blend-mode: soft-light`, measured at +5.7%).
6. Vignette and grain, then captions.

Performance rule: there are no live `filter: blur()`, shadows or CSS gradients in per-frame paths.
- Every soft image is baked once into a PNG by `pnpm --filter @moco/kit bake` (`kit/src/bake/`, a zero-dependency analytic PNG writer; a test checks the baked files are in sync). That covers skies, tints, grades, vignette, grain, dust, glow, mist and rays.
- Those PNGs are drawn with `<Img>` and only moved, scaled and faded.
- Images are served from `@moco/kit/assets` (`bundle({ publicDir: KIT_ASSETS_DIR })`).

`focus_on` keeps the actor's face at `FOCUS_POINT` (540, 576), above the captions, and clamps so the frame edges stay covered (`src/camera.ts`).

### 7.5 Benchmarks and budget
- `pnpm --filter @moco/renderer bench:render` (Phase 0 script) renders a spec N times at preview (scale 0.5) and/or final quality and records the median, slowest frames and machine info in `docs/benchmarks/render-<date>.{json,md}`. `--off <feature>` switches one premium feature off, and `--entry/--public-dir` benchmarks other compositions (the Rive spike).
- Results and the proposed render budget are in `docs/benchmarks/render-2026-10-30.md`.
- Rive: `docs/adr/rive-vs-svg-rig.md`. The decision is to keep the SVG rig and not ship `@remotion/rive`, which isn't frame-exact. A 150-line frame-exact player is in `spikes/rive/` if Rive is ever adopted.

---

## 8. Audio contract (`packages/audio`) — what the engine needs
```ts
export interface AudioPort {
  tts(lines: { id: string; text: string }[], voice: VoiceRef, language: string, outDir: string, signal?: AbortSignal): Promise<{ file: string; durationSeconds: number; words?: TimedWord[] }>;
  align(file: string, transcript: string, language: string): Promise<TimedWord[]>;   // whisper.cpp
  mix(input: MixInput, out: string): Promise<{ path: string }>;                       // VO + music ducking + SFX
}
```
- Word timings: from TTS alignment when the backend provides it; else **whisper.cpp** (via `nodejs-whisper`, MIT wrapper; `wordTimestamps` option; JSON/SRT/VTT; needs a C toolchain at build time — ship prebuilt binaries).
- Local TTS: `kokoro-js` (Apache-2.0, Node `device: "cpu"`, model `onnx-community/Kokoro-82M-v1.0-ONNX`) for English; Hindi via Kokoro is model-supported but **unconfirmed in kokoro-js** (R5). Regional languages: research item.
- Optional cloud TTS with the user's own key (e.g. ElevenLabs text-to-speech with timestamps).
- Music/SFX: bundled royalty-free library + user folder; mixing with FFmpeg (ducking/loudness filters **[VERIFY parameters]**). FFmpeg build licence (LGPL vs GPL) matters for distribution **[VERIFY]**.

---

## 9. Kit contract (`packages/kit`) — what the engine needs
The engine never imports React components. It reads `kit/src/catalog.json`, which `pnpm --filter @moco/kit catalog` generates from the component registry and the art. A test fails if the file is stale. As built (kit 0.2.0), trimmed:
```jsonc
{
  "kitVersion": "0.2.0",
  "characters": [{
    "id": "krishna", "packs": ["mahabharat"], "variants": ["default", "charioteer"],
    "actions": [{ "name": "raise_hand", "minFrames": 12, "params": { "side": ["left","right"] } }, { "name": "bless", "minFrames": 16, "params": { "side": ["left","right"] } },
                { "name": "speak", "minFrames": 6 }, { "name": "play_flute", "minFrames": 30 }, "…"],
    "expressions": ["neutral", "serious", "smile"],
    "visemes": ["A","B","C","D","E","F","X"],           // Rhubarb mouth-shape names; [] = no lip sync (keeps its expression mouth)
    "layers": ["arm_lower_L", "arm_lower_R", "…"], "angles": ["front"],
    "idle": { "breathPeriodFrames": 96, "blinkMinSeconds": 2, "blinkMaxSeconds": 5, "swayDegrees": 1.2, "…": 0 },
    "anchors": { "defaultScale": 0.6 }
  }],
  "props": [{ "id": "chariot", "attachPoints": ["seat"] }],
  "backgrounds": [{ "id": "kurukshetra", "layers": [{ "id": "sky", "depth": 0 }, { "id": "hills", "depth": 0.25 }, { "id": "armies", "depth": 0.5 }, { "id": "ground", "depth": 1 }], "timeOfDay": ["dawn","noon","dusk","night"] }],
  "fx": [{ "id": "dust", "maxDurationFrames": 90 }],
  "atmosphere": [{ "id": "dust", "placement": "back" }, { "id": "mist", "placement": "back" }, { "id": "light_rays", "placement": "front" }, { "id": "diya_glow", "placement": "front" }],
  "grades": ["none", "warm_epic", "cool_mystic"]
}
```
- **Art:** characters are layered SVG with named `<g id>` layers, hidden `pivot_*` markers and `<layer>--<variant>` overrides.
  - Illustrators follow `docs/kit-asset-spec.md`.
  - `kit/src/art/load.ts` validates the art at build time: required layers and pivots, and no scripts, images, filters, gradients or `url(`. Errors are typed: `ArtError` and `MissingLayerError`.
  - Krishna is converted; Arjuna is still React parts.
- **Rig:** `rigStateAt(actor, frame, { seed, idle?, visemes? })` is a pure function.
  - Gestures have anticipation, overshoot, hold and release.
  - Idle covers breathing, a seeded blink schedule, sway, secondary follow-through and feather flex.
  - Viseme mouths show only during `speak`.
- **Lip sync v0** (`packages/audio/src/lipsync.ts`): RMS loudness per frame inside spoken words, mapped to A/B/C/D, and X outside words. A renderer test checks that every shape it can emit is drawn by every character with visemes. Rhubarb is evaluated in `docs/adr/lip-sync.md`.
- Catalog is versioned with the kit; the engine validates specs against it (L2) and slices it into prompts (§4.7), without layers, visemes and idle, which the AI doesn't need.
- Packs (Ramayana, Shiva, Mahabharat) = catalog entries with `packs`; the engine only offers characters from installed/licensed packs.

---

## 10. Desktop contract (`apps/desktop`)
- Starts the engine host with `utilityProcess.fork` after `app.whenReady()`; talks via `MessageChannelMain`; renderer process → `contextBridge`/`ipcRenderer.invoke` → main → engine.
- Screens map to engine API: new series (`createSeries`), episode board (`status`, `on`), approvals (`approve/reject`), scene preview (`regenerateShot`, stills), render queue (`renderPreview/Final`, `cancel`), settings (AI backend + auth status, voice, brand, API keys via `safeStorage`).
- Desktop never writes into `projects/`.

---

## 11. What we keep from OpenMontage (and what we don't)

| OpenMontage pattern (verified in code) | moco adaptation |
|---|---|
| Schema-validated artifact per stage; checkpoint writer refuses invalid data | `store/artifacts.ts` + Zod in `@moco/spec` |
| Gate enforced at write time with an error that explains the protocol | `pipeline/gates.ts`; but approval comes from UI only (OpenMontage lets the agent pass `human_approved=True`) |
| History: superseded checkpoints copied to `history/` | Same, plus per-shot `attempts/` |
| Append-only decision log keyed by (category, subject) | Ledger table `decisions` (backend switches, fallbacks, bible changes) |
| Executive-producer send-back with caps (3 revisions/stage, 1 send-back per stage pair) | Planner/loop caps (§4.6, §4.8) — in code, not prose |
| Reviewer: max 2 rounds; critical findings must include a fix | Error messages always include an allowed-values list + fix line |
| Sample before batch | Generate + approve the **first shot** of the first episode before generating the rest |
| Slideshow-risk / repetition / generic-word checks before render | L2 checks: repeated identical camera moves, static shots > N s, captions-only shots |
| Content-addressed cache keyed by tool version + inputs | Render cache + TTS cache keyed by content hashes |
| Auto-instrumented tool calls → `events.jsonl` → live board | `events/bus.ts`; every job emits events automatically |
| Never auto-retry a paid submission | Capped retries for AI calls; rate-limit backoff with user-visible state |

Don't copy: agent-as-orchestrator (moco's engine orchestrates), huge instruction files, provider sprawl, docs that drift from code.

---

## 12. Testing
| Layer | What to test |
|---|---|
| spec | valid/invalid fixtures per schema; JSON Schema export snapshot; migrations |
| engine/store | atomic write under simulated crash; history; tamper detection; staleness propagation |
| engine/pipeline | gates open only with matching contentHash; reject feedback reaches next prompt; send-back caps |
| engine/loop | with `FakeAi` (scripted outputs) + `FakeRenderPort`: success first try; schema error then fix; semantic error then fix; 3 failures → fallback; error message format snapshot |
| engine/jobs | restart mid-episode resumes; cancel kills child; concurrency limits respected |
| ai | contract tests per backend with recorded stdout fixtures; one opt-in live smoke test per backend (manual/nightly) |
| renderer | golden spec → stills compared by perceptual hash; Electron packaged-build smoke test |
| audio | timing accuracy vs known clips; Hindi spike results recorded |
| e2e | idea → series plan → bible → 1 episode → preview MP4 with fakes in CI; with real backends manually |

Tooling: Vitest, TypeScript strict, pnpm workspaces (switch from npm workspaces in root `package.json` if desired — current root uses `"workspaces"`, which works with npm/pnpm/yarn).

---

## 13. Build plan — engine first

Each milestone ends with a demo-able check. E0–E4 need **no real AI and no real renderer**.

### E0 — Tooling (short)
- [ ] TypeScript strict, Vitest, lint, dependency rules (§3.1), CI.
- [ ] `packages/engine` public API stub (`createEngine`), `packages/spec` exporting a placeholder schema.
- **Done when:** CI green; dependency lint fails if engine imports Remotion.

### E1 — Spec v0 (with renderer/kit owners)
- [ ] Hand-build the Krishna chariot 10 s scene (CLAUDE.md "First step") **as a SceneSpec JSON** + the matching renderer components, then derive `SceneSpec` v0 from it.
- [ ] Schemas in §5.2 + `z.toJSONSchema` export; kit `catalog.json` v0 (Krishna, chariot, Kurukshetra).
- **Done when:** the golden spec validates, and the renderer team can render it; schema snapshot test exists.

### E2 — Store + pipeline (engine core)
- [ ] Workspace layout (§4.4), envelope, atomic save, history, ledger, tamper check.
- [ ] Stage machine (§4.3), gates bound to contentHash, staleness (§4.5), events.
- **Done when:** a scripted run with hand-written artifacts stops at each gate, resumes after `approve()`, survives a process restart, and marks downstream artifacts stale when the script changes.

### E3 — Generator + auto-fix loop with fakes
- [ ] Context builder (catalog slice, memory, examples), prompt templates, L1/L2 validators, feedback formatter, retry/fallback, attempts storage.
- [ ] `FakeAi` returning scripted outputs; `FakeRenderPort` with injectable errors.
- **Done when:** loop tests pass for: valid first try; schema error → fixed; unknown action → fixed using allowed-values hint; 3 failures → fallback shot flagged.

### E4 — Planner + memory with fakes
- [ ] Series plan, bible (kit-id-only cast), script fitting with per-language rates, shot list from timings, continuity updates.
- **Done when:** an end-to-end fake run produces series → bible → episode → VO (fake timings) → shot list → specs for every shot, all validated, with memory updated after approval.

### E5 — Real backends (spikes first, then adapters)
- [ ] `claude-cli` adapter with flags in §6.2 + integration test proving no tools/MCP/user config load and structured output works; `claude auth status` check.
- [ ] `codex-cli` adapter (`exec --json --output-schema -o --sandbox read-only --skip-git-repo-check --ephemeral --ignore-user-config`).
- [ ] `anthropic-api` adapter (first-class fallback per R1).
- [ ] TTS spike: English + Hindi with kokoro-js (and alternatives); record quality/latency.
- **Done when:** the same golden shot brief produces a valid SceneSpec through each backend within ≤ 3 attempts; rate-limit handling demonstrated with a forced error.

### E6 — Real renderer + audio integration
- [ ] `RenderPort` implementation on Remotion (check via stills, shot + episode render), audio mix, captions from word timings.
- **Done when:** idea → 30–45 s 9:16 MP4 with VO, captions and music, generated end to end on a dev machine.

### P — Premium kit + renderer upgrades (done 2026-10-30, branch `feat/engine`)
- [x] P0 render benchmark script + baseline (`packages/renderer/bench/`, `docs/benchmarks/`).
- [x] P1 layered SVG art pipeline + asset spec for illustrators (`kit/art/`, `kit/src/art/`, `docs/kit-asset-spec.md`).
- [x] P2 rig: anticipation/overshoot curves, idle motion, `bless`, `play_flute`; spec 0.2.0 (`idle`).
- [x] P3 lip sync v0 + Rhubarb evaluation (`audio/src/lipsync.ts`, `docs/adr/lip-sync.md`).
- [x] P4 looks: time of day, parallax backgrounds, atmosphere, grade, vignette, grain (all baked), `focus_on`.
- [x] P5 Rive spike + ADR (`renderer/spikes/rive/`, `docs/adr/rive-vs-svg-rig.md`): stay on SVG.
- [x] P6 L2 cinematography rules + loop tests.
- [x] P7 premium golden scene (prompt example + renderer golden stills + determinism test) and benchmark report.
- **Done when:** golden stills and determinism tests pass, and the benchmark report proposes a render budget (`docs/benchmarks/render-2026-10-30.md`).

### E7 — Desktop integration + hardening
- [ ] utilityProcess host, IPC, approvals UI, render queue, settings, packaged-build Remotion setup (§7.2).
- [ ] Partial regeneration (§4.5), render cache, usage meter UI, crash recovery.
- **Done when:** a packaged app on a clean machine completes an episode offline (except AI calls), and editing one script line re-generates only affected shots.

---

## 14. Open decisions (owner + by when)
1. **Subscription strategy** (R1–R3): ask Anthropic and apply to OpenAI's program; decide default backend for launch.
2. **Remotion licence** (R4): written answer from Remotion; else evaluate HyperFrames before E6.
3. **Languages at launch** (R5): which languages, which TTS per language.
4. **AI output = spec JSON** (§4.1): confirm and update `CLAUDE.md`.
5. **VO before shot specs** (§4.3): confirm the change to the README flow.
6. **Ledger storage**: SQLite (`better-sqlite3` needs `@electron/rebuild`) vs JSON files for v0.
7. **Package manager**: keep npm workspaces or move to pnpm.

---

## 15. Glossary
- **Engine:** `packages/engine`, the orchestrator and single writer of `projects/`.
- **Artifact:** schema-validated JSON produced by a stage (`{meta, data}`).
- **Gate:** a stage that waits for user approval in the UI, bound to the artifact's content hash.
- **Stale:** built from inputs that have since changed.
- **Attempt:** one AI generation for a shot, stored with its validation errors.
- **Fallback shot:** deterministic safe shot used after max attempts; flagged for the user.
- **Catalog:** machine-readable index of kit characters/actions/props/backgrounds.
- **Backend:** one way of calling an AI (`claude-cli`, `codex-cli`, `anthropic-api`, …).

---

## 16. Sources (opened during verification)
**moco repo:** https://github.com/Pratheek555/moco (README.md, CLAUDE.md, package READMEs)

**OpenMontage (read from source):** https://github.com/calesthio/OpenMontage — `lib/checkpoint.py`, `tools/base_tool.py`, `tools/tool_registry.py`, `tools/cost_tracker.py`, `tools/provider_jobs.py`, `lib/scoring.py`, `lib/asset_cache.py`, `lib/slideshow_risk.py`, `pipeline_defs/animated-explainer.yaml`, `skills/meta/*.md`, `skills/pipelines/explainer/*.md`

**Claude Code / Anthropic**
- Headless (`claude -p`, `--bare`, structured output): https://code.claude.com/docs/en/headless.md
- CLI reference (all flags): https://code.claude.com/docs/en/cli-reference.md
- Agent SDK overview (third-party login policy): https://code.claude.com/docs/en/agent-sdk/overview.md
- Agent SDK TypeScript: https://code.claude.com/docs/en/agent-sdk/typescript.md

**OpenAI / Codex**
- Codex non-interactive (`codex exec`): https://learn.chatgpt.com/docs/non-interactive-mode.md
- Codex SDK: https://learn.chatgpt.com/docs/codex-sdk.md
- Sign in with ChatGPT (third-party summaries; verify on openai.com): https://thenewstack.io/sign-in-with-chatgpt/ · https://flaviocopes.com/sign-in-with-chatgpt.md · https://www.developersdigest.tech/blog/sign-in-with-chatgpt-coding-agents-plan-usage-2026
- Policy page (did not load during verification): https://openai.com/policies/sign-in-with-chatgpt-terms/

**Rendering**
- Remotion licence FAQ: https://www.remotion.dev/docs/license/faq
- Remotion in Electron: https://www.remotion.dev/docs/electron
- Remotion renderer API: https://www.remotion.dev/docs/renderer
- HyperFrames (plan B): https://github.com/heygen-com/hyperframes

**Stack**
- Zod JSON Schema: https://zod.dev/json-schema
- Electron utilityProcess: https://electronjs.org/docs/latest/api/utility-process
- Electron safeStorage: https://www.electronjs.org/docs/latest/api/safe-storage

**Audio**
- kokoro-js: https://www.npmjs.com/package/kokoro-js
- Kokoro voices incl. Hindi: https://ttsforge.readthedocs.io/en/latest/voices.html
- nodejs-whisper (whisper.cpp): https://github.com/ChetanXpro/nodejs-whisper
- Piper status: https://www.cekura.ai/discover/piper-tts
- ElevenLabs TTS with timestamps: https://elevenlabs.io/docs/api-reference/streaming-with-timestamps
