/** Visibility-aware, non-overlapping polling. Manual refresh shares any pending request. */
export function createFilePoller<T>({ load, onFiles, onError, isVisible, interval = 3000 }: {
  load: () => Promise<T>;
  onFiles: (files: T) => void;
  onError: (error: unknown) => void;
  isVisible: () => boolean;
  interval?: number;
}) {
  let active = true;
  let pending: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer() {
    clearTimeout(timer);
    timer = undefined;
  }

  function schedule() {
    clearTimer();
    if (active && isVisible()) timer = setTimeout(() => {
      if (isVisible()) void refresh().catch(() => {});
    }, interval);
  }

  function refresh(): Promise<void> {
    if (!active) return Promise.resolve();
    if (pending) return pending;
    clearTimer();
    pending = Promise.resolve().then(async () => {
      if (!active) return;
      try {
        const files = await load();
        if (active) onFiles(files);
      } catch (error) {
        if (active) onError(error);
        throw error;
      }
    }).finally(() => {
      pending = null;
      if (active) schedule();
    });
    return pending;
  }

  function visibilityChanged() {
    clearTimer();
    if (active && isVisible()) void refresh().catch(() => {});
  }

  return {
    refresh,
    visibilityChanged,
    start: visibilityChanged,
    stop() { active = false; clearTimer(); },
  };
}
