import { FileDown, Plus, Search, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CustomerForm } from "@/components/CustomerForm";
import { useToast } from "@/components/Toast";
import { Button, Card, EmptyState, ErrorState, Input, LoadingBlock, Notice, PageHeader, Pagination, Toggle } from "@/components/ui";
import { useApp } from "@/hooks/useApp";
import { useDebounced, useQuery } from "@/hooks/useQuery";
import { api, download, errorMessage } from "@/services/api";
import type { Customer, CustomerWithStats, Page } from "@/types";
import { dec } from "@/utils/calc";
import { fmtDateTime, money } from "@/utils/format";
import { formatPhone } from "@/utils/phone";

export default function Customers() {
  const navigate = useNavigate();
  const toast = useToast();
  const { online } = useApp();
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const [page, setPage] = useState(1);
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const list = useQuery<Page<CustomerWithStats>>(
    (signal) => api.get("/customers", { q, page, page_size: 25, include_archived: archived }, signal),
    [q, page, archived],
    !q && page === 1 && !archived ? "customers:page1" : null,
  );
  const data = list.data;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Customers"
        description="Everyone you bill, with what they owe."
        actions={
          <>
            <Button variant="secondary" icon={<FileDown className="h-4 w-4" />} onClick={() => void download("/customers/export.csv", "customers.csv").catch((e) => toast.error("Export failed", errorMessage(e)))} disabled={!online}>
              Export CSV
            </Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)} disabled={!online}>New customer</Button>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input type="search" placeholder="Search name, company, phone or email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-9" aria-label="Search customers" />
        </div>
        <div className="sm:w-56"><Toggle checked={archived} onChange={(v) => { setArchived(v); setPage(1); }} label="Show archived" /></div>
      </div>
      {list.stale && <Notice tone="amber" className="mb-3">Offline — showing customers saved on {fmtDateTime(list.savedAt)}.</Notice>}
      <Card padded={false}>
        {list.error && !data ? (
          <div className="p-4"><ErrorState message={list.error} onRetry={list.reload} /></div>
        ) : !data ? (
          <div className="p-4"><LoadingBlock /></div>
        ) : data.items.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title={q ? "No matching customers" : "No customers yet"} description={q ? "Try another search." : "Add customers here or straight from the invoice form."} action={!q ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add customer</Button> : undefined} />
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                    <th className="px-4 py-3 font-medium">Customer</th>
                    <th className="px-4 py-3 font-medium">Contact</th>
                    <th className="px-4 py-3 text-right font-medium">Invoices</th>
                    <th className="px-4 py-3 text-right font-medium">Invoiced</th>
                    <th className="px-4 py-3 text-right font-medium">Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {data.items.map((c) => (
                    <tr key={c.id} className="cursor-pointer hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30" onClick={() => navigate(`/customers/${c.id}`)}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{c.name} {c.is_archived && <span className="text-xs text-zinc-400">(archived)</span>}</p>
                        {c.company && <p className="text-xs text-zinc-500">{c.company}</p>}
                      </td>
                      <td className="px-4 py-3 text-zinc-500">
                        <p>{formatPhone(c.phone)}</p>
                        <p className="text-xs">{c.email}</p>
                      </td>
                      <td className="tnum px-4 py-3 text-right">{c.invoice_count}</td>
                      <td className="tnum px-4 py-3 text-right">{money(c.total_invoiced, c.currency)}</td>
                      <td className={`tnum px-4 py-3 text-right font-medium ${dec(c.outstanding).gt(0) ? "text-amber-700 dark:text-amber-300" : ""}`}>{money(c.outstanding, c.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-zinc-100 md:hidden dark:divide-zinc-800">
              {data.items.map((c) => (
                <li key={c.id}>
                  <Link to={`/customers/${c.id}`} className="flex items-center gap-3 px-4 py-3.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-800 dark:bg-brand-500/10 dark:text-brand-200">{c.name.slice(0, 1).toUpperCase()}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{c.name}</p>
                      <p className="truncate text-[13px] text-zinc-500">{c.company || formatPhone(c.phone) || c.email || `${c.invoice_count} invoices`}</p>
                    </div>
                    <div className="text-right">
                      <p className={`tnum text-sm font-semibold ${dec(c.outstanding).gt(0) ? "text-amber-700 dark:text-amber-300" : ""}`}>{money(c.outstanding, c.currency)}</p>
                      <p className="text-[11px] text-zinc-500">owed</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <CustomerForm
        open={creating}
        onClose={() => setCreating(false)}
        onSubmit={async (c) => {
          try {
            const created = await api.post<Customer>("/customers", c);
            toast.success("Customer added", created.name);
            navigate(`/customers/${created.id}`);
          } catch (e) {
            throw new Error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}
