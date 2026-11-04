import { useEffect, useMemo, useRef } from "react";
import { AbsoluteFill, cancelRender, continueRender, delayRender, useCurrentFrame, useVideoConfig } from "remotion";
import type { SceneSpec } from "@moco/spec";
import { canvasDocument } from "../canvas-document.ts";

export function AuthoredCanvas({ scene }: { scene: SceneSpec }) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const iframe = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const document = useMemo(() => canvasDocument(scene.canvas!, width, height), [scene.canvas, width, height]);
  const handle = useMemo(() => delayRender(`canvas ${scene.shotId} frame ${frame}`, { timeoutInMilliseconds: 15_000 }), [document, frame, scene.shotId]);
  useEffect(() => {
    ready.current = false;
  }, [document]);
  useEffect(() => {
    const request = `${scene.shotId}:${frame}:${handle}`;
    const send = () => iframe.current?.contentWindow?.postMessage({ kind: "moco:frame", frame, fps, request }, "*");
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow) return;
      if (event.data?.kind === "moco:ready") { ready.current = true; send(); }
      if (event.data?.kind === "moco:drawn" && event.data.request === request) continueRender(handle);
      if (event.data?.kind === "moco:error" && (!event.data.request || event.data.request === request)) {
        cancelRender(new Error(`[moco:path=canvas.source] ${String(event.data.message).slice(0, 500)}`));
      }
    };
    window.addEventListener("message", receive);
    if (ready.current) send();
    return () => { window.removeEventListener("message", receive); continueRender(handle); };
  }, [document, frame, fps, handle, scene.shotId]);
  return <AbsoluteFill><iframe ref={iframe} sandbox="allow-scripts" srcDoc={document} title={`Authored shot ${scene.shotId}`} style={{ width, height, border: 0, pointerEvents: "none" }} /></AbsoluteFill>;
}
