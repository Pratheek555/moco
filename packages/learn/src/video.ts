// Turns measure.py's per-frame numbers into transitions, shots, camera moves and bursts of actor motion.
// Units: camera speed is % of the frame per frame (pan and zoom summed), rates are % per second, and
// camera directions are the camera's own (the picture moves the other way).
import { mad, mean, median, movingMedian, quantile, round } from "./stats.ts";

export interface VideoRaw {
  tool: string;
  fps: number;
  width: number;
  height: number;
  frames: number;
  analysisWidth: number;
  series: {
    cut: number[]; // HSV content change, 0–255
    hist: number[]; // 1 − histogram correlation
    zoom: number[]; // image scale vs the previous frame
    rot: number[]; // degrees
    dx: number[]; // picture motion, fraction of frame width
    dy: number[]; // fraction of frame height
    tracked: number[]; // features tracked forward and back
    inliers: number[];
    residual: number[]; // mean grey change once the camera move is undone
    active: number[]; // fraction of pixels still changing once the camera move is undone
    res50: number[]; // median leftover motion of tracked points, source px
    res90: number[];
    luma: number[];
    sat: number[];
    warm: number[];
    flow: number[]; // 1 when the move came from tracked features, 0 for the phase-correlation fallback
  };
  loop: { histCorrel: number; meanDiff: number };
}

export type TransitionKind = "cut" | "zoom" | "whip" | "blur";
export type Direction = "in" | "out" | "left" | "right" | "up" | "down";

export interface Transition {
  start: number; // first frame of the change (a hard cut is one frame)
  end: number; // last frame of the change
  at: number; // the frame the next shot starts on
  kind: TransitionKind;
  speedIn: number; // camera speed over the measured frames just before, % of frame per frame
  speedOut: number; // and just after
  direction?: Direction; // the camera's dominant move into the change
  directionOut?: Direction; // and out of it
}

export interface CameraFrame {
  zoom: number; // % scale change this frame (+ is in)
  panX: number; // camera pan, % of frame width (+ is right)
  panY: number; // % of frame height (+ is up)
  rot: number; // degrees
  speed: number; // % of frame per frame
}

export type CameraProfile = "hold" | "creep" | "steady_move" | "arrives_moving" | "accelerates_out" | "fast_in_fast_out" | "unknown";

export interface ShotCamera {
  measured: number; // fraction of the shot's frames with a reliable estimate
  zoomTotal: number; // % image scale change over the shot (+ in)
  panTotalX: number; // % of frame width the camera travelled (+ right)
  panTotalY: number; // % of frame height (+ up)
  zoomRate: number; // median |zoom| %/s
  panRate: number; // median pan %/s
  speedStart: number; // %/s, first measured frames
  speedMid: number; // %/s, median
  speedEnd: number; // %/s, last measured frames
  moving: number; // fraction of measured frames above the hold threshold
  shake: number; // RMS frame-to-frame jitter, % of frame per frame
  profile: CameraProfile;
  dominant: "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "tilt_up" | "tilt_down" | "still" | "mixed";
}

export interface Shot {
  index: number; // 1-based
  start: number; // first frame
  end: number; // last frame (inclusive)
  duration: number; // seconds
  camera: ShotCamera;
  activity: number; // mean fraction of the picture moving on its own
}

export interface MotionEvent {
  shot: number;
  onset: number;
  peak: number;
  end: number;
  frames: number;
  strength: number; // peak excess of `active` over the shot's baseline
}

export interface VideoAnalysis {
  fps: number;
  frames: number;
  duration: number;
  width: number;
  height: number;
  transitions: Transition[];
  shots: Shot[];
  camera: (CameraFrame | null)[]; // per frame, null where unmeasured (transitions, lost tracking)
  events: MotionEvent[];
  holdStillness: number; // median leftover motion of tracked points while the camera holds, source px/frame
  loop: VideoRaw["loop"];
}

// Thresholds, in the units above. Tuned on 3D cartoon shorts; they are relative where they can be.
export const HOLD_SPEED = 0.05; // % of frame per frame (~1.5 %/s at 30 fps): below this the camera is holding
const MIN_TRACKS = 15; // fewer tracked features than this and the camera estimate is not trusted
const NEAR_TRANSITION = 2; // frames either side of a transition that don't count as the shot's own motion
const MIN_SHOT_FRAMES = 6; // two changes closer than this are one transition

