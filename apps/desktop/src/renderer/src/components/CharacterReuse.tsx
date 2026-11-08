import { useState } from "react";
import type { Critique, SceneSpec } from "@moco/spec";
import { api } from "@/lib/api.ts";
import { useAsync } from "@/lib/async.ts";
import { humanize } from "@/lib/format.ts";
import { report, useApp } from "@/lib/store.ts";
import { Button } from "@/components/ui/button";

// Small entry point for the reuse engine; the broader editing workflow is separate.
export function CharacterReuse({ seriesId, episodeId, shotId, cast, disabled, canApply }: {
  seriesId: string; episodeId: string; shotId: string; cast: string[]; disabled: boolean; canApply: boolean;
}) {
  const version = useApp(s => s.version);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const { data, error, reload } = useAsync(async () => {
    const [scene, critique, characters] = await Promise.all([
      api.series.artifact(seriesId, `episodes/${episodeId}/shots/${shotId}/spec.json`),
      api.series.artifact(seriesId, `episodes/${episodeId}/artifacts/critique.json`),
      api.characters.list(seriesId),
    ]);
    return { scene: scene ? { hash: scene.meta.contentHash, spec: scene.data as SceneSpec } : undefined,
      quality: (critique?.data as Critique | undefined)?.quality, characters };
  }, [seriesId, episodeId, shotId, version]);
  if (!cast.length) return null;
  const canSave = data?.scene && data.quality?.status === "passed" && data.quality.sceneHashes[shotId] === data.scene.hash;
  const act = async (castId: string, rigVersion?: string) => {
    if (!data?.scene) return;
    setBusy(true);
    try {
      const choice = { castId, sceneHash: data.scene.hash };
      if (rigVersion) {
        await api.characters.apply(seriesId, episodeId, shotId, { ...choice, version: rigVersion });
        useApp.getState().toast("Updating this shot's character", "success", { description: "Moco will review the changed cut. Approve a new preview afterwards." });
      } else {
        await api.characters.save(seriesId, episodeId, shotId, choice);
        useApp.getState().toast("Character saved for reuse", "success", { description: "New shots in this series will use this version. Existing shots keep their artwork." });
      }
      reload();
    } catch (e) { report(e); }
    finally { setBusy(false); }
  };
  return <section className="flex flex-col gap-3" aria-label="Reusable characters">
    <h3 className="text-sm font-semibold">Keep your characters consistent</h3>
    <p className="text-xs text-muted-foreground">Save a character you like for new shots and episodes in this series. Existing shots keep their artwork.</p>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {!canSave && <p className="text-xs text-muted-foreground">Save becomes available after the current cut passes visual review.</p>}
    {cast.map(castId => {
      const character = data?.characters.find(c => c.castId === castId);
      const current = data?.scene?.spec.canvas?.characterRigs?.[castId];
      const chosen = selected[castId] ?? current ?? character?.activeVersion;
      return <div key={castId} className="flex flex-col gap-2 rounded-md border p-3">
        <span className="text-sm font-medium">{humanize(castId)}</span>
        <span className="text-xs text-muted-foreground">{current ? `Saved version ${current.slice(0, 8)}` : "Original artwork in this shot"}</span>
        <Button variant="outline" size="sm" disabled={disabled || busy || !canSave} onClick={() => void act(castId)}>Save character for reuse</Button>
        {character && <>
          <label htmlFor={`character-version-${castId}`} className="text-xs">Approved versions</label>
          <select id={`character-version-${castId}`} className="w-full rounded-md border bg-background p-2 text-xs" value={chosen} disabled={disabled || busy} onChange={event => setSelected(s => ({ ...s, [castId]: event.target.value }))}>
            {character.versions.map(v => <option key={v.version} value={v.version}>{v.version.slice(0, 8)} · {v.provenance.episodeId}/{v.provenance.shotId}{v.version === character.activeVersion ? " · default for new shots" : ""}</option>)}
          </select>
          <Button variant="outline" size="sm" disabled={disabled || busy || !canApply || !data?.scene || chosen === current} onClick={() => void act(castId, chosen)}>Use version in this shot</Button>
        </>}
      </div>;
    })}
    <p className="text-xs text-muted-foreground">Approval keeps the design and its review evidence. New gestures still need review; sampled frames do not prove smooth motion or continuous contact.</p>
  </section>;
}
