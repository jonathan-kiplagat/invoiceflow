import { Check, Copy, Download, Link2, Link2Off, Mail, MessageCircle, Printer, Send, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Field, Input, Modal, Notice, Textarea, Toggle } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { useApp } from "@/hooks/useApp";
import { api, errorMessage, saveBlob } from "@/services/api";
import type { Invoice, ShareInfo } from "@/types";

type Step = "menu" | "email";

/**
 * Sharing never claims delivery: WhatsApp/email apps are only opened with a prepared message,
 * native share hands the file to the OS, and SMTP sends report "accepted by the mail server".
 */
export function ShareSheet({ invoice, open, onClose, onMarkSent }: { invoice: Invoice; open: boolean; onClose: () => void; onMarkSent: () => void }) {
  const toast = useToast();
  const { online } = useApp();
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [step, setStep] = useState<Step>("menu");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState({ to: "", subject: "", body: "", attach: true });
  const [emailResult, setEmailResult] = useState<{ status: "accepted" | "failed"; detail: string } | null>(null);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("menu");
    setEmailResult(null);
    setShared(false);
    api
      .get<ShareInfo>(`/invoices/${invoice.id}/share-info`)
      .then((i) => {
        setInfo(i);
        setEmail({ to: i.email_to ?? "", subject: i.email_subject, body: i.email_body, attach: true });
      })
      .catch((e) => toast.error("Couldn't load sharing options", errorMessage(e)));
  }, [open, invoice.id, toast]);

  const pdfFile = async () => {
    const { blob } = await api.blob(`/invoices/${invoice.id}/pdf`, { download: true });
    return new File([blob], `Invoice-${invoice.number}.pdf`, { type: "application/pdf" });
  };

  const toggleLink = async (on: boolean) => {
    setBusy("link");
    try {
      const i = on ? await api.post<ShareInfo>(`/invoices/${invoice.id}/share-link`) : await api.del<ShareInfo>(`/invoices/${invoice.id}/share-link`);
      setInfo(i);
      if (on && invoice.status === "draft") toast.info("Link created", "Customers can open it once the invoice is marked as sent.");
    } catch (e) {
      toast.error("Couldn't update the link", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async () => {
    if (!info?.share_url) return;
    try {
      await navigator.clipboard.writeText(info.share_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy", "Select and copy the link manually.");
    }
  };

  const nativeShare = async () => {
    setBusy("native");
    try {
      const file = await pdfFile();
      const data: ShareData = { title: `Invoice ${invoice.number}`, text: info?.whatsapp_message };
      if (navigator.canShare?.({ files: [file] })) data.files = [file];
      else if (info?.share_url) data.url = info.share_url;
      await navigator.share(data);
      setShared(true);
      toast.info("Handed to your share menu", "We can't confirm whether the other app delivered it.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error("Sharing didn't complete", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const downloadPdf = async () => {
    setBusy("pdf");
    try {
      saveBlob(await pdfFile(), `Invoice-${invoice.number}.pdf`);
    } catch (e) {
      toast.error("Couldn't download PDF", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const print = async () => {
    const tab = window.open("", "_blank");
    try {
      const { blob } = await api.blob(`/invoices/${invoice.id}/pdf`);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (e) {
      tab?.close();
      toast.error("Couldn't open PDF", errorMessage(e));
    }
  };

  const sendEmail = async () => {
    setBusy("email");
    setEmailResult(null);
    try {
      const r = await api.post<{ status: "accepted" | "failed"; detail: string }>(`/invoices/${invoice.id}/email`, {
        to: email.to.trim(), subject: email.subject, body: email.body, attach_pdf: email.attach,
      });
      setEmailResult(r);
      if (r.status === "accepted") setShared(true);
    } catch (e) {
      setEmailResult({ status: "failed", detail: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const canNativeShare = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <Modal open={open} onClose={onClose} title={step === "email" ? "Email invoice" : `Share ${invoice.number}`} description={step === "menu" ? "Download, print or send it to your customer." : undefined}>
      {!online && <Notice tone="amber" className="mb-4">Sharing needs a connection, because the PDF is generated on the server.</Notice>}
      {step === "menu" ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { key: "pdf", icon: Download, label: "Download PDF", onClick: downloadPdf },
              { key: "print", icon: Printer, label: "Print", onClick: print },
              { key: "whatsapp", icon: MessageCircle, label: "WhatsApp", onClick: () => { if (info) { window.open(info.whatsapp_url, "_blank", "noopener"); setShared(true); } } },
              { key: "email", icon: Mail, label: "Email", onClick: () => setStep("email") },
            ].map(({ key, icon: Icon, label, onClick }) => (
              <button
                key={key}
                type="button"
                onClick={() => void onClick()}
                disabled={!online || !info || busy === key}
                className="flex flex-col items-center gap-2 rounded-xl border border-zinc-200 px-2 py-4 text-[13px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <Icon className={key === "whatsapp" ? "h-6 w-6 text-emerald-600" : "h-6 w-6 text-brand-700 dark:text-brand-300"} />
                {label}
              </button>
            ))}
          </div>

          {canNativeShare && (
            <Button variant="secondary" className="w-full" icon={<Share2 className="h-4 w-4" />} onClick={nativeShare} loading={busy === "native"} disabled={!online || !info}>
              Share PDF with another app…
            </Button>
          )}

          <div className="rounded-xl border border-zinc-200 p-3.5 dark:border-zinc-800">
            <Toggle
              checked={!!info?.share_url}
              onChange={(v) => void toggleLink(v)}
              label="Shareable link"
              description="Anyone with the link can view and download this invoice. Turn it off any time."
            />
            {info?.share_url && (
              <div className="mt-3 flex gap-2">
                <Input readOnly value={info.share_url} aria-label="Share link" onFocus={(e) => e.target.select()} className="text-[13px]" />
                <Button variant="secondary" onClick={copyLink} icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}>
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            )}
          </div>

          <Notice tone="blue" icon={<MessageCircle className="h-4 w-4" />}>
            {info?.whatsapp_phone ? <>WhatsApp opens a chat with <b>{info.whatsapp_phone}</b> and a ready-to-send message.</> : <>No phone number on this customer, so WhatsApp will ask who to send to.</>}{" "}
            WhatsApp links can't attach files — {info?.share_url ? "the message includes your invoice link." : "turn on the shareable link above to include it, or use “Share PDF with another app”."}
          </Notice>

          {shared && invoice.status === "draft" && (
            <Notice tone="amber" icon={<Send className="h-4 w-4" />}>
              Did you send it? InvoiceFlow can't tell whether your customer received it.
              <Button size="sm" className="mt-2 block" onClick={onMarkSent}>Mark as sent</Button>
            </Notice>
          )}
          {info && !info.share_url && (
            <p className="flex items-center gap-1.5 text-xs text-zinc-500"><Link2Off className="h-3.5 w-3.5" /> No public link exists for this invoice.</p>
          )}
          {info?.share_url && (
            <p className="flex items-center gap-1.5 text-xs text-zinc-500"><Link2 className="h-3.5 w-3.5" /> Public link is on.</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {info && !info.email_integration_enabled ? (
            <>
              <Notice tone="amber">
                Email sending isn't configured on this server, so InvoiceFlow can't send it for you. Download the PDF, then open your email app — the message below is prepared for you to attach it.
              </Notice>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={downloadPdf} loading={busy === "pdf"}>1. Download PDF</Button>
                <a href={info.mailto_url} className="sm:flex-1" onClick={() => setShared(true)}>
                  <Button className="w-full" icon={<Mail className="h-4 w-4" />}>2. Open email app</Button>
                </a>
              </div>
              <Textarea readOnly rows={8} value={`Subject: ${info.email_subject}\n\n${info.email_body}`} aria-label="Prepared email" className="text-[13px]" />
            </>
          ) : (
            <>
              <Field label="To" htmlFor="em-to">
                <Input id="em-to" type="email" value={email.to} onChange={(e) => setEmail({ ...email, to: e.target.value })} />
              </Field>
              <Field label="Subject" htmlFor="em-sub">
                <Input id="em-sub" value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} />
              </Field>
              <Field label="Message" htmlFor="em-body">
                <Textarea id="em-body" rows={8} value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} />
              </Field>
              <Toggle checked={email.attach} onChange={(v) => setEmail({ ...email, attach: v })} label="Attach PDF" />
              {emailResult && (
                <Notice tone={emailResult.status === "accepted" ? "green" : "red"}>
                  {emailResult.status === "accepted" ? "Sent to the mail server. " : ""}
                  {emailResult.detail}
                  {emailResult.status === "accepted" && " Delivery to the inbox can't be confirmed."}
                </Notice>
              )}
              {shared && invoice.status === "draft" && <Button variant="outline" onClick={onMarkSent}>Mark invoice as sent</Button>}
            </>
          )}
          <div className="flex justify-between gap-2 pt-1">
            <Button variant="ghost" onClick={() => setStep("menu")}>Back</Button>
            {info?.email_integration_enabled && (
              <Button icon={<Send className="h-4 w-4" />} onClick={sendEmail} loading={busy === "email"} disabled={!email.to.trim() || !online}>
                Send email
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
