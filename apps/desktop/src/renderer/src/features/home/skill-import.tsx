import { useRef, useState, type DragEvent } from "react";
import { FilePlus2, FolderOpen, Plus, Upload } from "lucide-react";
import type { StarterSkill } from "../../../../shared/api.ts";
import { api, run } from "../../lib/api.ts";
import { useApp } from "../../state/app-context.ts";
import { Button } from "../../components/ui/button.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";

export function useSkillImport() {
  const { refresh } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const locked = useRef(false);
  async function perform(key: string, work: () => Promise<unknown>) {
    if (locked.current) return;
    locked.current = true; setBusy(key);
    await run(async () => { const skill = await work(); if (skill) await refresh(); });
    locked.current = false; setBusy(null);
  }
  return {
    busy,
    importSkill: (kind: "file" | "folder") => perform(kind, () => api.importSkill(kind)),
    addStarter: (name: string) => perform(`starter:${name}`, () => api.addStarterSkill(name)),
    importDropped: (file: File) => perform("drop", () => api.importSkillDropped(file)),
  };
}

export type SkillImportActions = ReturnType<typeof useSkillImport>;

export function useSkillDrop(importDropped: (file: File) => Promise<void>, enabled = true) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const isFile = (event: DragEvent) => enabled && Array.from(event.dataTransfer.types).includes("Files");
  return {
    dragging,
    handlers: {
      onDragEnter: (event: DragEvent) => {
        if (!isFile(event)) return;
        event.preventDefault(); depth.current++; setDragging(true);
      },
      onDragOver: (event: DragEvent) => {
        if (!isFile(event)) return;
        event.preventDefault(); event.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: (event: DragEvent) => {
        if (!isFile(event)) return;
        event.preventDefault(); depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      },
      onDrop: (event: DragEvent) => {
        if (!isFile(event)) return;
        event.preventDefault(); depth.current = 0; setDragging(false);
        const file = event.dataTransfer.items[0]?.getAsFile() ?? event.dataTransfer.files[0];
        if (file) void importDropped(file);
      },
      onDragEnd: () => { depth.current = 0; setDragging(false); },
    },
  };
}

export function SkillDropOverlay() {
  return <div role="status" className="pointer-events-none absolute inset-4 z-20 flex min-w-0 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-primary bg-background/95 p-8 text-center animate-in fade-in duration-150">
    <Upload className="size-8 text-primary" />
    <p className="font-medium">Drop a skill folder or SKILL.md to import</p>
  </div>;
}

export function SkillImportButtons({ actions, onboarding = false }: { actions: SkillImportActions; onboarding?: boolean }) {
  return <div className="flex flex-wrap items-center gap-2">
    <Button variant="outline" disabled={!!actions.busy} onClick={() => void actions.importSkill("folder")}>{actions.busy === "folder" ? <Spinner /> : <FolderOpen className="size-4" />}{onboarding ? "Import a skill folder" : "Import folder"}</Button>
    <Button variant="outline" disabled={!!actions.busy} onClick={() => void actions.importSkill("file")}>{actions.busy === "file" ? <Spinner /> : <FilePlus2 className="size-4" />}Import SKILL.md</Button>
  </div>;
}

export function StarterSkillCards({ skills, actions }: { skills: StarterSkill[]; actions: SkillImportActions }) {
  return <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-4">
    {skills.map(skill => <article key={skill.name} className="flex min-w-0 flex-col items-start gap-3 rounded-xl border bg-card p-4">
      <div className="min-w-0 space-y-2"><h3 className="break-words font-medium">{skill.name}</h3><p className="line-clamp-3 break-words text-[13px] leading-6 text-muted-foreground">{skill.description}</p></div>
      <Button className="mt-auto" variant="outline" size="sm" disabled={!!actions.busy} onClick={() => void actions.addStarter(skill.name)}>{actions.busy === `starter:${skill.name}` ? <Spinner /> : <Plus className="size-4" />}Add skill</Button>
    </article>)}
  </div>;
}
