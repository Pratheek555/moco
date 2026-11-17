import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ClipboardEvent, RefObject } from "react";
import { ArrowUp, Paperclip, Square } from "lucide-react";
import type { Project, RunState } from "../../../../shared/api.ts";
import { providerLabels } from "../../../../shared/api.ts";
import { Button } from "../../components/ui/button.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { Spinner } from "../../components/ui/spinner.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.tsx";
import { api, errorMessage, run } from "../../lib/api.ts";
import { useApp } from "../../state/app-context.ts";
import { AttachmentChip } from "./AttachmentChip.tsx";
import { useProjectDraft } from "./draft-store.ts";

interface PendingUpload { id: number; name: string }
export function useComposer(projectId: string, ready: boolean, onSent: () => void) {
  const [draft, setDraft] = useProjectDraft(projectId);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const sequence = useRef(0), pastedImages = useRef(0), inFlight = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const focus = useCallback(() => { input.current?.focus({ preventScroll: true }); }, []);
  useEffect(focus, [focus]);
  const upload = useCallback(async (name: string, work: () => Promise<string[]>) => {
    const id = ++sequence.current;
    setUploads(old => [...old, { id, name }]);
    await run(async () => {
      const files = await work();
      setDraft(old => ({ ...old, attachments: [...new Set([...old.attachments, ...files])] }));
    });
    if (mounted.current) { setUploads(old => old.filter(item => item.id !== id)); focus(); }
  }, [focus, setDraft]);
  const attachFiles = useCallback((files: File[], pasted = false) => {
    for (const file of files) void upload(file.name || "Image", async () => {
      try { return await api.attachDropped(projectId, [file]); }
      catch (error) {
        // The API deliberately owns path lookup. Clipboard screenshots have no path;
        // only that specific failure should switch to the byte-upload route.
        if (!pasted || !file.type.startsWith("image/") || !/no path|paste image data/i.test(errorMessage(error))) throw error;
        const extension = ({ "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/bmp": "bmp" } as Record<string, string>)[file.type] ?? "png";
        return api.attachPasted(projectId, `pasted-image-${++pastedImages.current}.${extension}`, new Uint8Array(await file.arrayBuffer()));
      }
    });
  }, [projectId, upload]);
  const paste = useCallback((event: ClipboardEvent) => {
    const files = Array.from(event.clipboardData.files);
    if (!files.length) for (const item of Array.from(event.clipboardData.items)) { const file = item.kind === "file" ? item.getAsFile() : null; if (file) files.push(file); }
    if (files.length) { event.preventDefault(); attachFiles(files, true); }
  }, [attachFiles]);
  const send = async () => {
    if (!ready || inFlight.current || uploads.length || (!draft.text.trim() && !draft.attachments.length)) return;
    const sent = draft;
    inFlight.current = true; setSending(true);
    const success = await run(() => api.send(projectId, sent.text, sent.attachments));
    if (success) setDraft(old => ({ text: old.text === sent.text ? "" : old.text, attachments: old.attachments.filter(path => !sent.attachments.includes(path)) }));
    if (mounted.current) {
      if (success) onSent();
      setSending(false); focus();
    }
    inFlight.current = false;
  };
  return { draft, setDraft, uploads, sending, input, focus, paste, attachFiles, send, pick: () => void upload("Files", () => api.attach(projectId)) };
}
export type ComposerModel = ReturnType<typeof useComposer>;

