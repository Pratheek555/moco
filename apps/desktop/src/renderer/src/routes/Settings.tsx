import { useEffect, useState, type ReactNode } from "react";
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
import { report, setNavigationGuard, useApp } from "@/lib/store.ts";
import { LANGUAGE_OPTIONS } from "@/lib/format.ts";
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

export function SettingsPage() {
  const settings = useApp((s) => s.settings)!,
    route = useApp((s) => s.route),
    ai = useApp((s) => s.ai);
  const [draft, setDraft] = useState<Settings>(structuredClone(settings)),
    [section, setSection] = useState(route.name === "settings" ? (route.section ?? "ai") : "ai"),
    [saving, setSaving] = useState(false),
    [checking, setChecking] = useState(false),
    [voices, setVoices] = useState<VoiceInfo[]>([]),
    [previewing, setPreviewing] = useState(false),
    [leaving, setLeaving] = useState<(() => void) | null>(null);
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

  const save = async () => {
    setSaving(true);
    try {
      const { theme: _theme, ...changes } = draft;
      await useApp.getState().updateSettings({ ...changes, onboarded: true });
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
  const hearVoice = async () => {
    setPreviewing(true);
    try {
      const result = await api.voice.preview(PREVIEW_LINE);
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
            title="Claude Code"
            description="Moco writes with the Claude Code installed on this computer, on your own Claude plan. No API keys."
          >
            <AiStatusAlert ai={ai} />
            <Button variant="outline" className="self-start" disabled={checking} onClick={() => void check()}>
              {checking ? <Spinner data-icon="inline-start" aria-hidden /> : <RefreshCwIcon data-icon="inline-start" />}
              Check again
            </Button>
          </Section>
        </TabsContent>

        <TabsContent value="voice" className="max-w-xl">
          <Section
            title="Narration"
            description="The voices that come with your computer. Free, offline and always available."
          >
            <Field>
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
            </Field>
            <Field>
              <div className="flex items-center justify-between gap-4">
                <FieldLabel htmlFor="rate">Speed</FieldLabel>
                <span className="text-sm text-muted-foreground tabular-nums">{draft.voice.rate.toFixed(2)}×</span>
              </div>
              <Slider
                id="rate"
                aria-label="Narration speed"
                min={0.7}
                max={1.4}
                step={0.05}
                value={[draft.voice.rate]}
                onValueChange={([rate]) => patch("voice", { ...draft.voice, rate: rate ?? 1 })}
              />
            </Field>
            <Field orientation="horizontal">
              <Button variant="outline" disabled={dirty || previewing} onClick={() => void hearVoice()}>
                {previewing ? <Spinner data-icon="inline-start" aria-hidden /> : <PlayIcon data-icon="inline-start" />}
                Hear it
              </Button>
              {dirty && <FieldDescription>Save your changes first to hear them.</FieldDescription>}
            </Field>
          </Section>
        </TabsContent>

        <TabsContent value="render" className="max-w-xl">
          <Section title="Rendering" description="Videos render on this computer, never in the cloud.">
            <Field>
              <FieldLabel htmlFor="concurrency">Browser tabs per render</FieldLabel>
              <Select
                value={String(draft.render.concurrency)}
                onValueChange={(v) => patch("render", { concurrency: Number(v) })}
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
                      {[1, 2, 3, 5].map((n) => (
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

function AiStatusAlert({ ai }: { ai: AiStatus | null }) {
  if (!ai)
    return (
      <Alert>
        <Spinner aria-hidden />
        <AlertTitle>Checking Claude Code…</AlertTitle>
        <AlertDescription>This takes a few seconds.</AlertDescription>
      </Alert>
    );
  if (ai.ok)
    return (
      <Alert>
        <CircleCheckIcon />
        <AlertTitle>Claude Code {ai.version} is ready</AlertTitle>
        <AlertDescription>
          {ai.authMethod ? `Signed in with ${ai.authMethod}.` : "Signed in."} Moco works within your plan’s limits.
        </AlertDescription>
      </Alert>
    );
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>Claude Code isn’t ready</AlertTitle>
      <AlertDescription className="select-text">{ai.reason}</AlertDescription>
    </Alert>
  );
}
