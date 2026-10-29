import {
  EpisodeSchema,
  SeriesSchema,
  episodeSeconds,
  slugify,
  type Episode,
  type EpisodeStatus,
  type Series,
} from "@moco/spec";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

// Projects live as plain folders the user can back up or open:
//   <root>/<series-id>/series.json
//   <root>/<series-id>/episodes/01/episode.json, audio/, renders/

export interface RenderRecord {
  file: string;
  path: string;
  createdAt: string;
  size: number;
}

export interface EpisodeSummary {
  number: number;
  title: string;
  hook: string;
  summary: string;
  status: EpisodeStatus;
  seconds?: number;
  shots?: number;
  renders: number;
  updatedAt?: string;
}

export interface SeriesSummary {
  id: string;
  title: string;
  logline: string;
  language: string;
  style: string;
  cast: Series["cast"];
  episodes: EpisodeSummary[];
  updatedAt: string;
  createdAt: string;
}

async function writeJsonAtomic(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

export const pad = (n: number) => String(n).padStart(2, "0");

export function createStore(root: string) {
  const seriesDir = (id: string) => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,160}$/.test(id))
      throw new Error("Invalid series id");
    return path.join(root, id);
  };
  const episodeDir = (id: string, n: number) => {
    if (!Number.isInteger(n) || n < 1 || n > 1000)
      throw new Error("Invalid episode number");
    return path.join(seriesDir(id), "episodes", pad(n));
  };
  const seriesFile = (id: string) => path.join(seriesDir(id), "series.json");
  const episodeFile = (id: string, n: number) =>
    path.join(episodeDir(id, n), "episode.json");

  async function getSeries(id: string): Promise<Series> {
    const raw = JSON.parse(await readFile(seriesFile(id), "utf8"));
    return SeriesSchema.parse(raw);
  }

  async function saveSeries(series: Series) {
    series.updatedAt = new Date().toISOString();
    await writeJsonAtomic(seriesFile(series.id), SeriesSchema.parse(series));
  }

  async function getEpisode(id: string, n: number): Promise<Episode | null> {
    const file = episodeFile(id, n);
    if (!existsSync(file)) return null;
    const parsed = EpisodeSchema.safeParse(
      JSON.parse(await readFile(file, "utf8")),
    );
    if (!parsed.success)
      throw new Error(
        `episode ${n} of ${id} is corrupt: ${parsed.error.issues[0]?.message}`,
      );
    return parsed.data;
  }

  async function saveEpisode(id: string, episode: Episode) {
    await writeJsonAtomic(
      episodeFile(id, episode.number),
      EpisodeSchema.parse(episode),
    );
  }

  async function renders(id: string, n: number): Promise<RenderRecord[]> {
    const dir = path.join(episodeDir(id, n), "renders");
    if (!existsSync(dir)) return [];
    const files = (await readdir(dir)).filter((f) => f.endsWith(".mp4"));
    const out = await Promise.all(
      files.map(async (file) => {
        const p = path.join(dir, file);
        const s = await stat(p);
        return {
          file,
          path: p,
          createdAt: s.mtime.toISOString(),
          size: s.size,
        };
      }),
    );
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async function summarize(series: Series): Promise<SeriesSummary> {
    const episodes = await Promise.all(
      series.episodes.map(async (o) => {
        const ep = await getEpisode(series.id, o.number).catch(() => null);
        const r = await renders(series.id, o.number);
        return {
          number: o.number,
          title: ep?.title ?? o.title,
          hook: ep?.hook || o.hook,
          summary: ep?.summary || o.summary,
          status: o.status,
          seconds: ep ? episodeSeconds(ep) : undefined,
          shots: ep?.shots.length,
          renders: r.length,
          updatedAt: o.updatedAt,
        } satisfies EpisodeSummary;
      }),
    );
    return {
      id: series.id,
      title: series.title,
      logline: series.logline,
      language: series.language,
      style: series.style,
      cast: series.cast,
      episodes,
      updatedAt: series.updatedAt,
      createdAt: series.createdAt,
    };
  }

  return {
    root,
    seriesDir,
    episodeDir,
    async ensure() {
      await mkdir(root, { recursive: true });
    },
    newSeriesId(title: string) {
      return `${slugify(title, 32)}-${randomBytes(3).toString("hex")}`;
    },
    async listSeries(): Promise<SeriesSummary[]> {
      if (!existsSync(root)) return [];
      const dirs = (await readdir(root, { withFileTypes: true })).filter(
        (d) => d.isDirectory() && !d.name.startsWith("."),
      );
      const all = await Promise.all(
        dirs.map(async (d) => {
          try {
            return await summarize(await getSeries(d.name));
          } catch {
            return null;
          }
        }),
      );
      return all
        .filter((s): s is SeriesSummary => !!s)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    getSeries,
    saveSeries,
    summarize,
    async deleteSeries(id: string) {
      if (!id || id.includes("..") || path.isAbsolute(id))
        throw new Error("bad series id");
      await rm(seriesDir(id), { recursive: true, force: true });
    },
    getEpisode,
    saveEpisode,
    renders,
    async setStatus(id: string, n: number, status: EpisodeStatus) {
      const series = await getSeries(id);
      const o = series.episodes.find((e) => e.number === n);
      if (!o) return;
      o.status = status;
      o.updatedAt = new Date().toISOString();
      await saveSeries(series);
    },
    renderPath(id: string, n: number) {
      const stamp =
        new Date().toISOString().replace(/[:.]/g, "-") +
        "-" +
        randomBytes(2).toString("hex");
      return path.join(
        episodeDir(id, n),
        "renders",
        `ep${pad(n)}-${stamp}.mp4`,
      );
    },
    cacheDir() {
      return path.join(root, ".cache");
    },
    /** Append an AI exchange to the series log for debugging prompts. */
    async log(id: string, entry: Record<string, unknown>) {
      const file = path.join(seriesDir(id), "ai-log.jsonl");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(
        file,
        `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
        { flag: "a" },
      );
    },
  };
}

export type ProjectStore = ReturnType<typeof createStore>;
