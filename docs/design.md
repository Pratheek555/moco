# Moco design

How the desktop app looks, reads and behaves. The contracts behind it are in [reference.md](reference.md).

## Who it is for

A person who runs a faceless history channel. They are not a developer. They paid once, they have a Claude or ChatGPT subscription, and they want a finished video. A typical session: describe the video, answer a few questions, wait many minutes while the AI works, watch the result, ask for changes, save the MP4.

What follows from that:

1. **The video is the product.** Outputs are large, playable and one click from saved. Tool calls and logs are available but never in the way.
2. **Waiting is most of the session.** It is always clear whether Moco is working, waiting for the person, or stopped; what it is doing now; and how long it has been. People can leave: a notification brings them back.
3. **Nothing technical is required to start.** First run walks from a fresh install to a first project: connect an AI, add a skill, create a project. Every dead end has a next step on screen.
4. **The skill is the creative authority.** Moco adds no creative prompts, templates, suggestions or pipelines of its own. Chrome is quiet.
5. **It is a desktop app.** Native window chrome, keyboard shortcuts, context menus, drag and drop in and out, state that survives a restart.

## Structure

```
Window
├─ Sidebar (256px, collapsible, Ctrl/Cmd+B)
│  ├─ Logo
│  ├─ New project            Ctrl/Cmd+N
│  ├─ Home · Skills
│  ├─ Projects (newest first; state dot; row menu: Rename, Show in folder, Delete)
│  └─ Footer: AI connection summary · Settings (Ctrl/Cmd+,)
└─ Main
   ├─ Home        get-set-up checklist (first run) or New project + recent projects
   ├─ Skills      library, starter skills, import
   └─ Project     top bar · conversation + composer · files panel (resizable, collapsible)

Overlays: New project dialog · Settings dialog · Command palette (Ctrl/Cmd+K) ·
          Rename / Delete dialogs · Media viewer · Toasts
```

There is no router. `AppState.route` (`state/app-context.ts`) is `home`, `skills` or `project`.

## Visual system

Tokens live in `apps/desktop/src/renderer/src/styles.css`. Use them through Tailwind classes. Never write a hex or oklch colour in a component.

**Colour.** Cool neutrals and one accent, the Moco blue (`primary`). Blue means "the main action" or "working". `warning` (amber) means "waiting for you". `destructive` (red) means failed or deleting. `success` (green) means connected or done. Media sits on `bg-stage` (dark in both themes) so video and images read the same in light and dark. Surfaces: `bg-sidebar` for the sidebar and the files panel, `bg-background` for the main panel, `bg-card` for raised cards, `bg-secondary` / `bg-muted` for fills. Both themes must look intentional; check every screen in dark.

**Type.** Inter Variable. Sizes:

| Use | Class |
|---|---|
| Page title (Home, Skills) | `text-2xl font-semibold tracking-tight` |
| Dialog and section titles | `text-base font-semibold` |
| Conversation text | `text-[15px] leading-7` |
| UI text, buttons, inputs, list rows | `text-sm` |
| Secondary text, descriptions | `text-[13px] text-muted-foreground` |
| Meta: timestamps, sizes, counts, labels | `text-xs text-muted-foreground` |

Nothing is smaller than `text-xs` (12px). No uppercase eyebrow labels. Weights: 400 body, 500 for emphasis and buttons, 600 for titles. Numbers that update (timers, counts, sizes) use `tabular-nums`. Paths and code use `font-mono`.

**Space and shape.** A 4px grid: gaps of 1, 1.5, 2, 3, 4, 6, 8. Page padding `px-8 py-8` on Home and Skills, content capped at `max-w-5xl`. Conversation column capped at `max-w-3xl` and centred. Radii: controls `rounded-md`, cards and menus `rounded-xl`, the composer and dialogs `rounded-2xl`, pills `rounded-full`. Borders are 1px `border-border`. Shadows are rare: `shadow-xs` on outline buttons and cards that lift, `shadow-lg` on popovers and dialogs. No gradients, no glows, no glass.

