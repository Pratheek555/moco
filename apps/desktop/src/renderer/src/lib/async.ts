import { useEffect, useState } from "react";

/** Runs `fn` when `deps` change (or on reload()) and keeps its latest result. */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[],
): { data: T | null; error: string; reload: () => void } {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setError("");
    fn()
      .then((v) => {
        if (alive) setData(v);
      })
      .catch((e) => {
        if (alive) setError(String(e.message ?? e));
      });
    return () => {
      alive = false;
    };
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((v) => v + 1) };
}
