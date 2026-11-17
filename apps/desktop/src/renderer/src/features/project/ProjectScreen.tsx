import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, FolderOpen, MoreHorizontal, PanelRight, Pencil, Speech, Trash2 } from "lucide-react";
import type { NarrationEngine, Project, RunState } from "../../../../shared/api.ts";
import { providerLabels } from "../../../../shared/api.ts";
import { TopBar } from "../../components/app/top-bar.tsx";
import { RunStateBadge } from "../../components/app/run-state.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu.tsx";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../components/ui/resizable.tsx";
import { Skeleton } from "../../components/ui/skeleton.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.tsx";
import { api, run } from "../../lib/api.ts";
import { useApp } from "../../state/app-context.ts";
import { WorkspaceProvider } from "../files/workspace.tsx";
import { WorkspacePanel } from "../files/WorkspacePanel.tsx";
import { Conversation, useTranscript } from "./Conversation.tsx";
import { readSetting, writeSetting } from "./storage.ts";
import { useProjectView } from "./use-project-view.ts";
import { NarrationOptions, narrationLabels } from "./NarrationOptions.tsx";

export { useProjectView } from "./use-project-view.ts";

/** Owns everything right of the sidebar. The shell remounts this when the project changes. */
export function ProjectScreen({ projectId }: { projectId: string }) {
  const app = useApp();
  const { view, error, reload } = useProjectView(projectId);
  const transcript = useTranscript(view);
  const project = app.projects.find(project => project.id === projectId) ?? view?.project;
  const state = view?.state ?? app.runStates[projectId] ?? "idle";
  const openKey = `moco:project:${projectId}:files-open`, sizeKey = `moco:project:${projectId}:files-size`;
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1100 && readSetting(openKey) !== "false");
  const savedSize = useRef(Number(readSetting(sizeKey)) || 360);
  const [spaceForPanel, setSpaceForPanel] = useState(true);
  const body = useRef<HTMLDivElement>(null);
  const togglePanel = useCallback(() => setPanelOpen(open => {
    writeSetting(openKey, String(!open)); return !open;
  }), [openKey]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === "." && !event.defaultPrevented) { event.preventDefault(); togglePanel(); }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [togglePanel]);
  useEffect(() => {
    if (!body.current) return;
    const observer = new ResizeObserver(([entry]) => setSpaceForPanel((entry?.contentRect.width ?? 0) >= 701));
    observer.observe(body.current);
    return () => observer.disconnect();
  }, []);
  const visible = panelOpen && spaceForPanel;
  return <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <TopBar><ProjectHeader project={project} state={state} panelOpen={panelOpen} togglePanel={togglePanel} /></TopBar>
    <div ref={body} className="min-h-0 min-w-0 flex-1 overflow-hidden">
      {error ? <div className="flex h-full min-h-0 items-center justify-center p-6"><div role="alert" className="w-full max-w-md space-y-3 rounded-xl border border-destructive/30 bg-card p-6">
        <CircleAlert className="size-5 text-destructive" aria-hidden="true" /><h2 className="text-base font-semibold">Could not load this conversation</h2><p className="text-[13px] text-muted-foreground [overflow-wrap:anywhere] select-text">{error}</p><Button variant="outline" onClick={() => void reload()}>Try again</Button>
      </div></div> : !view ? <ProjectSkeleton /> : <WorkspaceProvider projectId={projectId}>
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 min-w-0" onLayoutChanged={() => {
          if (visible) writeSetting(sizeKey, String(Math.round(savedSize.current)));
        }}>
          <ResizablePanel id="conversation" minSize={420} className="h-full min-h-0 min-w-0" style={{ overflow: "hidden" }}>
            <Conversation view={view} model={transcript} state={state} />
          </ResizablePanel>
          {visible && <>
            <ResizableHandle aria-label="Resize files panel" />
            <ResizablePanel id="files" defaultSize={Math.max(280, Math.min(1000, savedSize.current))} minSize={280} maxSize="50%" groupResizeBehavior="preserve-pixel-size" className="h-full min-h-0 min-w-0 bg-sidebar" style={{ overflow: "hidden" }} onResize={size => {
              if (size.inPixels >= 280) savedSize.current = size.inPixels;
            }}>
              <WorkspacePanel delivered={transcript.delivered} tasks={transcript.tasks} state={state} />
            </ResizablePanel>
          </>}
        </ResizablePanelGroup>
        <Sheet open={panelOpen && !spaceForPanel} onOpenChange={open => {
          setPanelOpen(open); writeSetting(openKey, String(open));
        }}>
          <SheetContent className="top-12 h-[calc(100%-3rem)] w-[min(400px,calc(100vw-2rem))] gap-0 bg-sidebar p-0 sm:max-w-none">
            <SheetHeader className="shrink-0 border-b pr-12">
              <SheetTitle>Project files</SheetTitle>
              <SheetDescription className="sr-only">Outputs, all project files and task progress.</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-hidden"><WorkspacePanel delivered={transcript.delivered} tasks={transcript.tasks} state={state} /></div>
          </SheetContent>
        </Sheet>
      </WorkspaceProvider>}
    </div>
  </div>;
}

