// Brings a reference into its folder: source.mp4 (yt-dlp for links, a copy for local files), meta.json and audio.wav.
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { runTool, type Tools } from "./tools.ts";

export interface ReferenceMeta {
  id: string;
  source: string; // the link or path the user gave
  title: string;
  channel?: string;
  url?: string;
  uploadDate?: string;
  views?: number;
  description?: string;
  fps: number;
  width: number;
  height: number;
  duration: number;
}

const YOUTUBE_ID = /(?:youtube\.com\/(?:shorts\/|watch\?(?:.*&)?v=|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/;

export function referenceId(source: string): string {
  const youtube = YOUTUBE_ID.exec(source)?.[1];
  if (youtube) return `yt-${youtube}`;
  const name = basename(source, extname(source)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `file-${name.slice(0, 40) || "video"}`;
}

export function isLink(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

export async function fetchReference(source: string, dir: string, tools: Tools, signal?: AbortSignal, log?: (line: string) => void): Promise<ReferenceMeta> {
  await mkdir(dir, { recursive: true });
  const video = join(dir, "source.mp4");
  const metaFile = join(dir, "meta.json");
  const cached = await readMeta(metaFile);
  if (cached && cached.source === source && (await sizeOf(video)) > 0) return cached;

  let info: Record<string, unknown> = {};
  if (isLink(source)) {
    // Up to 1080p: enough for frame-level measurement, small enough to decode fast.
    const args = ["-I", "-m", "yt_dlp", "--no-playlist", "--js-runtimes", "node", "-f", "bv*[height<=1920][width<=1920][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
      "--merge-output-format", "mp4", "--write-info-json", "--no-write-playlist-metafiles", "-o", join(dir, "source.%(ext)s")];
    if (tools.ffmpeg !== "ffmpeg") args.push("--ffmpeg-location", tools.ffmpeg);
    try {
      await runTool(tools.python, [...args, source], { timeoutMs: 15 * 60_000, signal, onLine: log });
    } catch (error) {
      // yt-dlp's own "ERROR: …" line says what went wrong (private, removed, region-locked…).
      const detail = /ERROR: (.+)/.exec(error instanceof Error ? error.message : String(error))?.[1];
      throw detail ? new Error(`Couldn't download ${source}: ${detail}`) : error;
    }
    const infoFile = (await readdir(dir)).find((name) => name.endsWith(".info.json"));
    if (infoFile) {
      info = JSON.parse(await readFile(join(dir, infoFile), "utf8")) as Record<string, unknown>;
      await rm(join(dir, infoFile)); // megabytes of format lists; we keep the few fields below
    }
  } else {
    await copyFile(source, video);
  }

  const probe = await probeVideo(video, tools, signal);
  const meta: ReferenceMeta = {
    id: basename(dir),
    source,
    title: typeof info.title === "string" ? info.title : basename(source),
    channel: typeof info.channel === "string" ? info.channel : typeof info.uploader === "string" ? info.uploader : undefined,
    url: typeof info.webpage_url === "string" ? info.webpage_url : isLink(source) ? source : undefined,
    uploadDate: typeof info.upload_date === "string" ? info.upload_date : undefined,
    views: typeof info.view_count === "number" ? info.view_count : undefined,
    description: typeof info.description === "string" ? info.description.slice(0, 600) : undefined,
    ...probe,
  };
  await writeFile(metaFile, JSON.stringify(meta, null, 2));
  return meta;
}

export async function extractAudio(dir: string, tools: Tools, signal?: AbortSignal): Promise<string> {
  const wav = join(dir, "audio.wav");
  if ((await sizeOf(wav)) > 0) return wav;
  // 16 kHz mono: what whisper wants, and plenty for levels and pitch.
  await runTool(tools.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", join(dir, "source.mp4"), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { timeoutMs: 5 * 60_000, signal });
  return wav;
}

async function probeVideo(file: string, tools: Tools, signal?: AbortSignal): Promise<Pick<ReferenceMeta, "fps" | "width" | "height" | "duration">> {
  const { stdout } = await runTool(
    tools.ffprobe,
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate:format=duration", "-of", "json", file],
    { timeoutMs: 60_000, signal },
  );
  const parsed = JSON.parse(stdout) as { streams?: { width?: number; height?: number; avg_frame_rate?: string }[]; format?: { duration?: string } };
  const stream = parsed.streams?.[0];
  if (!stream?.width || !stream.height) throw new Error(`${file} has no video stream`);
  const [num, den] = (stream.avg_frame_rate ?? "30/1").split("/").map(Number);
  return { width: stream.width, height: stream.height, fps: num && den ? num / den : 30, duration: Number(parsed.format?.duration ?? 0) };
}

async function readMeta(file: string): Promise<ReferenceMeta | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as ReferenceMeta;
  } catch {
    return undefined;
  }
}

async function sizeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}
