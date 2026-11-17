import { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, CircleAlert, Copy, ExternalLink, RefreshCw } from "lucide-react";
import type { ProviderId, ProviderStatus } from "../../../../shared/api.ts";
import { providerLabels } from "../../../../shared/api.ts";
import { api, errorMessage, run } from "../../lib/api.ts";
import { useApp } from "../../state/app-context.ts";
import { Button } from "../../components/ui/button.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { Skeleton } from "../../components/ui/skeleton.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.tsx";

export function providerStatusText(status: ProviderStatus | undefined): string {
  if (!status) return "Checking connection…";
  if (status.ok) return "Connected";
  if (status.issue === "not-installed") return "Not installed";
  if (status.issue === "signed-out") return "Signed out";
  return "Can’t connect";
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <div className="mt-2 flex min-w-0 items-start gap-2 rounded-md border bg-muted px-3 py-2">
    <code className="min-w-0 flex-1 select-text break-all py-1 font-mono text-xs leading-5">{command}</code>
    <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={copied ? "Copied command" : `Copy ${command}`} onClick={() => void run(async () => {
      await api.copyText(command); setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 2_000);
    })}>{copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}</Button></TooltipTrigger><TooltipContent>{copied ? "Copied" : "Copy command"}</TooltipContent></Tooltip>
  </div>;
}

export function CheckProviderButton({ provider }: { provider: ProviderId }) {
  const { checkProvider, statuses } = useApp();
  const [checking, setChecking] = useState(false);
  return <Button size="sm" variant="outline" disabled={checking || !statuses[provider]} onClick={() => {
    setChecking(true); void checkProvider(provider).finally(() => setChecking(false));
  }}>{checking ? <Spinner /> : <RefreshCw className="size-4" />}Check again</Button>;
}

export function ProviderSetup({ provider }: { provider: ProviderId }) {
  const { info, statuses } = useApp();
  const status = statuses[provider];
  if (!status || status.ok) return null;
  const needsInstall = status.issue === "not-installed";
  const signIn = needsInstall || status.issue === "signed-out";
  if (needsInstall && provider === "claude-code" && !info) return <div aria-label="Loading setup instructions" className="space-y-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-16 w-full" /></div>;
  return <div className="min-w-0 space-y-4">
    {signIn ? <ol className="list-decimal space-y-3 pl-5 text-[13px] leading-6 marker:text-muted-foreground">
      {needsInstall && provider === "codex" && <>
        <li>Install Node.js from <Button variant="link" className="h-auto p-0 text-[13px]" onClick={() => void run(() => api.openExternal("https://nodejs.org"))}>nodejs.org<ExternalLink className="size-4" /></Button> if you do not have it.</li>
        <li>In a terminal run:<CopyCommand command="npm install -g @openai/codex" /></li>
      </>}
      {needsInstall && provider === "claude-code" && <li>In {info?.platform === "win32" ? "PowerShell" : "Terminal"} run:<CopyCommand command={info?.platform === "win32" ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash"} /></li>}
      <li>Run the command below and sign in with {provider === "codex" ? "ChatGPT" : "your Claude account"}.<CopyCommand command={provider === "codex" ? "codex login" : "claude"} /></li>
    </ol> : <p className="select-text break-words text-[13px] leading-6 text-muted-foreground">{status.reason ? errorMessage(status.reason) : `${providerLabels[provider]} can’t connect. Check your connection, then try again.`}</p>}
    <CheckProviderButton provider={provider} />
    <p className="text-xs leading-5 text-muted-foreground">Moco uses your own subscription. It never asks for an API key.</p>
  </div>;
}

export function ProviderCard({ provider }: { provider: ProviderId }) {
  const { statuses } = useApp();
  const status = statuses[provider];
  return <section aria-label={providerLabels[provider]} className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h3 className="font-medium">{providerLabels[provider]}</h3>
        <p className="text-[13px] text-muted-foreground">Uses your {provider === "codex" ? "ChatGPT" : "Claude"} subscription</p>
        <p className="flex flex-wrap items-center gap-1.5 text-xs" role="status">
          {!status ? <Spinner aria-label={`Checking ${providerLabels[provider]}`} /> : status.ok ? <CheckCircle2 className="size-4 text-success" /> : <CircleAlert className="size-4 text-warning" />}
          <span className={status?.ok ? "text-success" : "text-muted-foreground"}>{providerStatusText(status)}</span>
          {status?.version && <span className="select-text break-all text-muted-foreground">· {status.version}</span>}
        </p>
      </div>
      {status?.ok && <CheckProviderButton provider={provider} />}
    </div>
    {status && !status.ok && <ProviderSetup provider={provider} />}
  </section>;
}
