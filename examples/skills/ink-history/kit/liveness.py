"""Camera-compensated content-motion QA (numpy, Pillow, ffmpeg; no OpenCV).

    python liveness.py film.mp4 --csv motion.csv --json motion.json --png motion.png
    python liveness.py film.mp4 --fail-stale-run 2 --fail-quiet-run 4
    python liveness.py film.mp4 --gate --shots timeline.json --json motion-report.json --png motion-timeline.png
    python liveness.py --self-test

measure(path, **options) -> JSON-safe summary; violations(summary, max_stale=...,
max_quiet=...) -> windows. summarize_csv(csv_path, metadata=summary, ...) can
apply exclusions or authored shot ranges without decoding/registration again.
CLI --exclude START END is repeatable (seconds); --shots takes a JSON shot list
or {"shots": [...]} with id, kind, start, end (or dur). Excluded spans remain in
the full-film results; included/filtered_shots report the selected material.

changed/energy/spread retain v1's raw adjacent-pair meaning. content and
lag_content are residual changed fractions after robust global similarity
registration (translation, uniform zoom, rotation). Energy uses 0..255 gray
levels; fractions use 0..1. camera is RMS global displacement in pixels at the
sampled width (default 480), NOT at the source resolution. Slow content uses a
same-shot half-second and shorter corroborating baselines; labels can persist
up to the shorter baseline (normally one-third second).
Gradient/curvature-proportional slack rejects subpixel resampling shimmer.
Detector v4 requires spatially overlapping evidence against BOTH baselines.
Repeated weak two-frame phase returns with no lag displacement are rejected
retrospectively; an isolated short pop is retained, never temporally averaged.
A broadly supported second similarity model rejects camera/planar edge
residuals when registration locks onto an overlay. raw_content/raw_lag_content
retain single-model fractions; planar_removed records contour rejection.
Old v2/v3 scalar CSVs lack this spatial evidence and must be redecoded.

States: frozen (neither camera nor content), drift (camera only), local (small
content region), acting (meaningful changed area OR two separate grid regions),
cut (isolated raw widespread energy jump). Stale = frozen+drift; quiet =
frozen+drift+local. Events are shot-relative bursts of adjacent compensated
content above the shot's upper-quartile baseline, concentrated into a short
part of the half-second motion envelope, or sustained travel starting after
a quiet lead-in. Cuts, cut-straddling pairs and rapid
camera moves never earn event credit. Hysteresis groups a pop/settle as one
event. A pixel detector cannot establish a gesture's narrative meaning; inspect
the marked windows as well as the scores. Steady bob/flicker controls earn zero.

CSV t is the later sampled frame's timestamp; start/end are the interval to
which that evidence is assigned. The first frame is only a baseline; the last
pair's interval extends to video duration. Timing uncertainty is one sample,
plus lag persistence for content labels. Images use a fixed ring; scalar rows
are retained for shot-baseline calibration (not video-sized image buffers).
Nearby bursts within the grouping/refractory interval share an event marker;
event onsets can lag the first faint entrance sample. Registration is heuristic: independently
moving objects covering most of the frame may be mistaken for camera motion.
No intentional-freeze exemptions or automatic sponsor exclusions are applied.
"""

from __future__ import annotations

import argparse
from collections import Counter, deque
import csv
from contextlib import ExitStack
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

import numpy as np
from PIL import Image, ImageDraw


STATES = ("frozen", "drift", "local", "acting", "cut")
DETECTOR_VERSION = 4
DETECTOR_SOURCE_SHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
# Delivery policy. Reference: 12% stale / 74.5% acting, stale-run p95 2.1s;
# the old EIC film was 70% stale. These intentionally stricter limits are not
# story options. Only explicit CLI flags may override them; never exempt holds.
MAX_STALE_RUN_SECONDS = 2.0
MAX_FROZEN_RUN_SECONDS = 0.5
MAX_STALE_PERCENT = 10.0
MIN_ACTING_PERCENT = 50.0
WARN_SHOT_MIN_SECONDS = 3.0
WARN_SHOT_STALE_PERCENT = 40.0
# Event calibration, filtered 38m reference / detector v3: 728 events,
# 3.269/10s; inter-event p50/p90/p95/p99 = 1.833/6.833/9.042/14.898s;
# 219/249 (87.95%) shots >=3s have an event; per-shot max-gap p90=6.933s.
# 2.3/10s is 70.4% of that rate. The owner's 5s ceiling is intentionally
# stricter than reference p95 (31.7% of its >=3s shots exceed 5s). Every >=3s
# shot must have an event, stricter than reference coverage. No story opt-outs.
MIN_EVENTS_PER_10_SECONDS = 2.3
MAX_EVENT_GAP_SECONDS = 5.0
EVENT_REQUIRED_SHOT_SECONDS = 3.0
GATE_DEFAULTS = dict(max_stale_run=MAX_STALE_RUN_SECONDS, max_frozen_run=MAX_FROZEN_RUN_SECONDS,
                     max_stale_percent=MAX_STALE_PERCENT, min_acting_percent=MIN_ACTING_PERCENT,
                     min_events_per_10s=MIN_EVENTS_PER_10_SECONDS, max_event_gap=MAX_EVENT_GAP_SECONDS)
MOTION_HINT = "held drawing under camera move: add acting, ambient motion or an entrance; see SKILL.md 'Keep it alive'"
EVENT_HINT = "content only drifts: add a timed event — an arrival, reveal, pose change, token or cue-driven pop; see SKILL.md 'Keep it alive'"
DEFAULTS = dict(
    width=480, sample_rate=12.0, pixel_threshold=10.0, box=2,
    static_changed=0.0002, static_energy=0.03, lag_seconds=0.5, cell_changed=0.002,
    content_pixel=8.0, resample_slack=0.25, interpolation_slack=0.3, content_changed=0.0002,
    acting_changed=0.008, region_changed=0.0003, content_cell=0.003,
    camera_threshold=0.08, event_gap=0.2, event_refractory=0.4,
    event_floor=0.003, event_baseline_factor=1.5, event_lag_factor=0.4,
    event_camera_zoom=0.025, event_boundary_seconds=0.12, event_onset_quiet=0.5,
    cut_changed=0.2, cut_energy=15.0, cut_spread=0.9, cut_ratio=3.0,
    grid_cols=8, grid_rows=4,
)


def timestamp(seconds):
    """Human-readable timestamp, also for windows longer than an hour."""
    milliseconds = round(seconds * 1000)
    hours, rem = divmod(milliseconds, 3600000)
    minutes, rem = divmod(rem, 60000)
    secs, ms = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{ms:03d}"


def _scale(width):
    # DAR preserves non-square pixels; ffmpeg autorotation precedes this filter.
    return f"scale={width}:max(2\\,trunc(ow/dar/2)*2):flags=area,setsar=1,format=gray"


def _probe(path, width, ffmpeg):
    """Use ffmpeg itself, so ffprobe is not an extra executable dependency."""
    cmd = [ffmpeg, "-nostdin", "-hide_banner", "-threads", "2", "-filter_threads", "1",
           "-i", str(path), "-map", "0:v:0", "-vf", _scale(width),
           "-frames:v", "1", "-c:v", "pgm", "-f", "image2pipe", "pipe:1"]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    log = r.stderr.decode("utf-8", errors="replace")
    header = re.match(rb"P5\s+(\d+)\s+(\d+)\s+255\s", r.stdout)
    if r.returncode or not header:
        raise RuntimeError(f"Cannot decode a video frame from {path}:\n{log[-4000:]}")
    match = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", log)
    duration = (int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3])) if match else None
    return int(header[1]), int(header[2]), duration


def _frames(path, width, height, rate, ffmpeg):
    cmd = [ffmpeg, "-nostdin", "-hide_banner", "-v", "error", "-threads", "2",
           "-filter_threads", "1", "-i", str(path), "-map", "0:v:0", "-an", "-sn", "-dn",
           "-vf", f"fps={rate}:start_time=0:round=near:eof_action=pass," + _scale(width),
           "-c:v", "rawvideo", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"]
    # A file avoids stderr pipe deadlocks even on damaged input. Never buffer the
    # whole video, or let a caller's exception leave a blocked decoder behind.
    with tempfile.TemporaryFile() as errors:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=errors)
        try:
            size = width * height
            while True:
                buf = bytearray(size)
                view = memoryview(buf)
                offset = 0
                while offset < size:
                    n = proc.stdout.readinto(view[offset:])
                    if not n:
                        break
                    offset += n
                if not offset:
                    break
                if offset != size:
                    raise RuntimeError("ffmpeg returned an incomplete raw frame")
                yield np.frombuffer(buf, dtype=np.uint8).reshape(height, width)
            code = proc.wait()
            if code:
                errors.seek(0)
                raise RuntimeError("ffmpeg decode failed:\n" + errors.read().decode("utf-8", errors="replace")[-4000:])
        finally:
            proc.stdout.close()
            if proc.poll() is None:
                proc.terminate()
            proc.wait()


