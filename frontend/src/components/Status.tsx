import { AlertTriangle, CheckCircle2, CloudOff, GitMerge, HardDrive, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, type Tone } from "@/components/ui";
import { useApp, useSyncCounts } from "@/hooks/useApp";
import type { SyncState } from "@/services/db";
import { cn } from "@/utils/cn";
import { STATUS_LABEL } from "@/utils/format";

const STATUS_TONE: Record<string, Tone> = {
  draft: "gray", sent: "blue", partially_paid: "amber", paid: "green", overdue: "red", cancelled: "gray",
  accepted: "green", declined: "red", expired: "amber", converted: "violet",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? "gray"} dot className={status === "cancelled" ? "line-through decoration-zinc-400" : undefined}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

/** The four user-facing sync states (plus conflict) are worded so nothing implies delivery. */
export const SYNC_META: Record<SyncState, { label: string; tone: Tone; icon: typeof HardDrive; help: string }> = {
  local: { label: "Saved locally", tone: "gray", icon: HardDrive, help: "Autosaved on this device only. Press Save to queue it for sync." },
  pending: { label: "Pending sync", tone: "amber", icon: CloudOff, help: "Saved on this device. It will be sent to the server when you're online." },
  syncing: { label: "Syncing…", tone: "blue", icon: Loader2, help: "Sending to the server now." },
  synced: { label: "Synced", tone: "green", icon: CheckCircle2, help: "The server confirmed it saved this version." },
  failed: { label: "Sync failed", tone: "red", icon: AlertTriangle, help: "The server did not save it. Review the error and retry." },
  conflict: { label: "Needs review", tone: "violet", icon: GitMerge, help: "This invoice changed on another device. Choose which version to keep." },
};

export function SyncBadge({ state }: { state: SyncState }) {
  const m = SYNC_META[state];
  const Icon = m.icon;
  return (
    <Badge tone={m.tone}>
      <Icon className={cn("h-3 w-3", state === "syncing" && "animate-spin")} aria-hidden />
      {m.label}
    </Badge>
  );
}

/** Compact connectivity + sync status shown in the app header. */
export function SyncIndicator({ compact = false }: { compact?: boolean }) {
  const { online, syncing } = useApp();
  const c = useSyncCounts();
  const attention = c.failed + c.conflict;
  const waiting = c.pending + c.local;

  let tone = "text-emerald-700 bg-emerald-50 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300";
  let Icon = Wifi;
  let label = "Online · all synced";
  if (!online) {
    tone = "text-amber-800 bg-amber-50 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300";
    Icon = WifiOff;
    label = waiting ? `Offline · ${waiting} saved on device` : "Offline";
  } else if (syncing) {
    tone = "text-sky-700 bg-sky-50 ring-sky-600/15 dark:bg-sky-500/10 dark:text-sky-300";
    Icon = RefreshCw;
    label = "Syncing…";
  } else if (attention) {
    tone = "text-red-700 bg-red-50 ring-red-600/15 dark:bg-red-500/10 dark:text-red-300";
    Icon = AlertTriangle;
    label = `${attention} need${attention === 1 ? "s" : ""} attention`;
  } else if (c.pending) {
    tone = "text-amber-800 bg-amber-50 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300";
    Icon = CloudOff;
    label = `${c.pending} pending sync`;
  } else if (c.local) {
    tone = "text-zinc-700 bg-zinc-100 ring-zinc-500/15 dark:bg-zinc-800 dark:text-zinc-300";
    Icon = HardDrive;
    label = `${c.local} saved locally`;
  }

  return (
    <Link
      to="/sync"
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 ring-inset transition-opacity hover:opacity-80", tone)}
      title="Open sync centre"
      aria-label={`Sync status: ${label}`}
      data-testid="sync-indicator"
    >
      <Icon className={cn("h-3.5 w-3.5", syncing && online && "animate-spin")} aria-hidden />
      <span className={cn(compact && "sr-only sm:not-sr-only")}>{label}</span>
    </Link>
  );
}

export function OfflineBanner() {
  const { online } = useApp();
  if (online) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-[13px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200" role="status">
      <WifiOff className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px" aria-hidden />
      You're offline. You can create and edit invoice drafts — they're saved on this device and will sync when you reconnect.
    </div>
  );
}
