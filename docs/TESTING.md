# Testing

## Suites

| Suite | Location | Run with | Covers |
|---|---|---|---|
| Backend unit + API | `backend/tests` | `cd backend && pytest` | Calculations (shared fixtures), rounding, currency formatting, Kenyan phone numbers, auth (hashing, login, refresh rotation and reuse detection, logout, password change, rate limiting), cross-account data isolation, invoices (numbering, validation, idempotent create, offline new-customer, version conflicts, idempotent retries, search/filter/sort/pagination, duplicate/cancel/delete, CSV and formula-injection safety), payments (partial/full, overpayment, idempotency, deletion, overdue detection), customers, business settings, tax rates, logo upload validation, PDFs (all 4 templates, A4 size, 150-row multi-page invoice with long description, logo embedded, inclusive tax, unsaved preview), sharing (WhatsApp/mailto, public links, drafts never public, SMTP accepted/failed), quotations and conversion, dashboard/report figures, per-currency reports, backup/restore round trip and atomic failure |
| Frontend unit | `frontend/src/**/*.test.ts` | `cd frontend && npm test` | Same calculation fixtures as the backend, formatting, phone numbers, and the offline sync engine against a fake server: local-only autosave, pending while offline, sync on reconnect, lost-response retry without duplicates, concurrent runs, failed vs retryable errors, conflict detection, explicit overwrite, save-as-copy |
| End-to-end (real Chromium) | `tests/e2e` | `pytest tests/e2e` (after `npm run build`) | No horizontal overflow on 9 pages at 360/390/430/768/1024/1440 px; sidebar vs. bottom navigation; full invoice lifecycle through the UI incl. tax selection, preview, PDF download, partial → full payment; native share hands over the actual PDF file; WhatsApp link targets the customer; manifest, icons and service worker; offline draft survives an app restart and syncs exactly once; failed sync recovers via Retry without duplicates; conflicting edits are detected and resolved without overwriting |

## Recorded results — 3 November 2026

| Suite | Result |
|---|---|
| Backend on SQLite | **74 passed** |
| Backend on PostgreSQL 16 | **74 passed** |
| Migration check (`alembic check`) on SQLite and PostgreSQL | **No differences** between migration and models; downgrade → upgrade clean |
| Frontend type-check (`tsc --noEmit`) | **Clean** |
| Frontend unit tests (vitest) | **21 passed** |
| Production build (`vite build`) | **OK** — service worker precaches 50 files |
| End-to-end (Playwright 1.63, Chromium) | **13 passed**, 3 consecutive runs |

### Bugs found and fixed by these runs

- Dashboard "Paid vs. unpaid" legend overflowed by 86 px at 1024 px; invoice table by 7 px at 1024 px.
- Invoice item descriptions were squeezed to a few characters on desktop — rows were redesigned (description full width, figures beneath).
- Timestamps from SQLite were sent without a timezone, showing times 3 hours off in Nairobi — all timestamps are now timezone-aware UTC.
- A new tax rate's response showed `2` instead of `2.000`; empty report sums showed `0` instead of `0.00`.
- Large KSh amounts wrapped awkwardly on phone dashboards; the offline "page not saved yet" state now explains itself instead of showing a red error.
- Test-harness bugs (an unread server log pipe that froze the server; assertions that passed before sync had finished) — fixed so tests verify the real outcome on the server.

## Browser notes

Automated tests run in Chromium. Installation prompts, Background Sync and file sharing behave differently in Safari/iOS and Firefox — see [OFFLINE_SYNC.md](OFFLINE_SYNC.md#browser-specific-limitations). Those platforms were not available for automated testing here; test on a real iPhone and Android phone before launch.