**Icons.** `lucide-react`, 16px in controls (`size-4`), `strokeWidth` default. Every icon-only button has an `aria-label` and a `Tooltip`. No emoji.

**Motion.** 150 ms ease-out for hover and press; `animate-in fade-in` for things that appear. The only looping motion is "working": `text-shimmer` on the status line, `animate-pulse-soft` on a running dot, `Spinner` in buttons. Nothing bounces. `prefers-reduced-motion` is handled globally.

**Components.** Build from `components/ui/*` (shadcn). Do not hand-roll a control that exists there: Button, Dialog, AlertDialog, DropdownMenu, ContextMenu, Tooltip, Popover, Tabs, ToggleGroup, RadioGroup, Switch, Checkbox, Input, Textarea, ScrollArea, Skeleton, Spinner, Progress, Badge, Empty, Command, Sidebar, Resizable, Collapsible, Kbd, Sonner. Shared app pieces are in `components/app/*`: `LogoMark`, `Logo`, `TopBar`, `RunStateDot`, `RunStateBadge`. Helpers: `lib/api.ts` (`api`, `run`, `errorMessage`), `lib/format.ts` (`relativeTime`, `clockTime`, `fileSize`, `duration`, `fileName`, `uploadName`).

**Selectable text.** The body is `user-select: none`. Conversation text, paths, errors and anything a person might copy get `select-text`.

**States.** Every list and panel has four: loading (Skeleton, never a spinner on a blank page), empty (the `Empty` component: one line saying what will appear here and one action), content, and error (what happened in plain words, then what to do).

## Words

Plain, short, sentence case. Say what will happen. Buttons are verbs: "Create project", "Add skill", "Save a copy", "Check again". No exclamation marks, no "please", no "oops", no "successfully". Do not explain the interface in the interface.

- The person's AI is called by its name: "Claude Code" or "Codex". Generic: "your AI". Avoid "agent", "LLM", "model", "session", "provider" in visible text ("AI" or the name instead).
- "Project", "Skill", "Files", "Project folder" (not "workspace").
- States: "Working", "Waiting for you", "Ready", "Needs attention".
- Errors say what to do next. "Codex is signed out. Sign in, then check again." Never show a stack trace or "Error invoking remote method"; `errorMessage()` strips the prefix.
- Destructive confirmations name the thing and the consequence: "Delete “Fall of Rome”? The conversation is removed from Moco. The project folder and its files stay on your computer."

## Window

The title bar is hidden. The top 48px of the main panel (`TopBar`) and the top of the sidebar drag the window. On Windows the system buttons overlay the top-right 140px; on macOS the traffic lights overlay the top-left 76px. `App.tsx` sets `data-platform` on `<html>` from `info().platform`, which sets `--window-controls-width` / `--traffic-lights-width`. `TopBar` already pads for both. The sidebar header pads its top on macOS (`pt-10` when `data-platform=darwin`). Linux keeps the system frame.

Default size 1380×900, minimum 960×640. Size, position and maximised state are remembered.

## Shell

**Sidebar** (shadcn `Sidebar`, `collapsible="offcanvas"`). Top to bottom:

- `Logo`, in a drag region.
- "New project" button, full width, `variant="outline"`, with `Kbd` hint on hover.
- Menu: Home, Skills.
- "Projects" group. Each row: project name (truncate) and, on the right, a state mark: pulsing blue dot (working), amber dot (waiting for you), red dot (error), or a small blue "unseen" dot when `attention[id]` is set. Tooltip names the state. Selected row uses `sidebar-accent`. Hover or focus reveals a "…" `DropdownMenu`; right-click opens the same items as a `ContextMenu`: Rename, Show in folder, Delete…. When there are more than 8 projects a filter input appears above the list. Empty: "No projects yet."
- Footer: one row per connection problem only when there is one ("Codex is signed out", amber, opens Settings → AI); otherwise a single quiet "Settings" button with a gear.

