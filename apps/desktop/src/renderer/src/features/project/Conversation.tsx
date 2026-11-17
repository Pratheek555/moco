import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, CircleAlert, Upload } from "lucide-react";
import type { ProjectView, RunState } from "../../../../shared/api.ts";
import { providerLabels } from "../../../../shared/api.ts";
import { buildTranscript, elapsedTime } from "../../conversation.ts";
import type { Block, TextBlock, Transcript } from "../../conversation.ts";
import { LogoMark } from "../../components/app/logo.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../../components/ui/empty.tsx";
import { ScrollArea } from "../../components/ui/scroll-area.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.tsx";
import { clockTime, duration } from "../../lib/format.ts";
import { errorMessage } from "../../lib/api.ts";
import { useApp } from "../../state/app-context.ts";
import { DeliveredFile } from "../files/DeliveredFile.tsx";
import { AttachmentChip } from "./AttachmentChip.tsx";
import { Composer, useComposer } from "./Composer.tsx";
import { CopyButton } from "./CopyButton.tsx";
import { Markdown } from "./Markdown.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { WorkLog } from "./WorkLog.tsx";

export function useTranscript(view: ProjectView | undefined) {
  return useMemo(() => buildTranscript(view?.events ?? []), [view?.events]);
}

const Message = memo(function Message({ block }: { block: TextBlock }) {
  const user = block.role === "user";
  return <article className={`group min-w-0 ${user ? "flex flex-col items-end" : ""}`}>
    {(block.text || !user) && <div className={user ? "max-w-[85%] min-w-0 rounded-2xl bg-secondary px-4 py-2.5 text-[15px] leading-7 whitespace-pre-wrap [overflow-wrap:anywhere] select-text" : "min-w-0"}>
      {user ? block.text : <Markdown text={block.text} />}
    </div>}
    {!!block.files?.length && <div className="mt-2 flex max-w-[85%] min-w-0 flex-wrap justify-end gap-2">{block.files.map(file => <AttachmentChip key={file} path={file} />)}</div>}
    <div className="mt-1 flex h-8 items-center gap-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <time dateTime={block.at}>{clockTime(block.at)}</time>{block.text && <CopyButton text={block.text} />}
    </div>
  </article>;
}, (before, after) => before.block.id === after.block.id && before.block.text === after.block.text && before.block.at === after.block.at &&
  (before.block.files?.length ?? 0) === (after.block.files?.length ?? 0) && (before.block.files ?? []).every((file, index) => file === after.block.files?.[index]));

