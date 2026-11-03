// How much of the user's own Claude plan Moco has used: requests and tokens per day and per series,
// and how often the plan limit stopped a run. Read from each series' ledger via the library summary.
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { ChartColumnIcon, PlusIcon } from "lucide-react";
import { api, type DailyUsage, type EngineEvent, type SeriesSummary } from "@/lib/api.ts";
import { newSeries, report, useApp } from "@/lib/store.ts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Page, PageHeader } from "../components/Page.tsx";

type Range = "7" | "30" | "all";
type Metric = "calls" | "tokens";

const RANGES: { value: Range; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "all", label: "All time" },
];

const chartConfig = {
  calls: { label: "Requests", color: "var(--primary)" },
  tokens: { label: "Tokens", color: "var(--primary)" },
} satisfies ChartConfig;

const SERIES_SHOWN = 5; // the rest fold into "Other series"

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat();
const usd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

// Same key the engine writes: the local date, "2026-11-03".
function localDate(at: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
const parseDay = (key: string) => new Date(`${key}T00:00:00`);
const shortDay = (key: string) => parseDay(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const longDay = (key: string) =>
  parseDay(key).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

// The days the range covers, oldest first. "All time" starts at the first day any series recorded.
function rangeDays(range: Range, library: SeriesSummary[]): string[] {
  const today = new Date();
  let count = Number(range);
  if (range === "all") {
    const first = library
      .flatMap((s) => Object.keys(s.usage.daily ?? {}))
      .sort()[0];
    if (!first) return [];
    count = Math.round((parseDay(localDate(today)).getTime() - parseDay(first).getTime()) / 86_400_000) + 1;
  }
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (count - 1 - i));
    return localDate(day);
  });
}

const tokensOf = (day: DailyUsage) => day.inputTokens + day.outputTokens;

interface Totals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsdEstimate: number;
  rateLimits: number;
}

// One series' usage in the range. "All time" uses the lifetime counters, which predate the daily rows.
function seriesTotals(series: SeriesSummary, range: Range, days: Set<string>): Totals {
  const rows = Object.entries(series.usage.daily ?? {}).filter(([key]) => range === "all" || days.has(key));
  const sum = (pick: (day: DailyUsage) => number) => rows.reduce((total, [, day]) => total + pick(day), 0);
  if (range === "all")
    return {
      calls: Object.values(series.usage.aiCalls).reduce((a, b) => a + b, 0),
      inputTokens: series.usage.tokens?.input ?? sum((d) => d.inputTokens),
      outputTokens: series.usage.tokens?.output ?? sum((d) => d.outputTokens),
      costUsdEstimate: series.usage.costUsdEstimate,
      rateLimits: sum((d) => d.rateLimits),
    };
  return {
    calls: sum((d) => d.calls),
    inputTokens: sum((d) => d.inputTokens),
    outputTokens: sum((d) => d.outputTokens),
    costUsdEstimate: sum((d) => d.costUsdEstimate),
    rateLimits: sum((d) => d.rateLimits),
  };
}

