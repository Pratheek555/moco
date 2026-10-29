import { CHARACTER_DEFS, Character, restRig } from '@moco/kit';
import type { Expression, Pose } from '@moco/spec';
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

export interface SheetProps extends Record<string, unknown> {
  characters: string[];
  poses: Pose[];
  expression: Expression;
  cols: number;
}

/** Dev sheet: a grid of characters × poses for checking the art. */
export const Sheet: React.FC<SheetProps> = ({ characters, poses, expression, cols }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const cells = characters.flatMap((c) => poses.map((p) => ({ c, p })));
  const rows = Math.ceil(cells.length / cols);
  const cw = width / cols;
  const ch = height / rows;
  const scale = Math.min(cw / 640, ch / 1300);
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(#f4efe6, #e9e1d2)' }}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
        {cells.map(({ c, p }, i) => {
          const def = CHARACTER_DEFS[c];
          if (!def) return null;
          const x = (i % cols) * cw + cw / 2;
          const y = Math.floor(i / cols) * ch + ch - 40 * scale;
          return (
            <g key={i} transform={`translate(${x} ${y}) scale(${scale})`}>
              <Character def={def} rig={restRig(p, expression, frame / fps)} pose={p} uid={`s${i}`} />
            </g>
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
