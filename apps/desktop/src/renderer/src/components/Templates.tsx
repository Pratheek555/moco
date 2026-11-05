// Templates in the UI: the card art drawn from a template's palette, the cards, and the detail sheet.
import { ArrowRightIcon, CheckIcon, ExternalLinkIcon, FolderOpenIcon, LayoutTemplateIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import type { TemplateInfo } from "@/lib/api.ts";
import { api } from "@/lib/api.ts";
import { report, startFromTemplate, useApp } from "@/lib/store.ts";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// A little storybook street in the template's colours: sky, a row of houses and two bean-head figures.
export function TemplateCover({ template, className }: { template: TemplateInfo; className?: string }) {
  const { sky, ground, accents } = template.palette;
  const id = `sky-${template.id}`;
  if (template.production) return <svg viewBox="0 0 180 120" className={cn("block",className)} aria-hidden="true">
    <rect width="180" height="120" fill={sky[0]} />
    <rect x="12" y="18" width="96" height="62" rx="3" fill="#f3ecdf" />
    <rect x="20" y="28" width="57" height="7" rx="2" fill={accents[0]} />
    <circle cx="37" cy="56" r="12" fill={accents[1]} />
    <path d="M58 66 L73 44 L96 66Z" fill={accents[0]} />
    <rect y="95" width="180" height="25" fill={ground} />
    <rect x="119" y="67" width="30" height="31" rx="7" fill={accents[1]} />
    <rect x="114" y="30" width="40" height="38" rx="11" fill="#e8b2a4" />
    <circle cx="126" cy="48" r="2" fill="#2b2d42" /><circle cx="142" cy="48" r="2" fill="#2b2d42" />
    <path d="M121 96V113 M144 96V113 M120 73L99 61 M147 73L161 87" stroke={accents[1]} strokeWidth="8" strokeLinecap="round" />
  </svg>;
  const houses = [
    { x: 6, w: 34, h: 46 },
    { x: 42, w: 28, h: 58 },
    { x: 72, w: 36, h: 40 },
    { x: 110, w: 30, h: 52 },
    { x: 142, w: 34, h: 44 },
  ];
  return (
    <svg viewBox="0 0 180 120" preserveAspectRatio="xMidYMax slice" className={cn("block", className)} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky[0]} />
          <stop offset="1" stopColor={sky[1]} />
        </linearGradient>
      </defs>
      <rect width="180" height="120" fill={`url(#${id})`} />
      <circle cx="148" cy="22" r="9" fill="#fff6dc" opacity="0.9" />
      {houses.map((house, i) => {
        const top = 96 - house.h;
        const colour = accents[i % accents.length]!;
        return (
          <g key={i} stroke="#1b1420" strokeWidth="1.2" strokeLinejoin="round">
            <rect x={house.x} y={top} width={house.w} height={house.h} fill={colour} />
            <path d={`M${house.x - 2} ${top} L${house.x + house.w / 2} ${top - 12} L${house.x + house.w + 2} ${top} Z`} fill="#6b3a34" />
            <rect x={house.x + house.w - 9} y={top - 14} width="5" height="8" fill="#6b3a34" />
            {[0, 1].map((col) => (
              <rect key={col} x={house.x + 5 + col * (house.w / 2)} y={top + 9} width={house.w / 2 - 10} height="9" fill="#2d3c58" />
            ))}
            <rect x={house.x + house.w / 2 - 4} y={84} width="8" height="12" fill="#3b2a24" />
          </g>
        );
      })}
      <rect y="96" width="180" height="24" fill={ground} stroke="#1b1420" strokeWidth="1.2" />
      {[
        { x: 64, colour: "#c0392b" },
        { x: 82, colour: "#2f5fa8" },
      ].map((figure) => (
        <g key={figure.x} stroke="#241726" strokeWidth="1.4" strokeLinecap="round">
          <line x1={figure.x - 2} y1="112" x2={figure.x} y2="104" />
          <line x1={figure.x + 2} y1="112" x2={figure.x} y2="104" />
          <rect x={figure.x - 3.5} y="96" width="7" height="9" rx="2" fill={figure.colour} />
          <ellipse cx={figure.x} cy="91" rx="5.4" ry="5.8" fill="#f6dcc0" />
          <circle cx={figure.x - 1.6} cy="90.5" r="0.6" fill="#241726" />
          <circle cx={figure.x + 1.6} cy="90.5" r="0.6" fill="#241726" />
        </g>
      ))}
    </svg>
  );
}

