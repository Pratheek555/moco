// Scene-wide looks: atmosphere, time-of-day tint, colour grade, vignette and grain.
// Everything here is a baked kit image (packages/kit/assets) that is only moved, scaled and faded, so there's no
// live blur, shadow or gradient per frame. Motion is a pure function of the frame and Remotion's seeded random().
import { useMemo } from "react";
import { AbsoluteFill, Img, random, staticFile } from "remotion";
import { finish, grades, timesOfDay, type AtmosphereDef } from "@moco/kit/components";
import type { SceneSpec } from "@moco/spec";

type AtmosphereEntry = SceneSpec["atmosphere"][number];

const fullFrame = { position: "absolute" as const, left: 0, top: 0, width: "100%", height: "100%" };

export function Atmosphere({ def, entry, frame }: { def: AtmosphereDef; entry: AtmosphereEntry; frame: number }) {
  const src = staticFile(def.asset);
  switch (def.kind) {
    case "particles":
      return <Particles id={def.id} src={src} intensity={entry.intensity} frame={frame} />;
    case "drift":
      return <Drift src={src} intensity={entry.intensity} frame={frame} />;
    case "rays":
      return <Rays src={src} intensity={entry.intensity} frame={frame} />;
    case "glow":
      return <Glow id={def.id} src={src} intensity={entry.intensity} frame={frame} />;
  }
}

// Soft motes drifting right and slowly up across the lower two thirds of the frame, wrapping around.
const PARTICLE_COUNT = 18;
function Particles({ id, src, intensity, frame }: { id: string; src: string; intensity: number; frame: number }) {
  // Each mote's size, speed and start point are fixed by the seed, so they're worked out once.
  const seeds = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, (_, index) => ({
        size: 40 + 90 * random(`${id}-size-${index}`),
        speed: 0.6 + 1.6 * random(`${id}-speed-${index}`),
        startX: random(`${id}-x-${index}`) * 1300,
        startY: random(`${id}-y-${index}`) * 1300,
      })),
    [id],
  );
  const motes = seeds.map((seed, index) => ({
    size: seed.size,
    x: ((seed.startX + frame * seed.speed) % 1300) - 110,
    y: 700 + (((seed.startY - frame * seed.speed * 0.25) % 1300) + 1300) % 1300,
    opacity: intensity * (0.55 + 0.45 * Math.sin(frame / 18 + index)),
  }));
  return (
    <AbsoluteFill>
      {motes.map((mote, index) => (
        <Img key={index} src={src} style={{ position: "absolute", left: mote.x, top: mote.y, width: mote.size, height: mote.size, opacity: mote.opacity }} />
      ))}
    </AbsoluteFill>
  );
}

// Two copies of a seamless mist band side by side, scrolling slowly so the seam never shows.
const MIST = { width: 1620, height: 810, top: 1000, pixelsPerFrame: 0.8 };
function Drift({ src, intensity, frame }: { src: string; intensity: number; frame: number }) {
  const offset = -((frame * MIST.pixelsPerFrame) % MIST.width);
  const style = { position: "absolute" as const, top: MIST.top, width: MIST.width, height: MIST.height, opacity: 0.9 * intensity };
  return (
    <AbsoluteFill>
      <Img src={src} style={{ ...style, left: offset }} />
      <Img src={src} style={{ ...style, left: offset + MIST.width }} />
    </AbsoluteFill>
  );
}

// Light shafts that breathe and swing very slightly around their source (top right).
function Rays({ src, intensity, frame }: { src: string; intensity: number; frame: number }) {
  const opacity = intensity * (0.8 + 0.2 * Math.sin(frame / 45));
  const swing = 1.5 * Math.sin(frame / 90);
  return <Img src={src} style={{ ...fullFrame, opacity, transform: `rotate(${swing}deg)`, transformOrigin: "900px -120px" }} />;
}

// Warm lamp glows near the bottom of the frame, each flickering on its own smooth seeded noise.
const GLOWS = [
  { x: 0.1, y: 0.93, size: 460 },
  { x: 0.9, y: 0.91, size: 420 },
  { x: 0.52, y: 1.0, size: 380 },
];
function Glow({ id, src, intensity, frame }: { id: string; src: string; intensity: number; frame: number }) {
  return (
    <AbsoluteFill>
      {GLOWS.map((glow, index) => {
        const flicker = smoothNoise(`${id}-${index}`, frame / 4);
        const size = glow.size * (1 + 0.06 * flicker);
        const style = { position: "absolute" as const, left: glow.x * 1080 - size / 2, top: glow.y * 1920 - size / 2, width: size, height: size };
        return <Img key={index} src={src} style={{ ...style, opacity: intensity * (0.7 + 0.3 * flicker) }} />;
      })}
    </AbsoluteFill>
  );
}

// Seeded random values at whole steps, eased between them: 0..1, smooth over time.
function smoothNoise(seed: string, t: number): number {
  const step = Math.floor(t);
  const blend = t - step;
  const eased = blend * blend * (3 - 2 * blend);
  return random(`${seed}-${step}`) * (1 - eased) + random(`${seed}-${step + 1}`) * eased;
}

// ---------- finish: drawn over the whole scene, under the captions ----------

export function TimeOfDayTint({ timeOfDay }: { timeOfDay: string }) {
  const tint = timesOfDay[timeOfDay]?.tint;
  if (!tint) return null;
  return <Img src={staticFile(tint)} style={fullFrame} />;
}

export function Grade({ id }: { id: string }) {
  const grade = grades.find((candidate) => candidate.id === id);
  if (!grade?.asset) return null;
  return <Img src={staticFile(grade.asset)} style={{ ...fullFrame, opacity: grade.opacity, mixBlendMode: "soft-light" }} />;
}

export function Finish({ settings, frame }: { settings: SceneSpec["finish"]; frame: number }) {
  const shown = Math.floor(frame / finish.grain.framesPerImage) % finish.grain.assets.length;
  return (
    <>
      {settings.vignette ? <Img src={staticFile(finish.vignette.asset)} style={{ ...fullFrame, opacity: finish.vignette.opacity }} /> : null}
      {/* Every grain image stays mounted and only the visible one changes: swapping one <Img>'s src made it
          load and decode again every 2 frames, which cost about a third of the whole render. */}
      {settings.grain
        ? finish.grain.assets.map((asset, index) => (
            <Img key={asset} src={staticFile(asset)} style={{ ...fullFrame, opacity: index === shown ? finish.grain.opacity : 0 }} />
          ))
        : null}
    </>
  );
}
