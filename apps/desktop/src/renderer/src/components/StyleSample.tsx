import { useEffect, useState } from "react";
import type { SeriesStatus, StyleSampleReview } from "@moco/engine";
import { CheckIcon, PlayIcon, SparklesIcon } from "lucide-react";
import { api, type EpisodeMedia, type MocoApi, type TemplateInfo } from "@/lib/api.ts";
import { report, useApp } from "@/lib/store.ts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";

type SampleInput = Parameters<MocoApi["templates"]["createSample"]>[0];
const selectClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";
const gateName = (key: string) => ({ series_plan: "Sample plan", bible: "Character and visual design", script: "Script and storyboard", sample: "First shot", preview: "Complete sample" })[key.split("/").at(-1)!] ?? key.split("/").at(-1)!.replaceAll("_", " ");
const gateFile = (key: string) => key === "series_plan" ? "artifacts/series_plan.json" : key === "bible" ? "artifacts/show.json" : key.endsWith("/script") ? `episodes/${key.split("/")[0]}/artifacts/script.json` : undefined;

// A sample is a short ordinary artist project, with all existing human gates.
// New choices create a new project revision; accepting a preview never starts production.
export function StyleSampleDialog({ template, onOpenChange }: { template: TemplateInfo; onOpenChange(open: boolean): void }) {
  const version = useApp((state) => state.version);
  const languageDefault = useApp((state) => state.settings?.defaults.language ?? "en");
  const [topic, setTopic] = useState("");
  const [language, setLanguage] = useState(languageDefault);
  const [seconds, setSeconds] = useState("12");
  const [shape, setShape] = useState(template.production!.format.width > template.production!.format.height ? "landscape" : "portrait");
  const [palette, setPalette] = useState("");
  const [detail, setDetail] = useState<SampleInput["choices"]["detail"]>("balanced");
  const [acting, setActing] = useState<SampleInput["choices"]["acting"]>("expressive");
  const [pacing, setPacing] = useState<SampleInput["choices"]["pacing"]>("balanced");
  const [feedback, setFeedback] = useState("");
  const [revisions, setRevisions] = useState<SeriesStatus[]>([]);
  const [selected, setSelected] = useState<string>();
  const [review, setReview] = useState<StyleSampleReview>();
  const [media, setMedia] = useState<EpisodeMedia>();
  const [artifact, setArtifact] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string>();
  const current = revisions.find((item) => item.series.id === selected);
  const next = current?.next;
  const key = next && next.kind !== "finished" ? next.key : undefined;
  const waiting = next?.kind === "waiting" && next.status === "awaiting_approval";
  const running = Boolean(current?.activeJob);
  const stage = current?.stages.find((item) => item.key === key);
  const preview = key?.endsWith("/preview");
  const sampleApproved = Boolean(review?.approved);

  useEffect(() => {
    let cancelled = false;
    void api.templates.samples(template.id).then((items) => {
      if (cancelled) return;
      setRevisions(items);
      setSelected((value) => value ?? items[0]?.series.id);
      setError(undefined);
    }).catch((cause: unknown) => { if (!cancelled) setError(String(cause)); });
    return () => { cancelled = true; };
  }, [template.id, version, refresh]);

  useEffect(() => {
    let cancelled = false;
    setReview(undefined); setMedia(undefined); setArtifact(undefined);
    if (!selected) return;
    // Full review hashes the saved artwork and media. Read it after the job has
    // stopped, rather than repeatedly inspecting files while the artist writes.
    if (current?.activeJob) return;
    const file = key ? gateFile(key) : undefined;
    const episodeId = current?.stages.find((item) => item.key.endsWith("/script"))?.key.split("/")[0];
    void Promise.all([
      api.templates.sampleReview(selected),
      episodeId ? api.episode.media(selected, episodeId) : Promise.resolve(undefined),
      file ? api.series.artifact(selected, file) : Promise.resolve(null),
    ]).then(([nextReview, nextMedia, nextArtifact]) => {
      if (!cancelled) { setReview(nextReview); setMedia(nextMedia); setArtifact(nextArtifact?.data); }
    }).catch((cause: unknown) => { if (!cancelled) setError(String(cause)); });
    return () => { cancelled = true; };
  }, [selected, key, version, refresh, current?.activeJob?.id]);

  const perform = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(undefined);
    try { await work(); setRefresh((value) => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const create = () => perform(async () => {
    const duration = Number(seconds);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 60) throw Error("Enter a sample length above zero and up to 60 seconds.");
    const colors = palette.split(/[\s,]+/).filter(Boolean);
    if (colors.length > 8 || colors.some((color) => !/^#[0-9a-f]{6}$/i.test(color))) throw Error("Enter up to eight palette colors as #RRGGBB, or leave the palette blank.");
    const id = await api.templates.createSample({ templateId: template.id, topic: topic.trim(), language, seconds: duration,
      format: { width: shape === "portrait" ? 1080 : 1920, height: shape === "portrait" ? 1920 : 1080, fps: template.production!.format.fps },
      choices: { palette: colors, detail, acting, pacing, feedback: feedback.trim() },
    });
    setSelected(id);
  });
  const loadChoices = (item: SeriesStatus) => {
    const sample = item.series.styleSample;
    if (!sample) return;
    setTopic(sample.topic); setLanguage(item.series.language);
    setSeconds(String(item.series.production?.targetSeconds ?? 12));
    setShape(item.series.production!.format.width > item.series.production!.format.height ? "landscape" : "portrait");
    setPalette(sample.choices.palette.join(", ")); setDetail(sample.choices.detail);
    setActing(sample.choices.acting); setPacing(sample.choices.pacing); setFeedback(sample.choices.feedback);
  };

  return <Dialog open onOpenChange={(open) => !busy && onOpenChange(open)}>
    <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
      <DialogHeader>
        <DialogTitle>Try “{template.name}” on your topic</DialogTitle>
        <DialogDescription>Create a short original explainer with 2–3 shots. Review the plan, design and script before artwork. Each adjustment becomes a separate revision; approval saves the exact artwork and motion you reviewed.</DialogDescription>
      </DialogHeader>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <label className="text-sm font-medium" htmlFor="sample-topic">Your topic<Textarea id="sample-topic" className="mt-1" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Why does bread rise?" maxLength={12000} required /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm" htmlFor="sample-seconds">Target seconds<Input id="sample-seconds" type="number" min="1" max="60" step="any" value={seconds} onChange={(event) => setSeconds(event.target.value)} required /></label>
            <label className="text-sm" htmlFor="sample-language">Language<Input id="sample-language" value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="en" required /></label>
          </div>
          <label className="text-sm" htmlFor="sample-shape">Video shape<select id="sample-shape" className={selectClass} value={shape} onChange={(event) => setShape(event.target.value)}><option value="portrait">Portrait · 1080 × 1920</option><option value="landscape">Landscape · 1920 × 1080</option></select></label>
          <label className="text-sm" htmlFor="sample-palette">Palette override<Input id="sample-palette" value={palette} onChange={(event) => setPalette(event.target.value)} placeholder="#1c315e, #f4bf4f" /><span className="mt-1 block text-xs text-muted-foreground">Leave blank to follow the learned palette.</span></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm" htmlFor="sample-detail">Illustration detail<select id="sample-detail" className={selectClass} value={detail} onChange={(event) => setDetail(event.target.value as typeof detail)}><option value="simple">Simple</option><option value="balanced">Balanced</option><option value="rich">Rich</option></select></label>
            <label className="text-sm" htmlFor="sample-acting">Acting<select id="sample-acting" className={selectClass} value={acting} onChange={(event) => setActing(event.target.value as typeof acting)}><option value="restrained">Restrained</option><option value="expressive">Expressive</option></select></label>
          </div>
          <label className="text-sm" htmlFor="sample-pacing">Pacing<select id="sample-pacing" className={selectClass} value={pacing} onChange={(event) => setPacing(event.target.value as typeof pacing)}><option value="calm">Calm</option><option value="balanced">Balanced</option><option value="brisk">Brisk</option></select></label>
          <label className="text-sm" htmlFor="sample-feedback">Direction or changes<Textarea id="sample-feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Use a warmer palette and make the pointing gesture clearer." maxLength={2000} /></label>
          <p className="text-xs text-muted-foreground">Duration is a target; local narration determines the measured timing. Choices guide the artist and are checked in the rendered sample.</p>
          <Button type="submit" disabled={busy || !topic.trim() || running}>{busy ? <Spinner /> : <SparklesIcon />} {selected ? "Generate new revision" : "Generate sample"}</Button>
        </form>
        <div className="flex min-w-0 flex-col gap-4">
          {error && <p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
          {revisions.length > 0 && <label className="text-sm" htmlFor="sample-revisions">Saved revisions<select id="sample-revisions" className={selectClass} value={selected ?? ""} onChange={(event) => setSelected(event.target.value)}>{revisions.map((item, index) => <option key={item.series.id} value={item.series.id}>{new Date(item.series.createdAt).toLocaleString()} · {item.series.styleSample?.topic ?? `Sample ${index + 1}`}</option>)}</select></label>}
          {current && <>
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{sampleApproved ? "Approved sample" : key ? gateName(key) : "Sample"}</h3><Button type="button" size="sm" variant="outline" onClick={() => loadChoices(current)}>Load these choices</Button></div>
            {current.activeJob && <div className="flex items-center justify-between rounded-md border p-3"><span className="flex items-center gap-2 text-sm"><Spinner />Creating your sample…</span><Button variant="ghost" size="sm" onClick={() => void api.stages.cancel(current.activeJob!.id).catch(report)}>Stop</Button></div>}
            {stage?.error && <p className="text-sm text-destructive">{stage.error.message}</p>}
            {artifact !== undefined && <GateArtifact data={artifact} />}
            {key?.endsWith("/sample") && <div className="flex gap-2 overflow-x-auto">{Object.values(media?.stills ?? {}).flat().map((url) => <img key={url} src={url} alt="First sample shot" className="max-h-64 rounded-md border object-contain" />)}</div>}
            {media?.preview && (preview || sampleApproved) && <video key={review?.contentHash} src={media.preview} controls preload="metadata" className="max-h-96 w-full rounded-md bg-black" />}
            {review && <>
              {review.folder && <Button size="sm" variant="outline" className="self-start" onClick={() => void api.app.openPath(review.folder!).catch(report)}>Open sample files</Button>}
              {review.deviations.length > 0 && <div className="flex flex-col gap-3 rounded-md border p-3"><h4 className="text-sm font-semibold">What differs and why</h4>{review.deviations.map((item, index) => <div key={index} className="text-sm"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{item.kind === "judgment" ? "AI judgment" : item.kind}</Badge><span className="font-medium">{item.label}</span></div><p className="mt-1 text-muted-foreground">{item.detail}</p></div>)}</div>}
              {review.rules != null && <details className="rounded-md border p-3 text-sm"><summary className="cursor-pointer font-medium">Learned rules and evidence</summary><RuleEvidence data={review.rules} /></details>}
              {preview && review.blockers.length > 0 && <div className="rounded-md border p-3 text-sm"><p className="font-medium">Before approval</p><ul className="mt-2 list-disc space-y-1 pl-4">{review.blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul></div>}
            </>}
            {sampleApproved ? <div className="rounded-md border border-primary/30 p-3 text-sm"><p className="flex items-center gap-2 font-medium"><CheckIcon className="size-4" />Approved {new Date(review!.approved!.approvedAt).toLocaleString()}</p><p className="mt-1 text-muted-foreground">This revision’s executable artwork, assets, motion and review evidence are saved. You can generate another revision without changing this approval.</p></div> : !running && <div className="flex flex-wrap gap-2">
              {waiting && preview && review ? <Button disabled={busy || !review.canApprove || !media?.preview} onClick={() => void perform(() => api.templates.approveSample(current.series.id, review.contentHash))}><CheckIcon />Approve sample</Button> : waiting && stage?.artifactHash ? <Button disabled={busy || (gateFile(key!) !== undefined && artifact === undefined) || (key?.endsWith("/sample") && Object.values(media?.stills ?? {}).flat().length === 0)} onClick={() => void perform(async () => { await api.stages.approve(current.series.id, key!, stage.artifactHash!); await api.stages.run(current.series.id); })}>Approve {gateName(key!).toLowerCase()} and continue</Button> : next?.kind === "run" ? <Button disabled={busy} onClick={() => void perform(() => api.stages.run(current.series.id))}><PlayIcon />{stage?.status === "failed" ? "Retry" : "Continue sample"}</Button> : null}
            </div>}
          </>}
          {!current && <div className="flex min-h-64 items-center justify-center rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Your original sample and comparison notes will appear here. No generation starts until you choose Generate sample.</div>}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}

function GateArtifact({ data }: { data: unknown }) {
  const value = data as { title?: string; premise?: string; logline?: string; episodes?: { title: string; synopsis: string }[]; lines?: { id: string; text: string }[]; shotPlan?: { lineId: string; picture: string }[]; cast?: { id: string; description?: string; appearance?: unknown }[]; look?: unknown };
  return <div className="max-h-80 space-y-3 overflow-y-auto rounded-md border p-3 text-sm">
    {value.title && <p className="font-semibold">{value.title}</p>}
    {(value.premise || value.logline) && <p>{value.premise ?? value.logline}</p>}
    {value.episodes?.map((episode, index) => <div key={index}><p className="font-medium">{episode.title}</p><p>{episode.synopsis}</p></div>)}
    {value.lines?.map((line) => <div key={line.id}><p>{line.text}</p>{value.shotPlan?.filter((shot) => shot.lineId === line.id).map((shot, index) => <p key={index} className="mt-1 text-muted-foreground">{shot.picture}</p>)}</div>)}
    {value.cast?.map((member) => <div key={member.id}><p className="font-medium">{member.id}</p><p>{member.description}</p>{member.appearance !== undefined && <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{typeof member.appearance === "string" ? member.appearance : JSON.stringify(member.appearance, null, 2)}</pre>}</div>)}
    {value.look !== undefined && <details><summary className="cursor-pointer">Visual design</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{JSON.stringify(value.look, null, 2)}</pre></details>}
  </div>;
}

function RuleEvidence({ data }: { data: unknown }) {
  const rules = data as { sections?: { title: string; rules: { title: string; default: string; range: string; deviateWhen: string }[] }[] };
  return <div className="mt-3 max-h-80 space-y-4 overflow-y-auto">{rules.sections ? rules.sections.map((section, index) => <section key={index}><h5 className="font-medium">{section.title}</h5>{section.rules.map((rule, ruleIndex) => <div key={ruleIndex} className="mt-2 text-xs text-muted-foreground"><p className="font-medium text-foreground">{rule.title}</p><p>Default: {rule.default}</p><p>Range: {rule.range}</p><p>Deviate when: {rule.deviateWhen}</p></div>)}</section>) : <pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(data, null, 2)}</pre>}</div>;
}
