import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";
import type { CanvasScene, SceneSpec } from "@moco/spec";
import { AuthoredCanvas } from "./AuthoredCanvas.tsx";

// Fetch outside the opaque-origin iframe so its data-only CSP stays intact.
// The child registers its own frame delay before this load delay is released.
export function RemoteCanvas({ scene, url }: { scene: SceneSpec; url: string }) {
  const [handle] = useState(() => delayRender(`Loading artwork for ${scene.shotId}`));
  const [canvas, setCanvas] = useState<CanvasScene>();
  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Artwork for ${scene.shotId} could not load (${response.status})`);
        return response.json() as Promise<CanvasScene>;
      })
      .then(setCanvas)
      .catch((error: unknown) => { if (!controller.signal.aborted) cancelRender(error); });
    return () => { controller.abort(); continueRender(handle); };
  }, [url, handle, scene.shotId]);
  useEffect(() => { if (canvas) continueRender(handle); }, [canvas, handle]);
  return canvas ? <AuthoredCanvas scene={{ ...scene, canvas }} /> : null;
}
