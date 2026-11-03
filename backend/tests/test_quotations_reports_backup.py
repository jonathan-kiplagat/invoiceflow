import io
import json
import uuid
from datetime import timedelta

from app.core.timeutil import today_local
from tests.conftest import invoice_payload, make_customer, make_invoice, register

API = "/api/v1"


def quote_payload(customer_id, **kw):
    body = invoice_payload(customer_id, **kw)
    body.pop("due_date")
    body["valid_until"] = kw.get("valid_until", "2026-12-03")
    return body


def test_quotation_lifecycle_and_conversion(client, user):
    h = user["headers"]
    c = make_customer(client, h)
    r = client.post(f"{API}/quotations", json=quote_payload(c["id"]), headers=h)
    assert r.status_code == 201
    q = r.json()
    assert q["number"] == "QUO-2026-0001" and q["total"] == "71920.00"
    assert client.post(f"{API}/quotations/{q['id']}/send", headers=h).json()["status"] == "sent"
    assert client.post(f"{API}/quotations/{q['id']}/accept", headers=h).json()["status"] == "accepted"
    inv = client.post(f"{API}/quotations/{q['id']}/convert", headers=h)
    assert inv.status_code == 201
    inv = inv.json()
    assert inv["quotation_id"] == q["id"] and inv["total"] == "71920.00" and inv["status"] == "draft"
    assert inv["number"] == "INV-2026-0001"
    q2 = client.get(f"{API}/quotations/{q['id']}", headers=h).json()
    assert q2["status"] == "converted" and q2["converted_invoice_id"] == inv["id"]
    assert client.post(f"{API}/quotations/{q['id']}/convert", headers=h).status_code == 409
    pdf = client.get(f"{API}/quotations/{q['id']}/pdf", headers=h)
    assert pdf.content.startswith(b"%PDF")


def test_quotation_conflict(client, user):
    h = user["headers"]
    q = client.post(f"{API}/quotations", json=quote_payload(None), headers=h).json()
    body = quote_payload(None, version=q["version"], notes="a")
    assert client.put(f"{API}/quotations/{q['id']}", json=body, headers=h).status_code == 200
    body = quote_payload(None, version=q["version"], notes="b")
    assert client.put(f"{API}/quotations/{q['id']}", json=body, headers=h).status_code == 409


def _pay(client, h, inv_id, amount, method="mpesa", on=None):
    return client.post(f"{API}/invoices/{inv_id}/payments", json={"payment_date": (on or today_local()).isoformat(), "amount": amount, "method": method}, headers=h)


def test_dashboard_and_reports_separate_invoiced_collected_outstanding(client, user):
    h = user["headers"]
    today = today_local()
    c = make_customer(client, h)
    a = make_invoice(client, h, c["id"], issue_date=today.isoformat(), due_date=(today + timedelta(days=7)).isoformat())
    b = make_invoice(client, h, c["id"], issue_date=today.isoformat(), due_date=(today + timedelta(days=7)).isoformat())
    make_invoice(client, h, c["id"])  # draft: not counted as invoiced
    for x in (a, b):
        client.post(f"{API}/invoices/{x['id']}/send", headers=h)
    _pay(client, h, a["id"], "71920.00", "mpesa")
    _pay(client, h, b["id"], "10000.00", "bank_transfer")
    d = client.get(f"{API}/reports/dashboard", headers=h).json()
    t = d["totals"]
    assert t["invoiced"] == "143840.00"
    assert t["collected"] == "81920.00"
    assert t["outstanding"] == "61920.00"
    assert t["invoice_count"] == 3 and t["draft_count"] == 1 and t["customer_count"] == 1
    assert d["status_counts"]["paid"] == 1 and d["status_counts"]["partially_paid"] == 1
    month = f"{today.year:04d}-{today.month:02d}"
    m = next(x for x in d["monthly"] if x["month"] == month)
    assert m["invoiced"] == "143840.00" and m["collected"] == "81920.00"

    s = client.get(f"{API}/reports/summary", headers=h).json()
    assert s["ytd_collected"] == "81920.00" and s["outstanding"] == "61920.00"
    assert {x["method"] for x in s["payment_methods"]} == {"mpesa", "bank_transfer"}
    assert s["top_customers"][0]["name"] == "Wanjiku Kamau"
    assert s["customers"][0]["on_time_rate"] == 100.0
    for name in ("monthly", "customers", "payment-methods", "aging"):
        r = client.get(f"{API}/reports/export/{name}.csv", headers=h)
        assert r.status_code == 200 and r.content.decode("utf-8-sig").count("\n") >= 2


