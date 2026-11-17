import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import type { NarrationEngine, ProviderId } from "../../../../shared/api.ts";
import { providerLabels } from "../../../../shared/api.ts";
import { api, run } from "../../lib/api.ts";
import { useApp } from "../../state/app-context.ts";
import { providers } from "../../state/use-app-state.ts";
import { readPreference, savePreference } from "../../state/preferences.ts";
import { Button } from "../../components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog.tsx";
import { Empty, EmptyDescription, EmptyHeader } from "../../components/ui/empty.tsx";
import { Input } from "../../components/ui/input.tsx";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group.tsx";
import { Skeleton } from "../../components/ui/skeleton.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { providerStatusText } from "../shell/ProviderSetup.tsx";
import { useDialogFocus } from "../shell/use-dialog-focus.ts";
import { NarrationOptions } from "../project/NarrationOptions.tsx";

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { info, loaded, skills, statuses, refresh, navigate, openSettings } = useApp();
  const [name, setName] = useState("");
  const [skillId, setSkillId] = useState("");
  const [provider, setProvider] = useState<ProviderId>("codex");
  const [narrationEngine, setNarrationEngine] = useState<NarrationEngine | null>(null);
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  const created = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const focus = useDialogFocus();

  useEffect(() => {
    if (!open) { initialized.current = false; return; }
    if (initialized.current) return;
    initialized.current = true; created.current = false;
    setName("");
    const lastSkill = readPreference("last-skill");
    setSkillId(skills.find(skill => skill.id === lastSkill)?.id ?? skills[0]?.id ?? "");
    // Connection checks update status only; new projects always start with Codex.
    setProvider("codex");
    setNarrationEngine(null);
  }, [open, loaded, skills]);
  useEffect(() => {
    if (!open || !loaded) return;
    const lastSkill = readPreference("last-skill");
    setSkillId(current => skills.some(skill => skill.id === current) ? current : skills.find(skill => skill.id === lastSkill)?.id ?? skills[0]?.id ?? "");
  }, [open, loaded, skills]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim() || !skills.some(skill => skill.id === skillId)) return;
    setBusy(true);
    await run(async () => {
      const project = await api.create(name.trim(), skillId, provider, skills.find(skill => skill.id === skillId)?.name === "ink-history" ? narrationEngine ?? undefined : undefined);
      savePreference("last-skill", skillId);
      created.current = true; onOpenChange(false);
      await run(refresh);
      navigate({ name: "project", id: project.id });
    });
    setBusy(false);
  }

  return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <DialogContent showCloseButton={false} className="flex max-h-[85vh] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-xl" onOpenAutoFocus={event => { focus.captureFocus(); event.preventDefault(); input.current?.focus(); }} onCloseAutoFocus={event => { if (created.current) event.preventDefault(); else focus.restoreFocus(event); }}>
      <DialogHeader className="shrink-0 border-b px-6 py-5 text-left"><DialogTitle className="text-base">New project</DialogTitle><DialogDescription className="sr-only">Choose a name, skill and AI for your project.</DialogDescription></DialogHeader>
      <form onSubmit={event => void create(event)} className="flex min-h-0 flex-col">
        <div className="min-h-0 space-y-6 overflow-y-auto p-6">
          <div className="space-y-2"><label htmlFor="new-project-name" className="font-medium">Project name</label><Input ref={input} id="new-project-name" placeholder="Name your project" maxLength={120} required value={name} onChange={event => setName(event.target.value)} disabled={busy} /></div>
          <div className="space-y-3">
            <p className="font-medium">Skill</p>
            {!loaded ? <Skeleton className="h-24 w-full rounded-xl" /> : !skills.length ? <Empty className="gap-3 rounded-xl border p-4 md:p-4"><EmptyHeader><EmptyDescription>Add a skill to create a project.</EmptyDescription></EmptyHeader><Button type="button" variant="outline" onClick={() => { onOpenChange(false); navigate({ name: "skills" }); }}>Add a skill</Button></Empty> : <RadioGroup aria-label="Skill" value={skillId} onValueChange={setSkillId} disabled={busy} className="max-h-52 gap-2 overflow-y-auto p-1">
              {skills.map(skill => <label key={skill.id} htmlFor={`new-skill-${skill.id}`} className="flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border bg-card p-3 transition-colors duration-150 hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring">
                <RadioGroupItem id={`new-skill-${skill.id}`} aria-label={skill.name} value={skill.id} className="mt-0.5" />
                <span className="min-w-0 space-y-1"><span className="block break-words font-medium">{skill.name}</span><span className="line-clamp-2 break-words text-[13px] leading-5 text-muted-foreground">{skill.description}</span></span>
              </label>)}
            </RadioGroup>}
          </div>
          {skills.find(skill => skill.id === skillId)?.name === "ink-history" && <div className="space-y-3">
            <p className="font-medium">Narration voice</p>
            <NarrationOptions value={narrationEngine} onChange={setNarrationEngine} disabled={busy} idPrefix="new-narration" />
          </div>}
          <div className="space-y-3">
            <p className="font-medium">AI</p>
            <RadioGroup aria-label="AI provider" value={provider} disabled={busy} onValueChange={value => setProvider(value as ProviderId)} className="grid-cols-2 gap-3 p-1">
              {providers.map(id => <div key={id} className="min-w-0 rounded-xl border bg-card p-3 transition-colors duration-150 hover:bg-accent has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring">
                <label htmlFor={`new-provider-${id}`} className="flex min-w-0 cursor-pointer flex-col gap-3">
                  <span className="flex items-center gap-2"><RadioGroupItem id={`new-provider-${id}`} value={id} aria-label={providerLabels[id]} /><span className="font-medium">{providerLabels[id]}</span></span>
                  {!statuses[id] ? <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Spinner />Checking connection…</span> : statuses[id]?.ok ? <span className="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="size-4" />{providerStatusText(statuses[id])}</span> : null}
                </label>
                {statuses[id] && !statuses[id]?.ok && <div className="mt-3 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"><label htmlFor={`new-provider-${id}`} className="cursor-pointer">Not connected ·</label><Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => openSettings("providers")}>Set up</Button></div>}
              </div>)}
            </RadioGroup>
          </div>
        </div>
        <div className="shrink-0 space-y-3 border-t p-6">
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={busy || !loaded || !name.trim() || !skillId}>{busy && <Spinner />}Create project</Button></DialogFooter>
          {info ? <p className="select-text break-all text-xs leading-5 text-muted-foreground">Saved in <span className="font-mono">{info.projectsDir}</span></p> : <Skeleton className="h-4 w-2/3" />}
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
