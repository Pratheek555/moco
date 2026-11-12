import type { MocoAPI } from "../../../shared/api.ts";
declare global { interface Window { moco: MocoAPI } }
export const api = window.moco;
export type Run = (work: () => Promise<unknown>) => Promise<void>;
