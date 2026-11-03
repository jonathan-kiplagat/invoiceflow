import { useEffect, useState } from "react";
import { Button, Field, Input, Modal, Notice, Textarea } from "@/components/ui";
import type { CustomerInput } from "@/types";
import { normalizePhone, phoneError } from "@/utils/phone";

const EMPTY: CustomerInput = { name: "", company: "", email: "", phone: "", billing_address: "", tax_id: "", notes: "" };

export function validateCustomer(c: CustomerInput): Record<string, string> {
  const e: Record<string, string> = {};
  if (!c.name?.trim()) e.name = "Customer name is required";
  if (c.email && c.email.trim() && !/^\S+@\S+\.\S+$/.test(c.email.trim())) e.email = "Enter a valid email address";
  if (c.phone && c.phone.trim()) {
    const err = phoneError(c.phone);
    if (err) e.phone = err;
  }
  return e;
}

export function cleanCustomer(c: CustomerInput): CustomerInput {
  const t = (v?: string | null) => (v ?? "").trim() || null;
  return {
    name: c.name.trim(),
    company: t(c.company),
    email: t(c.email),
    phone: c.phone && c.phone.trim() ? normalizePhone(c.phone) : null,
    billing_address: t(c.billing_address),
    tax_id: t(c.tax_id)?.toUpperCase() ?? null,
    notes: t(c.notes),
    is_archived: c.is_archived ?? false,
  };
}

export function CustomerForm({
  open, onClose, onSubmit, initial, title = "New customer", submitLabel = "Save customer", offlineNote,
}: {
  open: boolean; onClose: () => void; onSubmit: (c: CustomerInput) => Promise<void>; initial?: CustomerInput | null;
  title?: string; submitLabel?: string; offlineNote?: boolean;
}) {
  const [c, setC] = useState<CustomerInput>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setC({ ...EMPTY, ...(initial ?? {}) });
      setErrors({});
      setError(null);
    }
  }, [open, initial]);

  const set = (k: keyof CustomerInput) => (e: { target: { value: string } }) => setC((x) => ({ ...x, [k]: e.target.value }));

  const submit = async () => {
    const errs = validateCustomer(c);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(cleanCustomer(c));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy}>{submitLabel}</Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {offlineNote && <Notice tone="amber">You're offline. This customer will be created on the server together with the invoice when it syncs.</Notice>}
        {error && <Notice tone="red">{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="c-name" required error={errors.name}>
            <Input id="c-name" value={c.name} onChange={set("name")} autoComplete="name" invalid={!!errors.name} data-autofocus />
          </Field>
          <Field label="Company" htmlFor="c-company" optional>
            <Input id="c-company" value={c.company ?? ""} onChange={set("company")} autoComplete="organization" />
          </Field>
          <Field label="Email" htmlFor="c-email" optional error={errors.email}>
            <Input id="c-email" type="email" inputMode="email" value={c.email ?? ""} onChange={set("email")} invalid={!!errors.email} />
          </Field>
          <Field label="Phone" htmlFor="c-phone" optional error={errors.phone} hint="Used for WhatsApp sharing, e.g. 0712 345 678">
            <Input id="c-phone" type="tel" inputMode="tel" value={c.phone ?? ""} onChange={set("phone")} invalid={!!errors.phone} />
          </Field>
        </div>
        <Field label="Billing address" htmlFor="c-addr" optional>
          <Textarea id="c-addr" rows={2} value={c.billing_address ?? ""} onChange={set("billing_address")} />
        </Field>
        <Field label="KRA PIN / Tax ID" htmlFor="c-tax" optional>
          <Input id="c-tax" value={c.tax_id ?? ""} onChange={set("tax_id")} autoCapitalize="characters" />
        </Field>
        <Field label="Internal notes" htmlFor="c-notes" optional hint="Not shown on invoices.">
          <Textarea id="c-notes" rows={2} value={c.notes ?? ""} onChange={set("notes")} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
