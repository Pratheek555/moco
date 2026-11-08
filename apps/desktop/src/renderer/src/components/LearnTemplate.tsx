// Learning a template from reference videos: the dialog that starts a run, and a card per run with its progress.
import { useState } from "react";
import { AlertCircleIcon, CheckIcon, FolderOpenIcon, SparklesIcon, XIcon } from "lucide-react";
import { api, type LearnJob } from "@/lib/api.ts";
import { report, useApp } from "@/lib/store.ts";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

// The pipeline's steps in order, with what the user sees for each.
const STEPS: { key: string; label: string }[] = [
  { key: "fetch", label: "Downloading" },
  { key: "measure", label: "Measuring every frame and word" },
  { key: "sheets", label: "Laying out frames" },
  { key: "agents", label: "AI is studying the videos" },
  { key: "merge", label: "Writing the style rules" },
  { key: "template", label: "Turning them into a template" },
  { key: "done", label: "Done" },
];

export function LearnDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const [name, setName] = useState("");
  const [links, setLinks] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const sources = [...new Set([...links.split(/\r?\n/).map((line) => line.trim()).filter(Boolean), ...files])];
  const valid = name.trim().length > 0 && sources.length > 0 && sources.length <= 10;

  async function start() {
    setBusy(true);
    try {
      await api.templates.learn({ name: name.trim(), sources, referenceImages });
      setName("");
      setLinks("");
      setFiles([]);
      setReferenceImages([]);
      onOpenChange(false);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Learn an illustrated style</DialogTitle>
          <DialogDescription>
            Add reference videos to study their visual technique. Then try the learned style on your own topic before approving it.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel htmlFor="learn-name">Template name</FieldLabel>
            <Input id="learn-name" placeholder="e.g. Expressive illustrated science" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="learn-links">YouTube links</FieldLabel>
            <Textarea
              id="learn-links"
              rows={4}
              placeholder={"https://www.youtube.com/shorts/…\nhttps://www.youtube.com/shorts/…"}
              value={links}
              onChange={(e) => setLinks(e.target.value)}
            />
            <FieldDescription>
              One per line, up to 10 videos in total. Analysis uses your selected AI provider; longer videos take more time and requests.
            </FieldDescription>
          </Field>
          <Field>
            <Button variant="outline" disabled={busy} onClick={() => void api.templates.chooseVideos().then((chosen) => setFiles((current) => [...new Set([...current, ...chosen])])).catch(report)}>
              <FolderOpenIcon data-icon="inline-start" />Add local videos
            </Button>
            {files.map((file) => <div key={file} className="flex items-center justify-between gap-2 text-xs"><span className="truncate" title={file}>{file}</span><Button variant="ghost" size="sm" aria-label={`Remove ${file}`} onClick={() => setFiles((current) => current.filter((item) => item !== file))}><XIcon className="size-3" /></Button></div>)}
            {sources.length > 10 && <p className="text-sm text-destructive">Choose up to 10 videos.</p>}
          </Field>
          <Field>
            <FieldLabel htmlFor="learn-images">Appearance references (optional)</FieldLabel>
            <Input id="learn-images" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onChange={(event) => {
              const chosen = Array.from(event.target.files ?? []);
              if (chosen.length > 5 || chosen.some((file) => file.size > 3_000_000)) { event.target.value = ""; setReferenceImages([]); report("Choose up to five PNG, JPEG or WebP images under 3 MB each"); return; }
              setBusy(true);
              void Promise.all(chosen.map((file) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(Error("Could not read reference image")); reader.readAsDataURL(file); }))).then(setReferenceImages).catch(report).finally(() => setBusy(false));
            }} />
            <FieldDescription>Up to five images under 3 MB each. Images guide appearance; motion and pacing come from the videos. Reference scripts, characters and content are excluded from the new sample.</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button disabled={!valid || busy} onClick={() => void start()}>
            {busy ? <Spinner data-icon="inline-start" /> : <SparklesIcon data-icon="inline-start" />}
            Learn template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Runs still going, and ones that failed or were stopped (finished ones are templates now).
export function LearnJobs({ onSample }: { onSample?(templateId: string): void }) {
  const jobs = useApp((s) => s.learnJobs);
  if (jobs.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {jobs.map((job) => (
        <LearnJobCard key={job.id} job={job} onSample={onSample} />
      ))}
    </div>
  );
}

function LearnJobCard({ job, onSample }: { job: LearnJob; onSample?(templateId: string): void }) {
  const index = Math.max(0, STEPS.findIndex((step) => step.key === job.step));
  const running = job.state === "running";
  const done = job.state === "done";
  const last = job.log.at(-1);
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {running ? <Spinner /> : done ? <CheckIcon className="size-4" /> : <AlertCircleIcon className="size-4 text-destructive" />}
          {done ? "Learned" : "Learning"} “{job.name}”
        </CardTitle>
        <CardDescription>
          {running
            ? `${STEPS[index]!.label} · ${job.sources.length} video${job.sources.length === 1 ? "" : "s"}`
            : done ? "Style draft ready. Try an original sample on your topic."
            : job.state === "cancelled"
              ? "Stopped. Start again to pick up where it left off."
              : job.error}
        </CardDescription>
        <CardAction>
          {running ? (
            <Button variant="ghost" size="sm" onClick={() => void api.templates.cancelLearn(job.id).catch(report)}>
              <XIcon data-icon="inline-start" />
              Stop
            </Button>
          ) : done ? (
            <Button size="sm" disabled={!job.templateId || !onSample} onClick={() => job.templateId && onSample?.(job.templateId)}>Make a sample</Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void api.templates.learn({ name: job.name, sources: job.sources, referenceImages: job.referenceImages }).catch(report)}
            >
              Try again
            </Button>
          )}
        </CardAction>
      </CardHeader>
      {running && (
        <div className="flex flex-col gap-2 px-6">
          <Progress value={((index + 0.5) / (STEPS.length - 1)) * 100} />
          {last && <p className="truncate font-mono text-xs text-muted-foreground">{last}</p>}
        </div>
      )}
    </Card>
  );
}
