import type { Question } from "@moco/agent/types";

export function questionAnswers(questions: readonly Question[], selected: Record<string, string[]>, other: Record<string, string>): Record<string, string> {
  return Object.fromEntries(questions.map(question => [question.question, [...selected[question.question] ?? [], ...(other[question.question]?.trim() ? [other[question.question]!.trim()] : [])].join(", ")]));
}

export function chooseOption(question: Question, current: readonly string[], label: string): string[] {
  return question.multiSelect ? current.includes(label) ? current.filter(value => value !== label) : [...current, label] : [label];
}
