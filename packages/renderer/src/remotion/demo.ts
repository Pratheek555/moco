// Default props for Remotion Studio (`pnpm --filter @moco/renderer studio`): a short Krishna scene.
import { SceneSpec } from "@moco/spec";

// Parsed, so fields with defaults (idle, finish, …) are filled in.
export const demoScene: SceneSpec = SceneSpec.parse({
  shotId: "demo",
  durationFrames: 150,
  background: { id: "kurukshetra", parallax: true },
  actors: [
    {
      castId: "krishna",
      kitCharacterId: "krishna",
      position: { x: 0.5, y: 0.6, scale: 0.6 },
      facing: "right",
      actions: [
        { name: "blink", startFrame: 20, endFrame: 26 },
        { name: "raise_hand", startFrame: 40, endFrame: 110, params: { side: "right" } },
        { name: "blink", startFrame: 120, endFrame: 126 },
      ],
      expression: [{ name: "smile", atFrame: 0 }],
    },
  ],
  props: [],
  camera: [{ move: "push_in", startFrame: 0, endFrame: 150, amount: 0.2 }],
  captions: [{ text: "Krishna smiled", startFrame: 10, endFrame: 140, emphasis: true }],
  fx: [{ id: "dust", startFrame: 0, endFrame: 90 }],
  fallback: false,
});
