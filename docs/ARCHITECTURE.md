# Architecture

```
 Browser / installed PWA                          Server
 ┌───────────────────────────────┐   HTTPS/JSON   ┌──────────────────────────────┐
 │ React UI (pages, components)  │ ─────────────▶ │ FastAPI routers (/api/v1)    │
 │ useApp: auth, business, sync  │                │  ├─ deps: auth + ownership    │
 │ SyncEngine ── IndexedDB       │ ◀───────────── │  ├─ services (domain logic)   │
 │ Service worker (app shell)    │   PDF / CSV    │  ├─ ReportLab PDF renderer    │
 └───────────────────────────────┘                │  └─ SQLAlchemy ─▶ PostgreSQL  │
                                                  └──────────────────────────────┘
```

## Key decisions

| Decision | Reasoning |
|---|---|
| **Server is the source of truth for money.** The client computes totals for live preview only; the server recomputes every line and total on save. | Prevents tampered or buggy client maths reaching the database. Both implementations are tested against `tests/fixtures/calc_cases.json`. |
| **Decimal everywhere**, half-up rounding to cents per line. | Accounting-correct; no float drift. PostgreSQL `NUMERIC(18,2)`; on SQLite the same columns store exact decimal text. |
| **Derived invoice status.** Stored facts: `sent_at`, `cancelled_at`, payments. Status = cancelled → paid (payments ≥ total) → draft → overdue (due date < today in Nairobi) → partially paid → sent. | An invoice can only become *Paid* through recorded payments. Overdue detection runs whenever lists, dashboards or reports load. |
| **Snapshots on documents.** Business and customer details are copied onto each invoice. | Editing a customer later doesn't rewrite history or change old PDFs. |
| **Invoices and quotations in separate tables** sharing column mixins. | Separate numbering, statuses and rules, without duplicated code. |
| **ReportLab (Platypus) for PDFs** instead of HTML-to-PDF. | Real vector PDFs, precise A4 layout, repeating table headers, safe row splitting, no headless browser in production. |
| **scrypt (stdlib) for passwords.** | Memory-hard and OWASP-recommended, with no native build dependency. |
| **Short-lived JWT + rotating refresh tokens** (hashed in DB, reuse revokes the session family). | Stateless API auth with server-side revocation (logout, password change). |
| **Single-origin deployment.** FastAPI serves the built PWA. | Service worker and API share an origin; no CORS needed in production. |
| **Offline via IndexedDB outbox, not service-worker request replay.** | The app controls idempotency, conflicts and honest status labels. See [OFFLINE_SYNC.md](OFFLINE_SYNC.md). |

## Data model

```
users 1─1 businesses 1─1 business_settings
                │  1─* tax_rates
                │  1─* customers 1─* invoices / quotations
                │  1─* invoices 1─* invoice_items
                │              1─* payments
                │  1─* quotations 1─* quotation_items
                │  1─* email_logs
invoice_templates (catalogue)  ◀─ business_settings.default_template
refresh_tokens *─1 users
```

Constraints worth knowing: unique `(business_id, number)` and `(business_id, client_uuid)` on invoices/quotations; unique `(business_id, client_uuid)` on payments (idempotent payment recording); customers referenced by documents can't be deleted (archive instead); invoices with payments can't be deleted (cancel instead).

## Security

- Every endpoint resolves the caller's business and loads records through ownership checks; foreign IDs return `404`, identical to "not found".
- Pydantic validation on all input; SQLAlchemy parameterised queries; CSV exports neutralise spreadsheet formula injection.
- Logo uploads: size-limited, verified and re-encoded with Pillow (strips anything that isn't pixel data; SVG rejected).
- Rate limiting on register/login/refresh/password change; security headers; `no-store` on API responses; generic 500 errors.
- Public share links use 192-bit random tokens, are revocable, and never expose drafts.
- Secrets only via environment variables; `.env` is git-ignored.
