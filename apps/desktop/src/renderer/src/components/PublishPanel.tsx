// Publishing by hand until the YouTube API is approved: drag the video into YouTube Studio, then paste
// the AI-written details and the thumbnail in the order Studio asks for them. Edits are saved back to the episode's kit.
import { useEffect, useState, type ReactNode } from "react";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  FilmIcon,
  FolderOpenIcon,
  GripVerticalIcon,
  ImageIcon,
  RefreshCwIcon,
  Settings2Icon,
} from "lucide-react";
import {
  checkYoutube,
  hashtagsIn,
  tagsLength,
  THUMBNAIL_TEXT_MAX,
  YOUTUBE_CATEGORIES,
  YOUTUBE_LIMITS,
  type PublishDefaults,
  type PublishKit,
  type PublishThumbnail,
  type YoutubeCategory,
} from "@moco/spec";
import { api } from "@/lib/api.ts";
import { useAsync } from "@/lib/async.ts";
import { report, useApp } from "@/lib/store.ts";
import { humanize, LANGUAGE_OPTIONS, languageName } from "@/lib/format.ts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Youtube = PublishKit["youtube"];
type Step = "title" | "description" | "tags";

// Studio's Details page, top to bottom (tags are under "Show more").
const STEPS: { step: Step; label: string }[] = [
  { step: "title", label: "Title" },
  { step: "description", label: "Description" },
  { step: "tags", label: "Tags" },
];

const parseTags = (text: string) => text.split(",").map((tag) => tag.trim()).filter(Boolean);

