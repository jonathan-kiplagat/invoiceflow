import { FileDown, Info } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { CHART, HBarList, RevenueChart } from "@/components/Charts";
import { useToast } from "@/components/Toast";
import { Button, Card, CardHeader, ErrorState, LoadingBlock, Menu, Notice, PageHeader, Select } from "@/components/ui";
import { useApp } from "@/hooks/useApp";
import { useQuery } from "@/hooks/useQuery";
import { api, download, errorMessage } from "@/services/api";
import type { Dec } from "@/types";
import { dec } from "@/utils/calc";
import { METHOD_LABEL, money, todayNairobi } from "@/utils/format";

interface Summary {
  year: number;
  currency: string;
  ytd_invoiced: Dec;
  ytd_collected: Dec;
  outstanding: Dec;
  overdue: Dec;
  overdue_count: number;
  monthly: { month: string; invoiced: Dec; collected: Dec }[];
  aging: Record<"current" | "1_30" | "31_60" | "61_90" | "90_plus", Dec>;
  customers: { customer_id: number; name: string; invoice_count: number; invoiced: Dec; paid: Dec; outstanding: Dec; avg_days_to_pay: number | null; on_time_rate: number | null }[];
  top_customers: Summary["customers"];
  payment_methods: { method: string; amount: Dec; count: number }[];
  quotations: { issued: number; accepted: number; converted: number; conversion_rate: number | null; converted_value: Dec };
}

const AGING_LABEL = { current: "Not yet due", "1_30": "1–30 days overdue", "31_60": "31–60 days", "61_90": "61–90 days", "90_plus": "90+ days" };

