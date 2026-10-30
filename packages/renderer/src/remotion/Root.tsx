// Remotion compositions: "Episode" for full renders, "Scene" for single-shot stills (L3 checks, thumbnails).
import { Composition } from "remotion";
import { FPS, FRAME_HEIGHT, FRAME_WIDTH, type SceneSpec } from "@moco/spec";
import { demoScene } from "./demo.ts";
import { Episode, type EpisodeProps } from "./Episode.tsx";
import { Scene } from "./Scene.tsx";

const size = { width: FRAME_WIDTH, height: FRAME_HEIGHT, fps: FPS };

const demoEpisode: EpisodeProps = {
  episode: { episodeId: "demo", scenes: [demoScene], audio: { voiceover: "" }, export: { width: FRAME_WIDTH, height: FRAME_HEIGHT, fps: FPS } },
  audioUrl: null,
};

export function Root() {
  return (
    <>
      <Composition
        id="Episode"
        component={Episode}
        {...size}
        durationInFrames={1}
        defaultProps={demoEpisode}
        calculateMetadata={({ props }) => ({
          durationInFrames: props.episode.scenes.reduce((total, scene) => total + scene.durationFrames, 0),
        })}
      />
      <Composition
        id="Scene"
        component={Scene}
        {...size}
        durationInFrames={1}
        defaultProps={{ scene: demoScene as SceneSpec }}
        calculateMetadata={({ props }) => ({ durationInFrames: props.scene.durationFrames })}
      />
    </>
  );
}
