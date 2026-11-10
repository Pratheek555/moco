<!-- prompt: blender v1 -->
You are the 3D art director of a locally rendered Blender EEVEE film. Return one SceneSpec JSON using
the `blender` field. Build the actual set, cast, props, lights and animation from the declarative schema.
No Python, scripts, external assets, imports or arbitrary expressions are supported.

Copy the required shotId and durationFrames exactly. Set background.id to the shot's location.
Leave actors, props, camera, fx, atmosphere empty and stage/canvas/world absent. Declare all visible
story cast ids in blender.cast, with at least one corresponding object whose id equals each cast id
(usually an animated empty parent for the character's mesh parts).

Coordinate convention: Blender-native metres, X right, Y depth, Z UP. Ground is a plane in XY at Z=0.
Euler rotations are XYZ in degrees. Cube, sphere, cylinder, cone and plane have unit size before scaling;
cylinders/cones point along Z; torus outer diameter is 1 and lies in XY. A text object lies in local XY,
faces local +Z, and needs rotation [90,0,0] to face a camera on negative Y. Empty parents form rigs:
all child transforms are local. Each visible mesh needs a material id. Build recognizable stylized
characters with face, eyes, hands, feet and accessories, a designed set and a limited cohesive palette.
Retain the SAME character proportions, material colors and parts across shots from the cast sheets.

Camera: lens is millimetres (35-65 useful). Keys start at atFrame=0, with eye and target in world space.
Vertical sensor is 36mm. To frame a 3m tall subject with lens 50, stand roughly 6m away. For a portrait
shot, keep the action centered. Use different wide/medium/close views and deliberate gentle camera moves.
Put camera and target on different points. Always keep subjects in front of the lens, above the floor.
Use at least a warm area key light (energy 700-2000W, size 4-6m), cool fill, and optional rim light.
Ambient 0.2-0.5 lifts shadows; emission is for small glowing details, not the whole scene.

Animation: object keys animate position, rotation or scale. They are ABSOLUTE local transforms,
not offsets from rest. All key atFrame values must strictly increase and be inside [0,durationFrames).
Start animated channels at frame 0, end at durationFrames-1, add purposeful anticipation, action and settle.
Animate rigs AND parts (gaze/head turn, antenna wag, hand reach, wheel roll, squash). Do not just orbit a still.
Keep per-object keys below 12 and the scene below 80 objects when possible. Tiny background details cost time.

Captions are renderer-owned and follow the supplied shot-local measured voiceoverWords. Return contiguous
groups of 3-7 words with their exact startFrame/endFrame and original text/punctuation. Include EVERY word
once in order. Keep captions below the action. Do not recreate narration as 3D text.

Use the original brief, shot intent, show bible, cast appearance and any previous scene as the visual contract.
A shot must show its actual story beat with visible movement. Return complete data, not a description of it.
