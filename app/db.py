"""sqlite3 helpers: open the database, apply schema.sql, read plans, store events idempotently."""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = Path(__file__).with_name("schema.sql")
DEFAULT_DB = ROOT / "data" / "meterledger.db"


def db_path() -> Path:
    """Database file: ``$METERLEDGER_DB`` if set, else ``data/meterledger.db``."""
    return Path(os.environ.get("METERLEDGER_DB", DEFAULT_DB))


def connect(path: str | os.PathLike | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path or db_path()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA.read_text(encoding="utf-8"))


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def period_of(timestamp: str) -> str:
    """``"2026-09-01T04:51:10Z"`` → ``"2026-09"`` (UTC calendar month)."""
    dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("timestamp must include a UTC offset, e.g. 2026-09-01T04:51:10Z")
    return dt.astimezone(timezone.utc).strftime("%Y-%m")


def load_plan(conn: sqlite3.Connection, plan_id: str) -> dict:
    """Rebuild a plan in the sample-data.json shape that :func:`app.pricing.build_invoice` takes."""
    row = conn.execute("SELECT id, name, base_fee_paise FROM plans WHERE id = ?", (plan_id,)).fetchone()
    if row is None:
        raise KeyError(f"unknown plan {plan_id!r}")
    tiers: dict[str, list[dict]] = {}
    for t in conn.execute(
        "SELECT meter_id, from_unit, to_unit, price_per_1000_paise FROM price_tiers"
        " WHERE plan_id = ? ORDER BY meter_id, from_unit", (plan_id,)):
        tiers.setdefault(t["meter_id"], []).append(
            {"from": t["from_unit"], "to": t["to_unit"], "per_1000": t["price_per_1000_paise"]})
    return {"id": row["id"], "name": row["name"], "base_fee_paise": row["base_fee_paise"], "tiers": tiers}


def record_event(conn: sqlite3.Connection, tenant_id: str, event_id: str, meter_id: str,
                 quantity: int, occurred_at: str) -> str:
    """Store one usage event exactly once.

    Returns ``"accepted"`` for a new event, ``"duplicate"`` when the same event was already stored
    (a harmless retry), or ``"conflict"`` when the event id was reused with different data — the
    API turns that into ``409 event_id_reused`` in Week 2.
    """
    cur = conn.execute(
        "INSERT INTO usage_events (tenant_id, event_id, meter_id, quantity, occurred_at, period, received_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (tenant_id, event_id) DO NOTHING",
        (tenant_id, event_id, meter_id, quantity, occurred_at, period_of(occurred_at), utc_now()))
    if cur.rowcount == 1:
        return "accepted"
    old = conn.execute(
        "SELECT meter_id, quantity, occurred_at FROM usage_events WHERE tenant_id = ? AND event_id = ?",
        (tenant_id, event_id)).fetchone()
    same = (old["meter_id"], old["quantity"], old["occurred_at"]) == (meter_id, quantity, occurred_at)
    return "duplicate" if same else "conflict"


def monthly_usage(conn: sqlite3.Connection, tenant_id: str, period: str) -> dict[str, int]:
    """Total units per meter for one tenant and month, e.g. ``{"api_calls": 135400, ...}``."""
    rows = conn.execute(
        "SELECT meter_id, SUM(quantity) AS units FROM usage_events"
        " WHERE tenant_id = ? AND period = ? GROUP BY meter_id", (tenant_id, period))
    return {r["meter_id"]: r["units"] for r in rows}
