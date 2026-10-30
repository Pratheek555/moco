// Versioned prompt templates live as .md files next to this one; they are part of the product.
import { readFileSync } from "node:fs";
import type { InputRef } from "@moco/spec";
import { sha256 } from "../store/hash.ts";

export type PromptName = "series" | "bible" | "script" | "shots" | "scene" | "memory";

export function loadPrompt(name: PromptName): string {
  return readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), "utf8");
}

// Recorded in every artifact's inputs, so we know which prompt produced it and caches miss when a prompt changes.
export function promptRef(name: PromptName): InputRef {
  const text = loadPrompt(name);
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
