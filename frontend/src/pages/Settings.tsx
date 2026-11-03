import { Download, ImagePlus, Info, Monitor, Moon, Plus, Save, Smartphone, Sun, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useInstall } from "@/components/Pwa";
import { useToast } from "@/components/Toast";
import { Badge, Button, Card, CardHeader, ConfirmDialog, Field, IconButton, Input, LoadingBlock, Notice, Segmented, Select, Tabs, Textarea, Toggle } from "@/components/ui";
import { useApp } from "@/hooks/useApp";
import { api, auth, download, errorMessage } from "@/services/api";
import type { Business, BusinessProfile, BusinessSettings, TaxRate, Tokens, User } from "@/types";
import { dec } from "@/utils/calc";
import { normalizePhone, phoneError } from "@/utils/phone";

type Tab = "business" | "tax" | "invoicing" | "payments" | "data" | "account";

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {children}
    </Card>
  );
}

export default function SettingsPage() {
  const { business, setBusiness, online, meta } = useApp();
  const toast = useToast();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>("business");
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const welcome = params.get("welcome") === "1";

  useEffect(() => {
    if (business && !profile) {
      setProfile(business.profile);
      setSettings(business.settings);
    }
  }, [business, profile]);

  if (!business || !profile || !settings) return <LoadingBlock rows={6} />;

  const p = (k: keyof BusinessProfile) => (e: { target: { value: string } }) => setProfile({ ...profile, [k]: e.target.value });
  const s = <K extends keyof BusinessSettings>(k: K, v: BusinessSettings[K]) => setSettings({ ...settings, [k]: v });
  const st = (k: keyof BusinessSettings) => (e: { target: { value: string } }) => s(k, e.target.value as never);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!profile.name.trim()) e.name = "Business name is required";
    if (profile.email && !/^\S+@\S+\.\S+$/.test(profile.email.trim())) e.email = "Enter a valid email";
    if (profile.phone && phoneError(profile.phone)) e.phone = phoneError(profile.phone)!;
    if (profile.kra_pin && !/^[A-Za-z]\d{9}[A-Za-z]$/.test(profile.kra_pin.replace(/\s/g, ""))) e.kra_pin = "Format: letter, 9 digits, letter (e.g. P051234567X)";
    if (settings.mpesa_phone && phoneError(settings.mpesa_phone)) e.mpesa_phone = phoneError(settings.mpesa_phone)!;
    if (settings.mpesa_paybill && !/^\d+$/.test(settings.mpesa_paybill)) e.mpesa_paybill = "Digits only";
    if (settings.mpesa_till && !/^\d+$/.test(settings.mpesa_till)) e.mpesa_till = "Digits only";
    if (!settings.invoice_number_format.includes("{SEQ")) e.invoice_number_format = "Must include {SEQ} or {SEQ:4}";
    if (!settings.quote_number_format.includes("{SEQ")) e.quote_number_format = "Must include {SEQ} or {SEQ:4}";
    setErrors(e);
    return e;
  };

  const save = async () => {
    const e = validate();
    if (Object.keys(e).length) {
      toast.error("Please fix the highlighted fields", Object.values(e)[0]);
      return;
    }
    setSaving(true);
    try {
      const b = await api.put<Business>("/business", {
        profile: { ...profile, phone: profile.phone ? normalizePhone(profile.phone) : null, kra_pin: profile.kra_pin?.replace(/\s/g, "") || null },
        settings: { ...settings, mpesa_phone: settings.mpesa_phone ? normalizePhone(settings.mpesa_phone) : null },
      });
      setBusiness(b);
      setProfile(b.profile);
      setSettings(b.settings);
      toast.success("Settings saved", "New invoices will use these details.");
    } catch (err) {
      toast.error("Couldn't save settings", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const saveBar = (
    <div className="flex justify-end">
      <Button icon={<Save className="h-4 w-4" />} onClick={save} loading={saving} disabled={!online}>Save settings</Button>
    </div>
  );

  return (
    <div className="animate-fade-in">
      <div className="mb-5">
        <h1 className="text-[22px] font-semibold tracking-tight sm:text-2xl">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">Your business details fill in every new invoice automatically.</p>
      </div>
      {welcome && <Notice tone="green" className="mb-4">Welcome! Add your business details, KRA PIN and M-Pesa instructions so your first invoice looks complete.</Notice>}
      {!online && <Notice tone="amber" className="mb-4">You're offline. Settings can be viewed but saved only when you're back online.</Notice>}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "business", label: "Business" },
          { value: "tax", label: "Tax & KRA" },
          { value: "invoicing", label: "Invoicing" },
          { value: "payments", label: "Payment details" },
          { value: "data", label: "Data & backup" },
          { value: "account", label: "Account & app" },
        ]}
      />
      <div className="mt-5 space-y-5">
        {tab === "business" && (
          <>
            <LogoCard business={business} onChange={setBusiness} />
            <Section title="Business profile">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business name" htmlFor="b-name" required error={errors.name}><Input id="b-name" value={profile.name} onChange={p("name")} /></Field>
                <Field label="Email" htmlFor="b-email" error={errors.email}><Input id="b-email" type="email" value={profile.email ?? ""} onChange={p("email")} /></Field>
                <Field label="Phone" htmlFor="b-phone" error={errors.phone} hint="e.g. 0712 345 678"><Input id="b-phone" type="tel" value={profile.phone ?? ""} onChange={p("phone")} /></Field>
                <Field label="Website" htmlFor="b-web"><Input id="b-web" value={profile.website ?? ""} onChange={p("website")} placeholder="www.example.co.ke" /></Field>
                <Field label="Address" htmlFor="b-addr" className="sm:col-span-2"><Textarea id="b-addr" rows={2} value={profile.address ?? ""} onChange={p("address")} placeholder={"Building, street\nTown, Kenya"} /></Field>
                <Field label="Business registration number" htmlFor="b-reg" optional><Input id="b-reg" value={profile.registration_number ?? ""} onChange={p("registration_number")} /></Field>
              </div>
            </Section>
            {saveBar}
          </>
        )}

        {tab === "tax" && (
          <>
            <Notice tone="blue" icon={<Info className="h-4 w-4" />}>
              Tax rates are fully configurable — nothing is hard-coded. Confirm current rates with KRA or your accountant. InvoiceFlow is <b>not</b> integrated with KRA eTIMS and does not submit tax returns or issue electronic tax invoices.
            </Notice>
            <Section title="KRA & VAT registration">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="KRA PIN" htmlFor="kra" error={errors.kra_pin} hint="Printed on every invoice."><Input id="kra" value={profile.kra_pin ?? ""} onChange={(e) => setProfile({ ...profile, kra_pin: e.target.value.toUpperCase() })} placeholder="P051234567X" /></Field>
                <div className="sm:pt-7"><Toggle checked={profile.vat_registered} onChange={(v) => setProfile({ ...profile, vat_registered: v })} label="VAT registered" description="Show your VAT number on invoices." /></div>
                {profile.vat_registered && <Field label="VAT registration number" htmlFor="vat"><Input id="vat" value={profile.vat_number ?? ""} onChange={p("vat_number")} /></Field>}
              </div>
            </Section>
            <TaxRatesCard business={business} onChange={setBusiness} defaultId={settings.default_tax_rate_id} setDefault={(id) => s("default_tax_rate_id", id)} />
            <Section title="Default pricing" description="How unit prices on new invoices are treated.">
              <Segmented value={settings.pricing_mode} onChange={(v) => s("pricing_mode", v)} options={[{ value: "exclusive", label: "Tax exclusive (add tax on top)" }, { value: "inclusive", label: "Tax inclusive (prices include tax)" }]} />
            </Section>
            {saveBar}
          </>
        )}

        {tab === "invoicing" && (
          <>
            <Section title="Defaults for new documents">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Default currency" htmlFor="cur">
                  <Select id="cur" value={settings.default_currency} onChange={st("default_currency")}>
                    {(meta?.currencies ?? [{ code: "KES", name: "Kenyan Shilling", symbol: "KSh" }]).map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
                  </Select>
                </Field>
                <Field label="Payment terms (days)" htmlFor="terms-days"><Input id="terms-days" type="number" min={0} max={365} inputMode="numeric" value={settings.payment_terms_days} onChange={(e) => s("payment_terms_days", Math.max(0, Math.min(365, Number(e.target.value) || 0)))} /></Field>
                <Field label="Quotation validity (days)" htmlFor="quote-days"><Input id="quote-days" type="number" min={1} max={365} inputMode="numeric" value={settings.quote_validity_days} onChange={(e) => s("quote_validity_days", Math.max(1, Math.min(365, Number(e.target.value) || 1)))} /></Field>
                <Field label="Default template" htmlFor="tpl">
                  <Select id="tpl" value={settings.default_template} onChange={st("default_template")}>
                    <option value="modern">Modern Minimal</option>
                    <option value="corporate">Corporate Professional</option>
                    <option value="elegant">Elegant Business</option>
                    <option value="classic">Classic Standard</option>
                  </Select>
                </Field>
                <Field label="Date format" htmlFor="df">
                  <Select id="df" value={settings.date_format} onChange={st("date_format")}>
                    <option value="DD MMM YYYY">03 Nov 2026</option>
                    <option value="DD/MM/YYYY">03/11/2026</option>
                    <option value="YYYY-MM-DD">2026-11-03</option>
                  </Select>
                </Field>
                <Field label="Brand colour" htmlFor="accent" hint="Used by the templates.">
                  <div className="flex gap-2">
                    <input id="accent" type="color" value={settings.accent_color} onChange={(e) => s("accent_color", e.target.value.toUpperCase())} className="h-10 w-12 cursor-pointer rounded-lg border-0 bg-transparent p-0" />
                    <Input value={settings.accent_color} onChange={(e) => s("accent_color", e.target.value)} maxLength={7} aria-label="Brand colour hex" />
                  </div>
                </Field>
              </div>
              <div className="mt-4"><Toggle checked={settings.show_signature} onChange={(v) => s("show_signature", v)} label="Signature line" description="Add an authorised signature and date line to PDFs." /></div>
            </Section>
            <Section title="Numbering" description={<>Use {"{YYYY}"}, {"{YY}"}, {"{MM}"} and {"{SEQ:4}"} (zero-padded counter).</>}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Invoice number format" htmlFor="inf" error={errors.invoice_number_format} hint={`Next: ${business.invoice_number_preview}`}><Input id="inf" value={settings.invoice_number_format} onChange={st("invoice_number_format")} /></Field>
                <Field label="Next invoice number" htmlFor="ins"><Input id="ins" type="number" min={1} value={settings.next_invoice_seq} onChange={(e) => s("next_invoice_seq", Math.max(1, Number(e.target.value) || 1))} /></Field>
                <Field label="Quotation number format" htmlFor="qnf" error={errors.quote_number_format} hint={`Next: ${business.quote_number_preview}`}><Input id="qnf" value={settings.quote_number_format} onChange={st("quote_number_format")} /></Field>
                <Field label="Next quotation number" htmlFor="qns"><Input id="qns" type="number" min={1} value={settings.next_quote_seq} onChange={(e) => s("next_quote_seq", Math.max(1, Number(e.target.value) || 1))} /></Field>
              </div>
            </Section>
            <Section title="Default notes & terms">
              <div className="space-y-4">
                <Field label="Notes" htmlFor="dn"><Textarea id="dn" rows={2} value={settings.default_notes ?? ""} onChange={st("default_notes")} placeholder="Thank you for your business!" /></Field>
                <Field label="Terms & conditions" htmlFor="dt"><Textarea id="dt" rows={4} value={settings.default_terms ?? ""} onChange={st("default_terms")} /></Field>
              </div>
            </Section>
            {saveBar}
          </>
        )}

        {tab === "payments" && (
          <>
            <Notice tone="blue">These instructions are printed on invoices so customers know how to pay you. InvoiceFlow doesn't process M-Pesa or card payments — you record payments once you've received them.</Notice>
            <Section title="M-Pesa">
              <Segmented
                className="mb-4 flex w-full sm:inline-flex sm:w-auto"
                value={settings.mpesa_type}
                onChange={(v) => s("mpesa_type", v)}
                options={[{ value: "none", label: "None" }, { value: "paybill", label: "Paybill" }, { value: "till", label: "Buy Goods" }, { value: "phone", label: "Send Money" }]}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                {settings.mpesa_type === "paybill" && (
                  <>
                    <Field label="Paybill number" htmlFor="pb" error={errors.mpesa_paybill}><Input id="pb" inputMode="numeric" value={settings.mpesa_paybill ?? ""} onChange={st("mpesa_paybill")} /></Field>
                    <Field label="Account number" htmlFor="pba" hint="Leave blank to ask customers to use the invoice number."><Input id="pba" value={settings.mpesa_account ?? ""} onChange={st("mpesa_account")} /></Field>
                  </>
                )}
                {settings.mpesa_type === "till" && <Field label="Till number" htmlFor="till" error={errors.mpesa_till}><Input id="till" inputMode="numeric" value={settings.mpesa_till ?? ""} onChange={st("mpesa_till")} /></Field>}
                {settings.mpesa_type === "phone" && <Field label="M-Pesa phone number" htmlFor="mp" error={errors.mpesa_phone}><Input id="mp" type="tel" value={settings.mpesa_phone ?? ""} onChange={st("mpesa_phone")} /></Field>}
                {settings.mpesa_type !== "none" && <Field label="Registered name" htmlFor="mn" optional><Input id="mn" value={settings.mpesa_name ?? ""} onChange={st("mpesa_name")} /></Field>}
              </div>
            </Section>
            <Section title="Bank transfer">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Bank" htmlFor="bank"><Input id="bank" value={settings.bank_name ?? ""} onChange={st("bank_name")} placeholder="e.g. KCB, Equity, Co-op" /></Field>
                <Field label="Branch" htmlFor="branch" optional><Input id="branch" value={settings.bank_branch ?? ""} onChange={st("bank_branch")} /></Field>
                <Field label="Account name" htmlFor="an"><Input id="an" value={settings.bank_account_name ?? ""} onChange={st("bank_account_name")} /></Field>
                <Field label="Account number" htmlFor="ac"><Input id="ac" value={settings.bank_account_number ?? ""} onChange={st("bank_account_number")} /></Field>
                <Field label="SWIFT code" htmlFor="sw" optional><Input id="sw" value={settings.bank_swift ?? ""} onChange={st("bank_swift")} /></Field>
              </div>
            </Section>
            <Section title="Other instructions">
              <Textarea rows={3} value={settings.other_payment_instructions ?? ""} onChange={st("other_payment_instructions")} aria-label="Other payment instructions" placeholder="e.g. Cheques payable to …" />
            </Section>
            {business.payment_instructions_preview && (
              <Card className="bg-zinc-50 dark:bg-zinc-900/40">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Currently printed on invoices</p>
                <p className="whitespace-pre-line text-sm">{business.payment_instructions_preview}</p>
              </Card>
            )}
            {saveBar}
          </>
        )}

        {tab === "data" && <DataTab />}
        {tab === "account" && <AccountTab />}
      </div>
    </div>
  );
}

