"""Measurement tools for the learn pipeline: numbers read off the video, not impressions.

  python measure.py video  <video> <out.json>                  per-frame cut scores, camera motion and actor motion
  python measure.py audio  <wav> <out.json> [--model small] [--language xx]
                                                               words with timings, loudness envelope, voice pitch
  python measure.py sheets <plan.json>                         tile sheets, charts and palettes the agents look at
  python measure.py selftest                                   checks the camera estimator on synthetic moves

Runs in .venv-learn (pnpm learn:setup): numpy, opencv-python-headless, faster-whisper.
"""
import argparse
import json
import math
import sys
import wave

import cv2
import numpy as np

ANALYSIS_WIDTH = 360  # camera and actor motion are measured on frames this wide
CUT_WIDTH = 72  # cut scores use tiny frames, like PySceneDetect's content detector

FEATURES = dict(maxCorners=400, qualityLevel=0.01, minDistance=7, blockSize=7)
LK = dict(winSize=(21, 21), maxLevel=3, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01))


def even(value):
    return max(2, int(round(value / 2)) * 2)


def open_video(path):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise SystemExit(f"cannot open video {path}")
    return cap


# ---------- camera ----------


def estimate_camera(prev, cur, window):
    """Dominant image motion between two grey frames as a similarity transform: zoom, rotation and the pan of the frame
    centre. Then how much is left once that move is undone, which is the actors' own motion."""
    h, w = prev.shape
    matrix, method, tracked, inliers, residuals = None, "phase", 0, 0, None
    points = cv2.goodFeaturesToTrack(prev, mask=None, **FEATURES)
    if points is not None and len(points) >= 12:
        moved, status, _ = cv2.calcOpticalFlowPyrLK(prev, cur, points, None, **LK)
        back, status_back, _ = cv2.calcOpticalFlowPyrLK(cur, prev, moved, None, **LK)
        forward_backward = np.linalg.norm((points - back).reshape(-1, 2), axis=1)
        good = (status.ravel() == 1) & (status_back.ravel() == 1) & (forward_backward < 0.8)
        p0, p1 = points.reshape(-1, 2)[good], moved.reshape(-1, 2)[good]
        tracked = int(len(p0))
        if tracked >= 10:
            matrix, mask = cv2.estimateAffinePartial2D(
                p0, p1, method=cv2.RANSAC, ransacReprojThreshold=1.0, maxIters=2000, confidence=0.995, refineIters=10
            )
            if matrix is not None:
                method = "flow"
                inliers = int(mask.ravel().sum())
                predicted = p0 @ matrix[:, :2].T + matrix[:, 2]
                residuals = np.linalg.norm(p1 - predicted, axis=1)
    if matrix is None:
        # Too few corners (flat colour): translation only.
        (dx, dy), _ = cv2.phaseCorrelate(prev.astype(np.float32), cur.astype(np.float32), window)
        matrix = np.array([[1.0, 0.0, dx], [0.0, 1.0, dy]])

    scale = math.hypot(matrix[0, 0], matrix[1, 0])
    rotation = math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))
    cx, cy = w / 2, h / 2
    nx = matrix[0, 0] * cx + matrix[0, 1] * cy + matrix[0, 2]
    ny = matrix[1, 0] * cx + matrix[1, 1] * cy + matrix[1, 2]

    warped = cv2.warpAffine(prev, matrix, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    margin = max(4, int(0.06 * w))  # edges revealed by the move are not motion
    diff = cv2.absdiff(cur[margin:-margin, margin:-margin], warped[margin:-margin, margin:-margin])
    return {
        "zoom": scale,
        "rot": rotation,
        # Image content motion as a fraction of the frame (the camera moves the other way).
        "dx": (nx - cx) / w,
        "dy": (ny - cy) / h,
        "method": method,
        "tracked": tracked,
        "inliers": inliers,
        "residual": float(diff.mean()),
        "active": float((diff > 12).mean()),
        "res50": float(np.percentile(residuals, 50)) if residuals is not None and len(residuals) else 0.0,
        "res90": float(np.percentile(residuals, 90)) if residuals is not None and len(residuals) else 0.0,
    }


def tiny_hsv(frame):
    h, w = frame.shape[:2]
    small = cv2.resize(frame, (CUT_WIDTH, even(CUT_WIDTH * h / w)), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(small, cv2.COLOR_BGR2HSV)


def hs_histogram(hsv):
    hist = cv2.calcHist([hsv], [0, 1], None, [32, 16], [0, 180, 0, 256])
    return cv2.normalize(hist, hist).flatten()


def measure_video(path, out):
    cap = open_video(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    aw, ah = ANALYSIS_WIDTH, even(ANALYSIS_WIDTH * height / width)
    window = cv2.createHanningWindow((aw, ah), cv2.CV_32F)
    to_source = width / aw

    keys = ["cut", "hist", "zoom", "rot", "dx", "dy", "tracked", "inliers", "residual", "active", "res50", "res90", "luma", "sat", "warm", "flow"]
    series = {key: [] for key in keys}
    prev_grey = prev_hsv = prev_hist = None
    first_hsv = last_hsv = None
    index = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        small = cv2.resize(frame, (aw, ah), interpolation=cv2.INTER_AREA)
        grey = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        hsv = tiny_hsv(frame)
        hist = hs_histogram(hsv)
        if first_hsv is None:
            first_hsv = hsv
        last_hsv = hsv

        if prev_grey is None:
            camera = {"zoom": 1.0, "rot": 0.0, "dx": 0.0, "dy": 0.0, "method": "none", "tracked": 0, "inliers": 0,
                      "residual": 0.0, "active": 0.0, "res50": 0.0, "res90": 0.0}
            cut, hist_distance = 0.0, 0.0
        else:
            camera = estimate_camera(prev_grey, grey, window)
            # Mean absolute change of hue, saturation and value (0–255), PySceneDetect's content score.
            cut = float(np.abs(hsv.astype(np.float32) - prev_hsv.astype(np.float32)).mean())
            hist_distance = float(1.0 - cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL))

        b, g, r = (float(c) for c in small.reshape(-1, 3).mean(axis=0))
        values = {
            "cut": cut,
            "hist": hist_distance,
            "zoom": camera["zoom"],
            "rot": camera["rot"],
            "dx": camera["dx"],
            "dy": camera["dy"],
            "tracked": camera["tracked"],
            "inliers": camera["inliers"],
            "residual": camera["residual"],
            "active": camera["active"],
            "res50": camera["res50"] * to_source,
            "res90": camera["res90"] * to_source,
            "luma": float(grey.mean()),
            "sat": float(hsv[..., 1].mean()),
            "warm": (r - b),
            "flow": 1 if camera["method"] == "flow" else 0,
        }
        for key in keys:
            series[key].append(round(values[key], 6))
        prev_grey, prev_hsv, prev_hist = grey, hsv, hist
        index += 1
        if index % 300 == 0:
            print(f"video: {index} frames", file=sys.stderr, flush=True)

    loop = {
        "histCorrel": float(cv2.compareHist(hs_histogram(first_hsv), hs_histogram(last_hsv), cv2.HISTCMP_CORREL)) if index else 0.0,
        "meanDiff": float(np.abs(first_hsv.astype(np.float32) - last_hsv.astype(np.float32)).mean()) if index else 0.0,
    }
    result = {
        "tool": "measure.py video v1",
        "fps": fps,
        "width": width,
        "height": height,
        "frames": index,
        "analysisWidth": aw,
        "series": series,
        "loop": loop,
    }
    with open(out, "w", encoding="utf8") as handle:
        json.dump(result, handle, separators=(",", ":"))


# ---------- audio ----------


def read_wav(path):
    with wave.open(path, "rb") as handle:
        rate, channels, width = handle.getframerate(), handle.getnchannels(), handle.getsampwidth()
        raw = handle.readframes(handle.getnframes())
    if width != 2:
        raise SystemExit("expected 16-bit PCM wav")
    samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples, rate


def frames_of(samples, size, hop):
    if len(samples) < size:
        samples = np.pad(samples, (0, size - len(samples)))
    count = 1 + (len(samples) - size) // hop
    strides = (samples.strides[0] * hop, samples.strides[0])
    return np.lib.stride_tricks.as_strided(samples, shape=(count, size), strides=strides)


def levels_db(samples, rate, hop_seconds=0.05):
    hop = int(rate * hop_seconds)
    frames = frames_of(samples, hop, hop)
    rms = np.sqrt((frames.astype(np.float64) ** 2).mean(axis=1))
    return [round(float(v), 2) for v in 20 * np.log10(np.maximum(rms, 1e-6))]


def pitch_hz(samples, rate, hop_seconds=0.02, window_seconds=0.04, low=70.0, high=400.0):
    """Voice pitch per hop by normalised autocorrelation; 0 where unvoiced or quiet."""
    size, hop = int(rate * window_seconds), int(rate * hop_seconds)
    frames = frames_of(samples, size, hop).astype(np.float64)
    frames = frames - frames.mean(axis=1, keepdims=True)
    energy = np.sqrt((frames ** 2).mean(axis=1))
    n = 1 << (2 * size - 1).bit_length()
    spectrum = np.fft.rfft(frames * np.hanning(size), n=n, axis=1)
    auto = np.fft.irfft(np.abs(spectrum) ** 2, n=n, axis=1)[:, :size]
    auto = auto / np.maximum(auto[:, :1], 1e-12)
    lo, hi = int(rate / high), min(int(rate / low), size - 2)
    lags = np.argmax(auto[:, lo:hi], axis=1) + lo
    peaks = auto[np.arange(len(lags)), lags]
    out = []
    for row, (lag, peak, level) in enumerate(zip(lags, peaks, energy)):
        if peak < 0.45 or level < 10 ** (-45 / 20):
            out.append(0.0)
            continue
        # Parabolic interpolation around the peak for a sub-sample lag.
        a, b, c = auto[row, lag - 1], auto[row, lag], auto[row, lag + 1]
        shift = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0.0
        out.append(round(rate / (lag + float(np.clip(shift, -0.5, 0.5))), 1))
    return out


def measure_audio(path, out, model_name, language):
    from faster_whisper import WhisperModel

    print(f"audio: loading whisper {model_name}", file=sys.stderr, flush=True)
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        path, word_timestamps=True, language=language or None, beam_size=5, vad_filter=False, condition_on_previous_text=False
    )
    words, lines = [], []
    for segment in segments:
        lines.append({"start": round(segment.start, 3), "end": round(segment.end, 3), "text": segment.text.strip()})
        for word in segment.words or []:
            text = word.word.strip()
            if text:
                words.append({"w": text, "start": round(word.start, 3), "end": round(word.end, 3), "p": round(word.probability, 3)})
    samples, rate = read_wav(path)
    result = {
        "tool": "measure.py audio v1",
        "model": model_name,
        "language": info.language,
        "languageProbability": round(info.language_probability, 3),
        "duration": round(len(samples) / rate, 3),
        "words": words,
        "segments": lines,
        "levels": {"hop": 0.05, "db": levels_db(samples, rate)},
        "pitch": {"hop": 0.02, "hz": pitch_hz(samples, rate)},
    }
    with open(out, "w", encoding="utf8") as handle:
        json.dump(result, handle, ensure_ascii=False, separators=(",", ":"))


# ---------- sheets ----------

INK = (32, 24, 20)
PAPER = (240, 238, 234)
MARK = (40, 40, 220)  # red, BGR
FONT = cv2.FONT_HERSHEY_SIMPLEX


def ascii_text(text):
    return "".join(ch if 32 <= ord(ch) < 127 else "?" for ch in text)


def fit_text(text, max_width, scale):
    text = ascii_text(text)
    while text and cv2.getTextSize(text, FONT, scale, 1)[0][0] > max_width:
        text = text[:-2] + "~" if len(text) > 2 else ""
    return text


def read_frames(path, wanted):
    """Frames by index, read in order (seeking is not frame-accurate for every codec)."""
    wanted = sorted(set(wanted))
    found = {}
    if not wanted:
        return found
    cap = open_video(path)
    index, target = 0, 0
    while target < len(wanted):
        ok = cap.grab()
        if not ok:
            break
        if index == wanted[target]:
            ok, frame = cap.retrieve()
            if ok:
                found[index] = frame
            target += 1
        index += 1
    return found


def render_tile(frame, tile, width):
    h, w = frame.shape[:2]
    height = even(width * h / w)
    image = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
    label_h = 40 if "caption" in tile else 22  # same height for every captioned tile, even a silent one
    canvas = np.full((height + label_h, width, 3), PAPER, dtype=np.uint8)
    canvas[label_h:, :] = image
    colour = MARK if tile.get("mark") else INK
    cv2.putText(canvas, fit_text(tile.get("label", ""), width - 6, 0.45), (4, 16), FONT, 0.45, colour, 1, cv2.LINE_AA)
    if tile.get("caption"):
        cv2.putText(canvas, fit_text(tile["caption"], width - 6, 0.42), (4, 34), FONT, 0.42, MARK if tile.get("mark") else (90, 90, 90), 1, cv2.LINE_AA)
    if tile.get("mark"):
        cv2.rectangle(canvas, (0, label_h), (width - 1, height + label_h - 1), MARK, 3)
    return canvas


def render_sheet(sheet, frames, out_dir):
    cols, width = sheet["cols"], sheet["tileWidth"]
    tiles = [render_tile(frames[t["frame"]], t, width) for t in sheet["tiles"] if t["frame"] in frames]
    if not tiles:
        return None
    tile_h = max(t.shape[0] for t in tiles)
    rows = math.ceil(len(tiles) / cols)
    gap, title_h = 6, 34
    canvas = np.full((title_h + rows * (tile_h + gap), cols * (width + gap) + gap, 3), PAPER, dtype=np.uint8)
    cv2.putText(canvas, fit_text(sheet.get("title", ""), canvas.shape[1] - 12, 0.6), (8, 23), FONT, 0.6, INK, 1, cv2.LINE_AA)
    for i, tile in enumerate(tiles):
        r, c = divmod(i, cols)
        y, x = title_h + r * (tile_h + gap), gap + c * (width + gap)
        canvas[y : y + tile.shape[0], x : x + width] = tile
    path = f"{out_dir}/{sheet['name']}.png"
    cv2.imwrite(path, canvas)
    return path


def palette(frame, k=5):
    small = cv2.resize(frame, (64, even(64 * frame.shape[0] / frame.shape[1])), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5)
    _, labels, centres = cv2.kmeans(lab, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(labels.ravel(), minlength=k)
    bgr = cv2.cvtColor(centres.reshape(1, -1, 3).astype(np.uint8), cv2.COLOR_LAB2BGR).reshape(-1, 3)
    order = np.argsort(-counts)
    return [
        {"hex": "#%02x%02x%02x" % (int(bgr[i][2]), int(bgr[i][1]), int(bgr[i][0])), "share": round(float(counts[i]) / len(labels), 3)}
        for i in order
    ]


def render_chart(chart, out_dir):
    width, height = chart["width"], chart["height"]
    panels = chart["panels"]
    canvas = np.full((height, width, 3), PAPER, dtype=np.uint8)
    title_h, left, right, gap = 34, 150, 16, 18
    cv2.putText(canvas, fit_text(chart.get("title", ""), width - 16, 0.6), (8, 23), FONT, 0.6, INK, 1, cv2.LINE_AA)
    panel_h = (height - title_h - gap * len(panels)) // max(1, len(panels))
    duration = max(chart["duration"], 1e-3)
    plot_w = width - left - right

    def x_of(t):
        return int(left + plot_w * min(max(t / duration, 0.0), 1.0))

    for p, panel in enumerate(panels):
        top = title_h + p * (panel_h + gap)
        bottom = top + panel_h
        cv2.rectangle(canvas, (left, top), (left + plot_w, bottom), (210, 205, 200), 1)
        cv2.putText(canvas, fit_text(panel["label"], left - 6, 0.38), (4, top + 14), FONT, 0.38, INK, 1, cv2.LINE_AA)
        values = [v for s in panel["series"] for v in s["values"] if v is not None]
        top_value = max([abs(v) for v in values] + [panel.get("minScale", 1e-6)])
        signed = any(v < 0 for v in values)
        zero_y = (top + bottom) // 2 if signed else bottom - 2
        span = (panel_h / 2 - 4) if signed else (panel_h - 6)
        cv2.line(canvas, (left, zero_y), (left + plot_w, zero_y), (170, 165, 160), 1)
        cv2.putText(canvas, f"{top_value:.3g}", (4, top + 32), FONT, 0.36, (110, 110, 110), 1, cv2.LINE_AA)
        for t in chart.get("markers", []):
            cv2.line(canvas, (x_of(t), top), (x_of(t), bottom), (205, 195, 235), 1)
        for band in panel.get("bands", []):
            cv2.rectangle(canvas, (x_of(band[0]), bottom - 6), (x_of(band[1]), bottom - 2), (150, 190, 150), -1)
        for s in panel["series"]:
            colour = tuple(int(c) for c in reversed(s["color"]))
            hop = s["hop"]
            points = [
                (x_of(i * hop), int(zero_y - span * v / top_value))
                for i, v in enumerate(s["values"])
                if v is not None
            ]
            if len(points) > 1:
                cv2.polylines(canvas, [np.array(points, dtype=np.int32)], False, colour, 1, cv2.LINE_AA)
    for second in range(0, int(duration) + 1, 5 if duration > 20 else 1):
        cv2.putText(canvas, f"{second}s", (x_of(second) - 8, height - 4), FONT, 0.36, (110, 110, 110), 1, cv2.LINE_AA)
    path = f"{out_dir}/{chart['name']}.png"
    cv2.imwrite(path, canvas)
    return path


def make_sheets(plan_path):
    with open(plan_path, encoding="utf8") as handle:
        plan = json.load(handle)
    wanted = [t["frame"] for s in plan.get("sheets", []) for t in s["tiles"]] + [p["frame"] for p in plan.get("palettes", [])]
    frames = read_frames(plan["video"], wanted)
    written = [render_sheet(sheet, frames, plan["outDir"]) for sheet in plan.get("sheets", [])]
    written += [render_chart(chart, plan["outDir"]) for chart in plan.get("charts", [])]
    palettes = {p["key"]: palette(frames[p["frame"]]) for p in plan.get("palettes", []) if p["frame"] in frames}
    with open(f"{plan['outDir']}/palettes.json", "w", encoding="utf8") as handle:
        json.dump(palettes, handle)
    print(json.dumps({"written": [w for w in written if w]}))


# ---------- self test ----------


def selftest():
    rng = np.random.default_rng(7)
    h, w = 640, 360
    base = cv2.GaussianBlur((rng.random((h * 2, w * 2)) * 255).astype(np.uint8), (0, 0), 3)
    window = cv2.createHanningWindow((w, h), cv2.CV_32F)
    failures = []
    for zoom, dx, dy in [(1.0, 0.0, 0.0), (1.01, 0.0, 0.0), (1.0, 3.0, -2.0), (0.99, -1.5, 1.0)]:
        centre = (w, h)  # middle of the big texture
        move = cv2.getRotationMatrix2D(centre, 0, zoom)
        move[:, 2] += (dx, dy)
        prev = base[h // 2 : h // 2 + h, w // 2 : w // 2 + w]
        cur = cv2.warpAffine(base, move, (w * 2, h * 2))[h // 2 : h // 2 + h, w // 2 : w // 2 + w]
        got = estimate_camera(prev, cur, window)
        ok = abs(got["zoom"] - zoom) < 0.002 and abs(got["dx"] * w - dx) < 0.3 and abs(got["dy"] * h - dy) < 0.3
        if not ok:
            failures.append({"want": [zoom, dx, dy], "got": [got["zoom"], got["dx"] * w, got["dy"] * h]})
    print(json.dumps({"ok": not failures, "failures": failures}))
    sys.exit(0 if not failures else 1)


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    video = sub.add_parser("video")
    video.add_argument("video")
    video.add_argument("out")
    audio = sub.add_parser("audio")
    audio.add_argument("wav")
    audio.add_argument("out")
    audio.add_argument("--model", default="small")
    audio.add_argument("--language", default="")
    sheets = sub.add_parser("sheets")
    sheets.add_argument("plan")
    sub.add_parser("selftest")
    args = parser.parse_args()
    if args.command == "video":
        measure_video(args.video, args.out)
    elif args.command == "audio":
        measure_audio(args.wav, args.out, args.model, args.language)
    elif args.command == "sheets":
        make_sheets(args.plan)
    else:
        selftest()


if __name__ == "__main__":
    main()
