// A series: what the engine is doing now, the step waiting for your review, and the episode board.
// The engine stops at each gate (plan, bible, script, sample shot, preview); nothing moves on until you approve.
import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  CircleStop,
  FolderOpen,
  LoaderCircle,
  MessageSquare,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { EpisodeScript, SeriesBible, SeriesPlan } from "@moco/spec";
import { api, type SeriesStatus } from "../lib/api.ts";
import { stageLabel, useApp } from "../lib/store.ts";
import {
  Button,
  CastArt,
  Empty,
  Loading,
  Modal,
  Tag,
  report,
  useAsync,
} from "../components/ui.tsx";

type Stage = SeriesStatus["stages"][number];

const PLAN = "artifacts/series_plan.json";
const BIBLE = "artifacts/bible.json";

// Which artifact a gate asks you to review. Sample and preview are reviewed as pictures, not JSON.
function reviewFile(key: string): string | undefined {
  const [first, second] = key.split("/");
  if (first === "series_plan") return PLAN;
  if (first === "bible") return BIBLE;
  if (second === "script") return `episodes/${first}/artifacts/script.json`;
  return undefined;
}

const episodeOf = (key: string) => (key.includes("/") ? key.split("/")[0] : undefined);

export function SeriesPage({ id }: { id: string }) {
  const version = useApp((s) => s.version),
    go = useApp((s) => s.go),
    progress = useApp((s) => s.progress[id]);
  const { data, error } = useAsync(
    async () => {
      const [status, plan, bible] = await Promise.all([
        api.series.status(id),
        api.series.artifact(id, PLAN),
        api.series.artifact(id, BIBLE),
      ]);
      return {
        status,
        plan: plan?.data as SeriesPlan | undefined,
        bible: bible?.data as SeriesBible | undefined,
      };
    },
    [id, version],
  );
  const [deleting, setDeleting] = useState(false);
  if (error) return <Empty title="Could not open series" detail={error} />;
  if (!data) return <Loading />;
  const { status, plan, bible } = data;
  const running = status.activeJob !== undefined;
  const stage = (key: string) => status.stages.find((s) => s.key === key);
  const current = status.stages.find((s) => s.status === "running");
  const failed = status.stages.find((s) => s.status === "failed");
  const waiting =
    status.next.kind === "waiting" && status.next.status === "awaiting_approval"
      ? stage(status.next.key)
      : undefined;

  const run = (key?: string) => void api.stages.run(id, key).catch(report);

  return (
    <div className="page enter">
      <div className="series-cover">
        <div>
          <div className="eyebrow">
            {status.series.language.toUpperCase()} · {status.series.episodes}{" "}
            {status.series.episodes === 1 ? "EPISODE" : "EPISODES"}
          </div>
          <h1>{plan?.title ?? "Planning your series…"}</h1>
          <p>{plan?.premise ?? status.series.idea}</p>
          <div className="row">
            {running ? (
              <Button
                onClick={() => void api.stages.cancel(status.activeJob!.id).catch(report)}
              >
                <CircleStop size={15} /> Stop
              </Button>
            ) : status.next.kind === "run" ? (
              <Button variant="primary" onClick={() => run()}>
                <Play size={15} /> Continue: {stageLabel(status.next.key)}
              </Button>
            ) : null}
            <Button
              onClick={() =>
                void api.app
                  .openPath(`${useApp.getState().settings!.projectsDir}/${id}`)
                  .catch(report)
              }
            >
              <FolderOpen size={15} /> Project folder
            </Button>
          </div>
        </div>
        <CastArt characters={bible?.cast.map((c) => c.kitCharacterId)} />
      </div>

      {running && (
        <div className="editor-job">
          <span className="shimmer">
            <LoaderCircle size={14} className="spin" />{" "}
            {current ? `Working on ${stageLabel(current.key)}…` : "Starting…"}
          </span>
          {progress !== undefined && <span>{Math.round(progress * 100)}%</span>}
          <i style={{ width: `${(progress ?? 0) * 100}%` }} />
        </div>
      )}
      {!running && failed && (
        <div className="notice">
          {stageLabel(failed.key)} failed: {failed.error?.message}
          <Button variant="ghost" onClick={() => run(failed.key)}>
            <RotateCcw size={14} /> Try again
          </Button>
        </div>
      )}
      {!running && waiting && (
        <Review seriesId={id} stage={waiting} plan={plan} bible={bible} />
      )}
      {status.next.kind === "finished" && (
        <div className="notice">
          <Check size={15} /> Every episode is rendered. Open an episode to
          watch or export it.
        </div>
      )}

      <div className="series-layout">
        <section>
          <div className="section-heading">
            <div>
              <h2>The episode board</h2>
              <p>One story, one chapter at a time.</p>
            </div>
          </div>
          {plan ? (
            <div className="episode-list">
              {plan.episodes.map((ep, index) => (
                <button
                  className="episode-row"
                  key={ep.id}
                  onClick={() => go({ name: "episode", seriesId: id, episodeId: ep.id })}
                >
                  <div className="episode-number">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div className="episode-row-info">
                    <h3>{ep.title}</h3>
                    <p>{ep.synopsis}</p>
                  </div>
                  <Tag tone={stage(`${ep.id}/final`)?.status === "done" ? "green" : ""}>
                    {episodeState(status, ep.id)}
                  </Tag>
                  <ArrowUpRight size={17} />
                </button>
              ))}
            </div>
          ) : (
            <p className="hint">Episodes appear once the series plan is written.</p>
          )}
        </section>
        <aside className="series-details">
          <h3>The cast</h3>
          {bible ? (
            bible.cast.map((c) => (
              <div className="cast-row" key={c.id}>
                <div className="cast-avatar">
                  <CastArt characters={[c.kitCharacterId]} />
                </div>
                <div>
                  <strong>{c.id}</strong>
                  <p>{c.description}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="hint">The cast is chosen with the series bible.</p>
          )}
          {status.decisions.length > 0 && (
            <>
              <hr />
              <h3>What the engine decided</h3>
              {status.decisions.slice(-6).map((d, i) => (
                <p className="hint" key={i}>
                  <strong>{d.subject}</strong>: {d.detail}
                </p>
              ))}
            </>
          )}
          <hr />
          <p className="hint">
            AI calls: {Object.values(status.usage.aiCalls).reduce((a, b) => a + b, 0)}
          </p>
          <Button
            variant="ghost"
            className="danger-text"
            disabled={running}
            onClick={() => setDeleting(true)}
          >
            <Trash2 size={14} /> Delete series
          </Button>
        </aside>
      </div>
      {deleting && (
        <Modal title="Delete this series?" close={() => setDeleting(false)}>
          <p>
            This permanently removes “{plan?.title ?? status.series.idea}”, its
            episodes, audio, and exported videos from your project folder.
          </p>
          <div className="modal-actions">
            <Button onClick={() => setDeleting(false)}>Keep series</Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await api.series.remove(id);
                  go({ name: "library" });
                  useApp.getState().toast("Series deleted");
                } catch (e) {
                  report(e);
                }
              }}
            >
              Delete series
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// One word for where an episode is, from its stages.
function episodeState(status: SeriesStatus, episodeId: string): string {
  const stages = status.stages.filter((s) => episodeOf(s.key) === episodeId);
  if (stages.some((s) => s.key.endsWith("/final") && s.status === "done")) return "Rendered";
  if (stages.some((s) => s.status === "running")) return "Working";
  if (stages.some((s) => s.status === "awaiting_approval")) return "Needs review";
  if (stages.some((s) => s.status === "failed")) return "Needs attention";
  if (stages.some((s) => s.status === "done")) return "In progress";
  return "Not started";
}

// The step waiting for you: what it made, and approve or ask for changes.
function Review({
  seriesId,
  stage,
  plan,
  bible,
}: {
  seriesId: string;
  stage: Stage;
  plan?: SeriesPlan;
  bible?: SeriesBible;
}) {
  const [feedback, setFeedback] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const file = reviewFile(stage.key);
  const episodeId = episodeOf(stage.key);
  const { data: script } = useAsync(
    async () =>
      file?.endsWith("script.json")
        ? ((await api.series.artifact(seriesId, file))?.data as EpisodeScript)
        : undefined,
    [seriesId, file, stage.artifactHash],
  );
  const { data: media } = useAsync(
    async () => (episodeId ? api.episode.media(seriesId, episodeId) : undefined),
    [seriesId, episodeId, stage.artifactHash],
  );

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  // Approving moves straight on to the next steps, up to the next review.
  const approve = () =>
    act(async () => {
      await api.stages.approve(seriesId, stage.key, stage.artifactHash!);
      await api.stages.run(seriesId);
    });
  const requestChanges = () =>
    act(async () => {
      await api.stages.reject(seriesId, stage.key, feedback ?? "");
      await api.stages.run(seriesId, stage.key);
      setFeedback(null);
    });

  const stills = Object.values(media?.stills ?? {}).flat();
  return (
    <section className="composer review-card" aria-label="Review">
      <div className="composer-title">
        <span>
          <MessageSquare size={17} /> Your review: {stageLabel(stage.key)}
        </span>
        <Tag>WAITING FOR YOU</Tag>
      </div>

      {stage.key === "series_plan" && plan && (
        <ol className="review-list">
          {plan.episodes.map((ep) => (
            <li key={ep.id}>
              <strong>{ep.title}</strong> {ep.synopsis}
            </li>
          ))}
        </ol>
      )}
      {stage.key === "bible" && bible && (
        <ul className="review-list">
          {bible.cast.map((c) => (
            <li key={c.id}>
              <strong>{c.id}</strong> ({c.kitCharacterId}
              {c.variant ? `, ${c.variant}` : ""}): {c.description}
            </li>
          ))}
          <li>
            <strong>Look</strong> {bible.style.mood} · grade {bible.style.grade} ·
            captions {bible.style.captionStyle}
          </li>
        </ul>
      )}
      {script && (
        <ol className="review-list">
          {script.lines.map((line) => (
            <li key={line.id}>
              <span className="hint">{line.beat}</span> {line.text}
            </li>
          ))}
        </ol>
      )}
      {stage.key.endsWith("/sample") && (
        <div className="review-stills">
          {stills.map((url) => (
            <img key={url} src={url} alt="Sample shot still" />
          ))}
        </div>
      )}
      {stage.key.endsWith("/preview") && media?.preview && (
        <video className="review-video" src={media.preview} controls />
      )}

      {feedback !== null && (
        <textarea
          aria-label="What should change"
          rows={3}
          placeholder="What should change? e.g. “Make Krishna calmer, end on the blessing.”"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
      )}
      <div className="composer-footer">
        <span className="hint">
          Approving moves on to the next step. Asking for changes redoes this
          one with your note.
        </span>
        <div className="row">
          {feedback === null ? (
            <Button disabled={busy} onClick={() => setFeedback("")}>
              Ask for changes
            </Button>
          ) : (
            <Button
              disabled={busy || !feedback.trim()}
              onClick={() => void requestChanges()}
            >
              Redo with my note
            </Button>
          )}
          <Button variant="primary" busy={busy} onClick={() => void approve()}>
            <Check size={15} /> Approve
          </Button>
        </div>
      </div>
    </section>
  );
}
