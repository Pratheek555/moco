import { createContext, useContext } from "react";
import type { WorkspaceFile } from "../../../../shared/api.ts";

export interface WorkspaceContextValue {
  projectId: string;
  /** Every visible workspace file, newest first. Refreshed every few seconds. */
  files: WorkspaceFile[];
  /** False until the first listing arrives. */
  loaded: boolean;
  refresh(): Promise<void>;
  /** Opens the viewer (lightbox) on a workspace-relative path. */
  view(path: string): void;
}

/** Files-panel internals that are not part of the public seam. */
export interface WorkspaceInternals {
  /** The latest listing failure. Existing files stay visible while polling retries. */
  listingError: string | null;
  refreshing: boolean;
  /** Opens the viewer on a path, stepping through `list` (the list it was opened from). */
  viewFrom(path: string, list: readonly string[]): void;
  /** True when this version of the file has not been opened in the viewer on this machine. */
  isUnseen(file: WorkspaceFile): boolean;
  markSeen(file: WorkspaceFile): void;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export const WorkspaceInternalsContext = createContext<WorkspaceInternals | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  return value;
}

export function useWorkspaceInternals(): WorkspaceInternals {
  const value = useContext(WorkspaceInternalsContext);
  if (!value) throw new Error("useWorkspaceInternals must be used inside WorkspaceProvider.");
  return value;
}
