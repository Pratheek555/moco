import { useState } from "react";
import { LayoutTemplateIcon, PlusIcon, SparklesIcon } from "lucide-react";
import type { TemplateInfo } from "@/lib/api.ts";
import { newSeries, startFromTemplate, useApp } from "@/lib/store.ts";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Page, PageHeader } from "../components/Page.tsx";
import { LearnDialog, LearnJobs } from "../components/LearnTemplate.tsx";
import { TemplateCard, TemplateSheet } from "../components/Templates.tsx";
import { api } from "@/lib/api.ts";
import { report } from "@/lib/store.ts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StyleSampleDialog } from "../components/StyleSample.tsx";

export function TemplatesPage({ id }: { id?: string }) {
  const templates = useApp((s) => s.templates),
    selected = useApp((s) => s.composerTemplate);
  const [open, setOpen] = useState<TemplateInfo | null>(() => templates.find((t) => t.id === id) ?? null);
  const [learning, setLearning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sampling, setSampling] = useState<TemplateInfo | null>(null);
  return (
    <Page>
      <PageHeader
        title="Templates"
        description="Learn visual technique from references, then review an original illustrated sample on your topic. Keep the artwork and motion you approve."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImporting(true)}>Paste a prompt</Button>
            <Button onClick={() => setLearning(true)}>
              <SparklesIcon data-icon="inline-start" />
              Learn from videos
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                useApp.getState().setComposerTemplate(null);
                newSeries();
              }}
            >
              <PlusIcon data-icon="inline-start" />
              Start from scratch
            </Button>
          </div>
        }
      />
      <LearnJobs onSample={(templateId) => {
        const template = useApp.getState().templates.find((item) => item.id === templateId);
        if (template?.production) setSampling(template);
        else void useApp.getState().refreshTemplates().then(() => { const refreshed = useApp.getState().templates.find((item) => item.id === templateId); if (refreshed?.production) setSampling(refreshed); }).catch(report);
      }} />
      {templates.length ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              selected={selected === template.id}
              onSelect={() => startFromTemplate(template)}
              onDetails={() => setOpen(template)}
              onSample={template.production && template.learned ? () => setSampling(template) : undefined}
            />
          ))}
        </div>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutTemplateIcon />
            </EmptyMedia>
            <EmptyTitle>No templates installed</EmptyTitle>
            <EmptyDescription>Start from scratch in the studio: any idea works.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <TemplateSheet template={open} onOpenChange={(isOpen) => !isOpen && setOpen(null)} onSample={setSampling} />
      {sampling && <StyleSampleDialog key={sampling.id} template={sampling} onOpenChange={(isOpen) => !isOpen && setSampling(null)} />}
      <LearnDialog open={learning} onOpenChange={setLearning} />
      <PromptDialog open={importing} onOpenChange={setImporting} />
    </Page>
  );
}

function PromptDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const [name, setName] = useState(""), [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<string[]>([]);
  const [shape, setShape] = useState("portrait"), [seconds, setSeconds] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (seconds && (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0)) { report("Enter a positive length or leave it blank"); return; }
    setBusy(true);
    try {
      const template = await api.templates.importPrompt({ name, prompt, referenceImages: references, production: { mode: "artist", localOnly: true, format: { width: shape === "portrait" ? 1080 : 1920, height: shape === "portrait" ? 1920 : 1080, fps: 60 }, ...(seconds ? { targetSeconds: Number(seconds) } : {}) } });
      await useApp.getState().refreshTemplates();
      onOpenChange(false); setName(""); setPrompt(""); setReferences([]); startFromTemplate(template);
    } catch (error) { report(error); } finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={value => !busy && onOpenChange(value)}><DialogContent><DialogHeader><DialogTitle>Template from a prompt</DialogTitle><DialogDescription>Save your full creative instructions. Moco draws custom canvas scenes using your local voice. Review the script and estimated shot plan before narration. Local mode uses procedural art and installed fonts, and omits stock music and effects. Paid image and voice services are not connected.</DialogDescription></DialogHeader>
    <label className="text-sm">Name<Input value={name} onChange={e => setName(e.target.value)} maxLength={120} /></label>
    <label className="text-sm">Creative prompt<Textarea className="h-64" value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={64000} /></label>
    <label className="text-sm">Style frames (optional, up to five)<Input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e => {
      const files=Array.from(e.target.files ?? []);
      if(files.length>5 || files.some(file=>file.size>3_000_000)) { setReferences([]); e.target.value=""; report("Choose up to five style frames under 3 MB each"); return; }
      setBusy(true);
      void Promise.all(files.map(file=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error("Could not read style frame"));reader.readAsDataURL(file);}))).then(setReferences).catch(report).finally(()=>setBusy(false));
    }} /></label>
    <label className="text-sm">Video shape<select className="ml-3 rounded border p-2" value={shape} onChange={e => setShape(e.target.value)}><option value="portrait">Portrait · 1080 × 1920</option><option value="landscape">Landscape · 1920 × 1080</option></select></label>
    <label className="text-sm">Length in seconds (optional)<Input type="number" min="1" value={seconds} onChange={e => setSeconds(e.target.value)} placeholder="Use the length in my prompt" /></label>
    <Button disabled={busy || !name.trim() || !prompt.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save template"}</Button>
  </DialogContent></Dialog>;
}