function LogoCard({ business, onChange }: { business: Business; onChange: (b: Business) => void }) {
  const toast = useToast();
  const { online } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) return toast.error("Logo is too large", "Use an image under 2 MB.");
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return toast.error("Unsupported file", "Upload a PNG, JPEG or WEBP image.");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      onChange(await api.upload<Business>("/business/logo", fd));
      toast.success("Logo updated");
    } catch (e) {
      toast.error("Upload failed", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Logo" description="PNG, JPEG or WEBP up to 2 MB. Shown on every template.">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex h-24 w-48 items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-900">
          {business.logo_data_url ? <img src={business.logo_data_url} alt="Business logo" className="max-h-full max-w-full object-contain" /> : <ImagePlus className="h-7 w-7 text-zinc-300" />}
        </div>
        <div className="flex gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          <Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => input.current?.click()} loading={busy} disabled={!online}>{business.logo_data_url ? "Replace" : "Upload logo"}</Button>
          {business.logo_data_url && (
            <Button variant="ghost" className="text-red-600" disabled={!online} onClick={async () => { try { onChange(await api.del<Business>("/business/logo")); } catch (e) { toast.error("Couldn't remove", errorMessage(e)); } }}>Remove</Button>
          )}
        </div>
      </div>
    </Section>
  );
}

