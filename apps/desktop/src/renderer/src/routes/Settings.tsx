import { useEffect, useState } from "react";
import { Check, FolderOpen, Mic, Play, Plug, RefreshCw, Save, Settings2 } from "lucide-react";
import { api, type AiStatus, type Settings, type VoiceInfo } from "../lib/api.ts";
import { useApp, setNavigationGuard } from "../lib/store.ts";
import { LANGUAGE_OPTIONS } from "../lib/format.ts";
import { Button, Field, Tag, report } from "../components/ui.tsx";

export function SettingsPage() {
  const settings = useApp((s) => s.settings)!,
    route = useApp((s) => s.route);
  const [draft, setDraft] = useState<Settings>(structuredClone(settings)),
    [section, setSection] = useState(route.name === "settings" ? (route.section ?? "ai") : "ai"),
    [saving, setSaving] = useState(false),
    [ai, setAi] = useState<AiStatus | null>(null),
    [checking, setChecking] = useState(false),
    [voices, setVoices] = useState<VoiceInfo[]>([]),
    [previewing, setPreviewing] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  useEffect(() => {
    setNavigationGuard(() => !dirty || window.confirm("Discard unsaved settings?"));
    return () => setNavigationGuard(null);
  }, [dirty]);
  const check = () => {
    setChecking(true);
    api.ai
      .status()
      .then(setAi)
      .catch(report)
      .finally(() => setChecking(false));
  };
  useEffect(check, []);
  useEffect(() => {
    api.voice.list().then(setVoices).catch(report);
  }, []);
  const save = async () => {
    setSaving(true);
    try {
      await useApp.getState().updateSettings({ ...draft, onboarded: true });
      setDraft(structuredClone(useApp.getState().settings!));
      useApp.getState().toast("Settings saved", "success");
    } catch (e) {
      report(e);
    } finally {
      setSaving(false);
    }
  };
  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d, [key]: value }));
  return (
    <div className="page settings-page enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE YOURSELF AT HOME</div>
          <h1>Studio settings</h1>
          <p>Your AI, your voice, your workspace.</p>
        </div>
        <Button variant="primary" disabled={!dirty} busy={saving} onClick={() => void save()}>
          <Save size={15} /> Save changes
        </Button>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings categories">
          {[
            ["ai", "AI connection"],
            ["voice", "Voice & narration"],
            ["render", "Rendering"],
            ["general", "Workspace"],
          ].map(([v, l]) => (
            <button key={v} className={section === v ? "selected" : ""} onClick={() => setSection(v!)}>
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
                  <p>Moco writes with the Claude Code installed on this computer, on your own Claude plan. No API keys.</p>
                </div>
              </div>
              <div className="notice">
                {ai === null ? (
                  "Checking Claude Code…"
                ) : ai.ok ? (
                  <>
                    <Check size={15} /> Claude Code {ai.version} is ready ({ai.authMethod}).
                  </>
                ) : (
                  ai.reason
                )}
                <Button variant="ghost" busy={checking} onClick={check}>
                  <RefreshCw size={14} /> Check again
                </Button>
              </div>
            </>
          ) : section === "voice" ? (
            <>
              <div className="settings-section-title">
                <Mic size={21} />
                <div>
                  <h2>Narration</h2>
                  <p>The voices that come with your computer. Free, offline, and always available.</p>
                </div>
              </div>
              <Field label="Voice">
                <select
                  aria-label="Narration voice"
                  value={draft.voice.voice}
                  onChange={(e) => patch("voice", { ...draft.voice, voice: e.target.value })}
                >
                  <option value="">System default</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} {v.locale && `(${v.locale})`}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`Speed ${draft.voice.rate.toFixed(2)}×`}>
                <input
                  aria-label="Narration speed"
                  type="range"
                  min={0.7}
                  max={1.4}
                  step={0.05}
                  value={draft.voice.rate}
                  onChange={(e) => patch("voice", { ...draft.voice, rate: +e.target.value })}
                />
              </Field>
              <Button
                busy={previewing}
                disabled={dirty}
                title={dirty ? "Save first to hear the new voice" : undefined}
                onClick={async () => {
                  setPreviewing(true);
                  const r = await api.voice.preview("Arise, Arjuna. Do your duty, and let go of the fruit of your actions.");
                  setPreviewing(false);
                  if (r.error) report(r.error);
                  else if (r.url) void new Audio(r.url).play();
                }}
              >
                <Play size={14} /> Hear it
              </Button>
            </>
          ) : section === "render" ? (
            <>
              <div className="settings-section-title">
                <Settings2 size={21} />
                <div>
                  <h2>Rendering</h2>
                  <p>Videos render on this computer. More tabs is faster but uses more memory.</p>
                </div>
              </div>
              <Field label="Browser tabs per render" hint="Each 1080 × 1920 tab needs about 1 GB of memory.">
                <select
                  aria-label="Render concurrency"
                  value={draft.render.concurrency}
                  onChange={(e) => patch("render", { concurrency: +e.target.value })}
                >
                  <option value={0}>Automatic (2)</option>
                  {[1, 2, 4, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : (
            <>
              <div className="settings-section-title">
                <FolderOpen size={21} />
                <div>
                  <h2>Workspace</h2>
                  <p>Projects are plain folders you can back up.</p>
                </div>
              </div>
              <Field label="Projects folder">
                <div className="row">
                  <input aria-label="Projects folder" readOnly value={draft.projectsDir} />
                  <Button
                    onClick={async () => {
                      const dir = await api.app.chooseFolder();
                      if (dir) patch("projectsDir", dir);
                    }}
                  >
                    Choose…
                  </Button>
                </div>
              </Field>
              <div className="two-fields">
                <Field label="Episodes for a new series">
                  <select
                    aria-label="Default episodes"
                    value={draft.defaults.episodes}
                    onChange={(e) => patch("defaults", { ...draft.defaults, episodes: +e.target.value })}
                  >
                    {[1, 2, 3, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Language">
                  <select
                    aria-label="Default language"
                    value={draft.defaults.language}
                    onChange={(e) => patch("defaults", { ...draft.defaults, language: e.target.value })}
                  >
                    {LANGUAGE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Appearance">
                <div className="tabs">
                  {(["system", "light", "dark"] as const).map((t) => (
                    <button key={t} className={draft.theme === t ? "selected" : ""} onClick={() => patch("theme", t)}>
                      {t}
                    </button>
                  ))}
                </div>
              </Field>
              <Tag>Saved on this device</Tag>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
