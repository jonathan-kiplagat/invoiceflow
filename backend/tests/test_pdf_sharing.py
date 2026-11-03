import io

import pytest
from PIL import Image
from pypdf import PdfReader

from tests.conftest import invoice_payload, make_customer, make_invoice

API = "/api/v1"


def _text(pdf: bytes) -> tuple[int, str]:
    reader = PdfReader(io.BytesIO(pdf))
    return len(reader.pages), "\n".join(p.extract_text() for p in reader.pages)


@pytest.mark.parametrize("template", ["modern", "corporate", "elegant", "classic"])
def test_each_template_renders_correct_totals(client, user, template):
    h = user["headers"]
    c = make_customer(client, h)
    inv = make_invoice(client, h, c["id"])
    r = client.get(f"{API}/invoices/{inv['id']}/pdf", params={"template": template, "download": True}, headers=h)
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert "attachment" in r.headers["content-disposition"]
    pages, text = _text(r.content)
    assert pages == 1
    assert "INV-2026-0001" in text and "Wanjiku Kamau" in text
    assert "KSh 71,920.00" in text and "KSh 9,920.00" in text
    page = PdfReader(io.BytesIO(r.content)).pages[0]
    assert round(float(page.mediabox.width)) == 595 and round(float(page.mediabox.height)) == 842  # A4


def test_large_invoice_spans_pages_without_losing_rows(client, user):
    h = user["headers"]
    body = invoice_payload(None)
    long_desc = "Installation of solar panels including wiring, inverter configuration and site survey. " * 40
    body["items"] = [
        {"description": (long_desc if i == 10 else f"Line item number {i + 1}"), "quantity": "1", "unit_price": "100.00", "tax_rate": "0"}
        for i in range(150)
    ]
    inv = client.post(f"{API}/invoices", json=body, headers=h).json()
    assert inv["total"] == "15000.00"
    r = client.get(f"{API}/invoices/{inv['id']}/pdf", headers=h)
    pages, text = _text(r.content)
    assert pages >= 4
    assert "Line item number 1\n" in text or "Line item number 1 " in text or "Line item number 1" in text
    assert "Line item number 150" in text
    assert "KSh 15,000.00" in text
    assert f"Page {pages} of {pages}" in text


def test_logo_in_pdf(client, user):
    h = user["headers"]
    buf = io.BytesIO()
    Image.new("RGB", (400, 160), (200, 30, 30)).save(buf, "PNG")
    client.post(f"{API}/business/logo", files={"file": ("logo.png", buf.getvalue(), "image/png")}, headers=h)
    inv = make_invoice(client, h, None)
    r = client.get(f"{API}/invoices/{inv['id']}/pdf", headers=h)
    page = PdfReader(io.BytesIO(r.content)).pages[0]
    assert len(page.images) >= 1


def test_preview_pdf_unsaved(client, user):
    h = user["headers"]
    body = invoice_payload(None, new_customer={"name": "Preview Person"})
    r = client.post(f"{API}/invoices/preview.pdf", json=body, headers=h)
    assert r.status_code == 200
    _, text = _text(r.content)
    assert "Preview Person" in text and "KSh 71,920.00" in text
    assert client.get(f"{API}/invoices", headers=h).json()["total"] == 0  # nothing saved


def test_inclusive_pricing_in_pdf(client, user):
    h = user["headers"]
    body = invoice_payload(None, pricing_mode="inclusive")
    body["items"] = [{"description": "Item", "quantity": "1", "unit_price": "1160.00", "tax_rate": "16", "tax_name": "VAT"}]
    inv = client.post(f"{API}/invoices", json=body, headers=h).json()
    assert inv["total"] == "1160.00" and inv["tax_total"] == "160.00"
    _, text = _text(client.get(f"{API}/invoices/{inv['id']}/pdf", headers=h).content)
    assert "Includes VAT" in text


def test_share_link_and_public_view(client, user):
    h = user["headers"]
    c = make_customer(client, h)
    inv = make_invoice(client, h, c["id"])
    info = client.get(f"{API}/invoices/{inv['id']}/share-info", headers=h).json()
    assert info["share_url"] is None
    assert info["whatsapp_url"].startswith("https://wa.me/254712345678?text=")
    assert "INV-2026-0001" in info["whatsapp_message"] and "KSh 71,920.00" in info["whatsapp_message"]
    assert info["mailto_url"].startswith("mailto:wanjiku%40example.co.ke?subject=")
    assert info["email_integration_enabled"] is False
    info = client.post(f"{API}/invoices/{inv['id']}/share-link", headers=h).json()
    token = info["share_url"].rsplit("/", 1)[1]
    # Draft invoices are never exposed publicly, even with a token.
    assert client.get(f"{API}/public/invoices/{token}").status_code == 404
    client.post(f"{API}/invoices/{inv['id']}/send", headers=h)
    pub = client.get(f"{API}/public/invoices/{token}")
    assert pub.status_code == 200 and pub.json()["balance_display"] == "KSh 71,920.00"
    assert "id" not in pub.json()
    assert client.get(f"{API}/public/invoices/{token}/pdf").content.startswith(b"%PDF")
    client.delete(f"{API}/invoices/{inv['id']}/share-link", headers=h)
    assert client.get(f"{API}/public/invoices/{token}").status_code == 404


def test_email_not_configured_is_honest(client, user):
    h = user["headers"]
    inv = make_invoice(client, h, None)
    r = client.post(f"{API}/invoices/{inv['id']}/email", json={"to": "a@example.co.ke", "subject": "Inv", "body": "Hi"}, headers=h)
    assert r.status_code == 503 and "not configured" in r.json()["detail"]


class FakeSMTP:
    sent: list = []
    fail = False

    def __init__(self, *a, **kw):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def starttls(self, **kw):
        pass

    def login(self, *a):
        pass

    def send_message(self, msg):
        if FakeSMTP.fail:
            raise OSError("smtp down")
        FakeSMTP.sent.append(msg)


def test_email_sent_via_smtp(client, user, monkeypatch):
    from app.core.config import get_settings
    from app.services import sharing

    s = get_settings()
    monkeypatch.setattr(s, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(s, "smtp_from_email", "billing@example.com")
    monkeypatch.setattr(sharing.smtplib, "SMTP", FakeSMTP)
    FakeSMTP.sent, FakeSMTP.fail = [], False
    h = user["headers"]
    inv = make_invoice(client, h, None)
    r = client.post(f"{API}/invoices/{inv['id']}/email", json={"to": "client@example.co.ke", "subject": "Invoice", "body": "Hi"}, headers=h)
    assert r.json()["status"] == "accepted"
    msg = FakeSMTP.sent[0]
    attachments = [p for p in msg.iter_attachments()]
    assert attachments[0].get_filename() == "Invoice-INV-2026-0001.pdf"
    FakeSMTP.fail = True
    r = client.post(f"{API}/invoices/{inv['id']}/email", json={"to": "client@example.co.ke", "subject": "Invoice", "body": "Hi"}, headers=h)
    assert r.json()["status"] == "failed"
