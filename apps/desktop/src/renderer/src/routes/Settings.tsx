import { useEffect, useState } from "react";
import {
  Check,
  FolderOpen,
  Mic,
  Play,
  Plug,
  RefreshCw,
  Save,
  Settings2,
} from "lucide-react";
import {
  api,
  type Settings,
  type VoiceInfo,
  type CliStatus,
} from "../lib/api.ts";
import { useApp, setNavigationGuard } from "../lib/store.ts";
import { LANGUAGE_OPTIONS, STYLE_OPTIONS } from "../lib/format.ts";
import { Button, Field, Tag, report } from "../components/ui.tsx";
export function SettingsPage() {
  const settings = useApp((s) => s.settings)!,
    route = useApp((s) => s.route),
    engine = useApp((s) => s.engine);
  const [draft, setDraft] = useState<Settings>(structuredClone(settings)),
    [section, setSection] = useState(
      route.name === "settings" ? (route.section ?? "ai") : "ai",
    ),
    [saving, setSaving] = useState(false),
    [testing, setTesting] = useState(false),
    [test, setTest] = useState(""),
    [detected, setDetected] = useState<{
      claude: CliStatus;
      codex: CliStatus;
    } | null>(null),
    [voices, setVoices] = useState<VoiceInfo[]>([]),
    [previewing, setPreviewing] = useState(false),
    [preparing, setPreparing] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  useEffect(() => {
    setNavigationGuard(
      () => !dirty || window.confirm("Discard unsaved settings?"),
    );
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      setNavigationGuard(null);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty]);
  useEffect(() => {
    api.ai.detect().then(setDetected).catch(report);
  }, []);
  useEffect(() => {
    let alive = true;
    api.voice
      .list(draft.voice.provider)
      .then((v) => {
        if (alive) setVoices(v);
      })
      .catch(report);
    return () => {
      alive = false;
    };
  }, [draft.voice.provider]);
  const save = async () => {
    setSaving(true);
    try {
      await useApp.getState().updateSettings({ ...draft, onboarded: true });
      setDraft(structuredClone(useApp.getState().settings!));
      useApp.getState().toast("Settings saved", "success");
      return true;
    } catch (e) {
      report(e);
      return false;
    } finally {
      setSaving(false);
    }
  };
  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  return (
    <div className="page settings-page enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE YOURSELF AT HOME</div>
          <h1>Studio settings</h1>
          <p>Your AI, your voice, your signature.</p>
        </div>
        <Button
          variant="primary"
          disabled={!dirty}
          busy={saving}
          onClick={() => void save()}
        >
          <Save size={15} /> Save changes
        </Button>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings categories">
          {[
            ["ai", "AI connection"],
            ["voice", "Voice & narration"],
            ["brand", "Brand & defaults"],
            ["render", "Rendering"],
            ["general", "Workspace"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={section === v ? "selected" : ""}
              onClick={() => setSection(v)}
            >
              {l}
            </button>
          ))}
        </nav>
        <section className="settings-content">
          {section === "ai" ? (
            <>
              <div className="settings-section-title">
                <Plug size={21} />
                <div>
                  <h2>Your creative partner</h2>
                  <p>Connect an installed CLI or use your own API key.</p>
                </div>
              </div>
              <div className="provider-grid">
                {[
                  [
                    "claude-cli",
                    "Claude Code",
                    "Use your local Claude Code login",
                  ],
                  ["codex-cli", "Codex", "Use your local Codex login"],
                  ["anthropic", "Anthropic API", "Connect with an API key"],
                  ["openai", "OpenAI API", "Connect with an API key"],
                ].map(([id, label, desc]) => (
                  <button
                    key={id}
                    className={`provider-card ${draft.ai.provider === id ? "selected" : ""}`}
                    onClick={() =>
                      patch("ai", {
                        ...draft.ai,
                        provider: id as Settings["ai"]["provider"],
                        model: "",
                      })
                    }
                  >
                    <span className="provider-logo">
                      {id.startsWith("claude") || id === "anthropic"
                        ? "✳"
                        : "◉"}
                    </span>
                    <strong>{label}</strong>
                    <p>{desc}</p>
                    {draft.ai.provider === id && <Check size={15} />}
                  </button>
                ))}
              </div>
              {draft.ai.provider.endsWith("-cli") ? (
                <div className="notice">
                  <span
                    className={`status-dot ${detected?.[draft.ai.provider === "claude-cli" ? "claude" : "codex"].installed ? "" : "gray"}`}
                  />
                  <div>
                    <strong>
                      {draft.ai.provider === "claude-cli"
                        ? "Claude Code"
                        : "Codex"}{" "}
                      {detected
                        ? detected[
                            draft.ai.provider === "claude-cli"
                              ? "claude"
                              : "codex"
                          ].installed
                          ? "is installed"
                          : "was not found"
                        : "detection in progress…"}
                    </strong>
                    <p>
                      Sign in using the CLI on this computer before generating
                      stories. Connection testing sends a small request to your
                      provider.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    aria-label="Detect AI tools again"
                    onClick={() =>
                      void api.ai.detect().then(setDetected).catch(report)
                    }
                  >
                    <RefreshCw size={14} />
                  </Button>
                </div>
              ) : (
                <Field
                  label={
                    draft.ai.provider === "anthropic"
                      ? "Anthropic API key"
                      : "OpenAI API key"
                  }
                  hint="Keys are stored locally and encrypted using the operating system when available."
                >
                  <input
                    aria-label="AI API key"
                    type="password"
                    autoComplete="off"
                    placeholder="Paste your API key"
                    value={
                      draft.ai.provider === "anthropic"
                        ? draft.ai.anthropicKey
                        : draft.ai.openaiKey
                    }
                    onChange={(e) =>
                      patch("ai", {
                        ...draft.ai,
                        [draft.ai.provider === "anthropic"
                          ? "anthropicKey"
                          : "openaiKey"]: e.target.value,
                      })
                    }
                  />
                </Field>
              )}
              <Field
                label="Model"
                hint="Leave empty to use the provider’s default model."
              >
                <input
                  aria-label="AI model"
                  placeholder="Provider default"
                  value={draft.ai.model}
                  onChange={(e) =>
                    patch("ai", { ...draft.ai, model: e.target.value })
                  }
                />
              </Field>
              <div className="two-fields">
                <Field label="Reasoning effort">
                  <select
                    aria-label="Reasoning effort"
                    value={draft.ai.effort}
                    onChange={(e) =>
                      patch("ai", {
                        ...draft.ai,
                        effort: e.target.value as Settings["ai"]["effort"],
                      })
                    }
                  >
                    {["low", "medium", "high"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Automatic repair attempts">
                  <input
                    aria-label="Automatic repair attempts"
                    type="number"
                    min={0}
                    max={5}
                    value={draft.ai.maxRepairs}
                    onChange={(e) =>
                      patch("ai", {
                        ...draft.ai,
                        maxRepairs: Math.max(0, Math.min(5, +e.target.value)),
                      })
                    }
                  />
                </Field>
              </div>
              <Button
                busy={testing}
                onClick={async () => {
                  if (!(await save())) return;
                  setTesting(true);
                  setTest("");
                  try {
                    const r = await api.ai.test();
                    setTest(
                      r.ok
                        ? `Connected${r.model ? ` to ${r.model}` : ""} · ${(r.ms / 1000).toFixed(1)}s`
                        : `Connection failed: ${r.error ?? r.reply}`,
                    );
                  } catch (e) {
                    report(e);
                  } finally {
                    setTesting(false);
                  }
                }}
              >
                <Plug size={15} /> Save & test connection
              </Button>
              {test && (
                <p
                  className={`test-result ${test.startsWith("Connected") ? "success" : ""}`}
                  role="status"
                >
                  {test}
                </p>
              )}
            </>
          ) : section === "voice" ? (
            <>
              <div className="settings-section-title">
                <Mic size={21} />
                <div>
                  <h2>A voice for your stories</h2>
                  <p>Choose how Moco narrates your episodes.</p>
                </div>
              </div>
              <Field label="Voice provider">
                <select
                  aria-label="Voice provider"
                  value={draft.voice.provider}
                  onChange={(e) =>
                    patch("voice", {
                      ...draft.voice,
                      provider: e.target.value as Settings["voice"]["provider"],
                      voice: "",
                    })
                  }
                >
                  <option value="system">System voice · local & free</option>
                  <option value="openai">OpenAI TTS · API key required</option>
                  <option value="elevenlabs">
                    ElevenLabs · API key required
                  </option>
                  <option value="none">No narration</option>
                </select>
              </Field>
              {draft.voice.provider === "elevenlabs" && (
                <Field label="ElevenLabs API key">
                  <input
                    aria-label="ElevenLabs API key"
                    type="password"
                    autoComplete="off"
                    value={draft.voice.elevenlabsKey}
                    onChange={(e) =>
                      patch("voice", {
                        ...draft.voice,
                        elevenlabsKey: e.target.value,
                      })
                    }
                  />
                </Field>
              )}
              {draft.voice.provider === "openai" && (
                <p className="notice">
                  Uses the OpenAI API key saved in AI connection settings.
                </p>
              )}
              {draft.voice.provider !== "none" && (
                <>
                  <Field label="Voice">
                    <select
                      aria-label="Narration voice"
                      value={draft.voice.voice}
                      onChange={(e) =>
                        patch("voice", {
                          ...draft.voice,
                          voice: e.target.value,
                        })
                      }
                    >
                      <option value="">Automatic voice</option>
                      {voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} {v.locale && `· ${v.locale}`}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label={`Speaking speed · ${draft.voice.rate.toFixed(1)}×`}
                  >
                    <input
                      aria-label="Speaking speed"
                      type="range"
                      min={0.5}
                      max={1.5}
                      step={0.1}
                      value={draft.voice.rate}
                      onChange={(e) =>
                        patch("voice", {
                          ...draft.voice,
                          rate: +e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Button
                    busy={previewing}
                    onClick={async () => {
                      if (!(await save())) return;
                      setPreviewing(true);
                      try {
                        const r = await api.voice.preview(
                          "Every great story begins with a little courage. Welcome to Moco.",
                        );
                        if (r.error) throw new Error(r.error);
                        if (r.url) {
                          const a = new Audio(r.url);
                          await a.play();
                        }
                        if (r.fallbackReason)
                          useApp.getState().toast(r.fallbackReason);
                      } catch (e) {
                        report(e);
                      } finally {
                        setPreviewing(false);
                      }
                    }}
                  >
                    <Play size={15} /> Save & preview voice
                  </Button>
                </>
              )}
            </>
          ) : section === "brand" ? (
            <>
              <div className="settings-section-title">
                <Settings2 size={21} />
                <div>
                  <h2>Make every reel yours</h2>
                  <p>Defaults apply to newly created series and episodes.</p>
                </div>
              </div>
              <Field label="Channel handle">
                <input
                  aria-label="Default channel handle"
                  placeholder="@yourchannel"
                  maxLength={40}
                  value={draft.brand.handle}
                  onChange={(e) =>
                    patch("brand", { ...draft.brand, handle: e.target.value })
                  }
                />
              </Field>
              <Field label="Accent color">
                <input
                  aria-label="Brand accent color"
                  type="color"
                  value={draft.brand.accent}
                  onChange={(e) =>
                    patch("brand", { ...draft.brand, accent: e.target.value })
                  }
                />
              </Field>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={draft.brand.watermark}
                  onChange={(e) =>
                    patch("brand", {
                      ...draft.brand,
                      watermark: e.target.checked,
                    })
                  }
                />{" "}
                Show channel handle on new episodes
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={draft.brand.progressBar}
                  onChange={(e) =>
                    patch("brand", {
                      ...draft.brand,
                      progressBar: e.target.checked,
                    })
                  }
                />{" "}
                Show video progress bar
              </label>
              <hr />
              <div className="two-fields">
                <Field label="Default language">
                  <select
                    aria-label="Default language"
                    value={draft.defaults.language}
                    onChange={(e) =>
                      patch("defaults", {
                        ...draft.defaults,
                        language: e.target.value,
                      })
                    }
                  >
                    {LANGUAGE_OPTIONS.map((v) => (
                      <option key={v.value} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Default visual style">
                  <select
                    aria-label="Default style"
                    value={draft.defaults.style}
                    onChange={(e) =>
                      patch("defaults", {
                        ...draft.defaults,
                        style: e.target.value,
                      })
                    }
                  >
                    {STYLE_OPTIONS.map((v) => (
                      <option key={v.value} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Default episodes">
                  <input
                    aria-label="Default episode count"
                    type="number"
                    min={1}
                    max={10}
                    value={draft.defaults.episodes}
                    onChange={(e) =>
                      patch("defaults", {
                        ...draft.defaults,
                        episodes: Math.min(10, Math.max(1, +e.target.value)),
                      })
                    }
                  />
                </Field>
                <Field label="Default duration (seconds)">
                  <input
                    aria-label="Default episode duration"
                    type="number"
                    min={10}
                    max={120}
                    value={draft.defaults.seconds}
                    onChange={(e) =>
                      patch("defaults", {
                        ...draft.defaults,
                        seconds: Math.min(120, Math.max(10, +e.target.value)),
                      })
                    }
                  />
                </Field>
              </div>
            </>
          ) : section === "render" ? (
            <>
              <h2>Local rendering</h2>
              <p>
                Export H.264 MP4 files with AAC audio, ready for Reels and
                Shorts.
              </p>
              <Field label="Export quality">
                <select
                  aria-label="Export quality"
                  value={draft.render.quality}
                  onChange={(e) =>
                    patch("render", {
                      ...draft.render,
                      quality: e.target.value as Settings["render"]["quality"],
                    })
                  }
                >
                  <option value="draft">
                    Draft · 540 × 960 · faster previews
                  </option>
                  <option value="standard">Standard · 1080 × 1920</option>
                  <option value="high">
                    High · 1080 × 1920 · higher bitrate
                  </option>
                </select>
              </Field>
              <Field
                label="Concurrent rendering threads"
                hint="0 lets the renderer choose a suitable value for your machine."
              >
                <input
                  aria-label="Rendering threads"
                  type="number"
                  min={0}
                  max={16}
                  value={draft.render.concurrency}
                  onChange={(e) =>
                    patch("render", {
                      ...draft.render,
                      concurrency: Math.min(16, Math.max(0, +e.target.value)),
                    })
                  }
                />
              </Field>
              <Field label="Remotion license key (optional)">
                <input
                  aria-label="Remotion license key"
                  type="password"
                  autoComplete="off"
                  value={draft.render.remotionLicenseKey}
                  onChange={(e) =>
                    patch("render", {
                      ...draft.render,
                      remotionLicenseKey: e.target.value,
                    })
                  }
                />
              </Field>
              <div className="notice">
                <div>
                  <strong>Engine: {engine?.browser ?? "unknown"}</strong>
                  <p>
                    Installed apps include a render browser for offline exports.
                    Check it here, or download it if your development setup
                    needs one.
                  </p>
                </div>
              </div>
              <Button
                busy={preparing}
                disabled={engine?.browser === "ready"}
                onClick={async () => {
                  setPreparing(true);
                  try {
                    await api.render.prepare();
                    useApp
                      .getState()
                      .toast("Render engine is ready", "success");
                  } catch (e) {
                    report(e);
                  } finally {
                    setPreparing(false);
                  }
                }}
              >
                <RefreshCw size={15} />
                {engine?.browser === "ready"
                  ? "Engine ready"
                  : "Prepare render engine"}
              </Button>
            </>
          ) : (
            <>
              <h2>Your local workspace</h2>
              <p>
                Your projects are plain folders on this computer. Back them up,
                move them, or open them whenever you like.
              </p>
              <Field
                label="Project folder"
                hint="Changing the folder switches libraries. Existing files stay in their original location."
              >
                <div className="row">
                  <input
                    aria-label="Project folder"
                    value={draft.projectsDir}
                    readOnly
                  />
                  <Button
                    onClick={async () => {
                      try {
                        const p = await api.app.chooseFolder();
                        if (p) patch("projectsDir", p);
                      } catch (e) {
                        report(e);
                      }
                    }}
                  >
                    <FolderOpen size={15} /> Browse
                  </Button>
                </div>
              </Field>
              <Field label="Appearance">
                <select
                  aria-label="Appearance"
                  value={draft.theme}
                  onChange={(e) =>
                    patch("theme", e.target.value as Settings["theme"])
                  }
                >
                  <option value="system">Match system</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </Field>
              <hr />
              <div className="about-moco">
                <strong>moco.</strong>
                <Tag>0.1.0</Tag>
              </div>
              <p>Small idea. Epic possibilities.</p>
              <Button
                onClick={() =>
                  void api.app.openPath(settings.projectsDir).catch(report)
                }
              >
                <FolderOpen size={15} /> Open project folder
              </Button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
