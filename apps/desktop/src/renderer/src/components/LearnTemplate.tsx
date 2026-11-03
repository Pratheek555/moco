// Learning a template from reference videos: the dialog that starts a run, and a card per run with its progress.
import { useState } from "react";
import { AlertCircleIcon, SparklesIcon, XIcon } from "lucide-react";
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
  { key: "agents", label: "Claude is studying the videos" },
  { key: "merge", label: "Writing the style rules" },
  { key: "template", label: "Turning them into a template" },
  { key: "done", label: "Done" },
];

export function LearnDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const [name, setName] = useState("");
  const [links, setLinks] = useState("");
  const [busy, setBusy] = useState(false);
  const sources = links.split(/\s+/).filter(Boolean);
  const valid = name.trim().length > 0 && sources.length > 0 && sources.length <= 10;

  async function start() {
    setBusy(true);
    try {
      await api.templates.learn({ name: name.trim(), sources });
      setName("");
      setLinks("");
      onOpenChange(false);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Learn a template from videos</DialogTitle>
          <DialogDescription>
            Paste a few shorts in the style you want. Moco measures every frame, Claude studies how they are made, and you get a
            template that copies the technique, never the content.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel htmlFor="learn-name">Template name</FieldLabel>
            <Input id="learn-name" placeholder="e.g. Deadpan 3D facts" value={name} onChange={(e) => setName(e.target.value)} />
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
              One per line, up to 10. Two to five from the same channel work best. It takes about 5 minutes per video and uses
              your Claude plan (around 8 requests per video).
            </FieldDescription>
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
export function LearnJobs() {
  const jobs = useApp((s) => s.learnJobs).filter((job) => job.state !== "done");
  if (jobs.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {jobs.map((job) => (
        <LearnJobCard key={job.id} job={job} />
      ))}
    </div>
  );
}

function LearnJobCard({ job }: { job: LearnJob }) {
  const index = Math.max(0, STEPS.findIndex((step) => step.key === job.step));
  const running = job.state === "running";
  const last = job.log.at(-1);
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {running ? <Spinner /> : <AlertCircleIcon className="size-4 text-destructive" />}
          Learning “{job.name}”
        </CardTitle>
        <CardDescription>
          {running
            ? `${STEPS[index]!.label} · ${job.sources.length} video${job.sources.length === 1 ? "" : "s"}`
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
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void api.templates.learn({ name: job.name, sources: job.sources }).catch(report)}
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
