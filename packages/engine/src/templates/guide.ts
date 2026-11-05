// Reads a template's guidance for one stage: the "# <stage>" section of its .md file (built-in or learned).
import { EngineError } from "../errors.ts";
import { TEMPLATE_STAGES, type TemplateStage } from "./index.ts";
import { lookupTemplate, templateText } from "./registry.ts";
import { templateImages } from "./registry.ts";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export function isTemplateStage(name: string): name is TemplateStage {
  return (TEMPLATE_STAGES as readonly string[]).includes(name);
}

export function templateGuide(templateId: string, stage: TemplateStage): string {
  const template = lookupTemplate(templateId);
  if (!template) throw new EngineError("invalid_id", `unknown template "${templateId}"`);
  // Adding optional reference support must not invalidate existing text-only art.
  if(template.creativePrompt && !templateImages(templateId).length) return `## Template: ${template.name}\nFollow this creative brief for ${stage}. Use only tools exposed by Moco. Record unavailable capabilities explicitly; never silently substitute a different visual style.\n${template.creativePrompt}`;
  if (template.creativePrompt) return `## Template: ${template.name}\nFollow this creative brief for ${stage}. Use only tools exposed by Moco. Record unavailable capabilities explicitly; never silently substitute a different visual style. Style reference frames, when attached, show composition, character proportions and illustration detail; use them as evidence without copying logos or creator characters.\n${template.creativePrompt}\nReference hashes: ${templateImages(templateId).map(path => createHash("sha256").update(readFileSync(path)).digest("hex")).join(",")}`;
  const text = templateText(template);
  const sections = text.split(/^# /m).slice(1);
  const section = sections.find((candidate) => candidate.slice(0, candidate.indexOf("\n")).trim() === stage);
  if (!section) return "";
  return `## Template: ${template.name}\n${section.slice(section.indexOf("\n") + 1).trim()}`;
}
