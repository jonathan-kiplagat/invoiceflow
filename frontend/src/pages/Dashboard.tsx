import { AlertTriangle, ArrowRight, Banknote, FileText, Plus, Receipt, Users, Wallet } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CHART, DonutChart, HBarList, RevenueChart } from "@/components/Charts";
import { InstallBanner } from "@/components/Pwa";
import { StatusBadge } from "@/components/Status";
import { Button, Card, CardHeader, EmptyState, ErrorState, Notice, Select, Skeleton } from "@/components/ui";
import { useApp } from "@/hooks/useApp";
import { useQuery } from "@/hooks/useQuery";
import { api } from "@/services/api";
import type { Dec } from "@/types";
import { dec } from "@/utils/calc";
import { fmtDate, fmtDateTime, METHOD_LABEL, money, STATUS_LABEL } from "@/utils/format";

interface DashboardData {
  currency: string;
  currencies: string[];
  totals: { invoice_count: number; invoiced: Dec; collected: Dec; outstanding: Dec; overdue_amount: Dec; overdue_count: number; customer_count: number; draft_count: number };
  monthly: { month: string; invoiced: Dec; collected: Dec }[];
  paid_vs_unpaid: { paid_count: number; unpaid_count: number; collected: Dec; outstanding: Dec };
  status_counts: Record<string, number>;
  recent_invoices: { id: number; number: string; customer_name: string | null; status: string; total: Dec; balance_due: Dec; due_date: string; currency: string }[];
  recent_payments: { id: number; invoice_id: number; invoice_number: string; amount: Dec; method: string; payment_date: string; reference: string | null; currency: string }[];
}

function Stat({ label, value, icon, hint, tone = "default", to }: { label: string; value: ReactNode; icon: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "warn" | "bad"; to?: string }) {
  const tones = {
    default: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
    good: "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300",
    warn: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    bad: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300",
  };
  const body = (
    <Card className="h-full transition-shadow hover:shadow-pop">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>{icon}</span>
      </div>
      <p className="tnum mt-2 break-words text-xl font-semibold tracking-tight sm:text-[22px]">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </Card>
  );
  return to ? <Link to={to} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{body}</Link> : body;
}