def test_reports_are_per_currency(client, user):
    h = user["headers"]
    c = make_customer(client, h)
    usd = make_invoice(client, h, c["id"], currency="USD")
    assert client.post(f"{API}/invoices/{usd['id']}/send", headers=h).status_code == 200
    kes = client.get(f"{API}/reports/dashboard", headers=h).json()
    assert kes["totals"]["invoiced"] == "0.00"
    assert "USD" in kes["currencies"]
    usd_d = client.get(f"{API}/reports/dashboard", params={"currency": "USD"}, headers=h).json()
    assert usd_d["totals"]["invoiced"] == "71920.00"


def test_quote_conversion_rate(client, user):
    h = user["headers"]
    for i in range(4):
        q = client.post(f"{API}/quotations", json=quote_payload(None, client_uuid=str(uuid.uuid4())), headers=h).json()
        client.post(f"{API}/quotations/{q['id']}/send", headers=h)
        if i == 0:
            client.post(f"{API}/quotations/{q['id']}/convert", headers=h)
    s = client.get(f"{API}/reports/summary", params={"year": 2026}, headers=h).json()
    assert s["quotations"]["issued"] == 4 and s["quotations"]["converted"] == 1 and s["quotations"]["conversion_rate"] == 25.0


def test_backup_roundtrip_into_another_account(client, user):
    h = user["headers"]
    c = make_customer(client, h)
    inv = make_invoice(client, h, c["id"])
    client.post(f"{API}/invoices/{inv['id']}/send", headers=h)
    _pay(client, h, inv["id"], "500.00")
    q = client.post(f"{API}/quotations", json=quote_payload(c["id"]), headers=h).json()
    client.post(f"{API}/quotations/{q['id']}/convert", headers=h)
    backup = client.get(f"{API}/backup/export", headers=h)
    assert backup.status_code == 200
    data = json.loads(backup.content)
    assert data["format"] == "invoiceflow-backup" and len(data["invoices"]) == 2

    other = register(client, email="restore@example.co.ke", business="Fresh")
    oh = other["headers"]
    make_customer(client, oh, name="Will be replaced")
    r = client.post(f"{API}/backup/restore", files={"file": ("b.json", backup.content, "application/json")}, data={"confirm": "nope"}, headers=oh)
    assert r.status_code == 400
    r = client.post(f"{API}/backup/restore", files={"file": ("b.json", backup.content, "application/json")}, data={"confirm": "REPLACE"}, headers=oh)
    assert r.status_code == 200, r.text
    assert r.json()["restored"] == {"customers": 1, "invoices": 2, "quotations": 1, "tax_rates": 3}
    custs = client.get(f"{API}/customers", headers=oh).json()["items"]
    assert [x["name"] for x in custs] == ["Wanjiku Kamau"]
    invs = client.get(f"{API}/invoices", params={"sort": "number", "order": "asc"}, headers=oh).json()["items"]
    first = client.get(f"{API}/invoices/{invs[0]['id']}", headers=oh).json()
    assert first["amount_paid"] == "500.00" and first["total"] == "71920.00" and len(first["payments"]) == 1
    assert client.get(f"{API}/business", headers=oh).json()["profile"]["name"] == "Acme Studio"
    # Original account is untouched.
    assert client.get(f"{API}/invoices", headers=h).json()["total"] == 2


def test_restore_rejects_garbage_atomically(client, user):
    h = user["headers"]
    make_customer(client, h)
    r = client.post(f"{API}/backup/restore", files={"file": ("b.json", io.BytesIO(b"{not json"), "application/json")}, data={"confirm": "REPLACE"}, headers=h)
    assert r.status_code == 422
    bad = {"format": "invoiceflow-backup", "version": 1, "business": {}, "settings": {}, "tax_rates": [], "customers": [{"_id": 1, "name": None}], "invoices": [], "quotations": []}
    r = client.post(f"{API}/backup/restore", files={"file": ("b.json", json.dumps(bad).encode(), "application/json")}, data={"confirm": "REPLACE"}, headers=h)
    assert r.status_code == 422
    # Nothing was lost.
    assert client.get(f"{API}/customers", headers=h).json()["total"] == 1


def test_health_and_meta(client):
    assert client.get("/api/health").json()["status"] == "ok"
    meta = client.get(f"{API}/meta").json()
    assert meta["timezone"] == "Africa/Nairobi"
    assert any(c["code"] == "KES" and c["symbol"] == "KSh" for c in meta["currencies"])
