// The agents: each is one isolated `claude -p` call (tools off) that sees some tile sheets and some measurement tables
// and returns JSON. Per reference: an overview agent classifies the format, which decides the specialists (camera and
// story always; motion when characters act; graphics when text or explainer graphics carry it), split into parts when
// there are more sheets than one agent should read. A reference lead then merges them into the reference's rule card.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { AiBackend } from "@moco/ai";
import * as z from "zod";
import { audioSummary, cameraSummary, eventTable, headline, paletteSummary, shotTable, syncSummary, transcript, transitionTable } from "./context.ts";
import type { Measurements } from "./measure.ts";
import type { SheetSet } from "./sheets.ts";

export const AREAS = [
  "format", "pace", "script", "hook", "loop", "voice", "music", "sound", "captions", "graphics", "characters", "faces",
  "gestures", "acting", "sets", "props", "lighting", "colour", "render", "framing", "camera", "transitions", "facts_to_pictures",
] as const;
export const CATEGORIES = ["3d_cartoon", "2d_cartoon", "motion_graphics", "stock_footage", "ai_images", "live_action", "screen_recording", "other"] as const;

const Area = z.enum(AREAS);
const Confidence = z.enum(["high", "medium", "low"]);

export const Finding = z.object({
  area: Area,
  observation: z.string().describe("what happens, concretely, with numbers or frame counts"),
  rule: z.string().describe("the reusable technique, as an instruction for any story"),
  measured: z.string().describe("the measured numbers or counted frames behind it; empty if judged by eye"),
  evidence: z.string().describe("where: shots, frames, sheets"),
  confidence: Confidence,
});

export const SpecialistOutput = z.object({
  findings: z.array(Finding),
  contentSpecifics: z.array(z.string()).describe("this video's own content: topic, names, places, objects, lines, signs"),
  notes: z.string().describe("caveats, e.g. measurements that looked wrong"),
});

export const OverviewOutput = SpecialistOutput.extend({
  category: z.enum(CATEGORIES),
  label: z.string(),
  why: z.string(),
  hasCharacters: z.boolean(),
  hasOnScreenText: z.boolean(),
  hasNarrator: z.boolean(),
});

export const ReferenceCard = z.object({
  category: z.enum(CATEGORIES),
  label: z.string(),
  summary: z.string(),
  rules: z.array(z.object({ area: Area, rule: z.string(), value: z.string(), evidence: z.string(), confidence: Confidence })),
  avoid: z.array(z.string()),
  contentSpecifics: z.array(z.string()),
});

export type Finding = z.infer<typeof Finding>;
export type SpecialistOutput = z.infer<typeof SpecialistOutput>;
export type OverviewOutput = z.infer<typeof OverviewOutput>;
export type ReferenceCard = z.infer<typeof ReferenceCard>;

export type Role = "overview" | "camera" | "motion" | "graphics" | "story" | "reference" | "merge" | "template" | "template_artist";

export interface AgentTask {
  name: string; // file name of its output, e.g. "camera-2"
  role: Role;
  prompt: string;
  images: string[];
}

export interface AgentContext {
  ai: AiBackend;
  model?: string;
  timeoutMs: number;
  limit: <T>(task: () => Promise<T>) => Promise<T>; // shared concurrency limit across all references
  log: (message: string) => void;
  usage: { calls: number; cached: number; costUsd: number };
}

const SHEETS_PER_AGENT = 6;

export function loadPrompt(role: Role): string {
  const read = (name: string) => readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), "utf8").trim();
  return `${read(role)}\n\n${read("common")}\n`;
}

