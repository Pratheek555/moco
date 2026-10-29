/** Find the first balanced JSON object/array in `text`, skipping prose and code fences. */
function findBalanced(text: string, from = 0): string | null {
  const start = text.slice(from).search(/[[{]/);
  if (start < 0) return null;
  const i0 = from + start;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = i0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return null;
      if (!stack.length) return text.slice(i0, i + 1);
    }
  }
  return null;
}

/** Light repairs for the usual LLM JSON slips. */
function repair(s: string) {
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1');
}

export class JsonExtractError extends Error {
  readonly raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.raw = raw;
  }
}

/** Parse the JSON payload out of a model reply (handles fences, preambles, trailing commas). */
export function extractJson<T = unknown>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    /* fall through */
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidates = [fence?.[1], findBalanced(trimmed)].filter((c): c is string => !!c);
  for (const c of candidates) {
    for (const attempt of [c, repair(c)]) {
      try {
        return JSON.parse(attempt) as T;
      } catch {
        /* next */
      }
    }
  }
  const balanced = findBalanced(trimmed);
  const hint = balanced ? 'The JSON is malformed.' : trimmed.includes('{') ? 'The JSON was cut off before it closed.' : 'No JSON object found in the reply.';
  throw new JsonExtractError(hint, text);
}
