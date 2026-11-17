# Offline Living Enamel effects

16 base names, 45 lossless 48 kHz mono variants. Run `python audio/sfx.py`
from the working film directory (also run by `film.py prepare`). It checks the
bundled SHA-256 hashes and exports PCM24 WAV to `work/sfx/`. FLAC decoding uses
the existing `soundfile` dependency; no network, new package, or random synthesis
is involved at runtime. The mixer controls loudness and variant rotation.

`manifest.json` records every bundled audio file's hash, sources, authors,
licences, exact source crops, layer offsets, speed changes and processing.
`licenses/` preserves original licence/readme files and exact primary-page
CC0 licence fields as inert text, with source URLs and page hashes. Source archives
and unused recordings are not bundled. The original DSP/editing terms are in
the kit's `LICENSE.txt`; source recordings are CC0 1.0 Universal.

`tink`, `clink`, `pour`, `crack`, `whoosh`, `stamp`, `shatter`, `spark`, `blade`,
`impact`, `paper`, `draw` and `march` each have three variants. `water`, `wind`
and `bell` each have two. Variant 1 exports as `<name>.wav`; subsequent variants
export as `<name>-2.wav` and `<name>-3.wav`. Declare the base name in `p.sound`.
See `references/authoring.md` in the skill for the scene vocabulary.

These are short action cues, not looping ambience. Entry is trimmed to the
first contact/air movement; there is no cinematic pre-rise before the event.
Every asset has an end fade, no long silent tail and at least 3 dB peak headroom.
Conditioning sets headroom, not the desired level in a narrated film.

The library was selected using source descriptions/file names and measurements.
It was **not listened to**. Physical labels are source labels or a documented
layering intention, not proof of a particular alloy, instrument or environment.
Owner audition is still required for subjective quality and picture fit.

Existing projects: update the `Painter.sound` vocabulary in `gilt/engine.py`
to accept all 16 names (preserve any unrelated project drawing changes),
overwrite `audio/sfx.py`, copy this entire `assets/sfx/`
directory (including manifest and licences), and copy the updated kit
`LICENSE.txt`. Run `python audio/sfx.py` to replace generated WAVs without
regenerating narration, then regenerate events/mix as needed. An updated mixer
is required for automatic variant rotation. Setup copies new projects
recursively, including this folder; rerunning setup does not overwrite existing
source files, so use the explicit copy for an existing project.
