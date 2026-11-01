"""One episode per process; load model once, retain its voice across all lines."""
import json
import os
import random
import sys
from pathlib import Path


def main():
    import numpy as np
    import soundfile as sf
    import torch
    import pyloudnorm as pyln
    import perth
    if not callable(perth.PerthImplicitWatermarker):
        raise RuntimeError("The voice runtime is missing its watermark dependency. Repair it by installing setuptools==80.9.0 in the voice runtime.")

    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    language = request["language"]
    device = request["device"]
    if device == "auto":
        # Leave headroom for rendering on small GPUs. CPU is slow but predictable.
        device = "cuda" if torch.cuda.is_available() and torch.cuda.get_device_properties(0).total_memory >= 6 * 1024**3 else "cpu"
    torch.set_num_threads(min(8, os.cpu_count() or 4))
    if language == "en":
        from chatterbox.tts import ChatterboxTTS
        model_type = ChatterboxTTS
    else:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS, SUPPORTED_LANGUAGES
        if language not in SUPPORTED_LANGUAGES:
            raise ValueError(f"Chatterbox does not support language {language}")
        model_type = ChatterboxMultilingualTTS
    print(f"Loading {model_type.__name__} on {device}", flush=True)
    # Synthesis is strictly offline. Only the explicit model-download action may fetch weights.
    model_dir = request.get("modelDir")
    if not model_dir or not (Path(model_dir) / "ready.json").is_file():
        raise RuntimeError("Download this narration model in Settings > Voice & narration first.")
    model = model_type.from_local(model_dir, device=device)
    default_conds = model.conds
    rate = float(request.get("rate", 1))
    if not 0.7 <= rate <= 1.4:
        raise ValueError("Narration speed must be between 0.7 and 1.4")
    for index, line in enumerate(request["lines"]):
        seed = line.get("seed", request["seed"] + index)
        random.seed(seed)
        np.random.seed(seed)
        torch.manual_seed(seed)
        # Reset between performances so an emotional reference cannot leak into the next line.
        model.conds = default_conds
        reference = line.get("reference") or request.get("reference")
        if reference and not Path(reference).is_file():
            raise FileNotFoundError(f"Voice reference not found: {reference}")
        kwargs = {key: line[key] for key in ("exaggeration", "cfg_weight", "temperature")}
        if language != "en":
            kwargs["language_id"] = language
        print(f"Speaking line {index + 1}/{len(request['lines'])}: {line['emotion']}", flush=True)
        with torch.inference_mode():
            wav = model.generate(line["text"], audio_prompt_path=reference, **kwargs)
        samples = wav.detach().cpu().numpy().reshape(-1)
        if not np.isfinite(samples).all() or len(samples) < model.sr // 10:
            raise ValueError(f"Invalid or empty neural audio at line {index + 1}")
        # Remove excess model padding, retaining 60 ms for consonants and natural breath.
        voiced = np.flatnonzero(np.abs(samples) > 0.004)
        if not len(voiced):
            raise ValueError(f"Silent neural audio at line {index + 1}")
        pad = int(model.sr * 0.06)
        samples = samples[max(0, voiced[0] - pad):min(len(samples), voiced[-1] + pad + 1)]
        if rate != 1:
            import librosa
            samples = librosa.effects.time_stretch(samples, rate=rate)
        # Gentle gain-only leveling preserves the performance's internal dynamics.
        if len(samples) > model.sr * 0.4:
            loudness = pyln.Meter(model.sr).integrated_loudness(samples)
            if np.isfinite(loudness):
                gain = min(10 ** ((-16 - loudness) / 20), 10 ** (12 / 20))
                peak = max(float(np.max(np.abs(samples))), 1e-6)
                samples = samples * min(gain, 0.89 / peak)
        sf.write(line["file"], samples, model.sr, subtype="PCM_16")


if __name__ == "__main__":
    main()
