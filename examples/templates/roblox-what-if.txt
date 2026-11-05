<inputs>
Ask me for my story idea: a "What if" that crosses a kid's real-life pain (screen time, Mom, chores, school, the dentist, a little brother) with one Roblox rule. Or pitch 3 different ones. Ask which voice tool I have: free first (Kokoro or Piper, run locally), or ElevenLabs (about $0.15 a Short). Ask if I have an image or video model, and tell me this method needs neither, because every frame is drawn in code. Then write the script and a shot list with seconds, and show me both before anything costs money.
</inputs>

<direction>
A 1080x1920, 60 fps, 40-45 s vertical Short in the style of the big 2D "What if" kid Roblox story channels: flat 2D cartoon cut-outs animated like motion graphics, drawn entirely on an HTML canvas in code. Not 3D, not AI images.
Characters: one blocky game-avatar rig shared by the whole cast.
- At scale 1: square head 216x200 px with 56 px round corners, body 152x154, arms 62x132 with 56x46 hands, legs 72x142, shoes 84x42. Draw them at scale 1.0-2.4.
- Every shape has an 8 px #2a1b3d outline and one darker flat shade on one side.
- One look each. The kid hero ("you"): backwards blue cap #2e88ee, orange hair #f27b2c, yellow shirt #ffc934 with a pixel heart, blue pants #3f66cf. Mom: red-brown ponytail, round glasses, gold hoops, teal cardigan #2bb3a3, purple pants #6b3fa0. One or two side characters (a dentist, a teacher, a little brother).
- Faces carry the comedy. Eyes: normal, happy arcs, huge, star, spiral, closed, narrow. Brows: up, worry, angry, flat. Mouths: smile, grin, o, scream, wavy, flat, smirk, tongue, chew, wide. Plus blush, sweat drops and sunglasses that drop in. Blink for 0.1 s about every 1.6 s.
Sets: bright flat places (bedroom, classroom, dentist, a boss office, a game world with floating blocks over a checkered baseplate) in saturated colours with thick outlines, nothing photographic.
Motion: something moves on every line, and the picture changes every 1-3 s.
- Things arrive with a squash (0.72, 1.12, 0.95, 1 over 0.3 s), an overshoot ease or a white poof cloud, never a plain fade.
- The camera pushes in 5-15% per shot and shakes (decaying over 0.35 s) on every hit.
Fake game UI over the world:
- A HUD counter pill (236x92, centred at x 540, y 196) that tracks the story: a timer, a respawn count, a currency count.
- "[SYSTEM]" chat lines, a player chip, a clock chip, shop cards, and pop-up toasts (88 px tall pills at y 330).
- A SUBSCRIBE button with a cursor hand.
Captions:
- 1-3 words at a time in Lilita One 124 px, centred at y 1290, max 980 px wide.
- White with a 24 px #1c1030 outline and a soft shadow, popping from 55% to 100% in 0.16 s.
- Key words in caps and colour: red #ff5165, green #5dff8f, yellow #ffd23f, pink #ff7ad9, cyan #7debff, orange #ffa53d, purple #c49bff.
- No full stops on screen, ever.
Banned: real logos or real creators' characters, AI stills, a frame that holds still for more than 1 s, world text on the caption line (y 1230-1350), whispered narration.
</direction>

<structure>
Length: 40-45 s, 85-110 words. Times below are from a 41.8 s Short; scale them to the voice.
0-2.3 s: the narrator reads the title as the first line ("What if your mom owned Roblox?") over the most striking picture of the rule (a chair spins round to reveal Mom, a bed turns into a spawn point). Caption words punch in.
2.3-4.5 s: one character line that proves the rule ("Hi sweetie! I bought it!"), with a toast pill.
4.5-10 s: DAY 1. A card pops: 230 px Lilita One in yellow #ffd23f with a 38 px outline, tilted -6 degrees. It comes in over 0.22 s and leaves at 1.05 s. One picture, one small joke, a reaction line ("Noooo!").
10-15.7 s: DAY 2, bigger. The HUD counter appears and ticks with a green "+1".
15.7-20.5 s: DAY 3, the biggest, with a callback to an earlier character.
20.5-23.5 s: the subscribe beat told inside the story ("Subscribe, and Mom adds one more minute"). The button is pressed at about 21.3 s.
23.5-33 s: the turn. The kid fights back and wins: a fast 3-shot montage (0.85 s each on bursting colour backgrounds), the counter racing to 1,000,000, confetti.
33-40.3 s: the payoff. The other side wins after all, in one clear picture and one line.
40.3-41.25 s: a short tag from the kid ("Wait, what?").
41.25-41.8 s: REWIND. The whole film scrubs backwards to frame 0 in 0.55 s with scanlines and a REWIND label, so the last line leads straight back into the first. No "comment X" ask.
</structure>

<build>
1. Tools (free): Python 3, Playwright with Edge or Chromium, FFmpeg, faster-whisper, numpy, Pillow. Install what's missing and tell me what you installed.
2. Script (free):
   - Point of view and lines: "you" and "your", the title as line 1, one picture per line, 10-16 words at most per line, words a 10-year-old uses, no names.
   - Make Roblox itself the topic in every beat (Robux, servers, obbies, avatars, the shop), not just a word in the title.
   - Days 1-3 escalate. The turn and the payoff flip it twice.
