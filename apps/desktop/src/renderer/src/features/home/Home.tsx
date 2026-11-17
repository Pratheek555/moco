import { useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, Plus } from "lucide-react";
import type { Project, WorkspaceFile } from "../../../../shared/api.ts";
import { mediaUrl, providerLabels } from "../../../../shared/api.ts";
import { api } from "../../lib/api.ts";
import { relativeTime } from "../../lib/format.ts";
import { useApp } from "../../state/app-context.ts";
import { providers } from "../../state/use-app-state.ts";
import { LogoMark } from "../../components/app/logo.tsx";
import { RunStateBadge } from "../../components/app/run-state.tsx";
import { TopBar } from "../../components/app/top-bar.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "../../components/ui/empty.tsx";
import { Skeleton } from "../../components/ui/skeleton.tsx";
import { ProjectContextMenu } from "../shell/ProjectMenus.tsx";
import { GetSetUp } from "./GetSetUp.tsx";

const covers = new Map<string, { revision: string; promise: Promise<WorkspaceFile | null> }>();

function projectCover(project: Project): Promise<WorkspaceFile | null> {
  const cached = covers.get(project.id);
  if (cached?.revision === project.updatedAt) return cached.promise;
  const promise = api.files(project.id).then(files => [...files]
    .filter(file => (file.kind === "image" || file.kind === "video") && !/^uploads\//i.test(file.path.replaceAll("\\", "/")))
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))[0] ?? null);
  const entry = { revision: project.updatedAt, promise };
  covers.set(project.id, entry);
  // Cache data, never media blobs, and bound it across long-lived app sessions.
  if (covers.size > 48) covers.delete(covers.keys().next().value!);
  void promise.catch(() => { if (covers.get(project.id) === entry) covers.delete(project.id); });
  return promise;
}

function ProjectCover({ project }: { project: Project }) {
  const container = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<WorkspaceFile | null>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let closed = false;
    setFile(undefined); setFailed(false);
    const load = () => {
      void projectCover(project).then(result => { if (!closed) setFile(result); }, () => { if (!closed) { setFile(null); setFailed(true); } });
    };
    if (!container.current || typeof IntersectionObserver === "undefined") { load(); return () => { closed = true; }; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); }
    });
    observer.observe(container.current);
    return () => { closed = true; observer.disconnect(); };
  }, [project.id, project.updatedAt]);
  return <div ref={container} className="relative flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden bg-stage">
    {file === undefined ? <Skeleton className="absolute inset-0 rounded-none bg-stage-foreground/10" /> : file && !failed ? file.kind === "image"
      ? <img src={mediaUrl(project.id, file.path, file.modifiedAt)} alt={file.name} loading="lazy" className="absolute inset-0 size-full object-cover" onError={() => setFailed(true)} />
      : <video src={mediaUrl(project.id, file.path, file.modifiedAt)} aria-label={file.name} muted preload="metadata" playsInline className="absolute inset-0 size-full object-cover" onError={() => setFailed(true)} />
      : <LogoMark className="size-12 text-stage-foreground/20" />}
    {failed && <span className="absolute bottom-3 text-xs font-normal text-stage-foreground/70">Preview unavailable</span>}
  </div>;
}

function RecentProjectCard({ project }: { project: Project }) {
  const { navigate, runStates } = useApp();
  const state = runStates[project.id] ?? "idle";
  return <ProjectContextMenu project={project}>
    <Button variant="ghost" onClick={() => navigate({ name: "project", id: project.id })} aria-label={`Open ${project.name}`} className="flex h-auto min-w-0 flex-col items-stretch gap-0 overflow-hidden rounded-xl border bg-card p-0 text-left whitespace-normal transition-colors duration-150 hover:border-primary/40 hover:bg-card focus-visible:ring-2">
      <ProjectCover project={project} />
      <span className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <span className="truncate font-medium">{project.name}</span>
        <span className="truncate text-[13px] font-normal text-muted-foreground">{project.skill.name} · {providerLabels[project.provider]}</span>
        <span className="mt-1 flex min-w-0 flex-wrap items-center justify-between gap-2"><span className="text-xs font-normal text-muted-foreground">{relativeTime(project.updatedAt)}</span>{state !== "idle" && <RunStateBadge state={state} />}</span>
      </span>
    </Button>
  </ProjectContextMenu>;
}

export function Home() {
  const { loaded, projects, skills, statuses, runStates, openNewProject, openSettings } = useApp();
  const setupIncomplete = !providers.some(provider => statuses[provider]?.ok) || skills.length === 0;
  const firstRun = !projects.length && setupIncomplete;
  const recent = useMemo(() => [...projects].sort((a, b) => {
    const waiting = Number(runStates[b.id] === "waiting") - Number(runStates[a.id] === "waiting");
    return waiting || b.updatedAt.localeCompare(a.updatedAt);
  }).slice(0, 12), [projects, runStates]);
  const disconnected = providers.filter(provider => statuses[provider] && !statuses[provider]?.ok && projects.some(project => project.provider === provider));
  return <>
    <TopBar><span className="text-sm font-medium">Home</span></TopBar>
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-8 py-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex min-w-0 flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">What will you create?</h1>
          {loaded && !firstRun && <Button onClick={openNewProject}><Plus className="size-4" />New project</Button>}
        </header>
        {!loaded ? <div aria-label="Loading projects" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-4">
          {Array.from({ length: 6 }, (_, index) => <div key={index} className="overflow-hidden rounded-xl border"><Skeleton className="aspect-video rounded-none" /><div className="space-y-3 p-4"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-16" /></div></div>)}
        </div> : firstRun ? <GetSetUp /> : <>
          {disconnected.length > 0 && <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3">
            <CircleAlert className="size-4 shrink-0 text-warning" />
            <p className="min-w-0 flex-1 text-[13px]">{disconnected.map(provider => providerLabels[provider]).join(" and ")} {disconnected.length > 1 ? "are" : "is"} not connected.</p>
            <Button variant="outline" size="sm" onClick={() => openSettings("providers")}>Set up</Button>
          </div>}
          <section aria-labelledby="recent-projects-title" className="space-y-4">
            <h2 id="recent-projects-title" className="text-base font-semibold">Recent projects</h2>
            {recent.length ? <div className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-4">{recent.map(project => <RecentProjectCard key={project.id} project={project} />)}</div> : <Empty className="rounded-xl border"><EmptyHeader><EmptyMedia><LogoMark className="size-10" /></EmptyMedia><EmptyDescription>Your projects will appear here.</EmptyDescription></EmptyHeader><Button onClick={openNewProject}><Plus className="size-4" />New project</Button></Empty>}
          </section>
        </>}
      </div>
    </div>
  </>;
}
