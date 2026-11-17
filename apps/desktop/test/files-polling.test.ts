import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFilePoller } from "../src/renderer/src/features/files/polling.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("workspace polling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shares an in-flight request with manual refresh and never overlaps long polls", async () => {
    const request = deferred<string[]>();
    const load = vi.fn(() => request.promise);
    const onFiles = vi.fn();
    const poller = createFilePoller({ load, onFiles, onError: vi.fn(), isVisible: () => true });
    poller.start();
    const first = poller.refresh();
    expect(poller.refresh()).toBe(first);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(load).toHaveBeenCalledTimes(1);
    request.resolve(["final.mp4"]);
    await first;
    expect(onFiles).toHaveBeenCalledWith(["final.mp4"]);
    await vi.advanceTimersByTimeAsync(2999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("pauses while hidden and refreshes immediately on becoming visible", async () => {
    let visible = false;
    const load = vi.fn(async () => ["file"]);
    const poller = createFilePoller({ load, onFiles: vi.fn(), onError: vi.fn(), isVisible: () => visible });
    poller.start();
    await vi.advanceTimersByTimeAsync(9000);
    expect(load).not.toHaveBeenCalled();
    visible = true;
    poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    visible = false;
    poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(9000);
    expect(load).toHaveBeenCalledTimes(1);
    visible = true;
    poller.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("keeps polling after a failure, preserves the last list and rejects manual errors", async () => {
    const failure = new Error("Project folder is unavailable");
    const load = vi.fn().mockResolvedValueOnce(["old.mp4"]).mockRejectedValueOnce(failure).mockResolvedValue(["new.mp4"]);
    const onFiles = vi.fn();
    const onError = vi.fn();
    const poller = createFilePoller({ load, onFiles, onError, isVisible: () => true });
    await poller.refresh();
    await expect(poller.refresh()).rejects.toThrow(failure);
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onFiles).toHaveBeenLastCalledWith(["new.mp4"]);
    poller.stop();
  });

  it("ignores late results from a closed project and cancels scheduled work", async () => {
    const request = deferred<string[]>();
    const load = vi.fn(() => request.promise);
    const onFiles = vi.fn();
    const onError = vi.fn();
    const poller = createFilePoller({ load, onFiles, onError, isVisible: () => true });
    const pending = poller.refresh();
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    request.resolve(["old-project.mp4"]);
    await pending;
    await vi.advanceTimersByTimeAsync(9000);
    expect(onFiles).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not start a request after immediate effect cleanup, including React StrictMode", async () => {
    const load = vi.fn(async () => []);
    const poller = createFilePoller({ load, onFiles: vi.fn(), onError: vi.fn(), isVisible: () => true });
    poller.start();
    poller.stop();
    await vi.advanceTimersByTimeAsync(9000);
    expect(load).not.toHaveBeenCalled();
  });

  it("does not issue an extra request if visibility resumes during a pending poll", async () => {
    let visible = true;
    const request = deferred<string[]>();
    const load = vi.fn(() => request.promise);
    const poller = createFilePoller({ load, onFiles: vi.fn(), onError: vi.fn(), isVisible: () => visible });
    const pending = poller.refresh();
    await vi.advanceTimersByTimeAsync(0);
    visible = false;
    poller.visibilityChanged();
    visible = true;
    poller.visibilityChanged();
    request.resolve([]);
    await pending;
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(load).toHaveBeenCalledTimes(2);
    poller.stop();
  });
});
