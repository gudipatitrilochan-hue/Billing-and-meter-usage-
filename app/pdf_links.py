"""PDF links: store an uploaded PDF, give back a link, and bill ₹20 for it.

Each upload becomes one usage event on the ``pdf_links`` meter, written with the same
:func:`app.db.record_event` as every other event. The charge therefore lands on the monthly
estimate and invoice through the normal pricing engine, and a retried upload that carries the
same ``Idempotency-Key`` is stored and billed once.
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
import sqlite3
from pathlib import Path

from app import db
from app.pricing import build_invoice

METER = "pdf_links"
MAX_PDF_BYTES = 10 * 1024 * 1024          # 10 MB
PDF_MAGIC = b"%PDF-"
IDEMPOTENCY_RE = re.compile(r"^[A-Za-z0-9_-]{1,60}$")
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
DEFAULT_UPLOADS = db.ROOT / "data" / "uploads"


class PdfError(Exception):
    def __init__(self, status: int, error: str, detail: str):
        super().__init__(detail)
        self.status, self.error, self.detail = status, error, detail


def uploads_dir() -> Path:
    """Folder for stored PDFs: ``$METERLEDGER_UPLOADS`` if set, else ``data/uploads``."""
    path = Path(os.environ.get("METERLEDGER_UPLOADS", DEFAULT_UPLOADS))
    path.mkdir(parents=True, exist_ok=True)
    return path


def file_for(token: str) -> Path | None:
    """Path of the stored PDF for a link token, or None for a malformed token."""
    if not TOKEN_RE.match(token):
        return None
    return uploads_dir() / f"{token}.pdf"


def safe_filename(name: str | None) -> str:
    base = os.path.basename((name or "").replace("\\", "/")).strip()
    base = re.sub(r"[^\w .()\-]", "_", base)[:120].strip(" .")
    if not base:
        base = "document"
    return base if base.lower().endswith(".pdf") else base + ".pdf"


def check_pdf(data: bytes) -> None:
    if not data:
        raise PdfError(400, "empty_file", "The file is empty")
    if len(data) > MAX_PDF_BYTES:
        raise PdfError(413, "file_too_large", f"A PDF can be at most {MAX_PDF_BYTES // (1024 * 1024)} MB")
    if not data.startswith(PDF_MAGIC):
        raise PdfError(415, "not_a_pdf", "Only PDF files can be uploaded")


def row_out(row: sqlite3.Row, base_url: str) -> dict:
    return {
        "token": row["token"],
        "link": f"{base_url.rstrip('/')}/p/{row['token']}",
        "filename": row["filename"],
        "size_bytes": row["size_bytes"],
        "created_at": row["created_at"],
        "period": db.period_of(row["created_at"]),
    }


def _period_closed(conn: sqlite3.Connection, tenant_id: str, period: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM invoices WHERE tenant_id = ? AND period = ? AND status IN ('finalized', 'paid')",
        (tenant_id, period)).fetchone() is not None


def estimate(conn: sqlite3.Connection, tenant: sqlite3.Row, period: str) -> dict:
    plan = db.load_plan(conn, tenant["plan_id"])
    usage = db.monthly_usage(conn, tenant["id"], period)
    return build_invoice(plan, usage)


def create(conn: sqlite3.Connection, tenant: sqlite3.Row, filename: str | None, data: bytes,
           idempotency_key: str | None, base_url: str) -> tuple[int, dict]:
    """Store one PDF and bill it. Returns ``(http_status, body)``: 201 new, 200 for a retry."""
    if idempotency_key is not None and not IDEMPOTENCY_RE.match(idempotency_key):
        raise PdfError(400, "bad_idempotency_key", "Idempotency-Key must be 1 to 60 letters, digits, - or _")
    token = secrets.token_urlsafe(18)
    event_id = "pdf-" + (idempotency_key or token)

    existing = conn.execute("SELECT * FROM pdf_links WHERE tenant_id = ? AND event_id = ?",
                            (tenant["id"], event_id)).fetchone()
    if existing:                                   # retried upload: same link, no second charge
        return 200, {**row_out(existing, base_url), "status": "duplicate", "charged_paise": 0}

    check_pdf(data)
    plan = db.load_plan(conn, tenant["plan_id"])
    if not plan["tiers"].get(METER):
        raise PdfError(409, "pdf_not_priced", f"The {plan['name']} plan has no price for PDF links")
    now = db.utc_now()
    period = db.period_of(now)
    if _period_closed(conn, tenant["id"], period):
        raise PdfError(409, "period_closed", f"The {period} invoice is finalized; new charges for it are rejected")

    before = estimate(conn, tenant, period)["total_paise"]
    path = uploads_dir() / f"{token}.pdf"
    tmp = path.with_suffix(".part")
    tmp.write_bytes(data)
    try:
        outcome = db.record_event(conn, tenant["id"], event_id, METER, 1, now)
        if outcome != "accepted":                  # lost a race with an identical retry
            conn.rollback()
            tmp.unlink(missing_ok=True)
            row = conn.execute("SELECT * FROM pdf_links WHERE tenant_id = ? AND event_id = ?",
                               (tenant["id"], event_id)).fetchone()
            if row is None:
                raise PdfError(409, "event_id_reused", "This Idempotency-Key was already used")
            return 200, {**row_out(row, base_url), "status": "duplicate", "charged_paise": 0}
        conn.execute(
            "INSERT INTO pdf_links (token, tenant_id, event_id, filename, size_bytes, sha256, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (token, tenant["id"], event_id, safe_filename(filename), len(data),
             hashlib.sha256(data).hexdigest(), now))
        after = estimate(conn, tenant, period)["total_paise"]
        conn.commit()
    except BaseException:
        conn.rollback()
        tmp.unlink(missing_ok=True)
        raise
    tmp.replace(path)
    row = conn.execute("SELECT * FROM pdf_links WHERE token = ?", (token,)).fetchone()
    return 201, {**row_out(row, base_url), "status": "accepted", "charged_paise": after - before,
                 "estimate_total_paise": after}


def list_for(conn: sqlite3.Connection, tenant_id: str, period: str | None, base_url: str) -> list[dict]:
    rows = conn.execute("SELECT * FROM pdf_links WHERE tenant_id = ? ORDER BY created_at DESC, rowid DESC",
                        (tenant_id,)).fetchall()
    out = [row_out(r, base_url) for r in rows]
    return [r for r in out if period is None or r["period"] == period]
