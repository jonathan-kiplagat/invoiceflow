import { ArrowDownUp, Copy, Download, Eye, FileDown, FileText, MoreHorizontal, Pencil, Plus, Search, Trash2, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PaymentDialog, type PayableInvoice } from "@/components/PaymentDialog";
import { StatusBadge, SyncBadge } from "@/components/Status";
import { useToast } from "@/components/Toast";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, IconButton, Input, LoadingBlock, Menu, Notice, PageHeader, Pagination, Select } from "@/components/ui";
import { useApp } from "@/hooks/useApp";
import { useDebounced, useQuery } from "@/hooks/useQuery";
import { api, download, errorMessage } from "@/services/api";
import type { Invoice, InvoiceSummary, Page } from "@/types";
import { cn } from "@/utils/cn";
import { computeDocument, dec } from "@/utils/calc";
import { fmtDate, fmtDateTime, money } from "@/utils/format";

const FILTERS = [
  { value: "", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "unpaid", label: "Unpaid" },
  { value: "overdue", label: "Overdue" },
  { value: "partially_paid", label: "Part paid" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
];

const SORTS = [
  { value: "issue_date:desc", label: "Newest first" },
  { value: "issue_date:asc", label: "Oldest first" },
  { value: "due_date:asc", label: "Due soonest" },
  { value: "total:desc", label: "Highest amount" },
  { value: "balance_due:desc", label: "Largest balance" },
  { value: "number:desc", label: "Invoice number" },
];

export default function Invoices() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { localDocs } = useApp();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const q = useDebounced(search, 300);
  const status = params.get("status") ?? "";
  const sort = params.get("sort") ?? "issue_date:desc";
  const page = Number(params.get("page") ?? 1);
  const [sortField, order] = sort.split(":");
  const [paying, setPaying] = useState<PayableInvoice | null>(null);
  const [deleting, setDeleting] = useState<InvoiceSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== "page") next.delete("page");
    setParams(next, { replace: true });
  };

  const list = useQuery<Page<InvoiceSummary>>(
    (signal) => api.get("/invoices", { q, status, sort: sortField, order, page, page_size: 20 }, signal),
    [q, status, sortField, order, page],
    !q && !status && page === 1 && sort === "issue_date:desc" ? "invoices:list" : null,
  );

  const unsynced = useMemo(() => localDocs.filter((d) => d.kind === "invoice" && d.state !== "synced"), [localDocs]);

  const pdf = async (inv: InvoiceSummary) => {
    try {
      await download(`/invoices/${inv.id}/pdf`, `invoice-${inv.number}.pdf`, { download: true });
    } catch (e) {
      toast.error("Couldn't download PDF", errorMessage(e));
    }
  };
  const duplicate = async (inv: InvoiceSummary) => {
    try {
      const dup = await api.post<Invoice>(`/invoices/${inv.id}/duplicate`);
      toast.success("Invoice duplicated", `${dup.number} created as a draft`);
      navigate(`/invoices/${dup.id}/edit`);
    } catch (e) {
      toast.error("Couldn't duplicate", errorMessage(e));
    }
  };
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/invoices/${deleting.id}`);
      toast.success("Invoice deleted", deleting.number);
      setDeleting(null);
      void list.reload();
    } catch (e) {
      toast.error("Couldn't delete", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const exportCsv = async () => {
    try {
      await download("/invoices/export.csv", "invoices.csv", { q, status });
    } catch (e) {
      toast.error("Export failed", errorMessage(e));
    }
  };

  const actions = (inv: InvoiceSummary) => [
    { label: "View", icon: <Eye />, onClick: () => navigate(`/invoices/${inv.id}`) },
    { label: "Edit", icon: <Pencil />, onClick: () => navigate(`/invoices/${inv.id}/edit`), hidden: inv.status === "cancelled" },
    { label: "Record payment", icon: <Wallet />, onClick: () => setPaying(inv), hidden: !["sent", "partially_paid", "overdue"].includes(inv.status) },
    { label: "Download PDF", icon: <Download />, onClick: () => void pdf(inv) },
    { label: "Duplicate", icon: <Copy />, onClick: () => void duplicate(inv) },
    { label: "Delete", icon: <Trash2 />, onClick: () => setDeleting(inv), danger: true, hidden: dec(inv.amount_paid).gt(0) },
  ];

  const data = list.data;
  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Invoices"
        description="Search, filter and manage every invoice."
        actions={
          <>
            <Button variant="secondary" icon={<FileDown className="h-4 w-4" />} onClick={exportCsv}>Export CSV</Button>
            <Link to="/invoices/new"><Button icon={<Plus className="h-4 w-4" />}>New invoice</Button></Link>
          </>
        }
      />

      {unsynced.length > 0 && (
        <Card className="mb-4" padded={false}>
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-semibold">On this device, not yet on the server</h2>
            <Link to="/sync" className="text-[13px] font-medium text-brand-700 hover:underline dark:text-brand-300">Sync centre</Link>
          </div>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {unsynced.map((d) => {
              const { totals } = computeDocument(d.payload.items, d.payload.shipping, d.payload.pricing_mode);
              return (
                <li key={d.localId}>
                  <Link to={`/invoices/local/${d.localId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{d.label || "Untitled draft"}</p>
                      <p className="text-xs text-zinc-500">{d.number ?? "Number assigned on sync"} · edited {fmtDateTime(d.updatedAt)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="tnum text-sm font-medium">{money(totals.total.toFixed(2), d.payload.currency)}</span>
                      <SyncBadge state={d.state} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input
            type="search"
            placeholder="Search invoice number, customer or notes"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setParam("q", e.target.value);
            }}
            className="pl-9"
            aria-label="Search invoices"
          />
        </div>
        <div className="flex items-center gap-2">
          <ArrowDownUp className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
          <Select aria-label="Sort" value={sort} onChange={(e) => setParam("sort", e.target.value)} className="lg:w-48">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </div>
      </div>
      <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-1.5" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={status === f.value}
              onClick={() => setParam("status", f.value)}
              className={cn(
                "h-8 rounded-full px-3 text-[13px] font-medium transition-colors",
                status === f.value ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "bg-white text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {list.stale && <Notice tone="amber" className="mb-3">Offline — showing the list saved on {fmtDateTime(list.savedAt)}.</Notice>}

      <Card padded={false}>
        {list.error && !data ? (
          <div className="p-4"><ErrorState message={list.error} onRetry={list.reload} /></div>
        ) : !data ? (
          <div className="p-4"><LoadingBlock rows={6} /></div>
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title={q || status ? "No matching invoices" : "No invoices yet"}
            description={q || status ? "Try a different search or filter." : "Create your first invoice to get paid faster."}
            action={!q && !status ? <Link to="/invoices/new"><Button icon={<Plus className="h-4 w-4" />}>Create invoice</Button></Link> : undefined}
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                    <th className="px-4 py-3 font-medium">Invoice</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="hidden px-4 py-3 font-medium lg:table-cell">Issued</th>
                    <th className="px-4 py-3 font-medium">Due</th>
                    <th className="px-4 py-3 text-right font-medium">Total</th>
                    <th className="hidden px-4 py-3 text-right font-medium xl:table-cell">Paid</th>
                    <th className="px-4 py-3 text-right font-medium">Balance</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="w-12 px-2 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {data.items.map((inv) => (
                    <tr key={inv.id} className="group cursor-pointer hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30" onClick={() => navigate(`/invoices/${inv.id}`)}>
                      <td className="px-4 py-3 font-medium text-zinc-900 dark:text-white">{inv.number}</td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-zinc-600 dark:text-zinc-300">{inv.customer_name ?? <span className="text-zinc-400">—</span>}</td>
                      <td className="hidden px-4 py-3 text-zinc-500 lg:table-cell">{fmtDate(inv.issue_date)}</td>
                      <td className="px-4 py-3 text-zinc-500">{fmtDate(inv.due_date)}</td>
                      <td className="tnum px-4 py-3 text-right">{money(inv.total, inv.currency)}</td>
                      <td className="tnum hidden px-4 py-3 text-right text-zinc-500 xl:table-cell">{money(inv.amount_paid, inv.currency)}</td>
                      <td className="tnum px-4 py-3 text-right font-medium">{money(inv.balance_due, inv.currency)}</td>
                      <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                        <Menu items={actions(inv)} trigger={(p) => <IconButton label={`Actions for ${inv.number}`} {...p}><MoreHorizontal className="h-4 w-4" /></IconButton>} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <ul className="divide-y divide-zinc-100 md:hidden dark:divide-zinc-800">
              {data.items.map((inv) => (
                <li key={inv.id} className="flex items-start gap-2 px-4 py-3.5">
                  <Link to={`/invoices/${inv.id}`} className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-medium">{inv.customer_name ?? "No customer"}</p>
                      <p className="tnum shrink-0 font-semibold">{money(inv.balance_due, inv.currency)}</p>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="truncate text-[13px] text-zinc-500">{inv.number} · due {fmtDate(inv.due_date)}</p>
                      <StatusBadge status={inv.status} />
                    </div>
                    {dec(inv.amount_paid).gt(0) && inv.status !== "paid" && (
                      <p className="mt-1 text-xs text-zinc-500">
                        {money(inv.amount_paid, inv.currency)} paid of {money(inv.total, inv.currency)}
                      </p>
                    )}
                  </Link>
                  <Menu items={actions(inv)} trigger={(p) => <IconButton label={`Actions for ${inv.number}`} className="-mr-2 -mt-1" {...p}><MoreHorizontal className="h-5 w-5" /></IconButton>} />
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={20} total={data.total} onPage={(p) => setParam("page", String(p))} />
          </>
        )}
      </Card>
      {data && data.total > 0 && <p className="mt-3 text-center text-xs text-zinc-500"><Badge>{data.total}</Badge> invoice{data.total === 1 ? "" : "s"}</p>}

      <PaymentDialog invoice={paying} open={!!paying} onClose={() => setPaying(null)} onRecorded={() => void list.reload()} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        loading={busy}
        danger
        title="Delete invoice?"
        confirmLabel="Delete invoice"
        message={<>This permanently deletes <b>{deleting?.number}</b>. This can't be undone. Invoices with recorded payments can't be deleted — cancel them instead.</>}
      />
    </div>
  );
}
