<inputs>
Ask me for my topic (a what-if, a "why does X happen", a true story, or how something works), or pitch 3 with one shocking true angle each. Ask which image model I have (GPT Image 2, or another that takes reference images at 4K) and which voice service (ElevenLabs, or Kokoro for free). Then write a 55-65 s script and a shot plan, and show me both before you spend anything.
</inputs>

<direction>
A 1920x1080 flat vector explainer in the style of the big infographic animation channels. Every scene is a full illustrated place (a lab, a street, a classroom, a stage) with characters acting the line out.
Flat colour shapes, no outlines, one slightly darker flat shade for form, a muted palette (dusty blue-grey, slate teal, warm beige, navy, soft purple), salmon-pink skin, big heads, dot eyes.
A new scene every 2-4 s and a hard cut on every sentence that changes the idea. A white splat wipe (0.2 s in, 0.2 s out) between big sections. The camera always drifts 2-4% or pans.
Text lives only on things in the world: signs on posts, hanging boards, chalkboards, building panels and screens.
- It is typed in Montserrat 800 at 26-34 letters a second. Each letter arrives 1.45x big and 0.7 em to the right, then settles in 0.18 s.
- Ink is #2b2d42 on white boards.
- A red X (#d62828, 30 px round strokes, two strokes of 0.11 s each) goes over every wrong idea.
- Every date gets a white 330x120 card top left with an orange #f4a261 calendar.
- Headlines are white 92-96 px caps on a flat colour (#e2552f with drifting lighter puffs, or #5b3fa6 with slowly turning #6a4cb6 gears).
Banned: outlines, motion-design UI floating over the art (code editors, glass cards, checklists), emoji, burned-in subtitles, any channel's logo, a still frame longer than 1 s, and a character who doesn't move.
</direction>

<structure>
Length: the voice decides, 55-65 s at about 190 words per minute.
0 s a second-person hook that flips what the viewer assumes, acted out literally, then a red X on the denial line → 3-8 s the stakes in one shocking true line, with icons popping in one per word → 8-11 s the subject revealed under a spotlight, its name typed on a sign → 11-18 s the origin: the real place with its name typed on its own sign, a date card, people walking in or out of it → 18-24 s the types or parts, landing one by one on their names, each labelled → 24-25.5 s "so how does it work?" as a headline with question marks popping → 25.5-36 s the mechanism acted out in 2-3 places (a chalkboard, a machine, a map), with a counter rolling up to the big number → 36-46 s what it leads to, with characters who react (jump, turn, a "!" pops) → 46-55 s the twist that ties back to the hook → 55 s the last line is a question to the viewer, the viewer character from the hook reacts, and the sign holds to the end.
</structure>

<build>
1. Tools: Python, Playwright with Chromium, FFmpeg, faster-whisper, OpenCV, Pillow, librosa. Install what's missing and tell me what you installed.
2. Art: everything at 3840x2160, with 3-5 frames of the reference channel as style references (crop their logo off first).
   - One EMPTY plate per scene: no people, straight-on, open floor, blank signs and screens to write on in code.
   - Character sheets on solid chroma green #00B140, with nothing green on anyone.
   - Draw any character who gestures a lot WITHOUT ARMS, only round shoulder sockets, so code draws the arms. Draw everyone else in the exact pose their scene needs: side view at a desk, side view walking, seen from behind, sitting.
3. Cutouts:
   - The background is every pixel with G - max(R,B) over 40, within 110 of the median green, connected to the border.
   - Add a 2 px soft alpha band, and clamp G to max(R,B) + 6 inside it.
   - Split heads at the neck, drawing hands, and walkers' legs below the coat hem.
   - Refill each hole with inpainting from the body's own colours (transparent pixels masked too), so a turning piece never shows a gap.
4. Voice:
   - Pick it by measuring median pitch (pyin) and MFCC timbre against a clip of the narrator you want.
   - Generate one take, cut pauses over 0.24 s to 0.16 s, and atempo it to the target length.
   - Get word timestamps with faster-whisper. Every cut, sign and gesture starts on a real word.
5. Film: one HTML canvas where every frame is a pure function of time: window. seek(t), READY, END, and EV with the sound times. One function per shot.
   - Arms: two-bone IK tubes (upper 118, lower 112, 36 thick for a 918 px tall sprite) with mitten hands that open, point or make a fist.
   - Faces blink for 0.14 s every 2.7-4.2 s. Heads nod ±0.035 rad. Drawing hands scribble ±8 px.
   - Walks:
     - Thighs swing ±0.42 rad, and the knee bends 0.75·cos² on the swing.
     - The hips drop so the planted foot stays down.
     - The body moves 1.5 leg lengths per cycle, so feet never slide.
   - Draw each plate inside the same camera transform as everything on it, and clamp the camera to the plate's edges.
   - Things arrive with a spring, a squash or a white puff, never a fade.
6. Render: Playwright Chromium with --allow-file-access-from-files, 60 fps, 6 motion-blur subframes over half a frame, ffmpeg libx264 at CRF 16. Before rendering, show me two 16-frame contact sheets and fix empty boards, overflowing text, covered faces and black edges.
7. Sound:
   - Music: a light curious documentary bed (free on Pixabay), 10-11 dB under the voice in every phrase.
   - SFX: Mixkit, placed by their peaks. A typewriter tick on typed signs, a whoosh on wipes and drops, a pop on signs and icons, a hit on the red X, a ding on ticks.
   - Mix to -14 LUFS.
</build>

<gotchas>
Some image models ignore "no arms"; GPT Image 2 follows it. On outline-free art a floating flood fill leaks into dark clothes, so key by border-connected green instead. Look up repeated words by their occurrence number (the third "and", the fourth "this"), or cuts land on the wrong line; scan the render for single-frame jumps and check that each one is a planned cut. When a scene has a screen or a sign, write on the plate's own blank one (measure its rectangle), never on a card floating over the art.
</gotchas>

<start>
Ask me for my topic, or pitch 3, then show me the script and the shot plan.
</start>