// Runs one agent, or returns its saved output when nothing it sees has changed. Retries once with the schema errors.
export async function runAgent<T>(ctx: AgentContext, task: AgentTask, schema: z.ZodType<T>, outFile: string): Promise<T> {
  const system = loadPrompt(task.role);
  const jsonSchema = z.toJSONSchema(schema, { io: "input", target: "draft-07" }) as object;
  const hash = createHash("sha256").update(system).update(task.prompt).update(JSON.stringify(jsonSchema)).update(ctx.model ?? "");
  for (const image of task.images) hash.update(await readFile(image));
  const inputHash = hash.digest("hex");

  const saved = await readSaved(outFile);
  if (saved?.inputHash === inputHash) {
    const parsed = schema.safeParse(saved.output);
    if (parsed.success) {
      ctx.usage.cached += 1;
      return parsed.data;
    }
  }

  return ctx.limit(async () => {
    let prompt = task.prompt;
    let lastError = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      ctx.log(`agent ${task.name}: ${task.images.length} image${task.images.length === 1 ? "" : "s"}${attempt > 1 ? ` (retry: ${lastError.slice(0, 80)})` : ""}`);
      const started = Date.now();
      try {
        const result = await ctx.ai.generate({ system, prompt, jsonSchema, images: task.images, model: ctx.model, timeoutMs: ctx.timeoutMs });
        ctx.usage.calls += 1;
        ctx.usage.costUsd += result.usage?.costUsdEstimate ?? 0;
        const parsed = schema.safeParse(result.json);
        if (parsed.success) {
          await writeFile(outFile, JSON.stringify({ inputHash, role: task.role, seconds: Math.round((Date.now() - started) / 1000), usage: result.usage, output: parsed.data }, null, 2));
          return parsed.data;
        }
        lastError = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
        prompt = `${task.prompt}\n\n## Your previous answer did not match the schema\n${lastError}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt === 2 || /usage limit|rate.?limit|not logged in/i.test(lastError)) throw error;
      }
    }
    throw new Error(`agent ${task.name} failed: ${lastError}`);
  });
}

async function readSaved(file: string): Promise<{ inputHash: string; output: unknown } | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as { inputHash: string; output: unknown };
  } catch {
    return undefined;
  }
}

// ---------- prompts per role ----------

const section = (title: string, body: string) => `## ${title}\n${body}`;

export function overviewTask(m: Measurements, sheets: SheetSet): AgentTask {
  return {
    name: "overview",
    role: "overview",
    images: sheets.overview.slice(0, 4),
    prompt: [
      section("Measured numbers", headline(m)),
      section("Picture", paletteSummary(m, sheets)),
      section("Shots", shotTable(m)),
      "The images are the overview sheets: the middle frame of every shot, labelled with shot number, start time, length and its words.",
    ].join("\n\n"),
  };
}

// The specialists this reference needs, and how many parts each is split into.
export function planSpecialists(m: Measurements, sheets: SheetSet, overview: OverviewOutput): AgentTask[] {
  const tasks: AgentTask[] = [];
  const kind = `This reference is a ${overview.label} (${overview.category}).`;
  const chunks = <T,>(items: T[]) => {
    const parts: T[][] = [];
    for (let i = 0; i < items.length; i += SHEETS_PER_AGENT) parts.push(items.slice(i, i + SHEETS_PER_AGENT));
    return parts.length ? parts : [[]];
  };
  const burst = sheets.bursts.map((entry) => entry.file);

  // Camera: every transition sheet is read by someone; the chart and a burst go to each part.
  const transitionParts = chunks(sheets.transitions);
  transitionParts.forEach((part, i) => {
    tasks.push({
      name: transitionParts.length > 1 ? `camera-${i + 1}` : "camera",
      role: "camera",
      images: [sheets.charts.camera, ...part.map((entry) => entry.file), ...burst.slice(i, i + 1)],
      prompt: [
        kind,
        transitionParts.length > 1 ? `You are part ${i + 1} of ${transitionParts.length}: your sheets show transitions ${part.map((entry) => `T${entry.index + 1}`).join(", ")}. Use the tables for the rest.` : "",
        section("Measured numbers", `${headline(m)}\n${cameraSummary(m)}\n${syncSummary(m)}`),
        section("Shots (camera per shot)", shotTable(m)),
        section("Transitions", transitionTable(m)),
        `Images, in order: the camera chart; ${part.length} transition sheet(s) (${part.map((entry) => `T${entry.index + 1}`).join(", ") || "none"}); ${burst[i] ? "one burst of consecutive frames" : "no burst"}.`,
      ].filter(Boolean).join("\n\n"),
    });
  });

  if (overview.hasCharacters && sheets.events.length > 0) {
    const eventParts = chunks(sheets.events);
    eventParts.forEach((part, i) => {
      tasks.push({
        name: eventParts.length > 1 ? `motion-${i + 1}` : "motion",
        role: "motion",
        images: [...part.map((entry) => entry.file), ...burst.slice(i, i + 1)],
        prompt: [
          kind,
          eventParts.length > 1 ? `You are part ${i + 1} of ${eventParts.length}.` : "",
          section("Measured numbers", `${headline(m)}\n${syncSummary(m)}\nLeftover motion while the camera holds: ${m.video.holdStillness} px/frame.`),
          section("Motion bursts on your sheets", eventTable(m, part.map((entry) => entry.index))),
          section("Shots", shotTable(m)),
          `Images, in order: ${part.length} motion sheet(s) (${part.map((entry) => `M${entry.index + 1}`).join(", ")})${burst[i] ? ", then one burst of consecutive frames" : ""}.`,
        ].filter(Boolean).join("\n\n"),
      });
    });
  }

  if (overview.hasOnScreenText || ["motion_graphics", "ai_images", "stock_footage"].includes(overview.category)) {
    tasks.push({
      name: "graphics",
      role: "graphics",
      images: [...sheets.overview.slice(0, 2), ...burst.slice(0, 2)],
      prompt: [kind, section("Measured numbers", headline(m)), section("Shots", shotTable(m)), section("Transcript", transcript(m)), "Images, in order: overview sheet(s), then bursts of consecutive frames."].join("\n\n"),
    });
  }

  tasks.push({
    name: "story",
    role: "story",
    images: [...sheets.overview.slice(0, 3), sheets.charts.audio],
    prompt: [
      kind,
      section("Measured numbers", `${headline(m)}\n${audioSummary(m)}\n${syncSummary(m)}`),
      section("Transcript", transcript(m)),
      section("Shots with their words", shotTable(m)),
      "Images, in order: overview sheet(s) (what is on screen in each shot), then the voice level and pitch chart.",
    ].join("\n\n"),
  });
  return tasks;
}

export function referenceTask(m: Measurements, overview: OverviewOutput, specialists: { task: AgentTask; output: SpecialistOutput }[]): AgentTask {
  const reports = [{ name: "overview", output: overview }, ...specialists.map((entry) => ({ name: entry.task.name, output: entry.output }))];
  return {
    name: "reference",
    role: "reference",
    images: [],
    prompt: [
      `This reference is a ${overview.label} (${overview.category}): ${overview.why}`,
      section("Measured numbers", `${headline(m)}\n${cameraSummary(m)}\n${audioSummary(m)}\n${syncSummary(m)}`),
      ...reports.map((report) => section(`Findings: ${report.name}`, JSON.stringify({ findings: report.output.findings, notes: report.output.notes, contentSpecifics: report.output.contentSpecifics }, null, 1))),
    ].join("\n\n"),
  };
}
