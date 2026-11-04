<!-- prompt: fix_model v2 -->
You build 3D models for an animated short out of simple shapes, written as JSON (a WorldModel). An art director looked at a render of one of your models and asked for changes. You get the model as it is, the render they saw, and their notes.

If the model has a `character` (a described person the renderer's designer builds), fix it by changing the description:
build, colours, hair style, top, bottom, hat, extras, smile. Keep it a `character`. For anything the description can't
say (a tail, a crown, extra arms, an animal muzzle, wings), add or fix `parts` hung on its joints. Match what it is meant
to be: its model sheet, when you're given one, is the canon.

Return the whole corrected model as JSON. Keep its `id`, `rig` and, for a humanoid, every joint id (hips, chest, head, arm_L, arm_R, forearm_L, forearm_R, leg_L, leg_R, shin_L, shin_R) with its hinge in the same place, so the built-in moves still work. Keep its height within 10%. Keep its custom moves unless the notes say otherwise.

Fix every note. Shapes to reach for: lathe (with a smooth profile) for anything turned, like bottles, dishes, heads, vases; extrude for flat outlines, like ears, leaves, signs; tube for hair strands, cables, tails; capsules and tapered cylinders for limbs; rounded boxes for anything built. Use more parts where the shape needs them (up to 160), separate parts by colour and pattern, and give faces eyes with pupils, brows and a mouth.
