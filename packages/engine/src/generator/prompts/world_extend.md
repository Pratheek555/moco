<!-- prompt: world_extend v1 -->
# Extending a world that already exists

This series' world is already built and approved, and episodes have been made in it. You are adding to it, not
rebuilding it. The full guide to building models and locations follows below and still applies, with these differences:

Return JSON: { "models": [...], "locations": [...], "cast": [...] } with only what is new:
- `models`: a model for each new character, and any new prop, building or scenery the new places need. Give every new
  model an id the world doesn't already use. Don't return existing models: reuse them by id in a location's `set` or
  `scatter` (the existing models are listed for you).
- `locations`: one location per new place, with the place's `id` as the location id.
- `cast`: one entry per new character, with the character's `id` and the `model` that plays them.

New characters must look like they belong in the same show as the existing cast: the same proportions, level of detail
and palette, while being instantly different from each of them in silhouette and colour. New places must share the
existing world's light and look.
