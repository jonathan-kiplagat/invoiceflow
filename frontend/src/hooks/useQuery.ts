import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "@/services/api";
import { cache } from "@/services/db";
import { useApp } from "@/hooks/useApp";

interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Data came from this device's offline cache because the server was unreachable. */
  stale: boolean;
  savedAt: number | null;
  reload: () => Promise<void>;
  setData: (d: T) => void;
}

/**
 * Small data-fetching hook. With `cacheKey`, successful responses are stored in IndexedDB
 * and served (clearly flagged as stale) when the device is offline.
 */
export function useQuery<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: unknown[], cacheKey?: string | null): QueryState<T> {
  const { user } = useApp();
  const [data, setDataState] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current(c.signal);
      if (c.signal.aborted) return;
      setDataState(result);
      setStale(false);
      setSavedAt(Date.now());
      if (cacheKey && user) void cache.set(user.id, cacheKey, result);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      if (e instanceof ApiError && e.network && cacheKey && user) {
        const cached = await cache.get<T>(user.id, cacheKey);
        if (cached) {
          setDataState(cached.value);
          setStale(true);
          setSavedAt(cached.savedAt);
          setLoading(false);
          return;
        }
      }
      setError(errorMessage(e));
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, user?.id, ...deps]);

  useEffect(() => {
    void load();
    return () => ctrl.current?.abort();
  }, [load]);

  const setData = useCallback(
    (d: T) => {
      setDataState(d);
      if (cacheKey && user) void cache.set(user.id, cacheKey, d);
    },
    [cacheKey, user],
  );

  return { data, loading, error, stale, savedAt, reload: load, setData };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setMatch(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [query]);
  return match;
}
