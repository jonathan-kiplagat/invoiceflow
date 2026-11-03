import uuid

from tests.conftest import invoice_payload, make_customer, make_invoice

API = "/api/v1"


def test_create_invoice_computes_totals_and_number(client, user):
    c = make_customer(client, user["headers"])
    inv = make_invoice(client, user["headers"], c["id"])
    assert inv["number"] == "INV-2026-0001"
    assert inv["subtotal"] == "62000.00"
    assert inv["tax_total"] == "9920.00"
    assert inv["total"] == "71920.00"
    assert inv["balance_due"] == "71920.00"
    assert inv["status"] == "draft"
    assert inv["customer_snapshot"]["phone"] == "+254 712 345 678"
    assert inv["business_snapshot"]["name"] == "Acme Studio"
    inv2 = make_invoice(client, user["headers"], c["id"])
    assert inv2["number"] == "INV-2026-0002"


def test_server_recomputes_ignoring_client_totals(client, user):
    c = make_customer(client, user["headers"])
    body = invoice_payload(c["id"])
    body["total"] = "1.00"  # unknown field, ignored
    r = client.post(f"{API}/invoices", json=body, headers=user["headers"])
    assert r.json()["total"] == "71920.00"


def test_validation_errors(client, user):
    c = make_customer(client, user["headers"])
    bad_dates = invoice_payload(c["id"], due_date="2026-10-01")
    r = client.post(f"{API}/invoices", json=bad_dates, headers=user["headers"])
    assert r.status_code == 422 and "Due date" in r.json()["detail"]
    neg = invoice_payload(c["id"])
    neg["items"][0]["unit_price"] = "-5"
    assert client.post(f"{API}/invoices", json=neg, headers=user["headers"]).status_code == 422
    zero_qty = invoice_payload(c["id"])
    zero_qty["items"][0]["quantity"] = "0"
    assert client.post(f"{API}/invoices", json=zero_qty, headers=user["headers"]).status_code == 422
    pct = invoice_payload(c["id"])
    pct["items"][0]["discount_value"] = "150"
    assert client.post(f"{API}/invoices", json=pct, headers=user["headers"]).status_code == 422
    assert client.post(f"{API}/invoices", json=invoice_payload(c["id"], currency="XYZ"), headers=user["headers"]).status_code == 422


def test_create_is_idempotent_by_client_uuid(client, user):
    c = make_customer(client, user["headers"])
    body = invoice_payload(c["id"])
    r1 = client.post(f"{API}/invoices", json=body, headers=user["headers"])
    r2 = client.post(f"{API}/invoices", json=body, headers=user["headers"])
    assert r1.status_code == 201 and r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
    assert client.get(f"{API}/invoices", headers=user["headers"]).json()["total"] == 1


def test_offline_draft_with_new_customer(client, user):
    body = invoice_payload(None, new_customer={"name": "Otieno Hardware", "phone": "0722111222"})
    r = client.post(f"{API}/invoices", json=body, headers=user["headers"])
    assert r.status_code == 201
    customers = client.get(f"{API}/customers", headers=user["headers"]).json()["items"]
    assert [x["name"] for x in customers] == ["Otieno Hardware"]
    assert r.json()["customer_id"] == customers[0]["id"]
    # Retrying the same sync does not create a second customer either.
    client.post(f"{API}/invoices", json=body, headers=user["headers"])
    assert client.get(f"{API}/customers", headers=user["headers"]).json()["total"] == 1


def test_update_with_version_and_conflict(client, user):
    c = make_customer(client, user["headers"])
    inv = make_invoice(client, user["headers"], c["id"])
    body = invoice_payload(c["id"], version=inv["version"], client_revision=str(uuid.uuid4()), notes="First edit")
    r = client.put(f"{API}/invoices/{inv['id']}", json=body, headers=user["headers"])
    assert r.status_code == 200 and r.json()["version"] == 2 and r.json()["notes"] == "First edit"
    # A second device still holding version 1 must not silently overwrite.
    stale = invoice_payload(c["id"], version=1, client_revision=str(uuid.uuid4()), notes="Stale edit")
    r = client.put(f"{API}/invoices/{inv['id']}", json=stale, headers=user["headers"])
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "version_conflict"
    assert client.get(f"{API}/invoices/{inv['id']}", headers=user["headers"]).json()["notes"] == "First edit"
    # Explicit, user-confirmed overwrite.
    stale["force_overwrite"] = True
    r = client.put(f"{API}/invoices/{inv['id']}", json=stale, headers=user["headers"])
    assert r.status_code == 200 and r.json()["notes"] == "Stale edit" and r.json()["version"] == 3