function dayKey(at: string): string { const date = new Date(at); return Number.isFinite(date.getTime()) ? date.toDateString() : ""; }
function dayLabel(at: string): string {
  const date = new Date(at), now = new Date(), yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(at) === now.toDateString()) return "Today";
  if (dayKey(at) === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

function StatusLine({ state, start, hasQuestion, questionVisible, goToQuestion }: { state: RunState; start?: string; hasQuestion: boolean; questionVisible: boolean; goToQuestion: () => void }) {
  const [now, setNow] = useState(Date.now);
  const fallback = useRef(Date.now());
  useEffect(() => {
    fallback.current = Date.now(); setNow(Date.now());
    if (state !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state, start]);
  if (state !== "running" && state !== "waiting" && !hasQuestion) return null;
  const waiting = state === "waiting" || hasQuestion;
  return <div className="flex min-h-9 flex-wrap items-center gap-2 py-2 text-[13px] text-muted-foreground" aria-live="polite" role="status">
    {waiting ? <><span className="size-2 shrink-0 rounded-full bg-warning" aria-hidden="true" /><span>Waiting for your answer</span>{hasQuestion && !questionVisible && <Button type="button" variant="ghost" size="sm" onClick={goToQuestion}>Go to question</Button>}</> : <>
      <span className="size-2 shrink-0 animate-pulse-soft rounded-full bg-primary" aria-hidden="true" /><span className="text-shimmer">Working…</span><span className="text-xs tabular-nums" aria-hidden="true">{duration(start ? elapsedTime(start, now) : now - fallback.current)}</span>
    </>}
  </div>;
}

export function Conversation({ view, model, state }: { view: ProjectView; model: Transcript; state: RunState }) {
  const { statuses, openSettings } = useApp();
  const ready = statuses[view.project.provider]?.ok === true;
  const root = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), question = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true), initialized = useRef(false), previousQuestion = useRef<string | undefined>(undefined);
  const [atBottom, setAtBottom] = useState(true), [newContent, setNewContent] = useState(false), [questionVisible, setQuestionVisible] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const pendingQuestion = model.blocks.findLast(block => block.type === "question" && block.answers === undefined);
  const pendingId = pendingQuestion?.id;
  const scrollToBottom = useCallback(() => {
    const node = viewport.current;
    if (!node) return;
    pinned.current = true; node.scrollTop = node.scrollHeight; setAtBottom(true); setNewContent(false);
  }, []);
  const goToQuestion = useCallback(() => {
    const node = viewport.current, card = question.current;
    if (!node || !card) return;
    node.scrollTop += card.getBoundingClientRect().top - node.getBoundingClientRect().top - 24;
    pinned.current = node.scrollHeight - node.clientHeight - node.scrollTop <= 64;
    setAtBottom(pinned.current);
  }, []);
  const composer = useComposer(view.project.id, ready, scrollToBottom);
  const activeTurn = model.turns.findLast(turn => !turn.endAt);

  useLayoutEffect(() => {
    const node = root.current?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]');
    if (!node) return;
    viewport.current = node;
    const onScroll = () => {
      pinned.current = node.scrollHeight - node.clientHeight - node.scrollTop <= 64;
      setAtBottom(pinned.current);
      if (pinned.current) setNewContent(false);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(() => { if (pinned.current) node.scrollTop = node.scrollHeight; });
    if (content.current) observer.observe(content.current);
    observer.observe(node);
    return () => { node.removeEventListener("scroll", onScroll); observer.disconnect(); viewport.current = null; };
  }, []);
  useLayoutEffect(() => {
    if (!initialized.current) {
      scrollToBottom(); initialized.current = true;
      if (pendingId) goToQuestion();
    } else if (pendingId && pendingId !== previousQuestion.current) goToQuestion();
    else if (pinned.current) scrollToBottom();
    else setNewContent(true);
    previousQuestion.current = pendingId;
  }, [view.events, pendingId, scrollToBottom, goToQuestion]);
  useEffect(() => {
    const card = question.current, node = viewport.current;
    if (!card || !node) { setQuestionVisible(false); return; }
    const observer = new IntersectionObserver(([entry]) => setQuestionVisible(entry?.isIntersecting ?? false), { root: node });
    observer.observe(card);
    return () => observer.disconnect();
  }, [pendingId]);
  useEffect(() => {
    const clear = () => { dragDepth.current = 0; setDragging(false); };
    window.addEventListener("dragend", clear); window.addEventListener("drop", clear); window.addEventListener("blur", clear);
    return () => { window.removeEventListener("dragend", clear); window.removeEventListener("drop", clear); window.removeEventListener("blur", clear); };
  }, []);

  function renderBlock(block: Block, index: number) {
    switch (block.type) {
      case "text": return <Message block={block} />;
      case "work": return <WorkLog block={block} live={state === "running" && index === model.blocks.length - 1} />;
      case "question": return <div ref={block.id === pendingId ? question : undefined}><QuestionCard projectId={view.project.id} block={block} onAnswered={composer.focus} /></div>;
      case "file": return <div className="min-w-0"><DeliveredFile path={block.path} label={block.label} /></div>;
      case "error": return <div role="alert" className="flex min-w-0 items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" /><div className="min-w-0 space-y-2">
          <p className="text-sm [overflow-wrap:anywhere] select-text">{errorMessage(block.message).split(/\n\s+at\s/)[0]}</p><p className="text-[13px] text-muted-foreground">Send a message to try again.</p>
          {!ready && <Button variant="outline" size="sm" onClick={() => openSettings("providers")}>Set up {providerLabels[view.project.provider]}</Button>}
        </div>
      </div>;
      case "stopped": return <p className="py-2 text-center text-[13px] text-muted-foreground">Stopped. Send a message to continue.</p>;
      case "turn_end": return <p className="text-xs text-muted-foreground tabular-nums">Worked for {duration(block.elapsed)}</p>;
    }
  }
  return <section aria-label="Conversation" className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background" onDragEnter={event => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault(); dragDepth.current++; setDragging(true);
  }} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }} onDragLeave={event => {
    event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false);
  }} onDrop={event => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault(); dragDepth.current = 0; setDragging(false); composer.attachFiles(Array.from(event.dataTransfer.files));
  }}>
    <div className="relative min-h-0 min-w-0 flex-1">
      <ScrollArea ref={root} className="h-full min-h-0 min-w-0 [&_[data-slot=scroll-area-viewport]>div]:!flex [&_[data-slot=scroll-area-viewport]>div]:min-h-full [&_[data-slot=scroll-area-viewport]>div]:flex-col">
        <div ref={content} className="mx-auto flex min-h-full w-full max-w-3xl flex-1 flex-col px-6 py-6 [overflow-anchor:none]">
          {!model.blocks.length && <Empty className="min-h-60 flex-1 border-0 px-0">
            <EmptyHeader><LogoMark className="mb-2 size-10 text-primary/60" /><EmptyTitle className="text-base font-semibold">Ready when you are</EmptyTitle>
              <EmptyDescription className="[overflow-wrap:anywhere]">Your AI will follow <strong className="font-medium text-foreground">{view.project.skill.name}</strong>.</EmptyDescription>
              {view.project.skill.description && <p className="max-w-sm text-[13px] leading-6 text-muted-foreground [overflow-wrap:anywhere] select-text">{view.project.skill.description}</p>}
            </EmptyHeader>
          </Empty>}
          <div className="min-w-0 space-y-6">{model.blocks.map((block, index) => {
            const day = dayKey(block.at), previousDay = dayKey(model.blocks[index - 1]?.at ?? "");
            return <div key={block.id} className="min-w-0">
              {day && day !== previousDay && <div className="mb-6 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" /><time dateTime={block.at}>{dayLabel(block.at)}</time><span className="h-px flex-1 bg-border" /></div>}
              {renderBlock(block, index)}
            </div>;
          })}</div>
          <StatusLine state={state} start={activeTurn?.at} hasQuestion={!!pendingId} questionVisible={questionVisible} goToQuestion={goToQuestion} />
        </div>
      </ScrollArea>
      {!atBottom && <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center"><Tooltip><TooltipTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label="Jump to latest" className="pointer-events-auto relative rounded-full bg-card shadow-xs" onClick={scrollToBottom}><ArrowDown className="size-4" />{newContent && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />}</Button>
      </TooltipTrigger><TooltipContent>Jump to latest{newContent ? " · New messages" : ""}</TooltipContent></Tooltip></div>}
    </div>
    <Composer project={view.project} state={state} ready={ready} empty={!model.blocks.length} model={composer} />
    {dragging && <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-background/95"><div className="flex items-center gap-3 text-sm font-medium"><Upload className="size-5 text-primary" />Drop files to attach</div></div>}
  </section>;
}
