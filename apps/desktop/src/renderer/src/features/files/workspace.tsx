import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { WorkspaceFile } from "../../../../shared/api.ts";
import { api, errorMessage, run } from "../../lib/api.ts";
import { WorkspaceContext, WorkspaceInternalsContext, useWorkspace } from "./context.ts";
import type { WorkspaceContextValue, WorkspaceInternals } from "./context.ts";
import { markSeen as withSeen, normalizePath, parseSeen, sameFiles, seenFromListing, viewerList } from "./model.ts";
import type { SeenMap } from "./model.ts";
import { createFilePoller } from "./polling.ts";
import { MediaViewer } from "./MediaViewer.tsx";
import type { ViewerTarget } from "./MediaViewer.tsx";

export type { WorkspaceContextValue };
export { useWorkspace };

const seenKey = (projectId: string) => `moco:files:seen:${projectId}`;

function readSeen(projectId: string): SeenMap | undefined {
  try { return parseSeen(localStorage.getItem(seenKey(projectId))); } catch { return undefined; }
}
function storeSeen(projectId: string, seen: SeenMap): void {
  try { localStorage.setItem(seenKey(projectId), JSON.stringify(seen)); } catch { /* Keep working in memory if storage is unavailable. */ }
}

/** A project key also isolates delayed requests and persisted state when the caller changes projects. */
export function WorkspaceProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  return <WorkspaceSession key={projectId} projectId={projectId}>{children}</WorkspaceSession>;
}

function WorkspaceSession({ projectId, children }: { projectId: string; children: ReactNode }) {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listingError, setListingError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [seen, setSeen] = useState<SeenMap | undefined>(() => readSeen(projectId));
  const [target, setTarget] = useState<ViewerTarget | null>(null);
  const filesRef = useRef(files);
  const poller = useRef<ReturnType<typeof createFilePoller<WorkspaceFile[]>> | null>(null);

  useEffect(() => {
    const current = createFilePoller({
      load: () => api.files(projectId),
      isVisible: () => !document.hidden,
      onError: error => setListingError(errorMessage(error)),
      onFiles: list => {
        if (!sameFiles(filesRef.current, list)) {
          filesRef.current = list;
          setFiles(list);
        }
        setSeen(previous => previous ?? seenFromListing(list));
        setLoaded(true);
        setListingError(null);
      },
    });
    poller.current = current;
    document.addEventListener("visibilitychange", current.visibilityChanged);
    current.start();
    return () => {
      current.stop();
      document.removeEventListener("visibilitychange", current.visibilityChanged);
      if (poller.current === current) poller.current = null;
    };
  }, [projectId]);

  useEffect(() => { if (seen) storeSeen(projectId, seen); }, [projectId, seen]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await run(() => poller.current?.refresh() ?? Promise.resolve()); }
    finally { setRefreshing(false); }
  }, []);
  const markSeen = useCallback((file: WorkspaceFile) => {
    setSeen(previous => withSeen(previous ?? seenFromListing(filesRef.current), file, filesRef.current));
  }, []);

  const viewFrom = useCallback((path: string, list: readonly string[]) => {
    setTarget({ path: normalizePath(path), list: viewerList(path, list, filesRef.current) });
  }, []);
  const view = useCallback((path: string) => viewFrom(path, []), [viewFrom]);
  const value = useMemo<WorkspaceContextValue>(
    () => ({ projectId, files, loaded, refresh, view }),
    [projectId, files, loaded, refresh, view],
  );
  const internals = useMemo<WorkspaceInternals>(
    () => ({ viewFrom, markSeen, isUnseen: file => seen ? seen[file.path] !== file.modifiedAt : false, listingError, refreshing }),
    [viewFrom, markSeen, seen, listingError, refreshing],
  );
  const close = useCallback(() => setTarget(null), []);
  const navigate = useCallback((path: string) => setTarget(current => current ? { ...current, path } : null), []);

  return (
    <WorkspaceContext.Provider value={value}>
      <WorkspaceInternalsContext.Provider value={internals}>
        {children}
        <MediaViewer target={target} onNavigate={navigate} onClose={close} />
      </WorkspaceInternalsContext.Provider>
    </WorkspaceContext.Provider>
  );
}
