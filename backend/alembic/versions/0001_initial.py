"""Initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-03
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import app.database.types as t

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    ]


def _doc_columns():
    return [
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("number", sa.String(40), nullable=False),
        sa.Column("client_uuid", sa.String(36), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("last_client_revision", sa.String(36)),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("issue_date", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("pricing_mode", sa.String(10), nullable=False),
        sa.Column("template", sa.String(32), nullable=False),
        sa.Column("customer_snapshot", sa.JSON()),
        sa.Column("business_snapshot", sa.JSON()),
        sa.Column("notes", sa.Text()),
        sa.Column("terms", sa.Text()),
        sa.Column("payment_instructions", sa.Text()),
        sa.Column("shipping", t.Money(), nullable=False),
        sa.Column("subtotal", t.Money(), nullable=False),
        sa.Column("discount_total", t.Money(), nullable=False),
        sa.Column("tax_total", t.Money(), nullable=False),
        sa.Column("total", t.Money(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("business_id", sa.Integer(), sa.ForeignKey("businesses.id", ondelete="CASCADE", name=None), nullable=False),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("customers.id", ondelete="RESTRICT")),
        *_ts(),
    ]


def _item_columns(parent_fk: str, parent_table: str):
    return [
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("quantity", t.Quantity(), nullable=False),
        sa.Column("unit_price", t.Money(), nullable=False),
        sa.Column("discount_type", sa.String(10), nullable=False),
        sa.Column("discount_value", t.Money(), nullable=False),
        sa.Column("tax_name", sa.String(60)),
        sa.Column("tax_rate", t.Rate(), nullable=False),
        sa.Column("line_subtotal", t.Money(), nullable=False),
        sa.Column("line_discount", t.Money(), nullable=False),
        sa.Column("line_tax", t.Money(), nullable=False),
        sa.Column("line_total", t.Money(), nullable=False),
        sa.Column("tax_rate_id", sa.Integer(), sa.ForeignKey("tax_rates.id", ondelete="SET NULL")),
        sa.Column(parent_fk, sa.Integer(), sa.ForeignKey(f"{parent_table}.id", ondelete="CASCADE"), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("full_name", sa.String(120), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        *_ts(),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])

    templates = op.create_table(
        "invoice_templates",
        sa.Column("key", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("description", sa.String(255), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
    )
    op.bulk_insert(templates, [
        {"key": "modern", "name": "Modern Minimal", "description": "Airy, light layout with a single accent rule.", "sort_order": 1},
        {"key": "corporate", "name": "Corporate Professional", "description": "Bold branded header band and structured tables.", "sort_order": 2},
        {"key": "elegant", "name": "Elegant Business", "description": "Serif typography, centred masthead and refined rules.", "sort_order": 3},
        {"key": "classic", "name": "Classic Standard", "description": "Traditional bordered layout that prints cleanly anywhere.", "sort_order": 4},
    ])

    op.create_table(
        "businesses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("email", sa.String(254)),
        sa.Column("phone", sa.String(20)),
        sa.Column("address", sa.Text()),
        sa.Column("website", sa.String(255)),
        sa.Column("registration_number", sa.String(64)),
        sa.Column("kra_pin", sa.String(20)),
        sa.Column("vat_registered", sa.Boolean(), nullable=False),
        sa.Column("vat_number", sa.String(64)),
        sa.Column("logo", sa.LargeBinary()),
        sa.Column("logo_mime", sa.String(32)),
        sa.Column("logo_updated_at", sa.DateTime(timezone=True)),
        *_ts(),
    )

    op.create_table(
        "tax_rates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("business_id", sa.Integer(), sa.ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("rate", t.Rate(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        *_ts(),
        sa.UniqueConstraint("business_id", "name", name="uq_tax_rates_business_name"),
    )
    op.create_index("ix_tax_rates_business_id", "tax_rates", ["business_id"])

    op.create_table(
        "business_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("business_id", sa.Integer(), sa.ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("default_currency", sa.String(3), nullable=False),
        sa.Column("default_tax_rate_id", sa.Integer(), sa.ForeignKey("tax_rates.id", ondelete="SET NULL")),
        sa.Column("pricing_mode", sa.String(10), nullable=False),
        sa.Column("payment_terms_days", sa.Integer(), nullable=False),
        sa.Column("quote_validity_days", sa.Integer(), nullable=False),
        sa.Column("invoice_number_format", sa.String(40), nullable=False),
        sa.Column("next_invoice_seq", sa.Integer(), nullable=False),
        sa.Column("quote_number_format", sa.String(40), nullable=False),
        sa.Column("next_quote_seq", sa.Integer(), nullable=False),
        sa.Column("default_template", sa.String(32), sa.ForeignKey("invoice_templates.key", ondelete="RESTRICT"), nullable=False),
        sa.Column("date_format", sa.String(16), nullable=False),
        sa.Column("show_signature", sa.Boolean(), nullable=False),
        sa.Column("accent_color", sa.String(7), nullable=False),
        sa.Column("default_notes", sa.Text()),
        sa.Column("default_terms", sa.Text()),
        sa.Column("bank_name", sa.String(120)),
        sa.Column("bank_account_name", sa.String(160)),
        sa.Column("bank_account_number", sa.String(64)),
        sa.Column("bank_branch", sa.String(120)),
        sa.Column("bank_swift", sa.String(20)),
        sa.Column("mpesa_type", sa.String(10), nullable=False),
        sa.Column("mpesa_paybill", sa.String(10)),
        sa.Column("mpesa_account", sa.String(40)),
        sa.Column("mpesa_till", sa.String(10)),
        sa.Column("mpesa_phone", sa.String(20)),
        sa.Column("mpesa_name", sa.String(120)),
        sa.Column("other_payment_instructions", sa.Text()),
        *_ts(),
    )

    op.create_table(
        "customers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("business_id", sa.Integer(), sa.ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("company", sa.String(160)),
        sa.Column("email", sa.String(254)),
        sa.Column("phone", sa.String(20)),
        sa.Column("billing_address", sa.Text()),
        sa.Column("tax_id", sa.String(64)),
        sa.Column("notes", sa.Text()),
        sa.Column("is_archived", sa.Boolean(), nullable=False),
        *_ts(),
    )
    op.create_index("ix_customers_business_id", "customers", ["business_id"])
    op.create_index("ix_customers_business_name", "customers", ["business_id", "name"])

    # Quotations first (invoices reference them); the reverse link is added afterwards.
    op.create_table(
        "quotations",
        *_doc_columns(),
        sa.Column("valid_until", sa.Date(), nullable=False),
        sa.Column("converted_invoice_id", sa.Integer()),
        sa.Column("converted_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("business_id", "number", name="uq_quotations_business_number"),
        sa.UniqueConstraint("business_id", "client_uuid", name="uq_quotations_business_client_uuid"),
    )
    op.create_index("ix_quotations_business_status", "quotations", ["business_id", "status"])
    op.create_index("ix_quotations_business_issue_date", "quotations", ["business_id", "issue_date"])

    op.create_table(
        "invoices",
        *_doc_columns(),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("amount_paid", t.Money(), nullable=False),
        sa.Column("balance_due", t.Money(), nullable=False),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        sa.Column("share_token", sa.String(64), unique=True),
        sa.Column("quotation_id", sa.Integer(), sa.ForeignKey("quotations.id", ondelete="SET NULL")),
        sa.UniqueConstraint("business_id", "number", name="uq_invoices_business_number"),
        sa.UniqueConstraint("business_id", "client_uuid", name="uq_invoices_business_client_uuid"),
    )
    op.create_index("ix_invoices_business_status", "invoices", ["business_id", "status"])
    op.create_index("ix_invoices_business_issue_date", "invoices", ["business_id", "issue_date"])
    op.create_index("ix_invoices_business_due_date", "invoices", ["business_id", "due_date"])
    op.create_index("ix_invoices_business_customer", "invoices", ["business_id", "customer_id"])

    with op.batch_alter_table("quotations") as batch:
        batch.create_foreign_key(
            "fk_quotations_converted_invoice_id_invoices", "invoices", ["converted_invoice_id"], ["id"], ondelete="SET NULL"
        )

    op.create_table("invoice_items", *_item_columns("invoice_id", "invoices"))
    op.create_index("ix_invoice_items_invoice_id", "invoice_items", ["invoice_id"])
    op.create_table("quotation_items", *_item_columns("quotation_id", "quotations"))
    op.create_index("ix_quotation_items_quotation_id", "quotation_items", ["quotation_id"])

    op.create_table(
        "payments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("business_id", sa.Integer(), sa.ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invoice_id", sa.Integer(), sa.ForeignKey("invoices.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("client_uuid", sa.String(36)),
        sa.Column("payment_date", sa.Date(), nullable=False),
        sa.Column("amount", t.Money(), nullable=False),
        sa.Column("method", sa.String(20), nullable=False),
        sa.Column("reference", sa.String(120)),
        sa.Column("notes", sa.Text()),
        *_ts(),
        sa.UniqueConstraint("business_id", "client_uuid", name="uq_payments_business_client_uuid"),
    )
    op.create_index("ix_payments_invoice_id", "payments", ["invoice_id"])
    op.create_index("ix_payments_business_date", "payments", ["business_id", "payment_date"])

    op.create_table(
        "email_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("business_id", sa.Integer(), sa.ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invoice_id", sa.Integer(), sa.ForeignKey("invoices.id", ondelete="SET NULL")),
        sa.Column("to_email", sa.String(254), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_email_logs_business_id", "email_logs", ["business_id"])
    op.create_index("ix_email_logs_invoice_id", "email_logs", ["invoice_id"])


def downgrade() -> None:
    for name in ("email_logs", "payments", "quotation_items", "invoice_items"):
        op.drop_table(name)
    with op.batch_alter_table("quotations") as batch:
        batch.drop_constraint("fk_quotations_converted_invoice_id_invoices", type_="foreignkey")
    for name in ("invoices", "quotations", "customers", "business_settings", "tax_rates", "businesses", "invoice_templates", "refresh_tokens", "users"):
        op.drop_table(name)
