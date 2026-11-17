import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Project } from "../../../../shared/api.ts";
import { api, run } from "../../lib/api.ts";
import { useApp } from "../../state/app-context.ts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../components/ui/alert-dialog.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Checkbox } from "../../components/ui/checkbox.tsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { useDialogFocus } from "./use-dialog-focus.ts";

export function RenameProjectDialog({ project, onClose }: { project: Project | null; onClose(): void }) {
  const { refresh } = useApp();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const focus = useDialogFocus();
  useEffect(() => {
    setName(project?.name ?? "");
    if (!project) return;
    const frame = requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
    return () => cancelAnimationFrame(frame);
  }, [project]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!project || !name.trim() || busy) return;
    setBusy(true);
    const saved = await run(() => api.renameProject(project.id, name.trim()));
    if (saved) { onClose(); await run(refresh); }
    setBusy(false);
  }
  return <Dialog open={!!project} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="rounded-2xl" showCloseButton={false} onOpenAutoFocus={event => { focus.captureFocus(); event.preventDefault(); input.current?.focus(); input.current?.select(); }} onCloseAutoFocus={focus.restoreFocus}>
      <DialogHeader><DialogTitle className="text-base">Rename project</DialogTitle><DialogDescription className="sr-only">Choose a new name for this project.</DialogDescription></DialogHeader>
      <form onSubmit={event => void save(event)} className="space-y-6">
        <div className="space-y-2"><label htmlFor="rename-project" className="font-medium">Project name</label><Input ref={input} id="rename-project" value={name} onChange={event => setName(event.target.value)} maxLength={120} disabled={busy} required /></div>
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !name.trim()}>{busy && <Spinner />}Save</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function DeleteProjectDialog({ project, onClose }: { project: Project | null; onClose(): void }) {
  const { info, route, navigate, refresh } = useApp();
  const [removeFiles, setRemoveFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const focus = useDialogFocus();
  const currentRoute = useRef(route); currentRoute.current = route;
  useEffect(() => { setRemoveFiles(false); }, [project]);
  const bin = info?.platform === "darwin" ? "Trash" : "Recycle Bin";
  async function remove() {
    if (!project || busy) return;
    setBusy(true);
    const removed = await run(() => api.deleteProject(project.id, removeFiles));
    if (removed) {
      if (currentRoute.current.name === "project" && currentRoute.current.id === project.id) navigate({ name: "home" });
      onClose(); await run(refresh);
    }
    setBusy(false);
  }
  return <AlertDialog open={!!project} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <AlertDialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl" onOpenAutoFocus={focus.captureFocus} onCloseAutoFocus={focus.restoreFocus}>
      <AlertDialogHeader>
        <AlertDialogTitle className="max-w-full break-words text-base">Delete “{project?.name}”?</AlertDialogTitle>
        <AlertDialogDescription className="leading-6">The conversation is removed from Moco. {removeFiles ? `The project folder and its files move to the ${bin}.` : "The project folder and its files stay on your computer."}</AlertDialogDescription>
      </AlertDialogHeader>
      <label htmlFor="delete-project-files" className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-[13px] leading-6"><Checkbox id="delete-project-files" checked={removeFiles} disabled={busy} className="mt-1" onCheckedChange={value => setRemoveFiles(value === true)} /><span>Also move the project folder to the {bin}</span></label>
      <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={event => { event.preventDefault(); void remove(); }}>{busy && <Spinner />}Delete project</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
