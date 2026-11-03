/**
 * Offline-first synchronisation engine for invoice and quotation drafts.
 *
 * Guarantees
 *  - Nothing is reported as synchronised until the server answered successfully.
 *  - Creating is idempotent: each local draft has a stable client_uuid, so a retry after a
 *    lost response returns the same server document instead of a duplicate.
 *  - Editing uses optimistic concurrency (base version). If the server copy changed on
 *    another device the draft moves to "conflict" and nothing is overwritten until the user
 *    explicitly chooses what to do.
 *  - Transient failures (offline, timeouts, 5xx) retry with exponential backoff; validation
 *    errors stop and wait for the user to fix the draft.
 */
import { ApiError } from "@/services/api";
import { outbox, type LocalDoc } from "@/services/db";
import type { DocKind, DocumentInput } from "@/types";
import { uuid } from "@/utils/cn";

export interface ServerDoc {
  id: number;
  number: string;
  version: number;
  [k: string]: unknown;
}

export interface Transport {
  create(kind: DocKind, payload: DocumentInput): Promise<ServerDoc>;
  update(kind: DocKind, id: number, payload: DocumentInput): Promise<ServerDoc>;
  fetch(kind: DocKind, id: number): Promise<ServerDoc>;
}

export interface SyncResult {
  attempted: number;
  synced: number;
  failed: number;
  conflicts: number;
}

const MAX_AUTO_ATTEMPTS = 6;

