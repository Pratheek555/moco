import type { Question, Task } from "@moco/agent/types";
import type { ProjectEvent } from "../../shared/api.ts";
import { isPresentationTool } from "./features/project/describe-tool.ts";

interface Base { id: string; at: string; turnId?: string }
export interface TextBlock extends Base { type: "text"; role: "user" | "assistant"; text: string; files?: string[] }
export interface ThinkingStep extends Base { type: "thinking"; text: string }
export interface ToolStep extends Base { type: "tool"; toolId: string; name: string; input: unknown; result?: unknown; completed: boolean; isError: boolean; activity?: string }
export interface ActivityStep extends Base { type: "activity"; activityId: string; description: string; status: string }
export type WorkStep = ThinkingStep | ToolStep | ActivityStep;
export interface WorkBlock extends Base { type: "work"; steps: WorkStep[]; revision: number }
export interface QuestionBlock extends Base { type: "question"; questionId: string; questions: Question[]; answers?: Record<string, string> }
export type Block = TextBlock | WorkBlock | QuestionBlock
  | (Base & { type: "file"; path: string; label?: string })
  | (Base & { type: "error"; message: string })
  | (Base & { type: "stopped" })
  | (Base & { type: "turn_end"; elapsed: number; status: string });
export interface Turn { id: string; at: string; endAt?: string; status?: string }
export interface Transcript { blocks: Block[]; turns: Turn[]; delivered: string[]; tasks?: Task[] }

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
const string = (value: unknown): string => typeof value === "string" ? value : "";
const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string"))] : [];

function readQuestions(value: unknown): Question[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(raw => {
    const q = object(raw), question = string(q.question);
    if (!question) return [];
    return [{ question, header: string(q.header), multiSelect: q.multiSelect === true, options: Array.isArray(q.options) ? q.options.flatMap(rawOption => {
      const option = object(rawOption), label = string(option.label);
      return label ? [{ label, description: string(option.description) }] : [];
    }) : [] }];
  });
}

