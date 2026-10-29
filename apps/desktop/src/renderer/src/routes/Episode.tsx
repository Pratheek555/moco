import { useEffect, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { EpisodeComposition, episodeFrames, COMPOSITION } from "@moco/renderer";
import { BACKGROUNDS } from "@moco/kit/catalog";
import {
  CAMERA_MOVES,
  TIMES_OF_DAY,
  TRANSITIONS,
  CAPTION_STYLES,
  MUSIC_MOODS,
  episodeTimeline,
  shotSeconds,
  type Episode,
  type Shot,
} from "@moco/spec";
import {
  ArrowRight,
  Check,
  Clapperboard,
  Download,
  Film,
  Mic,
  Save,
  Sparkles,
  Volume2,
  VolumeX,
  Code,
  Play,
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  FolderOpen,
} from "lucide-react";
import { api, type EpisodeBundle } from "../lib/api.ts";
import { useApp, jobFor, setNavigationGuard } from "../lib/store.ts";
import { seconds, bytes } from "../lib/format.ts";
import {
  Button,
  Empty,
  Field,
  Loading,
  Modal,
  Tag,
  report,
  startJob,
  useAsync,
} from "../components/ui.tsx";

export function EpisodePage({
  seriesId,
  number,
}: {
  seriesId: string;
  number: number;
}) {
  const { data: sfx } = useAsync(() => api.assets.sfx(), []);
  const version = useApp((s) => s.version),
    jobs = useApp((s) => s.jobs),
    go = useApp((s) => s.go);
  const [bundle, setBundle] = useState<EpisodeBundle | null>(null),
    [ep, setEp] = useState<Episode | null>(null),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(0),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [instruction, setInstruction] = useState(""),
    [muted, setMuted] = useState(true),
    [code, setCode] = useState<string | null>(null),
    [tab, setTab] = useState("scene"),
    [conflict, setConflict] = useState(false);
  const dirtyRef = useRef(false),
    player = useRef<PlayerRef>(null);
  const active = jobFor(jobs, seriesId, number);
  const change = (next: Episode) => {
    setEp(next);
    setDirty(true);
    dirtyRef.current = true;
  };
  useEffect(() => {
    let alive = true;
    api.episode
      .get(seriesId, number)
      .then((b) => {
        if (!alive) return;
        setBundle(b);
        if (!dirtyRef.current) {
          setEp(b?.episode ?? null);
          setConflict(false);
        } else setConflict(true);
        setLoaded(true);
      })
      .catch((e) => {
        if (alive) {
          setError(e.message);
          setLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [seriesId, number, version]);
  useEffect(() => {
    setNavigationGuard(
      () =>
        !dirtyRef.current ||
        window.confirm("Leave this episode and discard unsaved changes?"),
    );
    const f = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", f);
    return () => {
      window.removeEventListener("beforeunload", f);
      setNavigationGuard(null);
    };
  }, []);
  const save = async () => {
    if (!ep) return false;
    setSaving(true);
    try {
      const result = await api.episode.save(seriesId, ep);
      setEp(result.episode);
      setDirty(false);
      dirtyRef.current = false;
      setConflict(false);
      useApp
        .getState()
        .toast(
          result.issues.length
            ? `Saved with ${result.issues.length} scene warnings`
            : "Episode saved",
          result.issues.length ? "info" : "success",
        );
      return true;
    } catch (e) {
      report(e);
      return false;
    } finally {
      setSaving(false);
    }
  };
  const run = async (kind: "voice" | "render" | "make") => {
    if (dirty && !(await save())) return;
    await startJob({ kind, seriesId, number });
  };
  if (error) return <Empty title="Could not open episode" detail={error} />;
  if (!loaded) return <Loading />;
  if (!ep)
    return (
      <div className="page">
        <Empty
          title={`Let’s write episode ${number}`}
          detail="Your series plan is ready. Ask your connected AI to turn this chapter into animated scenes."
        >
          <Button
            variant="primary"
            disabled={!!active}
            onClick={() => void startJob({ kind: "write", seriesId, number })}
          >
            <Sparkles size={16} />
            {active ? active.stage : "Write this episode"}
          </Button>
          <Button onClick={() => go({ name: "renders" })}>View queue</Button>
        </Empty>
      </div>
    );
  const shot = ep.shots[Math.min(selected, ep.shots.length - 1)];
  const timeline = episodeTimeline(ep);
  const patchShot = (patch: Partial<Shot>) =>
    change({
      ...ep,
      shots: ep.shots.map((s, i) => (i === selected ? { ...s, ...patch } : s)),
    });
  const select = (i: number) => {
    setSelected(i);
    player.current?.pause();
    player.current?.seekTo(timeline.entries[i]?.from ?? 0);
  };
  const editNarration = (text: string) => {
    patchShot({ narration: text, voice: undefined });
  };
  const move = (delta: number) => {
    const next = [...ep.shots];
    const i = selected + delta;
    if (i < 0 || i >= next.length) return;
    [next[i], next[selected]] = [next[selected], next[i]];
    change({ ...ep, shots: next });
    setSelected(i);
  };
  return (
    <div className="episode-editor enter">
      <div className="editor-heading">
        <div>
          <span className="eyebrow">
            EPISODE {String(number).padStart(2, "0")}
          </span>
          <h2>
            {ep.title}{" "}
            {dirty && <span className="unsaved-dot" title="Unsaved changes" />}
          </h2>
        </div>
        <div className="row">
          <Button
            disabled={!dirty || !!active}
            busy={saving}
            onClick={() => void save()}
          >
            <Save size={14} /> Save
          </Button>
          <Button disabled={!!active} onClick={() => void run("voice")}>
            <Mic size={14} /> Voice & music
          </Button>
          <Button
            variant="primary"
            disabled={!!active}
            onClick={() => void run("render")}
          >
            <Download size={15} /> Export MP4
          </Button>
        </div>
      </div>
      {active && (
        <button className="editor-job" onClick={() => go({ name: "renders" })}>
          <span className="shimmer">{active.stage}</span>
          <span>
            {Math.round(active.progress * 100)}% <ArrowRight size={13} />
          </span>
          <i style={{ width: `${active.progress * 100}%` }} />
        </button>
      )}
      {conflict && (
        <div className="notice">
          A background job updated this episode. Your unsaved edits are still
          open.
          <Button
            variant="ghost"
            onClick={() => {
              setEp(bundle?.episode ?? null);
              dirtyRef.current = false;
              setDirty(false);
              setConflict(false);
            }}
          >
            Load latest version
          </Button>
        </div>
      )}
      <div className="editor-layout">
        <aside className="scene-list">
          <div className="scene-list-heading">
            <strong>
              Scenes <span>{ep.shots.length}</span>
            </strong>
            <Tag>{seconds(timeline.durationInFrames / ep.fps)}</Tag>
          </div>
          {ep.shots.map((s, i) => (
            <button
              className={`scene-item ${selected === i ? "selected" : ""}`}
              key={s.id}
              onClick={() => select(i)}
            >
              <div className={`scene-swatch swatch-${s.background.id}`}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <Film size={18} />
              </div>
              <div>
                <strong>{s.id.replaceAll("-", " ")}</strong>
                <span>
                  {s.background.id} · {seconds(shotSeconds(s))}
                </span>
                <p>{s.narration || "No narration"}</p>
              </div>
            </button>
          ))}
          <Button
            variant="ghost"
            className="add-scene"
            disabled={!!active || ep.shots.length >= 40}
            onClick={() => {
              const next = structuredClone(shot);
              next.id = `scene-${Date.now().toString(36)}`;
              next.voice = undefined;
              change({ ...ep, shots: [...ep.shots, next] });
              setSelected(ep.shots.length);
            }}
          >
            <Plus size={14} /> Duplicate scene
          </Button>
        </aside>
        <section className="preview-column">
          <div className="preview-meta">
            <span>
              <i className="status-dot" /> LIVE PREVIEW
            </span>
            <span>9:16 · 1080 × 1920</span>
          </div>
          <div className="player-stage">
            <Player
              ref={player}
              component={EpisodeComposition}
              inputProps={{
                episode: ep,
                assets: { base: bundle?.assetBase, sfx: sfx ?? {} },
                muted,
              }}
              durationInFrames={episodeFrames(ep)}
              compositionWidth={COMPOSITION.width}
              compositionHeight={COMPOSITION.height}
              fps={ep.fps}
              style={{
                height: "100%",
                aspectRatio: "9/16",
                maxWidth: "100%",
                borderRadius: 12,
                overflow: "hidden",
              }}
              controls
              loop
              acknowledgeRemotionLicense
              initialFrame={0}
            />
          </div>
          <div className="preview-footer">
            <button onClick={() => setMuted(!muted)}>
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}{" "}
              {muted ? "Muted preview" : "Audio on"}
            </button>
            <span>
              {ep.shots.length} scenes ·{" "}
              {seconds(timeline.durationInFrames / ep.fps)}
            </span>
            <button onClick={() => setCode(JSON.stringify(ep, null, 2))}>
              <Code size={15} /> Spec
            </button>
          </div>
          <div className="timeline-strip">
            {timeline.entries.map((entry, i) => (
              <button
                key={entry.shot.id}
                className={selected === i ? "selected" : ""}
                style={{ flexGrow: entry.durationInFrames }}
                onClick={() => select(i)}
                title={`Scene ${i + 1}: ${entry.shot.id}`}
              >
                <span>{i + 1}</span>
              </button>
            ))}
          </div>
        </section>
        <aside className="inspector">
          <div className="tabs">
            {[
              ["scene", "Scene"],
              ["audio", "Style & audio"],
              ["exports", "Exports"],
            ].map(([v, l]) => (
              <button
                key={v}
                className={tab === v ? "selected" : ""}
                onClick={() => setTab(v)}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="inspector-body">
            {tab === "scene" ? (
              <fieldset disabled={!!active}>
                <div className="inspector-title">
                  <h3>Scene {selected + 1}</h3>
                  <div className="row">
                    <button
                      title="Move scene earlier"
                      disabled={selected === 0}
                      onClick={() => move(-1)}
                    >
                      <ChevronUp size={15} />
                    </button>
                    <button
                      title="Move scene later"
                      disabled={selected === ep.shots.length - 1}
                      onClick={() => move(1)}
                    >
                      <ChevronDown size={15} />
                    </button>
                  </div>
                </div>
                <Field
                  label="Narration"
                  hint="Changing narration clears its generated voice. Generate voice again before exporting."
                >
                  <textarea
                    aria-label="Scene narration"
                    rows={5}
                    maxLength={400}
                    value={shot.narration}
                    onChange={(e) => editNarration(e.target.value)}
                  />
                </Field>
                <div className="two-fields">
                  <Field label="Duration (seconds)">
                    <input
                      aria-label="Scene duration"
                      type="number"
                      min={1}
                      max={20}
                      step={0.5}
                      value={shot.duration}
                      onChange={(e) => {
                        const n = +e.target.value;
                        if (n >= 1 && n <= 20) patchShot({ duration: n });
                      }}
                    />
                  </Field>
                  <Field label="Transition">
                    <select
                      aria-label="Scene transition"
                      value={shot.transition}
                      onChange={(e) =>
                        patchShot({
                          transition: e.target.value as Shot["transition"],
                        })
                      }
                    >
                      {TRANSITIONS.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Background">
                  <select
                    aria-label="Scene background"
                    value={shot.background.id}
                    onChange={(e) =>
                      patchShot({
                        background: { ...shot.background, id: e.target.value },
                      })
                    }
                  >
                    {BACKGROUNDS.map((b) => (
                      <option value={b.id} key={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="two-fields">
                  <Field label="Time of day">
                    <select
                      aria-label="Time of day"
                      value={shot.background.time}
                      onChange={(e) =>
                        patchShot({
                          background: {
                            ...shot.background,
                            time: e.target.value as Shot["background"]["time"],
                          },
                        })
                      }
                    >
                      {TIMES_OF_DAY.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Camera move">
                    <select
                      aria-label="Camera move"
                      value={shot.camera.move}
                      onChange={(e) =>
                        patchShot({
                          camera: {
                            ...shot.camera,
                            move: e.target.value as Shot["camera"]["move"],
                          },
                        })
                      }
                    >
                      {CAMERA_MOVES.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <hr />
                <div className="inspector-title">
                  <h3>
                    <Sparkles size={15} /> Direct with AI
                  </h3>
                </div>
                <textarea
                  aria-label="AI scene revision"
                  rows={3}
                  maxLength={2000}
                  placeholder="Make this more dramatic. Push in on Krishna as he raises his hand…"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                />
                <Button
                  disabled={!instruction.trim() || !!active}
                  onClick={async () => {
                    if (dirty && !(await save())) return;
                    const j = await startJob({
                      kind: "revise",
                      seriesId,
                      number,
                      shotId: shot.id,
                      instruction: instruction.trim(),
                    });
                    if (j) setInstruction("");
                  }}
                >
                  <Sparkles size={14} /> Revise scene
                </Button>
                <hr />
                <Button
                  variant="ghost"
                  className="danger-text"
                  disabled={ep.shots.length <= 1 || !!active}
                  onClick={() => {
                    change({
                      ...ep,
                      shots: ep.shots.filter((_, i) => i !== selected),
                    });
                    setSelected(Math.max(0, selected - 1));
                  }}
                >
                  <Trash2 size={13} /> Remove scene
                </Button>
              </fieldset>
            ) : tab === "audio" ? (
              <fieldset disabled={!!active}>
                <Field label="Episode title">
                  <input
                    aria-label="Episode title"
                    value={ep.title}
                    maxLength={120}
                    onChange={(e) => change({ ...ep, title: e.target.value })}
                  />
                </Field>
                <Field label="Caption style">
                  <select
                    aria-label="Caption style"
                    value={ep.captions.style}
                    onChange={(e) =>
                      change({
                        ...ep,
                        captions: {
                          ...ep.captions,
                          style: e.target.value as Episode["captions"]["style"],
                        },
                      })
                    }
                  >
                    {CAPTION_STYLES.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Music mood">
                  <select
                    aria-label="Music mood"
                    value={ep.music.mood}
                    onChange={(e) =>
                      change({
                        ...ep,
                        music: {
                          ...ep.music,
                          mood: e.target.value as Episode["music"]["mood"],
                          src: undefined,
                        },
                      })
                    }
                  >
                    {MUSIC_MOODS.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={`Music level · ${Math.round(ep.music.volume * 100)}%`}
                >
                  <input
                    aria-label="Music volume"
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={ep.music.volume}
                    onChange={(e) =>
                      change({
                        ...ep,
                        music: { ...ep.music, volume: +e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Brand handle">
                  <input
                    aria-label="Brand handle"
                    value={ep.brand.handle}
                    maxLength={40}
                    placeholder="@yourchannel"
                    onChange={(e) =>
                      change({
                        ...ep,
                        brand: { ...ep.brand, handle: e.target.value },
                      })
                    }
                  />
                </Field>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={ep.brand.watermark}
                    onChange={(e) =>
                      change({
                        ...ep,
                        brand: { ...ep.brand, watermark: e.target.checked },
                      })
                    }
                  />{" "}
                  Show brand handle
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={ep.brand.progressBar}
                    onChange={(e) =>
                      change({
                        ...ep,
                        brand: { ...ep.brand, progressBar: e.target.checked },
                      })
                    }
                  />{" "}
                  Show progress bar
                </label>
                <div className="notice">
                  <Mic size={16} />
                  <div>
                    {ep.shots.filter((s) => s.voice).length} of{" "}
                    {ep.shots.length} scenes have voice audio. Use “Voice &
                    music” to generate the soundtrack.
                  </div>
                </div>
                <Button
                  onClick={() => go({ name: "settings", section: "voice" })}
                >
                  Voice settings <ArrowRight size={14} />
                </Button>
              </fieldset>
            ) : (
              <div>
                {bundle?.renders.length ? (
                  bundle.renders.map((r) => (
                    <div className="export-card" key={r.file}>
                      <Check size={18} />
                      <strong>{r.file}</strong>
                      <span>
                        {bytes(r.size)} ·{" "}
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                      <div className="row">
                        <Button
                          onClick={() =>
                            void api.app.openPath(r.path).catch(report)
                          }
                        >
                          <Play size={13} /> Play
                        </Button>
                        <Button
                          onClick={() =>
                            void api.app.showItem(r.path).catch(report)
                          }
                        >
                          <FolderOpen size={13} /> Reveal
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <Empty
                    title="Your next export goes here"
                    detail="Export a vertical MP4 when the episode is ready."
                  />
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
      {code !== null && (
        <Modal title="Episode spec" close={() => setCode(null)}>
          <p className="hint">
            Advanced editing. The full spec is validated before saving.
          </p>
          <textarea
            className="code-editor"
            aria-label="Episode JSON spec"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <div className="modal-actions">
            <Button onClick={() => setCode(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!!active}
              onClick={async () => {
                try {
                  const result = await api.episode.save(
                    seriesId,
                    JSON.parse(code),
                  );
                  setEp(result.episode);
                  dirtyRef.current = false;
                  setDirty(false);
                  setCode(null);
                  useApp.getState().toast("Spec saved", "success");
                } catch (e) {
                  report(e);
                }
              }}
            >
              Validate & save
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
