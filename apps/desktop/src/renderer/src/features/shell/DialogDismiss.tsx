import { X } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { DialogClose } from "../../components/ui/dialog.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.tsx";

export function DialogDismiss() {
  return <Tooltip><TooltipTrigger asChild><DialogClose asChild>
    <Button variant="ghost" size="icon-sm" aria-label="Close" className="absolute right-4 top-4 text-muted-foreground"><X className="size-4" /></Button>
  </DialogClose></TooltipTrigger><TooltipContent>Close</TooltipContent></Tooltip>;
}
