import { memo, useMemo, useState } from "react";
import { Activity, BookOpen, Brain, ChevronRight, CircleAlert, FilePenLine, FileText, Globe, Search, Terminal, Wrench } from "lucide-react";
import type { WorkBlock, WorkStep } from "../../conversation.ts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible.tsx";
import { Button } from "../../components/ui/button.tsx";
import { clockTime } from "../../lib/format.ts";
import { describeTool, liveStepTitle, summarizeWork } from "./describe-tool.ts";
import type { ToolIcon } from "./describe-tool.ts";
import { formatDetail } from "./details.ts";

const icons = { read: FileText, edit: FilePenLine, terminal: Terminal, search: Search, web: Globe, thinking: Brain, activity: Activity, skill: BookOpen, tool: Wrench };
function StepIcon({ icon }: { icon: ToolIcon }) { const Icon = icons[icon]; return <Icon className="size-4 shrink-0" aria-hidden="true" />; }

function DetailBox({ value, label }: { value: unknown; label: string }) {
  const detail = useMemo(() => formatDetail(value), [value]);
  return <div className="min-w-0 space-y-1.5">
    <p className="text-xs font-medium text-muted-foreground">{label}</p>
    <pre tabIndex={0} aria-label={label} className="max-h-64 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere] select-text">{detail.text || "No details."}</pre>
    {detail.shortened && <p className="text-xs text-muted-foreground">Output shortened</p>}
  </div>;
}

const Step = memo(function Step({ step }: { step: WorkStep }) {
  const [open, setOpen] = useState(false);
  const description = step.type === "tool" ? describeTool(step.name, step.input) : { icon: step.type === "thinking" ? "thinking" as const : "activity" as const, title: step.type === "thinking" ? "Thought for a moment" : step.description || "Worked on a task" };
  const failed = step.type === "tool" ? step.isError : step.type === "activity" && step.status === "failed";
  return <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
    <CollapsibleTrigger asChild><Button variant="ghost" className="h-auto min-h-9 w-full min-w-0 justify-start gap-2 px-2 py-2 text-left text-[13px] font-normal text-muted-foreground">
      <ChevronRight aria-hidden="true" className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      <StepIcon icon={description.icon} /><span className="min-w-0 flex-1 truncate">{description.title}</span>
      {failed && <CircleAlert className="size-4 shrink-0 text-destructive" aria-label="Failed" />}
      <time className="shrink-0 text-xs tabular-nums" dateTime={step.at}>{clockTime(step.at)}</time>
    </Button></CollapsibleTrigger>
    <CollapsibleContent className="min-w-0 space-y-3 px-3 pt-1 pb-3">
      <p className="text-[13px] [overflow-wrap:anywhere] select-text">{description.title}</p>
      {description.detail && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere] select-text">{description.detail}</p>}
      {step.type === "thinking" ? <DetailBox value={step.text} label="Thoughts" /> : step.type === "activity" ? <DetailBox value={{ description: step.description, status: step.status }} label="Details" /> : <>
        <DetailBox value={step.input} label="Input" />
        {step.completed && <DetailBox value={step.result} label="Output" />}
        {step.activity && <p className="text-xs text-muted-foreground [overflow-wrap:anywhere] select-text">{step.activity}</p>}
      </>}
    </CollapsibleContent>
  </Collapsible>;
}, (before, after) => {
  const a = before.step, b = after.step;
  if (a.type !== b.type || a.id !== b.id || a.at !== b.at) return false;
  if (a.type === "tool" && b.type === "tool") return a.name === b.name && a.input === b.input && a.result === b.result && a.completed === b.completed && a.isError === b.isError && a.activity === b.activity;
  if (a.type === "thinking" && b.type === "thinking") return a.text === b.text;
  return a.type === "activity" && b.type === "activity" && a.description === b.description && a.status === b.status;
});

export const WorkLog = memo(function WorkLog({ block, live }: { block: WorkBlock; live: boolean }) {
  const [open, setOpen] = useState(false);
  const summary = summarizeWork(block.steps);
  const current = block.steps.at(-1);
  const failed = block.steps.some(step => step.type === "tool" ? step.isError : step.type === "activity" && step.status === "failed");
  return <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
    <CollapsibleTrigger asChild><Button variant="ghost" className="h-auto min-h-9 max-w-full min-w-0 justify-start gap-2 px-2 py-2 text-[13px] font-normal text-muted-foreground">
      <ChevronRight aria-hidden="true" className={`size-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      <StepIcon icon={current?.type === "tool" ? describeTool(current.name, current.input).icon : current?.type === "thinking" ? "thinking" : "activity"} />
      <span className={`min-w-0 truncate ${live ? "text-shimmer" : ""}`}>{live ? liveStepTitle(current) : summary}</span>
      {failed && <CircleAlert className="size-4 shrink-0 text-destructive" aria-label="A step failed" />}
    </Button></CollapsibleTrigger>
    <CollapsibleContent className="ml-4 min-w-0 border-l pl-2">
      {open && block.steps.map(step => <Step key={step.id} step={step} />)}
    </CollapsibleContent>
  </Collapsible>;
}, (before, after) => before.live === after.live && before.block.id === after.block.id && before.block.revision === after.block.revision);
