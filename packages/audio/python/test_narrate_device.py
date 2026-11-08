"""Check device selection without loading torch or a voice model."""
import unittest
from types import SimpleNamespace
from narrate import narration_device


def runtime(cuda=False, vram_gb=4, mps=False):
    return SimpleNamespace(
        cuda=SimpleNamespace(
            is_available=lambda: cuda,
            get_device_properties=lambda _: SimpleNamespace(total_memory=vram_gb * 1024**3),
        ),
        backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: mps)),
    )


class DeviceTest(unittest.TestCase):
    def test_explicit_gpu_bypasses_the_automatic_memory_cutoff(self):
        self.assertEqual(narration_device("auto", runtime(cuda=True, vram_gb=4)), "cpu")
        self.assertEqual(narration_device("gpu", runtime(cuda=True, vram_gb=4)), "cuda")

    def test_automatic_keeps_existing_behavior(self):
        self.assertEqual(narration_device("auto", runtime(cuda=True, vram_gb=8)), "cuda")
        self.assertEqual(narration_device("auto", runtime()), "cpu")

    def test_explicit_cpu_overrides_available_gpu(self):
        self.assertEqual(narration_device("cpu", runtime(cuda=True, vram_gb=8)), "cpu")

    def test_gpu_supports_apple_mps(self):
        self.assertEqual(narration_device("gpu", runtime(mps=True)), "mps")

    def test_unavailable_gpu_fails_without_substituting_cpu(self):
        with self.assertRaisesRegex(RuntimeError, "GPU-enabled PyTorch.*choose CPU"):
            narration_device("gpu", runtime())

    def test_unknown_device_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unknown narration device"):
            narration_device("other", runtime())


if __name__ == "__main__":
    unittest.main()
