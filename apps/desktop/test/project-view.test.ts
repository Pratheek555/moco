import { describe, expect, it, vi } from "vitest";
import type { MocoAPI, ProjectEvent, ProjectView, Update } from "../src/shared/api.ts";
import { mergeProjectEvents, observeProject } from "../src/renderer/src/features/project/project-view.ts";

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const event = (id: string): ProjectEvent => ({ id, at: "2026-11-14T12:00:00Z", event: { type: "text", messageId: "m", text: id } });
const view = (events: ProjectEvent[] = []): ProjectView => ({ project: { id: "p", name: "Project", workspace: "C:/project", provider: "codex", skill: { id: "s", name: "Skill", description: "", importedAt: "" }, createdAt: "", updatedAt: "" }, events, state: "idle" });
function setup() {
  const first = deferred<ProjectView>();
  let listener: (update: Update) => void = () => {};
  const off = vi.fn(), onView = vi.fn<(value: ProjectView | undefined) => void>(), onError = vi.fn();
  const source: Pick<MocoAPI, "project" | "onUpdate"> = {
    onUpdate: vi.fn(callback => { listener = callback; return off; }),
    project: vi.fn(() => first.promise),
  };
  const observer = observeProject(source, "p", onView, onError);
  return { first, emit: (update: Update) => listener(update), source, off, onView, onError, observer };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("project view subscription", () => {
  it("subscribes before loading, buffers records, and preserves the latest state including idle", async () => {
    const test = setup();
    expect(vi.mocked(test.source.onUpdate).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(test.source.project).mock.invocationCallOrder[0]!);
    test.emit({ projectId: "p", record: event("a"), state: "running" });
    test.emit({ projectId: "p", record: event("b") });
    test.emit({ projectId: "p", record: event("b"), state: "idle" });
    test.first.resolve({ ...view([event("a")]), state: "running" }); await flush();
    expect(test.onView.mock.lastCall?.[0]).toMatchObject({ state: "idle", events: [{ id: "a" }, { id: "b" }] });
    test.observer.dispose();
  });
  it("updates after loading and ignores other projects and global errors", async () => {
    const test = setup(); test.first.resolve(view()); await flush();
    test.emit({ projectId: "other", record: event("other"), state: "error" });
    test.emit({ error: "Host error handled by the shell" });
    test.emit({ projectId: "p", record: event("a"), state: "waiting" });
    test.emit({ projectId: "p", record: event("a") });
    expect(test.onView.mock.lastCall?.[0]).toMatchObject({ state: "waiting", events: [{ id: "a" }] });
    test.observer.dispose();
  });
  it("supports retry after a load error", async () => {
    const test = setup(); test.first.reject(new Error("Cannot read")); await flush();
    expect(test.onError.mock.lastCall?.[0]).toEqual(new Error("Cannot read"));
    const retry = deferred<ProjectView>(); vi.mocked(test.source.project).mockReturnValueOnce(retry.promise);
    const loaded = test.observer.reload();
    expect(test.onError.mock.lastCall?.[0]).toBeUndefined();
    test.emit({ projectId: "p", record: event("during-retry"), state: "running" });
    retry.resolve(view()); await loaded;
    expect(test.onView.mock.lastCall?.[0]).toMatchObject({ state: "running", events: [{ id: "during-retry" }] });
    test.observer.dispose();
  });
  it("ignores a stale load when reload overtakes it", async () => {
    const test = setup(), retry = deferred<ProjectView>();
    vi.mocked(test.source.project).mockReturnValueOnce(retry.promise);
    const loaded = test.observer.reload(); retry.resolve(view([event("new")])); await loaded;
    test.first.resolve(view([event("old")])); await flush();
    expect(test.onView.mock.lastCall?.[0]?.events.map(event => event.id)).toEqual(["new"]);
    test.observer.dispose();
  });
  it("unsubscribes and suppresses work after disposal", async () => {
    const test = setup(); test.observer.dispose();
    const count = test.onView.mock.calls.length;
    test.first.resolve(view()); await flush(); test.emit({ projectId: "p", record: event("a") });
    expect(test.off).toHaveBeenCalledOnce(); expect(test.onView).toHaveBeenCalledTimes(count);
  });
  it("deduplicates both snapshot and incoming records in stable order", () => {
    expect(mergeProjectEvents([event("a"), event("a"), event("b")], [event("b"), event("c"), event("c")]).map(event => event.id)).toEqual(["a", "b", "c"]);
  });
});
