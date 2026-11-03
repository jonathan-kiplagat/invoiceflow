# Deployment

InvoiceFlow ships as one container that serves the API **and** the built PWA from the same origin, plus PostgreSQL.

## Docker Compose (recommended)

```bash
cp .env.example .env
# Edit .env:
#   ENVIRONMENT=production
#   SECRET_KEY=<python -c "import secrets; print(secrets.token_urlsafe(48))">
#   POSTGRES_PASSWORD=<strong password>
#   PUBLIC_APP_URL=https://invoices.example.co.ke
docker compose up --build -d
docker compose logs -f app
```

The container runs `alembic upgrade head` on start, then serves on port 8000 with a health check at `/api/health`.

### HTTPS

Service workers, installation and the share sheet require HTTPS. Put a reverse proxy in front, for example Caddy:

```
invoices.example.co.ke {
    reverse_proxy localhost:8000
}
```

### Backups

- Database: `docker compose exec db pg_dump -U invoiceflow invoiceflow > backup.sql`
- Per-account: users can download a JSON backup from **Settings → Data & backup**.

## Without Docker

```bash
cd frontend && npm ci && npm run build          # produces frontend/dist
cd ../backend && pip install -r requirements.txt
export DATABASE_URL=postgresql://user:pass@host:5432/invoiceflow SECRET_KEY=... ENVIRONMENT=production
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2 --proxy-headers
```

The API automatically serves `frontend/dist` (override the location with `FRONTEND_DIST`).

## Platform notes

- Any container host works (Render, Railway, Fly.io, a VPS, etc.). Use a managed PostgreSQL and set `DATABASE_URL`.
- The built-in rate limiter is per process. With several workers or instances, add rate limiting at the proxy or move it to Redis.
- Set `CORS_ORIGINS` only if you host the frontend on a different origin from the API.

## Email (optional)

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` (and `SMTP_USE_TLS`/`SMTP_USE_SSL`). The app reports an email as "accepted by the mail server" only when the SMTP server accepts it; delivery to the inbox can't be confirmed. Without SMTP, users get a prepared message to send from their own mail app.

## Integrations not included

| Integration | Status |
|---|---|
| M-Pesa Daraja (STK push / C2B) | Not implemented. Payment instructions are printed; payments are recorded manually. |
| KRA eTIMS | Not implemented, not certified. No electronic tax invoices are issued or submitted. |
| Email | Implemented via SMTP; requires your SMTP credentials. |