export function PublishPanel({
  seriesId,
  episodeId,
  language,
  finalPath,
  thumbnail,
  shots,
  running,
}: {
  seriesId: string;
  episodeId: string;
  language: string;
  finalPath?: string;
  thumbnail: { url?: string; path?: string };
  shots: { id: string; intent: string }[];
  running: boolean;
}) {
  const version = useApp((s) => s.version),
    toast = useApp((s) => s.toast);
  const { data, error, reload } = useAsync(async () => {
    const [kit, defaults] = await Promise.all([
      api.series.artifact(seriesId, `episodes/${episodeId}/artifacts/publish.json`),
      api.series.artifact(seriesId, "artifacts/publish_defaults.json"),
    ]);
    return {
      kit: kit as { meta: { contentHash: string }; data: PublishKit } | null,
      defaults: defaults?.data as PublishDefaults | undefined,
    };
  }, [seriesId, episodeId, version]);

  const [draft, setDraft] = useState<Youtube | null>(null),
    [tagsText, setTagsText] = useState(""),
    [next, setNext] = useState(0),
    [copied, setCopied] = useState<Step | null>(null),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState<"save" | "rewrite" | null>(null),
    [editingDefaults, setEditingDefaults] = useState(false);

  // A new kit (written, rewritten or saved) replaces the draft.
  const saved = data?.kit?.data.youtube;
  useEffect(() => {
    if (!saved) return;
    setDraft(saved);
    setTagsText(saved.tags.join(", "));
    setNext(0);
    setCopied(null);
  }, [data?.kit?.meta.contentHash]);

  const rewrite = async () => {
    setBusy("rewrite");
    try {
      await api.publish.rewrite(seriesId, episodeId, note.trim() || undefined);
      setNote("");
      toast("Rewriting the YouTube details…", "success");
    } catch (e) {
      report(e);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="text-sm text-destructive select-text">{error}</p>;
  if (!finalPath)
    return (
      <p className="text-sm text-muted-foreground">
        The YouTube details are written once the final video is rendered.
      </p>
    );
  if (!data) return null;
  if (!data.kit || !draft || !saved) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          {running
            ? "Writing the title, description and tags, and making a thumbnail…"
            : "The AI writes a title, description, hashtags and tags from the episode, and makes a thumbnail."}
        </p>
        <Button disabled={running || busy !== null} onClick={() => void rewrite()}>
          {busy === "rewrite" || running ? (
            <Spinner data-icon="inline-start" aria-hidden />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          Write YouTube details
        </Button>
      </div>
    );
  }

  const tags = parseTags(tagsText);
  const current: Youtube = { ...draft, tags };
  const problems = checkYoutube(current);
  const dirty = JSON.stringify(current) !== JSON.stringify(saved);
  const problemsFor = (field: Step) =>
    problems.filter((problem) => problem.field === field).map((problem) => ({ message: problem.problem }));
  const textOf = (step: Step) => (step === "tags" ? tags.join(", ") : current[step]);

  const copy = async (step: Step) => {
    try {
      await api.app.copy(textOf(step));
      setCopied(step);
      setNext((STEPS.findIndex((s) => s.step === step) + 1) % STEPS.length);
      toast(`${STEPS.find((s) => s.step === step)!.label} copied`, "success", {
        description: "Paste it into YouTube Studio.",
      });
    } catch (e) {
      report(e);
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      await api.publish.save(seriesId, episodeId, { youtube: current });
      toast("YouTube details saved", "success");
      reload();
    } catch (e) {
      report(e);
    } finally {
      setBusy(null);
    }
  };

  const copyButton = (step: Step, label: string) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <InputGroupButton size="icon-xs" aria-label={`Copy ${label.toLowerCase()}`} onClick={() => void copy(step)}>
          {copied === step ? <CheckIcon /> : <CopyIcon />}
        </InputGroupButton>
      </TooltipTrigger>
      <TooltipContent>Copy {label.toLowerCase()}</TooltipContent>
    </Tooltip>
  );

  const titleProblems = problemsFor("title"),
    descriptionProblems = problemsFor("description"),
    tagProblems = problemsFor("tags");

  return (
    <div className="flex flex-col gap-6">
      <PublishStep number={1} title="Upload the video">
        <Item
          variant="outline"
          size="sm"
          draggable
          onDragStart={(e) => {
            e.preventDefault();
            api.app.startDrag(finalPath);
          }}
          className="cursor-grab border-dashed active:cursor-grabbing"
        >
          <ItemMedia variant="icon">
            <FilmIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>final.mp4</ItemTitle>
            <ItemDescription>Drag this into YouTube’s upload box.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <GripVerticalIcon className="size-4 text-muted-foreground" />
          </ItemActions>
        </Item>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void api.publish.openStudio().catch(report)}>
            <ExternalLinkIcon data-icon="inline-start" />
            Open YouTube Studio
          </Button>
          <Button size="sm" variant="outline" onClick={() => void api.app.showItem(finalPath).catch(report)}>
            <FolderOpenIcon data-icon="inline-start" />
            Show file
          </Button>
        </div>
      </PublishStep>

      <Separator />

      <PublishStep
        number={2}
        title="Paste the details"
        action={
          <Button size="sm" variant="secondary" onClick={() => void copy(STEPS[next]!.step)}>
            <CopyIcon data-icon="inline-start" />
            Copy next: {STEPS[next]!.label.toLowerCase()}
          </Button>
        }
      >
        <FieldGroup className="gap-5">
          <Field data-invalid={titleProblems.length > 0}>
            <FieldLabel htmlFor="yt-title">Title</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="yt-title"
                aria-invalid={titleProblems.length > 0}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText className="tabular-nums">
                  {[...current.title].length}/{YOUTUBE_LIMITS.titleChars}
                </InputGroupText>
                {copyButton("title", "Title")}
              </InputGroupAddon>
            </InputGroup>
            <FieldError errors={titleProblems} />
          </Field>
          <Field data-invalid={descriptionProblems.length > 0}>
            <FieldLabel htmlFor="yt-description">Description</FieldLabel>
            <InputGroup>
              <InputGroupTextarea
                id="yt-description"
                rows={8}
                aria-invalid={descriptionProblems.length > 0}
                className="max-h-80"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
              <InputGroupAddon align="block-end">
                <InputGroupText className="tabular-nums">
                  {hashtagsIn(current.description).length} hashtags
                </InputGroupText>
                <span className="ml-auto" />
                {copyButton("description", "Description")}
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>YouTube shows the first three hashtags above the title.</FieldDescription>
            <FieldError errors={descriptionProblems} />
          </Field>
          <Field data-invalid={tagProblems.length > 0}>
            <FieldLabel htmlFor="yt-tags">Tags</FieldLabel>
            <InputGroup>
              <InputGroupTextarea
                id="yt-tags"
                rows={3}
                aria-invalid={tagProblems.length > 0}
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
              />
              <InputGroupAddon align="block-end">
                <InputGroupText className="tabular-nums">
                  {tagsLength(tags)}/{YOUTUBE_LIMITS.tagsChars}
                </InputGroupText>
                <span className="ml-auto" />
                {copyButton("tags", "Tags")}
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>In Studio, open Show more → Tags and paste them all at once.</FieldDescription>
            <FieldError errors={tagProblems} />
          </Field>
        </FieldGroup>
        {dirty && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy !== null || problems.length > 0 || running} onClick={() => void save()}>
              {busy === "save" && <Spinner data-icon="inline-start" aria-hidden />}
              Save edits
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => {
                setDraft(saved);
                setTagsText(saved.tags.join(", "));
              }}
            >
              Undo edits
            </Button>
          </div>
        )}
      </PublishStep>

      <Separator />

      <PublishStep number={3} title="Add the thumbnail">
        <ThumbnailEditor
          seriesId={seriesId}
          episodeId={episodeId}
          saved={data.kit.data.thumbnail}
          url={thumbnail.url}
          path={thumbnail.path}
          shots={shots}
          running={running}
        />
      </PublishStep>

      <Separator />

      <PublishStep number={4} title="Set these in Studio">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Audience</dt>
          <dd>{current.madeForKids ? "Yes, it’s made for kids" : "No, it’s not made for kids"}</dd>
          <dt className="text-muted-foreground">Category</dt>
          <dd>{current.category}</dd>
          <dt className="text-muted-foreground">Video language</dt>
          <dd>{languageName(current.language)}</dd>
          <dt className="text-muted-foreground">Altered content</dt>
          <dd className="text-pretty">
            No, for clearly stylised animation. Choose Yes if anything could pass for real footage of a real
            person or event.
          </dd>
        </dl>
        <p className="text-sm text-muted-foreground">A vertical video under 3 minutes becomes a Short on its own.</p>
      </PublishStep>

      <Separator />

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Not quite right?</h3>
        <Field>
          <FieldLabel htmlFor="rewrite-note">Rewrite with a note</FieldLabel>
          <Textarea
            id="rewrite-note"
            rows={2}
            placeholder="e.g. “More devotional tone, mention Janmashtami.”"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {dirty && <FieldDescription>Rewriting replaces your unsaved edits.</FieldDescription>}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy !== null || running} onClick={() => void rewrite()}>
            {busy === "rewrite" ? <Spinner data-icon="inline-start" aria-hidden /> : <RefreshCwIcon data-icon="inline-start" />}
            Rewrite
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditingDefaults(true)}>
            <Settings2Icon data-icon="inline-start" />
            Series defaults
          </Button>
        </div>
      </section>

      <DefaultsDialog
        open={editingDefaults}
        onOpenChange={setEditingDefaults}
        seriesId={seriesId}
        language={language}
        defaults={data.defaults}
        onSaved={() => {
          setEditingDefaults(false);
          reload();
        }}
      />
    </div>
  );
}

