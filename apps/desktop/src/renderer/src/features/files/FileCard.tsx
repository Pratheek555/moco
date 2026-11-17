import { Download, FolderOpen } from "lucide-react";
import type { WorkspaceFile } from "../../../../shared/api.ts";
import { fileSize, relativeTime } from "../../lib/format.ts";
import { Button } from "../../components/ui/button.tsx";
import { FileContextMenu, FileMenu, useFileActions } from "./file-actions.tsx";
import { MediaPreview } from "./MediaPreview.tsx";
import { useWorkspace, useWorkspaceInternals } from "./context.ts";

/** Shared media treatment keeps delivered files as usable as the files panel. */
export function FileCard({ file, onView, deliveryLabel }: { file: WorkspaceFile; onView: () => void; deliveryLabel?: string }) {
  const { projectId } = useWorkspace();
  const { isUnseen } = useWorkspaceInternals();
  const actions = useFileActions(projectId);
  const unseen = isUnseen(file);
  return (
    <FileContextMenu file={file} actions={actions}>
      <article draggable onDragStart={actions.dragStart(file.path)} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        {deliveryLabel !== undefined && <p className="break-words border-b px-4 py-3 text-[13px] font-medium select-text [overflow-wrap:anywhere]">{deliveryLabel}</p>}
        <MediaPreview projectId={projectId} file={file} onView={onView} onOpen={() => void actions.open(file.path)} />
        <div className="space-y-3 p-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex min-w-0 items-center gap-2">
                {unseen && <span className="size-1.5 shrink-0 rounded-full bg-primary" role="img" aria-label="Not viewed yet" />}
                <Button variant="ghost" title={file.path} aria-label={`View ${file.name}`} onClick={onView} className="h-auto min-w-0 shrink justify-start rounded-sm p-0 text-left font-medium hover:bg-transparent hover:underline dark:hover:bg-transparent">
                  <span className="truncate">{file.name}</span>
                </Button>
              </div>
              <p className="truncate text-xs text-muted-foreground tabular-nums" title={file.modifiedAt}>{[fileSize(file.size) || "0 B", relativeTime(file.modifiedAt)].filter(Boolean).join(" · ")}</p>
            </div>
            <FileMenu file={file} actions={actions} />
          </div>
          {deliveryLabel !== undefined && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void actions.saveCopy(file.path)}><Download />Save a copy</Button>
              <Button size="sm" variant="outline" onClick={() => void actions.reveal(file.path)}><FolderOpen />Show in folder</Button>
            </div>
          )}
        </div>
      </article>
    </FileContextMenu>
  );
}
