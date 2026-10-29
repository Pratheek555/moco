import { randomUUID } from "node:crypto";
import type { Job, JobKind, JobLog } from "../shared/api.ts";

// A small job queue: AI work, voicing and rendering run in the background with
// progress pushed to the UI. Renders are serialised (they saturate the CPU).

export interface JobContext {
  job: Job;
  signal: AbortSignal;
  update(
    patch: Partial<Pick<Job, "progress" | "stage" | "output" | "title">>,
  ): void;
  log(msg: string, level?: JobLog["level"]): void;
  stream(text: string): void;
}

type Runner = (ctx: JobContext) => Promise<void>;

const LIMITS: Record<JobKind, { lane: "ai" | "voice" | "render" }> = {
  plan: { lane: "ai" },
  write: { lane: "ai" },
  "write-all": { lane: "ai" },
  revise: { lane: "ai" },
  voice: { lane: "voice" },
  render: { lane: "render" },
  make: { lane: "render" },
};
const LANE_CONCURRENCY = { ai: 2, voice: 2, render: 1 };

export function createJobManager(broadcast: (jobs: Job[]) => void) {
  const jobs: Job[] = [];
  const runners = new Map<string, Runner>();
  const controllers = new Map<string, AbortController>();
  let timer: NodeJS.Timeout | null = null;

  const publish = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      broadcast(snapshot());
    }, 80);
  };
  const snapshot = () => jobs.map((j) => ({ ...j, logs: j.logs.slice(-200) }));

  const running = (lane: string) =>
    jobs.filter((j) => j.status === "running" && LIMITS[j.kind].lane === lane)
      .length;

  function pump() {
    for (const job of jobs) {
      if (job.status !== "queued") continue;
      const lane = LIMITS[job.kind].lane;
      if (running(lane) >= LANE_CONCURRENCY[lane]) continue;
      start(job);
    }
  }

  function start(job: Job) {
    const run = runners.get(job.id);
    if (!run) return;
    const controller = new AbortController();
    controllers.set(job.id, controller);
    job.status = "running";
    job.startedAt = Date.now();
    publish();
    const ctx: JobContext = {
      job,
      signal: controller.signal,
      update(patch) {
        Object.assign(job, patch);
        publish();
      },
      log(msg, level = "info") {
        job.logs.push({ t: Date.now(), level, msg });
        if (job.logs.length > 400) job.logs.splice(0, job.logs.length - 400);
        publish();
      },
      stream(text) {
        job.stream = (job.stream + text).slice(-6000);
        publish();
      },
    };
    run(ctx)
      .then(() => {
        if (job.status === "running") {
          job.status = "done";
          job.progress = 1;
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          job.status = "canceled";
          job.stage = "Cancelled";
        } else {
          job.status = "error";
          job.error = err instanceof Error ? err.message : String(err);
          job.logs.push({ t: Date.now(), level: "error", msg: job.error });
        }
      })
      .finally(() => {
        job.finishedAt = Date.now();
        controllers.delete(job.id);
        runners.delete(job.id);
        publish();
        pump();
      });
  }

  return {
    add(
      kind: JobKind,
      title: string,
      meta: Pick<Job, "seriesId" | "number">,
      run: Runner,
    ): Job {
      const job: Job = {
        id: randomUUID(),
        kind,
        title,
        ...meta,
        status: "queued",
        progress: 0,
        stage: "Queued",
        logs: [],
        stream: "",
        createdAt: Date.now(),
      };
      jobs.unshift(job);
      runners.set(job.id, run);
      publish();
      pump();
      return job;
    },
    cancel(id: string) {
      const job = jobs.find((j) => j.id === id);
      if (!job) return;
      if (job.status === "queued") {
        job.status = "canceled";
        job.stage = "Cancelled";
        runners.delete(id);
        publish();
      } else controllers.get(id)?.abort();
    },
    list: snapshot,
    clear() {
      for (let i = jobs.length - 1; i >= 0; i--)
        if (!["queued", "running"].includes(jobs[i]!.status)) jobs.splice(i, 1);
      publish();
    },
    isBusy(seriesId: string, number?: number) {
      return jobs.some(
        (j) =>
          (j.status === "running" || j.status === "queued") &&
          j.seriesId === seriesId &&
          (number === undefined ||
            j.number === undefined ||
            j.number === number),
      );
    },
  };
}

export type JobManager = ReturnType<typeof createJobManager>;
