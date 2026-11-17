import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, Download, ExternalLink, FolderOpen, ImageOff, Music, X } from "lucide-react";
import { cn } from "cn";
import { mediaUrl } from "../../../../shared/api.ts";
import type { TextPreview, WorkspaceFile } from "../../../../shared/api.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { fileName, fileSize, relativeTime } from "../../lib/format.ts";
import { Button } from "../../components/ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog.tsx";
import { Skeleton } from "../../components/ui/skeleton.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../components/ui/tooltip.tsx";
import { useWorkspace, useWorkspaceInternals } from "./context.ts";
import { fileIcon, IconButton, useFileActions } from "./file-actions.tsx";
import { isTextLike } from "./model.ts";

export interface ViewerTarget { path: string; list: readonly string[] }

const stageButton = "text-stage-foreground hover:bg-stage-foreground/10 hover:text-stage-foreground dark:hover:bg-stage-foreground/10";

/** One controlled dialog shared by delivered files, Outputs and All files. */
export function MediaViewer({ target, onNavigate, onClose }: {
  target: ViewerTarget | null;
  onNavigate: (path: string) => void;
  onClose: () => void;
}) {
  const { projectId, files, loaded } = useWorkspace();
  const { markSeen, listingError } = useWorkspaceInternals();
  const actions = useFileActions(projectId);
  const file = target ? files.find(file => file.path === target.path) : undefined;
  const name = file?.name ?? fileName(target?.path ?? "");
  const index = target?.list.indexOf(target.path) ?? -1;
  const previous = target && index > 0 ? target.list[index - 1] : undefined;
  const next = target && index >= 0 ? target.list[index + 1] : undefined;
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (file) markSeen(file); }, [file, markSeen]);

  function stepWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const element = event.target;
    if (element instanceof Element && element.closest("video, audio, pre, input, textarea, select, [contenteditable=true], [role=slider], [role=menu]")) return;
    const path = event.key === "ArrowLeft" ? previous : event.key === "ArrowRight" ? next : undefined;
    if (path) { event.preventDefault(); onNavigate(path); }
  }

  return (
    <Dialog open={target !== null} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl border-stage-foreground/20 bg-stage p-0 text-stage-foreground sm:max-w-none"
        onKeyDown={stepWithKeyboard}
        onOpenAutoFocus={event => {
          event.preventDefault();
          returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          closeButton.current?.focus();
        }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (returnFocus.current?.isConnected) returnFocus.current.focus();
        }}
      >
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-stage-foreground/15 px-4 py-3">
          <div className="min-w-0 flex-1 basis-40 space-y-1">
            <DialogTitle title={name} className="truncate select-text text-base font-semibold leading-6">{name}</DialogTitle>
            <DialogDescription className="text-xs text-stage-foreground/60 tabular-nums">
              {file ? [fileSize(file.size) || "0 B", relativeTime(file.modifiedAt)].filter(Boolean).join(" · ") : "Project file"}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <Button variant="ghost" size="sm" disabled={!file} className={stageButton} onClick={() => file && void actions.saveCopy(file.path)}><Download />Save a copy</Button>
            <Button variant="ghost" size="sm" disabled={!file} className={stageButton} onClick={() => file && void actions.reveal(file.path)}><FolderOpen />Show in folder</Button>
            <Button variant="ghost" size="sm" disabled={!file} className={stageButton} onClick={() => file && void actions.open(file.path)}><ExternalLink />Open</Button>
            <IconButton ref={closeButton} label="Close" tooltip="Close (Esc)" className={stageButton} onClick={onClose}><X /></IconButton>
          </div>
        </header>
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {target && (file ? (
            <ViewerBody key={`${projectId}/${file.path}/${file.modifiedAt}`} projectId={projectId} file={file} onOpen={() => void actions.open(file.path)} />
          ) : !loaded && !listingError ? (
            <div role="status" aria-label="Loading file" className="size-full p-6"><Skeleton className="size-full bg-stage-foreground/10" /></div>
          ) : (
            <div className="flex size-full items-center justify-center p-6 text-center text-sm text-stage-foreground/70">
              {loaded ? "This file is no longer in the project folder." : "Files couldn’t be loaded. Close the viewer and check again in Files."}
            </div>
          ))}
        </div>
        <footer className="flex shrink-0 items-center justify-center gap-4 border-t border-stage-foreground/15 px-4 py-2">
          <IconButton label="Previous file" tooltip="Previous file (←)" disabled={!previous} className={stageButton} onClick={() => previous && onNavigate(previous)}><ArrowLeft /></IconButton>
          <span aria-live="polite" aria-atomic="true" className="min-w-16 text-center text-xs text-stage-foreground/70 tabular-nums">{target ? `${index + 1} of ${target.list.length}` : ""}</span>
          <IconButton label="Next file" tooltip="Next file (→)" disabled={!next} className={stageButton} onClick={() => next && onNavigate(next)}><ArrowRight /></IconButton>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function ViewerBody({ projectId, file, onOpen }: { projectId: string; file: WorkspaceFile; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const url = mediaUrl(projectId, file.path, file.modifiedAt);
  useEffect(() => {
    const player = video.current ?? audio.current;
    return () => { player?.pause(); };
  }, []);

  if (failed) return <UnavailablePreview onOpen={onOpen} />;
  if (file.kind === "image") return <ViewerImage url={url} name={file.name} onError={() => setFailed(true)} />;
  if (file.kind === "video") return (
    <video ref={video} src={url} autoPlay controls playsInline aria-label={`Play ${file.name}`} onError={() => setFailed(true)} className="size-full object-contain" />
  );
  if (file.kind === "audio") return (
    <div className="flex size-full items-center justify-center p-6">
      <div className="flex w-full max-w-lg min-w-0 flex-col items-center gap-4">
        <Music aria-hidden="true" className="size-10 text-stage-foreground/50" />
        <p className="max-w-full truncate select-text text-sm" title={file.name}>{file.name}</p>
        <audio ref={audio} src={url} controls preload="metadata" aria-label={`Play ${file.name}`} onError={() => setFailed(true)} className="w-full min-w-0 max-w-full" />
      </div>
    </div>
  );
  if (isTextLike(file.path)) return <TextFilePreview projectId={projectId} path={file.path} onOpen={onOpen} />;
  const Icon = fileIcon(file);
  return (
    <div className="flex size-full flex-col items-center justify-center gap-4 p-6 text-center">
      <Icon aria-hidden="true" className="size-10 text-stage-foreground/50" />
      <p className="max-w-full truncate select-text text-sm" title={file.name}>{file.name}</p>
      <Button variant="ghost" className={stageButton} onClick={onOpen}><ExternalLink />Open in default app</Button>
    </div>
  );
}

function UnavailablePreview({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-stage-foreground/70">
      <ImageOff aria-hidden="true" className="size-6" />
      <p className="text-sm">Preview unavailable</p>
      <Button variant="ghost" className={stageButton} onClick={onOpen}><ExternalLink />Open in default app</Button>
    </div>
  );
}

function ViewerImage({ url, name, onError }: { url: string; name: string; onError: () => void }) {
  const [actualSize, setActualSize] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const label = actualSize ? "Fit to window" : "View at actual size";
  return (
    <div className="relative size-full overflow-auto">
      {!loaded && <Skeleton className="pointer-events-none absolute inset-4 bg-stage-foreground/10" />}
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label={`${label}: ${name}`} aria-pressed={actualSize} onClick={() => setActualSize(value => !value)} className={cn("p-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset", actualSize ? "block w-max min-h-full min-w-full cursor-zoom-out" : "block size-full cursor-zoom-in")}>
              <img src={url} alt={name} draggable={false} onLoad={() => setLoaded(true)} onError={onError} className={actualSize ? "mx-auto block max-w-none" : "size-full object-contain"} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function TextFilePreview({ projectId, path, onOpen }: { projectId: string; path: string; onOpen: () => void }) {
  const [preview, setPreview] = useState<TextPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError(null);
    void api.readTextFile(projectId, path).then(
      value => { if (!cancelled) setPreview(value); },
      error => { if (!cancelled) setError(errorMessage(error)); },
    );
    return () => { cancelled = true; };
  }, [projectId, path, attempt]);

  if (error) return (
    <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm">This file couldn’t be previewed.</p>
      <p className="max-w-lg select-text break-words text-[13px] text-stage-foreground/60">{error}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="ghost" className={stageButton} onClick={() => setAttempt(value => value + 1)}>Check again</Button>
        <Button variant="ghost" className={stageButton} onClick={onOpen}><ExternalLink />Open in default app</Button>
      </div>
    </div>
  );
  if (!preview) return <div role="status" aria-label="Loading text preview" className="size-full space-y-3 p-6">{["w-3/4", "w-full", "w-5/6", "w-2/3"].map((width, index) => <Skeleton key={index} className={cn("h-4 bg-stage-foreground/10", width)} />)}</div>;
  return (
    <div className="flex size-full min-h-0 flex-col">
      {preview.truncated && <p className="shrink-0 border-b border-stage-foreground/15 px-6 py-2 text-xs text-stage-foreground/60">Showing the first part of this file</p>}
      <pre tabIndex={0} aria-label={`Text preview of ${fileName(path)}`} className="min-h-0 min-w-0 flex-1 overflow-auto p-6 font-mono text-[13px] leading-6 select-text outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset">{preview.text || "This file is empty."}</pre>
    </div>
  );
}
