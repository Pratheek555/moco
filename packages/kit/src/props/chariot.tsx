// Arjuna's chariot, side-on, with a spinning wheel and Hanuman's flag. Box 600×420, anchor bottom centre.
import type { PropDef } from "../define.ts";

const GOLD = "#e8b923";
const WOOD = "#7e4a1e";

function Chariot({ frame }: { frame: number }) {
  const spin = frame * 3; // degrees per frame
  const flagWave = Math.sin(frame / 6) * 6;
  return (
    <g>
      {/* flag pole and flag */}
      <rect x={120} y={10} width={8} height={190} fill={WOOD} />
      <path d={`M128 14 Q170 ${24 + flagWave} 210 18 L206 72 Q170 ${80 + flagWave} 128 70 Z`} fill="#e67e22" />
      {/* canopy */}
      <path d="M150 120 Q300 70 450 120 L450 135 L150 135 Z" fill="#922b21" />
      <rect x={160} y={135} width={10} height={95} fill={GOLD} />
      <rect x={430} y={135} width={10} height={95} fill={GOLD} />
      {/* body */}
      <path d="M110 230 L490 230 L470 320 L130 320 Z" fill={WOOD} stroke={GOLD} strokeWidth={6} />
      <path d="M140 250 L460 250" stroke={GOLD} strokeWidth={4} />
      <rect x={480} y={270} width={110} height={10} rx={5} fill={WOOD} />
      {/* wheel */}
      <g transform={`translate(300 330) rotate(${spin})`}>
        <circle r={86} fill="none" stroke={WOOD} strokeWidth={16} />
        <circle r={86} fill="none" stroke={GOLD} strokeWidth={4} />
        {[0, 30, 60, 90, 120, 150].map((angle) => (
          <rect key={angle} x={-4} y={-82} width={8} height={164} fill={WOOD} transform={`rotate(${angle})`} />
        ))}
        <circle r={16} fill={GOLD} />
      </g>
    </g>
  );
}

export const chariot: PropDef = { id: "chariot", attachPoints: ["seat"], width: 600, height: 420, Component: Chariot };
