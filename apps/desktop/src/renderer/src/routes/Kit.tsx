// The creative kit: everything the AI may use, straight from the kit catalog (the same list the engine checks against).
import { useState, type ReactNode } from "react";
import { api, type Catalog } from "@/lib/api.ts";
import { useAsync } from "@/lib/async.ts";
import { useApp, type KitTab } from "@/lib/store.ts";
import { humanize } from "@/lib/format.ts";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CastArt } from "../components/CastArt.tsx";
import { Page, PageError, PageHeader, PageLoading } from "../components/Page.tsx";

const list = (items: string[]) => items.map(humanize).join(", ") || "None";

export function KitPage() {
  const route = useApp((s) => s.route);
  const [tab, setTab] = useState<KitTab>(route.name === "kit" ? (route.tab ?? "characters") : "characters");
  const { data: catalog, error } = useAsync(() => api.kit.catalog(), []);
  if (error) return <PageError title="Couldn’t load the kit" detail={error} />;
  if (!catalog) return <PageLoading label="Loading the kit…" />;
  const tabs: { value: KitTab; label: string; count: number; content: ReactNode }[] = [
    { value: "characters", label: "Characters", count: catalog.characters.length, content: <Characters catalog={catalog} /> },
    { value: "backgrounds", label: "Backgrounds", count: catalog.backgrounds.length, content: <Backgrounds catalog={catalog} /> },
    { value: "props", label: "Props & effects", count: catalog.props.length + catalog.fx.length, content: <PropsAndFx catalog={catalog} /> },
    { value: "looks", label: "Looks", count: catalog.atmosphere.length + catalog.grades.length, content: <Looks catalog={catalog} /> },
  ];
  return (
    <Page>
      <PageHeader
        title="Creative kit"
        description="The cast, places and looks your stories are made from. The AI can only use what’s here."
        actions={<Badge variant="outline">Kit {catalog.kitVersion}</Badge>}
      />
      <Tabs value={tab} onValueChange={(value) => setTab(value as KitTab)} className="gap-6">
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              <Badge variant="secondary" className="tabular-nums">
                {t.count}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((t) => (
          <TabsContent key={t.value} value={t.value}>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">{t.content}</div>
          </TabsContent>
        ))}
      </Tabs>
    </Page>
  );
}

// A label and value pair inside a kit card.
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-pretty">{children}</dd>
    </div>
  );
}

function Characters({ catalog }: { catalog: Catalog }) {
  return catalog.characters.map((c) => (
    <Card key={c.id} className="gap-4 overflow-hidden pt-0">
      <div className="cast-backdrop flex h-48 items-end justify-center border-b">
        <CastArt characters={[c.id]} className="h-52 w-full" />
      </div>
      <CardHeader>
        <CardTitle>{humanize(c.id)}</CardTitle>
        {c.visemes.length > 0 && (
          <CardAction>
            <Badge variant="secondary">Lip sync</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-3">
          <Detail label="Looks">{list(c.variants)}</Detail>
          <Detail label="Moves">{list(c.actions.map((a) => a.name))}</Detail>
          <Detail label="Moods">{list(c.expressions)}</Detail>
        </dl>
      </CardContent>
    </Card>
  ));
}

function Backgrounds({ catalog }: { catalog: Catalog }) {
  return catalog.backgrounds.map((b) => (
    <Card key={b.id}>
      <CardHeader>
        <CardTitle>{humanize(b.id)}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-3">
          <Detail label="Times of day">{list(b.timeOfDay)}</Detail>
          <Detail label="Depth layers">{list(b.layers.map((l) => l.id))}</Detail>
        </dl>
      </CardContent>
    </Card>
  ));
}

// A small card for kit items that are just a name and a line.
function KitItem({ name, kind, detail }: { name: string; kind: string; detail: string }) {
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>{humanize(name)}</CardTitle>
        <CardAction>
          <Badge variant="secondary">{kind}</Badge>
        </CardAction>
        <CardDescription>{detail}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function PropsAndFx({ catalog }: { catalog: Catalog }) {
  return [
    ...catalog.props.map((p) => (
      <KitItem
        key={`prop-${p.id}`}
        name={p.id}
        kind="Prop"
        detail={p.attachPoints.length ? `Attach points: ${list(p.attachPoints).toLowerCase()}` : "No attach points"}
      />
    )),
    ...catalog.fx.map((f) => (
      <KitItem
        key={`fx-${f.id}`}
        name={f.id}
        kind="Effect"
        detail={`Lasts up to ${Math.round(f.maxDurationFrames / 30)} s`}
      />
    )),
  ];
}

function Looks({ catalog }: { catalog: Catalog }) {
  return [
    ...catalog.atmosphere.map((a) => (
      <KitItem
        key={`atmosphere-${a.id}`}
        name={a.id}
        kind="Atmosphere"
        detail={a.placement === "front" ? "In front of the cast" : "Behind the cast"}
      />
    )),
    ...catalog.grades.map((g) => (
      <KitItem
        key={`grade-${g}`}
        name={g === "none" ? "no_grade" : g}
        kind="Colour grade"
        detail={g === "none" ? "Colours as drawn" : "Tints the whole series"}
      />
    )),
  ];
}
