import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createEngine, type Engine } from "../src/index.ts";
import { FakeAi, FakeAudio, FakeRenderPort } from "../src/testing/fakes.ts";
import { advance, approveNext, scriptData, section, validAnswer } from "./helpers.ts";

async function established(episodes = 1) {
  const dir = await mkdtemp(join(tmpdir(), "moco-repeat-"));
  let failReview = false, failScript = false;
  const ai = Object.assign(new FakeAi(async (request, task) => {
    if (task === "script" && failScript) throw new Error("Interrupted script generation");
    if (task === "script") return { ...scriptData(2), targetSeconds: 12 };
    if (task === "artist") {
      const call = async (name: string, args: object) => request.artistTools!.find(tool => tool.name === name)!.call(args);
      const id = /Create shot (s\d+)/.exec(request.prompt)![1]!;
      const text = (result: Awaited<ReturnType<typeof call>>) => result.content.filter(block => block.type === "text").map(block => block.text).join("");
      const files = JSON.parse(text(await call("list_files", {}))) as string[];
      const brief = JSON.parse(text(await call("read_file", { path: `shots/${id}/brief.json` })));
      if (!files.includes("shared/character.js")) await call("write_file", { path: "shared/character.js", content: "function character(){helpers.circle(100,100,50,'#48767a')}" });
      await call("write_file", { path: `shots/${id}/draw.js`, content: "character();" });
      await call("write_file", { path: `shots/${id}/scene.json`, content: JSON.stringify({ sourceFiles: ["shared/character.js", `shots/${id}/draw.js`], cast: brief.shot.characters }) });
      await call("render_preview", {});
      return { finished: true };
    }
    if (task === "artist_review") {
      const parsed = JSON.parse(request.prompt);
      const targets = parsed.targets?.map((item: { shot: unknown }) => item.shot) ?? [parsed.target];
      const verdicts = targets.map((shot: { id: string; actionChecks: object[] }) => {
        const fails = failReview && shot.id === "s01";
        return { id: shot.id, score: fails ? 2 : 4, overall: "Sampled frames",
          checks: shot.actionChecks.map(action => ({ ...action, status: fails ? "fail" : "pass", severity: "major", evidence: "Sampled frames", fix: fails ? "Make the pointing hand clear" : "" })),
        };
      });
      return parsed.targets ? { verdicts } : verdicts[0];
    }
    const answer = validAnswer(request, task);
    if (task === "shots") {
      const words = section<unknown[]>(request.prompt, "Words");
      return { shots: Array.from({ length: Math.ceil(words.length / 14) }, (_, i) => ({ id: `s${String(i + 1).padStart(2, "0")}`, fromWord: i * 14, intent: "Explain the diagram.", characters: ["krishna"], location: "kurukshetra", actionChecks: [{ id: "point", description: "Hand points to the diagram", fromWord: i * 14, toWord: i * 14 }] })) };
    }
    if (task === "show") return { ...answer as object, format: { ...(answer as { format: object }).format, targetSeconds: 12 }, requirements: [{ id: "flat", text: "Flat illustrated explainer", support: "available", reason: "Canvas" }] };
    return answer;
  }), { supportsArtist: true, seesImages: true });
  const render = new FakeRenderPort(), audio = new FakeAudio();
  const create = () => createEngine({ projectsDir: dir, ai, render, audio });
  const engine = create();
  const id = await engine.createSeries({ idea: "Illustrated explainers with Krishna and Arjuna.", language: "en", episodes, production: { mode: "artist", format: { width: 960, height: 540, fps: 30 }, targetSeconds: 12 } });
  for (let gate = 0; gate < 5; gate++) { await advance(engine, id); await approveNext(engine, id); }
  await advance(engine, id);
  return { dir, id, engine, ai, create, render, setFailReview: (value: boolean) => { failReview = value; }, setFailScript: (value: boolean) => { failScript = value; } };
}

const runNext = async (engine: Engine, id: string, topic?: string) => {
  const job = await engine.waitForJob(await engine.nextEpisode(id, { topic }));
  expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
  return job;
};

