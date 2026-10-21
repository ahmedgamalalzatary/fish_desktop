import { useCallback, useEffect, useState } from "react";
import { errorMessage, useToast } from "./toast";

/**
 * Loads data with `fetcher` (which must be stable, e.g. from useCallback) and re-runs it on `reload()`.
 * Load failures are shown as a toast.
 */
export function useResource<T>(fetcher: () => Promise<T>): [T | null, () => void] {
  const toast = useToast();
  const [data, setData] = useState<T | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    fetcher().then(
      (result) => current && setData(result),
      (e) => current && toast(errorMessage(e), "error"),
    );
    return () => {
      current = false;
    };
  }, [fetcher, version, toast]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return [data, reload];
}