**Command palette** (`Command` in a `Dialog`, Ctrl/Cmd+K): New project, Go to Home, Go to Skills, Settings, switch theme, and every project by name.

**Toasts** (`Toaster` from `components/ui/sonner`, bottom-right) carry failures from `run()` and confirmations that have no other visible result ("Saved to Downloads" style). Do not toast what the screen already shows.

**Shortcuts.** Ctrl/Cmd+N new project, Ctrl/Cmd+K palette, Ctrl/Cmd+, settings, Ctrl/Cmd+B sidebar, Ctrl/Cmd+. files panel, Esc closes overlays, Enter sends, Shift+Enter new line. The main process sends `new-project`, `settings` and `open-project` through `api.onCommand`.

## Home

Heading: **"What will you create?"** (`h1`).

**First run** — shown while there is no project and setup is incomplete. A "Get set up" card with three numbered steps. A finished step collapses to one line with a green check; the first unfinished step is open.

1. **Connect your AI.** A row each for Codex and Claude Code: name, one line on what is needed ("Uses your ChatGPT subscription" / "Uses your Claude subscription"), and status: checking (Spinner), "Connected" with version (green check), "Not installed", "Signed out", or "Can't connect". An unconnected row expands to numbered instructions with copyable commands (`ProviderSetup`, below) and a "Check again" button. One connected AI completes the step.
2. **Add a skill.** Starter skills from `api.starterSkills()` as cards with name, description and "Add skill"; then "Import a skill folder" and "Import SKILL.md". The whole card is also a drop target for a skill folder or SKILL.md (`api.importSkillDropped`). One skill completes the step.
3. **Create your first project.** A primary "New project" button, enabled when steps 1 and 2 are done.

**Returning** — a primary "New project" button beside the heading, then "Recent projects": a responsive grid of cards (`grid-cols-[repeat(auto-fill,minmax(240px,1fr))]`). Each card: a 16:9 cover on `bg-stage` (the newest image or video in the project folder, via `api.files` + `mediaUrl`; a muted `LogoMark` when there is none), project name, "skill · AI", relative time, and a `RunStateBadge` when not idle. Projects waiting for the person sort first. The card is one button; right-click gives the project menu. If an AI that existing projects use is not connected, a single slim notice above the grid links to Settings → AI.

**ProviderSetup** (`features/shell/ProviderSetup.tsx`, used by Home and Settings). Driven by `ProviderStatus.issue`:

- `not-installed`, Codex: 1. Install Node.js from nodejs.org if you do not have it. 2. In a terminal run `npm install -g @openai/codex`. 3. Run `codex login` and sign in with ChatGPT.
- `not-installed`, Claude Code: 1. In PowerShell run `irm https://claude.ai/install.ps1 | iex` (Windows) or in Terminal run `curl -fsSL https://claude.ai/install.sh | bash` (macOS, Linux); show the one for `info.platform`. 2. Run `claude` and sign in with your Claude account.
- `signed-out`: only the sign-in step (`codex login` / `claude`).
- `unavailable` or no `issue`: show `status.reason` and "Check again".

Each command sits in a mono box with a copy button (`api.copyText`, the icon turns into a check for 2 s). Below: "Moco uses your own subscription. It never asks for an API key."

## New project dialog

`Dialog`, title "New project". One form:

- **Project name** — `Input`, autofocus, `maxLength` 120, placeholder "Name your project".
- **Skill** — `RadioGroup` (`aria-label="Skill"`) of cards: skill name and a two-line description. Preselect the skill used last (`localStorage`), else the newest. With no skills: an inline empty state with "Add a skill" that goes to Skills.
- **AI** — `RadioGroup` (`aria-label="AI provider"`) of two cards, "Codex" and "Claude Code", each with its live status. A disconnected one stays selectable and shows "Not connected · Set up" (opens Settings → AI). Every new project defaults to Codex. Connection checks never change the selected AI; Claude requires an explicit selection for that project.
- Footer: "Cancel", primary "Create project" (disabled until name and skill; shows a Spinner while creating). Below the form, muted: "Saved in {projectsDir}".

