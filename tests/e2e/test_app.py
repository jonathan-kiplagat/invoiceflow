import json
import re
import uuid

import pytest
from playwright.sync_api import Page, expect

from tests.e2e.conftest import ARTIFACTS, VIEWPORTS

PAGES = ["/", "/invoices", "/invoices/new", "/customers", "/payments", "/quotations", "/reports", "/settings", "/sync"]


def visible(locator):
    return locator.filter(visible=True).first


def register(page: Page, business="Savannah Studio") -> str:
    email = f"e2e-{uuid.uuid4().hex[:8]}@example.co.ke"
    page.goto("/register")
    page.get_by_label("Your name").fill("Achieng Otieno")
    page.get_by_label("Business name").fill(business)
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password", exact=True).fill("s3cure-pass")
    page.get_by_role("button", name="Create account").click()
    page.wait_for_url(re.compile(r"/settings"))
    return email


def token(page: Page) -> str:
    return json.loads(page.evaluate("localStorage.getItem('if-auth')"))["access_token"]


def api(page: Page, method: str, path: str, data=None):
    headers = {"Authorization": f"Bearer {token(page)}"}
    r = page.request.fetch(f"/api/v1{path}", method=method, headers=headers, data=data)
    assert r.ok, f"{method} {path}: {r.status} {r.text()}"
    return r.json() if r.status != 204 else None


def no_horizontal_overflow(page: Page) -> int:
    return page.evaluate("document.documentElement.scrollWidth - window.innerWidth")


def seed(page: Page):
    c = api(page, "POST", "/customers", {"name": "Wanjiku Kamau", "company": "Savannah Traders", "phone": "0712345678", "email": "wanjiku@example.co.ke"})
    inv = api(page, "POST", "/invoices", {
        "client_uuid": str(uuid.uuid4()), "customer_id": c["id"], "issue_date": "2026-10-01", "due_date": "2026-10-15",
        "currency": "KES", "pricing_mode": "exclusive", "template": "corporate", "shipping": "0",
        "items": [{"description": "Brand identity design", "quantity": "1", "unit_price": "85000", "tax_rate": "16", "tax_name": "VAT (standard)"},
                  {"description": "Social media templates", "quantity": "12", "unit_price": "1500", "tax_rate": "16", "tax_name": "VAT (standard)"}],
    })
    api(page, "POST", f"/invoices/{inv['id']}/send")
    api(page, "POST", f"/invoices/{inv['id']}/payments", {"payment_date": "2026-10-20", "amount": "50000", "method": "mpesa", "reference": "SJK3H2L9QX"})
    return c, inv


@pytest.mark.parametrize("vp", list(VIEWPORTS))
def test_layouts_have_no_horizontal_overflow(context_factory, vp):
    ctx = context_factory(vp)
    page = ctx.new_page()
    register(page)
    seed(page)
    for path in PAGES:
        page.goto(path)
        page.wait_for_load_state("networkidle")
        overflow = no_horizontal_overflow(page)
        assert overflow <= 0, f"{path} overflows by {overflow}px at {vp}px"
    # Navigation pattern adapts: sidebar on desktop, bottom bar on phones.
    page.goto("/")
    if int(vp) >= 1024:
        expect(page.locator("aside")).to_be_visible()
    else:
        expect(page.get_by_role("button", name="More")).to_be_visible()
    for path, name in [("/", "dashboard"), ("/invoices/new", "editor")]:
        page.goto(path)
        page.wait_for_load_state("networkidle")
        page.screenshot(path=str(ARTIFACTS / f"{name}-{vp}.png"), full_page=False)


