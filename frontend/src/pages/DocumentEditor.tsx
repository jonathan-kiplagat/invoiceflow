import { ArrowLeft, Building2, Check, ChevronRight, Eye, FileText, HardDrive, Plus, Search, Send, UserPlus, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CustomerForm } from "@/components/CustomerForm";
import { DocumentPreview, type PreviewModel } from "@/components/DocumentPreview";
import { emptyItem, itemErrors, ItemsEditor } from "@/components/ItemsEditor";
import { SyncBadge } from "@/components/Status";
import { useToast } from "@/components/Toast";
import { Badge, Button, Card, CardHeader, ErrorState, Field, Input, LoadingBlock, Modal, Notice, Segmented, Select, Textarea } from "@/components/ui";
import { useApp } from "@/hooks/useApp";
import { useMediaQuery } from "@/hooks/useQuery";
import { api, ApiError, errorMessage } from "@/services/api";
import { cache, outbox, type LocalDoc } from "@/services/db";
import { newLocalDoc } from "@/services/sync";
import type { Customer, CustomerInput, DocKind, DocumentInput, Invoice, Page, Quotation, TemplateKey } from "@/types";
import { cn, uuid } from "@/utils/cn";
import { computeDocument, dec, isValidAmount, taxSummary } from "@/utils/calc";
import { addDays, fmtDate, fmtDateTime, money, rate, todayNairobi } from "@/utils/format";
import { formatPhone } from "@/utils/phone";

const TEMPLATES: { value: TemplateKey; label: string }[] = [
  { value: "modern", label: "Modern Minimal" },
  { value: "corporate", label: "Corporate Professional" },
  { value: "elegant", label: "Elegant Business" },
  { value: "classic", label: "Classic Standard" },
];

function toPayload(doc: Invoice | Quotation, kind: DocKind): DocumentInput {
  return {
    client_uuid: doc.client_uuid,
    customer_id: doc.customer_id,
    new_customer: null,
    issue_date: doc.issue_date,
    ...(kind === "invoice" ? { due_date: (doc as Invoice).due_date } : { valid_until: (doc as Quotation).valid_until }),
    status: doc.sent_at ? "sent" : "draft",
    currency: doc.currency,
    pricing_mode: doc.pricing_mode,
    template: doc.template,
    notes: doc.notes,
    terms: doc.terms,
    payment_instructions: doc.payment_instructions,
    shipping: dec(doc.shipping).toFixed(2),
    items: doc.items.map((i) => ({
      description: i.description,
      quantity: dec(i.quantity).toString(),
      unit_price: dec(i.unit_price).toFixed(2),
      discount_type: i.discount_type,
      discount_value: dec(i.discount_value).toString(),
      tax_rate_id: i.tax_rate_id,
      tax_name: i.tax_name,
      tax_rate: dec(i.tax_rate).toString(),
    })),
  };
}