def _average(frame, box):
    h, w = frame.shape
    h, w = h // box * box, w // box * box
    # Keep fractional gray levels; uint8 rounding would erase small slow moves.
    return frame[:h, :w].reshape(h // box, box, w // box, box).mean(axis=(1, 3), dtype=np.float32)


def _diff(a, b, opt, edges):
    delta = np.abs(a - b)
    mask = delta > opt["pixel_threshold"]
    # reduceat works for uneven cell sizes too (e.g. portrait videos).
    ys, xs, areas = edges
    counts = np.add.reduceat(np.add.reduceat(mask, ys, axis=0, dtype=np.int32), xs, axis=1)
    spread = float(np.mean(counts / areas > opt["cell_changed"]))
    return float(mask.mean()), float(delta.mean()), spread


def _blur(a):
    p = np.pad(a, ((0, 0), (1, 1)), mode="edge")
    a = (p[:, :-2] + 2 * p[:, 1:-1] + p[:, 2:]) * .25
    p = np.pad(a, ((1, 1), (0, 0)), mode="edge")
    return (p[:-2] + 2 * p[1:-1] + p[2:]) * .25


def _weights(x, y, shape):
    h, w = shape
    x = np.clip(x, 0, w - 1.001)
    y = np.clip(y, 0, h - 1.001)
    ix, iy = x.astype(np.int32), y.astype(np.int32)
    return ix, iy, x - ix.astype(np.float32), y - iy.astype(np.float32)


def _sample(a, weights):
    ix, iy, dx, dy = weights
    top, bottom = a[iy, ix], a[iy + 1, ix]
    return (top + dx * (a[iy, ix + 1] - top)) * (1 - dy) + (bottom + dx * (a[iy + 1, ix + 1] - bottom)) * dy


class _Image:
    def __init__(self, a):
        self.a = a
        self.pyramid = []
        a = _blur(a)
        p = np.pad(a, 1, mode="edge")
        self.curvature = (np.abs(p[1:-1, :-2] - 2 * a + p[1:-1, 2:])
                          + np.abs(p[:-2, 1:-1] - 2 * a + p[2:, 1:-1]))
        for k in range(3):
            gy, gx = np.gradient(a)
            if k == 0:
                self.slope = np.abs(gx) + np.abs(gy)
            self.pyramid.append((a, gx, gy))
            if k != 2:
                a = _average(a, 2)


class _Camera:
    """Robust coarse-to-fine photometric similarity registration, numpy only.

    The inverse warp maps current pixels to the preceding frame. Equal spatial
    cells and Cauchy residual weights reduce foreground influence. Translation,
    uniform zoom and rotation are estimated, rather than interpreting a zoom's
    outward edge flow as independent content animation.
    """
    def __init__(self, shape):
        h, w = shape
        self.full_y, self.full_x = np.mgrid[:h, :w].astype(np.float32)
        self.grids = []
        for k in range(3):
            hk, wk = h // (2 ** k), w // (2 ** k)
            yy, xx = np.mgrid[3:hk-3:2, 3:wk-3:2].astype(np.float32)
            self.grids.append((xx.ravel(), yy.ravel(), (xx.ravel() - (wk - 1) / 2) / wk,
                               (yy.ravel() - (hk - 1) / 2) / wk,
                               (np.minimum(3, (yy.ravel() * 4 / hk).astype(int)) * 8
                                + np.minimum(7, (xx.ravel() * 8 / wk).astype(int)))))

    @staticmethod
    def matrix(p, shape):
        tx, ty, z, r = p
        h, w = shape
        cx, cy = (w - 1) / 2, (h - 1) / 2
        a, b = 1 + z / w, r / w
        return np.array([[a, -b, tx + cx - a * cx + b * cy],
                         [b, a, ty + cy - b * cx - a * cy], [0, 0, 1]])

    @staticmethod
    def parameters(m, shape):
        h, w = shape
        cx, cy = (w - 1) / 2, (h - 1) / 2
        return np.array([m[0, 2] - cx + m[0, 0] * cx + m[0, 1] * cy,
                         m[1, 2] - cy + m[1, 0] * cx + m[1, 1] * cy,
                         (m[0, 0] - 1) * w, m[1, 0] * w])

    def fit(self, current, previous, initial=None, quick=False, support=None):
        h, w = current.a.shape
        p = np.zeros(4) if initial is None else self.parameters(initial, (h, w))
        for level in ([0] if quick else [2, 1, 0]):
            factor = 2 ** level
            q = p / factor
            ca, _, _ = current.pyramid[level]
            pa, gx, gy = previous.pyramid[level]
            x, y, xn, yn, cell = self.grids[level]
            target = ca[y.astype(int), x.astype(int)]
            for _ in range(3 if quick else 5):
                tx, ty, z, r = q
                xx, yy = x + tx + z * xn - r * yn, y + ty + z * yn + r * xn
                valid = (xx >= 1) & (yy >= 1) & (xx < pa.shape[1] - 2) & (yy < pa.shape[0] - 2)
                if valid.sum() < 20:
                    break
                weights = _weights(xx, yy, pa.shape)
                residual = target - _sample(pa, weights)
                dx, dy = _sample(gx, weights), _sample(gy, weights)
                texture = dx * dx + dy * dy
                weight = valid * (texture > 1) / (1 + (residual / (20 if support is not None else 5)) ** 2)
                if support is not None:
                    weight *= support[np.minimum(h - 1, (y * factor).astype(int)),
                                      np.minimum(w - 1, (x * factor).astype(int))]
                # Give textured regions comparable votes, rather than allowing
                # one highly detailed mouth/hand to own the global camera.
                mass = np.bincount(cell, weights=weight, minlength=32)
                weight /= np.maximum(8, mass[cell])
                jac = np.stack((dx, dy, dx * xn + dy * yn, -dx * yn + dy * xn), axis=1)
                normal = (jac.T * weight) @ jac
                rhs = jac.T @ (weight * residual)
                try:
                    step = np.linalg.solve(normal + np.eye(4) * .0001, rhs)
                except np.linalg.LinAlgError:
                    break
                step = np.clip(step, [-3, -3, -8, -4], [3, 3, 8, 4])
                q += step
                if np.max(np.abs(step)) < .006:
                    break
            p = q * factor
        # Registration on a cut or an almost blank image can be ill-conditioned.
        if not np.isfinite(p).all() or abs(p[2]) > w * .35 or abs(p[3]) > w * .2:
            p = np.zeros(4)
        return self.matrix(p, (h, w))

    def residual(self, current, previous, matrix, opt, edges):
        x, y = self.full_x, self.full_y
        matrix = matrix.astype(np.float32)
        xx = matrix[0, 0] * x + matrix[0, 1] * y + matrix[0, 2]
        yy = matrix[1, 0] * x + matrix[1, 1] * y + matrix[1, 2]
        h, w = current.a.shape
        margin = 3
        valid = ((xx >= margin) & (yy >= margin) & (xx < w - margin - 1) & (yy < h - margin - 1)
                 & (x >= margin) & (y >= margin) & (x < w - margin - 1) & (y < h - margin - 1))
        ca, cx, cy = current.pyramid[0]
        pa, px, py = previous.pyramid[0]
        weights = _weights(xx, yy, pa.shape)
        aligned = _sample(pa, weights)
        delta = np.abs(ca - aligned)
        gradient = np.maximum(current.slope, _sample(previous.slope, weights))
        # Linear interpolation also changes the peaks of thin lines, where the
        # first derivative is zero. Curvature slack covers those phase errors;
        # gradient slack covers edge-position error. A real translated object
        # still leaves residual contours against the half-second baseline.
        threshold = opt.get("content_pixel", 8.) + opt.get("resample_slack", .25) * gradient
        curvature = np.maximum(current.curvature, _sample(previous.curvature, weights))
        threshold += opt.get("interpolation_slack", .3) * curvature
        mask = (delta > threshold) & valid
        ys, xs, areas = edges
        counts = np.add.reduceat(np.add.reduceat(mask, ys, axis=0, dtype=np.int32), xs, axis=1)
        denom = max(1, valid.sum())
        content = float(mask.sum() / denom)
        spread = float(np.mean(counts / areas > opt.get("content_cell", .003)))
        motion = np.hypot(xx - x, yy - y)
        camera = float(np.sqrt(np.mean(motion[valid] ** 2))) if valid.any() else 0.
        return dict(content=content, content_energy=float(delta[valid].mean()) if valid.any() else 0.,
                    content_spread=spread, camera=camera, counts=counts, mask=mask,
                    valid=valid, valid_fraction=float(valid.mean()))

    def evidence(self, current, previous, matrix, opt, edges):
        """Reject a broadly supported second camera/plane, not local actors.

        Robust registration can lock onto a static overlay/background while a
        camera or large flat surface accelerates. Fit another similarity ONLY
        on the unexplained pixels. It must explain >=80% of that residual and
        have support spanning half the image in BOTH axes and >=6 grid cells.
        Remove explained connected contours, preserving separate small changes.
        A small pen/hand/clock never supplies that global support by itself.
        """
        result = self.residual(current, previous, matrix, opt, edges)
        mask = result['mask']
        result['raw_content'] = result['content']
        result['planar_removed'] = 0.
        if not _broad_support(mask, edges):
            return result
        alternative = self.fit(current, previous, initial=matrix, support=_dilate(mask, 2))
        other = self.residual(current, previous, alternative, opt, edges)
        # Leaving the candidate's field of view is missing evidence, not a
        # successful match. Never erase an entrance merely for going offscreen.
        explained = mask & other['valid'] & ~other['mask']
        if explained.sum() < .8 * mask.sum() or not _broad_support(explained, edges):
            return result
        # Interpolation/occlusion at the end of a long moving contour can leave
        # a few unmatched pixels. Test connected contours, not their individual
        # pixels; otherwise those leftovers become fresh "content" once again.
        keep = mask.copy()
        for component in _components(_dilate(mask, 1)):
            yy, xx = component
            actual = mask[yy, xx]
            if np.count_nonzero(explained[yy, xx]) >= .8 * np.count_nonzero(actual):
                keep[yy, xx] = False
        result['planar_removed'] = float((mask.sum() - keep.sum()) / max(1, mask.size * result['valid_fraction']))
        _set_mask(result, keep, opt, edges)
        return result


def _dilate(mask, radius=1):
    h, w = mask.shape
    p = np.pad(mask, radius)
    return np.logical_or.reduce([p[y:y + h, x:x + w]
                                 for y in range(2 * radius + 1) for x in range(2 * radius + 1)])


def _components(mask):
    """Eight-connected row runs, avoiding a Python visit to every video pixel."""
    parents, runs, previous = [], [], []

    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i

    for y, row in enumerate(mask):
        transitions = np.flatnonzero(np.diff(np.pad(row.astype(np.int8), 1)))
        current, left = [], 0
        for x, end in zip(transitions[::2], transitions[1::2]):
            i = len(parents)
            parents.append(i)
            runs.append((y, x, end))
            # Endpoints are exclusive. Equal endpoints on adjacent rows still
            # touch diagonally, so count as one eight-connected component.
            while left < len(previous) and previous[left][1] < x:
                left += 1
            k = left
            while k < len(previous) and previous[k][0] <= end:
                parents[root(previous[k][2])] = root(i)
                k += 1
            current.append((x, end, i))
        previous = current
    groups = {}
    for i, (y, x, end) in enumerate(runs):
        groups.setdefault(root(i), []).append((y, x, end))
    for group in groups.values():
        yield (np.concatenate([np.full(end - x, y, dtype=int) for y, x, end in group]),
               np.concatenate([np.arange(x, end) for y, x, end in group]))


def _broad_support(mask, edges):
    yy, xx = np.nonzero(mask)
    if not len(yy) or np.ptp(yy) < mask.shape[0] * .5 or np.ptp(xx) < mask.shape[1] * .5:
        return False
    ys, xs, areas = edges
    counts = np.add.reduceat(np.add.reduceat(mask, ys, axis=0, dtype=np.int32), xs, axis=1)
    return np.count_nonzero(counts >= 3) >= 6


def _set_mask(result, mask, opt, edges):
    ys, xs, areas = edges
    counts = np.add.reduceat(np.add.reduceat(mask, ys, axis=0, dtype=np.int32), xs, axis=1)
    pixels = max(1, mask.size * result['valid_fraction'])
    result.update(mask=mask, counts=counts, content=float(mask.sum() / pixels),
                  content_spread=float(np.mean(counts / areas > opt['content_cell'])),
                  regions=_regions(counts, pixels, opt))


def _samples(frames, opt, edges):
    """Delay each pair by one frame to distinguish a cut from a camera snap."""
    previous, pending = None, None
    for index, raw in enumerate(frames):
        current = _average(raw, opt["box"])
        if previous is None:
            yield 0.0, current, None, 0.0
        else:
            fast = _diff(current, previous, opt, edges)
            if pending is not None:
                yield (*pending, fast[1])
            pending = (index / opt["sample_rate"], current, fast)
        previous = current
    if pending is not None:
        yield (*pending, 0.0)


def _regions(counts, pixels, opt):
    """Connected components on the grid; adjacent mouth cells count as one."""
    active = counts > max(1, pixels * opt["region_changed"] / 3)
    seen = np.zeros_like(active, dtype=bool)
    regions = 0
    for yy, xx in zip(*np.nonzero(active)):
        if seen[yy, xx]:
            continue
        todo, mass = [(yy, xx)], 0
        seen[yy, xx] = True
        while todo:
            y, x = todo.pop()
            mass += int(counts[y, x])
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < active.shape[0] and 0 <= nx < active.shape[1] and active[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    todo.append((ny, nx))
        if mass >= pixels * opt["region_changed"]:
            regions += 1
    return regions


def _is_cut(fast, previous_energy, next_energy, opt):
    changed, energy, spread = fast
    return (changed > opt["cut_changed"] and energy >= opt["cut_energy"]
            and spread >= opt["cut_spread"]
            and energy >= opt["cut_ratio"] * max(previous_energy, next_energy, .001))


def _state(row, opt):
    # Immediately recognize a genuinely held pair, even when the lag still
    # contains a preceding pose/pop. Camera drift does not take this shortcut.
    held = row["changed"] < opt["static_changed"] and row["energy"] <= opt["static_energy"]
    content = row["content"] >= opt["content_changed"]
    lag_content = not held and row["lag_content"] >= opt["content_changed"]
    if content or lag_content:
        acting = ((content and (row["content"] >= opt["acting_changed"] or row["regions"] >= 2))
                  or (lag_content and (row["lag_content"] >= opt["acting_changed"] or row["lag_regions"] >= 2)))
        return "acting" if acting else "local"
    return "drift" if max(row["camera"], row["lag_camera"]) >= opt["camera_threshold"] else "frozen"


def _window(start, end):
    return dict(start=round(start, 6), end=round(end, 6), duration=round(end - start, 6),
                start_timestamp=timestamp(start), end_timestamp=timestamp(end))


class _Runs:
    def __init__(self):
        self.starts = dict.fromkeys(("frozen", "stale", "quiet"))
        self.runs = {k: [] for k in self.starts}

    def add(self, start, state):
        active = dict(frozen=state == "frozen", stale=state in ("frozen", "drift"),
                      quiet=state in ("frozen", "drift", "local"))
        for kind in self.starts:
            if active[kind] and self.starts[kind] is None:
                self.starts[kind] = start
            if not active[kind]:
                self.close(kind, start)

    def close(self, kind, end):
        start = self.starts[kind]
        if start is not None:
            if end > start + 1e-9:
                self.runs[kind].append(_window(start, end))
            self.starts[kind] = None

    def finish(self, end):
        for kind in self.starts:
            self.close(kind, end)


def _run_distribution(runs, duration):
    lengths = [r["duration"] for r in runs]
    q = np.percentile(lengths, [50, 90, 95, 99, 100]) if lengths else [0.] * 5
    counts = {str(t): sum(v >= t - 1e-6 for v in lengths) for t in (1, 1.5, 2, 3, 5)}
    return dict(count=len(lengths), **{k: round(float(v), 6) for k, v in zip(("p50", "p90", "p95", "p99", "max"), q)},
                counts_ge_seconds=counts, runs_ge_2s_per_minute=round(counts["2"] * 60 / duration, 6) if duration else 0.)


HISTOGRAMS = ("changed", "spread", "lag_changed", "lag_spread", "content", "content_spread", "lag_content", "lag_content_spread")


class _Stats:
    def __init__(self, opt):
        self.opt = opt
        self.seconds = dict.fromkeys(STATES, 0.)
        self.hist = {k: np.zeros(10001) for k in HISTOGRAMS}
        self.runs = _Runs()
        self.last_end = None
        self.camera_sum = 0.
        self.camera_max = 0.

    def add(self, row, start=None, end=None):
        start = row["start"] if start is None else start
        end = row["end"] if end is None else end
        dt = end - start
        if dt <= 1e-9:
            return
        if self.last_end is not None and start > self.last_end + 1e-5:
            self.runs.finish(self.last_end)
        self.last_end = end
        state = row["state"]
        self.seconds[state] += dt
        for key, hist in self.hist.items():
            hist[min(10000, max(0, round(row[key] * 10000)))] += dt
        self.camera_sum += row["camera"] * dt
        self.camera_max = max(self.camera_max, row["camera"])
        self.runs.add(start, state)

    @staticmethod
    def quantiles(hist):
        total = hist.sum()
        if not total:
            return dict.fromkeys(("p10", "median", "p90"), None)
        cum = np.cumsum(hist)
        return {key: round(float(np.searchsorted(cum, total * q)) / 10000, 6)
                for key, q in (("p10", .1), ("median", .5), ("p90", .9))}

    def result(self):
        self.runs.finish(self.last_end or 0.)
        total = sum(self.seconds.values())
        runs = self.runs.runs
        quantiles = {k: self.quantiles(v) for k, v in self.hist.items()}
        def burstiness(key):
            q = quantiles[key]
            # A zero median is common for stepped animation. Undefined is
            # informative; replacing it with epsilon invents a huge ratio.
            return round(q['p90'] / q['median'], 6) if q['median'] else None
        return dict(
            measured_seconds=round(total, 6),
            seconds={k: round(v, 6) for k, v in self.seconds.items()},
            percent={k: round(v / total * 100, 3) if total else 0. for k, v in self.seconds.items()},
            percent_stale=round((self.seconds["frozen"] + self.seconds["drift"]) / total * 100, 3) if total else 0.,
            **quantiles,
            burstiness=dict(content_p90_over_median=burstiness('content'), changed_p90_over_median=burstiness('changed'),
                            note='null means zero/absent median; content is camera-compensated, changed is raw adjacent motion'),
            camera=dict(mean=round(self.camera_sum / total, 6) if total else 0., max=round(self.camera_max, 6), units="pixels at sampled width per sample"),
            longest_static_run=max((r["duration"] for r in runs["frozen"]), default=0.),
            longest_stale_run=max((r["duration"] for r in runs["stale"]), default=0.),
            longest_quiet_run=max((r["duration"] for r in runs["quiet"]), default=0.),
            stale_run_distribution=_run_distribution(runs["stale"], total),
            quiet_run_distribution=_run_distribution(runs["quiet"], total),
            frozen_runs=[r for r in runs["frozen"] if r["duration"] >= .5 - 1e-6],
            stale_runs=[r for r in runs["stale"] if r["duration"] >= .5 - 1e-6],
            quiet_runs=[r for r in runs["quiet"] if r["duration"] >= 1.5 - 1e-6],
            static_runs_ge_1s=sum(r["duration"] >= 1 - 1e-6 for r in runs["frozen"]),
            runs=runs,
        )


def _ranges(ranges, duration):
    merged = []
    for a, b in sorted(ranges or []):
        if not math.isfinite(a) or not math.isfinite(b) or a < 0 or b <= a:
            raise ValueError("Exclusions need finite 0 <= start < end")
        a, b = min(a, duration), min(b, duration)
        if b <= a:
            continue
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return merged


def _parts(start, end, excluded):
    for a, b in excluded:
        if b <= start:
            continue
        if a >= end:
            break
        if a > start:
            yield start, min(a, end)
        start = max(start, b)
        if start >= end:
            return
    if end > start:
        yield start, end


def _distribution(values):
    q = np.percentile(values, [50, 90, 95, 99, 100]) if len(values) else [0.] * 5
    return dict(count=len(values), **{k: round(float(v), 6) for k, v in zip(('p50', 'p90', 'p95', 'p99', 'max'), q)})


def _detect_events(rows, shots, opt, excluded=()):
    """Detect bursts once per shot, independent of state/acting thresholds.

    Only scalar rows are retained, never images. A shot's continuous baseline
    is 1.5 * adjacent-content q75 + .003. At least 40% of the local half-second
    content change must occur in one sample: a burst, rather than accumulated
    slow travel. This stops a slow float crest looking like a pop; q75
    rejects a continually flickering mouth even when its lag aliases to zero.
    One-sample impulses are deliberate: a five-frame/60Hz pop is only 83ms.
    No temporal smoothing may erase it. Cuts cannot reset the film gap clock.
    """
    if not rows:
        return []
    starts, ends, content, lag, zoom, cuts = (np.asarray([r[k] for r in rows]) for k in
                                            ('start', 'end', 'content', 'lag_content', 'camera_zoom', 'cut'))
    events = []
    for shot in shots:
        for a, b in _parts(shot['start'], shot['end'], excluded):
            # Every pair must belong entirely to this shot, with a two-frame
            # boundary guard. This also rejects cuts missed by the image test.
            ids = np.flatnonzero((starts >= a + opt['event_boundary_seconds'] - 1e-6)
                                 & (ends <= b - opt['event_boundary_seconds'] + 1e-6) & ~cuts)
            if not len(ids):
                continue
            baseline = float(np.quantile(content[ids], .75))
            envelope = float(np.median(lag[ids]))
            threshold = opt['event_floor'] + opt['event_baseline_factor'] * baseline
            groups = []
            for j in ids:
                if content[j] < threshold:
                    continue
                if not groups or starts[j] - ends[groups[-1][-1]] >= opt['event_gap'] - 1e-6:
                    groups.append([])
                groups[-1].append(j)
            last_event = -math.inf
            for group in groups:
                # Score the burst's evidence, not only its first faint frame.
                # This catches a short entrance easing up to its peak.
                candidates = [j for j in group if content[j] >= opt['event_lag_factor'] * lag[j]]
                if not candidates:
                    continue
                j = candidates[0]
                t = starts[j]
                # Camera registration is deliberately conservative during very
                # fast zooms. Do not reward its residual as a content event.
                lo = np.searchsorted(starts, t - .3)
                hi = np.searchsorted(starts, t + .3, side='right')
                rapid_camera = np.any(np.abs(np.log(np.maximum(zoom[lo:hi], 1e-9))) > opt['event_camera_zoom'])
                if not rapid_camera and t - last_event > opt['event_refractory'] + 1e-6:
                    events.append(dict(t=round(float(t), 6), content=round(float(content[j]), 8),
                                       kind='burst',
                                       baseline_q75=round(baseline, 8), lag_baseline_median=round(envelope, 8),
                                       threshold=round(threshold, 8)))
                    last_event = t
            # A token starting a continuous journey is an event even if it
            # subsequently becomes the shot's baseline. Require an actual
            # quiet lead-in and sustained travel (low variation, accumulating
            # lag displacement), not a noisy/flapping start. Never credit the
            # first sampled frame merely for already being in motion.
            for j in ids:
                t = starts[j]
                if content[j] < opt['content_changed'] or t < a + opt['event_onset_quiet']:
                    continue
                lead = ids[(starts[ids] >= t - opt['event_onset_quiet'] - 1e-6) & (starts[ids] < t - 1e-6)]
                if (len(lead) < opt['sample_rate'] * opt['event_onset_quiet'] - 1
                        or np.max(content[lead], initial=0.) >= opt['content_changed']):
                    continue
                travel = ids[(starts[ids] >= t) & (starts[ids] < t + .5)]
                v = content[travel]
                if (len(travel) < opt['sample_rate'] * .5 - 1 or np.mean(v >= opt['event_floor'] / 3) < .8
                        or np.std(v) > .6 * np.mean(v) or np.median(lag[travel]) < max(2 * opt['event_floor'], 2 * np.median(v))):
                    continue
                if any(abs(t - e['t']) < opt['event_refractory'] + .5 for e in events):
                    continue
                if np.any(np.abs(np.log(np.maximum(zoom[travel], 1e-9))) > opt['event_camera_zoom']):
                    continue
                events.append(dict(t=round(float(t), 6), kind='travel-onset', content=round(float(content[j]), 8),
                                   baseline_q75=round(baseline, 8), lag_baseline_median=round(envelope, 8),
                                   threshold=round(threshold, 8)))
    return sorted(events, key=lambda e: e['t'])


def _event_stats(events, spans, measured_seconds):
    """Edge-inclusive gaps for gates; separate inter-event percentiles for study."""
    selected, gaps, inter = [], [], []
    for a, b in spans:
        ev = [e for e in events if a <= e['t'] < b]
        selected.extend(ev)
        times = [e['t'] for e in ev]
        points = [a, *times, b]
        gaps.extend(_window(x, y) for x, y in zip(points, points[1:]) if y > x + 1e-7)
        inter.extend(y - x for x, y in zip(times, times[1:]))
    counts = Counter(int(e['t'] // 10) for e in selected)
    bins = []
    for k in range(math.ceil(max((b for _, b in spans), default=0.) / 10)):
        dt = sum(max(0., min(b, (k + 1) * 10) - max(a, k * 10)) for a, b in spans)
        if dt > 1e-6:
            bins.append(dict(start=k * 10, end=(k + 1) * 10, measured_seconds=round(dt, 6),
                             count=counts[k], per_10s=round(counts[k] * 10 / dt, 6)))
    return dict(count=len(selected), per_10s=round(len(selected) * 10 / measured_seconds, 6) if measured_seconds else 0.,
                onsets=[e['t'] for e in selected], bursts=selected, bins=bins,
                per_10s_distribution=_distribution([v['per_10s'] for v in bins]),
                inter_event_gap_distribution=_distribution(inter), gap_windows=gaps,
                longest_gap=max((w['duration'] for w in gaps), default=0.))


class _Collector:
    def __init__(self, opt, duration, exclude_ranges=None, shot_ranges=None):
        self.opt, self.duration = opt, duration
        self.excluded = _ranges(exclude_ranges, duration or 1e30)
        self.all = _Stats(opt)
        self.included = _Stats(opt)
        self.shot = _Stats(opt)
        self.shot_start, self.shots, self.cuts = 0., [], []
        self.event_rows = []
        self.authored = []
        for i, sh in enumerate(shot_ranges or []):
            a = float(sh["start"])
            b = float(sh["end"]) if "end" in sh else a + float(sh["dur"])
            if a < 0 or not math.isfinite(a + b) or b <= a:
                raise ValueError("Authored shots need finite 0 <= start < end")
            self.authored.append((dict(id=sh.get("id", "shot"), name=sh.get("name", sh.get("id", "shot")),
                                       index=sh.get("index", i + 1), kind=sh.get("kind", "unknown"), start=a, end=b), _Stats(opt), _Stats(opt)))

    def add(self, row):
        a, b = row["start"], row["end"]
        self.event_rows.append(dict(start=a, end=b, content=row['content'], lag_content=row['lag_content'],
                                    camera_zoom=row['camera_zoom'], cut=row['state'] == 'cut'))
        self.all.add(row)
        self.shot.add(row)
        for x, y in _parts(a, b, self.excluded):
            self.included.add(row, x, y)
        for sh, stats, included in self.authored:
            x, y = max(a, sh["start"]), min(b, sh["end"])
            if y > x:
                stats.add(row, x, y)
                for u, v in _parts(x, y, self.excluded):
                    included.add(row, u, v)
        if row["state"] == "cut":
            self.cuts.append(dict(t=row["t"], changed=row["changed"], energy=row["energy"]))
            self.shots.append(dict(start=self.shot_start, end=b, **self.shot.result()))
            self.shot_start, self.shot = b, _Stats(self.opt)

    def result(self, end):
        if end > self.shot_start:
            self.shots.append(dict(start=self.shot_start, end=end, **self.shot.result()))
        result = dict(**self.all.result(), cuts=self.cuts, shots=self.shots,
                    excluded_ranges=[_window(a, b) for a, b in self.excluded],
                    included=self.included.result(),
                    authored_shots=[dict(**sh, duration=sh["end"]-sh["start"], **stats.result()) for sh, stats, _ in self.authored],
                    filtered_shots=[dict(**sh, duration=sh["end"]-sh["start"], **stats.result()) for sh, _, stats in self.authored])
        # A container's audio/timeline can outlast its actual picture. Never
        # invent event-free picture beyond the decoded end, or report shots
        # that were not in this clip. Final QA checks truncation separately.
        for key in ('authored_shots', 'filtered_shots'):
            result[key] = [s for s in result[key] if s['start'] < end - 1e-7]
            for s in result[key]:
                if s['end'] > end:
                    s['timeline_end'] = s['end']
                    s['end'] = end
                    s['duration'] = end - s['start']
        shots = result['authored_shots'] or result['shots']
        events = _detect_events(self.event_rows, shots, self.opt)
        filtered = _detect_events(self.event_rows, shots, self.opt, self.excluded) if self.excluded else events
        result['events'] = _event_stats(events, [(0., end)], result['measured_seconds'])
        result['included']['events'] = _event_stats(filtered, list(_parts(0., end, self.excluded)), result['included']['measured_seconds'])
        for key in ('shots', 'authored_shots', 'filtered_shots'):
            for shot in result[key]:
                spans = list(_parts(shot['start'], shot['end'], self.excluded)) if key == 'filtered_shots' else [(shot['start'], shot['end'])]
                shot['events'] = _event_stats(filtered if key == 'filtered_shots' else events, spans, shot['measured_seconds'])
        return result


class _Timeline:
    def __init__(self, duration, bins=1280):
        self.duration = max(duration or 60., 1.)
        self.values = np.zeros((bins, 3))
        self.states = np.zeros((bins, len(STATES)))

    def add(self, row):
        a, b = row["start"], row["end"]
        while b > self.duration + 1e-6:
            n = len(self.values)
            self.values[:n // 2] = self.values.reshape(-1, 2, 3).max(axis=1)
            self.states[:n // 2] = self.states.reshape(-1, 2, len(STATES)).sum(axis=1)
            self.values[n // 2:] = 0
            self.states[n // 2:] = 0
            self.duration *= 2
        n = len(self.values)
        x, y = min(n - 1, int(a / self.duration * n)), min(n - 1, math.ceil(b / self.duration * n) - 1)
        self.values[x:y + 1] = np.maximum(self.values[x:y + 1], [row["content"], row["lag_content"], row["camera"]])
        for k in range(x, y + 1):
            self.states[k, STATES.index(row["state"])] += max(0., min(b, (k + 1) / n * self.duration) - max(a, k / n * self.duration))

    def save(self, path, summary):
        left, width = 78, len(self.values)
        im = Image.new("RGB", (width + left + 30, 650), "#faf9f5")
        d = ImageDraw.Draw(im)
        d.text((left, 12), f"Content motion: {Path(summary['path']).name}", fill="#20242c")
        d.text((left, 32), "  ".join(f"{s}: {summary['percent'][s]:.1f}%" for s in STATES), fill="#20242c")
        panels = [(70, 225, 0, .0001, 1., "Content / valid pixels", "%"),
                  (335, 125, 2, .01, 10., "Camera RMS pixels/sample (sampled width)", "px")]
        for top, height, channel, lo, hi, title, unit in panels:
            def yy(v):
                return top + height * (1 - min(1, max(0, math.log(max(v, lo) / lo) / math.log(hi / lo))))
            d.text((left, top - 18), title, fill="#303640")
            for run in summary["stale_runs"]:
                x0, x1 = (left + run[k] / self.duration * width for k in ("start", "end"))
                d.rectangle((x0, top, x1, top + height), fill="#f5dada")
            for a in summary.get("excluded_ranges", []):
                x0, x1 = (left + a[k] / self.duration * width for k in ("start", "end"))
                d.rectangle((x0, top, x1, top + height), fill="#d6d6d6")
            ticks = (.0001, .001, .01, .1, 1) if channel == 0 else (.01, .1, 1, 10)
            for v in ticks:
                y = yy(v)
                d.line((left, y, left + width, y), fill="#d7d9dc")
                d.text((4, y - 5), f"{v * 100:g}%" if unit == "%" else f"{v:g}px", fill="#4a4e56")
            traces = [(1, "#df9654"), (0, "#245f9a")] if channel == 0 else [(2, "#8061aa")]
            for column, color in traces:
                d.line([(left + k, yy(v)) for k, v in enumerate(self.values[:, column])], fill=color)
        colors = ("#c74753", "#db8d43", "#e4bf55", "#3caa88", "#8b78b1")
        for k in range(width):
            if self.states[k].sum():
                d.line((left + k, 480, left + k, 497), fill=colors[int(self.states[k].argmax())])
        for t in summary['events']['onsets']:
            x = left + t / self.duration * width
            d.line((x, 70, x, 295), fill='#9c3574')
            d.polygon([(x - 3, 465), (x + 3, 465), (x, 474)], fill='#9c3574')
        offset = summary.get('time_offset_seconds', 0.)
        for k in range(9):
            d.text((left + k / 8 * width - 25, 510), timestamp(offset + self.duration * k / 8)[:-4], fill="#4a4e56")
        d.text((left, 536), "Blue adjacent content | Orange lag content | Purple camera | Red shade stale >=0.5s | Gray excluded", fill="#303640")
        d.text((left, 551), "State strip: red frozen / orange drift / yellow local / green acting / purple cut. Log axes; bin maxima.", fill="#303640")
        for i, shot in enumerate(summary.get('authored_shots', [])):
            x = left + shot['start'] / self.duration * width
            d.line((x, 475, x, 503), fill='#303640')
            d.text((x + 2, 578 + (i % 2) * 16), str(shot.get('index', i + 1)), fill='#303640')
        d.text((left, 564), "Authored shot indexes (see per-shot table); timecodes include excerpt offset.", fill='#303640')
        d.text((left, 620), f"Magenta = content events (cuts excluded): {summary['events']['count']}; "
               f"{summary['events']['per_10s']:.2f}/10s; longest event-free gap {summary['events']['longest_gap']:.2f}s.", fill='#9c3574')
        _parent(path)
        im.save(path)


def _parent(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)


CSV_FIELDS = ("t", "changed", "energy", "spread", "state", "lag_changed", "lag_energy", "lag_spread", "lag_seconds",
              "start", "end", "content", "content_energy", "content_spread", "regions", "lag_content", "lag_content_energy",
              "lag_content_spread", "lag_regions", "camera", "lag_camera", "camera_dx", "camera_dy", "camera_zoom", "camera_rotation",
              "valid_fraction", "raw_content", "raw_lag_content", "planar_removed", "lag_planar_removed", "phase_rejected_content")


def _validate(opt):
    for name, value in opt.items():
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            raise ValueError(f"{name} must be a finite nonnegative number")
    for name in ("width", "box", "grid_cols", "grid_rows"):
        if opt[name] < 1 or int(opt[name]) != opt[name]:
            raise ValueError(f"{name} must be a positive integer")
    if opt["width"] < 64 or opt["width"] % 2:
        raise ValueError("width must be an even integer >=64")
    if opt["sample_rate"] <= 0 or opt["lag_seconds"] <= 0:
        raise ValueError("sample_rate and lag_seconds must be positive")
    for name in ("static_changed", "cell_changed", "cut_changed", "cut_spread", "content_changed", "acting_changed", "region_changed", "content_cell"):
        if not 0 <= opt[name] <= 1:
            raise ValueError(f"{name} must be a fraction in [0, 1]")
    if not 0 < opt["content_changed"] <= opt["acting_changed"]:
        raise ValueError("Require 0 < content_changed <= acting_changed")
    if opt["cut_ratio"] < 1 or max(opt["pixel_threshold"], opt["content_pixel"], opt["cut_energy"], opt["static_energy"]) > 255:
        raise ValueError("cut_ratio must be >=1; pixel/energy thresholds use 0..255 gray levels")


def measure(path, *, csv_path=None, png_path=None, ffmpeg="ffmpeg", exclude_ranges=None, shot_ranges=None, time_offset=0., **options):
    """Stream decoded images; return full, included and per-shot content stats.

    No files are written unless paths are provided. All thresholds are in
    DEFAULTS. Exclusions are explicit (start,end) seconds and never automatic.
    Decode/configuration errors raise, rather than quietly passing a QA gate.
    """
    unknown = options.keys() - DEFAULTS.keys()
    if unknown:
        raise TypeError("Unknown measurement options: " + ", ".join(sorted(unknown)))
    opt = {**DEFAULTS, **options}
    _validate(opt)
    if not math.isfinite(time_offset) or time_offset < 0:
        raise ValueError('time_offset must be finite and nonnegative')
    path = Path(path).resolve()
    if not path.is_file():
        raise FileNotFoundError(path)
    outputs = [Path(p).resolve() for p in (csv_path, png_path) if p]
    if path in outputs or len(set(outputs)) != len(outputs):
        raise ValueError("Input and output paths must be distinct")
    started = time.perf_counter()
    width, height, duration = _probe(path, opt["width"], ffmpeg)
    h, w = height // opt["box"], width // opt["box"]
    if h < max(32, opt["grid_rows"]) or w < max(32, opt["grid_cols"]):
        raise ValueError("Analysis frame too small; increase width or reduce box/grid")
    ys, xs = np.linspace(0, h, opt["grid_rows"] + 1, dtype=int), np.linspace(0, w, opt["grid_cols"] + 1, dtype=int)
    edges = ys[:-1], xs[:-1], np.diff(ys)[:, None] * np.diff(xs)[None, :]
    rate = opt["sample_rate"]
    lag_steps = max(1, round(opt["lag_seconds"] * rate))
    ring = deque(maxlen=lag_steps + 1)
    engine, cumulative = _Camera((h, w)), np.eye(3)
    collect = _Collector(opt, duration, exclude_ranges, shot_ranges)
    timeline = _Timeline(duration) if png_path else None
    previous_energy, last_t, count = 0., 0., 0
    pending, phase_returns = deque(), 0

    with ExitStack() as stack:
        writer = None
        if csv_path:
            _parent(csv_path)
            writer = csv.DictWriter(stack.enter_context(open(csv_path, "w", newline="", encoding="utf-8")), fieldnames=CSV_FIELDS)
            writer.writeheader()

        def emit(row):
            collect.add(row)
            if timeline:
                timeline.add(row)
            if writer:
                writer.writerow({k: round(v, 8) if isinstance(v, (float, np.floating)) else v for k, v in row.items()})

        frames = _frames(path, width, height, rate, ffmpeg)
        stack.callback(frames.close)
        samples = _samples(frames, opt, edges)
        stack.callback(samples.close)
        for t, a, fast, next_energy in samples:
            image = _Image(a)
            if ring:
                bt, baseline, bc = ring[max(0, len(ring) - lag_steps)]
                lag = _diff(a, baseline.a, opt, edges)
                is_cut = _is_cut(fast, previous_energy, next_energy, opt)
                if is_cut:
                    cumulative = np.eye(3)
                    matrix = np.eye(3)
                    residual = dict(content=0., content_energy=0., content_spread=0., regions=0, camera=0., valid_fraction=1.,
                                    raw_content=0., planar_removed=0.)
                    lag_residual = residual
                else:
                    previous = ring[-1][1]
                    matrix = np.eye(3) if fast[1] <= opt["static_energy"] else engine.fit(image, previous, quick=fast[1] < 8.)
                    cumulative = cumulative @ matrix
                    residual = engine.evidence(image, previous, matrix, opt, edges)
                    residual["regions"] = _regions(residual["counts"], h * w * residual["valid_fraction"], opt)
                    lag_matrix = np.linalg.solve(bc, cumulative)
                    lag_residual = engine.evidence(image, baseline, lag_matrix, opt, edges)
                    # A single lag pair can alternate with the raster's phase
                    # while adjacent pairs show no action at all. Require the
                    # same spatial evidence against full- and two-thirds-lag
                    # baselines. The shorter span also bounds post-action tails.
                    # Both masks live in current-frame coordinates. This keeps
                    # real slow travel/new ink, including a single-cell actor;
                    # no blanket size cutoff, state smoothing or hold exemption.
                    base_index = max(0, len(ring) - max(1, lag_steps * 2 // 3))
                    if base_index > max(0, len(ring) - lag_steps):
                        _, neighbor, nc = ring[base_index]
                        corroborating = engine.evidence(image, neighbor, np.linalg.solve(nc, cumulative), opt, edges)
                        lag_residual['mask'] &= _dilate(corroborating['mask'])
                    _set_mask(lag_residual, lag_residual['mask'], opt, edges)
                p = engine.parameters(matrix, (h, w))
                row = dict(t=t, start=last_t, end=t, changed=fast[0], energy=fast[1], spread=fast[2],
                           lag_changed=lag[0], lag_energy=lag[1], lag_spread=lag[2], lag_seconds=t - bt,
                           content=residual["content"], content_energy=residual["content_energy"], content_spread=residual["content_spread"], regions=residual["regions"],
                           lag_content=lag_residual["content"], lag_content_energy=lag_residual["content_energy"], lag_content_spread=lag_residual["content_spread"], lag_regions=lag_residual["regions"],
                           camera=residual["camera"] * opt["box"], lag_camera=lag_residual["camera"] * opt["box"],
                           camera_dx=-float(p[0]) * opt["box"], camera_dy=-float(p[1]) * opt["box"],
                           camera_zoom=1 / math.hypot(matrix[0, 0], matrix[1, 0]), camera_rotation=-math.degrees(math.atan2(matrix[1, 0], matrix[0, 0])),
                           valid_fraction=residual["valid_fraction"], raw_content=residual['raw_content'],
                           raw_lag_content=lag_residual['raw_content'], planar_removed=residual['planar_removed'],
                           lag_planar_removed=lag_residual['planar_removed'], phase_rejected_content=0.)
                row["state"] = "cut" if is_cut else _state(row, opt)
                # A weak local residual which repeatedly returns to the SAME
                # camera-aligned pixels two samples later, with no accumulating
                # lag evidence, is raster phase/flicker rather than travel or
                # new ink. Wait for three consecutive returns before rejecting
                # the cycle; isolated one-frame blinks/pops survive unchanged.
                weak = (not is_cut and opt['content_changed'] <= row['content'] < opt['acting_changed']
                        and row['regions'] <= 1
                        and (row['lag_content'] < opt['content_changed'] or len(ring) < lag_steps))
                returns = False
                if weak and len(ring) >= 2:
                    _, two_back, tc = ring[-2]
                    cycle = engine.residual(image, two_back, np.linalg.solve(tc, cumulative), opt, edges)
                    returns = cycle['content'] < opt['content_changed']
                phase_returns = phase_returns + 1 if returns else 0
                pending.append(row)
                if phase_returns >= 3:
                    for r in list(pending)[-4:]:
                        if (r['state'] != 'cut' and r['content'] < opt['acting_changed'] and r['regions'] <= 1
                                and (r['lag_content'] < opt['content_changed'] or r['lag_seconds'] < lag_steps / rate)):
                            r['phase_rejected_content'] = max(r['phase_rejected_content'], r['content'])
                            r.update(content=0., content_spread=0., regions=0,
                                     lag_content=0., lag_content_spread=0., lag_regions=0)
                            r['state'] = _state(r, opt)
                # Four scalar rows suffice for retrospective confirmation. No
                # image smoothing and no extra video-sized buffers are used.
                if len(pending) > 4:
                    emit(pending.popleft())
                count += 1
                if is_cut:
                    ring.clear()
                previous_energy = fast[1]
            ring.append((t, image, cumulative.copy()))
            last_t = t
        single_frame = not pending
        if single_frame:
            if not ring:
                raise ValueError("No sampled video frames could be decoded")
            # A sub-sample clip has no pair proving motion. Conservatively mark
            # its entire duration frozen, rather than crashing or claiming life.
            row = dict.fromkeys(CSV_FIELDS, 0.)
            row.update(state="frozen", camera_zoom=1., valid_fraction=1.)
            pending.append(row)
        decoded_duration = last_t + 1 / rate
        end = duration if duration and abs(duration - decoded_duration) <= 1.5 / rate else decoded_duration
        end = max(last_t, end)
        pending[-1]["end"] = end
        for row in pending:
            emit(row)

    summary = dict(version=DETECTOR_VERSION, event_detector_version=DETECTOR_VERSION,
                   detector_source_sha256=DETECTOR_SOURCE_SHA256,
                   path=str(path), duration=round(end, 6), source_duration=duration,
                   sample_rate=rate, samples=count, sampled_frame_size=[width, height], analysis_frame_size=[w, h],
                   thresholds=opt, actual_lag_seconds=lag_steps / rate,
                   corroborating_lag_seconds=max(1, lag_steps * 2 // 3) / rate, timing_uncertainty_seconds=1 / rate,
                   single_sample=single_frame,
                   time_offset_seconds=time_offset,
                   quantile_changed_resolution=.0001, **collect.result(end), elapsed_seconds=round(time.perf_counter() - started, 3))
    if timeline:
        timeline.save(png_path, summary)
    return summary


def summarize_csv(csv_path, *, metadata=None, exclude_ranges=None, shot_ranges=None, png_path=None):
    """Reaggregate v4 CSV without decoding; old scalars lack spatial evidence.

    V2/v3 inputs MUST be redecoded: scalar cell spreads cannot distinguish an
    interpolation halo from a genuine small clock/pen. Never relabel an old CSV
    as if it had passed the new spatial checks.
    """
    meta = dict(metadata or {})
    if meta.get('version') != DETECTOR_VERSION:
        raise ValueError('Detector v4 needs spatial/multi-baseline evidence; redecode v2/v3 video instead of replaying old scalars')
    if meta.get('detector_source_sha256') != DETECTOR_SOURCE_SHA256:
        raise ValueError('CSV detector source differs; redecode with the current detector before reaggregation')
    opt = {**DEFAULTS, **{k: v for k, v in meta.get("thresholds", {}).items()
                        if meta.get('event_detector_version') == DETECTOR_VERSION or not k.startswith('event_')}}
    if shot_ranges is None:
        shot_ranges = meta.get("authored_shots", [])
    if exclude_ranges is None:
        exclude_ranges = [(r["start"], r["end"]) for r in meta.get("excluded_ranges", [])]
    collect = _Collector(opt, meta.get("duration"), exclude_ranges, shot_ranges)
    timeline = _Timeline(meta.get('duration')) if png_path else None
    count, end = 0, 0.
    with open(csv_path, newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            row = {k: v if k == "state" else float(v) for k, v in row.items()}
            collect.add(row)
            if timeline: timeline.add(row)
            end = row["end"]
            count += 1
    if not count:
        raise ValueError("CSV contains no measurements")
    meta.update(collect.result(end))
    meta.update(version=DETECTOR_VERSION, event_detector_version=DETECTOR_VERSION,
                duration=round(end, 6), samples=count, thresholds=opt)
    if timeline: timeline.save(png_path, meta)
    return meta


def violations(summary, max_static=None, max_low=None, *, max_stale=None, max_quiet=None, included=False):
    """Windows longer than the limits, with timestamps. None disables a limit.

    Legacy max_static checks frozen; legacy max_low checks quiet. New callers
    should use max_stale / max_quiet, which include camera-only holds.
    """
    source = summary["included"] if included else summary
    found = []
    for kind, limit in (("frozen", max_static), ("quiet", max_low), ("stale", max_stale), ("quiet", max_quiet)):
        if limit is None:
            continue
        if not math.isfinite(limit) or limit < 0:
            raise ValueError("Run limits must be finite and nonnegative")
        for run in source["runs"][kind]:
            if run["duration"] > limit + 1e-6:
                found.append(dict(kind=kind, **run, limit=limit))
    return sorted(found, key=lambda r: (r["start"], r["kind"]))


def gate_limits(**overrides):
    """Validate explicit policy overrides before spending time on a render."""
    unknown = overrides.keys() - GATE_DEFAULTS.keys()
    if unknown:
        raise TypeError("Unknown gate limits: " + ", ".join(sorted(unknown)))
    limits = {**GATE_DEFAULTS, **{k: v for k, v in overrides.items() if v is not None}}
    for key, value in limits.items():
        if not math.isfinite(value) or value < 0 or (key.endswith("percent") and value > 100):
            raise ValueError(f"Invalid motion limit {key}: {value}")
    return limits


def gate(summary, *, time_offset=0., **overrides):
    """Evaluate the delivery policy on ALL measured time (never exclusions).

    Pure JSON-safe API: returns passed/limits/failures/windows/warnings/per_shot.
    time_offset maps a draft excerpt back to authored film time. Run durations
    are tested before display rounding; percentage checks use seconds, too.
    """
    limits = gate_limits(**overrides)
    if not math.isfinite(time_offset) or time_offset < 0:
        raise ValueError("time_offset must be finite and nonnegative")
    total = summary["measured_seconds"]
    if total <= 0:
        raise ValueError("No measured time; motion QA cannot pass")
    stale_percent = (summary["seconds"]["frozen"] + summary["seconds"]["drift"]) / total * 100
    acting_percent = summary["seconds"]["acting"] / total * 100
    shots = summary.get("authored_shots") or [dict(id=f"detected-shot-{i + 1}", index=i + 1, **s)
                                               for i, s in enumerate(summary.get("shots", []))]

    def window(a, b):
        w = _window(a + time_offset, b + time_offset)
        # Film timecodes deliberately use minutes, including minutes >=60.
        for key in ("start", "end"):
            ms = round(w[key] * 1000)
            minutes, rem = divmod(ms, 60000)
            seconds, millis = divmod(rem, 1000)
            w[key + "_timestamp"] = f"{minutes:02d}:{seconds:02d}.{millis:03d}"
        return w

    def shot_refs(a, b):
        return [dict(index=s.get("index", i + 1), id=s["id"], name=s.get("name", s["id"]),
                     **window(max(a, s["start"]), min(b, s["end"])))
                for i, s in enumerate(shots) if min(b, s["end"]) > max(a, s["start"]) + 1e-7]

    failures, windows = [], []
    frozen = summary["runs"]["frozen"]
    for run in summary["runs"]["stale"]:
        a, b = run["start"], run["end"]
        freeze = [r for r in frozen if r["start"] >= a - 1e-6 and r["end"] <= b + 1e-6]
        too_frozen = [r for r in freeze if r["duration"] > limits["max_frozen_run"] + 1e-6]
        too_stale = run["duration"] > limits["max_stale_run"] + 1e-6
        if not too_stale and not too_frozen:
            continue
        # One stale window subsumes any nested frozen defects. Exact frozen
        # subwindows remain available, but no duplicate legacy freeze warning.
        spans = [(a, b)] if too_stale else [(r["start"], r["end"]) for r in too_frozen]
        for x, y in spans:
            frozen_seconds = sum(max(0., min(y, r["end"]) - max(x, r["start"])) for r in freeze)
            state = "frozen" if abs(frozen_seconds - (y - x)) < 1e-5 else "frozen+drift" if frozen_seconds > 1e-6 else "drift"
            checks = (["stale_run"] if too_stale else []) + (["frozen_run"] if too_frozen else [])
            windows.append(dict(**window(x, y), state=state, failed_checks=checks, shots=shot_refs(x, y),
                                frozen_windows=[window(r["start"], r["end"]) for r in too_frozen
                                                if r["end"] > x and r["start"] < y]))
    if any("stale_run" in w["failed_checks"] for w in windows):
        failures.append(f"Stale run exceeds {limits['max_stale_run']:g}s.")
    if any("frozen_run" in w["failed_checks"] for w in windows):
        failures.append(f"Fully frozen run exceeds {limits['max_frozen_run']:g}s.")
    if stale_percent > limits["max_stale_percent"] + 1e-6:
        failures.append(f"Stale time {stale_percent:.2f}% exceeds {limits['max_stale_percent']:g}%.")
    if acting_percent < limits["min_acting_percent"] - 1e-6:
        failures.append(f"Acting time {acting_percent:.2f}% is below {limits['min_acting_percent']:g}%.")
    # Aggregate stale failures can be made entirely of short runs. Expose those
    # windows too, without repeating a run/frozen defect already listed above.
    if stale_percent > limits['max_stale_percent'] + 1e-6:
        for run in summary['runs']['stale']:
            a, b = run['start'], run['end']
            frozen_seconds = sum(max(0., min(b, r['end']) - max(a, r['start'])) for r in frozen)
            state = 'frozen' if abs(frozen_seconds - (b - a)) < 1e-5 else 'frozen+drift' if frozen_seconds > 1e-6 else 'drift'
            if not any(w['start'] <= a + time_offset + 1e-6 and w['end'] >= b + time_offset - 1e-6 for w in windows):
                # A short stale span with a nested frozen defect is represented
                # once, with its aggregate cause and exact frozen subwindow.
                nested = [w for w in windows if w['start'] >= a + time_offset - 1e-6 and w['end'] <= b + time_offset + 1e-6]
                windows = [w for w in windows if w not in nested]
                windows.append(dict(**window(a, b), state=state, failed_checks=['stale_share'] + (['frozen_run'] if nested else []),
                                    shots=shot_refs(a, b), frozen_windows=[f for w in nested for f in w['frozen_windows']]))
        windows.sort(key=lambda w: w['start'])
    if acting_percent < limits['min_acting_percent'] - 1e-6:
        stale_spans = [(r['start'], r['end']) for r in summary['runs']['stale']]
        for run in summary['runs']['quiet']:
            for a, b in _parts(run['start'], run['end'], stale_spans):
                windows.append(dict(**window(a, b), state='local', failed_checks=['acting_share'], shots=shot_refs(a, b), frozen_windows=[]))
        windows.sort(key=lambda w: w['start'])
    events = summary['events']
    event_rate_ok = events['count'] * 10 / total >= limits['min_events_per_10s'] - 1e-6
    if not event_rate_ok:
        failures.append(f"Content event rate {events['per_10s']:.2f}/10s is below {limits['min_events_per_10s']:g}/10s.")
    event_gaps = [w for w in events['gap_windows'] if w['duration'] > limits['max_event_gap'] + 1e-6]
    if event_gaps:
        failures.append(f"Content event gap exceeds {limits['max_event_gap']:g}s (cuts do not reset the clock).")
        for w in event_gaps:
            windows.append(dict(**window(w['start'], w['end']), state='event-free', failed_checks=['event_gap'],
                                shots=shot_refs(w['start'], w['end']), frozen_windows=[]))
    per_shot, warnings = [], []
    for i, s in enumerate(shots):
        row = dict(index=s.get("index", i + 1), id=s["id"], name=s.get("name", s["id"]),
                   **window(s["start"], s["end"]), measured_seconds=s["measured_seconds"],
                   percent_stale=round((s['seconds']['frozen'] + s['seconds']['drift']) / s['measured_seconds'] * 100, 6) if s['measured_seconds'] else 0.,
                   percent_acting=round(s['seconds']['acting'] / s['measured_seconds'] * 100, 6) if s['measured_seconds'] else 0.,
                   longest_stale_run=s["longest_stale_run"], event_count=s['events']['count'],
                   longest_event_gap=s['events']['longest_gap'],
                   needs_event=s['end'] - s['start'] >= EVENT_REQUIRED_SHOT_SECONDS - 1e-6)
        per_shot.append(row)
        if row['needs_event'] and not row['event_count']:
            existing = next((w for w in windows if w['state'] == 'event-free' and
                             abs(w['start'] - row['start']) < 1e-6 and abs(w['end'] - row['end']) < 1e-6), None)
            if existing:
                existing['failed_checks'].append('no_event_shot')
            else:
                windows.append(dict(**window(s['start'], s['end']), state='event-free', failed_checks=['no_event_shot'],
                                    shots=shot_refs(s['start'], s['end']), frozen_windows=[]))
        if row["duration"] >= WARN_SHOT_MIN_SECONDS and row["percent_stale"] > WARN_SHOT_STALE_PERCENT:
            warnings.append(dict(**row, message=f"Shot >= {WARN_SHOT_MIN_SECONDS:g}s is > {WARN_SHOT_STALE_PERCENT:g}% stale."))
    empty_shots = sum(s['needs_event'] and not s['event_count'] for s in per_shot)
    if empty_shots:
        failures.append(f"{empty_shots} shot(s) >= {EVENT_REQUIRED_SHOT_SECONDS:g}s contain no content event.")
    windows.sort(key=lambda w: (w['start'], w['end']))
    per_shot.sort(key=lambda s: (not (s['needs_event'] and not s['event_count']), -s['longest_event_gap'],
                                 -s["percent_stale"], -s["longest_stale_run"], s["index"]))
    rules = dict(stale_share=stale_percent <= limits['max_stale_percent'] + 1e-6,
                 stale_run=summary['longest_stale_run'] <= limits['max_stale_run'] + 1e-6,
                 frozen_run=summary['longest_static_run'] <= limits['max_frozen_run'] + 1e-6,
                 acting_share=acting_percent >= limits['min_acting_percent'] - 1e-6,
                 event_rate=event_rate_ok, event_gap=not event_gaps, shot_events=not empty_shots)
    return dict(passed=not failures, limits=limits, failures=failures, windows=windows, warnings=warnings,
                rules=rules, events_per_10s=events['per_10s'], longest_event_gap=events['longest_gap'],
                shots_without_events=empty_shots, event_required_shot_seconds=EVENT_REQUIRED_SHOT_SECONDS,
                warning_limits=dict(min_shot_seconds=WARN_SHOT_MIN_SECONDS, stale_percent=WARN_SHOT_STALE_PERCENT),
                per_shot=per_shot, percent_stale=round(stale_percent, 6), percent_acting=round(acting_percent, 6),
                time_offset=time_offset, hint=MOTION_HINT, event_hint=EVENT_HINT)


def print_gate(result, *, stream=None):
    """Compact diagnostics shared by delivery QA, preflight and this CLI."""
    stream = stream or sys.stdout
    def say(text): print(text, file=stream)
    def refs(shots): return ", ".join(f"#{s['index']} {s['name']}" for s in shots) or "unmapped shot"
    say(f"Motion {'PASS' if result['passed'] else 'FAIL'}: {result['percent_stale']:.2f}% stale; {result['percent_acting']:.2f}% acting; "
        f"{result['events_per_10s']:.2f} events/10s; max event gap {result['longest_event_gap']:.3f}s.")
    for msg in result['failures']: say("FAIL " + msg)
    for w in result['windows']:
        say(f"FAIL {w['start_timestamp']}–{w['end_timestamp']}  {w['duration']:.3f}s  {w['state']}  [{refs(w['shots'])}] ({', '.join(w['failed_checks'])})")
        if w['state'] == 'event-free': say('     Hint: ' + result['event_hint'])
        for f in w['frozen_windows']:
            if abs(f['duration'] - w['duration']) > 1e-6:
                say(f"     frozen within: {f['start_timestamp']}–{f['end_timestamp']}  {f['duration']:.3f}s")
    if any(not result['rules'][k] for k in ('stale_run', 'frozen_run', 'stale_share', 'acting_share')):
        say("Hint: " + result['hint'])
    if any(not result['rules'][k] for k in ('event_rate', 'event_gap', 'shot_events')):
        say("Hint: " + result['event_hint'])
    for s in result['warnings']:
        say(f"WARN #{s['index']} {s['name']} {s['start_timestamp']}–{s['end_timestamp']}: {s['percent_stale']:.1f}% stale ({s['duration']:.3f}s shot)")
    say("Shot (worst first: event-less, longest gap, stale) | duration | % stale | % acting | longest stale | events | longest event gap")
    for s in result['per_shot']:
        say(f"#{s['index']} {s['name']} | {s['duration']:.3f}s | {s['percent_stale']:.2f}% | {s['percent_acting']:.2f}% | "
            f"{s['longest_stale_run']:.3f}s | {s['event_count']} | {s['longest_event_gap']:.3f}s")


def add_gate_arguments(parser):
    group = parser.add_argument_group("motion policy (explicit overrides only; no intentional-hold exemptions)")
    for key, default in GATE_DEFAULTS.items():
        unit = 'events per 10 seconds' if key.endswith('per_10s') else 'percent' if key.endswith('percent') else 'seconds'
        group.add_argument('--motion-' + key.replace('_', '-'), dest='motion_' + key, type=float,
                           help=f"{unit}; default {default:g}")


def gate_options(args):
    return {key: getattr(args, 'motion_' + key) for key in GATE_DEFAULTS if getattr(args, 'motion_' + key) is not None}


def self_test(ffmpeg="ffmpeg", out=None):
    """Encode deterministic controls, then exercise the real decoding/fit path."""
    if out is None:
        with tempfile.TemporaryDirectory(prefix="ink-motion-") as temp:
            return self_test(ffmpeg, Path(temp))
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    w, h, fps, seconds = 480, 240, 12, 3
    yy, xx = np.mgrid[:h, :w]
    # Distinct fixed texture in every grid region anchors robust registration.
    base = (135 + 22 * np.sin(xx / 7.) + 20 * np.cos(yy / 9.) + 13 * np.sin((xx + yy) / 13.)).astype(np.uint8)
    results = []
    for expected in ("frozen", "drift", "local", "acting"):
        file = out / (expected + '.mp4')
        cmd = [ffmpeg, '-v', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'gray', '-video_size', f'{w}x{h}',
               '-framerate', str(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-threads', '2', '-crf', '17', '-pix_fmt', 'yuv420p', str(file)]
        frames = []
        for f in range(fps * seconds):
            a = np.roll(base, f // 2, axis=1).copy() if expected == 'drift' else base.copy()
            if expected in ('local', 'acting'):
                x = 85 + round(7 * math.sin(f * .5))
                a[65:77, x:x + 12] = 245
            if expected == 'acting':
                x = 340 + round(7 * math.sin(f * .43))
                a[171:183, x:x + 12] = 30
            frames.append(a.tobytes())
        subprocess.run(cmd, input=b''.join(frames), check=True, stdout=subprocess.DEVNULL)
        summary = measure(file, ffmpeg=ffmpeg, csv_path=out / (expected + '.csv'), png_path=out / (expected + '.png'))
        dominant = max(STATES, key=lambda s: summary['seconds'][s])
        passed = dominant == expected and summary['percent'][expected] >= 85
        results.append(dict(expected=expected, dominant=dominant, percent=summary['percent'], passed=passed))
        print(f"{'PASS' if passed else 'FAIL'} control {expected}: " + ', '.join(f"{s} {summary['percent'][s]:.1f}%" for s in STATES))
    # Exercise the actual encoded/decoded camera path, not handcrafted scores.
    # The transient control is five source frames long: it must survive 12Hz
    # sampling at all five possible 60Hz phases, and its return is not a second
    # event. Repeated high-duty flicker and sinusoidal travel are counterexamples.
    event_controls = [('steady-bob', 0), ('talking-flicker', 0), ('cuts-only', 0), ('token-start', 1), ('pop-ins', 4),
                      *[(f'five-frame-pops-{phase}', 4) for phase in range(5)]]
    for name, expected_count in event_controls:
        source_fps, seconds = 60, 8
        file = out / (name + '.mp4')
        cmd = [ffmpeg, '-v', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'gray', '-video_size', f'{w}x{h}',
               '-framerate', str(source_fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-threads', '2',
               '-crf', '17', '-pix_fmt', 'yuv420p', str(file)]
        # Stream controls instead of allocating seconds of 60Hz raw images.
        with tempfile.TemporaryFile() as errors:
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors)
            try:
                for frame in range(source_fps * seconds):
                    a = base.copy()
                    if name == 'steady-bob':
                        y = 85 + round(12 * math.sin(frame / source_fps * math.tau / 2.))
                        a[y:y + 65, 170:260] = 240
                        a[y + 12:y + 42, 185:240] = 25
                    elif name == 'talking-flicker':
                        # A visible face with a 12Hz stepped, cycling open mouth.
                        a[35:195, 155:310] = 235
                        a[75:88, 185:198] = a[75:88, 270:283] = 20
                        size = (2, 14, 7, 23, 4, 18)[frame // 5 % 6]
                        a[140:140 + size, 200:265] = 15
                    elif name == 'token-start':
                        x = 50 + round(40 * min(4., max(0., frame / source_fps - 2.)))
                        a[90:130, x:x + 40] = 240
                        a[98:120, x + 8:x + 29] = 25
                    elif name == 'cuts-only':
                        if frame // 60 % 2: a = 255 - base
                    else:
                        phase = int(name.rsplit('-', 1)[1]) if name.startswith('five-') else 0
                        for k, at in enumerate((60, 150, 240, 330)):
                            age = frame - at - phase
                            if age >= 0 and (name == 'pop-ins' or age < 5):
                                x = 45 + k * 100
                                a[80:135, x:x + 40] = 240
                                a[91:116, x + 8:x + 29] = 25
                    proc.stdin.write(a.tobytes())
                proc.stdin.close()
                if proc.wait():
                    errors.seek(0)
                    raise RuntimeError(errors.read().decode('utf-8', errors='replace'))
            finally:
                if proc.poll() is None: proc.terminate()
                proc.wait()
        summary = measure(file, ffmpeg=ffmpeg, csv_path=out / (name + '.csv'), png_path=out / (name + '.png'))
        count = summary['events']['count']
        passed = count == expected_count
        results.append(dict(control=name, expected_events=expected_count, actual_events=count,
                            onsets=summary['events']['onsets'], gate=gate(summary)['rules'], passed=passed))
        print(f"{'PASS' if passed else 'FAIL'} control {name}: {count} events (expected {expected_count})")
    result = dict(passed=all(r['passed'] for r in results), controls=results,
                  detector_version=DETECTOR_VERSION, detector_source_sha256=DETECTOR_SOURCE_SHA256)
    (out / 'self-test.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video", type=Path, nargs="?")
    parser.add_argument("--self-test", action="store_true", help="Verify motion states, bob/flicker rejection and pop detection at five 60Hz phases; no video needed")
    parser.add_argument("--self-test-out", type=Path, help="Keep control videos, CSVs, PNGs and self-test.json here (otherwise temporary)")
    parser.add_argument("--gate", action="store_true", help="Apply all delivery motion limits to the entire video; --exclude is forbidden")
    parser.add_argument("--csv", dest="csv_path", type=Path)
    parser.add_argument("--json", dest="json_path", type=Path)
    parser.add_argument("--png", dest="png_path", type=Path)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--exclude", nargs=2, type=float, action="append", dest="exclude_ranges", metavar=("START", "END"))
    parser.add_argument("--shots", type=Path, help="JSON list of authored id/kind/start/end shot ranges")
    for kind in ("stale", "quiet", "static", "low"):
        parser.add_argument(f"--fail-{kind}-run", type=float, metavar="SECONDS")
    for name, default in DEFAULTS.items():
        parser.add_argument("--" + name.replace("_", "-"), type=type(default), default=default, help=f"default: {default}")
    add_gate_arguments(parser)
    parsed = parser.parse_args(argv)
    overrides = gate_options(parsed)
    args = vars(parsed)
    for key in GATE_DEFAULTS: args.pop('motion_' + key)
    test, test_out, use_gate = args.pop('self_test'), args.pop('self_test_out'), args.pop('gate')
    path, json_path, shots_path = args.pop("video"), args.pop("json_path"), args.pop("shots")
    limits = {"max_" + k: args.pop("fail_" + k + "_run") for k in ("stale", "quiet", "static", "low")}
    try:
        if test:
            return 0 if self_test(args['ffmpeg'], test_out)['passed'] else 1
        if path is None:
            parser.error("provide a video, or use --self-test")
        if overrides and not use_gate:
            parser.error("--motion-* overrides require --gate")
        if use_gate and args.get('exclude_ranges'):
            parser.error("--gate measures the entire clip; no exclusion/hold exemptions")
        if use_gate: gate_limits(**overrides)
        outputs = [p.resolve() for p in (json_path, args["csv_path"], args["png_path"]) if p]
        if path.resolve() in outputs or len(set(outputs)) != len(outputs):
            raise ValueError("Input and output paths must be distinct")
        for limit in limits.values():
            if limit is not None and (not math.isfinite(limit) or limit < 0):
                raise ValueError("Run limits must be finite and nonnegative")
        if shots_path:
            shots = json.loads(shots_path.read_text(encoding="utf-8-sig"))
            args["shot_ranges"] = shots["shots"] if isinstance(shots, dict) else shots
        summary = measure(path, **args)
        failures = violations(summary, **limits, included=bool(args.get("exclude_ranges")))
        if use_gate:
            summary['qa'] = gate(summary, **overrides)
            print_gate(summary['qa'], stream=sys.stderr)
        elif any(v is not None for v in limits.values()):
            summary["qa"] = dict(passed=not failures, limits=limits, included_only=bool(args.get("exclude_ranges")), violations=failures)
        payload = json.dumps(summary, indent=2, allow_nan=False) + "\n"
        if json_path:
            _parent(json_path)
            json_path.write_text(payload, encoding="utf-8")
        else:
            print(payload, end="")
        print(f"Measured {summary['duration']:.2f}s in {summary['elapsed_seconds']:.2f}s: " +
              ", ".join(f"{s} {summary['percent'][s]:.1f}%" for s in STATES), file=sys.stderr)
        for row in failures:
            print(f"FAIL {row['kind']} {row['start_timestamp']} - {row['end_timestamp']} "
                  f"({row['duration']:.3f}s > {row['limit']:g}s)", file=sys.stderr)
        return 1 if failures or (use_gate and not summary['qa']['passed']) else 0
    except (OSError, ValueError, RuntimeError, KeyError, subprocess.CalledProcessError) as exc:
        print(f"liveness: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())


