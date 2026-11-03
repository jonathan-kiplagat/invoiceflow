import { useEffect, useMemo, useState } from "react";
import { Button, Field, Input, Modal, Notice, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useApp } from "@/hooks/useApp";
import { api, errorMessage } from "@/services/api";
import type { Invoice, PaymentMethod } from "@/types";
import { uuid } from "@/utils/cn";
import { dec, isValidAmount } from "@/utils/calc";
import { money, todayNairobi } from "@/utils/format";

const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "mpesa", label: "M-Pesa" },
  { key: "bank_transfer", label: "Bank transfer" },
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "cheque", label: "Cheque" },
  { key: "other", label: "Other" },
];

export interface PayableInvoice {
  id: number;
  number: string;
  currency: string;
  total: string;
  balance_due: string;
  status: string;
}

export function PaymentDialog({ invoice, open, onClose, onRecorded }: { invoice: PayableInvoice | null; open: boolean; onClose: () => void; onRecorded: (inv: Invoice) => void }) {
  const toast = useToast();
  const { online } = useApp();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayNairobi());
  const [method, setMethod] = useState<PaymentMethod>("mpesa");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per dialog session, so a double-tap or retry never records twice.
  const [clientUuid, setClientUuid] = useState(uuid());

  useEffect(() => {
    if (open && invoice) {
      setAmount(dec(invoice.balance_due).toFixed(2));
      setDate(todayNairobi());
      setMethod("mpesa");
      setReference("");
      setNotes("");
      setError(null);
      setClientUuid(uuid());
    }
  }, [open, invoice]);

  const balance = invoice ? dec(invoice.balance_due) : dec(0);
  const amountErr = useMemo(() => {
    if (!amount) return "Enter the amount received";
    if (!isValidAmount(amount)) return "Enter a valid amount with up to 2 decimals";
    const a = dec(amount);
    if (a.lte(0)) return "Amount must be more than zero";
    if (a.gt(balance)) return `That's more than the outstanding ${money(balance, invoice?.currency)}`;
    return null;
  }, [amount, balance, invoice?.currency]);
  const isFull = !amountErr && dec(amount).eq(balance);

  const submit = async () => {
    if (!invoice || amountErr) return;
    setBusy(true);
    setError(null);
    try {
      const inv = await api.post<Invoice>(`/invoices/${invoice.id}/payments`, {
        client_uuid: clientUuid,
        amount: dec(amount).toFixed(2),
        payment_date: date,
        method,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      });
      toast.success("Payment recorded", `${money(amount, invoice.currency)} on ${inv.number} · now ${inv.status === "paid" ? "fully paid" : `${money(inv.balance_due, inv.currency)} outstanding`}`);
      onRecorded(inv);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record payment"
      description={invoice ? `${invoice.number} · ${money(invoice.balance_due, invoice.currency)} outstanding` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!!amountErr || !online}>
            {isFull ? "Record full payment" : "Record partial payment"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!online && <Notice tone="amber">Payments can only be recorded while online, so your balances are never out of step with the server.</Notice>}
        {error && <Notice tone="red">{error}</Notice>}
        <Notice tone="blue">
          This records a payment you've already received. InvoiceFlow does not collect M-Pesa or card payments itself.
        </Notice>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Amount received (${invoice?.currency ?? ""})`} htmlFor="pay-amount" error={amount ? amountErr : null}>
            <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="tnum" data-autofocus />
          </Field>
          <Field label="Payment date" htmlFor="pay-date">
            <Input id="pay-date" type="date" value={date} max={todayNairobi()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Method" htmlFor="pay-method">
            <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </Select>
          </Field>
          <Field label={method === "mpesa" ? "M-Pesa code" : "Reference"} htmlFor="pay-ref" optional>
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(method === "mpesa" ? e.target.value.toUpperCase() : e.target.value)} placeholder={method === "mpesa" ? "e.g. SGH12ABC34" : "Transaction reference"} maxLength={120} autoCapitalize="characters" />
          </Field>
        </div>
        {invoice && dec(invoice.balance_due).gt(0) && !isFull && (
          <button type="button" className="text-[13px] font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => setAmount(balance.toFixed(2))}>
            Use full balance ({money(balance, invoice.currency)})
          </button>
        )}
        <Field label="Notes" htmlFor="pay-notes" optional>
          <Textarea id="pay-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </Field>
      </div>
    </Modal>
  );
}
