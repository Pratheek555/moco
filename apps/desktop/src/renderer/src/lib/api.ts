import type { MocoApi } from "../../../shared/api.ts";

declare global {
  interface Window {
    moco: MocoApi;
  }
}

export const api: MocoApi = window.moco;
export * from "../../../shared/api.ts";
