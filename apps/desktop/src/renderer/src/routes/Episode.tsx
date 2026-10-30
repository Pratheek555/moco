// One episode: its shots with their stills, the latest render, and redoing a single shot with a note.
import { useState } from "react";
import { Download, FolderOpen, Play, RefreshCw } from "lucide-react";
import type { EpisodeScript, SeriesPlan, ShotList } from "@moco/spec";
import { api } from "../lib/api.ts";
import { stageLabel, useApp } from "../lib/store.ts";
import { seconds } from "../lib/format.ts";
import {
  Button,
  Empty,
  Field,
  Loading,
  Tag,
  report,
  useAsync,
} from "../components/ui.tsx";

export function EpisodePage({
  seriesId,
  episodeId,
}: {
  seriesId: string;
  episodeId: string;
}) {
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
  if (error) return <Empty title="Could not open episode" detail={error} />;
  if (!data) return <Loading />;
  const { status, plan, script, shots, media } = data;
  const index = plan?.episodes.findIndex((ep) => ep.id === episodeId) ?? -1;
  const episode = plan?.episodes[index];
  const running = status.activeJob !== undefined;
  const stage = (name: string) => status.stages.find((s) => s.key === `${episodeId}/${name}`);
  const scenesDone = stage("scenes")?.status === "done";
  const nextHere = status.next.kind === "run" && status.next.key.startsWith(`${episodeId}/`) ? status.next.key : undefined;
  const shot = shots[selected];
  const video = media.final ?? media.preview;

  const regenerate = async () => {
    if (!shot) return;
    setBusy(true);
    try {
      await api.episode.regenerateShot(seriesId, episodeId, shot.id, note.trim() || undefined);
      setNote("");
      useApp.getState().toast(`Redoing ${shot.id}. Render the preview again afterwards.`, "success");
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="episode-editor enter">
      <div className="editor-heading">
        <div>
          <span className="eyebrow">EPISODE {String(index + 1).padStart(2, "0")}</span>
          <h2>{episode?.title ?? episodeId}</h2>
        </div>
        <div className="row">
          <Button onClick={() => go({ name: "series", id: seriesId })}>Back to review</Button>
          {nextHere && (
            <Button
              variant="primary"
              disabled={running}
              onClick={() => void api.stages.run(seriesId, nextHere).catch(report)}
            >
              <Play size={15} /> {stageLabel(nextHere)}
            </Button>
          )}
        </div>
      </div>
      <div className="editor-layout">
        <aside className="scene-list">
          <div className="scene-list-heading">
            <strong>
              Shots <span>{shots.length}</span>
            </strong>
            <Tag>{seconds(shots.at(-1)?.end)}</Tag>
          </div>
          {shots.length === 0 && <p className="hint">Shots appear after the shot list is made.</p>}
          {shots.map((s, i) => (
            <button
              key={s.id}
              className={`scene-item ${selected === i ? "selected" : ""}`}
              onClick={() => setSelected(i)}
            >
              <div
                className="scene-swatch"
                style={{
                  background: media.stills[s.id]?.[0] ? `center / cover url("${media.stills[s.id]![0]}")` : "var(--card)",
                }}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
              </div>
              <div>
                <strong>{s.id}</strong>
                <span>
                  {s.location} · {seconds(s.end - s.start)}
                </span>
                <p>{s.intent}</p>
              </div>
            </button>
          ))}
        </aside>
        <section className="preview-column">
          <div className="preview-meta">
            <span>
              <i className="status-dot" /> {media.final ? "FINAL RENDER" : media.preview ? "PREVIEW" : "NOT RENDERED YET"}
            </span>
            <span>9:16 · 1080 × 1920</span>
          </div>
          <div className="player-stage">
            {video ? (
              <video
                key={video}
                src={video}
                controls
                style={{ height: "100%", aspectRatio: "9/16", maxWidth: "100%", borderRadius: 12 }}
              />
            ) : (
              <Empty title="Nothing to play yet" detail="The preview renders after every shot is written." />
            )}
          </div>
          <div className="preview-footer">
            <span>
              {shots.length} shots · {seconds(shots.at(-1)?.end)}
            </span>
          </div>
        </section>
        <aside className="inspector">
          <div className="tabs">
            {[
              ["shot", "Shot"],
              ["script", "Script"],
              ["exports", "Exports"],
            ].map(([v, l]) => (
              <button key={v} className={tab === v ? "selected" : ""} onClick={() => setTab(v!)}>
                {l}
              </button>
            ))}
          </div>
          <div className="inspector-body">
            {tab === "shot" && shot ? (
              <fieldset disabled={running}>
                <div className="inspector-title">
                  <h3>{shot.id}</h3>
                  <Tag>{seconds(shot.end - shot.start)}</Tag>
                </div>
                <p>{shot.intent}</p>
                <p className="hint">
                  {shot.characters.join(", ") || "No characters"} · {shot.location}
                  {shot.cameraHint ? ` · ${shot.cameraHint}` : ""}
                </p>
                {(media.stills[shot.id] ?? []).map((url) => (
                  <img key={url} src={url} alt={`${shot.id} still`} style={{ width: "100%", borderRadius: 8, marginTop: 8 }} />
                ))}
                <Field label="Redo this shot" hint="The AI rewrites only this shot. Render the preview again afterwards.">
                  <textarea
                    aria-label="Shot note"
                    rows={3}
                    placeholder="e.g. “Closer on Krishna, slower camera.”"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
                <Button disabled={!scenesDone} busy={busy} onClick={() => void regenerate()}>
                  <RefreshCw size={14} /> Redo shot
                </Button>
              </fieldset>
            ) : tab === "script" ? (
              script ? (
                script.lines.map((line) => (
                  <p key={line.id}>
                    <span className="hint">{line.beat}</span> {line.text}
                  </p>
                ))
              ) : (
                <p className="hint">The script hasn’t been written yet.</p>
              )
            ) : tab === "exports" ? (
              media.final ? (
                <div className="export-card">
                  <strong>final.mp4</strong>
                  <p className="hint">1080 × 1920, ready for Reels and Shorts.</p>
                  <div className="row">
                    <Button onClick={() => void api.app.showItem(media.finalPath!).catch(report)}>
                      <FolderOpen size={14} /> Show in folder
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="hint">
                  <Download size={14} /> The final MP4 renders after you approve the preview.
                </p>
              )
            ) : (
              <p className="hint">Pick a shot.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
