import type { ReactElement } from "react";
import { FolderOpen, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { Project } from "../../../../shared/api.ts";
import { api, run } from "../../lib/api.ts";
import { useApp } from "../../state/app-context.ts";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "../../components/ui/context-menu.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu.tsx";
import { SidebarMenuAction } from "../../components/ui/sidebar.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.tsx";

export function ProjectContextMenu({ project, children }: { project: Project; children: ReactElement }) {
  const { requestRename, requestDelete } = useApp();
  return <ContextMenu>
    <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
    <ContextMenuContent className="w-48 rounded-xl">
      <ContextMenuItem onSelect={() => requestRename(project)}><Pencil />Rename</ContextMenuItem>
      <ContextMenuItem onSelect={() => void run(() => api.openWorkspace(project.id))}><FolderOpen />Show in folder</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => requestDelete(project)}><Trash2 />Delete…</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>;
}

export function ProjectRowMenu({ project }: { project: Project }) {
  const { requestRename, requestDelete } = useApp();
  return <DropdownMenu>
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label={`More options for ${project.name}`}><MoreHorizontal /></SidebarMenuAction>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent side="right">Project options</TooltipContent>
    </Tooltip>
    <DropdownMenuContent align="start" side="right" className="w-48 rounded-xl">
      <DropdownMenuItem onSelect={() => requestRename(project)}><Pencil />Rename</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void run(() => api.openWorkspace(project.id))}><FolderOpen />Show in folder</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={() => requestDelete(project)}><Trash2 />Delete…</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