function TaxRatesCard({ business, onChange, defaultId, setDefault }: { business: Business; onChange: (b: Business) => void; defaultId: number | null; setDefault: (id: number | null) => void }) {
  const toast = useToast();
  const { online } = useApp();
  const [name, setName] = useState("");
  const [rateVal, setRateVal] = useState("");
  const refresh = async () => onChange(await api.get<Business>("/business"));
  const add = async () => {
    if (!name.trim() || !/^\d{1,3}(\.\d{1,3})?$/.test(rateVal) || dec(rateVal).gt(100)) return toast.error("Enter a name and a rate between 0 and 100");
    try {
      await api.post("/tax-rates", { name: name.trim(), rate: rateVal });
      setName("");
      setRateVal("");
      await refresh();
    } catch (e) {
      toast.error("Couldn't add rate", errorMessage(e));
    }
  };
  const update = async (t: TaxRate, patch: Partial<TaxRate>) => {
    try {
      await api.put(`/tax-rates/${t.id}`, { name: t.name, rate: t.rate, is_active: t.is_active, ...patch });
      await refresh();
    } catch (e) {
      toast.error("Couldn't update rate", errorMessage(e));
    }
  };
  const remove = async (t: TaxRate) => {
    try {
      await api.del(`/tax-rates/${t.id}`);
      await refresh();
    } catch (e) {
      toast.error("Couldn't delete rate", errorMessage(e));
    }
  };
  return (
    <Section title="Tax rates" description="Available on invoice items. Existing invoices keep the rate they were saved with.">
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {business.tax_rates.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.name} <span className="tnum font-normal text-zinc-500">· {dec(t.rate).toString()}%</span> {defaultId === t.id && <Badge tone="brand">Default</Badge>} {!t.is_active && <Badge>Hidden</Badge>}</p>
            </div>
            <div className="flex items-center gap-1">
              {defaultId !== t.id ? <Button variant="ghost" size="sm" onClick={() => setDefault(t.id)}>Make default</Button> : <Button variant="ghost" size="sm" onClick={() => setDefault(null)}>Unset default</Button>}
              <Button variant="ghost" size="sm" onClick={() => void update(t, { is_active: !t.is_active })} disabled={!online}>{t.is_active ? "Hide" : "Show"}</Button>
              <IconButton label={`Delete ${t.name}`} onClick={() => void remove(t)} className="h-8 w-8 hover:text-red-600" disabled={!online}><Trash2 className="h-4 w-4" /></IconButton>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-col gap-2 border-t border-zinc-100 pt-4 sm:flex-row dark:border-zinc-800">
        <Input placeholder="Name, e.g. VAT (standard)" value={name} onChange={(e) => setName(e.target.value)} aria-label="New tax rate name" />
        <Input placeholder="Rate %" inputMode="decimal" value={rateVal} onChange={(e) => setRateVal(e.target.value)} className="sm:w-32" aria-label="New tax rate percentage" />
        <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={add} disabled={!online}>Add rate</Button>
      </div>
      <p className="mt-3 text-xs text-zinc-500">Remember to press “Save settings” after changing the default rate.</p>
    </Section>
  );
}

