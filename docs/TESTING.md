# Testing

## Suites

| Suite | Location | Run with | Covers |
|---|---|---|---|
| Backend unit + API | `backend/tests` | `cd backend && pytest` | Calculations (shared fixtures), rounding, currency formatting, Kenyan phone numbers, auth (hashing, login, refresh rotation and reuse detection, logout, password change, rate limiting), cross-account data isolation, invoices (numbering, validation, idempotent create, offline new-customer, version conflicts, idempotent retries, search/filter/sort/pagination, duplicate/cancel/delete, CSV and formula-injection safety), payments (partial/full, overpayment, idempotency, deletion, overdue detection), customers, business settings, tax rates, logo upload validation, PDFs (all 4 templates, A4 size, 150-row multi-page invoice with long description, logo embedded, inclusive tax, unsaved preview), sharing (WhatsApp/mailto, public links, drafts never public, SMTP accepted/failed), quotations and conversion, dashboard/report figures, per-currency reports, backup/restore round trip and atomic failure |
| Frontend unit | `frontend/src/**/*.test.ts` | `cd frontend && npm test` | Same calculation fixtures as the backend, formatting, phone numbers, and the offline sync engine against a fake server: local-only autosave, pending while offline, sync on reconnect, lost-response retry without duplicates, concurrent runs, failed vs retryable errors, conflict detection, explicit overwrite, save-as-copy |
| End-to-end (browser) | `tests/e2e` | `pytest tests/e2e` (after `npm run build`) | No horizontal overflow on 9 pages at 360/390/430/768/1024/1440 px, navigation adapts (sidebar vs bottom bar), full invoice lifecycle through the UI incl. PDF download and partial → full payment, native share hands over the actual PDF file, manifest/icons/service worker, offline draft survives restart and syncs exactly once, failed sync recovers via Retry without duplicates, conflicting edits detected and resolved without overwriting |

## Recorded results

| Date | Suite | Result |
|---|---|---|
| 2026-11-03 | PDF renderer (all 4 templates, 3-item and 45-item invoices) | **Executed** — rendered with ReportLab, each 3-item invoice is 1 A4 page, the 45-item invoice paginates to 4 pages, totals verified visually (see `docs/sample-*.pdf`, `docs/screenshots/pdf-templates.png`). |
| 2026-11-03 | Shared calculation fixtures vs. backend engine | **Executed** — all 6 cases match. |
| 2026-11-03 | Syntax check (all Python files compile; all 41 TypeScript files parse) | **Executed** — no errors. |
| — | Backend pytest, frontend vitest, end-to-end Playwright | **Not yet run.** The build environment used to write this project could not reach PyPI/npm, so FastAPI, SQLAlchemy, React etc. could not be installed. Run the commands above to execute them. |

This table is updated whenever the suites are run; nothing is listed as passing unless it was actually executed.
