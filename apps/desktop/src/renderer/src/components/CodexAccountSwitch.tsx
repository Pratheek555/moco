import { useEffect, useRef, useState } from "react";
import type { CodexAccountState } from "../../../shared/api.ts";
import { api } from "@/lib/api.ts";
import { useApp } from "@/lib/store.ts";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const active = (state: CodexAccountState) => state.state === "signing-out" || state.state === "signing-in";

export function CodexAccountSwitch({ disabled }: { disabled: boolean }) {
  const [account, setAccount] = useState<CodexAccountState>({ state: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const lastState = useRef(account.state);
  const busy = submitting || active(account);

  useEffect(() => {
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const next = await api.ai.accountStatus();
        if (disposed) return;
        setPollError("");
        setAccount(next);
        if (next.state !== lastState.current) {
          lastState.current = next.state;
          if (active(next)) useApp.setState({ ai: null });
          else if (next.state !== "idle") await useApp.getState().checkAi();
        }
      } catch { if (!disposed) setPollError("Could not check account sign-in. Reopen Settings to try again."); }
      finally { refreshing = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);

  const start = async () => {
    setSubmitting(true); setError("");
    try {
      setAccount(await api.ai.switchAccount());
      useApp.setState({ ai: null });
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setSubmitting(false); }
  };
  const cancel = async () => {
    setSubmitting(true);
    try {
      setAccount(await api.ai.cancelSignIn());
      await useApp.getState().checkAi();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setSubmitting(false); }
  };

  return <div className="space-y-3 rounded-lg border p-4">
    <p className="text-sm font-medium">Codex account</p>
    <p className="text-sm text-muted-foreground">
      Switch account signs out of the current Codex CLI login, then opens browser sign-in.
      This also changes the account used by other tools sharing that login. Choose your intended ChatGPT account in the browser.
    </p>
    {disabled && <p className="text-sm text-muted-foreground">Save your provider selection before switching accounts.</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={disabled || busy} onClick={() => void start()}>
        {busy && <Spinner data-icon="inline-start" aria-hidden />}
        {busy ? "Signing in…" : "Switch account / Sign in"}
      </Button>
      {active(account) && <Button variant="outline" disabled={submitting} onClick={() => void cancel()}>Cancel sign-in</Button>}
      {account.state === "signing-in" && account.loginUrl && <Button variant="link" onClick={() => void api.app.openExternal(account.loginUrl!).catch(() => setError("Could not open the browser. Check your default browser settings."))}>Open sign-in page</Button>}
    </div>
    {account.message && <p role={account.state === "error" ? "alert" : "status"} className="text-sm text-muted-foreground">{account.message}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {pollError && <p role="alert" className="text-sm text-destructive">{pollError}</p>}
    <p className="text-xs text-muted-foreground">Cancelling does not restore the previous login. Codex CLI status reports the login method, but does not report the account email.</p>
  </div>;
}
