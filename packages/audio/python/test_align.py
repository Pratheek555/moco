"""Check independent transcription and line mapping without loading an ASR model."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from align import align


def transcript(tokens):
    return [SimpleNamespace(words=[SimpleNamespace(word=text, start=index * .4, end=(index + 1) * .4)
                                   for index, text in enumerate(tokens)])]


class AlignmentTest(unittest.TestCase):
    def test_script_is_not_used_as_preceding_speech(self):
        # Prompting with the opening previously skipped ~27 seconds of a real take.
        lines = [{"id": "l01", "text": "A thousand meters down."},
                 {"id": "l02", "text": "Sunlight has disappeared."}]
        model = Mock()
        model.transcribe.return_value = (transcript("A thousand meters down. Sunlight has disappeared.".split()), None)
        result = align({"file": "vo.wav", "language": "en", "lines": lines}, model)
        model.transcribe.assert_called_once_with("vo.wav", language="en", word_timestamps=True, beam_size=5)
        self.assertEqual(result["similarity"], 1)
        self.assertEqual([word["lineId"] for word in result["words"]], ["l01"] * 4 + ["l02"] * 3)
        self.assertEqual(result["words"][0]["start"], 0)
        self.assertAlmostEqual(result["words"][-1]["end"], 2.8)

    def test_missing_speech_is_not_filled_from_script(self):
        lines = [{"id": "l01", "text": "A thousand meters down."},
                 {"id": "l02", "text": "Sunlight has disappeared."}]
        model = Mock()
        model.transcribe.return_value = (transcript("Sunlight has disappeared.".split()), None)
        result = align({"file": "vo.wav", "language": "en", "lines": lines}, model)
        self.assertTrue(all(word["lineId"] == "l02" for word in result["words"]))
        self.assertLess(result["similarity"], .65)

    def test_silent_transcript_remains_empty(self):
        model = Mock()
        model.transcribe.return_value = ([], None)
        result = align({"file": "silent.wav", "language": "en", "lines": [{"id": "l01", "text": "Hello."}]}, model)
        self.assertEqual(result["words"], [])
        self.assertEqual(result["similarity"], 0)


if __name__ == "__main__":
    unittest.main()
