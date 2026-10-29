import { DEMO_EPISODE, KRISHNA_CHARIOT_SHOT } from '@moco/spec';
import React from 'react';
import { Composition } from 'remotion';
import { EpisodeComposition, ShotComposition, type EpisodeProps, type ShotProps } from './Episode.tsx';
import { COMPOSITION, episodeFrames, shotFrames } from './metadata.ts';
import { Sheet, type SheetProps } from './dev/Sheet.tsx';

export const Root: React.FC = () => (
  <>
    <Composition
      id="Episode"
      component={EpisodeComposition}
      {...COMPOSITION}
      durationInFrames={300}
      defaultProps={{ episode: DEMO_EPISODE } satisfies EpisodeProps}
      calculateMetadata={({ props }) => ({ durationInFrames: episodeFrames(props.episode), fps: props.episode.fps ?? COMPOSITION.fps })}
    />
    <Composition
      id="Shot"
      component={ShotComposition}
      {...COMPOSITION}
      durationInFrames={150}
      defaultProps={{ shot: KRISHNA_CHARIOT_SHOT } satisfies ShotProps}
      calculateMetadata={({ props }) => ({ durationInFrames: shotFrames(props.shot) })}
    />
    <Composition
      id="Sheet"
      component={Sheet}
      {...COMPOSITION}
      durationInFrames={90}
      defaultProps={{ characters: ['krishna'], poses: ['stand'], expression: 'neutral', cols: 1 } satisfies SheetProps}
    />
  </>
);
