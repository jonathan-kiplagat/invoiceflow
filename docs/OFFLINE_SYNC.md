# Offline drafts & synchronisation

InvoiceFlow lets you create and edit invoice and quotation **drafts** with no connection. This document explains exactly what happens to your data and what each status means.

## Where data lives

| Data | Stored | Notes |
|---|---|---|
| App code (HTML/JS/CSS/icons) | Service worker precache | Updated in the background; you're prompted to reload for a new version |
| Your drafts made/edited on this device | IndexedDB `outbox` | Survives restarts and reloads; per signed-in user |
| Last-seen server data (settings, customers, invoices, dashboard) | IndexedDB `cache` | Shown with a clear "offline copy" notice |
| API responses | **Not** cached by the service worker | Avoids serving one user's data to another |

The app also asks the browser for persistent storage so drafts aren't evicted under storage pressure (best effort; browsers decide).

## Status labels

| Label | Meaning |
|---|---|
| **Saved locally** | Autosaved on this device while you edit. Not queued yet — press *Save* to queue it. |
| **Pending sync** | Saved on this device and queued. It will be sent when the server is reachable. |
| **Syncing…** | Being sent now. |
| **Synced** | The InvoiceFlow server confirmed it stored this exact version. |
| **Sync failed** | The server rejected it (e.g. a validation error) or kept failing. The error is shown; fix and/or *Retry*. |
| **Needs review** | The invoice was changed on another device after you started editing. You choose what to keep. |

"Synced" never means the invoice was sent to, or received by, your customer. Sending is a separate, explicit action.

## How sync works

1. **Triggers:** reconnecting (`online` event), returning to the app, every 30 s while online, after pressing *Save*, and manual *Sync now / Retry*.
2. **Creating** a new document sends `POST` with a client-generated `client_uuid`. The server stores it with a unique `(business, client_uuid)` constraint, so a retry after a lost response returns the *same* invoice — never a duplicate. New customers added offline travel inside the same request and are created in the same transaction.
3. **Editing** sends `PUT` with the server `version` the edit was based on plus a `client_revision` id.
   - Version matches → applied, version + 1.
   - Version differs but `client_revision` equals the last one the server applied → it's a retry of an update that already succeeded → returns success without changing anything.
   - Otherwise → `409 version_conflict`. The draft becomes **Needs review** and nothing on the server changes.
4. **Errors:** network failures leave the draft *Pending* and retry with exponential backoff (2 s → 5 min). `5xx/429/408` mark it *Sync failed* but retry automatically (up to 6 times). `4xx` validation errors mark it *Sync failed* and wait for you.
5. A single sync run is shared by concurrent triggers, and each draft is claimed atomically, so the same draft is never submitted twice in parallel. Tabs are kept in step via `BroadcastChannel`.

## Resolving a conflict

In **Offline & sync → Resolve** you see both versions side by side and choose:

- **Keep the server version** — discard this device's edits.
- **Keep both** — save this device's edits as a new draft invoice.
- **Replace the server version with mine** — requires a second confirmation; only then is `force_overwrite` sent. Recorded payments are never touched, and the server still refuses edits that would make the total lower than the payments already recorded.

## What needs a connection

Recording payments, generating/downloading PDFs, sharing, sending, changing settings, and reports with fresh numbers. These buttons are disabled offline with an explanation, so balances can never drift from the server.

## Browser-specific limitations

- **iOS Safari:** no Background Sync API — pending drafts upload the next time InvoiceFlow is opened online. Installation is manual (*Share → Add to Home Screen*). Storage may be cleared if the app isn't used for several weeks; sync regularly.
- **Firefox:** no PWA installation on desktop; offline drafts work in the browser.
- **Private/incognito windows:** IndexedDB is wiped when the window closes.
- **Service workers require HTTPS** (or `localhost`).