function ProjectHeader({ project, state, panelOpen, togglePanel }: { project?: Project; state: RunState; panelOpen: boolean; togglePanel: () => void }) {
  const { requestRename, requestDelete, refresh } = useApp();
  const [narrationOpen, setNarrationOpen] = useState(false);
  const [narrationEngine, setNarrationEngine] = useState<NarrationEngine | null>(null);
  const [savingNarration, setSavingNarration] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const narrationLocked = state === "running" || state === "waiting" || savingNarration;
  async function saveNarration() {
    if (!project || narrationLocked) return;
    setSavingNarration(true);
    await run(async () => {
      await api.setNarrationEngine(project.id, narrationEngine);
      setNarrationOpen(false);
      await refresh();
    });
    setSavingNarration(false);
  }
  return <div data-testid="project-header" className="flex min-w-0 flex-1 items-center gap-3">
    <div className="min-w-0 flex-1">
      {project ? <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <h1 className="max-w-full truncate text-sm font-semibold" title={project.name}>{project.name}</h1>
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={`${project.skill.name} · ${providerLabels[project.provider]}`}>{project.skill.name} · {providerLabels[project.provider]}</span>
        {project.narrationEngine && <span className="text-xs text-muted-foreground">{narrationLabels[project.narrationEngine]}</span>}
      </div> : <Skeleton className="h-4 w-40" />}
    </div>
    {state !== "idle" && <RunStateBadge state={state} />}
    <div className="flex shrink-0 items-center gap-1">
      <Button variant="ghost" size="sm" disabled={!project} onClick={() => project && void run(() => api.openWorkspace(project.id))}><FolderOpen className="size-4" />Open folder</Button>
      <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Toggle files panel" aria-pressed={panelOpen} onClick={togglePanel}><PanelRight className="size-4" /></Button></TooltipTrigger><TooltipContent>{panelOpen ? "Hide files panel" : "Show files panel"} · Ctrl/Cmd+.</TooltipContent></Tooltip>
      <DropdownMenu><Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild><Button ref={menuTrigger} variant="ghost" size="icon-sm" aria-label="Project options" disabled={!project}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger></TooltipTrigger><TooltipContent>Project options</TooltipContent></Tooltip>
        <DropdownMenuContent align="end" className="rounded-xl" onCloseAutoFocus={event => { if (narrationOpen) event.preventDefault(); }}>
          {project?.skill.name === "ink-history" && <DropdownMenuItem disabled={narrationLocked} onSelect={() => { setNarrationEngine(project.narrationEngine ?? null); setNarrationOpen(true); }}><Speech className="size-4" />Narration voice...</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => project && requestRename(project)}><Pencil className="size-4" />Rename</DropdownMenuItem><DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => project && requestDelete(project)}><Trash2 className="size-4" />Delete…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={narrationOpen} onOpenChange={open => { if (!savingNarration) setNarrationOpen(open); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-lg" onCloseAutoFocus={event => { event.preventDefault(); menuTrigger.current?.focus(); }}>
          <DialogHeader><DialogTitle>Narration voice</DialogTitle><DialogDescription>Choose the voice for this project. Your choice takes effect on your next message.</DialogDescription></DialogHeader>
          <NarrationOptions value={narrationEngine} onChange={setNarrationEngine} disabled={narrationLocked} idPrefix="project-narration" />
          <DialogFooter><Button variant="outline" disabled={savingNarration} onClick={() => setNarrationOpen(false)}>Cancel</Button><Button disabled={narrationLocked} onClick={() => void saveNarration()}>{savingNarration && <Spinner />}Save voice</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </div>;
}

function ProjectSkeleton() {
  return <section aria-label="Conversation" aria-busy="true" className="flex h-full min-h-0 min-w-0 flex-col">
    <div className="min-h-0 flex-1 overflow-hidden"><div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-8">
      <Skeleton className="ml-auto h-16 w-3/5 rounded-2xl" /><div className="space-y-3"><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div><Skeleton className="h-8 w-48" /><div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></div>
    </div></div>
    <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-4"><Skeleton className="h-28 w-full rounded-2xl" /></div>
  </section>;
}
