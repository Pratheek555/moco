# @moco/kit

The quality bar. Layered SVG React components with a shared rig (`src/rig.ts`: blink, timed actions with ease-in/hold/ease-out, expressions, idle breathing).

- `characters/`: Krishna (blink, raise_hand, point, turn_head, smile, play_flute), Arjuna (blink, draw_bow, lower_head, turn_head)
- `props/`: chariot
- `backgrounds/`: Kurukshetra (dawn/noon, 4 parallax layers)
- `fx/`: dust

Two entry points:
- `@moco/kit` — `catalog` only (data). The engine reads this; it never imports React.
- `@moco/kit/components` — the registry of React components, for the renderer.

`catalog.json` is generated from the registry: `pnpm --filter @moco/kit catalog`. A test fails if it's out of date, so the AI is never offered an action the kit doesn't draw.

Packs (Ramayana, Shiva, Mahabharat) = entries with `packs`. The current art is programmer-drawn placeholder art; an artist's version should keep the same rig props.