export function backoffMs(attempts: number): number {
  return Math.min(5 * 60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
}

export function newLocalDoc(userId: number, kind: DocKind, payload: DocumentInput, opts: Partial<LocalDoc> = {}): LocalDoc {
  const now = Date.now();
  return {
    localId: payload.client_uuid,
    userId,
    kind,
    serverId: null,
    number: null,
    baseVersion: null,
    payload,
    state: "local",
    error: null,
    retryable: true,
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: now,
    updatedAt: now,
    syncedAt: null,
    serverCopy: null,
    label: "",
    ...opts,
  };
}

type Listener = () => void;

export class SyncEngine {
  private running: Promise<SyncResult> | null = null;
  private listeners = new Set<Listener>();
  private channel: BroadcastChannel | null = null;

  constructor(
    private transport: Transport,
    private getUserId: () => number | null,
    private isOnline: () => boolean = () => (typeof navigator === "undefined" ? true : navigator.onLine),
  ) {
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel("invoiceflow-sync");
      this.channel.onmessage = () => this.listeners.forEach((l) => l());
    }
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    this.listeners.forEach((l) => l());
    this.channel?.postMessage("changed");
  }

  /** Save a draft on this device. `queue` = also send it to the server (Save), otherwise autosave only. */
  async saveLocal(doc: LocalDoc, queue: boolean): Promise<LocalDoc> {
    const payload = { ...doc.payload, client_revision: uuid() };
    const next: LocalDoc = {
      ...doc,
      payload,
      state: queue ? "pending" : doc.state === "pending" || doc.state === "failed" ? doc.state : "local",
      error: queue ? null : doc.error,
      retryable: true,
      attempts: queue ? 0 : doc.attempts,
      nextAttemptAt: 0,
      updatedAt: Date.now(),
    };
    if (doc.state === "conflict" && !queue) next.state = "conflict";
    await outbox.put(next);
    this.emit();
    return next;
  }

  async discard(localId: string) {
    await outbox.remove(localId);
    this.emit();
  }

  async retry(localId: string) {
    await outbox.update(localId, (d) => ({ ...d, state: "pending", error: null, retryable: true, attempts: 0, nextAttemptAt: 0 }));
    this.emit();
    return this.syncAll();
  }

  /** Conflict resolution: keep the server version and drop the local edits. */
  async resolveKeepServer(localId: string) {
    await this.discard(localId);
  }

  /** Conflict resolution: user explicitly chose to replace the newer server copy. */
  async resolveOverwrite(localId: string) {
    await outbox.update(localId, (d) => {
      const server = d.serverCopy as ServerDoc | null;
      return {
        ...d,
        baseVersion: server?.version ?? d.baseVersion,
        payload: { ...d.payload, force_overwrite: true, client_revision: uuid() },
        state: "pending",
        error: null,
        attempts: 0,
        nextAttemptAt: 0,
        serverCopy: null,
      };
    });
    this.emit();
    return this.syncAll();
  }

  /** Conflict resolution: keep both by saving the local edits as a brand-new draft. */
  async resolveSaveAsCopy(localId: string) {
    const d = await outbox.get(localId);
    if (!d) return;
    const id = uuid();
    const copy = newLocalDoc(d.userId, d.kind, { ...d.payload, client_uuid: id, version: undefined, force_overwrite: false, status: "draft" }, {
      label: d.label,
      state: "pending",
    });
    await outbox.put(copy);
    await outbox.remove(localId);
    this.emit();
    return this.syncAll();
  }

  /** Push every due draft. Concurrent calls share one run. */
  syncAll(): Promise<SyncResult> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async run(): Promise<SyncResult> {
    const result: SyncResult = { attempted: 0, synced: 0, failed: 0, conflicts: 0 };
    const userId = this.getUserId();
    if (userId == null || !this.isOnline()) return result;
    const now = Date.now();
    const due = (await outbox.all(userId))
      .filter((d) => (d.state === "pending" || (d.state === "failed" && d.retryable && d.attempts < MAX_AUTO_ATTEMPTS)) && d.nextAttemptAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const d of due) {
      result.attempted++;
      const outcome = await this.syncOne(d.localId);
      if (outcome === "synced") result.synced++;
      else if (outcome === "conflict") result.conflicts++;
      else if (outcome === "failed") result.failed++;
      else if (outcome === "offline" || outcome === "auth") break;
    }
    return result;
  }

  private async syncOne(localId: string): Promise<"synced" | "conflict" | "failed" | "offline" | "auth" | "skipped"> {
    const claimed = await outbox.update(localId, (d) => (d.state === "pending" || d.state === "failed" ? { ...d, state: "syncing" } : d));
    if (!claimed || claimed.state !== "syncing") return "skipped";
    this.emit();
    const sentRevision = claimed.payload.client_revision;
    try {
      let server: ServerDoc;
      if (claimed.serverId == null) {
        server = await this.transport.create(claimed.kind, { ...claimed.payload, client_uuid: claimed.localId });
      } else {
        server = await this.transport.update(claimed.kind, claimed.serverId, { ...claimed.payload, version: claimed.baseVersion ?? 1 });
      }
      await outbox.update(localId, (d) => {
        // If the user edited the draft while it was uploading, keep the newer edit queued.
        const editedMeanwhile = d.payload.client_revision !== sentRevision;
        return {
          ...d,
          serverId: server.id,
          number: server.number,
          baseVersion: server.version,
          state: editedMeanwhile ? "pending" : "synced",
          syncedAt: editedMeanwhile ? d.syncedAt : Date.now(),
          error: null,
          attempts: 0,
          nextAttemptAt: 0,
          serverCopy: null,
          payload: { ...d.payload, force_overwrite: false },
        };
      });
      this.emit();
      return "synced";
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, (e as Error)?.message ?? "Sync failed", undefined, true);
      if (err.status === 409 && err.code === "version_conflict" && claimed.serverId != null) {
        let serverCopy: ServerDoc | null = null;
        try {
          serverCopy = await this.transport.fetch(claimed.kind, claimed.serverId);
        } catch {
          /* keep null; the UI can still offer the choices */
        }
        await outbox.update(localId, (d) => ({ ...d, state: "conflict", error: "Changed on another device", retryable: false, serverCopy }));
        this.emit();
        return "conflict";
      }
      if (err.status === 401) {
        await outbox.update(localId, (d) => ({ ...d, state: "pending", error: "Sign in again to sync" }));
        this.emit();
        return "auth";
      }
      if (err.network) {
        // Still safely stored on this device; just waiting for the network.
        await outbox.update(localId, (d) => ({ ...d, state: "pending", error: null, attempts: d.attempts + 1, nextAttemptAt: Date.now() + backoffMs(d.attempts + 1) }));
        this.emit();
        return "offline";
      }
      const retryable = err.status >= 500 || err.status === 429 || err.status === 408;
      await outbox.update(localId, (d) => ({
        ...d,
        state: "failed",
        error: err.message,
        retryable,
        attempts: d.attempts + 1,
        nextAttemptAt: Date.now() + backoffMs(d.attempts + 1),
      }));
      this.emit();
      return "failed";
    }
  }
}
