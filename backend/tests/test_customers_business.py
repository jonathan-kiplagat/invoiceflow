import io

import pytest
from PIL import Image

from app.core.phone import format_phone, normalize_phone, whatsapp_digits
from tests.conftest import make_customer, make_invoice

API = "/api/v1"


@pytest.mark.parametrize("raw,expected", [
    ("0712345678", "+254712345678"), ("712 345 678", "+254712345678"), ("+254 712 345 678", "+254712345678"),
    ("254712345678", "+254712345678"), ("0110 123 456", "+254110123456"), ("+44 20 7946 0958", "+442079460958"),
])
def test_phone_normalisation(raw, expected):
    assert normalize_phone(raw) == expected


def test_phone_invalid_and_formatting():
    with pytest.raises(ValueError):
        normalize_phone("12345")
    with pytest.raises(ValueError):
        normalize_phone("+2547123")
    assert format_phone("+254712345678") == "+254 712 345 678"
    assert whatsapp_digits("+254712345678") == "254712345678"


def test_customer_crud_search_stats(client, user):
    h = user["headers"]
    c = make_customer(client, h)
    assert c["phone"] == "+254712345678"
    make_customer(client, h, name="Juma Otieno", email=None, phone=None, company=None)
    r = client.get(f"{API}/customers", params={"q": "savannah"}, headers=h).json()
    assert r["total"] == 1
    r = client.put(f"{API}/customers/{c['id']}", json={"name": "Wanjiku K.", "phone": "0722000111"}, headers=h)
    assert r.status_code == 200 and r.json()["phone"] == "+254722000111"
    inv = make_invoice(client, h, c["id"])
    client.post(f"{API}/invoices/{inv['id']}/send", headers=h)
    client.post(f"{API}/invoices/{inv['id']}/payments", json={"payment_date": "2026-11-03", "amount": "1920.00", "method": "cash"}, headers=h)
    row = next(x for x in client.get(f"{API}/customers", headers=h).json()["items"] if x["id"] == c["id"])
    assert row["total_invoiced"] == "71920.00" and row["total_paid"] == "1920.00" and row["outstanding"] == "70000.00"
    hist = client.get(f"{API}/customers/{c['id']}/invoices", headers=h).json()
    assert len(hist) == 1
    stmt = client.get(f"{API}/customers/{c['id']}/statement.pdf", headers=h)
    assert stmt.status_code == 200 and stmt.content.startswith(b"%PDF")


def test_customer_delete_rules(client, user):
    h = user["headers"]
    used = make_customer(client, h)
    make_invoice(client, h, used["id"])
    r = client.delete(f"{API}/customers/{used['id']}", headers=h)
    assert r.status_code == 409 and "Archive" in r.json()["detail"]
    unused = make_customer(client, h, name="Temp")
    assert client.delete(f"{API}/customers/{unused['id']}", headers=h).status_code == 204


def test_invalid_customer(client, user):
    h = user["headers"]
    assert client.post(f"{API}/customers", json={"name": "  "}, headers=h).status_code == 422
    assert client.post(f"{API}/customers", json={"name": "X", "email": "bad"}, headers=h).status_code == 422
    assert client.post(f"{API}/customers", json={"name": "X", "phone": "123"}, headers=h).status_code == 422


def _profile(b):
    return {k: b["profile"][k] for k in ("name", "email", "phone", "address", "website", "registration_number", "kra_pin", "vat_registered", "vat_number")}


def test_business_settings_and_payment_instructions(client, user):
    h = user["headers"]
    b = client.get(f"{API}/business", headers=h).json()
    assert b["settings"]["default_currency"] == "KES"
    assert {t["name"] for t in b["tax_rates"]} >= {"VAT (standard)", "Zero-rated", "Exempt"}
    profile = _profile(b) | {"kra_pin": "p051234567x", "vat_registered": True, "vat_number": "0123456X", "phone": "0700 111 222"}
    settings = b["settings"] | {"mpesa_type": "paybill", "mpesa_paybill": "522522", "mpesa_account": "ACME", "bank_name": "KCB", "bank_account_number": "1234567890", "payment_terms_days": 30}
    r = client.put(f"{API}/business", json={"profile": profile, "settings": settings}, headers=h)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["profile"]["kra_pin"] == "P051234567X"
    assert "Paybill: 522522" in out["payment_instructions_preview"]
    assert "Account number: 1234567890" in out["payment_instructions_preview"]
    # New invoices pick up the defaults
    inv = make_invoice(client, h, None)
    assert "522522" in inv["payment_instructions"]
    assert inv["business_snapshot"]["kra_pin"] == "P051234567X"


def test_bad_settings_rejected(client, user):
    h = user["headers"]
    b = client.get(f"{API}/business", headers=h).json()
    for bad in ({"invoice_number_format": "INV-NOSEQ"}, {"default_currency": "BTC"}, {"mpesa_paybill": "12ab"}, {"accent_color": "red"}):
        r = client.put(f"{API}/business", json={"profile": _profile(b), "settings": b["settings"] | bad}, headers=h)
        assert r.status_code == 422, bad
    r = client.put(f"{API}/business", json={"profile": _profile(b) | {"kra_pin": "123"}, "settings": b["settings"]}, headers=h)
    assert r.status_code == 422


def test_tax_rates_configurable(client, user):
    h = user["headers"]
    r = client.post(f"{API}/tax-rates", json={"name": "Catering levy", "rate": "2"}, headers=h)
    assert r.status_code == 201 and r.json()["rate"] == "2.000"
    rid = r.json()["id"]
    r = client.put(f"{API}/tax-rates/{rid}", json={"name": "Catering levy", "rate": "2.5"}, headers=h)
    assert r.json()["rate"] == "2.500"
    assert client.post(f"{API}/tax-rates", json={"name": "Bad", "rate": "101"}, headers=h).status_code == 422
    assert client.delete(f"{API}/tax-rates/{rid}", headers=h).status_code == 204


def _png(size=(300, 120)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (15, 118, 110)).save(buf, "PNG")
    return buf.getvalue()


def test_logo_upload_validation(client, user):
    h = user["headers"]
    r = client.post(f"{API}/business/logo", files={"file": ("logo.png", _png(), "image/png")}, headers=h)
    assert r.status_code == 200 and r.json()["logo_data_url"].startswith("data:image/png;base64,")
    r = client.post(f"{API}/business/logo", files={"file": ("x.png", b"<svg onload=alert(1)>", "image/png")}, headers=h)
    assert r.status_code == 400
    r = client.post(f"{API}/business/logo", files={"file": ("big.png", b"0" * (2 * 1024 * 1024 + 10), "image/png")}, headers=h)
    assert r.status_code == 413
    assert client.delete(f"{API}/business/logo", headers=h).json()["logo_data_url"] is None
