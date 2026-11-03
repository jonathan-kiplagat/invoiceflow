import { ArrowLeft, ArrowRightLeft, Check, Copy, Download, MoreHorizontal, Pencil, Send, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DocumentPreview } from "@/components/DocumentPreview";
import { StatusBadge } from "@/components/Status";
import { useToast } from "@/components/Toast";
import { Button, ConfirmDialog, ErrorState, IconButton, LoadingBlock, Menu, Notice } from "@/components/ui";
import { useApp } from "@/hooks/useApp";
import { useQuery } from "@/hooks/useQuery";
import { api, download, errorMessage } from "@/services/api";
import type { Invoice, Quotation } from "@/types";
import { fmtDate, fmtDateTime, money } from "@/utils/format";

export default function QuotationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { business, online } = useApp();
  const q = useQuery<Quotation>((s) => api.get(`/quotations/${id}`, undefined, s), [id], `quotation:${id}`);
  const [confirm, setConfirm] = useState<"delete" | "convert" | null>(null);
  const [busy, setBusy] = useState(false);
  const quote = q.data;
  if (q.error && !quote) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!quote || !business) return <LoadingBlock rows={8} />;

  const editable = quote.status !== "converted";
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error("That didn't work", errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const setStatus = (action: "send" | "accept" | "decline", label: string) =>
    act(async () => {
      q.setData(await api.post<Quotation>(`/quotations/${quote.id}/${action}`));
      toast.success(label);
    });

  return (
    <div className="animate-fade-in">
      <Link to="/quotations" className="mb-2 inline-flex items-center gap-1 text-[13px] font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        <ArrowLeft className="h-4 w-4" /> Quotations
      </Link>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight sm:text-2xl">{quote.number}</h1>
            <StatusBadge status={quote.status} />
          </div>
          <p className="mt-1 text-sm text-zinc-500">{quote.customer_snapshot?.name ?? "No customer"} · {money(quote.total, quote.currency)} · valid until {fmtDate(quote.valid_until)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && <Link to={`/quotations/${quote.id}/edit`}><Button variant="secondary" icon={<Pencil className="h-4 w-4" />}>Edit</Button></Link>}
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} disabled={!online} onClick={() => void download(`/quotations/${quote.id}/pdf`, `Quotation-${quote.number}.pdf`, { download: true }).catch((e) => toast.error("Couldn't download", errorMessage(e)))}>PDF</Button>
          {quote.status === "draft" && <Button variant="secondary" icon={<Send className="h-4 w-4" />} onClick={() => void setStatus("send", "Marked as sent")} disabled={!online || busy}>Mark sent</Button>}
          {editable && quote.status !== "declined" && <Button icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setConfirm("convert")} disabled={!online}>Convert to invoice</Button>}
          {quote.converted_invoice_id && <Link to={`/invoices/${quote.converted_invoice_id}`}><Button>Open invoice</Button></Link>}
          <Menu
            trigger={(p) => <IconButton label="More actions" {...p} className="ring-1 ring-inset ring-zinc-200 dark:ring-zinc-700"><MoreHorizontal className="h-4 w-4" /></IconButton>}
            items={[
              { label: "Mark accepted", icon: <Check />, onClick: () => void setStatus("accept", "Marked as accepted"), hidden: !editable || quote.status === "accepted", disabled: !online },
              { label: "Mark declined", icon: <X />, onClick: () => void setStatus("decline", "Marked as declined"), hidden: !editable || quote.status === "declined", disabled: !online },
              { label: "Duplicate", icon: <Copy />, onClick: () => void act(async () => { const d = await api.post<Quotation>(`/quotations/${quote.id}/duplicate`); navigate(`/quotations/${d.id}/edit`); }), disabled: !online },
              { label: "Delete", icon: <Trash2 />, danger: true, onClick: () => setConfirm("delete"), disabled: !online },
            ]}
          />
        </div>
      </div>
      {q.stale && <Notice tone="amber" className="mb-4">Offline copy from {fmtDateTime(q.savedAt)}.</Notice>}
      {quote.status === "converted" && <Notice tone="blue" className="mb-4">Converted to an invoice on {fmtDateTime(quote.converted_at)}.</Notice>}
      <div className="mx-auto max-w-4xl rounded-xl bg-zinc-100 p-2 sm:p-5 dark:bg-zinc-900">
        <DocumentPreview
          model={{
            kind: "quotation", number: quote.number, issue_date: quote.issue_date, end_date: quote.valid_until, currency: quote.currency,
            pricing_mode: quote.pricing_mode, template: quote.template, accent: business.settings.accent_color, show_signature: business.settings.show_signature,
            business: { ...(quote.business_snapshot ?? {}), logo: business.logo_data_url }, customer: quote.customer_snapshot, items: quote.items,
            shipping: quote.shipping, notes: quote.notes, terms: quote.terms, payment_instructions: quote.payment_instructions,
          }}
        />
      </div>
      <ConfirmDialog
        open={confirm === "convert"}
        onClose={() => setConfirm(null)}
        loading={busy}
        title="Convert to invoice?"
        confirmLabel="Create invoice"
        message="A new draft invoice is created with the same customer, items and prices. The quotation is marked as converted."
        onConfirm={() => void act(async () => {
          const inv = await api.post<Invoice>(`/quotations/${quote.id}/convert`);
          toast.success("Invoice created", inv.number);
          navigate(`/invoices/${inv.id}`);
        })}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        danger
        loading={busy}
        title="Delete quotation?"
        confirmLabel="Delete"
        message={<>Permanently delete <b>{quote.number}</b>?{quote.converted_invoice_id ? " The invoice created from it is not affected." : ""}</>}
        onConfirm={() => void act(async () => { await api.del(`/quotations/${quote.id}`); toast.success("Quotation deleted"); navigate("/quotations", { replace: true }); })}
      />
    </div>
  );
}