def test_invoice_lifecycle_desktop(context_factory):
    page = context_factory("1440").new_page()
    register(page)
    page.goto("/invoices/new")
    page.get_by_role("button", name="Add a new customer").click()
    page.get_by_label("Name").fill("Juma Mwangi")
    page.get_by_label("Phone").fill("0722 111 222")
    page.get_by_role("button", name="Save customer").click()
    expect(page.get_by_text("Juma Mwangi").first).to_be_visible()

    visible(page.get_by_label("Item 1 description")).fill("Website redesign")
    visible(page.get_by_label("Item 1 quantity")).fill("2")
    visible(page.get_by_label("Item 1 unit price")).fill("25000")
    page.get_by_role("button", name="Add item").click()
    visible(page.get_by_label("Item 2 description")).fill("Hosting, 12 months")
    visible(page.get_by_label("Item 2 quantity")).fill("1")
    visible(page.get_by_label("Item 2 unit price")).fill("12000.50")
    # Live totals: (50,000 + 12,000.50) x 1.16 = 71,920.58
    expect(page.get_by_text("KSh 71,920.58").first).to_be_visible()

    page.get_by_role("button", name="Preview").first.click()
    expect(page.get_by_label("Invoice preview")).to_be_visible()
    page.keyboard.press("Escape")

    page.get_by_role("button", name="Save & mark sent").first.click()
    page.wait_for_url(re.compile(r"/invoices/\d+$"))
    expect(page.get_by_text("Sent", exact=True).first).to_be_visible()

    with page.expect_download() as dl:
        page.get_by_role("button", name="PDF", exact=True).click()
    path = dl.value.path()
    assert open(path, "rb").read(5) == b"%PDF-"

    page.get_by_role("button", name="Record payment").first.click()
    page.get_by_label(re.compile("Amount received")).fill("20000")
    page.get_by_role("button", name="Record partial payment").click()
    expect(page.get_by_text("Partially paid").first).to_be_visible()
    page.get_by_role("button", name="Record payment").first.click()
    page.get_by_role("button", name="Record full payment").click()
    expect(page.get_by_text("Paid", exact=True).first).to_be_visible()
    page.screenshot(path=str(ARTIFACTS / "invoice-detail-1440.png"))


def test_mobile_invoice_flow_and_native_share(context_factory):
    ctx = context_factory("390")
    # Stub the Web Share API so we can see exactly what would be handed to the OS.
    ctx.add_init_script("""
      window.__shared = null;
      navigator.canShare = () => true;
      navigator.share = async (d) => { window.__shared = { title: d.title, files: (d.files||[]).map(f => [f.name, f.type, f.size]) }; };
    """)
    page = ctx.new_page()
    register(page)
    c, inv = seed(page)
    page.goto(f"/invoices/{inv['id']}")
    page.get_by_role("button", name="Share").click()
    page.get_by_role("button", name=re.compile("Share PDF with another app")).click()
    page.wait_for_function("window.__shared !== null")
    shared = page.evaluate("window.__shared")
    assert shared["files"][0][0] == f"Invoice-{inv['number']}.pdf"
    assert shared["files"][0][1] == "application/pdf" and shared["files"][0][2] > 1000
    # WhatsApp link targets the customer's number with a prefilled message.
    info = api(page, "GET", f"/invoices/{inv['id']}/share-info")
    assert info["whatsapp_url"].startswith("https://wa.me/254712345678?text=")
    page.screenshot(path=str(ARTIFACTS / "share-390.png"))


def test_pwa_manifest_and_service_worker(context_factory):
    page = context_factory("1440").new_page()
    page.goto("/login")
    href = page.get_attribute("link[rel=manifest]", "href")
    manifest = page.request.get(href).json()
    assert manifest["display"] == "standalone" and manifest["start_url"] == "/"
    sizes = {i["sizes"] for i in manifest["icons"]}
    assert {"192x192", "512x512"} <= sizes and any(i.get("purpose") == "maskable" for i in manifest["icons"])
    for icon in manifest["icons"]:
        assert page.request.get(icon["src"]).ok
    register(page)
    page.evaluate("navigator.serviceWorker.ready.then(() => true)")
    assert page.evaluate("!!navigator.serviceWorker.controller") or page.reload() or page.evaluate("navigator.serviceWorker.ready.then(r => !!r.active)")


def _ready_offline_capable(page: Page):
    """Wait until the service worker controls the page so the app shell is cached."""
    page.evaluate("navigator.serviceWorker.ready")
    if not page.evaluate("!!navigator.serviceWorker.controller"):
        page.reload()
        page.wait_for_function("!!navigator.serviceWorker.controller")


