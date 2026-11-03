// Reads a template's guidance for one stage: the "# <stage>" section of its .md file (built-in or learned).
import { EngineError } from "../errors.ts";
import { TEMPLATE_STAGES, type TemplateStage } from "./index.ts";
import { lookupTemplate, templateText } from "./registry.ts";

export function isTemplateStage(name: string): name is TemplateStage {
  return (TEMPLATE_STAGES as readonly string[]).includes(name);
}

export function templateGuide(templateId: string, stage: TemplateStage): string {
  const template = lookupTemplate(templateId);
  if (!template) throw new EngineError("invalid_id", `unknown template "${templateId}"`);
  const text = templateText(template);
  const sections = text.split(/^# /m).slice(1);
  const section = sections.find((candidate) => candidate.slice(0, candidate.indexOf("\n")).trim() === stage);
  if (!section) return "";
  return `## Template: ${template.name}\n${section.slice(section.indexOf("\n") + 1).trim()}`;
}
