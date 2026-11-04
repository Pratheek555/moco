"""Optional demo alignment using an already installed faster-whisper runtime/model."""
import json
import sys
from faster_whisper import WhisperModel

model = WhisperModel("small", device="cpu", compute_type="int8", local_files_only=True)
segments, _ = model.transcribe(sys.argv[1], language="en", word_timestamps=True, beam_size=5)
words = [{"text": w.word.strip(), "start": w.start, "end": w.end, "lineId": "narration"}
         for segment in segments for w in (segment.words or [])]
with open(sys.argv[2], "w", encoding="utf-8") as output:
    json.dump(words, output, indent=2)
print(f"Aligned {len(words)} words")
