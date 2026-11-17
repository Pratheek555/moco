/** Bounded traversal avoids walking an enormous or cyclic tool result just to open its details. */
export function formatDetail(value: unknown, limit = 20_000): { text: string; shortened: boolean } {
  let shortened = false, remaining = limit, visits = 0;
  const seen = new WeakSet<object>();
  function bounded(item: unknown, depth: number): unknown {
    if (remaining <= 0 || ++visits > 3000 || depth > 12) { shortened = true; return "…"; }
    if (typeof item === "string") {
      const next = item.slice(0, remaining);
      if (next.length < item.length) shortened = true;
      remaining -= next.length;
      return next;
    }
    if (typeof item === "bigint") return `${item}n`;
    if (item === undefined) return "";
    if (item === null || typeof item !== "object") return item;
    if (seen.has(item)) return "[Circular]";
    seen.add(item);
    if (Array.isArray(item)) {
      const result: unknown[] = [];
      for (const entry of item) { if (remaining <= 0 || visits > 3000) { shortened = true; break; } result.push(bounded(entry, depth + 1)); }
      return result;
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(item)) {
      if (remaining <= 0 || visits > 3000) { shortened = true; break; }
      remaining -= key.length;
      Object.defineProperty(result, key, { value: bounded((item as Record<string, unknown>)[key], depth + 1), enumerable: true });
    }
    return result;
  }
  try {
    const safe = bounded(value, 0);
    const serialized = typeof safe === "string" ? safe : JSON.stringify(safe, null, 2) ?? String(safe);
    return { text: serialized.slice(0, limit), shortened: shortened || serialized.length > limit };
  } catch { return { text: "Details could not be displayed.", shortened: false }; }
}
