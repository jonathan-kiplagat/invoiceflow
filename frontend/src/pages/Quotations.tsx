import { FileSpreadsheet, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { StatusBadge, SyncBadge } from "@/components/Status";
import { Button, Card, EmptyState, ErrorState, Input, LoadingBlock, Notice, PageHeader, Pagination, Select } from "@/components/ui";
import { useApp } from "@/hooks/useApp";
import { useDebounced, useQuery } from "@/hooks/useQuery";
import { api } from "@/services/api";
import type { Page, QuotationSummary } from "@/types";
import { computeDocument } from "@/utils/calc";
import { fmtDate, money, STATUS_LABEL } from "@/utils/format";

export default function Quotations() {
  const navigate = useNavigate();
  const { localDocs } = useApp();
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const list = useQuery<Page<QuotationSummary>>((s) => api.get("/quotations", { q, status, page, page_size: 20 }, s), [q, status, page], !q && !status && page === 1 ? "quotations:page1" : null);
  const unsynced = useMemo(() => localDocs.filter((d) => d.kind === "quotation" && d.state !== "synced"), [localDocs]);
  const data = list.data;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Quotations" description="Estimates you can convert into invoices in one tap." actions={<Link to="/quotations/new"><Button icon={<Plus className="h-4 w-4" />}>New quotation</Button></Link>} />
      {unsynced.length > 0 && (
        <Card className="mb-4" padded={false}>
          <p className="border-b border-zinc-100 px-4 py-3 text-sm font-semibold dark:border-zinc-800">On this device, not yet on the server</p>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {unsynced.map((d) => (
              <li key={d.localId}>
                <Link to={`/quotations/local/${d.localId}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <span className="truncate text-sm font-medium">{d.label || "Untitled quotation"}</span>
                  <span className="flex items-center gap-2">
                    <span className="tnum text-sm">{money(computeDocument(d.payload.items, d.payload.shipping, d.payload.pricing_mode).totals.total, d.payload.currency)}</span>
                    <SyncBadge state={d.state} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input type="search" placeholder="Search number or customer" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-9" aria-label="Search quotations" />
        </div>
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="sm:w-48">
          <option value="">All statuses</option>
          {["draft", "sent", "accepted", "declined", "expired", "converted"].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
      </div>
      {list.stale && <Notice tone="amber" className="mb-3">Offline — showing quotations saved on this device.</Notice>}
      <Card padded={false}>
        {list.error && !data ? (
          <div className="p-4"><ErrorState message={list.error} onRetry={list.reload} /></div>
        ) : !data ? (
          <div className="p-4"><LoadingBlock /></div>
        ) : data.items.length === 0 ? (
          <EmptyState icon={<FileSpreadsheet className="h-6 w-6" />} title="No quotations yet" description="Send a quote first; convert it to an invoice once the customer agrees." action={<Link to="/quotations/new"><Button icon={<Plus className="h-4 w-4" />}>New quotation</Button></Link>} />
        ) : (
          <>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.items.map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => navigate(`/quotations/${x.id}`)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-zinc-50 sm:px-5 dark:hover:bg-zinc-800/40">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{x.customer_name ?? "No customer"}</p>
                      <p className="truncate text-[13px] text-zinc-500">{x.number} · issued {fmtDate(x.issue_date)} · valid until {fmtDate(x.valid_until)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="tnum font-semibold">{money(x.total, x.currency)}</span>
                      <StatusBadge status={x.status} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={20} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