export function UsagePage() {
  const library = useApp((s) => s.library),
    go = useApp((s) => s.go);
  const [range, setRange] = useState<Range>("30"),
    [metric, setMetric] = useState<Metric>("calls");

  // Fresh numbers on open, then again shortly after each AI call while the page is up.
  useEffect(() => {
    void useApp.getState().refreshLibrary().catch(report);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = api.on("engine", (payload) => {
      if ((payload as EngineEvent).type !== "usage.updated") return;
      clearTimeout(timer);
      timer = setTimeout(() => void useApp.getState().refreshLibrary().catch(report), 1500);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);

  const { days, daily, perSeries, totals } = useMemo(() => {
    const days = rangeDays(range, library);
    const inRange = new Set(days);
    const daily = days.map((date) => {
      const rows = library.map((s) => s.usage.daily?.[date]).filter((d): d is DailyUsage => d !== undefined);
      return {
        date,
        calls: rows.reduce((total, d) => total + d.calls, 0),
        tokens: rows.reduce((total, d) => total + tokensOf(d), 0),
      };
    });
    const each = library.map((series) => ({ series, ...seriesTotals(series, range, inRange) }));
    const totals = each.reduce<Totals>(
      (sum, s) => ({
        calls: sum.calls + s.calls,
        inputTokens: sum.inputTokens + s.inputTokens,
        outputTokens: sum.outputTokens + s.outputTokens,
        costUsdEstimate: sum.costUsdEstimate + s.costUsdEstimate,
        rateLimits: sum.rateLimits + s.rateLimits,
      }),
      { calls: 0, inputTokens: 0, outputTokens: 0, costUsdEstimate: 0, rateLimits: 0 },
    );
    const perSeries = each
      .map((s) => ({ id: s.series.id, title: s.series.title, calls: s.calls, tokens: s.inputTokens + s.outputTokens }))
      .filter((s) => s[metric] > 0)
      .sort((a, b) => b[metric] - a[metric]);
    const rest = perSeries.slice(SERIES_SHOWN);
    if (rest.length > 1)
      perSeries.splice(SERIES_SHOWN, rest.length, {
        id: "",
        title: `${rest.length} other series`,
        calls: rest.reduce((total, s) => total + s.calls, 0),
        tokens: rest.reduce((total, s) => total + s.tokens, 0),
      });
    return { days, daily, perSeries, totals };
  }, [library, range, metric]);

  const everUsed = library.some((s) => Object.values(s.usage.aiCalls).some((n) => n > 0));
  const label = chartConfig[metric].label.toLowerCase();
  const format = (n: number) => (metric === "tokens" ? compact.format(n) : whole.format(n));

  return (
    <Page>
      <PageHeader
        title="Usage"
        description="How much of your Claude plan Moco has used. Moco runs on your own plan, so nothing here is billed by Moco."
        actions={
          everUsed && (
            <>
              <ToggleGroup
                type="single"
                variant="outline"
                aria-label="Measure"
                value={metric}
                onValueChange={(value) => value && setMetric(value as Metric)}
              >
                <ToggleGroupItem value="calls">Requests</ToggleGroupItem>
                <ToggleGroupItem value="tokens">Tokens</ToggleGroupItem>
              </ToggleGroup>
              <ToggleGroup
                type="single"
                variant="outline"
                aria-label="Time range"
                value={range}
                onValueChange={(value) => value && setRange(value as Range)}
              >
                {RANGES.map((r) => (
                  <ToggleGroupItem key={r.value} value={r.value}>
                    {r.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </>
          )
        }
      />

      {!everUsed ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartColumnIcon />
            </EmptyMedia>
            <EmptyTitle>No Claude usage yet</EmptyTitle>
            <EmptyDescription>
              Each time Moco plans, writes or fixes a scene it asks Claude. Those requests show up here.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={newSeries}>
              <PlusIcon data-icon="inline-start" />
              Start a series
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Claude requests" value={whole.format(totals.calls)} note="Plans, scripts, scenes and fixes" />
            <Stat
              label="Tokens"
              value={compact.format(totals.inputTokens + totals.outputTokens)}
              note={`${compact.format(totals.inputTokens)} read · ${compact.format(totals.outputTokens)} written`}
            />
            <Stat
              label="Plan limit reached"
              value={whole.format(totals.rateLimits)}
              note={totals.rateLimits === 1 ? "time a run had to wait" : "times a run had to wait"}
            />
            <Stat
              label="Pay-as-you-go value"
              value={usd.format(totals.costUsdEstimate)}
              note="Claude’s estimate at API prices; your plan covers it"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{chartConfig[metric].label} per day</CardTitle>
              <CardDescription>
                {days.length > 0
                  ? `${shortDay(days[0]!)} – ${shortDay(days.at(-1)!)}`
                  : "Daily history starts from this version of Moco"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
                <BarChart accessibilityLayer data={daily} margin={{ left: 4, right: 4 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={24}
                    tickFormatter={shortDay}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    allowDecimals={false}
                    tickFormatter={(n: number) => compact.format(n)}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_, payload) => longDay(String(payload[0]?.payload.date))}
                        formatter={(value) => (
                          <div className="flex w-full justify-between gap-4">
                            <span className="text-muted-foreground">{chartConfig[metric].label}</span>
                            <span className="font-mono font-medium tabular-nums">{whole.format(Number(value))}</span>
                          </div>
                        )}
                      />
                    }
                  />
                  <Bar dataKey={metric} fill={`var(--color-${metric})`} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>By series</CardTitle>
              <CardDescription>Where your {label} went in this period</CardDescription>
            </CardHeader>
            <CardContent>
              {perSeries.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No {label} in this period.</p>
              ) : (
                <ChartContainer
                  config={chartConfig}
                  className="aspect-auto w-full"
                  style={{ height: perSeries.length * 44 + 8 }}
                >
                  <BarChart
                    accessibilityLayer
                    data={perSeries}
                    layout="vertical"
                    margin={{ left: 0, right: 56 }}
                    onClick={(state) => {
                      const id = perSeries[Number(state?.activeTooltipIndex)]?.id;
                      if (id) go({ name: "series", id });
                    }}
                  >
                    <YAxis
                      dataKey="title"
                      type="category"
                      tickLine={false}
                      axisLine={false}
                      width={180}
                      tickFormatter={(title: string) => (title.length > 26 ? `${title.slice(0, 25)}…` : title)}
                    />
                    <XAxis type="number" dataKey={metric} hide />
                    <ChartTooltip
                      cursor={{ fill: "var(--muted)" }}
                      content={
                        <ChartTooltipContent
                          hideIndicator
                          formatter={(value) => (
                            <div className="flex w-full justify-between gap-4">
                              <span className="text-muted-foreground">{chartConfig[metric].label}</span>
                              <span className="font-mono font-medium tabular-nums">{whole.format(Number(value))}</span>
                            </div>
                          )}
                        />
                      }
                    />
                    <Bar dataKey={metric} fill={`var(--color-${metric})`} radius={4} barSize={24} className="cursor-pointer">
                      <LabelList
                        dataKey={metric}
                        position="right"
                        offset={8}
                        className="fill-foreground tabular-nums"
                        fontSize={12}
                        formatter={(value: unknown) => format(Number(value))}
                      />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </Page>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card className="gap-1">
      <CardHeader className="gap-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{note}</CardContent>
    </Card>
  );
}
