// One episode: its shots with their stills, the latest render, redoing a single shot with a note,
// and the YouTube details for publishing it.
import { useState } from "react";
import {
  ArrowRightIcon,
  FileVideoIcon,
  FilmIcon,
  FolderOpenIcon,
  MessageSquareIcon,
  PlayIcon,
  RefreshCwIcon,
} from "lucide-react";
import type { EpisodeScript, SeriesPlan, ShotList } from "@moco/spec";
import { api } from "@/lib/api.ts";
import { useAsync } from "@/lib/async.ts";
import { report, stageLabel, useApp } from "@/lib/store.ts";
import { humanize, pad2, seconds } from "@/lib/format.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel, FieldSet } from "@/components/ui/field";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageError, PageLoading } from "../components/Page.tsx";
import { PublishPanel } from "../components/PublishPanel.tsx";
import { RepeatEpisodePanel } from "../components/RepeatEpisode";

// "ep-01/voiceover" → "voiceover": the episode is already on screen.
const stepOf = (key: string) => stageLabel(key).replace(/^Episode \d+ /, "");

export function EpisodePage({ seriesId, episodeId }: { seriesId: string; episodeId: string }) {
  const version = useApp((s) => s.version),
    go = useApp((s) => s.go);
  const { data, error } = useAsync(async () => {
    const read = (file: string) => api.series.artifact(seriesId, file);
    const [status, plan, script, shots, media] = await Promise.all([
      api.series.status(seriesId),
      read("artifacts/series_plan.json"),
      read(`episodes/${episodeId}/artifacts/script.json`),
      read(`episodes/${episodeId}/artifacts/shot_list.json`),
      api.episode.media(seriesId, episodeId),
    ]);
    return {
      status,
      plan: plan?.data as SeriesPlan | undefined,
      script: script?.data as EpisodeScript | undefined,
      shots: (shots?.data as ShotList | undefined)?.shots ?? [],
      media,
    };
  }, [seriesId, episodeId, version]);
  const [selected, setSelected] = useState(0),
    [tab, setTab] = useState("shot"),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  const toSeries = () => go({ name: "series", id: seriesId });
  if (error)
    return (
      <PageError
        title="Couldn’t open this episode"
        detail={error}
        action={{ label: "Back to the series", run: toSeries }}
      />
    );
  if (!data) return <PageLoading label="Opening episode…" />;
  const { status, plan, script, shots, media } = data;
  const number = Number(episodeId.replace(/\D/g, ""));
  const episode = plan?.episodes.find((ep) => ep.id === episodeId);
  const running = status.activeJob !== undefined;
  const scenesDone = status.stages.find((s) => s.key === `${episodeId}/scenes`)?.status === "done";
  const here = (key: string) => key.startsWith(`${episodeId}/`);
  const nextHere = status.next.kind === "run" && here(status.next.key) ? status.next.key : undefined;
  const reviewHere =
    status.next.kind === "waiting" && status.next.status === "awaiting_approval" && here(status.next.key)
      ? status.next.key
      : undefined;
  const shot = shots[selected];
  const video = media.final ?? media.preview;
  const total = shots.at(-1)?.end;

  const regenerate = async () => {
    if (!shot) return;
    setBusy(true);
    try {
      await api.episode.regenerateShot(seriesId, episodeId, shot.id, note.trim() || undefined);
      setNote("");
      useApp.getState().toast(`Redoing ${humanize(shot.id)}`, "success", {
        description: "Render the preview again afterwards to see it in the episode.",
      });
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="studio-episode dark flex min-h-0 flex-1 flex-col animate-in fade-in-0 duration-200">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b px-6 py-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs font-medium text-muted-foreground">Episode {number}</span>
          <h1 className="truncate text-lg font-semibold tracking-tight">{episode?.title ?? episodeId}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {reviewHere ? (
            <Button onClick={toSeries}>
              <MessageSquareIcon data-icon="inline-start" />
              Review the {stepOf(reviewHere)}
            </Button>
          ) : (
            <Button variant="outline" onClick={toSeries}>
              Series overview
            </Button>
          )}
          {nextHere && (
            <Button disabled={running} onClick={() => void api.stages.run(seriesId, nextHere).catch(report)}>
              <PlayIcon data-icon="inline-start" />
              Continue: {stepOf(nextHere)}
            </Button>
          )}
        </div>
      </header>
      {running && (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b bg-muted/50 px-6 py-2 text-sm text-muted-foreground">
          <Spinner aria-hidden />
          Moco is working on this series. Redoing shots is paused until it finishes.
        </div>
      )}

      {status.repeatEpisodes?.[episodeId] && <div className="max-h-96 shrink-0 overflow-y-auto border-b p-4"><RepeatEpisodePanel status={status} episodeId={episodeId} onReview={toSeries} /></div>}
      <div className="studio-edit-layout grid min-h-0 flex-1 grid-cols-[11rem_minmax(0,1fr)_18rem] xl:grid-cols-[14rem_minmax(0,1fr)_22rem]">
        <aside className="flex min-h-0 flex-col border-r">
          <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
            <h2 className="text-sm font-semibold">
              Shots <span className="font-normal text-muted-foreground tabular-nums">{shots.length}</span>
            </h2>
            {total !== undefined && (
              <Badge variant="secondary" className="tabular-nums">
                {seconds(total)}
              </Badge>
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-3">
            {shots.length === 0 && (
              <p className="px-2 text-sm text-muted-foreground">Shots appear once the shot list is made.</p>
            )}
            {shots.map((s, i) => {
              const still = media.stills[s.id]?.[0];
              return (
                <Item key={s.id} asChild size="sm" data-active={selected === i} className="items-start gap-3 px-2">
                  <button aria-current={selected === i} onClick={() => setSelected(i)}>
                    <ItemMedia variant="image" className="h-16 w-9 rounded-md border">
                      {still ? (
                        <img src={still} alt="" />
                      ) : (
                        <span className="flex size-full items-center justify-center bg-muted text-xs font-medium text-muted-foreground tabular-nums">
                          {pad2(i + 1)}
                        </span>
                      )}
                    </ItemMedia>
                    <ItemContent className="min-w-0 gap-0.5">
                      <ItemTitle className="w-full">
                        <span className="truncate">{humanize(s.id)}</span>
                      </ItemTitle>
                      <span className="truncate text-xs text-muted-foreground tabular-nums">
                        {humanize(s.location)} · {seconds(s.end - s.start)}
                      </span>
                      <ItemDescription className="mt-0.5">{s.intent}</ItemDescription>
                    </ItemContent>
                  </button>
                </Item>
              );
            })}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col gap-4 bg-muted/40 p-6">
          <div className="flex items-center justify-between gap-3">
            <Badge variant={media.final ? "default" : "outline"}>
              {media.final ? "Final render" : media.preview ? "Preview" : "Not rendered yet"}
            </Badge>
            <span className="text-xs text-muted-foreground tabular-nums">9:16 · 1080 × 1920</span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {video ? (
              <video
                key={video}
                src={video}
                controls
                className="aspect-[9/16] h-full max-w-full rounded-xl bg-black shadow-lg"
              />
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FilmIcon />
                  </EmptyMedia>
                  <EmptyTitle>Nothing to play yet</EmptyTitle>
                  <EmptyDescription>The preview renders once every shot is written.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
          <p className="text-center text-xs text-muted-foreground tabular-nums">
            {shots.length} {shots.length === 1 ? "shot" : "shots"} · {seconds(total)}
          </p>
        </section>

        <aside className="flex min-h-0 flex-col border-l">
          <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
            <div className="border-b p-3">
              <TabsList className="w-full">
                <TabsTrigger value="shot">Shot</TabsTrigger>
                <TabsTrigger value="script">Script</TabsTrigger>
                <TabsTrigger value="exports">Exports</TabsTrigger>
                <TabsTrigger value="publish">Publish</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="shot" className="min-h-0 overflow-y-auto">
              {shot ? (
                <div className="flex flex-col gap-5 p-5">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="text-base font-semibold">{humanize(shot.id)}</h2>
                      <Badge variant="secondary" className="tabular-nums">
                        {seconds(shot.end - shot.start)}
                      </Badge>
                    </div>
                    <p className="text-sm leading-relaxed text-pretty select-text">{shot.intent}</p>
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                    <dt className="text-muted-foreground">Cast</dt>
                    <dd>{shot.characters.map(humanize).join(", ") || "No characters"}</dd>
                    <dt className="text-muted-foreground">Location</dt>
                    <dd>{humanize(shot.location)}</dd>
                    {shot.cameraHint && (
                      <>
                        <dt className="text-muted-foreground">Camera</dt>
                        <dd>{shot.cameraHint}</dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">Time</dt>
                    <dd className="tabular-nums">
                      {seconds(shot.start)} – {seconds(shot.end)}
                    </dd>
                  </dl>
                  {(media.stills[shot.id] ?? []).length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {media.stills[shot.id]!.map((url) => (
                        <img
                          key={url}
                          src={url}
                          alt={`${humanize(shot.id)} still`}
                          className="aspect-[9/16] w-full rounded-lg border object-cover"
                        />
                      ))}
                    </div>
                  )}
                  <Separator />
                  <FieldSet disabled={running || !scenesDone} className="gap-3">
                    <Field data-disabled={running || !scenesDone}>
                      <FieldLabel htmlFor="shot-note">Redo this shot</FieldLabel>
                      <Textarea
                        id="shot-note"
                        rows={3}
                        placeholder="e.g. “Closer on the hero, slower camera.”"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <FieldDescription>
                        {scenesDone
                          ? "The AI rewrites only this shot. Render the preview again afterwards."
                          : "You can redo a shot once every scene is written."}
                      </FieldDescription>
                    </Field>
                    <Button variant="outline" className="self-start" disabled={busy} onClick={() => void regenerate()}>
                      {busy ? <Spinner data-icon="inline-start" aria-hidden /> : <RefreshCwIcon data-icon="inline-start" />}
                      Redo shot
                    </Button>
                  </FieldSet>
                </div>
              ) : (
                <InspectorEmpty title="No shots yet" detail="Shots appear once the shot list is made." />
              )}
            </TabsContent>

            <TabsContent value="script" className="min-h-0 overflow-y-auto">
              {script ? (
                <ol className="flex flex-col gap-4 p-5 select-text">
                  {script.lines.map((line) => (
                    <li key={line.id} className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium text-muted-foreground">
                        {humanize(line.beat)}
                        {line.speaker !== "narrator" && ` · ${humanize(line.speaker)}`}
                      </span>
                      <p className="text-sm leading-relaxed text-pretty">{line.text}</p>
                        <span className="text-xs text-muted-foreground">{line.text.trim().split(/\s+/).length} words{script.shotPlan?.find(shot => shot.lineId === line.id) && ` · ~${script.shotPlan.find(shot => shot.lineId === line.id)!.seconds}s`}</span>
                        {script.shotPlan?.filter(shot => shot.lineId === line.id).map(shot => <p key={shot.lineId} className="text-xs text-muted-foreground">{shot.picture}</p>)}
                    </li>
                  ))}
                </ol>
              ) : (
                <InspectorEmpty
                  title="No script yet"
                  detail="The script is written after the series bible is approved."
                />
              )}
            </TabsContent>

            <TabsContent value="exports" className="min-h-0 overflow-y-auto">
              {media.final ? (
                <div className="flex flex-col gap-3 p-5">
                  <Item variant="outline">
                    <ItemMedia variant="icon">
                      <FileVideoIcon />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>final.mp4</ItemTitle>
                      <ItemDescription>1080 × 1920, ready for Reels and Shorts.</ItemDescription>
                    </ItemContent>
                  </Item>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void api.app.showItem(media.finalPath!).catch(report)}
                    >
                      <FolderOpenIcon data-icon="inline-start" />
                      Show in folder
                    </Button>
                    <Button size="sm" onClick={() => setTab("publish")}>
                      Publish to YouTube
                      <ArrowRightIcon data-icon="inline-end" />
                    </Button>
                  </div>
                </div>
              ) : (
                <InspectorEmpty
                  title="No export yet"
                  detail="The final MP4 renders after you approve the preview."
                />
              )}
            </TabsContent>

            <TabsContent value="publish" className="min-h-0 overflow-y-auto">
              <div className="p-5">
                <PublishPanel
                  seriesId={seriesId}
                  episodeId={episodeId}
                  language={status.series.language}
                  finalPath={media.finalPath}
                  thumbnail={{ url: media.thumbnail, path: media.thumbnailPath }}
                  shots={shots}
                  stills={media.stills}
                  running={running}
                />
              </div>
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}

function InspectorEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <Empty className="p-6 md:p-6">
      <EmptyHeader>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        <EmptyDescription>{detail}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
