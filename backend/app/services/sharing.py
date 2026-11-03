"""Invoice sharing: WhatsApp/email message preparation and optional SMTP sending.

Nothing here claims delivery. A WhatsApp link only opens WhatsApp with a prefilled message;
an email is "accepted" only when the configured SMTP server accepted it for delivery.
"""

from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from urllib.parse import quote

from app.core.config import get_settings
from app.core.money import format_money
from app.core.phone import whatsapp_digits
from app.models import Business, Invoice
from app.services.pdf.render import fmt_date


def share_url(inv: Invoice) -> str | None:
    if not inv.share_token:
        return None
    return f"{get_settings().public_app_url.rstrip('/')}/share/{inv.share_token}"


def whatsapp_message(inv: Invoice, business: Business) -> str:
    customer = (inv.customer_snapshot or {}).get("name") or "there"
    fmt = business.settings.date_format
    lines = [
        f"Hello {customer},",
        "",
        f"Here is invoice {inv.number} from {business.name}.",
        f"Amount due: {format_money(inv.balance_due, inv.currency)}",
        f"Due date: {fmt_date(inv.due_date, fmt)}",
    ]
    url = share_url(inv)
    if url:
        lines += ["", f"View or download the invoice: {url}"]
    if inv.payment_instructions:
        lines += ["", "How to pay:", inv.payment_instructions]
    lines += ["", "Thank you!"]
    return "\n".join(lines)


def email_draft(inv: Invoice, business: Business) -> tuple[str, str]:
    customer = (inv.customer_snapshot or {}).get("name") or "Customer"
    fmt = business.settings.date_format
    subject = f"Invoice {inv.number} from {business.name}"
    body = [
        f"Dear {customer},",
        "",
        f"Please find attached invoice {inv.number} for {format_money(inv.total, inv.currency)}.",
        f"Amount due: {format_money(inv.balance_due, inv.currency)}, due on {fmt_date(inv.due_date, fmt)}.",
    ]
    url = share_url(inv)
    if url:
        body += ["", f"You can also view and download it online: {url}"]
    if inv.payment_instructions:
        body += ["", "Payment details:", inv.payment_instructions, f"Please use {inv.number} as your payment reference."]
    body += ["", "Kind regards,", business.name]
    return subject, "\n".join(body)


def whatsapp_url(phone_e164: str | None, message: str) -> str:
    digits = whatsapp_digits(phone_e164)
    base = f"https://wa.me/{digits}" if digits else "https://wa.me/"
    return f"{base}?text={quote(message)}"


def mailto_url(to: str | None, subject: str, body: str) -> str:
    return f"mailto:{quote(to or '')}?subject={quote(subject)}&body={quote(body)}"


class EmailNotConfigured(Exception):
    pass


def send_email(to: str, subject: str, body: str, reply_to: str | None, attachment: tuple[str, bytes] | None) -> None:
    s = get_settings()
    if not s.email_enabled:
        raise EmailNotConfigured()
    msg = EmailMessage()
    msg["From"] = formataddr((s.smtp_from_name, s.smtp_from_email))
    msg["To"] = to
    msg["Subject"] = subject
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(body)
    if attachment:
        name, data = attachment
        msg.add_attachment(data, maintype="application", subtype="pdf", filename=name)
    context = ssl.create_default_context()
    if s.smtp_use_ssl:
        server: smtplib.SMTP = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=20, context=context)
    else:
        server = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20)
    with server:
        if s.smtp_use_tls and not s.smtp_use_ssl:
            server.starttls(context=context)
        if s.smtp_username:
            server.login(s.smtp_username, s.smtp_password)
        server.send_message(msg)
