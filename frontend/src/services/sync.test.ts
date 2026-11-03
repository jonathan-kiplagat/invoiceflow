import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { outbox } from "./db";
import { newLocalDoc, SyncEngine, type ServerDoc, type Transport } from "./sync";
import type { DocKind, DocumentInput } from "@/types";

/** In-memory fake of the server's idempotency + optimistic-concurrency rules. */
class FakeServer implements Transport {
  docs = new Map<number, ServerDoc & { client_uuid: string; last_rev?: string; notes?: string | null }>();
  nextId = 1;
  offline = false;
  failNext: number | null = null;
  loseResponse = false;
  calls = 0;

  private guard() {
    this.calls++;
    if (this.offline) throw new ApiError(0, "offline", undefined, true);
    if (this.failNext) {
      const s = this.failNext;
      this.failNext = null;
      throw new ApiError(s, s === 422 ? "Due date cannot be before the issue date" : "Server error");
    }
  }

  async create(_k: DocKind, p: DocumentInput): Promise<ServerDoc> {
    this.guard();
    const existing = [...this.docs.values()].find((d) => d.client_uuid === p.client_uuid);
    if (existing) return existing;
    const id = this.nextId++;
    const doc = { id, number: `INV-${id}`, version: 1, client_uuid: p.client_uuid, last_rev: p.client_revision, notes: p.notes };
    this.docs.set(id, doc);
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new ApiError(0, "connection dropped", undefined, true);
    }
    return doc;
  }

  async update(_k: DocKind, id: number, p: DocumentInput): Promise<ServerDoc> {
    this.guard();
    const d = this.docs.get(id)!;
    if (d.version !== p.version) {
      if (p.client_revision && d.last_rev === p.client_revision) return d;
      if (!p.force_overwrite) throw new ApiError(409, "conflict", { code: "version_conflict" });
    }
    const next = { ...d, version: d.version + 1, last_rev: p.client_revision, notes: p.notes };
    this.docs.set(id, next);
    return next;
  }

  async fetch(_k: DocKind, id: number): Promise<ServerDoc> {
    this.guard();
    return this.docs.get(id)!;
  }
}

let n = 0;
function payload(notes = "hello"): DocumentInput {
  return {
    client_uuid: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    customer_id: null, issue_date: "2026-11-03", due_date: "2026-11-17", currency: "KES",
    pricing_mode: "exclusive", template: "modern", notes, terms: null, payment_instructions: null,
    shipping: "0", items: [{ description: "x", quantity: "1", unit_price: "100", discount_type: "percent", discount_value: "0", tax_rate_id: null, tax_name: null, tax_rate: "16" }],
  };
}

const USER = 7;
let server: FakeServer;
let online: boolean;
let engine: SyncEngine;

beforeEach(async () => {
  for (const d of await outbox.all(USER)) await outbox.remove(d.localId);
  server = new FakeServer();
  online = true;
  engine = new SyncEngine(server, () => USER, () => online);
});

