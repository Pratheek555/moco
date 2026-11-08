// Caption-free artwork with the same headline presentation used by the desktop editor.
import { AbsoluteFill, useVideoConfig } from "remotion";
import { thumbnailPresentation, type SceneSpec, type ThumbnailDesign } from "@moco/spec";
import { Scene } from "./Scene.tsx";

export type ThumbnailProps = {
  scene: SceneSpec;
  text: string;
  design?: ThumbnailDesign;
};

export function Thumbnail({ scene, text, design }: ThumbnailProps) {
  const { width, height } = useVideoConfig();
  const headline = text.trim();
  const presentation = thumbnailPresentation(width, height, headline, design);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={headline ? presentation.image : undefined}>
        <Scene scene={{ ...scene, captions: [] }} />
      </AbsoluteFill>
      {headline && (
        <AbsoluteFill style={presentation.shade}>
          <div style={presentation.headline}>{headline}</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}
