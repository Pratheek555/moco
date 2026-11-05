// Every template the engine can use: the built-in ones (templates/<id>.md) plus styles learned from reference videos
// by @moco/learn, each a folder <stylesDir>/<id>/ with moco-template.json (TemplateInfo) and moco-template.md (stage
// sections). The folder is read on every lookup, so a style learned while the app runs is usable straight away.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATES, type TemplateInfo } from "./index.ts";
import { ArtistProduction } from "@moco/spec";

let stylesDir: string | undefined;

// Where learned styles live; undefined = built-in templates only. The engine sets this from its options.
export function setStylesDir(dir: string | undefined): void {
  stylesDir = dir;
}

export function learnedTemplates(dir = stylesDir): TemplateInfo[] {
  if (!dir || !existsSync(dir)) return [];
  const found: TemplateInfo[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const folder = join(dir, entry.name);
    if (!entry.isDirectory() || entry.name.startsWith(".") || !existsSync(join(folder, "moco-template.md"))) continue;
    const info = readLearnedInfo(folder);
    // A built-in id always wins, so a learned style can't replace one.
    if (info && !TEMPLATES.some((template) => template.id === info.id)) found.push(info);
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

export function allTemplates(): TemplateInfo[] {
  return [...TEMPLATES, ...learnedTemplates()];
}

export function lookupTemplate(id: string | undefined): TemplateInfo | undefined {
  return id === undefined ? undefined : allTemplates().find((template) => template.id === id);
}

// The template's stage guidance file.
export function templateText(template: TemplateInfo): string {
  if (template.learned) return readFileSync(join(template.learned.dir, "moco-template.md"), "utf8");
  return readFileSync(new URL(`./${template.id}.md`, import.meta.url), "utf8");
}

function readLearnedInfo(folder: string): TemplateInfo | undefined {
  try {
    const info = JSON.parse(readFileSync(join(folder, "moco-template.json"), "utf8")) as Partial<TemplateInfo>;
    if (typeof info.id !== "string" || typeof info.name !== "string" || !info.palette?.sky || !Array.isArray(info.palette.accents)) return undefined;
    const style = readStyle(folder);
    return {
      id: info.id,
      name: info.name,
      tagline: info.tagline ?? "",
      description: info.description ?? "",
      tags: info.tags ?? [],
      story: info.story ?? [],
      look: info.look ?? [],
      palette: info.palette,
      world: info.world === "auto" ? "auto" : "world",
      defaults: { episodes: info.defaults?.episodes ?? 3 },
      ideas: info.ideas ?? [],
      ...(typeof info.creativePrompt === "string" && { creativePrompt: info.creativePrompt }),
      referenceImages: info.referenceImages?.filter(path => /^references\/[0-4]\.(png|jpeg|webp)$/.test(path)),
      ...(info.production && { production: ArtistProduction.parse(info.production) }),
      learned: { dir: folder, sources: style.sources ?? [], learnedAt: style.updatedAt },
    };
  } catch {
    return undefined; // half-written or hand-edited badly: skip it rather than break the list
  }
}

export function templateImages(id: string | undefined): string[] {
  const template = lookupTemplate(id);
  if(!template?.learned) return [];
  return (template.referenceImages ?? []).map(path => join(template.learned!.dir,path)).filter(existsSync);
}

function readStyle(folder: string): { sources?: string[]; updatedAt?: string } {
  try {
    return JSON.parse(readFileSync(join(folder, "style.json"), "utf8")) as { sources?: string[]; updatedAt?: string };
  } catch {
    return {};
  }
}