3. Voice: record one take per character, with all of that character's lines separated by blank lines.
   - ElevenLabs eleven_v4 with stock library voices, never a cloned real creator. Narrator: an energetic young man (median pitch 160-210 Hz). Kid: a high cartoon voice (about 340 Hz). Mom: bright and sassy (about 280 Hz).
   - Use audio tags: [excited], [screaming], [sweetly], [mischievously]. Cost: about 750 credits, about $0.14 for a 42 s Short.
   - Free route: Kokoro or Piper locally. Pick the liveliest voices; it will sound flatter.
   - Cut the takes into lines with faster-whisper word times (pad 0.06 s before and 0.15 s after). Squeeze pauses inside a line to 0.22 s. Leave 0.2 s between lines and 0.3-0.35 s before each DAY line.
   - Match each take's level to the narrator, then lift any line more than 1.5 dB under the narrator's median. Use atempo only up to 1.07; past that it sounds sped up.
   - Run whisper again on the finished track for word times. Every cut, card, caption and sound starts on a real word.
4. Film (free): one HTML page with one canvas, where every frame is a pure function of time: window .seek(t), window.READY, window.END.
   - A SHOTS list of [start, end, function]. Each shot sets a camera (centre x, centre y, zoom, keyed over time), draws its world, and may return an overlay drawn in screen space.
   - One rig function draws every character from a pose object: x, y, scale, squash, rotation, arm and leg angles, head tilt, eyes, brows, mouth, look.
   - Find hand positions with the same arm maths, so held props (a tablet, a sock, a money bag) sit in the hand.
   - Lilita One (free on Google Fonts) for every word.
5. Check before render: draw 3 contact sheets of 12-16 frames at key times. Fix captions over world text, characters cut off, cards over faces and empty corners.
6. Render (free): seek every frame in headless Edge or Chromium and encode inside the page with WebCodecs H.264 on the GPU: 60 fps, 60 Mbps, 2 motion-blur subframes over half a frame.
   - It renders at about 18 fps, so 42 s takes about 2.5 min.
   - Re-encode with libx264 CRF 20, preset slow, for the upload (about 27 MB).
7. Sound (free):
   - Music: one playful bed (Mixkit, free licence). Cut it on the two big moments (the shutdown and the twist).
   - Effects: Mixkit, placed so each effect's loudest moment lands on its frame. Use a whoosh and a pop on cards, a poof, a coin ding on +1, a boing on jumps, a slam, a glint, a party horn, a sting, a rewind.
   - Keep the narrator 15+ dB over everything else on every line. Render a voice-only mix and a no-voice mix with the same gains (before loudness normalising), compare RMS per line, and fix any line under 15 dB.
   - What worked: the music bed about 19 dB down, effects that land on speech 12 dB down, effects in gaps 4 dB down, and every cue capped at -3 dBFS peak. Result: minimum 15.5 dB, median 17.9 dB.
   - Two-pass loudnorm to -14 LUFS, true peak -1.5.
8. Cover (free):
   - Study the top 5-10 rival covers first. On YouTube the custom cover is the middle 405x720 of the video's maxresdefault.jpg.
   - Background: a bright radial sunburst (#f6a8ff to #a24dff to #3d138f, with 22 white rays at 13%).
   - Title, 2 lines: line 1 at 300 px in a pink gradient (#ffe3f4 to #ff4fae). Line 2 at 140 px in a yellow gradient (#fff27a to #ffa51a), ending in "?!". Each letter bounces and is tilted -4 degrees, with a thick dark outline.
   - The main character big and smug with one prop circled in red (15 px #ff2d3d), the kid shocked in front, both cropped by the frame edges. Draw it with the same rig.
   - Check it side by side with the rivals at 240 px wide. JPG under 2 MB.
9. Upload text:
   - Title: "What If Your MOM [did X] Roblox?" plus 1 emoji, 28-49 characters, one word in caps.
   - Description: 2-3 teaser lines with caps words and emoji, ending on a question, then 5 hashtags and a line saying the video is not affiliated with Roblox.
   - Decide YouTube's made-for-kids setting yourself before posting: it changes comments and reach.
</build>

<gotchas>
- Plain script tags share one global scope, so a top-level const declared in two files is a SyntaxError that blanks the whole page. Give each file's names their own prefix.
- Whisper writes "8" for "eight" and "No!" for "Noooo!". Match lines by word count, not exact text.
- Whisper's word times drift up to 0.3 s where one character hands over to another. Time those lines from your own assembly list.
- On the first mix the narrator was only 6 dB over the music: the voice had hit the -3 dBFS peak cap and could not go louder. Pull everything else down instead, and measure before you normalise.
- A raised arm drawn behind the head hides the hand holding a prop. Pick arm angles where the hand clears the head.
- A camera that follows a jumping avatar bounces with it. Follow x, and ease y on its own.
- World text on the caption line (a nameplate, a sign) collides with the captions. Keep it above y 1230.
- A DAY card covers a head in game shots. Frame heads below y 600 while a card shows.
- Reading pixels back every frame (toDataURL) knocks the canvas off the GPU and renders about 50x slower. Encode inside the page instead.
- The 60 Mbps master is about 300 MB for 42 s. Render it to a big drive and upload the CRF 20 copy.
- The first version ran 55 s and ended on "Comment BED". The biggest rivals run 43-46 s, and a comment ask is wasted if comments end up off. Cut to 40-45 s and end on a loop.
- Stock narrators read at about 2.2 words a second; the rivals talk at about 3.1 while talking. Ask for an energetic read and squeeze pauses before you reach for atempo.
</gotchas>

<start>
Ask me for my story idea, or pitch 3. Then show me the script (word count and seconds per line) and the shot list before any voice is generated.
</start>
