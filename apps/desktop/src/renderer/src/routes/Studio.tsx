import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Sparkles,
  Plus,
  WandSparkles,
  Search,
  Check,
} from "lucide-react";
import { api } from "../lib/api.ts";
import { useApp, runningSeries } from "../lib/store.ts";
import { IDEAS, LANGUAGE_OPTIONS } from "../lib/format.ts";
import { Button, CastArt, Empty, SeriesCard, Tag, report } from "../components/ui.tsx";

export function Studio() {
  const settings = useApp((s) => s.settings)!,
    library = useApp((s) => s.library),
    idea = useApp((s) => s.composerIdea),
    setIdea = useApp((s) => s.setComposerIdea),
    go = useApp((s) => s.go);
  const [episodes, setEpisodes] = useState(settings.defaults.episodes),
    [language, setLanguage] = useState(settings.defaults.language),
    [starting, setStarting] = useState(false);
  const submit = async () => {
    if (!idea.trim() || starting) return;
    setStarting(true);
    try {
      const id = await api.series.create({ idea: idea.trim(), episodes, language });
      setIdea("");
      go({ name: "series", id });
    } catch (e) {
      report(e);
    } finally {
      setStarting(false);
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
              {[1, 2, 3, 5].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "episode" : "episodes"}
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
        </div>
        <div className="composer-footer">
          <span className="hint">Moco plans the series, then stops for you to review each step.</span>
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
          detail="Start with an idea above. Moco writes it with your Claude Code and renders it on this computer."
        />
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
        {runningSeries(library).length > 0 && (
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
      `${s.title} ${s.premise}`.toLowerCase().includes(q.toLowerCase()) &&
      (filter === "all" ||
        (filter === "rendered" ? s.finals > 0 : s.next.kind !== "finished")),
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