export function analyseVideo(raw: VideoRaw): VideoAnalysis {
  const fps = raw.fps;
  const transitions = detectTransitions(raw);
  const inTransition = new Set<number>();
  for (const transition of transitions) for (let f = transition.start; f <= transition.end; f += 1) inTransition.add(f);

  const camera = raw.series.zoom.map((_, f) => (inTransition.has(f) ? null : cameraFrame(raw, f)));
  for (const transition of transitions) describeTransition(transition, camera);

  const bounds = shotBounds(raw.frames, transitions);
  const shots = bounds.map(([start, end], i) => ({
    index: i + 1,
    start,
    end,
    duration: round((end - start + 1) / fps, 3),
    camera: shotCamera(camera.slice(start, end + 1), fps),
    activity: round(mean(raw.series.active.slice(start, end + 1)), 4),
  }));

  const events = shots.flatMap((shot) => motionEvents(raw, shot, camera, inTransition));
  const holdFrames = camera.flatMap((frame, f) => (frame && frame.speed < HOLD_SPEED ? [raw.series.res50[f]!] : []));
  return {
    fps,
    frames: raw.frames,
    duration: round(raw.frames / fps, 3),
    width: raw.width,
    height: raw.height,
    transitions,
    shots,
    camera,
    events,
    holdStillness: round(median(holdFrames), 3),
    loop: raw.loop,
  };
}

function cameraFrame(raw: VideoRaw, f: number): CameraFrame | null {
  const s = raw.series;
  if (f === 0 || s.flow[f] !== 1 || s.tracked[f]! < MIN_TRACKS || s.inliers[f]! < 0.3 * s.tracked[f]!) return null;
  const zoom = Math.log(s.zoom[f]!) * 100;
  const panX = -s.dx[f]! * 100;
  const panY = s.dy[f]! * 100; // picture moving down = camera tilting up
  return { zoom: round(zoom, 4), panX: round(panX, 4), panY: round(panY, 4), rot: round(s.rot[f]!, 4), speed: round(Math.hypot(panX, panY) + Math.abs(zoom), 4) };
}

// A transition is a run of frames where the picture changes far more than camera motion explains: a one-frame hard cut,
// or several frames of motion blur where tracking collapses (whip pans and zoom-throughs). Collapse is relative to the
// frames just before, because a flat sky or a plain wall has few features to track even when nothing is blurred.
export function detectTransitions(raw: VideoRaw): Transition[] {
  const { cut, hist, tracked } = raw.series;
  const typical = median(cut.slice(1));
  const local = movingMedian(cut, 5);
  const flagged = cut.map((score, f) => {
    if (f === 0) return false;
    const before = median(tracked.slice(Math.max(1, f - 12), Math.max(1, f - 2)));
    const spike = score > Math.max(2.2 * typical, 25) && score > 1.8 * local[f]!;
    const jump = hist[f]! > 0.3 && score > 1.5 * typical;
    const blur = tracked[f]! < Math.max(MIN_TRACKS, 0.35 * before) && score > 1.5 * typical;
    return spike || jump || blur;
  });

  const runs: [number, number][] = [];
  for (let f = 1; f < flagged.length; f += 1) {
    if (!flagged[f]) continue;
    const last = runs.at(-1);
    if (last && f - last[1] < MIN_SHOT_FRAMES) last[1] = f;
    else runs.push([f, f]);
  }

  return runs.map(([start, end]) => {
    // The next shot starts after the peak change: on a hard cut that is the cut frame itself.
    const window = cut.slice(start, end + 1);
    const peak = start + window.indexOf(Math.max(...window));
    const at = end - start <= 1 ? peak : end + 1;
    return { start, end, at: Math.min(at, raw.frames - 1), kind: end - start <= 1 ? "cut" : "blur", speedIn: 0, speedOut: 0 };
  });
}

