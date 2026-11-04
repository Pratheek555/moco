# Switching the Codex account

In Settings > AI connection, select and save Codex, then choose **Switch account / Sign in**.
Moco signs out of the shared Codex CLI login and starts `codex login`. Complete browser sign-in with
the desired ChatGPT account. If the browser selects the wrong account automatically, sign out there
and use the desired account. **Open sign-in page** reopens the CLI-provided authorization link.

This changes the shared CLI login, including other tools using the same credentials. It does not
create a separate Moco account or save a list of accounts. The CLI reports the authentication method,
not the account email, so Moco does not claim to verify which email was chosen. Credentials remain
managed by Codex; Moco neither copies credential files nor sends tokens to its renderer.

Switching waits for generation and template learning to finish. While switching, Moco rejects new
jobs and changes to engine settings. Sign-in lasts up to five minutes, can be cancelled, and is
stopped when Moco quits. Cancelling does not restore the old account; check the connection and sign
in again if needed. The process tree is terminated on cancellation to stop the npm launcher from
leaving a native login process alive. Leaving the settings page does not cancel sign-in; reopening
it restores progress from the main process. Successful login is checked with `codex login status`.

Implementation uses the supported CLI authentication flow described in the
[official OpenAI documentation](https://learn.chatgpt.com/docs/auth?surface=cli).

Validation:

- `pnpm typecheck`
- `pnpm exec vitest run packages/ai/test/codex-account.test.ts packages/ai/test/codex-cli.test.ts --maxWorkers=2`
- `pnpm --filter @moco/desktop build`
- `pnpm --filter @moco/desktop test:account-switch`

The desktop check launches an isolated profile with a fake Codex CLI and a temporary `CODEX_HOME`.
It exercises real IPC, settings controls, browser-link presentation, duplicate exclusion, the job
guard, cancellation and retry. It never logs out of the real account or opens a real OAuth page.
Completing browser authentication with a real account remains a manual user step.
