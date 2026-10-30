// Camera moves → one transform per frame. Moves that have finished keep their end state
// (a push-in stays pushed in); a shake only shakes while it's active.
import type { CameraMove } from "@moco/spec";

export interface CameraState {
  scale: number; // 1 = no zoom
  x: number; // camera offset in frame pixels (content moves the other way)
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

const MAX_ZOOM = 0.35; // push_in amount 1 → 35% closer
const MAX_PAN = 220; // pan amount 1 → 220 px
const MAX_SHAKE = 30; // shake amount 1 → ±30 px
const FOCUS_ZOOM = 0.6; // focus_on amount 1 → 60% closer
// focus_on puts the face here: well above the captions, which start at 64% of the frame height.
export const FOCUS_POINT = { x: 540, y: 1920 * 0.3 };
// How far the camera may travel past a zoomed frame's edge; backgrounds are drawn this far beyond the frame.
const EDGE_ROOM = 250;
const CENTRE = { x: 540, y: 960 };

function eased(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

// `faces`: where each cast member's face is (frame pixels, before the camera), for focus_on.
export function cameraAt(moves: CameraMove[], frame: number, faces: Record<string, Point> = {}): CameraState {
  const state: CameraState = { scale: 1, x: 0, y: 0 };
  for (const move of moves) {
    const progress = eased((frame - move.startFrame) / Math.max(1, move.endFrame - move.startFrame));
    const active = frame >= move.startFrame && frame < move.endFrame;
    applyMove(state, move, progress, active, frame, faces);
  }
  return state;
}

function applyMove(state: CameraState, move: CameraMove, progress: number, active: boolean, frame: number, faces: Record<string, Point>): void {
  switch (move.move) {
    case "push_in":
      state.scale *= 1 + MAX_ZOOM * move.amount * progress;
      break;
    case "pull_out":
      state.scale *= 1 + MAX_ZOOM * move.amount * (1 - progress);
      break;
    case "pan_left":
      state.x -= MAX_PAN * move.amount * progress;
      break;
    case "pan_right":
      state.x += MAX_PAN * move.amount * progress;
      break;
    case "shake":
      if (active) {
        state.x += Math.sin(frame * 1.7) * MAX_SHAKE * move.amount;
        state.y += Math.cos(frame * 2.3) * MAX_SHAKE * move.amount;
      }
      break;
    case "focus_on": {
      const goal = focusFraming(faces[move.castId ?? ""], move.amount);
      state.scale += (goal.scale - state.scale) * progress;
      state.x += (goal.x - state.x) * progress;
      state.y += (goal.y - state.y) * progress;
      break;
    }
    case "static":
      break;
  }
}

// The camera that zooms in by `amount` and puts `face` at FOCUS_POINT, without showing past the backgrounds' edges.
// A screen point is centre + scale·(point − centre) − camera, so camera = centre + scale·(face − centre) − FOCUS_POINT.
export function focusFraming(face: Point | undefined, amount: number): CameraState {
  if (!face) return { scale: 1, x: 0, y: 0 }; // the renderer rejects unknown cast ids before this
  const scale = 1 + FOCUS_ZOOM * amount;
  const x = CENTRE.x + scale * (face.x - CENTRE.x) - FOCUS_POINT.x;
  const y = CENTRE.y + scale * (face.y - CENTRE.y) - FOCUS_POINT.y;
  const roomX = EDGE_ROOM + (scale - 1) * CENTRE.x;
  const roomY = EDGE_ROOM + (scale - 1) * CENTRE.y;
  return { scale, x: Math.max(-roomX, Math.min(roomX, x)), y: Math.max(-roomY, Math.min(roomY, y)) };
}

// Far layers move and zoom less than near ones. depth: 0 = far, 1 = near.
export function layerTransform(camera: CameraState, depth: number): string {
  const follow = 0.3 + 0.7 * depth;
  const scale = 1 + (camera.scale - 1) * (0.5 + 0.5 * depth);
  return `translate(${-camera.x * follow}px, ${-camera.y * follow}px) scale(${scale})`;
}
