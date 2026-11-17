import { useEffect, useState } from "react";
import { GEMINI_VOICES } from "../../../../shared/gemini.ts";
import type { GeminiVoice, KeyCheck, NarrationStatus } from "../../../../shared/gemini.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.tsx";

export function NarrationSettings() {
  const [status, setStatus] = useState<NarrationStatus>();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const [check, setCheck] = useState<KeyCheck>();
  useEffect(() => { let live = true; void api.narrationStatus().then(value => { if (live) setStatus(value); }, () => { if (live) setError("Could not load narration settings."); }); return () => { live = false; }; }, []);
  async function work(action: string, task: () => Promise<void>) {
    setBusy(action); setError("");
    try { await task(); } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(undefined); }
  }
  return <div className="space-y-5">
    <p className="text-[13px] leading-6 text-muted-foreground">Use your own Gemini key for narration; Google bills usage to you, and Moco keeps the key encrypted on this computer.</p>
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (key.trim() && status?.encryptionAvailable && !busy) void work("Saving", async () => { setStatus(await api.setGeminiKey(key)); setKey(""); setCheck(undefined); }); }}>
      <Label htmlFor="gemini-key">Gemini API key</Label>
      <Input id="gemini-key" type="password" autoComplete="off" spellCheck={false} maxLength={256} value={key} disabled={!!busy || !status?.encryptionAvailable} placeholder={status?.keySet ? "A key is saved. Paste to replace it." : "Paste your Gemini API key"} aria-describedby="gemini-key-status" onChange={event => { setKey(event.target.value); setCheck(undefined); setError(""); }} />
      <p id="gemini-key-status" role="status" className="text-xs leading-5 text-muted-foreground">{status ? status.unreadable ? "The saved key could not be read. Enter it again." : status.keySet ? "Key saved. Saved keys are never displayed." : "No key saved. Your current narration stays available." : "Loading narration settings…"}</p>
      {status?.encryptionReason && <p role="alert" className="text-[13px] leading-5 text-destructive">{status.encryptionReason}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={!!busy || (!key.trim() && !status?.keySet)} onClick={() => void work("Checking", async () => { setCheck(undefined); setCheck(await api.checkGeminiKey(key.trim() ? key : undefined)); })}>{busy === "Checking" ? "Checking…" : "Check key"}</Button>
        <Button type="submit" disabled={!!busy || !key.trim() || !status?.encryptionAvailable}>{busy === "Saving" ? "Saving…" : "Save key"}</Button>
        <Button type="button" variant="outline" disabled={!!busy || (!status?.keySet && !status?.unreadable)} onClick={() => void work("Removing", async () => { setStatus(await api.clearGeminiKey()); setKey(""); setCheck(undefined); })}>Remove</Button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">Check key lists models without generating audio. You can paste, check, then save.</p>
      {check && <p role="status" className={check.outcome === "accepted" ? "text-[13px]" : "text-[13px] text-destructive"}>{check.message}</p>}
      {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
    </form>
    <div className="space-y-3 border-t pt-5">
      <Label htmlFor="gemini-voice">Gemini voice</Label>
      <Select value={status?.voice ?? "Charon"} disabled={!status || !!busy} onValueChange={voice => void work("Saving voice", async () => { setStatus(await api.setGeminiVoice(voice as GeminiVoice)); })}>
        <SelectTrigger id="gemini-voice" className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{GEMINI_VOICES.map(voice => <SelectItem key={voice} value={voice}>{voice}</SelectItem>)}</SelectContent>
      </Select>
      <p className="text-xs leading-5 text-muted-foreground">Key and voice changes apply on the next idle run in Claude Code and Codex. Runs already in progress keep their current settings. Project voice choices and uploaded narration take precedence.</p>
    </div>
  </div>;
}
