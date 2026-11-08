import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Popover, DropdownMenu } from "radix-ui";
import {
  ArrowLeftIcon, ArrowUpIcon, CheckIcon, ChevronDownIcon, ClapperboardIcon,
  FileTextIcon, FolderOpenIcon, MoreHorizontalIcon, PlusIcon,
  SparklesIcon, SquareIcon, XIcon,
} from "lucide-react";
import type { SeriesPlan } from "@moco/spec";
import { api, type SeriesStatus } from "@/lib/api";
import { languageName, MOD_KEY } from "@/lib/format";
import { report, stageLabel, useApp } from "@/lib/store";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import "../studio-conversation.css";

const phases = ["Plan", "World", "Script", "Visuals", "Preview", "Deliver"];
export function phaseFor(key: string) {
  if (key === "series_plan") return 0;
  if (key === "bible") return 1;
  const step = key.split("/")[1];
  return step === "script" ? 2
    : ["voiceover", "shot_list", "sample", "scenes"].includes(step ?? "") ? 3
    : step === "preview" ? 4 : 5;
}

export function StudioProgress({ status }: { status: SeriesStatus }) {
  const active = status.stages.find(s => s.status === "running")
    ?? status.stages.find(s => s.status === "awaiting_approval");
  const key = active?.key ?? ("key" in status.next ? status.next.key : "series_plan");
  const delivered = !status.activeJob && status.next.kind === "run" && status.next.key.endsWith("/script") && status.stages.some(s => s.key.endsWith("/final") && s.status === "done");
  const finished = status.next.kind === "finished" || delivered;
  const current = finished ? 6 : phaseFor(key);
  return <Popover.Root>
    <Popover.Trigger className="generation-progress-trigger" aria-label="Production progress">
      <span className="generation-status-dot" data-running={Boolean(status.activeJob)} />
      {delivered ? "Ready to publish" : finished ? "Complete" : active?.status === "awaiting_approval" ? "Your review" : phases[current]}
      <span>{finished ? "6 / 6" : `${current + 1} / 6`}</span><ChevronDownIcon />
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="generation-progress-panel dark" align="end" sideOffset={12}>
        <p>From a little idea to the final frame</p>
        <nav aria-label="Production stages"><ol>{phases.map((label, i) => <li key={label}
          data-state={i < current ? "done" : i === current ? "current" : "pending"}
          aria-current={i === current ? "step" : undefined}>
          <span>{i < current ? <CheckIcon /> : String(i + 1).padStart(2, "0")}</span>
          <div>{label}<small>{i < current ? "Complete" : i === current ? stageLabel(key) : "Up next"}</small></div>
        </li>)}</ol></nav>
        <span>Each creative milestone comes back to you.</span>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}

export function GenerationHeader({ status, plan }: { status: SeriesStatus; plan?: SeriesPlan }) {
  const [briefOpen, setBriefOpen] = useState(false);
  const projectFiles = () => void api.app.openPath(`${useApp.getState().settings!.projectsDir}/${status.series.id}`).catch(report);
  return <header className="generation-header">
    <button className="generation-back" aria-label="All series" title="All series" onClick={() => useApp.getState().go({ name: "library" })}><ArrowLeftIcon /></button>
    <div className="generation-project-name"><span>{plan?.title ?? "A new story"}</span></div>
    <div className="generation-header-actions">
      <StudioProgress status={status} />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="generation-icon-button" aria-label="Project options"><MoreHorizontalIcon /></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="generation-options dark" align="end" sideOffset={8}>
          <DropdownMenu.Item onSelect={() => setBriefOpen(true)}><FileTextIcon /> View story brief</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={projectFiles}><FolderOpenIcon /> Open project files</DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => useApp.getState().go({ name: "library" })}><ArrowLeftIcon /> All series</DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
    <BriefDialog status={status} open={briefOpen} onOpenChange={setBriefOpen} />
  </header>;
}