it("adds one topic, combines outline/script review and retains preview approval and series decisions", async () => {
  const { engine, id, dir, ai } = await established();
  const original = await readFile(join(dir, id, "episodes/ep-01/shots/s01/spec.json"), "utf8");
  const offer = await engine.repeatOffer(id);
  expect(offer).toMatchObject({ available: true, sourceEpisodeId: "ep-01", reuse: { designFiles: 1, cast: ["Krishna", "Arjuna"], format: { width: 960, height: 540, fps: 30 } } });
  const before = ai.requests.length;
  const job = await runNext(engine, id, "Why does friction make heat?");
  expect(job.stagesRun).toEqual(["series_plan", "ep-02/script"]);
  expect(ai.requests.slice(before).every(request => !request.artistTools)).toBe(true);
  expect(ai.requests.slice(before).some(request => request.prompt.includes("Why does friction make heat?"))).toBe(true);
  let status = await engine.status(id);
  expect(status.next).toMatchObject({ kind: "waiting", key: "ep-02/script" });
  expect(status.repeatEpisodes?.["ep-02"]?.outlinePending).toBe(true);
  expect(status.stages.find(stage => stage.key === "series_plan")?.status).toBe("done");
  const gate = status.stages.find(stage => stage.key === "ep-02/script")!;
  await expect(engine.approve({ seriesId: id, key: gate.key }, "old-hash")).rejects.toMatchObject({ code: "gate_mismatch" });
  await approveNext(engine, id);
  expect((await engine.status(id)).repeatEpisodes?.["ep-02"]?.outlinePending).toBe(false);
  await advance(engine, id);
  status = await engine.status(id);
  expect(status.next).toMatchObject({ kind: "waiting", key: "ep-02/preview" });
  await expect(engine.renderFinal({ seriesId: id, episodeId: "ep-02" }).then(job => engine.waitForJob(job))).resolves.toMatchObject({ status: "failed", error: { code: "stage_blocked" } });
  const artist = ai.requests.slice().reverse().find(request => Boolean(request.artistTools))!;
  await expect(artist.artistTools!.find(tool => tool.name === "write_file")!.call({ path: "shared/versions/new.js", content: "new character" })).rejects.toThrow(/approved designs/);
  await approveNext(engine, id);
  await advance(engine, id);
  expect((await engine.status(id)).next).toEqual({ kind: "finished" });
  expect(await readFile(join(dir, id, "episodes/ep-01/shots/s01/spec.json"), "utf8")).toBe(original);
  expect(await readFile(join(dir, id, "episodes/ep-02/artist/shared/character.js"), "utf8")).toBe(await readFile(join(dir, id, "episodes/ep-01/artist/shared/character.js"), "utf8"));
  // Simulate a crash after memory was saved but before its stage was marked complete.
  const ledgerPath = join(dir, id, "ledger.json");
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  ledger.stages["ep-02/memory_update"].status = "running";
  await writeFile(ledgerPath, JSON.stringify(ledger));
  const restarted = createEngine({ projectsDir: dir, ai, render: new FakeRenderPort(), audio: new FakeAudio() });
  const memoryCalls = ai.requests.filter(request => request.system.includes("prompt: memory")).length;
  await advance(restarted, id);
  expect(ai.requests.filter(request => request.system.includes("prompt: memory"))).toHaveLength(memoryCalls);
  const memory = JSON.parse(await readFile(join(dir, id, "artifacts/memory.json"), "utf8"));
  expect(memory.data.facts.filter((fact: { sinceEpisode: string }) => fact.sinceEpisode === "ep-02")).toHaveLength(1);
}, 30_000);

it("starts a planned episode without changing the plan, and resumes combined review after restart", async () => {
  const { engine, id, dir, create } = await established(2);
  const plan = await readFile(join(dir, id, "artifacts/series_plan.json"), "utf8");
  await expect(engine.nextEpisode(id, { topic: "Unrelated new topic" })).rejects.toThrow(/already planned/);
  expect((await runNext(engine, id)).stagesRun).toEqual(["ep-02/script"]);
  expect(await readFile(join(dir, id, "artifacts/series_plan.json"), "utf8")).toBe(plan);
  const restarted = create();
  expect((await restarted.status(id)).next).toMatchObject({ key: "ep-02/script", status: "awaiting_approval" });
  await approveNext(restarted, id);
  await advance(restarted, id);
  expect((await restarted.status(id)).next).toMatchObject({ key: "ep-02/preview" });
}, 30_000);

it("keeps a rejected combined script behind review and preserves its outline on restart", async () => {
  const { engine, id, create, ai } = await established();
  await runNext(engine, id, "Explain magnets");
  await engine.reject({ seriesId: id, key: "ep-02/script" }, "Make the explanation simpler");
  const restarted = create();
  await advance(restarted, id);
  const revisedOutline = ai.requests.slice().reverse().find(request => request.system.includes("prompt: series_extend"))!;
  expect(revisedOutline.prompt).toContain("Make the explanation simpler");
  expect((await restarted.status(id)).repeatEpisodes?.["ep-02"]).toMatchObject({ outlinePending: true, topic: "Explain magnets" });
  expect((await restarted.status(id)).next).toMatchObject({ key: "ep-02/script", status: "awaiting_approval" });
  await approveNext(restarted, id);
  expect((await restarted.status(id)).stages.find(stage => stage.key === "series_plan")?.status).toBe("approved");
}, 30_000);

