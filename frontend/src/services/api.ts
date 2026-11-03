import type { Tokens, User } from "@/types";

const BASE = `${(import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? ""}/api/v1`;
const STORAGE_KEY = "if-auth";

export class ApiError extends Error {
  status: number;
  detail: unknown;
  code?: string;
  /** True when the request never reached the server (offline, DNS, timeout). */
  network: boolean;

  constructor(status: number, message: string, detail?: unknown, network = false) {
    super(message);
    this.status = status;
    this.detail = detail;
    this.network = network;
    if (detail && typeof detail === "object" && "code" in (detail as Record<string, unknown>)) {
      this.code = String((detail as Record<string, unknown>).code);
    }
  }
}

interface Session {
  access_token: string;
  refresh_token: string;
  user: User | null;
}

let session: Session | null = loadSession();
const listeners = new Set<(s: Session | null) => void>();

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(s: Session | null) {
  session = s;
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode) - session lives in memory only */
  }
  listeners.forEach((l) => l(s));
}

export const auth = {
  get session() {
    return session;
  },
  subscribe(fn: (s: Session | null) => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  setTokens(t: Tokens, user: User | null = session?.user ?? null) {
    saveSession({ access_token: t.access_token, refresh_token: t.refresh_token, user });
  },
  setUser(user: User) {
    if (session) saveSession({ ...session, user });
  },
  clear() {
    saveSession(null);
  },
};

// Keep tabs in sync when the user logs in/out elsewhere.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      session = loadSession();
      listeners.forEach((l) => l(session));
    }
  });
}

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (!session?.refresh_token) return false;
  if (!refreshing) {
    const token = session.refresh_token;
    refreshing = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: token }),
        });
        if (!res.ok) {
          // Only sign out when the server definitively rejected the token.
          if (res.status === 401) auth.clear();
          return false;
        }
        auth.setTokens((await res.json()) as Tokens);
        return true;
      } catch {
        return false; // offline: keep the session, try again later
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  form?: FormData;
  raw?: boolean;
  signal?: AbortSignal;
  auth?: boolean;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = `${BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  });
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

function messageFrom(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "message" in detail) return String((detail as { message: unknown }).message);
  if (status >= 500) return "The server had a problem. Please try again.";
  return "Request failed";
}

export async function request<T = unknown>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.auth !== false && session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), { method: opts.method ?? "GET", headers, body, signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "You appear to be offline. Check your connection.", undefined, true);
  }
  if (res.status === 401 && opts.auth !== false && !retried && session?.refresh_token) {
    if (await refreshTokens()) return request<T>(path, opts, true);
  }
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = (await res.json()).detail;
    } catch {
      detail = undefined;
    }
    throw new ApiError(res.status, messageFrom(detail, res.status), detail);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"], signal?: AbortSignal) => request<T>(path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", form }),
  async blob(path: string, query?: RequestOptions["query"], body?: unknown): Promise<{ blob: Blob; filename: string | null }> {
    const res = await request<Response>(path, { query, raw: true, method: body ? "POST" : "GET", body });
    const cd = res.headers.get("Content-Disposition") ?? "";
    const m = /filename="?([^";]+)"?/.exec(cd);
    return { blob: await res.blob(), filename: m ? m[1] : null };
  },
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

/** Saves a blob to the device. Works on desktop browsers, Android and iOS Safari 13+. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function download(path: string, fallbackName: string, query?: RequestOptions["query"]) {
  const { blob, filename } = await api.blob(path, query);
  saveBlob(blob, filename ?? fallbackName);
}
