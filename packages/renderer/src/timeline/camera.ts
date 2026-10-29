import { clamp, noise1 } from '@moco/kit';
import type { Shot } from '@moco/spec';
import { easeInOut, easeOut } from './actors.ts';

export interface CameraFrame {
  zoom: number;
  /** Camera position offset in px at the actors' plane. */
  x: number;
  y: number;
  rot: number;
  /** Zoom pivot in px. */
  fx: number;
  fy: number;
}

const W = 1080;
const H = 1920;

export function cameraFrame(shot: Shot, t: number, duration: number): CameraFrame {
  const { move, intensity: k, focus } = shot.camera;
  const p = easeInOut(t / Math.max(0.1, duration));
  const fx = (focus?.x ?? 0.5) * W;
  const fy = (focus?.y ?? 0.42) * H;
  const base: CameraFrame = { zoom: 1, x: 0, y: 0, rot: 0, fx, fy };
  const pan = 70 + 110 * k;
  switch (move) {
    case 'push-in':
      return { ...base, zoom: 1 + (0.06 + 0.24 * k) * p };
    case 'pull-out':
      return { ...base, zoom: 1 + (0.06 + 0.28 * k) * (1 - p) };
    case 'pan-left':
      return { ...base, zoom: 1.08, x: pan * (1 - 2 * p) };
    case 'pan-right':
      return { ...base, zoom: 1.08, x: -pan * (1 - 2 * p) };
    case 'tilt-up':
      return { ...base, zoom: 1.08, y: pan * (1 - 2 * p) };
    case 'tilt-down':
      return { ...base, zoom: 1.08, y: -pan * (1 - 2 * p) };
    case 'drift':
      return { ...base, zoom: 1.06 + Math.sin(t * 0.6) * 0.012 * (1 + k), x: Math.sin(t * 0.45) * 30 * (0.5 + k), y: Math.cos(t * 0.38) * 22 * (0.5 + k), rot: Math.sin(t * 0.3) * 0.4 };
    case 'crash-zoom': {
      const c = easeOut(t / 0.35);
      const settle = Math.sin(clamp(t / 0.6, 0, 1) * Math.PI * 2) * 0.015 * (1 - clamp(t / 0.6, 0, 1));
      return { ...base, zoom: 1 + (0.15 + 0.3 * k) * c + settle + 0.03 * p };
    }
    case 'handheld':
      return { ...base, zoom: 1.05, x: noise1(t * 0.9, 3) * 14 * (0.5 + k), y: noise1(t * 0.8, 7) * 12 * (0.5 + k), rot: noise1(t * 0.6, 11) * 0.5 };
    case 'shake':
      return { ...base, zoom: 1.08, x: noise1(t * 14, 3) * 34 * (0.4 + k), y: noise1(t * 13, 7) * 28 * (0.4 + k), rot: noise1(t * 9, 11) * 1.6 * (0.4 + k) };
    default:
      return base;
  }
}

/** CSS transform for a layer at `depth` (0 sky … 1 actors … >1 foreground). */
export function layerTransform(cam: CameraFrame, depth: number) {
  const z = 1 + (cam.zoom - 1) * (0.3 + 0.7 * depth);
  const tx = -cam.x * depth;
  const ty = -cam.y * depth;
  return `translate(${cam.fx}px, ${cam.fy}px) rotate(${cam.rot * Math.min(1, depth)}deg) scale(${z}) translate(${-cam.fx + tx}px, ${-cam.fy + ty}px)`;
}