On success: close, refresh, navigate to the project, focus the composer.

## Skills

Heading "Skills", with "{n} imported" beside it and the two import buttons ("Import folder", "Import SKILL.md") on the right. One sentence under the heading: "A skill tells your AI how to make your videos. Each project uses one."

- **Your skills** — cards: name, description (three lines), "Added {relative time}", "Used by {n} projects" when > 0, and a "…" menu with "Remove from library…" (AlertDialog: "Projects that use it keep their own copy."). Re-importing a skill adds a new version; show the newer one first.
- **Starter skills** — the ones from `api.starterSkills()` not yet in the library (match by name), each with "Add skill".
- The page is a drop target for a skill folder or SKILL.md, with a visible drop overlay.
- Empty: "No skills yet. Add a starter skill or import your own."

## Settings dialog

`Dialog`, title "Settings", a left list of sections and a content pane (stack on narrow widths).

- **General** — Appearance: `RadioGroup` `aria-label="Appearance"` with "System", "Light", "Dark" (applies at once). Notifications: `Switch` "Notify me when a project finishes or needs an answer".
- **AI** — a card per AI with status, version, `ProviderSetup` when not connected, and "Check again".
- **Storage** — "Project folders are saved in" + path (mono, selectable) + "Open folder" (`api.openProjectsFolder`).
- **About** — `LogoMark`, "Moco", version, and a keyboard shortcut list.

## Project

`ProjectScreen({ projectId })` owns everything right of the sidebar.

**Top bar** (`TopBar`, with `data-testid="project-header"`): project name as `h1` (`text-sm font-semibold`, truncate), then muted "skill · AI"; a `RunStateBadge` when not idle; on the right "Open folder" (ghost, icon + label), a files-panel toggle (icon, pressed state), and a "…" menu (Rename, Delete…) that calls `requestRename` / `requestDelete`.

**Body**: `ResizablePanelGroup` horizontal — conversation (min 420px) and the files panel (default 360px, min 280px, max 50%). Panel width and open/closed persist in `localStorage`.

When the project body cannot fit both panel minimums (including at increased UI zoom), the files toggle opens a right-side drawer with the same Files and Progress controls. It remains available without hiding the sidebar or shrinking the conversation below its minimum width.

### Conversation

A scroll area with a centred `max-w-3xl` column, `px-6`, generous vertical rhythm (`space-y-6` between turns).

