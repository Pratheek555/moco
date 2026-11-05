"""Exercise clip writing and pause compression without loading a neural model."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
import numpy as np
import soundfile as sf


class WorkerTest(unittest.TestCase):
    def test_compact_phrase_retains_speech_and_writes_each_take_index(self):
        with tempfile.TemporaryDirectory(prefix="moco-kokoro-test-") as directory:
            root = Path(directory)
            (root / "kokoro_onnx.py").write_text('''import numpy as np
class Kokoro:
    def __init__(self, *args): pass
    def create(self, *args, **kwargs):
        r=24000
        tone=(.1*np.sin(2*np.pi*220*np.arange(r)/r)).astype(np.float32)
        return np.concatenate([np.zeros(r//4),tone,np.zeros(r//2),tone,np.zeros(r//4)]).astype(np.float32),r
''', encoding="utf-8")
            request = root / "request.json"
            request.write_text(json.dumps({"modelDir":str(root),"outDir":str(root),"voice":"default","lines":[{"text":"Three short commands","compact":True},{"text":"A second take"}]}),encoding="utf-8")
            env = dict(os.environ, PYTHONPATH=str(root))
            subprocess.run([sys.executable,str(Path(__file__).with_name("kokoro_worker.py")),str(request)],env=env,check=True,capture_output=True)
            first, rate = sf.read(root / "kokoro-0.wav")
            second, _ = sf.read(root / "kokoro-1.wav")
            self.assertEqual(len(list(root.glob("kokoro-*.wav"))),2)
            self.assertLess(len(first),len(second))
            self.assertGreater(np.count_nonzero(np.abs(first)>.01),40000)
            self.assertGreater(len(first)/rate,2)


if __name__ == "__main__":
    unittest.main()
