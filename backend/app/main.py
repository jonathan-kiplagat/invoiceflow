import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import select
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.api import auth, business, customers, data, invoices, quotations, reports
from app.core.config import get_settings
from app.database.session import SessionLocal
from app.models import TEMPLATE_SEED, InvoiceTemplate

log = logging.getLogger("invoiceflow")
API_PREFIX = "/api/v1"


def ensure_reference_data() -> None:
    """Make sure the template catalogue exists (it is also seeded by the initial migration)."""
    with SessionLocal() as db:
        existing = set(db.execute(select(InvoiceTemplate.key)).scalars())
        for t in TEMPLATE_SEED:
            if t["key"] not in existing:
                db.add(InvoiceTemplate(**t))
        db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_reference_data()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=f"{settings.app_name} API",
        version=__version__,
        lifespan=lifespan,
        docs_url="/api/docs" if settings.environment != "production" else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.environment != "production" else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["Content-Disposition"],
        max_age=600,
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_: Request, exc: RequestValidationError):
        errors = []
        for e in exc.errors():
            loc = [str(p) for p in e.get("loc", []) if p not in ("body", "query", "path")]
            msg = str(e.get("msg", "Invalid value")).removeprefix("Value error, ")
            errors.append({"field": ".".join(loc), "message": msg})
        first = errors[0] if errors else {"field": "", "message": "Invalid request"}
        summary = f"{first['field']}: {first['message']}" if first["field"] else first["message"]
        return JSONResponse(status_code=422, content={"detail": summary, "errors": errors})

    @app.exception_handler(StarletteHTTPException)
    async def http_handler(_: Request, exc: StarletteHTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=getattr(exc, "headers", None))

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):  # pragma: no cover - safety net
        log.exception("Unhandled error", exc_info=exc)
        return JSONResponse(status_code=500, content={"detail": "Something went wrong on our side. Please try again."})

    for r in (auth.router, business.router, customers.router, invoices.router, quotations.router, reports.router, data.router, data.public):
        app.include_router(r, prefix=API_PREFIX)

    @app.get("/api/health", tags=["system"])
    def health() -> dict:
        return {"status": "ok", "version": __version__}

    # Optional: serve the built PWA from the same origin (single-container deployment).
    dist = Path(os.environ.get("FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
    if dist.is_dir() and (dist / "index.html").exists():
        index = dist / "index.html"

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith("api/"):
                return JSONResponse(status_code=404, content={"detail": "Not found"})
            candidate = (dist / path).resolve()
            if path and candidate.is_file() and dist.resolve() in candidate.parents:
                headers = {}
                if path in ("sw.js", "registerSW.js", "manifest.webmanifest") or path.endswith(".html"):
                    headers["Cache-Control"] = "no-cache"
                elif path.startswith("assets/"):
                    headers["Cache-Control"] = "public, max-age=31536000, immutable"
                return FileResponse(candidate, headers=headers)
            return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
