export type ProviderId = 'claude-cli' | 'codex-cli' | 'anthropic' | 'openai' | 'mock';

export interface CompleteRequest {
  system: string;
  prompt: string;
  /** Streamed text as it arrives (when the backend supports it). */
  onText?: (delta: string) => void;
  /** Coarse progress notes ("thinking…", "writing…"). */
  onStatus?: (status: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CompleteResult {
  text: string;
  /** Which model answered, when known. */
  model?: string;
  durationMs: number;
}

export interface AiProvider {
  id: ProviderId;
  label: string;
  complete(req: CompleteRequest): Promise<CompleteResult>;
}

export interface ProviderSettings {
  provider: ProviderId;
  /** Model override; empty = the backend's default. */
  model?: string;
  anthropicKey?: string;
  openaiKey?: string;
  /** Reasoning effort for API providers. */
  effort?: 'low' | 'medium' | 'high';
}

export interface CliStatus {
  installed: boolean;
  path?: string;
  version?: string;
  loggedIn?: boolean;
  account?: string;
  error?: string;
}
