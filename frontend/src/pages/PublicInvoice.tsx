import { Download, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { StatusBadge } from "@/components/Status";
import { Button, Card, ErrorState, LoadingBlock } from "@/components/ui";
import { errorMessage, request, saveBlob } from "@/services/api";
import { fmtDate, money } from "@/utils/format";

interface PublicView {
  number: string;
  status: string;
  issue_date: string;
  due_date: string;
  currency: string;
  total: string;
  amount_paid: string;
  balance_due: string;
  business_name: string;
  business_email: string | null;
  business_phone: string | null;
  customer_name: string | null;
  payment_instructions: string | null;
  items: { description: string; quantity: string; line_total: string }[];
}

/** Read-only page a customer sees when they open a shared invoice link. */
export default function PublicInvoice() {
  const { token } = useParams();
  const [data, setData] = useState<PublicView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request<PublicView>(`/public/invoices/${token}`, { auth: false }).then(setData).catch((e) => setError(errorMessage(e)));
  }, [token]);

  const downloadPdf = async () => {
    setBusy(true);
    try {
      const res = await request<Response>(`/public/invoices/${token}/pdf`, { auth: false, raw: true, query: { download: true } });
      saveBlob(await res.blob(), `Invoice-${data?.number}.pdf`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-zinc-50 px-4 py-8 sm:py-14 dark:bg-[#0b0f14]">
      <div className="mx-auto max-w-xl">
        {error && !data ? (
          <ErrorState message={error} />
        ) : !data ? (
          <LoadingBlock rows={5} />
        ) : (
          <Card className="p-5 sm:p-7">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-zinc-500">Invoice from</p>
                <h1 className="text-xl font-semibold">{data.business_name}</h1>
              </div>
              <StatusBadge status={data.status} />
            </div>
            <div className="mt-6 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
              <p className="text-sm text-zinc-500">{data.number}{data.customer_name ? ` · for ${data.customer_name}` : ""}</p>
              <p className="tnum mt-1 text-3xl font-semibold">{money(data.balance_due, data.currency)}</p>
              <p className="mt-1 text-sm text-zinc-500">{data.status === "paid" ? "Paid in full — thank you." : `Due ${fmtDate(data.due_date, "DD MMM YYYY")}`}</p>
            </div>
            <ul className="mt-5 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {data.items.map((i, n) => (
                <li key={n} className="flex justify-between gap-4 py-2">
                  <span className="min-w-0 whitespace-pre-line">{i.description} <span className="text-zinc-400">× {i.quantity}</span></span>
                  <span className="tnum shrink-0">{money(i.line_total, data.currency)}</span>
                </li>
              ))}
              <li className="flex justify-between py-2 font-semibold"><span>Total</span><span className="tnum">{money(data.total, data.currency)}</span></li>
            </ul>
            {data.payment_instructions && data.status !== "paid" && (
              <div className="mt-5 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
                <p className="mb-1 font-medium">How to pay</p>
                <p className="whitespace-pre-line text-zinc-600 dark:text-zinc-300">{data.payment_instructions}</p>
                <p className="mt-2 text-xs text-zinc-500">Use <b>{data.number}</b> as your reference.</p>
              </div>
            )}
            <Button size="lg" className="mt-6 w-full" icon={<Download className="h-4 w-4" />} onClick={downloadPdf} loading={busy}>Download PDF</Button>
            <p className="mt-4 text-center text-xs text-zinc-500">
              {[data.business_phone, data.business_email].filter(Boolean).join(" · ")}
            </p>
          </Card>
        )}
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-zinc-400"><FileText className="h-3.5 w-3.5" /> Sent with InvoiceFlow</p>
      </div>
    </div>
  );
}
