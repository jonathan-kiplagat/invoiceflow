from datetime import timedelta

from app.core.timeutil import today_local
from tests.conftest import make_customer, make_invoice

API = "/api/v1"


def _sent_invoice(client, h, **kw):
    c = make_customer(client, h)
    inv = make_invoice(client, h, c["id"], **kw)
    return client.post(f"{API}/invoices/{inv['id']}/send", headers=h).json()


def pay(client, h, inv_id, amount, **kw):
    body = {"payment_date": today_local().isoformat(), "amount": amount, "method": "mpesa", "reference": "SGH12ABC34", **kw}
    return client.post(f"{API}/invoices/{inv_id}/payments", json=body, headers=h)


def test_partial_then_full_payment(client, user):
    h = user["headers"]
    today = today_local()
    inv = _sent_invoice(client, h, issue_date=today.isoformat(), due_date=(today + timedelta(days=14)).isoformat())
    assert inv["status"] == "sent"
    r = pay(client, h, inv["id"], "20000.00")
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "partially_paid"
    assert body["amount_paid"] == "20000.00" and body["balance_due"] == "51920.00"
    r = pay(client, h, inv["id"], "51920.00", method="bank_transfer")
    assert r.json()["status"] == "paid" and r.json()["balance_due"] == "0.00"
    assert len(r.json()["payments"]) == 2


def test_overpayment_rejected(client, user):
    h = user["headers"]
    inv = _sent_invoice(client, h)
    r = pay(client, h, inv["id"], "71920.01")
    assert r.status_code == 422 and "outstanding balance" in r.json()["detail"]


def test_invalid_payments(client, user):
    h = user["headers"]
    inv = _sent_invoice(client, h)
    assert pay(client, h, inv["id"], "0").status_code == 422
    assert pay(client, h, inv["id"], "-1").status_code == 422
    assert pay(client, h, inv["id"], "10", method="bitcoin").status_code == 422


def test_payment_idempotent(client, user):
    h = user["headers"]
    inv = _sent_invoice(client, h)
    r1 = pay(client, h, inv["id"], "100.00", client_uuid="pay-uuid-0001")
    r2 = pay(client, h, inv["id"], "100.00", client_uuid="pay-uuid-0001")
    assert r1.status_code == 201 and r2.status_code == 200
    assert r2.json()["amount_paid"] == "100.00"


def test_delete_payment_recomputes(client, user):
    h = user["headers"]
    inv = _sent_invoice(client, h)
    r = pay(client, h, inv["id"], "71920.00")
    assert r.json()["status"] == "paid"
    pid = r.json()["payments"][0]["id"]
    r = client.delete(f"{API}/payments/{pid}", headers=h)
    assert r.status_code == 200
    assert r.json()["status"] in ("sent", "overdue") and r.json()["amount_paid"] == "0.00"


def test_never_paid_without_payment(client, user):
    h = user["headers"]
    inv = _sent_invoice(client, h)
    got = client.get(f"{API}/invoices/{inv['id']}", headers=h).json()
    assert got["status"] != "paid" and got["amount_paid"] == "0.00"


def test_overdue_detection(client, user):
    h = user["headers"]
    past = today_local() - timedelta(days=40)
    inv = _sent_invoice(client, h, issue_date=past.isoformat(), due_date=(past + timedelta(days=10)).isoformat())
    listed = client.get(f"{API}/invoices", params={"status": "overdue"}, headers=h).json()
    assert listed["total"] == 1 and listed["items"][0]["id"] == inv["id"]
    # A partial payment keeps it overdue; settling it marks it paid.
    pay(client, h, inv["id"], "1000.00", payment_date=today_local().isoformat())
    assert client.get(f"{API}/invoices/{inv['id']}", headers=h).json()["status"] == "overdue"
    r = pay(client, h, inv["id"], "70920.00")
    assert r.json()["status"] == "paid"


def test_payments_blocked_on_cancelled_and_delete_blocked_when_paid(client, user):
    h = user["headers"]
    inv = _sent_invoice(client, h)
    pay(client, h, inv["id"], "10.00")
    assert client.delete(f"{API}/invoices/{inv['id']}", headers=h).status_code == 409
    client.post(f"{API}/invoices/{inv['id']}/cancel", headers=h)
    assert pay(client, h, inv["id"], "10.00").status_code == 409


def test_editing_total_below_paid_is_rejected(client, user):
    h = user["headers"]
    inv = _sent_invoice(client, h)
    r = pay(client, h, inv["id"], "60000.00")
    body = {**{k: inv[k] for k in ("issue_date", "due_date", "currency", "pricing_mode", "template")},
            "customer_id": inv["customer_id"], "version": r.json()["version"], "shipping": "0",
            "items": [{"description": "Small", "quantity": "1", "unit_price": "100.00", "tax_rate": "0"}]}
    r = client.put(f"{API}/invoices/{inv['id']}", json=body, headers=h)
    assert r.status_code == 422


def test_payments_list_and_export(client, user):
    h = user["headers"]
    inv = _sent_invoice(client, h)
    pay(client, h, inv["id"], "500.00")
    r = client.get(f"{API}/payments", headers=h).json()
    assert r["total"] == 1 and r["items"][0]["invoice_number"] == inv["number"]
    csv_text = client.get(f"{API}/payments/export.csv", headers=h).content.decode("utf-8-sig")
    assert "SGH12ABC34" in csv_text
