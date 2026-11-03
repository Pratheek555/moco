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

export function TemplatesPage({ id }: { id?: string }) {
  const templates = useApp((s) => s.templates),
    selected = useApp((s) => s.composerTemplate);
  const [open, setOpen] = useState<TemplateInfo | null>(() => templates.find((t) => t.id === id) ?? null);
  const [learning, setLearning] = useState(false);
  return (
    <Page>
      <PageHeader
        title="Templates"
        description="Ready-made styles the AI follows for the story, the world and the cut. Pick one, add your idea, and Moco does the rest. Or teach Moco a new one from videos you like."
        actions={
          <div className="flex gap-2">
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
      <LearnJobs />
      {templates.length ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              selected={selected === template.id}
              onSelect={() => startFromTemplate(template)}
              onDetails={() => setOpen(template)}
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
      <TemplateSheet template={open} onOpenChange={(isOpen) => !isOpen && setOpen(null)} />
      <LearnDialog open={learning} onOpenChange={setLearning} />
    </Page>
  );
}
