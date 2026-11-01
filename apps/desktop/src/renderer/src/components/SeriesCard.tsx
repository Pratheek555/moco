import { CheckIcon } from "lucide-react";
import type { SeriesSummary } from "@/lib/api.ts";
import { stageLabel, useApp } from "@/lib/store.ts";
import { languageName, timeAgo } from "@/lib/format.ts";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { CastArt } from "./CastArt.tsx";

export function SeriesCard({ series }: { series: SeriesSummary }) {
  const go = useApp((s) => s.go);
  return (
    <Card className="relative gap-4 overflow-hidden pt-0 transition-shadow hover:shadow-md has-[[data-card-link]:focus-visible]:ring-[3px] has-[[data-card-link]:focus-visible]:ring-ring/50">
      <div className="cast-backdrop relative h-40 border-b">
        <CastArt
          characters={series.cast.length ? series.cast : undefined}
          className="absolute inset-x-0 bottom-0 mx-auto h-44 w-full"
        />
        <Badge variant="secondary" className="absolute top-3 left-3">
          {languageName(series.language)}
        </Badge>
      </div>
      <CardHeader className="gap-1.5">
        <CardTitle className="truncate leading-snug">
          {/* One link for the whole card: its ::after covers the card. */}
          <button
            data-card-link
            className="text-left outline-none after:absolute after:inset-0"
            onClick={() => go({ name: "series", id: series.id })}
          >
            {series.title}
          </button>
        </CardTitle>
        <CardDescription className="line-clamp-2 min-h-10">{series.premise}</CardDescription>
      </CardHeader>
      <CardFooter className="mt-auto justify-between gap-3">
        <SeriesState series={series} />
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {series.episodes} {series.episodes === 1 ? "episode" : "episodes"} · {timeAgo(series.createdAt)}
        </span>
      </CardFooter>
    </Card>
  );
}

// Where the series is, in one badge: what the user would want to know before opening it.
function SeriesState({ series }: { series: SeriesSummary }) {
  if (series.running)
    return (
      <Badge variant="secondary">
        <Spinner aria-hidden />
        Working
      </Badge>
    );
  if (series.next.kind === "finished")
    return (
      <Badge variant="outline">
        <CheckIcon />
        {series.finals > 0 ? `${series.finals} exported` : "Finished"}
      </Badge>
    );
  if (series.next.kind === "waiting" && series.next.status === "awaiting_approval")
    return <Badge>Ready for review</Badge>;
  return (
    <Badge variant="outline" className="min-w-0 shrink">
      <span className="truncate">Next: {stageLabel(series.next.key)}</span>
    </Badge>
  );
}