/** Persisted input is deliberately treated as untrusted: old versions and incomplete records are safe to replay. */
export function buildTranscript(records: readonly ProjectEvent[]): Transcript {
  const blocks: Block[] = [], turns: Turn[] = [], delivered: string[] = [];
  let tasks: Task[] | undefined, turn: Turn | undefined;
  const seen = new Set<string>();
  const messages = new Map<string, TextBlock | ThinkingStep>();
  const tools = new Map<string, { step: ToolStep; group: WorkBlock }>();
  const activity = new Map<string, { step: ActivityStep; group: WorkBlock }>();
  const hiddenTools = new Set<string>();
  const results = new Map<string, { content: unknown; isError: boolean }>();
  const questions = new Map<string, QuestionBlock>();
  const answers = new Map<string, Record<string, string>>();
  const thinkingGroups = new Map<string, WorkBlock>();

  function group(base: Base): WorkBlock {
    const last = blocks.at(-1);
    if (last?.type === "work" && last.turnId === base.turnId) return last;
    const next: WorkBlock = { ...base, type: "work", steps: [], revision: 0 };
    blocks.push(next);
    return next;
  }
  for (const raw of records) {
    const record = object(raw), id = string(record.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const at = string(record.at), event = object(record.event), type = string(event.type);
    // A message sent while work is running belongs to the same turn until turn_end.
    if (!turn && ["user", "text", "thinking", "tool_call", "question"].includes(type)) {
      turn = { id, at }; turns.push(turn);
    }
    const base: Base = { id, at, turnId: turn?.id };
    switch (type) {
      case "user": {
        const text = string(event.text), files = strings(event.files);
        if (text.trim() || files.length) blocks.push({ ...base, type: "text", role: "user", text, files });
        break;
      }
      case "text": case "thinking": {
        const text = string(event.text);
        if (!text) break;
        const key = `${turn?.id ?? ""}:${type}:${string(event.messageId) || id}`;
        const existing = messages.get(key);
        if (existing) {
          existing.text += text;
          const work = thinkingGroups.get(key);
          if (work) work.revision++;
        } else if (type === "text") {
          const block: TextBlock = { ...base, type, role: "assistant", text };
          blocks.push(block); messages.set(key, block);
        } else {
          const step: ThinkingStep = { ...base, type, text }, work = group(base);
          work.steps.push(step); work.revision++;
          messages.set(key, step); thinkingGroups.set(key, work);
        }
        break;
      }
      case "tool_call": {
        const toolId = string(event.id) || id, name = string(event.name);
        if (isPresentationTool(name)) {
          hiddenTools.add(toolId);
          const progress = activity.get(toolId);
          if (progress) { progress.group.steps = progress.group.steps.filter(step => step !== progress.step); progress.group.revision++; activity.delete(toolId); }
          break;
        }
        if (tools.has(toolId)) break;
        const result = results.get(toolId);
        const step: ToolStep = { ...base, type: "tool", toolId, name, input: event.input, result: result?.content, completed: !!result, isError: result?.isError ?? false };
        const work = group(base);
        const progress = activity.get(toolId);
        if (progress) {
          progress.group.steps = progress.group.steps.filter(item => item !== progress.step);
          progress.group.revision++;
          step.activity = progress.step.description;
          activity.delete(toolId);
        }
        work.steps.push(step); work.revision++; tools.set(toolId, { step, group: work });
        break;
      }
      case "tool_result": {
        const toolId = string(event.id), result = { content: event.content, isError: event.isError === true };
        results.set(toolId, result);
        const tool = tools.get(toolId);
        if (tool) { tool.step.result = result.content; tool.step.completed = true; tool.step.isError = result.isError; tool.group.revision++; }
        const progress = activity.get(toolId);
        if (progress) { progress.step.status = result.isError ? "failed" : "completed"; progress.group.revision++; }
        break;
      }
      case "activity": {
        const activityId = string(event.id) || id;
        if (hiddenTools.has(activityId)) break;
        const tool = tools.get(activityId);
        if (tool) { tool.step.activity = string(event.description); tool.group.revision++; break; }
        const old = activity.get(activityId);
        if (old) { old.step.description = string(event.description); old.step.status = string(event.status); old.group.revision++; }
        else {
          const step: ActivityStep = { ...base, type: "activity", activityId, description: string(event.description), status: string(event.status) }, work = group(base);
          work.steps.push(step); work.revision++; activity.set(activityId, { step, group: work });
        }
        break;
      }
      case "question": {
        const questionId = string(event.id) || id, items = readQuestions(event.questions);
        if (!items.length) break;
        const block: QuestionBlock = { ...base, type: "question", questionId, questions: items, answers: answers.get(questionId) };
        blocks.push(block); questions.set(questionId, block); break;
      }
      case "answer": {
        const map = Object.fromEntries(Object.entries(object(event.answers)).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
        const questionId = string(event.id);
        answers.set(questionId, map);
        const question = questions.get(questionId); if (question) question.answers = map;
        break;
      }
      case "file": {
        const path = string(event.path);
        if (path) { blocks.push({ ...base, type: "file", path, label: string(event.label) || undefined }); if (!delivered.includes(path)) delivered.push(path); }
        break;
      }
      case "tasks": {
        if (Array.isArray(event.tasks)) tasks = event.tasks.flatMap(rawTask => {
          const task = object(rawTask), subject = string(task.subject);
          return subject ? [{ id: string(task.id), subject, status: string(task.status) }] : [];
        });
        break;
      }
      case "error":
        blocks.push({ ...base, type: "error", message: string(event.message) || "Your AI could not continue." });
        break;
      case "turn_end": {
        if (turn) { turn.endAt = at; turn.status = string(event.status); }
        if (event.status === "interrupted") blocks.push({ ...base, type: "stopped" });
        const elapsed = turn ? elapsedTime(turn.at, at) : 0;
        if (event.status === "completed" && elapsed >= 30_000) blocks.push({ ...base, type: "turn_end", elapsed, status: "completed" });
        turn = undefined; break;
      }
      // Session, usage, permission and future record types have no transcript representation.
    }
  }
  return { blocks: blocks.filter(block => block.type !== "work" || block.steps.length), turns, delivered, tasks };
}

export function transcript(records: readonly ProjectEvent[]): Block[] { return buildTranscript(records).blocks; }

export function elapsedTime(start: string, end: string | number = Date.now()): number {
  const elapsed = (typeof end === "number" ? end : Date.parse(end)) - Date.parse(start);
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
}
