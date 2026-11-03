import re

from fastapi.responses import Response, StreamingResponse


def safe_filename(name: str, ext: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-.")[:60] or "document"
    return f"{base}.{ext}"


def pdf_response(pdf: bytes, filename: str, download: bool) -> Response:
    disposition = "attachment" if download else "inline"
    return Response(
        pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'{disposition}; filename="{safe_filename(filename, "pdf")}"',
                 "Cache-Control": "private, no-store"},
    )


def csv_response(content: str, filename: str) -> StreamingResponse:
    # BOM so Excel opens UTF-8 (e.g. "KSh", accented names) correctly.
    return StreamingResponse(
        iter(["﻿" + content]), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{safe_filename(filename, "csv")}"'},
    )


def csv_safe(value) -> str:
    """Neutralise spreadsheet formula injection in exported text cells."""
    s = "" if value is None else str(value)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r") and not _is_number(s):
        return "'" + s
    return s


def _is_number(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False