function DataTab() {
  const toast = useToast();
  const { online, reloadBusiness } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const dl = (path: string, name: string) => void download(path, name).catch((e) => toast.error("Download failed", errorMessage(e)));
  const restore = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("confirm", "REPLACE");
      const r = await api.upload<{ restored: Record<string, number> }>("/backup/restore", fd);
      await reloadBusiness();
      toast.success("Backup restored", `${r.restored.invoices} invoices, ${r.restored.customers} customers, ${r.restored.quotations} quotations`);
      setConfirm(false);
      setFile(null);
    } catch (e) {
      toast.error("Restore failed — nothing was changed", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Section title="Export to CSV" description="Open in Excel or Google Sheets.">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => dl("/invoices/export.csv", "invoices.csv")} disabled={!online}>Invoices</Button>
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => dl("/payments/export.csv", "payments.csv")} disabled={!online}>Payments</Button>
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => dl("/customers/export.csv", "customers.csv")} disabled={!online}>Customers</Button>
        </div>
      </Section>
      <Section title="Backup" description="A complete copy of your business data (settings, customers, invoices, payments, quotations) as a JSON file.">
        <Button icon={<Download className="h-4 w-4" />} onClick={() => dl("/backup/export", "invoiceflow-backup.json")} disabled={!online}>Download backup</Button>
      </Section>
      <Section title="Restore from backup" description="Replaces ALL current data in this account with the backup. Download a fresh backup first.">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium dark:file:bg-zinc-800" aria-label="Backup file" />
          <Button variant="danger" onClick={() => setConfirm(true)} disabled={!file || !online}>Restore…</Button>
        </div>
      </Section>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={restore}
        loading={busy}
        danger
        requireText="REPLACE"
        title="Replace all data?"
        confirmLabel="Replace my data"
        message={<>Everything in this account will be replaced by <b>{file?.name}</b>. If the file is invalid, nothing is changed.</>}
      />
    </>
  );
}

