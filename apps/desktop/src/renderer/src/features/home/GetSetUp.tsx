import { Check, Plus } from "lucide-react";
import { cn } from "cn";
import { useApp } from "../../state/app-context.ts";
import { providers } from "../../state/use-app-state.ts";
import { Button } from "../../components/ui/button.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { ProviderCard } from "../shell/ProviderSetup.tsx";
import { SkillDropOverlay, SkillImportButtons, StarterSkillCards, useSkillDrop, useSkillImport } from "./skill-import.tsx";

export function GetSetUp() {
  const { skills, starterSkills, statuses, openNewProject } = useApp();
  const actions = useSkillImport();
  const drop = useSkillDrop(actions.importDropped);
  const connected = providers.some(provider => statuses[provider]?.ok);
  const hasSkill = skills.length > 0;
  const firstUnfinished = !connected ? 0 : !hasSkill ? 1 : 2;
  const steps = ["Connect your AI", "Add a skill", "Create your first project"];
  return <section aria-labelledby="setup-heading" {...drop.handlers} className="relative min-w-0 rounded-xl border bg-card">
    <h2 id="setup-heading" className="border-b px-6 py-5 text-base font-semibold">Get set up</h2>
    {actions.busy === "drop" && <p role="status" className="flex items-center gap-2 border-b px-6 py-3 text-[13px] text-muted-foreground"><Spinner />Importing skill…</p>}
    <ol className="divide-y">
      {steps.map((title, index) => {
        const done = index === 0 ? connected : index === 1 ? hasSkill : false;
        const expanded = index === firstUnfinished;
        return <li key={title} className="min-w-0 px-6 py-5" aria-current={expanded ? "step" : undefined}>
          <div className="flex min-w-0 items-center gap-3">
            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums", done ? "border-success/20 bg-success/10 text-success" : expanded ? "border-primary/30 bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
              {done ? <Check aria-label="Complete" className="size-4" /> : index + 1}
            </span>
            <h3 className={cn("min-w-0 flex-1 font-medium", !expanded && !done && "text-muted-foreground")}>{title}</h3>
            {index === 2 && <Button disabled={!connected || !hasSkill} onClick={openNewProject}><Plus className="size-4" />New project</Button>}
          </div>
          {expanded && index !== 2 && <div className="mt-4 min-w-0 space-y-4 sm:pl-10">
            {index === 0 && <div className="space-y-3">{providers.map(provider => <ProviderCard key={provider} provider={provider} />)}</div>}
            {index === 1 && <>
              <StarterSkillCards skills={starterSkills.filter(starter => !skills.some(skill => skill.name === starter.name))} actions={actions} />
              <SkillImportButtons actions={actions} onboarding />
            </>}
          </div>}
        </li>;
      })}
    </ol>
    {drop.dragging && <SkillDropOverlay />}
  </section>;
}
