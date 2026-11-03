"""End-to-end browser tests (Playwright) against a real running InvoiceFlow.

The backend is started with a throwaway SQLite database and serves the built PWA from
frontend/dist on one origin (http://127.0.0.1:8765), exactly like production, so the
service worker, manifest and offline behaviour are exercised for real.

Run:  cd frontend && npm run build && cd .. && pytest tests/e2e
"""

import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
DIST = ROOT / "frontend" / "dist"
ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
PORT = int(os.environ.get("E2E_PORT", "8765"))
BASE_URL = f"http://127.0.0.1:{PORT}"

VIEWPORTS = {
    "360": {"width": 360, "height": 780},
    "390": {"width": 390, "height": 844},
    "430": {"width": 430, "height": 932},
    "768": {"width": 768, "height": 1024},
    "1024": {"width": 1024, "height": 768},
    "1440": {"width": 1440, "height": 900},
}


def _free(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


@pytest.fixture(scope="session")
def server():
    if not (DIST / "index.html").exists():
        pytest.skip("Build the frontend first: cd frontend && npm run build")
    assert _free(PORT), f"Port {PORT} is busy"
    tmp = tempfile.mkdtemp(prefix="invoiceflow-e2e-")
    env = {
        **os.environ,
        "DATABASE_URL": f"sqlite:///{tmp}/e2e.db",
        "ENVIRONMENT": "test",
        "SECRET_KEY": "e2e-secret-key-that-is-long-enough-123456",
        "FRONTEND_DIST": str(DIST),
        "PUBLIC_APP_URL": BASE_URL,
        "CORS_ORIGINS": BASE_URL,
        "AUTH_RATE_LIMIT": "1000",
    }
    python = os.environ.get("E2E_PYTHON", sys.executable)
    subprocess.run([python, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, env=env, check=True)
    # Log to a file: an unread PIPE fills up and blocks the server mid-run.
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    log = open(ARTIFACTS / "server.log", "w")
    proc = subprocess.Popen(
        [python, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=BACKEND, env=env, stdout=log, stderr=subprocess.STDOUT,
    )
    for _ in range(100):
        try:
            if urllib.request.urlopen(f"{BASE_URL}/api/health", timeout=1).status == 200:
                break
        except OSError:
            time.sleep(0.2)
    else:
        proc.kill()
        raise RuntimeError(f"Server did not start:\n{(ARTIFACTS / 'server.log').read_text()}")
    yield BASE_URL
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
    log.close()


@pytest.fixture(scope="session")
def browser_instance():
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        yield browser
        browser.close()


@pytest.fixture
def context_factory(browser_instance, server):
    contexts = []

    def make(viewport: str = "1440", **kw):
        opts = {"viewport": VIEWPORTS[viewport], "base_url": server, "timezone_id": "Africa/Nairobi", "locale": "en-KE", "accept_downloads": True}
        if int(VIEWPORTS[viewport]["width"]) < 768:
            opts.update({"is_mobile": True, "has_touch": True, "device_scale_factor": 2})
        opts.update(kw)
        ctx = browser_instance.new_context(**opts)
        contexts.append(ctx)
        return ctx

    yield make
    for c in contexts:
        c.close()


@pytest.fixture(scope="session", autouse=True)
def _artifacts():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    yield
