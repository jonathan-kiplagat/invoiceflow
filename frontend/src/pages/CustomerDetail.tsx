import { Archive, ArchiveRestore, ArrowLeft, FileDown, FileText, Mail, MapPin, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CustomerForm } from "@/components/CustomerForm";
import { StatusBadge } from "@/components/Status";
import { useToast } from "@/components/Toast";
import { Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, LoadingBlock, Notice } from "@/components/ui";
import { useApp } from "@/hooks/useApp";
import { useQuery } from "@/hooks/useQuery";
import { api, download, errorMessage } from "@/services/api";
import type { Customer, InvoiceSummary } from "@/types";
import { fmtDate, money } from "@/utils/format";
import { formatPhone } from "@/utils/phone";

interface Detail {
  customer: Customer;
  totals: { currency: string; invoice_count: number; total_invoiced: string; total_paid: string; outstanding: string }[];
}

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { online } = useApp();
  const q = useQuery<Detail>((s) => api.get(`/customers/${id}`, undefined, s), [id], `customer:${id}`);
  const history = useQuery<InvoiceSummary[]>((s) => api.get(`/customers/${id}/invoices`, undefined, s), [id], `customer:${id}:invoices`);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  if (q.error && !q.data) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!q.data) return <LoadingBlock rows={6} />;
  const c = q.data.customer;

  const setArchived = async (v: boolean) => {
    try {
      const updated = await api.put<Customer>(`/customers/${c.id}`, { ...c, is_archived: v });
      q.setData({ ...q.data!, customer: updated });
      toast.success(v ? "Customer archived" : "Customer restored");
    } catch (e) {
      toast.error("Couldn't update", errorMessage(e));
    }
  };

  return (
    <div className="animate-fade-in">
      <Link to="/customers" className="mb-2 inline-flex items-center gap-1 text-[13px] font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        <ArrowLeft className="h-4 w-4" /> Customers
      </Link>
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-lg font-semibold text-brand-800 dark:bg-brand-500/10 dark:text-brand-200">{c.name.slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-semibold tracking-tight">{c.name}</h1>
            <p className="text-sm text-zinc-500">{c.company ?? "Individual"}{c.is_archived ? " · Archived" : ""}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)} disabled={!online}>Edit</Button>
          <Button variant="secondary" icon={<FileDown className="h-4 w-4" />} disabled={!online} onClick={() => void download(`/customers/${c.id}/statement.pdf`, "statement.pdf", { currency: q.data!.totals[0]?.currency }).catch((e) => toast.error("Couldn't create statement", errorMessage(e)))}>
            Statement
          </Button>
          <Link to="/invoices/new"><Button icon={<Plus className="h-4 w-4" />}>New invoice</Button></Link>
        </div>
      </div>
      {q.stale && <Notice tone="amber" className="mb-4">Offline copy — changes need a connection.</Notice>}

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          {q.data.totals.map((t) => (
            <Card key={t.currency}>
              <p className="text-[13px] text-zinc-500">Outstanding ({t.currency})</p>
              <p className="tnum mt-1 text-2xl font-semibold">{money(t.outstanding, t.currency)}</p>
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800">
                <div><p className="text-xs text-zinc-500">Invoiced</p><p className="tnum font-medium">{money(t.total_invoiced, t.currency)}</p></div>
                <div><p className="text-xs text-zinc-500">Paid</p><p className="tnum font-medium text-brand-700 dark:text-brand-300">{money(t.total_paid, t.currency)}</p></div>
              </div>
            </Card>
          ))}
          <Card>
            <CardHeader title="Details" />
            <ul className="space-y-2.5 text-sm">
              {c.phone && <li className="flex gap-2.5"><Phone className="mt-0.5 h-4 w-4 text-zinc-400" /><a href={`tel:${c.phone}`} className="hover:underline">{formatPhone(c.phone)}</a></li>}
              {c.email && <li className="flex gap-2.5"><Mail className="mt-0.5 h-4 w-4 text-zinc-400" /><a href={`mailto:${c.email}`} className="break-all hover:underline">{c.email}</a></li>}
              {c.billing_address && <li className="flex gap-2.5"><MapPin className="mt-0.5 h-4 w-4 text-zinc-400" /><span className="whitespace-pre-line">{c.billing_address}</span></li>}
              {c.tax_id && <li className="text-zinc-500">KRA PIN / Tax ID: <span className="text-zinc-900 dark:text-zinc-100">{c.tax_id}</span></li>}
              {c.notes && <li className="rounded-lg bg-zinc-50 p-2.5 text-[13px] text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-300">{c.notes}</li>}
              {!c.phone && !c.email && !c.billing_address && <li className="text-zinc-500">No contact details yet.</li>}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <Button variant="ghost" size="sm" icon={c.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />} onClick={() => void setArchived(!c.is_archived)} disabled={!online}>
                {c.is_archived ? "Restore" : "Archive"}
              </Button>
              <Button variant="ghost" size="sm" className="text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(true)} disabled={!online}>Delete</Button>
            </div>
          </Card>
        </div>

        <Card padded={false}>
          <div className="px-4 pt-4 sm:px-5 sm:pt-5"><h2 className="text-[15px] font-semibold">Invoice history</h2></div>
          {!history.data ? (
            <div className="p-4"><LoadingBlock rows={3} /></div>
          ) : history.data.length === 0 ? (
            <EmptyState icon={<FileText className="h-6 w-6" />} title="No invoices for this customer" />
          ) : (
            <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
              {history.data.map((i) => (
                <li key={i.id}>
                  <Link to={`/invoices/${i.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 sm:px-5 dark:hover:bg-zinc-800/40">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{i.number}</p>
                      <p className="text-xs text-zinc-500">Issued {fmtDate(i.issue_date)} · due {fmtDate(i.due_date)}</p>
                    </div>
                    <div className="text-right">
                      <p className="tnum text-sm font-medium">{money(i.total, i.currency)}</p>
                      <StatusBadge status={i.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <CustomerForm
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit customer"
        initial={c}
        onSubmit={async (data) => {
          try {
            const updated = await api.put<Customer>(`/customers/${c.id}`, { ...data, is_archived: c.is_archived });
            q.setData({ ...q.data!, customer: updated });
            toast.success("Customer updated");
          } catch (e) {
            throw new Error(errorMessage(e));
          }
        }}
      />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        danger
        loading={busy}
        title="Delete customer?"
        confirmLabel="Delete customer"
        message="Customers with invoices or quotations can't be deleted, to protect your records — archive them instead."
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/customers/${c.id}`);
            toast.success("Customer deleted");
            navigate("/customers", { replace: true });
          } catch (e) {
            toast.error("Couldn't delete", errorMessage(e));
            setDeleting(false);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