function CustomerPicker({
  customers, value, newCustomer, onPick, onNew, error,
}: { customers: Customer[]; value: number | null; newCustomer: CustomerInput | null | undefined; onPick: (c: Customer | null) => void; onNew: () => void; error?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = customers.find((c) => c.id === value);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return customers.filter((c) => !c.is_archived && (!s || [c.name, c.company, c.email, c.phone].some((v) => v?.toLowerCase().includes(s)))).slice(0, 100);
  }, [customers, q]);
  const display = selected ?? (newCustomer ? { name: newCustomer.name, company: newCustomer.company, email: newCustomer.email, phone: newCustomer.phone } : null);

  return (
    <>
      {display ? (
        <div className={cn("flex items-start gap-3 rounded-xl border p-3", error ? "border-red-300" : "border-zinc-200 dark:border-zinc-800")}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-800 dark:bg-brand-500/10 dark:text-brand-200">{display.name.slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">
              {display.name} {newCustomer && !selected && <Badge tone="amber" className="ml-1">New · created on save</Badge>}
            </p>
            {display.company && <p className="text-zinc-500">{display.company}</p>}
            <p className="truncate text-[13px] text-zinc-500">{[formatPhone(display.phone), display.email].filter(Boolean).join(" · ")}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Change</Button>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cn("flex h-12 items-center gap-2 rounded-xl border border-dashed px-3 text-left text-sm text-zinc-600 hover:border-brand-400 hover:bg-brand-50/50 dark:text-zinc-300 dark:hover:bg-brand-500/5", error ? "border-red-300" : "border-zinc-300 dark:border-zinc-700")}
          >
            <Users className="h-4 w-4 text-zinc-400" /> Choose a saved customer
          </button>
          <button type="button" onClick={onNew} className="flex h-12 items-center gap-2 rounded-xl border border-dashed border-zinc-300 px-3 text-left text-sm text-zinc-600 hover:border-brand-400 hover:bg-brand-50/50 dark:border-zinc-700 dark:text-zinc-300">
            <UserPlus className="h-4 w-4 text-zinc-400" /> Add a new customer
          </button>
        </div>
      )}
      {error && <p className="mt-1.5 text-[13px] text-red-600">{error}</p>}
      <Modal open={open} onClose={() => setOpen(false)} title="Choose customer" fullScreenMobile>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, company, phone or email" className="pl-9" data-autofocus aria-label="Search customers" />
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onNew();
          }}
          className="mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
        >
          <Plus className="h-4 w-4" /> New customer{q.trim() ? ` "${q.trim()}"` : ""}
        </button>
        {shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">{customers.length ? "No matching customers." : "No saved customers yet."}</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {shown.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(c);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="truncate text-xs text-zinc-500">{[c.company, formatPhone(c.phone), c.email].filter(Boolean).join(" · ")}</p>
                  </div>
                  {c.id === value ? <Check className="h-4 w-4 text-brand-600" /> : <ChevronRight className="h-4 w-4 text-zinc-300" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}

export default function DocumentEditor({ kind }: { kind: DocKind }) {
  const { id, localId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { business, user, online, engine, meta } = useApp();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const path = kind === "invoice" ? "invoices" : "quotations";
  const label = kind === "invoice" ? "Invoice" : "Quotation";

  const [doc, setDoc] = useState<LocalDoc | null>(null);
  const [form, setForm] = useState<DocumentInput | null>(null);
  const [server, setServer] = useState<Invoice | Quotation | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"draft" | "sent" | null>(null);
  const [preview, setPreview] = useState(false);
  const [newCustOpen, setNewCustOpen] = useState(false);
  const [autosavedAt, setAutosavedAt] = useState<number | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const dirty = useRef(false);
  const docRef = useRef<LocalDoc | null>(null);
  docRef.current = doc;

  const settings = business?.settings;
  const defaultTax = useMemo(() => business?.tax_rates.find((t) => t.id === settings?.default_tax_rate_id) ?? null, [business, settings]);

  // ---- load -------------------------------------------------------------------------
  useEffect(() => {
    if (!user || !business) return;
    let cancelled = false;
    (async () => {
      try {
        if (localId) {
          const rec = await outbox.get(localId);
          if (!rec || rec.userId !== user.id || rec.kind !== kind) throw new Error("This draft isn't on this device any more. It may have been synced or discarded.");
          if (rec.state === "synced" && rec.serverId) {
            navigate(`/${path}/${rec.serverId}`, { replace: true });
            return;
          }
          if (!cancelled) {
            setDoc(rec);
            setForm(rec.payload);
          }
          return;
        }
        if (id) {
          const serverId = Number(id);
          const pending = await outbox.forServer(user.id, kind, serverId);
          let srv: Invoice | Quotation | null = null;
          try {
            srv = await api.get<Invoice | Quotation>(`/${path}/${serverId}`);
            void cache.set(user.id, `${kind}:${serverId}`, srv);
          } catch (e) {
            if (e instanceof ApiError && e.network) {
              srv = (await cache.get<Invoice | Quotation>(user.id, `${kind}:${serverId}`))?.value ?? null;
              if (!srv && !pending) throw new Error(`This ${kind} hasn't been opened on this device before, so it isn't available offline.`);
            } else throw e;
          }
          if (srv && kind === "invoice" && (srv as Invoice).status === "cancelled") throw new Error("Cancelled invoices can't be edited. Reopen it first.");
          if (srv && kind === "quotation" && (srv as Quotation).status === "converted") throw new Error("This quotation was converted to an invoice and can no longer be edited.");
          if (cancelled) return;
          setServer(srv);
          if (pending) {
            setDoc(pending);
            setForm(pending.payload);
          } else if (srv) {
            const payload = toPayload(srv, kind);
            setDoc(newLocalDoc(user.id, kind, payload, { localId: uuid(), serverId, baseVersion: srv.version, number: srv.number, label: srv.customer_snapshot?.name ?? "" }));
            setForm(payload);
          }
          return;
        }
        // New document from business defaults.
        const today = todayNairobi();
        const payload: DocumentInput = {
          client_uuid: uuid(),
          customer_id: null,
          new_customer: null,
          issue_date: today,
          ...(kind === "invoice" ? { due_date: addDays(today, business.settings.payment_terms_days) } : { valid_until: addDays(today, business.settings.quote_validity_days) }),
          status: "draft",
          currency: business.settings.default_currency,
          pricing_mode: business.settings.pricing_mode,
          template: business.settings.default_template,
          notes: business.settings.default_notes,
          terms: business.settings.default_terms,
          payment_instructions: business.payment_instructions_preview || null,
          shipping: "0",
          items: [emptyItem(defaultTax)],
        };
        if (!cancelled) {
          setDoc(newLocalDoc(user.id, kind, payload));
          setForm(payload);
        }
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, localId, kind, user?.id, !!business]);

  // Customers for the picker (cached for offline use).
  useEffect(() => {
    if (!user) return;
    api
      .get<Page<Customer>>("/customers", { page_size: 500 })
      .then((p) => {
        setCustomers(p.items);
        void cache.set(user.id, "customers:all", p.items);
      })
      .catch(async () => {
        const c = await cache.get<Customer[]>(user.id, "customers:all");
        if (c) setCustomers(c.value);
      });
  }, [user]);

  const customerLabel = useCallback(
    (f: DocumentInput) => customers.find((c) => c.id === f.customer_id)?.name ?? f.new_customer?.name ?? "",
    [customers],
  );

  // ---- autosave to this device (never sent until the user presses Save) -------------
  useEffect(() => {
    if (!form || !doc || !dirty.current) return;
    const t = setTimeout(async () => {
      const cur = docRef.current;
      if (!cur) return;
      const saved = await engine.saveLocal({ ...cur, payload: form, label: customerLabel(form) }, false);
      setDoc(saved);
      setAutosavedAt(Date.now());
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const update = (patch: Partial<DocumentInput>) => {
    dirty.current = true;
    setSaveError(null);
    setForm((f) => (f ? { ...f, ...patch } : f));
  };

  // ---- validation -----------------------------------------------------------------
  const endKey = kind === "invoice" ? "due_date" : "valid_until";
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!form) return e;
    if (!form.issue_date) e.issue_date = "Choose an issue date";
    const end = form[endKey];
    if (!end) e[endKey] = "Choose a date";
    else if (form.issue_date && end < form.issue_date) e[endKey] = `${kind === "invoice" ? "Due date" : "Valid-until date"} can't be before the issue date`;
    if (!form.items.length) e.items = "Add at least one item";
    if (form.items.some((it) => Object.keys(itemErrors(it)).length)) e.items = "Fix the highlighted items";
    if (form.shipping && !isValidAmount(form.shipping)) e.shipping = "Enter a valid amount";
    return e;
  }, [form, endKey, kind]);

  // ---- save ----------------------------------------------------------------------
  const save = async (mode: "draft" | "sent") => {
    if (!form || !doc) return;
    setShowErrors(true);
    const errs = { ...errors };
    if (mode === "sent" && !form.customer_id && !form.new_customer) errs.customer = "Choose a customer before sending";
    if (Object.keys(errs).length) {
      setSaveError(Object.values(errs)[0]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSaving(mode);
    setSaveError(null);
    try {
      const payload: DocumentInput = { ...form, status: mode === "sent" ? "sent" : form.status ?? "draft", shipping: form.shipping || "0" };
      const queued = await engine.saveLocal({ ...doc, payload, label: customerLabel(form) }, true);
      setDoc(queued);
      dirty.current = false;
      if (!online) {
        toast.info("Saved on this device", "Pending sync — it will upload automatically when you're back online.");
        navigate(`/${path}`);
        return;
      }
      await engine.syncAll();
      const rec = await outbox.get(queued.localId);
      if (rec?.state === "synced" && rec.serverId) {
        toast.success(mode === "sent" ? `${label} saved and marked as sent` : `${label} saved`, rec.number ?? undefined);
        navigate(`/${path}/${rec.serverId}`, { replace: true });
      } else if (rec?.state === "conflict") {
        toast.error("Changed on another device", "Review both versions in the sync centre.");
        navigate("/sync");
      } else if (rec?.state === "failed") {
        setSaveError(rec.error ?? "The server didn't accept this draft.");
        setDoc(rec);
      } else {
        toast.info("Saved on this device", "Pending sync — the server couldn't be reached. It will retry automatically.");
        navigate(`/${path}`);
      }
    } catch (e) {
      setSaveError(errorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  const discard = async () => {
    if (doc && (await outbox.get(doc.localId))) await engine.discard(doc.localId);
    dirty.current = false;
    navigate(doc?.serverId ? `/${path}/${doc.serverId}` : `/${path}`);
  };

  // ---- derived ---------------------------------------------------------------------
  const calc = useMemo(() => (form ? computeDocument(form.items, form.shipping, form.pricing_mode) : null), [form]);
  const taxes = useMemo(() => (form && calc ? taxSummary(form.items, calc.lines) : []), [form, calc]);
  const selectedCustomer = customers.find((c) => c.id === form?.customer_id) ?? null;
  const paid = server && kind === "invoice" ? dec((server as Invoice).amount_paid) : dec(0);
  const numberLabel = doc?.number ?? server?.number ?? (kind === "invoice" ? business?.invoice_number_preview : business?.quote_number_preview) ?? "";

  const previewModel: PreviewModel | null =
    form && business
      ? {
          kind,
          number: doc?.number ?? server?.number ?? `${numberLabel}`,
          issue_date: form.issue_date,
          end_date: (form[endKey] as string) ?? form.issue_date,
          currency: form.currency,
          pricing_mode: form.pricing_mode,
          template: form.template,
          accent: business.settings.accent_color,
          show_signature: business.settings.show_signature,
          business: { ...business.profile, phone: formatPhone(business.profile.phone), logo: business.logo_data_url },
          customer: selectedCustomer
            ? { ...selectedCustomer, phone: formatPhone(selectedCustomer.phone) }
            : form.new_customer
              ? { ...form.new_customer, phone: formatPhone(form.new_customer.phone) }
              : null,
          items: form.items,
          shipping: form.shipping,
          amount_paid: paid.toFixed(2),
          notes: form.notes,
          terms: form.terms,
          payment_instructions: form.payment_instructions,
          status: server?.status ?? "draft",
        }
      : null;

  const openPdf = async () => {
    if (!form) return;
    setPdfBusy(true);
    // Open the tab synchronously so mobile browsers don't block it as a popup.
    const tab = window.open("", "_blank");
    try {
      const { blob } = await api.blob(`/${path}/preview.pdf`, undefined, { ...form, shipping: form.shipping || "0" });
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (e) {
      tab?.close();
      toast.error("Couldn't create the PDF preview", errorMessage(e));
    } finally {
      setPdfBusy(false);
    }
  };

  // ---- render ----------------------------------------------------------------------
  if (loadError)
    return (
      <div className="mx-auto max-w-xl">
        <ErrorState message={loadError} />
        <Link to={`/${path}`} className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">Back to {path}</Link>
      </div>
    );
  if (!form || !doc || !business || !calc) return <LoadingBlock rows={8} />;

  const isEdit = !!doc.serverId;
  const totals = calc.totals;
  const balance = totals.total.minus(paid);
  const unsyncedEdit = doc.state !== "local" || (localId && doc.state === "local");
  const currencies = meta?.currencies ?? [{ code: "KES", symbol: "KSh", name: "Kenyan Shilling" }];

  const actionButtons = (
    <>
      <Button variant="secondary" icon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)}>Preview</Button>
      <Button variant="secondary" loading={saving === "draft"} disabled={!!saving} onClick={() => void save("draft")} icon={<HardDrive className="h-4 w-4" />}>
        {isEdit ? "Save changes" : "Save draft"}
      </Button>
      {(form.status ?? "draft") === "draft" && (
        <Button loading={saving === "sent"} disabled={!!saving} onClick={() => void save("sent")} icon={<Send className="h-4 w-4" />}>
          Save & mark sent
        </Button>
      )}
    </>
  );

  return (
    <div className="animate-fade-in">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <Link to={isEdit ? `/${path}/${doc.serverId}` : `/${path}`} className="mb-2 inline-flex items-center gap-1 text-[13px] font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
            <ArrowLeft className="h-4 w-4" /> {isEdit ? `Back to ${kind}` : `All ${path}`}
          </Link>
          <h1 className="text-[22px] font-semibold tracking-tight sm:text-2xl">{isEdit ? `Edit ${label.toLowerCase()} ${numberLabel}` : `New ${label.toLowerCase()}`}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-zinc-500">
            {unsyncedEdit && <SyncBadge state={doc.state} />}
            {autosavedAt && doc.state === "local" && <span>Autosaved on this device {fmtDateTime(autosavedAt)}</span>}
            {!online && <span>Offline — saving works, sync happens later.</span>}
          </div>
        </div>
        <div className="hidden flex-wrap gap-2 lg:flex">{actionButtons}</div>
      </div>

      {doc.state === "conflict" && (
        <Notice tone="red" className="mb-4">
          This {kind} was changed on another device. <Link to="/sync" className="font-medium underline">Review in the sync centre</Link> before saving again.
        </Notice>
      )}
      {saveError && <Notice tone="red" className="mb-4">{saveError}</Notice>}
      {isEdit && kind === "invoice" && paid.gt(0) && (
        <Notice tone="blue" className="mb-4">
          {money(paid, form.currency)} has already been recorded against this invoice. The new total can't be lower than that.
        </Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title={kind === "invoice" ? "Bill to" : "Prepared for"} description="Pick a saved customer or add a new one." />
            <CustomerPicker
              customers={customers}
              value={form.customer_id}
              newCustomer={form.new_customer}
              onPick={(c) => update({ customer_id: c?.id ?? null, new_customer: null })}
              onNew={() => setNewCustOpen(true)}
              error={showErrors && saving === null && saveError?.includes("customer") ? "Choose a customer before sending" : undefined}
            />
          </Card>

          <Card>
            <CardHeader title={`${label} details`} />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Field label={`${label} number`} hint={isEdit || doc.number ? undefined : "Assigned automatically when saved"}>
                <Input value={numberLabel} readOnly disabled aria-readonly />
              </Field>
              <Field label="Issue date" htmlFor="issue_date" error={showErrors ? errors.issue_date : null}>
                <Input
                  id="issue_date"
                  type="date"
                  value={form.issue_date}
                  onChange={(e) => {
                    const v = e.target.value;
                    const patch: Partial<DocumentInput> = { issue_date: v };
                    // Keep the same payment terms when the issue date moves.
                    if (v && form.issue_date && form[endKey]) {
                      const diff = Math.round((Date.parse(form[endKey] as string) - Date.parse(form.issue_date)) / 86_400_000);
                      patch[endKey] = addDays(v, diff);
                    }
                    update(patch);
                  }}
                />
              </Field>
              <Field label={kind === "invoice" ? "Due date" : "Valid until"} htmlFor="end_date" error={showErrors ? errors[endKey] : null}>
                <Input id="end_date" type="date" value={(form[endKey] as string) ?? ""} min={form.issue_date} onChange={(e) => update({ [endKey]: e.target.value })} />
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(kind === "invoice" ? [0, 7, 14, 30] : [7, 14, 30, 60]).map((d) => (
                    <button key={d} type="button" onClick={() => update({ [endKey]: addDays(form.issue_date, d) })} className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">
                      {d === 0 ? "On receipt" : `${d} days`}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Currency" htmlFor="currency">
                <Select id="currency" value={form.currency} onChange={(e) => update({ currency: e.target.value })}>
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Prices entered" hint={form.pricing_mode === "inclusive" ? "Unit prices already include tax." : "Tax is added on top of unit prices."}>
                <Segmented
                  className="w-full"
                  value={form.pricing_mode}
                  onChange={(v) => update({ pricing_mode: v })}
                  options={[
                    { value: "exclusive", label: "Excl. tax" },
                    { value: "inclusive", label: "Incl. tax" },
                  ]}
                />
              </Field>
              <Field label="Template" htmlFor="template">
                <Select id="template" value={form.template} onChange={(e) => update({ template: e.target.value as TemplateKey })}>
                  {TEMPLATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Items" description={showErrors && errors.items ? <span className="text-red-600">{errors.items}</span> : `${form.items.length} line${form.items.length === 1 ? "" : "s"}`} />
            <ItemsEditor items={form.items} onChange={(items) => update({ items })} taxRates={business.tax_rates} pricingMode={form.pricing_mode} currency={form.currency} showErrors={showErrors} defaultTax={defaultTax} />
          </Card>

          <Card>
            <CardHeader title="Notes & payment" description="Shown on the invoice. Defaults come from Settings." />
            <div className="space-y-4">
              <Field label="Payment instructions" htmlFor="pi" hint={!business.payment_instructions_preview ? <>Add M-Pesa and bank details in <Link to="/settings" className="underline">Settings</Link> to fill this automatically.</> : undefined}>
                <Textarea id="pi" rows={3} value={form.payment_instructions ?? ""} onChange={(e) => update({ payment_instructions: e.target.value })} maxLength={2000} />
              </Field>
              <Field label="Notes" htmlFor="notes" optional>
                <Textarea id="notes" rows={2} value={form.notes ?? ""} onChange={(e) => update({ notes: e.target.value || null })} maxLength={2000} placeholder="e.g. Thank you for your business!" />
              </Field>
              <Field label="Terms & conditions" htmlFor="terms" optional>
                <Textarea id="terms" rows={3} value={form.terms ?? ""} onChange={(e) => update({ terms: e.target.value || null })} maxLength={4000} />
              </Field>
            </div>
          </Card>

          <Card className="bg-zinc-50/60 dark:bg-zinc-900/30">
            <div className="flex items-start gap-3">
              <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">From: {business.profile.name}</p>
                <p className="truncate text-[13px] text-zinc-500">
                  {[business.profile.kra_pin && `KRA PIN ${business.profile.kra_pin}`, formatPhone(business.profile.phone), business.profile.email].filter(Boolean).join(" · ") || "Add your address, KRA PIN and contacts in Settings."}
                </p>
              </div>
              <Link to="/settings" className="shrink-0 text-[13px] font-medium text-brand-700 hover:underline dark:text-brand-300">Edit</Link>
            </div>
          </Card>
        </div>

        {/* Summary column */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader title="Summary" />
            <dl className="tnum space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-zinc-500">Subtotal</dt><dd>{money(totals.subtotal, form.currency)}</dd></div>
              {totals.discount_total.gt(0) && <div className="flex justify-between"><dt className="text-zinc-500">Discount</dt><dd>−{money(totals.discount_total, form.currency)}</dd></div>}
              {form.pricing_mode === "exclusive" && taxes.map((t) => (
                <div key={t.name + t.rate} className="flex justify-between"><dt className="text-zinc-500">{t.name} ({rate(t.rate)})</dt><dd>{money(t.amount, form.currency)}</dd></div>
              ))}
              <div className="flex items-center justify-between gap-3">
                <dt className="text-zinc-500"><label htmlFor="shipping">Shipping & charges</label></dt>
                <dd className="w-32">
                  <Input id="shipping" inputMode="decimal" value={form.shipping === "0" ? "" : form.shipping} placeholder="0.00" onChange={(e) => update({ shipping: e.target.value })} className="tnum h-9 text-right" invalid={!!(showErrors && errors.shipping)} />
                </dd>
              </div>
              <div className="flex justify-between border-t border-zinc-200 pt-3 text-base font-semibold dark:border-zinc-800">
                <dt>Total</dt>
                <dd>{money(totals.total, form.currency)}</dd>
              </div>
              {form.pricing_mode === "inclusive" && taxes.map((t) => (
                <div key={t.name + t.rate} className="flex justify-between text-xs text-zinc-500"><dt>Includes {t.name} ({rate(t.rate)})</dt><dd>{money(t.amount, form.currency)}</dd></div>
              ))}
              {kind === "invoice" && (
                <>
                  <div className="flex justify-between text-zinc-500"><dt>Amount paid</dt><dd>{money(paid, form.currency)}</dd></div>
                  <div className={cn("flex justify-between rounded-lg px-3 py-2 font-semibold", balance.lt(0) ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-900 dark:bg-brand-500/10 dark:text-brand-200")}>
                    <dt>Balance due</dt>
                    <dd>{money(balance, form.currency)}</dd>
                  </div>
                </>
              )}
            </dl>
            <p className="mt-3 text-xs text-zinc-500">
              {kind === "invoice" ? "Due" : "Valid until"} {fmtDate(form[endKey] as string)}. Totals are recalculated and stored by the server when saved.
            </p>
            <div className="mt-4 hidden flex-col gap-2 lg:flex">
              <Button variant="outline" icon={<FileText className="h-4 w-4" />} onClick={openPdf} loading={pdfBusy} disabled={!online}>
                {online ? "View PDF preview" : "PDF preview needs a connection"}
              </Button>
              {(doc.state !== "local" || dirty.current || localId) && (
                <Button variant="ghost" className="text-red-600" icon={<X className="h-4 w-4" />} onClick={() => void discard()}>
                  {isEdit ? "Discard changes" : "Discard draft"}
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Mobile sticky action bar */}
      {!isDesktop && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-zinc-200 bg-white/95 px-4 py-2.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-zinc-500">{kind === "invoice" ? "Balance due" : "Total"}</p>
              <p className="tnum truncate text-base font-semibold">{money(kind === "invoice" ? balance : totals.total, form.currency)}</p>
            </div>
            <Button variant="secondary" size="md" onClick={() => setPreview(true)} aria-label="Preview"><Eye className="h-4 w-4" /></Button>
            <Button variant="secondary" loading={saving === "draft"} disabled={!!saving} onClick={() => void save("draft")}>Save</Button>
            {(form.status ?? "draft") === "draft" && (
              <Button loading={saving === "sent"} disabled={!!saving} onClick={() => void save("sent")} icon={<Send className="h-4 w-4" />}>Send</Button>
            )}
          </div>
        </div>
      )}
      {!isDesktop && <div className="h-16" aria-hidden />}

      <Modal
        open={preview}
        onClose={() => setPreview(false)}
        title={`${label} preview`}
        description="Switch templates to compare. The downloadable PDF is generated by the server."
        size="xl"
        fullScreenMobile
        footer={
          <>
            <Button variant="secondary" onClick={() => setPreview(false)}>Close</Button>
            <Button variant="outline" icon={<FileText className="h-4 w-4" />} onClick={openPdf} loading={pdfBusy} disabled={!online}>
              {online ? "Open PDF" : "PDF needs a connection"}
            </Button>
          </>
        }
      >
        <div className="mb-4 -mx-1 overflow-x-auto px-1">
          <Segmented size="sm" value={form.template} onChange={(v) => update({ template: v })} options={TEMPLATES.map((t) => ({ value: t.value, label: t.label.split(" ")[0] }))} />
        </div>
        <div className="rounded-lg bg-zinc-100 p-2 sm:p-6 dark:bg-zinc-950">{previewModel && <DocumentPreview model={previewModel} />}</div>
      </Modal>

      <CustomerForm
        open={newCustOpen}
        onClose={() => setNewCustOpen(false)}
        offlineNote={!online}
        title="New customer"
        submitLabel={online ? "Save customer" : "Add to this draft"}
        onSubmit={async (c) => {
          if (online) {
            try {
              const created = await api.post<Customer>("/customers", c);
              setCustomers((xs) => [created, ...xs]);
              if (user) void cache.set(user.id, "customers:all", [created, ...customers]);
              update({ customer_id: created.id, new_customer: null });
              toast.success("Customer added", created.name);
              return;
            } catch (e) {
              if (!(e instanceof ApiError && e.network)) throw e;
            }
          }
          // Offline: the customer is created on the server in the same request as the draft.
          update({ customer_id: null, new_customer: c });
        }}
      />
    </div>
  );
}