export function TemplateCard({
  template,
  selected,
  onSelect,
  onDetails,
}: {
  template: TemplateInfo;
  selected?: boolean;
  onSelect(): void;
  onDetails?(): void;
}) {
  return (
    <Card
      className={cn(
        "relative gap-4 overflow-hidden pt-0 transition-shadow hover:shadow-md",
        selected && "ring-2 ring-primary",
      )}
    >
      <div className="relative h-36 border-b">
        <TemplateCover template={template} className="absolute inset-0 size-full" />
        {template.learned && (
          <Badge variant="secondary" className="absolute top-3 right-3">
            <SparklesIcon />
            {template.creativePrompt ? "Prompt" : "Learned"}
          </Badge>
        )}
        {selected && (
          <Badge className="absolute top-3 left-3">
            <CheckIcon />
            Selected
          </Badge>
        )}
      </div>
      <CardHeader className="gap-1.5">
        <CardTitle className="leading-snug">{template.name}</CardTitle>
        <CardDescription className="line-clamp-2 min-h-10">{template.tagline}</CardDescription>
      </CardHeader>
      <CardFooter className="mt-auto flex-wrap justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {template.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
        <div className="flex gap-1">
          {onDetails && (
            <Button variant="ghost" size="sm" onClick={onDetails}>
              Details
            </Button>
          )}
          <Button variant={selected ? "secondary" : "default"} size="sm" onClick={onSelect}>
            {selected ? "Selected" : "Use"}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

// Everything the template does, so the user knows what they're choosing.
export function TemplateSheet({ template, onOpenChange }: { template: TemplateInfo | null; onOpenChange(open: boolean): void }) {
  return (
    <Sheet open={template !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {template && (
          <>
            <TemplateCover template={template} className="h-44 w-full border-b" />
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <LayoutTemplateIcon className="size-4 text-muted-foreground" />
                {template.name}
              </SheetTitle>
              <SheetDescription>{template.description}</SheetDescription>
              <div className="flex flex-wrap gap-1 pt-1">
                {template.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 pb-4">
              <TemplateList title="The story" items={template.story} />
              <TemplateList title="The look" items={template.look} />
              {template.missing?.length ? <TemplateList title="Not available in Moco yet" items={template.missing} /> : null}
              {template.creativePrompt && <details className="text-sm"><summary className="cursor-pointer font-medium">Creative instructions</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">{template.creativePrompt}</pre></details>}
              {template.ideas.length > 0 && <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Try it with</h3>
                <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                  {template.ideas.map((idea) => (
                    <li key={idea.label}>
                      <span className="font-medium text-foreground">{idea.label}.</span> {idea.idea}
                    </li>
                  ))}
                </ul>
              </div>}
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                <Separator className="mb-2" />
                <span>
                  {template.production ? "Creates custom canvas illustrations and animation from your prompt, using local narration." : template.world === "world"
                    ? "Always builds the story its own 3D world: the AI designs the cast and places for each series."
                    : "Uses the creative kit when the story fits it, otherwise builds a 3D world for it."}
                </span>
                {template.learned && <LearnedFrom template={template} onRemoved={() => onOpenChange(false)} />}
                {template.credit && (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto justify-start p-0 text-xs"
                    onClick={() => void api.app.openExternal(template.credit!.url)}
                  >
                    {template.credit.label}
                    <ExternalLinkIcon data-icon="inline-end" />
                  </Button>
                )}
              </div>
            </div>
            <SheetFooter className="mt-auto border-t">
              <Button
                onClick={() => {
                  onOpenChange(false);
                  startFromTemplate(template);
                }}
              >
                Start a series with this template
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// Where a learned template came from, and its folder (the full skill, measurements and frame sheets).
function LearnedFrom({ template, onRemoved }: { template: TemplateInfo; onRemoved(): void }) {
  const learned = template.learned!;
  return (
    <div className="flex flex-col gap-1.5">
      <span>
        {template.creativePrompt ? "Saved from your creative prompt" : `Learned from ${learned.sources.length} video${learned.sources.length === 1 ? "" : "s"}`}
        {learned.learnedAt ? ` on ${new Date(learned.learnedAt).toLocaleDateString()}` : ""}:
      </span>
      {learned.sources.map((source) => (
        <Button
          key={source}
          variant="link"
          size="sm"
          className="h-auto justify-start truncate p-0 text-xs"
          onClick={() => void api.app.openExternal(source)}
        >
          {source}
          <ExternalLinkIcon data-icon="inline-end" />
        </Button>
      ))}
      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={() => void api.templates.openFolder(template.id).catch(report)}>
          <FolderOpenIcon data-icon="inline-start" />
          Open folder
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (!window.confirm(`Remove “${template.name}”? Series already made with it keep their plans.`)) return;
            api.templates
              .remove(template.id)
              .then(() => useApp.getState().refreshTemplates())
              .then(onRemoved)
              .catch(report);
          }}
        >
          <Trash2Icon data-icon="inline-start" />
          Remove
        </Button>
      </div>
    </div>
  );
}

function TemplateList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
