import { toast } from "sonner";
import type { MocoAPI } from "../../../shared/api.ts";
declare global { interface Window { moco: MocoAPI } }
export const api = window.moco;

/** Electron prefixes errors that cross IPC; show people only the sentence that was written for them. */
export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']+': /, "").replace(/^(?:Error: )+/, "");
}

/** Runs async work and reports a failure as a toast. Resolves true when the work succeeded. */
export async function run(work: () => Promise<unknown>): Promise<boolean> {
  try { await work(); return true; }
  catch (error) { toast.error(errorMessage(error)); return false; }
}
