import type { z } from 'zod';

export * from './vocab.ts';
export * from './schema.ts';
export * from './timeline.ts';
export * from './examples.ts';

/** Turn a zod error into short `path: message` lines an AI (or a person) can act on. */
export function formatIssues(error: z.ZodError, limit = 25): string[] {
  const lines = error.issues.slice(0, limit).map((issue) => {
    const path = issue.path.length ? issue.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('').replace(/^\./, '') : '(root)';
    return `${path}: ${issue.message}`;
  });
  if (error.issues.length > limit) lines.push(`…and ${error.issues.length - limit} more`);
  return lines;
}

export const slugify = (text: string, max = 40) =>
  text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '') || 'untitled';
