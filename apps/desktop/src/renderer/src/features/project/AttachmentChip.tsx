import { useState } from "react";
import { File, X } from "lucide-react";
import { mediaUrl } from "../../../../shared/api.ts";
import { Button } from "../../components/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.tsx";
import { uploadName } from "../../lib/format.ts";
import { useWorkspace } from "../files/workspace.tsx";

export function AttachmentChip({ path, remove }: { path: string; remove?: () => void }) {
  const { projectId, view } = useWorkspace();
  const name = uploadName(path);
  const [failed, setFailed] = useState(false);
  const image = !failed && /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(path);
  return <span className="inline-flex h-10 max-w-full min-w-0 shrink-0 items-center gap-1.5 rounded-md border bg-background px-2 text-xs">
    <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" className="h-auto min-w-0 gap-2 px-0 py-0.5 text-xs font-normal" onClick={() => view(path)} aria-label={`Open ${name}`}>
      {image ? <img src={mediaUrl(projectId, path)} alt={name} onError={() => setFailed(true)} className="size-7 shrink-0 rounded object-cover" /> : <File className="size-4 text-muted-foreground" />}
      <span className="max-w-44 truncate">{name}</span>
    </Button></TooltipTrigger><TooltipContent className="max-w-80 [overflow-wrap:anywhere]">{name}</TooltipContent></Tooltip>
    {remove && <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${name}`} onClick={remove}><X className="size-3" /></Button></TooltipTrigger><TooltipContent>Remove {name}</TooltipContent></Tooltip>}
  </span>;
}
