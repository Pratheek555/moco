# @moco/engine

The pipeline:

- `planner`: idea → series → episodes → shot list fitted to 30–60s
- `generator`: shot → scene spec JSON via `ai`, using kit catalog + examples
- `loop`: validate against `spec`, render, feed errors back, retry
- `memory`: characters, style and story state carried across episodes