function describeTransition(transition: Transition, camera: (CameraFrame | null)[]): void {
  const before = measuredNear(camera, transition.start - 1, -1);
  const after = measuredNear(camera, transition.end + 1, 1);
  transition.speedIn = round(mean(before.map((frame) => frame.speed)), 3);
  transition.speedOut = round(mean(after.map((frame) => frame.speed)), 3);
  transition.direction = dominantDirection(before);
  transition.directionOut = dominantDirection(after);
  if (transition.kind === "blur") {
    // Name the blur by the move that runs into it.
    if (transition.direction === "in" || transition.direction === "out") transition.kind = "zoom";
    else if (transition.direction) transition.kind = "whip";
  }
}

// Up to 4 measured frames walking away from `from` (step −1 = backwards), stopping at a gap of more than 3 frames.
function measuredNear(camera: (CameraFrame | null)[], from: number, step: number): CameraFrame[] {
  const found: CameraFrame[] = [];
  for (let f = from, misses = 0; f >= 0 && f < camera.length && found.length < 4 && misses <= 3; f += step) {
    const frame = camera[f];
    if (frame) found.push(frame);
    else misses += 1;
  }
  return found;
}

function dominantDirection(frames: CameraFrame[]): Direction | undefined {
  if (frames.length === 0) return undefined;
  const zoom = mean(frames.map((frame) => frame.zoom));
  const panX = mean(frames.map((frame) => frame.panX));
  const panY = mean(frames.map((frame) => frame.panY));
  const strongest = Math.max(Math.abs(zoom), Math.abs(panX), Math.abs(panY));
  if (strongest < 0.3) return undefined; // too slow to call it a move into the transition
  if (strongest === Math.abs(zoom)) return zoom > 0 ? "in" : "out";
  if (strongest === Math.abs(panX)) return panX > 0 ? "right" : "left";
  return panY > 0 ? "up" : "down";
}

function shotBounds(frames: number, transitions: Transition[]): [number, number][] {
  const bounds: [number, number][] = [];
  let start = 0;
  for (const transition of transitions) {
    if (transition.at > start) bounds.push([start, transition.at - 1]);
    start = transition.at;
  }
  if (start < frames) bounds.push([start, frames - 1]);
  return bounds;
}

export function shotCamera(frames: (CameraFrame | null)[], fps: number): ShotCamera {
  // The frames right after the cut and right before the next belong to the transition's motion, not the shot's.
  const inner = frames.length > 2 * NEAR_TRANSITION + 4 ? frames.slice(NEAR_TRANSITION, frames.length - NEAR_TRANSITION) : frames;
  const measured = frames.filter((frame): frame is CameraFrame => frame !== null);
  const middle = inner.filter((frame): frame is CameraFrame => frame !== null);
  const sum = (key: keyof CameraFrame) => round(measured.reduce((total, frame) => total + frame[key], 0), 2);
  const speeds = measured.map((frame) => frame.speed);
  const start = mean(speeds.slice(0, 3));
  const end = mean(speeds.slice(-3));
  const mid = median(middle.map((frame) => frame.speed));

  // Shake: frame-to-frame jerk (second difference) away from the transitions, where deliberate ramps live. A smooth
  // move, even an accelerating one, has almost none; a handheld camera has plenty.
  const jerk = (key: "panX" | "panY" | "zoom") => {
    const values = middle.map((frame) => frame[key]);
    return values.slice(1, -1).map((value, i) => (values[i]! - 2 * value + values[i + 2]!) / 2);
  };
  const shake = Math.sqrt(mean([...jerk("panX"), ...jerk("panY"), ...jerk("zoom")].map((value) => value * value)));

  const zoomTotal = sum("zoom");
  const panTotalX = sum("panX");
  const panTotalY = sum("panY");
  return {
    measured: round(measured.length / Math.max(1, frames.length), 2),
    zoomTotal: round((Math.exp(zoomTotal / 100) - 1) * 100, 1),
    panTotalX,
    panTotalY,
    zoomRate: round(median(middle.map((frame) => Math.abs(frame.zoom))) * fps, 2),
    panRate: round(median(middle.map((frame) => Math.hypot(frame.panX, frame.panY))) * fps, 2),
    speedStart: round(start * fps, 2),
    speedMid: round(mid * fps, 2),
    speedEnd: round(end * fps, 2),
    moving: round(speeds.filter((speed) => speed >= HOLD_SPEED).length / Math.max(1, speeds.length), 2),
    shake: round(Number.isFinite(shake) ? shake : 0, 4),
    profile: cameraProfile(start, mid, end, speeds),
    dominant: dominantMove(zoomTotal, panTotalX, panTotalY, mid),
  };
}