function AccountTab() {
  const { user, theme, setTheme, meta } = useApp();
  const toast = useToast();
  const inst = useInstall();
  const [name, setName] = useState(user?.full_name ?? "");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <>
      <Section title="Appearance">
        <Segmented
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: <span className="inline-flex items-center gap-1.5"><Sun className="h-3.5 w-3.5" /> Light</span> },
            { value: "dark", label: <span className="inline-flex items-center gap-1.5"><Moon className="h-3.5 w-3.5" /> Dark</span> },
            { value: "system", label: <span className="inline-flex items-center gap-1.5"><Monitor className="h-3.5 w-3.5" /> System</span> },
          ]}
        />
      </Section>
      <Section title="Install the app" description="Add InvoiceFlow to your home screen or desktop for an app-like experience and offline access.">
        {inst.installed ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-300">You're using the installed app.</p>
        ) : inst.canPrompt ? (
          <Button icon={<Smartphone className="h-4 w-4" />} onClick={() => void inst.install()}>Install InvoiceFlow</Button>
        ) : inst.ios ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">On iPhone or iPad: open in Safari, tap Share, then “Add to Home Screen”.</p>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Use your browser's menu (“Install app” / “Add to Home screen”). Chrome, Edge and Samsung Internet support installation.</p>
        )}
      </Section>
      <Section title="Email delivery">
        {meta?.email_integration_enabled ? (
          <p className="text-sm">Email sending is <b className="text-emerald-700 dark:text-emerald-300">configured</b> on this server. Invoices can be emailed with the PDF attached.</p>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">Email sending is <b>not configured</b> on this server. You can still prepare an email and attach the downloaded PDF in your own email app. Administrators can enable it by setting the SMTP variables (see README).</p>
        )}
      </Section>
      <Section title="Your profile">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Full name" htmlFor="fn" className="flex-1"><Input id="fn" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Button
            variant="secondary"
            loading={busy === "name"}
            onClick={async () => {
              setBusy("name");
              try {
                const u = await api.patch<User>("/auth/me", { full_name: name });
                auth.setUser(u);
                toast.success("Profile updated");
              } catch (e) {
                toast.error("Couldn't update", errorMessage(e));
              } finally {
                setBusy(null);
              }
            }}
          >
            Update name
          </Button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">Signed in as {user?.email}</p>
      </Section>
      <Section title="Change password" description="Signs you out on other devices.">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Current password" htmlFor="cp"><Input id="cp" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="New password" htmlFor="np"><Input id="np" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Button
            variant="secondary"
            loading={busy === "pw"}
            disabled={!pw.current || pw.next.length < 8}
            onClick={async () => {
              setBusy("pw");
              try {
                const tokens = await api.post<Tokens>("/auth/change-password", { current_password: pw.current, new_password: pw.next });
                auth.setTokens(tokens);
                setPw({ current: "", next: "" });
                toast.success("Password changed");
              } catch (e) {
                toast.error("Couldn't change password", errorMessage(e));
              } finally {
                setBusy(null);
              }
            }}
          >
            Change
          </Button>
        </div>
      </Section>
    </>
  );
}
