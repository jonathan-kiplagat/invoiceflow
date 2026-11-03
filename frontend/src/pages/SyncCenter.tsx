import { CheckCircle2, CloudOff, Copy, GitMerge, RefreshCw, Server, Trash2, Wifi, WifiOff } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { SYNC_META, SyncBadge } from "@/components/Status";
import { useToast } from "@/components/Toast";
import { Button, Card, CardHeader, ConfirmDialog, EmptyState, Modal, Notice, PageHeader } from "@/components/ui";
import { useApp, useSyncCounts } from "@/hooks/useApp";
import type { LocalDoc, SyncState } from "@/services/db";
import type { Dec } from "@/types";
import { computeDocument } from "@/utils/calc";
import { fmtDateTime, money, relativeTime } from "@/utils/format";

const ORDER: SyncState[] = ["conflict", "failed", "pending", "syncing", "local", "synced"];

function total(d: LocalDoc) {
  return computeDocument(d.payload.items, d.payload.shipping, d.payload.pricing_mode).totals.total;
}

function ConflictDialog({ doc, onClose }: { doc: LocalDoc | null; onClose: () => void }) {
  const { engine } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  if (!doc) return null;
  const server = doc.serverCopy as { version: number; total: Dec; currency: string; updated_at: string; notes: string | null; items: unknown[]; customer_snapshot: { name?: string } | null } | null;
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      onClose();
    } finally {
      setBusy(null);
    }
  };
  const path = doc.kind === "invoice" ? "invoices" : "quotations";
  return (
    <>
      <Modal open={!!doc} onClose={onClose} title="This document changed on another device" description={`${doc.number ?? "Draft"} — choose which version to keep. Nothing has been overwritten.`} size="lg">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Server className="h-4 w-4 text-sky-600" /> Server version</p>
            {server ? (
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-zinc-500">Customer</dt><dd className="truncate">{server.customer_snapshot?.name ?? "—"}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-zinc-500">Items</dt><dd>{server.items.length}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-zinc-500">Total</dt><dd className="tnum font-medium">{money(server.total, server.currency)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-zinc-500">Last changed</dt><dd>{fmtDateTime(server.updated_at)}</dd></div>
              </dl>
            ) : (
              <p className="text-sm text-zinc-500">Couldn't load the server copy right now.</p>
            )}
            {doc.serverId && <Link to={`/${path}/${doc.serverId}`} className="mt-2 inline-block text-[13px] font-medium text-brand-700 hover:underline" onClick={onClose}>Open server version</Link>}
          </div>
          <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 dark:border-brand-900 dark:bg-brand-950/20">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><GitMerge className="h-4 w-4 text-brand-600" /> Your version (this device)</p>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-zinc-500">Customer</dt><dd className="truncate">{doc.label || "—"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-zinc-500">Items</dt><dd>{doc.payload.items.length}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-zinc-500">Total</dt><dd className="tnum font-medium">{money(total(doc), doc.payload.currency)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-zinc-500">Edited</dt><dd>{fmtDateTime(doc.updatedAt)}</dd></div>
            </dl>
          </div>
        </div>
        <div className="mt-5 space-y-2">
          <Button variant="secondary" className="w-full justify-start" icon={<Server className="h-4 w-4" />} loading={busy === "keep"} onClick={() => void run("keep", () => engine.resolveKeepServer(doc.localId), "Kept the server version")}>
            Keep the server version — discard my changes
          </Button>
          <Button variant="secondary" className="w-full justify-start" icon={<Copy className="h-4 w-4" />} loading={busy === "copy"} onClick={() => void run("copy", () => engine.resolveSaveAsCopy(doc.localId), "Saved your version as a new draft")}>
            Keep both — save my version as a new draft
          </Button>
          <Button variant="danger" className="w-full justify-start" icon={<GitMerge className="h-4 w-4" />} onClick={() => setConfirmOverwrite(true)}>
            Replace the server version with mine
          </Button>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmOverwrite}
        onClose={() => setConfirmOverwrite(false)}
        danger
        loading={busy === "overwrite"}
        title="Overwrite the newer server version?"
        confirmLabel="Overwrite"
        message="The changes made on the other device will be lost. Recorded payments are never affected."
        onConfirm={() => void run("overwrite", () => engine.resolveOverwrite(doc.localId), "Your version was saved to the server").finally(() => setConfirmOverwrite(false))}
      />
    </>
  );
}