export default function Reports() {
  const toast = useToast();
  const { business } = useApp();
  const thisYear = Number(todayNairobi().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [currency, setCurrency] = useState(business?.settings.default_currency ?? "KES");
  const q = useQuery<Summary>((s) => api.get("/reports/summary", { year, currency }, s), [year, currency], `reports:${year}:${currency}`);
  const d = q.data;
  const exportCsv = (name: string) => void download(`/reports/export/${name}.csv`, `report-${name}.csv`, { year, currency }).catch((e) => toast.error("Export failed", errorMessage(e)));

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Reports"
        description="Calculated only from invoices you issued and payments you recorded."
        actions={
          <>
            <Select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28">
              {Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => <option key={y}>{y}</option>)}
            </Select>
            <Select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-28">
              {["KES", "USD", "EUR", "GBP", "TZS", "ZAR", "NGN", "AED", "INR", "CNY", "CAD", "AUD", "CHF"].map((c) => <option key={c}>{c}</option>)}
            </Select>
            <Menu
              trigger={(p) => <Button variant="secondary" icon={<FileDown className="h-4 w-4" />} {...p}>Export CSV</Button>}
              items={[
                { label: "Monthly revenue", onClick: () => exportCsv("monthly") },
                { label: "Customer performance", onClick: () => exportCsv("customers") },
                { label: "Payment methods", onClick: () => exportCsv("payment-methods") },
                { label: "Receivables ageing", onClick: () => exportCsv("aging") },
              ]}
            />
          </>
        }
      />
      <Notice tone="blue" icon={<Info className="h-4 w-4" />} className="mb-5">
        <b>Invoiced</b> is what you billed (issued invoices, by issue date). <b>Collected</b> is money you recorded as received (by payment date). <b>Outstanding</b> is still owed — it is never counted as cash.
      </Notice>
      {q.stale && <Notice tone="amber" className="mb-4">Offline — showing figures saved on this device.</Notice>}
      {q.error && !d ? (
        <ErrorState message={q.error} onRetry={q.reload} />
      ) : !d ? (
        <LoadingBlock rows={6} />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: `Invoiced ${year === thisYear ? "year to date" : year}`, value: d.ytd_invoiced },
              { label: `Collected ${year === thisYear ? "year to date" : year}`, value: d.ytd_collected, tone: "text-brand-700 dark:text-brand-300" },
              { label: "Outstanding receivables", value: d.outstanding, tone: "text-amber-700 dark:text-amber-300" },
              { label: `Overdue (${d.overdue_count})`, value: d.overdue, tone: d.overdue_count ? "text-red-600 dark:text-red-400" : "" },
            ].map((s) => (
              <Card key={s.label}>
                <p className="text-[13px] text-zinc-500">{s.label}</p>
                <p className={`tnum mt-1.5 break-words text-xl font-semibold ${s.tone ?? ""}`}>{money(s.value, d.currency)}</p>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader title={`Revenue by month — ${year}`} description="Invoiced vs. collected" />
            <RevenueChart data={d.monthly} currency={d.currency} height={280} />
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Receivables ageing" description="Outstanding balances by how late they are, today" />
              <HBarList
                format={(v) => money(v, d.currency)}
                rows={(Object.keys(AGING_LABEL) as (keyof typeof AGING_LABEL)[]).map((k) => ({
                  label: AGING_LABEL[k],
                  value: dec(d.aging[k]).toNumber(),
                  color: k === "current" ? CHART.outstanding : CHART.overdue,
                }))}
              />
            </Card>
            <Card>
              <CardHeader title="Payment methods" description={`Collected in ${year}`} />
              {d.payment_methods.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-500">No payments recorded in {year}.</p>
              ) : (
                <HBarList format={(v) => money(v, d.currency)} rows={d.payment_methods.map((m) => ({ label: `${METHOD_LABEL[m.method] ?? m.method} · ${m.count}`, value: dec(m.amount).toNumber() }))} />
              )}
            </Card>
            <Card>
              <CardHeader title="Top customers" description="By value invoiced (all time)" />
              {d.top_customers.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-500">No issued invoices yet.</p>
              ) : (
                <HBarList format={(v) => money(v, d.currency)} rows={d.top_customers.map((c) => ({ label: c.name, value: dec(c.invoiced).toNumber(), hint: `${money(c.outstanding, d.currency)} outstanding` }))} />
              )}
            </Card>
            <Card>
              <CardHeader title="Quotation conversion" description={`Quotations sent in ${year}`} />
              <div className="grid grid-cols-3 gap-3 text-center">
                <div><p className="tnum text-2xl font-semibold">{d.quotations.issued}</p><p className="text-xs text-zinc-500">Sent</p></div>
                <div><p className="tnum text-2xl font-semibold">{d.quotations.accepted}</p><p className="text-xs text-zinc-500">Accepted</p></div>
                <div><p className="tnum text-2xl font-semibold text-brand-700 dark:text-brand-300">{d.quotations.converted}</p><p className="text-xs text-zinc-500">Invoiced</p></div>
              </div>
              <p className="mt-4 text-center text-sm text-zinc-600 dark:text-zinc-300">
                {d.quotations.conversion_rate == null ? "No quotations sent yet." : <>Conversion rate <b>{d.quotations.conversion_rate}%</b> · {money(d.quotations.converted_value, d.currency)} converted</>}
              </p>
            </Card>
          </div>

          <Card padded={false}>
            <div className="px-4 pt-4 sm:px-5 sm:pt-5">
              <h2 className="text-[15px] font-semibold">Customer payment performance</h2>
              <p className="text-[13px] text-zinc-500">Average days from issue to final payment, and share of invoices paid by the due date.</p>
            </div>
            {d.customers.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-zinc-500">No data yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-y border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                      <th className="px-4 py-2.5 font-medium sm:px-5">Customer</th>
                      <th className="px-4 py-2.5 text-right font-medium">Invoices</th>
                      <th className="px-4 py-2.5 text-right font-medium">Invoiced</th>
                      <th className="px-4 py-2.5 text-right font-medium">Outstanding</th>
                      <th className="px-4 py-2.5 text-right font-medium">Avg. days to pay</th>
                      <th className="px-4 py-2.5 text-right font-medium sm:pr-5">Paid on time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {d.customers.map((c) => (
                      <tr key={c.customer_id}>
                        <td className="px-4 py-2.5 sm:px-5"><Link to={`/customers/${c.customer_id}`} className="font-medium hover:underline">{c.name}</Link></td>
                        <td className="tnum px-4 py-2.5 text-right">{c.invoice_count}</td>
                        <td className="tnum px-4 py-2.5 text-right">{money(c.invoiced, d.currency)}</td>
                        <td className="tnum px-4 py-2.5 text-right">{money(c.outstanding, d.currency)}</td>
                        <td className="tnum px-4 py-2.5 text-right">{c.avg_days_to_pay ?? "—"}</td>
                        <td className="tnum px-4 py-2.5 text-right sm:pr-5">{c.on_time_rate == null ? "—" : `${c.on_time_rate}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
