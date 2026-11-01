// A thumbnail: one frame of a shot without its caption, darkened at the bottom behind a big headline.
// The headline sits where captions do: below the faces (top third), inside the 3:4 middle that Instagram's
// profile grid shows, and above the title and buttons YouTube draws along the bottom.
import { AbsoluteFill } from "remotion";
import { FRAME_HEIGHT, FRAME_WIDTH, type SceneSpec } from "@moco/spec";
import { Scene } from "./Scene.tsx";

export type ThumbnailProps = {
  scene: SceneSpec;
  text: string;
};

export function Thumbnail({ scene, text }: ThumbnailProps) {
  const headline = text.trim();
  return (
    <AbsoluteFill>
      <Scene scene={{ ...scene, captions: [] }} />
      {headline && (
        <AbsoluteFill
          style={{
            justifyContent: "flex-start",
            alignItems: "center",
            paddingTop: FRAME_HEIGHT * 0.62,
            background: "linear-gradient(to top, rgba(0,0,0,0.65) 15%, rgba(0,0,0,0) 55%)",
          }}
        >
          <div
            style={{
              maxWidth: FRAME_WIDTH * 0.86,
              textAlign: "center",
              fontFamily: "'Arial Black', 'Noto Sans Devanagari', Arial, sans-serif",
              fontWeight: 900,
              fontSize: headline.length > 24 ? 112 : 136,
              lineHeight: 1.05,
              color: "#ffd54f",
              WebkitTextStroke: "18px #111",
              paintOrder: "stroke fill",
              textWrap: "balance",
            }}
          >
            {headline}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}
