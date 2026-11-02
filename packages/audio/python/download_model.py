"""Explicit opt-in download. Never imported by narration or app startup."""
import json
import sys
import time
from pathlib import Path

REVISION = "5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18"
FILES = {
    "english": ["ve.safetensors", "t3_cfg.safetensors", "s3gen.safetensors", "tokenizer.json", "conds.pt"],
    "multilingual": ["ve.pt", "t3_mtl23ls_v2.safetensors", "s3gen.pt", "grapheme_mtl_merged_expanded_v1.json", "conds.pt", "Cangjie5_TC.json"],
}


def emit(**values):
    print(json.dumps(values), flush=True)


def main():
    from huggingface_hub import HfApi, hf_hub_download
    from tqdm.auto import tqdm

    model_id, directory = sys.argv[1:3]
    files = FILES[model_id]
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    emit(message="Checking model download size…", progress=0)
    info = HfApi().model_info("ResembleAI/chatterbox", revision=REVISION, files_metadata=True)
    available = {file.rfilename: file.size for file in info.siblings}
    expected = {file: available.get(file) for file in files}
    if any(not isinstance(size, int) or size <= 0 for size in expected.values()):
        raise RuntimeError("Could not determine the model download size. Please retry.")
    total_bytes = sum(expected.values())
    downloaded = {}
    for file in files:
        path = directory / file
        downloaded[file] = expected[file] if path.is_file() and path.stat().st_size == expected[file] else 0

    def report():
        count = sum(downloaded.values())
        emit(message=f"Downloading voice model ({index + 1} of {len(files)})",
             progress=count / total_bytes, downloadedBytes=count, totalBytes=total_bytes)

    class Progress(tqdm):
        def __init__(self, *args, **kwargs):
            self.byte_count = kwargs.get("initial", 0)
            self.last_report = time.monotonic()
            super().__init__(*args, **kwargs)
            downloaded[filename] = max(0, min(expected[filename], self.byte_count))
            report()

        def update(self, amount=1):
            result = super().update(amount)
            # Track independently of tqdm.n: disabled/non-terminal progress bars may not update it.
            # Negative updates correctly handle a server restarting a resumed transfer from zero.
            self.byte_count += amount
            downloaded[filename] = max(0, min(expected[filename], self.byte_count))
            now = time.monotonic()
            if now - self.last_report >= 0.25 or downloaded[filename] == expected[filename]:
                report()
                self.last_report = now
            return result

    sizes = {}
    for index, filename in enumerate(files):
        report()
        path = hf_hub_download("ResembleAI/chatterbox", filename, revision=REVISION, local_dir=directory, tqdm_class=Progress)
        sizes[filename] = Path(path).stat().st_size
        if sizes[filename] != expected[filename]:
            raise RuntimeError("A model file is incomplete. Retry to resume the download.")
        downloaded[filename] = sizes[filename]
        report()
    # Atomic marker: an interrupted download never looks installed.
    marker = directory / "ready.tmp"
    marker.write_text(json.dumps({"modelId": model_id, "revision": REVISION, "files": sizes}), encoding="utf-8")
    marker.replace(directory / "ready.json")
    emit(message="Ready to use", progress=1, downloadedBytes=total_bytes, totalBytes=total_bytes)


if __name__ == "__main__":
    main()
