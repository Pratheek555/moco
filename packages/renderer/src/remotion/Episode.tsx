// A whole episode: scenes back to back, with the voiceover underneath.
import { Audio, Series } from "remotion";
import type { RenderEpisode } from "../render-input.ts";
import { Scene } from "./Scene.tsx";

// A type alias, not an interface: Remotion needs props assignable to Record<string, unknown>.
export type EpisodeProps = {
  episode: RenderEpisode;
  audioUrl: string | null; // served over http by the RenderPort during a render
};

export function Episode({ episode, audioUrl }: EpisodeProps) {
  return (
    <>
      <Series>
        {episode.scenes.map((scene) => (
          <Series.Sequence key={scene.shotId} durationInFrames={scene.durationFrames}>
            <Scene scene={scene} />
          </Series.Sequence>
        ))}
      </Series>
      {audioUrl ? <Audio src={audioUrl} /> : null}
    </>
  );
}
