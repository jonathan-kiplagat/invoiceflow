"""One account must never see or change another account's records."""

from tests.conftest import invoice_payload, make_customer, make_invoice

API = "/api/v1"


def test_cross_account_access_is_denied(client, user, other_user):
    a, b = user["headers"], other_user["headers"]
    c = make_customer(client, a)
    inv = make_invoice(client, a, c["id"])
    client.post(f"{API}/invoices/{inv['id']}/send", headers=a)
    r = client.post(f"{API}/invoices/{inv['id']}/payments", json={"payment_date": "2026-11-03", "amount": "10.00", "method": "cash"}, headers=a)
    pid = r.json()["payments"][0]["id"]

    # Reads
    assert client.get(f"{API}/customers/{c['id']}", headers=b).status_code == 404
    assert client.get(f"{API}/invoices/{inv['id']}", headers=b).status_code == 404
    assert client.get(f"{API}/invoices/{inv['id']}/pdf", headers=b).status_code == 404
    assert client.get(f"{API}/invoices/{inv['id']}/share-info", headers=b).status_code == 404
    assert client.get(f"{API}/customers/{c['id']}/statement.pdf", headers=b).status_code == 404
    # Lists are scoped
    assert client.get(f"{API}/customers", headers=b).json()["total"] == 0
    assert client.get(f"{API}/invoices", headers=b).json()["total"] == 0
    assert client.get(f"{API}/payments", headers=b).json()["total"] == 0
    assert client.get(f"{API}/reports/dashboard", headers=b).json()["totals"]["invoice_count"] == 0
    # Writes
    assert client.put(f"{API}/customers/{c['id']}", json={"name": "Hacked"}, headers=b).status_code == 404
    assert client.delete(f"{API}/invoices/{inv['id']}", headers=b).status_code == 404
    assert client.post(f"{API}/invoices/{inv['id']}/payments", json={"payment_date": "2026-11-03", "amount": "1.00", "method": "cash"}, headers=b).status_code == 404
    assert client.delete(f"{API}/payments/{pid}", headers=b).status_code == 404
    assert client.post(f"{API}/invoices/{inv['id']}/duplicate", headers=b).status_code == 404
    # Referencing someone else's customer when creating an invoice
    assert client.post(f"{API}/invoices", json=invoice_payload(c["id"]), headers=b).status_code == 404
    # client_uuid idempotency is per account: B reusing A's uuid creates B's own invoice, not A's
    body = invoice_payload(None, client_uuid=inv["client_uuid"])
    r = client.post(f"{API}/invoices", json=body, headers=b)
    assert r.status_code == 201 and r.json()["id"] != inv["id"]
    # Owner's data unchanged
    assert client.get(f"{API}/customers/{c['id']}", headers=a).json()["customer"]["name"] == "Wanjiku Kamau"


def test_tax_rates_are_scoped(client, user, other_user):
    rates_a = client.get(f"{API}/tax-rates", headers=user["headers"]).json()
    rid = rates_a[0]["id"]
    assert client.delete(f"{API}/tax-rates/{rid}", headers=other_user["headers"]).status_code == 404
    # Using someone else's tax rate id on an item doesn't link it.
    body = invoice_payload(None)
    body["items"][0]["tax_rate_id"] = rid
    r = client.post(f"{API}/invoices", json=body, headers=other_user["headers"])
    assert r.json()["items"][0]["tax_rate_id"] is None