- **Your messages** — right-aligned bubble, `bg-secondary rounded-2xl px-4 py-2.5`, max 85% width, text preserved (`whitespace-pre-wrap`), attachments as chips under the bubble (image thumbnails for image uploads). Hover shows the time and a copy button.
- **AI text** — no bubble, full column width, rendered as Markdown (`react-markdown` + `remark-gfm`, no raw HTML): headings, lists, tables (horizontal scroll), block quotes, inline code, fenced code with a copy button. Links open in the browser through `api.openExternal` (https only; others render as text). Remote images are not loaded. Hover shows a copy button.
- **Work** — consecutive thinking, tool calls and activity fold into one quiet block between pieces of text. Collapsed (default) it is a single line: a chevron, an icon, and a plain summary of what was done — "Read 3 files · Ran 2 commands · Edited story.mjs". While the block is the live edge of a running turn the line is the current step in `text-shimmer`: "Running a command…". Expanded, each step is a row: icon, plain title ("Read SKILL.md", "Ran `node render.mjs`", "Searched the web for …", "Thought for a moment"), a red mark if it failed; a step opens to show its input and output in a scrollable mono box (`max-h-64`, `select-text`). Titles come from one `describeTool(name, input)` function that knows the tool names of both AIs (Claude: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, TodoWrite, Task, Skill, …; Codex: Shell, File changes, Web search, `mcp__server__tool`, `moco_*`) and falls back to the raw name. `SendUserFile`, `AskUserQuestion` and task-list tools are not listed as steps: the file card, question card and progress list already show them.
- **Questions** — a card (`form`, `aria-label="Agent question"`, `border-primary/30`): a small "Waiting for your answer" label; for each question its `header` as a `Badge`, the question text, and options as full-width selectable rows (radio or checkbox, label, muted description; the whole row is the label). Then an "Other" `Input` (`aria-label="Other: {question}"`, placeholder "Something else"). "Continue" is enabled when every question has an answer. Answered, the card collapses to the question and "You answered: …". Number keys 1–9 pick options of the focused question.
- **Delivered files** — `<DeliveredFile path label />` from `features/files`.
- **Errors** — a card with a red icon, the message (`select-text`), and next steps: "Send a message to try again." When the AI is not connected, a "Set up {AI}" button opens Settings → AI.
- **Stopped** — a centred muted line: "Stopped. Send a message to continue."
- **Status line** — while running, the last item in the column: `text-shimmer` "Working…" with the elapsed time of this turn (`tabular-nums`, updates each second). While waiting: amber dot + "Waiting for your answer" and, if the question is off screen, a "Go to question" button.
- **Turn end** — after a completed turn of 30 s or more, a muted line "Worked for 4m 12s".
- **Day separators** between messages on different days; times on hover.
- **Scrolling** — stays pinned to the bottom while the person is at the bottom. Scrolling up unpins; a round "Jump to latest" button appears above the composer, with a dot when new content arrived.
- **Empty** — centred: `LogoMark`, "Ready when you are", then "Your AI will follow **{skill name}**." and the skill's description in muted text. No suggested prompts.

Performance: build blocks with `useMemo`; memoise message components so streaming text re-renders only the last block.

### Composer

A `rounded-2xl border bg-card shadow-xs` box pinned under the conversation, same `max-w-3xl` column.

- Auto-growing `Textarea` (`aria-label="Message"`), 1 to 10 lines, then scrolls. Placeholder: "Describe what you want to make" on an empty project, "Reply or ask for a change" after.
- Attachment chips above the text: thumbnail (images) or file icon, original file name (`uploadName`), remove button (`aria-label="Remove {name}"`).
- Bottom row: "Attach files" (ghost icon button with `aria-label="Attach files"` and tooltip), then on the right a round primary send button (`aria-label="Send message"`). While running, a "Stop" button (`aria-label="Stop"`, outline, square icon) sits beside send; send still works, because messages reach the AI while it works.
- Enter sends, Shift+Enter breaks the line, IME composition is respected.
- **Drop and paste.** Dragging files over the conversation shows a full-column overlay "Drop files to attach"; dropping calls `api.attachDropped`. Pasting files does the same; pasted image data without a file calls `api.attachPasted` with a generated name.
- Drafts persist per project in `localStorage` and are cleared on send.
- When the project's AI is not connected: a slim notice above the composer, "{AI} is not connected." + "Set up", and send is disabled with a tooltip. Typing stays possible.
- The composer takes focus when a project opens and after sending.

## Files panel

`WorkspacePanel` on `bg-sidebar`, full height, its own scroll.

- **Progress** (only when the AI has a task list): title "Progress", "{done} of {total}", a thin `Progress` bar, then the tasks: check (done, muted text), spinner (in progress, while the project is running; a blue ring otherwise), empty ring (pending). `section` with `aria-label="Agent tasks"`. Collapsible; collapses itself when every task is done.
- **Files**: title "Files", a `ToggleGroup` or `Tabs` with "Outputs" and "All files", and a refresh icon button.
  - **Outputs** — delivered files and new media (not under `uploads/`), newest first, as cards: media preview on `bg-stage` (image: contain; video: poster frame with a play mark and duration; audio: an inline player), name, "size · relative time", and a "…" menu. Clicking the preview opens the viewer. Files not yet seen in the viewer show a small blue dot. Empty: "Videos, images and audio your AI makes will appear here."
  - **All files** — a folder tree (folders first, collapsible, remembered per project), each file a compact row: type icon, name, size. Click opens the viewer for media and text, or the default app for anything else. Empty: "This project folder is empty."
  - Every file menu: Open, Show in folder, Save a copy…, Copy path. Rows and cards are draggable out of the app (`draggable` + `api.dragFile` in `onDragStart` after `preventDefault`).

