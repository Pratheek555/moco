import { useState } from "react";
import { ArrowRightIcon, CheckIcon, FolderOpenIcon } from "lucide-react";
import type { SeriesPlan, ShotList } from "@moco/spec";
import { api, type SeriesStatus } from "@/lib/api";
import { useAsync } from "@/lib/async";
import { report, useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { PublishPanel } from "./PublishPanel";
import { NextEpisode } from "./RepeatEpisode";

export function StudioDelivery({ status, episode, nextEpisode }: {
  status: SeriesStatus; episode: SeriesPlan["episodes"][number]; nextEpisode?: SeriesPlan["episodes"][number];
}) {
  const version = useApp(s => s.version);
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useAsync(async () => {
    const [media, list] = await Promise.all([
      api.episode.media(status.series.id, episode.id),
      api.series.artifact(status.series.id, `episodes/${episode.id}/artifacts/shot_list.json`),
    ]);
    return { media, shots: (list?.data as ShotList | undefined)?.shots ?? [] };
  }, [status.series.id, episode.id, version]);
  const startNext = async () => {
    if (!nextEpisode || busy) return;
    setBusy(true);
    try { await api.stages.run(status.series.id); } catch (e) { report(e); } finally { setBusy(false); }
  };
  return <div className="generation-delivery">
    <header><span className="generation-state-label"><CheckIcon />Ready to publish</span><h2>{episode.title}</h2><p>Watch the final cut, then take it to YouTube.</p></header>
    <div className="generation-delivery-content">
      {error ? <div role="alert"><p>{error}</p><Button variant="outline" onClick={reload}>Reload publishing help</Button></div> : !data ? <Spinner aria-label="Loading publishing help" /> : <>
        {data.media.final && <video src={data.media.final} controls aria-label="Finished episode" />}
        {data.media.finalPath && <Button variant="outline" onClick={() => void api.app.showItem(data.media.finalPath!).catch(report)}><FolderOpenIcon />Show video file</Button>}
        <PublishPanel seriesId={status.series.id} episodeId={episode.id} language={status.series.language}
          finalPath={data.media.finalPath} thumbnail={{ url: data.media.thumbnail, path: data.media.thumbnailPath }} shots={data.shots} stills={data.media.stills} running={Boolean(status.activeJob)} />
      </>}
    </div>
    <footer className="generation-sidebar-footer">
      {status.series.production ? <NextEpisode status={status} /> : nextEpisode ? <><p>The next episode starts when you’re ready.</p><Button disabled={busy || Boolean(status.activeJob)} onClick={() => void startNext()}>{busy ? <Spinner /> : <ArrowRightIcon />}Start episode {Number(nextEpisode.id.slice(3))}</Button></>
        : <p>All episodes are complete. Your videos and publishing details are saved.</p>}
    </footer>
  </div>;
}