export function Composer({ project, state, ready, empty, model }: { project: Project; state: RunState; ready: boolean; empty: boolean; model: ComposerModel }) {
  const { openSettings } = useApp();
  const [stopping, setStopping] = useState(false);
  const stopInFlight = useRef(false);
  const previousState = useRef(state);
  useEffect(() => {
    if (previousState.current !== state) { setStopping(false); stopInFlight.current = false; }
    previousState.current = state;
  }, [state]);
  useAutoGrow(model.input, model.draft.text);
  const active = state === "running" || state === "waiting";
  const label = providerLabels[project.provider];
  const disabled = !ready || model.sending || !!model.uploads.length || (!model.draft.text.trim() && !model.draft.attachments.length);
  return <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pt-2 pb-4">
    {!ready && <div className="mb-2 flex min-w-0 items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-1.5 text-[13px]">
      <span className="min-w-0 [overflow-wrap:anywhere]">{label} is not connected.</span><Button variant="ghost" size="sm" onClick={() => openSettings("providers")}>Set up</Button>
    </div>}
    <form className="min-w-0 rounded-2xl border bg-card p-2 shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20" onSubmit={event => { event.preventDefault(); void model.send(); }} onPaste={model.paste}>
      {(model.draft.attachments.length > 0 || model.uploads.length > 0) && <div className="flex min-w-0 gap-2 overflow-x-auto px-1 pt-1 pb-2">
        {model.draft.attachments.map(path => <AttachmentChip key={path} path={path} remove={() => model.setDraft(old => ({ ...old, attachments: old.attachments.filter(item => item !== path) }))} />)}
        {model.uploads.map(upload => <span key={upload.id} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border bg-muted/50 px-3 text-xs text-muted-foreground"><Spinner aria-label={`Attaching ${upload.name}`} /><span className="max-w-44 truncate">{upload.name}</span></span>)}
      </div>}
      <Textarea ref={model.input} aria-label="Message" rows={1} value={model.draft.text} placeholder={empty ? "Describe what you want to make" : "Reply or ask for a change"} className="min-h-10 resize-none border-0 bg-transparent px-3 py-2 text-[15px] leading-6 shadow-none [field-sizing:fixed] focus-visible:ring-0 dark:bg-transparent md:text-[15px]" onChange={event => model.setDraft(old => ({ ...old, text: event.target.value }))} onKeyDown={event => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void model.send(); }
      }} />
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="Attach files" className="text-muted-foreground" onClick={model.pick}><Paperclip className="size-4" /></Button></TooltipTrigger><TooltipContent>Attach files</TooltipContent></Tooltip>
        <div className="flex items-center gap-2">
          {active && <Tooltip><TooltipTrigger asChild><Button type="button" variant="outline" size="sm" aria-label="Stop" disabled={stopping} onClick={() => {
            if (stopInFlight.current) return;
            stopInFlight.current = true; setStopping(true);
            void run(() => api.stop(project.id)).then(success => { if (!success) { stopInFlight.current = false; setStopping(false); } });
          }}>{stopping ? <Spinner aria-hidden="true" /> : <Square className="size-4" />}Stop</Button></TooltipTrigger><TooltipContent>Stop working</TooltipContent></Tooltip>}
          <Tooltip><TooltipTrigger asChild><span className="inline-flex" tabIndex={!ready ? 0 : undefined}>
            <Button type="submit" size="icon-sm" className="rounded-full" aria-label="Send message" disabled={disabled}>{model.sending ? <Spinner aria-hidden="true" /> : <ArrowUp className="size-4" />}</Button>
          </span></TooltipTrigger><TooltipContent>{!ready ? `Set up ${label} to send a message` : model.uploads.length ? "Attaching files…" : "Send message"}</TooltipContent></Tooltip>
        </div>
      </div>
    </form>
  </div>;
}

function useAutoGrow(input: RefObject<HTMLTextAreaElement | null>, text: string) {
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    const update = () => {
      node.style.height = "0px";
      const max = 256; // Ten 24px lines plus the vertical padding.
      node.style.height = `${Math.min(max, Math.max(40, node.scrollHeight))}px`;
      node.style.overflowY = node.scrollHeight > max ? "auto" : "hidden";
    };
    update();
    let previousWidth = node.parentElement?.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = node.parentElement?.clientWidth;
      if (width !== previousWidth) { previousWidth = width; update(); }
    });
    // Only width changes affect wrapping. Ignore height changes caused by auto-growing.
    if (node.parentElement) observer.observe(node.parentElement, { box: "border-box" });
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, [input, text]);
}
