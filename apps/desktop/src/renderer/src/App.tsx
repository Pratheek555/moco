import { useEffect, useState, Component, type ReactNode } from "react";
import {
  Sparkles,
  Library,
  Shapes,
  Settings2,
  Search,
  Plus,
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Clapperboard,
  ArrowUpRight,
  CircleHelp,
  Command,
  Sun,
  Moon,
} from "lucide-react";
import { api } from "./lib/api.ts";
import { bootstrap, runningSeries, useApp, type Route } from "./lib/store.ts";
import { Button, Loading, Modal, Toasts, report } from "./components/ui.tsx";
import { Studio, LibraryPage } from "./routes/Studio.tsx";
import { SeriesPage } from "./routes/Series.tsx";
import { EpisodePage } from "./routes/Episode.tsx";
import { KitPage } from "./routes/Kit.tsx";
import { QueuePage } from "./routes/Queue.tsx";
import { SettingsPage } from "./routes/Settings.tsx";

const nav = [
  { name: "studio", label: "Studio", icon: Sparkles },
  { name: "library", label: "My series", icon: Library },
  { name: "kit", label: "Creative kit", icon: Shapes },
  { name: "renders", label: "Activity", icon: Clapperboard },
] as const;
let boot: Promise<void> | undefined;

class Boundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <div className="empty">
        <h2>Something interrupted the studio</h2>
        <p>{this.state.error}</p>
        <Button onClick={() => location.reload()}>Reload studio</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function App() {
  const route = useApp((s) => s.route),
    go = useApp((s) => s.go),
    settings = useApp((s) => s.settings),
    library = useApp((s) => s.library),
    dark = useApp((s) => s.dark);
  const [collapsed, setCollapsed] = useState(false),
    [error, setError] = useState(""),
    [help, setHelp] = useState(false);
  const busy = runningSeries(library);
  useEffect(() => {
    boot ??= bootstrap();
    boot.catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useApp.getState().setPalette(!useApp.getState().palette);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        go({ name: "studio" });
        setTimeout(
          () => document.querySelector<HTMLTextAreaElement>("#idea")?.focus(),
          50,
        );
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [go]);
  const title =
    route.name === "series"
      ? (library.find((s) => s.id === route.id)?.title ?? "Series")
      : route.name === "episode"
        ? `Episode ${Number(route.episodeId.replace(/\D/g, ""))}`
        : (nav.find((n) => n.name === route.name)?.label ?? "Settings");
  return (
    <Boundary>
      <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
        <div className="titlebar drag-region">
          <span className="titlebar-word">moco</span>
          <span>Animation studio</span>
        </div>
        <aside className="sidebar">
          <button
            className="brand"
            onClick={() => go({ name: "studio" })}
            aria-label="Moco home"
          >
            <span className="brand-symbol">
              <i />
              <i />
              <i />
            </span>
            {!collapsed && (
              <span>
                moco<span className="brand-dot">.</span>
              </span>
            )}
          </button>
          <Button
            className="new-button"
            onClick={() => {
              go({ name: "studio" });
              setTimeout(() => document.getElementById("idea")?.focus(), 50);
            }}
          >
            <Plus size={16} />
            {!collapsed && (
              <>
                New series<kbd>⌘ N</kbd>
              </>
            )}
          </Button>
          <div className="nav-section">{!collapsed && "WORKSPACE"}</div>
          <nav aria-label="Main navigation">
            {nav.map((n) => (
              <button
                key={n.name}
                title={n.label}
                aria-label={n.label}
                className={`nav-item ${route.name === n.name || (n.name === "library" && ["series", "episode"].includes(route.name)) ? "active" : ""}`}
                onClick={() => go({ name: n.name } as Route)}
              >
                <n.icon size={18} />
                {!collapsed && (
                  <>
                    <span>{n.label}</span>
                    {n.name === "renders" && busy.length > 0 && (
                      <span className="nav-count">{busy.length}</span>
                    )}
                  </>
                )}
              </button>
            ))}
          </nav>
          {!collapsed && (
            <div className="sidebar-note">
              <div className="tiny-spark">
                <Sparkles size={15} />
              </div>
              <strong>A little idea. A whole world.</strong>
              <p>
                Your stories, brought to life.
                <br />
                Made on your machine.
              </p>
              <button onClick={() => setHelp(true)}>
                Meet your studio <ArrowUpRight size={12} />
              </button>
            </div>
          )}
          <div className="sidebar-bottom">
            <button
              className="nav-item"
              onClick={() => useApp.getState().setPalette(true)}
              title="Search"
              aria-label="Quick search"
            >
              <Search size={17} />
              {!collapsed && (
                <>
                  <span>Quick search</span>
                  <kbd>⌘ K</kbd>
                </>
              )}
            </button>
            <button
              className={`nav-item ${route.name === "settings" ? "active" : ""}`}
              title="Settings"
              onClick={() => go({ name: "settings" })}
            >
              <Settings2 size={17} />
              {!collapsed && <span>Settings</span>}
            </button>
            <div className="sidebar-footer">
              {!collapsed && (
                <span>
                  <i className="status-dot" />
                  Local workspace
                </span>
              )}
              <button
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={() => setCollapsed(!collapsed)}
              >
                {collapsed ? (
                  <PanelLeftOpen size={16} />
                ) : (
                  <PanelLeftClose size={16} />
                )}
              </button>
            </div>
          </div>
        </aside>
        <main className="main-panel">
          <header className="topbar">
            <div className="breadcrumb">
              {useApp((s) => s.history.length) > 0 && (
                <button
                  aria-label="Go back"
                  onClick={() => useApp.getState().back()}
                >
                  <ArrowLeft size={16} />
                </button>
              )}
              <span>Workspace</span>
              <span className="slash">/</span>
              <strong>{title}</strong>
            </div>
            <div className="topbar-actions">
              {busy.length > 0 && (
                <button
                  className="working-indicator"
                  onClick={() => go({ name: "renders" })}
                >
                  <i className="status-dot pulse" />
                  {busy.length} in progress
                </button>
              )}
              <span className="local-pill">
                <span /> Saved on this device
              </span>
              <button
                title="Toggle appearance"
                aria-label="Toggle appearance"
                onClick={() =>
                  void useApp
                    .getState()
                    .updateSettings({ theme: dark ? "light" : "dark" })
                    .catch(report)
                }
              >
                {dark ? <Sun size={17} /> : <Moon size={17} />}
              </button>
              <button aria-label="Studio help" onClick={() => setHelp(true)}>
                <CircleHelp size={17} />
              </button>
            </div>
          </header>
          <div
            className={`page-scroll ${route.name === "episode" ? "editor-scroll" : ""}`}
          >
            {error ? (
              <div className="empty">
                <h2>Could not open your workspace</h2>
                <p>{error}</p>
                <Button onClick={() => location.reload()}>Try again</Button>
              </div>
            ) : !settings ? (
              <Loading />
            ) : (
              <Boundary key={route.name}>
                {route.name === "studio" ? (
                  <Studio />
                ) : route.name === "library" ? (
                  <LibraryPage />
                ) : route.name === "series" ? (
                  <SeriesPage key={route.id} id={route.id} />
                ) : route.name === "episode" ? (
                  <EpisodePage
                    key={`${route.seriesId}-${route.episodeId}`}
                    seriesId={route.seriesId}
                    episodeId={route.episodeId}
                  />
                ) : route.name === "kit" ? (
                  <KitPage />
                ) : route.name === "renders" ? (
                  <QueuePage />
                ) : (
                  <SettingsPage />
                )}
              </Boundary>
            )}
          </div>
        </main>
      </div>
      <Toasts />
      <Palette />
      {help && (
        <Modal title="Your idea-to-reel studio" close={() => setHelp(false)}>
          <div className="help-steps">
            {[
              [
                "01",
                "Start with a story",
                "Describe an idea. Moco plans a series, a cast and an episode arc, then stops for your review.",
              ],
              [
                "02",
                "Make it your own",
                "Approve each step or ask for changes: the plan, the cast, the script, a sample shot, the preview.",
              ],
              [
                "03",
                "Bring it to life",
                "Moco voices it, animates every shot with the kit, and renders a vertical MP4 on this computer.",
              ],
            ].map(([n, t, d]) => (
              <div key={n}>
                <span>{n}</span>
                <section>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </section>
              </div>
            ))}
          </div>
          <p className="hint">
            Moco writes with the Claude Code on this computer, on your own Claude
            plan. Check the connection in Settings.
          </p>
          <Button
            variant="primary"
            onClick={() => {
              setHelp(false);
              go({ name: "settings" });
            }}
          >
            Set up my studio <ArrowUpRight size={15} />
          </Button>
        </Modal>
      )}
    </Boundary>
  );
}
function Palette() {
  const open = useApp((s) => s.palette),
    library = useApp((s) => s.library),
    go = useApp((s) => s.go);
  const [q, setQ] = useState("");
  if (!open) return null;
  const close = () => {
    useApp.getState().setPalette(false);
    setQ("");
  };
  return (
    <Modal title="Jump to…" close={close}>
      <div className="search-input">
        <Search size={18} />
        <input
          autoFocus
          aria-label="Search workspace"
          placeholder="Search series, pages, and actions…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <kbd>ESC</kbd>
      </div>
      <div className="palette-results">
        {[
          ...nav.map((n) => ({
            title: n.label,
            route: { name: n.name } as Route,
          })),
          { title: "Settings", route: { name: "settings" } as Route },
          ...library.map((s) => ({
            title: s.title,
            route: { name: "series", id: s.id } as Route,
          })),
        ]
          .filter((x) => x.title.toLowerCase().includes(q.toLowerCase()))
          .map((x, i) => (
            <button
              key={i}
              onClick={() => {
                go(x.route);
                close();
              }}
            >
              <Command size={16} />
              <span>{x.title}</span>
              <ArrowUpRight size={14} />
            </button>
          ))}
      </div>
    </Modal>
  );
}
