import os
import tempfile
from pathlib import Path

# Configure the app for tests before anything imports it.
_tmp = tempfile.mkdtemp(prefix="invoiceflow-test-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{Path(_tmp) / 'test.db'}")
os.environ["ENVIRONMENT"] = "test"
os.environ["SECRET_KEY"] = "test-secret-key-that-is-long-enough-for-hs256"
os.environ["AUTH_RATE_LIMIT"] = "1000"
os.environ["SMTP_HOST"] = ""
os.environ["FRONTEND_DIST"] = str(Path(_tmp) / "no-dist")

import itertools  # noqa: E402
import uuid  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.ratelimit import limiter  # noqa: E402
from app.database.session import engine  # noqa: E402
from app.main import app, ensure_reference_data  # noqa: E402
from app.models import Base  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
_counter = itertools.count(1)


@pytest.fixture(autouse=True)
def _fresh_db():
    get_settings.cache_clear()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    ensure_reference_data()
    limiter.reset()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def register(client: TestClient, email: str | None = None, business: str = "Acme Studio") -> dict:
    email = email or f"user{next(_counter)}@example.co.ke"
    r = client.post("/api/v1/auth/register", json={
        "full_name": "Test User", "email": email, "password": "s3cure-pass", "business_name": business,
    })
    assert r.status_code == 201, r.text
    tokens = r.json()
    return {"email": email, "tokens": tokens, "headers": {"Authorization": f"Bearer {tokens['access_token']}"}}


@pytest.fixture
def user(client):
    return register(client)


@pytest.fixture
def other_user(client):
    return register(client, business="Other Ltd")


def make_customer(client, headers, **kw) -> dict:
    body = {"name": "Wanjiku Kamau", "company": "Savannah Traders", "email": "wanjiku@example.co.ke", "phone": "0712 345 678", **kw}
    r = client.post("/api/v1/customers", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def invoice_payload(customer_id: int | None, **kw) -> dict:
    body = {
        "client_uuid": str(uuid.uuid4()),
        "customer_id": customer_id,
        "issue_date": "2026-11-03",
        "due_date": "2026-11-17",
        "currency": "KES",
        "pricing_mode": "exclusive",
        "template": "modern",
        "shipping": "0",
        "items": [
            {"description": "Website design", "quantity": "1", "unit_price": "50000.00", "tax_rate": "16", "tax_name": "VAT (standard)"},
            {"description": "Hosting (12 months)", "quantity": "12", "unit_price": "1000.00", "tax_rate": "16", "tax_name": "VAT (standard)"},
        ],
    }
    body.update(kw)
    return body


def make_invoice(client, headers, customer_id, **kw) -> dict:
    r = client.post("/api/v1/invoices", json=invoice_payload(customer_id, **kw), headers=headers)
    assert r.status_code == 201, r.text
    return r.json()
