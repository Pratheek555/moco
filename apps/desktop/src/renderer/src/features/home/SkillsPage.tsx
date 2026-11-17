import { useState } from "react";
import { Layers, MoreHorizontal, Trash2 } from "lucide-react";
import type { Skill } from "../../../../shared/api.ts";
import { api, run } from "../../lib/api.ts";
import { relativeTime } from "../../lib/format.ts";
import { useApp } from "../../state/app-context.ts";
import { TopBar } from "../../components/app/top-bar.tsx";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog.tsx";
import { Button } from "../../components/ui/button.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "../../components/ui/empty.tsx";
import { Skeleton } from "../../components/ui/skeleton.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.tsx";
import { SkillDropOverlay, SkillImportButtons, StarterSkillCards, useSkillDrop, useSkillImport } from "./skill-import.tsx";
import { useDialogFocus } from "../shell/use-dialog-focus.ts";

export function SkillsPage() {
  const { loaded, skills, starterSkills, projects, refresh } = useApp();
  const actions = useSkillImport();
  const drop = useSkillDrop(actions.importDropped, loaded);
  const [removing, setRemoving] = useState<Skill | null>(null);
  const [deleting, setDeleting] = useState(false);
  const focus = useDialogFocus();
  const starters = starterSkills.filter(starter => !skills.some(skill => skill.name === starter.name));
  async function remove() {
    if (!removing || deleting) return;
    setDeleting(true);
    const removed = await run(() => api.deleteSkill(removing.id));
    if (removed) { setRemoving(null); await run(refresh); }
    setDeleting(false);
  }
  return <>
    <TopBar><span className="text-sm font-medium">Skills</span></TopBar>
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" {...drop.handlers}>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-5xl space-y-8">
          <header className="space-y-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-baseline gap-3"><h1 className="text-2xl font-semibold tracking-tight">Skills</h1>{loaded ? <span className="text-xs tabular-nums text-muted-foreground">{skills.length} imported</span> : <Skeleton className="h-4 w-20" />}</div>
              {loaded && <SkillImportButtons actions={actions} />}
            </div>
            <p className="text-[13px] leading-6 text-muted-foreground">A skill tells your AI how to make your videos. Each project uses one.</p>
          </header>
          {!loaded ? <div aria-label="Loading skills" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-44 rounded-xl" />)}</div> : <>
            <section aria-labelledby="your-skills-title" className="space-y-4">
              <h2 id="your-skills-title" className="text-base font-semibold">Your skills</h2>
              {!skills.length ? <Empty className="rounded-xl border">
                <EmptyHeader><EmptyMedia variant="icon"><Layers /></EmptyMedia><EmptyDescription>No skills yet. Add a starter skill or import your own.</EmptyDescription></EmptyHeader>
                <Button variant="outline" onClick={() => void actions.importSkill("folder")} disabled={!!actions.busy}>{actions.busy === "folder" && <Spinner />}Add skill</Button>
              </Empty> : <div className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-4">
                {skills.map(skill => {
                  const count = projects.filter(project => project.skill.id === skill.id).length;
                  return <article key={skill.id} className="flex min-w-0 flex-col rounded-xl border bg-card p-4">
                    <div className="flex min-w-0 items-start justify-between gap-2"><h3 className="min-w-0 break-words pt-1 font-medium">{skill.name}</h3>
                      <DropdownMenu><Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`More options for ${skill.name}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger></TooltipTrigger><TooltipContent>Skill options</TooltipContent></Tooltip>
                        <DropdownMenuContent align="end" className="rounded-xl"><DropdownMenuItem variant="destructive" onSelect={() => setRemoving(skill)}><Trash2 />Remove from library…</DropdownMenuItem></DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <p className="mt-2 line-clamp-3 break-words text-[13px] leading-6 text-muted-foreground">{skill.description}</p>
                    <div className="mt-auto space-y-1 pt-4 text-xs text-muted-foreground"><p>Added {relativeTime(skill.importedAt)}</p>{count > 0 && <p className="tabular-nums">Used by {count} {count === 1 ? "project" : "projects"}</p>}</div>
                  </article>;
                })}
              </div>}
            </section>
            {starters.length > 0 && <section aria-labelledby="starter-skills-title" className="space-y-4"><h2 id="starter-skills-title" className="text-base font-semibold">Starter skills</h2><StarterSkillCards skills={starters} actions={actions} /></section>}
          </>}
        </div>
      </div>
      {drop.dragging && <SkillDropOverlay />}
      {actions.busy === "drop" && <div role="status" className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-xl border bg-popover px-4 py-3 shadow-lg"><Spinner />Importing skill…</div>}
    </div>
    <AlertDialog open={!!removing} onOpenChange={open => { if (!open && !deleting) setRemoving(null); }}>
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl" onOpenAutoFocus={focus.captureFocus} onCloseAutoFocus={focus.restoreFocus}><AlertDialogHeader><AlertDialogTitle className="max-w-full break-words text-base">Remove “{removing?.name}” from the library?</AlertDialogTitle><AlertDialogDescription>Projects that use it keep their own copy.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={deleting} onClick={event => { event.preventDefault(); void remove(); }}>{deleting && <Spinner />}Remove from library</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </>;
}
