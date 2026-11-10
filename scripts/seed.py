"""Create data/meterledger.db and load plans, tenants and usage events (PRD Week 1).

    python scripts/seed.py            # build a fresh database and print monthly totals per tenant
    python scripts/seed.py --keep     # load into the existing database instead of starting over

* Plans, tiers and tenants come from data/sample-data.json.
* Usage events come from data/cloud_api_usage_sample.csv (plus the JSON excerpt).
* Every event goes through app.db.record_event, so retried rows in the CSV are stored once.
* Each tenant gets a fresh API key. It is printed once here and only its SHA-256 hash is stored.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import secrets
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import db  # noqa: E402
from app.pricing import build_invoice, format_inr, validate_tiers  # noqa: E402

SAMPLE_JSON = ROOT / "data" / "sample-data.json"
SAMPLE_CSV = ROOT / "data" / "cloud_api_usage_sample.csv"
TOTALS_SQL = ROOT / "scripts" / "monthly_totals.sql"


def new_api_key() -> str:
    return "ml_" + secrets.token_urlsafe(24)


def load_catalog(conn, data: dict) -> dict[str, str]:
    """Insert meters, plans, tiers and tenants. Returns {tenant_id: raw_api_key}."""
    now = db.utc_now()
    conn.executemany(
        "INSERT OR IGNORE INTO meters (id, name, unit, aggregation) VALUES (:id, :name, :unit, :aggregation)",
        data["meters"])
    for plan in data["plans"]:
        for meter, tiers in plan["tiers"].items():
            validate_tiers(tiers)
        conn.execute(
            "INSERT OR IGNORE INTO plans (id, name, base_fee_paise, currency, active, created_at)"
            " VALUES (?, ?, ?, 'INR', 1, ?)", (plan["id"], plan["name"], plan["base_fee_paise"], now))
        for meter, tiers in plan["tiers"].items():
            conn.executemany(
                "INSERT OR IGNORE INTO price_tiers (plan_id, meter_id, from_unit, to_unit, price_per_1000_paise)"
                " VALUES (?, ?, ?, ?, ?)",
                [(plan["id"], meter, t["from"], t["to"], t["per_1000"]) for t in tiers])
    keys: dict[str, str] = {}
    for tenant in data["tenants"]:
        if conn.execute("SELECT 1 FROM tenants WHERE id = ?", (tenant["id"],)).fetchone():
            continue
        key = new_api_key()
        conn.execute(
            "INSERT INTO tenants (id, name, plan_id, api_key_hash, key_prefix, status, created_at)"
            " VALUES (?, ?, ?, ?, ?, 'active', ?)",
            (tenant["id"], tenant["name"], tenant["plan_id"],
             hashlib.sha256(key.encode()).hexdigest(), key[:8], now))
        keys[tenant["id"]] = key
    return keys


def load_events(conn, data: dict) -> Counter:
    outcomes: Counter = Counter()
    rows = list(data.get("events", []))
    with SAMPLE_CSV.open(newline="", encoding="utf-8") as f:
        rows.extend(csv.DictReader(f))
    for row in rows:
        result = db.record_event(conn, row["tenant_id"], row["event_id"], row["meter"],
                                 int(row["quantity"]), row["timestamp"])
        outcomes[result] += 1
    outcomes["rows"] = len(rows)
    return outcomes


def print_totals(conn) -> None:
    rows = conn.execute(TOTALS_SQL.read_text(encoding="utf-8")).fetchall()
    head = f"{'Tenant':<12} {'Plan':<8} {'Period':<8} {'API calls':>10} {'Emails':>8} {'Events':>7} {'Invoice estimate':>17}"
    print(head)
    print("-" * len(head))
    plans: dict[str, dict] = {}
    for r in rows:
        plan = plans.setdefault(r["plan"], db.load_plan(conn, r["plan"]))
        est = build_invoice(plan, {"api_calls": r["api_calls"], "emails_sent": r["emails_sent"]})
        print(f"{r['tenant']:<12} {r['plan']:<8} {r['period']:<8} {r['api_calls']:>10,} "
              f"{r['emails_sent']:>8,} {r['events']:>7,} {format_inr(est['total_paise']):>17}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--keep", action="store_true", help="keep the existing database")
    args = parser.parse_args(argv)

    path = db.db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if not args.keep and path.exists():
        path.unlink()
    data = json.loads(SAMPLE_JSON.read_text(encoding="utf-8"))
    with db.connect(path) as conn:
        db.init_schema(conn)
        keys = load_catalog(conn, data)
        outcomes = load_events(conn, data)
        stored = conn.execute("SELECT COUNT(*) FROM usage_events").fetchone()[0]

        print(f"Database: {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}\n")
        if keys:
            print("Tenant API keys (shown once; only the SHA-256 hash is stored):")
            for tenant_id, key in keys.items():
                print(f"  {tenant_id:<14} {key}")
            print()
        print(f"Events read {outcomes['rows']:,} · accepted {outcomes['accepted']:,} · "
              f"duplicates skipped {outcomes['duplicate']:,} · conflicts {outcomes['conflict']:,} · "
              f"rows in usage_events {stored:,}\n")
        print_totals(conn)


if __name__ == "__main__":
    main()
