/**
 * IndexedDB persistence for offline work.
 *
 * - `outbox`: drafts created or edited on this device and their synchronisation state.
 * - `cache`:  last known server data (business settings, customers, invoices) for offline use.
 *
 * Every record carries the user id, so two accounts on one device never see each other's data.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { DocKind, DocumentInput } from "@/types";

export type SyncState =
  | "local" // autosaved on this device only (work in progress, not queued)
  | "pending" // saved on this device, waiting to be sent to the server
  | "syncing" // being sent right now
  | "synced" // the server confirmed it saved this version
  | "failed" // the server rejected it or kept failing; needs attention / retry
  | "conflict"; // the server copy changed on another device; user must choose

export interface LocalDoc {
  localId: string; // also the document's client_uuid for new documents
  userId: number;
  kind: DocKind;
  serverId: number | null;
  number: string | null;
  baseVersion: number | null; // server version this edit started from
  payload: DocumentInput;
  state: SyncState;
  error: string | null;
  retryable: boolean;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  syncedAt: number | null;
  serverCopy: unknown | null; // newer server version when in conflict
  label: string; // human label e.g. customer name
}

interface CacheEntry {
  key: string;
  value: unknown;
  savedAt: number;
}

interface Schema extends DBSchema {
  outbox: { key: string; value: LocalDoc; indexes: { byUser: number; byServer: [number, string, number] } };
  cache: { key: string; value: CacheEntry };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

export function getDb(): Promise<IDBPDatabase<Schema>> {
  if (!dbp) {
    dbp = openDB<Schema>("invoiceflow", 1, {
      upgrade(db) {
        const outbox = db.createObjectStore("outbox", { keyPath: "localId" });
        outbox.createIndex("byUser", "userId");
        outbox.createIndex("byServer", ["userId", "kind", "serverId"]);
        db.createObjectStore("cache", { keyPath: "key" });
      },
      blocking() {
        // A newer version of the app wants to upgrade the database.
        dbp?.then((d) => d.close());
        dbp = null;
      },
    });
  }
  return dbp;
}

export const outbox = {
  async all(userId: number): Promise<LocalDoc[]> {
    const db = await getDb();
    const rows = await db.getAllFromIndex("outbox", "byUser", userId);
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async get(localId: string): Promise<LocalDoc | undefined> {
    return (await getDb()).get("outbox", localId);
  },
  async forServer(userId: number, kind: DocKind, serverId: number): Promise<LocalDoc | undefined> {
    const db = await getDb();
    const rows = await db.getAllFromIndex("outbox", "byServer", [userId, kind, serverId]);
    return rows.find((r) => r.state !== "synced");
  },
  async put(doc: LocalDoc): Promise<void> {
    await (await getDb()).put("outbox", doc);
  },
  /** Atomic read-modify-write so concurrent syncs/edits never clobber each other. */
  async update(localId: string, fn: (d: LocalDoc) => LocalDoc | null): Promise<LocalDoc | null> {
    const db = await getDb();
    const tx = db.transaction("outbox", "readwrite");
    const cur = await tx.store.get(localId);
    if (!cur) {
      await tx.done;
      return null;
    }
    const next = fn(cur);
    if (next) await tx.store.put(next);
    else await tx.store.delete(localId);
    await tx.done;
    return next;
  },
  async remove(localId: string): Promise<void> {
    await (await getDb()).delete("outbox", localId);
  },
  async prune(userId: number, olderThanMs = 24 * 3600 * 1000): Promise<void> {
    const db = await getDb();
    const rows = await db.getAllFromIndex("outbox", "byUser", userId);
    const cutoff = Date.now() - olderThanMs;
    await Promise.all(rows.filter((r) => r.state === "synced" && (r.syncedAt ?? 0) < cutoff).map((r) => db.delete("outbox", r.localId)));
  },
};

export const cache = {
  async get<T>(userId: number, key: string): Promise<{ value: T; savedAt: number } | null> {
    const row = await (await getDb()).get("cache", `${userId}:${key}`);
    return row ? { value: row.value as T, savedAt: row.savedAt } : null;
  },
  async set(userId: number, key: string, value: unknown): Promise<void> {
    await (await getDb()).put("cache", { key: `${userId}:${key}`, value, savedAt: Date.now() });
  },
  async del(userId: number, key: string): Promise<void> {
    await (await getDb()).delete("cache", `${userId}:${key}`);
  },
};

/** Ask the browser not to evict offline data under storage pressure (best effort). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) return await navigator.storage.persist();
    return true;
  } catch {
    return false;
  }
}