it("rejects duplicate launches and recovers an interrupted combined plan without adding another episode", async () => {
  const { engine, id, dir, create, setFailScript, ai } = await established();
  setFailScript(true);
  const launches = await Promise.allSettled([engine.nextEpisode(id, { topic: "Explain ice" }), engine.nextEpisode(id, { topic: "Explain ice" })]);
  const successful = launches.filter(result => result.status === "fulfilled");
  expect(successful).toHaveLength(1);
  expect(launches.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "busy" } });
  const jobId = (successful[0] as PromiseFulfilledResult<string>).value;
  expect(await engine.waitForJob(jobId)).toMatchObject({ status: "failed" });
  const ledgerPath = join(dir, id, "ledger.json");
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  ledger.stages["ep-02/script"].status = "running";
  ledger.jobs[jobId].status = "running";
  await writeFile(ledgerPath, JSON.stringify(ledger));
  await rm(join(dir, id, "episodes/ep-02/artist/shared/character.js"));
  setFailScript(false);
  const restarted = create();
  const outlineCalls = ai.requests.filter(request => request.system.includes("prompt: series_extend")).length;
  await advance(restarted, id);
  expect(ai.requests.filter(request => request.system.includes("prompt: series_extend"))).toHaveLength(outlineCalls);
  const status = await restarted.status(id);
  expect(status.next).toMatchObject({ key: "ep-02/script", status: "awaiting_approval" });
  expect(status.stages.some(stage => stage.key.startsWith("ep-03/"))).toBe(false);
  expect(await readFile(join(dir, id, "episodes/ep-02/artist/shared/character.js"), "utf8")).toContain("function character");
}, 30_000);

it("blocks changed approved source and changed inherited files instead of silently using them", async () => {
  const { engine, id, dir, create } = await established();
  const source = join(dir, id, "episodes/ep-01/artist/shared/character.js");
  const bytes = await readFile(source);
  await writeFile(source, "changed design");
  expect(await engine.repeatOffer(id)).toMatchObject({ available: false, reason: expect.stringContaining("missing or changed") });
  await writeFile(source, bytes);
  await runNext(engine, id, "Explain inertia");
  await writeFile(join(dir, id, "episodes/ep-02/artist/shared/character.js"), "changed inherited design");
  const restarted = create();
  await expect(approveNext(restarted, id)).rejects.toThrow(/Reused design/);
  // Restoring the expected bytes lets the existing review resume without rebuilding the episode.
  await writeFile(join(dir, id, "episodes/ep-02/artist/shared/character.js"), bytes);
  await approveNext(restarted, id);
}, 30_000);

it("offers an inspection preview for unresolved quality without approving or exporting it", async () => {
  const { engine, id, dir, setFailReview, render } = await established();
  await runNext(engine, id, "Explain gravity");
  await approveNext(engine, id);
  setFailReview(true);
  const failed = await engine.waitForJob(await engine.runStage({ seriesId: id }));
  expect(failed).toMatchObject({ status: "failed", error: { code: "validation_failed" } });
  const rendersBefore = render.renders;
  const previewBefore = (await engine.status(id)).stages.find(stage => stage.key === "ep-02/preview");
  expect(await engine.waitForJob(await engine.inspectPreview({ seriesId: id, episodeId: "ep-02" }))).toMatchObject({ status: "succeeded" });
  expect(render.renders).toBeGreaterThan(rendersBefore);
  expect(await engine.renderFreshness({ seriesId: id, episodeId: "ep-02" })).toEqual({ preview: true, final: false });
  expect((await engine.status(id)).stages.find(stage => stage.key === "ep-02/preview")).toEqual(previewBefore);
  expect((await engine.status(id)).stages.find(stage => stage.key === "ep-02/scenes")?.status).toBe("failed");
  await expect(engine.approve({ seriesId: id, key: "ep-02/preview" }, "anything")).rejects.toMatchObject({ code: "not_awaiting_approval" });
  expect(await engine.waitForJob(await engine.renderFinal({ seriesId: id, episodeId: "ep-02" }))).toMatchObject({ status: "failed" });
  // An inspection report must not bypass freshness checks after the cut changes.
  const scenePath = join(dir, id, "episodes/ep-02/shots/s01/spec.json");
  const sceneBytes = await readFile(scenePath, "utf8");
  const changedScene = JSON.parse(sceneBytes);
  changedScene.data.durationFrames += 1;
  await writeFile(scenePath, JSON.stringify(changedScene));
  expect(await engine.renderFreshness({ seriesId: id, episodeId: "ep-02" })).toEqual({ preview: false, final: false });
  await writeFile(scenePath, sceneBytes);
  setFailReview(false);
  await advance(engine, id);
  expect((await engine.status(id)).next).toMatchObject({ key: "ep-02/preview", status: "awaiting_approval" });
}, 30_000);
