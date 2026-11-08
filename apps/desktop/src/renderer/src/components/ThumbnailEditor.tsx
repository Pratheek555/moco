import { useEffect, useRef, useState } from "react";
import { CheckIcon, ExternalLinkIcon, FolderOpenIcon, ImageIcon, RotateCcwIcon } from "lucide-react";
import {
  DEFAULT_THUMBNAIL_DESIGN, THUMBNAIL_ACCENTS, THUMBNAIL_STYLES, THUMBNAIL_TEXT_MAX,
  thumbnailPresentation, type PublishThumbnail, type SceneSpec, type ThumbnailDesign,
} from "@moco/spec";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/async";
import { humanize } from "@/lib/format";
import { report, useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import "../thumbnail-editor.css";

// Still filenames are exact scene frames, not array offsets. Ignore unknown URLs rather than guess a frame.
function stillFrame(url: string): number | undefined {
  const match = url.split(/[?#]/)[0]?.match(/\/(\d+)\.png$/i);
  return match ? Number(match[1]) : undefined;
}

function CoverPreview({ image, text, design, ratio, guides = false, label }: {
  image?: string; text: string; design: ThumbnailDesign; ratio: number; guides?: boolean; label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(200);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width); });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const presentation = thumbnailPresentation(width, width / ratio, text, design);
  return <div ref={ref} className="thumbnail-cover" role="img" aria-label={label} style={{ aspectRatio: ratio }}>
    {image ? <img src={image} alt="" draggable={false} style={text.trim() ? presentation.image : undefined} />
      : <div className="thumbnail-no-art"><ImageIcon /><span>Choose a rendered shot</span></div>}
    {text.trim() && <><div className="thumbnail-shade" style={presentation.shade} /><div style={presentation.headline}>{text.trim()}</div></>}
    {guides && <div className="thumbnail-safe-guide"><span>Keep the subject in this area</span></div>}
  </div>;
}

export function ThumbnailEditor({ seriesId, episodeId, saved, url, path, shots, stills, running, onSaved }: {
  seriesId: string; episodeId: string; saved?: PublishThumbnail; url?: string; path?: string;
  shots: { id: string; intent: string }[]; stills: Record<string, string[]>; running: boolean; onSaved(): void;
}) {
  const [shotId, setShotId] = useState(saved?.shotId ?? shots[0]?.id ?? "");
  const [text, setText] = useState(saved?.text ?? "");
  const [design, setDesign] = useState<ThumbnailDesign>(saved?.design ?? DEFAULT_THUMBNAIL_DESIGN);
  const [frame, setFrame] = useState<number | undefined>(saved?.frame);
  const [busy, setBusy] = useState(false);
  const [guides, setGuides] = useState(false);
  const reset = () => {
    setShotId(saved?.shotId ?? shots[0]?.id ?? ""); setText(saved?.text ?? "");
    setDesign(saved?.design ?? DEFAULT_THUMBNAIL_DESIGN); setFrame(saved?.frame);
  };
  useEffect(reset, [saved?.shotId, saved?.text, saved?.frame, saved?.design?.style, saved?.design?.position, saved?.design?.accent, shots[0]?.id]);
  const { data, error: sceneError } = useAsync(async () => {
    if (!shotId) return null;
    const artifact = await api.series.artifact(seriesId, `episodes/${episodeId}/shots/${shotId}/spec.json`);
    const scene = artifact?.data as SceneSpec | undefined;
    // Retain only the metadata; artist source and embedded assets can be large.
    return { shotId, format: scene?.format, durationFrames: scene?.durationFrames };
  }, [seriesId, episodeId, shotId]);
  const metadata = data?.shotId === shotId ? data : undefined;
  const middle = metadata?.durationFrames ? Math.floor((metadata.durationFrames - 1) / 2) : undefined;
  const actualFrame = frame ?? middle;
  const format = metadata?.format ?? { width: 1080, height: 1920, fps: 30 };
  const ratio = format.width / format.height;
  const frames = (stills[shotId] ?? []).flatMap(image => {
    const at = stillFrame(image);
    return at === undefined ? [] : [{ image, frame: at }];
  });
  const nearest = frames.reduce<(typeof frames)[number] | undefined>((best, candidate) =>
    !best || Math.abs(candidate.frame - (actualFrame ?? 0)) < Math.abs(best.frame - (actualFrame ?? 0)) ? candidate : best, undefined);
  const length = [...text.trim()].length;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const tooLong = length > THUMBNAIL_TEXT_MAX;
  const savedDesign = saved?.design ?? DEFAULT_THUMBNAIL_DESIGN;
  const sameDesign = design.style === savedDesign.style && design.position === savedDesign.position && design.accent === savedDesign.accent;
  const changed = !saved || !url || shotId !== saved.shotId || text.trim() !== saved.text || !sameDesign || (actualFrame !== undefined && actualFrame !== saved.frame);
  const canRender = changed && !busy && !running && !tooLong && Boolean(shotId);
  const render = async () => {
    if (!canRender) return;
    setBusy(true);
    try {
      await api.publish.setThumbnail(seriesId, episodeId, { shotId, text: text.trim(), frame: actualFrame, design });
      onSaved();
      await useApp.getState().refreshLibrary();
      useApp.getState().toast("Thumbnail updated", "success");
    } catch (e) { report(e); } finally { setBusy(false); }
  };
  const sourceUrl = "https://support.google.com/youtube/answer/72431?hl=en";

  return <div className="thumbnail-editor" aria-busy={busy}>
    <div className="thumbnail-intro"><p>Give your story a strong first frame.</p><span>Choose a look, find the moment, and check it at feed size.</span></div>
    <fieldset disabled={busy || running} className="thumbnail-controls">
      <legend className="sr-only">Thumbnail design</legend>
      <div className="thumbnail-section-heading"><span>01</span><h4>Choose a look</h4><small>Made for small screens</small></div>
      <div className="thumbnail-style-grid" role="group" aria-label="Thumbnail style">
        {THUMBNAIL_STYLES.map(style => <button type="button" key={style.id} className="thumbnail-style-card" aria-pressed={design.style === style.id}
          onClick={() => setDesign({ ...design, style: style.id })}>
          <div className={`thumbnail-style-sample thumbnail-style-${style.id}`} aria-hidden="true"><span>{style.sample}</span></div>
          <div className="thumbnail-style-title">{style.name}{design.style === style.id && <CheckIcon />}</div><p>{style.description}</p>
        </button>)}
      </div>

      <div className="thumbnail-section-heading"><span>02</span><h4>Find the moment</h4></div>
      <Field>
        <FieldLabel htmlFor="thumbnail-shot">Shot</FieldLabel>
        <select id="thumbnail-shot" className="thumbnail-select" value={shotId} disabled={!shots.length}
          onChange={event => { setShotId(event.target.value); setFrame(undefined); }}>
          {!shots.length && <option value="">No shots available</option>}
          {shots.map(shot => <option key={shot.id} value={shot.id}>{humanize(shot.id)} · {shot.intent}</option>)}
        </select>
      </Field>
      {frames.length > 0 && <div className="thumbnail-moments" role="group" aria-label="Shot frames">
        {frames.map(item => <button type="button" key={item.image} aria-label={`Use frame ${item.frame}`} aria-pressed={actualFrame === item.frame}
          onClick={() => setFrame(item.frame)}>
          <img src={item.image} alt="" loading="lazy" /><span>Frame {item.frame}</span>
        </button>)}
      </div>}
      <div className="thumbnail-moment-note"><p>{actualFrame === undefined ? "Uses the middle of the shot." : `Frame ${actualFrame} · ${(actualFrame / format.fps).toFixed(1)}s into the shot`}</p>
        <Button size="xs" variant="ghost" type="button" onClick={() => setFrame(undefined)}>Use middle frame</Button></div>
      {sceneError && <p className="text-xs text-muted-foreground">Shot timing is unavailable. You can still render the middle or choose a frame above.</p>}

      <div className="thumbnail-section-heading"><span>03</span><h4>Make it yours</h4></div>
      <Field data-invalid={tooLong}>
        <div className="thumbnail-label-row"><FieldLabel htmlFor="thumbnail-text">Headline</FieldLabel><span>{length}/{THUMBNAIL_TEXT_MAX}</span></div>
        <Input id="thumbnail-text" aria-invalid={tooLong} aria-describedby="thumbnail-headline-help" value={text} placeholder="A few words. Or none."
          onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && canRender) void render(); }} />
        {tooLong ? <FieldError id="thumbnail-headline-help">Keep it to {THUMBNAIL_TEXT_MAX} characters.</FieldError>
          : <FieldDescription id="thumbnail-headline-help">{words > 3 ? "Try 2–3 words for easier reading. Add context in the video title." : "One idea, a few words. Leave empty to let the picture speak."}</FieldDescription>}
      </Field>
      <div className="thumbnail-design-row">
        <Field><FieldLabel htmlFor="thumbnail-position">Text position</FieldLabel>
          <select id="thumbnail-position" className="thumbnail-select" value={design.position} onChange={event => setDesign({ ...design, position: event.target.value as ThumbnailDesign["position"] })}>
            <option value="upper">Upper</option><option value="center">Center</option><option value="lower">Lower</option>
          </select>
        </Field>
        <div><p className="thumbnail-field-label">Accent color</p><div className="thumbnail-swatches" role="group" aria-label="Accent color">
          {THUMBNAIL_ACCENTS.map(accent => <button type="button" key={accent.id} aria-label={accent.name} aria-pressed={design.accent === accent.id}
            style={{ background: accent.color }} onClick={() => setDesign({ ...design, accent: accent.id })}>{design.accent === accent.id && <CheckIcon />}</button>)}
        </div></div>
      </div>
    </fieldset>

    <div className="thumbnail-preview-panel">
      <div className="thumbnail-preview-header"><h4>{changed ? "Draft preview" : "Saved thumbnail"}</h4>
        <label><input type="checkbox" checked={guides} onChange={event => setGuides(event.target.checked)} />Composition guide</label></div>
      <div className="thumbnail-preview-pair">
        <div className="thumbnail-main-preview">
          {!changed && url ? <div className="thumbnail-cover" style={{ aspectRatio: ratio }}><img src={url} alt="Saved episode thumbnail" draggable={Boolean(path)} onDragStart={event => { if (path) { event.preventDefault(); api.app.startDrag(path); } }} />{guides && <div className="thumbnail-safe-guide"><span>Keep the subject in this area</span></div>}</div>
            : <CoverPreview image={nearest?.image} text={text} design={design} ratio={ratio} guides={guides} label="Draft thumbnail layout" />}
          <span>{changed ? "Layout preview" : "Ready to upload"}</span>
        </div>
        <div className="thumbnail-feed-preview">
          {!changed && url ? <div className="thumbnail-cover" style={{ aspectRatio: ratio }}><img src={url} alt="Saved thumbnail at feed size" /></div>
            : <CoverPreview image={nearest?.image} text={text} design={design} ratio={ratio} label="Draft thumbnail at feed size" />}
          <strong>Feed size</strong><p>Can you read it at a glance?</p>
        </div>
      </div>
      {changed && <p className="thumbnail-preview-note">Layout uses the nearest shot still{nearest ? ` (frame ${nearest.frame})` : " when available"}. Render to see the exact moment; video captions are removed from the export.</p>}
    </div>

    <div className="thumbnail-actions">
      <Button size="sm" disabled={!canRender} onClick={() => void render()}>{busy ? <Spinner /> : <ImageIcon />}{busy ? "Rendering thumbnail…" : url ? "Update thumbnail" : "Make thumbnail"}</Button>
      {changed && saved && <Button size="sm" variant="ghost" disabled={busy || running} onClick={reset}><RotateCcwIcon />Reset</Button>}
      {path && <Button size="sm" variant="outline" onClick={() => void api.app.showItem(path).catch(report)}><FolderOpenIcon />Show saved file</Button>}
    </div>
    <div className="thumbnail-publishing-note"><p>For a Short, upload the saved image under Thumbnail in YouTube Studio on desktop (verified accounts). For Instagram, use it as your reel cover.</p>
      <button type="button" onClick={() => void api.app.openExternal(sourceUrl).catch(report)}>YouTube upload guide<ExternalLinkIcon /></button></div>
    <details className="thumbnail-tips"><summary>What makes a good thumbnail?</summary><p>Show one clear subject, use contrast, and keep words short. Choose a real reaction, question, or fact your video delivers. Check that the headline adds to the title and leaves the subject visible.</p>
      <button type="button" onClick={() => void api.app.openExternal("https://vidiq.com/blog/post/types-youtube-thumbnails/").catch(report)}>Thumbnail style research<ExternalLinkIcon /></button>
    </details>
  </div>;
}
