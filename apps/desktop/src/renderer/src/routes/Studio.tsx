import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Sparkles,
  Play,
  Plus,
  WandSparkles,
  Search,
  Trash2,
  FolderOpen,
  ArrowDown,
  Check,
} from "lucide-react";
import { api } from "../lib/api.ts";
import { useApp, activeJobs } from "../lib/store.ts";
import {
  IDEAS,
  LANGUAGE_OPTIONS,
  STYLE_OPTIONS,
  STATUS_LABEL,
  seconds,
} from "../lib/format.ts";
import {
  Button,
  CastArt,
  Empty,
  Field,
  Loading,
  Modal,
  SeriesCard,
  Tag,
  report,
  startJob,
  useAsync,
} from "../components/ui.tsx";

export function Studio() {
  const settings = useApp((s) => s.settings)!,
    library = useApp((s) => s.library),
    idea = useApp((s) => s.composerIdea),
    setIdea = useApp((s) => s.setComposerIdea),
    go = useApp((s) => s.go),
    jobs = useApp((s) => s.jobs);
  const [episodes, setEpisodes] = useState(settings.defaults.episodes),
    [duration, setDuration] = useState(settings.defaults.seconds),
    [language, setLanguage] = useState(settings.defaults.language),
    [style, setStyle] = useState(settings.defaults.style),
    [starting, setStarting] = useState(false),
    [write, setWrite] = useState(true);
  const submit = async () => {
    if (!idea.trim() || starting) return;
    setStarting(true);
    const j = await startJob({
      kind: "plan",
      input: {
        idea: idea.trim(),
        episodes,
        seconds: duration,
        language,
        style,
      },
      thenWrite: write,
    });
    setStarting(false);
    if (j) {
      setIdea("");
      go({ name: "renders" });
    }
  };
  return (
    <div className="page studio-page enter">
      <div className="studio-heading">
        <div>
          <div className="eyebrow">
            <span className="status-dot" /> YOUR STORY STARTS HERE
          </div>
          <h1>
            Small idea.
            <br />
            <span>Epic possibilities.</span>
          </h1>
          <p>
            Turn the stories in your head into animated reels.
            <br />A cast, a world, a little movie. All yours.
          </p>
        </div>
        <div className="hero-illustration">
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <span className="hero-star star-one">✦</span>
          <span className="hero-star star-two">✧</span>
          <CastArt />
          <span className="floating-label">
            <Sparkles size={12} /> A world of your own
          </span>
        </div>
      </div>
      <section className="composer">
        <div className="composer-title">
          <span>
            <Sparkles size={17} /> What story will you tell?
          </span>
          <Tag>IDEA → ANIMATION</Tag>
        </div>
        <textarea
          id="idea"
          aria-label="Your story idea"
          maxLength={4000}
          placeholder="A moment from the Mahabharat. A lesson from Chanakya. A story only you can tell…"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void submit();
          }}
        />
        <div className="composer-options">
          <label>
            <span>Episodes</span>
            <select
              aria-label="Number of episodes"
              value={episodes}
              onChange={(e) => setEpisodes(+e.target.value)}
            >
              {[1, 3, 5, 7, 10].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "episode" : "episodes"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Length</span>
            <select
              aria-label="Episode length"
              value={duration}
              onChange={(e) => setDuration(+e.target.value)}
            >
              {[15, 30, 45, 60, 90].map((n) => (
                <option key={n} value={n}>
                  {n} seconds
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Language</span>
            <select
              aria-label="Story language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Style</span>
            <select
              aria-label="Story style"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
            >
              {STYLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="composer-footer">
          <label className="check-label">
            <input
              type="checkbox"
              checked={write}
              onChange={(e) => setWrite(e.target.checked)}
            />{" "}
            Write episodes after planning
          </label>
          <Button
            variant="primary"
            disabled={!idea.trim()}
            busy={starting}
            onClick={() => void submit()}
          >
            <Sparkles size={15} /> Create series <ArrowRight size={15} />
          </Button>
        </div>
      </section>
      <div className="idea-row">
        <span>Need a spark?</span>
        {[
          "A lesson from the Gita",
          "Hanuman’s great leap",
          "Little Krishna’s adventures",
        ].map((t, i) => (
          <button key={t} onClick={() => setIdea(IDEAS[[9, 1, 6][i]])}>
            {t}
            <ArrowUpRight size={12} />
          </button>
        ))}
        <button
          className="shuffle-idea"
          aria-label="Surprise me with a story idea"
          onClick={() =>
            setIdea(IDEAS[Math.floor(Math.random() * IDEAS.length)])
          }
        >
          <WandSparkles size={14} />
        </button>
      </div>
      <div className="section-heading">
        <div>
          <h2>Continue the story</h2>
          <p>Your worlds, waiting for the next chapter.</p>
        </div>
        <Button variant="ghost" onClick={() => go({ name: "library" })}>
          All series <ArrowRight size={14} />
        </Button>
      </div>
      {library.length ? (
        <div className="series-grid">
          {library.slice(0, 3).map((s) => (
            <SeriesCard key={s.id} series={s} />
          ))}
        </div>
      ) : (
        <Empty
          title="Your next great story lives here"
          detail="Start with an idea above, or explore a ready-made animated episode."
        >
          <Button
            onClick={() =>
              void api.series
                .demo()
                .then((s) => go({ name: "series", id: s.id }))
                .catch(report)
            }
          >
            <Play size={15} /> Open demo series
          </Button>
        </Empty>
      )}
      <div className="studio-bottom">
        <span>
          <Check size={14} /> Rendered on your device
        </span>
        <span>
          <Check size={14} /> Your own AI connection
        </span>
        <span>
          <Check size={14} /> Ready for Reels & Shorts
        </span>
        {activeJobs(jobs).length > 0 && (
          <button onClick={() => go({ name: "renders" })}>
            See what’s being made <ArrowRight size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

export function LibraryPage() {
  const library = useApp((s) => s.library),
    go = useApp((s) => s.go);
  const [q, setQ] = useState(""),
    [filter, setFilter] = useState("all");
  const list = library.filter(
    (s) =>
      `${s.title} ${s.logline}`.toLowerCase().includes(q.toLowerCase()) &&
      (filter === "all" ||
        s.episodes.some((e) =>
          filter === "rendered"
            ? e.status === "rendered"
            : e.status === "planned",
        )),
  );
  return (
    <div className="page enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR CREATIVE UNIVERSE</div>
          <h1>
            My series<span className="count">{library.length}</span>
          </h1>
          <p>Every world you’ve started. Every story still unfolding.</p>
        </div>
        <Button variant="primary" onClick={() => go({ name: "studio" })}>
          <Plus size={16} /> New series
        </Button>
      </div>
      <div className="toolbar">
        <div className="tabs">
          {[
            ["all", "All series"],
            ["planned", "In progress"],
            ["rendered", "With exports"],
          ].map(([v, l]) => (
            <button
              className={filter === v ? "selected" : ""}
              key={v}
              onClick={() => setFilter(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="search-input">
          <Search size={15} />
          <input
            aria-label="Search series"
            placeholder="Find a series…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      {list.length ? (
        <div className="series-grid library-grid">
          {list.map((s) => (
            <SeriesCard key={s.id} series={s} />
          ))}
        </div>
      ) : (
        <Empty
          title={q ? "No matching stories" : "A blank page is a beginning"}
          detail={
            q
              ? "Try another title or clear your filters."
              : "Create your first series in the studio."
          }
        >
          <Button
            onClick={() =>
              q || filter !== "all"
                ? (setQ(""), setFilter("all"))
                : go({ name: "studio" })
            }
          >
            {q || filter !== "all" ? "Clear filters" : "Create a series"}
          </Button>
        </Empty>
      )}
    </div>
  );
}

export function SeriesPage({ id }: { id: string }) {
  const version = useApp((s) => s.version),
    go = useApp((s) => s.go),
    jobs = useApp((s) => s.jobs);
  const { data, error } = useAsync(() => api.series.get(id), [id, version]);
  const [deleting, setDeleting] = useState(false),
    [notes, setNotes] = useState<string | null>(null),
    [saving, setSaving] = useState(false);
  if (error) return <Empty title="Could not open series" detail={error} />;
  if (!data) return <Loading />;
  const { series, summary } = data;
  const busy = activeJobs(jobs).some((j) => j.seriesId === id);
  return (
    <div className="page enter">
      <div className="series-cover">
        <div>
          <div className="eyebrow">
            {series.style.toUpperCase()} · {series.language.toUpperCase()} ·{" "}
            {series.episodes.length} EPISODES
          </div>
          <h1>{series.title}</h1>
          <p>{series.logline}</p>
          <div className="row">
            <Button
              variant="primary"
              disabled={
                busy ||
                !series.episodes.some(
                  (e) => e.status === "planned" || e.status === "error",
                )
              }
              onClick={() => void startJob({ kind: "write-all", seriesId: id })}
            >
              <Sparkles size={15} /> Write remaining episodes
            </Button>
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
        <CastArt characters={series.cast.map((c) => c.character)} />
      </div>
      <div className="series-layout">
        <section>
          <div className="section-heading">
            <div>
              <h2>The episode board</h2>
              <p>One story, one chapter at a time.</p>
            </div>
            <Tag>
              {summary.episodes.filter((e) => e.status === "rendered").length}{" "}
              exported
            </Tag>
          </div>
          <div className="episode-list">
            {summary.episodes.map((ep) => (
              <button
                className="episode-row"
                key={ep.number}
                onClick={() =>
                  go({ name: "episode", seriesId: id, number: ep.number })
                }
              >
                <div className="episode-number">
                  {String(ep.number).padStart(2, "0")}
                </div>
                <div className="episode-row-info">
                  <h3>{ep.title}</h3>
                  <p>{ep.hook || ep.summary}</p>
                  <span>
                    {ep.shots
                      ? `${ep.shots} scenes · ${seconds(ep.seconds)}`
                      : "Ready to write"}
                  </span>
                </div>
                <Tag tone={ep.status === "rendered" ? "green" : ""}>
                  {STATUS_LABEL[ep.status]}
                </Tag>
                <ArrowUpRight size={17} />
              </button>
            ))}
          </div>
        </section>
        <aside className="series-details">
          <h3>The cast</h3>
          <p className="hint">Familiar faces across every episode.</p>
          {series.cast.map((c) => (
            <div className="cast-row" key={c.character}>
              <div className="cast-avatar">
                <CastArt characters={[c.character]} />
              </div>
              <div>
                <strong>{c.name}</strong>
                <p>{c.role}</p>
              </div>
            </div>
          ))}
          <hr />
          <h3>Story memory</h3>
          <p className="hint">
            Keep names, promises, and details consistent as the story grows.
          </p>
          <textarea
            aria-label="Series memory"
            rows={5}
            placeholder="Notes for your AI writer…"
            value={notes ?? series.memory.notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <Button
            disabled={notes === null}
            busy={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await api.series.save({
                  ...series,
                  memory: { ...series.memory, notes: notes ?? "" },
                });
                setNotes(null);
                useApp.getState().toast("Story memory saved", "success");
              } catch (e) {
                report(e);
              } finally {
                setSaving(false);
              }
            }}
          >
            Save memory
          </Button>
          {series.memory.storySoFar.length > 0 && (
            <details>
              <summary>
                Story so far <ArrowDown size={13} />
              </summary>
              {series.memory.storySoFar.map((s, i) => (
                <p className="hint" key={i}>
                  {s}
                </p>
              ))}
            </details>
          )}
          <hr />
          <Button
            variant="ghost"
            className="danger-text"
            disabled={busy}
            onClick={() => setDeleting(true)}
          >
            <Trash2 size={14} /> Delete series
          </Button>
        </aside>
      </div>
      {deleting && (
        <Modal title="Delete this series?" close={() => setDeleting(false)}>
          <p>
            This permanently removes “{series.title}”, its episodes, audio, and
            exported videos from your project folder.
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
