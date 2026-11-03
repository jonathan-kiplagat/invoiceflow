import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, api, auth } from "@/services/api";
import { cache, outbox, requestPersistentStorage, type LocalDoc } from "@/services/db";
import { SyncEngine, type ServerDoc } from "@/services/sync";
import type { Business, DocKind, Meta, Tokens, User } from "@/types";
import { setDateFormat } from "@/utils/format";

type Theme = "light" | "dark" | "system";

interface AppState {
  user: User | null;
  ready: boolean;
  business: Business | null;
  businessStale: boolean;
  meta: Meta | null;
  online: boolean;
  theme: Theme;
  setTheme: (t: Theme) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { full_name: string; email: string; password: string; business_name: string }) => Promise<void>;
  logout: () => Promise<void>;
  setBusiness: (b: Business) => void;
  reloadBusiness: () => Promise<void>;
  engine: SyncEngine;
  localDocs: LocalDoc[];
  syncing: boolean;
  syncNow: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

const transport = {
  create: (kind: DocKind, payload: unknown) => api.post<ServerDoc>(kind === "invoice" ? "/invoices" : "/quotations", payload),
  update: (kind: DocKind, id: number, payload: unknown) => api.put<ServerDoc>(`/${kind === "invoice" ? "invoices" : "quotations"}/${id}`, payload),
  fetch: (kind: DocKind, id: number) => api.get<ServerDoc>(`/${kind === "invoice" ? "invoices" : "quotations"}/${id}`),
};

function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(auth.session?.user ?? null);
  const [ready, setReady] = useState(false);
  const [business, setBusinessState] = useState<Business | null>(null);
  const [businessStale, setBusinessStale] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem("if-theme") as Theme) || "system");
  const [localDocs, setLocalDocs] = useState<LocalDoc[]>([]);
  const [syncing, setSyncing] = useState(false);
  const userRef = useRef(user);
  userRef.current = user;

  const engine = useMemo(() => new SyncEngine(transport as never, () => userRef.current?.id ?? null), []);

  const refreshLocal = useCallback(async () => {
    const u = userRef.current;
    if (!u) return setLocalDocs([]);
    setLocalDocs(await outbox.all(u.id));
  }, []);

  useEffect(() => engine.subscribe(() => void refreshLocal()), [engine, refreshLocal]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      await engine.syncAll();
    } finally {
      setSyncing(false);
      void refreshLocal();
    }
  }, [engine, refreshLocal]);

  // Online/offline tracking + sync triggers (reconnect, app focus, periodic).
  useEffect(() => {
    const on = () => {
      setOnline(true);
      void syncNow();
    };
    const off = () => setOnline(false);
    const vis = () => document.visibilityState === "visible" && navigator.onLine && void syncNow();
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    document.addEventListener("visibilitychange", vis);
    const timer = setInterval(() => navigator.onLine && void syncNow(), 30_000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      document.removeEventListener("visibilitychange", vis);
      clearInterval(timer);
    };
  }, [syncNow]);

  useEffect(() => auth.subscribe((s) => setUser(s?.user ?? null)), []);

  useEffect(() => {
    applyTheme(theme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const fn = () => theme === "system" && applyTheme("system");
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [theme]);

  const setTheme = (t: Theme) => {
    try {
      localStorage.setItem("if-theme", t);
    } catch {
      /* ignore */
    }
    setThemeState(t);
  };

  const setBusiness = useCallback((b: Business) => {
    setBusinessState(b);
    setBusinessStale(false);
    setDateFormat(b.settings.date_format);
    const u = userRef.current;
    if (u) void cache.set(u.id, "business", b);
  }, []);

  const reloadBusiness = useCallback(async () => {
    const u = userRef.current;
    if (!u) return;
    try {
      setBusiness(await api.get<Business>("/business"));
    } catch (e) {
      if (e instanceof ApiError && e.network) {
        const cached = await cache.get<Business>(u.id, "business");
        if (cached) {
          setBusinessState(cached.value);
          setDateFormat(cached.value.settings.date_format);
          setBusinessStale(true);
        }
      } else throw e;
    }
  }, [setBusiness]);

  // Boot: validate session, load business + meta (falling back to the offline cache).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!auth.session) {
        setReady(true);
        return;
      }
      try {
        const me = await api.get<User>("/auth/me");
        if (cancelled) return;
        auth.setUser(me);
        setUser(me);
        userRef.current = me;
      } catch (e) {
        // Offline: trust the stored session so offline drafts remain usable.
        if (!(e instanceof ApiError && e.network)) {
          if (!cancelled) setReady(true);
          return;
        }
      }
      try {
        await reloadBusiness();
      } catch {
        /* surfaced on pages */
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    void refreshLocal();
    void requestPersistentStorage();
    void outbox.prune(user.id);
    api.get<Meta>("/meta").then(setMeta).catch(async () => {
      const cached = await cache.get<Meta>(user.id, "meta");
      if (cached) setMeta(cached.value);
    });
    if (navigator.onLine) void syncNow();
  }, [user, refreshLocal, syncNow]);

  useEffect(() => {
    if (meta && user) void cache.set(user.id, "meta", meta);
  }, [meta, user]);

  const finishAuth = async (tokens: Tokens) => {
    auth.setTokens(tokens, null);
    const me = await api.get<User>("/auth/me");
    auth.setUser(me);
    userRef.current = me;
    setUser(me);
    await reloadBusiness();
  };

  const value: AppState = {
    user,
    ready,
    business,
    businessStale,
    meta,
    online,
    theme,
    setTheme,
    engine,
    localDocs,
    syncing,
    syncNow,
    setBusiness,
    reloadBusiness,
    login: async (email, password) => finishAuth(await api.post<Tokens>("/auth/login", { email, password })),
    register: async (data) => finishAuth(await api.post<Tokens>("/auth/register", data)),
    logout: async () => {
      const rt = auth.session?.refresh_token;
      if (rt) await api.post("/auth/logout", { refresh_token: rt }).catch(() => undefined);
      auth.clear();
      setBusinessState(null);
      setLocalDocs([]);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp outside AppProvider");
  return ctx;
}

export function useSyncCounts() {
  const { localDocs } = useApp();
  return useMemo(() => {
    const c = { local: 0, pending: 0, failed: 0, conflict: 0, synced: 0 };
    for (const d of localDocs) {
      if (d.state === "syncing" || d.state === "pending") c.pending++;
      else c[d.state]++;
    }
    return c;
  }, [localDocs]);
}
