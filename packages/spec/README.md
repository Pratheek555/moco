# @moco/spec

The scene spec: a zod schema describing one shot (duration, background, actors + timed actions, camera, captions, fx) and an episode (ordered shots + audio). Everything the AI writes must pass this schema. Both `engine` and `renderer` import it, nothing else is shared between them.