export default function Dashboard() {
  const { business, user } = useApp();
  const [currency, setCurrency] = useState<string | null>(null);
  const q = useQuery<DashboardData>((signal) => api.get("/reports/dashboard", { currency }, signal), [currency], `dashboard:${currency ?? "default"}`);
  const d = q.data;
  const cur = d?.currency ?? business?.settings.default_currency ?? "KES";
  const hour = Number(new Intl.DateTimeFormat("en-KE", { hour: "numeric", hour12: false, timeZone: "Africa/Nairobi" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{greeting}, {user?.full_name.split(" ")[0]}</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">Dashboard</h1>
        </div>
        <div className="flex gap-2">
          {d && d.currencies.length > 1 && (
            <Select aria-label="Currency" value={cur} onChange={(e) => setCurrency(e.target.value)} className="w-28">
              {d.currencies.map((c) => <option key={c}>{c}</option>)}
            </Select>
          )}
          <Link to="/invoices/new" className="hidden sm:block">
            <Button icon={<Plus className="h-4 w-4" />}>New invoice</Button>
          </Link>
        </div>
      </div>

      <InstallBanner />
      {q.stale && <Notice tone="amber" className="mb-4">Showing figures saved on this device on {fmtDateTime(q.savedAt)}. They'll refresh when you're back online.</Notice>}
      {q.error && !d && <ErrorState message={q.error} onRetry={q.reload} />}

      {!d && q.loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[108px] rounded-xl" />)}
        </div>
      ) : d ? (
        <>
          <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Total invoiced" value={money(d.totals.invoiced, cur)} icon={<Receipt className="h-4 w-4" />} hint="Issued invoices, excl. drafts" to="/invoices" />
            <Stat label="Collected" value={money(d.totals.collected, cur)} icon={<Banknote className="h-4 w-4" />} tone="good" hint="Payments recorded" to="/payments" />
            <Stat label="Outstanding" value={money(d.totals.outstanding, cur)} icon={<Wallet className="h-4 w-4" />} tone="warn" hint="Still owed to you" to="/invoices?status=unpaid" />
            <Stat
              label="Overdue"
              value={money(d.totals.overdue_amount, cur)}
              icon={<AlertTriangle className="h-4 w-4" />}
              tone={d.totals.overdue_count ? "bad" : "default"}
              hint={`${d.totals.overdue_count} invoice${d.totals.overdue_count === 1 ? "" : "s"} past due`}
              to="/invoices?status=overdue"
            />
            <Stat label="Invoices" value={d.totals.invoice_count} icon={<FileText className="h-4 w-4" />} hint={`${d.totals.draft_count} draft${d.totals.draft_count === 1 ? "" : "s"}`} to="/invoices" />
            <Stat label="Customers" value={d.totals.customer_count} icon={<Users className="h-4 w-4" />} to="/customers" />
            <Stat label="Paid invoices" value={d.paid_vs_unpaid.paid_count} icon={<Banknote className="h-4 w-4" />} tone="good" to="/invoices?status=paid" />
            <Stat label="Unpaid invoices" value={d.paid_vs_unpaid.unpaid_count} icon={<Wallet className="h-4 w-4" />} tone="warn" to="/invoices?status=unpaid" />
          </section>

          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Monthly revenue" description={`Invoiced vs. actually collected, last 12 months (${cur})`} />
              <RevenueChart data={d.monthly} currency={cur} />
            </Card>
            <Card>
              <CardHeader title="Paid vs. unpaid" description="Value of issued invoices" />
              <DonutChart
                currency={cur}
                slices={[
                  { name: "Collected", value: dec(d.paid_vs_unpaid.collected).toNumber(), color: CHART.collected },
                  { name: "Outstanding", value: dec(d.paid_vs_unpaid.outstanding).toNumber(), color: CHART.outstanding },
                ]}
              />
            </Card>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            <Card padded={false} className="lg:col-span-2">
              <div className="flex items-center justify-between px-4 pt-4 sm:px-5 sm:pt-5">
                <h2 className="text-[15px] font-semibold">Recent invoices</h2>
                <Link to="/invoices" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline dark:text-brand-300">
                  View all <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              {d.recent_invoices.length === 0 ? (
                <EmptyState icon={<FileText className="h-6 w-6" />} title="No invoices yet" description="Create your first invoice — it takes about a minute." action={<Link to="/invoices/new"><Button icon={<Plus className="h-4 w-4" />}>Create invoice</Button></Link>} />
              ) : (
                <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
                  {d.recent_invoices.map((i) => (
                    <li key={i.id}>
                      <Link to={`/invoices/${i.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 sm:px-5 dark:hover:bg-zinc-800/40">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{i.customer_name ?? "No customer"}</p>
                          <p className="text-xs text-zinc-500">{i.number} · due {fmtDate(i.due_date)}</p>
                        </div>
                        <div className="text-right">
                          <p className="tnum text-sm font-medium">{money(i.total, i.currency)}</p>
                          <div className="mt-0.5"><StatusBadge status={i.status} /></div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Invoice status" />
              <HBarList
                rows={(["paid", "partially_paid", "sent", "overdue", "draft", "cancelled"] as const).map((s) => ({
                  label: STATUS_LABEL[s],
                  value: d.status_counts[s] ?? 0,
                  color: { paid: CHART.collected, partially_paid: CHART.outstanding, sent: "#0ea5e9", overdue: CHART.overdue, draft: "#a1a1aa", cancelled: "#d4d4d8" }[s],
                }))}
              />
            </Card>
          </div>

          <Card padded={false} className="mt-5">
            <div className="flex items-center justify-between px-4 pt-4 sm:px-5 sm:pt-5">
              <h2 className="text-[15px] font-semibold">Recent payments</h2>
              <Link to="/payments" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline dark:text-brand-300">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {d.recent_payments.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-zinc-500">No payments recorded yet. Record one from any sent invoice.</p>
            ) : (
              <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
                {d.recent_payments.map((p) => (
                  <li key={p.id}>
                    <Link to={`/invoices/${p.invoice_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 sm:px-5 dark:hover:bg-zinc-800/40">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                        <Banknote className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{METHOD_LABEL[p.method] ?? p.method} · {p.invoice_number}</p>
                        <p className="truncate text-xs text-zinc-500">{fmtDate(p.payment_date)}{p.reference ? ` · ${p.reference}` : ""}</p>
                      </div>
                      <p className="tnum text-sm font-semibold text-brand-700 dark:text-brand-300">+{money(p.amount, p.currency)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