describe("offline drafts", () => {
  it("stays 'local' when only autosaved and is never sent", async () => {
    await engine.saveLocal(newLocalDoc(USER, "invoice", payload()), false);
    await engine.syncAll();
    expect(server.calls).toBe(0);
    expect((await outbox.all(USER))[0].state).toBe("local");
  });

  it("is pending while offline, then synced when connectivity returns", async () => {
    online = false;
    const d = await engine.saveLocal(newLocalDoc(USER, "invoice", payload()), true);
    await engine.syncAll();
    expect((await outbox.get(d.localId))!.state).toBe("pending");
    expect(server.calls).toBe(0);
    online = true;
    await engine.syncAll();
    const after = (await outbox.get(d.localId))!;
    expect(after.state).toBe("synced");
    expect(after.serverId).toBe(1);
    expect(after.number).toBe("INV-1");
  });

  it("network failure mid-request keeps it pending (not synced, not failed)", async () => {
    server.offline = true;
    const d = await engine.saveLocal(newLocalDoc(USER, "invoice", payload()), true);
    await engine.syncAll();
    const after = (await outbox.get(d.localId))!;
    expect(after.state).toBe("pending");
    expect(after.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it("does not create duplicates when a response is lost and the request retried", async () => {
    server.loseResponse = true;
    const d = await engine.saveLocal(newLocalDoc(USER, "invoice", payload()), true);
    await engine.syncAll();
    expect((await outbox.get(d.localId))!.state).toBe("pending");
    await engine.retry(d.localId);
    expect((await outbox.get(d.localId))!.state).toBe("synced");
    expect(server.docs.size).toBe(1);
  });

  it("concurrent sync runs don't double-submit", async () => {
    await engine.saveLocal(newLocalDoc(USER, "invoice", payload()), true);
    await Promise.all([engine.syncAll(), engine.syncAll(), engine.syncAll()]);
    expect(server.docs.size).toBe(1);
    expect(server.calls).toBe(1);
  });

  it("validation errors become 'failed' and wait for the user; server errors retry", async () => {
    server.failNext = 422;
    const d = await engine.saveLocal(newLocalDoc(USER, "invoice", payload()), true);
    await engine.syncAll();
    let after = (await outbox.get(d.localId))!;
    expect(after.state).toBe("failed");
    expect(after.retryable).toBe(false);
    expect(after.error).toContain("Due date");
    await engine.syncAll(); // not auto-retried
    expect(server.calls).toBe(1);
    await engine.retry(d.localId); // explicit retry works
    after = (await outbox.get(d.localId))!;
    expect(after.state).toBe("synced");

    server.failNext = 503;
    const e = await engine.saveLocal(newLocalDoc(USER, "invoice", payload()), true);
    await engine.syncAll();
    expect((await outbox.get(e.localId))!.retryable).toBe(true);
  });
});

describe("conflicts", () => {
  async function syncedDoc() {
    const d = await engine.saveLocal(newLocalDoc(USER, "invoice", payload("v1")), true);
    await engine.syncAll();
    return (await outbox.get(d.localId))!;
  }

  it("detects a newer server version and never overwrites it silently", async () => {
    const synced = await syncedDoc();
    // Another device edits the invoice on the server.
    const s = server.docs.get(synced.serverId!)!;
    server.docs.set(s.id, { ...s, version: 2, notes: "from phone" });
    // This device edits its (older) copy.
    const edit = newLocalDoc(USER, "invoice", { ...synced.payload, notes: "from laptop" }, { localId: "edit-1", serverId: synced.serverId, baseVersion: 1 });
    await engine.saveLocal(edit, true);
    await engine.syncAll();
    const after = (await outbox.get("edit-1"))!;
    expect(after.state).toBe("conflict");
    expect((after.serverCopy as { notes: string }).notes).toBe("from phone");
    expect(server.docs.get(s.id)!.notes).toBe("from phone");
  });

  it("overwrite only happens when the user explicitly chooses it", async () => {
    const synced = await syncedDoc();
    const s = server.docs.get(synced.serverId!)!;
    server.docs.set(s.id, { ...s, version: 2, notes: "from phone" });
    await engine.saveLocal(newLocalDoc(USER, "invoice", { ...synced.payload, notes: "from laptop" }, { localId: "edit-2", serverId: synced.serverId, baseVersion: 1 }), true);
    await engine.syncAll();
    await engine.resolveOverwrite("edit-2");
    expect((await outbox.get("edit-2"))!.state).toBe("synced");
    expect(server.docs.get(s.id)!.notes).toBe("from laptop");
  });

  it("save-as-copy keeps both versions", async () => {
    const synced = await syncedDoc();
    const s = server.docs.get(synced.serverId!)!;
    server.docs.set(s.id, { ...s, version: 2, notes: "from phone" });
    await engine.saveLocal(newLocalDoc(USER, "invoice", { ...synced.payload, notes: "from laptop" }, { localId: "edit-3", serverId: synced.serverId, baseVersion: 1 }), true);
    await engine.syncAll();
    await engine.resolveSaveAsCopy("edit-3");
    expect(server.docs.size).toBe(2);
    expect(server.docs.get(s.id)!.notes).toBe("from phone");
    expect([...server.docs.values()].some((d) => d.notes === "from laptop")).toBe(true);
  });
});
