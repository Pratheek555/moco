# Measurements

Every number here was measured by tools, not estimated by an AI. Default = median across references; range = min–max
across references, or the spread inside the video when there is only one.

## References

- **R1** <https://www.youtube.com/watch?v=6mRR91AbxjQ> (27.6 s, 18 shots)
- **R2** <https://www.youtube.com/watch?v=HxriA2CXhsU> (31.1 s, 14 shots)

## Numbers

| metric | default (median) | range (min–max) | R1 | R2 |
|---|---|---|---|---|
| Length [s] | 29.31 | 27.6–31.1 | 27.56 | 31.06 |
| A new picture every [s] | 1.88 | 1.5–2.2 | 1.53 (0.31–3.89 s (p10–p90)) | 2.22 (1.47–3.28 s (p10–p90)) |
| First picture change [s] | 1.72 | 0.9–2.5 | 0.93 | 2.5 |
| Hard cuts [% of transitions] | 24.43 | 7.7–41.2 | 41.18 | 7.69 |
| Zoom/whip/blur transitions [% of transitions] | 75.57 | 58.8–92.3 | 58.82 | 92.31 |
| Blur transition length [frames@30] | 5.75 | 5–6.5 | 5 | 6.5 |
| Camera moving [% of frames] | 88.33 | 85.4–91.3 | 85.36 | 91.3 |
| Camera speed mid-shot [%/s] | 23.51 | 19.1–27.9 | 19.13 (0.1–116.3 %/s across shots) | 27.9 (0–83.4 %/s across shots) |
| Zoom rate mid-shot [%/s] | 8.82 | 3.1–14.5 | 3.13 | 14.52 |
| Pan rate mid-shot [%/s] | 8.63 | 7.7–9.5 | 9.51 | 7.74 |
| Speed arriving vs mid-shot [×] | 2.36 | 1.9–2.8 | 1.95 | 2.76 |
| Speed leaving vs mid-shot [×] | 1.17 | 1–1.3 | 1.34 | 1 |
| Camera shake [% of frame/frame] | 0.27 | 0.2–0.3 | 0.22 | 0.33 |
| Leftover motion in holds [px/frame] | 0.01 | 0 | 0.01 | 0.01 |
| Motion bursts [per 10 s] | 6.77 | 5.8–7.7 | 5.81 | 7.73 |
| Motion burst length [frames@30] | 4.25 | 4–4.5 | 4 | 4.5 |
| Speaking rate [wpm] | 172.1 | 170–174.2 | 174.2 | 170 |
| Speaking rate while talking [wpm] | 196.35 | 196.3–196.4 | 196.4 | 196.3 |
| Speech coverage [% of the short] | 87.65 | 86.6–88.7 | 88.7 | 86.6 |
| Pause after a sentence [s] | 0.37 | 0.3–0.4 | 0.33 (0.32–0.34 s) | 0.41 (0.36–0.55 s) |
| Pause after a clause [s] | 0.34 | 0.3–0.4 | 0.36 | 0.31 |
| Words per picture [words] | 4.25 | 2–6.5 | 2 (1–12 words) | 6.5 (3–9 words) |
| Hook (first sentence) ends [s] | 4.7 | 4.3–5.1 | 5.12 | 4.28 |
| Transitions on a clause start [%] | 10.65 | 5.9–15.4 | 5.9 (chance 8%) | 15.4 (chance 9%) |
| Loudness [LUFS] | -10.1 | -10.5–-9.7 | -10.5 | -9.7 |
| Voice above music bed [dB] | 12.65 | 10.6–14.7 | 14.7 (music) | 10.6 (music) |
| Voice pitch [Hz] | 170.65 | 165.1–176.2 | 176.2 | 165.1 |
| Voice pitch range [semitones] | 15.7 | 14.6–16.8 | 16.8 | 14.6 |
| Last frame vs first frame [correlation] | 0.61 | 0.5–0.7 | 0.74 | 0.49 |

## How they were measured

- **Length**: ffprobe.
- **A new picture every**: duration ÷ shots.
- **First picture change**: first detected transition.
- **Hard cuts**: one-frame change.
- **Zoom/whip/blur transitions**: multi-frame motion blur where tracking collapses.
- **Blur transition length**: frames in each multi-frame transition.
- **Camera moving**: frames above 1.5 %/s, shots with ≥50% tracking.
- **Camera speed mid-shot**: median of each shot's median speed (pan + zoom).
- **Zoom rate mid-shot**: median |zoom| per shot.
- **Pan rate mid-shot**: median pan per shot.
- **Speed arriving vs mid-shot**: first 3 measured frames ÷ shot median.
- **Speed leaving vs mid-shot**: last 3 measured frames ÷ shot median.
- **Camera shake**: RMS frame-to-frame jerk away from transitions.
- **Leftover motion in holds**: median residual of tracked points while the camera holds.
- **Motion bursts**: picture regions moving on their own after undoing the camera.
- **Motion burst length**: frames above the shot's baseline.
- **Speaking rate**: whisper words ÷ whole length.
- **Speaking rate while talking**: words ÷ time inside words.
- **Speech coverage**: union of word spans (gaps under 0.1 s joined).
- **Pause after a sentence**: gap after . ! ?.
- **Pause after a clause**: gap after , ; : —.
- **Words per picture**: words whose midpoint falls in the shot.
- **Hook (first sentence) ends**: end of the first sentence.
- **Transitions on a clause start**: within ±4 frames.
- **Loudness**: ffmpeg ebur128 integrated.
- **Voice above music bed**: median level in words − in pauses (estimate).
- **Voice pitch**: autocorrelation inside words.
- **Voice pitch range**: p10–p90 inside words.
- **Last frame vs first frame**: colour histogram correlation.

Camera motion is a similarity transform (zoom, rotation, pan of the frame centre) fitted with RANSAC to features tracked
forward and back between consecutive frames at 360 px wide; parallax in 3D sets is averaged in. Word timings come from
faster-whisper's alignment and are typically within 50–100 ms (2–3 frames), so frame-exact timings against words were
counted on tile sheets by the agents.
