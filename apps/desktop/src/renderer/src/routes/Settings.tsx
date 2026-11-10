import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CircleCheckIcon,
  FolderOpenIcon,
  MicIcon,
  MonitorIcon,
  MoonIcon,
  PlayIcon,
  PlugIcon,
  RefreshCwIcon,
  SaveIcon,
  SunIcon,
  TriangleAlertIcon,
  VideoIcon,
} from "lucide-react";
import { api, type AiStatus, type Settings, type Theme, type VoiceInfo } from "@/lib/api.ts";
import type { VoiceModelStatus } from "../../../shared/api.ts";
import { VoiceDownloadProgress } from "../components/VoiceDownloadProgress.tsx";
import { CodexAccountSwitch } from "../components/CodexAccountSwitch.tsx";
import { voiceLanguageProblem } from "../../../shared/voice-availability.ts";
import { report, setNavigationGuard, useApp } from "@/lib/store.ts";
import { EPISODE_COUNTS, LANGUAGE_OPTIONS } from "@/lib/format.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Page, PageHeader } from "../components/Page.tsx";

const SYSTEM_VOICE = "system"; // Select items can't have an empty value; "" means the system voice.
const PREVIEW_LINE = "Every story starts with one small, stubborn step into the unknown.";
const HINDI_PREVIEW_LINE = "हर कहानी एक छोटे से कदम से शुरू होती है। डर के आगे बढ़ो, और अपनी कहानी खुद लिखो।";

