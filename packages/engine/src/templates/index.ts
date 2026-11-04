// Templates: house styles the user can start a series from. A template is a ready-made skill for the AI: guidance
// for each planning stage (series.md → "# series", "# script", …) plus a few rules the engine enforces in code.
// This file is plain data so the desktop UI can list templates without loading the engine.

// The planning stages a template can guide; each is a "# <stage>" section of the template's .md file.
export const TEMPLATE_STAGES = ["series", "series_extend", "show", "bible", "world", "script", "shots", "scene", "publish"] as const;
export type TemplateStage = (typeof TEMPLATE_STAGES)[number];

export interface TemplateInfo {
  id: string;
  name: string;
  tagline: string; // one line for cards
  description: string; // a short paragraph for the detail view
  tags: string[];
  // What the template does to the story and the picture, shown in the detail view as bullet lists.
  story: string[];
  look: string[];
  missing?: string[]; // learned templates: what the references do that moco can't render yet
  // Colours for the card art: sky top → horizon, ground, and accents for the houses.
  palette: { sky: [string, string]; ground: string; accents: string[] };
  // "world": always build the story's own 3D world, even if the kit could play it. "auto": the bible decides.
  world: "world" | "auto";
  defaults: { episodes: number };
  ideas: { label: string; idea: string }[];
  credit?: { label: string; url: string };
  // Set for styles learned from reference videos (templates/registry.ts): where they live and what they came from.
  learned?: { dir: string; sources: string[]; learnedAt?: string };
}

export const TEMPLATES: TemplateInfo[] = [
  {
    id: "cartoon-3d-short",
    name: "Cartoon 3D story short",
    tagline: "Bean-head cartoon characters in a bright storybook town. One true story, one big snap.",
    description:
      "A surprising true story with a physical cause and effect, told in under a minute: a one-line hook, a quick setting, " +
      "three escalating beats, the snap, a deadpan joke, then the science explained with an everyday analogy. Drawn as " +
      "chunky cartoon characters in a saturated, painted 3D world with gliding cameras.",
    tags: ["History", "Science", "Explainer", "Comedy"],
    story: [
      "One surprising, true, visual story per episode",
      "Hook → setting → escalation → snap → “Luckily… Unluckily…” → analogy → consequence → callback",
      "Jokes are real researched facts, told deadpan in one steady voice",
      "Never narrates what the viewer can already see",
    ],
    look: [
      "Bean-head characters about 3.5 heads tall, thin stick limbs, dot hands",
      "Painted storybook town: brick, cream, ochre and terracotta houses",
      "Saturated blue day sky or a backlit golden-hour sky, horizon-coloured haze",
      "Cuts on big jumps, slow glides and push-ins everywhere else",
    ],
    palette: { sky: ["#3e7fd2", "#b8d0ec"], ground: "#c9a45c", accents: ["#a5523f", "#efe2c4", "#d39a3a", "#c4643f"] },
    world: "world",
    defaults: { episodes: 3 },
    ideas: [
      { label: "The bridge that fell for a song", idea: "Soldiers marching in step brought down an iron bridge in 1831, and armies still break step on bridges because of it." },
      { label: "The great molasses flood", idea: "In 1919 a giant tank burst and a wave of molasses swept through a Boston street faster than people could run." },
      { label: "The war over a bucket", idea: "Two Italian city-states went to war in 1325 over a stolen wooden bucket, and the bucket is still on display today." },
    ],
    credit: { label: "Adapted from the cartoon-3d-short skill by mromidev", url: "https://github.com/mromidev/claude-animated-shorts" },
  },
];

export function findTemplate(id: string | undefined): TemplateInfo | undefined {
  return id === undefined ? undefined : TEMPLATES.find((template) => template.id === id);
}
