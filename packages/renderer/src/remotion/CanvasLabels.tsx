import { useEffect, useMemo, useRef } from "react";
import { cancelRender, continueRender, delayRender, useCurrentFrame, useVideoConfig } from "remotion";
import type { SceneSpec } from "@moco/spec";

// Keep one loaded face per embedded font instead of registering another face on
// every rendered frame. A page is local to a render and dies with that render.
const loadedFonts = new Map<string, { family: string; ready: Promise<void> }>();
function loadFont(family: string, url: string) {
  const key = `${family}:${url}`;
  let loaded = loadedFonts.get(key);
  if (!loaded) {
    // Separate aliases prevent same-named fonts with different bytes in two
    // shots from changing one another during seeks or out-of-order rendering.
    const alias = `moco-label-${loadedFonts.size}`;
    loaded = { family: alias, ready: new FontFace(alias, `url(${url})`).load().then(face => { document.fonts.add(face); }) };
    loadedFonts.set(key, loaded);
  }
  return loaded;
}

// Renderer-owned transparent layer. The source iframe cannot see the label text,
// alter its layout, or change drawing state. Each label is clipped to its own box.
export function CanvasLabels({ scene }: { scene: SceneSpec }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  const labels = scene.canvas!.labels;
  const fonts = scene.canvas!.fonts;
  const handle = useMemo(() => delayRender(`Labels ${scene.shotId}:${frame}`), [scene.shotId, frame, labels, fonts]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const families = [...new Set((labels ?? []).map(label => label.fontFamily))];
      await Promise.all(families.map(async family => {
        if (family === "Arial") return;
        const url = fonts?.[family];
        if (!url) throw Error(`Label font is not embedded: ${family}`);
        await loadFont(family, url).ready;
      }));
      if (!alive) return;
      const canvas = ref.current!;
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      const ids = new Set<string>();
      for (const label of labels ?? []) {
        if (ids.has(label.id)) throw Error(`Duplicate label id: ${label.id}`);
        ids.add(label.id);
        if (label.x + label.width > width || label.y + label.height > height || label.endFrame > scene.durationFrames || label.startFrame >= label.endFrame) throw Error(`Invalid bounds or timing for label ${label.id}`);
        ctx.save();
        const family = label.fontFamily === "Arial" ? "Arial" : loadFont(label.fontFamily, fonts![label.fontFamily]!).family;
        ctx.font = `${label.fontWeight} ${label.fontSize}px "${family}"`;
        ctx.textAlign = label.align;
        ctx.textBaseline = "alphabetic";
        const metrics = ctx.measureText(label.text);
        const x = label.align === "left" ? 2 : label.align === "right" ? label.width - 2 : label.width / 2;
        const ascent = metrics.actualBoundingBoxAscent, descent = metrics.actualBoundingBoxDescent;
        const y = (label.height + ascent - descent) / 2;
        if (metrics.width > label.width - 4 || x - metrics.actualBoundingBoxLeft < 0 || x + metrics.actualBoundingBoxRight > label.width || ascent + descent > label.height - 4) throw Error(`Label ${label.id} overflows its fixed box. Shorten the text; layout is locked.`);
        if (frame >= label.startFrame && frame < label.endFrame) {
          ctx.beginPath(); ctx.rect(label.x, label.y, label.width, label.height); ctx.clip();
          ctx.fillStyle = label.color;
          ctx.fillText(label.text, label.x + x, label.y + y);
        }
        ctx.restore();
      }
      continueRender(handle);
    })().catch(error => { if (alive) cancelRender(new Error(`[moco:path=canvas.labels] ${String(error.message ?? error)}`)); });
    return () => { alive = false; continueRender(handle); };
  }, [frame, width, height, labels, fonts, scene.durationFrames, handle]);
  return <canvas ref={ref} width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />;
}
