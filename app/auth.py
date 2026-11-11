"""API key checks (PRD Section 10).

Tenants send ``X-Api-Key``; the admin sends ``X-Admin-Key``. Tenant keys are never stored: the
database keeps only their SHA-256 hash, so a key is checked by hashing what was sent.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import sqlite3


class AuthError(Exception):
    def __init__(self, status: int, error: str, detail: str):
        super().__init__(detail)
        self.status, self.error, self.detail = status, error, detail


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def admin_key() -> str | None:
    """``$ADMIN_KEY`` from the environment (see .env.example). No admin access when unset."""
    return os.environ.get("ADMIN_KEY") or None


def is_admin(sent: str | None) -> bool:
    expected = admin_key()
    return bool(sent and expected and hmac.compare_digest(sent, expected))


def tenant_for_key(conn: sqlite3.Connection, raw_key: str | None) -> sqlite3.Row:
    """Return the tenant row for an ``X-Api-Key``, or raise :class:`AuthError` (401 / 403)."""
    if not raw_key:
        raise AuthError(401, "missing_key", "Send your API key in the X-Api-Key header")
    row = conn.execute("SELECT * FROM tenants WHERE api_key_hash = ?", (hash_key(raw_key),)).fetchone()
    if row is None:
        raise AuthError(401, "bad_key", "Key not recognised")
    if row["status"] == "suspended":
        raise AuthError(403, "tenant_suspended", "This tenant is suspended")
    return row
