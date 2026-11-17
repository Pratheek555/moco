import { cn } from "cn";
import type { RunState } from "../../../../shared/api.ts";

export const runStateLabels: Record<RunState, string> = {
  idle: "Ready",
  running: "Working",
  waiting: "Waiting for you",
  error: "Needs attention",
};

const dot: Record<RunState, string> = {
  idle: "bg-muted-foreground/40",
  running: "bg-primary animate-pulse-soft",
  waiting: "bg-warning",
  error: "bg-destructive",
};

/** A small coloured dot for a project's run state. Decorative: pair it with text or an aria-label. */
export function RunStateDot({ state, className }: { state: RunState; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", dot[state], className)} />;
}

/** Dot and label, for headers and cards. */
export function RunStateBadge({ state, className }: { state: RunState; className?: string }) {
  return (
    <span
      data-state={state}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground",
        state === "waiting" && "border-warning/40 bg-warning/10 text-foreground",
        state === "error" && "border-destructive/40 bg-destructive/10 text-foreground",
        className,
      )}
    >
      <RunStateDot state={state} />
      {runStateLabels[state]}
    </span>
  );
}
