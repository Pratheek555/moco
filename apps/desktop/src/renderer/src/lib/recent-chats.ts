import type { SeriesSummary } from "./api.ts";

// Opening a conversation must not move the sidebar's click or keyboard targets.
// New stories appear first; navigation, status and title changes keep their order.
export function recentChats(library: SeriesSummary[], limit = 8) {
  const created = (series: SeriesSummary) => Date.parse(series.createdAt) || 0;
  return [...library].sort((a, b) => created(b) - created(a) || a.id.localeCompare(b.id)).slice(0, limit);
}
