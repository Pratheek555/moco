// Versioned prompt templates live as .md files next to this one; they are part of the product.
import { readFileSync } from "node:fs";
import type { InputRef } from "@moco/spec";
import { sha256 } from "../store/hash.ts";
import { isTemplateStage, templateGuide } from "../templates/guide.ts";

export type PromptName = "series" | "series_extend" | "show" | "bible" | "world" | "script" | "shots" | "scene" | "blender" | "artist" | "artist_review" | "memory" | "publish" | "look_models" | "look_shots" | "fix_model" | "retro" | "canon" | "world_extend";

// With a template, its guidance for this stage follows the base prompt, so it can override the general style advice.
export function loadPrompt(name: PromptName, template?: string): string {
  const base = readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), "utf8");
  const stage = name === "blender" ? "scene" : name;
  const guide = template && isTemplateStage(stage) ? templateGuide(template, stage) : "";
  return guide ? `${base.trimEnd()}\n\n${guide}\n` : base;
}

// A prompt can hold blocks for different situations, "<!-- when: <kind> -->…<!-- end -->": keeps the blocks for `kind`
// and drops the rest, so the AI only reads the rules that apply (a built world's shot never hears about race cars).
export function selectBlocks(text: string, kind: string): string {
  return text
    .replace(/<!-- when: (\w+) -->\n?([\s\S]*?)<!-- end -->\n?/g, (_block, when: string, body: string) => (when === kind ? body : ""))
    .replace(/\n{3,}/g, "\n\n");
}

// Recorded in every artifact's inputs, so we know which prompt produced it and caches miss when a prompt
// (or the series' template) changes.
export function promptRef(name: PromptName, template?: string): InputRef {
  const text = loadPrompt(name, template);
  const version = Number(/<!-- prompt: \w+ v(\d+)/.exec(text)?.[1] ?? 0);
  return { kind: `Prompt:${name}`, revision: version, contentHash: sha256(text) };
}

// A prompt section: a heading followed by pretty-printed JSON.
export function jsonSection(title: string, value: unknown): string {
  return [`## ${title}`, "```json", JSON.stringify(value, null, 2), "```"].join("\n");
}

// User feedback (from reject() or a send-back) always goes last, so it wins.
export function feedbackSection(feedback: string | undefined): string {
  return feedback ? `## Change requested by the user — this overrides anything above\n${feedback}` : "";
}

export function joinSections(sections: string[]): string {
  return sections.filter(Boolean).join("\n\n");
}
