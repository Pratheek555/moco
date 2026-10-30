// Dust drifting across the lower frame, fading in and out. Particle paths are fixed per index, so frames are reproducible.
import type { FxDef } from "../define.ts";

const PARTICLES = Array.from({ length: 36 }, (_, i) => ({
  x: (i * 197) % 1080,
  y: 1350 + ((i * 89) % 450),
  r: 14 + ((i * 31) % 40),
  speed: 1.5 + ((i * 7) % 5) * 0.6,
}));

function Dust({ frame, durationFrames }: { frame: number; durationFrames: number }) {
  const fade = Math.min(1, frame / 15, (durationFrames - frame) / 15);
  return (
    <svg viewBox="0 0 1080 1920" width="100%" height="100%">
      {PARTICLES.map((particle, i) => (
        <circle key={i} cx={(particle.x + frame * particle.speed * 3) % 1180 - 50} cy={particle.y - frame * 0.4} r={particle.r} fill="#d7b98e" opacity={0.28 * fade} />
      ))}
    </svg>
  );
}

export const dust: FxDef = { id: "dust", maxDurationFrames: 90, Component: Dust };
