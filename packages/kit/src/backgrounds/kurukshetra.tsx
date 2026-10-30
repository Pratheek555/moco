// Kurukshetra: the battlefield as four parallax layers. The sky is a baked image per time of day (src/bake);
// the rest is flat SVG drawn past the frame edges, so camera moves never show an edge.
import type { BackgroundDef } from "../define.ts";

function Hills() {
  return (
    <svg viewBox="0 0 1080 1920" width="100%" height="100%" overflow="visible">
      <path d="M-400 1080 Q100 880 380 1010 Q640 860 900 990 Q1100 900 1480 1000 L1480 2300 L-400 2300 Z" fill="#7d5a50" opacity={0.75} />
    </svg>
  );
}

// Rows of distant soldiers and banners; banners wave with the frame.
function Armies({ frame }: { frame: number; timeOfDay: string }) {
  const banners = Array.from({ length: 13 }, (_, i) => i);
  return (
    <svg viewBox="0 0 1080 1920" width="100%" height="100%" overflow="visible">
      <path d="M-400 1130 Q540 1080 1480 1130 L1480 2300 L-400 2300 Z" fill="#5d4037" />
      <path d="M-400 1135 L1480 1135" stroke="#3e2723" strokeWidth={28} strokeDasharray="10 8" />
      {banners.map((i) => {
        const x = -360 + i * 150;
        const wave = Math.sin(frame / 7 + i) * 8;
        return (
          <g key={i}>
            <rect x={x} y={960} width={6} height={170} fill="#3e2723" />
            <path d={`M${x + 6} 965 Q${x + 40} ${975 + wave} ${x + 76} 968 L${x + 72} 1010 Q${x + 40} ${1018 + wave} ${x + 6} 1008 Z`} fill={i % 2 ? "#c0392b" : "#e67e22"} />
          </g>
        );
      })}
    </svg>
  );
}

function Ground() {
  return (
    <svg viewBox="0 0 1080 1920" width="100%" height="100%" overflow="visible">
      <path d="M-400 1480 Q540 1420 1480 1480 L1480 2300 L-400 2300 Z" fill="#a0785a" />
      <path d="M-400 1560 Q540 1520 1480 1580" stroke="#8d6e63" strokeWidth={6} fill="none" opacity={0.6} />
      <path d="M-400 1700 Q540 1650 1480 1720" stroke="#8d6e63" strokeWidth={6} fill="none" opacity={0.6} />
    </svg>
  );
}

const skies = ["dawn", "noon", "dusk", "night"];

export const kurukshetra: BackgroundDef = {
  id: "kurukshetra",
  timeOfDay: skies,
  layers: [
    { id: "sky", depth: 0, image: Object.fromEntries(skies.map((time) => [time, `kurukshetra/sky-${time}.png`])) },
    { id: "hills", depth: 0.25, Component: Hills },
    { id: "armies", depth: 0.5, Component: Armies },
    { id: "ground", depth: 1, Component: Ground },
  ],
};
