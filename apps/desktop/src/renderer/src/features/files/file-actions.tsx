import { useMemo } from "react";
import type { ComponentProps, DragEvent, ReactNode } from "react";
import { Copy, Download, Ellipsis, ExternalLink, File, FileAudio, FileImage, FileText, FileVideo, FolderOpen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import type { WorkspaceFile } from "../../../../shared/api.ts";
import { api, run } from "../../lib/api.ts";
import { Button } from "../../components/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../components/ui/tooltip.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu.tsx";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "../../components/ui/context-menu.tsx";
import { isTextLike } from "./model.ts";

export interface FileActions {
  open(path: string): Promise<boolean>;
  reveal(path: string): Promise<boolean>;
  saveCopy(path: string): Promise<boolean>;
  copyPath(path: string): Promise<boolean>;
  /** dragstart handler that hands the file to the operating system. */
  dragStart(path: string): (event: DragEvent) => void;
}

export function useFileActions(projectId: string): FileActions {
  return useMemo<FileActions>(() => ({
    open: path => run(() => api.openFile(projectId, path, false)),
    reveal: path => run(() => api.openFile(projectId, path, true)),
    saveCopy: path => run(async () => { if (await api.saveFileAs(projectId, path)) toast.success("Saved a copy"); }),
    copyPath: path => run(async () => { await api.copyText(path); toast.success("Path copied"); }),
    dragStart: path => event => {
      event.preventDefault();
      api.dragFile(projectId, path);
    },
  }), [projectId]);
}

/** An icon-only button with an accessible name and a tooltip. */
export function IconButton({ label, tooltip, children, className, ...props }: ComponentProps<typeof Button> & { label: string; tooltip?: string }) {
  return (
    // A local provider keeps tooltips working wherever the panel is mounted; nesting providers is harmless.
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={label} className={className} {...props}>{children}</Button>
        </TooltipTrigger>
        <TooltipContent>{tooltip ?? label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function fileIcon(file: Pick<WorkspaceFile, "kind" | "path">): LucideIcon {
  if (file.kind === "video") return FileVideo;
  if (file.kind === "image") return FileImage;
  if (file.kind === "audio") return FileAudio;
  return isTextLike(file.path) ? FileText : File;
}

interface MenuItemSpec { label: string; icon: LucideIcon; action: () => void; separatorBefore?: boolean }

function menuItems(path: string, actions: FileActions): MenuItemSpec[] {
  return [
    { label: "Open", icon: ExternalLink, action: () => void actions.open(path) },
    { label: "Show in folder", icon: FolderOpen, action: () => void actions.reveal(path) },
    { label: "Save a copy…", icon: Download, action: () => void actions.saveCopy(path) },
    { label: "Copy path", icon: Copy, action: () => void actions.copyPath(path), separatorBefore: true },
  ];
}

/** The "…" menu for a file. */
export function FileMenu({ file, actions, className, onOpenChange }: { file: WorkspaceFile; actions: FileActions; className?: string; onOpenChange?: (open: boolean) => void }) {
  return (
    <DropdownMenu modal={false} onOpenChange={onOpenChange}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${file.name}`} className={cn("shrink-0", className)}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>More actions</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end" className="min-w-44 rounded-xl shadow-lg">
        {menuItems(file.path, actions).map(item => [
          item.separatorBefore ? <DropdownMenuSeparator key={`${item.label}-sep`} /> : null,
          <DropdownMenuItem key={item.label} onSelect={item.action}><item.icon />{item.label}</DropdownMenuItem>,
        ])}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Right-click gives the same items as the "…" menu. `children` must be a single element that accepts a ref. */
export function FileContextMenu({ file, actions, children }: { file: WorkspaceFile; actions: FileActions; children: ReactNode }) {
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-44 rounded-xl shadow-lg">
        {menuItems(file.path, actions).map(item => [
          item.separatorBefore ? <ContextMenuSeparator key={`${item.label}-sep`} /> : null,
          <ContextMenuItem key={item.label} onSelect={item.action}><item.icon />{item.label}</ContextMenuItem>,
        ])}
      </ContextMenuContent>
    </ContextMenu>
  );
}