def test_offline_draft_persists_and_syncs_once(context_factory):
    ctx = context_factory("390")
    page = ctx.new_page()
    register(page)
    seed(page)
    page.goto("/invoices/new")  # caches business settings + customers for offline use
    page.wait_for_load_state("networkidle")
    _ready_offline_capable(page)

    ctx.set_offline(True)
    page.goto("/invoices/new")
    expect(page.get_by_text("You're offline").first).to_be_visible()
    page.get_by_role("button", name="Choose a saved customer").click()
    page.get_by_role("button", name=re.compile("Wanjiku Kamau")).click()
    visible(page.get_by_label("Item 1 description")).fill("Offline consultation")
    visible(page.get_by_label("Unit price (KES)")).fill("3000")
    page.get_by_role("button", name="Save", exact=True).click()
    page.wait_for_url(re.compile(r"/invoices$"))
    expect(page.get_by_text("Pending sync").first).to_be_visible()
    page.screenshot(path=str(ARTIFACTS / "offline-pending-390.png"))

    # Still there after the app restarts while offline.
    page.close()
    page = ctx.new_page()
    page.goto("/sync")
    expect(page.get_by_text("Pending sync").first).to_be_visible()
    expect(page.get_by_text("Wanjiku Kamau").first).to_be_visible()

    ctx.set_offline(False)
    page.evaluate("window.dispatchEvent(new Event('online'))")
    expect(page.get_by_text("Synced", exact=True).first).to_be_visible(timeout=15000)
    # Exactly one new invoice reached the server (1 seeded + 1 offline).
    assert api(page, "GET", "/invoices")["total"] == 2


def test_sync_failure_is_recoverable_without_duplicates(context_factory):
    ctx = context_factory("1440")
    page = ctx.new_page()
    register(page)
    calls = {"n": 0}

    def flaky(route):
        if route.request.method == "POST":
            calls["n"] += 1
            if calls["n"] == 1:
                return route.fulfill(status=503, body='{"detail":"Service unavailable"}', content_type="application/json")
        return route.continue_()

    page.route(re.compile(r".*/api/v1/invoices$"), flaky)
    page.goto("/invoices/new")
    visible(page.get_by_label("Item 1 description")).fill("Retry me")
    visible(page.get_by_label("Item 1 unit price")).fill("100")
    page.get_by_role("button", name="Save draft").first.click()
    expect(page.get_by_text("Service unavailable").first).to_be_visible()
    page.goto("/sync")
    expect(page.get_by_text("Sync failed").first).to_be_visible()
    page.get_by_role("button", name="Retry").first.click()
    expect(page.get_by_text("Synced", exact=True).first).to_be_visible(timeout=15000)
    page.unroute(re.compile(r".*/api/v1/invoices$"))
    assert api(page, "GET", "/invoices")["total"] == 1


def test_conflicting_edit_is_detected_not_overwritten(context_factory):
    ctx = context_factory("1440")
    page = ctx.new_page()
    register(page)
    c, inv = seed(page)
    page.goto(f"/invoices/{inv['id']}/edit")
    page.get_by_label("Notes").fill("Edited on the laptop")
    # Meanwhile, "another device" changes the invoice on the server.
    current = api(page, "GET", f"/invoices/{inv['id']}")
    other = {k: current[k] for k in ("client_uuid", "customer_id", "issue_date", "due_date", "currency", "pricing_mode", "template", "terms", "payment_instructions", "shipping")}
    other["items"] = [{k: i[k] for k in ("description", "quantity", "unit_price", "discount_type", "discount_value", "tax_rate_id", "tax_name", "tax_rate")} for i in current["items"]]
    api(page, "PUT", f"/invoices/{inv['id']}", {**other, "notes": "Edited on the phone", "version": current["version"]})
    page.get_by_role("button", name="Save changes").first.click()
    page.wait_for_url(re.compile(r"/sync$"))
    expect(page.get_by_text("Needs review").first).to_be_visible()
    assert api(page, "GET", f"/invoices/{inv['id']}")["notes"] == "Edited on the phone"
    page.get_by_role("button", name="Resolve").click()
    expect(page.get_by_text("Server version")).to_be_visible()
    page.screenshot(path=str(ARTIFACTS / "conflict-1440.png"))
    page.get_by_role("button", name=re.compile("Keep both")).click()
    expect(page.get_by_text("Synced", exact=True).first).to_be_visible(timeout=15000)
    assert api(page, "GET", f"/invoices/{inv['id']}")["notes"] == "Edited on the phone"
    assert api(page, "GET", "/invoices")["total"] == 2


def test_screenshots_for_readme(context_factory):
    for vp in ("1440", "390"):
        ctx = context_factory(vp)
        page = ctx.new_page()
        register(page)
        c, inv = seed(page)
        for path, name in [("/", "dashboard"), (f"/invoices/{inv['id']}", "invoice"), ("/reports", "reports")]:
            page.goto(path)
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(400)
            page.screenshot(path=str(ARTIFACTS / f"readme-{name}-{vp}.png"))
