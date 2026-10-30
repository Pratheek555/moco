// Validation issues, written for the model: where, what's wrong, what's allowed, how to fix.
export interface Issue {
  path: string; // JSON path, e.g. "actors[0].actions[1].name"
  problem: string;
  allowed?: string[];
  fix?: string;
}

const MAX_ALLOWED_SHOWN = 12;

// One issue → one line, e.g.
// actors[0].actions[1].name: "jump" is not in krishna's rig. Allowed: blink, raise_hand. Pick one.
export function formatIssue(issue: Issue): string {
  const parts = [`${issue.path || "(root)"}: ${issue.problem}.`];
  if (issue.allowed) parts.push(`Allowed: ${formatAllowed(issue.allowed)}.`);
  if (issue.fix) parts.push(issue.fix);
  return parts.join(" ");
}

function formatAllowed(allowed: string[]): string {
  const shown = allowed.slice(0, MAX_ALLOWED_SHOWN).join(", ");
  const hidden = allowed.length - MAX_ALLOWED_SHOWN;
  return hidden > 0 ? `${shown} (+${hidden} more)` : shown || "(none)";
}

// The top N issues as a bullet list for the retry prompt.
export function formatIssues(issues: Issue[], max = 8): string {
  const lines = issues.slice(0, max).map((issue) => `- ${formatIssue(issue)}`);
  const hidden = issues.length - max;
  if (hidden > 0) lines.push(`- …and ${hidden} more issues.`);
  return lines.join("\n");
}

// Zod issue path [ "actors", 0, "name" ] → "actors[0].name"
export function jsonPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((out, part) => {
    if (typeof part === "number") return `${out}[${part}]`;
    return out ? `${out}.${String(part)}` : String(part);
  }, "");
}