function cameraProfile(start: number, mid: number, end: number, speeds: number[]): CameraProfile {
  if (speeds.length < 4 || !Number.isFinite(mid)) return "unknown";
  if (mid < HOLD_SPEED && quantile(speeds, 0.9) < 3 * HOLD_SPEED) return "hold";
  const fastIn = start > 2.5 * mid && start > 0.5;
  const fastOut = end > 2.5 * mid && end > 0.5;
  if (fastIn && fastOut) return "fast_in_fast_out";
  if (fastIn) return "arrives_moving";
  if (fastOut) return "accelerates_out";
  return mid < 0.4 ? "creep" : "steady_move";
}

function dominantMove(zoom: number, panX: number, panY: number, mid: number): ShotCamera["dominant"] {
  if (!Number.isFinite(mid) || mid < HOLD_SPEED) return "still";
  const magnitudes = [Math.abs(zoom), Math.abs(panX), Math.abs(panY)];
  const strongest = Math.max(...magnitudes);
  if (strongest < 1) return "still";
  if (magnitudes.filter((value) => value > 0.6 * strongest).length > 1) return "mixed";
  if (strongest === magnitudes[0]) return zoom > 0 ? "zoom_in" : "zoom_out";
  if (strongest === magnitudes[1]) return panX > 0 ? "pan_right" : "pan_left";
  return panY > 0 ? "tilt_up" : "tilt_down";
}

// Bursts of motion the camera doesn't explain: gestures, face changes, things flying in. Candidates for the agents to
// confirm on tile sheets, not verdicts: parallax in 3D sets also leaves residual motion.
export function motionEvents(raw: VideoRaw, shot: Shot, camera: (CameraFrame | null)[], inTransition: Set<number>): MotionEvent[] {
  const frames: number[] = [];
  for (let f = shot.start + NEAR_TRANSITION; f <= shot.end - NEAR_TRANSITION; f += 1) {
    if (!inTransition.has(f)) frames.push(f);
  }
  if (frames.length < 8) return [];
  const active = frames.map((f) => raw.series.active[f]!);
  const baseline = movingMedian(active, 7);
  const excess = active.map((value, i) => value - baseline[i]!);
  const threshold = Math.max(0.02, 3 * mad(excess));
  const speeds = frames.map((f) => camera[f]?.speed ?? Number.NaN);
  const typicalSpeed = median(speeds);

  const events: MotionEvent[] = [];
  for (let i = 0; i < frames.length; i += 1) {
    if (excess[i]! <= threshold) continue;
    let a = i;
    let b = i;
    while (a > 0 && excess[a - 1]! > threshold / 3) a -= 1;
    while (b < frames.length - 1 && excess[b + 1]! > threshold / 3) b += 1;
    i = b;
    if (b - a + 1 < 2) continue;
    // A burst that rides on a camera speed spike is parallax, not acting.
    const speed = median(speeds.slice(a, b + 1));
    if (Number.isFinite(speed) && Number.isFinite(typicalSpeed) && speed > 3 * typicalSpeed + 0.3) continue;
    const window = excess.slice(a, b + 1);
    const peakAt = a + window.indexOf(Math.max(...window));
    const previous = events.at(-1);
    if (previous && frames[a]! - previous.end <= 2) {
      previous.end = frames[b]!;
      previous.frames = previous.end - previous.onset + 1;
      if (excess[peakAt]! > previous.strength) Object.assign(previous, { peak: frames[peakAt]!, strength: round(excess[peakAt]!, 4) });
      continue;
    }
    events.push({ shot: shot.index, onset: frames[a]!, peak: frames[peakAt]!, end: frames[b]!, frames: b - a + 1, strength: round(excess[peakAt]!, 4) });
  }
  return events;
}
