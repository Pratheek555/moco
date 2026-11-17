import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Circle, Files, Folder, FolderOpen, RefreshCw } from "lucide-react";
import { cn } from "cn";
import type { RunState, Task } from "../../../../shared/api.ts";
import { api, run } from "../../lib/api.ts";
import { fileSize } from "../../lib/format.ts";
import { Button } from "../../components/ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "../../components/ui/empty.tsx";
import { Progress } from "../../components/ui/progress.tsx";
import { ScrollArea } from "../../components/ui/scroll-area.tsx";
import { Skeleton } from "../../components/ui/skeleton.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs.tsx";
import { useWorkspace, useWorkspaceInternals } from "./context.ts";
import { FileCard } from "./FileCard.tsx";
import { FileContextMenu, FileMenu, fileIcon, IconButton, useFileActions } from "./file-actions.tsx";
import type { FileActions } from "./file-actions.tsx";
import { buildTree, folderFiles, isViewable, outputFiles, parentFolder, taskCounts, taskStatus } from "./model.ts";
import type { TreeNode } from "./model.ts";

export interface WorkspacePanelProps {
  /** Workspace-relative paths the agent explicitly handed to the user, oldest first. */
  delivered: string[];
  /** The agent's latest task list, if it has one. */
  tasks?: Task[];
  state: RunState;
}

/** The right-hand panel of a project: progress and files. Fills its container; must be inside WorkspaceProvider. */
export function WorkspacePanel({ delivered, tasks, state }: WorkspacePanelProps) {
  const { projectId, files, loaded, refresh } = useWorkspace();
  const { viewFrom, listingError, refreshing } = useWorkspaceInternals();
  const actions = useFileActions(projectId);
  const outputs = useMemo(() => outputFiles(files, delivered), [files, delivered]);
  const outputPaths = useMemo(() => outputs.map(file => file.path), [outputs]);
  const tree = useMemo(() => buildTree(files), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(`moco:files:expanded:${projectId}`) ?? "[]");
      return new Set(Array.isArray(saved) ? saved.filter((path): path is string => typeof path === "string") : []);
    } catch { return new Set(); }
  });

  useEffect(() => {
    try { localStorage.setItem(`moco:files:expanded:${projectId}`, JSON.stringify([...expanded])); } catch { /* Keep working if storage is unavailable. */ }
  }, [projectId, expanded]);
  const toggle = useCallback((path: string, open: boolean) => setExpanded(previous => {
    const next = new Set(previous);
    if (open) next.add(path); else next.delete(path);
    return next;
  }), []);
  const viewFile = useCallback((path: string) => {
    const file = files.find(file => file.path === path);
    if (!file) return;
    if (isViewable(file)) viewFrom(path, folderFiles(files, parentFolder(path)).map(file => file.path));
    else void actions.open(path);
  }, [files, actions, viewFrom]);

  return (
    <aside aria-label="Files" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
      <ScrollArea className="min-h-0 min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
        <TaskProgress tasks={tasks ?? []} state={state} />
        <section className="min-w-0 p-4">
          <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Files</h2>
            <IconButton label="Refresh files" disabled={refreshing} aria-busy={refreshing} onClick={() => void refresh()}>
              {refreshing ? <Spinner aria-hidden="true" /> : <RefreshCw />}
            </IconButton>
          </div>
          <Tabs defaultValue="outputs" className="min-w-0 gap-4">
            <TabsList aria-label="Files" className="w-full"><TabsTrigger value="outputs">Outputs</TabsTrigger><TabsTrigger value="all">All files</TabsTrigger></TabsList>
            {listingError && (
              <div role="alert" className="min-w-0 space-y-2 rounded-xl border bg-card p-3">
                <p className="text-[13px] font-medium">{loaded ? "Files couldn’t be refreshed." : "Files couldn’t be loaded."}</p>
                <p className="break-words text-[13px] text-muted-foreground select-text [overflow-wrap:anywhere]">{listingError}</p>
                <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}>Check again</Button>
              </div>
            )}
            <TabsContent value="outputs" className="min-w-0">
              {!loaded ? (!listingError && <FilesLoading />) : outputs.length ? (
                <div className="min-w-0 space-y-3">{outputs.map(file => <FileCard key={file.path} file={file} onView={() => viewFrom(file.path, outputPaths)} />)}</div>
              ) : <FilesEmpty outputs onOpenFolder={() => void run(() => api.openWorkspace(projectId))} />}
            </TabsContent>
            <TabsContent value="all" className="min-w-0">
              {!loaded ? (!listingError && <FilesLoading rows />) : tree.length ? (
                <FileTree nodes={tree} expanded={expanded} toggle={toggle} onView={viewFile} actions={actions} />
              ) : <FilesEmpty onOpenFolder={() => void run(() => api.openWorkspace(projectId))} />}
            </TabsContent>
          </Tabs>
        </section>
      </ScrollArea>
    </aside>
  );
}

