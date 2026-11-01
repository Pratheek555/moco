"""Download protocol checks with tiny fixtures; no model or network access."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("download_model", Path(__file__).with_name("download_model.py"))
downloader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(downloader)


class DownloadTests(unittest.TestCase):
    def run_download(self, directory, missing_metadata=False, fail_transfer=False):
        names = downloader.FILES["english"]
        sizes = dict(zip(names, [10, 1000, 100, 5, 5]))
        hub = types.ModuleType("huggingface_hub")

        class Api:
            def model_info(self, *args, **kwargs):
                return types.SimpleNamespace(siblings=[types.SimpleNamespace(rfilename=name, size=None if missing_metadata else size) for name, size in sizes.items()])

        def download(_repo, filename, revision, local_dir, tqdm_class):
            path = Path(local_dir) / filename
            if not path.exists():
                initial = 200 if filename == names[1] else 0
                progress = tqdm_class(total=sizes[filename], initial=initial, disable=True)
                if fail_transfer:
                    raise RuntimeError("connection interrupted")
                progress.update(sizes[filename] - initial)
                path.write_bytes(b"x" * sizes[filename])
            return str(path)

        class DisabledTqdm:
            def __init__(self, *args, **kwargs):
                self.n = kwargs.get("initial", 0)
            def update(self, amount=1):
                return None  # Matches tqdm's disabled behavior: n is not updated.

        hub.HfApi, hub.hf_hub_download = Api, download
        tqdm = types.ModuleType("tqdm")
        auto = types.ModuleType("tqdm.auto")
        auto.tqdm = DisabledTqdm
        stdout = io.StringIO()
        with patch.dict(sys.modules, {"huggingface_hub": hub, "tqdm": tqdm, "tqdm.auto": auto}), patch.object(sys, "argv", ["download_model.py", "english", str(directory)]), contextlib.redirect_stdout(stdout):
            downloader.main()
        return [json.loads(line) for line in stdout.getvalue().splitlines()]

    def test_byte_weighted_totals_include_cached_files_and_resumed_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "ve.safetensors").write_bytes(b"x" * 10)
            (directory / "conds.pt").write_bytes(b"x" * 5)
            events = self.run_download(directory)
            resumed = next(event for event in events if event.get("downloadedBytes") == 215)
            self.assertEqual(resumed["totalBytes"], 1120)
            self.assertAlmostEqual(resumed["progress"], 215 / 1120)
            self.assertEqual(events[-1]["downloadedBytes"], 1120)
            self.assertEqual(events[-1]["totalBytes"], 1120)
            self.assertEqual(events[-1]["progress"], 1)
            self.assertTrue((directory / "ready.json").is_file())

    def test_unknown_size_is_not_reported_as_a_fake_total(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError, "download size"):
                self.run_download(Path(tmp), missing_metadata=True)
            self.assertFalse((Path(tmp) / "ready.json").exists())

    def test_interrupted_transfer_does_not_mark_ready(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError, "interrupted"):
                self.run_download(Path(tmp), fail_transfer=True)
            self.assertFalse((Path(tmp) / "ready.json").exists())


if __name__ == "__main__":
    unittest.main()