**DeliveredFile** (in the conversation): a card up to 480px wide — the label ("{label}" or "Shared a file"), a large preview that opens the viewer, the name and size, and visible "Save a copy" and "Show in folder" buttons. If the file no longer exists: a muted row "{name} is no longer in the project folder."

**Viewer** (one per project, opened by `useWorkspace().view(path)`): a near-full-window `Dialog` on `bg-stage`. Image: fit to window, click toggles actual size. Video: native controls, starts playing. Audio: a player with the file name. Text-like files (`.txt .md .json .srt .vtt .csv .log .mjs .js .ts .py .yaml .yml .toml .html .css .xml`): `api.readTextFile` in a mono scroll box, with "Showing the first part of this file" when truncated. Anything else: icon, name and "Open in default app". Header: file name, "size · modified", and Save a copy, Show in folder, Open, Close. Left/Right arrows step through the list the file was opened from; Esc closes.

## Notifications and quitting

When the window is not focused and notifications are on, the main process notifies: "{Project} needs your answer", "{Project} is ready" (a turn finished), "{Project} stopped with an error". Clicking focuses the window and opens the project. Closing the window while a project is working asks first: "Moco is still working on {n} project(s). Quit anyway?".

## Names that tests rely on

Keep these accessible names and hooks stable. `apps/desktop/scripts/smoke-test.mjs` uses them.

| Where | Hook |
|---|---|
| Home | `h1` "What will you create?" |
| Sidebar | `nav` `aria-label="Projects"`; each project is a button whose name contains the project name; buttons "New project", "Home", "Skills", "Settings" |
| New project dialog | dialog "New project"; textbox "Project name"; radiogroup "AI provider" with radios "Codex", "Claude Code"; radiogroup "Skill" with a radio per skill name; button "Create project" |
| Skills | `h1` "Skills"; text "{n} imported"; buttons "Import folder", "Import SKILL.md" |
| Settings | dialog "Settings"; radiogroup "Appearance" with radios "System", "Light", "Dark" |
| Project | `data-testid="project-header"` containing name, skill name and AI label |
| Composer | textbox "Message"; buttons "Attach files", "Send message", "Stop"; chip buttons "Remove {file name}" |
| Tasks | region `aria-label="Agent tasks"` |
| Question | form `aria-label="Agent question"`; options labelled by their label; textbox "Other: {question}"; button "Continue" |
| Media | images use the file name as `alt` |
| Theme | `<html>` has class `dark` in dark mode |

## Code map

```
apps/desktop/src/renderer/src/
  main.tsx, App.tsx              app provider, shell composition, global shortcuts
  styles.css                     tokens and base styles only
  state/app-context.ts           AppState, Route, useApp()
  lib/api.ts, lib/format.ts      api, run(), errorMessage(); formatting helpers
  conversation.ts                persisted events → transcript blocks
  components/ui/*                shadcn components
  components/app/*               Logo, TopBar, RunState
  features/shell/*               AppSidebar, CommandPalette, SettingsDialog, ProviderSetup, project dialogs
  features/home/*                Home, GetSetUp, NewProjectDialog, SkillsPage
  features/project/*             ProjectScreen, transcript, Markdown, work log, questions, composer
  features/files/*               WorkspaceProvider, WorkspacePanel, DeliveredFile, viewer
```

Rules: strict TypeScript, erasable syntax only (no enums, namespaces or parameter properties). Tailwind utilities in components; a feature may add one small CSS file for things utilities cannot express (Markdown prose). The renderer talks to the system only through `api` (`window.moco`). No application-authored creative workflow, prompt suggestions, output schema, validation or repair loop.
