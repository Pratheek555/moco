import { useState } from "react";
import type { LabelEditorState, LabelEditPreview } from "@moco/engine";
import { api } from "@/lib/api.ts";
import { useAsync } from "@/lib/async.ts";
import { useApp } from "@/lib/store.ts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function LabelEditor({ seriesId, episodeId, shotId, disabled }: { seriesId: string; episodeId: string; shotId: string; disabled: boolean }) {
  const version = useApp(s => s.version);
  const { data, error, reload } = useAsync(() => api.episode.labelEditor(seriesId, episodeId, shotId), [seriesId, episodeId, shotId, version]);
  return <section aria-label="Precise label editor" className="flex flex-col gap-3">
    <h3 className="text-sm font-semibold">Edit a label</h3>
    <p className="text-xs text-muted-foreground">Artwork, narration, other labels, placement and timing are locked. Only the selected label’s text changes.</p>
    {error ? <p role="status" className="text-xs text-muted-foreground">Labels are unavailable: {error}</p> : !data ? <p className="text-xs">Loading labels…</p> :
      <LabelForm key={`${shotId}:${data.sceneHash}:${data.undoId}`} state={data} disabled={disabled} seriesId={seriesId} episodeId={episodeId} shotId={shotId} refresh={reload} />}
  </section>;
}

function LabelForm({ state, disabled, seriesId, episodeId, shotId, refresh }: { state: LabelEditorState; disabled: boolean; seriesId: string; episodeId: string; shotId: string; refresh: () => void }) {
  const [labelId, setLabelId] = useState(state.labels[0]?.id ?? "");
  const label = state.labels.find(item => item.id === labelId);
  const [text, setText] = useState(label?.text ?? "");
  const [draft, setDraft] = useState<LabelEditPreview>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const changed = async (undo: boolean) => {
    if (undo) await api.episode.undoLabelEdit(seriesId, episodeId, shotId, state.undoId!);
    else await api.episode.applyLabelEdit(seriesId, episodeId, shotId, draft!.id);
    setOpen(false); setDraft(undefined); refresh();
    await useApp.getState().refreshLibrary();
    useApp.getState().toast(undo ? "Label edit undone" : "Label updated", "success", { description: "Rebuild the episode preview and review the updated cut before final export." });
  };
  if (!label) return <p className="text-xs text-muted-foreground">No editable labels in this shot. Text drawn in code or baked into images needs conversion; the existing artwork is preserved.</p>;
  return <div className="flex flex-col gap-3">
    <fieldset disabled={disabled || busy} className="flex min-w-0 flex-col gap-3">
      <label className="text-xs font-medium" htmlFor="label-choice">Label</label>
      <select id="label-choice" className="w-full rounded-md border bg-background p-2 text-sm" value={labelId} onChange={event => {
        const id = event.target.value; setLabelId(id); setText(state.labels.find(item => item.id === id)!.text); setDraft(undefined); setError("");
      }}>{state.labels.map(item => <option key={item.id} value={item.id}>{item.id} — {item.text}</option>)}</select>
      <label className="text-xs font-medium" htmlFor="label-text">Replacement text</label>
      <Input id="label-text" value={text} maxLength={300} onChange={event => { setText(event.target.value); setDraft(undefined); setError(""); }} />
      <p className="text-xs text-muted-foreground">One line, at the existing font size. Text that does not fit is rejected.</p>
      <Button variant="outline" disabled={!text.trim() || text.trim() === label.text} onClick={() => void act(async () => {
        const result = await api.episode.previewLabelEdit(seriesId, episodeId, shotId, { sceneHash: state.sceneHash, labelId, text });
        setDraft(result); setOpen(true);
      })}>{busy ? "Checking…" : "Compare label edit"}</Button>
      {draft && <Button variant="outline" onClick={() => setOpen(true)}>Open comparison</Button>}
      {state.undoId && <Button variant="ghost" onClick={() => void act(() => changed(true))}>Undo last label edit</Button>}
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Compare label edit</DialogTitle>
          <DialogDescription>“{draft?.beforeText}” → “{draft?.text}”. These are sampled frames; the accepted shot stays in place until you apply.</DialogDescription>
        </DialogHeader>
        {draft && <>
          <div className="grid grid-cols-2 gap-3 text-sm"><strong>Before</strong><strong>After</strong></div>
          {draft.frames.map((frame, i) => <div key={frame} className="grid grid-cols-2 gap-3">
            <figure><img src={draft.before[i]} alt={`Before label edit, frame ${frame}`} className="w-full rounded border" /><figcaption className="text-xs text-muted-foreground">Frame {frame}</figcaption></figure>
            <figure><img src={draft.after[i]} alt={`After label edit, frame ${frame}`} className="w-full rounded border" /><figcaption className="text-xs text-muted-foreground">Frame {frame}</figcaption></figure>
          </div>)}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Keep current shot</Button>
            <Button disabled={disabled || busy} onClick={() => void act(() => changed(false))}>{busy ? "Applying…" : "Apply label edit"}</Button>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  </div>;
}
