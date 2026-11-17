import { createContext, useContext } from "react";
import type { AppInfo, Project, ProviderId, ProviderStatus, RunState, Skill, StarterSkill, Theme } from "../../../shared/api.ts";

export type Route = { name: "home" } | { name: "skills" } | { name: "project"; id: string };
export type SettingsSection = "general" | "providers" | "narration" | "storage" | "about";

/** App-wide state. Provided once by App.tsx; read anywhere with useApp(). */
export interface AppState {
  /** Undefined until the first load finishes. */
  info: AppInfo | undefined;
  /** False until projects, skills and info have loaded once. Show skeletons, not empty states, while false. */
  loaded: boolean;
  projects: Project[];
  skills: Skill[];
  starterSkills: StarterSkill[];
  /** A provider's entry is missing while its connection is being checked. */
  statuses: Partial<Record<ProviderId, ProviderStatus>>;
  /** Live run state by project id. A missing id is idle. */
  runStates: Record<string, RunState>;
  /** Projects that changed while they were not on screen: needs an answer, finished, or failed. Cleared when opened. */
  attention: Record<string, "waiting" | "done" | "error">;
  route: Route;
  navigate(route: Route): void;
  /** Reloads projects and skills. */
  refresh(): Promise<void>;
  /** Re-checks one provider's connection and stores the result. */
  checkProvider(provider: ProviderId): Promise<ProviderStatus>;
  setTheme(theme: Theme): Promise<void>;
  setNotifications(enabled: boolean): Promise<void>;
  openSettings(section?: SettingsSection): void;
  openNewProject(): void;
  /** Open the shared rename / delete dialogs for a project. */
  requestRename(project: Project): void;
  requestDelete(project: Project): void;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const app = useContext(AppContext);
  if (!app) throw new Error("useApp must be used inside the App provider.");
  return app;
}
