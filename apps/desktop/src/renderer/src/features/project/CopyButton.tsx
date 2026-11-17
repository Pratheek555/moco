import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.tsx";
import { api, run } from "../../lib/api.ts";

export function CopyButton({ text, label = "Copy message" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <Tooltip><TooltipTrigger asChild>
    <Button type="button" variant="ghost" size="icon-sm" aria-label={copied ? "Copied" : label} className="text-muted-foreground" onClick={() => void run(async () => {
      await api.copyText(text); setCopied(true); clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    })}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}</Button>
  </TooltipTrigger><TooltipContent>{copied ? "Copied" : label}</TooltipContent></Tooltip>;
}
