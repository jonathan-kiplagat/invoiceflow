# InvoiceFlow

**Professional invoicing for freelancers and small businesses in Kenya — on your phone or your computer, online or offline.**

InvoiceFlow is an installable Progressive Web App for creating invoices and quotations, generating print-ready PDFs, sharing them over WhatsApp or email, and tracking M-Pesa, bank and cash payments. It is built Kenya-first (KSh, KRA PIN, configurable VAT, M-Pesa instructions, Africa/Nairobi time) and works with other major currencies too.

## Screenshots

*Captured automatically by the end-to-end test suite in a real browser.*

| Dashboard (desktop) | Invoice with payments (desktop) |
|---|---|
| ![Dashboard](docs/screenshots/dashboard-1440.png) | ![Invoice detail](docs/screenshots/invoice-1440.png) |

| Phone: dashboard | Phone: new invoice | Phone: offline draft, pending sync | Phone: share sheet |
|---|---|---|---|
| ![](docs/screenshots/dashboard-390.png) | ![](docs/screenshots/editor-390.png) | ![](docs/screenshots/offline-pending-390.png) | ![](docs/screenshots/share-390.png) |

| Reports | Conflict resolution |
|---|---|
| ![Reports](docs/screenshots/reports-1440.png) | ![Conflict](docs/screenshots/conflict-1440.png) |

**The four PDF templates** — Modern Minimal, Corporate Professional, Elegant Business, Classic Standard ([sample PDFs](docs)):

![PDF templates](docs/screenshots/pdf-templates.png)

---

## Features

**Invoicing**
- Invoice editor with multiple line items, quantities to 3 decimals, per-line % or fixed discounts, per-line tax, shipping/other charges
- Tax-exclusive **and** tax-inclusive pricing, with a VAT summary by rate
- Automatic numbering with a configurable format (e.g. `INV-{YYYY}-{SEQ:4}` → `INV-2026-0042`)
- Drafts, mark as sent, duplicate, cancel/reopen, delete (with confirmation; invoices with payments can only be cancelled)
- Pick a saved customer or add one straight from the invoice form
- Live, exact (decimal) totals that match what the server stores
- Notes, terms & conditions and payment instructions pre-filled from Settings

**PDF & sharing**
- Four vector PDF templates: **Modern Minimal, Corporate Professional, Elegant Business, Classic Standard** — real PDFs (ReportLab), not screenshots
- A4 pages, header rows repeat on every page, long rows split instead of being cut off, totals kept together, “Page x of y”, logo, signature line, Draft/Paid/Cancelled watermark
- On-screen preview of every template (works offline), plus server-rendered PDF preview before saving
- Download, print, native share sheet (sends the actual PDF file on supported phones), WhatsApp link to the customer's number with a prefilled message, email (SMTP if configured, otherwise a prepared message for your own mail app), and revocable public links
- Customer statements (PDF) with running balance

**Payments, customers, quotations**
- Record full or partial payments: date, amount, method (M-Pesa, bank transfer, cash, card, cheque, other), reference, notes
- Status updates automatically from recorded payments: Draft → Sent → Partially paid → Paid, with automatic **Overdue** detection (Nairobi date). An invoice is never marked paid without a recorded payment.
- Customer management with search, archive, invoice history, totals invoiced/paid/outstanding
- Quotations with accept/decline and one-click conversion to an invoice

**Dashboard & reports**
- KPIs, 12-month invoiced-vs-collected chart, paid vs. unpaid, status distribution, recent invoices and payments
- Reports: year-to-date invoiced and collected, outstanding and overdue receivables, ageing buckets, customer payment performance (average days to pay, % paid on time), top customers, payment method mix, quotation conversion rate — all exportable to CSV
- Invoiced revenue, collected cash and outstanding receivables are always kept separate

**Progressive Web App**
- Installable (manifest, icons incl. maskable, standalone display, shortcuts); service worker precaches the app shell
- Create and edit invoice/quotation drafts **offline**, stored in IndexedDB and surviving restarts
- Automatic sync on reconnect, on focus and every 30 s, with retry/backoff and a Sync centre
- Clear, honest states: **Saved locally · Pending sync · Synced · Sync failed · Needs review (conflict)**
- Idempotent creation (no duplicates on retry) and optimistic-concurrency conflict detection — newer server data is never silently overwritten

**Settings & data**
- Business profile and logo, KRA PIN, VAT registration, configurable tax rates, default currency/terms/template/date format/brand colour
- M-Pesa (Paybill, Buy Goods till, Send Money) and bank payment instructions
- CSV exports, full JSON backup and atomic restore
- Light, dark and system themes

## What is *not* included (by design)

- **No real payment processing.** InvoiceFlow does not collect M-Pesa (Daraja/STK push) or card payments. It records payments you have received.
- **No KRA eTIMS integration.** It does not issue electronic tax invoices, is not eTIMS-certified, and does not submit anything to KRA. Tax rates are user-configurable — confirm current rates with KRA or your accountant.
- **Email delivery requires SMTP credentials.** Without them, the app prepares the email for you to send from your own mail app and never claims it was sent.

