// Writes the results: skill/ (a self-contained Claude skill: SKILL.md + references/) and moco-template.md/.json.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReferenceCard } from "./agents.ts";
import type { ReferenceMeta } from "./fetch.ts";
import type { Measurements } from "./measure.ts";
import { metricText, type ArtistTemplateDraft, type MetricRow, type SkillDraft, type TemplateDraft } from "./merge.ts";

// Skill names are lowercase words joined by hyphens, at most 64 characters.
export function skillSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "learned-style";
}

export function renderSkill(draft: SkillDraft, slug: string, refs: ReferenceMeta[], date: string): string {
  const description = draft.description.replace(/\s+/g, " ").trim().slice(0, 1000);
  const lines = [
    "---",
    `name: ${slug}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
    `# ${draft.name}`,
    "",
    draft.summary.trim(),
    "",
    `> Learned by moco on ${date} from ${refs.length} reference video${refs.length === 1 ? "" : "s"}, measured frame by frame.`,
    "> Numbers and how they were measured: [references/measurements.md](references/measurements.md).",
    "> Technique only: the references' characters, sets, signs, topics and lines are not part of this style.",
    "",
  ];
  for (const section of draft.sections) {
    lines.push(`## ${section.title}`, "");
    if (section.intro.trim()) lines.push(section.intro.trim(), "");
    for (const rule of section.rules) {
      lines.push(`### ${rule.title}`, `- **Default:** ${rule.default.trim()}`, `- **Range:** ${rule.range.trim()}`, `- **Deviate when:** ${rule.deviateWhen.trim()}`);
      if (rule.why.trim()) lines.push("", `*Why:* ${rule.why.trim()}`);
      lines.push("");
    }
  }
  if (draft.checklist.length) lines.push("## Checklist for a finished video", "", ...draft.checklist.map((item) => `- [ ] ${item}`), "");
  if (draft.avoid.length) lines.push("## Never", "", ...draft.avoid.map((item) => `- ${item}`), "");
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderMeasurements(rows: MetricRow[], all: Measurements[]): string {
  const ids = all.map((_, i) => `R${i + 1}`);
  const table = metricText(rows, ids).split("\n");
  const markdownTable = [
    `| ${table[0]!.split(" | ").join(" | ")} |`,
    `|${table[0]!.split(" | ").map(() => "---").join("|")}|`,
    ...table.slice(1).map((line) => `| ${line} |`),
  ];
  return [
    "# Measurements",
    "",
    "Every number here was measured by tools, not estimated by an AI. Default = median across references; range = min–max",
    "across references, or the spread inside the video when there is only one.",
    "",
    "## References",
    "",
    // No titles: they are the references' content, and this file ships inside the skill.
    ...all.map((m, i) => `- **${ids[i]}** ${m.ref.url ? `<${m.ref.url}>` : m.ref.id} (${m.video.duration.toFixed(1)} s, ${m.video.shots.length} shots)`),
    "",
    "## Numbers",
    "",
    ...markdownTable,
    "",
    "## How they were measured",
    "",
    ...rows.map((row) => `- **${row.label}**: ${row.how}.`),
    "",
    "Camera motion is a similarity transform (zoom, rotation, pan of the frame centre) fitted with RANSAC to features tracked",
    "forward and back between consecutive frames at 360 px wide; parallax in 3D sets is averaged in. Word timings come from",
    "faster-whisper's alignment and are typically within 50–100 ms (2–3 frames), so frame-exact timings against words were",
    "counted on tile sheets by the agents.",
    "",
  ].join("\n");
}

export function renderCard(card: ReferenceCard, meta: ReferenceMeta): string {
  const byArea = new Map<string, ReferenceCard["rules"]>();
  for (const rule of card.rules) byArea.set(rule.area, [...(byArea.get(rule.area) ?? []), rule]);
  return [
    `# ${meta.title}`,
    "",
    `${card.label} (${card.category})${meta.channel ? ` · ${meta.channel}` : ""}${meta.url ? ` · <${meta.url}>` : ""}`,
    "",
    card.summary.trim(),
    "",
    ...[...byArea.entries()].flatMap(([area, rules]) => [
      `## ${area.replace(/_/g, " ")}`,
      "",
      ...rules.map((rule) => `- ${rule.rule}${rule.value ? ` **${rule.value}**` : ""} _(${rule.confidence}; ${rule.evidence})_`),
      "",
    ]),
    "## Never",
    "",
    ...card.avoid.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

const STAGE_ORDER = ["series", "series_extend", "bible", "world", "script", "shots", "scene", "publish"] as const;

export function renderTemplate(draft: TemplateDraft | ArtistTemplateDraft, slug: string, refs: ReferenceMeta[]): string {
  const sources = refs.map((ref) => ref.url ?? ref.title).join(", ");
  const artist = "artist" in draft.stages;
  const stages = artist ? ["series", "series_extend", "show", "bible", "world", "script", "shots", "scene", "artist", "publish"] : STAGE_ORDER;
  const guidance = draft.stages as Record<string, string>;
  return [
    `<!-- template: ${slug} v1 -->`,
    `<!-- Learned by moco from ${refs.length} reference video${refs.length === 1 ? "" : "s"} (${sources}): their technique, translated into what moco's`,
    `     ${artist ? "planner and authored Canvas artwork" : "planner, World and scene specs"} can express. See skill/SKILL.md for the full style guide. -->`,
    "",
    ...stages.flatMap((stage) => [`# ${stage}`, guidance[stage]!.trim(), ""]),
  ].join("\n");
}

// Shaped like the engine's TemplateInfo, ready to add to TEMPLATES.
export function templateInfo(draft: TemplateDraft, slug: string) {
  const { episodes, ...info } = draft.info;
  return { id: slug, ...info, palette: { ...info.palette, sky: [info.palette.sky[0], info.palette.sky[1]] }, defaults: { episodes } };
}

export async function writeOutputs(dir: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
  }
}