function TaskProgress({ tasks, state }: { tasks: Task[]; state: RunState }) {
  const { done, total } = taskCounts(tasks);
  const complete = total > 0 && done === total;
  const [open, setOpen] = useState(!complete);
  const previouslyComplete = useRef(complete);
  useEffect(() => {
    if (previouslyComplete.current !== complete) setOpen(!complete);
    previouslyComplete.current = complete;
  }, [complete]);
  if (!total) return null;
  return (
    <section aria-label="Agent tasks" className="min-w-0 border-b p-4">
      <Collapsible open={open} onOpenChange={setOpen}>
        <h2 className="mb-3">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="h-auto w-full min-w-0 justify-start gap-2 p-0 hover:bg-transparent dark:hover:bg-transparent">
              {open ? <ChevronDown /> : <ChevronRight />}
              <span className="text-base font-semibold">Progress</span>
              <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">{done} of {total}</span>
            </Button>
          </CollapsibleTrigger>
        </h2>
        <Progress value={done / total * 100} aria-label="Task progress" aria-valuetext={`${done} of ${total}`} className="h-1" />
        <CollapsibleContent>
          <ul className="mt-4 space-y-3">
            {tasks.map(task => {
              const status = taskStatus(task);
              return <li key={task.id} className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 shrink-0">
                  {status === "completed" ? <Check aria-hidden="true" className="size-4 text-muted-foreground" /> : status === "in_progress" && state === "running" ? <Spinner aria-label="In progress" className="text-primary" /> : <Circle aria-hidden="true" className={cn("size-4", status === "in_progress" ? "text-primary" : "text-muted-foreground/50")} />}
                </span>
                <span className={cn("min-w-0 break-words text-sm leading-5 [overflow-wrap:anywhere]", status === "completed" && "text-muted-foreground")}><span className="sr-only">{status === "completed" ? "Completed: " : status === "in_progress" ? "In progress: " : "Pending: "}</span>{task.subject}</span>
              </li>;
            })}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

function FileTree({ nodes, expanded, toggle, onView, actions, depth = 0 }: {
  nodes: readonly TreeNode[];
  expanded: ReadonlySet<string>;
  toggle: (path: string, open: boolean) => void;
  onView: (path: string) => void;
  actions: FileActions;
  depth?: number;
}) {
  return (
    <ul aria-label={depth === 0 ? "Project files" : undefined} className="min-w-0 space-y-0.5">
      {nodes.map(node => {
        // Cap indentation so deeply nested paths still leave room for the name at 280px.
        const indent = { paddingInlineStart: `${Math.min(depth, 5) * 12 + 4}px` };
        if (node.type === "folder") {
          const open = expanded.has(node.path);
          return <li key={node.key} className="min-w-0">
            <Collapsible open={open} onOpenChange={open => toggle(node.path, open)}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" title={node.path} className="h-9 w-full min-w-0 justify-start gap-1.5 pr-2 font-normal" style={indent}>
                  {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
                  {open ? <FolderOpen className="size-4 text-muted-foreground" /> : <Folder className="size-4 text-muted-foreground" />}
                  <span className="truncate">{node.name}</span>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>{open && <FileTree nodes={node.children} expanded={expanded} toggle={toggle} onView={onView} actions={actions} depth={depth + 1} />}</CollapsibleContent>
            </Collapsible>
          </li>;
        }
        const Icon = fileIcon(node.file);
        return <li key={node.key} className="min-w-0">
          <FileContextMenu file={node.file} actions={actions}>
            <div draggable onDragStart={actions.dragStart(node.path)} className="group/row flex min-w-0 items-center gap-1 rounded-md hover:bg-sidebar-accent focus-within:bg-sidebar-accent" style={indent}>
              <Button variant="ghost" title={node.path} onClick={() => onView(node.path)} className="h-9 min-w-0 shrink flex-1 justify-start gap-2 px-1 font-normal">
                <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-left">{node.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{fileSize(node.file.size) || "0 B"}</span>
              </Button>
              <FileMenu file={node.file} actions={actions} />
            </div>
          </FileContextMenu>
        </li>;
      })}
    </ul>
  );
}

function FilesEmpty({ outputs = false, onOpenFolder }: { outputs?: boolean; onOpenFolder: () => void }) {
  return <Empty className="min-h-56 gap-4 p-4 md:p-4">
    <EmptyHeader>
      <EmptyMedia variant="icon"><Files aria-hidden="true" /></EmptyMedia>
      <EmptyDescription className="text-[13px]">{outputs ? "Videos, images and audio your AI makes will appear here." : "This project folder is empty."}</EmptyDescription>
    </EmptyHeader>
    <Button variant="outline" size="sm" onClick={onOpenFolder}><FolderOpen />Open folder</Button>
  </Empty>;
}

function FilesLoading({ rows = false }: { rows?: boolean }) {
  return <div role="status" aria-label="Loading files" className="min-w-0 space-y-3">
    {rows ? Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-9 w-full" />) : [0, 1].map(index => <div key={index} className="min-w-0 overflow-hidden rounded-xl border bg-card"><Skeleton className="aspect-video rounded-none" /><div className="space-y-2 p-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div></div>)}
  </div>;
}
