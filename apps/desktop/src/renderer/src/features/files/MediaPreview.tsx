import { useState } from "react";
import { ImageOff, Play } from "lucide-react";
import { cn } from "cn";
import { mediaUrl } from "../../../../shared/api.ts";
import type { WorkspaceFile } from "../../../../shared/api.ts";
import { fileIcon } from "./file-actions.tsx";
import { mediaDuration } from "./model.ts";
import { Button } from "../../components/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../components/ui/tooltip.tsx";

/**
 * The preview at the top of an output card or a delivered-file card.
 * Images and videos sit in a fixed 16:9 box on the stage so lists do not jump while media loads.
 */
export function MediaPreview({ projectId, file, onView, onOpen, className }: { projectId: string; file: WorkspaceFile; onView: () => void; onOpen: () => void; className?: string }) {
  const url = mediaUrl(projectId, file.path, file.modifiedAt);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<{ url: string; seconds: number } | null>(null);
  const failed = failedUrl === url;

  if (file.kind === "audio") {
    return (
      <div className={cn("min-w-0 overflow-hidden bg-stage p-3 text-stage-foreground", className)}>
        {failed ? (
          <PreviewFallback onOpen={onOpen} compact />
        ) : (
          <audio
            key={url}
            src={url}
            controls
            preload="metadata"
            aria-label={`Play ${file.name}`}
            onError={() => setFailedUrl(url)}
            className="block h-9 w-full min-w-0 max-w-full"
          />
        )}
      </div>
    );
  }

  if (file.kind !== "image" && file.kind !== "video") {
    const Icon = fileIcon(file);
    return (
      <div className={cn("relative flex h-20 items-center justify-center bg-muted text-muted-foreground", className)}>
        <Icon aria-hidden="true" className="size-6" />
        <ViewOverlay name={file.name} onView={onView} />
      </div>
    );
  }

  const seconds = duration?.url === url ? duration.seconds : undefined;
  return (
    <div className={cn("group/preview relative aspect-video w-full overflow-hidden bg-stage text-stage-foreground", className)}>
      {failed ? (
        <PreviewFallback onOpen={onOpen} />
      ) : file.kind === "image" ? (
        <img
          key={url}
          src={url}
          alt={file.name}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedUrl(url)}
          className="absolute inset-0 size-full object-contain"
        />
      ) : (
        <>
          <video
            key={url}
            // A small offset makes Chromium paint a real frame instead of the black first frame.
            src={`${url}#t=0.1`}
            preload="metadata"
            muted
            playsInline
            tabIndex={-1}
            aria-hidden="true"
            onLoadedMetadata={event => setDuration({ url, seconds: event.currentTarget.duration })}
            onError={() => setFailedUrl(url)}
            className="absolute inset-0 size-full object-contain"
          />
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-stage/70 text-stage-foreground ring-1 ring-stage-foreground/20 transition-transform duration-150 ease-out group-hover/preview:scale-105">
              <Play className="size-5 translate-x-px fill-current" />
            </span>
          </span>
          {seconds !== undefined && mediaDuration(seconds) && (
            <span className="pointer-events-none absolute right-2 bottom-2 rounded-md bg-stage/80 px-1.5 py-0.5 text-xs font-medium text-stage-foreground tabular-nums">
              {mediaDuration(seconds)}
            </span>
          )}
        </>
      )}
      {!failed && <ViewOverlay name={file.name} onView={onView} />}
    </div>
  );
}

function PreviewFallback({ onOpen, compact = false }: { onOpen: () => void; compact?: boolean }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 text-stage-foreground/70", compact ? "min-w-0 flex-wrap" : "absolute inset-0 flex-col p-3")}>
      <ImageOff aria-hidden="true" className="size-4 shrink-0" />
      <span className="text-[13px]">Preview unavailable</span>
      <Button size="sm" variant="ghost" className="text-stage-foreground hover:bg-stage-foreground/10 hover:text-stage-foreground dark:hover:bg-stage-foreground/10" onClick={onOpen}>Open</Button>
    </div>
  );
}

/** A transparent button over the preview. It is a sibling of the media so images keep their own alt text in the accessibility tree. */
function ViewOverlay({ name, onView }: { name: string; onView: () => void }) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`View ${name}`}
            onClick={onView}
            className="absolute inset-0 cursor-zoom-in rounded-[inherit] outline-none transition-colors duration-150 ease-out hover:bg-stage-foreground/5 focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:ring-inset"
          />
        </TooltipTrigger>
        <TooltipContent>View file</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