function BriefDialog({ status, open, onOpenChange }: { status: SeriesStatus; open: boolean; onOpenChange(open: boolean): void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="generation-brief-dialog dark">
    <DialogHeader><DialogTitle>The story so far</DialogTitle><DialogDescription>Your original brief. Every draft starts here.</DialogDescription></DialogHeader>
    <p>{status.series.idea}</p><span>{status.series.episodes} {status.series.episodes === 1 ? "episode" : "episodes"} · {languageName(status.series.language)}</span>
  </DialogContent></Dialog>;
}

export function GenerationBrief({ status }: { status: SeriesStatus }) {
  const [expanded, setExpanded] = useState(false);
  const briefId = useId();
  const long = status.series.idea.length > 600 || status.series.idea.split("\n").length > 5;
  return <article className="development-idea generation-brief">
    <div className="generation-user-message"><p id={briefId} className={long && !expanded ? "generation-brief-collapsed" : undefined}>{status.series.idea}</p></div>
    {long && <button className="generation-brief-toggle" aria-expanded={expanded} aria-controls={briefId} onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "Read full brief"}<ChevronDownIcon /></button>}
  </article>;
}

/** A review stays beside the conversation, with its own scrolling content and action footer. */
export function GenerationSidebar({ label, onClose, children }: { label: string; onClose(): void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
  return <aside ref={panel} className="generation-sidebar" tabIndex={-1} aria-label={label} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
  }}>
    <div className="generation-sidebar-toolbar"><span>{label}</span><button className="generation-icon-button" onClick={onClose} aria-label="Close sidebar"><XIcon /></button></div>
    {children}
  </aside>;
}

export function GenerationIdentity({ label, running }: { label: string; running: boolean }) {
  return <div className="development-agent generation-identity"><span className="generation-agent-avatar"><SparklesIcon /></span><strong>Moco</strong><span>{label}</span>{running && <span className="generation-status-dot" data-running="true" />}</div>;
}

export type DirectionNote = { text: string; at: string };
export function useDirectionNotes(id: string) {
  const key = `moco.production-direction.${id}`;
  const [notes, setNotes] = useState<DirectionNote[]>(() => {
    try {
      const data: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(data) ? data.filter(n => typeof n?.text === "string" && typeof n?.at === "string") : [];
    } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(notes)); } catch { /* Notes remain available in memory. */ } }, [key, notes]);
  return [notes, setNotes] as const;
}

export function DirectionQueue({ notes, canApply, busy, onApply, onClear }: { notes: DirectionNote[]; canApply: boolean; busy: boolean; onApply(): void; onClear(): void }) {
  if (!notes.length) return null;
  return <div className="development-queued generation-queued"><span>{notes.length} {notes.length === 1 ? "note" : "notes"} {canApply ? "ready for the next draft" : "saved for your next review"}</span>
    <div>{canApply && <button disabled={busy} onClick={onApply}>Apply notes & revise <ArrowUpIcon /></button>}
      <button className="generation-clear-notes" aria-label="Clear queued notes" title="Clear queued notes" disabled={busy} onClick={onClear}><XIcon /></button></div>
  </div>;
}

export function GenerationComposer({ status, inputRef, value, onChange, onSubmit, label, context, placeholder, busy, disabled, onStop, sendLabel }: {
  status: SeriesStatus; inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string; onChange(value: string): void; onSubmit(event: FormEvent): void;
  label: string; context: string; placeholder: string; busy: boolean;
  disabled?: boolean; onStop(): void; sendLabel: string;
}) {
  const [briefOpen, setBriefOpen] = useState(false);
  return <>
    <form className="development-composer generation-composer" onSubmit={onSubmit}>
      <button type="button" className="generation-context-chip" onClick={() => setBriefOpen(true)}><ClapperboardIcon />{context}<ChevronDownIcon /></button>
      <Textarea ref={inputRef} aria-label={label} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled || busy} rows={2} maxLength={4000}
        onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
      <div className="generation-composer-tools">
        <div className="generation-composer-context"><button type="button" className="generation-icon-button" aria-label="Story context" title="View story brief" onClick={() => setBriefOpen(true)}><PlusIcon /></button></div>
        <div className="development-composer-buttons"><span className="generation-send-shortcut">{MOD_KEY} ↵</span>{status.activeJob && <button type="button" className="generation-stop" aria-label="Stop generation" title="Stop generation" disabled={busy} onClick={onStop}><SquareIcon /></button>}
          <button type="submit" className="generation-send" aria-label={sendLabel} title={sendLabel} disabled={!value.trim() || disabled || busy}>{busy ? <Spinner /> : <ArrowUpIcon />}</button></div>
      </div>
    </form>
    <BriefDialog status={status} open={briefOpen} onOpenChange={setBriefOpen} />
  </>;
}
