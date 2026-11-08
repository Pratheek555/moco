import { useState } from "react";
import { ArrowRightIcon, RefreshCwIcon } from "lucide-react";
import type { RepeatReuse } from "@moco/engine";
import type { Critique, ShotList } from "@moco/spec";
import { api, type SeriesStatus } from "@/lib/api";
import { useAsync } from "@/lib/async";
import { report, useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

const number = (episode: string) => Number(episode.replace(/\D/g, ""));

export function ReuseSummary({ reuse, sourceEpisodeId }: { reuse: RepeatReuse; sourceEpisodeId: string }) {
  return <details className="rounded-lg border p-3 text-sm">
    <summary className="cursor-pointer font-medium">Reusing your approved series setup · episode {number(sourceEpisodeId)}</summary>
    <dl className="mt-3 grid gap-2">
      <div><dt className="font-medium">Characters</dt><dd>{reuse.cast.join(", ")}</dd></div>
      <div><dt className="font-medium">Voices</dt><dd>{reuse.voices.join(", ")}</dd></div>
      <div><dt className="font-medium">Visual style</dt><dd>{reuse.look}</dd></div>
      <div><dt className="font-medium">Artwork and format</dt><dd>{reuse.designFiles} saved design files · {reuse.format.width} × {reuse.format.height} · {reuse.format.fps} fps</dd></div>
      {reuse.rules.length > 0 && <div><dt className="font-medium">Series rules</dt><dd><ul className="list-disc pl-5">{reuse.rules.map((rule, i) => <li key={i}>{rule}</li>)}</ul></dd></div>}
    </dl>
  </details>;
}

export function NextEpisode({ status }: { status: SeriesStatus }) {
  const version = useApp(s => s.version);
  const { data: offer, error, reload } = useAsync(() => api.series.repeatOffer(status.series.id), [status.series.id, version]);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const running = Boolean(status.activeJob);
  const launch = async () => {
    if (!offer?.available || busy || running || (!offer.nextEpisode && !topic.trim())) return;
    setBusy(true);
    try {
      await api.series.repeat(status.series.id, offer.nextEpisode ? {} : { topic: topic.trim() });
      setTopic("");
    } catch (e) { report(e); } finally { setBusy(false); }
  };
  return <Card aria-label="Next episode">
    <CardHeader>
      <CardTitle>Next episode</CardTitle>
      <CardDescription>Keep your series setup. Review the script, then the video.</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      {error ? <div role="alert"><p>{error}</p><Button variant="outline" onClick={reload}>Reload next episode</Button></div>
        : !offer ? <Spinner aria-label="Checking series setup" />
        : <>
          {offer.reuse && offer.sourceEpisodeId && <ReuseSummary reuse={offer.reuse} sourceEpisodeId={offer.sourceEpisodeId} />}
          {!offer.available ? <p role="status" className="text-sm text-muted-foreground">{offer.reason}</p>
            : offer.nextEpisode ? <div className="text-sm"><p className="font-medium">Episode {number(offer.nextEpisode.id)}: {offer.nextEpisode.title}</p><p>{offer.nextEpisode.synopsis}</p><p className="mt-2 text-muted-foreground">Finish your planned episodes before adding a new topic.</p></div>
              : <Field><FieldLabel htmlFor={`repeat-topic-${status.series.id}`}>What should the next episode explain?</FieldLabel><Textarea id={`repeat-topic-${status.series.id}`} value={topic} onChange={event => setTopic(event.target.value)} maxLength={2000} rows={3} disabled={busy || running} placeholder="e.g. Why do we get hiccups?" /><FieldDescription>The outline and script come back together for your approval.</FieldDescription></Field>}
          <Button className="self-start" disabled={!offer.available || busy || running || (!offer.nextEpisode && !topic.trim())} onClick={() => void launch()}>
            {busy ? <Spinner /> : <ArrowRightIcon />} {offer.nextEpisode ? `Start episode ${number(offer.nextEpisode.id)}` : "Create next episode"}
          </Button>
          {!offer.available && status.next.kind === "run" && status.next.key.endsWith("/script") && <Button variant="outline" disabled={busy || running} onClick={() => void api.stages.run(status.series.id).catch(report)}>Continue planned episode</Button>}
        </>}
    </CardContent>
  </Card>;
}

export function RepeatEpisodePanel({ status, episodeId, onReview }: { status: SeriesStatus; episodeId: string; onReview?: () => void }) {
  const version = useApp(s => s.version);
  const record = status.repeatEpisodes?.[episodeId];
  const { data, error, reload } = useAsync(async () => {
    if (!record) return null;
    const [critique, list, media] = await Promise.all([
      api.series.artifact(status.series.id, `episodes/${episodeId}/artifacts/critique.json`),
      api.series.artifact(status.series.id, `episodes/${episodeId}/artifacts/shot_list.json`),
      api.episode.media(status.series.id, episodeId),
    ]);
    return { critique: critique?.data as Critique | undefined, shots: (list?.data as ShotList | undefined)?.shots ?? [], media };
  }, [status.series.id, episodeId, Boolean(record), version]);
  const [busy, setBusy] = useState(false);
  if (!record) return null;
  const running = Boolean(status.activeJob);
  const next = status.next;
  const here = (key: string) => key.startsWith(`${episodeId}/`) || (record.outlinePending && key === "series_plan");
  const waiting = next.kind === "waiting" && next.status === "awaiting_approval" && here(next.key);
  const failed = status.stages.find(stage => here(stage.key) && stage.status === "failed");
  const quality = data?.critique?.quality;
  const warnings = status.decisions.filter(decision => decision.subject === episodeId && decision.category === "duration_off_target").slice(-1);
  const issues = [...new Set([...(failed?.error ? [failed.error.message] : []), ...(quality?.status === "needs_attention" ? quality.unresolved : []), ...warnings.map(warning => warning.detail)])];
  const canInspect = status.stages.some(stage => stage.key === `${episodeId}/scenes` && stage.status === "failed") && Boolean(data?.shots.length) && data!.shots.every(shot => data!.media.savedShots?.includes(shot.id));
  const work = async (run: () => Promise<unknown>) => {
    if (running || busy) return;
    setBusy(true);
    try { await run(); } catch (e) { report(e); } finally { setBusy(false); }
  };
  return <Card aria-label={`Episode ${number(episodeId)} repeat workflow`}>
    <CardHeader><CardTitle>Episode {number(episodeId)}</CardTitle><CardDescription>{record.outlinePending ? "Outline and script need your approval before production." : "Your saved series setup carries into this episode."}</CardDescription></CardHeader>
    <CardContent className="flex flex-col gap-3">
      <ReuseSummary reuse={record.reuse} sourceEpisodeId={record.sourceEpisodeId} />
      {error && <div role="alert"><p>Could not load episode checks: {error}</p><Button variant="outline" onClick={reload}>Reload episode checks</Button></div>}
      {issues.length > 0 && <div role="alert" className="rounded-lg border p-3 text-sm"><p className="font-medium">Needs attention</p><ul className="mt-2 list-disc space-y-1 pl-5">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul><p className="mt-2 text-muted-foreground">Final export waits for passing quality checks and your video approval.</p></div>}
      {data?.media.preview && !data.media.final && <div><p className="mb-2 text-sm font-medium">{quality?.status === "needs_attention" ? "Inspection preview" : "Video preview"}</p><video src={data.media.preview} controls aria-label={`Episode ${number(episodeId)} preview`} className="max-h-80 w-full rounded-lg bg-black" /></div>}
      <div className="flex flex-wrap gap-2">
        {waiting && onReview && <Button disabled={running || busy} onClick={onReview}>Review {next.key.endsWith("/script") ? record.outlinePending ? "outline and script" : "script" : "video"}</Button>}
        {next.kind === "run" && here(next.key) && <Button disabled={running || busy} onClick={() => void work(() => api.stages.run(status.series.id))}>{busy ? <Spinner /> : <RefreshCwIcon />}{failed ? "Retry saved work" : "Resume episode"}</Button>}
        {canInspect && <Button variant="outline" disabled={running || busy} onClick={() => void work(() => api.episode.inspect(status.series.id, episodeId))}>Watch inspection preview</Button>}
      </div>
      {running && <p role="status" className="text-sm text-muted-foreground">Working on your episode. Completed work is saved for retry.</p>}
    </CardContent>
  </Card>;
}
