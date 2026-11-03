import { ArrowLeft, Ban, Copy, Download, FileText, MoreHorizontal, Pencil, RotateCcw, Send, Share2, Trash2, Wallet, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DocumentPreview } from "@/components/DocumentPreview";
import { PaymentDialog } from "@/components/PaymentDialog";
import { ShareSheet } from "@/components/ShareSheet";
import { StatusBadge, SyncBadge } from "@/components/Status";
import { useToast } from "@/components/Toast";
import { Button, Card, CardHeader, ConfirmDialog, ErrorState, IconButton, LoadingBlock, Menu, Notice, Segmented } from "@/components/ui";
import { useApp } from "@/hooks/useApp";
import { useQuery } from "@/hooks/useQuery";
import { api, download, errorMessage } from "@/services/api";
import type { Invoice, TemplateKey } from "@/types";
import { dec } from "@/utils/calc";
import { fmtDate, fmtDateTime, METHOD_LABEL, money } from "@/utils/format";
import { formatPhone } from "@/utils/phone";

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { business, online, localDocs } = useApp();
  const q = useQuery<Invoice>((signal) => api.get(`/invoices/${id}`, undefined, signal), [id], `invoice:${id}`);
  const inv = q.data;
  const [paying, setPaying] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "cancel" | { payment: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [template, setTemplate] = useState<TemplateKey | null>(null);
  const pendingEdit = localDocs.find((d) => d.kind === "invoice" && d.serverId === Number(id) && d.state !== "synced");

  if (q.error && !inv) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!inv || !business) return <LoadingBlock rows={8} />;

  const tpl = template ?? inv.template;
  const open = ["sent", "partially_paid", "overdue"].includes(inv.status);
  const paidPct = dec(inv.total).gt(0) ? dec(inv.amount_paid).div(dec(inv.total)).times(100).toNumber() : 0;

  const act = async (fn: () => Promise<Invoice | void>, ok: string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r) q.setData(r);
      toast.success(ok);
      setConfirm(null);
    } catch (e) {
      toast.error("That didn't work", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pdf = async () => {
    try {
      await download(`/invoices/${inv.id}/pdf`, `Invoice-${inv.number}.pdf`, { download: true, template: tpl });
    } catch (e) {
      toast.error("Couldn't download PDF", errorMessage(e));
    }
  };

  const markSent = () => act(() => api.post<Invoice>(`/invoices/${inv.id}/send`), "Marked as sent");

  return (
    <div className="animate-fade-in">
      <Link to="/invoices" className="mb-2 inline-flex items-center gap-1 text-[13px] font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        <ArrowLeft className="h-4 w-4" /> Invoices
      </Link>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight sm:text-2xl">{inv.number}</h1>
            <StatusBadge status={inv.status} />
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {inv.customer_snapshot?.name ?? "No customer"} · issued {fmtDate(inv.issue_date)} · due {fmtDate(inv.due_date)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {inv.status !== "cancelled" && (
            <Link to={`/invoices/${inv.id}/edit`}><Button variant="secondary" icon={<Pencil className="h-4 w-4" />}>Edit</Button></Link>
          )}
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={pdf} disabled={!online}>PDF</Button>
          <Button variant="secondary" icon={<Share2 className="h-4 w-4" />} onClick={() => setSharing(true)} disabled={!online}>Share</Button>
          {open && <Button icon={<Wallet className="h-4 w-4" />} onClick={() => setPaying(true)} disabled={!online}>Record payment</Button>}
          {inv.status === "draft" && <Button icon={<Send className="h-4 w-4" />} onClick={markSent} loading={busy} disabled={!online}>Mark as sent</Button>}
          <Menu
            trigger={(p) => <IconButton label="More actions" {...p} className="ring-1 ring-inset ring-zinc-200 dark:ring-zinc-700"><MoreHorizontal className="h-4 w-4" /></IconButton>}
            items={[
              { label: "Duplicate", icon: <Copy />, onClick: () => void act(async () => { const d = await api.post<Invoice>(`/invoices/${inv.id}/duplicate`); navigate(`/invoices/${d.id}/edit`); }, "Duplicated as a new draft"), disabled: !online },
              { label: "Cancel invoice", icon: <Ban />, onClick: () => setConfirm("cancel"), hidden: inv.status === "cancelled" || inv.status === "paid", disabled: !online },
              { label: "Reopen invoice", icon: <RotateCcw />, onClick: () => void act(() => api.post<Invoice>(`/invoices/${inv.id}/reopen`), "Invoice reopened"), hidden: inv.status !== "cancelled", disabled: !online },
              { label: "Delete", icon: <Trash2 />, danger: true, onClick: () => setConfirm("delete"), hidden: dec(inv.amount_paid).gt(0), disabled: !online },
            ]}
          />
        </div>
      </div>

      {q.stale && <Notice tone="amber" className="mb-4">Offline copy from {fmtDateTime(q.savedAt)}. Payments, sharing and PDFs need a connection.</Notice>}
      {pendingEdit && (
        <Notice tone="amber" className="mb-4">
          You have changes to this invoice on this device that aren't on the server yet. <SyncBadge state={pendingEdit.state} />{" "}
          <Link to={`/invoices/local/${pendingEdit.localId}`} className="font-medium underline">Open them</Link>
        </Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <div className="-mx-1 overflow-x-auto px-1">
            <Segmented size="sm" value={tpl} onChange={(v) => setTemplate(v)} options={[
              { value: "modern", label: "Modern" }, { value: "corporate", label: "Corporate" }, { value: "elegant", label: "Elegant" }, { value: "classic", label: "Classic" },
            ]} />
          </div>
          <div className="rounded-xl bg-zinc-100 p-2 sm:p-5 dark:bg-zinc-900">
            <DocumentPreview
              model={{
                kind: "invoice", number: inv.number, issue_date: inv.issue_date, end_date: inv.due_date, currency: inv.currency,
                pricing_mode: inv.pricing_mode, template: tpl, accent: business.settings.accent_color, show_signature: business.settings.show_signature,
                business: { ...(inv.business_snapshot ?? {}), logo: business.logo_data_url }, customer: inv.customer_snapshot,
                items: inv.items, shipping: inv.shipping, amount_paid: inv.amount_paid, notes: inv.notes, terms: inv.terms,
                payment_instructions: inv.payment_instructions, status: inv.status,
              }}
            />
          </div>
          {template && template !== inv.template && <p className="text-xs text-zinc-500">Previewing another template. Downloads use the selected one; edit the invoice to change its saved template.</p>}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Payment status" />
            <dl className="tnum space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-zinc-500">Total</dt><dd className="font-medium">{money(inv.total, inv.currency)}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Paid</dt><dd className="text-brand-700 dark:text-brand-300">{money(inv.amount_paid, inv.currency)}</dd></div>
              <div className="flex justify-between text-base font-semibold"><dt>Balance due</dt><dd>{money(inv.balance_due, inv.currency)}</dd></div>
            </dl>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" role="progressbar" aria-valuenow={Math.round(paidPct)} aria-valuemin={0} aria-valuemax={100} aria-label="Paid">
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, paidPct)}%` }} />
            </div>
            {open && (
              <Button className="mt-4 w-full" icon={<Wallet className="h-4 w-4" />} onClick={() => setPaying(true)} disabled={!online}>
                Record payment
              </Button>
            )}
            {inv.status === "draft" && <p className="mt-3 text-xs text-zinc-500">Mark the invoice as sent before recording payments.</p>}
          </Card>

          <Card padded={false}>
            <div className="px-4 pt-4 sm:px-5"><h2 className="text-[15px] font-semibold">Payments</h2></div>
            {inv.payments.length === 0 ? (
              <p className="px-5 py-6 text-sm text-zinc-500">No payments recorded.</p>
            ) : (
              <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
                {inv.payments.map((p) => (
                  <li key={p.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="tnum text-sm font-medium">{money(p.amount, inv.currency)}</p>
                      <p className="text-xs text-zinc-500">{METHOD_LABEL[p.method]} · {fmtDate(p.payment_date)}{p.reference ? ` · ${p.reference}` : ""}</p>
                      {p.notes && <p className="mt-0.5 text-xs text-zinc-500">{p.notes}</p>}
                    </div>
                    <IconButton label="Delete payment" className="h-8 w-8 hover:text-red-600" onClick={() => setConfirm({ payment: p.id })} disabled={!online}>
                      <X className="h-4 w-4" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Customer" />
            {inv.customer_snapshot ? (
              <div className="space-y-0.5 text-sm">
                <p className="font-medium">{inv.customer_id ? <Link to={`/customers/${inv.customer_id}`} className="hover:underline">{inv.customer_snapshot.name}</Link> : inv.customer_snapshot.name}</p>
                {inv.customer_snapshot.company && <p className="text-zinc-500">{inv.customer_snapshot.company}</p>}
                {inv.customer_snapshot.phone && <p className="text-zinc-500">{formatPhone(inv.customer_snapshot.phone_e164) || inv.customer_snapshot.phone}</p>}
                {inv.customer_snapshot.email && <p className="text-zinc-500">{inv.customer_snapshot.email}</p>}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No customer selected.</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Activity" />
            <ol className="space-y-3 border-l border-zinc-200 pl-4 text-sm dark:border-zinc-800">
              <li><p className="font-medium">Created</p><p className="text-xs text-zinc-500">{fmtDateTime(inv.created_at)}</p></li>
              {inv.quotation_id && <li><p className="font-medium">Converted from a quotation</p><Link to={`/quotations/${inv.quotation_id}`} className="text-xs text-brand-700 hover:underline">View quotation</Link></li>}
              {inv.sent_at && <li><p className="font-medium">Marked as sent</p><p className="text-xs text-zinc-500">{fmtDateTime(inv.sent_at)}</p></li>}
              {inv.payments.map((p) => <li key={p.id}><p className="font-medium">Payment of {money(p.amount, inv.currency)}</p><p className="text-xs text-zinc-500">{fmtDate(p.payment_date)}</p></li>)}
              {inv.cancelled_at && <li><p className="font-medium text-red-600">Cancelled</p><p className="text-xs text-zinc-500">{fmtDateTime(inv.cancelled_at)}</p></li>}
            </ol>
          </Card>
          <Button variant="ghost" className="w-full" icon={<FileText className="h-4 w-4" />} onClick={() => void download(`/invoices/${inv.id}/pdf`, `Invoice-${inv.number}.pdf`, { download: true, template: tpl }).catch((e) => toast.error("Couldn't download", errorMessage(e)))} disabled={!online}>
            Download {tpl} PDF
          </Button>
        </div>
      </div>

      <PaymentDialog invoice={inv} open={paying} onClose={() => setPaying(false)} onRecorded={(r) => q.setData(r)} />
      <ShareSheet invoice={inv} open={sharing} onClose={() => setSharing(false)} onMarkSent={() => void markSent()} />
      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        danger
        loading={busy}
        title="Delete invoice?"
        confirmLabel="Delete"
        message={<>Permanently delete <b>{inv.number}</b>? This can't be undone.</>}
        onConfirm={() => void act(async () => { await api.del(`/invoices/${inv.id}`); navigate("/invoices", { replace: true }); }, "Invoice deleted")}
      />
      <ConfirmDialog
        open={confirm === "cancel"}
        onClose={() => setConfirm(null)}
        danger
        loading={busy}
        title="Cancel invoice?"
        confirmLabel="Cancel invoice"
        message="The invoice stays in your records marked Cancelled and stops counting towards outstanding balances. You can reopen it later."
        onConfirm={() => void act(() => api.post<Invoice>(`/invoices/${inv.id}/cancel`), "Invoice cancelled")}
      />
      <ConfirmDialog
        open={typeof confirm === "object" && confirm !== null}
        onClose={() => setConfirm(null)}
        danger
        loading={busy}
        title="Delete payment?"
        confirmLabel="Delete payment"
        message="Use this to correct a payment recorded by mistake. The balance and status are recalculated."
        onConfirm={() => typeof confirm === "object" && confirm && void act(() => api.del<Invoice>(`/payments/${confirm.payment}`), "Payment deleted")}
      />
    </div>
  );
}
