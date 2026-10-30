// The creative kit: everything the AI may use, straight from the kit catalog (the same list the engine checks against).
import { useState } from "react";
import { api, type Catalog } from "../lib/api.ts";
import { useApp, type KitTab } from "../lib/store.ts";
import { CastArt, Loading, Tag, useAsync } from "../components/ui.tsx";

const TABS: [KitTab, string][] = [
  ["characters", "Characters"],
  ["backgrounds", "Backgrounds"],
  ["props", "Props & effects"],
  ["looks", "Looks"],
];

export function KitPage() {
  const route = useApp((s) => s.route);
  const [tab, setTab] = useState<KitTab>(route.name === "kit" ? (route.tab ?? "characters") : "characters");
  const { data: catalog } = useAsync(() => api.kit.catalog(), []);
  if (!catalog) return <Loading />;
  return (
    <div className="page kit-page enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">KIT {catalog.kitVersion}</div>
          <h1>Creative kit</h1>
          <p>The cast, places and looks your stories are made from. The AI can only use what is here.</p>
        </div>
      </div>
      <div className="toolbar">
        <div className="tabs">
          {TABS.map(([value, label]) => (
            <button key={value} className={tab === value ? "selected" : ""} onClick={() => setTab(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="kit-grid">{cards(catalog, tab)}</div>
    </div>
  );
}

function cards(catalog: Catalog, tab: KitTab) {
  if (tab === "characters")
    return catalog.characters.map((c) => (
      <div className="kit-card character-card" key={c.id}>
        <CastArt characters={[c.id]} />
        <div className="kit-info">
          <h3>{c.id}</h3>
          <p>Looks: {c.variants.join(", ")}</p>
          <p>Moves: {c.actions.map((a) => a.name.replaceAll("_", " ")).join(", ")}</p>
          <p>Moods: {c.expressions.join(", ")}</p>
          {c.visemes.length > 0 && <Tag tone="green">Lip sync</Tag>}
        </div>
      </div>
    ));
  if (tab === "backgrounds")
    return catalog.backgrounds.map((b) => (
      <div className="kit-card" key={b.id}>
        <div className="kit-info">
          <h3>{b.id}</h3>
          <p>Times of day: {b.timeOfDay.join(", ")}</p>
          <p>Depth layers: {b.layers.map((l) => l.id).join(", ")}</p>
        </div>
      </div>
    ));
  if (tab === "props")
    return [
      ...catalog.props.map((p) => (
        <div className="kit-card compact-kit" key={`prop-${p.id}`}>
          <div className="kit-info">
            <h3>{p.id}</h3>
            <p>Prop · seats: {p.attachPoints.join(", ") || "none"}</p>
          </div>
        </div>
      )),
      ...catalog.fx.map((f) => (
        <div className="kit-card compact-kit" key={`fx-${f.id}`}>
          <div className="kit-info">
            <h3>{f.id}</h3>
            <p>Effect · up to {Math.round(f.maxDurationFrames / 30)} s</p>
          </div>
        </div>
      )),
    ];
  return [
    ...catalog.atmosphere.map((a) => (
      <div className="kit-card compact-kit" key={`atmosphere-${a.id}`}>
        <div className="kit-info">
          <h3>{a.id.replaceAll("_", " ")}</h3>
          <p>Atmosphere · {a.placement === "front" ? "in front of the cast" : "behind the cast"}</p>
        </div>
      </div>
    )),
    ...catalog.grades.map((g) => (
      <div className="kit-card compact-kit" key={`grade-${g}`}>
        <div className="kit-info">
          <h3>{g.replaceAll("_", " ")}</h3>
          <p>Colour grade</p>
        </div>
      </div>
    )),
  ];
}
