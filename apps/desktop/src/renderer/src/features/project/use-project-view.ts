import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectView } from "../../../../shared/api.ts";
import { api, errorMessage } from "../../lib/api.ts";
import { observeProject } from "./project-view.ts";

export function useProjectView(projectId: string) {
  const [view, setView] = useState<ProjectView>();
  const [error, setError] = useState("");
  const observer = useRef<ReturnType<typeof observeProject> | null>(null);
  useEffect(() => {
    const subscription = observeProject(api, projectId, setView, error => setError(error === undefined ? "" : errorMessage(error).split(/\n\s+at\s/)[0]!));
    observer.current = subscription;
    return () => { subscription.dispose(); observer.current = null; };
  }, [projectId]);
  const reload = useCallback(() => observer.current?.reload(), []);
  return { view, error, reload };
}
