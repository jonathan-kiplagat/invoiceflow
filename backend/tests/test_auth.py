from app.core.ratelimit import limiter
from app.core.security import hash_password, verify_password
from tests.conftest import register


def test_password_hash_roundtrip():
    h = hash_password("correct horse 1")
    assert h.startswith("scrypt$") and "correct" not in h
    assert verify_password("correct horse 1", h)
    assert not verify_password("wrong", h)
    assert hash_password("same") != hash_password("same")  # salted


def test_register_login_me(client):
    u = register(client, email="Jane@Example.co.ke")
    me = client.get("/api/v1/auth/me", headers=u["headers"])
    assert me.status_code == 200
    assert me.json()["email"] == "jane@example.co.ke"
    r = client.post("/api/v1/auth/login", json={"email": "JANE@example.co.ke", "password": "s3cure-pass"})
    assert r.status_code == 200 and r.json()["access_token"]


def test_register_validation_and_duplicates(client):
    register(client, email="dup@example.co.ke")
    r = client.post("/api/v1/auth/register", json={"full_name": "X Y", "email": "dup@example.co.ke", "password": "s3cure-pass", "business_name": "Biz"})
    assert r.status_code == 409
    r = client.post("/api/v1/auth/register", json={"full_name": "X Y", "email": "new@example.co.ke", "password": "12345678", "business_name": "Biz"})
    assert r.status_code == 422
    r = client.post("/api/v1/auth/register", json={"full_name": "X Y", "email": "not-an-email", "password": "s3cure-pass", "business_name": "Biz"})
    assert r.status_code == 422


def test_bad_login_same_message(client):
    register(client, email="a@example.co.ke")
    r1 = client.post("/api/v1/auth/login", json={"email": "a@example.co.ke", "password": "wrong-pass1"})
    r2 = client.post("/api/v1/auth/login", json={"email": "nobody@example.co.ke", "password": "wrong-pass1"})
    assert r1.status_code == r2.status_code == 401
    assert r1.json()["detail"] == r2.json()["detail"]


def test_protected_routes_require_token(client):
    assert client.get("/api/v1/invoices").status_code == 401
    assert client.get("/api/v1/invoices", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_refresh_rotation_and_reuse_detection(client):
    u = register(client)
    old = u["tokens"]["refresh_token"]
    r = client.post("/api/v1/auth/refresh", json={"refresh_token": old})
    assert r.status_code == 200
    new = r.json()["refresh_token"]
    assert new != old
    # Reusing the rotated token is treated as theft: it fails and revokes the newer one too.
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": old}).status_code == 401
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": new}).status_code == 401


def test_logout_revokes_refresh(client):
    u = register(client)
    rt = u["tokens"]["refresh_token"]
    assert client.post("/api/v1/auth/logout", json={"refresh_token": rt}).status_code == 204
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": rt}).status_code == 401


def test_change_password(client):
    u = register(client, email="pw@example.co.ke")
    r = client.post("/api/v1/auth/change-password", json={"current_password": "s3cure-pass", "new_password": "n3w-password"}, headers=u["headers"])
    assert r.status_code == 200 and r.json()["access_token"]
    # Older sessions are signed out, the new tokens keep this one working.
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": r.json()["refresh_token"]}).status_code == 200
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": u["tokens"]["refresh_token"]}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": "pw@example.co.ke", "password": "s3cure-pass"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": "pw@example.co.ke", "password": "n3w-password"}).status_code == 200


def test_login_rate_limited(client, monkeypatch):
    from app.core.config import get_settings

    register(client, email="rl@example.co.ke")
    monkeypatch.setattr(get_settings(), "auth_rate_limit", 3)
    limiter.reset()
    codes = [client.post("/api/v1/auth/login", json={"email": "rl@example.co.ke", "password": "bad-pass-1"}).status_code for _ in range(5)]
    assert codes[:3] == [401, 401, 401]
    assert codes[3:] == [429, 429]
