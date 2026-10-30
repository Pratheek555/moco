# ADR: Lip sync — amplitude v0 now, Rhubarb later

**Status:** accepted (v0 shipped); Rhubarb is a candidate for later, not adopted
**Date:** 2026-10-30

## Context

The `speak` action needs a mouth shape per frame. The spec carries it as a `VisemeTrack` (`{frame, viseme}` keys
using Rhubarb's shape names X, A–F) on `VoiceoverTrack` (episode frames) and `SceneSpec` (shot frames). The engine
fills it; the AI never writes it. TTS isn't chosen yet (R5), and the target narration is English **and Hindi**.

## Options measured

The spike used one English line (macOS `say`, Samantha, 4.8 s) and one Hindi line (`say`, Lekha, 5.0 s), both
16-bit 16 kHz WAV, on an M2 Max. The scripts are in the session scratchpad and aren't committed.

| | v0 amplitude (`@moco/audio` `amplitudeVisemes`) | Rhubarb 1.14.0, `phonetic` | Rhubarb 1.14.0, `pocketSphinx` + dialog text |
|---|---|---|---|
| How | RMS loudness per frame inside the TTS word timings → A/B/C/D; X outside words | Phone recognition, language-independent | English speech recognition guided by the known text |
| English, 4.8 s | **1.6 ms** | 1.04 s | 5.32 s |
| Hindi, 5.0 s | **0.8 ms** | 1.05 s | n/a (English model only) |
| 45 s reel (extrapolated) | ~10 ms | ~9.5 s | ~50 s |
| Shapes used | X A B C D (openness only) | X A–H | X A–H |
| Rounded vowels (O, OO, W) | ✗ never; loud O reads as wide-open D | ✓ E / F | ✓ E / F |
| M/B/P closures | only if the audio dips | ✓ A | ✓ A |
| Agreement with Rhubarb (open vs closed, per frame) | EN 80–83%, HI 61% | – | – |
| Agreement, 3 buckets (closed / small / open) | EN 41–46%, HI 35% | – | – |
| New dependency | none | ~87 MB download (binary + models) | same |
| Licence | ours | **MIT**; all bundled deps permissive (Boost, BSD-2/3, MIT, WTFPL); checked from `LICENSE.md` in DanielSWolf/rhubarb-lip-sync | same |

The agreement numbers compare two estimates, not a ground truth. Where they disagree, Rhubarb is the one that knows
about phonemes. v0's flicker filter keeps its shape-change rate close to Rhubarb's: 34 vs 33–35 changes in
English, 53 vs 40 in Hindi.

## Decision

- **Ship v0 as the default.** It needs no dependency, works the same for any language, costs nothing per reel, and
  never disagrees with the audio about *when* the mouth moves. That matters most on a phone screen at our character
  size: the mouth is about 30 px tall in a 1080×1920 frame at the default actor scale.
- **Don't adopt Rhubarb yet.** It's clearly better at *which* shape (closures, rounded vowels), and the licence is
  fine. But it adds an 87 MB binary download (over our 5 MB commit limit, so it would be a first-run download), about
  1 s of CPU per 5 s of audio, and a native process to manage. On Hindi only the phonetic recognizer applies; it ran
  and produced plausible shapes, but we have no Hindi reference to judge it against.
- The track format already uses Rhubarb's shape names, so switching is a change inside `@moco/audio` behind
  `AudioPort.visemes`. No spec, kit or renderer change.

## Revisit when

- TTS is chosen (R5). If the TTS returns phonemes or visemes with timings (several do), use those; they're better
  than either option here, with no extra process.
- Close-up shots, where the mouth is large on screen, become common.
- Real kit art arrives with distinct E/F shapes that v0 can't trigger.

## Follow-ups

- Render a side-by-side clip (v0 vs Rhubarb phonetic) with the real TTS voice, and judge it by eye on a phone.
