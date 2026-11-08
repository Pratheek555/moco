"""Offline faster-whisper timestamps, mapped monotonically to script line ids; keeps mismatch evidence."""
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path


def align(request, model):
    expected = [(token, line["id"]) for line in request["lines"] for token in line["text"].split()]
    normalize = lambda word: re.sub(r"[^\w]", "", word.lower())
    # The script is comparison evidence, not preceding speech. Feeding its opening
    # into initial_prompt can make Whisper skip those same words in the recording
    # (or hallucinate a replacement for the first window). Transcribe independently.
    segments, _ = model.transcribe(request["file"], language=request["language"], word_timestamps=True, beam_size=5)
    actual = [{"text": word.word.strip(), "start": word.start, "end": word.end}
              for segment in segments for word in (segment.words or [])]
    matcher = SequenceMatcher(None, [normalize(word) for word, _ in expected], [normalize(word["text"]) for word in actual], autojunk=False)
    mapping = {}
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            mapping[block.b + offset] = block.a + offset
    for index, word in enumerate(actual):
        if index in mapping:
            match = mapping[index]
        elif mapping:
            closest = min(mapping, key=lambda other: abs(other - index))
            match = max(0, min(len(expected) - 1, mapping[closest] + index - closest))
        else:
            match = 0
        word["lineId"] = expected[match][1]
    return {"method": "faster-whisper ASR with script line mapping (not forced alignment)",
            "similarity": matcher.ratio(), "words": actual, "expected": [word for word, _ in expected]}


def main():
    from faster_whisper import WhisperModel

    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    model = WhisperModel(request["model"], device="cpu", compute_type="int8", local_files_only=True)
    result = align(request, model)
    Path(request["output"]).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"Aligned {len(result['words'])} words; script similarity {result['similarity']:.3f}")


if __name__ == "__main__":
    main()
