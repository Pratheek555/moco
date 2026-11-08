import { useEffect, useRef } from "react";
import { createAsciiScene } from "@/lib/ascii-scenes";

/** One decorative canvas attached to the current update; never mounted per history row. */
export function StudioAscii({ phase, animate }: { phase: number; animate: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(phase);
  const redraw = useRef<(() => void) | null>(null);
  phaseRef.current = phase;
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const draw = createAsciiScene(element);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, last = 0, time = 0;
    const paint = (now: number) => {
      frame = requestAnimationFrame(paint);
      if (document.hidden || now - last < 100) return;
      time += Math.min((now - (last || now)) / 1000, .15);
      last = now;
      if (!reduced.matches && animate) draw(phaseRef.current, time);
    };
    const still = () => draw(phaseRef.current, time);
    redraw.current = still;
    still();
    reduced.addEventListener("change", still);
    if (animate) frame = requestAnimationFrame(paint);
    return () => { redraw.current = null; cancelAnimationFrame(frame); reduced.removeEventListener("change", still); };
  }, [animate]);
  useEffect(() => { redraw.current?.(); }, [phase]);
  return <canvas ref={canvas} width={640} height={600} className="studio-ascii" aria-hidden="true" />;
}
