import { useEffect, useRef } from "react";
import { createAsciiOcean } from "@/lib/ascii-ocean";

/** One decorative canvas keeps thousands of shaded glyphs out of the DOM. */
export function AsciiOcean({ paused, dark }: { paused: boolean; dark: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const clock = useRef({ time: 0 });
  useEffect(() => {
    if (!canvas.current) return;
    return createAsciiOcean(canvas.current, clock.current, paused, dark);
  }, [paused, dark]);
  return <canvas ref={canvas} className="ascii-ocean" aria-hidden="true" />;
}