function PublishStep({
  number,
  title,
  action,
  children,
}: {
  number: number;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-5 items-center justify-center rounded-full bg-muted text-xs tabular-nums">
            {number}
          </span>
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// The thumbnail the engine rendered, and the shot and headline to render another one from.
function ThumbnailEditor({
  seriesId,
  episodeId,
  saved,
  url,
  path,
  shots,
  running,
}: {
  seriesId: string;
  episodeId: string;
  saved?: PublishThumbnail;
  url?: string;
  path?: string;
  shots: { id: string; intent: string }[];
  running: boolean;
}) {
  const [shotId, setShotId] = useState(saved?.shotId ?? shots[0]?.id ?? ""),
    [text, setText] = useState(saved?.text ?? ""),
    [busy, setBusy] = useState(false);
  // A new thumbnail (rendered or rewritten) resets the form to it.
  useEffect(() => {
    setShotId(saved?.shotId ?? shots[0]?.id ?? "");
    setText(saved?.text ?? "");
  }, [saved?.shotId, saved?.text, saved?.frame]);

  const length = [...text.trim()].length;
  const tooLong = length > THUMBNAIL_TEXT_MAX;
  const changed = !saved || !url || shotId !== saved.shotId || text.trim() !== saved.text;
  const canRender = changed && !busy && !running && !tooLong && shotId !== "";

  const render = async () => {
    setBusy(true);
    try {
      await api.publish.setThumbnail(seriesId, episodeId, { shotId, text: text.trim() });
      await useApp.getState().refreshLibrary(); // reloads the episode, and with it the new image
      useApp.getState().toast("Thumbnail updated", "success");
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex gap-4">
        <div className="relative aspect-[9/16] w-28 shrink-0 overflow-hidden rounded-lg border bg-muted">
          {url && path ? (
            <img
              key={url}
              src={url}
              alt="Episode thumbnail"
              draggable
              onDragStart={(e) => {
                e.preventDefault();
                api.app.startDrag(path);
              }}
              className="size-full cursor-grab object-cover active:cursor-grabbing"
            />
          ) : (
            <span className="flex size-full items-center justify-center p-3 text-center text-xs text-muted-foreground">
              No thumbnail yet
            </span>
          )}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/70">
              <Spinner aria-hidden />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col items-start gap-3">
          <p className="text-sm text-pretty text-muted-foreground">
            {url
              ? "Drag it onto Thumbnail in Studio. On Instagram, use it as the reel’s cover."
              : "Pick a shot and a headline, then make one."}
          </p>
          {path && (
            <Button size="sm" variant="outline" onClick={() => void api.app.showItem(path).catch(report)}>
              <FolderOpenIcon data-icon="inline-start" />
              Show file
            </Button>
          )}
        </div>
      </div>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="thumbnail-shot">Shot</FieldLabel>
          <Select value={shotId} onValueChange={setShotId} disabled={shots.length === 0}>
            <SelectTrigger id="thumbnail-shot" className="w-full">
              <SelectValue placeholder="Pick a shot" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {shots.map((shot) => (
                  <SelectItem key={shot.id} value={shot.id}>
                    <span className="truncate">
                      {humanize(shot.id)} · {shot.intent}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>The picture comes from the middle of the shot.</FieldDescription>
        </Field>
        <Field data-invalid={tooLong}>
          <FieldLabel htmlFor="thumbnail-text">Headline</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="thumbnail-text"
              aria-invalid={tooLong}
              placeholder="No headline"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canRender) void render();
              }}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText className="tabular-nums">
                {length}/{THUMBNAIL_TEXT_MAX}
              </InputGroupText>
            </InputGroupAddon>
          </InputGroup>
          {tooLong ? (
            <FieldError>Keep it to {THUMBNAIL_TEXT_MAX} characters so it reads at feed size.</FieldError>
          ) : (
            <FieldDescription>A few big words. Leave it empty for just the picture.</FieldDescription>
          )}
        </Field>
      </FieldGroup>
      {changed && (
        <Button size="sm" className="self-start" disabled={!canRender} onClick={() => void render()}>
          {busy ? <Spinner data-icon="inline-start" aria-hidden /> : <ImageIcon data-icon="inline-start" />}
          {url ? "Update thumbnail" : "Make thumbnail"}
        </Button>
      )}
    </>
  );
}

// Set once per series: added to every episode's kit from now on.
function DefaultsDialog({
  open,
  onOpenChange,
  seriesId,
  language,
  defaults,
  onSaved,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  seriesId: string;
  language: string;
  defaults?: PublishDefaults;
  onSaved(): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-4rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>YouTube defaults for this series</DialogTitle>
          <DialogDescription>
            Added to every episode’s details from now on. Rewrite an episode to apply them to it.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so it starts from the saved defaults each time. */}
        {open && <DefaultsForm seriesId={seriesId} language={language} defaults={defaults} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function DefaultsForm({
  seriesId,
  language,
  defaults,
  onSaved,
}: {
  seriesId: string;
  language: string;
  defaults?: PublishDefaults;
  onSaved(): void;
}) {
  const [footer, setFooter] = useState(defaults?.footer ?? ""),
    [hashtags, setHashtags] = useState((defaults?.hashtags ?? []).join(" ")),
    [madeForKids, setMadeForKids] = useState(defaults?.madeForKids ?? false),
    [category, setCategory] = useState<YoutubeCategory>(defaults?.category ?? "Entertainment"),
    [secondLanguage, setSecondLanguage] = useState(defaults?.secondLanguage ?? ""),
    [busy, setBusy] = useState(false);
  const tags = hashtags
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
  const tooMany = tags.length > 5;

  const save = async () => {
    setBusy(true);
    try {
      await api.publish.setDefaults(seriesId, {
        footer,
        hashtags: tags,
        madeForKids,
        category,
        secondLanguage: secondLanguage || undefined,
      });
      useApp.getState().toast("YouTube defaults saved", "success", {
        description: "New details use them. Rewrite an episode to apply them to it.",
      });
      onSaved();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <FieldGroup className="gap-5">
        <Field>
          <FieldLabel htmlFor="defaults-footer">Description footer</FieldLabel>
          <Textarea
            id="defaults-footer"
            rows={4}
            value={footer}
            onChange={(e) => setFooter(e.target.value)}
            placeholder="Follow for a new episode every day 🙏"
          />
          <FieldDescription>Added to the end of every description: channel links, a follow line.</FieldDescription>
        </Field>
        <Field data-invalid={tooMany}>
          <FieldLabel htmlFor="defaults-hashtags">Hashtags on every episode</FieldLabel>
          <Input
            id="defaults-hashtags"
            aria-invalid={tooMany}
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            placeholder="#shorts #animation"
          />
          {tooMany ? (
            <FieldError>Use at most 5 hashtags.</FieldError>
          ) : (
            <FieldDescription>Up to 5, separated by spaces.</FieldDescription>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="defaults-category">Category</FieldLabel>
          <Select value={category} onValueChange={(v) => setCategory(v as YoutubeCategory)}>
            <SelectTrigger id="defaults-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {Object.keys(YOUTUBE_CATEGORIES).map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="defaults-language">Second language for titles</FieldLabel>
          <Select value={secondLanguage || "none"} onValueChange={(v) => setSecondLanguage(v === "none" ? "" : v)}>
            <SelectTrigger id="defaults-language" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="none">None</SelectItem>
                {LANGUAGE_OPTIONS.filter((option) => option.value !== language).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>For example, a Hindi title followed by an English one.</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <Checkbox
            id="defaults-kids"
            checked={madeForKids}
            onCheckedChange={(checked) => setMadeForKids(checked === true)}
          />
          <FieldContent>
            <FieldLabel htmlFor="defaults-kids">Made for kids</FieldLabel>
            <FieldDescription>Turns off comments and personalised ads on YouTube.</FieldDescription>
          </FieldContent>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" disabled={busy}>
            Cancel
          </Button>
        </DialogClose>
        <Button disabled={busy || tooMany} onClick={() => void save()}>
          {busy && <Spinner data-icon="inline-start" aria-hidden />}
          Save defaults
        </Button>
      </DialogFooter>
    </>
  );
}
