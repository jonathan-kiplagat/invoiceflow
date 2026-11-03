import { CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, Field, Input, Notice } from "@/components/ui";
import { useApp } from "@/hooks/useApp";
import { errorMessage } from "@/services/api";

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh]">
      <div className="hidden w-[44%] flex-col justify-between bg-brand-900 p-10 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <img src="/icons/favicon.svg" alt="" className="h-9 w-9 rounded-lg ring-1 ring-white/20" />
          <span className="text-lg font-semibold">InvoiceFlow</span>
        </div>
        <div>
          <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight">Invoices your customers take seriously. Payments you can actually track.</h2>
          <ul className="mt-8 space-y-3 text-[15px] text-brand-100">
            {[
              "Professional PDF invoices in four templates",
              "Record M-Pesa, bank and cash payments — partial or full",
              "KRA PIN, VAT and KSh formatting built in",
              "Works offline and syncs when you reconnect",
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-300" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-brand-200/70">Built for freelancers and small businesses in Kenya.</p>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <img src="/icons/favicon.svg" alt="" className="h-9 w-9 rounded-lg" />
            <span className="text-lg font-semibold">InvoiceFlow</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
          <div className="mt-7">{children}</div>
          <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">{footer}</p>
        </div>
      </div>
    </div>
  );
}

function PasswordInput(props: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={props.id} type={show ? "text" : "password"} value={props.value} onChange={(e) => props.onChange(e.target.value)} autoComplete={props.autoComplete} required invalid={props.invalid} className="pr-11" />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-zinc-400 hover:text-zinc-700" aria-label={show ? "Hide password" : "Show password"}>
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function Login() {
  const { login } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate((location.state as { from?: string } | null)?.from ?? "/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to manage your invoices." footer={<>New to InvoiceFlow? <Link to="/register" className="font-medium text-brand-700 hover:underline dark:text-brand-300">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="red">{error}</Notice>}
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="password">
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!email || !password}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

export function Register() {
  const { register } = useApp();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: "", business_name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (form.full_name.trim().length < 2) e.full_name = "Enter your name";
    if (form.business_name.trim().length < 2) e.business_name = "Enter your business name";
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) e.email = "Enter a valid email address";
    if (form.password.length < 8) e.password = "Use at least 8 characters";
    else if (/^\d+$/.test(form.password) || /^[a-zA-Z]+$/.test(form.password)) e.password = "Mix letters with numbers or symbols";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setError(null);
    try {
      await register({ ...form, email: form.email.trim() });
      navigate("/settings?welcome=1", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your account" subtitle="Free to start. Set up your business in a minute." footer={<>Already have an account? <Link to="/login" className="font-medium text-brand-700 hover:underline dark:text-brand-300">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="red">{error}</Notice>}
        <Field label="Your name" htmlFor="full_name" error={errors.full_name}>
          <Input id="full_name" autoComplete="name" value={form.full_name} onChange={(e) => set("full_name")(e.target.value)} invalid={!!errors.full_name} />
        </Field>
        <Field label="Business name" htmlFor="business_name" error={errors.business_name}>
          <Input id="business_name" autoComplete="organization" value={form.business_name} onChange={(e) => set("business_name")(e.target.value)} invalid={!!errors.business_name} />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email}>
          <Input id="email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(e) => set("email")(e.target.value)} invalid={!!errors.email} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password} hint="At least 8 characters, with letters and numbers or symbols.">
          <PasswordInput id="password" value={form.password} onChange={set("password")} autoComplete="new-password" invalid={!!errors.password} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
