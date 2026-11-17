import { FileWarning } from "lucide-react";
import { fileName } from "../../lib/format.ts";
import { Skeleton } from "../../components/ui/skeleton.tsx";
import { Button } from "../../components/ui/button.tsx";
import { useWorkspace, useWorkspaceInternals } from "./context.ts";
import { FileCard } from "./FileCard.tsx";
import { normalizePath } from "./model.ts";

/** A file the agent handed over, shown inline in the conversation. Must be inside WorkspaceProvider. */
export function DeliveredFile({ path, label }: { path: string; label?: string }) {
  const { files, loaded, view, refresh } = useWorkspace();
  const { listingError, refreshing } = useWorkspaceInternals();
  const normalized = normalizePath(path);
  const file = files.find(file => file.path === normalized);
  // Reserve the matching preview height before metadata arrives. This never loads media.
  const loadingShape = /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(path) ? "h-15" : /\.(png|jpe?g|webp|gif|avif|mp4|webm|mov|m4v)$/i.test(path) ? "aspect-video" : "h-20";

  if (!loaded) return (
    <div data-path={path} className="w-full min-w-0 max-w-[480px] overflow-hidden rounded-xl border bg-card">
      {listingError ? (
        <div className="space-y-3 p-4">
          <p className="text-[13px] text-muted-foreground">This file couldn’t be loaded.</p>
          <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}>Check again</Button>
        </div>
      ) : (
        <div role="status" aria-label={`Loading ${fileName(path)}`}>
          <div className="border-b px-4 py-3"><Skeleton className="h-5 w-1/3" /></div>
          <Skeleton className={`w-full rounded-none ${loadingShape}`} />
          <div className="space-y-3 p-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /><div className="flex flex-wrap gap-2"><Skeleton className="h-8 w-32" /><Skeleton className="h-8 w-32" /></div></div>
        </div>
      )}
    </div>
  );
  if (!file) return (
    <div data-path={path} className="flex max-w-[480px] min-w-0 items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-[13px] text-muted-foreground">
      <FileWarning aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 break-words select-text [overflow-wrap:anywhere]">{fileName(path)} is no longer in the project folder.</p>
    </div>
  );
  return <div data-path={path} className="w-full min-w-0 max-w-[480px]"><FileCard file={file} deliveryLabel={label || "Shared a file"} onView={() => view(file.path)} /></div>;
}