## Technology

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Lucide icons, Recharts | Fast, typed, mobile-first UI |
| PWA | vite-plugin-pwa (Workbox), IndexedDB via `idb` | Installable app shell + durable offline drafts |
| Money maths | `decimal.js` (client), `Decimal` (server) | No floating-point errors; both sides tested against the same fixtures |
| Backend | Python FastAPI, Pydantic v2, SQLAlchemy 2, Alembic | Validated REST API, migrations |
| Database | PostgreSQL (production), SQLite (local dev) | Money in `NUMERIC(18,2)`; SQLite stores exact decimal text |
| PDF | ReportLab Platypus with embedded OFL fonts | True vector PDFs with reliable pagination |
| Auth | scrypt password hashing, short-lived JWT access tokens, rotating refresh tokens with reuse detection | No extra native dependencies |

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/OFFLINE_SYNC.md](docs/OFFLINE_SYNC.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [docs/TESTING.md](docs/TESTING.md)

## Project structure

```
invoiceflow/
├── backend/
│   ├── app/
│   │   ├── api/          # REST endpoints (auth, business, customers, invoices, quotations, reports, data)
│   │   ├── core/         # config, security, rate limiting, money, phone, time
│   │   ├── database/     # engine/session, exact decimal column types
│   │   ├── models/       # SQLAlchemy models
│   │   ├── schemas/      # Pydantic request/response models
│   │   ├── services/     # calculations, numbering, statuses, payments, PDF, sharing, backup
│   │   └── assets/fonts/ # fonts embedded in PDFs (SIL OFL)
│   ├── alembic/          # database migrations
│   └── tests/            # pytest API & unit tests
├── frontend/
│   ├── public/icons/     # PWA icons
│   └── src/{components,hooks,layouts,pages,services,types,utils}
├── tests/
│   ├── fixtures/         # calculation cases shared by backend and frontend tests
│   └── e2e/              # Playwright browser tests (6 viewport sizes, offline, sync)
├── docs/
├── Dockerfile, docker-compose.yml, .env.example
└── README.md, LICENSE
```

## Getting started (local development)

Requirements: **Python 3.11+**, **Node.js 20+**. PostgreSQL is optional locally (SQLite is used by default).

```bash
git clone https://github.com/jonathan-kiplagat/invoiceflow.git
cd invoiceflow
cp .env.example backend/.env        # then set SECRET_KEY

# Backend
cd backend
python -m venv .venv
source .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
alembic upgrade head                # creates invoiceflow.db (SQLite)
uvicorn app.main:app --reload       # http://127.0.0.1:8000  (API docs: /api/docs)

# Frontend (second terminal)
cd frontend
npm install
npm run dev                         # http://localhost:5173 (proxies /api to :8000)
```

Open http://localhost:5173, create an account, then fill in **Settings** (business details, KRA PIN, M-Pesa/bank details).

To try it on your phone on the same Wi-Fi: `npm run dev -- --host` and open the shown network address. (Installing as an app and the service worker need HTTPS or `localhost`; use the production build behind HTTPS for full PWA behaviour on phones.)

## Environment configuration

All settings come from environment variables (or `backend/.env`). See [`.env.example`](.env.example) for the full list.

| Variable | Purpose |
|---|---|
| `SECRET_KEY` | Signs access tokens. **Required** (≥32 random chars) when `ENVIRONMENT=production`. |
| `DATABASE_URL` | `sqlite:///./invoiceflow.db` or `postgresql://user:pass@host:5432/db` |
| `CORS_ORIGINS` | Allowed browser origins if the frontend is served from another origin |
| `PUBLIC_APP_URL` | Used to build shareable invoice links |
| `TIMEZONE` | Defaults to `Africa/Nairobi` (overdue detection, dates) |
| `SMTP_*` | Optional email delivery. Leave `SMTP_HOST` empty to disable. |

## Database

- **Local:** SQLite file, created by `alembic upgrade head`.
- **Production:** PostgreSQL. Set `DATABASE_URL`, then run `alembic upgrade head` (the Docker image does this on start).
- Money is stored as exact decimals; multi-record operations (invoice + items, payment + balance, quotation conversion, restore) run in single transactions.
- Every query is scoped to the signed-in account; another account's IDs return `404`.

## Running tests

```bash
# Backend (unit + API, incl. data isolation, PDFs, sync idempotency, conflicts)
cd backend && pytest

# Frontend (calculation fixtures, formatting, offline sync engine)
cd frontend && npm test

# End-to-end in a real browser (desktop + 360/390/430/768/1024/1440 px, offline, sync)
cd frontend && npm run build && cd ..
pip install -r backend/requirements-dev.txt && playwright install chromium
E2E_PYTHON=backend/.venv/bin/python pytest tests/e2e
```

**Latest results (3 Nov 2026):** backend **74/74** passed on SQLite *and* PostgreSQL 16 · frontend **21/21** · end-to-end **13/13** (stable over 3 consecutive runs). See [docs/TESTING.md](docs/TESTING.md) for details.

## Deployment

```bash
cp .env.example .env     # set SECRET_KEY, POSTGRES_PASSWORD, PUBLIC_APP_URL
docker compose up --build -d
```

This runs PostgreSQL and a single InvoiceFlow container that serves both the API and the PWA on port 8000. Put it behind HTTPS (required for installation and service workers on phones). Details, including non-Docker hosting, are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Browser support notes

- **Android (Chrome, Edge, Samsung Internet) and desktop Chrome/Edge:** install prompt, offline drafts, native PDF sharing.
- **iPhone/iPad (Safari, iOS 16.4+):** install via *Share → Add to Home Screen*; offline drafts work; sync runs while the app is open (iOS has no Background Sync).
- **Firefox desktop:** works fully in the browser, but Firefox doesn't support installing PWAs; native file sharing isn't available on desktop browsers that lack the Web Share API.
- WhatsApp links cannot attach files — use the native share sheet to send the PDF itself, or include the invoice link.

## Future improvements

- M-Pesa Daraja integration (STK push, C2B confirmation) to reconcile payments automatically
- KRA eTIMS integration once the official API is implemented and verified
- Recurring invoices and automatic payment reminders
- Multi-user businesses with roles
- Offline payment recording and offline PDF generation
- Server-side (Redis) rate limiting for multi-instance deployments

## License

[MIT](LICENSE) © 2026 Jonathan Kiplagat
