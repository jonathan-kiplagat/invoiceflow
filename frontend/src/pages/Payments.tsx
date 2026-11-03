import { Banknote, FileDown, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "@/components/Toast";
import { Card, EmptyState, ErrorState, Input, LoadingBlock, Notice, PageHeader, Pagination, Select, Button } from "@/components/ui";
import { useDebounced, useQuery } from "@/hooks/useQuery";
import { api, download, errorMessage } from "@/services/api";
import type { Page, PaymentListItem } from "@/types";
import { fmtDate, METHOD_LABEL, money } from "@/utils/format";

export default function Payments() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const [method, setMethod] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const list = useQuery<Page<PaymentListItem>>(
    (s) => api.get("/payments", { q, method, date_from: from, date_to: to, page, page_size: 25 }, s),
    [q, method, from, to, page],
    !q && !method && !from && !to && page === 1 ? "payments:page1" : null,
  );
  const data = list.data;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Payments"
        description="Money recorded as received. Record new payments from an invoice."
        actions={<Button variant="secondary" icon={<FileDown className="h-4 w-4" />} onClick={() => void download("/payments/export.csv", "payments.csv").catch((e) => toast.error("Export failed", errorMessage(e)))}>Export CSV</Button>}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input type="search" placeholder="Invoice, customer or reference" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-9" aria-label="Search payments" />
        </div>
        <Select aria-label="Method" value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }}>
          <option value="">All methods</option>
          {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Input type="date" aria-label="From date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        <Input type="date" aria-label="To date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
      </div>
      {list.stale && <Notice tone="amber" className="mb-3">Offline — showing payments saved on this device.</Notice>}
      <Card padded={false}>
        {list.error && !data ? (
          <div className="p-4"><ErrorState message={list.error} onRetry={list.reload} /></div>
        ) : !data ? (
          <div className="p-4"><LoadingBlock /></div>
        ) : data.items.length === 0 ? (
          <EmptyState icon={<Banknote className="h-6 w-6" />} title="No payments found" description="Open a sent invoice and choose “Record payment” when your customer pays." />
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Invoice</th>
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Method</th>
                    <th className="px-4 py-3 font-medium">Reference</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {data.items.map((p) => (
                    <tr key={p.id} className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30">
                      <td className="px-4 py-3 text-zinc-500">{fmtDate(p.payment_date)}</td>
                      <td className="px-4 py-3"><Link to={`/invoices/${p.invoice_id}`} className="font-medium hover:underline">{p.invoice_number}</Link></td>
                      <td className="px-4 py-3">{p.customer_name ?? "—"}</td>
                      <td className="px-4 py-3">{METHOD_LABEL[p.method]}</td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-500">{p.reference ?? "—"}</td>
                      <td className="tnum px-4 py-3 text-right font-medium text-brand-700 dark:text-brand-300">{money(p.amount, p.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-zinc-100 md:hidden dark:divide-zinc-800">
              {data.items.map((p) => (
                <li key={p.id}>
                  <Link to={`/invoices/${p.invoice_id}`} className="flex items-center gap-3 px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{p.customer_name ?? p.invoice_number}</p>
                      <p className="truncate text-[13px] text-zinc-500">{METHOD_LABEL[p.method]} · {fmtDate(p.payment_date)} · {p.invoice_number}</p>
                    </div>
                    <p className="tnum font-semibold text-brand-700 dark:text-brand-300">{money(p.amount, p.currency)}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
