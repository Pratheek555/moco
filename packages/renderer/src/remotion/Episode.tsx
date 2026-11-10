// A whole episode: scenes back to back, with the voiceover underneath.
import { AbsoluteFill, Audio, Freeze, Series, useCurrentFrame } from "remotion";
import type { RenderEpisode } from "../render-input.ts";
import type { RenderScene } from "../render-input.ts";
import { transitionAt } from "../transitions.ts";
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
        {episode.scenes.map((scene, index) => (
          <Series.Sequence key={scene.shotId} durationInFrames={scene.durationFrames}>
            <Shot scene={scene} previous={episode.scenes[index - 1]} />
          </Series.Sequence>
        ))}
      </Series>
      {audioUrl ? <Audio src={audioUrl} /> : null}
    </>
  );
}

function Shot({ scene, previous }: { scene: RenderScene; previous: RenderScene | undefined }) {
  const frame = useCurrentFrame();
  const opacity = transitionAt(previous ? scene.transition : undefined, frame, scene.durationFrames);
  return <AbsoluteFill style={{ backgroundColor: "black" }}>
    {previous && opacity.outgoing > 0 ? <AbsoluteFill style={{ opacity: opacity.outgoing }}>
      <Freeze frame={previous.durationFrames - 1}><Scene scene={previous} /></Freeze>
    </AbsoluteFill> : null}
    <AbsoluteFill style={{ opacity: opacity.incoming }}><Scene scene={scene} /></AbsoluteFill>
  </AbsoluteFill>;
}