def test_retried_update_is_not_a_conflict(client, user):
    c = make_customer(client, user["headers"])
    inv = make_invoice(client, user["headers"], c["id"])
    body = invoice_payload(c["id"], version=1, client_revision="rev-123-abc", notes="Edit")
    assert client.put(f"{API}/invoices/{inv['id']}", json=body, headers=user["headers"]).status_code == 200
    # Same request again (e.g. response lost while offline) -> success, no duplicate change.
    r = client.put(f"{API}/invoices/{inv['id']}", json=body, headers=user["headers"])
    assert r.status_code == 200 and r.json()["version"] == 2


def test_list_search_filter_sort_paginate(client, user):
    h = user["headers"]
    a = make_customer(client, h, name="Alpha Ltd")
    b = make_customer(client, h, name="Beta Co", phone="0711000000")
    for _ in range(3):
        make_invoice(client, h, a["id"])
    big = invoice_payload(b["id"])
    big["items"][0]["unit_price"] = "900000.00"
    client.post(f"{API}/invoices", json=big, headers=h)
    r = client.get(f"{API}/invoices", params={"q": "beta"}, headers=h).json()
    assert r["total"] == 1 and r["items"][0]["customer_name"] == "Beta Co"
    r = client.get(f"{API}/invoices", params={"sort": "total", "order": "desc"}, headers=h).json()
    assert r["items"][0]["customer_name"] == "Beta Co"
    r = client.get(f"{API}/invoices", params={"page_size": 2, "page": 2}, headers=h).json()
    assert r["total"] == 4 and len(r["items"]) == 2
    r = client.get(f"{API}/invoices", params={"status": "draft"}, headers=h).json()
    assert r["total"] == 4


def test_send_duplicate_cancel_delete(client, user):
    h = user["headers"]
    c = make_customer(client, h)
    inv = make_invoice(client, h, c["id"])
    r = client.post(f"{API}/invoices/{inv['id']}/send", headers=h)
    assert r.json()["status"] == "sent" and r.json()["sent_at"]
    dup = client.post(f"{API}/invoices/{inv['id']}/duplicate", headers=h).json()
    assert dup["number"] != inv["number"] and dup["status"] == "draft" and dup["total"] == inv["total"]
    assert len(dup["items"]) == 2
    r = client.post(f"{API}/invoices/{inv['id']}/cancel", headers=h)
    assert r.json()["status"] == "cancelled"
    edit = invoice_payload(c["id"], version=r.json()["version"])
    assert client.put(f"{API}/invoices/{inv['id']}", json=edit, headers=h).status_code == 409
    assert client.delete(f"{API}/invoices/{dup['id']}", headers=h).status_code == 204
    assert client.get(f"{API}/invoices/{dup['id']}", headers=h).status_code == 404


def test_send_requires_customer(client, user):
    inv = make_invoice(client, user["headers"], None)
    r = client.post(f"{API}/invoices/{inv['id']}/send", headers=user["headers"])
    assert r.status_code == 422


def test_custom_number_format(client, user):
    h = user["headers"]
    b = client.get(f"{API}/business", headers=h).json()
    s = b["settings"]
    s.update({"invoice_number_format": "ACME/{YY}{MM}/{SEQ:3}", "next_invoice_seq": 7})
    profile = {k: b["profile"][k] for k in ("name", "email", "phone", "address", "website", "registration_number", "kra_pin", "vat_registered", "vat_number")}
    r = client.put(f"{API}/business", json={"profile": profile, "settings": s}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["invoice_number_preview"].endswith("/007")
    inv = make_invoice(client, h, None)
    assert inv["number"] == "ACME/2611/007"


def test_csv_export(client, user):
    h = user["headers"]
    c = make_customer(client, h, name="=HYPERLINK(evil)")
    make_invoice(client, h, c["id"])
    r = client.get(f"{API}/invoices/export.csv", headers=h)
    assert r.status_code == 200 and "text/csv" in r.headers["content-type"]
    text = r.content.decode("utf-8-sig")
    assert "INV-2026-0001" in text and "71920.00" in text
    assert "'=HYPERLINK" in text  # formula injection neutralised