export function SettingsPage() {
  const settings = useApp((s) => s.settings)!,
    route = useApp((s) => s.route),
    ai = useApp((s) => s.ai);
  const [draft, setDraft] = useState<Settings>(structuredClone(settings)),
    [section, setSection] = useState(route.name === "settings" ? (route.section ?? "ai") : "ai"),
    [saving, setSaving] = useState(false),
    [checking, setChecking] = useState(false),
    [voices, setVoices] = useState<VoiceInfo[]>([]),
    [elevenVoices, setElevenVoices] = useState<VoiceInfo[]>([]),
    [loadingElevenVoices, setLoadingElevenVoices] = useState(false),
    [elevenVoiceError, setElevenVoiceError] = useState(""),
    [models, setModels] = useState<VoiceModelStatus[]>([]),
    [modelError, setModelError] = useState(""),
    [previewing, setPreviewing] = useState(false),
    [leaving, setLeaving] = useState<(() => void) | null>(null);
  const voiceRequest = useRef(0);
  const [blender, setBlender] = useState<{ ok: boolean; path: string; version?: string; reason?: string } | null>(null);
  const [checkingBlender, setCheckingBlender] = useState(false);
  const checkBlender = async () => {
    setCheckingBlender(true);
    try { setBlender(await api.settings.blenderStatus(draft.render.blenderPath)); }
    catch (error) { report(error); }
    finally { setCheckingBlender(false); }
  };
  useEffect(() => {
    voiceRequest.current += 1;
    setElevenVoices([]);
    setElevenVoiceError("");
    setLoadingElevenVoices(false);
    return () => { voiceRequest.current += 1; };
  }, [draft.voice.elevenlabs?.apiKey, draft.voice.backend]);
  // Appearance applies at once (like the switch in the top bar), so it isn't part of the draft.
  const dirty = JSON.stringify({ ...draft, theme: settings.theme }) !== JSON.stringify(settings);

  // Leaving with unsaved changes asks first, in the dialog at the bottom of this page.
  useEffect(() => {
    setNavigationGuard((proceed) => {
      if (!dirty) return true;
      setLeaving(() => proceed);
      return false;
    });
    return () => setNavigationGuard(null);
  }, [dirty]);

  const check = async () => {
    setChecking(true);
    try {
      await useApp.getState().checkAi();
    } catch (e) {
      report(e);
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    void check();
    api.voice.list().then(setVoices).catch(report);
  }, []);
  useEffect(() => {
    let disposed = false;
    const refresh = () => api.voice.models().then((next) => { if (!disposed) { setModels(next); setModelError(""); } }).catch((error) => { if (!disposed) setModelError(String(error)); });
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  const neuralReady = !voiceLanguageProblem(draft.defaults.language, { ...draft.voice, backend: "chatterbox" }, null, models);
  const downloadBusy = models.some((model) => model.state === "downloading");

  const save = async () => {
    setSaving(true);
    try {
      const { theme: _theme, ...changes } = draft;
      await useApp.getState().updateSettings({ ...changes, onboarded: true });
      setDraft(structuredClone(useApp.getState().settings!));
      await check();
      useApp.getState().toast("Settings saved", "success");
      return true;
    } catch (e) {
      report(e);
      return false;
    } finally {
      setSaving(false);
    }
  };
  const hearVoice = async () => {
    setPreviewing(true);
    try {
      const result = await api.voice.preview(settings.defaults.language.split(/[-_]/)[0] === "hi" ? HINDI_PREVIEW_LINE : PREVIEW_LINE);
      if (result.error) report(result.error);
      else if (result.url) await new Audio(result.url).play();
    } catch (e) {
      report(e);
    } finally {
      setPreviewing(false);
    }
  };
  const setTheme = (theme: Theme) => void useApp.getState().updateSettings({ theme }).catch(report);
  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const patchElevenLabs = (value: NonNullable<Settings["voice"]["elevenlabs"]>) => patch("voice", { ...draft.voice, elevenlabs: { ...draft.voice.elevenlabs, ...value } });
  const hasElevenLabsKey = draft.voice.elevenlabs?.apiKey !== undefined ? Boolean(draft.voice.elevenlabs.apiKey.trim()) : Boolean(draft.voice.elevenlabs?.hasApiKey);
  const loadElevenVoices = async () => {
    const request = ++voiceRequest.current;
    setLoadingElevenVoices(true);
    setElevenVoiceError("");
    try {
      const next = await api.voice.elevenLabsVoices(draft.voice.elevenlabs?.apiKey);
      if (request === voiceRequest.current) {
        setElevenVoices(next);
        if (!next.length) setElevenVoiceError("No voices found. Add a voice to your ElevenLabs account, then load again.");
      }
    } catch (error) {
      if (request === voiceRequest.current) { setElevenVoices([]); setElevenVoiceError(error instanceof Error ? error.message : String(error)); }
    } finally {
      if (request === voiceRequest.current) setLoadingElevenVoices(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title="Settings"
        description="Your AI connection, narration voice and workspace."
        actions={
          <>
            {dirty && (
              <Button variant="ghost" disabled={saving} onClick={() => setDraft(structuredClone(settings))}>
                Discard changes
              </Button>
            )}
            <Button disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? <Spinner data-icon="inline-start" aria-hidden /> : <SaveIcon data-icon="inline-start" />}
              Save changes
            </Button>
          </>
        }
      />
      <Tabs orientation="vertical" value={section} onValueChange={setSection} className="gap-10">
        <TabsList className="w-52 shrink-0 items-stretch">
          <TabsTrigger value="ai" className="h-9 px-3">
            <PlugIcon />
            AI connection
          </TabsTrigger>
          <TabsTrigger value="voice" className="h-9 px-3">
            <MicIcon />
            Voice & narration
          </TabsTrigger>
          <TabsTrigger value="render" className="h-9 px-3">
            <VideoIcon />
            Rendering
          </TabsTrigger>
          <TabsTrigger value="general" className="h-9 px-3">
            <FolderOpenIcon />
            General
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ai" className="max-w-xl">
          <Section
            title="AI connection"
            description="Choose the CLI installed on this computer. Moco uses its existing login and your own plan."
          >
            <Field>
              <FieldLabel htmlFor="ai-provider">AI provider</FieldLabel>
              <Select value={draft.aiProvider} onValueChange={(value) => patch("aiProvider", value as Settings["aiProvider"])}>
                <SelectTrigger id="ai-provider" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-cli">Claude Code</SelectItem>
                  <SelectItem value="codex-cli">Codex</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>Save changes to use this provider for story generation and template learning.</FieldDescription>
            </Field>
            <AiStatusAlert ai={ai} name={settings.aiProvider === "codex-cli" ? "Codex" : "Claude Code"} />
            <Button variant="outline" className="self-start" disabled={checking} onClick={() => void check()}>
              {checking ? <Spinner data-icon="inline-start" aria-hidden /> : <RefreshCwIcon data-icon="inline-start" />}
              Check again
            </Button>
            {draft.aiProvider === "codex-cli" && <CodexAccountSwitch disabled={settings.aiProvider !== "codex-cli" || saving} />}
          </Section>
        </TabsContent>

        <TabsContent value="voice" className="max-w-xl">
          <Section
            title="Narration"
            description="Use your computer's voices, a local neural model, or ElevenLabs with your own API key."
          >
            <Field>
              <FieldLabel htmlFor="voice-backend">Voice engine</FieldLabel>
              <Select value={draft.voice.backend ?? "system"} onValueChange={(backend) => patch("voice", { ...draft.voice, backend: backend as Settings["voice"]["backend"], rate: backend === "elevenlabs" ? Math.min(draft.voice.rate, 1.2) : draft.voice.rate })}>
                <SelectTrigger id="voice-backend" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="chatterbox" disabled={!neuralReady}>Chatterbox · {neuralReady ? "expressive neural voice" : "download a model below"}</SelectItem>
                  <SelectItem value="system">System speech · basic offline voice</SelectItem>
                  <SelectItem value="elevenlabs">ElevenLabs · your API key</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>System speech works offline. Chatterbox needs a downloaded model. ElevenLabs uses your account and an internet connection.</FieldDescription>
            </Field>
            {draft.voice.backend === "elevenlabs" && <FieldSet>
              <FieldLegend>ElevenLabs account</FieldLegend>
              <FieldDescription>Previews and episode narration send script text to ElevenLabs and use your account's credits. The model is Eleven Multilingual v2, including English, Hindi and Tamil.</FieldDescription>
              <Field>
                <FieldLabel htmlFor="elevenlabs-api-key">ElevenLabs API key</FieldLabel>
                <InputGroup><InputGroupInput id="elevenlabs-api-key" type="password" autoComplete="off" spellCheck={false}
                  value={draft.voice.elevenlabs?.apiKey ?? ""}
                  placeholder={draft.voice.elevenlabs?.hasApiKey ? "Key saved · enter a new key to replace it" : "Paste your ElevenLabs API key"}
                  onChange={(event) => patchElevenLabs({ apiKey: event.target.value || undefined })} /></InputGroup>
                <FieldDescription>{draft.voice.elevenlabs?.hasApiKey ? "A key is saved. Leave this field empty to keep it. " : ""}Saved keys are encrypted using your OS credential protection. Allow Text to Speech and Voices read access.</FieldDescription>
                <Button variant="link" className="self-start" onClick={() => void api.app.openExternal("https://elevenlabs.io/app/settings/api-keys")}>Get an ElevenLabs API key</Button>
              </Field>
              <Field>
                <FieldLabel htmlFor="elevenlabs-voice-id">ElevenLabs voice ID</FieldLabel>
                <InputGroup><InputGroupInput id="elevenlabs-voice-id" value={draft.voice.elevenlabs?.voiceId ?? ""} placeholder="Paste a voice ID or choose one below" onChange={(event) => patchElevenLabs({ voiceId: event.target.value })} /></InputGroup>
                <Button variant="outline" className="self-start" disabled={!hasElevenLabsKey || loadingElevenVoices} onClick={() => void loadElevenVoices()}>
                  {loadingElevenVoices ? <Spinner data-icon="inline-start" aria-hidden /> : <RefreshCwIcon data-icon="inline-start" />}Load my voices
                </Button>
                {elevenVoiceError && <p role="alert" className="text-sm text-destructive">{elevenVoiceError}</p>}
                {elevenVoices.length > 0 && <>
                  <FieldLabel htmlFor="elevenlabs-voice">Choose an account voice</FieldLabel>
                  <Select value={draft.voice.elevenlabs?.voiceId || ""} onValueChange={(voiceId) => patchElevenLabs({ voiceId })}>
                    <SelectTrigger id="elevenlabs-voice" className="w-full"><SelectValue placeholder="Choose a voice" /></SelectTrigger>
                    <SelectContent>{elevenVoices.map((voice) => <SelectItem key={voice.id} value={voice.id}>{voice.name}</SelectItem>)}</SelectContent>
                  </Select>
                </>}
                <FieldDescription>Load voices with the entered or saved key, then save your changes before previewing. Existing series keep their approved narrator and character voice IDs.</FieldDescription>
              </Field>
              {hasElevenLabsKey && <Button variant="outline" className="self-start" onClick={() => patch("voice", { ...draft.voice, backend: "system", elevenlabs: { ...draft.voice.elevenlabs, apiKey: "" } })}>Remove key and use system speech</Button>}
            </FieldSet>}
            {draft.voice.backend !== "elevenlabs" && <FieldSet>
              <FieldLegend>Optional voice models</FieldLegend>
              <FieldDescription>Nothing downloads until you choose Download. Each model needs about 3 GB, plus several GB for the shared voice runtime. Downloading does not change your selected voice.</FieldDescription>
              {modelError && <p role="alert" className="text-sm text-destructive">Could not check voice models: {modelError}</p>}
              {!modelError && models.length === 0 && <p role="status" className="text-sm text-muted-foreground">Checking available voice models…</p>}
              {models.map((model) => <div key={model.id} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div><p className="text-sm font-medium">{model.name}</p><p className="text-xs text-muted-foreground mt-1">{model.size}</p></div>
                  {model.state === "ready" ? <span className="text-sm text-muted-foreground">Installed</span> : model.state === "downloading" ?
                    <Button variant="outline" size="sm" onClick={() => void api.voice.cancelDownload().catch(report)}>Cancel</Button> :
                    <Button variant="outline" size="sm" disabled={downloadBusy} onClick={async () => {
                      try { await api.voice.download(model.id); setModels(await api.voice.models()); } catch (error) { report(error); }
                    }}>{model.state === "error" ? "Retry download" : "Download"}</Button>}
                </div>
                {model.state === "downloading" && <VoiceDownloadProgress model={model} />}
                {model.message && <p role={model.state === "error" ? "alert" : "status"} className="text-xs text-muted-foreground">{model.message}</p>}
              </div>)}
              {models.some((model) => model.state === "error" && model.message?.includes("Install uv")) && <Button variant="link" className="self-start" onClick={() => void api.app.openExternal("https://docs.astral.sh/uv/getting-started/installation/")}>Get the optional voice installer</Button>}
            </FieldSet>}
            {draft.voice.backend === "chatterbox" && <>
              <Field>
                <FieldLabel htmlFor="voice-device">Narration processing</FieldLabel>
                <Select value={draft.voice.device ?? "auto"} onValueChange={(device) => patch("voice", { ...draft.voice, device: device as NonNullable<Settings["voice"]["device"]> })}>
                  <SelectTrigger id="voice-device" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automatic</SelectItem>
                    <SelectItem value="cpu">CPU</SelectItem>
                    <SelectItem value="gpu">GPU</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>Choose the processor for voice previews and episode narration. GPU uses an NVIDIA or Apple graphics processor and can be faster, but needs enough video memory. If GPU cannot run, Moco reports an error so you can choose CPU.</FieldDescription>
              </Field>
                <FieldSet>
                  <FieldLegend>Character voices</FieldLegend>
                  <FieldDescription>Add named recordings for Claude to assign in new show bibles. Existing series keep their assigned voice ids; keep those recordings available.</FieldDescription>
                  {(draft.voice.characterVoices ?? []).map((entry, index) => (
                    <div key={index} className="flex flex-col gap-2">
                      <InputGroup><InputGroupInput aria-label={`Voice ${index + 1} id`} value={entry.id} placeholder="Voice id, e.g. warm-guide" onChange={(event) => patch("voice", { ...draft.voice, characterVoices: draft.voice.characterVoices!.map((voice, i) => i === index ? { ...voice, id: event.target.value } : voice) })} /></InputGroup>
                      <InputGroup><InputGroupInput aria-label={`Voice ${index + 1} recording`} value={entry.reference} placeholder="Path to a clean 6–10 second recording" onChange={(event) => patch("voice", { ...draft.voice, characterVoices: draft.voice.characterVoices!.map((voice, i) => i === index ? { ...voice, reference: event.target.value } : voice) })} /></InputGroup>
                      <Button variant="outline" onClick={() => patch("voice", { ...draft.voice, characterVoices: draft.voice.characterVoices!.filter((_, i) => i !== index) })}>Remove voice {index + 1}</Button>
                    </div>
                  ))}
                  <Button variant="outline" onClick={() => patch("voice", { ...draft.voice, characterVoices: [...draft.voice.characterVoices ?? [], { id: "", reference: "" }] })}>Add character voice</Button>
                </FieldSet>
              <Field>
                <FieldLabel htmlFor="voice-reference">Performance reference (optional)</FieldLabel>
                <InputGroup><InputGroupInput id="voice-reference" value={draft.voice.reference ?? ""} placeholder="Path to a clean 6–10 second voice recording" onChange={(event) => patch("voice", { ...draft.voice, reference: event.target.value })} /></InputGroup>
                <FieldDescription>Use a clean recording of your narrator. Leave empty to use the built-in voice. A reference guides tone, accent and delivery.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="expressiveness">Expressiveness</FieldLabel>
                <Slider id="expressiveness" aria-label="Voice expressiveness" min={0} max={1} step={0.05} value={[draft.voice.expressiveness ?? 0.65]} onValueChange={([expressiveness]) => patch("voice", { ...draft.voice, expressiveness: expressiveness ?? 0.65 })} />
                <FieldDescription>Subtle to dramatic. Each script line also carries its own emotional intensity and pause.</FieldDescription>
              </Field>
            </>}
            {(draft.voice.backend ?? "system") === "system" && <Field>
              <FieldLabel htmlFor="voice">Voice</FieldLabel>
              <Select
                value={draft.voice.voice || SYSTEM_VOICE}
                onValueChange={(v) => patch("voice", { ...draft.voice, voice: v === SYSTEM_VOICE ? "" : v })}
              >
                <SelectTrigger id="voice" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={SYSTEM_VOICE}>System default</SelectItem>
                    {voices.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                        {v.locale && <span className="text-muted-foreground">{v.locale}</span>}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>}
            <Field>
              <div className="flex items-center justify-between gap-4">
                <FieldLabel htmlFor="rate">Speed</FieldLabel>
                <span className="text-sm text-muted-foreground tabular-nums">{draft.voice.rate.toFixed(2)}×</span>
              </div>
              <Slider
                id="rate"
                aria-label="Narration speed"
                min={0.7}
                max={draft.voice.backend === "elevenlabs" ? 1.2 : 1.4}
                step={0.05}
                value={[draft.voice.rate]}
                onValueChange={([rate]) => patch("voice", { ...draft.voice, rate: rate ?? 1 })}
              />
            </Field>
            <Field orientation="horizontal">
              <Button variant="outline" disabled={dirty || previewing || (draft.voice.backend === "chatterbox" && !neuralReady) || (draft.voice.backend === "elevenlabs" && Boolean(voiceLanguageProblem(draft.defaults.language, draft.voice, null, null)))} onClick={() => void hearVoice()}>
                {previewing ? <Spinner data-icon="inline-start" aria-hidden /> : <PlayIcon data-icon="inline-start" />}
                Hear it
              </Button>
              {dirty && <FieldDescription>Save your changes first to hear them.</FieldDescription>}
              {!dirty && draft.voice.backend === "elevenlabs" && <FieldDescription>{voiceLanguageProblem(draft.defaults.language, draft.voice, null, null) ?? "This preview uses your ElevenLabs credits."}</FieldDescription>}
            </Field>
          </Section>
        </TabsContent>

        <TabsContent value="render" className="max-w-xl">
          <Section title="Rendering" description="Videos render on this computer, never in the cloud.">
            <Field>
              <FieldLabel htmlFor="render-backend">Renderer for new animations</FieldLabel>
              <Select value={draft.render.backend ?? "remotion"} onValueChange={(value) => patch("render", { ...draft.render, backend: value as "remotion" | "blender" })}>
                <SelectTrigger id="render-backend"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="remotion">Remotion · kit and generated worlds</SelectItem>
                  <SelectItem value="blender">Blender · native 3D animation</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>New standard animations use this renderer. Illustration templates and existing projects retain their renderer.</FieldDescription>
            </Field>
            {draft.render.backend === "blender" && <>
              <Field>
                <FieldLabel htmlFor="blender-path">Blender executable</FieldLabel>
                <InputGroup><InputGroupInput id="blender-path" placeholder="Automatic detection" value={draft.render.blenderPath ?? ""} onChange={(event) => { patch("render", { ...draft.render, blenderPath: event.target.value }); setBlender(null); }} /></InputGroup>
                <FieldDescription>Install Blender 4.5 LTS with <code>pnpm blender:setup</code>, or enter your installed Blender executable. FFmpeg must be installed too.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="blender-samples">Render quality</FieldLabel>
                <Select value={String(draft.render.blenderSamples ?? 32)} onValueChange={value => patch("render", { ...draft.render, blenderSamples: Number(value) })}>
                  <SelectTrigger id="blender-samples"><SelectValue /></SelectTrigger>
                  <SelectContent>{[8,16,32,64,128].map(value => <SelectItem key={value} value={String(value)}>{value} samples{value === 32 ? " · balanced" : ""}</SelectItem>)}</SelectContent>
                </Select>
                <FieldDescription>Higher sample counts smooth shadows and take longer. Previews use up to 8 samples.</FieldDescription>
              </Field>
              <Button variant="outline" disabled={checkingBlender} onClick={() => void checkBlender()}>{checkingBlender && <Spinner />}Check Blender installation</Button>
              {blender && <Alert variant={blender.ok ? "default" : "destructive"}><AlertTitle>{blender.ok ? `Blender ${blender.version} ready` : "Blender needs setup"}</AlertTitle><AlertDescription className="break-all">{blender.ok ? blender.path : blender.reason}</AlertDescription></Alert>}
            </>}
            <Field>
              <FieldLabel htmlFor="concurrency">Browser tabs per render</FieldLabel>
              <Select
                value={String(draft.render.concurrency)}
                onValueChange={(v) => patch("render", { ...draft.render, concurrency: Number(v) })}
              >
                <SelectTrigger id="concurrency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="0">Automatic (2 tabs)</SelectItem>
                    {[1, 2, 4, 8].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} {n === 1 ? "tab" : "tabs"}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                More tabs render faster but use more memory: each 1080 × 1920 tab needs about 1 GB.
              </FieldDescription>
            </Field>
          </Section>
        </TabsContent>

        <TabsContent value="general" className="max-w-xl">
          <Section title="General" description="Where projects live, how new series start, and how Moco looks.">
            <Field>
              <FieldLabel htmlFor="projects-dir">Projects folder</FieldLabel>
              <InputGroup>
                <InputGroupInput id="projects-dir" readOnly value={draft.projectsDir} />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    variant="secondary"
                    onClick={async () => {
                      const dir = await api.app.chooseFolder();
                      if (dir) patch("projectsDir", dir);
                    }}
                  >
                    Choose…
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>Projects are plain folders you can back up.</FieldDescription>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="default-episodes">Episodes in a new series</FieldLabel>
                <Select
                  value={String(draft.defaults.episodes)}
                  onValueChange={(v) => patch("defaults", { ...draft.defaults, episodes: Number(v) })}
                >
                  <SelectTrigger id="default-episodes" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {EPISODE_COUNTS.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} {n === 1 ? "episode" : "episodes"}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="default-language">Story language</FieldLabel>
                <Select
                  value={draft.defaults.language}
                  onValueChange={(v) => patch("defaults", { ...draft.defaults, language: v })}
                >
                  <SelectTrigger id="default-language" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {LANGUAGE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field>
              <FieldTitle id="appearance-label">Appearance</FieldTitle>
              <ToggleGroup
                type="single"
                variant="outline"
                aria-labelledby="appearance-label"
                value={settings.theme}
                onValueChange={(value) => value && setTheme(value as Theme)}
              >
                <ToggleGroupItem value="system">
                  <MonitorIcon />
                  System
                </ToggleGroupItem>
                <ToggleGroupItem value="light">
                  <SunIcon />
                  Light
                </ToggleGroupItem>
                <ToggleGroupItem value="dark">
                  <MoonIcon />
                  Dark
                </ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>Changes right away.</FieldDescription>
            </Field>
          </Section>
        </TabsContent>
      </Tabs>

      <AlertDialog open={leaving !== null} onOpenChange={(open) => !open && setLeaving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your settings have unsaved changes. If you leave without saving, they’re lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                const proceed = leaving;
                setLeaving(null);
                setNavigationGuard(null);
                proceed?.();
              }}
            >
              Discard
            </Button>
            <Button
              disabled={saving}
              onClick={async () => {
                const proceed = leaving;
                if (!(await save())) return;
                setLeaving(null);
                setNavigationGuard(null);
                proceed?.();
              }}
            >
              {saving && <Spinner data-icon="inline-start" aria-hidden />}
              Save and leave
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <FieldSet>
      <FieldLegend>{title}</FieldLegend>
      <FieldDescription>{description}</FieldDescription>
      <FieldGroup className="gap-6">{children}</FieldGroup>
    </FieldSet>
  );
}

function AiStatusAlert({ ai, name }: { ai: AiStatus | null; name: string }) {
  if (!ai)
    return (
      <Alert>
        <Spinner aria-hidden />
        <AlertTitle>Checking {name}…</AlertTitle>
        <AlertDescription>This takes a few seconds.</AlertDescription>
      </Alert>
    );
  if (ai.ok)
    return (
      <Alert>
        <CircleCheckIcon />
        <AlertTitle>{name} {ai.version} is ready</AlertTitle>
        <AlertDescription>
          {ai.authMethod ? `Signed in with ${ai.authMethod}.` : "Signed in."} Moco works within your plan’s limits.
        </AlertDescription>
      </Alert>
    );
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{name} isn’t ready</AlertTitle>
      <AlertDescription className="select-text">{ai.reason}</AlertDescription>
    </Alert>
  );
}
