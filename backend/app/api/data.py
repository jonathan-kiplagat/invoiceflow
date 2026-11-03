import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select

from app.api.deps import DB, CurrentBusiness
from app.api.responses import pdf_response
from app.core.config import get_settings
from app.core.money import format_money
from app.core.timeutil import today_local
from app.models import Business, Invoice
from app.services.backup import export_backup, restore_backup
from app.services.pdf import render_document, view_from_model
from app.services.status import refresh_invoice

router = APIRouter(tags=["data"])
public = APIRouter(prefix="/public", tags=["public"])


@router.get("/backup/export")
def backup_export(business: CurrentBusiness, db: DB) -> Response:
    payload = json.dumps(export_backup(db, business), ensure_ascii=False, indent=1)
    filename = f"invoiceflow-backup-{today_local().isoformat()}.json"
    return Response(payload, media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/backup/restore")
async def backup_restore(
    business: CurrentBusiness, db: DB, file: UploadFile = File(...), confirm: str = Form(...)
) -> dict:
    if confirm != "REPLACE":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, 'Type REPLACE to confirm that all current data will be replaced')
    limit = get_settings().max_backup_bytes
    raw = await file.read(limit + 1)
    if len(raw) > limit:
        raise HTTPException(413, "Backup file is too large")
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise HTTPException(422, "The file is not valid JSON") from None
    if not isinstance(data, dict):
        raise HTTPException(422, "This is not an InvoiceFlow backup file")
    return {"restored": restore_backup(db, business, data)}


def _shared_invoice(db, token: str) -> tuple[Invoice, Business]:
    if not token or len(token) > 64:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This link is not valid")
    inv = db.execute(select(Invoice).where(Invoice.share_token == token)).scalar_one_or_none()
    if inv is None or inv.status == "draft":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This link is not valid or has been turned off")
    business = db.get(Business, inv.business_id)
    refresh_invoice(inv)
    return inv, business


@public.get("/invoices/{token}")
def public_invoice(token: str, db: DB) -> dict:
    """Minimal read-only view for customers who open a shared link. No internal IDs exposed."""
    inv, business = _shared_invoice(db, token)
    snap = inv.business_snapshot or {}
    return {
        "number": inv.number,
        "status": inv.status,
        "issue_date": inv.issue_date.isoformat(),
        "due_date": inv.due_date.isoformat(),
        "currency": inv.currency,
        "total": format(inv.total, "f"),
        "amount_paid": format(inv.amount_paid, "f"),
        "balance_due": format(inv.balance_due, "f"),
        "total_display": format_money(inv.total, inv.currency),
        "balance_display": format_money(inv.balance_due, inv.currency),
        "business_name": snap.get("name") or business.name,
        "business_email": snap.get("email"),
        "business_phone": snap.get("phone"),
        "customer_name": (inv.customer_snapshot or {}).get("name"),
        "payment_instructions": inv.payment_instructions,
        "items": [{"description": i.description, "quantity": format(i.quantity.normalize(), "f"), "line_total": format(i.line_total, "f")} for i in inv.items],
    }


@public.get("/invoices/{token}/pdf")
def public_invoice_pdf(token: str, db: DB, download: bool = False) -> Response:
    inv, business = _shared_invoice(db, token)
    pdf = render_document(view_from_model(inv, business), inv.template, business.logo)
    return pdf_response(pdf, f"invoice-{inv.number}", download)