export default function SyncCenter() {
  const { localDocs, online, syncing, syncNow, engine } = useApp();
  const counts = useSyncCounts();
  const toast = useToast();
  const [conflict, setConflict] = useState<LocalDoc | null>(null);
  const [discarding, setDiscarding] = useState<LocalDoc | null>(null);
  const sorted = [...localDocs].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || b.updatedAt - a.updatedAt);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Offline & sync"
        description="Drafts saved on this device and whether the server has them yet."
        actions={<Button icon={<RefreshCw className={syncing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />} onClick={() => void syncNow()} disabled={!online || syncing}>Sync now</Button>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <p className="flex items-center gap-2 text-[13px] text-zinc-500">{online ? <Wifi className="h-4 w-4 text-emerald-600" /> : <WifiOff className="h-4 w-4 text-amber-600" />} Connection</p>
          <p className="mt-1 text-lg font-semibold">{online ? "Online" : "Offline"}</p>
        </Card>
        <Card><p className="text-[13px] text-zinc-500">Saved locally</p><p className="mt-1 text-lg font-semibold">{counts.local}</p></Card>
        <Card><p className="text-[13px] text-zinc-500">Pending sync</p><p className="mt-1 text-lg font-semibold text-amber-700 dark:text-amber-300">{counts.pending}</p></Card>
        <Card><p className="text-[13px] text-zinc-500">Need attention</p><p className="mt-1 text-lg font-semibold text-red-600">{counts.failed + counts.conflict}</p></Card>
      </div>

      <Card className="mb-5">
        <CardHeader title="What the labels mean" />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(["local", "pending", "synced", "failed", "conflict"] as SyncState[]).map((s) => (
            <li key={s} className="text-sm">
              <SyncBadge state={s} />
              <p className="mt-1 text-[13px] text-zinc-500">{SYNC_META[s].help}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-zinc-500">“Synced” means the InvoiceFlow server stored it. It does not mean the invoice was sent to or received by your customer.</p>
      </Card>

      <Card padded={false}>
        {sorted.length === 0 ? (
          <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Everything is on the server" description="Drafts you create or edit offline will appear here until they sync." />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sorted.map((d) => {
              const path = d.kind === "invoice" ? "invoices" : "quotations";
              return (
                <li key={d.localId} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <SyncBadge state={d.state} />
                      <span className="text-xs uppercase tracking-wide text-zinc-400">{d.kind}</span>
                    </div>
                    <p className="mt-1 truncate text-sm font-medium">{d.number ?? "New — number assigned on sync"} · {d.label || "No customer"}</p>
                    <p className="text-xs text-zinc-500">
                      {money(total(d), d.payload.currency)} · edited {relativeTime(d.updatedAt)}
                      {d.syncedAt && d.state === "synced" ? ` · synced ${relativeTime(d.syncedAt)}` : ""}
                      {d.state === "pending" && d.attempts > 0 && d.nextAttemptAt > Date.now() ? ` · next try ${relativeTime(d.nextAttemptAt).replace(" ago", "")}` : ""}
                    </p>
                    {d.error && d.state !== "synced" && <p className="mt-1 text-[13px] text-red-600 dark:text-red-400">{d.error}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {d.state === "synced" && d.serverId ? (
                      <Link to={`/${path}/${d.serverId}`}><Button variant="secondary" size="sm">Open</Button></Link>
                    ) : (
                      <Link to={`/${path}/local/${d.localId}`}><Button variant="secondary" size="sm">Edit</Button></Link>
                    )}
                    {d.state === "conflict" && <Button size="sm" icon={<GitMerge className="h-4 w-4" />} onClick={() => setConflict(d)}>Resolve</Button>}
                    {(d.state === "failed" || d.state === "pending" || d.state === "local") && (
                      <Button size="sm" icon={<RefreshCw className="h-4 w-4" />} disabled={!online} onClick={async () => { await engine.retry(d.localId); toast.info(d.state === "local" ? "Queued for sync" : "Retrying…"); }}>
                        {d.state === "local" ? "Sync" : "Retry"}
                      </Button>
                    )}
                    {d.state !== "syncing" && (
                      <Button variant="ghost" size="sm" className="text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDiscarding(d)}>
                        {d.state === "synced" ? "Clear" : "Discard"}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {!online && counts.pending > 0 && <Notice tone="amber" className="mt-4" icon={<CloudOff className="h-4 w-4" />}>Pending drafts upload automatically when this device reconnects and InvoiceFlow is open.</Notice>}

      <ConflictDialog doc={conflict} onClose={() => setConflict(null)} />
      <ConfirmDialog
        open={!!discarding}
        onClose={() => setDiscarding(null)}
        danger={discarding?.state !== "synced"}
        title={discarding?.state === "synced" ? "Clear from this list?" : "Discard these changes?"}
        confirmLabel={discarding?.state === "synced" ? "Clear" : "Discard"}
        message={discarding?.state === "synced" ? "The server already has this version; this only tidies the list." : "These changes exist only on this device and will be lost. The server copy (if any) is not affected."}
        onConfirm={async () => {
          if (discarding) await engine.discard(discarding.localId);
          setDiscarding(null);
        }}
      />
    </div>
  );
}
